import { describe, it, expect } from 'vitest';
import { createActor, CombatActor, ActorStats } from '../state';
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
import { bareEnemy } from '../__testutils__/bareRosterFixture';

describe('ActorStats — hacking/security', () => {
    it('carries hacking/security when supplied', () => {
        const a = createActor({
            id: 'x',
            side: 'player',
            kind: 'team',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                shieldPenetration: 0,
                defence: 0,
                hp: 1,
                speed: 50,
                hacking: 120,
                security: 80,
            },
        });
        expect(a.stats.hacking).toBe(120);
        expect(a.stats.security).toBe(80);
    });

    it('leaves hacking/security undefined when omitted (back-compat fixtures)', () => {
        const a = createActor({
            id: 'y',
            side: 'player',
            kind: 'team',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                shieldPenetration: 0,
                defence: 0,
                hp: 1,
                speed: 50,
            },
        });
        expect(a.stats.hacking).toBeUndefined();
        expect(a.stats.security).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Base hacking/security plumbed onto every combat actor.
// These bases flow ONLY into effectiveStatsOf.hacking/.security (no production
// reader until Task 4) — verified here at construction, never via goldens.
// ─────────────────────────────────────────────────────────────────────────────

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
    // Every run needs a real opponent. 5000 lives on the roster entry's own
    // `stats.defence` (the fight-wide `enemyDefense` scalar it used to be kept in step with,
    // always inert positionally M6/#11, was deleted in SP-4d) and the HP is raised to 10M so a
    // damaging team ship cannot kill it mid-sim. Nothing in this file asserts a damage magnitude —
    // these tests read stat plumbing off the actors via `__testTapActors`.
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000, defence: 5000 } }),
    attack: 10000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 10,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
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

describe('A2 Task 2 — base hacking/security on every actor', () => {
    // (a) Walked-team actor carries stats.security from its walk bundle. The walk bundle's
    //     `security` is threaded by deriveTeamEngineActors from CombatStatBlock.security.
    it('walked-team actor carries hacking + security from its walk bundle', () => {
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
                    hacking: 175,
                    defence: 2000,
                    hp: 40000,
                    security: 65,
                },
            },
        ];
        const engineTeam = deriveTeamEngineActors(teamActors, undefined);
        // The walk bundle must carry the security threaded from CombatStatBlock.security.
        expect(engineTeam?.[0].walk?.stats.security).toBe(65);
        expect(engineTeam?.[0].walk?.stats.hacking).toBe(175);

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
        expect(team?.stats.hacking).toBe(175);
        expect(team?.stats.security).toBe(65);
    });

    // (b) Enemy actor carries both hacking and security from its EnemyActorInput.stats.
    it('enemy actor carries hacking + security from EnemyActorInput.stats', () => {
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
                hacking: 222,
                security: 133,
            },
            chargeCount: 0,
            startCharged: false,
        };
        const runtime = buildEnemyPlayerActorRuntime(input, {
            statusEngine,
            enemyIds: ['attacker'],
            enemyDebuffLookup: new Map<string, SelectedGameBuff[]>(),
        });
        expect(runtime.actor.stats.hacking).toBe(222);
        expect(runtime.actor.stats.security).toBe(133);
    });

    // (c) SP-4c-2d DELETED a case here: 'DPS dummy enemy carries security = configured
    // enemySecurity'. It asserted that `input.enemySecurity` reached the dummy `enemy` actor's
    // `stats.security`. That actor is gone, and it was the ONLY consumer of `enemySecurity` —
    // SP-4d deleted the field (and `enemySpeed`/`enemyDefense`/`enemyHp`) from `CombatEngineInput`
    // entirely, so there is no plumbing left to pin. The real per-actor security plumbing is
    // covered by (a)/(b) above (focus + enemy attacker).

    // (d) Player attacker actor carries stats.hacking = configured hacking.
    it('player attacker actor carries hacking = configured hacking', () => {
        let captured: CombatActor[] = [];
        runCombat(
            baseEngineInput({
                hacking: 215,
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );
        const attacker = captured.find((a) => a.id === 'attacker');
        expect(attacker?.stats.hacking).toBe(215);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// turnsTaken + chargeLossImmune on CombatActor
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 0 Task 1 — turnsTaken + chargeLossImmune on CombatActor', () => {
    const baseStats: ActorStats = {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        shieldPenetration: 0,
        defence: 0,
        hp: 1,
        speed: 50,
    };

    it('createActor seeds turnsTaken to 0 and chargeLossImmune to false', () => {
        const a = createActor({
            id: 'x',
            side: 'player',
            kind: 'team',
            stats: baseStats,
        });
        expect(a.turnsTaken).toBe(0);
        expect(a.chargeLossImmune).toBe(false);
    });

    it('createActor honors chargeLossImmune passthrough', () => {
        const a = createActor({
            id: 'x',
            side: 'player',
            kind: 'team',
            stats: baseStats,
            chargeLossImmune: true,
        });
        expect(a.chargeLossImmune).toBe(true);
    });
});
