import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';

type CleansePerformed = Extract<CombatEvent, { type: 'cleanse-performed' }>;

// ---------------------------------------------------------------------------
// C1 Task 3: cast-path cleanse REMOVES debuffs (player-side).
//
// Two-team battle-sim harness (mirrors enemyActions.test.ts Task 5b): a player
// healer (focus = the heal target) carries a cleanse ability; a FASTER enemy
// attacker applies a removable debuff (`Attack Down`, application 'apply' → always
// lands, no affinity disadvantage) to the heal target each round BEFORE the focus
// acts. After the focus cleanses, the debuff must be GONE and the `cleanseCount`
// metric must reflect the ACTUAL number removed (1), not the nominal cfg.count.
// ---------------------------------------------------------------------------
describe('C1 Task 3: cast-path cleanse removes debuffs (player-side)', () => {
    const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
        id: `c${Math.random().toString(36).slice(2)}`,
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        ...partial,
    });

    const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
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
        hp: 10000,
        ...overrides,
    });

    // Focus healer: a cleanse-2 active cast targeting self (the heal target).
    const cleanseSkills = (count: number): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'cleanse',
                        target: 'self',
                        config: { type: 'cleanse', count },
                    }),
                ],
            },
        ],
    });

    // Enemy attacker: a FASTER (speed 100) actor whose active cast applies a single
    // removable debuff (Attack Down, application 'apply' → lands unless affinity
    // disadvantage; none here → always lands) to the heal target.
    const debuffEnemy = (count = 1) => ({
        id: 'enemy1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 200 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: Array.from({ length: count }, (_, i) =>
                        ab({
                            type: 'debuff',
                            target: 'enemy', // from the enemy's view the heal target is its enemy
                            config: {
                                type: 'debuff',
                                buffName: `Attack Down ${i + 1}`,
                                parsedEffects: { attack: -30 },
                                stacks: 1,
                                isStackable: false,
                                application: 'apply',
                                duration: 5,
                            },
                        })
                    ),
                },
            ],
        },
    });

    it('removes the enemy-applied debuff and credits the ACTUAL removed count (1, not nominal 2)', () => {
        const events: CleansePerformed[] = [];
        const bus = createEventBus();
        bus.on('cleanse-performed', (e) => events.push(e));

        const result = runCombat(
            BASE({
                numRounds: 1,
                healTargetId: 'attacker',
                bus,
                // Focus cleanses up to 2, but only ONE removable debuff exists this round.
                shipSkills: cleanseSkills(2),
                enemyAttackers: [debuffEnemy(1)],
            })
        );

        // cleanseCount credits the ACTUAL removed count (1), NOT the nominal cfg.count (2).
        const focusCleanse = (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('attacker')?.cleanseCount ?? 0),
            0
        );
        expect(focusCleanse).toBe(1);

        // cleanse-performed fired with the focus id and the ACTUAL removed count.
        const focusCleanseEvents = events.filter((e) => e.casterId === 'attacker');
        expect(focusCleanseEvents.length).toBe(1);
        expect(focusCleanseEvents[0].count).toBe(1);
    });

    it('cleanse with nothing removable credits 0 and emits no cleanse-performed', () => {
        const events: CleansePerformed[] = [];
        const bus = createEventBus();
        bus.on('cleanse-performed', (e) => events.push(e));

        const result = runCombat(
            BASE({
                numRounds: 1,
                healTargetId: 'attacker',
                bus,
                // Focus cleanses but no enemy applies any debuff → nothing to remove.
                shipSkills: cleanseSkills(2),
                enemyAttackers: [
                    {
                        id: 'enemy1',
                        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 100 },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: { slots: [] },
                    },
                ],
            })
        );

        const focusCleanse = (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('attacker')?.cleanseCount ?? 0),
            0
        );
        expect(focusCleanse).toBe(0);
        const focusCleanseEvents = events.filter((e) => e.casterId === 'attacker');
        expect(focusCleanseEvents.length).toBe(0);
    });
});
