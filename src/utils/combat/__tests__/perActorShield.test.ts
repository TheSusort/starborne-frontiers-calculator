/**
 * Shield System H1 — Task 6: per-actor per-round shield data on RoundData.
 *
 * Each round's RoundData (the same object that already carries `perTargetDamage`) now also
 * carries `perActorShield?: Record<id, { granted, absorbed, pool }>`:
 *   - granted  = total shield actually added to the actor's pool THIS round (post-cap delta),
 *   - absorbed = shield drained by incoming damage THIS round (perActorIncoming.shieldAbsorbed),
 *   - pool     = the actor's live remaining shieldPool at end-of-round assembly.
 *
 * Both the granted accumulator and the incoming map are fresh PER ROUND (they mirror
 * `roundPerTargetDamage`/`perActorIncoming`), so `granted`/`absorbed` are this-round values,
 * never cumulative — pinned by the round-2 test below.
 *
 * Harness mirrors shieldAbsorption.test.ts: a focus actor that IS the heal target (tank),
 * carrying a self-shield skill, attacked by a manual enemy. The tank (speed 100) shields
 * BEFORE the enemy (speed 50) acts each round, so the grant + the absorb both land in round 1.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ps${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const healSkills = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const manualEnemy = (id: string, attack: number): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed: 50, shieldPenetration: 0 },
    chargeCount: 0,
    startCharged: false,
});

/** A self-shield skill granting `pct`% of the tank's HP as a shield pool. */
const selfShield = (pct: number) =>
    ab({ type: 'shield', target: 'self', config: { type: 'shield', pct, basis: 'hp' } });

// Tank = focus actor 'attacker', speed 100 (acts BEFORE the speed-50 enemy each round),
// defence 0 (intake == enemy attack), no crit anywhere → deterministic.
const TANK = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 1,
    speed: 100,
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
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

describe('H1 Task 6 — perActorShield on RoundData', () => {
    // Tank hp 10000, self-shield 100% → pool 10000 (capped at maxHp). Enemy attacks 3000,
    // defence 0 → 3000 incoming, pen 0 → fully absorbed by the shield. R1: tank shields first
    // (pool 0→10000), then enemy hits 3000 → pool 10000→7000, hp untouched.
    it('round 1 carries granted (the cast), absorbed (the hit), and post-absorb pool', () => {
        idCounter = 0;
        const result = runCombat(
            TANK({
                numRounds: 1,
                enemyAttackers: [manualEnemy('atk1', 3000)],
                shipSkills: healSkills([selfShield(100)]),
            })
        );

        const r1 = result.rounds[0];
        expect(r1.perActorShield).toBeDefined();
        const tank = r1.perActorShield!['attacker'];
        expect(tank).toBeDefined();

        // granted: 100% of 10000 max HP, post-cap (the pool starts at 0 → the full 10000 lands).
        expect(tank.granted).toBeCloseTo(10000, 6);
        // absorbed: the 3000 hit drained the shield (pen 0 → full absorb).
        expect(tank.absorbed).toBeCloseTo(3000, 6);
        // pool: remaining shield at end-of-round = 10000 granted − 3000 absorbed.
        expect(tank.pool).toBeCloseTo(7000, 6);
    });

    // Post-cap delta: a grant that exceeds the maxHP cap records only the portion that landed.
    // Tank hp 10000, self-shield 150% → raw 15000, capped to 10000 → granted is the 10000
    // actual increase, NOT the 15000 raw.
    it('granted is the post-cap delta, not the raw grant', () => {
        idCounter = 0;
        const result = runCombat(
            TANK({
                numRounds: 1,
                // No enemy hit → isolate the grant side.
                shipSkills: healSkills([selfShield(150)]),
            })
        );
        const tank = result.rounds[0].perActorShield!['attacker'];
        expect(tank.granted).toBeCloseTo(10000, 6); // capped at maxHp, not 15000
        expect(tank.absorbed).toBe(0);
        expect(tank.pool).toBeCloseTo(10000, 6);
    });

    // Per-round (not cumulative): the grant happens ONCE in round 1; round 2 sees the enemy
    // drain the carried pool. Round 2's `granted` must be 0 (no new cast) while `absorbed`
    // reflects ONLY that round's drain — proving both halves reset each round.
    it('granted and absorbed are per-round, not cumulative', () => {
        idCounter = 0;
        const result = runCombat(
            TANK({
                numRounds: 2,
                enemyAttackers: [manualEnemy('atk1', 3000)],
                // The 100%-of-HP self-shield re-fires each round; round 2's re-grant only tops the
                // drained pool back toward the cap (post-cap delta), so `granted` is this round's
                // top-up, never cumulative with round 1 — that's what this test pins.
                shipSkills: healSkills([selfShield(100)]),
            })
        );

        const r1 = result.rounds[0].perActorShield!['attacker'];
        const r2 = result.rounds[1].perActorShield!['attacker'];

        // R1: full grant + first 3000 drain → pool 7000.
        expect(r1.granted).toBeCloseTo(10000, 6);
        expect(r1.absorbed).toBeCloseTo(3000, 6);
        expect(r1.pool).toBeCloseTo(7000, 6);

        // R2: the re-cast tops the 7000 pool back UP toward the 10000 cap, so granted is the
        // post-cap delta of THIS round's top-up (3000), NOT cumulative with R1's 10000. The
        // enemy then drains another 3000 this round. Net pool: 7000 + 3000 − 3000 = 7000.
        expect(r2.granted).toBeCloseTo(3000, 6); // per-round top-up only, never 13000
        expect(r2.absorbed).toBeCloseTo(3000, 6); // this round's drain only, never 6000
        expect(r2.pool).toBeCloseTo(7000, 6);
    });
});
