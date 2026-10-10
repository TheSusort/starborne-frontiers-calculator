/**
 * #654: an enemy attacker pierces defence with its OWN defence penetration, exactly as a player
 * attacker does. The same 10,000-attack ship with 30% pen hits a 10,000-defence victim once from
 * each side; the two hits must be the same size. Each arm builds its own input objects, so the
 * comparison is between two genuinely different boards, not one board read twice.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { bareInput, bareEnemy, damageKit, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

const FOCUS_ID = 'attacker';
const VICTIM_DEFENCE = 10_000;

const firstHit = (input: CombatEngineInput, attackerId: string, targetId: string): number => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('attacked', (e) => events.push(e));
    runCombat({ ...input, numRounds: 1, bus });
    const hit = events.find(
        (e) => e.type === 'attacked' && e.attackerId === attackerId && e.targetId === targetId
    );
    if (!hit || hit.type !== 'attacked' || hit.damage === undefined)
        throw new Error(`no damaging hit ${attackerId} -> ${targetId}`);
    return hit.damage;
};

/** The player focus attacks; the enemy is an inert, high-defence victim. */
const playerHit = (pen: number): number =>
    firstHit(
        {
            ...bareInput(),
            defensePenetration: pen,
            enemyAttackers: bareEnemy({ stats: { defence: VICTIM_DEFENCE } }),
        },
        FOCUS_ID,
        BARE_ENEMY_ID
    );

/** The enemy attacks; the player focus is an inert, high-defence victim. */
const enemyHit = (pen: number): number =>
    firstHit(
        {
            ...bareInput(),
            attack: 0,
            shipSkills: { slots: [] },
            defence: VICTIM_DEFENCE,
            enemyAttackers: bareEnemy({
                shipSkills: damageKit(),
                stats: { attack: 10_000, defensePenetration: pen },
            }),
        },
        BARE_ENEMY_ID,
        FOCUS_ID
    );

describe('#654 enemy defence penetration', () => {
    it('an enemy with 30% pen hits as hard as the same ship on the player side', () => {
        expect(enemyHit(30)).toBe(playerHit(30));
    });

    it('pen actually moves the enemy hit (the comparison above is not vacuous)', () => {
        expect(enemyHit(30)).toBeGreaterThan(enemyHit(0));
    });

    it('0% pen is unchanged and still symmetric', () => {
        expect(enemyHit(0)).toBe(playerHit(0));
    });
});
