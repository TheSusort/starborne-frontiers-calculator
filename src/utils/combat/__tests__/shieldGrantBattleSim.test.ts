/**
 * H1 Task 5 — all-actor shield grant in the battle sim.
 *
 * The absorb side (a shield pool draining before HP) already works for ANY actor (H1
 * Task 3/4). This test pins the GRANT side: when a ship casts a shield-granting ability
 * to `all-allies`, every targeted ally — not just the engine's heal target (the focus)
 * — must actually receive a `shieldPool`.
 *
 * Harness mirrors shieldPenetration.test.ts: a focus attacker that IS the heal target,
 * a walked team ally, and the `__testTapActors` seam (the captured actor array holds LIVE
 * references mutated through the run, so we read each actor's `shieldPool` AFTER the run
 * settles). The shield-cast path lives in playerTurn.ts (`recipientsFor` → per-recipient
 * `grantShieldToTarget`).
 */
import { describe, it, expect } from 'vitest';
import { CombatActor } from '../state';
import { runCombat, CombatEngineInput } from '../engine';
import { deriveTeamEngineActors } from '../../calculators/dpsSimulator';
import { ShipSkills } from '../../../types/abilities';
import { TeamActorInput } from '../../../types/calculator';

// A team actor whose active skill grants a Shield equal to 25% of its Max HP to ALL ALLIES.
// recipientsFor('all-allies') → playerIds = ['attacker', 'team1'], so the pool must land on
// BOTH the focus (heal target) and the non-focus ally.
const SHIELD_ALL_ALLIES_SKILLS = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'team-shield',
                    type: 'shield',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'shield', pct: 25, basis: 'hp' },
                },
            ],
        },
    ],
});

const baseEngineInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    // Focus does NO damage and IS the heal target — it just sits and receives the team shield.
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
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
    hp: 40_000,
    // healingCtx requires a heal target; simulateBattle points it at the focus (player[0]).
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

describe('H1 Task 5 — shield grant reaches all targeted allies (battle sim)', () => {
    it('an all-allies shield cast grants a shieldPool to a NON-focus ally, not just the heal target', () => {
        const teamActors: TeamActorInput[] = [
            {
                id: 'team1',
                speed: 200, // acts before the focus so the grant lands within round 1
                selfBuffs: [],
                enemyDebuffs: [],
                chargeCount: 0,
                startCharged: false,
                shipSkills: SHIELD_ALL_ALLIES_SKILLS(),
                stats: {
                    attack: 1000,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    shieldPenetration: 0,
                    hacking: 175,
                    defence: 0,
                    hp: 50_000,
                },
            },
        ];
        const engineTeam = deriveTeamEngineActors(teamActors, undefined);

        // LIVE references — read shieldPool AFTER the run settles.
        let captured: CombatActor[] = [];
        runCombat(
            baseEngineInput({
                teamActors: engineTeam,
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );

        const focus = captured.find((a) => a.id === 'attacker');
        const ally = captured.find((a) => a.id === 'team1');

        // Sanity: the heal target (focus) gets a pool — this already worked pre-Task-5.
        expect(focus?.shieldPool).toBeGreaterThan(0);
        // The actual Task-5 assertion: the NON-focus ally also receives a pool.
        // 25% of team1's 50k max HP = 12,500.
        expect(ally?.shieldPool).toBeGreaterThan(0);
        expect(ally?.shieldPool).toBeCloseTo(12_500, 6);
    });
});
