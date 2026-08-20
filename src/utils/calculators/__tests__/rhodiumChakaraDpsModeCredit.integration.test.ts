/**
 * SP-M M1 Task 7b review: Tasks 5/6 re-targeted Rhodium's end-of-round reactive damage and
 * Chakara's start-of-round reactive damage to the `enemy-most-buffs` / `enemy-highest-speed`
 * selectors (triggers.ts, ctx.enemyWithMostBuffs / ctx.enemyWithHighestSpeed). Those selectors
 * are bound (engine.ts playerDrainCtx) over `enemyAttackerActors` — the POSITIONED opposing
 * roster. In pure DPS mode (no positioned enemy attackers) that roster is EMPTY, so
 * `mostBuffsAmong([])` / `highestSpeedInRoster([])` resolve to `undefined`, and triggers.ts's
 * damage arm (`if (id === undefined) return;`) silently drops the proc — `applyReactiveDamage`/
 * `creditDamage` is never called at all — a regression vs pre-SP-M behavior (these procs used to
 * target the DPS dummy `enemy` via the plain `target:'enemy'` fallback and always credited).
 *
 * The fix at the time (engine.ts playerDrainCtx): `enemyWithMostBuffs`/`enemyWithHighestSpeed` fell
 * back to the live dummy `enemy.id` when there was no positioned enemy roster — mirroring Task 7's
 * `livingOpposingActorIds` dummy-aware binding for Judge/Incinerator's all-enemies proc. It
 * originally keyed on `dummyEnemyIsVestigial`; Task 9b re-keyed it to `hasPositionedEnemyRoster`,
 * SP-4c-2c deleted the old gate, and SP-4c-2d deleted the fallback arm together with the dummy —
 * all three resolvers now read the real positioned roster unconditionally.
 *
 * Both ships use their real corpus passive text (docs/ship-skills.csv), matching the positional
 * fixtures in reactiveDamagePositionalHp.test.ts verbatim.
 *
 * Chakara (start-of-round trigger) is verified end-to-end through the PUBLIC `simulateDPS`
 * surface (`cumulativeDamage`/`directDamage`) — the same surface `judgeStartOfRoundDamage.
 * integration.test.ts` uses for Judge's start-of-round proc. `round-started` is emitted+drained
 * BEFORE the round's damage tally is snapshotted (engine.ts), so the credited amount correctly
 * appears in that round's reported numbers.
 *
 * Rhodium (end-of-round trigger) is verified via the lower-level `__testTapCreditDamage` probe
 * (the same instrumentation `reactiveDamageMitigation.integration.test.ts` uses), NOT through
 * `simulateDPS`'s `cumulativeDamage`. This is deliberate: `round-ended` is emitted+drained AFTER
 * the round's `directDamage`/`cumulativeDamage`/`totalRoundDamage` locals are already snapshotted
 * (engine.ts ~8005-8035, well before the `round-ended` emit at ~8113) — a SEPARATE, PRE-EXISTING
 * ordering gap (confirmed present at commit 78eab536, BEFORE Task 5 ever touched Rhodium — i.e.
 * NOT introduced by, and out of scope for, this selector fix) that silently discards ANY
 * 'end-of-round'-triggered reactive-damage credit from DPS-mode `RoundData`/`summary` regardless
 * of target/selector. The `__testTapCreditDamage` probe proves the SPECIFIC regression this task
 * fixes — the selector no longer resolves to `undefined` and drops the proc; `creditDamage` now
 * fires with the correct (mitigated) amount, exactly like every other reactive-damage credit path
 * — while honestly not claiming the separate round-tail ordering bug is fixed (it isn't, and
 * fixing it is out of this task's locus; flagged in the task report as a follow-up).
 *
 * ─── SP-4b-2a migration (Task 7 wave A) ──────────────────────────────────────────────────────
 * `simulateDPS` now ALWAYS builds a real, positioned enemy (`enemy-1`), so the four `simulateDPS`
 * tests below no longer take the dummy-fallback branch this file was written against — they take
 * the POSITIONAL branch, where `enemyWithMostBuffs` is `onceByOwner(() => mostBuffsAmong(
 * enemyAttackerActors))`. That branch was the `hasPositionedEnemyRoster === true` arm of a ternary
 * at the time; SP-4c-2d deleted the gate and the dummy-fallback arm, so it is now the only binding
 * (see `playerDrainCtx` in engine.ts).
 * Against a single UNBUFFED enemy `mostBuffsAmong` returns `undefined` (engine.ts:8250,
 * `return bestCount > 0 ? best : undefined;`, the deliberate "no buffs anywhere → no most-buffs
 * target" rule), so Rhodium's proc found no target and dropped entirely: `directDamage` read 0.
 *
 * The repair is to make the fixture exercise the mechanic it NAMES rather than to re-pin 0. Each
 * `simulateDPS` test now supplies an explicit `buffedEnemyRoster()`: one positioned enemy whose
 * active grants it `Attack Up III` (the same `buffedEnemy` idiom the positional sibling
 * reactiveDamagePositionalHp.test.ts uses), so `mostBuffsAmong` resolves it deterministically.
 * `hp` on the DPS input is load-bearing too: an enemy attacker with NO living opposing victim
 * takes the no-victim cadence-only skip and never casts, so it would never gain the buff.
 * The enemy keeps `attack: 0`, so its own basic attack deals 0 and moves nothing.
 *
 * EVERY EXPECTED NUMBER IS UNCHANGED (ATTACK × 0.8 per round; kill on round 1 at enemyHp 5000):
 * the proc is back on the same amount, now landing on a real enemy instead of the dummy sink.
 *
 * ─── SP-4b-2b migration (repair wave D) ──────────────────────────────────────────────────────
 * The FIRST test used to drive `runCombat` directly with NO `enemyAttackers`, which is how it kept
 * covering the dummy-fallback branch (`hasPositionedEnemyRoster === false`). An empty roster is now
 * a validation error at the normalization boundary, and ANY roster makes that branch unreachable —
 * so the branch it covered is gone, not merely re-shaped. It follows the same two moves 2a already
 * applied to its four siblings, for the same reasons:
 *   • it supplies `buffedEnemyRoster()`, because against a single UNBUFFED enemy `mostBuffsAmong`
 *     returns `undefined` and Rhodium's proc DROPS ENTIRELY rather than shifting — so an unbuffed
 *     fixture would read 0 and be a pin on the drop, not on the mechanic this file names. The
 *     dummy-fallback era made that selector trivially satisfiable, which is why this fixture never
 *     had to buff anything before;
 *   • it reads the per-victim `perTargetDealt` channel instead of `__testTapCreditDamage`. On a
 *     positional run a reactive-damage proc books through `applyReactiveDamage` -> `creditDealt`,
 *     not through the credit-only `creditDamage` chokepoint the tap observes — measured: the tap
 *     sees 0 while `perTargetDealt` carries the full amount. The pinned number is unchanged
 *     (ATTACK x 0.8 = 8000).
 */
import { describe, it, expect } from 'vitest';
import { simulateDPS, DPSSimulationInput, SYNTHESIZED_DPS_ENEMY_ID } from '../dpsSimulator';
import { runCombat, CombatEngineInput } from '../../combat/engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ship } from '../../../types/ship';
import { dealtBy, dealtEntries } from '../../combat/__testutils__/perTargetDealt';

// Verbatim from docs/ship-skills.csv (Rhodium, second_passive_skill_text — the R2/refit-active
// slot getShipSkillRows resolves for a 2-refit ship). Matches reactiveDamagePositionalHp.test.ts.
const RHODIUM_P2 =
    'At the end of the round, this Unit <unit-aid>purges 2</unit-aid> buffs from the enemy with ' +
    'the most buffs and deals <unit-damage>80% damage</unit-damage> that cannot critically hit.';

function rhodiumShipSkills() {
    const rhodium = {
        refits: [{}, {}],
        activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage>.',
        secondPassiveSkillText: RHODIUM_P2,
    } as unknown as Ship;
    return buildShipAbilities(rhodium);
}

// Verbatim from docs/ship-skills.csv (Chakara, third_passive_skill_text — the R4/refit-active
// slot getShipSkillRows resolves for a 4-refit ship). Matches reactiveDamagePositionalHp.test.ts.
const CHAKARA_P4 =
    'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and ' +
    '<unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all ' +
    'Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.';

function chakaraShipSkills(withPassive: boolean) {
    const chakara = {
        refits: withPassive ? [{}, {}, {}, {}] : [],
        activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage>.',
        ...(withPassive ? { thirdPassiveSkillText: CHAKARA_P4 } : {}),
    } as unknown as Ship;
    return buildShipAbilities(chakara);
}

/** Sums every unit of damage `sourceId` is credited with dealing across the whole run.
 *
 *  SP-4b-2b: this used to tap `__testTapCreditDamage`, which observes the credit-only
 *  `creditDamage` chokepoint. That is the NON-positional channel; a positional run books a
 *  reactive-damage proc through `applyReactiveDamage` -> `creditDealt` and the tap sees nothing.
 *  `perTargetDealt` is the live channel and carries the identical amount. */
const creditedDirectDamageFor = (sourceId: string, input: CombatEngineInput): number =>
    dealtBy(runCombat(input).rounds, sourceId);

const ATTACK = 10_000;

// A self-buff-granting active (real corpus idiom — verbatim from reactiveDamagePositionalHp.
// test.ts's `buffedEnemy`). This is the ONLY thing that makes the enemy carry a buff at all, so
// `mostBuffsAmong` resolves it instead of returning `undefined` ("no buffs anywhere").
function buffedEnemySkills() {
    const buffer = {
        refits: [],
        activeSkillText: 'This Unit gains <unit-skill>Attack Up III</unit-skill> for 2 turns.',
    } as unknown as Ship;
    return buildShipAbilities(buffer);
}

/**
 * The positioned enemy roster Rhodium's `enemy-most-buffs` selector needs (SP-4b-2a). Carries the
 * SAME id `simulateDPS` would synthesize, `attack: 0` (its own basic attack deals nothing and
 * moves no number), and the given max HP so the kill test's HP budget is the roster's.
 */
const buffedEnemyRoster = (hp: number): NonNullable<DPSSimulationInput['enemyAttackers']> => [
    {
        id: SYNTHESIZED_DPS_ENEMY_ID,
        stats: { attack: 0, crit: 0, critDamage: 0, speed: 50, defence: 0, hp, security: 100 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: buffedEnemySkills(),
    },
];

/**
 * A Rhodium DPS run against that buffed enemy. `hp` on the ATTACKER is load-bearing: an enemy
 * attacker with no living opposing victim takes the no-victim cadence-only skip and never casts,
 * so it would never gain the buff the selector keys on. Rhodium's own active is 0%-damage by
 * construction, so any reported damage is unambiguously the end-of-round reactive proc.
 */
const rhodiumRun = (enemyHp: number, rounds: number) =>
    simulateDPS({
        attack: ATTACK,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        enemyDefense: 0,
        enemyHp,
        rounds,
        selfBuffs: [],
        enemyDebuffs: [],
        shipSkills: rhodiumShipSkills(),
        defence: 0,
        hp: 1_000_000_000,
        enemyAttackers: buffedEnemyRoster(enemyHp),
    });

/** Direct-`runCombat` input carrying the given ship's parsed abilities, against the buffed
 *  positioned enemy Rhodium's `enemy-most-buffs` selector needs (see the SP-4b-2b note in the file
 *  header). The active skill is 0%-damage by construction (both ships' texts above) — any credited
 *  direct damage is unambiguously the reactive proc. */
const buildDpsInput = (shipSkills: ReturnType<typeof rhodiumShipSkills>): CombatEngineInput => ({
    enemyAttackers: buffedEnemyRoster(1_000_000_000),
    attack: ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills,
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    hp: 1_000_000_000,
    speed: 200,
    healTargetId: 'attacker',
    mode: 'healing',
});

describe('SP-M M1 Task 7b review: Rhodium/Chakara reactive damage credits the DPS-mode damage metric', () => {
    it("Rhodium's end-of-round most-buffed-enemy proc no longer silently drops in DPS mode — the proc fires and books the mitigated 80% amount (regression probe via perTargetDealt)", () => {
        const credited = creditedDirectDamageFor('attacker', buildDpsInput(rhodiumShipSkills()));
        // Pre-fix: enemyWithMostBuffs(ownerId) resolved to `undefined` off the empty
        // enemyAttackerActors roster → triggers.ts's damage arm returned early → the proc was
        // NEVER booked → credited === 0. Post-fix the selector resolves the buffed positioned
        // enemy, so the proc fires and books ATTACK × 0.8 (noCrit, 0 defense).
        expect(credited).toBeCloseTo(ATTACK * 0.8, 6);
        // Non-vacuity: the selector really did resolve a target (and exactly one), rather than the
        // amount arriving from some other source. The victim is the roster entry, not the sink.
        const entries = dealtEntries(runCombat(buildDpsInput(rhodiumShipSkills())).rounds);
        expect(entries).toHaveLength(1);
        expect(entries[0].victimId).toBe(SYNTHESIZED_DPS_ENEMY_ID);
    });

    it("Rhodium's end-of-round proc surfaces in the PUBLIC simulateDPS summary (round-tail ordering fix)", () => {
        // The end-of-round reactive credit lands during the `round-ended` drain, which fires
        // AFTER the round's directDamage/cumulativeDamage/totalRoundDamage scalar snapshot. The
        // post-drain re-fold folds that late credit into the reported round + summary numbers,
        // so the proc is now visible on the public surface (not only via __testTapCreditDamage).
        const reaction = rhodiumRun(1_000_000_000, 1);
        // Active skill is 0%-damage; the only credited direct damage is the end-of-round 80%
        // proc (noCrit, 0 defense) → ATTACK × 0.8, on the round row, the direct total, and the
        // cumulative summary.
        expect(reaction.rounds[0].directDamage).toBeCloseTo(ATTACK * 0.8, 6);
        expect(reaction.summary.totalDirectDamage).toBeCloseTo(ATTACK * 0.8, 6);
        expect(reaction.summary.totalDamage).toBeCloseTo(ATTACK * 0.8, 6);
    });

    it("Rhodium's end-of-round proc accumulates across rounds in the public summary", () => {
        const reaction = rhodiumRun(1_000_000_000, 3);
        // Each round's 80% proc (ATTACK × 0.8 = 8000) is folded into that round + the cumulative
        // summary — the re-fold runs every round, not just once.
        expect(reaction.rounds).toHaveLength(3);
        expect(reaction.rounds[2].directDamage).toBeCloseTo(ATTACK * 0.8, 6);
        expect(reaction.summary.totalDamage).toBeCloseTo(3 * ATTACK * 0.8, 6);
    });

    it("Rhodium's end-of-round proc can land the kill at round tail — roundsToKill honours the reactive HP decline and the run terminates", () => {
        // enemyHp (5000) < the round-tail proc (ATTACK × 0.8 = 8000), and the active skill deals
        // 0% — so the enemy survives the (zero) pre-drain decline and is killed by the end-of-round
        // proc's supplemental applyVictimDamage in the re-fold. Pre-fix the proc never touched HP,
        // so the enemy survived all 3 rounds; post-fix it dies on round 1 and the run terminates.
        const reaction = rhodiumRun(5_000, 3);
        expect(reaction.summary.survived).toBe(false);
        expect(reaction.summary.roundsToKill).toBe(1);
        // Run terminated on the kill round — no zero-damage rounds past it.
        expect(reaction.rounds).toHaveLength(1);
        // enemyHpPct is the ENTERING-round value (dpsSimulator.ts docs; used for hp-threshold
        // gating), NOT a post-round value — so the kill round reports 100 (full HP entering),
        // exactly like the tested [100,75,50,25] case where the enemy dies on round 4 showing 25.
        // (Deliberately not 0: a round-tail kill is consistent with every other kill round.)
        expect(reaction.rounds[0].enemyHpPct).toBe(100);
    });

    it("Chakara's start-of-round highest-Speed-enemy proc credits cumulativeDamage/directDamage in DPS mode (against the synthesized positioned enemy)", () => {
        const reaction = simulateDPS({
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            rounds: 2,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: chakaraShipSkills(true),
        });
        // Control: the passive (and therefore the whole proc) is entirely absent — same idiom as
        // reactiveDamagePositionalHp.test.ts's Chakara control run. Isolates the reactive's own
        // HP delta from the (0%-damage) active hit, without hardcoding the "lowest speed among
        // Allies" self-buff's attack-up magnitude into the expectation.
        const control = simulateDPS({
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            rounds: 2,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: chakaraShipSkills(false),
        });

        expect(control.summary.totalDamage).toBe(0);
        // Pre-fix: enemyWithHighestSpeed(ownerId) resolved to `undefined` off the empty
        // enemyAttackerActors roster → the proc silently dropped → reaction === control (both 0).
        // SP-4b-2a: this run is POSITIONAL, so the roster is no longer empty — it holds the one
        // synthesized enemy — and `highestSpeedInRoster` resolves it directly (no dummy fallback,
        // and no buff precondition, which is why this test needed no fixture change where the
        // Rhodium `enemy-most-buffs` ones above did). Round 1 alone therefore still credits at
        // least ATTACK × 0.6 (the self-buff granted by the co-located "starts each round with
        // Attack Up II..." clause can only ever ADD to this floor, never subtract).
        expect(reaction.rounds[0].directDamage).toBeGreaterThanOrEqual(ATTACK * 0.6);
        expect(reaction.summary.totalDamage).toBeGreaterThan(control.summary.totalDamage);
        // Recurring across both rounds (not a one-shot) — the proc fires every round entered.
        expect(reaction.rounds[1].directDamage).toBeGreaterThanOrEqual(ATTACK * 0.6);
    });
});
