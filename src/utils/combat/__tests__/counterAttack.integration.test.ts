/**
 * counterAttack.integration.test.ts — G PR1: END-TO-END counter via the REAL registry.
 *
 * Unlike counterAttack.test.ts (which builds the `counter` ability INLINE), this test drives the
 * counter through the REAL parse path: a player ship constructed with Stalwart's verbatim skill text
 * is run through `buildShipAbilities` (the same registry every production ship uses), and the
 * resulting `ShipSkills` is fed straight into `runCombat`. This makes the test mutation-resistant:
 * removing the parser branch (Task 5) OR the executor branch (Task 4) breaks it.
 *
 * Harness mirrors counterAttack.test.ts EXACTLY: healing mode, the FOCUS ('attacker') is the heal
 * target and carries the parsed Stalwart skills; one `enemyAttackers` actor ('foe') lands a real
 * primary-target basic hit on it each round. The counter surfaces as the foe's incoming damage via
 * the round `perTargetDamage` map (the same channel the unit tests + REFLECT thorns use). The
 * co-located `Legion Discipline II` self-buff surfaces via `buff-applied` events on the bus.
 *
 * Determinism: the focus has crit 0 → the counter never crits → fixed magnitude. The co-located
 * Legion Discipline II self-buff (+15% Attack, non-stackable) is live when the counter resolves, so
 * the magnitude is owner.attack × 1.15 × multiplier/100 vs defence 0 / neutral affinity. Stalwart's
 * counter carries no procChance, so no proc override is needed.
 *
 * Scope: NO enemy-side mirror (enemy victims don't emit `attacked` — out of scope per the spec).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

/** A Ship carrying Stalwart's first-passive (30%) counterattack skill text.
 *  Parsed through the real registry → an on-attacked `counter` ability
 *  (requirePrimaryTarget) plus the co-located `Legion Discipline II` self-buff. */
function stalwartShip(passiveText: string): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        firstPassiveSkillText: passiveText,
    } as Ship;
}

// Verbatim CSV-derived skill text (docs/ship-skills.csv, Stalwart row). The real registry parses
// the `<unit-damage>`/`<unit-skill>`-tagged source — using the exact in-game strings keeps the
// test grounded in the canonical data the parser actually consumes.
const STALWART_P1 =
    'When this Unit is directly damaged as a primary target, it deals <unit-damage>30% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.';
const STALWART_P2 =
    'When this Unit is directly damaged as a primary target, it deals <unit-damage>70% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.<br /><br />Additionally, when this Unit is adjacent to a Supporter, this Unit gains 20% Attack.';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** An enemy attacker that lands a single-hit basic attack (synthesized 100% active) on the focus. */
const basicEnemy = (id: string, attack: number): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 50 },
        chargeCount: 0,
        startCharged: false,
    }) as EnemyAttacker;

/** Healing-mode base: the FOCUS ('attacker') is the heal target and carries `skills` (parsed from
 *  the real registry); one enemy attacker hits it each round. owner crit 0 → deterministic counter. */
const counterBase = (
    skills: ShipSkills,
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000, // OWNER (counter source) attack
    crit: 0, // no crit → didCrit false → predictable counter
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: skills,
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    enemyAttackers: [basicEnemy('foe', 3_000)],
    ...overrides,
});

/** Cumulative damage credited to `actorId` across the run via the round perTargetDamage maps. */
const totalPerTargetDamage = (result: ReturnType<typeof runCombat>, actorId: string): number => {
    let sum = 0;
    for (const rd of result.rounds) sum += rd.perTargetDamage?.[actorId] ?? 0;
    return sum;
};

describe('G PR1 — Stalwart counterattack END-TO-END via the real registry', () => {
    it('parsing produces a real on-attacked counter (sanity: registry wiring)', () => {
        const skills = buildShipAbilities(stalwartShip(STALWART_P1));
        const passive = skills.slots.find((s) => s.slot === 'passive');
        const counter = passive?.abilities.find((a) => a.type === 'counter');
        // Mutation guard: if the parser stops emitting a counter, this fails before the run.
        expect(counter).toMatchObject({
            type: 'counter',
            trigger: 'on-attacked',
            config: { type: 'counter', multiplier: 30, requirePrimaryTarget: true },
        });
    });

    it('(P1 30%) the attacker takes mitigated counter damage; Legion Discipline II is granted', () => {
        const skills = buildShipAbilities(stalwartShip(STALWART_P1));

        const bus = createEventBus();
        const buffEvents: CombatEvent[] = [];
        bus.on('buff-applied', (e) => buffEvents.push(e as CombatEvent));

        const result = runCombat(counterBase(skills, { bus }));

        // The enemy ('foe') took counter damage; a non-countering control credits nothing.
        const withCounter = totalPerTargetDamage(result, 'foe');
        const control = runCombat(counterBase({ slots: [] }));
        expect(totalPerTargetDamage(control, 'foe')).toBe(0);

        // Per round: exactly one counter, of a bounded magnitude. Base = owner.attack × 30% =
        // 10000 × 0.30 = 3000 (vs defence 0 / neutral affinity / no crit). The co-located Legion
        // Discipline II self-buff (+15% Attack, non-stackable) is granted by the SAME on-attacked
        // reaction, so the round-1 counter resolves at base (3000) and subsequent rounds resolve
        // with the buff live (3000 × 1.15 = 3450). Every non-zero round is one of those two values.
        const BASE = 10_000 * 0.3; // 3000
        const BUFFED = BASE * 1.15; // 3450
        const counterRounds = result.rounds
            .map((rd) => rd.perTargetDamage?.['foe'] ?? 0)
            .filter((d) => d > 0);
        expect(counterRounds.length).toBeGreaterThan(0);
        for (const dealt of counterRounds) {
            const isBase = Math.abs(dealt - BASE) < 1e-6;
            const isBuffed = Math.abs(dealt - BUFFED) < 1e-6;
            expect(isBase || isBuffed).toBe(true);
        }
        // The first counter resolves at base (the LD2 buff lands with it, not before it).
        expect(counterRounds[0]).toBeCloseTo(BASE, 6);
        expect(withCounter).toBeGreaterThanOrEqual(BASE - 1e-6);

        // M1 non-regression: the co-located Legion Discipline II self-buff fires on the focus.
        const ld2 = buffEvents.filter(
            (e) => e.type === 'buff-applied' && e.buffName === 'Legion Discipline II'
        );
        expect(ld2.length).toBeGreaterThan(0);
        expect(ld2.every((e) => e.type === 'buff-applied' && e.actorId === 'attacker')).toBe(true);
    });

    it('(P2 70%) the counter scales with the parsed multiplier (base 7000, buffed 8050)', () => {
        const skills = buildShipAbilities(stalwartShip(STALWART_P2));
        const result = runCombat(counterBase(skills));
        // Base = 10000 × 0.70 = 7000; with LD2 (+15% Attack) live = 7000 × 1.15 = 8050.
        const BASE = 10_000 * 0.7; // 7000
        const BUFFED = BASE * 1.15; // 8050
        const counterRounds = result.rounds
            .map((rd) => rd.perTargetDamage?.['foe'] ?? 0)
            .filter((d) => d > 0);
        expect(counterRounds.length).toBeGreaterThan(0);
        for (const dealt of counterRounds) {
            const isBase = Math.abs(dealt - BASE) < 1e-6;
            const isBuffed = Math.abs(dealt - BUFFED) < 1e-6;
            expect(isBase || isBuffed).toBe(true);
        }
        expect(counterRounds[0]).toBeCloseTo(BASE, 6);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// G PR2 — Nyxen shield-hit counterattack END-TO-END via the real registry.
//
// Nyxen's passive ("This Unit deals X% damage when its Shield is directly damaged.") parses to
// an on-attacked `counter` with requireShieldHit:true. Nyxen's ACTIVE grants a self-shield
// ("Shield equal to 15% of its Max HP"). Built together through the real registry and fed to
// runCombat: the focus (speed 100) casts its active FIRST each round → a live shield; the
// speed-50 enemy then lands a primary hit that DRAINS the shield → attacked.shieldWasHit:true →
// the counter fires. The NEGATIVE control builds Nyxen with ONLY the passive (no active shield) →
// no shield ever exists → shieldWasHit never true → NO counter.
// ───────────────────────────────────────────────────────────────────────────

const NYXEN_ACTIVE =
    'This Unit <unit-aid>Cleanses 2 bombs</unit-aid>, Grants a <unit-damage>Shield equal to 15%</unit-damage> of its Max HP, and Grants <unit-skill>Atlas Readiness II</unit-skill> for 1 turn.';
const NYXEN_P1 =
    'This Unit deals <unit-damage>100% damage</unit-damage> when its Shield is directly damaged.';
const NYXEN_P2 =
    'This Unit deals <unit-damage>200% damage</unit-damage> when its Shield is directly damaged.';

/** A Ship carrying Nyxen's active (self-shield) and a chosen passive (shield-hit counter),
 *  verbatim from docs/ship-skills.csv, parsed through the real registry. */
function nyxenShip(passiveText: string, withActiveShield = true): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        ...(withActiveShield ? { activeSkillText: NYXEN_ACTIVE } : {}),
        firstPassiveSkillText: passiveText,
    } as Ship;
}

describe('G PR2 — Nyxen shield-hit counterattack END-TO-END via the real registry', () => {
    it('parsing produces a real on-attacked counter with requireShieldHit (sanity: registry wiring)', () => {
        const skills = buildShipAbilities(nyxenShip(NYXEN_P1));
        const passive = skills.slots.find((s) => s.slot === 'passive');
        const counter = passive?.abilities.find((a) => a.type === 'counter');
        // Mutation guard: if the parser stops emitting a shield-hit counter, this fails before the run.
        expect(counter).toMatchObject({
            type: 'counter',
            trigger: 'on-attacked',
            config: { type: 'counter', multiplier: 100, requireShieldHit: true },
        });
        expect(
            (counter?.config as { requirePrimaryTarget?: boolean }).requirePrimaryTarget
        ).toBeUndefined();
    });

    it('(P1 100%) the counter fires ONLY when the live shield is actually hit', () => {
        // Focus speed 100 → casts its self-shield active BEFORE the speed-50 enemy hits, so the
        // enemy's hit drains a LIVE shield → shieldWasHit:true → counter fires.
        const shielded = buildShipAbilities(nyxenShip(NYXEN_P1, /* withActiveShield */ true));
        const withShieldResult = runCombat(
            counterBase(shielded, { speed: 100, enemyAttackers: [basicEnemy('foe', 3_000)] })
        );
        // Owner attack 10000 × 100% vs defence 0 / neutral affinity / no crit = 10000 per counter.
        const fired = totalPerTargetDamage(withShieldResult, 'foe');
        expect(fired).toBeGreaterThan(0);
        for (const rd of withShieldResult.rounds) {
            const dealt = rd.perTargetDamage?.['foe'] ?? 0;
            if (dealt > 0) expect(dealt).toBeCloseTo(10_000, 6);
        }

        // NEGATIVE control: no active shield → the shield never exists → shieldWasHit never true →
        // NO counter ever fires (the foe takes zero counter damage).
        const noShield = buildShipAbilities(nyxenShip(NYXEN_P1, /* withActiveShield */ false));
        const noShieldResult = runCombat(
            counterBase(noShield, { speed: 100, enemyAttackers: [basicEnemy('foe', 3_000)] })
        );
        expect(totalPerTargetDamage(noShieldResult, 'foe')).toBe(0);
    });

    it('(P2 200%) the counter scales with the parsed multiplier (20000 per shield-hit counter)', () => {
        const shielded = buildShipAbilities(nyxenShip(NYXEN_P2, /* withActiveShield */ true));
        const result = runCombat(
            counterBase(shielded, { speed: 100, enemyAttackers: [basicEnemy('foe', 3_000)] })
        );
        // Owner attack 10000 × 200% = 20000 per counter.
        const counterRounds = result.rounds
            .map((rd) => rd.perTargetDamage?.['foe'] ?? 0)
            .filter((d) => d > 0);
        expect(counterRounds.length).toBeGreaterThan(0);
        for (const dealt of counterRounds) expect(dealt).toBeCloseTo(20_000, 6);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// G PR2 — Centurion self/adjacent-ally counterattack END-TO-END via the real registry.
//
// Centurion's passive ("At the start of combat, this Unit gains N attack per adjacent ally.<br/>
// <br/>When this Unit OR AN ADJACENT ALLY is directly damaged, this Unit retaliates dealing X%.")
// parses to TWO counters: a self on-attacked counter (no gate) + an adjacent-ally on-ally-attacked
// counter (requireDamagedAllyAdjacent). Built through the real registry and fed to runCombat with
// REAL board positions so the listener's adjacency gate is exercised end to end.
//
// Read mechanism: the counter surfaces as the attacking enemy's incoming damage via the round
// perTargetDamage map (same channel as Stalwart/Nyxen above). Geometry (board.ts): owner at M2 →
// adjacent = T1,T2,M1,M3,B1,B2; NON-adjacent = B4.
// ───────────────────────────────────────────────────────────────────────────

const CENTURION_P2 =
    'At the start of combat, this Unit gains 750 attack per adjacent ally.<br /><br />When this Unit or an adjacent ally is directly damaged, this Unit retaliates dealing <unit-damage>50%</unit-damage>.';

/** A Ship carrying Centurion's second passive (self/adjacent-ally retaliate), verbatim from
 *  docs/ship-skills.csv, parsed through the real registry. */
function centurionShip(passiveText: string): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        secondPassiveSkillText: passiveText,
    } as Ship;
}

/** A positioned, inert team ally (no skills, big HP, no real damage). Mirrors the cfProvoke harness. */
function ally(id: string, position: Position): TeamActorEngineInput {
    return {
        id,
        speed: 10, // slower than the focus / enemy so it never acts first
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1_000_000_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    };
}

describe('G PR2 — Centurion self/adjacent-ally counterattack END-TO-END via the real registry', () => {
    it('parsing produces self (on-attacked) + adjacent-ally (on-ally-attacked) counters (sanity)', () => {
        const skills = buildShipAbilities(centurionShip(CENTURION_P2));
        const passive = skills.slots.find((s) => s.slot === 'passive');
        const counters = passive?.abilities.filter((a) => a.type === 'counter') ?? [];
        expect(counters).toHaveLength(2);
        expect(counters.find((a) => a.trigger === 'on-attacked')).toMatchObject({
            type: 'counter',
            config: { type: 'counter', multiplier: 50 },
        });
        expect(counters.find((a) => a.trigger === 'on-ally-attacked')).toMatchObject({
            type: 'counter',
            config: { type: 'counter', multiplier: 50 },
            requireDamagedAllyAdjacent: true,
        });
    });

    it('SELF hit: Centurion retaliates against the attacker when it is directly hit', () => {
        // Focus 'attacker' (Centurion owner) IS the heal target → the enemy hits IT each round →
        // the self on-attacked counter fires. No adjacency needed.
        const skills = buildShipAbilities(centurionShip(CENTURION_P2));
        const result = runCombat(
            counterBase(skills, {
                position: 'M2',
                healTargetId: 'attacker',
                mode: 'healing',
                enemyAttackers: [basicEnemy('foe', 3_000)],
            })
        );
        // Owner attack 10000 × 50% vs defence 0 / neutral affinity / no crit = 5000 per counter.
        const counterRounds = result.rounds
            .map((rd) => rd.perTargetDamage?.['foe'] ?? 0)
            .filter((d) => d > 0);
        expect(counterRounds.length).toBeGreaterThan(0);
        for (const dealt of counterRounds) expect(dealt).toBeCloseTo(5_000, 6);
    });

    it('ADJACENT ally hit: Centurion retaliates when an adjacent ally is directly damaged', () => {
        // Owner at M2; adjacent ally 'ally-T2' at T2 is the heal target → the enemy hits T2 →
        // owner is adjacent → the on-ally-attacked counter fires against the attacker.
        //
        // SP-4b-1: the enemy has to be PINNED to row T. `front` selection scans rows starting from
        // the caster's own row and only then takes the front-most column within it (selectTargets),
        // and every actor is now placed — so an unpositioned enemy would land on the middle row,
        // find the OWNER at M2 there, and fire the SELF counter instead. That reads as a pass while
        // testing nothing about adjacency. From T1 the scan row is T, whose only occupant is the
        // intended victim `ally-T2`.
        const skills = buildShipAbilities(centurionShip(CENTURION_P2));
        const result = runCombat(
            counterBase(skills, {
                speed: 100, // owner acts first; its passive listens for the ally hit
                position: 'M2',
                teamActors: [ally('ally-T2', 'T2'), ally('ally-B4', 'B4')],
                healTargetId: 'ally-T2',
                mode: 'healing',
                enemyAttackers: [{ ...basicEnemy('foe', 3_000), position: 'T1' }],
            })
        );
        const counterRounds = result.rounds
            .map((rd) => rd.perTargetDamage?.['foe'] ?? 0)
            .filter((d) => d > 0);
        expect(counterRounds.length).toBeGreaterThan(0);
        for (const dealt of counterRounds) expect(dealt).toBeCloseTo(5_000, 6);
    });

    it('NON-adjacent ally hit: Centurion does NOT retaliate (adjacency gate)', () => {
        // Owner at M2; heal target is 'ally-B4' at B4 (NON-adjacent). The enemy hits B4; the
        // on-ally-attacked listener runs but requireDamagedAllyAdjacent rejects it → no counter.
        // Adjacent ally-T2 still present so the geometry is positional (not the all-allies fallback).
        //
        // SP-4b-1: the enemy is pinned to row B for the same reason as the ADJACENT case above —
        // otherwise it lands on the middle row, hits the OWNER at M2, and the SELF counter fires,
        // which is a real retaliation and has nothing to do with the adjacency gate under test.
        // `ally-B4` is the only actor in row B, so the scan resolves onto it.
        const skills = buildShipAbilities(centurionShip(CENTURION_P2));
        const result = runCombat(
            counterBase(skills, {
                speed: 100,
                position: 'M2',
                teamActors: [ally('ally-T2', 'T2'), ally('ally-B4', 'B4')],
                healTargetId: 'ally-B4',
                mode: 'healing',
                enemyAttackers: [{ ...basicEnemy('foe', 3_000), position: 'B4' }],
            })
        );
        // The non-adjacent ally IS being hit (non-vacuous): the gate rejected a real ally hit
        // rather than the enemy quietly attacking someone else.
        expect(totalPerTargetDamage(result, 'ally-B4')).toBeGreaterThan(0);
        expect(totalPerTargetDamage(result, 'foe')).toBe(0);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Multi-hit epic residual R4 — Centurion multi-VICTIM double-retaliation.
//
// Centurion's ONE passive clause is synthesized into TWO counter abilities (self `on-attacked` +
// adjacent-ally `on-ally-attacked`). The executor's dedupe guard is keyed
// `ownerId:abilityId:subAttackIndex`, so the two abilities land in DIFFERENT buckets. Since
// per-victim `attacked` emission landed, a single AoE sub-attack that covers Centurion AND an
// adjacent ally wakes BOTH abilities → Centurion retaliates TWICE for one incoming attack.
//
// One incoming attack must draw ONE retaliation. This is a multi-VICTIM defect, not a multi-HIT
// one: it reproduces at `hits: 1`, and PR6's sub-attack token neither caused nor fixes it.
//
// Geometry (board.ts): M4 is the player-side FRONT column; neighbors('M4') = M3,T3,T4,B3,B4. A
// Line-Range-1 footprint anchored on M4 covers M4 + M3, so the focus (Centurion, M4) and its
// adjacent ally (M3) are hit by the SAME sub-attack.
//
// Read mechanism: count `reactive-damage-performed` rows sourced at the focus. That counts
// RETALIATIONS directly, where a damage total would conflate "two counters" with "one bigger
// counter" — the co-located "gains 750 attack per adjacent ally" buff makes the magnitude
// position-dependent, so a magnitude assertion here would be reading the wrong signal.
// ───────────────────────────────────────────────────────────────────────────

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

/** AoE footprint: origin + one covered cell one step toward back (Pattern-Line-Range-1). */
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

/** A no-passive single-hit basic-attack active slot (100% multiplier, 1 hit). */
const basicAttackSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'r4-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
});

/** A positioned enemy that fires `front` with an AoE footprint covering two player cells. */
const aoeEnemyAt = (id: string, position: Position, pattern: ParsedPattern): EnemyAttacker =>
    ({
        id,
        stats: { attack: 3_000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern,
        shipSkills: { slots: [basicAttackSlot()] },
    }) as EnemyAttacker;

describe('R4 — one incoming attack draws ONE Centurion retaliation, not one per ability', () => {
    it('AoE covering Centurion AND an adjacent ally retaliates ONCE per sub-attack', () => {
        const skills = buildShipAbilities(centurionShip(CENTURION_P2));

        const bus = createEventBus();
        const reactive: CombatEvent[] = [];
        bus.on('reactive-damage-performed', (e) => reactive.push(e as CombatEvent));

        runCombat(
            counterBase(skills, {
                bus,
                numRounds: 1,
                position: 'M4', // front column → the enemy's `front` selection anchors here
                teamActors: [ally('ally-M3', 'M3')], // adjacent to M4, inside the footprint
                healTargetId: 'attacker',
                mode: 'healing',
                enemyAttackers: [aoeEnemyAt('foe', 'M4', lineRange1Pattern())],
            })
        );

        const retaliations = reactive.filter(
            (e) => e.type === 'reactive-damage-performed' && e.sourceId === 'attacker'
        );
        // Both victims are covered by ONE sub-attack, so both the self and the adjacent-ally
        // counter wake — but Centurion retaliates against that attack exactly once.
        expect(retaliations).toHaveLength(1);
    });
});
