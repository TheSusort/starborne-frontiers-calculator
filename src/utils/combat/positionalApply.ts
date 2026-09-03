import type { Position } from '../../types/encounters';
import type { ParsedPattern, ParsedTarget } from '../targetingParser';
import { resolveCells, type CellRole } from '../targeting/resolvePattern';
import { resolvePositionalTarget, type ActorTargetingStatus } from './positionalBinding';
import {
    victimHitDamageParts,
    victimDefenceMitigation,
    type AttackerDamageScalars,
    type VictimDefenseProfile,
} from './victimDamage';
import type { CombatActor } from './state';

/**
 * One footprint cell that landed on a living opposing actor.
 * `roleScale` is the per-cell damage multiplier: origin cells deal full damage
 * (1.0), covered/splash cells deal half (0.5).
 */
export interface FootprintHit {
    victim: CombatActor;
    /** origin → 1.0, covered (any non-origin role) → 0.5 */
    roleScale: number;
}

/**
 * The per-hit damage resolution outcome surfaced by the engine's victim-apply wrappers
 * (`applyIncomingToTarget` / `applyOutgoingToEnemy`, E1 — symmetric incoming surface):
 * the victim's shield pool BEFORE the hit, the HP damage that actually landed after
 * shield/Barrier absorption, and whether a Barrier fully absorbed the hit. E2 plumbs this
 * through `applyPositionalDamage` so per-direction leech can read it per footprint victim.
 */
export interface VictimDamageOutcome {
    shieldBefore: number;
    hpDamage: number;
    barriered: boolean;
    /** `Shield Converter` nullified this hit and deposited it into the victim's shield pool instead
     *  of letting it land. Structurally excludes a converted hit from `shieldWasHit` detection at
     *  every consumer site, the same way `barriered` excludes a Barrier-nullified hit and
     *  `transformedToDot` excludes a Hit-Mitigation-transformed one: a converted hit's `shieldBefore`
     *  is deliberately reported as the PRE-deposit pool (see `shieldPoolBeforeConversion` in
     *  `applyVictimDamage`), so without this flag `shieldBefore > 0 && hpDamage < damage` still reads
     *  TRUE whenever the victim already held ANY shield before the conversion — its normal state for
     *  a unit that grants itself shield every turn (e.g. Quixilver). Absent/false for every other hit. */
    converted?: boolean;
    /** Voron/Orel: the portion of this hit that was CONVERTED into a Damage-over-Time
     *  effect instead of landing as damage this turn (the converted amount arrives over time via
     *  DoT ticks, which book their own per-victim increments). Absent/0 for every normal hit.
     *
     *  Already netted out of {@link incomingBooked}, so a caller booking a damage-taken credit does
     *  NOT subtract this itself — read it only to ASK whether a hit was converted (the `attacked`
     *  suppression in `onVictimResolved` does exactly that). */
    transformedToDot?: number;
    /** THE per-victim damage-taken credit: the exact net amount this application recorded into the
     *  victim's `.incoming` bucket (`perActorIncoming[victim].incoming`).
     *
     *  Every caller that books a per-victim display amount — `emitHit` here, and the engine's
     *  Protection-transfer / reflect / counter / reactive-damage / bomb-splash sites — books THIS,
     *  which makes the reconciliation identity hold by construction:
     *
     *      Σ perTargetDealt[attacker] == Σ perTargetDamage == Σ perActorIncoming[].incoming
     *
     *  It is the funnel's own number, so it already accounts for everything the funnel does to a
     *  hit before recording it, in one value instead of one subtraction per mechanism at every
     *  call site: an incoming-block proc shaving it, a Protection cascade diverting a chunk to an
     *  ally, and a transform deferring it into a self-DoT (which reverses the `.incoming` it just
     *  recorded — the deferred amount is booked later, per tick, by the DoT path). A
     *  Barrier-nullified hit IS booked here, matching `.incoming`.
     *
     *  Absent only on outcomes from callers that don't set it (test stubs of `applyToVictim`);
     *  `applyVictimDamage` always sets it — see {@link AppliedVictimDamage}. */
    incomingBooked?: number;
    /** The portion of this hit a Protection cascade diverted to
     *  protecting allies, summed across protectors and measured as the intake the funnel actually
     *  RECORDED on each (`incomingBooked` per sub-hit), so a protector's own incoming-block or
     *  DoT-transform is already netted out.
     *
     *  Deliberately NOT part of {@link incomingBooked}: that is THIS victim's own booked intake, and
     *  the diverted chunk is booked on each protector's row instead — folding it in here would
     *  double-count it and break the `Σ perTargetDealt[attacker] == Σ perTargetDamage` identity.
     *
     *  Exists so a sub-attack can reconstruct the FULL amount the attack delivered (protector damage
     *  + target remainder), which is the locked basis for damage-proportional effects like
     *  Bloodthirst. Absent when no cascade fired. */
    protectionRedirected?: number;
}

/** {@link VictimDamageOutcome} as returned by the engine's real apply funnel, where
 *  {@link VictimDamageOutcome.incomingBooked} is guaranteed. Lets the engine-internal booking
 *  sites read it without a fallback while the injected-callback interface above stays satisfiable
 *  by a minimal stub. */
export type AppliedVictimDamage = VictimDamageOutcome & { incomingBooked: number };

/**
 * The outcome of ONE sub-attack — one iteration of `applyPositionalDamage`'s hit loop.
 *
 * A multi-hit skill is N consecutive FULL-WALK attacks (locked game rule: Enforcer critting on
 * every sub-attack inflicts N Defense Shred stacks), so the sub-attack — not the cast and not the
 * (hit, victim) pair — is the unit that outgoing effects resolve against. Its AoE footprint is
 * ONE attack's spread and shares a single outgoing roll.
 *
 * Emitted for EVERY iteration including whiffs, so `subAttacks[h]` always corresponds to loop
 * iteration `h`.
 *
 * The engine turns each NON-EMPTY entry into its own `ability-performed`.
 * See docs/superpowers/specs/2026-08-07-multi-hit-full-walk-attacks-design.md.
 */
export interface SubAttackOutcome {
    /** 0-based index within the cast. Always equals this entry's position in the array. */
    index: number;
    /** The anchor failed to resolve — this sub-attack landed nothing (no victims, no damage). */
    whiffed: boolean;
    /** At least one victim of THIS sub-attack critted. */
    didCrit: boolean;
    /**
     * Sum of `incomingBooked` across this sub-attack's footprint victims — the funnel's own
     * recorded intake, the same basis `emitHit` books. NOT the computed pre-funnel hit: a
     * Protection cascade, incoming-block proc or DoT transform alters what actually landed.
     */
    damage: number;
    /**
     * What this sub-attack actually DELIVERED — {@link damage} plus every victim's
     * `protectionRedirected`. The locked basis for damage-proportional outgoing effects
     * (Bloodthirst): the heal counts the damage dealt to the protector AND the remainder left on
     * the original target.
     *
     * Differs from {@link damage} only when a Protection cascade fired. Both deliberately exclude a
     * DoT-transformed portion (ruled: "if dot, no heal") and an incoming-block shave, and both
     * deliberately INCLUDE shield-absorbed damage, because {@link incomingBooked} — this field's
     * own basis — is recorded before the shield/HP split.
     *
     * This is a SUM over every footprint victim of this sub-attack, critting or not — an AoE that
     * crits one victim and not another still contributes both victims' shares to one total. The
     * per-victim outcome in that mixed-crit case (should a non-critting victim's share count at
     * all, or count differently?) has NOT been verified in-game; today it is folded into the sum
     * unconditionally. A future PR may need to reverse this if that verification lands otherwise.
     *
     * NOT the combat log's number: the log's primary-target amount reads `ability-performed.damage`
     * (the cast's pre-funnel `directDamage`), which this field leaves untouched.
     */
    deliveredDamage: number;
    /** Victims struck by this sub-attack, in footprint order. */
    victimIds: string[];
    /**
     * The victims THIS sub-attack critically hit, in footprint order.
     *
     * The per-sub-attack slice of the cast-wide `critVictimIds`/`critPairs` pair: a victim appears
     * at most once per sub-attack (one footprint cell each), so this list's LENGTH is also this
     * sub-attack's critting-(victim) count and Σ over the cast reproduces `critPairs` exactly.
     * The engine carries it on each sub-attack's own `ability-performed` as `critHits`/`critVictimIds`,
     * so `on-crit` counts one attack's crits rather than the whole cast's.
     */
    critVictimIds: string[];
}

/** Per-cell damage scale keyed off the resolved CellRole. */
const roleScaleFor = (role: CellRole): number => (role === 'origin' ? 1.0 : 0.5);

/**
 * Expand a positional pattern footprint into the list of living victims it hits.
 *
 * PURE helper. Given a parsed pattern, the resolved anchor position, and the living
 * opposing roster, returns one {@link FootprintHit} per occupied footprint cell with
 * its role scale. Empty cells contribute nothing; dead actors are not in the roster
 * map and so are never hit.
 *
 * `not-self` patterns produce only non-origin (covered) cells — the scale is keyed off
 * the resolved `role`, never off whether the cell equals the anchor.
 */
export function footprintVictims(
    pattern: ParsedPattern,
    anchor: Position,
    opposingLiving: CombatActor[]
): FootprintHit[] {
    // Mirror positionalBinding.byCell: living, positioned actors, ≤1 per cell.
    const byCell = new Map<Position, CombatActor>();
    for (const a of opposingLiving) {
        if (a.position !== undefined && a.currentHp > 0) {
            byCell.set(a.position, a);
        }
    }

    const hits: FootprintHit[] = [];
    for (const { position, role } of resolveCells(pattern, anchor)) {
        const victim = byCell.get(position);
        if (!victim) continue; // empty cell: contributes nothing
        hits.push({ victim, roleScale: roleScaleFor(role) });
    }
    return hits;
}

/**
 * Per-hit positional damage driver with live re-resolution.
 *
 * Drives `scalars.hits` discrete hits of one skill. For EACH hit it re-resolves the anchor and
 * re-expands the footprint against the LIVE `opposingLiving` roster — so when a victim
 * dies mid-skill (its `currentHp` drops to 0 inside `applyToVictim`), it disappears from
 * the roster and later hits redirect to the next living target automatically. This is the
 * heart of the task: target resolution and footprint expansion MUST run inside the loop.
 *
 * The per-hit loop count is `scalars.hits` — the SAME field victimHitDamage reads to re-split
 * the folded multiplier, keeping hit count from a single canonical source.
 *
 * Whiff (spec §5.1): if `resolvePositionalTarget` returns `null` for a hit (no living
 * opposing actor resolvable — e.g. everything died), that hit lands nothing: no
 * `applyToVictim`, no `emitHit`.
 *
 * PURE module: `applyToVictim` / `emitHit` are injected callbacks; this file imports no
 * engine state.
 *
 * @returns `anyCrit` — true if at least one (hit, victim) pair critted this call;
 *          `critPairs` — the count of critting (hit, victim) pairs;
 *          `critVictimIds` — the DISTINCT victims that took at least one critting hit, in
 *          first-crit order. Carries the per-victim crit IDENTITY that `critPairs` (a bare
 *          count) throws away, so an `on-ally-crit` reactive can route "that enemy" to the
 *          enemies actually crit rather than the cast's selected anchor;
 *          `subAttacks` — one {@link SubAttackOutcome} per loop iteration, in order, including
 *          whiffs. Carries the SUB-ATTACK identity that `critPairs` also throws away (it
 *          multiplies hits × victims into one number). The engine emits one
 *          `ability-performed` per non-empty sub-attack off these entries.
 */
export function applyPositionalDamage(args: {
    hitCrits: boolean[];
    scalars: AttackerDamageScalars;
    pattern: ParsedPattern;
    actorPosition: Position;
    target: ParsedTarget;
    /** The live roster; re-read each hit (it mutates as victims die). */
    opposingLiving: CombatActor[];
    statusOf?: (id: string) => ActorTargetingStatus | undefined;
    acting?: { ignoresForcedTargeting?: boolean; ignoresStealth?: boolean; provokedBy?: string };
    defenseProfileOf: (v: CombatActor) => VictimDefenseProfile;
    /**
     * SUB-ATTACK INDEX. Every per-victim callback below
     * takes a trailing optional `subAttackIndex` — the 0-based index of the sub-attack currently
     * resolving. Trailing and optional so existing engine call sites compile unchanged and JS
     * drops the extra argument, exactly as `isAnchor` was introduced. Every footprint victim of
     * ONE sub-attack sees the SAME index: an AoE footprint is one attack's spread, whereas each
     * multi-hit sub-attack is a separate attack.
     */
    /**
     * Engine wrapper — decrements the victim's currentHp (the engine passes applyOutgoingToEnemy)
     * and returns the resolved {@link VictimDamageOutcome} (shield-before / HP-damage / barriered).
     * The third param is `isAnchor` — true when this victim IS the attacker's
     * resolved anchor/primary target, false for a covered/splash footprint victim (Nosorog's
     * "reflects damage taken … as a PRIMARY TARGET" requirePrimaryTarget gate). Optional so
     * a caller that omits it keeps compiling unchanged (JS simply drops the extra arg).
     */
    applyToVictim: (
        victim: CombatActor,
        damage: number,
        isAnchor?: boolean,
        subAttackIndex?: number,
        /**
         * The DEFENCE mitigation factor already folded into `damage` for THIS victim
         * (`victimDefenceMitigation(defenseProfileOf(victim), scalars.defensePenetrationPct)`).
         * Handed down rather than re-derived downstream so the engine's Protection cascade can
         * recover the pre-defence amount by dividing by the factor that was actually applied —
         * a re-derivation from the victim's live stats omits the attacker's penetration and
         * reads a buff-folded defence the caller never used. Trailing and optional so existing
         * stub callers compile unchanged.
         */
        targetMitigation?: number,
        /**
         * #358 ADDENDUM 2: the PRE-defence-mitigation amount this hit threw at the victim — the
         * same computation as `damage` with the defence term removed. Recorded by the funnel as
         * the victim's RAW intake so "damage absorbed" counts damage thrown, not damage that got
         * through. Trailing and optional so existing stub callers compile unchanged.
         */
        preMitigation?: number
    ) => VictimDamageOutcome;
    emitHit?: (
        victim: CombatActor,
        damage: number,
        didCrit: boolean,
        subAttackIndex?: number
    ) => void;
    /**
     * OPTIONAL per-victim hook (E2 — per-victim leech). Invoked once per footprint victim AFTER
     * the hit resolves, with the resolved {@link VictimDamageOutcome}. Direction-specific leech
     * logic is supplied per call site (standing vs taken) rather than branched inline. Unsupplied
     * → fully inert.
     *
     * ⚠️ `damage` IS THE HIT AS THROWN, NOT WHAT LANDED. It is the computed per-victim hit, handed
     * down before the funnel recorded anything: a Protection cascade may have moved a slice to a
     * protector, an incoming-block proc may have shaved one, a transform may have deferred the
     * whole thing into a DoT. A consumer that needs a damage-proportional BASIS must derive it from
     * `outcome` — {@link VictimDamageOutcome.incomingBooked} for what this victim took, plus
     * {@link VictimDamageOutcome.protectionRedirected} for what the attacker dealt elsewhere. It is
     * left as the raw hit because the hook's other consumers legitimately want it: the `attacked`
     * suppression asks only WHETHER a transform fired, not for a magnitude.
     */
    onVictimResolved?: (
        victim: CombatActor,
        damage: number,
        outcome: VictimDamageOutcome,
        didCrit: boolean,
        subAttackIndex?: number
    ) => void;
    /**
     * OPTIONAL per-sub-hit incoming %-reduction hook. Invoked per footprint victim with
     * that victim's per-hit crit outcome; the returned percentage points are folded additively
     * into the incoming term of {@link victimHitDamage}. Unsupplied → 0 (inert for victims
     * without an incoming-reduction ability).
     *
     * #358 ADDENDUM 3: the channel is MIXED, so the hook may return the SPLIT instead of a single
     * number. A bare `number` keeps its original meaning — entirely VICTIM-side, which is what
     * every non-crit hit and every direct-call test supplies. The object form separates out the
     * ATTACKER-side half (`attackerSidePct`, today the attacker's own squad-leader
     * `outgoingCritDamage` penalty), which shrinks the attack AS THROWN and must therefore stay on
     * BOTH damage axes rather than being stripped from the pre-mitigation one as collateral.
     */
    incomingReductionFor?: (
        victim: CombatActor,
        didCrit: boolean,
        subAttackIndex?: number
    ) => number | { victimSidePct: number; attackerSidePct: number };
    /**
     * OPTIONAL per-hit attacker-side outgoing amplification % hook (Menace/Giant Slayer).
     * Invoked per footprint victim with that victim's per-hit crit outcome; the returned percentage
     * is applied multiplicatively on the resolved hit BEFORE {@link applyToVictim}. Unsupplied → 0
     * (inert for attackers without an outgoing-amplification ability).
     */
    outgoingAmplificationFor?: (
        victim: CombatActor,
        didCrit: boolean,
        subAttackIndex?: number
    ) => number;
    /**
     * OPTIONAL per-victim crit resolver.
     * The anchor victim (the resolved target, `victim.id === anchorActor.id`) reuses
     * hitCrits[h]; each other footprint victim resolves via this callback.
     * Unsupplied → every victim uses hitCrits[h].
     */
    rollVictimCrit?: (victim: CombatActor, subAttackIndex?: number) => boolean;
    /**
     * Boundary hooks for ONE sub-attack. `onSubAttackStart`
     * runs after the anchor resolves and BEFORE any of that sub-attack's damage; `onSubAttackEnd`
     * runs after ALL of it. A WHIFF (no living anchor) calls neither — there is no attack to hang a
     * clause on — but still consumes its loop index, so `subAttacks[h]` stays aligned.
     *
     * They exist so a direct debuff clause can land per sub-attack, in written clause order
     * relative to that sub-attack's own damage, and be visible to the NEXT sub-attack's
     * `defenseProfileOf` read. Both optional: an unsupplied hook is simply not called.
     *
     * `victimIds` is this sub-attack's footprint in hit order — the anchor plus every covered
     * cell — and is the set the engine re-rolls the landing against. Overkill retargeting is correct for
     * free: the anchor is re-resolved against the live roster at the top of every iteration, so a
     * victim killed on an earlier sub-attack simply is not here.
     */
    onSubAttackStart?: (sub: { index: number; anchorId: string; victimIds: string[] }) => void;
    onSubAttackEnd?: (sub: { index: number; anchorId: string; victimIds: string[] }) => void;
}): {
    anyCrit: boolean;
    critPairs: number;
    critVictimIds: string[];
    subAttacks: SubAttackOutcome[];
} {
    const {
        hitCrits,
        scalars,
        pattern,
        actorPosition,
        target,
        opposingLiving,
        statusOf,
        acting,
        defenseProfileOf,
        applyToVictim,
        emitHit,
        onVictimResolved,
        incomingReductionFor,
        outgoingAmplificationFor,
        rollVictimCrit,
        onSubAttackStart,
        onSubAttackEnd,
    } = args;

    let anyCrit = false;
    let critPairs = 0;
    // Insertion-ordered DISTINCT crit victims. A multi-hit cast that crits the same victim twice
    // lists it once — "deals X to that enemy" is per ENEMY, not per critting (hit, victim) pair.
    const critVictims = new Set<string>();
    const subAttacks: SubAttackOutcome[] = [];

    // Canonical hit count: derive the loop count from `scalars.hits` (the single source of
    // truth that victimHitDamage also reads), avoiding silent under/over-application from a
    // divergent separate `hits` arg.
    for (let h = 0; h < scalars.hits; h++) {
        // Re-resolve the anchor against the LIVE roster (a victim killed on an earlier hit
        // is already gone from opposingLiving via currentHp === 0 filtering).
        const anchorActor = resolvePositionalTarget(
            actorPosition,
            target,
            opposingLiving,
            statusOf,
            acting
        );
        if (anchorActor === null || anchorActor.position === undefined) {
            // WHIFF — no living target resolvable for this sub-attack. Skip entirely, but still
            // record an entry so `subAttacks[h]` stays aligned with the loop index.
            subAttacks.push({
                index: h,
                whiffed: true,
                didCrit: false,
                damage: 0,
                deliveredDamage: 0,
                victimIds: [],
                critVictimIds: [],
            });
            continue;
        }

        const anchorCrit = hitCrits[h] ?? false;
        let subDidCrit = false;
        let subDamage = 0;
        let subDelivered = 0;
        const subVictimIds: string[] = [];
        const subCritVictimIds: string[] = [];

        const footprint = footprintVictims(pattern, anchorActor.position, opposingLiving);
        const subVictimIdsForHooks = footprint.map((f) => f.victim.id);
        onSubAttackStart?.({
            index: h,
            anchorId: anchorActor.id,
            victimIds: subVictimIdsForHooks,
        });
        for (const { victim, roleScale } of footprint) {
            // Anchor reuses the pre-rolled hitCrits[h]; covered victims resolve via callback.
            const isAnchor = victim.id === anchorActor.id;
            const didCrit = isAnchor ? anchorCrit : (rollVictimCrit?.(victim, h) ?? anchorCrit);
            if (didCrit) {
                anyCrit = true;
                critPairs += 1;
                critVictims.add(victim.id);
                subDidCrit = true;
                subCritVictimIds.push(victim.id);
            }
            // #358: unpack the (possibly split) reduction. A bare number is 100% victim-side,
            // which is what a direct-call site that supplies no split means.
            const reductionParts = incomingReductionFor?.(victim, didCrit, h) ?? 0;
            const equipReductionPct =
                typeof reductionParts === 'number' ? reductionParts : reductionParts.victimSidePct;
            const attackerSideReductionPct =
                typeof reductionParts === 'number' ? 0 : reductionParts.attackerSidePct;
            // Read the profile ONCE and derive both the hit and the mitigation factor from it, so
            // the factor handed to `applyToVictim` is provably the one baked into `dmg`.
            const defenseProfile = defenseProfileOf(victim);
            // ONE call, both figures. Calling `victimHitDamage` and a separate pre-mitigation
            // helper would repeat the whole assembly — the same profile read, the same affinity
            // resolve — on the hottest path in the engine, and would leave the two figures as
            // numbers that merely ought to agree rather than one evaluation.
            const { damage: dmgBase, preMitigation: rawBase } = victimHitDamageParts(
                scalars,
                defenseProfile,
                didCrit,
                roleScale,
                equipReductionPct,
                attackerSideReductionPct
            );
            const ampPct = outgoingAmplificationFor?.(victim, didCrit, h) ?? 0;
            const dmg = ampPct !== 0 ? dmgBase * (1 + ampPct / 100) : dmgBase;
            const rawDmg = ampPct !== 0 ? rawBase * (1 + ampPct / 100) : rawBase;
            const outcome = applyToVictim(
                victim,
                dmg,
                isAnchor,
                h,
                victimDefenceMitigation(defenseProfile, scalars.defensePenetrationPct),
                rawDmg
            );
            // Credit the victim the intake the funnel actually RECORDED for it, not the hit we
            // computed. The two differ whenever the funnel altered the hit before recording it: a
            // Protection cascade diverted a chunk to an ally (booked on that ally's own row by the
            // transfer site — crediting it here too would count it twice and inflate the attacker's
            // damage-dealt past the hit it landed), an incoming-block proc shaved it, or a
            // transform (Voron/Orel, Hit Mitigation) deferred it into a DoT that books its own
            // increment per tick. See `incomingBooked`'s doc for the identity this preserves.
            //
            // Fallback keeps the previous shape for a caller that supplies no `incomingBooked` —
            // only test stubs of `applyToVictim`; the engine's own funnel always sets it.
            const booked = outcome.incomingBooked ?? dmg - (outcome.transformedToDot ?? 0);
            emitHit?.(victim, booked, didCrit, h);
            onVictimResolved?.(victim, dmg, outcome, didCrit, h);
            subDamage += booked;
            // The FULL amount this hit delivered. `booked` is the victim's own intake, which
            // excludes anything a Protection cascade diverted to protectors; the ruled basis counts
            // both. A DoT-transformed portion is already netted out of `booked` and is correctly
            // absent here too.
            subDelivered += booked + (outcome.protectionRedirected ?? 0);
            subVictimIds.push(victim.id);
        }

        onSubAttackEnd?.({
            index: h,
            anchorId: anchorActor.id,
            victimIds: subVictimIdsForHooks,
        });

        subAttacks.push({
            index: h,
            whiffed: false,
            didCrit: subDidCrit,
            damage: subDamage,
            deliveredDamage: subDelivered,
            victimIds: subVictimIds,
            critVictimIds: subCritVictimIds,
        });
    }
    return { anyCrit, critPairs, critVictimIds: [...critVictims], subAttacks };
}
