/**
 * SP-4c-2b: a REACTIVE infliction's landing roll is measured against the enemy it is actually
 * inflicting on — the applier's hacking vs THAT ship's security.
 *
 * THE GAME RULE (owner ruling): "An enemy shoots Flamel. Flamel's passive should inflict Speed Down
 * + Stasis on it." The roll is Flamel's hacking vs THAT ship's security. Not against a value cached
 * from an unrelated earlier turn, and not against nothing.
 *
 * WHAT WAS WRONG. Every reactive inflict already knew its victim (`debuffTargetId` / `victimId` in
 * triggers.ts) but drew its landing gate against `PlayerActorRuntime.liveDebuffLandingChance` — the
 * chance the owner computed on ITS OWN turn for ITS OWN turn target, published onto its runtime.
 * Two things were wrong with that, one latent and one acute:
 *   • LATENT: the reactive victim is usually not the cast target, so the roll was measured against
 *     the wrong ship's security. Measured across the 147-ship fingerprint corpus: 812 reactive
 *     debuff draws and 253 reactive DoT draws where the per-victim chance differs from the cached
 *     one, spreads as wide as 0.54 vs 1.0.
 *   • ACUTE: SP-4c-2b lets an ally-targeted cast resolve NO victim, and a no-victim turn's cast
 *     chance is 0 ("there is no enemy to beat"). Published, that 0 auto-resisted every reactive
 *     inflict its owner would ever make — measured on Flamel: 138 landings → 0, i.e. its shipped
 *     refit-active passive silently stopped working.
 *
 * WHY THIS FILE EXISTS AT ALL. The fix moved 812 + 253 real draws and moved ZERO golden snapshots,
 * because `realKitFingerprints` records a token SET and the affected ships already produced BOTH
 * `debuff` and `debuff-resisted` tokens — individual outcomes flip, the set does not. A behaviour
 * fix whose only evidence is "nothing moved" is the fixture-vacuity trap in its purest form, so the
 * rule gets its own two-armed test here.
 *
 * DRIVEN THROUGH `runCombat`, not through the delegate. A unit test that handed the executor two
 * different chances would only prove the executor prefers the argument it was given; it could not
 * prove the ENGINE resolves a real per-victim chance from real actors, which is the whole claim.
 * So the fixture puts two real enemies on the board, identical in every field except SECURITY, and
 * reads the outcome.
 *
 * DETERMINISTIC WITHOUT DEPENDING ON THE SEED. `liveDebuffLandingChance` is
 * `clamp(hacking×(1+affMod/100) − security, 0, 100)/100`, so security 0 ⇒ chance 1 (always lands)
 * and security ≥ hacking ⇒ chance 0 (never lands). Both arms sit at a SATURATED chance on purpose:
 * a future reseed cannot flip either assertion, and neither can a change to the gate's draw order.
 *
 * VERIFIED TWO-ARMED: with the fix reverted, cases 1 and 3 below go RED (case 2 stays green by
 * design — it only asserts that both enemies attacked, which is true either way, and exists so
 * case 1's "never lands on e-hard" can never pass because e-hard never showed up).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { damageKit } from '../__testutils__/bareRosterFixture';
import type { ShipSkills } from '../../../types/abilities';

const SOFT_ENEMY_ID = 'e-soft';
const HARD_ENEMY_ID = 'e-hard';
/** The focus's base hacking. Both arms are derived from it, so it appears once. */
const FOCUS_HACKING = 100;
/** `numRounds` for every run here. Named because the victimless-arm case asserts one inflict PER
 *  ROUND — see there for why the exact count, not merely a non-zero one, is the load-bearing claim. */
const ROUNDS = 6;

/**
 * The Flamel shape, reduced to its mechanism: a passive-slot reactive debuff that fires when this
 * unit is directly damaged and inflicts a timed debuff on whoever damaged it.
 *
 * `application: 'inflict'` is the load-bearing field — it is the arm that draws the
 * hacking-vs-security gate. The sibling `'apply'` arm resolves on affinity instead and was already
 * per-target (Task A); it is not what this file is about.
 */
const retaliatoryDebuffKit = (): ShipSkills => ({
    slots: [
        ...damageKit().slots,
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'retaliate',
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-attacked',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Speed Down I',
                        stacks: 1,
                        parsedEffects: { speed: -10 },
                        isStackable: false,
                        application: 'inflict',
                        duration: 2,
                    },
                },
            ],
        },
    ],
});

/**
 * Both enemies attack the focus every round and are identical APART FROM SECURITY, which is the
 * whole experiment: any outcome difference between them can only come from the security term.
 *
 * `hp` is huge and `attack` modest so neither side dies — a death would end the fight early
 * (SP-4c-1 ends it on the turn a side is wiped) and truncate the observation window.
 */
const twoEnemiesOfDifferentSecurity = (): CombatEngineInput['enemyAttackers'] =>
    [
        { id: SOFT_ENEMY_ID, security: 0 },
        { id: HARD_ENEMY_ID, security: FOCUS_HACKING },
    ].map(({ id, security }) => ({
        id,
        chargeCount: 0,
        startCharged: false,
        shipSkills: damageKit(),
        stats: {
            attack: 1_000,
            crit: 0,
            critDamage: 0,
            speed: 10,
            defence: 0,
            hp: 10_000_000,
            security,
        },
    }));

/**
 * FIX 5 (review wave 1): the SUPPORT-ONLY variant of the kit above — same `on-attacked` inflict, but
 * its cast targets ALLIES and carries no damage ability. This is the shape that blocked the task:
 * such a ship resolves NO victim on its own turn (SP-4c-2b), so it is the only shape that can be hit
 * by a poisoned publication or by the reactive roll being priced against a phantom.
 *
 * `target: 'ally'` + `type: 'heal'` reproduces Flamel/Makoli: a pure supporter whose retaliation
 * nevertheless has a real victim (whoever shot it).
 */
const supportOnlyRetaliatoryKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'support-cast',
                    type: 'heal',
                    target: 'ally',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                },
            ],
        },
        ...retaliatoryDebuffKit().slots.filter((s) => s.slot === 'passive'),
    ],
});

/**
 * A support-only focus whose reactive inflict fires on `start-of-round` and therefore threads NO
 * victim — the Judge/Chakara trigger shape. Used by the victimless-arm case: it is what drives
 * `triggers.ts` into its `?? ctx.enemy.id` fallthrough, where the dummy sentinel would otherwise be
 * priced as a real defender.
 */
const victimlessReactiveKit = (): ShipSkills => ({
    slots: [
        ...supportOnlyRetaliatoryKit().slots.filter((s) => s.slot === 'active'),
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'victimless-inflict',
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'start-of-round',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Speed Down I',
                        stacks: 1,
                        parsedEffects: { speed: -10 },
                        isStackable: false,
                        application: 'inflict',
                        duration: 2,
                    },
                },
            ],
        },
    ],
});

const input = (): CombatEngineInput => ({
    attack: 1_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: retaliatoryDebuffKit(),
    numRounds: ROUNDS,
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
    hp: 10_000_000,
    hacking: FOCUS_HACKING,
    enemyAttackers: twoEnemiesOfDifferentSecurity(),
});

/**
 * The support-only run: same board, same passive, but the focus's cast targets its own allies, so
 * `selectTurnTarget` resolves NO victim for it every turn (SP-4c-2b). `target`/`pattern` are what put
 * it on the ally-side axis — the same knobs `dummyReachability`'s LIVENESS case uses.
 */
const supportInput = (): CombatEngineInput => ({
    ...input(),
    shipSkills: supportOnlyRetaliatoryKit(),
    position: 'M4',
    target: { raw: 'ally-team', side: 'ally', selection: 'team' },
    pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
});

/**
 * Runs the fixture and counts the focus's `debuff-applied` / `debuff-resisted` emissions per victim.
 *
 * Read off the EVENT BUS, not `runCombat`'s return value: the resisted/applied split is an event, and
 * the round summaries only carry the aggregate lists. The engine treats a supplied bus as a
 * write-only tap (engine.ts ~1886), so tapping it cannot perturb the run.
 */
const retaliationsByVictim = (
    build: () => CombatEngineInput = input
): Record<string, { applied: number; resisted: number }> => {
    const acc: Record<string, { applied: number; resisted: number }> = {
        [SOFT_ENEMY_ID]: { applied: 0, resisted: 0 },
        [HARD_ENEMY_ID]: { applied: 0, resisted: 0 },
    };
    const bus = createEventBus();
    const note =
        (kind: 'applied' | 'resisted') => (e: { sourceId?: string; targetId?: string }) => {
            if (e.sourceId !== 'attacker') return;
            const row = e.targetId !== undefined ? acc[e.targetId] : undefined;
            if (row) row[kind] += 1;
        };
    bus.on('debuff-applied', note('applied'));
    bus.on('debuff-resisted', note('resisted'));
    runCombat({ ...build(), bus });
    return acc;
};

describe('SP-4c-2b: a reactive infliction rolls against ITS OWN victim', () => {
    beforeEach(() => {
        // Seeded so the file is deterministic end to end. The assertions below do NOT depend on the
        // seed — both arms are at a saturated chance (1 and 0) precisely so that a future reseed
        // cannot flip them. Seeding only pins the two enemies' damage/crit streams.
        setupKeyedTestRng(4242);
    });

    it('lands every time on the ZERO-security attacker and never on the high-security one', () => {
        const byVictim = retaliationsByVictim();

        // The zero-security attacker: chance = (100 - 0)/100 = 1 → lands on every retaliation.
        expect(byVictim[SOFT_ENEMY_ID].resisted).toBe(0);
        expect(byVictim[SOFT_ENEMY_ID].applied).toBeGreaterThan(0);

        // The security-100 attacker: chance = clamp(100 - 100)/100 = 0 → never lands.
        expect(byVictim[HARD_ENEMY_ID].applied).toBe(0);
        expect(byVictim[HARD_ENEMY_ID].resisted).toBeGreaterThan(0);
    });

    it('is non-vacuous: BOTH attackers really did trigger the passive, in the same run', () => {
        // Without this, the case above passes if only one enemy ever reaches the focus — "never
        // lands on e-hard" would then be true because e-hard never attacked, not because the roll
        // said so. The two counts below are the retaliation ATTEMPTS, which must both be non-zero.
        const byVictim = retaliationsByVictim();

        const attemptsSoft = byVictim[SOFT_ENEMY_ID].applied + byVictim[SOFT_ENEMY_ID].resisted;
        const attemptsHard = byVictim[HARD_ENEMY_ID].applied + byVictim[HARD_ENEMY_ID].resisted;
        expect(attemptsSoft).toBeGreaterThan(0);
        expect(attemptsHard).toBeGreaterThan(0);
    });

    it('THE ACUTE SHAPE: an ally-targeting supporter, which resolves NO cast victim, still retaliates', () => {
        // FIX 5 (review wave 1). Every case above gives the focus a damage kit, so it always resolves
        // a cast victim — which means none of them exercises the shape that BLOCKED this rung: a
        // support ship whose ally-targeted cast resolves nobody (SP-4c-2b), publishes a landing
        // chance of 0 for that turn, and then retaliates against whoever shot it. That is Flamel and
        // Makoli, and until now its only evidence was a manual log dump. The goldens cannot see it:
        // `realKitFingerprints` records a token SET and Flamel already emits both `debuff` and
        // `debuff-resisted`, so the set is unchanged whether its passive works or is dead.
        //
        // WHAT THIS CASE FENCES, verified by mutation rather than asserted — an earlier draft of this
        // comment claimed three landmines and two of them were WRONG, which is worth recording since
        // the same over-claim is easy to make again:
        //   ✓ THE ORIGINAL DEFECT — reverting the per-victim resolver so the reactive path falls back
        //     to the published chance turns this case RED (measured).
        //   ✗ NOT the poisoned publication on its own: removing the `hasVictim` guard at the write
        //     site leaves this case GREEN, because the resolver prices the real victim and never
        //     reads the published value.
        //   ✗ NOT the ghost-pricing guard on its own: removing it leaves this case GREEN, because an
        //     `on-attacked` retaliation stamps `counterTargetId`, so a REAL victim always resolves and
        //     the `?? ctx.enemy.id` fallthrough is never taken.
        // Those last two are fenced by the NEXT case, which is built on the arm that does reach them.
        const byVictim = retaliationsByVictim(supportInput);

        // The zero-security attacker is still at a saturated chance of 1, so a working passive lands
        // EVERY retaliation. `> 0` is the load-bearing claim (the passive is alive at all); `resisted
        // === 0` additionally pins that the chance is the victim's own and not a phantom's.
        expect(byVictim[SOFT_ENEMY_ID].applied).toBeGreaterThan(0);
        expect(byVictim[SOFT_ENEMY_ID].resisted).toBe(0);

        // And the per-victim split still holds for a caster that never had a cast victim to cache a
        // chance from — the reactive roll is sourced entirely from the reactive victim.
        expect(byVictim[HARD_ENEMY_ID].applied).toBe(0);
        expect(byVictim[HARD_ENEMY_ID].resisted).toBeGreaterThan(0);
    });

    it('THE VICTIMLESS REACTIVE ARM is now a NO-OP — SP-4c-2d INVERTED THIS CASE', () => {
        // WHAT THIS CASE USED TO SAY, and why the inversion matters. A `start-of-round` reactive
        // threads no victim at all (no `victimId`, no `counterTargetId`), so `triggers.ts` took its
        // `applicationTargetId ?? ctx.enemy.id` fallthrough and the inflict was aimed at the DUMMY
        // SENTINEL. This case asserted exactly that — `inflicted` equalled `['enemy', 'enemy', …]`,
        // one per round — on the grounds that landing on the sentinel is "the honest reading of
        // 'this reaction named nobody'". SP-4c-2d took the opposite view, which is the one the
        // reactive `damage` branch already documented: a reaction that names nobody is a NO-OP.
        //
        // ⚠️ COVERAGE THIS INVERSION COSTS — recorded rather than quietly dropped, because both
        // items were fenced BY MUTATION here and by nothing else in the corpus:
        //   * `reactiveLandingChanceFor`'s refusal to price the dummy sentinel (engine.ts). No arm
        //     can hand it the sentinel any more — every surviving route resolves a real id — so the
        //     refusal is now a measured-inert BACKSTOP. Its comment says so.
        //   * the `hasVictim` guard on the landing-chance PUBLICATION. With the sentinel arm gone,
        //     nothing in production reads `owner.liveDebuffLandingChance` through the reactive
        //     fallback tail either (`liveDebuffLandingChanceFor` resolves a real victim and returns
        //     a number), so that guard is inert on the same footing.
        // The two cases ABOVE still fence the per-victim resolver itself, which is this file's
        // primary subject; what is gone is the fallback-path fencing, and it is gone because the
        // fallback path is gone.
        const inflicted: string[] = [];
        const bus = createEventBus();
        bus.on('debuff-applied', (e) => {
            if (e.sourceId === 'attacker') inflicted.push(e.targetId);
        });
        runCombat({ ...supportInput(), shipSkills: victimlessReactiveKit(), bus });

        // NOTHING is inflicted — not on the sentinel, not on a real enemy. The `toEqual([])` form
        // (rather than a length check) is deliberate: if a future change re-routes this arm to some
        // real enemy instead of no-opping, the failure message names the enemy it picked.
        expect(inflicted).toEqual([]);
    });

    it('THE REGRESSION: one cached chance cannot produce both outcomes', () => {
        // The pre-fix code drew both victims' gates against ONE number
        // (`runtime.liveDebuffLandingChance`, the owner's own turn-target chance), so the two
        // enemies were structurally incapable of diverging on the security term. This case states
        // that in the form a regression would break: the outcomes must DIFFER, and differ in the
        // direction security predicts (the softer target is the one that gets debuffed).
        const byVictim = retaliationsByVictim();

        expect(byVictim[SOFT_ENEMY_ID].applied).toBeGreaterThan(byVictim[HARD_ENEMY_ID].applied);
        expect(byVictim[HARD_ENEMY_ID].resisted).toBeGreaterThan(byVictim[SOFT_ENEMY_ID].resisted);
    });
});
