/**
 * End-to-end log visibility for shield-destroyed (Task 3) and cheat-death-activated (Task 4)
 * through the REAL positional sim path (planPlacement -> simulateBattle -> buildCombatLog).
 * These events fire inside applyVictimDamage; the engine buffers them (defer-flush) so they
 * surface nested under the triggering attack rather than out of order.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

const makeShip = (id: string, name: string, over: Partial<Ship> = {}): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'Attacker',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    ...over,
});

const placement = (
    ship: Ship,
    position: BattlePlacement['position'],
    over: Partial<NonNullable<BattlePlacement['statOverrides']>>
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 1000,
        crit: 0,
        critDamage: 100,
        defensePenetration: 0,
        hacking: 0,
        defence: 0,
        hp: 20_000,
        speed: 100,
        ...over,
    },
});

const noGear = (): GearPiece | undefined => undefined;

describe('shield-destroyed surfaces in the combat log (real sim path)', () => {
    it('a broken enemy shield appears as a shield-destroyed entry', () => {
        // Enemy seeds a start-of-combat self-shield; a fast, hard-hitting player breaks it.
        const shielded = makeShip('shielded', 'Shielded', {
            secondPassiveSkillText:
                'This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.',
            refits: [{}, {}] as Ship['refits'],
        });
        const breaker = makeShip('breaker', 'Breaker');
        const result = simulateBattle(
            {
                playerTeam: [
                    placement(breaker, 'M2', { attack: 5000, crit: 0, hp: 20_000, speed: 300 }),
                ],
                enemyTeam: [
                    placement(shielded, 'M4', {
                        attack: 1,
                        crit: 0,
                        defence: 0,
                        hp: 20_000,
                        speed: 1,
                    }),
                ],
                rounds: 2,
            },
            noGear
        );
        const shieldBreaks = flattenCombatLog(result).filter((e) => e.kind === 'shield-destroyed');
        expect(shieldBreaks.length).toBeGreaterThan(0);

        // Ordering proof (the actual defer-flush contract): the shield-destroyed entry fires
        // INSIDE applyVictimDamage — BEFORE the attack's deferred ability-performed on the
        // positional path — so a naive (unbuffered) forward would surface it as a TOP-LEVEL
        // sibling entry in the breaker's turn instead of nested under the attack that caused it.
        // Only the buffered defer-flush routes it into the triggering attack's `.reactions[]`.
        const topLevelShieldDestroyed = result.combatLog
            .flatMap((round) => round.turns.flatMap((turn) => turn.entries))
            .filter((entry) => entry.kind === 'shield-destroyed');
        expect(topLevelShieldDestroyed).toHaveLength(0);

        const nestedShieldDestroyed = result.combatLog
            .flatMap((round) => round.turns.flatMap((turn) => turn.entries))
            .flatMap((entry) => entry.reactions)
            .filter((reaction) => reaction.kind === 'shield-destroyed');
        expect(nestedShieldDestroyed.length).toBeGreaterThan(0);
        expect(nestedShieldDestroyed.length).toBe(shieldBreaks.length);
    });
});
