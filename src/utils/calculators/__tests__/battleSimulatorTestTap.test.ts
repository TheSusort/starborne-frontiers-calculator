/**
 * `BattleSimulationInput.__testTapActors` — the test-only seam that lets a fixture set initial
 * actor state (`shieldPool`, `currentHp`) that BattlePlacement/statOverrides cannot express.
 * Forwarded verbatim to the engine's own tap; consumed by the real-kit fingerprint scenarios.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, type BattlePlacement, type BattleResult } from '../battleSimulator';
import { runSeededBattle } from '../../combat/audit/seededBattle';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../../combat/state';

const ship = (id: string): Ship =>
    ({
        id,
        name: id,
        type: 'ATTACKER',
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>90% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
        baseStats: {
            hp: 100_000,
            attack: 1000,
            defence: 0,
            hacking: 200,
            security: 100,
            crit: 0,
            critDamage: 150,
            speed: 100,
        },
    }) as unknown as Ship;

const placement = (s: Ship, position: Position): BattlePlacement => ({
    ship: s,
    position,
    statOverrides: {
        attack: s.baseStats.attack,
        crit: s.baseStats.crit,
        critDamage: s.baseStats.critDamage,
        defensePenetration: 0,
        hacking: s.baseStats.hacking,
        security: s.baseStats.security,
        defence: s.baseStats.defence,
        hp: s.baseStats.hp,
        speed: s.baseStats.speed,
    },
});

const input = (tap?: (actors: CombatActor[]) => void, rounds = 1) => ({
    playerTeam: [placement(ship('p1'), 'M4' as Position)],
    enemyTeam: [placement(ship('e1'), 'M1' as Position)],
    rounds,
    ...(tap ? { __testTapActors: tap } : {}),
});

describe('simulateBattle __testTapActors forwarding', () => {
    it('hands the full roster to the tap exactly once', () => {
        let calls = 0;
        let ids: string[] = [];
        simulateBattle(
            input((actors) => {
                calls += 1;
                ids = actors.map((a) => a.id);
            })
        );
        expect(calls).toBe(1);
        // The roster is [team…, attacker, dummy enemy, enemy attackers…] (engine.ts allActors).
        expect(ids.length).toBeGreaterThanOrEqual(2);
        expect(ids).toContain('attacker');
    });

    it('seeds shieldPool that the battle then honours (the tap is not a no-op copy)', () => {
        // Proves the tap mutates the LIVE actors, not a detached array: a seeded pool must show up
        // as shield absorption when the enemy is hit. Without forwarding, this is 0.
        // NOTE vs. brief: `BattleResult.rounds` has no `perActorShield` map — that name belongs to
        // the engine's internal `RoundData` (consumed inside simulateBattle to build the per-actor
        // `shieldsAbsorbed`/`shieldGranted`/`currentShieldPool` fields on `ShipRoundState`, see
        // battleSimulator.ts's `BattleRound` / `ShipRoundState`). Reading the actual public shape
        // (`ships[].shieldsAbsorbed`) instead — same assertion intent, correct accessor.
        const seeded = simulateBattle(
            input((actors) => {
                for (const a of actors) if (a.side === 'enemy') a.shieldPool = 50_000;
            })
        );
        const absorbed = seeded.rounds
            .flatMap((r) => r.ships)
            .reduce((sum, s) => sum + s.shieldsAbsorbed, 0);
        expect(absorbed).toBeGreaterThan(0);
    });

    it('seeds currentHp that the battle then honours (proves the OTHER seeded field is live)', () => {
        // `shieldPool` seeding is proven above; the fingerprint scenarios also seed `currentHp`,
        // and nothing proved THAT reaches live combat — a tap that set a field the engine
        // recomputed at first use would leave the `wounded` scenario silently identical to `plain`.
        // Proof by lethality: the same 3-round battle the enemy comfortably survives at full HP
        // ends with it dead when the tap starts it at 1% HP.
        const control = runSeededBattle(input(undefined, 3), 4242);
        const seeded = runSeededBattle(
            input((actors) => {
                for (const a of actors) if (a.side === 'enemy') a.currentHp = a.stats.hp * 0.01;
            }, 3),
            4242
        );
        const enemyAlive = (r: BattleResult): boolean => {
            const last = r.rounds[r.rounds.length - 1];
            return last.ships.filter((s) => s.side === 'enemy').every((s) => s.alive);
        };
        expect(enemyAlive(control)).toBe(true);
        expect(enemyAlive(seeded)).toBe(false);
        expect(seeded.outcome.winner).toBe('player');
        // ...and the kill is EARLIER than the round cap, i.e. the seed shortened the fight rather
        // than the enemy dying anyway on the last round.
        expect(seeded.outcome.lastRound).toBeLessThan(control.outcome.lastRound);
    });

    it('is inert when absent: a no-op tap produces a byte-identical battle', () => {
        // `not.toThrow()` was near-tautological. The real claim is that the seam has no effect of
        // its own — every production caller omits it, so the tapped and untapped engines must agree
        // exactly. Both runs go through runSeededBattle under one seed so any difference is the
        // tap's, not the RNG's.
        const withoutTap = runSeededBattle(input(undefined, 3), 99);
        const withNoopTap = runSeededBattle(
            input(() => {
                /* no-op: read nothing, mutate nothing */
            }, 3),
            99
        );
        expect(withNoopTap).toEqual(withoutTap);
    });
});
