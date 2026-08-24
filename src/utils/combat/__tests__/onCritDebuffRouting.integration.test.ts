/**
 * SP-4b-2 D2 — a reactive `on-crit` enemy-debuff must land on the enemy the cast actually CRIT,
 * not on the vestigial DPS sink actor (`ctx.enemy.id`, literally `'enemy'`).
 *
 * The defect: the `on-crit` listener (triggers.ts) stamped no victim on the intent it enqueued, so
 * the debuff executor's target resolution — `applicationTargetId ?? ctx.enemy.id` — fell all the
 * way through to the sink. While the sink WAS the run's only enemy that was harmless; on a
 * positional run (every DPS run since SP-1, and every battle run always) the cast hits a real
 * positioned enemy and the debuff landed in a store nobody reads. `on-ally-crit`, the ally-subject
 * half of the same pair, has stamped its crit victims since Phase 3 PR-G — `on-crit` was not swept.
 *
 * These tests assert on `debuff-applied.targetId` — the ADDRESS — not on a downstream damage
 * delta: a debuff landing somewhere harmless still moves no damage, so a damage-only assertion
 * cannot tell "landed on the sink" from "did not fire". (`teamWalk.test.ts`'s "a team on-crit
 * enemy-debuff fires on the team crit …" covers the damage half.)
 *
 * Team symmetry is LOCKED here (#306): every player-side case below has an enemy-side mirror.
 * Both sides register through the same `registerReactiveListeners` call shape and both sides'
 * positional apply emits `ability-performed` through the same `emitDeferredAbilityPerformed`,
 * so the stamp is side-agnostic by construction — these mirrors prove it rather than assume it.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** The vestigial DPS sink actor's id (engine.ts:1858) — the address the defect used. */
const SINK_ID = 'enemy';
const DEBUFF = 'Crit Shred';

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

const hit = (): Ability => ({
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

/**
 * The Enforcer shape: "when this Unit critically hits, it inflicts <debuff> on that enemy".
 * `application: 'apply'` keeps the landing draw out of the picture entirely — this file is about
 * the ADDRESS, and a hacking-vs-security miss would be indistinguishable from a mis-route.
 */
const onCritDebuff = (): Ability => ({
    id: 'ocd',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-crit',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: DEBUFF,
        parsedEffects: { defense: -40 },
        stacks: 1,
        isStackable: false,
        application: 'apply',
        duration: 5,
    },
});

/** The same shape as `onCritDebuff`, but `application: 'inflict'` — i.e. the landing DRAW is live
 *  (hacking-vs-security), which is the whole point of the per-victim fan-out block below. */
const onCritInflictDebuff = (): Ability => {
    const base = onCritDebuff();
    return { ...base, id: 'ocdi', config: { ...base.config, application: 'inflict' } } as Ability;
};

const punchingBag = (id: string, position: Position, security = 0): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 1,
        security,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

/** An enemy-side attacker carrying the SAME on-crit reactive debuff (the mirror). */
const critingEnemy = (id: string, position: Position, pattern: ParsedPattern): EnemyAttacker => ({
    id,
    stats: {
        attack: 5000,
        crit: 100,
        critDamage: 150,
        defence: 0,
        hp: 1_000_000_000,
        speed: 900,
        hacking: 250,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern,
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [hit()] },
            { slot: 'passive', abilities: [onCritDebuff()] },
        ],
    },
});

/** A player-side team actor that just stands there and takes hits (an enemy-side crit victim). */
const bystander = (id: string, position: Position, security = 0): TeamActorEngineInput => ({
    id,
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    walk: {
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            security,
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
});

const focus = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 5000,
    crit: 100,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
    numRounds: 1,
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
    hp: 1_000_000_000,
    speed: 1000,
    hacking: 250,
    mode: 'battle',
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    ...over,
});

function applications(
    input: CombatEngineInput
): Extract<CombatEvent, { type: 'debuff-applied' }>[] {
    const bus = createEventBus();
    const applied: Extract<CombatEvent, { type: 'debuff-applied' }>[] = [];
    bus.on('debuff-applied', (e) => {
        if (e.buffName === DEBUFF) applied.push(e);
    });
    runCombat({ ...input, bus });
    return applied;
}

/** Every landing DECISION the reactive debuff produced, plus the crit identity of the casts that
 *  triggered it. `landed` + `resisted` together are one entry per gate evaluation, which is what
 *  makes "one draw per crit victim" measurable rather than inferred. */
function landingOutcomes(input: CombatEngineInput): {
    landed: string[];
    resisted: string[];
    critVictimIds: string[];
} {
    const bus = createEventBus();
    const landed: string[] = [];
    const resisted: string[] = [];
    const critVictimIds: string[] = [];
    bus.on('debuff-applied', (e) => {
        if (e.buffName === DEBUFF) landed.push(e.targetId);
    });
    bus.on('debuff-resisted', (e) => {
        if (e.buffName === DEBUFF) resisted.push(e.targetId);
    });
    bus.on('ability-performed', (e) => {
        for (const id of e.critVictimIds ?? [])
            if (!critVictimIds.includes(id)) critVictimIds.push(id);
    });
    runCombat({ ...input, bus });
    return { landed, resisted, critVictimIds };
}

describe('SP-4b-2 D2 — player-side on-crit enemy-debuff routing', () => {
    // M4 is the unique front/col-4 cell, so `front` selection deterministically picks 'foe-a'.
    const singleTarget = (): CombatEngineInput =>
        focus({
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [hit()] },
                    { slot: 'passive', abilities: [onCritDebuff()] },
                ],
            },
            enemyAttackers: [punchingBag('foe-a', 'M4'), punchingBag('foe-b', 'M3')],
        });

    it('lands on the crit victim, never on the vestigial sink actor', () => {
        const applied = applications(singleTarget());
        expect(applied.length).toBeGreaterThan(0);
        expect(applied.every((e) => e.targetId !== SINK_ID)).toBe(true);
        expect(applied.map((e) => e.targetId)).toEqual(['foe-a']);
        expect(applied.every((e) => e.sourceId === 'attacker')).toBe(true);
    });

    it('an AoE that crits two enemies debuffs BOTH of them ("that enemy" = every enemy crit)', () => {
        const applied = applications({ ...singleTarget(), pattern: allPattern() });
        expect(new Set(applied.map((e) => e.targetId))).toEqual(new Set(['foe-a', 'foe-b']));
        expect(applied.every((e) => e.targetId !== SINK_ID)).toBe(true);
    });

    it('never fires when the cast cannot crit (non-vacuity guard)', () => {
        expect(applications({ ...singleTarget(), crit: 0 })).toEqual([]);
    });
});

describe('SP-4b-2 D2 — enemy-side mirror: an ENEMY on-crit debuff lands on the PLAYER it crit', () => {
    // The focus sits at M1 and a bystander at M4 (the unique front cell), so the enemy's `front`
    // selection deterministically picks the bystander — a REAL routing choice, not the focus by
    // default. player[0] is always the reserved focus id 'attacker'.
    const enemySide = (pattern: ParsedPattern): CombatEngineInput =>
        focus({
            attack: 0,
            crit: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
            speed: 1,
            teamActors: [bystander('ally-front', 'M4')],
            enemyAttackers: [critingEnemy('foe-crit', 'M4', pattern)],
        });

    it('lands on the player actor the enemy crit, never on the vestigial sink actor', () => {
        const applied = applications(enemySide(basePattern()));
        expect(applied.length).toBeGreaterThan(0);
        expect(applied.every((e) => e.targetId !== SINK_ID)).toBe(true);
        expect(applied.map((e) => e.targetId)).toEqual(['ally-front']);
        expect(applied.every((e) => e.sourceId === 'foe-crit')).toBe(true);
    });

    it('an enemy AoE that crits both player actors debuffs BOTH of them', () => {
        const applied = applications(enemySide(allPattern()));
        expect(new Set(applied.map((e) => e.targetId))).toEqual(
            new Set(['attacker', 'ally-front'])
        );
        expect(applied.every((e) => e.targetId !== SINK_ID)).toBe(true);
    });

    it('never fires when the enemy cast cannot crit (non-vacuity guard)', () => {
        const noCrit = enemySide(basePattern());
        const enemies = noCrit.enemyAttackers;
        expect(
            applications({
                ...noCrit,
                enemyAttackers: [{ ...enemies[0], stats: { ...enemies[0].stats, crit: 0 } }],
            })
        ).toEqual([]);
    });
});

/**
 * SP-4b-2 D2, task-14 finding 4 — THE PER-VICTIM FAN-OUT ITSELF.
 *
 * The block above pins the ADDRESS (which enemy the debuff reaches). What it deliberately could
 * not measure is the CARDINALITY the crit route introduced: `applicationTargetIds` became a LIST,
 * so the debuff executor's landing gate is now drawn once PER crit victim, and the header comment
 * on that loop states the rule ("one draw PER TARGET"). Every fixture above uses
 * `application: 'apply'` — RNG-free by design, so the landing gate is never drawn at all — and
 * `crit: 100`, so every footprint victim crits. Between them, neither half of the executor's own
 * claim ("an AoE that crit two of three victims debuffs exactly those two") was asserted anywhere.
 *
 * These two cases split that claim along its two axes and assert each one:
 *   • LANDING is per victim — an `inflict` debuff over identically-defended victims produces one
 *     independent landing decision each, so some land and some resist within a single cast.
 *   • CRIT MEMBERSHIP is per victim — the debuffed set is EXACTLY the cast's `critVictimIds`, on a
 *     cast that crit only some of the enemies it hit.
 *
 * SEEDING. Both cases need a genuinely mixed draw, so all four pin the SAME
 * `setupKeyedTestRng(MIXED_DRAW_SEED)` (never followed by `resetRateGateRng` — the global
 * bootstrap's `afterEach` owns cleanup). The seed chooses WHICH victims land/crit; it does not
 * choose the invariants — the set-equality and the one-decision-per-victim count hold for every
 * seed, and the "genuinely partial / genuinely mixed" guards are the only assertions the seed
 * exists to make reproducible. It was found by scanning seeds 1.. for the first that makes all
 * four fixtures below genuinely mixed at once (2: 1-of-4 land, 2-of-3 land, 2-of-4 crit,
 * 2-of-4 crit).
 *
 * Team symmetry is LOCKED: each case has its enemy-side mirror.
 */
describe('SP-4b-2 D2 — the crit route fans the landing gate out per victim', () => {
    /** See the SEEDING note above: the smallest seed that makes all four fixtures genuinely mixed. */
    const MIXED_DRAW_SEED = 2;

    // hacking 250 vs security 200 → a landing chance of exactly 0.5, so four independent draws
    // over four identical victims cannot all agree. Every victim shares one chance, so a MIXED
    // result is only possible if the gate is drawn per victim.
    const FOUR_FOES = (): EnemyAttacker[] => [
        punchingBag('foe-a', 'M4', 200),
        punchingBag('foe-b', 'M3', 200),
        punchingBag('foe-c', 'M2', 200),
        punchingBag('foe-d', 'M1', 200),
    ];

    it('an `inflict` on-crit debuff draws landing PER crit victim — some land, some resist', () => {
        setupKeyedTestRng(MIXED_DRAW_SEED);
        const { landed, resisted, critVictimIds } = landingOutcomes(
            focus({
                hacking: 250,
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [hit()] },
                        { slot: 'passive', abilities: [onCritInflictDebuff()] },
                    ],
                },
                pattern: allPattern(),
                enemyAttackers: FOUR_FOES(),
            })
        );

        // crit 100 → the AoE crit all four, so all four are candidates for the debuff.
        expect(new Set(critVictimIds)).toEqual(new Set(['foe-a', 'foe-b', 'foe-c', 'foe-d']));

        // EXACTLY ONE landing decision per crit victim — the cardinality claim. A single shared
        // draw (the pre-fan-out shape) would produce one decision, not four.
        expect([...landed, ...resisted].sort()).toEqual(['foe-a', 'foe-b', 'foe-c', 'foe-d']);

        // …and the four draws genuinely disagreed, which is what makes them independent rather
        // than one outcome replayed four times. (Seed-pinned; the two assertions above are not.)
        expect(landed.length).toBeGreaterThan(0);
        expect(resisted.length).toBeGreaterThan(0);
    });

    it('an enemy `inflict` on-crit debuff draws landing per PLAYER victim (mirror)', () => {
        setupKeyedTestRng(MIXED_DRAW_SEED);
        const enemy = critingEnemy('foe-crit', 'M4', allPattern());
        const { landed, resisted, critVictimIds } = landingOutcomes(
            focus({
                attack: 0,
                crit: 0,
                // security 200 on both player actors → the enemy's 250 hacking gives the same 0.5.
                shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                security: 200,
                speed: 1,
                teamActors: [bystander('ally-front', 'M4', 200), bystander('ally-mid', 'M3', 200)],
                enemyAttackers: [
                    {
                        ...enemy,
                        shipSkills: {
                            slots: [
                                { slot: 'active', abilities: [hit()] },
                                { slot: 'passive', abilities: [onCritInflictDebuff()] },
                            ],
                        },
                    },
                ],
            })
        );

        expect(new Set(critVictimIds)).toEqual(new Set(['attacker', 'ally-front', 'ally-mid']));
        expect([...landed, ...resisted].sort()).toEqual(['ally-front', 'ally-mid', 'attacker']);
        expect(landed.length).toBeGreaterThan(0);
        expect(resisted.length).toBeGreaterThan(0);
    });

    // The other axis: `apply` (no landing draw at all) so the ONLY thing that can vary is which
    // victims the cast crit. crit 50 → per-victim crit draws → a partial crit.
    it('a PARTIAL crit debuffs exactly the victims it crit, and no others', () => {
        setupKeyedTestRng(MIXED_DRAW_SEED);
        const { landed, resisted, critVictimIds } = landingOutcomes(
            focus({
                crit: 50,
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [hit()] },
                        { slot: 'passive', abilities: [onCritDebuff()] },
                    ],
                },
                pattern: allPattern(),
                enemyAttackers: FOUR_FOES(),
            })
        );

        // GENUINELY PARTIAL (seed-pinned): the cast crit some but not all four. Without this the
        // set-equality below would be satisfied by an all-crit cast and prove nothing.
        expect(critVictimIds.length).toBeGreaterThan(0);
        expect(critVictimIds.length).toBeLessThan(4);

        // THE CLAIM: the debuffed set IS the crit set — the non-crit victims are untouched, and no
        // crit victim is missed. `apply` never resists, so `landed` is the whole story.
        expect(new Set(landed)).toEqual(new Set(critVictimIds));
        expect(resisted).toEqual([]);
        expect(landed.every((id) => id !== SINK_ID)).toBe(true);
    });

    it('an enemy PARTIAL crit debuffs exactly the player actors it crit (mirror)', () => {
        setupKeyedTestRng(MIXED_DRAW_SEED);
        const enemy = critingEnemy('foe-crit', 'M4', allPattern());
        const { landed, resisted, critVictimIds } = landingOutcomes(
            focus({
                attack: 0,
                crit: 0,
                shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                speed: 1,
                teamActors: [
                    bystander('ally-front', 'M4'),
                    bystander('ally-mid', 'M3'),
                    bystander('ally-back', 'M2'),
                ],
                enemyAttackers: [{ ...enemy, stats: { ...enemy.stats, crit: 50 } }],
            })
        );

        expect(critVictimIds.length).toBeGreaterThan(0);
        expect(critVictimIds.length).toBeLessThan(4);
        expect(new Set(landed)).toEqual(new Set(critVictimIds));
        expect(resisted).toEqual([]);
        expect(landed.every((id) => id !== SINK_ID)).toBe(true);
    });
});
