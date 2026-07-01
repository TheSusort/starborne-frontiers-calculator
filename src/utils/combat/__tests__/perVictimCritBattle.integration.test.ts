/**
 * Per-victim crit — end-to-end battle integration (per-victim crit, Task 3).
 *
 * Proves the FULL wiring: playerTurn builds a `rollVictimCrit(victimAffinity)` closure that
 * rolls the attacker's crit gate at THAT victim's affinity-capped rate, and the engine threads
 * it through `drivePositionalApply` into `applyPositionalDamage` so a COVERED AoE victim the
 * attacker is at an affinity DISADVANTAGE against crits less often than the ANCHOR.
 *
 * Fixture: one player AoE attacker (affinity CHEMICAL, base crit 100) fires
 * Pattern-Line-Range-1 targeting `front` — anchoring the front-most enemy (M4) and covering M3.
 *   - ANCHOR enemy (M4): affinity ANTIMATTER → NEUTRAL vs chemical → critCap 100, penalty 0 →
 *     effective crit rate = min(100, 100-0)/100 = 1.0 → ALWAYS crits.
 *   - COVERED enemy (M3): affinity THERMAL → thermal beats chemical → attacker DISADVANTAGED →
 *     critCap 75, penalty 25 → effective crit rate = min(75, 100-25)/100 = 0.75 → crits only on
 *     a draw < 0.75.
 *
 * A gate fires when `rng() < rate` (see rateAccumulator). With a constant scripted RNG of 0.9:
 *   - anchor rate 1.0 → 0.9 < 1.0 → CRITS.
 *   - covered rate 0.75 → 0.9 < 0.75 is FALSE → does NOT crit.
 *   - any crit:0 gate (rate 0) → never fires regardless.
 * So in the same AoE the anchor crits while the disadvantaged covered victim does not — exactly
 * the per-victim behaviour this task ships. Before wiring, the covered victim shared the anchor's
 * crit (both crit) → this test FAILS on the pre-wiring engine.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship, AffinityName } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { CombatLogTarget } from '../log/types';

const makeShip = (
    id: string,
    name: string,
    opts: { activeTarget: string; activePattern: string; affinity: AffinityName }
): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'Attacker',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: opts.affinity,
    // Single-hit 100% active damage skill so a real firing hit resolves per victim.
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: opts.activeTarget,
    activePattern: opts.activePattern,
});

const placement = (
    ship: Ship,
    position: Position,
    attack: number,
    hp: number,
    crit: number
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack,
        crit,
        critDamage: 100,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp,
    },
});

describe('per-victim crit — end-to-end battle (per-victim crit, Task 3)', () => {
    afterEach(() => resetRateGateRng());

    it('a covered victim the attacker is DISADVANTAGED against does NOT crit while the anchor does', () => {
        // Constant RNG 0.9: anchor (rate 1.0) crits; disadvantaged covered (rate 0.75) does not.
        setRateGateRng(() => 0.9);

        const result = simulateBattle({
            playerTeam: [
                // Player AoE attacker: chemical, base crit 100, fires Line-Range-1 at `front`.
                placement(
                    makeShip('p1', 'AoE Attacker', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Line-Range-1',
                        affinity: 'chemical',
                    }),
                    'M1',
                    5000,
                    1_000_000_000,
                    100
                ),
            ],
            enemyTeam: [
                // ANCHOR (front-most, M4): antimatter → neutral vs chemical → always crits.
                placement(
                    makeShip('e1', 'Anchor', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                        affinity: 'antimatter',
                    }),
                    'M4',
                    0,
                    1_000_000_000,
                    0
                ),
                // COVERED (M3): thermal → attacker chemical is DISADVANTAGED → cap 75, penalty 25.
                placement(
                    makeShip('e2', 'Covered', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                        affinity: 'thermal',
                    }),
                    'M3',
                    0,
                    1_000_000_000,
                    0
                ),
            ],
            rounds: 1,
        });

        // The player focus fires the AoE in round 1; grab its attack entry.
        const r1 = result.combatLog.find((r) => r.round === 1)!;
        expect(r1).toBeDefined();
        const attackerTurn = r1.turns.find((t) => t.actorId === 'attacker')!;
        expect(attackerTurn).toBeDefined();
        const attackEntry = attackerTurn.entries.find(
            (e) => e.kind === 'attack' && e.actorId === 'attacker'
        )!;
        expect(attackEntry).toBeDefined();

        const byId = new Map<string, CombatLogTarget>(
            attackEntry.targets.map((t) => [t.targetId, t])
        );
        const anchor = byId.get('e:e1:0');
        const covered = byId.get('e:e2:1');

        // Both AoE cells were struck (footprint genuinely covers both occupied cells).
        expect(anchor).toBeDefined();
        expect(covered).toBeDefined();

        // The heart of the task: same AoE, DIFFERENT crit outcomes per victim.
        // (`attacked` omits didCrit for a non-crit → the covered log target is falsy/undefined.)
        expect(anchor!.didCrit).toBe(true); // neutral anchor at rate 1.0 → crits
        expect(covered!.didCrit).toBeFalsy(); // disadvantaged covered at rate 0.75 → does NOT crit
    });

    it('control: when the covered victim is NEUTRAL too, it crits alongside the anchor (rules out a blanket suppression)', () => {
        // Same RNG 0.9 but the covered victim is ANTIMATTER (neutral, rate 1.0) → it MUST crit.
        // Proves the covered victim did not crit in the first case BECAUSE of its affinity
        // disadvantage, not because covered victims are simply never allowed to crit.
        setRateGateRng(() => 0.9);

        const result = simulateBattle({
            playerTeam: [
                placement(
                    makeShip('p1', 'AoE Attacker', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Line-Range-1',
                        affinity: 'chemical',
                    }),
                    'M1',
                    5000,
                    1_000_000_000,
                    100
                ),
            ],
            enemyTeam: [
                placement(
                    makeShip('e1', 'Anchor', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                        affinity: 'antimatter',
                    }),
                    'M4',
                    0,
                    1_000_000_000,
                    0
                ),
                placement(
                    makeShip('e2', 'Covered', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                        affinity: 'antimatter', // neutral this time
                    }),
                    'M3',
                    0,
                    1_000_000_000,
                    0
                ),
            ],
            rounds: 1,
        });

        const r1 = result.combatLog.find((r) => r.round === 1)!;
        const attackerTurn = r1.turns.find((t) => t.actorId === 'attacker')!;
        const attackEntry = attackerTurn.entries.find(
            (e) => e.kind === 'attack' && e.actorId === 'attacker'
        )!;
        const byId = new Map<string, CombatLogTarget>(
            attackEntry.targets.map((t) => [t.targetId, t])
        );
        expect(byId.get('e:e1:0')!.didCrit).toBe(true); // anchor crits
        expect(byId.get('e:e2:1')!.didCrit).toBe(true); // neutral covered ALSO crits
    });
});
