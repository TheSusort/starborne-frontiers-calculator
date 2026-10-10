/**
 * An enemy's max HP is its EFFECTIVE (buff-folded) max HP on both sides of the board: a player
 * attacker reads the same figure an enemy attacker reads off a buffed player ship. An enemy at
 * 100,000 current HP with a +20% HP buff has a 120,000 max, so it sits at 83% — not 100%.
 *
 * The probe is an Akula-shape hit: damage scaled up to +30% by the target's current HP percentage.
 * The enemy is faster than the focus and buffs itself first, so its raised max is published before
 * the focus acts. Each arm builds its own input, so the comparison is between distinct boards.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { bareInput, bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';
import type { Ability, ShipSkills } from '../../../types/abilities';

const FOCUS_ID = 'attacker';
const ENEMY_HP = 100_000;
const HP_BUFF_PCT = 20;
const BASE_DAMAGE_PCT = 100;
const HP_SCALING_MAX_PCT = 30;

const hpScaledHit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'hp-scaled',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [{ subject: 'enemy-hp-pct', derivable: true }],
                    config: { type: 'damage', multiplier: BASE_DAMAGE_PCT },
                    scaling: {
                        conditionIndex: 0,
                        perUnit: HP_SCALING_MAX_PCT / 100,
                        cap: HP_SCALING_MAX_PCT,
                    },
                },
            ],
        },
    ],
});

const selfHpBuffKit = (): ShipSkills => {
    const buff: Ability = {
        id: 'hp-up',
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'HP Up',
            parsedEffects: { hp: HP_BUFF_PCT },
            stacks: 1,
            isStackable: false,
            duration: 10,
        },
    };
    return { slots: [{ slot: 'active', abilities: [buff] }] };
};

const focusHit = (input: CombatEngineInput): number => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('attacked', (e) => events.push(e));
    runCombat({ ...input, numRounds: 1, bus });
    const hit = events.find(
        (e) => e.type === 'attacked' && e.attackerId === FOCUS_ID && e.targetId === BARE_ENEMY_ID
    );
    if (!hit || hit.type !== 'attacked' || hit.damage === undefined)
        throw new Error('no damaging focus hit on the enemy');
    return hit.damage;
};

const board = (enemyKit: ShipSkills | undefined): CombatEngineInput => ({
    ...bareInput(),
    shipSkills: hpScaledHit(),
    enemyAttackers: bareEnemy({
        ...(enemyKit ? { shipSkills: enemyKit } : {}),
        stats: { hp: ENEMY_HP, speed: 200 },
    }),
});

describe('enemy effective max HP on the player-attacks-enemy path', () => {
    const unbuffed = focusHit(board(undefined));
    const buffed = focusHit(board(selfHpBuffKit()));

    it('control: an unbuffed enemy at full HP takes the full +30% HP-scaled bonus', () => {
        // 10,000 attack, 100% multiplier, 0 defence: 10,000 * 1.30.
        expect(unbuffed).toBe(13_000);
    });

    it('an HP-buffed enemy at 83% takes the bonus for 83%, not for full HP', () => {
        // current 100,000 / max 120,000 = 83.33% -> +25%.
        expect(buffed).toBeCloseTo(12_500, 0);
    });
});
