/**
 * SP-4e Task 3 — the BEHAVIOUR this rung changes, on REAL kits.
 *
 * Task 3 flips one parser regex, and that flip is the whole reason the healing calculator stops
 * routing a text-named worst-HP repair to the user's chosen focus ship. Nothing in the existing
 * golden suites can see it:
 *
 *   • `realKitFingerprints.test.ts` runs all three ships but is deliberately STRUCTURAL — it
 *     records the token `heal`, never the recipient — so a recipient change is invisible to it.
 *   • `healingGoldenParity.test.ts` is the numeric referee, but its "Tithonus/Pallas shape"
 *     (scenario 10) and "Valkyrie shape" (scenario 11) fixtures HAND-WRITE `target: 'all-allies'`
 *     / `target: 'ally'`. They pin the shape, never what the ships' own text parses to, so they
 *     are structurally immune to the flip.
 *
 * So this file is the missing coverage. Every case is TWO-ARMED: the same real kit is run once as
 * parsed (`'lowest-hp-ally'`) and once with the recipient rewound to `'ally'` — the exact and only
 * field Task 3 changed. A test that only asserted the new arm could go quietly vacuous if the
 * fixture stopped healing at all; asserting BOTH arms means the delta itself is pinned.
 *
 * ⚠️ WHAT THE `'legacy'` ARM IS, PRECISELY (corrected by SP-4e Task 4). It rewinds the PARSER, not
 * the engine. That made it a faithful reproduction of pre-Task-3 production only while the engine
 * still carried the mode-flag arms Task 3 made dead; Task 4 deleted them, so what a plain `'ally'`
 * MEANS has itself changed — it is now "the caster's target pattern" (own side, narrowed by the
 * support footprint) rather than `[healing.targetId]`. So in the healing-mode block below the
 * legacy arm is no longer a picture of the old defect; it is the CURRENT plain-`'ally'` rule, and
 * its value as an arm is that it isolates the recipient field as the only cause of the delta.
 * (`healerTargeting.active.pattern` here is `Pattern-Base` — no `support` segment — so
 * `supportFootprintAllyIds` returns undefined and the plain-`'ally'` arm narrows to nothing,
 * reaching the whole own side.) The battle-mode Valkyrie block at the bottom is UNAFFECTED: it
 * runs the reactive route (`reactiveRecipients`), which Task 4 did not touch, so there the legacy
 * arm still is the pre-Task-3 behaviour. That block rewinds her skill TEXT instead, because
 * `simulateBattle` derives the abilities itself — see the comment there, and the assertion that
 * proves the two rewinds are equivalent.
 *
 * Reference data (docs/ship-data.json, docs/ship-skills.csv) is gitignored dev-only. This file
 * THROWS when it is absent rather than skipping (`realKitFingerprints.test.ts`'s convention): a
 * fresh worktree of this repo routinely lacks those files and there is no CI test workflow, so a
 * skip would make a guard against future heal re-routing silently disappear exactly where nobody
 * is watching.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import {
    simulateHealing,
    type EnemyAttackerInput,
    type HealerStats,
    type HealingSimulationInput,
} from '../healingEngineAdapter';
import { simulateBattle, type BattlePlacement } from '../battleSimulator';
import { createEventBus } from '../../combat/events';
import { setupKeyedTestRng } from '../rateAccumulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { TeamActorInput } from '../../../types/calculator';
import type { Ship } from '../../../types/ship';
import type { CombatLogEntry } from '../../combat/log/types';

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — tests need them to resolve real ship skill text/stats.'
        );
    }
}

/** The user's configured heal target — the "focus" the calculator used to route everything to. */
const FOCUS = 'ally-focus';
/** A second ally, deliberately at a LOWER HP fraction than the focus for the whole window. */
const WORST = 'ally-worst';

const HEALER: HealerStats = {
    hp: 50_000,
    attack: 10_000,
    defence: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    healModifier: 0,
    hacking: 200,
    speed: 300,
};

const ally = (id: string, position: 'M3' | 'M4', hp: number): TeamActorInput => ({
    id,
    speed: 10,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: { slots: [] },
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp,
    },
    position,
});

/**
 * The enemy is FAST (speed 900 vs the healer's 300) so it strikes before the first repair — the
 * round-1 board is already asymmetric, rather than a full-HP tie the selector would resolve by
 * source order (which is the focus, making round 1 blind to the change).
 */
const foe = (): EnemyAttackerInput => ({
    id: 'enemy-1',
    stats: {
        attack: 3_000,
        crit: 0,
        critDamage: 0,
        speed: 900,
        defence: 0,
        hp: 5_000_000,
        security: 100,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4' as const,
    target: parseTarget('all'),
    pattern: parsePattern('Pattern-Circle-Range-1'),
});

/**
 * Equal absolute intake, unequal max HP → WORST sits at a strictly lower HP FRACTION every round
 * while both stay alive. Both halves matter: a dead ally would leave the selector one candidate
 * and mask the change, and an equal FRACTION would make the two arms agree by tie-break.
 */
const FOCUS_MAX_HP = 100_000;
const WORST_MAX_HP = 20_000;

/** The real ship's kit; `arm: 'legacy'` rewinds the parsed selector to its pre-Task-3 value. */
function kitFor(shipName: string, arm: 'legacy' | 'selector'): ShipSkills {
    const ship = buildTraceShip(shipName);
    if (!ship) throw new Error(`buildTraceShip returned nothing for ${shipName}`);
    const skills = buildShipAbilities(ship);
    if (arm === 'legacy')
        for (const slot of skills.slots)
            for (const a of slot.abilities) if (a.target === 'lowest-hp-ally') a.target = 'ally';
    return skills;
}

interface Observed {
    /** `heal-performed` recipient ids, in emission order, deduped per cast. */
    recipients: string[];
    /** Recipients with a non-zero effective total, from the summary's per-recipient report. */
    healedIds: string[];
}

function runHealing(
    shipName: string,
    arm: 'legacy' | 'selector',
    team: TeamActorInput[]
): Observed {
    setupKeyedTestRng(4242);
    const skills = kitFor(shipName, arm);
    const recipients: string[] = [];
    const bus = createEventBus();
    bus.on('heal-performed', (e) => {
        const ev = e as unknown as {
            perTarget?: { targetId: string }[];
            targets?: string[];
        };
        for (const id of ev.perTarget?.map((p) => p.targetId) ?? ev.targets ?? []) {
            if (!recipients.includes(id)) recipients.push(id);
        }
    });
    const input: HealingSimulationInput = {
        healer: HEALER,
        chargeCount: 0,
        shipSkills: skills,
        selfBuffs: [],
        healTargetId: team.length > 0 ? FOCUS : 'attacker',
        enemies: [foe()],
        rounds: 4,
        healerPosition: 'M2',
        healerTargeting: {
            active: { target: parseTarget('all'), pattern: parsePattern('Pattern-Base') },
        },
        teamActors: team,
        bus,
    };
    const result = simulateHealing(input);
    const per = result.summary.perRecipient ?? {};
    return {
        recipients,
        healedIds: Object.entries(per)
            .filter(([, v]) => (v as { totalEffectiveHealing: number }).totalEffectiveHealing > 0)
            .map(([id]) => id)
            .sort(),
    };
}

const fullTeam = () => [ally(FOCUS, 'M3', FOCUS_MAX_HP), ally(WORST, 'M4', WORST_MAX_HP)];

describe('SP-4e: a text-named worst-HP repair reaches the worst-HP ally, not the configured focus', () => {
    beforeAll(requireReferenceData);

    // Pallas: ACTIVE slot, "The other ally with the lowest current health percentage heals for
    // 20% of the damage dealt".
    it('Pallas moves off the heal target onto the worst-HP ally', () => {
        const legacy = runHealing('Pallas', 'legacy', fullTeam());
        const selector = runHealing('Pallas', 'selector', fullTeam());
        // PLAIN 'ally' (post-Task-4): the caster's target pattern. `Pattern-Base` carries no
        // `support` segment, so nothing narrows it and the repair reaches the whole own side —
        // her included. Pre-Task-4 this arm produced `[FOCUS]` alone (the `[healing.targetId]`
        // fallback, defect D3); that fallback is deleted, which is why the list is wider now.
        // The healer is in `recipients` but not `healedIds`: it is at full HP when the repair
        // lands, so its share is all overheal.
        expect(legacy.recipients).toEqual(['attacker', FOCUS, WORST]);
        expect(legacy.healedIds).toEqual([FOCUS, WORST]);
        // SELECTOR: her own text names ONE recipient, so neither the pattern nor the anchor
        // decides it — and the anchor/focus is excluded even though it is on the pattern.
        expect(selector.recipients).toEqual([WORST]);
        expect(selector.healedIds).toEqual([WORST]);
    });

    // Volk: PASSIVE slot, "repairs 30% of its Max HP to the ally with the most missing health"
    // — loose phrasing for lowest HP PERCENTAGE, the same selector.
    it('Volk moves off the heal target onto the worst-HP ally', () => {
        const legacy = runHealing('Volk', 'legacy', fullTeam());
        const selector = runHealing('Volk', 'selector', fullTeam());
        // PLAIN 'ally' (post-Task-4): the whole own side, as above — so it reaches WORST too.
        // The discriminating assertion is now the SELECTOR arm's exclusion of FOCUS: the plain
        // arm includes the configured focus, the selector arm must not.
        expect(legacy.recipients).toEqual(['attacker', FOCUS, WORST]);
        expect(selector.recipients).toContain(WORST);
        expect(selector.recipients).not.toContain(FOCUS);
    });

    // "The OTHER ally" — with nobody else alive there is no recipient, and the pre-4e
    // `?? actor.id` tail made that a self-heal her text forbids.
    it('Pallas heals NOBODY when she is the only living ally', () => {
        const legacy = runHealing('Pallas', 'legacy', []);
        const selector = runHealing('Pallas', 'selector', []);
        // PLAIN 'ally': the caster repairs itself. Same observation as pre-Task-4 but for a
        // DIFFERENT reason — it used to be the `?? actor.id`/`[healing.targetId]` self-fallback,
        // and is now simply that the caster is the only id on its own side, so the target
        // pattern contains nothing else. (The forbidden self-answer for the SELECTOR is what the
        // second assertion pins; the plain arm self-targeting is legitimate.)
        expect(legacy.recipients).toEqual(['attacker']);
        // SELECTOR: no recipient at all. Anti-vacuity is the legacy arm above: the fixture
        // demonstrably CAN produce a heal here, so an empty list is a routing answer, not a
        // fixture that never cast.
        expect(selector.recipients).toEqual([]);
    });
});

// ===========================================================================
// Valkyrie — the BATTLE-mode arm (spec §6 item 4).
//
// Her dual repair ("this Unit and the ally with the lowest current health percentage repair 5% of
// damage dealt") rides `trigger: 'on-bomb-detonated'`, so nothing above reaches it: the healing
// harness never detonates anything. An earlier report called her change "parse-only today" — that
// was WRONG, and it was reached by measuring the wrong quantity. `BattleRound.ships[].healingReceived`
// documents that it excludes reactive-heal channels (battleSimulator.ts, `healingReceived`), so it
// reads 0 for every actor in the run below even while 22 repairs land. The combat log's `heal`
// entries are the channel that observes them.
//
// Fixture: Valkyrie as the focus at M4, plus a real Demolisher at M3 whose active inflicts Bomb III
// and whose kit detonates it. The trigger is bomb-family (skillTextParser.ts:1365 — "an Echoing
// Burst explodes" is one named bomb-type effect among several), so a plain Bomb III detonation pays
// her repair; which detonation qualifies is not what this test is about, the RECIPIENT is. The two
// enemies are synthetic, high-HP and low-Security, so nothing survives-or-dies differently between
// arms and the bomb always lands (at security 150 the infliction was resisted every round and the
// fixture observed nothing at all).
// ===========================================================================

/** Deliberately NOT `{...ship}` with a patched ShipSkills: `simulateBattle` derives skills from the
 *  ship's TEXT itself (`planPlacement` → `buildShipAbilities`), so an attached `skills` field is
 *  ignored. The legacy arm therefore rewinds the TEXT — and the first assertion below proves the
 *  rewind reproduces the pre-Task-3 PARSE exactly (same pct/basis/leechScope/trigger, `'ally'`
 *  instead of `'lowest-hp-ally'`), which is what makes it a faithful arm rather than a second
 *  fixture. */
function traceShipForArm(name: string, arm: 'legacy' | 'selector'): Ship {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`buildTraceShip returned nothing for ${name}`);
    if (arm === 'selector') return ship;
    const rewind = (t: string | undefined) =>
        t?.replace(/the ally with the lowest current health percentage/gi, 'the ally');
    return {
        ...ship,
        activeSkillText: rewind(ship.activeSkillText),
        chargeSkillText: rewind(ship.chargeSkillText),
        firstPassiveSkillText: rewind(ship.firstPassiveSkillText),
        secondPassiveSkillText: rewind(ship.secondPassiveSkillText),
        thirdPassiveSkillText: rewind(ship.thirdPassiveSkillText),
    };
}

const healAbilitiesOf = (ship: Ship): Ability[] =>
    buildShipAbilities(ship)
        .slots.flatMap((s) => s.abilities)
        .filter((a) => a.type === 'heal');

/** A no-kit punching bag: high HP so it never dies, Security 1 so Demolisher's Bomb III always
 *  lands, Attack 3 000 so the player side takes real damage and the two allies sit at different
 *  HP fractions (without which the selector and the caster could coincide). */
const punchingBag = (speed: number): BattlePlacement => ({
    ship: {
        id: 'sp4e-bag',
        name: 'Bag',
        rarity: 'legendary',
        faction: 'MPL',
        type: 'ATTACKER',
        affinity: 'antimatter',
        baseStats: {
            hp: 5_000_000,
            attack: 3_000,
            defence: 0,
            hacking: 200,
            security: 1,
            crit: 0,
            critDamage: 150,
            speed,
        },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    } as unknown as Ship,
    position: speed === 120 ? 'M3' : 'M2',
    statOverrides: { hp: 5_000_000, attack: 3_000, defence: 0, security: 1, speed },
});

/** Every `heal` log target in the whole battle, walking `reactions` too (a reactive repair hangs
 *  off the entry that triggered it, not off the turn's top-level list). */
function battleHealTargets(arm: 'legacy' | 'selector'): { targetId: string; amount: number }[] {
    setupKeyedTestRng(4242);
    const stats = { hp: 200_000, attack: 20_000, hacking: 2_000 };
    const result = simulateBattle({
        playerTeam: [
            {
                ship: traceShipForArm('Valkyrie', arm),
                position: 'M4',
                statOverrides: { ...stats, speed: 300 },
            },
            {
                ship: traceShipForArm('Demolisher', arm),
                position: 'M3',
                statOverrides: { ...stats, speed: 250 },
            },
        ],
        enemyTeam: [punchingBag(120), punchingBag(110)],
        rounds: 12,
    });
    const out: { targetId: string; amount: number }[] = [];
    const walk = (entries: CombatLogEntry[]): void => {
        for (const e of entries) {
            if (e.kind === 'heal')
                for (const t of e.targets)
                    out.push({ targetId: t.targetId, amount: t.amount ?? 0 });
            walk(e.reactions);
        }
    };
    for (const round of result.combatLog) {
        walk(round.startOfRound);
        for (const turn of round.turns) walk(turn.entries);
        walk(round.endOfRound);
    }
    return out;
}

const countByRecipient = (rows: { targetId: string }[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.targetId] = (counts[r.targetId] ?? 0) + 1;
    return counts;
};

describe("SP-4e: Valkyrie's detonation repair moves off herself onto the worst-HP ally", () => {
    beforeAll(requireReferenceData);

    it('rewinding her text reproduces the pre-Task-3 parse, differing ONLY in target', () => {
        const legacy = healAbilitiesOf(traceShipForArm('Valkyrie', 'legacy'));
        const selector = healAbilitiesOf(traceShipForArm('Valkyrie', 'selector'));
        // The ally half plus the mirrored self half ("this Unit AND the ally …").
        expect(legacy.map((a) => a.target)).toEqual(['ally', 'self']);
        expect(selector.map((a) => a.target)).toEqual(['lowest-hp-ally', 'self']);
        // Everything else — pct, basis, leechScope, trigger, slot — is identical, so the battle
        // below differs in the recipient selector and nothing else.
        const blind = (as: Ability[]) => as.map((a) => ({ ...a, target: 'X' }));
        expect(blind(legacy)).toEqual(blind(selector));
    });

    it('battle mode: both halves landed on her; the ally half now lands on the worst-HP ally', () => {
        const legacy = battleHealTargets('legacy');
        const selector = battleHealTargets('selector');

        // Anti-vacuity: the fixture really does detonate bombs and really does pay the repair.
        expect(legacy.length).toBe(22);
        // A re-route, not a new or lost repair: same number of heal payouts, same amounts.
        expect(selector.length).toBe(legacy.length);
        const amounts = (rows: { amount: number }[]) => rows.map((r) => r.amount).sort();
        expect(amounts(selector)).toEqual(amounts(legacy));

        // LEGACY: `reactiveRecipients` resolved a plain `'ally'` to the caster, so BOTH halves of
        // the dual repair landed on Valkyrie — 11 + 11 on the focus id. This is the defect.
        expect(countByRecipient(legacy)).toEqual({ attacker: 22 });
        // SELECTOR: the ally half goes to the living same-side ally with the lowest HP fraction
        // (Demolisher, the only other ally); the self half still — correctly — lands on her.
        expect(countByRecipient(selector)).toEqual({
            attacker: 11,
            'p:trace:Demolisher:1': 11,
        });
    });
});
