/**
 * Combat-log / ship-panel VISIBILITY through the PRODUCTION `simulateBattle` routing.
 *
 * Three engine effects really happened but were invisible (or misfiled) in what the
 * Simulator page shows. Each is asserted here through `simulateBattle` — NOT by
 * subscribing a hand-rolled bus — because all three defects live in the production
 * wiring between the engine's event stream and the assembled result:
 *
 *  1. A drain-time REACTIVE cleanse (AEGIS's on-ally-shield-destroyed "cleanses all
 *     debuffs") emits `reactive-cleanse-performed`, but that type was missing from
 *     `LOG_EVENT_TYPES` — the bus never subscribed it, so `buildCombatLog`'s handler
 *     for it was dead code and the reaction never reached the log.
 *  2. A `start-of-turn` shield grant (the SHIELD gear set) fires BEFORE the acting
 *     actor produces any entry, so `routeReaction` found no trigger to nest under and
 *     dumped it into `endOfRound` instead of the actor's own turn.
 *  3. `ShipRoundState.activeDebuffs` was infliction-only — no removal path at all, so a
 *     cleansed (or expired, or purged) debuff stayed listed for the rest of the battle.
 */
import { describe, it, expect } from 'vitest';
import {
    simulateBattle,
    type BattleSimulationInput,
    type BattlePlacement,
} from '../../calculators/battleSimulator';
import { setupKeyedTestRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { Position } from '../../../types/encounters';
import type { CombatLogEntry } from '../log/types';

const SEED = 4242;

/** Deterministic stats: crit 0 so damage never varies, high hacking vs low security so
 *  debuff landing is certain, speed set explicitly to pin turn order. */
function statsFor(over: { attack: number; speed: number; hp: number }) {
    return {
        attack: over.attack,
        crit: 0,
        critDamage: 0,
        hacking: 500,
        security: 0,
        defence: 0,
        hp: over.hp,
        speed: over.speed,
    };
}

function ship(over: Partial<Ship> & { id: string; name: string }): Ship {
    return {
        rarity: 'legendary',
        faction: 'MPL',
        type: 'ATTACKER',
        affinity: 'antimatter',
        baseStats: {
            hp: 100_000,
            attack: 1000,
            defence: 0,
            hacking: 500,
            security: 0,
            crit: 0,
            critDamage: 0,
            speed: 100,
        },
        equipment: {},
        implants: {},
        // Two refits → the R2 (second) passive is the refit-active one (getShipSkillRows).
        refits: [{}, {}],
        ...over,
    } as Ship;
}

/** AEGIS-shaped support: grants an all-ally shield on cast, and on an ally's shield being
 *  destroyed grants Defense Up II AND cleanses all debuffs (its real R2 passive text). */
const SHIELDER_SHIELD_PCT = 10;
function shielder(id: string, extra: Partial<Ship> = {}): Ship {
    return ship({
        id,
        name: 'Shielder',
        type: 'DEFENDER',
        activeSkillText: `This Unit grants <unit-damage>Shield equal to ${SHIELDER_SHIELD_PCT}%</unit-damage> of its Max HP.`,
        secondPassiveSkillText:
            'This Unit grants <unit-skill>Defense Up II</unit-skill> for 1 turn and <unit-aid>cleanses all</unit-aid> debuffs when an ally within the Active pattern has their Shield destroyed.',
        // State the targeting DATA COLUMNS (see `debuffer`'s note for why). The R2
        // passive is `patternScoped` — "an ally within the Active pattern" — so the Active pattern
        // is what bounds its reach, and leaving the columns empty left the boundary to fill a
        // single-cell front-ENEMY footprint for a support ship. These are the REAL Aegis columns
        // from docs/ship-data.json; from M2 that support cone covers {M2, T2, M3, M4, B2}, so the
        // M3 debuffer is inside it and the narrowing is not what limits the cleanse below.
        activeTarget: 'allies',
        activePattern: 'Pattern-Prolonged_Cone-Support-Range-2',
        ...extra,
    });
}

/** Curator-shaped AoE debuffer: inflicts a timed debuff on every enemy and hits them.
 *
 *  The `activeTarget`/`activePattern` DATA COLUMNS are now stated. `parseShipTargeting`
 *  reads those columns, NOT the skill text, so leaving them empty made `plan.targeting` undefined
 *  and the cast had no board footprint at all — which the pre-boundary engine resolved to the
 *  legacy sink. The boundary fills an absent footprint with SINGLE-TARGET front-enemy, and a
 *  single-target cast reaches only the front-most opposing cell (M3, the other debuffer) and never
 *  the M2 shielder, so no shield was ever broken and the whole reactive-cleanse chain went dead.
 *  Every production ship carries these columns; stating them is what makes this fixture's
 *  "damage to ALL enemies" claim true of the run and not only of the prose. */
function debuffer(id: string): Ship {
    return ship({
        id,
        name: 'Debuffer',
        activeSkillText:
            'This Unit deals <unit-damage>100% damage</unit-damage> to all enemies, and inflicts <unit-skill>Attack Down III</unit-skill> for 2 turns.',
        activeTarget: 'all',
        activePattern: 'Pattern-All',
    });
}

function place(s: Ship, position: Position, st: ReturnType<typeof statsFor>): BattlePlacement {
    return { ship: s, position, statOverrides: st };
}

function run(
    input: BattleSimulationInput,
    getGearPiece?: (id: string) => GearPiece | undefined
): ReturnType<typeof simulateBattle> {
    setupKeyedTestRng(SEED);
    try {
        return simulateBattle(input, getGearPiece);
    } finally {
        resetRateGateRng();
    }
}

function walk(
    entries: CombatLogEntry[],
    visit: (e: CombatLogEntry, depth: number) => void,
    depth = 0
): void {
    for (const e of entries) {
        visit(e, depth);
        walk(e.reactions ?? [], visit, depth + 1);
    }
}

function collect(entries: CombatLogEntry[]): CombatLogEntry[] {
    const out: CombatLogEntry[] = [];
    walk(entries, (e) => out.push(e));
    return out;
}

// ── Scenario: shielder + debuffer per side. The SHIELDER acts first (higher speed) so a
// shield pool exists; the DEBUFFER then debuffs + breaks that shield in the same cast,
// firing the shielder's on-ally-shield-destroyed cleanse. The attack is tuned to exceed
// the 10%-max-HP pool without killing anyone.
function shieldBreakScenario(shielderExtra: Partial<Ship> = {}): BattleSimulationInput {
    const fast = statsFor({ attack: 1000, speed: 200, hp: 100_000 });
    const slow = statsFor({ attack: 30_000, speed: 100, hp: 100_000 });
    return {
        playerTeam: [
            place(shielder('p-shield', shielderExtra), 'M2', fast),
            place(debuffer('p-debuff'), 'M3', slow),
        ],
        enemyTeam: [
            place(shielder('e-shield', shielderExtra), 'M2', fast),
            place(debuffer('e-debuff'), 'M3', slow),
        ],
        rounds: 3,
    };
}

describe('combat-log visibility — reactive cleanse', () => {
    it('surfaces a drain-time reactive cleanse as a cleanse entry in the combat log', () => {
        const result = run(shieldBreakScenario());

        // Sanity: the trigger really fired, otherwise the cleanse assertion is vacuous.
        const allEntries = result.combatLog.flatMap((r) => [
            ...collect(r.startOfRound ?? []),
            ...r.turns.flatMap((t) => collect(t.entries)),
            ...collect(r.endOfRound ?? []),
        ]);
        expect(
            allEntries.filter((e) => e.kind === 'shield-destroyed').length,
            'precondition: a shield must actually be destroyed'
        ).toBeGreaterThan(0);

        expect(allEntries.filter((e) => e.kind === 'cleanse').length).toBeGreaterThan(0);
    });
});

describe('combat-log visibility — start-of-turn shield grant placement', () => {
    const SHIELD_SET_PIECES: GearPiece[] = ['Weapon', 'Hull', 'Generator', 'Sensor'].map(
        (slot, i) => ({
            id: `sh-${i}`,
            slot,
            level: 20,
            stars: 6,
            rarity: 'legendary',
            mainStat: { name: 'hp', value: 100, type: 'flat' },
            subStats: [],
            setBonus: 'SHIELD',
        })
    );
    const getGearPiece = (id: string): GearPiece | undefined =>
        SHIELD_SET_PIECES.find((p) => p.id === id);
    const equipment = {
        Weapon: 'sh-0',
        Hull: 'sh-1',
        Generator: 'sh-2',
        Sensor: 'sh-3',
    } as Ship['equipment'];

    it("files a start-of-turn shield grant under the granting actor's turn, not endOfRound", () => {
        const result = run(shieldBreakScenario({ equipment }), getGearPiece);

        const round1 = result.combatLog.find((r) => r.round === 1);
        if (!round1) throw new Error('fixture: no round 1 in the combat log');

        // The SHIELD gear set grants 4% of max HP at start-of-turn — a separate, smaller grant
        // than the shielder's 10%-max-HP active cast. Find it by amount.
        const setGrant = (entries: CombatLogEntry[]): CombatLogEntry[] =>
            collect(entries).filter(
                (e) =>
                    e.kind === 'shield' &&
                    e.targets.some((t) => t.amount !== undefined && Math.round(t.amount) === 4000)
            );

        const inTurns = round1.turns.flatMap((t) => setGrant(t.entries));
        const inEndOfRound = setGrant(round1.endOfRound ?? []);

        expect(
            inTurns.length + inEndOfRound.length,
            'precondition: the SHIELD set must grant a 4%-max-HP pool'
        ).toBeGreaterThan(0);
        expect(inEndOfRound).toHaveLength(0);
        expect(inTurns.length).toBeGreaterThan(0);
    });
});

describe('ship-panel state — activeDebuffs reflects removal', () => {
    /** Every `debuff` log entry naming `buffName`, across all rounds/nesting levels. */
    function debuffEntries(
        result: ReturnType<typeof simulateBattle>,
        buffName: string
    ): CombatLogEntry[] {
        return result.combatLog
            .flatMap((r) => [
                ...collect(r.startOfRound ?? []),
                ...r.turns.flatMap((t) => collect(t.entries)),
                ...collect(r.endOfRound ?? []),
            ])
            .filter((e) => e.kind === 'debuff' && e.note === buffName);
    }

    it('drops a debuff from activeDebuffs once the reactive cleanse removes it', () => {
        const result = run(shieldBreakScenario());

        // Precondition read from the LOG, not from activeDebuffs — asserting the precondition on
        // the very field under test would make the test vacuous once the fix lands.
        expect(
            debuffEntries(result, 'Attack Down III').length,
            'precondition: Attack Down III must actually be inflicted'
        ).toBeGreaterThan(0);

        const round1 = result.rounds.find((r) => r.round === 1);
        if (!round1) throw new Error('fixture: no round 1 in the result');

        // The R2 cleanse is `target: 'ally'`, so it clears the ONE ally the trigger named — the
        // shielder whose shield broke. By the end of round 1 neither shielder still carries Attack
        // Down III, while the two debuffers (which nothing cleansed) still do.
        //
        // SP-4b-1 note on what this used to assert. The old form was "NO ship still lists it", and
        // it held for a reason that had nothing to do with the removal path under test: the
        // debuffer's cast carried no board footprint, so its AoE debuff went into the legacy dummy
        // sink and `activeDebuffs` came back EMPTY for every ship in every round (verified by
        // running this same probe against the pre-boundary tree). Now that the cast lands on the
        // real, placed enemies the snapshot is populated, and the assertion has to name who was
        // cleansed and who was not. The still-carrying debuffers are what makes it non-vacuous: an
        // `activeDebuffs` that degenerated back to always-empty now FAILS this test instead of
        // passing it — which is exactly the regression this file exists to catch.
        const byId = new Map(round1.ships.map((s) => [s.actorId, s.activeDebuffs]));
        const carries = (id: string) => (byId.get(id) ?? []).includes('Attack Down III');
        expect([...byId.keys()].sort()).toEqual([
            'attacker',
            'e:e-debuff:1',
            'e:e-shield:0',
            'p:p-debuff:1',
        ]);
        // Removed from the cleansed shielders (the player focus and the enemy shielder)…
        expect(carries('attacker')).toBe(false);
        expect(carries('e:e-shield:0')).toBe(false);
        // …and still listed on the un-cleansed debuffers.
        expect(carries('p:p-debuff:1')).toBe(true);
        expect(carries('e:e-debuff:1')).toBe(true);
    });

    it('still lists a debuff that was never removed', () => {
        // Same scenario minus the cleanse: the shielder keeps only its shield-granting active
        // (no R2 passive), so nothing removes Attack Down III and it MUST remain listed. Guards
        // against the snapshot degenerating into "always empty", which would pass the test above
        // for the wrong reason.
        const noCleanse = shieldBreakScenario({ secondPassiveSkillText: undefined });
        const result = run(noCleanse);

        expect(
            debuffEntries(result, 'Attack Down III').length,
            'precondition: Attack Down III must actually be inflicted'
        ).toBeGreaterThan(0);

        const round1 = result.rounds.find((r) => r.round === 1);
        if (!round1) throw new Error('fixture: no round 1 in the result');
        expect(round1.ships.map((s) => s.activeDebuffs).flat()).toContain('Attack Down III');
    });
});
