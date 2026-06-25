/**
 * H1 Task 2 — thread shieldPenetration from inputs onto actors.
 *
 * This task is INERT: the plumbed value is not yet consumed at any apply site (that
 * lands in H1 Task 4). These tests verify the plumbing only — every actor carries the
 * correct base shieldPenetration immediately after construction, using the
 * `__testTapActors` seam (same pattern as the A2 Task 2 actorStats.test.ts tests).
 *
 * Because the value is never read downstream, all existing golden snapshots are byte-identical
 * after this task (no golden movement is the correctness signal, verified by `npm test`).
 */
import { describe, it, expect } from 'vitest';
import { CombatActor } from '../state';
import {
    runCombat,
    CombatEngineInput,
    buildEnemyPlayerActorRuntime,
    EnemyActorInput,
} from '../engine';
import { createStatusEngine } from '../statusEngine';
import { deriveTeamEngineActors } from '../../calculators/dpsSimulator';
import { ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff, TeamActorInput } from '../../../types/calculator';

// ── Shared fixtures ────────────────────────────────────────────────────────────

const TEAM_SKILLS = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'team-basic',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100, hits: 1 },
                },
            ],
        },
    ],
});

const baseEngineInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 10000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 10,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    enemyDefense: 5000,
    enemyHp: 300000,
    numRounds: 2,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 6000,
    hp: 30000,
    ...overrides,
});

// ── H1 Task 2 — shieldPenetration threading ───────────────────────────────────

describe('H1 Task 2 — shieldPenetration on every actor', () => {
    // (a) Focus attacker actor carries shieldPenetration from CombatEngineInput.shieldPenetration.
    it('focus attacker carries shieldPenetration from top-level input', () => {
        let captured: CombatActor[] = [];
        runCombat(
            baseEngineInput({
                shieldPenetration: 30,
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );
        const attacker = captured.find((a) => a.id === 'attacker');
        expect(attacker?.stats.shieldPenetration).toBe(30);
    });

    // (b) Focus attacker defaults to 0 when shieldPenetration is omitted.
    it('focus attacker defaults shieldPenetration to 0 when omitted', () => {
        let captured: CombatActor[] = [];
        runCombat(
            baseEngineInput({
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );
        const attacker = captured.find((a) => a.id === 'attacker');
        expect(attacker?.stats.shieldPenetration).toBe(0);
    });

    // (c) Walked-team actor carries shieldPenetration from its walk.stats (CombatStatBlock).
    it('walked-team actor carries shieldPenetration from its walk bundle', () => {
        const teamActors: TeamActorInput[] = [
            {
                id: 'team1',
                speed: 90,
                selfBuffs: [],
                enemyDebuffs: [],
                chargeCount: 0,
                startCharged: false,
                shipSkills: TEAM_SKILLS(),
                stats: {
                    attack: 4000,
                    crit: 10,
                    critDamage: 50,
                    defensePenetration: 0,
                    shieldPenetration: 15,
                    hacking: 175,
                    defence: 2000,
                    hp: 40000,
                },
            },
        ];
        const engineTeam = deriveTeamEngineActors(teamActors, undefined);
        // Walk bundle carries shieldPenetration from CombatStatBlock.shieldPenetration.
        expect(engineTeam?.[0].walk?.stats.shieldPenetration).toBe(15);

        let captured: CombatActor[] = [];
        runCombat(
            baseEngineInput({
                teamActors: engineTeam,
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );
        const team = captured.find((a) => a.id === 'team1');
        expect(team?.stats.shieldPenetration).toBe(15);
    });

    // (d) Enemy actor (buildEnemyPlayerActorRuntime) carries shieldPenetration from its stats.
    it('enemy actor carries shieldPenetration from EnemyActorInput.stats', () => {
        const statusEngine = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            landsTimedEnemyApplication: () => true,
        });
        const input: EnemyActorInput = {
            id: 'enemy-atk',
            stats: {
                attack: 5000,
                crit: 20,
                critDamage: 100,
                speed: 50,
                defence: 3000,
                hp: 50000,
                shieldPenetration: 25,
            },
            chargeCount: 0,
            startCharged: false,
        };
        const runtime = buildEnemyPlayerActorRuntime(input, {
            statusEngine,
            enemyIds: ['attacker'],
            enemyDebuffLookup: new Map<string, SelectedGameBuff[]>(),
        });
        expect(runtime.actor.stats.shieldPenetration).toBe(25);
    });

    // (e) Enemy actor defaults to 0 when shieldPenetration is omitted from its stats.
    it('enemy actor defaults shieldPenetration to 0 when omitted', () => {
        const statusEngine = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            landsTimedEnemyApplication: () => true,
        });
        const input: EnemyActorInput = {
            id: 'enemy-atk',
            stats: { attack: 5000, crit: 20, critDamage: 100, speed: 50 },
            chargeCount: 0,
            startCharged: false,
        };
        const runtime = buildEnemyPlayerActorRuntime(input, {
            statusEngine,
            enemyIds: ['attacker'],
            enemyDebuffLookup: new Map<string, SelectedGameBuff[]>(),
        });
        expect(runtime.actor.stats.shieldPenetration).toBe(0);
    });

    // (f) DPS dummy enemy always has shieldPenetration = 0 (it has no shield pen — indestructible punching bag).
    it('DPS dummy enemy always has shieldPenetration 0', () => {
        let captured: CombatActor[] = [];
        runCombat(
            baseEngineInput({
                shieldPenetration: 50, // focus pen must not bleed onto dummy enemy
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );
        const dummy = captured.find((a) => a.id === 'enemy');
        expect(dummy?.stats.shieldPenetration).toBe(0);
    });
});
