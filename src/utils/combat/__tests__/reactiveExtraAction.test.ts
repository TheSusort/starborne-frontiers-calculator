/**
 * Phase 4b Task 10 — reactive extra-action bridge.
 *
 * A death-triggered extra-action ability (Sokol on-enemy-destroyed, Harvester
 * on-ally-destroyed, Liberator on-enemy-destroyed) routes from its death listener
 * (Task 5) through the executor's `extra-action` branch into the engine's
 * `grantExtraAction`. Two dispatch paths, by death timing:
 *
 *  Path A — during-turn death (on-ally-destroyed): the death fires inside an actor's
 *    turn while the round-local queue is still walked → the grant splices into the
 *    CURRENT round (same-round extra turn).
 *  Path B — post-round enemy death (on-enemy-destroyed): the enemy is a cumulative-
 *    damage wall reconciled AFTER the turn loop. No live queue → the grant buffers as
 *    a cross-round pending grant, inserted at the START of the NEXT round's queue.
 *    Landing round = R+1 where R is the round the kill was registered.
 *
 * Tests assert the LANDING ROUND explicitly.
 */
import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `rea${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const BASE: DPSSimulationInput = {
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 10_000_000,
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    hacking: 0,
    enemySecurity: 0,
    defence: 0,
    hp: 30000,
};

describe('reactive extra-action bridge', () => {
    // ── Path B: Sokol on-enemy-destroyed → extra action in round R+1 ─────────
    // Sokol-style: plain 100% active + a passive extra-action gated on-enemy-destroyed,
    // once per round. attack=10000, defense=0 → base turn damage 10000.
    // enemyHp small enough to die in round 1 (10000 dmg/round kills 10000-HP enemy).
    // The enemy's death is reconciled POST-round-1; the on-enemy-destroyed extra-action
    // grant has no live queue this round → buffers and lands in round 2.
    const sokolSkills = (): ShipSkills => {
        idCounter = 0;
        return {
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
    };

    it('Sokol on-enemy-destroyed: gains ONE extra action in round R+1 (kill in R)', () => {
        const result = simulateDPS({
            ...BASE,
            rounds: 4,
            // 10000 dmg/round → enemy (10000 HP) dies at the end of round 1.
            enemyHp: 10000,
            shipSkills: sokolSkills(),
        });

        // Round 1: the kill is REGISTERED post-round (reconciliation). No live queue →
        // no extra turn this round. extraTurns undefined (legacy shape, single turn).
        expect(result.rounds[0].extraTurns).toBeUndefined();
        // Round 2 (R+1): the buffered grant is flushed into the queue → exactly ONE
        // extra action. The enemy dies once → the grant fires at most once.
        expect(result.rounds[1].extraTurns).toBe(1);
        // Round 3+: the buffer was already cleared at the R+1 flush, and the enemy is
        // already dead → no new grant is buffered → no further extra turns.
        expect(result.rounds[2].extraTurns).toBeUndefined();
        expect(result.rounds[3].extraTurns).toBeUndefined();
    });

    it('Sokol round 2 damage doubles (the extra action is a full turn)', () => {
        const result = simulateDPS({
            ...BASE,
            rounds: 3,
            enemyHp: 10000,
            shipSkills: sokolSkills(),
        });
        // Round 1: single 10000 turn. Round 2: two 10000 turns (base + extra) = 20000.
        expect(result.rounds[0].totalRoundDamage).toBe(10000);
        expect(result.rounds[1].totalRoundDamage).toBe(20000);
    });

    // ── Path B: Liberator all-allies charge drains immediately ───────────────
    // Liberator-style: a charge(all-allies) ability on-enemy-destroyed. The post-round
    // drainIntents (added after the enemy ship-destroyed emit) applies the charge the
    // round the enemy dies; charges carry into the next round. Self has chargeCount > 0
    // so the charge bumps the attacker's own charge counter.
    it('Liberator on-enemy-destroyed all-allies charge bumps charges the round the enemy dies', () => {
        idCounter = 0;
        const liberatorSkills: ShipSkills = {
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
                            type: 'charge',
                            target: 'all-allies',
                            trigger: 'on-enemy-destroyed',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
            ],
        };
        const result = simulateDPS({
            ...BASE,
            rounds: 3,
            // chargeCount 5 so the charge gain is observable on the round row (not capped to 0).
            chargeCount: 5,
            enemyHp: 10000,
            shipSkills: liberatorSkills,
        });
        // Baseline: identical run but with ONLY the active damage ability (no reactive
        // charge passive). Its round-1 charges reflect only the chargeCount 5 cadence.
        const baseline = simulateDPS({
            ...BASE,
            rounds: 3,
            chargeCount: 5,
            enemyHp: 10000,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        ],
                    },
                ],
            },
        });
        // Round 1: enemy dies post-round; the post-emit drainIntents applies the all-allies
        // charge to the attacker. The round-end `charges` field reflects the bumped counter.
        // The reactive charge must add beyond the baseline per-round cadence.
        expect(result.rounds[0].charges).toBeGreaterThan(baseline.rounds[0].charges);
    });

    // ── Path A: Harvester on-ally-destroyed → SAME-round extra action ────────
    // Path A fires when a death happens DURING a turn while the round queue is still walked.
    // In normal DPS the only death is the post-round enemy reconciliation (Path B); a PLAYER
    // ally dies mid-round only in HEALING mode, when an enemy attacker kills the heal target.
    // We drive that real path via runCombat with an enemy attacker, asserting the live-queue
    // splice (Path A) — proving the on-ally-destroyed wiring without a synthetic emit (the
    // engine's internal bus is not reachable by an external write-only tap).
    //
    // Setup: focus attacker 'attacker' = Harvester-style (on-ally-destroyed extra-action
    // passive), speed 50. Heal target 't1' (a team ally, low HP, speed 10). Enemy attacker
    // 'atk1' (speed 100, acts FIRST) deals lethal damage to t1 in round 1 → ship-destroyed t1
    // fires DURING atk1's turn → the focus's on-ally-destroyed listener enqueues → the per-turn
    // drain (point b) after atk1's turn splices the focus into the REMAINING queue → the focus
    // takes a SAME-round extra turn (extraTurns 1 in round 1).
    const harvesterEngineAb = (
        partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>
    ): Ability => ({
        id: `hea${++idCounter}`,
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        ...partial,
    });

    it('Harvester on-ally-destroyed: same-round extra action when an ally dies mid-round (Path A)', () => {
        idCounter = 0;
        const harvesterSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        harvesterEngineAb({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        harvesterEngineAb({
                            type: 'extra-action',
                            target: 'self',
                            trigger: 'on-ally-destroyed',
                            config: { type: 'extra-action', oncePerRound: true },
                        }),
                    ],
                },
            ],
        };

        const teamWalk = (id: string, hp: number): TeamActorEngineInput => ({
            id,
            speed: 10, // slowest → acts last; dies on atk1's earlier turn
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [] },
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp,
                },
                debuffLandingChance: 1,
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        });

        const input: CombatEngineInput = {
            attack: 10000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: harvesterSkills,
            enemyDefense: 0,
            enemyHp: 10_000_000, // dummy enemy never dies → no Path-B noise
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            debuffLandingChance: 1,
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 100000,
            speed: 50, // focus acts after atk1 (100) but before t1 (10)
            healTargetId: 't1',
            teamActors: [teamWalk('t1', 3000)],
            enemyAttackers: [
                {
                    id: 'atk1',
                    // 5000 dmg vs t1 hp 3000 → lethal in round 1.
                    stats: { attack: 5000, crit: 0, critDamage: 0, speed: 100 },
                    chargeCount: 0,
                    startCharged: false,
                },
            ],
        };

        const result = runCombat(input);

        // atk1 kills t1 mid-round → the focus's on-ally-destroyed extra-action splices into the
        // live queue → the focus takes a same-round extra turn (Path A). extraTurns 1 in round 1.
        expect(result.rounds[0].extraTurns).toBe(1);
        // Sanity: t1 actually died this round (otherwise the trigger never fired).
        expect(result.healing!.destroyedRound).toBe(1);
    });
});
