/**
 * enemyCleanse.integration.test.ts — enemy on-cast cleanse removal (positional two-team sim).
 *
 * Symmetric counterpart to E5's enemy HEAL lift and #166's enemy SHIELD lift: an enemy ship's
 * on-cast CLEANSE ability now REMOVES debuffs the player applied to it (and emits a
 * cleanse-performed reflecting the REAL removed count) — previously the enemy arm of the cleanse
 * branch removed nothing and bumped the count by the nominal cfg.count.
 *
 * Distinguishing observable: the player applies ONE removable debuff and the enemy cleanses
 * count: 2. PRE-FIX the stub emits cleanse-performed { count: 2 } (nominal) and removes nothing;
 * POST-FIX it emits { count: 1 } (real removal). The negative control (no debuff applied → no
 * cleanse-performed) is the explicit cadence-change guard (old stub always fired).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type CleansePerformed = Extract<CombatEvent, { type: 'cleanse-performed' }>;

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// Player active: a damage hit PLUS a removable debuff ('Attack Down', application 'apply' → lands
// with no affinity disadvantage) onto the positionally-anchored front enemy.
const damageThenDebuff = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'ec-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
        {
            id: 'ec-debuff',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Attack Down',
                parsedEffects: { attack: -30 },
                stacks: 1,
                isStackable: false,
                application: 'apply',
                duration: 5,
            },
        } as unknown as Ability,
    ],
});

const damageOnly = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'ec-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
});

// Enemy whose ACTIVE cleanses up to `count` debuffs off itself (no damage).
const selfCleanseSkills = (count: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'enemy-oncast-cleanse',
                    type: 'cleanse',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'cleanse', count },
                },
            ],
        },
    ],
});

const enemyAt = (id: string, position: Position, shipSkills: ShipSkills): EnemyAttacker =>
    ({
        id,
        stats: { attack: 1_000, crit: 0, critDamage: 0, defence: 0, hp: 40_000, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills,
    }) as EnemyAttacker;

// Player FOCUS at M4 fires `front` (anchors the enemy at M4) and acts FIRST (speed 200), immortal.
const playerVsEnemy = (
    playerSlot: ShipSkills['slots'][number],
    enemies: EnemyAttacker[],
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [playerSlot] },
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
    speed: 200,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: enemies,
    ...overrides,
});

describe('enemy on-cast cleanse: removes a player-applied debuff (real removed count)', () => {
    it('POSITIVE: player applies 1 debuff, enemy cleanses count 2 → cleanse-performed { count: 1 }', () => {
        const bus = createEventBus();
        const events: CleansePerformed[] = [];
        bus.on('cleanse-performed', (e) => {
            if (e.type === 'cleanse-performed') events.push(e);
        });
        runCombat(
            playerVsEnemy(damageThenDebuff(), [enemyAt('foe', 'M4', selfCleanseSkills(2))], { bus })
        );
        // The enemy's own cleanse-performed, keyed on the enemy id.
        const enemyCleanse = events.filter((e) => e.casterId === 'foe');
        expect(enemyCleanse.length).toBe(1);
        // REAL removal (1) — NOT the nominal cfg.count (2). PRE-FIX this is 2 and the test fails.
        expect(enemyCleanse[0].count).toBe(1);
    });

    it('NEGATIVE control: enemy cleanses with NO debuff applied → no cleanse-performed (cadence)', () => {
        const bus = createEventBus();
        const events: CleansePerformed[] = [];
        bus.on('cleanse-performed', (e) => {
            if (e.type === 'cleanse-performed') events.push(e);
        });
        runCombat(
            playerVsEnemy(damageOnly(), [enemyAt('foe', 'M4', selfCleanseSkills(2))], { bus })
        );
        // Nothing to remove → real count 0 → NO event. PRE-FIX the stub fires { count: 2 } and fails.
        expect(events.filter((e) => e.casterId === 'foe')).toHaveLength(0);
    });
});

const grifPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'ec-grif',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-enemy-cleansed',
            conditions: [],
            config: { type: 'damage', multiplier: 200, noCrit: true },
        } as unknown as Ability,
    ],
});

describe('enemy on-cast cleanse: drives a focus on-enemy-cleansed (Grif) proc on REAL removal', () => {
    it('enemy removes a player-applied debuff → focus Grif on-enemy-cleansed proc fires', () => {
        const input = playerVsEnemy(damageThenDebuff(), [
            enemyAt('foe', 'M4', selfCleanseSkills(2)),
        ]);
        // Inject the Grif passive alongside the player's debuff active.
        input.shipSkills = { slots: [damageThenDebuff(), grifPassive()] };
        const bus = createEventBus();
        const procs: number[] = [];
        bus.on('reactive-damage-performed', (e) => {
            if (e.type === 'reactive-damage-performed' && e.targetId === 'foe')
                procs.push(e.amount);
        });
        input.bus = bus;
        const result = runCombat(input);

        // This is a positioned two-team run, so the Grif on-enemy-cleansed reactive reduces the
        // foe's real HP and books its intake per-victim (perTargetDealt) alongside the player's own
        // attack — it does NOT land on the credit-only `directDamage` bucket this assertion used to
        // read. Both amounts are exact here (crit 0, defence 0, no shields, single round): the
        // active is attack × 100% = 10_000 and the proc is attack × 200% = 20_000, against a
        // 40_000-HP foe so nothing clamps.
        expect(procs).toEqual([20_000]);
        const dealtToFoe = result.rounds.reduce(
            (sum, rd) => sum + (rd.perTargetDealt?.attacker?.foe ?? 0),
            0
        );
        expect(dealtToFoe).toBe(30_000);
    });
});

// PR11 (epic PR11) team-symmetry: an ENEMY carrying the debuff-duration-reduction reactive
// (Heliodor's shape: on-attacked, target self, count:'all') behaves identically to a player-side
// carrier — proving the mechanic is not player-only. The reduce-duration branch is a "pure status
// mutation" (triggers.ts) that credits `cleanseCount` via `ctx.healing.credit(intent.ownerId, …)`
// regardless of side — empirically confirmed this credits the ENEMY's OWN `perActor` bucket (NOT
// suppressed the way E5's player-facing heal metric is for enemy heals). Distinguishing
// observable: the player applies TWO distinct debuffs to the enemy each round ('Older','Newer').
// count:1 (Warpstrike's newest-only shape) can only ever touch ONE of them; count:'all' (this
// PR's Heliodor/Pestilence shape) touches BOTH — proven on an ENEMY owner exactly as the
// player-side unit tests (cleanseReactivePath.test.ts) proved it on a player owner.
describe('PR11: enemy-side debuff-duration reduction (team symmetry — Heliodor shape)', () => {
    const debuffAbility = (name: string): Ability =>
        ({
            id: `sym-debuff-${name}`,
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: name,
                parsedEffects: { attack: -10 },
                stacks: 1,
                isStackable: false,
                application: 'apply',
                duration: 5,
            },
        }) as unknown as Ability;

    // Player active: 100% damage + TWO distinct always-landing debuffs on the enemy.
    const damageThenTwoDebuffs = (): ShipSkills['slots'][number] => ({
        slot: 'active',
        abilities: [
            {
                id: 'sym-basic',
                type: 'damage',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'damage', multiplier: 100 },
            },
            debuffAbility('Older'),
            debuffAbility('Newer'),
        ],
    });

    // Enemy: a plain 100% damage active, paired with an on-attacked self reduce-duration passive
    // whose `count` is the parameter under test (1 = pre-PR11 newest-only; 'all' = PR11's shape).
    const enemyReduceDurationSkills = (count: number | 'all'): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'enemy-basic',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
            {
                slot: 'passive',
                abilities: [
                    {
                        id: 'enemy-reduce-duration',
                        type: 'cleanse',
                        target: 'self',
                        trigger: 'on-attacked',
                        conditions: [],
                        config: {
                            type: 'cleanse',
                            count,
                            mode: 'reduce-duration',
                            durationTurns: 1,
                        },
                    } as unknown as Ability,
                ],
            },
        ],
    });

    const foeCleanseCount = (count: number | 'all'): number | undefined => {
        const result = runCombat(
            playerVsEnemy(damageThenTwoDebuffs(), [
                enemyAt('foe', 'M4', enemyReduceDurationSkills(count)),
            ])
        );
        return result.healing?.rounds[0]?.perActor.get('foe')?.cleanseCount;
    };

    it("CONTROL (count:1, newest-only): the enemy's reactive touches exactly ONE of its two debuffs", () => {
        expect(foeCleanseCount(1)).toBe(1);
    });

    it("TREATMENT (count:'all', PR11): the SAME enemy reactive touches BOTH debuffs — the defining team-symmetry observable", () => {
        expect(foeCleanseCount('all')).toBe(2);
    });
});
