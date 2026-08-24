/**
 * counterReflectLog.integration.test.ts — Task 3: counter-attacks and reflects surface in the
 * combat log.
 *
 * Both mechanisms apply real mitigated damage (via `applyVictimDamage`) but, pre-fix, emit NO
 * `reactive-damage-performed` event, so the reaction is invisible in `combatLog` even though the
 * HP change is real. This mirrors the shipped Sentinel pattern
 * (sentinelReactionLog.integration.test.ts / reflectGearSet.integration.test.ts's combatLog #4
 * case): drive a real two-ship `simulateBattle`, flatten the resulting `combatLog`, and assert a
 * reactive `attack` entry is attributed to the REACTOR (counter owner / reflector), nested under
 * the TRIGGERING attacker's turn entry — not a top-level entry in the reactor's own turn.
 *
 * Non-vacuity: without the engine/trigger emit fix, `applyCounterAttack`/the reflect block still
 * apply real HP damage (proven via `totalDamageTaken` in the sibling suites), but no
 * `reactive-damage-performed` event fires, so these log-shape assertions are red.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import { Ship, AffinityName } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

const place = (
    ship: Ship,
    position: Position,
    overrides: Partial<BattlePlacement['statOverrides']> = {}
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp: 1_000_000,
        ...overrides,
    },
});

/** A ship that fires a single-hit 100% direct attack on the front enemy every turn. */
function makeAttacker(id: string, name: string, affinity: AffinityName): Ship {
    return {
        id,
        name,
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        affinity,
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        chargeSkillCharge: 0,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    } as Partial<Ship> as Ship;
}

/** Resolve a roster actorId by ship display name (the player focus is 'attacker'; others are
 *  slot-suffixed `p:<id>:<i>` / `e:<id>:<i>`, so match on the stable name instead). */
function actorIdByName(result: ReturnType<typeof simulateBattle>, name: string): string {
    return result.roster.find((r) => r.name === name)!.actorId;
}

// ---------------------------------------------------------------------------
// 3a: Counter-attack (Stalwart) — the counter owner's retaliation surfaces as a nested
// reactive `attack` entry under the attacking hero's turn.
// ---------------------------------------------------------------------------

const STALWART_P1 =
    'When this Unit is directly damaged as a primary target, it deals <unit-damage>30% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.';

/** A counter-bearing ship: a self-repair active (no offence) + Stalwart's on-attacked counter
 *  passive (verbatim, docs/ship-skills.csv). Refits [{},{},{},{}] make the refit-active first
 *  passive apply — the SAME fixture shape as reflectGearSet.integration.test.ts's combatLog #4
 *  case (which proves the co-located buff reaction nests correctly; this test adds the DAMAGE
 *  side of that same reaction). */
function makeCounterShip(id: string, name: string, affinity: AffinityName): Ship {
    return {
        id,
        name,
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [{}, {}, {}, {}],
        affinity,
        activeSkillText: 'This Unit repairs 30% of its Max HP.',
        firstPassiveSkillText: STALWART_P1,
        chargeSkillCharge: 0,
        activeTarget: 'allies',
        activePattern: 'Pattern-Base',
    } as Partial<Ship> as Ship;
}

describe('Counter-attacks surface in the combat log (real sim path)', () => {
    // Player focus 'hero' is a plain attacker; the ENEMY carries Stalwart's counter passive. Each
    // round hero directly hits the enemy (primary target) → the enemy's on-attacked counter fires
    // back at hero.
    const build = () =>
        simulateBattle({
            playerTeam: [place(makeAttacker('hero', 'Hero', 'thermal'), 'M4')],
            enemyTeam: [place(makeCounterShip('foe', 'Foe', 'antimatter'), 'M4')],
            rounds: 4,
        });

    it('surfaces a counter-attack as a nested reactive entry in the combat log', () => {
        const result = build();
        const counterOwnerId = actorIdByName(result, 'Foe');
        const heroId = actorIdByName(result, 'Hero');

        const flat = flattenCombatLog(result);
        const counterEntries = flat.filter(
            (e) => e.kind === 'attack' && e.actorId === counterOwnerId
        );
        expect(counterEntries.length).toBeGreaterThan(0);
        expect(counterEntries[0].targets[0].amount).toBeGreaterThan(0);
        expect(counterEntries[0].targets[0].targetId).toBe(heroId);

        // Nested under the attacking hero's turn — NOT a top-level entry anywhere.
        const topLevelCounterOccurrences = result.combatLog
            .flatMap((round) => round.turns.flatMap((turn) => turn.entries))
            .filter((entry) => entry.kind === 'attack' && entry.actorId === counterOwnerId);
        expect(topLevelCounterOccurrences).toHaveLength(0);

        const entriesWithCounterReaction = result.combatLog
            .flatMap((round) => round.turns.flatMap((turn) => turn.entries))
            .filter((entry) =>
                entry.reactions.some((re) => re.kind === 'attack' && re.actorId === counterOwnerId)
            );
        expect(entriesWithCounterReaction.length).toBeGreaterThan(0);
        // The trigger is the hero's OWN attack entry (not the reactor's own turn).
        expect(entriesWithCounterReaction[0].actorId).toBe(heroId);
    });
});

// ---------------------------------------------------------------------------
// 3b: Reflect (Nosorog / Reflect gear set) — the reflector's thorns hit surfaces as a nested
// reactive `attack` entry under the attacking enemy's turn.
// ---------------------------------------------------------------------------

/** Nosorog's verbatim reflect passive (docs/ship-skills.csv, Nosorog passive2/3). */
const NOSOROG_REFLECT =
    'This Unit reflects 40% of the Damage taken back to the enemy when directly damaged as a primary target.';

/** A NON-DAMAGING player Nosorog: self-repair active (never deals direct damage to the enemy, so
 *  any damage the enemy takes is PURELY reflected thorns) + the reflect passive on the R0 slot
 *  (no refits needed — firstPassiveSkillText applies at R0). */
function makeReflectNosorog(id: string, name: string, affinity: AffinityName): Ship {
    return {
        id,
        name,
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        affinity,
        activeSkillText: 'This Unit repairs 30% of its Max HP.',
        firstPassiveSkillText: NOSOROG_REFLECT,
        chargeSkillCharge: 0,
        activeTarget: 'allies',
        activePattern: 'Pattern-Base',
    } as Partial<Ship> as Ship;
}

describe('Reflects surface in the combat log (real sim path)', () => {
    // A player Nosorog reflector (front, M4) faces a real enemy attacker. Every enemy hit lands
    // on Nosorog (primary target) → the reflect passive bounces a mitigated hit back at the enemy.
    const build = () =>
        simulateBattle({
            playerTeam: [
                place(makeReflectNosorog('nosorog', 'Nosorog', 'thermal'), 'M4', {
                    hp: 1_000_000,
                    attack: 0,
                }),
            ],
            enemyTeam: [
                place(makeAttacker('foe', 'Foe', 'antimatter'), 'M4', {
                    hp: 1_000_000,
                    attack: 5000,
                }),
            ],
            rounds: 4,
        });

    it('surfaces a reflected hit as a nested reactive entry in the combat log', () => {
        const result = build();
        const nosorogId = actorIdByName(result, 'Nosorog');
        const foeId = actorIdByName(result, 'Foe');

        const flat = flattenCombatLog(result);
        const reflectEntries = flat.filter((e) => e.kind === 'attack' && e.actorId === nosorogId);
        expect(reflectEntries.length).toBeGreaterThan(0);
        expect(reflectEntries[0].targets[0].amount).toBeGreaterThan(0);
        expect(reflectEntries[0].targets[0].targetId).toBe(foeId);

        // Nested under the attacking enemy's turn — NOT a top-level entry anywhere.
        const topLevelReflectOccurrences = result.combatLog
            .flatMap((round) => round.turns.flatMap((turn) => turn.entries))
            .filter((entry) => entry.kind === 'attack' && entry.actorId === nosorogId);
        expect(topLevelReflectOccurrences).toHaveLength(0);

        const entriesWithReflectReaction = result.combatLog
            .flatMap((round) => round.turns.flatMap((turn) => turn.entries))
            .filter((entry) =>
                entry.reactions.some((re) => re.kind === 'attack' && re.actorId === nosorogId)
            );
        expect(entriesWithReflectReaction.length).toBeGreaterThan(0);
        // The trigger is the enemy's OWN attack entry (not the reflector's own turn).
        expect(entriesWithReflectReaction[0].actorId).toBe(foeId);
    });
});

// ---------------------------------------------------------------------------
// 3b regression — reflect must nest under the ATTACK entry, NOT a preceding
// non-reactive entry (charge-changed / self-buff) the attacker's active cast
// emits BEFORE the deferred positional apply.
//
// This is the case the reviewer used to prove the original buffer-based fix was
// wrong: the reflect fires inside applyVictimDamage DURING the enemy's positional
// apply, which happens AFTER runPlayerTurn emitted the enemy's self-charge-gain
// `charge-changed` (playerTurn ~2043) but BEFORE the engine's deferred
// `ability-performed`. A naive inline emit (or a "buffer only when the turn has no
// non-reactive entry yet" heuristic) nests the reflect under the charge-changed
// entry. The engine-defer fix buffers the reflect row through drivePositionalApply
// and flushes it right after emitDeferredAbilityPerformed, so it routes to the
// just-created attack entry. RED on the pre-fix code (inline emit) — the reflect
// nests under kind:'charge-changed'; GREEN after — it nests under kind:'attack'.
// ---------------------------------------------------------------------------

/** An enemy attacker whose ACTIVE deals 100% damage AND self-grants a charge (ungated), and which
 *  carries a charged skill (chargeSkillCharge 3) so `hasChargedSkill` is true → the self-charge
 *  gain fires and emits a `charge-changed` (reason 'manip') entry BEFORE the attack each active
 *  turn. chargeSkillCharge is set high enough that within the battle it never actually fires the
 *  charged skill, so every turn is an ACTIVE cast that both self-charges and deals the reflecting
 *  hit. */
function makeChargingAttacker(id: string, name: string, affinity: AffinityName): Ship {
    return {
        id,
        name,
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        affinity,
        activeSkillText:
            "This Unit deals <unit-damage>100% damage</unit-damage> and adds <unit-aid>1 charge</unit-aid> to it's Charged Skill.",
        chargeSkillText: 'This Unit deals <unit-damage>300% damage</unit-damage>.',
        chargeSkillCharge: 3,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    } as Partial<Ship> as Ship;
}

describe('Reflects nest under the attack, not a preceding charge/buff entry (regression)', () => {
    it('nests the reflect under the attacker attack entry even when the active self-grants charge first', () => {
        const result = simulateBattle({
            playerTeam: [
                place(makeReflectNosorog('nosorog', 'Nosorog', 'thermal'), 'M4', {
                    hp: 1_000_000,
                    attack: 0,
                }),
            ],
            enemyTeam: [
                place(makeChargingAttacker('foe', 'Foe', 'antimatter'), 'M4', {
                    hp: 1_000_000,
                    attack: 5000,
                }),
            ],
            rounds: 4,
        });
        const nosorogId = actorIdByName(result, 'Nosorog');
        const foeId = actorIdByName(result, 'Foe');

        // Non-vacuity: the enemy DID emit a charge-changed entry in its own turn (the exact
        // preceding non-reactive entry that the bug mis-nested the reflect under).
        const enemyTurnEntries = result.combatLog
            .flatMap((round) => round.turns.filter((t) => t.actorId === foeId))
            .flatMap((t) => t.entries);
        expect(enemyTurnEntries.some((e) => e.kind === 'charge-changed')).toBe(true);

        // The reflect reaction exists and is attributed to the reflector.
        const reflectReactions = enemyTurnEntries.flatMap((e) =>
            e.reactions.filter((re) => re.kind === 'attack' && re.actorId === nosorogId)
        );
        expect(reflectReactions.length).toBeGreaterThan(0);
        expect(reflectReactions[0].targets[0].amount).toBeGreaterThan(0);
        expect(reflectReactions[0].targets[0].targetId).toBe(foeId);

        // CORE OF THE FIX: every reflect reaction hangs off an ATTACK entry — NEVER off the
        // charge-changed (or any non-attack) entry that preceded the attack in the same turn.
        const triggersOfReflect = enemyTurnEntries.filter((e) =>
            e.reactions.some((re) => re.kind === 'attack' && re.actorId === nosorogId)
        );
        expect(triggersOfReflect.length).toBeGreaterThan(0);
        for (const trigger of triggersOfReflect) {
            expect(trigger.kind).toBe('attack');
            expect(trigger.actorId).toBe(foeId);
        }
        // And no charge-changed entry ever carries a reflect reaction.
        const chargeEntriesWithReflect = enemyTurnEntries.filter(
            (e) =>
                e.kind === 'charge-changed' &&
                e.reactions.some((re) => re.kind === 'attack' && re.actorId === nosorogId)
        );
        expect(chargeEntriesWithReflect).toHaveLength(0);
    });
});
