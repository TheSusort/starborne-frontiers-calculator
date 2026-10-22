/**
 * Integration: Cobalt start-of-turn full-HP self-charge.
 *
 * Cobalt's passive text "Every turn this Unit adds 1 charge to its charged skill if it is at full
 * HP" is parsed into a charge ability:
 *   { type:'charge', target:'self', trigger:'start-of-turn',
 *     conditions:[{ subject:'hp-threshold', derivable:true, hpComparator:'above',
 *                   hpPercent:99, hpSubject:'self' }],
 *     config:{ type:'charge', amount:1 } }
 *
 * The ability under test is RESOLVED FROM THE REAL PARSER PATH: we hand `buildShipAbilities` a Ship
 * whose `firstPassiveSkillText` is Cobalt's real corpus string and pull the start-of-turn charge
 * ability out of the built passive slot — so the shape the engine runs is the parser's genuine
 * output, not a hand-rolled copy (mirrors the Chrono Reaver goldens' implant-resolution discipline).
 *
 * We then run that ability through `runCombat` (the battle-sim engine) with a two-side roster (the
 * Cobalt focus vs. an enemy attacker) and read the focus's per-round charge counts from
 * `result.rounds[].charges` (the focus's END-OF-ROUND live charge counter) and
 * `result.rounds[].action` ('active' | 'charged'). `simulateBattle`'s result surfaces damage/HP but
 * NOT charge counts, so `runCombat` is the only entry point that can pin the per-round charge ledger
 * (same reason the Chrono Reaver / Phase-1 charge goldens use it).
 *
 * ─── TIMING (baked into the ledgers) ─────────────────────────────────────────────────────────
 * Charges are live (owner ruling 2026-10-22): the `start-of-turn` charge intent is enqueued on
 * `turn-started` and drains BEFORE the skill pick (`drainStartOfTurnGrants` in engine.ts), so
 * Cobalt's +1 proc counts toward the skill he uses that same turn. The +1/turn baseline
 * (advanceChargeCadence) still banks after an active cast. Net effect at full HP: the bar
 * advances by +2 each active turn, so the charged skill fills ~twice as fast as a no-passive
 * baseline; and a Cobalt one charge short at turn start fires his charged skill that turn. A
 * proc landing on an already-full bar is lost at the cap.
 *
 * ─── SELF-HP LIVENESS (drives Part 2's approach) ──────────────────────────────────────────────
 * The drain-time `hpSubject:'self'` gate reads `selfHpPctFor(ownerId)`. On the player side that
 * closure returns LIVE HP (currentHp / maxHp * 100) ONLY for the heal-target actor, and 100 for
 * every other owner (engine.ts ~1836). Because `buildInput` sets `healTargetId:'attacker'` (the
 * focus IS the heal target), the focus's live HP IS threaded into its own gate — so a damaged focus
 * genuinely flips the gate false. Part 2 therefore uses the PREFERRED live-HP approach (a): an
 * enemy attacker that acts BEFORE the focus dents it below 99% every turn, and the proc is
 * suppressed on every round (NOT the Arcane-Siege-style always-100 fallback (b)).
 */

import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parseChargeGain } from '../../skillTextParser';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Cobalt's two real corpus passive strings. Buff names are wrapped in <unit-skill> tags exactly as
// the game CSV stores them (the buff/effect parser reads buff names from those tags — an untagged
// "Out. Damage Up II" is invisible to parseAllSkillEffects, so the corpus-faithful tagged form is
// required for Part 3 to exercise the real swallow hazard).
const COBALT_P1 =
    'Every turn this Unit <unit-skill>adds 1 charge</unit-skill> to its charged skill if it is at full HP.';
const COBALT_P2 =
    'Every turn this Unit <unit-skill>adds 1 charge</unit-skill> to its charged skill and gains ' +
    '<unit-skill>Out. Damage Up II</unit-skill> for 1 turn if it is at full HP.';

// ─── Real parser resolution ───────────────────────────────────────────────────────
// Resolve Cobalt's abilities from the SAME path production uses: a Ship carrying the passive text,
// through buildShipAbilities. This is the genuine parser output (Tasks 6-8), not a hand-rolled copy.

function makeShip(passiveText: string): Ship {
    return {
        id: 'cobalt',
        name: 'Cobalt',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        stats: [],
        equipment: {},
        implants: {},
        refits: [],
        firstPassiveSkillText: passiveText,
    } as Ship;
}

/** Pull the passive-slot abilities buildShipAbilities produces from a Cobalt passive string. */
function resolvePassiveAbilities(passiveText: string): Ability[] {
    const skills = buildShipAbilities(makeShip(passiveText));
    return skills.slots.find((s) => s.slot === 'passive')?.abilities ?? [];
}

/** The start-of-turn self-charge ability, resolved from the real parser path. */
function resolveCobaltCharge(passiveText: string): Ability {
    const charge = resolvePassiveAbilities(passiveText).find(
        (a) => a.type === 'charge' && a.trigger === 'start-of-turn'
    );
    if (!charge) throw new Error('expected a start-of-turn charge ability from the Cobalt passive');
    return charge;
}

// ─── Ability + enemy fixtures ───────────────────────────────────────────────────────

const damage = (multiplier: number, id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** A passive, charge-less dummy/sink enemy: slow (speed 40, acts AFTER the focus), tiny attack
 *  (1) so it never meaningfully dents a 1e9-HP focus → the focus stays at full HP and Cobalt's
 *  gate stays true. Present only so the run is a real two-side battle. */
const dummySink = (): EnemyAttacker => ({
    id: 'e-sink',
    stats: { attack: 1, crit: 0, critDamage: 0, speed: 40 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [{ slot: 'active', abilities: [damage(1, 'es-a')] }],
    },
});

/** A heavy hitter that acts BEFORE the focus (speed 200 > 100) and dents it below 99% every turn,
 *  but never kills it: vs a 1,000,000-HP focus a 100% hit of attack 100000 removes ~100000/turn, so
 *  over 6 rounds the focus drops to ~40% and lives the whole run. Drives Part 2's live-HP gate flip. */
const heavyHitter = (): EnemyAttacker => ({
    id: 'heavy',
    stats: { attack: 100000, crit: 0, critDamage: 0, speed: 200, defence: 0, hp: 1_000_000_000 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [{ slot: 'active', abilities: [damage(100, 'hv-a')] }],
    },
});

// ─── Player / engine input ────────────────────────────────────────────────────────

/** A charged player focus (id 'attacker', speed 100). active 50% / charged 400% so a charged cast
 *  is plainly distinguishable from an active one. `healTargetId:'attacker'` makes the focus its own
 *  heal target so its live HP feeds the drain-time self hp-threshold gate. The under-test charge
 *  ability rides the passive slot; `hp` and `enemyAttackers` are caller-tunable so the same builder
 *  serves the full-HP (Part 1) and damaged (Part 2) scenarios. */
const buildInput = (opts: {
    chargeCount: number;
    numRounds: number;
    passiveAbilities?: Ability[];
    hp?: number;
    enemyAttackers?: EnemyAttacker[];
}): CombatEngineInput => {
    const slots: ShipSkills['slots'] = [
        { slot: 'active', abilities: [damage(50, 'p-a')] },
        { slot: 'charged', abilities: [damage(400, 'p-c')] },
    ];
    if (opts.passiveAbilities && opts.passiveAbilities.length) {
        slots.push({ slot: 'passive', abilities: opts.passiveAbilities });
    }
    return {
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: opts.chargeCount,
        shipSkills: { slots },
        numRounds: opts.numRounds,
        selfBuffs: [],
        enemyDebuffs: [],
        hasChargedSkill: true,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: opts.hp ?? 1_000_000_000,
        speed: 100,
        healTargetId: 'attacker',
        mode: 'healing',
        enemyAttackers: opts.enemyAttackers ?? [dummySink()],
    };
};

/** Convenience: the per-round (action, charges) ledger for the focus. */
const ledger = (r: ReturnType<typeof runCombat>): Array<[string, number]> =>
    r.rounds.map((x) => [x.action, x.charges]);

// ─── Part 1: full-HP proc ─────────────────────────────────────────────────────────

describe('Cobalt start-of-turn charge — full-HP proc', () => {
    it('banks an EXTRA +1/turn beyond baseline; charged fills ~twice as fast', () => {
        // chargeCount 8 so the cadence is visible across 8 rounds. At full HP the gate is always
        // true, so the bar advances by +2 each active turn: Cobalt's +1 proc BEFORE the skill pick,
        // then the +1 baseline (advanceChargeCadence) after the active cast.
        //
        // Per-round ledger (focus turnsTaken === round):
        //   R1 (t1): proc 0→1, active 1<8, baseline 1→2              → charges 2
        //   R2 (t2): proc 2→3, active 3<8, baseline 3→4              → charges 4
        //   R3 (t3): proc 4→5, active 5<8, baseline 5→6              → charges 6
        //   R4 (t4): proc 6→7, active 7<8, baseline 7→8 (fills bar)  → charges 8
        //   R5 (t5): proc lost at the cap, 8≥8 → CHARGED, reset      → charges 0
        //   R6 (t6): proc 0→1, active, baseline 1→2                  → charges 2
        //   R7 (t7): proc 2→3, active, baseline 3→4                  → charges 4
        //   R8 (t8): proc 4→5, active, baseline 5→6                  → charges 6
        const charge = resolveCobaltCharge(COBALT_P1);
        const proc = runCombat(
            buildInput({ chargeCount: 8, numRounds: 8, passiveAbilities: [charge] })
        );

        expect(ledger(proc)).toEqual([
            ['active', 2],
            ['active', 4],
            ['active', 6],
            ['active', 8],
            ['charged', 0],
            ['active', 2],
            ['active', 4],
            ['active', 6],
        ]);

        // No-passive baseline: pure +1/turn cadence — it only just reaches the cap on R8 (→ charged
        // R9, outside the window), so it NEVER fires a charged cast in 8 rounds.
        const base = runCombat(buildInput({ chargeCount: 8, numRounds: 8 }));
        expect(ledger(base)).toEqual([
            ['active', 1],
            ['active', 2],
            ['active', 3],
            ['active', 4],
            ['active', 5],
            ['active', 6],
            ['active', 7],
            ['active', 8],
        ]);

        // Differential: Cobalt fires its charged skill by R5 (the +2/turn fill reaches 8 at R4 →
        // charged R5); the no-passive baseline fires none within 8 rounds. The proc roughly doubles
        // the fill rate, exactly as the parsed start-of-turn +1 should.
        const procCharged = proc.rounds.filter((x) => x.action === 'charged').map((x) => x.round);
        const baseCharged = base.rounds.filter((x) => x.action === 'charged').map((x) => x.round);
        expect(procCharged).toEqual([5]);
        expect(baseCharged).toEqual([]);
    });
});

// ─── Part 2: damaged → no proc (PREFERRED live-HP approach (a)) ──────────────────────

describe('Cobalt start-of-turn charge — damaged focus suppresses the proc (live-HP)', () => {
    it('a focus below 99% HP banks only the +1/turn baseline (the full-HP gate flips false)', () => {
        // APPROACH (a), the PREFERRED live-HP path. The focus is its own heal target
        // (healTargetId:'attacker'), so selfHpPctFor returns its LIVE HP% to the drain-time
        // hp-threshold gate. A heavy enemy attacker (speed 200) acts BEFORE the focus (speed 100)
        // each round, so by the focus's turn-start its HP is already < 99% — INCLUDING round 1 (the
        // attacker's round-1 hit lands before the focus's first turn). The gate (hp-threshold ABOVE
        // 99 self) is therefore false on EVERY turn, so Cobalt's +1 proc never fires and the bar
        // advances by only the +1/turn baseline (which is NOT HP-gated):
        //   R1..R6: active, baseline +1 each, proc SUPPRESSED → 1,2,3,4,5,6
        // (vs the full-HP control's 2,4,6,... — the +1 proc is exactly the missing increment.)
        const charge = resolveCobaltCharge(COBALT_P1);
        const damaged = runCombat(
            buildInput({
                chargeCount: 8,
                numRounds: 6,
                passiveAbilities: [charge],
                hp: 1_000_000, // large pool: dented below 99% but never killed across 6 rounds
                enemyAttackers: [heavyHitter()],
            })
        );

        expect(ledger(damaged)).toEqual([
            ['active', 1],
            ['active', 2],
            ['active', 3],
            ['active', 4],
            ['active', 5],
            ['active', 6],
        ]);

        // The proc is missing on EVERY round: a full-HP control (same charge, same chargeCount, but
        // the harmless dummy sink) banks +2/turn from R1. The damaged run is strictly behind from R1
        // onward — the gap is exactly the suppressed +1/turn proc.
        const control = runCombat(
            buildInput({ chargeCount: 8, numRounds: 6, passiveAbilities: [charge] })
        );
        expect(ledger(control)).toEqual([
            ['active', 2],
            ['active', 4],
            ['active', 6],
            ['active', 8],
            ['charged', 0],
            ['active', 2],
        ]);
        for (let i = 0; i < 4; i++) {
            // R1..R4 (pre-control-reset window): damaged strictly fewer charges than the full-HP run.
            expect(damaged.rounds[i].charges).toBeLessThan(control.rounds[i].charges);
        }

        // Structural sanity: the resolved ability really carries the full-HP self gate that drives
        // the suppression (so the differential above is the gate flipping, not some unrelated effect).
        expect(charge.conditions).toEqual([
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'above',
                hpPercent: 99,
                hpSubject: 'self',
            },
        ]);
    });
});

// ─── Direct parse assertion ────────────────────────────────────────────────────────
// Complements the integration-path assertions above: confirms the PARSER OUTPUT shape for
// the 2nd-passive string directly, independent of buildShipAbilities / the engine path.

describe('Cobalt second passive — parseChargeGain direct parse assertion', () => {
    it('parseChargeGain returns start-of-turn + full-HP gate for the 2nd-passive string', () => {
        const result = parseChargeGain(COBALT_P2);
        expect(result).toEqual({
            amount: 1,
            condition: 'always',
            derivable: true,
            trigger: 'start-of-turn',
            conditions: [
                {
                    subject: 'hp-threshold',
                    derivable: true,
                    hpComparator: 'above',
                    hpPercent: 99,
                    hpSubject: 'self',
                },
            ],
        });
    });
});

// ─── Part 3: second-passive co-buff coexistence ─────────────────────────────────────

describe('Cobalt second passive — charge AND Out. Damage Up II coexist (no clause swallow)', () => {
    it('buildShipAbilities yields BOTH the start-of-turn charge AND the Out. Damage Up II buff', () => {
        // The 2nd-passive text joins the charge clause and the buff clause with "and", and the buff
        // name carries the "Out." abbreviation period — a known clause-scoping hazard (abbreviation
        // periods must be masked before sentence-splitting in BOTH skillTextParser and auditSkills,
        // or the period reads as a sentence boundary and the buff clause is swallowed). This asserts
        // the buff SURVIVES: the parser emits a charge ability AND a buff ability for the SAME passive.
        const abilities = resolvePassiveAbilities(COBALT_P2);

        const charge = abilities.find((a) => a.type === 'charge' && a.trigger === 'start-of-turn');
        expect(charge, 'start-of-turn charge ability present').toBeDefined();

        const buff = abilities.find(
            (a) =>
                a.type === 'buff' &&
                a.config.type === 'buff' &&
                a.config.buffName === 'Out. Damage Up II'
        );
        expect(
            buff,
            'Out. Damage Up II buff ability present (not swallowed by the "Out." period)'
        ).toBeDefined();

        // The buff is self-targeted and inherits the same full-HP gate as the charge (both are
        // gained "every turn … if it is at full HP").
        expect(buff!.target).toBe('self');
        expect(buff!.conditions).toEqual([
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'above',
                hpPercent: 99,
                hpSubject: 'self',
            },
        ]);

        // The buff half shares the SAME start-of-turn trigger as the charge half — both are
        // gained "every turn", which buildShipAbilities' detectEveryTurnTrigger promotion reads
        // for the buff — so the buff applies once per turn instead of re-granting on every skill
        // use.
        expect(buff!.trigger).toBe('start-of-turn');
    });
});

// ─── The start-of-turn grant precedes the owner's cast ───────────────────────────────────────
//
// The acting owner's start-of-turn grants drain between the turn-started emit and the cast, so the
// Out. Damage Up II buff boosts the SAME turn it is granted — every turn, not every other turn.
describe('Cobalt Out. Damage Up II — engine consumption (recurring, every turn)', () => {
    // SP-4c-2a (B1): `dummySink()` (buildInput's default enemy) carries no `stats.hp`, so the
    // targetable-HP floor (normalizeRoster.ts) now raises it to MIN_TARGETABLE_MAX_HP and the run
    // is positional — the scalar `directDamage` credit is suppressed in favour of the per-victim
    // map. Read the per-victim channel only — NO scalar fallback. Every call below goes through
    // `buildInput` without an `enemyAttackers` override, so every run in this file uses the same
    // always-positional `dummySink()`; a fallback to the scalar channel would never fire and would
    // only mask a future regression (the deleted non-positional shape returning) by silently
    // reading a stale 0 instead of failing loudly. Matches the stricter, fallback-free shape in
    // `enemyTeamRouting.test.ts`'s `playerDealt`.
    const runFocusDamage = (withBuff: boolean): number[] => {
        const abilities = resolvePassiveAbilities(COBALT_P2).filter(
            (a) =>
                a.type !== 'charge' &&
                (withBuff ||
                    !(a.config.type === 'buff' && a.config.buffName === 'Out. Damage Up II'))
        );
        const r = runCombat(
            buildInput({ chargeCount: 0, numRounds: 4, passiveAbilities: abilities })
        );
        return r.rounds.map((round) => {
            const perVictim = round.perTargetDealt?.['attacker'];
            return perVictim ? Object.values(perVictim).reduce((sum, v) => sum + v, 0) : 0;
        });
    };

    it('the buff boosts EVERY turn (pre-cast grant ordering)', () => {
        const boosted = runFocusDamage(true);
        const control = runFocusDamage(false);
        expect(boosted[0]).toBeGreaterThan(control[0]);
        expect(boosted[1]).toBeGreaterThan(control[1]);
        expect(boosted[2]).toBeGreaterThan(control[2]);
        expect(boosted[3]).toBeGreaterThan(control[3]);
    });
});

// ─── Charges are live: a start-of-turn charge counts toward that turn's skill ───────────────────
//
// Owner ruling 2026-10-22 (ledger row 3.3): Cobalt at full HP, one charge short of a full bar at
// the start of his turn, fires his CHARGED skill that turn. chargeCount 3 puts him in exactly that
// state on every second turn: R1 proc 0→1, active, baseline →2; R2 starts one short, proc 2→3,
// CHARGED. Banking the proc after the cast instead would give R2 an active (2<3) and push every
// charged cast one round later (R3/R5 instead of R2/R4/R6).
describe('Cobalt one charge short at turn start fires his charged skill that turn', () => {
    const chargedRounds = (input: CombatEngineInput, actorId: string): number[] => {
        const bus = createEventBus();
        const rounds: number[] = [];
        bus.on('skill-fired', (e: Extract<CombatEvent, { type: 'skill-fired' }>) => {
            if (e.actorId === actorId && e.slot === 'charged') rounds.push(e.round);
        });
        runCombat({ ...input, bus });
        return rounds;
    };

    it('PLAYER side: charged on R2/R4/R6, and the no-proc baseline fires on R4 only', () => {
        const charge = resolveCobaltCharge(COBALT_P1);
        const input = buildInput({ chargeCount: 3, numRounds: 6, passiveAbilities: [charge] });
        expect(chargedRounds(input, 'attacker')).toEqual([2, 4, 6]);
        expect(ledger(runCombat(input)).slice(0, 2)).toEqual([
            ['active', 2],
            ['charged', 0],
        ]);
        // Without the proc the bar fills by the baseline alone: 1, 2, 3 → charged on R4.
        expect(chargedRounds(buildInput({ chargeCount: 3, numRounds: 6 }), 'attacker')).toEqual([
            4,
        ]);
    });

    it('ENEMY side (team symmetry): an enemy Cobalt fires on R2/R4/R6 too', () => {
        const charge = resolveCobaltCharge(COBALT_P1);
        const enemyCobalt: EnemyAttacker = {
            id: 'e-cobalt',
            stats: { attack: 1, crit: 0, critDamage: 0, speed: 40, hp: 1_000_000_000 },
            chargeCount: 3,
            startCharged: false,
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [damage(1, 'ec-a')] },
                    { slot: 'charged', abilities: [damage(1, 'ec-c')] },
                    { slot: 'passive', abilities: [charge] },
                ],
            },
        };
        const input = buildInput({ chargeCount: 0, numRounds: 6, enemyAttackers: [enemyCobalt] });
        expect(chargedRounds(input, 'e-cobalt')).toEqual([2, 4, 6]);
    });
});
