/**
 * Task 3 — OWN-TURN SELF-BUFF REPRIEVE: engine-level behavioral tests.
 *
 * Feature: a TIMED self-buff applied during a ship's OWN turn lasts through that ship's
 * NEXT turn (matching the game), instead of expiring one turn early. The status engine
 * stamps `appliedThisTurn` on a self-side timed write when the carrier is the active actor
 * (set by statusEngine.beginTurn at turn-started); decrementPlayer skips such an entry ONCE
 * (the reprieve) then decrements normally.
 *
 * These tests exercise the WHOLE engine (runCombat) — the proof that beginTurn is actually
 * wired into the turn loop at turn-started. The harness style mirrors decrementUnification.test.ts:
 * collect() taps buff-applied/buff-expired/debuff-applied via a bus, runCombat() is driven via
 * CombatEngineInput with Ability skill fixtures.
 *
 * KEY observable: the round of the FIRST buff-expired for a 1-turn self-buff applied on the
 * carrier's own turn.
 *   - WITHOUT the reprieve (pre-wiring): applied round 1, decremented at the SAME Post Turn
 *     (1 -> 0) -> expires ROUND 1.
 *   - WITH the reprieve (this task): applied round 1, skipped at round-1 Post Turn (reprieve),
 *     decremented at round-2 Post Turn (1 -> 0) -> expires ROUND 2. The buff is therefore
 *     active across TWO of the carrier's turns (round 1 and round 2).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

// ---------------------------------------------------------------------------
// Shared fixture helpers (mirrors decrementUnification.test.ts)
// ---------------------------------------------------------------------------

let idCounter = 0;

const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `br${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/** Active-slot skill that deals damage AND applies an N-turn self-buff each turn. */
const selfBuffSkills = (buffName: string, duration: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                ab({
                    type: 'buff',
                    target: 'self',
                    config: {
                        type: 'buff',
                        buffName,
                        parsedEffects: { attack: 10 },
                        stacks: 1,
                        isStackable: false,
                        duration,
                    },
                }),
            ],
        },
    ],
});

/** Active-slot damage-only skill so the turn always runs. */
const damageSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
        },
    ],
});

/** Collect buff/debuff lifecycle events from a runCombat call. */
const collect = (input: CombatEngineInput): CombatEvent[] => {
    idCounter = 0;
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = ['buff-applied', 'buff-expired', 'debuff-applied'];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};

/** Shared minimal DPS-mode base (no healTargetId). */
const dpsBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // SP-4b-2b: a real opponent. This is a DAMAGE fixture (5000 attack for up to 5 rounds) so it
    // takes the 10M-HP form; the 500k default is not a survival guarantee and a mid-sim death would
    // truncate the buff-lifecycle rounds this file counts. 0 lives on the roster entry's own
    // stats.defence (the fight-wide `enemyDefense` scalar it used to be kept in step with, always
    // inert positionally M6, was deleted in SP-4d).
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000, defence: 0 } }),
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: damageSkills(),
    numRounds: 5,
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
    hp: 100_000,
    ...overrides,
});

const expiredOf = (events: CombatEvent[], buffName: string, actorId: string) =>
    events.filter(
        (e): e is Extract<CombatEvent, { type: 'buff-expired' }> =>
            e.type === 'buff-expired' && e.buffName === buffName && e.actorId === actorId
    );

const appliedOf = (events: CombatEvent[], buffName: string, actorId: string) =>
    events.filter(
        (e): e is Extract<CombatEvent, { type: 'buff-applied' }> =>
            e.type === 'buff-applied' && e.buffName === buffName && e.actorId === actorId
    );

// ---------------------------------------------------------------------------
// Test 1 — focus path (Thresh-style): own-turn self-buff lives through next turn
// ---------------------------------------------------------------------------

describe('own-turn self-buff reprieve — focus actor', () => {
    /**
     * The focus 'attacker' fires its active skill each round, applying a 1-turn 'Attack Up'
     * to itself ON its own turn. With the reprieve wired in, that buff survives the round-1
     * Post Turn (reprieve) and first expires at the round-2 Post Turn -> active across the
     * carrier's round-1 AND round-2 turns.
     */
    it('a 1-turn self-buff applied on the carrier own turn is active in round 1 and expires round 2 (not round 1)', () => {
        const events = collect(
            dpsBase({
                shipSkills: selfBuffSkills('Attack Up', 1),
                numRounds: 4,
            })
        );

        // NON-VACUOUS: the self-buff is actually applied on round 1 (active on the round it lands).
        const applied = appliedOf(events, 'Attack Up', 'attacker');
        expect(applied.length).toBeGreaterThan(0);
        expect(applied.some((e) => e.round === 1)).toBe(true);

        const expired = expiredOf(events, 'Attack Up', 'attacker');
        // The buff was applied, so it must eventually expire within the run.
        expect(expired.length).toBeGreaterThan(0);

        // CORE ASSERTION: the FIRST expiry is round 2, NOT round 1. The buff applied on the
        // carrier's round-1 turn was reprieved at the round-1 Post Turn and only decremented to
        // 0 at the round-2 Post Turn — proving it stayed active across TWO of the carrier's turns.
        expect(expired[0].round).toBe(2);

        // Active in round 1: the buff was applied round 1 AND did NOT expire round 1.
        expect(expired.some((e) => e.round === 1)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Test 2 — team ability-path: a non-focus actor's own-turn self-buff also gets the reprieve
// ---------------------------------------------------------------------------

describe('own-turn self-buff reprieve — team (non-focus) actor, ability path', () => {
    /**
     * A team actor 't1' (faster than the focus so its turn-started fires with its own id as the
     * active carrier) self-applies a 1-turn 'Crit Up' via its ability slot on ITS own turn. The
     * reprieve must apply on t1's store (keyed by t1's real id) exactly as it does for the focus.
     *
     * This exercises the ability-status write path (applyTimedAbilityStatus) for a non-attacker
     * carrier — NOT the scheduled-buff path. The actor MUST carry a `walk` bundle so it runs the
     * full runPlayerTurn pipeline (a buff-only team actor gets an empty synthesized kit and its
     * shipSkills self-buffs would never fire).
     */
    const t1 = (): TeamActorEngineInput => ({
        id: 't1',
        speed: 150, // faster than the focus (default 100) -> acts first; carrier = 't1' at its turn
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: selfBuffSkills('Crit Up', 1),
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 200,
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
    });

    it("team actor's 1-turn ability self-buff is active round 1 and first expires round 2 (reprieve across two of its turns)", () => {
        const events = collect(
            dpsBase({
                shipSkills: damageSkills(), // focus does nothing buff-relevant
                numRounds: 4,
                teamActors: [t1()],
            })
        );

        // NON-VACUOUS: t1 applied the self-buff on round 1 under its own actor id.
        const applied = appliedOf(events, 'Crit Up', 't1');
        expect(applied.length).toBeGreaterThan(0);
        expect(applied.some((e) => e.round === 1)).toBe(true);

        const expired = expiredOf(events, 'Crit Up', 't1');
        expect(expired.length).toBeGreaterThan(0);

        // The reprieve applies to the team carrier exactly as to the focus: first expiry round 2.
        expect(expired[0].round).toBe(2);
        expect(expired.some((e) => e.round === 1)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Test 3 — negative control: enemy debuff lifetime is unchanged (no leak to the debuff path)
// ---------------------------------------------------------------------------

describe('own-turn reprieve does NOT leak to the enemy/debuff path (negative control)', () => {
    /**
     * NEGATIVE CONTROL choice (documented): a clean reactive off-turn SELF-buff is awkward to
     * stand up in this harness, so we use the harness-supported enemy-debuff path instead. A
     * scheduled enemy debuff is applied during the PLAYER's turn and decremented at the dummy
     * enemy's Post Turn via decrementEnemy — a code path the reprieve must NOT touch. Its
     * lifetime must be exactly what it was before the fix (decrementUnification Case 1 locks the
     * same scenario at round 2). The reprieve only stamps SELF-side timed writes whose carrier is
     * the active actor; enemy-side writes leave appliedThisTurn falsy and decrementEnemy never
     * consults it. This asserts the fix is correctly scoped.
     */
    it('a scheduled enemy debuff still expires on round 2 (decrementEnemy untouched by the reprieve)', () => {
        const debuff: SelectedGameBuff = {
            id: 'nd1',
            buffName: 'Def Down',
            stacks: 1,
            isStackable: false,
            parsedEffects: { defense: -20 },
            skillSource: 'charge',
            skillDuration: 2,
        };
        const events = collect(
            dpsBase({
                enemyDebuffs: [debuff],
                hasChargedSkill: true,
                startCharged: true,
                chargeCount: 99,
            })
        );

        const expired = expiredOf(events, 'Def Down', 'enemy');
        // The debuff expires exactly once, on round 2 — UNCHANGED from pre-reprieve behavior
        // (the attacker fires first applying the duration-2 debuff; the dummy enemy decrements
        // 2->1 in round 1 and 1->0 in round 2). If the reprieve leaked to the enemy path this
        // would shift to round 3.
        expect(expired).toHaveLength(1);
        expect(expired[0].round).toBe(2);
    });
});
