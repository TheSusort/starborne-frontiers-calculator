/**
 * Integration: enemy-targeted charge REMOVAL (Phase 0 Task 7).
 *
 * A `charge` ability whose target is an ENEMY ('enemy' | 'all-enemies') SUBTRACTS charges from
 * each opposing actor (floored at 0), skipping actors that are `chargeLossImmune`. Self/ally
 * targets keep the additive behaviour (unchanged). There is NO separate "charge-remove" type.
 *
 * Both application sites are exercised:
 *   - REACTIVE executor (triggers.ts executeIntent charge branch) — via a PLAYER `start-of-round`
 *     all-enemies charge ability, which is partitioned to the reactive drain (a live trigger),
 *     exactly like the Graphite start-of-round grant in allyChargeGrant.test.ts.
 *   - CAST path (playerTurn.ts runPlayerTurn charge step) — via a PLAYER `on-cast` all-enemies
 *     charge ability, which fires during the caster's own turn.
 *
 * Observable: the enemy team here is a single charged BURSTER seeded `chargeCount: 3,
 * startCharged: true` (→ charges == chargeCount == 3) so, left alone, it fires its big CHARGED
 * skill (400%) on its first turn. The PLAYER acts first (higher speed) and removes 2 of the
 * enemy's charges BEFORE the enemy acts → charges drop to 1 (< chargeCount) → the enemy fires
 * its small ACTIVE skill (50%) instead → far LESS incoming damage to the heal target. A control
 * whose charge ability is SELF-targeted (additive, no reach to the enemy) leaves the enemy at 3
 * → it bursts on turn 1 → MORE incoming. The strict inequality is the charge-removal signal.
 *
 * Floor-at-0: the enemy is seeded chargeCount 3, startCharged false, so it banks its first charge
 * on its own turn and reaches 1. A removal of 2 then floors it: max(0, 1 - 2) === 0 (no negative,
 * no crash). The test asserts remove-2 produces the SAME observable incoming as a remove-1 control
 * (both drive the single banked charge to 0) — proving over-removal floors at 0 without side
 * effects.
 *
 * Immunity: a chargeLossImmune burster seeded charges 3 — the removal is a no-op → it still
 * bursts on turn 1 → incoming EQUALS the self-target control (gate fully skips immune actors).
 */

import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { IntentExecContext } from '../triggers';
import type { CombatActor } from '../state';
import { createEventBus, type CombatEvent } from '../events';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ─── Direct-charge harness ────────────────────────────────────────────────────────
// The integration tests above infer enemy charge state INDIRECTLY (via incoming damage).
// The Phase-1 cases below assert the post-event enemy `charges` DIRECTLY by tapping the
// engine's live actor roster (`__testTapActors`) and reading the mutated CombatActor after
// the run. The tap hands out the SAME objects the engine mutates in place, so reading
// `actor.charges` post-run observes the final value.
const runAndTap = (input: CombatEngineInput): CombatActor[] => {
    let captured: CombatActor[] = [];
    runCombat({ ...input, __testTapActors: (actors) => (captured = actors) });
    return captured;
};
/** runAndTap with a forced round count — the on-cast cases read after a SINGLE player cast
 *  (numRounds 1), otherwise the player would re-cast the removal every round and stack drops. */
const runAndTapRounds = (input: CombatEngineInput, numRounds: number): CombatActor[] =>
    runAndTap({ ...input, numRounds });
const chargesOf = (actors: CombatActor[], id: string): number => {
    const a = actors.find((x) => x.id === id);
    if (!a) throw new Error(`no actor '${id}' in tapped roster`);
    return a.charges;
};

// ─── Ability fixtures ───────────────────────────────────────────────────────────

const enemyDamage = (multiplier: number, id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** A player charge ability with a configurable target + trigger (positive amount; the engine
 *  subtracts for enemy targets). */
const chargeAbility = (
    amount: number,
    target: Ability['target'],
    trigger: Ability['trigger'],
    id: string
): Ability => ({
    id,
    type: 'charge',
    target,
    trigger,
    conditions: [],
    config: { type: 'charge', amount },
});

// ─── Enemy fixtures ─────────────────────────────────────────────────────────────

/** A pure charged BURSTER. Seeded charges == chargeCount via startCharged → ready to fire its
 *  big CHARGED skill on its FIRST turn unless its charges are knocked below chargeCount first.
 *  Speed 40 → acts AFTER the player (speed 100). attack large so the burst is clearly visible. */
const chargedBurster = (opts: {
    chargeCount: number;
    startCharged: boolean;
    chargeLossImmune?: boolean;
}): EnemyAttacker => ({
    id: 'e-burster',
    stats: { attack: 5000, crit: 0, critDamage: 0, speed: 40 },
    chargeCount: opts.chargeCount,
    startCharged: opts.startCharged,
    ...(opts.chargeLossImmune ? { chargeLossImmune: true } : {}),
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [enemyDamage(50, 'eb-a')] },
            { slot: 'charged', abilities: [enemyDamage(400, 'eb-c')] },
        ],
    } as ShipSkills,
});

// ─── Player / engine input ────────────────────────────────────────────────────────

/** Player focus: a heal target that holds the charge ability under test. Speed 100 → acts
 *  BEFORE the enemy burster (speed 40), so the removal lands before the enemy's turn. Huge HP so
 *  the enemy's hits never destroy it (incoming stays observable across all rounds). */
const buildInput = (chargeAbilityUnderTest: Ability, enemy: EnemyAttacker): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [enemyDamage(50, 'p-a')] },
            { slot: 'passive', abilities: [chargeAbilityUnderTest] },
        ],
    },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 6,
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
    speed: 100,
    healTargetId: 'attacker',
    mode: 'healing',
    enemyAttackers: [enemy],
});

const totalIncoming = (r: ReturnType<typeof runCombat>): number =>
    r.healing!.rounds.reduce((sum, round) => sum + round.incomingDamage, 0);

// ─── Reactive-executor path (start-of-round all-enemies) ──────────────────────────

describe('enemy charge removal — reactive executor (start-of-round all-enemies)', () => {
    it('removes 2 of the enemy burster’s 3 charges → its turn-1 charged burst is suppressed', () => {
        // Removal of 2 (3 → 1 < chargeCount 3) → enemy fires its ACTIVE (50%), not its 400%
        // charged burst, on turn 1. Control: SAME ability but SELF-targeted (additive, no reach
        // to the enemy) → enemy stays at 3 → bursts on turn 1 → strictly MORE incoming.
        const removal = runCombat(
            buildInput(
                chargeAbility(2, 'all-enemies', 'start-of-round', 'p-remove'),
                chargedBurster({ chargeCount: 3, startCharged: true })
            )
        );
        const control = runCombat(
            buildInput(
                chargeAbility(2, 'self', 'start-of-round', 'p-self'),
                chargedBurster({ chargeCount: 3, startCharged: true })
            )
        );

        // Charge removal suppresses the enemy's turn-1 charged burst → strictly less incoming.
        expect(totalIncoming(removal)).toBeLessThan(totalIncoming(control));
    });

    it('floors at 0: removing 2 from a 1-charge enemy underflows cleanly (no negative, no crash)', () => {
        // Enemy seeded chargeCount 3, startCharged false → it banks 1 charge on its own turn,
        // reaching 1 (< chargeCount 3, so no burst either way). Removal amount 2 floors it:
        // max(0, 1 - 2) === 0. A remove-1 control drives the same single charge to 0. We assert
        // incoming is FINITE and EQUAL between remove-2 and remove-1 — over-removal floors at 0
        // without underflow, so the larger removal behaves no differently than remove-1.
        const remove2 = runCombat(
            buildInput(
                chargeAbility(2, 'all-enemies', 'start-of-round', 'p-r2'),
                chargedBurster({ chargeCount: 3, startCharged: false })
            )
        );
        const remove1 = runCombat(
            buildInput(
                chargeAbility(1, 'all-enemies', 'start-of-round', 'p-r1'),
                chargedBurster({ chargeCount: 3, startCharged: false })
            )
        );

        // Both runs complete with finite incoming; over-removal floors at 0 without underflow,
        // so the two runs deny the enemy its burst identically.
        expect(Number.isFinite(totalIncoming(remove2))).toBe(true);
        expect(totalIncoming(remove2)).toBe(totalIncoming(remove1));
    });

    it('skips a chargeLossImmune enemy → its burst is NOT suppressed (incoming == self-control)', () => {
        // Immune burster seeded charges 3 — removal is a no-op → it bursts on turn 1, exactly as
        // the self-target control (which never touches the enemy). Equal incoming → gate skipped.
        const removalVsImmune = runCombat(
            buildInput(
                chargeAbility(2, 'all-enemies', 'start-of-round', 'p-rm-imm'),
                chargedBurster({ chargeCount: 3, startCharged: true, chargeLossImmune: true })
            )
        );
        const selfControl = runCombat(
            buildInput(
                chargeAbility(2, 'self', 'start-of-round', 'p-self-imm'),
                chargedBurster({ chargeCount: 3, startCharged: true, chargeLossImmune: true })
            )
        );

        // Immune → removal no-op → identical incoming to the self-target control.
        expect(totalIncoming(removalVsImmune)).toBe(totalIncoming(selfControl));
    });
});

// ─── Cast path (on-cast all-enemies, fired during the player’s own turn) ──────────

describe('enemy charge removal — cast path (on-cast all-enemies)', () => {
    it('removes 2 of the enemy burster’s 3 charges on cast → turn-1 burst suppressed', () => {
        // on-cast routes through runPlayerTurn's charge step (the cast path). The player (speed
        // 100) casts before the enemy (speed 40) acts → removal lands first → burst suppressed.
        const removal = runCombat(
            buildInput(
                chargeAbility(2, 'all-enemies', 'on-cast', 'p-remove-cast'),
                chargedBurster({ chargeCount: 3, startCharged: true })
            )
        );
        const control = runCombat(
            buildInput(
                chargeAbility(2, 'self', 'on-cast', 'p-self-cast'),
                chargedBurster({ chargeCount: 3, startCharged: true })
            )
        );

        expect(totalIncoming(removal)).toBeLessThan(totalIncoming(control));
    });

    it('cast-path removal skips a chargeLossImmune enemy (incoming == self-control)', () => {
        const removalVsImmune = runCombat(
            buildInput(
                chargeAbility(2, 'all-enemies', 'on-cast', 'p-rm-cast-imm'),
                chargedBurster({ chargeCount: 3, startCharged: true, chargeLossImmune: true })
            )
        );
        const selfControl = runCombat(
            buildInput(
                chargeAbility(2, 'self', 'on-cast', 'p-self-cast-imm'),
                chargedBurster({ chargeCount: 3, startCharged: true, chargeLossImmune: true })
            )
        );

        expect(totalIncoming(removalVsImmune)).toBe(totalIncoming(selfControl));
    });
});

// ─── Phase 1: direct post-event charge assertions ────────────────────────────────
//
// These mirror the parsed charge-removal ABILITIES the orchestrator emits (Task 3):
//   { type:'charge', target:'enemy', trigger, config:{ amount }, everyNthEvent? }
// and assert the enemy's `charges` directly after the run (via the actor tap).
//
// The charge-HOLDER enemy below carries a chargeCount (so it is a valid removal target —
// removeEnemyCharges skips chargeCount-0 actors) but has NO charged-damage slot, so the
// engine derives hasChargedSkill === false. With hasChargedSkill false, advanceChargeCadence
// is a no-op on the enemy's own turn — its `charges` are NOT re-banked, so the seeded value
// minus the removal is exactly observable. (It still acts each turn via its active slot.)

const chargeHolder = (opts: {
    chargeCount: number;
    seeded: number; // charges to seed via startCharged (charges == chargeCount when true)
    chargeLossImmune?: boolean;
}): EnemyAttacker => ({
    id: 'e-holder',
    stats: { attack: 1, crit: 0, critDamage: 0, speed: 40 },
    chargeCount: opts.chargeCount,
    // startCharged seeds charges = chargeCount. We pick chargeCount === seeded so the
    // holder starts with exactly `seeded` charges and (no charged-damage slot →
    // hasChargedSkill false) never re-banks.
    startCharged: opts.seeded === opts.chargeCount && opts.seeded > 0,
    ...(opts.chargeLossImmune ? { chargeLossImmune: true } : {}),
    shipSkills: {
        // active-only: a tiny basic attack. No charged slot → hasChargedSkill false → cadence
        // never advances the holder's charges.
        slots: [{ slot: 'active', abilities: [enemyDamage(1, 'eh-a')] }],
    } as ShipSkills,
});

describe('enemy charge removal — direct post-event charges (on-cast, Opal-style)', () => {
    it('case 1: on-cast removal amount 2 against a 3-charge enemy → charges === 1', () => {
        // Opal-style: the player casts an on-cast enemy-targeted charge removal (amount 2).
        // The holder is seeded charges 3 and never re-banks → after ONE cast: 3 − 2 === 1.
        // numRounds 1 — a multi-round run would re-cast each round and stack the drop to 0.
        const actors = runAndTapRounds(
            buildInput(
                chargeAbility(2, 'enemy', 'on-cast', 'p-opal'),
                chargeHolder({ chargeCount: 3, seeded: 3 })
            ),
            1
        );
        expect(chargesOf(actors, 'e-holder')).toBe(1);
    });

    it('case 2: immunity no-op — chargeLossImmune holder keeps its 3 charges', () => {
        // Same removal, but the holder is chargeLossImmune → removeEnemyCharges skips it → 3.
        const actors = runAndTap(
            buildInput(
                chargeAbility(2, 'enemy', 'on-cast', 'p-opal-imm'),
                chargeHolder({ chargeCount: 3, seeded: 3, chargeLossImmune: true })
            )
        );
        expect(chargesOf(actors, 'e-holder')).toBe(3);
    });

    it('case 3: floor at 0 — removal amount 2 against a 1-charge enemy → charges === 0', () => {
        // Holder seeded chargeCount 1, charges 1; removal 2 floors: max(0, 1 − 2) === 0.
        const actors = runAndTapRounds(
            buildInput(
                chargeAbility(2, 'enemy', 'on-cast', 'p-opal-floor'),
                chargeHolder({ chargeCount: 1, seeded: 1 })
            ),
            1
        );
        expect(chargesOf(actors, 'e-holder')).toBe(0);
    });

    // Epic PR3 (#209 review follow-up): end-to-end proof that the Thresh-style enemy-type gate
    // on an enemy-targeted removal is actually CONSUMED by the engine's cast-path condition
    // gating — not just constructed by the parser. Same condition object shape
    // buildShipAbilities emits via toCondition('enemy-type', …).
    const gatedRemoval = (id: string): Ability => ({
        ...chargeAbility(2, 'enemy', 'on-cast', id),
        conditions: [{ subject: 'enemy-type', requiredEnemyType: 'Defender', derivable: true }],
    });

    it('case 5 (Thresh gate, match): enemy-type gate passes vs a Defender → charges 3 − 2 === 1', () => {
        const actors = runAndTapRounds(
            {
                ...buildInput(
                    gatedRemoval('p-thresh-hit'),
                    chargeHolder({ chargeCount: 3, seeded: 3 })
                ),
                enemyType: 'Defender',
            },
            1
        );
        expect(chargesOf(actors, 'e-holder')).toBe(1);
    });

    it('case 6 (Thresh gate, mismatch): gate fails vs an Attacker → removal suppressed, charges stay 3', () => {
        const actors = runAndTapRounds(
            {
                ...buildInput(
                    gatedRemoval('p-thresh-miss'),
                    chargeHolder({ chargeCount: 3, seeded: 3 })
                ),
                enemyType: 'Attacker',
            },
            1
        );
        expect(chargesOf(actors, 'e-holder')).toBe(3);
    });

    it('case 7 (Thresh gate, DPS default): no enemyType configured → gate reads 0 → removal suppressed', () => {
        const actors = runAndTapRounds(
            buildInput(gatedRemoval('p-thresh-unset'), chargeHolder({ chargeCount: 3, seeded: 3 })),
            1
        );
        expect(chargesOf(actors, 'e-holder')).toBe(3);
    });
});

// ─── Case 4: bomb-driven removal (Demolisher-style) ───────────────────────────────
//
// A player ship that applies a Bomb DoT (active slot) AND carries an on-bomb-detonated
// enemy-targeted charge removal (amount 2). When the bomb detonates (bomb-detonated event,
// actorId 'attacker'), the reactive executor routes the removal through removeEnemyCharges
// (bulk all-opposing) → the holder's charges drop by 2.

describe('enemy charge removal — bomb-driven (Demolisher-style, on-bomb-detonated)', () => {
    const bombRemovalSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    enemyDamage(50, 'p-bomb-hit'),
                    {
                        id: 'p-bomb-dot',
                        type: 'dot',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'dot', dotType: 'bomb', tier: 10, stacks: 2, duration: 2 },
                    },
                ],
            },
            {
                slot: 'passive',
                abilities: [chargeAbility(2, 'enemy', 'on-bomb-detonated', 'p-demolisher')],
            },
        ],
    });

    it('case 4: a bomb detonation drops the enemy holder’s charges by 2 (bulk all-opposing)', () => {
        const input: CombatEngineInput = {
            ...buildInput(
                // The under-test ability slot from buildInput is unused (we override shipSkills).
                chargeAbility(0, 'self', 'on-cast', 'p-unused'),
                chargeHolder({ chargeCount: 5, seeded: 5 })
            ),
            shipSkills: bombRemovalSkills(),
            // Bomb applied round 1 (countdown 2) detonates on the enemy turn of round 2. A
            // 2-round run yields EXACTLY one detonation (the round-2 re-application would burst
            // in round 3, outside the window) → a single, deterministic removal.
            numRounds: 2,
        };

        // One run: a real bus records bomb-detonated events AND the actor tap captures the
        // mutated roster. Asserting BOTH on the same run proves the detonation drove the drop.
        const bus = createEventBus();
        const detonations: CombatEvent[] = [];
        bus.on('bomb-detonated', (e) => detonations.push(e));
        let captured: CombatActor[] = [];
        runCombat({ ...input, bus, __testTapActors: (actors) => (captured = actors) });

        expect(detonations.length).toBe(1); // exactly one bomb detonation in the window
        expect(detonations[0].type === 'bomb-detonated' && detonations[0].actorId).toBe('attacker');
        // Seeded 5; ONE detonation removes 2 (bulk all-opposing) → 3. The holder never re-banks
        // (no charged-damage slot → hasChargedSkill false).
        expect(chargesOf(captured, 'e-holder')).toBe(3);
    });
});

// ─── Team symmetry (epic PR3): an ENEMY-side ship removes PLAYER charges ──────────
//
// Every case above drives a PLAYER ability with target:'enemy' removing the AI enemy
// attacker's charges. `feedback_engine_team_symmetry` requires the reverse to work
// identically: an ENEMY ship's OWN charge-removal ability (also target:'enemy' — a
// charge ability's target is always relative to its OWNER's side) must decrement a
// PLAYER actor's charges. The engine wires this generically via `bySide(a.side)`
// (engine.ts), never a player-only closure, so this is a regression lock, not a new
// code path.

describe('enemy charge removal — team symmetry (ENEMY casts, PLAYER charges drop)', () => {
    it('an enemy on-cast removal of 2 drops the player holder’s 3 charges to 1', () => {
        // Player 'attacker' seeded with 3 charges (startCharged, hasChargedSkill:false so its
        // own turn never re-banks) at LOW speed (40) so the enemy (speed 100) acts first — the
        // removal lands before the player's own turn.
        const enemy: EnemyAttacker = {
            id: 'e-remover',
            stats: { attack: 1, crit: 0, critDamage: 0, speed: 100 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            enemyDamage(1, 'er-a'),
                            chargeAbility(2, 'enemy', 'on-cast', 'er-remove'),
                        ],
                    },
                ],
            } as ShipSkills,
        };
        const input: CombatEngineInput = {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 3,
            // No charged slot + hasChargedSkill:false → advanceChargeCadence never re-banks the
            // player's own charges on its turn (mirrors the `chargeHolder` fixture above), so the
            // seeded value minus the enemy's removal is exactly observable.
            shipSkills: {
                slots: [{ slot: 'active', abilities: [enemyDamage(1, 'p-a')] }],
            },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: true,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 40,
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [enemy],
        };

        const actors = runAndTap(input);
        expect(chargesOf(actors, 'attacker')).toBe(1);
    });

    it('floors at 0 and is a no-op against a chargeLossImmune player holder (mirrors the player→enemy cases)', () => {
        const enemy: EnemyAttacker = {
            id: 'e-remover-2',
            stats: { attack: 1, crit: 0, critDamage: 0, speed: 100 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            enemyDamage(1, 'er2-a'),
                            chargeAbility(5, 'enemy', 'on-cast', 'er2-remove'),
                        ],
                    },
                ],
            } as ShipSkills,
        };
        const baseInput: CombatEngineInput = {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 3,
            // No charged slot + hasChargedSkill:false → advanceChargeCadence never re-banks the
            // player's own charges on its turn (mirrors the `chargeHolder` fixture above), so the
            // seeded value minus the enemy's removal is exactly observable.
            shipSkills: {
                slots: [{ slot: 'active', abilities: [enemyDamage(1, 'p-a')] }],
            },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: true,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 40,
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [enemy],
        };

        // Floor: removal amount 5 against a 3-charge holder floors at max(0, 3-5) === 0.
        const floored = runAndTap(baseInput);
        expect(chargesOf(floored, 'attacker')).toBe(0);

        // Immunity: chargeLossImmune player holder is untouched by the same removal.
        const immune = runAndTap({ ...baseInput, chargeLossImmune: true });
        expect(chargesOf(immune, 'attacker')).toBe(3);
    });
});

// ─── Type shape assertions ───────────────────────────────────────────────────────

it('IntentExecContext exposes removeChargesFrom (single-target removal)', () => {
    const fn: IntentExecContext['removeChargesFrom'] = (_targetId: string, _amount: number) => {};
    expect(typeof fn).toBe('function');
});

it('Ability accepts everyNthEvent (every-Nth-event gate)', () => {
    const a: Ability = {
        id: 't',
        type: 'charge',
        target: 'enemy',
        trigger: 'on-enemy-repaired',
        conditions: [],
        everyNthEvent: 2,
        config: { type: 'charge', amount: 1 },
    };
    expect(a.everyNthEvent).toBe(2);
});
