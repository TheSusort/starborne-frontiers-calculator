import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';
import { createEventBus, CombatEvent } from '../events';

// ─────────────────────────────────────────────────────────────────────────────
// Control-classification unification — Task 4: resist OWNERSHIP in the cast-path
// control emission loop.
//
// Control inflictions (Stasis/Provoke/Taunt/CF/Disable) reach the engine BOTH as a
// named timed debuff (its buffName, routed through the timed landing fold which owns
// the Block-Debuff resist) AND, additively, as a `type:'control'` ability whose ONLY
// job on the cast path is to emit `control-applied` so reactions (on-stasis-applied)
// can fire.
//
// This task makes the control loop emit the SUCCESS event only:
//   (a) a normal enemy-targeted control emits `control-applied`;
//   (b) a SELF-target control (Taunt) always emits `control-applied` — it has no enemy
//       debuff target, so it ignores enemy immunity entirely;
//   (c) on a Block-Debuff-immune enemy target the control loop does NOT emit its own
//       resist — the named-status path owns it → EXACTLY ONE `debuff-resisted`.
//
// Engine is team-symmetric, so we drive these via an enemy attacker casting at the
// focus actor (the proven Block-Debuff harness direction) — the change applies to both
// sides uniformly.
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;

const engineBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
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
    hp: 1_000_000,
    healTargetId: 'attacker',
    ...overrides,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const enemyAb = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `cce${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/** An enemy attacker (speed 10 → acts AFTER the speed-100 focus actor, so the focus
 *  actor's recurring Block Debuff self-buff is live before this enemy casts) whose kit
 *  is a basic attack + the supplied control/debuff abilities. `hacking` omitted →
 *  defaults to 200 → 100% landing (so the ONLY thing that can resist is Block Debuff). */
const attackerWith = (...abilities: Ability[]): EnemyAttacker =>
    ({
        id: 'e1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        enemyAb({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        ...abilities,
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

/** Like attackerWith but with a custom `hacking` stat. `liveDebuffLandingChance`
 *  (effectiveStats.ts) clamps `(hacking - security) / 100` to >= 0 — hacking <= the focus
 *  actor's default security (100) deterministically floors the landing chance at 0, so an
 *  'inflict' named status is GUARANTEED resisted by the landing roll on round 1 (NOT
 *  Block-Debuff), independent of the RNG stream (SP-0: gates now draw from keyed per-actor
 *  sub-streams, so a mid-range rate is no longer safe to pin a single-draw outcome on). */
const attackerWithHacking = (hacking: number, ...abilities: Ability[]): EnemyAttacker =>
    ({
        id: 'e1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10, hacking },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        enemyAb({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        ...abilities,
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

/** Focus actor (heal target) shipSkills granting a recurring `Block Debuff` self-buff. */
const blockDebuffSelfSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'block-debuff-self',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Block Debuff',
                        stacks: 1,
                        isStackable: false,
                        duration: 'recurring',
                        parsedEffects: {},
                    },
                },
            ],
        },
    ],
});

const controlAb = (effect: string, target: Ability['target'] = 'enemy'): Ability =>
    enemyAb({
        type: 'control',
        target,
        config: { type: 'control', effect: effect as never },
    });

/** A named timed debuff carrying the control effect's buffName — the PARALLEL named-status
 *  path that owns the Block-Debuff resist (mirrors real builder output: control effects emit
 *  both a named debuff and a control ability). */
const namedControlDebuff = (buffName: string): Ability =>
    enemyAb({
        type: 'debuff',
        config: {
            type: 'debuff',
            buffName,
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            application: 'inflict',
            duration: 3,
        },
    });

const run = (
    focusSkills: ShipSkills,
    bus: ReturnType<typeof createEventBus>,
    attacker: EnemyAttacker
) =>
    runCombat(
        engineBase({
            numRounds: 1,
            enemyAttackers: [attacker],
            shipSkills: focusSkills,
            bus,
        })
    );

const tap = () => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('control-applied', (e) => events.push(e as CombatEvent));
    bus.on('debuff-resisted', (e) => events.push(e as CombatEvent));
    return { bus, events };
};

describe('control-classification emission — resist ownership (Task 4)', () => {
    // (a) Success: an enemy-targeted control (Provoke) whose paired named status LANDS emits
    //     control-applied on a normal cast. Mirrors real builder output (named debuff + control
    //     ability); default hacking 200 vs security 100 → 100% landing.
    it('an enemy-targeted Provoke emits control-applied{effect:provoke} when its named status lands', () => {
        const { bus, events } = tap();
        run({ slots: [] }, bus, attackerWith(namedControlDebuff('Provoke'), controlAb('provoke')));

        const controls = events.filter((e) => e.type === 'control-applied');
        expect(controls.length).toBeGreaterThan(0);
        expect(controls.some((e) => e.type === 'control-applied' && e.effect === 'provoke')).toBe(
            true
        );
        // 100% landing → no resist.
        expect(events.some((e) => e.type === 'debuff-resisted')).toBe(false);
    });

    // (b) Self-target Taunt emits control-applied even against a Block-Debuff-immune target:
    //     it has no enemy debuff target, so the immune gate is skipped entirely.
    it('a SELF-target Taunt emits control-applied{effect:taunt} regardless of target immunity', () => {
        const { bus, events } = tap();
        // Focus actor is Block-Debuff immune; the enemy still self-grants Taunt successfully.
        run(blockDebuffSelfSkills(), bus, attackerWith(controlAb('taunt', 'self')));

        const controls = events.filter((e) => e.type === 'control-applied');
        expect(controls.some((e) => e.type === 'control-applied' && e.effect === 'taunt')).toBe(
            true
        );
    });

    // (c) NO double-resist: a Block-Debuff-immune target receiving Provoke (named debuff +
    //     control ability, mirroring real builder output) produces EXACTLY ONE debuff-resisted
    //     for 'Provoke' — from the named-status path, NOT a second from the control loop. And
    //     because the control was blocked, NO control-applied fires.
    it('Block-Debuff-immune Provoke → exactly ONE debuff-resisted (named path), no control-applied', () => {
        const { bus, events } = tap();
        run(
            blockDebuffSelfSkills(),
            bus,
            attackerWith(namedControlDebuff('Provoke'), controlAb('provoke'))
        );

        const provokeResists = events.filter(
            (e) => e.type === 'debuff-resisted' && e.buffName === 'Provoke'
        );
        expect(provokeResists).toHaveLength(1);
        // Blocked → the control loop emits no success event.
        expect(events.some((e) => e.type === 'control-applied')).toBe(false);
    });

    // (d) Finding 1: a LANDING-ROLL resist (NOT Block Debuff) of the paired named status must
    //     suppress control-applied. hacking 100 vs security 100 → 0 landing chance (deterministic
    //     floor, not a probabilistic draw) → round-1 'inflict' never lands, so the named Stasis
    //     is resisted and the control must NOT emit (otherwise on-stasis-applied reactions fire
    //     for a Stasis that never landed).
    it('a landing-roll-resisted Stasis (not Block Debuff) emits NO control-applied', () => {
        const { bus, events } = tap();
        run(
            { slots: [] }, // NO Block Debuff on the target — the resist comes from the landing roll.
            bus,
            attackerWithHacking(100, namedControlDebuff('Stasis'), controlAb('stasis'))
        );

        // The named status was resisted by the landing roll → recorded resisted.
        expect(events.some((e) => e.type === 'debuff-resisted' && e.buffName === 'Stasis')).toBe(
            true
        );
        // ...and the control loop must NOT emit a success event for the un-landed Stasis.
        expect(events.some((e) => e.type === 'control-applied' && e.effect === 'stasis')).toBe(
            false
        );
    });

    // (e) Finding 1 counterpart: full landing (hacking 200 → 100%) of the paired named status
    //     DOES emit control-applied (the gate only suppresses genuine resists).
    it('a fully-landing Stasis (no resist) emits control-applied{effect:stasis}', () => {
        const { bus, events } = tap();
        run({ slots: [] }, bus, attackerWith(namedControlDebuff('Stasis'), controlAb('stasis')));

        expect(events.some((e) => e.type === 'debuff-resisted' && e.buffName === 'Stasis')).toBe(
            false
        );
        expect(events.some((e) => e.type === 'control-applied' && e.effect === 'stasis')).toBe(
            true
        );
    });
});

// Epic PR2 (control-twin gating parity): buildShipAbilities now copies a control ability's
// named-twin CONDITIONS onto the control ability itself when the twin stays on-cast (Crocus
// "if the target has more than 3 Debuffs" / Nayra "if the target was repaired this round" —
// both static per-cast gates, not reactive triggers). This proves the FULL engine — not just
// the applyAbilities plumbing in isolation — actually honors that inherited condition on the
// cast path: `runCombat` builds the real per-cast ConditionContext, gateFiringAbilities filters
// the skill's abilities against it (control included, uniformly with every other ability type),
// and controlAbilitiesFromSkill only ever sees what survives the gate.
describe('control-classification emission — inherited condition gate is honored end-to-end (epic PR2)', () => {
    it('a Crocus-style control{stasis} gated on "enemy has 4+ debuffs" does NOT emit control-applied when the target has fewer debuffs', () => {
        const { bus, events } = tap();
        const gatedControl = controlAb('stasis');
        gatedControl.conditions = [
            { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 4 },
        ];
        // Focus actor (the control's target) carries NO standing debuffs → the gate fails.
        run({ slots: [] }, bus, attackerWith(namedControlDebuff('Stasis'), gatedControl));

        expect(events.some((e) => e.type === 'control-applied' && e.effect === 'stasis')).toBe(
            false
        );
    });

    // Positive counterpart, driven via a self-buff gate (easy to stand up deterministically): the
    // attacker carries its OWN standing recurring self-buff (a passive-style aura registered at
    // combat setup, same mechanism as the Block-Debuff fixture above but on the CASTER instead of
    // the target — so it is live in the caster's own ConditionContext before its first cast, and
    // is entirely independent of the target-immunity suppression exercised by the Block-Debuff
    // tests). This proves the SAME gate mechanism DOES let control-applied through once its
    // inherited condition holds.
    it('a control{stasis} gated on the caster holding its own standing self-buff DOES emit control-applied once that self-buff is present', () => {
        const { bus, events } = tap();
        const gatedControl = controlAb('stasis');
        gatedControl.conditions = [
            { subject: 'self-buff', derivable: true, buffName: 'Overload', anyOf: true },
        ];
        const attackerWithOwnAura: EnemyAttacker = {
            id: 'e1',
            stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            enemyAb({
                                type: 'damage',
                                config: { type: 'damage', multiplier: 100 },
                            }),
                            enemyAb({
                                type: 'buff',
                                target: 'self',
                                config: {
                                    type: 'buff',
                                    buffName: 'Overload',
                                    stacks: 1,
                                    isStackable: false,
                                    duration: 'recurring',
                                    parsedEffects: {},
                                },
                            }),
                            namedControlDebuff('Stasis'),
                            gatedControl,
                        ],
                    },
                ],
            } as ShipSkills,
        } as EnemyAttacker;

        run({ slots: [] }, bus, attackerWithOwnAura);

        expect(events.some((e) => e.type === 'control-applied' && e.effect === 'stasis')).toBe(
            true
        );
    });
});
