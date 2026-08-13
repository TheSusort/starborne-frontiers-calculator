/**
 * H2/H3 FOUNDATION (Task 0.1) — a REACTIVE shield grant lands on its actual recipient,
 * not just the engine's heal target (the battle-sim focus).
 *
 * Background: the cast path (playerTurn.ts) already routes a shield-cast pool to EACH
 * targeted ally's own actor via `healing.recipientActor(rid)` → `grantShieldToTarget(raw,
 * recipientActor)` (H1 Task 5). The REACTIVE heal/shield executor (triggers.ts) did NOT —
 * it only landed a pool when the recipient WAS the heal target (`rid === healing.targetId`).
 * So a reactive self-shield (or ally-shield) on a NON-focus ship granted NOTHING.
 *
 * This test pins the reactive path. Harness mirrors shieldGrantBattleSim.test.ts: a focus
 * attacker that IS the heal target, plus a SEPARATE non-focus team ally. The ally carries a
 * hand-built reactive self-shield with trigger 'start-of-turn' (a LIVE trigger → it routes
 * through the reactive executor, NOT the cast path). We read each actor's `shieldPool` via the
 * `__testTapActors` seam (LIVE references mutated through the run) AFTER the run settles.
 *
 * The ally is NOT the heal target. Pre-fix: its pool stays 0 (the reactive executor skips it
 * because `rid !== healing.targetId`). Post-fix: it receives 10% × its Max HP.
 */
import { describe, it, expect } from 'vitest';
import { CombatActor } from '../state';
import { runCombat, CombatEngineInput } from '../engine';
import { deriveTeamEngineActors } from '../../calculators/dpsSimulator';
import { ShipSkills } from '../../../types/abilities';
import { TeamActorInput } from '../../../types/calculator';

// A team actor whose PASSIVE carries a reactive self-shield: on its OWN start-of-turn it gains
// a Shield equal to 10% of its Max HP. trigger 'start-of-turn' is a LIVE trigger, so this
// ability is partitioned into reactiveAbilities and fired by the reactive executor — exercising
// the per-recipient routing under test. target 'self' → reactive recipients = [ownerId].
const REACTIVE_SELF_SHIELD_SKILLS = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'reactive-self-shield',
                    type: 'shield',
                    target: 'self',
                    trigger: 'start-of-turn',
                    conditions: [],
                    config: { type: 'shield', pct: 10, basis: 'hp' },
                },
            ],
        },
    ],
});

const baseEngineInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // Focus does NO damage and IS the heal target — it just sits; it is NOT the shield owner.
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

describe('Task 0.1 — a reactive shield grant lands on its NON-focus recipient (battle sim)', () => {
    it('a reactive self-shield on a non-focus ally grants that ally a pool, even though it is NOT the heal target', () => {
        const teamActors: TeamActorInput[] = [
            {
                id: 'team1',
                speed: 200, // acts within round 1 so its start-of-turn fires
                selfBuffs: [],
                enemyDebuffs: [],
                chargeCount: 0,
                startCharged: false,
                shipSkills: REACTIVE_SELF_SHIELD_SKILLS(),
                stats: {
                    attack: 0,
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

        // The focus is NOT the shield owner and casts nothing → no pool (sanity / non-vacuous).
        expect(focus?.shieldPool ?? 0).toBe(0);

        // The Task-0.1 assertion: the NON-focus ally's reactive self-shield landed a pool.
        // 10% of team1's 50k max HP = 5,000. PRE-FIX this is 0 (reactive executor skipped it).
        expect(ally?.shieldPool).toBeGreaterThan(0);
        expect(ally?.shieldPool).toBeCloseTo(5_000, 6);
    });
});
