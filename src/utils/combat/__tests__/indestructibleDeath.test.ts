/**
 * PR5d Task 1 — characterization of the dummy-enemy death surface + behavior-change locks.
 *
 * TDD: this file changes NO production code. Two flavors of lock:
 *
 *  INVARIANT locks (GREEN now AND after Task 2): the dummy `enemy` sink (id 'enemy',
 *    kind 'enemy', indestructible:true) is a DAMAGE WALL. Its turn-skip is gated on
 *    `isDummyEnemy` (engine.ts ~2787 `!isDummyEnemy`), NOT on `destroyedRound`, so the dummy
 *    keeps running its post-0-HP turn bookkeeping (DoT ticks, decrements, turn-started/ended)
 *    whether or not it is recorded-destroyed. The engine "keeps hitting the dead dummy
 *    regardless": cumulative damage keeps rising and DoTs keep ticking AFTER its modeled HP
 *    hits 0. Task 2 gates ONLY the recordDestroyed/drains block on `!enemy.indestructible`; it
 *    must leave this damage/tick surface byte-identical. These locks pin that.
 *
 *  RED behavior-change locks (FAIL now → PASS after Task 2 gates the death path):
 *    - No dummy `ship-destroyed`: TODAY the post-round block (engine.ts ~3821) calls
 *      recordDestroyed(enemy) once the dummy's HP decline crosses enemyHp, emitting ONE
 *      ship-destroyed{actorId:'enemy'}. After Task 2 the dummy (indestructible) never records
 *      destroyed → no event. RED today (the event IS emitted).
 *    - No on-enemy-destroyed reaction against the dummy: TODAY the dummy's ship-destroyed +
 *      the post-emit drainIntents fire any player-side on-enemy-destroyed reactive (Sokol
 *      extra-action / Liberator all-allies charge). After Task 2 the dummy never dies → the
 *      reactive never fires against it. RED today (it fires).
 *
 * DPS mode: NO `healTargetId` is set (DPS-first fixture). Manual (non-positional) enemy
 * attackers are NOT needed — DPS mode drives the dummy purely via the focus attacker's damage.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `idd${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/** Plain 100% active damage skill — base turn damage == effective attack (defense 0). */
const activeDamageSkills = (): ShipSkills => {
    idCounter = 0;
    return {
        slots: [
            {
                slot: 'active',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
            },
        ],
    };
};

/** 100% active damage + an inferno DoT applied to the dummy on the active turn. */
const damagePlusInfernoSkills = (): ShipSkills => {
    idCounter = 0;
    return {
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ab({
                        type: 'dot',
                        target: 'enemy',
                        config: {
                            type: 'dot',
                            dotType: 'inferno',
                            tier: 100,
                            stacks: 1,
                            duration: 99,
                        },
                    }),
                ],
            },
        ],
    };
};

const dpsBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: activeDamageSkills(),
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 4,
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
    hp: 30_000,
    // NO healTargetId — DPS mode.
    ...overrides,
});

const run = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    const result = runCombat({ ...input, bus });
    return result;
};

describe('PR5d Task 1 — dummy-enemy death surface INVARIANT locks (GREEN now AND after Task 2)', () => {
    // The dummy's modeled HP reaches 0 within the rounds: attack 10000 × 100% → 10000 dmg/round;
    // enemyHp 10000 → 0 HP entering round 2. With numRounds 4 there are post-0 rounds to inspect.
    it('rawTotals baseline (captures the wall surface; must stay identical after Task 2)', () => {
        const result = run(dpsBase({ attack: 10000, enemyHp: 10000, numRounds: 4 }));
        // BASELINE: 10000 direct dmg per round × 4 rounds = 40000 cumulative direct. The dummy is
        // a WALL — it keeps taking the full 10000/round even after its modeled HP hits 0 in R2.
        expect(result.rawTotals).toEqual({
            direct: 40000,
            corrosion: 0,
            inferno: 0,
            detonation: 0,
            cumulative: 40000,
            totalSecondary: 0,
            totalConditional: 0,
            teamTotal: 0,
        });
    });

    it('dummy keeps accumulating direct damage in rounds AFTER its HP hits 0 (not skipped)', () => {
        const result = run(dpsBase({ attack: 10000, enemyHp: 10000, numRounds: 4 }));
        const rounds = result.rounds;

        // NON-VACUOUS: at least one round shows the dummy at 0% HP (entering that round).
        const zeroPctRounds = rounds.filter((rd) => rd.enemyHpPct === 0);
        expect(zeroPctRounds.length).toBeGreaterThan(0);

        // The first round entered at 0% HP — and EVERY subsequent round — still records the full
        // 10000 direct hit, and cumulativeDamage keeps strictly rising. The wall does not stop.
        for (const rd of zeroPctRounds) {
            expect(rd.directDamage).toBe(10000);
        }
        // cumulativeDamage rises monotonically across the post-0 rounds (10k, 20k, 30k, 40k ...).
        const firstZeroIdx = rounds.findIndex((rd) => rd.enemyHpPct === 0);
        for (let i = firstZeroIdx; i + 1 < rounds.length; i++) {
            expect(rounds[i + 1].cumulativeDamage).toBeGreaterThan(rounds[i].cumulativeDamage);
        }
    });

    it('dummy keeps TICKING DoTs in rounds AFTER its HP hits 0 (turn bookkeeping still runs)', () => {
        // Inferno applied round 1; it ticks at the dummy's own turn-start each subsequent round.
        // attack 10000 dies the dummy fast (enemyHp 10000 → 0 entering R2). The inferno keeps
        // ticking in the post-0 rounds — proof the dummy's turn (DoT bookkeeping) is NOT skipped.
        const result = run(
            dpsBase({
                attack: 10000,
                enemyHp: 10000,
                numRounds: 5,
                shipSkills: damagePlusInfernoSkills(),
            })
        );
        const rounds = result.rounds;

        // NON-VACUOUS: the dummy is at 0% HP in at least one round.
        expect(rounds.some((rd) => rd.enemyHpPct === 0)).toBe(true);

        // In rounds entered at 0% HP, the inferno DoT still deals damage (> 0). The dummy's
        // turn-start DoT tick ran despite its modeled HP being 0.
        const zeroPctRounds = rounds.filter((rd) => rd.enemyHpPct === 0);
        expect(zeroPctRounds.length).toBeGreaterThan(0);
        expect(zeroPctRounds.some((rd) => rd.infernoDamage > 0)).toBe(true);
        // And inferno is part of rawTotals (DoT total accumulated across all rounds incl. post-0).
        expect(result.rawTotals.inferno).toBeGreaterThan(0);
    });
});

describe('PR5d Task 1 — dummy death behavior-change locks (RED now → GREEN after Task 2)', () => {
    // RED LOCK 1: the dummy must NOT emit ship-destroyed. recordDestroyed is the SOLE emitter;
    // TODAY the post-round block calls it for the dummy once HP decline crosses enemyHp.
    it('no ship-destroyed event for the dummy enemy id "enemy"', () => {
        idCounter = 0;
        const bus = createEventBus();
        const shipDestroyed: { actorId: string; round: number }[] = [];
        bus.on('ship-destroyed', (e) => {
            shipDestroyed.push({ actorId: e.actorId, round: e.round });
        });

        runCombat({
            ...dpsBase({ attack: 10000, enemyHp: 10000, numRounds: 4 }),
            bus,
        });

        // RED today: the dummy emits exactly one ship-destroyed when its HP decline crosses enemyHp.
        expect(shipDestroyed.some((e) => e.actorId === 'enemy')).toBe(false);
    });

    // RED LOCK 2: a player-side on-enemy-destroyed extra-action reactive (Sokol-shape) must NOT
    // fire against the dummy. TODAY the dummy's ship-destroyed + post-emit drainIntents buffers a
    // cross-round extra-action grant that lands the round AFTER the dummy's HP crosses 0.
    it('no on-enemy-destroyed extra-action reaction fires against the dummy', () => {
        idCounter = 0;
        const sokolSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'extra-action',
                            target: 'self',
                            trigger: 'on-enemy-destroyed',
                            config: { type: 'extra-action', oncePerRound: true },
                        }),
                    ],
                },
            ],
        };

        // DEATH run: dummy dies (enemyHp 10000, 10000 dmg/round → 0 entering R2). Post-round-1 the
        // dummy's ship-destroyed buffers the on-enemy-destroyed extra-action grant → lands round 2.
        const death = run(
            dpsBase({ attack: 10000, enemyHp: 10000, numRounds: 4, shipSkills: sokolSkills })
        );

        // CONTROL: identical skills but the dummy NEVER dies (huge enemyHp). The on-enemy-destroyed
        // reactive can never fire → no round ever has an extra turn. This isolates the grant to the
        // dummy-death path (rules out an unrelated extra-turn source).
        const control = run(
            dpsBase({ attack: 10000, enemyHp: 10_000_000, numRounds: 4, shipSkills: sokolSkills })
        );

        // Control proves the only way to get an extra turn here is the dummy's death.
        expect(control.rounds.some((rd) => rd.extraTurns !== undefined)).toBe(false);

        // RED today: the dummy's death grants the focus a cross-round extra action → some round in
        // the DEATH run has extraTurns set. After Task 2 (dummy never dies) this stays false.
        expect(death.rounds.some((rd) => rd.extraTurns !== undefined)).toBe(false);
    });
});
