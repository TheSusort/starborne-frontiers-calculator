import { Buff, SelectedGameBuff } from '../../types/calculator';
import type { AbilityStatusPayload, ActiveBuff } from './statusEngine';
import { deriveFamilyKey, familyChallengerWins } from './statusEngine';

// ---------------------------------------------------------------------------
// Leaf helpers shared by the player turn (playerTurn.ts) and the effective-stat
// fold (effectiveStats.ts). Kept in this dependency-free module so neither caller
// has to import the other — breaking the playerTurn ⇄ effectiveStats import cycle.
// ---------------------------------------------------------------------------

/**
 * Fold a flat Buff[] into the additive-percentage totals the damage/heal and
 * effective-stat (effectiveStats.ts) pipelines consume. Pure: each channel sums
 * the matching-stat buff values.
 * NOTE: hotPct is intentionally NOT summed here — HoTs need per-status applier
 * identity, so those statuses are read directly downstream.
 */
export function calculateBuffTotals(buffs: Buff[]) {
    const attackBuff = buffs
        .filter((b) => b.stat === 'attack')
        .reduce((sum, b) => sum + b.value, 0);
    const critBuff = buffs.filter((b) => b.stat === 'crit').reduce((sum, b) => sum + b.value, 0);
    const critDamageBuff = buffs
        .filter((b) => b.stat === 'critDamage')
        .reduce((sum, b) => sum + b.value, 0);
    const outgoingDamageBuff = buffs
        .filter((b) => b.stat === 'outgoingDamage')
        .reduce((sum, b) => sum + b.value, 0);
    const defenceBuff = buffs
        .filter((b) => b.stat === 'defence')
        .reduce((sum, b) => sum + b.value, 0);
    const hpBuff = buffs.filter((b) => b.stat === 'hp').reduce((sum, b) => sum + b.value, 0);
    const outgoingHealBuff = buffs
        .filter((b) => b.stat === 'outgoingHeal')
        .reduce((sum, b) => sum + b.value, 0);
    const incomingHealBuff = buffs
        .filter((b) => b.stat === 'incomingHeal')
        .reduce((sum, b) => sum + b.value, 0);
    const speedBuff = buffs.filter((b) => b.stat === 'speed').reduce((sum, b) => sum + b.value, 0);
    const hackingBuff = buffs
        .filter((b) => b.stat === 'hacking')
        .reduce((sum, b) => sum + b.value, 0);
    const securityBuff = buffs
        .filter((b) => b.stat === 'security')
        .reduce((sum, b) => sum + b.value, 0);
    const attackFlatBuff = buffs
        .filter((b) => b.stat === 'attackFlat')
        .reduce((sum, b) => sum + b.value, 0);
    return {
        attackBuff,
        critBuff,
        critDamageBuff,
        outgoingDamageBuff,
        defenceBuff,
        hpBuff,
        outgoingHealBuff,
        incomingHealBuff,
        speedBuff,
        hackingBuff,
        securityBuff,
        attackFlatBuff,
    };
}

// Expand an active buff/debuff into its underlying SelectedGameBuff effects.
// Accumulating buffs override their static stacks with the per-round count and
// drop out entirely when at zero stacks; non-accumulating ones pass through.
export function expandBuffEntry(ab: ActiveBuff, bufs: SelectedGameBuff[]): SelectedGameBuff[] {
    if (ab.stacks !== undefined) {
        return ab.stacks > 0 ? bufs.map((b) => ({ ...b, stacks: ab.stacks! })) : [];
    }
    return bufs;
}

/** Expand a victim's active enemy-debuff snapshot into SelectedGameBuff effects via the
 *  enemy-debuff lookup (applies the per-round stack override; drops zero-stack and unknown
 *  names). Shared by the engine's per-victim defense/incoming-damage sourcing (B1) and
 *  victimEnemyBuffs (triggers.ts). */
export function expandEnemyDebuffs(
    activeEnemyDebuffs: ActiveBuff[],
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>
): SelectedGameBuff[] {
    return activeEnemyDebuffs.flatMap((ab) =>
        expandBuffEntry(ab, enemyDebuffLookup.get(ab.buffName) ?? [])
    );
}

// Mirror toSimBuffs/toEnemyModifiers semantics for an ability-status payload: wrap it as
// a SelectedGameBuff so the existing buff-fold helpers apply (effect × stacks). The payload's
// own stacks (current count for accumulating; configured stacks otherwise) become the buff stacks.
export function payloadToSelectedBuff(payload: AbilityStatusPayload): SelectedGameBuff {
    // NOTE: the derived id `ability-${buffName}` is non-unique by design for duplicate buffNames
    // (only summed by stat downstream, never deduped by id).
    return {
        id: `ability-${payload.buffName}`,
        buffName: payload.buffName,
        stacks: payload.stacks,
        parsedEffects: payload.parsedEffects,
        isStackable: false,
        ...(payload.application ? { application: payload.application } : {}),
    };
}

/**
 * The INCOMING-REPAIR multiplier for a summed incoming-heal percentage, floored at 0 (#367 §3.4).
 *
 * WHY IT IS FLOORED. The summed percentage fed in is unclamped by construction. Under the locked
 * tier rule (R1: same-family statuses overwrite by highest tier, survivors add) only ONE
 * `Inc. Repair Down` can stand today, so the worst reachable value is −75% and the floor is a
 * no-op — this is a TRIPWIRE for the next incoming-repair reducer, not a fix for a live bug.
 * Nothing upstream stops a future second reducer from pushing the sum past −100%, and a factor
 * below 0 would flip the repair's SIGN.
 *
 * HP itself is safe either way: `applyHealToTarget` floors both of its paths (`Math.max(0,
 * Math.min(raw, deficit))` normally, `Math.max(0, raw)` under a #362 reversal), so a negative raw
 * can never move HP the wrong way. What an unfloored factor silently corrupts is the ACCOUNTING
 * built from that raw — `healing.credit(...)`, `healRawSum`, `heal-performed.amount` /
 * `perTarget[].amount`, the battle report's healing done/received, and a negative reported
 * `overheal` (`raw − 0` once the deficit clamp zeroes `consumed`). The guard is for the numbers a
 * reader would report, not for the bar.
 *
 * A fully-suppressed repair floors to 0, never damage: Reversed Repairs (#362) is the only
 * sanctioned repair-to-damage channel, and it is an explicit status, not a sign accident reached by
 * folding percentages past −100%.
 *
 * WHY IT LIVES IN THIS LEAF MODULE. It has SIX consumption sites across three files that import
 * each other in one direction only — `runPlayerTurn`'s player and `healEventOnly` cast arms and its
 * HoT tick (`playerTurn.ts`), the reactive-heal executor (`triggers.ts`), and the two per-victim
 * leech procs `procStandingLeechesPerVictim` / `procTakenLeechesPerVictim` (`engine.ts`, added by
 * #367 task 7 when the owner ruled a leech self-repair is a repair like any other). It was
 * originally a closure inside `runPlayerTurn` whose doc was honestly scoped to "this file's three
 * sites", which made it an INCOMPLETE tripwire: #367 routed `triggers.ts`'s `incomingPctFor`
 * through `liveHealChannelPct`, so for the first time that site could see an enemy-applied
 * reduction while being the only one not clamped. `buffTotals` is the leaf all three files already
 * import — the "import-cycle safe: … come from ./buffTotals (leaf module), not from ./playerTurn
 * (which imports triggers.ts)" note on `triggers.ts`'s `victimEnemyBuffs` is the same argument — so
 * a single definition serves all six without a cycle. A value import of `playerTurn` from
 * `triggers` would be one, which is why this did not simply get exported where it stood.
 *
 * HISTORICAL: two leech heal-apply sites in `engine.ts` were deliberately left unfolded here — the
 * aggregate `procStandingLeeches` and the non-positional heal-target taken-leech block — because
 * both were corpus-DEAD (measured with ungated probes across the whole suite; neither fired), so a
 * fold there would have been an unverifiable change to unexercised code. #374 DELETED both, so
 * there is no longer an unfolded site to account for.
 *
 * ⚠️ NO OUTGOING TWIN, DELIBERATELY. The outgoing channel (`Out. Repair Down`) is unfloored at
 * every one of its sites — `(1 + outgoingHealBuff / 100)` in both `playerTurn` cast arms and
 * `(1 + ownerOutgoing / 100)` in the reactive executor — so it is at least CONSISTENT today.
 * Flooring it in one of the three would rebuild exactly the partial tripwire this function exists
 * to remove. Its own reachability argument is the same shape (one tier-shadowed family,
 * `Out. Repair Down II` at −50%, so −100% is unreachable today). If a second outgoing reducer ever
 * ships, add the twin at ALL THREE sites in one change, not here first.
 */
export function incomingHealFactor(pct: number): number {
    return Math.max(0, 1 + pct / 100);
}

// ---------------------------------------------------------------------------
// CROSS-STORE TIER SHADOWING — #389 (the two outgoing channels) generalised to every
// channel with a cross-store meeting point by #396.
//
// OWNER RULING (LOCKED, and general — #396 spec §1; #389 spec §5 stated the same rule while
// scoping the code to two channels): the strongest single instance of a named family applies and
// weaker instances are shadowed, REGARDLESS OF WHICH SIDE APPLIED IT. An enemy carrying a
// self-inflicted `Attack Down I` (-15%) that your Curator hits with `Attack Down III` (-45%)
// throws at -45%: not -15%, and NOT the -60% sum. The ONLY exceptions are DoTs (`Corrosion`,
// `Inferno`) and bombs, which stack — and `deriveFamilyKey` already keeps them out by giving each
// tier its own family key, so nothing here needs to name them.
//
// WHY THIS NEEDED WRITING. Tier shadowing (`familyApplicationWins` in statusEngine.ts) is
// PER-STORE: it keys a family map inside one side's store, so it cannot see across the self/enemy
// boundary. Simply switching on a dead enemy-side channel would make the two instances ADD — which
// the ruling explicitly rules out, both because it makes two instances of one debuff worth more
// than one (contradicting the family's behaviour inside a single store) and because it puts -100%
// within accidental reach.
//
// ONE RULE, NOT TWO (spec §6, and #389's review). The comparison below is
// `statusEngine.familyChallengerWins` — the SAME predicate the engine's own within-store upsert
// uses: TIER first, tie-break second. The tie-break axis is the only thing that differs, and it
// has to: across the boundary there is no shared duration to compare on, so magnitude stands in
// for it. Comparing magnitude ALONE (which is what shipped first) is a genuinely different rule
// and diverges wherever stacks or duplicates invert the tier order — self `Attack Down I` at four
// stacks (-60) against an applied `Attack Down III` (-45) resolved to -60 under magnitude-only,
// which is both weaker-tier-wins AND the additive shape the ruling forbids.
//
// SCOPE — PER NAMED FAMILY, and no wider. `Attack Down` and `Out. Damage Down` are DIFFERENT
// families and still combine exactly as they always have; only same-family instances shadow.
// Collapsing across families would be a new defect, which is why the fold below is keyed by
// `deriveFamilyKey` and every channel is carried independently inside each entry.
//
// THE CHANNEL LIST IS THE AUDIT RESULT, not a guess (#396 spec §1.1). A channel belongs here iff
// an ENEMY-store read is combined with a SELF-store read of the SAME `parsedEffects` key:
//   • `attack` / `outgoingDamage` — `victimOwnEnemyOutgoingFamilies` vs the actor's own named
//     self statuses, combined in playerTurn's late fold (#389) AND, since #395, in
//     `effectiveOutgoingStatsOf` for the two attacks thrown outside the turn loop
//     (engine.ts's `applyCounterAttack` / `applyReactiveDamage`). TWO sites, one per path, and
//     they are mutually exclusive by construction: a reactive hit has no cast, so it never
//     reaches playerTurn's fold, and the turn loop never calls the accessor.
//   • `defense` / `incomingDamage` — `toEnemyModifiers(victimEnemyBuffs)` vs
//     `toSelfDefenseModifier`/`toSelfIncomingDamageModifier(victimSelfBuffs)`, combined in
//     engine.ts's `victimIncomingModifiers`.
//   • `incomingHeal` / `outgoingHeal` — `victimOwnEnemyHealModifiers` vs the same named self
//     statuses, combined in playerTurn's late fold (#367 folded them additively; #396 does not).
// Every OTHER channel was checked and has NO meeting point: `incomingDotDamage` is read from the
// enemy list only (`toDotAndPenModifiers`' `enemy` argument) and never from a self list;
// `dotDamage`, `detonationDamage`, `defensePenetration` and `hotPct` are read from the
// self/attacker list only.
//
// #398 CLOSED THE LAST FIVE. `crit`, `critDamage`, `speed`, `hacking` and `security` USED to fold
// exclusively through `foldActorBuffTotals`, whose sources were the SELF store and the scheduled
// `selfBuffLookup` — the enemy store was not among them, so those enemy-side channels were DEAD
// rather than additive. Measured (5 families, 17 corpus ships): they landed, displayed, ticked down
// and changed nothing. They now read the enemy store via `FOLD_SHADOW_CHANNELS` at the status-mode
// fold, and `crit`/`critDamage`/`security` additionally via `TURN_SHADOW_CHANNELS` at the
// damage-mode fold. `hp` remains dead, with no corpus applier to switch on.
//
// Adding a channel here without a meeting point is inert; adding one when a new meeting point
// appears is required — and `enemyStoreChannelCoverage.test.ts` is the tripwire that says so.
//
// REACHABILITY — it comes from the PICKERS, not from ship kits (#396 spec §1.3). A probe over all
// 149 corpus ships (335 buff/debuff-typed abilities) found ZERO families granted from both a
// self-targeted and an enemy-targeted ability, on every channel including the two #389 fixed. The
// straddle is user-reachable instead: `GameBuffPicker` excludes only `type: 'effect'`, so both
// buff- and debuff-typed entries are offered in the self-side AND enemy-side pickers, and its
// `toggleBuff` family-collapse is per-picker. So a FIXTURE for this rule must be built from buff
// LISTS; building one from ship kits produces no straddle and a vacuously green test.
// ---------------------------------------------------------------------------

/** The channels with a cross-store meeting point. See the audit note above — this list is a
 *  measurement of where an enemy-store read meets a self-store read, not a wish list. */
export const SHADOW_CHANNELS = [
    'attack',
    'outgoingDamage',
    'defense',
    'incomingDamage',
    'incomingHeal',
    'outgoingHeal',
    // #398 — the five channels that were DEAD on the enemy store until this change. They had no
    // enemy-store reader AT ALL (not an additive one), so switching them on is what CREATES the
    // cross-store meeting point that obliges shadowing here. See the design spec's per-channel
    // site table: `crit`/`critDamage`/`security` are folded at BOTH fold sites, `speed` and
    // `hacking` at the status-mode fold only.
    'crit',
    'critDamage',
    'speed',
    'hacking',
    'security',
] as const;
export type ShadowChannel = (typeof SHADOW_CHANNELS)[number];

/** #398: the channels `foldActorBuffTotals` (status mode) projects from the actor's OWN per-victim
 *  ENEMY store. EXACTLY the five with no enemy-store reader of their own — every other channel
 *  has one (`victimOwnEnemyFamilies`, `toEnemyModifiers`, `victimOwnEnemyHealModifiers`),
 *  so projecting one of those here would DOUBLE-COUNT, and `effectiveStatsOf(...).attack` /
 *  `.defence` are read all over engine.ts.
 *
 *  `hp` is deliberately absent. It is the sixth channel the #396 audit named dead, but no
 *  `HP Down`/`Max HP Down` family exists anywhere in `docs/ship-skills.csv`, so there is no
 *  applier to switch on — it stays dead, recorded on the tripwire's dead-list instead. */
export const FOLD_SHADOW_CHANNELS = [
    'crit',
    'critDamage',
    'speed',
    'hacking',
    'security',
] as const satisfies readonly ShadowChannel[];

/** #389's original pair, kept named so its call site and unit suite read unchanged. */
export const OUTGOING_CHANNELS = [
    'attack',
    'outgoingDamage',
] as const satisfies readonly ShadowChannel[];

/**
 * One named family's grip on ONE channel. Three numbers because the two sides of the
 * boundary need different ones (see `familiesOf`): the shadowing comparison reads
 * `pct`/`tier`, and the self side additionally needs `sum` to know what its own additive fold
 * already contains.
 */
export interface ChannelContribution {
    /** The STRONGEST instance's post-stacks magnitude — percentage points on every channel EXCEPT
     *  `hacking`/`security`, which are FLAT additive stat units (#398). The shadowing comparison is
     *  a pure magnitude comparison and so is unit-agnostic; one field serves both and the `pct`
     *  name is historical. 0 when the family, as read from this list, does not touch the channel
     *  at all. */
    pct: number;
    /** `deriveFamilyKey` tier of that strongest instance — 0 both for an un-suffixed name
     *  (`Overload`) and for an absent contribution, which is why `pct` decides the tie. */
    tier: number;
    /** Σ of EVERY instance's post-stacks magnitude on this channel (percentage points, or flat
     *  units for `hacking`/`security` — see `pct`) — i.e. exactly what an
     *  additive fold of the same list (`calculateBuffTotals`) puts into the totals. Equals `pct`
     *  whenever the list holds a single instance of the family, which is every corpus case. */
    sum: number;
}

/** One named family's contribution, per channel, in additive percentage points (flat units for
 *  `hacking`/`security`). Sparse: a channel the family does not touch is simply absent. */
export type FamilyEntry = Partial<Record<ShadowChannel, ChannelContribution>>;

/** familyKey (`deriveFamilyKey`) → that family's per-channel MAXIMUM (plus its sum). Not a total:
 *  see `familiesOf` for why the distinction is load-bearing on the self side. */
export type FamilyMap = Map<string, FamilyEntry>;

/** Per-channel percentage-point figures handed back by `shadowedDelta`. Sparse in the same way
 *  `FamilyEntry` is; read with `?? 0`. */
export type ChannelDeltas = Partial<Record<ShadowChannel, number>>;

export interface ShadowedDelta {
    /** ADD to the already-folded SELF-sourced total for that channel. For a family present only on
     *  the enemy side this is the whole enemy contribution (`own.sum` is 0), so the caller adds
     *  this INSTEAD OF the raw enemy sum, never as well as it. */
    delta: ChannelDeltas;
    /** The SELF-sourced contribution that the enemy side shadowed away, per channel. Needed only
     *  by a caller that publishes a victim-side/attacker-side SPLIT of one mixed channel
     *  (engine.ts's `victimSideIncomingModifier`, #358 addendum 3): shadowing can move a term from
     *  one half of that split to the other, and nothing downstream can un-mix it afterwards. */
    ownSuppressed: ChannelDeltas;
}

const NO_CONTRIBUTION: ChannelContribution = { pct: 0, tier: 0, sum: 0 };

/** Fold one more instance into a channel's running contribution.
 *
 *  A zero contribution is not an instance: it neither wins nor claims a tier, so a family whose
 *  `Attack Down III` touches only the attack channel cannot lend tier 3 to its (untouched)
 *  outgoing-damage channel and shadow something there.
 *
 *  Magnitude, not a signed comparison, as the tie-break: a family is sign-homogeneous by
 *  construction — `Attack Up` and `Attack Down` derive DIFFERENT family keys, so one family never
 *  mixes a buff and a debuff whose signs would fight. */
function foldChannel(prev: ChannelContribution, pct: number, tier: number): ChannelContribution {
    if (pct === 0) return prev;
    const sum = prev.sum + pct;
    if (prev.pct === 0) return { pct, tier, sum };
    return familyChallengerWins(prev.tier, Math.abs(prev.pct), tier, Math.abs(pct))
        ? { pct, tier, sum }
        : { ...prev, sum };
}

/**
 * Reduce a buff list to the STRONGEST instance per named family, per requested channel, carrying
 * each family's additive sum alongside it.
 *
 * ⚠️ THE MAP IS A PER-FAMILY MAXIMUM, NOT A TOTAL — and it is called with two different meanings,
 * which is exactly why `sum` rides along. On the ENEMY side the maximum IS the answer: the ruling
 * says the strongest applied instance is what lands, so a pre-summed enemy value would re-introduce
 * the additive shape the ruling forbids. On the SELF side the maximum answers "which of my
 * instances is the one to compare against", but the caller's totals hold the SUM of all of them —
 * so a delta that subtracted the maximum instead of the sum would leave the difference behind and
 * push the total PAST the applied value (measured before #389: two self `Attack Down I` (-30 in the
 * totals) plus an applied `Attack Down III` (-45) resolved to -60, the sum). `shadowedDelta`
 * therefore compares on `pct`/`tier` and subtracts `sum`.
 *
 * Effects are taken post-stacks (`value * stacks`), the same basis every other fold in this file
 * uses — so a stacking debuff's strength is its accumulated magnitude, not its per-stack value.
 * Entries touching none of the requested channels are skipped entirely, which is what keeps the
 * returned map empty (and therefore the whole delta a no-op) for the overwhelming majority of
 * actors.
 */
export function familiesOf(
    buffs: SelectedGameBuff[],
    channels: readonly ShadowChannel[]
): FamilyMap {
    const out: FamilyMap = new Map();
    for (const b of buffs) {
        let touched = false;
        for (const c of channels) {
            if ((b.parsedEffects[c] ?? 0) * b.stacks !== 0) {
                touched = true;
                break;
            }
        }
        if (!touched) continue;
        const { familyKey, tier } = deriveFamilyKey(b.buffName);
        const prev = out.get(familyKey);
        const entry: FamilyEntry = { ...prev };
        for (const c of channels) {
            const pct = (b.parsedEffects[c] ?? 0) * b.stacks;
            const folded = foldChannel(prev?.[c] ?? NO_CONTRIBUTION, pct, tier);
            if (folded.pct !== 0 || folded.sum !== 0) entry[c] = folded;
        }
        out.set(familyKey, entry);
    }
    return out;
}

/** One channel's pair of figures: raise the total to exactly the applied value when the applied
 *  instance wins the family, and leave it alone when the actor's own instance does. */
function channelDelta(
    own: ChannelContribution,
    applied: ChannelContribution
): { delta: number; ownSuppressed: number } {
    if (applied.pct === 0) return { delta: 0, ownSuppressed: 0 };
    const appliedWins =
        own.pct === 0 ||
        familyChallengerWins(own.tier, Math.abs(own.pct), applied.tier, Math.abs(applied.pct));
    return appliedWins
        ? { delta: applied.pct - own.sum, ownSuppressed: own.sum }
        : { delta: 0, ownSuppressed: 0 };
}

/**
 * The DELTA to add to an actor's already-folded SELF-sourced total on each channel so that the
 * result is `Σ over families of the strongest instance, either side`.
 *
 * THE ARITHMETIC, and why it is a delta rather than a recomputation. The caller's totals already
 * contain the full self-sourced sum, and this function is deliberately not allowed to rebuild that
 * (it would have to re-derive layers it cannot see — the un-named `modifierAbilities` channel and
 * the squad-leader `preFight` baseline, neither of which is a named family and neither of which may
 * participate in shadowing). So for each family the ENEMY side contributes, it adds
 *
 *     appliedInstance wins ? appliedInstance - Σ(own instances) : 0
 *
 * i.e. it moves the total to exactly the winning applied instance, or leaves it untouched when the
 * actor's own instance is the winner. Families present only on the self side are never visited, so
 * they pass through unchanged; the no-enemy-debuff case returns empty figures without even reading
 * the self side. Both directions of the ruling fall out of the one expression.
 *
 * SUBTRACTING THE SUM (not the strongest own instance) is what makes the delta structurally unable
 * to push the total past the applied value. Duplicate self-side instances of one family are
 * reachable two ways — `selfBuffLookup` accumulates entries across the attacker AND every team
 * actor under one `buffName`, and the same family can stand in `activeSelfBuffs` (scheduled) and
 * `abilitySelfEffects` (ability) at once with no shadowing between those two either — and with the
 * strongest subtracted instead, each duplicate left its own value behind in the total.
 *
 * `selfBuffs` MUST be the same named-status lists the caller's own fold consumed, or the
 * subtraction removes something the total never contained. See the call sites in playerTurn.ts and
 * engine.ts.
 */
export function shadowedDelta(
    enemyFamilies: FamilyMap,
    selfBuffs: SelectedGameBuff[],
    channels: readonly ShadowChannel[]
): ShadowedDelta {
    const delta: ChannelDeltas = {};
    const ownSuppressed: ChannelDeltas = {};
    if (enemyFamilies.size === 0) return { delta, ownSuppressed };
    const selfFamilies = familiesOf(selfBuffs, channels);
    for (const [familyKey, applied] of enemyFamilies) {
        const own = selfFamilies.get(familyKey);
        for (const c of channels) {
            const a = applied[c];
            if (a === undefined) continue;
            const r = channelDelta(own?.[c] ?? NO_CONTRIBUTION, a);
            if (r.delta !== 0) delta[c] = (delta[c] ?? 0) + r.delta;
            if (r.ownSuppressed !== 0) ownSuppressed[c] = (ownSuppressed[c] ?? 0) + r.ownSuppressed;
        }
    }
    return { delta, ownSuppressed };
}

// --- #389 compatibility surface -------------------------------------------------------------
// The two outgoing channels keep their own named types and entry points. They are the ONLY
// consumer that wants a fixed-shape (non-sparse) result, because playerTurn's late fold adds both
// unconditionally.

export type OutgoingChannelContribution = ChannelContribution;
export type OutgoingFamilyEntry = FamilyEntry;
export type OutgoingFamilyMap = FamilyMap;

/** The two percentage-point deltas `shadowedOutgoingDelta` hands back to the turn loop. */
export interface OutgoingDelta {
    attackPct: number;
    outgoingDamagePct: number;
}

/** `familiesOf` over `OUTGOING_CHANNELS`. */
export function outgoingFamiliesOf(buffs: SelectedGameBuff[]): OutgoingFamilyMap {
    return familiesOf(buffs, OUTGOING_CHANNELS);
}

/** `shadowedDelta` over `OUTGOING_CHANNELS`, flattened to the turn loop's two named fields. */
export function shadowedOutgoingDelta(
    enemyFamilies: OutgoingFamilyMap,
    selfBuffs: SelectedGameBuff[]
): OutgoingDelta {
    const { delta } = shadowedDelta(enemyFamilies, selfBuffs, OUTGOING_CHANNELS);
    return { attackPct: delta.attack ?? 0, outgoingDamagePct: delta.outgoingDamage ?? 0 };
}
