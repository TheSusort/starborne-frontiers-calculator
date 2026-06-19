import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';

type CleansePerformed = Extract<CombatEvent, { type: 'cleanse-performed' }>;

// ---------------------------------------------------------------------------
// C1 Task 4: reactive-path cleanse REMOVES debuffs (player-side, side-correct).
//
// Mirrors cleanseCastPath.test.ts but drives the cleanse through the REACTIVE
// trigger machinery (executeIntent) instead of the on-cast path. A player healer
// (focus = the heal target) carries a `start-of-round` reactive cleanse targeting
// itself; a FASTER enemy attacker applies a removable debuff (`Attack Down`,
// application 'apply' → always lands) to the heal target each round. Because
// `start-of-round` fires at the TOP of each round (before any turn), the debuff
// applied in round N is present when the reactive cleanse fires at the top of
// round N+1 — so it is removed, and `cleanseCount` reflects the ACTUAL removed
// count (NOT the nominal cfg.count, which was the pre-T4 behaviour).
// ---------------------------------------------------------------------------
describe('C1 Task 4: reactive-path cleanse removes debuffs (player-side)', () => {
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

    // Focus healer: a reactive (start-of-round) cleanse-1 on a passive slot, targeting
    // self (the heal target). A reactive trigger routes through executeIntent's cleanse
    // branch — the path this task wires.
    const reactiveCleanseSkills = (count: number): ShipSkills => ({
        slots: [
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'cleanse',
                        target: 'self',
                        trigger: 'start-of-round',
                        config: { type: 'cleanse', count },
                    }),
                ],
            },
        ],
    });

    // Enemy attacker: a FASTER (speed 200) actor whose active cast applies a single
    // removable debuff (Attack Down, application 'apply' → always lands) to the heal target.
    const debuffEnemy = () => ({
        id: 'enemy1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 200 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        ab({
                            type: 'debuff',
                            target: 'enemy', // from the enemy's view the heal target is its enemy
                            config: {
                                type: 'debuff',
                                buffName: 'Attack Down',
                                parsedEffects: { attack: -30 },
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

    it('reactive cleanse REMOVES the enemy-applied debuff and credits the ACTUAL removed count', () => {
        const events: CleansePerformed[] = [];
        const bus = createEventBus();
        bus.on('cleanse-performed', (e) => events.push(e));

        const NUM_ROUNDS = 3;
        const result = runCombat(
            BASE({
                numRounds: NUM_ROUNDS,
                healTargetId: 'attacker',
                bus,
                shipSkills: reactiveCleanseSkills(1),
                enemyAttackers: [debuffEnemy()],
            })
        );

        // Round timeline:
        //   R1: start-of-round cleanse fires (nothing on focus yet → 0 removed), then the
        //       faster enemy applies Attack Down to the focus.
        //   R2: start-of-round cleanse fires → removes the Attack Down from R1 (1), then the
        //       enemy re-applies Attack Down.
        //   R3: start-of-round cleanse fires → removes the Attack Down from R2 (1), then re-apply.
        // → total ACTUAL removed = 2 (NOT the nominal 1 × 3 = 3 the pre-T4 credit-only path gave).
        const totalCleanse = (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('attacker')?.cleanseCount ?? 0),
            0
        );
        expect(totalCleanse).toBe(2);
    });
});
