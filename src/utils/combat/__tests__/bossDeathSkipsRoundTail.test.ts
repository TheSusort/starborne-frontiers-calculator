/**
 * A destroyed bounty boss defeats its side at the end of that turn (owner ruling, #519): the
 * round's end-of-round combat does not run, so a surviving unit on the boss's side cannot wipe
 * the other side after the boss fell. An ordinary wipe keeps the round tail.
 *
 * Each case puts an end-of-round 100% hit on the boss's side that would kill the last opposing
 * ship if the round tail ran — the witness that it did not.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { collectTurns } from '../__testutils__/turnOrderTap';
import { bareInput, bareEnemy, damageKit } from '../__testutils__/bareRosterFixture';
import type { ShipSkills } from '../../../types/abilities';

const roundEndHitKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'eor',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'end-of-round',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
});

const BOSS_ID = 'boss';
const ESCORT_ID = 'escort';
const OPPONENT_ID = 'opponent';

describe('a boss death skips the round tail', () => {
    beforeEach(() => {
        setupKeyedRng(12345);
    });

    // The focus kills the enemy boss with a direct hit; the enemy escort's end-of-round hit would
    // then kill the focus, the player side's only ship.
    const enemyBossRun = (isBoss: boolean) =>
        collectTurns({
            ...bareInput(),
            mode: 'battle',
            numRounds: 3,
            hp: 5_000,
            speed: 50,
            enemyAttackers: [
                ...bareEnemy({ id: BOSS_ID, isBoss, stats: { hp: 5_000, speed: 100 } }),
                ...bareEnemy({
                    id: ESCORT_ID,
                    shipSkills: roundEndHitKit(),
                    stats: { hp: 10_000_000, attack: 10_000, speed: 1 },
                }),
            ],
        });

    it('ENEMY BOSS: the boss side loses and the round-end hit never lands', () => {
        const { result, destroyed } = enemyBossRun(true);
        expect(destroyed()).toContain(BOSS_ID);
        expect(destroyed()).not.toContain('attacker');
        expect(result.rounds).toHaveLength(1);
    });

    it('CONTROL: without the boss flag the round-end hit kills the focus', () => {
        // Proves the fixture's round-end hit is lethal, so the boss case is not vacuous. Here the
        // enemy side is not defeated by the kill, so the round tail runs.
        const { destroyed } = enemyBossRun(false);
        expect(destroyed()).toContain(BOSS_ID);
        expect(destroyed()).toContain('attacker');
    });

    // Mirror: the focus is the player side's boss and an enemy kills it with a direct hit; the
    // player-side ally's end-of-round hit would then kill the enemy side's only ship.
    const playerBossRun = (isBoss: boolean) =>
        collectTurns({
            ...bareInput(),
            mode: 'battle',
            numRounds: 3,
            hp: 5_000,
            attack: 0,
            speed: 1,
            isBoss,
            teamActors: [
                {
                    id: ESCORT_ID,
                    speed: 1,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    walk: {
                        shipSkills: roundEndHitKit(),
                        stats: {
                            attack: 10_000,
                            crit: 0,
                            critDamage: 0,
                            defensePenetration: 0,
                            hacking: 0,
                            defence: 0,
                            hp: 10_000_000,
                        },
                        affinityDamageModifier: 0,
                        affinityCritCap: 100,
                        affinityCritPenalty: 0,
                        hasChargedSkill: false,
                    },
                },
            ],
            enemyAttackers: [
                ...bareEnemy({
                    id: OPPONENT_ID,
                    shipSkills: damageKit(),
                    stats: { hp: 5_000, attack: 10_000, speed: 100 },
                }),
            ],
        });

    it('PLAYER BOSS: the boss side loses and the round-end hit never lands', () => {
        const { result, destroyed } = playerBossRun(true);
        expect(destroyed()).toContain('attacker');
        expect(destroyed()).not.toContain(OPPONENT_ID);
        expect(result.rounds).toHaveLength(1);
    });

    it('CONTROL: without the boss flag the round-end hit kills the opponent', () => {
        const { destroyed } = playerBossRun(false);
        expect(destroyed()).toContain('attacker');
        expect(destroyed()).toContain(OPPONENT_ID);
    });
});
