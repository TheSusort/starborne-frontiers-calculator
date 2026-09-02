/**
 * Phase 4b Task 10 — reactive death-triggered bridge (extra-action + charge).
 *
 * A death-triggered ability (Sokol/Liberator on-enemy-destroyed, Harvester on-ally-destroyed)
 * routes from its death listener through the executor's `extra-action` / `charge` branch
 * into the engine's `grantExtraAction` / `grantAllyCharges`. Dispatch path is set by death TIMING:
 *
 *  Path A — during-turn death: the death fires inside an actor's turn while the round-local queue
 *    is still walked → the per-turn drain (drain point (b), `inTurnLoop` true) dispatches the grant
 *    into the CURRENT round (same-round extra turn / same-round charge bump).
 *
 *  Path B — post-round death: a death reconciled AFTER the turn loop has no live queue, so an
 *    extra-action grant buffers as a cross-round pending grant landing at the START of round R+1.
 *
 * HISTORY (this file): Path B was previously exercised here via the DPS dummy enemy — the
 * dummy "died" post-round when its cumulative damage crossed `enemyHp`, emitting ship-destroyed
 * and triggering the player's on-enemy-destroyed reactive into the buffered cross-round grant.
 * PR5d made the dummy INDESTRUCTIBLE: it is a pure damage wall that never records destroyed, so
 * the dummy is no longer a death trigger (locked negatively by `indestructibleDeath.test.ts`).
 *
 * The on-enemy-destroyed BRIDGE itself is unchanged and still fires for a REAL enemy death. We
 * now exercise it the honest way: a positioned focus attacker with a parsed target + pattern lands
 * lethal damage on a positioned ENEMY ATTACKER during its turn (the same positional kill machinery
 * `positionalDamage.integration.test.ts` pins). That death fires DURING the focus turn → Path A
 * (same-round), so these tests now assert a SAME-round extra action / charge bump — mirroring the
 * Harvester on-ally-destroyed test below. (The old dummy-driven Path-B R+1 timing was an artifact
 * of the now-immortal dummy and is gone by design.)
 */
import { describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `rea${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Single-target target selection: the front-most enemy (origin-only footprint).
const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
// Origin-only pattern (Pattern-Base): hits exactly the anchored cell.
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A positioned, finite-HP enemy attacker with zero offense — a stationary damageable target.
// `hp` is sized to bracket the focus's firing-hit damage so it dies exactly when intended.
const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position,
    shipSkills: { slots: [] },
});

// A positioned focus attacker that lands a real, lethal positional hit on the enemy at M4.
// attack 5000 × 100% × 1 hit vs defence 0, no crit → firing-hit damage = 5000. Healing mode
// (healTargetId) is REQUIRED for the positioned enemy roster to be built (enemyAttackers require
// healTargetId), and the focus IS the heal target so no separate team actor is needed.
const positionalKillBase = (
    shipSkills: ShipSkills,
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills,
    // Dummy sink HP huge so the dummy is never even close to a (now impossible) death — the only
    // death in these runs is the positioned enemy attacker the focus kills.
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
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: frontTarget(),
    pattern: basePattern(),
    // One positioned enemy attacker at the focus's targeted cell (M4), HP 5000 → dies to the
    // 5000 firing-hit in round 1. Overridable per test.
    // TWO members, not one. The front dies to the round-1 firing hit — that is the
    // on-enemy-destroyed trigger these cases are about — and a survivor at the back keeps the kill
    // from WIPING the enemy side, which would end the match on that turn and take the granted
    // extra action (and rounds 2-4) with it. The survivor is 0-attack and effectively immortal
    // (1e9 HP vs a 5 000 hit), so later rounds still produce NO new kill and therefore no new
    // grant — which is exactly what the post-round-1 assertions claim.
    enemyAttackers: [
        enemyAt('enemy-front', 'M4', 5000),
        enemyAt('enemy-back', 'M1', 1_000_000_000),
    ],
    ...overrides,
});

describe('reactive death-triggered bridge', () => {
    // ── Path A: Sokol on-enemy-destroyed → SAME-round extra action (real enemy kill) ─────────
    // Sokol-style: plain 100% active + a passive extra-action gated on-enemy-destroyed, once per
    // round. The focus lands a lethal positional hit on the positioned enemy attacker DURING its
    // own turn → ship-destroyed fires while the round queue is still live → the on-enemy-destroyed
    // listener enqueues → the per-turn drain (Path A) splices the focus a same-round extra turn.
    const sokolSkills = (): ShipSkills => {
        idCounter = 0;
        return {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
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

    it('Sokol on-enemy-destroyed: SAME-round extra action when a real enemy dies mid-turn (Path A)', () => {
        const result = runCombat(positionalKillBase(sokolSkills()));

        // Round 1: the focus kills the positioned enemy during its turn → on-enemy-destroyed
        // splices ONE same-round extra action (oncePerRound caps it at one).
        expect(result.rounds[0].extraTurns).toBe(1);
        // Subsequent rounds: the enemy is already dead → no new kill → no new grant. (The
        // positional path whiffs against an all-dead roster, so no phantom re-trigger.)
        expect(result.rounds[1].extraTurns).toBeUndefined();
        expect(result.rounds[2].extraTurns).toBeUndefined();
        expect(result.rounds[3].extraTurns).toBeUndefined();
    });

    it('Sokol: NO extra action when the enemy survives the round (the trigger is the death)', () => {
        // Same skills, but the positioned enemy has HP above the firing-hit damage → it never
        // dies → on-enemy-destroyed never fires → no extra turn in any round. Isolates the grant
        // to the real enemy death (rules out an unrelated extra-turn source).
        const result = runCombat(
            positionalKillBase(sokolSkills(), {
                enemyAttackers: [enemyAt('enemy-front', 'M4', 1_000_000_000)],
            })
        );
        expect(result.rounds.some((rd) => rd.extraTurns !== undefined)).toBe(false);
    });

    // ── Path A: Liberator on-enemy-destroyed all-allies charge → SAME-round charge bump ──────
    // Liberator-style: a charge(all-allies) ability on-enemy-destroyed. When the real positioned
    // enemy dies during the focus turn, the per-turn drain applies the all-allies charge SAME-round
    // → the focus's own charge counter bumps beyond the baseline per-round cadence.
    it('Liberator on-enemy-destroyed all-allies charge bumps charges the round a real enemy dies', () => {
        idCounter = 0;
        const liberatorSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'charge',
                            target: 'all-allies',
                            trigger: 'on-enemy-destroyed',
                            oncePerRound: true,
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
            ],
        };
        // chargeCount 5 + hasChargedSkill so the charge gain is observable on the round row (not
        // capped to 0). The focus kills the positioned enemy in round 1 → the reactive all-allies
        // charge bumps the focus's own counter that same round.
        const result = runCombat(
            positionalKillBase(liberatorSkills, { chargeCount: 5, hasChargedSkill: true })
        );
        // Baseline: identical run but with ONLY the active damage ability (no reactive charge
        // passive). Its round-1 charges reflect only the chargeCount-5 cadence.
        const baseline = runCombat(
            positionalKillBase(
                {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                ab({
                                    type: 'damage',
                                    target: 'enemy',
                                    config: { type: 'damage', multiplier: 100 },
                                }),
                            ],
                        },
                    ],
                },
                { chargeCount: 5, hasChargedSkill: true }
            )
        );
        // Round 1: the enemy dies during the focus turn; the per-turn drain applies the all-allies
        // charge to the focus. The round-end `charges` field reflects the bumped counter — strictly
        // above the baseline per-round cadence.
        expect(result.rounds[0].charges).toBeGreaterThan(baseline.rounds[0].charges);
    });

    it('Liberator on-enemy-death charge fires when an ally kills, once per round (not killer-scoped)', () => {
        idCounter = 0;
        const liberatorSkills: ShipSkills = {
            slots: [
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'charge',
                            target: 'all-allies',
                            trigger: 'on-enemy-destroyed',
                            oncePerRound: true,
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
            ],
        };
        const killerWalk: TeamActorEngineInput = {
            id: 'killer',
            speed: 100,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position: 'M4',
            target: frontTarget(),
            pattern: basePattern(),
            walk: {
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                ab({
                                    type: 'damage',
                                    target: 'enemy',
                                    config: { type: 'damage', multiplier: 100 },
                                }),
                            ],
                        },
                    ],
                },
                stats: {
                    attack: 5000,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 100_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        };
        const withAllyKill = runCombat(
            positionalKillBase(liberatorSkills, {
                attack: 100,
                speed: 50,
                chargeCount: 4,
                hasChargedSkill: true,
                teamActors: [killerWalk],
            })
        );
        const noPassive = runCombat(
            positionalKillBase(
                { slots: [] },
                {
                    attack: 100,
                    speed: 50,
                    chargeCount: 4,
                    hasChargedSkill: true,
                    teamActors: [killerWalk],
                }
            )
        );
        expect(withAllyKill.rounds[0].charges).toBeGreaterThan(noPassive.rounds[0].charges);
    });
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
            hp: 100000,
            speed: 50, // focus acts after atk1 (100) but before t1 (10)
            healTargetId: 't1',
            mode: 'healing',
            // `t1` claims the front-middle cell explicitly. The normalization boundary
            // places every actor and synthesizes `atk1`'s missing targeting, so the victim is now
            // decided by board geometry — and with `t1` on its index-derived default (M3) the
            // auto-placed FOCUS would hold M4, win `front enemy`, and soak the 5000 on its 100000
            // HP. `t1` would never die and the on-ally-destroyed trigger would never fire. An
            // explicit placement beats the invented anchor, so the focus steps back and `t1` is the
            // front-most player again. Nothing in the extra-action or turn-order path changes.
            teamActors: [{ ...teamWalk('t1', 3000), position: 'M4' }],
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
