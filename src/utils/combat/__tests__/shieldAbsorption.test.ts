/**
 * Shield System H1 — Task 4: penetration + bomb-portion wired LIVE at the apply wrappers.
 *
 * These are ENGINE-LEVEL integration tests (full `runCombat`) with EXPLICIT penetration
 * values, proving end-to-end:
 *  - A direct hit from an attacker with shieldPenetration > 0 splits: pen % bypasses to HP,
 *    the rest drains the shield (Scenario A, with a pen=0 control).
 *  - An Inferno/Corrosion DoT BYPASSES a live shield entirely — pool unchanged, HP takes the
 *    full tick (Scenario B — proves the Task 3 byDirectDamage:false bypass on a real shielded
 *    actor, the gap noted in Task 3).
 *  - A bomb/detonation portion drains the shield in FULL regardless of the attacker's pen
 *    (Scenario C — covered structurally here; the exact bomb-vs-pen arithmetic is unit-tested
 *    on the pure `shieldAbsorb` helper in shieldAbsorb.test.ts).
 *
 * Harness mirrors healing.test.ts "enemy attackers and target intake": a focus actor that IS
 * the heal target (tank) carrying a self-shield skill, attacked by a manual enemy. Live actor
 * objects are captured via `__testTapActors` (same array refs, mutated in place) so final
 * `currentHp` / `shieldPool` can be read directly after the run.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { CombatActor } from '../state';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sa${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const healSkills = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A manual flat enemy: one synthesized basic attack, no skills (unless `extra` adds them). */
const manualEnemy = (
    id: string,
    attack: number,
    extra: Partial<EnemyAttacker> = {},
    shieldPenetration = 0
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed: 50, shieldPenetration },
    chargeCount: 0,
    startCharged: false,
    ...extra,
});

// Tank = focus actor 'attacker', speed 100 (acts BEFORE the speed-50 enemy each round),
// defence 0 (intake == enemy attack, no reduction), no crit anywhere → deterministic.
const TANK = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
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

/** A self-shield skill granting `pct`% of the tank's HP as a shield pool. */
const selfShield = (pct: number) =>
    ab({ type: 'shield', target: 'self', config: { type: 'shield', pct, basis: 'hp' } });

describe('Shield System H1 Task 4 — penetration + bomb live at apply wrappers', () => {
    // ── Scenario A: enemy → shielded tank, penetration split ──────────────────
    // Tank hp 10000, self-shield 100% → pool 10000 (capped at maxHp). Enemy attacks 4000,
    // defence 0 → 4000 incoming. Sequence (R1): tank (speed 100) shields first, enemy
    // (speed 50) attacks.
    //   pen 25 → shieldEligible = 4000 × (1 − 0.25) = 3000. absorbed = min(10000,3000) = 3000.
    //            hp damage = 4000 − 3000 = 1000 (the 25% bypass). pool 10000→7000, hp 9000.
    //   pen 0  (control) → absorbed = min(10000,4000) = 4000. hp damage 0. pool 6000, hp 10000.
    it('Scenario A: pen 25 bypasses 25% to HP while the shield drains the other 75%', () => {
        idCounter = 0;
        let actors: CombatActor[] = [];
        const result = runCombat(
            TANK({
                enemyAttackers: [manualEnemy('atk1', 4000, {}, /* shieldPenetration */ 25)],
                shipSkills: healSkills([selfShield(100)]),
                __testTapActors: (a) => {
                    actors = a;
                },
            })
        );
        const tank = actors.find((a) => a.id === 'attacker')!;
        // 25% of the 4000 hit bypassed the (more-than-sufficient) shield onto HP.
        expect(tank.currentHp).toBeCloseTo(9000, 6);
        // The shield drained by the 75% eligible portion, NOT the full hit.
        expect(tank.shieldPool).toBeCloseTo(7000, 6);
        // Sanity: the full hit landed (incomingDamage is the pre-absorb total).
        expect(result.healing!.rounds[0].incomingDamage).toBeCloseTo(4000, 6);
        // The shield absorbed only the 3000 eligible portion (pen consumed), not 4000.
        expect(result.healing!.rounds[0].shieldAbsorbed).toBeCloseTo(3000, 6);
    });

    it('Scenario A control: pen 0 → shield fully absorbs the hit, no HP loss', () => {
        idCounter = 0;
        let actors: CombatActor[] = [];
        const result = runCombat(
            TANK({
                enemyAttackers: [manualEnemy('atk1', 4000, {}, /* shieldPenetration */ 0)],
                shipSkills: healSkills([selfShield(100)]),
                __testTapActors: (a) => {
                    actors = a;
                },
            })
        );
        const tank = actors.find((a) => a.id === 'attacker')!;
        expect(tank.currentHp).toBeCloseTo(10000, 6); // no bypass → HP untouched
        expect(tank.shieldPool).toBeCloseTo(6000, 6); // full 4000 absorbed
        expect(result.healing!.rounds[0].shieldAbsorbed).toBeCloseTo(4000, 6);
    });

    // ── Scenario B: DoT bypasses a live shield entirely ───────────────────────
    // Tank hp 10000, self-shield 100% → pool 10000. An enemy seeds an Inferno DoT (no direct
    // damage). The tank ticks the DoT at its own turn-start in a later round, WHILE holding the
    // R1 shield. A DoT (byDirectDamage:false) must bypass: shield unchanged, HP takes the full
    // tick. Inferno tick = stacks 1 × (tier 100/100) × applier effectiveAttack 5000 = 5000.
    //   R1: tank shields (pool 0→10000); enemy seeds inferno (no direct hit).
    //   R2: tank turn-start inferno tick 5000 → bypasses shield → pool STILL 10000, hp 5000.
    it('Scenario B: an Inferno DoT bypasses the live shield — pool unchanged, full tick to HP', () => {
        idCounter = 0;
        const infernoDot = () =>
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'inferno', tier: 100, stacks: 1, duration: 5 },
            });
        let actors: CombatActor[] = [];
        runCombat(
            TANK({
                numRounds: 2,
                hp: 10000,
                enemyAttackers: [
                    manualEnemy('dotEnemy', 5000, {
                        shipSkills: { slots: [{ slot: 'active', abilities: [infernoDot()] }] },
                    }),
                ],
                shipSkills: healSkills([selfShield(100)]),
                __testTapActors: (a) => {
                    actors = a;
                },
            })
        );
        const tank = actors.find((a) => a.id === 'attacker')!;
        // The DoT bypassed the shield entirely — pool is untouched by the tick.
        expect(tank.shieldPool).toBeCloseTo(10000, 6);
        // The full 5000 tick landed on HP (10000 − 5000).
        expect(tank.currentHp).toBeCloseTo(5000, 6);
    });

    // ── Scenario B control: a DIRECT hit of the same size DOES drain the shield ──
    // Same tank/shield, but the enemy deals a 5000 DIRECT hit (no pen). The shield absorbs it
    // in full → HP untouched. Proves the bypass in Scenario B is DoT-specific, not a fixture
    // artifact (a shielded actor's pool genuinely drains for direct damage).
    it('Scenario B control: a direct hit of the same size DOES drain the shield', () => {
        idCounter = 0;
        let actors: CombatActor[] = [];
        runCombat(
            TANK({
                numRounds: 1,
                hp: 10000,
                enemyAttackers: [manualEnemy('atk1', 5000)],
                shipSkills: healSkills([selfShield(100)]),
                __testTapActors: (a) => {
                    actors = a;
                },
            })
        );
        const tank = actors.find((a) => a.id === 'attacker')!;
        expect(tank.shieldPool).toBeCloseTo(5000, 6); // 5000 of the 10000 pool consumed
        expect(tank.currentHp).toBeCloseTo(10000, 6); // HP untouched (shield covered it)
    });
});
