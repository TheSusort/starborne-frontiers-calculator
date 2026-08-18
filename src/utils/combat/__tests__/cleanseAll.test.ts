import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';

type CleansePerformed = Extract<CombatEvent, { type: 'cleanse-performed' }>;

// ---------------------------------------------------------------------------
// C1 Task 5: "cleanse all" REMOVES every removable debuff (player-side cast).
//
// Mirrors cleanseCastPath.test.ts. A player healer (focus = the heal target)
// carries a `cleanse` ability with count 'all'. A FASTER enemy attacker applies
// several removable debuffs AND one UNREMOVABLE debuff (Acidic Decay) to the
// heal target before the focus acts. After the focus cleanses 'all', every
// removable debuff must be gone while the unremovable one remains, and
// cleanseCount must equal the number actually removed.
// ---------------------------------------------------------------------------
describe('C1 Task 5: "cleanse all" removes every removable debuff (player-side)', () => {
    const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
        id: `c${Math.random().toString(36).slice(2)}`,
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        ...partial,
    });

    const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        enemyAttackers: [],
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

    // Focus healer: a cleanse-'all' active cast targeting self (the heal target).
    const cleanseAllSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'cleanse',
                        target: 'self',
                        config: { type: 'cleanse', count: 'all' },
                    }),
                ],
            },
        ],
    });

    // Enemy attacker (FASTER, speed 200): applies `removable` distinct removable
    // debuffs (Attack Down N) plus one UNREMOVABLE debuff (Acidic Decay) to the
    // heal target each round before the focus acts.
    const debuffEnemy = (removable: number) => ({
        id: 'enemy1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 200 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        ...Array.from({ length: removable }, (_, i) =>
                            ab({
                                type: 'debuff',
                                target: 'enemy',
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
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            config: {
                                type: 'debuff',
                                buffName: 'Acidic Decay', // UNREMOVABLE
                                parsedEffects: { defense: -30 },
                                stacks: 1,
                                isStackable: false,
                                application: 'apply',
                                duration: 5,
                            },
                        }),
                    ],
                },
            ],
        },
    });

    it('removes every removable debuff, keeps the unremovable one, credits the actual removed count', () => {
        const events: CleansePerformed[] = [];
        const bus = createEventBus();
        bus.on('cleanse-performed', (e) => events.push(e));

        const REMOVABLE = 3;
        const result = runCombat(
            BASE({
                numRounds: 1,
                healTargetId: 'attacker',
                mode: 'healing',
                bus,
                shipSkills: cleanseAllSkills(),
                enemyAttackers: [debuffEnemy(REMOVABLE)],
            })
        );

        // cleanseCount credits the ACTUAL removed count = every removable debuff (3),
        // excluding the unremovable Acidic Decay.
        const focusCleanse = (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('attacker')?.cleanseCount ?? 0),
            0
        );
        expect(focusCleanse).toBe(REMOVABLE);

        // cleanse-performed fired once with the focus id and the actual removed count.
        const focusCleanseEvents = events.filter((e) => e.casterId === 'attacker');
        expect(focusCleanseEvents.length).toBe(1);
        expect(focusCleanseEvents[0].count).toBe(REMOVABLE);
    });
});
