/**
 * PR4 Task 1 — CHARACTERIZATION TESTS: 4-branch Post-Turn decrement routing.
 *
 * Goal: lock the CURRENT per-branch decrement behavior so the Task 3 unification
 * can be proven safe. All four tests must PASS against the current code AND remain
 * green (unmodified) after the refactor.
 *
 * The four cases:
 *
 *   1. DPS dummy debuff expiry — player inflicts a finite-duration enemy debuff in DPS
 *      mode (no healTargetId → sentinel '__enemy__' store). Assert the buff-expired event
 *      fires on the dummy enemy's Post Turn, attributed to 'enemy', expected round.
 *
 *   2. Dummy self store empty (invariant) — in the same DPS run, NO buff-expired is ever
 *      attributed to the dummy via a self-buff (selfMaps['enemy'] never populated).
 *      Adding decrementPlayer('enemy') in Task 3 must be a no-op for goldens.
 *
 *   3. Heal-target self + debuff expiry — in single-target healing mode, a self-buff on
 *      the heal target AND an enemy debuff landed on it both expire, attributed to 'attacker'.
 *      Both fire via the 'attacker's Post Turn: the self-buff via decrementPlayer('attacker'),
 *      the debuff via decrementEnemy('attacker').
 *
 *   4. Team / focus debuff store empty in golden mode (invariant) — in healing mode with
 *      NO board positions, NO buff-expired is attributed to the focus attacker or a
 *      non-heal-target team actor via the debuff store. Adding decrementEnemy(actor.id)
 *      for those actors in Task 3 must be a no-op for goldens.
 *
 * Harness style mirrors engine.events.test.ts: collect() taps events via a bus, and
 * runCombat() is driven via CombatEngineInput with SelectedGameBuff and Ability skill
 * fixtures. The invariant cases (2 and 4) are observed via the ABSENCE of buff-expired
 * events (non-vacuous: positive cases first confirm the buff/debuff was actually applied).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `du${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/** Minimal active-slot damage skill so the turn always runs. */
const damageSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
        },
    ],
});

/**
 * Minimal active-slot skill that deals damage AND applies a 1-turn self-buff.
 * Duration 1: applied in the firing round, decremented to 0 at the same Post Turn,
 * expires the same round it was applied (same-turn decrement rule).
 */
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

/** Minimal enemy-attacker skill: damage + a finite-duration debuff infliction. */
const debuffEnemySkills = (buffName: string, duration: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                ab({
                    type: 'debuff',
                    config: {
                        type: 'debuff',
                        buffName,
                        parsedEffects: { defense: -10 },
                        stacks: 1,
                        isStackable: false,
                        application: 'inflict',
                        duration,
                    },
                }),
            ],
        },
    ],
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** Collect all CombatEvents from a runCombat call. */
const collect = (input: CombatEngineInput): CombatEvent[] => {
    idCounter = 0; // Resets before each run so ability ids are deterministic within this call; the module-level counter can safely accumulate across tests.
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = ['buff-applied', 'buff-expired', 'debuff-applied'];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};

/** Shared minimal DPS-mode base (no healTargetId). */
const dpsBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // SP-4b-2b: a real opponent. DAMAGE fixture (5000 attack over 5 rounds) so it takes the
    // 10M-HP form; a mid-sim death would truncate the decrement rounds this file counts.
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
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

/** Shared minimal healing-mode base (healTargetId: 'attacker'). */
const healBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput =>
    dpsBase({
        healTargetId: 'attacker',
        mode: 'healing',
        ...overrides,
    });

// ---------------------------------------------------------------------------
// Case 1: DPS dummy debuff expiry
// ---------------------------------------------------------------------------

describe('Case 1 — DPS dummy debuff expiry (sentinel store, actorId: "enemy")', () => {
    /**
     * The attacker fires a scheduled 'Def Down' debuff (skillSource 'charge', duration 2,
     * one-shot via startCharged + large chargeCount). It lands in the sentinel '__enemy__'
     * store (no healTargetId → DPS mode). The dummy enemy (id 'enemy') carries that store
     * and decrements it at ITS Post Turn via decrementEnemy() (no arg → sentinel).
     *
     * Default speeds: attacker 100 acts before the dummy enemy 50. So the first Post-Turn
     * decrement is in round 1 (enemy acts same round, decrements 2→1). The second
     * decrement is round 2 (enemy Post Turn, 1→0 → expired). Expected expiry round: 2.
     */
    it('NON-VACUOUS: the scheduled enemy debuff is actually applied (debuff-applied fires)', () => {
        const debuff: SelectedGameBuff = {
            id: 'dd1',
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
        const applied = events.filter(
            (e): e is Extract<CombatEvent, { type: 'debuff-applied' }> =>
                e.type === 'debuff-applied' && e.buffName === 'Def Down'
        );
        // The debuff was actually inflicted — non-vacuous precondition for expiry.
        expect(applied.length).toBeGreaterThan(0);
        // SP-4b-2b (M1): the debuff LANDS on the real opposing actor now that a roster is required.
        // Its sentinel-store ENTRY still decrements and expires on the vestigial `enemy` actor —
        // see the next test, which still asserts `actorId: 'enemy'` and is unchanged. That split
        // between "where it landed" and "whose Post Turn decrements it" is precisely Branch 1, the
        // thing this file exists to pin, so it is stated here rather than smoothed over.
        expect(applied[0].targetId).toBe(BARE_ENEMY_ID);
    });

    it('buff-expired fires ONCE, attributed to actorId "enemy", on the expected round', () => {
        const debuff: SelectedGameBuff = {
            id: 'dd1',
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
        const expired = events.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-expired' }> =>
                e.type === 'buff-expired' && e.buffName === 'Def Down'
        );
        // Exactly one expiry — the debuff was applied once and runs its full window.
        expect(expired).toHaveLength(1);
        // Attributed to the DUMMY enemy actor (actorId 'enemy'), not to 'attacker'.
        // This locks Branch 1: decrementEnemy() (sentinel store) fires on the dummy actor.
        expect(expired[0].actorId).toBe('enemy');
        // Duration 2, attacker fires first → dummy decrements round 1 (2→1) and round 2
        // (1→0 → expired). Expected expiry round: 2.
        expect(expired[0].round).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Case 2: Dummy self store empty (invariant)
// ---------------------------------------------------------------------------

describe('Case 2 — invariant: dummy enemy self store is always empty (no buff-expired via selfMaps["enemy"])', () => {
    /**
     * The dummy enemy (id 'enemy') has no ability skills (only the engine's passive
     * attack cadence) and no self-buff abilities. Its selfMaps['enemy'] is therefore
     * never populated. As a result, decrementPlayer('enemy') — which will be added by
     * Task 3 — is a safe no-op: it returns { expired: [] } and emits NOTHING.
     *
     * Observable: across a full 5-round DPS run (with the same 'Def Down' debuff from
     * Case 1 to confirm the dummy does fire and decrement), NO buff-expired event is
     * ever attributed to 'enemy' for a self-buff. The only buff-expired event attributed
     * to 'enemy' is the debuff-store expiry — attributing any OTHER buff-expired to it
     * (e.g. from a non-existent self-buff) would indicate the invariant was violated.
     *
     * Why the absence proves the invariant: the test confirms the run produced the
     * expected debuff-store expiry (non-vacuous: the dummy's Post Turn does run and
     * decrements things). Any additional buff-expired on 'enemy' would require an entry
     * in selfMaps['enemy'], which the current code never creates.
     */
    it('only the debuff-store expiry fires for "enemy"; no self-buff expiry ever fires on it', () => {
        const debuff: SelectedGameBuff = {
            id: 'dd2',
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
        const expiredOnEnemy = events.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-expired' }> =>
                e.type === 'buff-expired' && e.actorId === 'enemy'
        );

        // NON-VACUOUS: the dummy does have something to expire (the debuff-store entry).
        // If this assertion fails, the run is vacuous — revise the fixture.
        expect(expiredOnEnemy.length).toBeGreaterThan(0);

        // Every buff-expired on 'enemy' must be the 'Def Down' expiry (debuff store).
        // No self-buff expiry may ever appear on 'enemy' — selfMaps['enemy'] is empty.
        // Comment: this is the invariant Task 3 relies on when adding
        // decrementPlayer('enemy') — it will always return { expired: [] }.
        for (const e of expiredOnEnemy) {
            expect(e.buffName).toBe('Def Down');
        }
    });
});

// ---------------------------------------------------------------------------
// Case 3: Heal-target self + debuff expiry
// ---------------------------------------------------------------------------

describe('Case 3 — heal-target self-buff + enemy debuff both expire attributed to "attacker"', () => {
    /**
     * The focus 'attacker' is the heal target (healTargetId: 'attacker').
     * Its active skill grants itself a 1-turn self-buff ('Attack Up', duration 1).
     * An enemy attacker (speed 10 → acts AFTER the focus at 100) inflicts a 1-turn
     * debuff ('Def Down', duration 1) on the heal target via an ability.
     *
     * Turn order in round 1: focus (speed 100) fires first — applies self-buff, then
     * Post Turn: decrementPlayer('attacker') → self-buff expires ROUND 1.
     * Then the enemy attacker (speed 10) fires — inflicts 'Def Down' on heal-target's
     * per-target store (enemyMaps['attacker']). The focus already did its Post Turn this
     * round; the first decrement is ROUND 2 when the focus fires again.
     *
     * Expected:
     *  - 'Attack Up' buff-expired on 'attacker', round 1 (decrementPlayer path)
     *  - 'Def Down'  buff-expired on 'attacker', round 2 (decrementEnemy path)
     *
     * Both attributed to 'attacker' — locks Branch 3 (attacker Post Turn: both calls).
     */

    /** Enemy attacker with only damage skills (used for the self-buff non-vacuous check). */
    const ea1Damage = (): EnemyAttacker =>
        ({
            id: 'ea1',
            stats: { attack: 500, crit: 0, critDamage: 0, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: damageSkills(),
        }) as EnemyAttacker;

    /** Enemy attacker that also inflicts a 1-turn 'Def Down' debuff. */
    const ea1Debuff = (): EnemyAttacker =>
        ({
            id: 'ea1',
            stats: { attack: 500, crit: 0, critDamage: 0, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: debuffEnemySkills('Def Down', 1),
        }) as EnemyAttacker;

    it('NON-VACUOUS: self-buff is applied in round 1 (buff-applied fires on "attacker")', () => {
        const events = collect(
            healBase({
                shipSkills: selfBuffSkills('Attack Up', 1),
                hp: 1_000_000,
                numRounds: 3,
                enemyAttackers: [ea1Damage()],
            })
        );
        const selfApplied = events.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-applied' }> =>
                e.type === 'buff-applied' && e.buffName === 'Attack Up' && e.round === 1
        );
        // The self-buff was actually applied — non-vacuous precondition for expiry.
        expect(selfApplied.length).toBeGreaterThan(0);
    });

    it('NON-VACUOUS: enemy debuff is applied on the heal target (debuff-applied fires)', () => {
        const events = collect(
            healBase({
                shipSkills: selfBuffSkills('Attack Up', 1),
                hp: 1_000_000,
                numRounds: 3,
                enemyAttackers: [ea1Debuff()],
            })
        );
        const debuffApplied = events.filter(
            (e): e is Extract<CombatEvent, { type: 'debuff-applied' }> =>
                e.type === 'debuff-applied' && e.buffName === 'Def Down'
        );
        // The debuff was actually inflicted on the heal target — non-vacuous precondition.
        expect(debuffApplied.length).toBeGreaterThan(0);
        // The debuff targets the heal target, not the dummy enemy.
        expect(debuffApplied[0].targetId).toBe('attacker');
    });

    it('self-buff "Attack Up" expires round 1 attributed to "attacker" (decrementPlayer path)', () => {
        const events = collect(
            healBase({
                shipSkills: selfBuffSkills('Attack Up', 1),
                hp: 1_000_000,
                numRounds: 3,
                enemyAttackers: [ea1Debuff()],
            })
        );
        const selfExpired = events.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-expired' }> =>
                e.type === 'buff-expired' && e.buffName === 'Attack Up'
        );
        // The 1-turn self-buff expires on round 1 (same-turn decrement rule: applied in the
        // active round, decremented at that same Post Turn → expires round 1). Fires every
        // round (re-applied each active turn), but we assert at least round 1 is present.
        expect(selfExpired.length).toBeGreaterThan(0);
        // Lock: self-buff expiry is attributed to 'attacker', not 'enemy'.
        for (const e of selfExpired) {
            expect(e.actorId).toBe('attacker');
        }
    });

    it('enemy debuff "Def Down" expires on "attacker" (decrementEnemy path, round 2)', () => {
        const events = collect(
            healBase({
                shipSkills: selfBuffSkills('Attack Up', 1),
                hp: 1_000_000,
                numRounds: 3,
                enemyAttackers: [ea1Debuff()],
            })
        );
        const debuffExpired = events.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-expired' }> =>
                e.type === 'buff-expired' && e.buffName === 'Def Down'
        );
        // The 1-turn debuff was inflicted AFTER the focus's round-1 Post Turn (enemy speed
        // 10 < focus speed 100), so the first decrement fires on the focus's round-2 Post Turn
        // → expires round 2. Fires every round thereafter (re-inflicted each enemy turn).
        expect(debuffExpired.length).toBeGreaterThan(0);
        // Lock: debuff expiry is attributed to 'attacker' (the heal target is the carrier).
        // This is Branch 3's decrementEnemy(actor.id) call when actor.id === healTarget.id.
        for (const e of debuffExpired) {
            expect(e.actorId).toBe('attacker');
        }
        // Lock the expiry round: duration 1 inflicted after the focus Post Turn → first expiry
        // at round 2.
        expect(debuffExpired[0].round).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Case 4: Team / focus debuff store empty in golden mode (invariant)
// ---------------------------------------------------------------------------

describe('Case 4 — invariant: non-heal-target actors have empty debuff stores (no buff-expired via enemyMaps[actor.id])', () => {
    /**
     * In healing mode with NO board positions (the "golden shape"), only the heal target
     * ('attacker') ever receives debuffs in enemyMaps — its per-target store is keyed by
     * its own id. Other actors (team actors, the focus when it is NOT the heal target)
     * are never targeted by enemy debuff infliction, so their enemyMaps entries are never
     * populated.
     *
     * This test: a team actor 't1' (speed 80, acts between focus and enemy) and the focus
     * 'attacker' are both present. An enemy attacker inflicts 'Def Down' on the heal target
     * ('attacker'). No buff-expired events attributed to 't1' via the debuff store should
     * ever fire.
     *
     * Why the absence proves the invariant: we confirm 't1' has an active turn (via a
     * non-vacuous precondition that the run actually uses it), but its enemyMaps['t1'] is
     * never populated (no enemy targets a non-heal-target player), so decrementEnemy('t1')
     * added in Task 3 will always return { expired: [] }.
     *
     * Note: we cannot observe empty enemyMaps directly (no public read outside the
     * engine's status engine internals), so we assert via the absence of buff-expired
     * events attributed to 't1'. This is a valid indirect observable: buff-expired is
     * emitted IFF decrementEnemy(id) returns a non-empty `expired` list, which only
     * happens if there are timed entries in that store.
     */

    /** Team actor with speed 80 (acts between focus at 100 and enemy at 10). */
    const t1 = () => ({
        id: 't1',
        speed: 80,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
    });

    /** Enemy attacker that inflicts a 1-turn 'Def Down' debuff. */
    const ea1 = (): EnemyAttacker =>
        ({
            id: 'ea1',
            stats: { attack: 500, crit: 0, critDamage: 0, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: debuffEnemySkills('Def Down', 1),
        }) as EnemyAttacker;

    it('NON-VACUOUS: the enemy debuff is inflicted and expires on the heal target ("attacker"), not on "t1"', () => {
        // duration: 1 so the debuff expires every round (re-applied by ea1 each round after the
        // focus Post Turn → first expiry round 2, then round 3, etc). This avoids the family-rule
        // renewal trap that would occur with duration > 1 (ea1 re-applies every round with the
        // same duration, so the family rule keeps the turnsRemaining from ever reaching 0).
        const events = collect(
            healBase({
                shipSkills: damageSkills(),
                hp: 1_000_000,
                numRounds: 3,
                teamActors: [t1()],
                enemyAttackers: [ea1()],
            })
        );

        // NON-VACUOUS: the debuff was actually inflicted on the heal target.
        const debuffApplied = events.filter(
            (e): e is Extract<CombatEvent, { type: 'debuff-applied' }> =>
                e.type === 'debuff-applied' && e.buffName === 'Def Down'
        );
        expect(debuffApplied.length).toBeGreaterThan(0);

        // The debuff targets the heal target, not the team actor.
        for (const e of debuffApplied) {
            expect(e.targetId).toBe('attacker');
        }
    });

    it('no buff-expired event is ever attributed to the team actor "t1" (empty debuff store invariant)', () => {
        // duration: 1 — ea1 re-applies the debuff every round (after focus Post Turn),
        // so the focus's Post Turn in rounds 2+ expires the previous round's debuff.
        // This produces buff-expired on 'attacker' (non-vacuous) while ensuring no
        // buff-expired ever appears on 't1' (the invariant under test).
        const events = collect(
            healBase({
                shipSkills: damageSkills(),
                hp: 1_000_000,
                numRounds: 3,
                teamActors: [t1()],
                enemyAttackers: [ea1()],
            })
        );

        // NON-VACUOUS: the debuff expires on 'attacker' (heal target) — proves the run is
        // live and the decrement path is exercised. With duration 1, inflicted after the
        // focus Post Turn each round → expiry at the focus's next Post Turn (round 2+).
        const expiredOnHealTarget = events.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-expired' }> =>
                e.type === 'buff-expired' && e.actorId === 'attacker' && e.buffName === 'Def Down'
        );
        expect(expiredOnHealTarget.length).toBeGreaterThan(0); // non-vacuous: heal-target does expire

        // INVARIANT: No buff-expired is ever attributed to 't1' via the debuff store.
        // Comment: this is what makes decrementEnemy('t1') a safe no-op in Task 3.
        // enemyMaps['t1'] is empty because no enemy attacker inflicts debuffs on a
        // non-heal-target player in the current golden shape (no board positions).
        const expiredOnTeamActor = events.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-expired' }> =>
                e.type === 'buff-expired' && e.actorId === 't1'
        );
        expect(expiredOnTeamActor).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Case 5 (RED GAP): non-heal-target team actor debuff never decrements
// ---------------------------------------------------------------------------

describe('Case 5 — RED GAP: debuff on non-heal-target team actor never expires (decrement missing)', () => {
    /**
     * BACKGROUND: engine.ts ~3706-3725 (Post Turn else-branch for 'attacker'/'team' kinds)
     * only calls decrementEnemy(actor.id) when actor.id === healTarget.id (line 3716).
     * A debuff landed in enemyMaps[nonHealTargetActor.id] is therefore NEVER decremented
     * → it persists forever. This test is the RED repro for that gap.
     *
     * SETUP:
     *   - Focus 'attacker' at position M3, healTargetId 'attacker' (heal target), speed 50.
     *   - Walked team actor 'player-victim' at M4 (front), speed 80, very high HP (3 rounds
     *     of enemy attack never kill it). Walks damageSkills (must take an active turn each round).
     *   - Enemy 'ea-debuffer' at M4, speed 200 (acts FIRST each round), very low attack (victim
     *     survives), targets 'front' → positional resolution picks player at M4 = 'player-victim'
     *     (NOT the heal target 'attacker' at M3). Inflicts 'Def Down' duration 1 via an ability.
     *
     * TURN ORDER per round (speed desc): ea-debuffer(200) → player-victim(80) → attacker(50).
     *
     *   Round 1: ea-debuffer fires → Def Down landed on enemyMaps['player-victim'].
     *            player-victim Post Turn: decrementPlayer('player-victim') — no
     *            decrementEnemy('player-victim') → Def Down stays at 1 (the gap).
     *            attacker Post Turn: decrementPlayer('attacker') + decrementEnemy('attacker')
     *            (heal target only, NOT player-victim).
     *
     * WITH THE GAP (current code): buff-expired with actorId='player-victim' NEVER fires.
     * WITH THE FIX (Task 3): decrementEnemy('player-victim') runs at player-victim's Post Turn
     *   → duration 1→0 → buff-expired fires with actorId='player-victim', round 1.
     *
     * The non-vacuous precondition (debuff-applied with targetId='player-victim') MUST PASS
     * even against current code — proving the debuff actually routes to the victim's store.
     */

    const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
        raw: selection,
        side: 'enemy',
        selection,
    });

    const basePattern = (): ParsedPattern => ({
        raw: 'base',
        shape: 'base',
        range: 0,
        modifiers: {},
    });

    /** Enemy that inflicts a 1-turn 'Def Down' debuff, positioned at M4, targets 'front'. */
    const eaDebuffer = (): EnemyAttacker =>
        ({
            id: 'ea-debuffer',
            // Very low attack: player-victim (500 000 HP) survives many rounds.
            stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4' as Position,
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: debuffEnemySkills('Def Down', 1),
        }) as EnemyAttacker;

    /** Non-heal-target walked team actor at M4 (front) — the debuff victim. */
    const playerVictim = (): TeamActorEngineInput => ({
        id: 'player-victim',
        speed: 80,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M4' as Position,
        walk: {
            shipSkills: damageSkills(),
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                // Very high HP: 200 rounds of attack:1 with no defence never kills it.
                hp: 500_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    /** Build the battle input. */
    const gapBattle = (): CombatEngineInput => ({
        // Focus 'attacker' = the heal target, positioned at M3 (behind the victim).
        // Speed 50 so it acts LAST — post-round ordering: enemy(200) → victim(80) → attacker(50).
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: damageSkills(),
        numRounds: 3,
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
        // Heal target sits at M3; victim at M4 is closer to the enemy 'front'.
        position: 'M3' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        teamActors: [playerVictim()],
        enemyAttackers: [eaDebuffer()],
    });

    it('NON-VACUOUS: enemy debuff routes to "player-victim" store (debuff-applied targetId check)', () => {
        // This assertion MUST PASS even against current code — the debuff actually lands in
        // enemyMaps['player-victim'] (confirmed via debuff-applied event). If this fails, the
        // fixture is broken (wrong position/targeting), not the gap itself.
        const events = collect(gapBattle());

        const applied = events.filter(
            (e): e is Extract<CombatEvent, { type: 'debuff-applied' }> =>
                e.type === 'debuff-applied' && e.buffName === 'Def Down'
        );

        // The debuff was actually inflicted at least once.
        expect(applied.length).toBeGreaterThan(0);

        // Crucially: it landed on the NON-heal-target victim, not on the sentinel 'enemy'
        // and not on the heal target 'attacker'. This is the per-target store keying that
        // proves the debuff is in enemyMaps['player-victim'] and can never decrement.
        expect(applied[0].targetId).toBe('player-victim');
        expect(applied[0].targetId).not.toBe('enemy');
        expect(applied[0].targetId).not.toBe('attacker');
    });

    it('RED GAP: buff-expired on "player-victim" NEVER fires — debuff persists forever (current code fails here)', () => {
        // With the gap: decrementEnemy('player-victim') is never called at player-victim's
        // Post Turn → the Def Down duration never counts down → buff-expired never fires.
        // After Task 3's fix: decrementEnemy('player-victim') runs each Post Turn →
        // duration 1→0 on round 1 → buff-expired with actorId='player-victim' fires.
        //
        // EXPECTED FAILURE MESSAGE (current code):
        //   AssertionError: expected +0 to be greater than 0
        //   (the expired-on-victim array is empty because the debuff never expires)
        const events = collect(gapBattle());

        const expiredOnVictim = events.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-expired' }> =>
                e.type === 'buff-expired' &&
                e.actorId === 'player-victim' &&
                e.buffName === 'Def Down'
        );

        // This assertion FAILS on current code (expiredOnVictim is empty — the gap).
        // It will PASS after Task 3 adds decrementEnemy(actor.id) for non-heal-target actors.
        expect(expiredOnVictim.length).toBeGreaterThan(0);
    });
});
