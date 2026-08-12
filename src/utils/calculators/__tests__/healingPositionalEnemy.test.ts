/**
 * healingPositionalEnemy.test.ts — SP-3b Task 6.
 *
 * The healing calculator now fights a REAL, POSITIONED enemy roster instead of the dummy
 * punching bag (a fixed 10,000-defence / 1,000,000-HP sink that never died and never really
 * participated). Three properties only a positional run can satisfy:
 *
 *   1. a `basis:'damage-dealt'` rider scales off the REAL enemy's defence, so a tougher enemy
 *      repairs the healer less;
 *   2. an enemy that can DIE stops contributing incoming damage;
 *   3. the focus's damage is credited PER VICTIM against the real enemy id.
 *
 * (3) is the only non-silent proof the positional apply actually ran: with a target but no
 * pattern the cast still resolves onto the real enemy and still credits a plausible cumulative
 * damage number, while `perTargetDealt` comes back EMPTY (engine.ts:8344).
 */
import { describe, it, expect } from 'vitest';
import { simulateHealing, HealingSimulationInput, HealerStats } from '../healingEngineAdapter';
import { Ability, ShipSkills } from '../../../types/abilities';
import { parsePattern, parseTarget } from '../../targetingParser';

/** The engine keys the focus actor as `'attacker'`, never the page's ship id. */
const FOCUS_ID_IN_ENGINE = 'attacker';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sp3b_${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const HEALER: HealerStats = {
    hp: 50_000,
    attack: 10_000,
    defence: 2_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    healModifier: 0,
    hacking: 200,
    speed: 300,
};

/** A damage cast that also repairs 50% of the damage it dealt — the F7 rider path. */
const damageWithRider = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    target: 'enemy',
                    config: { type: 'damage', multiplier: 100 },
                }),
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 50, basis: 'damage-dealt' },
                }),
            ],
        },
    ],
});

const enemy = (id: string, defence: number, hp: number) => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, speed: 1, defence, hp, security: 100 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4' as const,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
});

const BASE = (o: Partial<HealingSimulationInput> = {}): HealingSimulationInput => ({
    healer: HEALER,
    chargeCount: 0,
    shipSkills: damageWithRider(),
    selfBuffs: [],
    healTargetId: 'healer',
    enemies: [enemy('enemy-1', 1_000, 500_000)],
    rounds: 1,
    healerPosition: 'M3',
    healerTargeting: {
        active: { target: parseTarget('front'), pattern: parsePattern('Pattern-Base') },
    },
    ...o,
});

describe('SP-3b: the healing calculator fights a real positioned enemy', () => {
    it("the damage-dealt rider bases off the REAL enemy's defence, not ENEMY_DEFENSE", () => {
        idc = 0;
        const low = simulateHealing(BASE({ enemies: [enemy('enemy-1', 1_000, 500_000)] }));
        const high = simulateHealing(BASE({ enemies: [enemy('enemy-1', 9_000, 500_000)] }));

        // Anti-vacuity: the two candidate bases must actually differ in this fixture, or the
        // assertion pins nothing. A tougher enemy takes less damage, so the rider repairs less.
        expect(low.summary.totalDirectHeal).toBeGreaterThan(0);
        expect(high.summary.totalDirectHeal).toBeGreaterThan(0);
        expect(low.summary.totalDirectHeal).not.toBe(high.summary.totalDirectHeal);
        expect(low.summary.totalDirectHeal).toBeGreaterThan(high.summary.totalDirectHeal);
    });

    it('a killable enemy stops contributing incoming damage', () => {
        idc = 0;
        // ⚠️ ANTI-VACUITY, load-bearing. The enemy must land at least one hit BEFORE dying, or
        // "no incoming damage after round 1" is trivially true and the test observes nothing.
        // Turn order is speed-driven, so the enemy is given speed 999 (> the healer's 300) to act
        // FIRST in round 1; it then dies to the healer's cast in that same round.
        // Window kept TIGHT (3 rounds): over a long window the focus kills everything and the
        // premise evaporates — SP-1's earned lesson.
        const glassCannon = {
            ...enemy('enemy-1', 0, 1),
            stats: {
                attack: 5_000,
                crit: 0,
                critDamage: 0,
                speed: 999,
                defence: 0,
                hp: 1,
                security: 100,
            },
        };
        const result = simulateHealing(BASE({ rounds: 3, enemies: [glassCannon] }));

        // Precondition: it DID hit in round 1. Without this the assertion below is vacuous.
        expect(result.rounds[0].incomingDamage).toBeGreaterThan(0);
        // And it died, so rounds 2-3 take nothing.
        const laterIncoming = result.rounds.slice(1).reduce((n, r) => n + r.incomingDamage, 0);
        expect(laterIncoming).toBe(0);
    });

    it('credits damage per-victim against the REAL enemy, not the legacy sink', () => {
        idc = 0;
        const result = simulateHealing(BASE());
        // A non-empty perTargetDealt is the positional-apply proof. Asserting the damage TOTAL
        // alone would pass even if the cast fell back to the legacy sink, because the legacy path
        // still credits a plausible cumulative number (SP-1's silent-failure lesson).
        const dealt = result.rounds[0].perTargetDealt;
        expect(dealt).toBeDefined();
        expect(Object.keys(dealt![FOCUS_ID_IN_ENGINE] ?? {})).toContain('enemy-1');
    });
});
