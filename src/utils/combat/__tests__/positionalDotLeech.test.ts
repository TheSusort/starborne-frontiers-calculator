/**
 * SP-4b-2b Task 2b — a `basis:'damage-dealt'` STANDING leech pays out on a POSITIONAL DoT tick.
 *
 * THE DEFECT (pre-existing, masked by the dummy path). A standing damage-dealt leech is procced
 * from exactly two places:
 *   1. `creditDamage(sourceId, channel, amount)` → `procStandingLeeches` — the NON-positional
 *      aggregate channel. The dummy enemy's DoT tick routes through it
 *      (`credit: (sourceId, dotType, damage) => creditDamage(sourceId, dotType, damage)`), so
 *      against the dummy a `leechScope:'all'` leech DID pay out on DoT ticks.
 *   2. `procStandingLeechesPerVictim(sourceId, amount)` — the POSITIONAL per-victim channel,
 *      wired at all three attack sites through `procLeechesForVictim`.
 *
 * The positional per-victim DoT-tick branch used neither: its `credit` callback accumulated into
 * `total` / `tickDealtBySource` / `perActorDot` and stopped there. So the moment a run faced a
 * REAL positioned enemy instead of the dummy, every `leechScope:'all'` standing leech silently
 * stopped paying out on DoT damage — while the same leech kept paying out on DIRECT damage
 * (which does go through `procLeechesForVictim`). Production-reachable: Magnolia's self leech is
 * a passive standing `'all'` leech, and `buildEquipmentAbilities.ts` injects the same shape from
 * the Leech gear set.
 *
 * THE FIX. The per-victim tick's `credit` callback now calls `procStandingLeechesPerVictim` —
 * the same per-victim proc the direct path uses, which is side-aware (`allRuntimesById`,
 * side-relative recipients) and therefore team-symmetric by construction. It does NOT re-credit
 * the damage: `procStandingLeechesPerVictim` only writes HEAL buckets and heal/shield pools, and
 * never touches `dmg()` / `roundPerTargetDamage` / `creditDealt`, so no DoT number moves.
 *
 * --- DoT-tick arithmetic (from tickDoTs) ---
 *   corrosion tick = stacks × (tier/100) × min(victimOwnMaxHp, 500_000) × dotMult × affinityMult
 * With neutral mults, a tier-5 / 1-stack corrosion on a victim of maxHp 10000 ticks 500.
 * A 20% heal leech on 500 dealt → directHeal 100 (crit 0 / healModifier 0 → no fold).
 *
 * Every fixture here runs the focus at attack 0 so the FIRING hit deals nothing and cannot
 * contribute a direct-channel leech payout — the whole directHeal figure is the DoT-tick leech.
 * The `direct`-channel control case (which must pass BEFORE and AFTER the fix) gives the focus a
 * real attack instead; it is the working path, and a red control means the fix broke it.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, ActiveDoTStack, PendingBomb } from '../state';
import type { CombatStatBlock } from '../../../types/calculator';
import { dealtBy } from '../__testutils__/perTargetDealt';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pdl${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// Single-hit basic attack (multiplier 100%, 1 hit). Paired with attack 0 it resolves the cast
// positionally while dealing nothing — so no direct-channel leech payout can muddy the figure.
const basicAttack = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

const basicSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [basicAttack()],
});

/**
 * A passive-slot damage-dealt HEAL leech (a STANDING leech — passive-slot heal abilities are
 * on-cast, not reactive, so they survive the reactive partition into `standingLeeches`).
 * `target: 'self'` → the leech owner repairs its own pool, which is the shape every corpus ship
 * that reaches this map uses (Magnolia, Malvex, Quixilver, Valerian).
 */
const leechHeal = (pct: number, leechScope: 'all' | 'detonation' = 'all'): Ability =>
    ab({
        type: 'heal',
        target: 'self',
        config: { type: 'heal', pct, basis: 'damage-dealt', leechScope },
    });

const leechSlot = (
    pct: number,
    leechScope: 'all' | 'detonation' = 'all'
): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [leechHeal(pct, leechScope)],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// Origin + one covered cell one step toward the back (Pattern-Line-Range-1).
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A positioned, zero-offense, finite-HP enemy. speed 1 → it takes a turn each round. */
const enemyAt = (
    id: string,
    position: Position,
    hp: number,
    slots: ShipSkills['slots'] = []
): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots } as ShipSkills,
    }) as EnemyAttacker;

/** A pre-seeded corrosion stack (HP-basis, so it is independent of the applier's attack). */
const corrosion = (
    tier: number,
    stacks: number,
    remainingRounds: number,
    sourceId: string
): ActiveDoTStack => ({ tier, stacks, remainingRounds, sourceId });

/** A pre-seeded TIMED bomb: burst = stacks × damagePerStack with neutral mults. */
const timedBomb = (
    damagePerStack: number,
    stacks: number,
    countdown: number,
    sourceId = 'attacker'
): PendingBomb => ({
    countdown,
    damagePerStack,
    stacks,
    tier: 100,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

const teamStats = (hp: number): CombatStatBlock => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    defence: 0,
    hp,
    hacking: 0,
});

/** A positioned walked-team ally. speed 100 → it acts before the speed-1 enemies. */
const teamAlly = (id: string, position: Position, hp: number): TeamActorEngineInput =>
    ({
        id,
        speed: 100,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern: lineRange1Pattern(),
        walk: {
            shipSkills: { slots: [basicSlot()] },
            stats: teamStats(hp),
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

/**
 * Positional healing-mode BASE. The focus 'attacker' sits at M4, is the heal target (which is
 * what builds `healingCtx` and registers `standingLeeches` at all), fires a Line-Range-1 basic
 * attack at `front`, and has attack 0 so its firing hit deals nothing.
 */
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicSlot(), leechSlot(20)] },
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
    hp: 1_000_000,
    healModifier: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: lineRange1Pattern(),
    enemyAttackers: [enemyAt('enemy-front', 'M4', 1_000_000_000)],
    ...overrides,
});

/** Sum a healing bucket over every round for `actorId`. */
const sumHeal = (
    result: ReturnType<typeof runCombat>,
    bucket: 'directHeal' | 'effectiveHeal' | 'overheal',
    actorId: string
): number =>
    (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(actorId)?.[bucket] ?? 0),
        0
    );

describe("SP-4b-2b Task 2b — a leechScope:'all' standing leech pays out on a positional DoT tick", () => {
    it('PLAYER side: the focus’s standing leech pays out on its corrosion ticking a positioned enemy', () => {
        idc = 0;
        // enemy-back at M2 is OUTSIDE the Line-Range-1 footprint (M4 + M3), so nothing but the DoT
        // tick touches it. maxHp 10000, corrosion tier 5 / 1 stack applied by the focus → tick 500,
        // landing at enemy-back's own turn-start in round 1 (the focus acts first, so its ctx is set).
        // The focus's 20% standing 'all' leech must therefore credit directHeal 500 × 0.20 = 100.
        const result = runCombat(
            BASE({
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-back', 'M2', 10000),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-back')
                        ?.corrosionEntries.push(corrosion(5, 1, 5, 'attacker'));
                },
            })
        );

        // ANTI-VACUITY, load-bearing: the tick REALLY landed, attributed to the focus. Without this
        // the leech assertion could pass trivially by the DoT never ticking at all (0 → 0).
        expect(result.rounds[0].perTargetDamage?.['enemy-back']).toBe(500);
        expect(dealtBy(result.rounds, 'attacker')).toBe(500);
        // ANTI-VACUITY: attack 0 → the firing hit landed on the footprint victim for ZERO, so it
        // contributed no direct-channel leech and the whole directHeal figure below is the DoT-tick
        // leech. (`dealtBy` above is 500 exactly — the tick and nothing else.)
        expect(result.rounds[0].perTargetDamage?.['enemy-front']).toBe(0);

        expect(sumHeal(result, 'directHeal', 'attacker')).toBeCloseTo(100, 6);
    });

    it('ENEMY side (team symmetry): an enemy’s standing leech pays out on its corrosion ticking a positioned player ally', () => {
        idc = 0;
        // Mirror of the player case with the sides swapped. The focus stays the heal target (so the
        // ally ticks through the per-victim branch, not the heal-target branch); the DoT carrier is
        // the walked-team ally at M2 (maxHp 10000) and the APPLIER is 'enemy-leecher', which carries
        // the 20% standing 'all' leech in its own passive slot.
        //
        // Turn order: the ally (speed 100) and the focus act before the speed-1 enemy, so in round 1
        // the applier has no ctx yet and tickDoTs skips the entry. The tick lands in round 2 → one
        // tick of 500 across the run → the enemy's own directHeal is 500 × 0.20 = 100.
        const result = runCombat(
            BASE({
                numRounds: 2,
                position: 'M3',
                shipSkills: { slots: [basicSlot()] }, // the focus carries NO leech here
                teamActors: [teamAlly('team-ally', 'M2', 10000)],
                enemyAttackers: [enemyAt('enemy-leecher', 'M4', 1_000_000_000, [leechSlot(20)])],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'team-ally')
                        ?.corrosionEntries.push(corrosion(5, 1, 5, 'enemy-leecher'));
                },
            })
        );

        // ANTI-VACUITY: the tick landed on the ally's own HP, attributed to the enemy applier.
        expect(result.rounds[1].perTargetDamage?.['team-ally']).toBe(500);
        expect(dealtBy(result.rounds, 'enemy-leecher')).toBe(500);

        // The ENEMY owner's own heal bucket — the team-symmetric mirror of the player assertion.
        expect(sumHeal(result, 'directHeal', 'enemy-leecher')).toBeCloseTo(100, 6);
        // The focus carries no leech in this fixture, so nothing leaked onto the player side.
        expect(sumHeal(result, 'directHeal', 'attacker')).toBe(0);
    });

    it('CONTROL (the working path — must pass before AND after the fix): the same leech pays out on positional DIRECT damage', () => {
        idc = 0;
        // The direct channel already procs the standing leech per victim (procLeechesForVictim at
        // all three attack sites). Focus attack 5000 vs defence 0: origin (enemy-front, M4) takes
        // 5000, covered (enemy-mid, M3) takes 2500 → 7500 dealt → 20% → directHeal 1500.
        // If this ever goes red, the fix has broken the path that was already working.
        const result = runCombat(
            BASE({
                attack: 5000,
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 1_000_000_000),
                ],
            })
        );

        expect(result.rounds[0].perTargetDamage?.['enemy-front']).toBe(5000);
        expect(result.rounds[0].perTargetDamage?.['enemy-mid']).toBe(2500);
        expect(sumHeal(result, 'directHeal', 'attacker')).toBeCloseTo(1500, 6);
    });

    it('a detonation-scoped leech stays inert on a DoT tick (the DoT channel is not the detonation channel)', () => {
        idc = 0;
        // Same fixture as the player case, with the leech scoped to 'detonation'. The tick still
        // lands, but a detonation-scoped leech must NOT pay out on it — the scope gate is preserved
        // by routing through procStandingLeechesPerVictim (which skips scope 'detonation').
        const result = runCombat(
            BASE({
                shipSkills: { slots: [basicSlot(), leechSlot(20, 'detonation')] },
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-back', 'M2', 10000),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-back')
                        ?.corrosionEntries.push(corrosion(5, 1, 5, 'attacker'));
                },
            })
        );

        expect(result.rounds[0].perTargetDamage?.['enemy-back']).toBe(500); // the tick landed
        expect(sumHeal(result, 'directHeal', 'attacker')).toBe(0); // and paid nothing
    });

    it('SCOPE GUARD: a detonation-scoped leech pays NOTHING on a corrosion tick, while an all-scoped one pays 100', () => {
        idc = 0;
        // Identical fixture to the PLAYER-side case above (tick = 500), run twice with only the
        // leech's scope changed. 'all' → 500 × 0.20 = 100. 'detonation' → 0, because a corrosion
        // tick is not a detonation. This pins BOTH halves of the restored conjunct: delete the
        // `channel !== 'detonation'` half and the 'all' arm breaks; delete the whole line and the
        // 'detonation' arm breaks.
        const run = (scope: 'all' | 'detonation') =>
            runCombat(
                BASE({
                    shipSkills: { slots: [basicSlot(), leechSlot(20, scope)] },
                    enemyAttackers: [
                        enemyAt('enemy-front', 'M4', 1_000_000_000),
                        enemyAt('enemy-back', 'M2', 10000),
                    ],
                    __testTapActors: (actors: CombatActor[]) => {
                        actors
                            .find((a) => a.id === 'enemy-back')
                            ?.corrosionEntries.push(corrosion(5, 1, 5, 'attacker'));
                    },
                })
            );

        const allScoped = run('all');
        const detonationScoped = run('detonation');

        // ANTI-VACUITY, load-bearing: the tick really landed in BOTH runs, so the 0 below is a
        // scope decision and not a fixture that failed to tick.
        expect(allScoped.rounds[0].perTargetDamage?.['enemy-back']).toBe(500);
        expect(detonationScoped.rounds[0].perTargetDamage?.['enemy-back']).toBe(500);

        expect(sumHeal(allScoped, 'directHeal', 'attacker')).toBeCloseTo(100, 6);
        expect(sumHeal(detonationScoped, 'directHeal', 'attacker')).toBe(0);
    });
});

/**
 * KNOWN GAP TRIPWIRE — a standing leech pays ZERO off a positional bomb/accumulator burst.
 *
 * DELIBERATELY NOT FIXED HERE (owner ruling, SP-4b-2b Task 2b) — the burst channel's routing is
 * its own scope decision for a follow-up task, not a comment fix.
 *
 * ⚠️ LINE NUMBERS BELOW ARE HINTS, NOT ADDRESSES — every one is paired with the SYMBOL it points
 * at, because engine.ts is ~10,700 lines and these citations have gone stale twice already (once
 * inside the very commit that wrote them, when the same commit's other edits shifted the file).
 * Search the symbol; trust the number only if it matches.
 *
 * THE REAL MECHANISM (corrected — a prior version of this comment misattributed the zero to a
 * scope guard; it does not come from one). `applyPositionedTimedBurst` (engine.ts:6995, `const applyPositionedTimedBurst = (`) applies a
 * burst's damage via `applyVictimDamage` directly, inside `processBombs`' `creditDetonation`
 * callback, and never calls `procLeechesForVictim` — the seam that would reach either leech proc.
 * So the positional burst channel reaches NEITHER `procStandingLeechesPerVictim` NOR
 * `procTakenLeechesPerVictim`, regardless of the leech's `scope`. The `scope === 'detonation'`
 * `continue` inside `procStandingLeechesPerVictim` (engine.ts:3926,
 * `if (e.scope === 'detonation') continue;`) is never even reached from this
 * path — it cannot be what produces the zero below, because nothing calls either proc from the
 * burst channel in the first place. (The two procs are called from `procLeechesForVictim`
 * (engine.ts:4064-4065, the adjacent `procStandingLeechesPerVictim(actorId, damage);` /
 * `procTakenLeechesPerVictim(victim, damage, outcome);` pair) and from that helper's three call
 * sites (engine.ts:9162, 9441, 10245, each a `procLeechesForVictim(actor.id, victim, …)`), plus
 * one direct positional-DoT-tick call to the standing proc (engine.ts:8885,
 * `procStandingLeechesPerVictim(sourceId, damage);`) — none of them the
 * burst channel.) Deleting that scope guard entirely would leave this test exactly as green as it
 * is today.
 *
 * SO THE GAP IS WIDER THAN THE `'detonation'` SCOPE THIS FIXTURE HAPPENS TO USE. A
 * production-REACHABLE `leechScope:'all'` standing leech — Magnolia's self leech, and the Leech
 * gear set via `buildEquipmentAbilities.ts` — ALSO pays zero on a positional bomb/accumulator
 * burst, where on the old dummy path it paid via `creditDamage(sourceId, 'detonation', damage)`
 * (engine.ts:9601 and :9614, both `creditDamage(sourceId, 'detonation', damage),`). This is the identical "procs no leeches in either direction" gap the
 * engine already documents for the sibling passive-slot-damage-footprint helper — see its
 * "KNOWN GAPS … (a) IT PROCS NO LEECHES, IN EITHER DIRECTION" block (engine.ts:6557,
 * `KNOWN GAPS — both real, both corpus-bounded today`) for the
 * fuller shape of the defect class.
 *
 * WHY *THIS FIXTURE* STAYS CORPUS-UNREACHABLE EVEN SO: it uses a `leechScope:'detonation'` leech
 * so the assertion is unambiguous, and that scope's only producer — the "Echoing Burst explodes"
 * parse (Valkyrie) — triggers `on-bomb-detonated`, so the reactive partition pulls it out of
 * `castSkills` before the `standingLeeches` scan ever sees it (engine.ts:3940, the
 * "`on-bomb-detonated`, so it is reactive and never enters this map" note). No shipped
 * ship registers a detonation-scoped STANDING leech today. The underlying burst-channel gap it
 * stands in for is not similarly corpus-bounded — see the `'all'`-scope exposure above.
 *
 * THE POINT OF THIS TEST: it pins the zero so that fixing the burst channel — routing it through
 * `procLeechesForVictim`, for either scope — is a deliberate, reviewed decision rather than a
 * silent side effect. Because the gap is channel-wide, that fix will also change the payout of a
 * `leechScope:'all'` leech on a burst (Magnolia, the Leech gear set); read this comment before
 * updating either expectation.
 */
describe('KNOWN GAP (tripwire): a detonation-scoped standing leech pays zero on a positional burst', () => {
    it('a positioned enemy’s timed bomb bursts, and the focus’s detonation-scoped leech still credits 0', () => {
        idc = 0;
        // enemy-back at M2 is outside the firing footprint and carries a timed bomb applied by the
        // focus: 2 stacks × 3000 = 6000, countdown 1 → it bursts at enemy-back's own turn-start in
        // round 1. The focus carries a 20% standing leech scoped to 'detonation'. If a detonation
        // channel existed positionally this would credit 6000 × 0.20 = 1200; it credits 0.
        const result = runCombat(
            BASE({
                shipSkills: { slots: [basicSlot(), leechSlot(20, 'detonation')] },
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-back', 'M2', 1_000_000),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-back')
                        ?.pendingBombs.push(timedBomb(3000, 2, 1, 'attacker'));
                },
            })
        );

        // ANTI-VACUITY, load-bearing: the burst REALLY landed on the positioned enemy. Without this
        // the zero below would be indistinguishable from "no detonation happened".
        expect(result.rounds[0].perTargetDamage?.['enemy-back']).toBe(6000);
        // …and the detonation-scoped standing leech paid nothing: THE KNOWN GAP.
        expect(sumHeal(result, 'directHeal', 'attacker')).toBe(0);
    });
});
