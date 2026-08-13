/**
 * Ship-kit correctness audit, Wave 3, Task 8 — Pestilence's `on-enemy-cleansed` reactive DoT
 * (ENGINE integration).
 *
 * Pestilence's second passive (verbatim from docs/ship-skills.csv, the cleanse clause): "When an
 * enemy cleanses a Debuff this unit inflicts Corrosion II for 2 turns on all cleansed enemies."
 * Before this task NO ability of any kind existed for it: DoT abilities were built ONLY by
 * `buildDoTAutoFill` (active/charge sources — passive-slot DoTs categorically excluded) and
 * `dotAbility()` hardcodes `trigger:'on-cast'`, so there was no code path that could produce a
 * reactive passive-slot DoT. This task adds that path (parser: `detectEnemyCleanseTrigger`-gated
 * dot builder; engine: a `cleansedEnemyIds` eventCtx field on the `on-enemy-cleansed` trigger case
 * + a multi-recipient fan-out in the reactive `dot` executor).
 *
 * Exercised through the REAL production pipeline (`buildShipAbilities` fed verbatim skill text,
 * never a hand-built ability). Follows the `onEnemyTauntGainedReactivePromotion.integration.test.ts`
 * harness (mutation guard, then `runCombat` positional battles). The DoT must land on the REAL
 * cleansed enemies — ALL of them ("on all cleansed enemies") — never on the DPS dummy sink
 * (`ctx.enemy`, literal id `'enemy'`). This is the dummy-sink failure class documented in
 * `project_reactive_dot_routing_and_dummy_gate` (PR #244). A same-side (player) cleanse must NOT
 * trigger it (opposing-scoped), and an enemy-side Pestilence must react to a player cleanse
 * (team symmetry).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type DotApplied = Extract<CombatEvent, { type: 'dot-applied' }>;

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

// Verbatim docs/ship-skills.csv Corrosion clause of Pestilence's second (refit-active) passive.
const PESTILENCE_CLEANSE_P2 =
    'When an enemy <unit-aid>cleanses a Debuff</unit-aid> this unit inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns on all cleansed enemies.';

/** Extract Pestilence's reactive Corrosion-on-enemy-cleanse DoT through the REAL parser/builder. */
function pestilenceCleanseDot(): Ability {
    const abilities =
        buildShipAbilities(ship({ secondPassiveSkillText: PESTILENCE_CLEANSE_P2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? [];
    const dot = abilities.find((a) => a.type === 'dot' && a.config.type === 'dot');
    if (!dot)
        throw new Error('mutation guard: Pestilence Corrosion-on-enemy-cleanse DoT not found');
    return dot;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pt = (selection: string): any => ({ raw: selection, side: 'enemy', selection });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const basePattern = (): any => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
// A whole-team pattern so an all-enemies debuff's footprint covers EVERY positioned enemy
// (resolvePattern's `shape === 'all'` special case → ALL_POSITIONS).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allPattern = (): any => ({ raw: 'all', shape: 'all', range: 0, modifiers: {} });

// A whole-team debuff (target 'all-enemies') that always lands — the "removable debuff" the
// cleanser then strips (so cleanse-performed fires with a REAL removal on all touched enemies).
const allEnemiesDebuff = (id: string): Ability =>
    ({
        id,
        type: 'debuff',
        target: 'all-enemies',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'debuff',
            buffName: 'Attack Down',
            parsedEffects: { attack: -30 },
            stacks: 1,
            isStackable: false,
            application: 'apply',
            duration: 9,
        },
    }) as unknown as Ability;

// An all-allies cleanse (removes 1 debuff off the caster's WHOLE side) — so ONE cleanse-performed
// event carries MULTIPLE cleansed ids, exercising the multi-recipient fan-out.
const allAlliesCleanse = (id: string): Ability =>
    ({
        id,
        type: 'cleanse',
        target: 'all-allies',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'cleanse', count: 1 },
    }) as unknown as Ability;

const noopActive = (id: string): Ability =>
    ({
        id,
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 0 },
    }) as unknown as Ability;

const enemyAt = (
    id: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    position: any,
    slots: ShipSkills['slots'],
    speed: number
): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed, security: 0 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: pt('front'),
        pattern: basePattern(),
        shipSkills: { slots },
    }) as unknown as EnemyAttacker;

function runAndCollect(input: CombatEngineInput) {
    const bus = createEventBus();
    const dotsApplied: DotApplied[] = [];
    bus.on('dot-applied', (e) => dotsApplied.push(e));
    runCombat({ ...input, bus });
    return { dotsApplied };
}

// =============================================================================
// Mutation guard — the extracted ability shape (fails loudly here on a parser/builder regression
// rather than silently no-op'ing the engine tests).
// =============================================================================
describe('Pestilence Corrosion-on-enemy-cleanse — extracted ability shape (mutation guard)', () => {
    it('rides on-enemy-cleansed, all-enemies (multi-recipient), Corrosion II tier 6, 2 turns', () => {
        const dot = pestilenceCleanseDot();
        expect(dot.trigger).toBe('on-enemy-cleansed');
        expect(dot.target).toBe('all-enemies');
        expect(dot.config).toMatchObject({
            type: 'dot',
            dotType: 'corrosion',
            tier: 6,
            duration: 2,
        });
    });
});

// =============================================================================
// POSITIVE — a player Pestilence fans Corrosion onto ALL enemies an opposing cleanse touched.
// =============================================================================
describe('Pestilence (player-side) — Corrosion II lands on EVERY cleansed enemy, never the dummy sink', () => {
    // Focus 'attacker' = Pestilence: an all-enemies debuff (the removable debuff) + the reactive
    // Corrosion-on-enemy-cleanse passive. Whole-team pattern so the debuff hits both enemies.
    const pestFocusSkills = (): ShipSkills => ({
        slots: [
            { slot: 'active', abilities: [allEnemiesDebuff('p-deb')] },
            { slot: 'passive', abilities: [pestilenceCleanseDot()] },
        ],
    });

    const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: pestFocusSkills(),
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
        speed: 1000, // focus acts first → applies the debuff before the enemy cleanses
        hacking: 1000, // Corrosion always lands (vs enemy security 0)
        enemySecurity: 0,
        healTargetId: 'attacker', // healing mode unlocks the positioned enemy roster
        mode: 'healing',
        position: 'M2',
        target: pt('all'),
        pattern: allPattern(),
        // foe1 all-allies-cleanses (strips the debuff off BOTH enemies → one cleanse-performed with
        // targets [foe1, foe2]); foe2 is a passive bystander.
        enemyAttackers: [
            enemyAt('foe1', 'M4', [{ slot: 'active', abilities: [allAlliesCleanse('e-cl')] }], 10),
            enemyAt('foe2', 'M3', [{ slot: 'active', abilities: [noopActive('e-noop')] }], 5),
        ],
        ...over,
    });

    it('fans Corrosion onto BOTH cleansed enemies (one cleanse event, two recipients) and leaves the dummy empty', () => {
        let foe1: CombatActor | undefined;
        let foe2: CombatActor | undefined;
        let dummy: CombatActor | undefined;
        const bus = createEventBus();
        const dotsApplied: DotApplied[] = [];
        bus.on('dot-applied', (e) => dotsApplied.push(e));
        runCombat(
            BASE({
                bus,
                __testTapActors: (actors) => {
                    foe1 = actors.find((a) => a.id === 'foe1');
                    foe2 = actors.find((a) => a.id === 'foe2');
                    dummy = actors.find((a) => a.id === 'enemy');
                },
            })
        );
        if (!foe1 || !foe2)
            throw new Error('__testTapActors never handed out the positioned enemies');

        // The reactive Corrosion (sourceId = the Pestilence focus) landed on BOTH cleansed enemies.
        const corrosion = dotsApplied.filter(
            (e) => e.dotType === 'corrosion' && e.sourceId === 'attacker'
        );
        const hitIds = new Set(corrosion.map((e) => e.targetId));
        expect(hitIds.has('foe1')).toBe(true);
        expect(hitIds.has('foe2')).toBe(true);
        // Dummy-sink guard: the Corrosion never routed to the vestigial DPS dummy 'enemy'.
        expect(corrosion.some((e) => e.targetId === 'enemy')).toBe(false);
        expect(dummy?.corrosionEntries ?? []).toHaveLength(0);
        // Both real enemies actually carry a Corrosion stack from the focus.
        expect(foe1.corrosionEntries.some((e) => e.sourceId === 'attacker')).toBe(true);
        expect(foe2.corrosionEntries.some((e) => e.sourceId === 'attacker')).toBe(true);
    });
});

// =============================================================================
// NEGATIVE control — a SAME-SIDE (player ally) cleanse must NOT trigger a player Pestilence
// (on-enemy-cleansed is opposing-scoped).
// =============================================================================
describe('Pestilence (player-side) — a same-side (ally) cleanse does NOT trigger the Corrosion', () => {
    it('a player ally cleansing a player-side debuff never inflicts Corrosion', () => {
        // Player ally that all-allies-cleanses (removes the enemy-applied debuff off the player side).
        const allyCleanser: TeamActor = {
            id: 'ally-cleanser',
            speed: 5, // acts after the enemy applies the debuff
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [{ slot: 'active', abilities: [allAlliesCleanse('ac')] }] },
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 1_000_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        } as unknown as TeamActor;

        // Enemy that debuffs the player side (so the ally has a real debuff to cleanse) — it does
        // NOT cleanse anything itself, so the ONLY cleanse-performed is the same-side ally's.
        const enemyDebuffer = enemyAt(
            'foe',
            'M4',
            [{ slot: 'active', abilities: [allEnemiesDebuff('e-deb')] }],
            1000
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (enemyDebuffer as any).target = pt('all');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (enemyDebuffer as any).pattern = allPattern();

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopActive('p-noop')] },
                    { slot: 'passive', abilities: [pestilenceCleanseDot()] },
                ],
            },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 2,
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
            speed: 1,
            hacking: 1000,
            enemySecurity: 0,
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M3',
            target: pt('front'),
            pattern: basePattern(),
            teamActors: [allyCleanser],
            enemyAttackers: [enemyDebuffer],
        };

        const { dotsApplied } = runAndCollect(input);
        // The same-side ally cleanse fired, but Pestilence (also player-side) must NOT react.
        expect(
            dotsApplied.some((e) => e.dotType === 'corrosion' && e.sourceId === 'attacker')
        ).toBe(false);
    });
});

// =============================================================================
// SYMMETRY — an ENEMY-side Pestilence reacts to a PLAYER cleanse (team-agnostic engine).
// =============================================================================
describe('Pestilence (enemy-side) — team symmetry: reacts to a PLAYER actor cleansing', () => {
    it('an enemy Pestilence inflicts Corrosion on the cleansed PLAYER actor(s), never on itself or the dummy', () => {
        // Enemy 'enemy-pest' = Pestilence: an all-enemies debuff (hits the player side) + the
        // reactive passive.
        const enemyPest: EnemyAttacker = {
            id: 'enemy-pest',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 1,
                security: 0,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            target: pt('front'),
            pattern: basePattern(),
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [allEnemiesDebuff('ep-deb')] },
                    { slot: 'passive', abilities: [pestilenceCleanseDot()] },
                ],
            },
        } as unknown as EnemyAttacker;

        // Player ally that all-allies-cleanses (removes the enemy-Pestilence-applied debuff off the
        // player side) — an OPPOSING cleanse from the enemy Pestilence's perspective.
        const allyCleanser: TeamActor = {
            id: 'ally-cleanser',
            speed: 5,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [{ slot: 'active', abilities: [allAlliesCleanse('ac')] }] },
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 1_000_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        } as unknown as TeamActor;

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [noopActive('p-noop')] }] },
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
            hp: 1_000_000_000,
            speed: 1000,
            hacking: 0,
            enemySecurity: 0,
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M3',
            target: pt('front'),
            pattern: basePattern(),
            teamActors: [allyCleanser],
            enemyAttackers: [enemyPest],
        };

        const { dotsApplied } = runAndCollect(input);
        const corrosion = dotsApplied.filter(
            (e) => e.dotType === 'corrosion' && e.sourceId === 'enemy-pest'
        );
        // The enemy Pestilence reacted to the player cleanse and inflicted Corrosion on the
        // cleansed PLAYER actor (the real cleansed recipient, id 'attacker').
        expect(corrosion.length).toBeGreaterThan(0);
        expect(corrosion.every((e) => e.targetId === 'attacker')).toBe(true);
        // Never on the enemy Pestilence itself, and never on the DPS dummy sink.
        expect(corrosion.some((e) => e.targetId === 'enemy-pest')).toBe(false);
        expect(corrosion.some((e) => e.targetId === 'enemy')).toBe(false);
    });
});
