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

const punchingBag = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    }) as EnemyAttacker;

/** An enemy-side attacker carrying the SAME on-crit reactive debuff (the mirror). */
const critingEnemy = (id: string, position: Position, pattern: ParsedPattern): EnemyAttacker =>
    ({
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
    }) as EnemyAttacker;

/** A player-side team actor that just stands there and takes hits (an enemy-side crit victim). */
const bystander = (id: string, position: Position): TeamActorEngineInput =>
    ({
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
    }) as TeamActorEngineInput;

const focus = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 100,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
        const enemies = noCrit.enemyAttackers!;
        expect(
            applications({
                ...noCrit,
                enemyAttackers: [{ ...enemies[0], stats: { ...enemies[0].stats, crit: 0 } }],
            })
        ).toEqual([]);
    });
});
