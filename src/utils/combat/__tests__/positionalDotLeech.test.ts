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
        // tick is not a detonation. WHAT THIS PINS, PRECISELY: that the gate LINE EXISTS. Delete it entirely and the
        // 'detonation' arm pays 1200 instead of 0, so this test goes red.
        //
        // WHAT IT CANNOT PIN, and deliberately does not claim to: the second conjunct on its own.
        // The gate is `e.scope === 'detonation' && channel !== 'detonation'`, short-circuited on the
        // first term. The 'all' arm has `e.scope === 'all'`, so the first term is false and the
        // second is never evaluated — dropping it changes nothing here. The 'detonation' arm runs on
        // a corrosion channel, where the one-conjunct and two-conjunct forms BOTH skip. So no
        // fixture shaped like this one can distinguish them.
        // The conjunct's own coverage arrives with the burst channel (site 2), whose
        // 'detonation'-scoped arm calls the proc with `channel: 'detonation'` and expects a PAYOUT
        // — that arm is the one that fails if the conjunct goes missing. Until a call site can
        // supply `channel: 'detonation'`, the second term is unreachable from any test.
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
 * Site 2 of the leech-channel class (spec §3): a standing damage-dealt leech pays out on a
 * POSITIONAL bomb / accumulator burst.
 *
 * WAS A TRIPWIRE, NOW A REGRESSION TEST. `applyPositionedTimedBurst` applied burst damage via
 * `applyVictimDamage` inside `processBombs`' `creditDetonation` callback and never reached a leech
 * proc, so the burst channel paid NOTHING regardless of the leech's scope — a regression against
 * the pre-positional path, which paid via `creditDamage(sourceId, 'detonation', damage)`.
 *
 * BOTH scopes are asserted, because the gap was channel-wide rather than scope-specific:
 *   • `leechScope:'detonation'` (Valkyrie's shape) — pays ONLY here, so this is its only payout.
 *   • `leechScope:'all'` (Magnolia, Valerian, the Leech gear set) — production-reachable, and the
 *     reason this was a user-facing bug rather than a corpus-inert one.
 *
 * The incoming direction is deliberately NOT asserted: a burst does not proc the victim's
 * damage-taken leech (owner ruling, spec §2.2 — Malvex reads "directly damaged as a primary
 * target"). That is why this site calls the standing proc directly and never
 * `procLeechesForVictim`.
 */
describe('Site 2 — a standing leech pays out on a positional bomb burst', () => {
    it.each([
        ['detonation' as const, 1200],
        ['all' as const, 1200],
    ])('a %s-scoped 20%% leech credits %d off a 6000 burst', (scope, expected) => {
        idc = 0;
        // enemy-back at M2 is outside the Line-Range-1 firing footprint (M4 + M3), so nothing but
        // the burst touches it. A timed bomb applied by the focus: 2 stacks × 3000 = 6000,
        // countdown 1 → bursts at enemy-back's own turn-start in round 1. A 20% leech on 6000
        // dealt → directHeal 1200 (crit 0 / healModifier 0 → no fold).
        const result = runCombat(
            BASE({
                shipSkills: { slots: [basicSlot(), leechSlot(20, scope)] },
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

        // ANTI-VACUITY, load-bearing: the burst really landed on the positioned enemy. Without it
        // a zero payout would be indistinguishable from "no detonation happened".
        expect(result.rounds[0].perTargetDamage?.['enemy-back']).toBe(6000);
        // ANTI-VACUITY: attack 0 → the firing hit dealt nothing, so no direct-channel leech can
        // contribute and the whole figure below is the burst leech.
        expect(result.rounds[0].perTargetDamage?.['enemy-front']).toBe(0);

        expect(sumHeal(result, 'directHeal', 'attacker')).toBeCloseTo(expected, 6);
    });
});

/**
 * Site 3 of the leech-channel class (spec §3): a standing leech pays out on a DoT ticking the
 * HEAL TARGET.
 *
 * THE DEFECT. The heal-target branch of the per-victim DoT-tick prologue is preserved verbatim from
 * the pre-positional engine: its `credit` callback signature is `(_sourceId, _dotType, damage)` —
 * it DISCARDS the applier and sums only into `tankDotDamage`, so by the time
 * `applyIncomingToTarget` books the aggregate there is no source left to pay. Instance 1 (the
 * sibling `else` branch, every non-heal-target victim) was fixed in SP-4b-2b Task 2b; this branch
 * was left behind, and it had no test at all — which is why a sweep driven only by the burst
 * tripwire would have missed it.
 *
 * TEAM SYMMETRY (spec §5): this branch is structurally player-only — `healTarget` is a player
 * concept — and its enemy-side counterpart IS instance 1, already covered by the PLAYER/ENEMY pair
 * at the top of this file. So the applier here is an ENEMY leeching off a DoT on the player tank,
 * which is the direction that was unreachable.
 *
 * TURN ORDER (fixture correction vs. the task-brief draft): the focus 'attacker' (the heal target)
 * acts BEFORE the speed-1 enemy each round, so at the focus's OWN turn-start in round 1,
 * `lastTurnCtxByActor.get('enemy-front')` is still unset (enemy-front hasn't had a turn yet) and
 * `tickDoTs` skips the entry entirely — exactly the ctx-availability gap the ENEMY-side sibling test
 * above documents for the identical reason. `numRounds: 2` is required so the tick lands at the
 * focus's turn-start in round 2, once enemy-front's round-1 turn has set its ctx.
 *
 * ANTI-VACUITY (deviates from `dealtBy`, and why). Unlike every other site in this file, this
 * branch's `credit` callback ONLY ever accumulates into `tankDotDamage`; `applyIncomingToTarget`
 * is then called with no `killerId`/`sourceId` at all
 * (`applyIncomingToTarget(tankDotDamage, healTarget, { byDirectDamage: false })`), and no call
 * anywhere in this branch ever reaches `creditDealt`. So `perTargetDealt` (`dealtBy`) and
 * `perTargetDamage` are BOTH structurally silent for this branch — verified empirically by running
 * this exact fixture with the Step-3 fix applied and confirming `dealtBy(result.rounds,
 * 'enemy-front')` still reads 0. That is a genuine, separate, pre-existing attribution gap in the
 * heal-target branch (it never received the sibling branch's SP-F F1 `tickDealtBySource` /
 * `creditDealt` reshape) — NOT something this leech-channel fix (spec §3) can or should paper over;
 * wiring `creditDealt` into this branch would ripple `perTargetDealt` entries into every
 * healing-mode fixture with an enemy DoT on the tank, leech or not, which is a much wider blast
 * radius than this task's scope. Flagged for a follow-up task rather than fixed here.
 *
 * The load-bearing "it really landed, attributed to the right owner" proof instead uses the
 * healing display's own `incomingDamage`, fed by the SAME `credit` callback's `tankDotDamage`
 * accumulator via `applyIncomingToTarget` → `sink.addIncoming` — an independent bookkeeping write
 * from the leech's `healingCtx.credit`, so it still rules out "the 100 came from nowhere real":
 * round 0 must show NOTHING (ctx not ready) and round 1 must show EXACTLY the tick's 500. Attribution
 * to the right OWNER is then closed by construction (only `enemy-front` carries any DoT or leech
 * against the tank in this fixture) and reinforced by asserting the focus's OWN bucket — which
 * would catch a `sourceId` mix-up in `procStandingLeechesPerVictim` — stays at 0.
 */
describe('Site 3 — a standing leech pays out on a DoT ticking the heal target', () => {
    it('an enemy’s standing leech pays out on its corrosion ticking the player heal target', () => {
        idc = 0;
        // The focus 'attacker' at M4 is the heal target, maxHp 10000. `enemy-front` carries a 20%
        // standing 'all' leech in its passive slot and has applied corrosion tier 5 / 1 stack to
        // the focus. The tick (1 × 0.05 × 10000 = 500) lands at the focus's turn-start in round 2
        // (see the TURN ORDER note above). The enemy's leech must credit directHeal
        // 500 × 0.20 = 100 to ITSELF (target:'self').
        const result = runCombat(
            BASE({
                hp: 10000,
                numRounds: 2,
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000, [basicSlot(), leechSlot(20)]),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'attacker')
                        ?.corrosionEntries.push(corrosion(5, 1, 5, 'enemy-front'));
                },
            })
        );

        // ANTI-VACUITY, load-bearing (see the class comment above for why this is `incomingDamage`
        // and not `dealtBy`): round 0 has no tick at all (enemy-front's ctx isn't ready yet), round
        // 1 has EXACTLY the 500 tick and nothing else (enemy-front's own basic attack is attack:0).
        const incomingByRound = (result.healing?.rounds ?? []).map((rd) => rd.incomingDamage);
        expect(incomingByRound[0]).toBe(0);
        expect(incomingByRound[1]).toBe(500);
        // ANTI-VACUITY: the focus's own bucket stays at 0 — a `sourceId` mix-up inside
        // `procStandingLeechesPerVictim` (crediting the victim instead of the applier) would show
        // up here instead of leaking silently.
        expect(sumHeal(result, 'directHeal', 'attacker')).toBe(0);

        expect(sumHeal(result, 'directHeal', 'enemy-front')).toBeCloseTo(100, 6);
    });
});
