import {
    CombatStatBlock,
    DoTType,
    EnemyBaseClass,
    SelectedGameBuff,
    TeamActorInput,
} from '../../types/calculator';
import type { ShipTypeName } from '../../constants/shipTypes';
import { matchesRoleCategory } from '../../constants/shipTypes';
import type { FactionKey } from '../../constants/factions';
import {
    TOXIC_OVERFLOW,
    SPREAD_CORROSION_TIER,
    SPREAD_CORROSION_DURATION,
} from '../../constants/toxicOverflow';
import { Ability, AbilityTarget, IncomingHitContext, ShipSkills } from '../../types/abilities';
import type { Position } from '../../types/encounters';
import type { AffinityName } from '../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../targetingParser';
import { DEFAULT_BASE_PATTERN } from '../calculators/dpsEnemyPlacement';
import { makeRateGate, rollRateGate } from '../calculators/rateAccumulator';
import type { RoundData } from '../calculators/dpsSimulator';
import { toSelfDefenseModifier, toSelfIncomingDamageModifier } from '../calculators/dpsBuffHelpers';
import { computeAffinityModifiers, getAffinityMatchup } from '../calculators/affinityUtils';
import { calculateDamageReduction } from '../autogear/priorityScore';
import {
    type ExtraActionGrant,
    hasUsableChargedSkill,
    modifierTotalsFromAbilities,
} from '../abilities/applyAbilities';
import { conditionsMet, type ConditionContext } from '../abilities/evaluateConditions';
import {
    isEnemyTarget,
    isAllEnemiesTarget,
    type EnemySelectorKind,
} from '../abilities/abilityTargetSide';
import { aliveTargetsOf, type AliveRoster } from './targetableActors';
import {
    foldActorBuffTotals,
    effectiveStatsOf,
    effectiveOutgoingStatsOf,
    liveDebuffLandingChance,
} from './effectiveStats';
import {
    ActiveDoTStack,
    ActorDamage,
    ActorHealing,
    CombatActor,
    PendingAccumulator,
    PendingBomb,
    createActor,
    selectNextBySpeed,
    MAX_SELECTION_TICKS,
    emptyActorDamage,
    emptyActorHealing,
} from './state';
import {
    ActiveBuff,
    AbilityStatusPayload,
    RegisteredAbilityStatus,
    StatusEngine,
    createStatusEngine,
} from './statusEngine';
import { liveGateConditions } from './abilityStatusGating';
import {
    isPositional,
    resolvePositionalTarget,
    resolvesPositionalVictim,
} from './positionalBinding';
import {
    applyPositionalDamage,
    footprintVictims,
    type VictimDamageOutcome,
    type AppliedVictimDamage,
    type SubAttackOutcome,
} from './positionalApply';
import type { AttackerDamageScalars, VictimDefenseProfile } from './victimDamage';
import { victimHitDamageParts, victimDefenceMitigation } from './victimDamage';
import {
    incomingReductionForHit,
    incomingBlockForIntake,
    conditionMet,
    allyScopedIncomingRecipients,
    addIncomingAbilityDeduped,
    withLiveAllyScopedOwners,
} from './incomingEffects';
import { reflectedDamageParts } from './damageReflection';
import { splashDamageForBomb } from './bombSplash';
import { detonateContainers, type DetonationRecipe } from './detonation';
import { outgoingAmplificationForHit } from './outgoingEffects';
import { incomingHealAmpForRecipient } from './healAmplification';
import { CHEAT_DEATH_BUFFS } from './cheatDeathBuffs';
import { BARRIER_BUFFS } from './barrierBuffs';
import { BARRIER_RECHARGING, holdsBarrierRecharging } from './barrierRecharging';
import { shieldAbsorb } from './shieldAbsorb';
import { thresholdShieldForHit } from './thresholdShield';
import { isStasis, STASIS_BUFFS } from './stasisBuffs';
import { isDisable } from './disableBuffs';
import { highestAttackAmong } from './highestAttack';
import { emitAttacked } from './emitAttacked';
import { emitPerVictimAttacked } from './emitPerVictimAttacked';
import { CombatEvent, CombatEventBus, ShieldApplyAccumulator, createEventBus } from './events';
import { resolveLethalHp } from './lethalHp';
import { reversedRepairsOn } from './reversedRepairs';
// `incomingHealFactor` lives in the `buffTotals` LEAF module precisely so every consumer of the
// incoming-repair channel shares ONE floored definition — read its doc for why a channel clamped
// at some of its sites and not others is worse than one clamped nowhere. The two per-victim leech
// procs below are its fifth and sixth call sites.
import { incomingHealFactor, familiesOf, shadowedDelta, ShadowChannel } from './buffTotals';
import { normalizeTeamActorsToWalked } from './teamActorWalk';
import { normalizeCombatRoster } from './normalizeRoster';
import { buildBuffDurationExtensionByOwner } from './buffDurationExtension';
import {
    HealingRuntimeCtx,
    PlayerActorRuntime,
    PlayerRoundCtx,
    PassiveSlotHit,
    PlayerTurnResult,
    RateGate,
    runPlayerTurn,
} from './playerTurn';
import {
    Intent,
    MAX_INTENT_GENERATIONS,
    buildActorConditionContext,
    buildForcedTargetingStatus,
    countOwnersWithSelfBuff,
    executeIntent,
    liveHealChannelPct,
    ownerDebuffNamesFor,
    partitionReactiveAbilities,
    provokerOf,
    registerReactiveListeners,
    selfBuffNamesForOwners,
    selfBuffStacksForOwner,
    victimEnemyBuffs,
    victimOwnEnemyFamilies,
    victimSelfBuffs,
} from './triggers';
import { adjacentAllyIds } from './adjacency';
import { allyHpFraction, lowestHpAllyRecipients, narrowByFaction } from './supportRecipients';
import { consumeExposed, exposedIncomingPct } from './exposedStatus';
import {
    HIT_MITIGATION_DOT_ROUNDS,
    consumeHitMitigation,
    holdsHitMitigation,
} from './hitMitigation';
import { holdsShieldConverter, consumeShieldConverter } from './shieldConverter';
import { holdsRoguesLiberty } from './rogueLiberty';
import { holdsToxicOverflow } from './toxicOverflowStatus';
import { supportFootprintAllyIds } from './supportFootprint';
import type { PreFightCombatModifiers } from './preFight/types';
import { protectionCascade } from './protectionTransfer';

/** Backstop for pathological extra-action loops (a non-once-per-round grant whose
 *  conditions stay true re-fires on the extra turn it granted). Real texts are
 *  self-limited (charged-skill grants consume charges; passive grants are once per
 *  round), so any round needing more than this is a config/parser bug. */
const MAX_EXTRA_TURNS_PER_ROUND = 8;

/** SP-4c-2d §4.3: the id the side-wide scheduled-enemy-debuff bucket emits `buff-expired`
 *  under. The dummy actor that used to host that bucket is gone; the bucket is not. Keeping
 *  the literal 'enemy' keeps the event stream byte-identical across the deletion, and the
 *  name is honest about what it is — an id for a bucket, not a claim that an actor exists.
 *  Attributing the expiry to one positioned enemy instead would be the same lie `finalHpPct`
 *  told when it silently described only `enemyAttackers[0]`.
 *
 *  It stays RESERVED (see `reservedActorIds`): freeing the string would let a caller name a
 *  real enemy attacker 'enemy' and interleave its events with the bucket's under one id.
 *  Fenced in BOTH directions by `sentinelActorIdReservation.test.ts` — no actor may carry it,
 *  and no caller may claim it. */
export const SENTINEL_ENEMY_ACTOR_ID = 'enemy';

/** #396: the two channels `victimIncomingModifiers` combines across the self/enemy store boundary.
 *  Module-level so the array is not rebuilt per victim per hit. */
const VICTIM_INCOMING_CHANNELS = [
    'defense',
    'incomingDamage',
] as const satisfies readonly ShadowChannel[];

/**
 * Sum an actor's LIVE speed-buff percentage from the status engine (Task 2 authority for
 * effectiveSpeedOf; pure read, no mutation). Folds the same two sources the per-actor buff
 * fold uses, keyed by owner id so it is correct for any actor on either side:
 *   1. Scheduled self-buffs: snapshot(actorId).activeSelfBuffs, each expanded via selfBuffLookup
 *      (accumulating buffs override their static stacks with the per-round count; 0 → dropped).
 *   2. Timed ability statuses: timedAbilityStatuses('self', actorId), each payload wrapped via
 *      payloadToSelectedBuff.
 * Both fold through toSimBuffs → calculateBuffTotals, summing only `.speedBuff`.
 *
 * Task 0 corpus investigation: every corpus speed buff (Speed Up I/II/III, Speed Down I/II,
 * XAOC Swiftness I/II/III) is an UNCONDITIONAL timed status grant — there is NO conditional/
 * gated speed buff, NO always-active/aura speed buff, and NO standing speed modifier — so the
 * ctx-gated activeAbilityStatuses path and a ModifierChannel speed entry are intentionally
 * omitted. Returns a percentage (e.g. 30 for +30%); effective speed is uncapped.
 */
export function foldSpeedBuffPct(
    statusEngine: StatusEngine,
    selfBuffLookup: Map<string, SelectedGameBuff[]>,
    actorId: string
): number {
    return foldActorBuffTotals(statusEngine, selfBuffLookup, actorId).speedBuff;
}

// Classify ONE actor's cast buff/debuff abilities into timed/aura/accumulating statuses
// and register them under the correct status-engine recipients. Returns the timed-by-slot
// lists (applied when that caster's slot fires). Extracted from the attacker's inline loop
// (Task 4); Task 5 makes the routing real (see below).
//
// Classification (spec): accumulating (stackTrigger && isStackable) → accumulating maps,
// effect inclusion aura-gated; aura (recurring/undefined duration) → per-round effect gate;
// timed (finite duration) → gated at application. A finite-duration passive buff is timed (NOT
// an aura): it is a one-time combat-start window ("gains X for N turns"), seeded once in the
// round-1 loop and then decrementing on the owner's normal timed lifecycle.
//
// TARGET ROUTING (Task 5): the binary side computation becomes recipient routing —
//   enemy/all-enemies → 'enemy' side (recipients ignored, enemy maps are singular);
//   self              → recipients [casterId] (the owner only);
//   ally/all-allies   → recipients = ALL player ids (`playerIds`, a FIXED source order
//                       [focusActorId, ...team ids in input order] — independent of which
//                       actor cast, so application order is deterministic).
// `casterId` (== this caster's ownerId) is stamped on every status so its gate evaluates
// against the caster's ctx even when the status lives on another recipient.
//
// AURA/ACCUMULATING fan-out: the engine fans these out by calling
// statusEngine.registerAbilityStatuses(...) ONCE PER RECIPIENT (keeping the statusEngine API
// stable). Each recipient gets its own per-owner aura/accum store entry carrying the same
// casterId. Timed statuses are NOT registered here — they apply lazily per recipient via
// applyTimedAbilityStatus at the firing site (playerTurn loops `status.recipients`).
//
// KNOWN APPROXIMATION (documented, not fixed this task): a team-cast all-allies ACCUMULATING
// status registered onto the attacker's store ticks per-active/per-charge on the ATTACKER's
// cadence (sourceFired increments only the 'attacker' map for per-slot triggers). Per-caster
// cadence tracking is out of scope here; per-round increments tick every owner's map already.
//
// Zero-churn: for an attacker-only run playerIds = ['attacker'], so self and ally/all-allies
// both yield recipients ['attacker'] and casterId 'attacker' — identical to the pre-Task-5
// owner-routing (one registration onto the attacker's store).
function registerActorAbilityStatuses(
    castSkills: ShipSkills,
    statusEngine: ReturnType<typeof createStatusEngine>,
    ownerId: string,
    // Same-side ally-recipient order for `ally`/`all-allies` cast buffs: player ids for player
    // actors, enemy attacker ids for enemy actors. Named `playerIds` historically; for enemy
    // actors the engine passes the enemy team's ids so cross-enemy buffs land on the enemy side.
    playerIds: string[],
    // Heal target id (healing mode) — the recipient a single-`ally`/`lowest-hp-ally`
    // Cheat-Death-family firing-slot grant narrows to (Hermes shape). Absent (DPS mode / no heal
    // target): the `'ally'` carve-out falls back to [ownerId], but the `'lowest-hp-ally'`
    // carve-out falls back to [] — the owner is the one answer that selector forbids (see the
    // fence's own comment at the recipients computation below). Irrelevant for every
    // non-carve-out status.
    healTargetId?: string,
    // #363: actor id → faction, for `factionFilter`'d ally scopes (site 3 of the four-site
    // sweep — the aura/accumulating registration fan-out below). Optional so every caller that
    // predates #363 (and every fixture that omits it) keeps the un-narrowed behaviour;
    // `narrowByFaction` treats an absent reader the same as an absent filter.
    factionOf?: (id: string) => FactionKey | undefined
): {
    timedSelfBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[];
    timedEnemyBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[];
} {
    // Aura/accumulating statuses to register, grouped per RECIPIENT owner id (the engine fans
    // them out with one registerAbilityStatuses call per recipient). Timed statuses are applied
    // lazily and tracked via timedSelfBySlot/timedEnemyBySlot — they carry recipients on the
    // status object for the per-recipient application loop in playerTurn.
    const byRecipient = new Map<string, RegisteredAbilityStatus[]>();
    const pushFor = (rid: string, status: RegisteredAbilityStatus) => {
        let list = byRecipient.get(rid);
        if (!list) {
            list = [];
            byRecipient.set(rid, list);
        }
        list.push(status);
    };
    const timedSelfBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[] = [];
    const timedEnemyBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[] = [];
    for (const slot of castSkills.slots) {
        // Intra-cast clause order: within ONE firing slot, a clause resolves after the clauses
        // before it, so a debuff whose clause follows a damage-dealing clause is not yet in the
        // store while that cast's damage resolves ("deals X% damage AND inflicts Defense Down").
        // `slot.abilities` IS clause order — buildShipAbilities sorts each slot by text position.
        // Only the two FIRING slots cast; a passive row has no damage clause to order against
        // (its statuses are seeded, not cast), so the tracker stays false there.
        const isFiringSlot = slot.slot === 'active' || slot.slot === 'charged';
        let sawDamageClause = false;
        for (const ability of slot.abilities) {
            const cfg = ability.config;
            // A real damage-dealing clause. A 0-multiplier entry is a structural no-op (the
            // fixtures' "took a turn" placeholder) and orders nothing.
            if (isFiringSlot && cfg.type === 'damage' && cfg.multiplier > 0) sawDamageClause = true;
            if (cfg.type !== 'buff' && cfg.type !== 'debuff') continue;
            // #399: the store side comes from the ONE classifier (abilityTargetSide.ts), not a
            // local list. The list this replaced omitted the three selector targets, so a
            // buff/debuff with `target: 'enemy-highest-attack'` and a NON-live trigger was
            // misregistered on the CASTER's self store — invisible to every enemy-store reader.
            // Measured in `selectorTargetStoreSide.test.ts`; corpus-unreachable today (every
            // shipped selector-targeted infliction carries a LIVE trigger and is partitioned to
            // the reactive path before this loop), which is why nothing observable moves.
            //
            // #403 CLOSED the recipient axis for DEBUFF-typed clauses: `resolveDebuffRecipientIds`
            // (debuffRecipients.ts) now resolves the three selector targets through engine
            // `buildTurnArgs`'s `selectorEnemyIdFor` delegate, so a selector-targeted debuff lands
            // on the resolved highest-attack/most-buffed/fastest enemy instead of the cast anchor.
            // Residual, measured in `selectorTargetStoreSide.test.ts`'s RESIDUAL arm: a BUFF-typed
            // config aimed at an enemy matches no ability in playerTurn's `matchingAbility` lookup
            // (which filters `type === 'debuff'`), so THAT half still lands on the anchor. #407
            // closed it at the AUTHORING boundary instead of here (ruling R4) — the editor no
            // longer offers an enemy target to a buff-typed ability — and left this engine path
            // deliberately unchanged for the hand-edited-saved-data case. See the comment there.
            const side: 'self' | 'enemy' = isEnemyTarget(ability.target) ? 'enemy' : 'self';
            // Hit count ("Barrier for 1 hit"), captured as the VALUE rather than a flag so the
            // timed literal below can thread it without re-narrowing `cfg` back to the buff arm.
            // Only a buff config carries it — `hits` does not exist on the debuff arm.
            const hitCount = cfg.type === 'buff' ? cfg.hits : undefined;
            const hitCounted = hitCount !== undefined;
            // A hit-counted grant must never resolve to the ENEMY side either — `consumeStatusHit`
            // (statusEngine.ts) only spends from the per-actor SELF timed map (getSelfMap); the
            // enemy timed map is a completely separate store it never reads. `side` above is
            // 'enemy' for SEVEN targets now (#399 added the three selectors to the four pre-
            // existing enemy targets: 'enemy', 'all-enemies', and the two enemy-adjacency DEBUFF
            // scopes Vindicator/Asphyxiator) — but a hit-counted grant only ever exists on a
            // `buff`-typed config (`hits` is a buff-config field; see its declaration in
            // types/abilities.ts), and every corpus BUFF carrying `hits` is self-targeted ("for N
            // hit(s)": Malvex/Panon/Quixilver/Sansi Barrier). The ability editor cannot produce the
            // combination either — `AbilityCard.tsx`'s buff/debuff editor exposes no `hits` control
            // at all, and does not offer the three selector targets. So the throw below is
            // corpus-unreachable regardless of which/how-many targets classify as 'enemy', same
            // footing as the accumulating/aura guards just below and the persistent store's throw
            // in statusEngine.ts's applyTimedAbilityStatus. Thrown loudly here rather than left to
            // silently land a permanent, unspendable grant on the enemy side if a future parser or
            // editor change ever produces one.
            if (hitCounted && side === 'enemy') {
                throw new Error(
                    `registerActorAbilityStatuses: hit-counted buff '${cfg.buffName}' resolved to ` +
                        `the ENEMY side (ability.target '${ability.target}') — the enemy timed map ` +
                        `is unreachable by consumeStatusHit. Route it through the self side or extend ` +
                        `consumeStatusHit first.`
                );
            }
            // A hit-counted grant is never accumulating and never an aura — BOTH stores are
            // unreachable by `consumeStatusHit`, which only spends from the per-actor TIMED map.
            // Landing a hit-counted grant in either one would make it permanent and unspendable
            // (the known one-shot-in-an-unreachable-channel defect class). No corpus config
            // combines `hits` with `stackTrigger + isStackable` today; if one ever does, the hit
            // lifecycle wins and the stack accrual is what gets dropped, loudly here rather than
            // silently at the spend site.
            const accumulating = !hitCounted && !!cfg.stackTrigger && cfg.isStackable;
            // Cheat-Death-family grants from a FIRING slot (Hermes/Hayyan charged skills) are
            // cast-path persistent grants, NOT always-on auras: they apply when the slot fires
            // (per-slot timed loop in playerTurn, gated by conditionsMet at cast time) and never
            // expire (duration Infinity; the intercept consumes them via cheatDeathConsumed).
            // Scoped to CHEAT_DEATH_BUFFS — other firing-slot recurring buffs (Panon, Sansi,
            // Sentinel, Oleander…) keep the aura model for now (documented in coverage §5).
            const castPathCheatDeath =
                !accumulating &&
                CHEAT_DEATH_BUFFS.has(cfg.buffName) &&
                (slot.slot === 'active' || slot.slot === 'charged');
            // Player-side recipients (self vs ally/all-allies). Enemy-side statuses ignore this
            // (recipients are only consulted on the self side). Self → caster only; ally/all-allies
            // → every player actor (fixed source order). `playerIds` already includes the caster.
            // CARVE-OUT (castPathCheatDeath only): a single-`ally` grant narrows to the heal target
            // (Hermes "grants Cheat Death to the lowest-HP ally"), fallback [ownerId] when no heal
            // target; `all-allies` (Hayyan) keeps every player. The global ally → all-players rule
            // for every OTHER cast-path buff is UNCHANGED.
            //
            // SP-4e: `'lowest-hp-ally'` joins BOTH ally arms. On the CARVE-OUT arm the match is
            // purely DEFENSIVE and is expected to stay dead — do not read it as a Hermes fix.
            // Measured against the corpus (`docs/ship-skills.csv`, 2026-08-20): the only
            // firing-slot Cheat Death grants are Hermes (charged, `'ally'`) and Hayyan (charged,
            // `'all-allies'`); Tycho's and Yazid's are passive-slot, which `castPathCheatDeath`
            // already excludes. Hermes's charged text is "This Unit repairs 37% of its Max HP and
            // adds 1 charge to the Charged Skill. / If the target has less than 40% HP, it grants
            // Cheat Death." — it names NO ally selector (no "most missing health" / "lowest
            // current health" / "the other ally" in any of its five rows), so Task 3's parser flip
            // cannot turn it into `'lowest-hp-ally'`. `castPathCheatDeath` is keyed on the BUFF
            // NAME, so nothing else can reach this arm with the variant either. The match exists
            // so the two single-ally flavours cannot diverge if a future kit does land here.
            //
            // NO OWNER FALLBACK FOR THE SELECTOR. The `'ally'` flavour names the heal ANCHOR, and
            // `[ownerId]` is a sane stand-in for it when there is no anchor (DPS mode —
            // `healTargetId` is optional). The selector flavour names "the OTHER ally", so the
            // owner is the one answer it forbids: with no anchor to narrow to it resolves to
            // NOBODY, matching every other SP-4e site (`undefined` → empty recipient list). An
            // un-fenced `healTargetId ?? ownerId` here would have been exactly the self-grant this
            // rung exists to prevent.
            //
            // KNOWN APPROXIMATION on the non-carve-out arm: this function runs at actor
            // CONSTRUCTION, before any HP has moved and before `healingCtx` exists, so there is no
            // live-HP view here to resolve the selector against — and the statuses it registers
            // (auras / accumulating / timed-recipient lists) outlive any single instant anyway, so
            // a setup-time snapshot would be a wrong answer dressed as a precise one. The variant
            // therefore inherits plain `'ally'`'s roster-wide fan-out, which over-applies exactly
            // as plain `'ally'` already does. What matters is that it must NOT fall through to the
            // trailing `[ownerId]`: a self-only grant is the one answer "the OTHER ally" forbids,
            // and that is what an un-armed variant would have got here.
            const recipients: string[] =
                side === 'enemy'
                    ? [] // enemy-side statuses have no player recipients; the timed-enemy application path never reads recipients
                    : castPathCheatDeath &&
                        (ability.target === 'ally' || ability.target === 'lowest-hp-ally')
                      ? healTargetId !== undefined
                          ? [healTargetId]
                          : ability.target === 'lowest-hp-ally'
                            ? [] // selector + no anchor → nobody; NEVER the owner (see above)
                            : [ownerId]
                      : ability.target === 'ally' ||
                          ability.target === 'all-allies' ||
                          ability.target === 'lowest-hp-ally'
                        ? playerIds
                        : [ownerId];
            // A hit-counted grant is never an aura: an aura is re-evaluated per round against
            // its gate and has no consumable charge, so a durationless "Barrier for 1 hit" would
            // otherwise be permanent for as long as its gate held. (`hitCounted` is computed with
            // `accumulating` above — the other classification it has to lose to.)
            const isAura =
                !accumulating &&
                !castPathCheatDeath &&
                !hitCounted &&
                (cfg.duration === 'recurring' || cfg.duration === undefined);
            const payload: AbilityStatusPayload = {
                buffName: cfg.buffName,
                stacks: cfg.stacks,
                parsedEffects: cfg.parsedEffects,
                ...(cfg.type === 'debuff' ? { application: cfg.application } : {}),
                // SP-G G1b: threads the config's isStackable flag through so the aura branch of
                // activeAbilityStatuses can tell a genuinely-stackable one-shot grant (Meatshield's
                // Protection) apart from the structural stacks:1 default every non-stackable buff
                // carries — only the former should surface a reported stack count.
                ...(cfg.isStackable ? { isStackable: true } : {}),
            };
            // `as const` keeps the literal types (side, sourceSlot) so the spread into
            // a union variant below doesn't widen them — runtime object is unchanged.
            // casterId/recipients (Task 5) carry the ally-routing decision on the status.
            const base = {
                payload,
                side,
                sourceSlot: slot.slot,
                conditions: liveGateConditions(ability.conditions),
                casterId: ownerId,
                recipients,
                // #363 (Fuying): carry the recipient FACTION scope onto the status. `recipients`
                // above is the roster-wide ally fan-out; the faction intersection happens at
                // APPLICATION time in playerTurn (where the actor→faction map is in scope), not
                // here — this function runs at actor construction. Attached only when the ability
                // carries one, so every other ship's status object is byte-identical.
                ...(ability.factionFilter ? { factionFilter: ability.factionFilter } : {}),
                // #390: mark the enemy-side statuses whose target covers the whole opposing board.
                // The aura/accumulating registration below has no victim id to key by (it runs at
                // actor construction, before any cast), so it writes into the singular
                // DEFAULT_ENEMY_TARGET bucket; statusEngine folds that bucket into a per-victim
                // read only for entries carrying this flag. Attached only when it is 'all', so
                // every other status object stays byte-identical (same rule as factionFilter).
                ...(side === 'enemy' && isAllEnemiesTarget(ability.target)
                    ? { enemyScope: 'all' as const }
                    : {}),
            } as const;
            let status: RegisteredAbilityStatus;
            if (accumulating) {
                // accumulating: stackTrigger is required and non-optional on this variant.
                status = {
                    ...base,
                    kind: 'accumulating',
                    stackTrigger: cfg.stackTrigger!,
                    maxStacks: cfg.maxStacks,
                };
            } else if (isAura) {
                // NOTE: persistent-stacking names (PERSISTENT_STACKING_BUFFS) should never
                // reach the aura arm with current data — their cast applications either carry
                // a stackTrigger (accumulating, climbs + caps there) or a reactive trigger
                // (partitioned out before this loop; the executor routes them to the
                // persistent map). If one ever lands here it would become a per-round
                // re-rolled aura and silently lose persistence — see persistentStackingBuffs.ts.
                status = { ...base, kind: 'aura' };
            } else {
                // timed: cfg.duration is a number here (NOT accumulating, NOT aura — i.e.
                // not recurring/undefined duration). A finite-duration passive buff lands here
                // too (seeded at combat start by the round-1 loop). The classification branches
                // above exhaustively exclude non-numeric durations from reaching this arm.
                // Cheat-Death-family firing-slot grants take Infinity (never decrements to 0:
                // Infinity − 1 === Infinity; expiry compares <= 0) → persists like Cheat Death;
                // clearRemovable on the intercept still wipes it (it's consumed anyway).
                status = {
                    ...base,
                    kind: 'timed',
                    duration: castPathCheatDeath
                        ? Infinity
                        : hitCounted && typeof cfg.duration !== 'number'
                          ? // Hit-counted with no stated turn window: never tick out, expire on
                            // the hit count alone. Same non-expiring-but-removable shape as
                            // TOXIC_OVERFLOW_DURATION.
                            Infinity
                          : (cfg.duration as number),
                    ...(hitCount !== undefined ? { hits: hitCount } : {}),
                    // Clause-order stamp (enemy side only — a self-buff never modifies the
                    // victim's incoming damage, so deferring one would change nothing but its
                    // event order). Consumed by playerTurn's timed-enemy application loop.
                    ...(side === 'enemy' && sawDamageClause ? { afterDamageClause: true } : {}),
                };
                (side === 'self' ? timedSelfBySlot : timedEnemyBySlot).push(status);
            }
            // Enemy-side statuses register once (singular enemy maps); self-side aura/accum fan
            // out to every recipient store. Timed statuses are applied lazily (per recipient) at
            // the firing site, so we only group the NON-timed statuses for registration here —
            // but enemy timed statuses also flow through registerAbilityStatuses as before (it
            // ignores timed — they apply via applyTimedAbilityStatus). Keep the historical
            // behaviour by registering every status under each recipient (registerAbilityStatuses
            // only stores aura/accumulating internally; timed are no-ops there).
            if (side === 'enemy') {
                // Enemy side: single registration (recipientId irrelevant — enemy maps singular).
                // No faction narrowing here — an enemy-side status is a debuff on the OPPOSING
                // side, not an ally-scoped grant, so `factionFilter` (which only ever appears on
                // an ally-targeted buff) has nothing to intersect against on this branch.
                pushFor('enemy', status);
            } else {
                // `recipients` is the locally-computed list (always defined) — use it directly
                // rather than status.recipients (typed optional through the union).
                // #363: narrow to `ability.factionFilter` (site 3 of the four-site sweep) —
                // same semantics as playerTurn.ts's cast-path loop (site 1), intersecting AFTER
                // the roster-wide fan-out computed above. This affects the aura/accumulating
                // stores this function actually populates; the parallel `timedSelfBySlot` array
                // built above still carries the UN-narrowed `recipients` on the status object —
                // its own consumers (playerTurn's cast loop, seedPassiveTimedStatuses) apply the
                // same narrowing themselves at their own application time.
                for (const rid of narrowByFaction(recipients, ability.factionFilter, factionOf))
                    pushFor(rid, status);
            }
        }
    }
    // Fan out: one registerAbilityStatuses call per recipient owner (statusEngine API stable).
    // Enemy-side statuses were grouped under the sentinel key 'enemy'; their ownerId argument is
    // irrelevant (registerAbilityStatuses routes enemy-side statuses to the singular enemy maps).
    for (const [rid, statuses] of byRecipient) {
        statusEngine.registerAbilityStatuses(statuses, rid === 'enemy' ? ownerId : rid);
    }
    return { timedSelfBySlot, timedEnemyBySlot };
}

// ─────────────────────────────────────────────────────────────────────────────
// Combat-start seeding for PASSIVE-sourced finite (timed) self-statuses.
//
// The passive slot never fires as an action, so these would otherwise never apply; they
// are a one-time window from combat start ("gains X for N turns"), NOT a per-turn refresh.
// Apply once at round start, then the normal timed lifecycle (timedAbilityStatuses fold +
// decrementPlayer + clearRemovable) expires them and wipes them on death. Gated by
// conditionsMet for parity with the cast path (executeIntent).
function seedPassiveTimedStatuses(
    runtimes: PlayerActorRuntime[],
    statusEngine: ReturnType<typeof createStatusEngine>,
    bus: CombatEventBus,
    enemyType: EnemyBaseClass | undefined,
    round: number,
    // #363: actor id → faction, for `factionFilter`'d ally scopes (Fuying-shaped passive-slot
    // grant). Optional so test fixtures that omit it get the pre-#363 unnarrowed behaviour
    // (`narrowByFaction` treats an absent filter as absent regardless of this reader).
    factionOf?: (id: string) => FactionKey | undefined
): void {
    for (const rt of runtimes) {
        const seedCtx = buildActorConditionContext(statusEngine, rt.actor.id, {
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            enemyHpPct: 100,
            enemyType, // `enemy-type` survives liveGateConditions, so omitting it would
            // wrongly skip an enemy-class-gated passive buff.
        });
        for (const status of rt.timedSelfBySlot) {
            if (status.sourceSlot !== 'passive') continue;
            if (!conditionsMet(status.conditions, seedCtx)) continue;
            // recipients is populated by registerActorAbilityStatuses for every timed-by-slot
            // status; the [rt.actor.id] fallback only guards test fixtures that omit it.
            // #363: narrow to the status's own recipient FACTION scope (site 2 of the
            // four-site sweep) — the same intersection playerTurn.ts's cast-path loop applies,
            // here for a passive-slot grant seeded at combat start instead of a firing cast.
            for (const rid of narrowByFaction(
                status.recipients ?? [rt.actor.id],
                status.factionFilter,
                factionOf
            )) {
                // Barrier Recharging: same gate as the cast-path loop (playerTurn.ts) and the
                // reactive path (triggers.ts), for symmetry. Corpus-unreachable today — no
                // passive-slot grant currently applies Barrier Recharging before this seed runs
                // (Panon/Quixilver/Last Stand all grant it reactively, never as a round-1
                // passive seed) — but a future passive-slot Barrier/Barrier-Recharging grant
                // must not become the fifth silently-bypassed lockout channel.
                if (
                    (BARRIER_BUFFS.has(status.payload.buffName) ||
                        status.payload.buffName === BARRIER_RECHARGING) &&
                    holdsBarrierRecharging(statusEngine, rid)
                ) {
                    continue;
                }
                statusEngine.applyTimedAbilityStatus(round, status, rid);
                bus.emit({
                    type: 'buff-applied',
                    actorId: rid,
                    granterId: status.casterId ?? rt.actor.id,
                    round,
                    buffName: status.payload.buffName,
                    duration: status.duration,
                });
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Combat-start seeding for PASSIVE-sourced PRE-COMBAT shields (epic PR4).
//
// "At the start of combat, this Unit gains a Shield equal to N% of its Max HP" (Crucialis,
// FrontLine) — the parser now tags these `type:'shield', trigger:'pre-combat'`. The cast path
// (runPlayerTurn's heal/shield loop) SKIPS pre-combat abilities (they used to re-grant the pool
// on every cast), and this seam applies them exactly ONCE, before any round-1 turn — the same
// sequence point as seedPassiveTimedStatuses. Semantics mirror the F3 squad-leader
// `startingShieldPctOfHp` seeding in createActor: silent (no shield-applied emission, no
// `granted` credit — a pre-fight pool, not a cast), basis = the actor's BASE max HP (post
// pre-fight stat passes; no round buffs exist yet), pool capped at max HP (locked H rule).
// Team-symmetric by construction: the engine calls this for both runtime collections.
// Conditions are ignored — every corpus clause is unconditional (verified ship-skills.csv);
// a future conditional pre-combat shield must add gating here.
function seedPreCombatShields(runtimes: PlayerActorRuntime[]): void {
    for (const rt of runtimes) {
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const ability of slot.abilities) {
                if (ability.trigger !== 'pre-combat') continue;
                const cfg = ability.config;
                if (cfg.type !== 'shield' || cfg.basis !== 'hp') continue;
                const maxHp = rt.actor.stats.hp;
                rt.actor.shieldPool = Math.min(
                    rt.actor.shieldPool + maxHp * (cfg.pct / 100),
                    maxHp
                );
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enemy PlayerActorRuntime builder (Task 5; consumed by the Task 6b dispatch)
//
// Constructs a FULL PlayerActorRuntime for a healing-mode enemy attacker, mirroring
// the walked-team construction. The enemy walks runPlayerTurn bound to the heal target
// (Task 6b dispatch): its damage drains into the target, self-buffs land in its own owner
// store, debuffs/DoTs on the target's per-target store.
//
// Design decisions:
//   manual enemy:  A flat-card enemy (no shipSkills) gets a synthesized single-slot basic
//                  attack (100% multiplier, 1 hit, crit-eligible) so the walk produces
//                  byte-identical damage to the retired runEnemyAttackerTurn manual path.
//   defence/hp:    The enemy's own stats (default 0 until Task 9 populates real values
//                  via the adapter).
//   affinity:      Neutral placeholder (modifier 0, cap 100, penalty 0, no disadvantage).
//                  Task 9 wires real matchup after the affinity selector lands.
//   selfBuffLookup: Empty map (walked-style: payload effects are self-contained).
//   enemyDebuffLookup: The engine's global map (same as walked-team actors).
//   status registration: registerActorAbilityStatuses registers any buff/debuff abilities
//                  the enemy's kit carries (no-op for damage-only shipSkills).
// ─────────────────────────────────────────────────────────────────────────────

/** Input shape for buildEnemyPlayerActorRuntime. Mirrors CombatEngineInput['enemyAttackers'][number]. */
export interface EnemyActorInput {
    id: string;
    stats: {
        attack: number;
        crit: number;
        critDamage: number;
        speed: number;
        defence?: number;
        hp?: number;
        /** Base hacking (A2 Task 2). Optional — flows onto the enemy CombatActor's stats.hacking
         *  (base for effectiveStatsOf.hacking). No production reader until landing lands (A2 Task 4). */
        hacking?: number;
        /** Base security (A2 Task 2). Optional — flows onto the enemy CombatActor's stats.security
         *  (base for effectiveStatsOf.security). No production reader until landing lands (A2 Task 4). */
        security?: number;
        /** Shield penetration (H1 Task 2). Optional — flows onto the enemy CombatActor's
         *  stats.shieldPenetration. No production reader until H1 Task 4 wires the apply path. */
        shieldPenetration?: number;
        /** Heal-modifier % (SP-F F4). Folded into this enemy's own heal casts as
         *  `(1 + healModifier/100)`, team-symmetric with the player focus/walk paths. Optional —
         *  undefined treated as 0. */
        healModifier?: number;
    };
    chargeCount: number;
    startCharged: boolean;
    shipSkills?: ShipSkills;
    /** Pre-resolved affinity damage modifier (from computeAffinityModifiers). Default 0 (neutral). */
    affinityDamageModifier?: number;
    /** Pre-resolved crit cap (from computeAffinityModifiers). Default 100 (neutral). */
    affinityCritCap?: number;
    /** Pre-resolved crit penalty (from computeAffinityModifiers). Default 0 (neutral). */
    affinityCritPenalty?: number;
    /** Board position of this enemy. Consumed by isPositional/resolvePositionalTarget at the
     *  enemy-turn positional target-selection and footprint-apply sites. */
    position?: Position;
    /** Attacker ignores Taunt/Provoke forced targeting (not Concentrate Fire). Populated from the
     *  ship's own skill text via buildShipAbilities/detectIgnoresForcedTargeting; ORed at the read
     *  sites with the timed `Rogue's Liberty` buff (rogueLiberty.ts). */
    ignoresForcedTargeting?: boolean;
    /** W6: ship-wide stealth-targeting bypass. */
    ignoresStealth?: boolean;
    /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
     *  site (§4.5 Akula exception). Optional — undefined treated as false. */
    doesntBreakStasis?: boolean;
    /** Attacker is immune to charge loss effects (Lev). Enemy-sourced charge removal is a
     *  no-op against actors with this flag set (Phase 0 Task 7). Optional — undefined = false. */
    chargeLossImmune?: boolean;
    /** Pre-parsed targeting preference for this enemy. Consumed by the enemy-turn positional
     *  target selection AND the positional apply at the enemy damage site (threaded via
     *  enemyTargetById). */
    target?: ParsedTarget;
    /** Pre-parsed positional pattern for this enemy. Consumed by the positional apply at the
     *  enemy damage site (origin/covered footprint expansion; threaded via enemyPatternById). */
    pattern?: ParsedPattern;
    /** Pre-parsed charged-skill pattern when it differs from active; falls back to `pattern`. */
    chargedPattern?: ParsedPattern;
    /** SP-F F5: pre-parsed charged-skill TARGET selection when it differs from active; falls
     *  back to `target`. Drives BOTH the damage footprint anchor AND target-selection on a
     *  charge-firing turn (mirrors `chargedPattern`'s contract). */
    chargedTarget?: ParsedTarget;
    /** RAW affinity of this enemy attacker — the SAME affinity the adapter fed to
     *  computeAffinityModifiers to produce `affinityDamageModifier` above. Threaded onto the
     *  runtime's attackerAffinity (consumed by the positional apply path via
     *  positionalScalars.attackerAffinity → victimHitDamage's per-victim matchup recompute) +
     *  the CombatActor.affinity (consumed wherever a victim's own affinity is read). Absent →
     *  neutral default ('antimatter') downstream. */
    affinity?: AffinityName;
    /** Pre-fight combat-modifier baseline (sub-project F, PR F3) — squad-leader modifier
     *  channels for this enemy attacker. Absent → all folds inert (byte-identical). */
    preFight?: PreFightCombatModifiers;
    /** SP-F F5: this enemy attacker's ship role (Ship.type), for role-filtered classification —
     *  today only Meatshield's defense-substitution "non-defender ally" gate (roleByActorId,
     *  matchesRoleCategory(..., ['DEFENDER'])). Mirrors TeamActorInput.role's contract: absent →
     *  the substitution gate treats an unknown role as dormant (no substitution) rather than
     *  assuming non-defender — consistent with Graphite's role-filtered reaction also staying
     *  dormant on an unknown role (matchesRoleCategory(undefined, ...) is always false). */
    role?: ShipTypeName;
    /** SP-F F4: this enemy attacker's ship name, for the live `ally-on-team` roster check
     *  (Isha/Nayra reciprocal Override gate). Absent → not added to the name map → the gate
     *  falls back to assume-met (byte-identical). */
    name?: string;
    /** #363: this enemy attacker's faction, for `factionFilter`'d ally scopes (factionByActorId).
     *  Mirrors `role`'s contract: absent → unknown faction → never matches a filter
     *  (conservative), so an enemy-side Fuying's Tianchao grant reaches only the enemy allies
     *  whose faction the caller supplied. */
    faction?: FactionKey;
}

/** Build a full PlayerActorRuntime for a healing-mode enemy attacker.
 *  Exported for unit-testing; called inside runCombat. The enemy-dispatch branch
 *  walks runPlayerTurn with this runtime, bound to the heal target (Task 6b). */
export function buildEnemyPlayerActorRuntime(
    e: EnemyActorInput,
    ctx: {
        statusEngine: StatusEngine;
        // Enemy-team recipient order (mirror of playerIds for player actors): the enemy ATTACKER
        // ids in input order. An enemy supporter's `ally`/`all-allies` cast buffs route to THIS
        // list so they land on the enemy team (raising other enemies' damage to the tank) instead
        // of leaking onto the player team.
        enemyIds: string[];
        enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
        /** #363: actor id → faction (side-agnostic by key — the same map runCombat threads to
         *  the player-side registration calls), for this enemy's `factionFilter`'d ally scopes. */
        factionOf?: (id: string) => FactionKey | undefined;
    }
): PlayerActorRuntime {
    const { statusEngine, enemyIds, enemyDebuffLookup, factionOf } = ctx;

    // Manual flat-card enemy (no shipSkills): synthesize a single basic-attack active slot
    // (100% multiplier, 1 hit, crit-eligible) so the runPlayerTurn walk produces byte-identical
    // damage to the retired runEnemyAttackerTurn manual path. A ship-backed enemy uses its real
    // shipSkills. The synthesized ability is on-cast/target-enemy → survives reactive partition.
    const sourceSkills: ShipSkills = e.shipSkills ?? {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: `${e.id}-basic`,
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100, hits: 1 },
                    },
                ],
            },
        ],
    };

    // Partition reactive abilities out of castSkills (mirrors walked-team pattern).
    // Damage abilities are never reactive, so the synthesized basic stays in castSkills; a
    // ship-backed enemy's reactive abilities (if any) partition out as for a walked team actor.
    const { castSkills, reactiveAbilities } = partitionReactiveAbilities(sourceSkills);

    // Register this enemy actor's cast buff/debuff abilities (no-op for damage-only
    // shipSkills; safe to call defensively). Own ownerId = actor id. `enemyIds` is the
    // same-side ally-recipient order: an enemy supporter's `ally`/`all-allies` buff routes
    // onto the ENEMY team (aura/accum fan out per enemy store; timed carry `recipients` for
    // the per-recipient apply loop), so it folds into each enemy's own turn rather than
    // leaking onto the player team.
    const { timedSelfBySlot, timedEnemyBySlot } = registerActorAbilityStatuses(
        castSkills,
        statusEngine,
        e.id,
        enemyIds,
        undefined, // healTargetId: not applicable on the enemy side
        factionOf
    );

    // Shared with the player focus and walked-team paths — see hasUsableChargedSkill. Deriving
    // this per-path is what let the enemy side drift into requiring a charged DAMAGE ability,
    // which disabled the charge cadence for every support enemy.
    const hasChargedSkill = hasUsableChargedSkill(e.shipSkills, e.chargeCount);

    const actor = createActor({
        id: e.id,
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: e.stats.attack,
            crit: e.stats.crit,
            critDamage: e.stats.critDamage,
            defensePenetration: 0,
            shieldPenetration: e.stats.shieldPenetration ?? 0,
            defence: e.stats.defence ?? 0,
            hp: e.stats.hp ?? 0,
            speed: e.stats.speed,
            // Base hacking/security (A2 Task 2) — base for effectiveStatsOf; unread until landing lands (A2 Task 4).
            hacking: e.stats.hacking,
            security: e.stats.security,
        },
        chargeCount: e.chargeCount,
        startCharged: e.startCharged,
        position: e.position,
        ignoresForcedTargeting: e.ignoresForcedTargeting,
        ignoresStealth: e.ignoresStealth,
        doesntBreakStasis: e.doesntBreakStasis,
        chargeLossImmune: e.chargeLossImmune,
        affinity: e.affinity,
        preFight: e.preFight,
    });

    // Resolved affinity fields — pre-computed by the adapter via computeAffinityModifiers
    // (enemy as attacker, heal target as defender). Absent → neutral defaults (damageMod 0,
    // cap 100, penalty 0), preserving byte-identical behaviour for fixtures without affinity.
    const resolvedDamageMod = e.affinityDamageModifier ?? 0;
    const resolvedCritCap = e.affinityCritCap ?? 100;
    const resolvedCritPenalty = e.affinityCritPenalty ?? 0;
    const affinityDisadvantage = resolvedDamageMod < 0;
    // Own gate instances — separate draw streams so this enemy's crit/heal-crit/debuff/extend
    // rolls are fully isolated from every other actor's deterministic schedule. Keyed by this
    // enemy's own id + purpose (SP-0 Task 3) so, under the keyed test provider, its draws come
    // from a sub-stream no other actor shares; production (no keyed provider) is unaffected.
    const enemyActiveCritGate = makeRateGate(`${e.id}:active-crit`);
    const enemyChargedCritGate = makeRateGate(`${e.id}:charged-crit`);
    const enemyActiveHealCritGate = makeRateGate(`${e.id}:active-heal-crit`);
    const enemyChargedHealCritGate = makeRateGate(`${e.id}:charged-heal-crit`);
    const enemyDebuffLandingGate = makeRateGate(`${e.id}:landing`);
    const enemyExtendChanceGate = makeRateGate(`${e.id}:extend`);
    // The landing closure reads the runtime's LIVE per-target landing chance (A2 Task 4 — set
    // each turn by runPlayerTurn) and falls back to the threaded scalar. It references `runtime`
    // (defined in the same const initializer); the arrow BODY runs only at turn time, well after
    // construction, so the self-reference is safe.
    const runtime: PlayerActorRuntime = {
        actor,
        focus: false,
        castSkills,
        reactiveAbilities,
        timedSelfBySlot,
        timedEnemyBySlot,
        hasChargedSkill,
        attack: e.stats.attack,
        crit: e.stats.crit,
        critDamage: e.stats.critDamage,
        defensePenetration: 0,
        defence: e.stats.defence ?? 0,
        hp: e.stats.hp ?? 0,
        // SP-F F4: fold the enemy's own heal-modifier (team symmetry with the player focus/walk
        // paths); was hard-coded 0 before F4. Undefined → 0.
        healModifier: e.stats.healModifier ?? 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: resolvedDamageMod,
        affinityCritCap: resolvedCritCap,
        affinityCritPenalty: resolvedCritPenalty,
        affinityDisadvantage,
        // RAW affinity — sourced from the SAME e.affinity the adapter fed to
        // computeAffinityModifiers for resolvedDamageMod, so the two never disagree. Positional
        // plumbing: read by victimHitDamage for per-victim re-resolution (Task 8b/9). Undefined →
        // neutral 'antimatter' default downstream.
        attackerAffinity: e.affinity,
        allyChargePerRound: undefined,
        activeCritGate: enemyActiveCritGate,
        chargedCritGate: enemyChargedCritGate,
        activeHealCritGate: enemyActiveHealCritGate,
        chargedHealCritGate: enemyChargedHealCritGate,
        debuffLandingGate: enemyDebuffLandingGate,
        extendChanceGate: enemyExtendChanceGate,
        landsTimedEnemyApplication: (
            application?: 'inflict' | 'apply',
            targetAffinity?: AffinityName,
            targetLandingChance?: number
        ): boolean =>
            application === 'apply'
                ? // Target-aware (Task A): when the ACTUAL target's affinity is supplied, re-resolve
                  // the applier's RAW affinity (e.affinity, same value fed to attackerAffinity) vs
                  // that target — an 'apply' lands UNLESS the applier is at a disadvantage. Absent
                  // (DPS/unit mode, single representative opponent) → the static flag, which already
                  // equals the target-aware result there → byte-identical.
                  targetAffinity !== undefined
                    ? getAffinityMatchup(e.affinity, targetAffinity) !== 'disadvantage'
                    : !affinityDisadvantage
                : // SP-4c-2b: `targetLandingChance` is THIS victim's own hacking-vs-security chance,
                  // supplied by the reactive path (which knows the victim it is inflicting on).
                  // Falling back to `runtime.liveDebuffLandingChance` keeps the cast path — whose
                  // turn target IS the actor's own — byte-identical, and keeps a caller with no
                  // victim in hand on the old neutral guard.
                  enemyDebuffLandingGate(
                      targetLandingChance ?? runtime.liveDebuffLandingChance ?? 1
                  ),
        selfBuffLookup: new Map(),
        enemyDebuffLookup,
    };
    return runtime;
}

function totalStacks(entries: ActiveDoTStack[]): number {
    return entries.reduce((sum, e) => sum + e.stacks, 0);
}

/** De-dupe ActiveBuffs by buffName, keeping the first occurrence. Used to collapse the
 *  per-round enemy-effects union (multiple enemy attackers can carry the same status) so
 *  the UI shows each effect once per round (Task 10). */
function dedupeByBuffName(buffs: ActiveBuff[]): ActiveBuff[] {
    const seen = new Set<string>();
    const out: ActiveBuff[] = [];
    for (const b of buffs) {
        if (seen.has(b.buffName)) continue;
        seen.add(b.buffName);
        out.push(b);
    }
    return out;
}

/** Merge a pre-tick DoT snapshot with the live (post-tick) container for display purposes.
 *  Live entries take precedence (they reflect the current state after the tick). Snapshot
 *  entries whose (sourceId, tier) key is absent from live are appended — those are the DoTs
 *  that ticked AND expired within this round (the tick-and-expire case: CodeRabbit finding). */
function mergeDoTsForDisplay(
    snapshot: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[],
    live: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[]
): Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[] {
    if (snapshot.length === 0) return live;
    const liveKeys = new Set(live.map((e) => `${e.sourceId}-${e.tier}`));
    const expiredOnly = snapshot.filter((e) => !liveKeys.has(`${e.sourceId}-${e.tier}`));
    return expiredOnly.length === 0 ? live : [...live, ...expiredOnly];
}

/** Assemble the per-round `EnemyRoundEffects[]` for the healing UI (Task 4a). Each enemy that acted
 *  (in `roundEnemyEffects`, keyed by actor id) keeps its de-duped self-buffs/debuffs; on top, the
 *  DoTs ACTIVE on the heal target this round are attributed to their applier via the stack
 *  `sourceId`, summed per type+tier (mirroring the DPS active-DoT display). A DoT-only enemy (no
 *  self-buffs/debuffs, so absent from `roundEnemyEffects`) gets a fresh entry appended so its DoTs
 *  still surface. NAMES/COUNTS ONLY for display — never folded into a sim value. */
function buildEnemyRoundEffects(
    roundEnemyEffects: Map<
        string,
        {
            selfBuffs: ActiveBuff[];
            debuffs: ActiveBuff[];
            resistedDebuffs: ActiveBuff[];
            resistedDots: EnemyDoTState[];
        }
    >,
    corrosionEntries: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[],
    infernoEntries: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[]
): EnemyRoundEffects[] {
    // Sum active stacks per source → type → tier, preserving first-seen source order.
    const dotsBySource = new Map<string, Map<string, EnemyDoTState>>();
    const accumulate = (
        type: DoTType,
        entries: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[]
    ): void => {
        for (const e of entries) {
            let byKey = dotsBySource.get(e.sourceId);
            if (!byKey) {
                byKey = new Map();
                dotsBySource.set(e.sourceId, byKey);
            }
            const key = `${type}-${e.tier}`;
            const existing = byKey.get(key);
            if (existing) existing.stacks += e.stacks;
            else byKey.set(key, { type, tier: e.tier, stacks: e.stacks });
        }
    };
    accumulate('corrosion', corrosionEntries);
    accumulate('inferno', infernoEntries);

    // Merge resisted DoTs by type+tier, summing stacks — consistent with the landed `dots`
    // accumulate-by-type+tier semantics above so repeats collapse to one row.
    const mergeResistedDots = (dots: EnemyDoTState[]): EnemyDoTState[] => {
        const byKey = new Map<string, EnemyDoTState>();
        for (const d of dots) {
            const key = `${d.type}-${d.tier}`;
            const existing = byKey.get(key);
            if (existing) existing.stacks += d.stacks;
            else byKey.set(key, { ...d });
        }
        return Array.from(byKey.values());
    };

    const out: EnemyRoundEffects[] = [];
    const emitted = new Set<string>();
    // Enemies that acted (self-buffs/debuffs) first, in their acting order — each gains its DoTs.
    for (const [enemyId, e] of roundEnemyEffects) {
        emitted.add(enemyId);
        out.push({
            enemyId,
            selfBuffs: dedupeByBuffName(e.selfBuffs),
            debuffs: dedupeByBuffName(e.debuffs),
            dots: Array.from(dotsBySource.get(enemyId)?.values() ?? []),
            resistedDebuffs: dedupeByBuffName(e.resistedDebuffs),
            resistedDots: mergeResistedDots(e.resistedDots),
        });
    }
    // DoT-only enemies (active DoTs but no self-buffs/debuffs) appended in container order.
    for (const [sourceId, byKey] of dotsBySource) {
        if (emitted.has(sourceId)) continue;
        emitted.add(sourceId);
        out.push({
            enemyId: sourceId,
            selfBuffs: [],
            debuffs: [],
            dots: Array.from(byKey.values()),
            resistedDebuffs: [],
            resistedDots: [],
        });
    }
    return out;
}

function expireStacks(entries: ActiveDoTStack[]): void {
    for (let i = entries.length - 1; i >= 0; i--) {
        entries[i].remainingRounds -= 1;
        if (entries[i].remainingRounds <= 0) {
            entries.splice(i, 1);
        }
    }
}

// Step 6: Process bombs — their burst is detonation damage (same category as Step 2.95).
// `emitBombDetonated` is called once per burst (per detonating bomb entry) so Phase 3
// reactive triggers can observe each burst's actorId, round, stacks, and damage.
// Per-actor attribution (Task 4): each burst uses the APPLIER's affinityMult (snapshotted at
// application) and is credited to that applier's detonation channel via `creditDetonation`.
// `actorIdFor` supplies the bomb-detonated event's actorId (the applier).
function processBombs(args: {
    pendingBombs: PendingBomb[];
    emitBombDetonated?: (actorId: string, stacks: number, damage: number) => void;
    creditDetonation: (sourceId: string, damage: number) => void;
}): void {
    for (let i = args.pendingBombs.length - 1; i >= 0; i--) {
        args.pendingBombs[i].countdown -= 1;
        if (args.pendingBombs[i].countdown <= 0) {
            const bomb = args.pendingBombs[i];
            const burstDamage =
                bomb.stacks *
                bomb.damagePerStack *
                bomb.affinityMult *
                (1 + bomb.detonationDamageModifier / 100);
            args.emitBombDetonated?.(bomb.sourceId, bomb.stacks, burstDamage);
            args.creditDetonation(bomb.sourceId, burstDamage);
            args.pendingBombs.splice(i, 1);
        }
    }
}

/** SP-4b-2 D6: the footprint of an `all-enemies` ability — every occupied cell of the opposing
 *  board, all at ORIGIN role (full damage; `resolveCells` special-cases shape 'all' and ignores
 *  the anchor's geometry entirely). Used by `passiveSlotPattern` for a passive-slot damage
 *  ability whose own `target` is `'all-enemies'` (Judge, Incinerator). */
const ALL_ENEMIES_PATTERN: ParsedPattern = {
    raw: 'all enemies',
    shape: 'all',
    range: 'all',
    modifiers: {},
};

// Step 6b: Echoing Burst accumulators gather this round's direct damage, then detonate
// for pct% of the accumulated total on expiry (game-categorised as detonation damage).
// directDamage already includes affinity, so no extra affinity multiplier is applied.
// Per-actor attribution (Task 4): the accumulation INPUT is the summed direct damage of the
// ACCUMULATING SIDE this round (spec: Echoing Burst gathers all its side's direct); the OUTPUT
// burst is credited to the accumulator's applier via `creditDetonation`.
//
// SP-4b-2 D1: the input is now supplied by `directDealtBy(<that side's roster>)`, which reads the
// scalar credit channel AND its positional twin. It used to be a bare sum over the scalar
// `roundDamage` map, which a positional run never writes — so every accumulator drained on
// schedule for exactly 0.
//
// #345: `emitAccumulatorDetonated` is called once per burst, so an APPLIER-scoped reaction can
// observe it — the sibling of `processBombs`' `emitBombDetonated`, which this function went
// without. Valkyrie's "when an Echoing Burst explodes on an enemy … repair 5% of damage dealt"
// rode the Bomb event instead, which meant it fired on any teammate's Bomb and never once on her
// own burst. Emitted BEFORE `creditDetonation` (the same order `processBombs` uses); the reaction
// it enqueues drains later regardless.
function processAccumulators(args: {
    pendingAccumulators: PendingAccumulator[];
    /** Direct damage the ACCUMULATING side (the side that applied these accumulators — i.e. the
     *  bursting actor's OPPOSING roster) has dealt so far this round. */
    gatheredDirect: number;
    emitAccumulatorDetonated?: (actorId: string, damage: number) => void;
    creditDetonation: (sourceId: string, damage: number) => void;
}): void {
    for (let i = args.pendingAccumulators.length - 1; i >= 0; i--) {
        const acc = args.pendingAccumulators[i];
        acc.accumulated += args.gatheredDirect;
        acc.roundsRemaining -= 1;
        if (acc.roundsRemaining <= 0) {
            const damage = acc.accumulated * (acc.pct / 100);
            args.emitAccumulatorDetonated?.(acc.sourceId, damage);
            args.creditDetonation(acc.sourceId, damage);
            args.pendingAccumulators.splice(i, 1);
        }
    }
}

// Steps 4 & 5: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%) and
// inferno (scales with the APPLIER's effective attack, no outgoing buff), then expire both
// stack sets. Per-actor attribution (Task 4): each entry ticks with its applier's ctx (looked
// up via `ctxFor(entry.sourceId)`) — inferno uses the applier's effectiveAttack, both use the
// applier's dotMult/affinityMult; corrosion stays enemy-HP-based. An entry whose applier has
// no ctx yet (faster-enemy round 1) is skipped this tick (its applier acts later). Damage is
// credited per applier via `credit`; the `dot-ticked` event carries the per-dotType SUMMED
// damage (preserving the pre-Task-4 single-event-per-type emission). At attacker-only this
// produces byte-identical totals (exactly one applier → same sums).
//
// Sub-project I, PR I4b: `dotMultFor(ctx)` replaces the bare `ctx.dotMult` read for BOTH
// dotTypes — it re-folds any enemy-status-name-gated dotDamage modifier (Wildfire) against
// THIS call's ticking victim, live, at tick time (see `victimDotMult`). Every call site that
// doesn't pass it (or an applier ctx with no such modifier) is unaffected: `ctx.dotMult` alone.
/** DoT types `tickDoTs` handles as a per-round tick — everything except 'bomb' (bombs burst on a
 *  timed countdown via `processBombs`, a separate mechanism, never a per-round tick). SP-E: added
 *  'generic' alongside 'corrosion'/'inferno'. */
type TickableDoTType = Exclude<DoTType, 'bomb'>;

export function tickDoTs(args: {
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    /** SP-E: absolute per-tick generic DoT entries (Voron/Orel transform, Acidic Decay family). */
    genericDoTEntries: ActiveDoTStack[];
    enemyHp: number;
    ctxFor: (sourceId: string) => PlayerRoundCtx | undefined;
    /** Called ONCE PER (dotType, tier) GROUP that ticked (corrosion/inferno split by tier so the
     *  combat log shows "corrosion I ×n" and "corrosion III ×m" on separate lines; generic emits a
     *  single tier-0 call). `stacks` = the summed ticking stacks for that group (only entries with a
     *  resolvable applier ctx are counted for corrosion/inferno; generic counts all). `tier` = the
     *  group's tier MAGNITUDE (corrosion 3/6/9, inferno 15/30/45; 0 for generic). */
    emitTicked: (dotType: TickableDoTType, damage: number, stacks: number, tier: number) => void;
    /**
     * @param damage        the tick's damage as the victim TAKES it — post `incomingDotReductionPct`.
     * @param preMitigation #358 ADDENDUM 3 (C2/C4): the same tick as THROWN. Two victim-side
     *        reductions are absent from it: this carrier's `incomingDotReductionPct` (Vortex Veil),
     *        and — for a generic DoT re-booking a `convertHitToSelfDot` deferral — the defence
     *        mitigation the original direct hit folded, recovered from the entry's
     *        `perTickPreMitigation`. Equal to `damage` for every tick that had neither.
     *        Callers that book a DAMAGE number must use `damage`; only the victim's
     *        "damage absorbed" (raw intake) axis reads this.
     */
    credit: (
        sourceId: string,
        dotType: TickableDoTType,
        damage: number,
        preMitigation: number
    ) => void;
    /** D-PR3 (Vortex Veil): % reduction applied to this carrier's DoT ticks of the given type.
     *  Absent → 0 → byte-identical. */
    incomingDotReductionPct?: (dotType: TickableDoTType) => number;
    /** Sub-project I, PR I4b — resolves the EFFECTIVE dotMult for one applier's ctx, given the
     *  ticking VICTIM (this tickDoTs call's whole entries list belongs to ONE victim, so the
     *  victim is fixed for the call; only the per-entry applier ctx varies). Defaults to the
     *  applier's `ctx.dotMult` unchanged — every call site that doesn't (yet) pass this stays
     *  byte-identical. Production call sites pass the engine's `victimDotMult` closure. */
    dotMultFor?: (ctx: PlayerRoundCtx) => number;
}): void {
    const dotMultFor = args.dotMultFor ?? ((ctx: PlayerRoundCtx) => ctx.dotMult);
    // Per-(dotType,tier) tick group — the combat log shows each tier on its own line, so a mix of
    // e.g. Corrosion I and Corrosion III does not collapse into one summed line. `credits` keeps
    // the per-entry credit list IN ENTRY ORDER so crediting is byte-identical to the pre-grouping
    // single-loop behaviour; only the log-facing `emitTicked` granularity changes.
    interface TickGroup {
        sum: number;
        stacks: number;
        credits: Array<{ sourceId: string; d: number }>;
    }
    // Sum-then-emit for a whole DoT type, split by tier. Emits per tier ASCENDING (deterministic
    // log order, independent of entry order). Credits run in entry order across all tiers, exactly
    // as before, so total credited damage and RNG-free credit order are unchanged.
    const tickByTier = (
        dotType: 'corrosion' | 'inferno',
        entries: ActiveDoTStack[],
        damageOf: (e: ActiveDoTStack, ctx: PlayerRoundCtx) => number
    ): void => {
        const byTier = new Map<number, TickGroup>();
        const creditOrder: Array<{
            sourceId: string;
            dotType: 'corrosion' | 'inferno';
            d: number;
        }> = [];
        let total = 0;
        for (const e of entries) {
            const ctx = args.ctxFor(e.sourceId);
            if (!ctx) continue; // applier has not acted yet this run (faster-enemy round 1)
            const d = damageOf(e, ctx);
            let g = byTier.get(e.tier);
            if (!g) {
                g = { sum: 0, stacks: 0, credits: [] };
                byTier.set(e.tier, g);
            }
            g.sum += d;
            g.stacks += e.stacks;
            creditOrder.push({ sourceId: e.sourceId, dotType, d });
            total += d;
        }
        if (total <= 0) return;
        const reductionPct = args.incomingDotReductionPct?.(dotType) ?? 0;
        const factor = 1 - reductionPct / 100;
        // #358 ADDENDUM 3: `d` (pre-`factor`) is the tick as THROWN; `d * factor` is what the
        // carrier takes after its own DoT-reduction ability. Both are handed over — see `credit`.
        for (const { sourceId, d } of creditOrder) args.credit(sourceId, dotType, d * factor, d);
        for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
            const g = byTier.get(tier)!;
            if (g.sum <= 0) continue;
            args.emitTicked(dotType, g.sum * factor, g.stacks, tier);
        }
    };

    // Step 4: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%)
    const corrosionBaseHp = Math.min(args.enemyHp, 500_000);
    tickByTier(
        'corrosion',
        args.corrosionEntries,
        (e, ctx) => e.stacks * (e.tier / 100) * corrosionBaseHp * dotMultFor(ctx) * ctx.affinityMult
    );

    // Step 5: Tick inferno (scales with the applier's effective attack, no outgoing buff)
    tickByTier(
        'inferno',
        args.infernoEntries,
        (e, ctx) =>
            e.stacks * (e.tier / 100) * ctx.effectiveAttack * dotMultFor(ctx) * ctx.affinityMult
    );

    // SP-E: Tick generic DoTs — an ABSOLUTE per-tick amount, independent of stats/HP (no ctxFor
    // gate: unlike corrosion/inferno, a generic tick doesn't need the applier's effective attack
    // or affinity, so it ticks even before the applier's first turn this run).
    let genericSum = 0;
    let genericStacks = 0;
    const genericCredits: Array<{ sourceId: string; d: number; pre: number }> = [];
    for (const e of args.genericDoTEntries) {
        const d = (e.perTickAmount ?? 0) * e.stacks;
        // #358 ADDENDUM 3 (C4): a generic entry created by `convertHitToSelfDot` carries the
        // PRE-mitigation slice of the direct hit it deferred. `?? e.perTickAmount` covers every
        // other generic DoT (Acidic Decay and friends), which folds no defence and so ticks the
        // same amount on both axes.
        const pre = (e.perTickPreMitigation ?? e.perTickAmount ?? 0) * e.stacks;
        genericCredits.push({ sourceId: e.sourceId, d, pre });
        genericSum += d;
        genericStacks += e.stacks;
    }
    if (genericSum > 0) {
        const reductionPct = args.incomingDotReductionPct?.('generic') ?? 0;
        const factor = 1 - reductionPct / 100;
        for (const { sourceId, d, pre } of genericCredits)
            args.credit(sourceId, 'generic', d * factor, pre);
        // Generic DoTs are untiered (absolute per-tick) → single tier-0 group.
        args.emitTicked('generic', genericSum * factor, genericStacks, 0);
    }

    // Expire DoT stacks after ticking
    expireStacks(args.corrosionEntries);
    expireStacks(args.infernoEntries);
    expireStacks(args.genericDoTEntries);
}

/** Damage-credit channels the standing-leech hook distinguishes (damage-leech spec §4). */
type LeechChannel = 'direct' | 'detonation' | 'corrosion' | 'inferno' | 'generic';

/** A team actor input as the ENGINE consumes it: the public TeamActorInput plus an
 *  optional `walk` bundle the adapter (simulateDPS) resolves when the actor carries
 *  shipSkills. With `walk` the actor runs the full runPlayerTurn pipeline; without it it
 *  stays the legacy scheduled-list source (byte-identical to pre-walk behaviour). The
 *  walk's per-actor rates are pre-derived by the adapter (same shape as the attacker's). */
export type TeamActorEngineInput = TeamActorInput & {
    walk?: {
        shipSkills: ShipSkills;
        stats: CombatStatBlock;
        selfDotModifier: number;
        defensePenetrationBuff: number;
        affinityDamageModifier: number;
        affinityCritCap: number;
        affinityCritPenalty: number;
        hasChargedSkill: boolean;
        /** Caster heal-modifier stat (healing calc). Default 0. */
        healModifier?: number;
        /** RAW affinity of this team actor — the SAME affinity (TeamActorInput.affinity) the
         *  adapter fed to computeAffinityModifiers to produce `affinityDamageModifier` in this
         *  bundle, so the two never disagree. Threaded onto the runtime's attackerAffinity
         *  (consumed by the positional apply path via positionalScalars.attackerAffinity →
         *  victimHitDamage's per-victim matchup recompute) + the CombatActor.affinity (consumed
         *  wherever a victim's own affinity is read). Absent → neutral default ('antimatter')
         *  downstream. */
        affinity?: AffinityName;
    };
    /** Board position of this team actor. Consumed by isPositional/resolvePositionalTarget at
     *  the walked-team positional target-selection and footprint-apply sites. */
    position?: Position;
    /** Attacker ignores Taunt/Provoke forced targeting (not Concentrate Fire). Populated from the
     *  ship's own skill text via buildShipAbilities/detectIgnoresForcedTargeting; ORed at the read
     *  sites with the timed `Rogue's Liberty` buff (rogueLiberty.ts). */
    ignoresForcedTargeting?: boolean;
    /** W6: ship-wide stealth-targeting bypass. */
    ignoresStealth?: boolean;
    /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
     *  site (§4.5 Akula exception). Optional — undefined treated as false. */
    doesntBreakStasis?: boolean;
    /** Attacker is immune to charge loss effects (Lev). Enemy-sourced charge removal is a
     *  no-op against actors with this flag set (Phase 0 Task 7). Optional — undefined = false. */
    chargeLossImmune?: boolean;
    /** Pre-parsed targeting preference for this team actor. Consumed by the walked-team
     *  positional target selection AND the Task 8b positional apply at the team damage site. */
    target?: ParsedTarget;
    /** Pre-parsed positional pattern for this team actor. Consumed by the Task 8b positional
     *  apply at the team damage site (origin/covered footprint expansion). */
    pattern?: ParsedPattern;
    /** Pre-parsed charged-skill pattern when it differs from active; falls back to `pattern`. */
    chargedPattern?: ParsedPattern;
    /** SP-F F5: pre-parsed charged-skill TARGET selection when it differs from active; falls
     *  back to `target`. Drives BOTH the damage footprint anchor AND target-selection on a
     *  charge-firing turn (mirrors `chargedPattern`'s contract). */
    chargedTarget?: ParsedTarget;
    /** Pre-fight combat-modifier baseline (sub-project F, PR F3) — squad-leader modifier
     *  channels for this team actor. Absent → all folds inert (byte-identical). */
    preFight?: PreFightCombatModifiers;
};

/**
 * What kind of run this is — the engine's ONLY run-kind discriminator.
 *
 *  - `'dps'`     the focus's output is the report. The run ends when the focus itself dies
 *                (`isDpsMeasurementRun`, nothing left to measure). There used to be a SECOND
 *                dps-run exit — the focus's TARGET dying — which was not mode-gated but derived
 *                from roster emptiness (`dpsEnemyTarget`, i.e. no enemy attackers). SP-4b-2b made
 *                that derivation permanently false (`normalizeCombatRoster` throws on an
 *                absent/empty roster) and SP-4c-2d deleted it with the dummy actor. A real enemy's
 *                death now ends the run through SP-4c-1's side-wipe rule, in every mode.
 *  - `'healing'` heal/shield accounting is the report. The run continues past the focus's death.
 *  - `'battle'`  two-team battle. The squad fights on without its focus.
 *
 * Default `'dps'`. The default is a CONSTANT, not a derivation — that distinction is the whole
 * point of this type. Never infer a mode from a data field (`healTargetId`, roster emptiness):
 * that is exactly what SP-4 removed.
 */
export type RunMode = 'dps' | 'healing' | 'battle';

export interface CombatEngineInput {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    /** Shield penetration for the focus attacker (H1 Task 2). Optional — defaults to 0 at the
     *  actor-construction site. No production reader until H1 Task 4 wires the apply path. */
    shieldPenetration?: number;
    chargeCount: number;
    shipSkills: ShipSkills;
    numRounds: number;
    /** Scheduled (manual + team) buffs — statusEngine input. */
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
    /** Team ships as real speed-ordered actors (Phase 2). Their buff lists are keyed to
     *  their own turns via the status engine's teamSources, NOT merged into selfBuffs/
     *  enemyDebuffs (no-double-count). */
    teamActors?: TeamActorEngineInput[];
    // Rate/fold fields below (selfDotModifier, defensePenetrationBuff)
    // are pre-derived by the adapter (simulateDPS) — pass the resolved values, not raw hacking.
    selfDotModifier: number;
    defensePenetrationBuff: number;
    hasChargedSkill: boolean;
    startCharged: boolean;
    affinityDamageModifier: number;
    affinityCritCap: number;
    affinityCritPenalty: number;
    defence: number;
    hp: number;
    /** Focus attacker's base hacking (A2 Task 2). Optional — base for effectiveStatsOf.hacking on the
     *  attacker actor. The adapter passes `input.hacking ?? 200` (the OLD landing-formula default); no
     *  production reader until dynamic landing lands (A2 Task 4). */
    hacking?: number;
    /** Focus attacker's base security. Optional — base for effectiveStatsOf.security on the
     *  attacker actor. Threaded so the focus actor's own security (e.g. gear-folded via Code
     *  Guard) reaches both the per-turn stats-snapshot and the live debuff-landing recompute
     *  when the focus is the target of an enemy debuff, instead of silently defaulting. */
    security?: number;
    allyChargePerRound?: number;
    enemyType?: EnemyBaseClass;
    /** Attacker turn-order speed. Default 100. */
    speed?: number;
    /** Caster heal-modifier stat (healing calc). Default 0. */
    healModifier?: number;
    /** FOCUS actor's ship role (Ship.type) for role-filtered ally-damage reactions
     *  (Graphite's "when a Defender or Debuffer ally takes damage"). Team actors carry
     *  their own `role` on TeamActorInput. Absent (manual stats / no ship picked) →
     *  the focus actor never matches a role filter — the reaction stays dormant for
     *  hits on it (conservative; mirrors TeamActorInput.role's contract). */
    role?: ShipTypeName;
    /** SP-F F4: FOCUS actor's ship name, for the live `ally-on-team` roster check (Isha/Nayra
     *  reciprocal Override gate). Absent → assume-met fallback (byte-identical). */
    name?: string;
    /** #363: FOCUS actor's faction, for `factionFilter`'d ally scopes (factionByActorId). Team
     *  actors carry their own `faction` on TeamActorInput. Absent (manual stats / no ship picked)
     *  → unknown faction → the focus never matches a faction filter (conservative). */
    faction?: FactionKey;
    /** The player actor id that heals/shields route to and consume against. Must be a player
     *  actor id (focus or a team actor). Required by `mode: 'healing'`; optional under
     *  `mode: 'battle'` (battle mode otherwise anchors the heal target to the focus actor, and
     *  the heal pipeline stays active either way); forbidden under `mode: 'dps'`. */
    healTargetId?: string;
    /** See `RunMode`. Default `'dps'`. Validated against `healTargetId`: `mode: 'healing'`
     *  without `healTargetId` throws, and `healTargetId` with a mode other than `'healing'` or
     *  `'battle'` throws. */
    mode?: RunMode;
    /** Apply heals to EACH recipient's own actor (per-recipient application). This is the
     *  APPLICATION axis and nothing more: since SP-4e Task 4 recipient CHOICE comes from the
     *  ability's own target on every run — a text-named worst-HP ally routes to that ally, and
     *  everything else routes over the caster's support PATTERN, which is the game's rule for every
     *  ship. (The retired `teamBattle` flag used to make `mode: 'battle'` pick lowest-HP routing for
     *  a plain `'ally'`; that conflated the two axes and is gone.) The healing calculator sets this
     *  once it runs positionally; `mode: 'battle'` implies it too, so the battle sim is unaffected.
     *  Absent/false → heals apply only to `healTargetId` (legacy single-target accounting). */
    perRecipientHealApply?: boolean;
    /** The opposing roster — REQUIRED on every run since SP-4b-2b, and never empty (the boundary
     *  throws). Real ships carrying stats + `shipSkills`, positioned by `normalizeCombatRoster`
     *  when they arrive without a slot. A caller with no enemy to model synthesizes an inert one
     *  rather than passing `[]`; see `healingEngineAdapter.practiceTarget`.
     *  `defence` and `hp` are optional now (default 0 for bare-stat legacy path); Task 9
     *  populates them with real matchup values via the adapter. */
    enemyAttackers: {
        id: string;
        stats: {
            attack: number;
            crit: number;
            critDamage: number;
            speed: number;
            /** Enemy's own defence stat. Default 0. Task 9 provides real value. */
            defence?: number;
            /** Enemy's own hp stat. Default 0. Task 9 provides real value. */
            hp?: number;
            /** Base hacking (A2 Task 2). Optional — base for effectiveStatsOf.hacking; unread until A2 Task 4. */
            hacking?: number;
            /** Base security (A2 Task 2). Optional — base for effectiveStatsOf.security; unread until A2 Task 4. */
            security?: number;
            /** Shield penetration (H1 Task 2). Optional — flows onto the enemy CombatActor's
             *  stats.shieldPenetration. No production reader until H1 Task 4. */
            shieldPenetration?: number;
        };
        chargeCount: number;
        startCharged: boolean;
        shipSkills?: ShipSkills;
        /** Pre-resolved affinity damage modifier vs the heal target. Default 0 (neutral). */
        affinityDamageModifier?: number;
        /** Pre-resolved crit cap vs the heal target. Default 100 (neutral). */
        affinityCritCap?: number;
        /** Pre-resolved crit penalty vs the heal target. Default 0 (neutral). */
        affinityCritPenalty?: number;
        /** Board position of this enemy attacker. Consumed by isPositional/resolvePositionalTarget
         *  at the enemy-turn positional target-selection and footprint-apply sites. */
        position?: Position;
        /** Attacker ignores Taunt/Provoke forced targeting (not Concentrate Fire). Populated from the
         *  ship's own skill text via buildShipAbilities/detectIgnoresForcedTargeting; ORed at the read
         *  sites with the timed `Rogue's Liberty` buff (rogueLiberty.ts). */
        ignoresForcedTargeting?: boolean;
        /** W6: ship-wide stealth-targeting bypass. */
        ignoresStealth?: boolean;
        /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
         *  site (§4.5 Akula exception). Optional — undefined treated as false. */
        doesntBreakStasis?: boolean;
        /** Attacker is immune to charge loss effects (Lev). Enemy-sourced charge removal is a
         *  no-op against actors with this flag set (Phase 0 Task 7). Optional — undefined = false. */
        chargeLossImmune?: boolean;
        /** Pre-parsed targeting preference for this enemy attacker. Consumed by the enemy-turn
         *  positional target selection AND the positional apply at the enemy damage site
         *  (threaded via enemyTargetById). */
        target?: ParsedTarget;
        /** Pre-parsed positional pattern for this enemy attacker. Consumed by the positional
         *  apply at the enemy damage site (origin/covered footprint expansion; threaded via
         *  enemyPatternById). */
        pattern?: ParsedPattern;
        /** Pre-parsed charged-skill pattern when it differs from active; falls back to `pattern`. */
        chargedPattern?: ParsedPattern;
        /** SP-F F5: pre-parsed charged-skill TARGET selection when it differs from active; falls
         *  back to `target`. Drives BOTH the damage footprint anchor AND target-selection on a
         *  charge-firing turn (mirrors `chargedPattern`'s contract). */
        chargedTarget?: ParsedTarget;
        /** RAW affinity of this enemy attacker — the SAME affinity the adapter fed to
         *  computeAffinityModifiers for `affinityDamageModifier` above. Threaded onto the
         *  runtime's attackerAffinity, consumed by the positional apply path via
         *  positionalScalars.attackerAffinity → victimHitDamage's per-victim matchup recompute.
         *  Absent → neutral default ('antimatter') downstream. */
        affinity?: AffinityName;
        /** Pre-fight combat-modifier baseline (sub-project F, PR F3) — squad-leader modifier
         *  channels for this enemy attacker. Absent → all folds inert (byte-identical). */
        preFight?: PreFightCombatModifiers;
        /** SP-F F5: this enemy attacker's ship role (Ship.type) — see EnemyActorInput.role's doc
         *  comment for the full contract (Meatshield defense-substitution's "non-defender ally"
         *  classification, side-agnostic via roleByActorId). */
        role?: ShipTypeName;
        /** SP-F F4: this enemy attacker's ship name — see EnemyActorInput.name (live
         *  `ally-on-team` roster check). Absent → assume-met fallback. */
        name?: string;
        /** #363: this enemy attacker's faction — see EnemyActorInput.faction (factionByActorId,
         *  side-agnostic by key). Absent → unknown faction → never matches a filter. */
        faction?: FactionKey;
    }[];
    /** Emit-only event tap. Listeners must not read or mutate combat state. */
    bus?: CombatEventBus;
    /** Board position of the focus attacker. Consumed by isPositional/resolvePositionalTarget at
     *  the focus positional target-selection and footprint-apply sites. */
    position?: Position;
    /** Attacker ignores Taunt/Provoke forced targeting (not Concentrate Fire). Populated from the
     *  ship's own skill text via buildShipAbilities/detectIgnoresForcedTargeting; ORed at the read
     *  sites with the timed `Rogue's Liberty` buff (rogueLiberty.ts). */
    ignoresForcedTargeting?: boolean;
    /** W6: ship-wide stealth-targeting bypass. */
    ignoresStealth?: boolean;
    /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
     *  site (§4.5 Akula exception). Optional — undefined treated as false. */
    doesntBreakStasis?: boolean;
    /** Attacker is immune to charge loss effects (Lev). Enemy-sourced charge removal is a
     *  no-op against actors with this flag set (Phase 0 Task 7). Optional — undefined = false. */
    chargeLossImmune?: boolean;
    /** Pre-parsed targeting preference for the focus attacker. Consumed by the focus positional
     *  target selection AND the Task 8b positional apply at the focus damage site. */
    target?: ParsedTarget;
    /** Pre-parsed positional pattern for the focus attacker. Consumed by the Task 8b positional
     *  apply at the focus damage site (origin/covered footprint expansion). */
    pattern?: ParsedPattern;
    /** Pre-parsed charged-skill pattern when it differs from active; falls back to `pattern`. */
    chargedPattern?: ParsedPattern;
    /** SP-F F5: pre-parsed charged-skill TARGET selection when it differs from active; falls
     *  back to `target`. Drives BOTH the damage footprint anchor AND target-selection on a
     *  charge-firing turn (mirrors `chargedPattern`'s contract). */
    chargedTarget?: ParsedTarget;
    /** RAW affinity of the focus attacker — the SAME affinity matchup the page resolved into the
     *  pre-resolved `affinityDamageModifier` above, so the two never disagree. Threaded onto the
     *  attacker runtime's attackerAffinity (consumed by the positional apply path via
     *  positionalScalars.attackerAffinity → victimHitDamage's per-victim matchup recompute) + the
     *  CombatActor.affinity (consumed wherever a victim's own affinity is read). Absent → neutral
     *  default ('antimatter') downstream. */
    affinity?: AffinityName;
    /** Pre-fight combat-modifier baseline (sub-project F, PR F3) — squad-leader modifier
     *  channels for the focus attacker. Absent → all folds inert (byte-identical). */
    preFight?: PreFightCombatModifiers;
    /** TEST-ONLY tap (Phase 4 PR1, Task 3): receives the genuine `applyOutgoingToEnemy` closure
     *  once on the first round it is built, so unit tests can exercise the player→enemy victim
     *  wrapper against a hand-built enemy actor. Never set by production code; the closure runs the
     *  real applyVictimDamage path (no mocks).
     *  KEPT (not removed once Task 8/9 wired production callers): `applyOutgoingToEnemy.test.ts`
     *  behaviour #6 — the enemy-side sink now records per-victim intake (incoming / shield-absorbed /
     *  barrier-absorbed into the victim's own bucket, since E1) — is unique coverage the
     *  positionalDamage integration test cannot observe (it only sees `ship-destroyed`). Inert
     *  (optional, never set in production). */
    __testTapApplyOutgoingToEnemy?: (
        fn: (damage: number, enemyVictim: CombatActor) => VictimDamageOutcome
    ) => void;
    /** TEST-ONLY notification hook (PR4b): fired on EVERY `creditDamage` call (both sides, every
     *  round) with the raw (sourceId, channel, amount) — a per-call NOTIFICATION, not a
     *  tap-the-closure-out pattern (creditDamage is redeclared every round inside the round
     *  loop, so exposing the closure reference the way `__testTapApplyOutgoingToEnemy` does
     *  would only ever surface the LAST round's instance). Needed because the reactive `damage`
     *  executor (Judge/Chakara/Incinerator/Rhodium/Grif/FrontLine) credits its mitigated/crit
     *  amount here rather than applying real HP damage via applyVictimDamage — there is no other
     *  observable surface for an ENEMY-owned reactive damage credit (its victim's `intakeFor`
     *  bucket is never touched; see the CREDIT-vs-INTAKE split above `roundDamage`). Lets
     *  integration tests observe the exact mitigated/crit amount an owner (either side) was
     *  credited, proving team-symmetric mitigation without needing a leech buff as an indirect
     *  HP-based proxy. Never set by production code; inert when absent. */
    __testTapCreditDamage?: (
        sourceId: string,
        // SP-E: widened to include 'generic' (mirrors LeechChannel).
        channel: 'direct' | 'detonation' | 'corrosion' | 'inferno' | 'generic',
        amount: number
    ) => void;
    /** TEST-ONLY tap (A2 Task 2): receives the full `allActors` roster once, right after actors
     *  are constructed, so unit tests can assert the plumbed base hacking/security on each actor
     *  (the bases have no production reader yet). Never set by production code; inert when absent.
     *  IMPORTANT: the passed array and its CombatActors are LIVE references mutated by the run
     *  (currentHp, currentShield, etc.) — test callbacks must read any mutable values immediately
     *  in the callback, not after runCombat returns. Base stats (hacking, security, etc.) are
     *  never mutated, so existing base-stat assertions are safe to read post-run. */
    __testTapActors?: (actors: CombatActor[]) => void;
    /** TEST-ONLY tap (B1 Task 2): receives the per-victim incoming-damage modifier reader
     *  (`victimIncomingModifiers`) once it is built in the round loop. Since D-PR12 the closure
     *  sums BOTH the enemy-debuff term AND the victim's own friendly self-buff term (field name
     *  kept as `__testTapVictimEnemyModifiers` to avoid churning the existing tap tests). Unit
     *  tests capture the closure and call it with a victim id to assert per-actor modifier reads.
     *  Never set by production code; inert when absent. The closure is per-round-identical
     *  in behaviour (only the live status-engine state changes), so capturing it once is sufficient
     *  for a single-round test. NOTE: the tap reads LIVE statusEngine state at call time, which
     *  is fine for single-round tests (the state is fully settled after runCombat returns). */
    __testTapVictimEnemyModifiers?: (
        fn: (victimId: string) => {
            enemyDefenseModifier: number;
            incomingDamageModifier: number;
            /** #358 ADDENDUM 3: the victim-side half of `incomingDamageModifier`. */
            victimSideIncomingModifier: number;
        }
    ) => void;
    /** TEST TAP (inert in production): exposes the engine-local isStasised(actorId) reader so a
     *  test can assert per-victim Stasis detection for both directions. Mirrors
     *  __testTapVictimEnemyModifiers. Never set by production callers. */
    __testTapIsStasised?: (fn: (actorId: string) => boolean) => void;
    /** TEST-ONLY tap (C2a Task 3): receives the live `statusEngine` once it is built so a test can
     *  read an actor's settled self-buff / debuff state AFTER `runCombat` returns (e.g. to assert a
     *  cast-path purge removed an enemy's self-buffs). Never set by production code; inert when
     *  absent. The engine reference is LIVE — read it after the run when state is fully settled. */
    __testTapStatusEngine?: (engine: StatusEngine) => void;
}

/** One round's healing accounting (healing mode only). `perActor` mirrors the round
 *  damage map. incomingDamage/shieldAbsorbed stay 0 until enemy attacks (Task 8).
 *  targetHpPctStart/targetShieldStart are captured at the ROUND TOP (raw floats — the
 *  adapter owns any rounding). */
/** One enemy attacker's effects for a single round, attributed to its actor id (Task 10a).
 *  selfBuffs = the self-buffs active on that enemy this round; debuffs = the debuffs/DoTs it
 *  landed on the heal target. Both are de-duped by buffName WITHIN this enemy (so the same
 *  status from two attackers stays distinct per source). The UI resolves enemyId → the enemy
 *  attacker's ship name (or its manual label) for the per-enemy round overview. */
export interface EnemyRoundEffects {
    enemyId: string;
    selfBuffs: ActiveBuff[];
    debuffs: ActiveBuff[];
    /** Enemy-applied DoTs (Corrosion/Inferno) ACTIVE on the heal target this round, attributed to
     *  this enemy via the stack's `sourceId` (the applier's actor id), summed per type+tier. Mirrors
     *  the DPS `ActiveDoTState` `{ type, tier, stacks }` shape so the UI reuses the DPS DoT-label
     *  helper. A DoT shows for every round it is active on the target (across its duration), so a
     *  DoT-based enemy (Torcher/Belladonna) surfaces in the panel even with no self-buffs/debuffs.
     *  NAMES ONLY for display — never folded into any sim value. Empty when no DoTs are active. */
    dots: EnemyDoTState[];
    /** TIMED debuffs this enemy attacker ATTEMPTED to inflict on the heal target this round but
     *  that were RESISTED by the live hacking-vs-security landing roll.
     *  De-duped by buffName WITHIN this enemy. NAMES ONLY for display — never folded into any sim
     *  value. Empty when every attempted debuff landed (or the enemy attempted none). */
    resistedDebuffs: ActiveBuff[];
    /** DoTs this enemy attacker ATTEMPTED to inflict on the heal target this round but that were
     *  RESISTED by the live hacking-vs-security landing roll (the whole turn's DoTs share one draw).
     *  Summed per type+tier like `dots`. NAMES/COUNTS ONLY for display — never folded into any sim
     *  value. Empty when the turn's DoTs landed (or the enemy attempted none). */
    resistedDots: EnemyDoTState[];
}

/** One enemy-applied DoT active on the heal target, attributed to its source enemy and summed per
 *  type+tier (mirrors the DPS `ActiveDoTState` shape, minus ticksRemaining which the panel omits). */
export interface EnemyDoTState {
    // SP-E: widened to DoTType (was 'corrosion' | 'inferno') for forward-compat with a future
    // generic-DoT healing-panel display; `accumulate` below is called only with 'corrosion'/
    // 'inferno' today (generic DoTs are not auto-applied from skill text in this task).
    type: DoTType;
    tier: number;
    stacks: number;
}

/** The four side-specific fields the reactive intent drain needs (enemy-team PR1). Everything
 *  else in the executor ctx is shared across sides; only these differ between the player drain
 *  and the enemy drain. `recipientIds` becomes the executor's `playerIds` (same-side recipients). */
interface ReactiveSideCtx {
    runtimes: Map<string, PlayerActorRuntime>;
    recipientIds: string[];
    isLowestSpeedAllyFor: (ownerId: string) => boolean;
    grantAllyCharges: (
        amount: number,
        opts?: { recipientIds?: string[]; emitBus?: CombatEventBus }
    ) => void;
    /** Enemy-targeted charge removal for this drain side — bySide(side).removeEnemyCharges, which
     *  subtracts from the OPPOSING side (floored at 0, immune actors skipped). The optional
     *  `applierAffinity` enforces the Charge Manipulation affinity gate (skip affinity-advantaged
     *  targets); omit it to disable the gate. The optional `emitBus` stamps the `charge-changed`
     *  when called during a reactive intent (pass ctx.bus). */
    removeEnemyCharges: (
        amount: number,
        applierAffinity?: AffinityName,
        emitBus?: CombatEventBus
    ) => void;
    /** Single-target charge removal for this drain side — bySide(side).removeChargesFrom, which
     *  subtracts from ONE actor by id (floored at 0, immune actors skipped). Same optional
     *  `applierAffinity` charge-manip gate as removeEnemyCharges, and the same optional `emitBus`. */
    removeChargesFrom: (
        targetId: string,
        amount: number,
        applierAffinity?: AffinityName,
        emitBus?: CombatEventBus
    ) => void;
    /** Live self-HP% for a same-side drain owner (drain-time hp-threshold gates). Optional —
     *  absent/undefined → buildDrainContext defaults the gate to 100. Pre-#415 this was always the
     *  DPS-mode case (no `healTarget` to source it from); #415 anchors `healTarget` to the focus in
     *  every mode, so the player side is now always defined here, DPS included. Sourced from
     *  bySide(side).selfHpPctFor (bySide PR3): player = heal-target HP, enemy = 100 until PR5. */
    selfHpPctFor?: (ownerId: string) => number;
    /** Per-side most-buffs opposing-actor resolver (Rhodium). See IntentExecContext. */
    enemyWithMostBuffs?: (ownerId: string) => string | undefined;
    /** D-PR14 Doomsayer: per-side highest-attack opposing-actor resolver. See IntentExecContext. */
    enemyWithHighestAttack?: (ownerId: string) => string | undefined;
    /** SP-M M1 Task 6 Chakara: per-side highest-speed opposing-actor resolver. See
     *  IntentExecContext. Resolved LIVE (no onceByOwner memo) — unlike enemyWithMostBuffs,
     *  Chakara's co-located clause is a SELF-buff that never changes an enemy's speed. */
    enemyWithHighestSpeed?: (ownerId: string) => string | undefined;
    /** SP-M M1 Task 7 Judge/Incinerator: LIVING opposing-actor ids for an 'all-enemies' reactive
     *  DAMAGE proc (per-victim-conditional AoE). Player side → living enemy attackers; enemy side
     *  → living player actors. See IntentExecContext. Resolved LIVE per drain (no memo). */
    livingOpposingActorIds?: (ownerId: string) => string[];
    /** D-PR14: id of the round's first real activator (live value at drain-build time). */
    firstActivatorId?: string;
    /** D-PR16: id of the sole living actor on this side, recomputed each drain (Last Stand). */
    lastStandingId?: string;
    /** D-PR14 Bulwark: per-round once-per-(owner,ability) consume set (shared across both sides). */
    oncePerRoundConsumed?: Set<string>;
    /** ship-kit W3 (Sansi): per-round fire COUNT per (owner,ability) backing Ability.maxPerRound
     *  (shared across both sides, like oncePerRoundConsumed). */
    perRoundFireCounts?: Map<string, number>;
    /** Per-side adjacent-allies resolver (Fortifying Shroud). See IntentExecContext. */
    adjacentAllyIdsFor: (ownerId: string) => string[];
    /** Ship-kit W5 Task C3 (Demolisher bomb-splash): OPPOSING-side adjacent-ids resolver — mirrors
     *  `livingOpposingActorIds`'s same-direction wiring (player drain → enemy roster, enemy drain
     *  → player roster), but narrowed to board-neighbours of the given anchor instead of the
     *  whole roster. See IntentExecContext. */
    adjacentOpposingIdsFor?: (anchorId: string) => string[];
    /** Per-side support footprint resolver (pattern-scoped reactive grants). See IntentExecContext. */
    footprintAllyIdsFor: (ownerId: string) => string[] | undefined;
}

/** Per-victim incoming accounting bucket (PR5a foundation — written in parallel with the
 *  heal-target scalars; no reader until PR5b flips them). Keyed by victim actor id. */
interface ActorIntake {
    incoming: number;
    /** #358 ADDENDUM 2, WIDENED BY ADDENDUM 3: the same intake with EVERY victim-side reduction
     *  taken back out — the raw damage THROWN at this victim. `incoming` is what got THROUGH, so it
     *  FALLS as a ship gets tankier, which made a tankier ship report a smaller headline (the whole
     *  reason this axis exists; "measured EHP" as a NAME is retired — addendum 3 C1).
     *
     *  WHAT COMES OUT, as of addendum 3: the defence-mitigation factor (every direct-damage caller
     *  folds it before the funnel sees it), the victim's own `Inc. Damage Down` family and its
     *  pre-fight incoming baseline, `equipReductionPct`, `incomingDotReductionPct` (Vortex Veil),
     *  and the reflect channel's incoming-reduction. WHAT STAYS IN: attacker-side modifiers and
     *  enemy-APPLIED amplification (`Out. Damage Up`, `Exposed`), plus shield/Barrier absorption —
     *  those pools eat damage that ARRIVED.
     *
     *  SCALING, precisely: recorded at the same instant as `incoming` and scaled by the Protection
     *  retention fraction, but NOT by the incoming-block proc — a blocked hit was thrown in full
     *  (see the funnel's `damageRaw` comment for why that scaling was deliberately removed).
     *  `incomingRaw >= incoming` OVER A WINDOW SUM, with equality when the victim applies no reduction
     *  at all. NOT per round, and not per booking: the DoT transform books the full raw amount at
     *  THROW time, and the ticks that re-book the deferred slice carry `perTickPreMitigation: 0` while
     *  contributing real post damage — so an individual later round can legitimately read
     *  `incomingRaw < incoming`. Any test asserting the inequality must sum the window, or scope itself
     *  to paths with no transform (which is what `rawIntakeAxis.test.ts` does — see the scope note on
     *  its suite-health arm).
     *  A path that folds no defence AND meets no other victim-side reduction (a plain DoT tick, a
     *  bomb/detonation burst) books the identical amount on both — but a DoT tick on a Vortex Veil
     *  carrier does NOT, which is why the two axes are pinned separately per path in
     *  `rawIntakeAxis.test.ts`. */
    incomingRaw: number;
    shieldAbsorbed: number;
    barrierAbsorbed: number;
    /** Direct-hit damage nullified by `Shield Converter` and turned into Shield. Netted against
     *  `.incoming` for display the same way `barrierAbsorbed` is: the hit still ARRIVED (so the
     *  attacker keeps its damage-dealt credit and the #293 identity holds), but its effect was
     *  converted rather than applied. Records the FULL nullified amount even when the resulting
     *  shield gain was clamped at max HP — this figure explains the missing HP damage, not the
     *  shield delta. */
    convertedToShield: number;
}

export interface HealingRoundEngine {
    perActor: Map<string, ActorHealing>;
    targetHpPctStart: number;
    targetShieldStart: number;
    incomingDamage: number;
    /** #358 ADDENDUM 2: the heal target's per-round intake BEFORE defence mitigation. See
     *  `ActorIntake.incomingRaw`. */
    incomingDamageRaw: number;
    shieldAbsorbed: number;
    /** Per-round total fully blocked by an active Barrier (full damage immunity). Tracked
     *  separately from shieldAbsorbed (Barrier does not drain the shield pool). Task 2 adds the
     *  UI display surface; this field exists now so the blocked total is observable. */
    barrierAbsorbed: number;
    /** Per-round direct-hit damage nullified by `Shield Converter` and turned into Shield, for the
     *  heal target. Netted against `incomingDamage` for display exactly as `barrierAbsorbed` is —
     *  the hit ARRIVED (the attacker keeps its damage-dealt credit) but was converted rather than
     *  applied. Surfaced so the intake breakdown's four terms close; without it a Shield Converter
     *  ship shows an unexplained residual. */
    convertedToShield: number;
    /** Per-actor incoming accounting bucket. The heal target's `incomingDamage`/`shieldAbsorbed`/
     *  `barrierAbsorbed` row totals above are sourced from this map's `healTarget.id` entry (PR5b);
     *  the legacy per-round scalars it replaced were removed in the same change. Keyed by victim
     *  actor id. */
    perActorIncoming: Map<string, ActorIntake>;
    /** Per-RECIPIENT healing accounting, keyed by the actor a repair LANDED ON — the counterpart to
     *  `perActor`, which is keyed by the SOURCE that cast it. Populated only when
     *  `perRecipientApply` (or `mode: 'battle'`) is set; **empty otherwise**, which is what
     *  keeps every legacy healing result byte-identical.
     *
     *  EVERY repair whose pool application succeeds is on this axis (SP-3b Task 7): the cast site
     *  (playerTurn.ts — BOTH arms, the player one and the `healEventOnly` enemy one), HoT ticks
     *  (playerTurn.ts `tickHot` — raw into the HOLDER's `hotHeal`), the per-victim standing and
     *  taken leeches (engine.ts, both via `creditLandedRepair`), and reactive repairs (triggers.ts).
     *  That completeness is load-bearing twice over: the healing report's
     *  `effectiveHealing`/`overheal` read this axis, and since #375 so does the Simulator's
     *  `healingReceived` (via `hp-snapshot.repairReceived`) — so a source that credited only
     *  `perActor` would silently vanish from both.
     *
     *  SIDE-AGNOSTIC, and that is the point (#375). This axis records where HP LANDED, which has no
     *  side to it — an enemy repairing an enemy ally is on it exactly like a player healer. That is
     *  a deliberate asymmetry with `perActor`, which is PLAYER-ONLY by design (E5 §4.1), and it is
     *  why `healingEngineAdapter` filters this axis through `playerRecipientIds` before reporting
     *  it. Do not "fix" an enemy key appearing here; filter it at the consumer.
     *
     *  `creditLandedRepair` is a `runCombat`-local closure, not an export — `tickHot` and the cast
     *  path (playerTurn.ts) and the reactive executor (triggers.ts) live in OTHER modules and cannot
     *  reach it, so each duplicates the `perRecipientApply` gate check inline instead of calling
     *  through. A future cross-module credit site has nothing to reach for either — it must add its
     *  own inline gate, the same way those do.
     *
     *  `shield` and `cleanseCount` are still SOURCE-ONLY and deliberately so — the shield pool lands
     *  per-recipient via `grantShieldToTarget`, but no recipient-side shield TOTAL is computed, and
     *  the healing report keeps both source-keyed to match.
     *
     *  THERE IS NOW A THIRD AXIS BESIDE THESE TWO (#383): `currentRoundSourceRepair`, keyed by the
     *  actor that PERFORMED a repair. It is what `hp-snapshot.repairPerformed` reports and what the
     *  Simulator's "Healing done" column reads. It exists as a SIBLING rather than as a widening of
     *  `perActor` precisely because `perActor` must stay player-only — read `creditPerformedRepair`
     *  for its contract, which is this one's twin in every respect but the one that matters: a HoT
     *  tick credits `perRecipient` and must NEVER credit the source axis (R2, #367).
     *
     *  ⚠️ For whoever extends this next: mirror a repair ONLY where its pool application actually
     *  happened. Several sources credit the source axis's raw bucket for recipients they never
     *  repair (a non-heal-target `all-allies` leech share), and mirroring those invents a landing.
     *  And every new credit MUST be gated on `perRecipientApply` — the shield-grant site
     *  (playerTurn.ts:3730-3738) has NO flag gate of its own, so an ungated
     *  `creditRecipient(rid, 'shield', …)` there would make the map non-empty on legacy runs and
     *  break the byte-identical guarantee above. */
    perRecipient: Map<string, ActorHealing>;
    /** Per-enemy effects this round (Task 10a): one entry per enemy attacker that produced an
     *  effect, carrying its own self-buffs + the debuffs it landed on the heal target. Surfaced
     *  for the UI's enemy-effects round overview, grouped/attributed by the source enemy ship.
     *  Empty for a bare/manual enemy with no effects. NAMES ONLY — never folded into a sim value. */
    enemyEffects: EnemyRoundEffects[];
    /** The HEAL TARGET's OWN active self-buffs this round, captured from the target actor's turn
     *  (PlayerTurnResult.activeSelfBuffs — comprehensive, so recurring/always-active buffs like
     *  Cheat Death / Everliving Regeneration are included). Empty when there is no heal target,
     *  the target never acted this round, or the target is destroyed. NAMES ONLY for the UI's
     *  round overview — never folded into any sim value. */
    healTargetBuffs: ActiveBuff[];
}

/**
 * Side-specific accounting hooks for {@link applyVictimDamage}. Everything keyed off the
 * `victim` (Barrier/shield/HP/Cheat-Death/recordDestroyed/hp-changed) lives in the shared
 * core; the per-direction intake accounting is injected here so the core stays
 * caller-agnostic. Both directions record into the same per-actor `perActorIncoming` map keyed
 * by the victim's id — a single `sink` (SP-U U1) serves BOTH enemy→player (tank intake) and
 * player→enemy (E1 symmetric surface) directions, since ids are globally unique across sides.
 */
interface DamageAccountingSink {
    /** today: intakeFor(victimId).incoming += amount */
    addIncoming: (amount: number, victimId: string) => void;
    /** #358 ADDENDUM 2: today: intakeFor(victimId).incomingRaw += amount */
    addIncomingRaw: (amount: number, victimId: string) => void;
    /** today: intakeFor(victimId).shieldAbsorbed += amount */
    addShieldAbsorbed: (amount: number, victimId: string) => void;
    /** today: intakeFor(victimId).barrierAbsorbed += amount */
    addBarrierAbsorbed: (amount: number, victimId: string) => void;
    /** today: intakeFor(victimId).convertedToShield += amount */
    addConvertedToShield: (amount: number, victimId: string) => void;
}
/**
 * Replaces a direct hit the victim just took with a generic self-DoT spread over `rounds` rounds,
 * returning the amount converted (for the caller's `transformedToDot`).
 *
 * The single home of the DEFERRAL accounting both transform steps in {@link applyVictimDamage}
 * share — the ability-based Voron/Orel `transform-incoming-to-dot` and the name-keyed
 * `Hit Mitigation` one-shot. The two steps differ only in where `rounds` comes from (the ability's
 * `turns` vs the status's fixed spread), and the accounting MUST NOT diverge between them:
 *  - the DoT is credited to the victim itself (`sourceId: victim.id`), so the existing generic-DoT
 *    tick sites pick it up with no extra wiring, and its damage is never attributed to the attacker;
 *  - reversing the `.incoming` the funnel already recorded is what makes the battle sim's HP
 *    derivation (incoming − shield − barrier) net to zero real HP loss for this hit — the damage
 *    instead lands over time, each tick recording its own `.incoming`;
 *  - the RAW axis (`.incomingRaw`, "damage absorbed") is DELIBERATELY NOT reversed — see below;
 *  - the returned amount is what the caller reports as `transformedToDot`, and that is what drops
 *    the hit from the per-victim damage-taken credit AND suppresses its `attacked` signal.
 * Unlike the Barrier path this hit is DEFERRED, not nullified, so it is deliberately NOT booked as
 * barrier- or shield-absorbed: nothing absorbed it.
 *
 * CALLER CONTRACT — this helper cannot reach the caller's `damage` local, so every call site MUST
 * follow it with `damage = 0` of its own WHEN THE RETURN VALUE IS NON-ZERO (both do — the guard
 * below is the one case the return can be 0). Omitting that on a real conversion does not merely
 * mis-report: the `immediateDamage` capture a few lines below the call sites reads `damage`, so a
 * non-zero leftover would drain the victim's shield/HP for the full amount as well as spreading it
 * over the DoT — the hit landing twice. Neither existing call site's real-conversion path would
 * change, so no test would catch a regression there.
 *
 * Module-local rather than its own module: it is a private detail of the one funnel, and speaking
 * `DamageAccountingSink` (an engine-internal accounting seam) from outside would mean exporting
 * that interface purely to relocate these three statements.
 *
 * #358 ADDENDUM 3 (C4) — WHY ONLY ONE OF THE TWO AXES IS REVERSED.
 *
 * The two axes answer different questions, so a deferral moves them differently:
 *  • `.incoming` is what ARRIVED. Nothing arrived from this hit, so it is reversed and each tick
 *    books its own share as it lands. Unchanged.
 *  • `.incomingRaw` is what was THROWN ("damage absorbed", C2). The attack was thrown in full, at
 *    full size, at the instant this helper runs. A transform is a purely DEFENSIVE ability; it
 *    changes WHEN the damage lands, not whether it was thrown. So the raw booking the funnel made
 *    a few lines above STANDS, and the entry below carries `perTickPreMitigation: 0` so the ticks
 *    that re-book the slice do not count it a second time.
 *
 * TWO WRONG SHAPES THIS REPLACES, both measured on a Voron defender (5,000 defence, 20,000-attack
 * attacker, 5-round window) against a plain defender's 100,000:
 *  1. Reverse the raw axis and let the ticks re-book WITHOUT a pre-mitigation figure (the shipped
 *     addendum-2 behaviour): the slice migrated onto the post axis and the figure collapsed to
 *     **24,993** — a defensive ability quartering its own owner's headline.
 *  2. Reverse the raw axis and re-book WITH the pre-mitigation figure in lockstep: better, but the
 *     deferral runs past the end of the window, so the ticks scheduled for rounds 6-8 never fire
 *     and the figure lands at **60,000**. Still lower than the plain defender's, still an
 *     inversion — just a quieter one. A window edge must not decide whether a hit was thrown.
 * Booking at THROW time is edge-free by construction: **100,000**, exactly the plain defender's.
 *
 * `perTickPreMitigation: 0` is LOAD-BEARING and must stay an explicit 0, never omitted: the tick
 * reader is `e.perTickPreMitigation ?? e.perTickAmount`, and `??` does not fall through on 0. Drop
 * the field and every transformed hit is counted twice on the raw axis.
 *
 * GUARD: `rounds` traces back to a parsed skill row (the ability's `turns`) or a hand-coded
 * constant (Hit Mitigation's fixed 3) — the former is untrusted input. `detectTransformToDot`
 * already rejects a non-positive parse at the source, but this is the single shared choke point
 * for both call sites, so it defends independently: a non-positive `rounds` here would push
 * `perTickAmount: damage / rounds` = `Infinity` (or a poisoned negative) into `genericDoTEntries`,
 * silently corrupting every downstream tick and HP derivation that reads it. Treat it as a no-op
 * instead — convert nothing, leave the hit to resolve normally — rather than throwing: a
 * malformed skill row must not crash a simulation.
 */
function convertHitToSelfDot(
    victim: CombatActor,
    sink: DamageAccountingSink,
    damage: number,
    rounds: number
): number {
    if (rounds <= 0) return 0;
    victim.genericDoTEntries.push({
        stacks: 1,
        tier: 0,
        remainingRounds: rounds,
        sourceId: victim.id,
        perTickAmount: damage / rounds,
        // #358 ADDENDUM 3 (C4): this slice's raw contribution was ALREADY booked, at full size, by
        // the funnel's `addIncomingRaw` a few lines above the call site — see the block comment.
        // An explicit 0 (never omitted: the reader is `?? perTickAmount`) stops the re-booking
        // ticks from counting it a second time.
        perTickPreMitigation: 0,
    });
    sink.addIncoming(-damage, victim.id);
    return damage;
}
/**
 * TEST-ONLY. Counts turns — on EITHER side — that resolved **NO VICTIM**: an actor whose parsed
 * target names nobody living on the opposing board, so `selectTurnTarget` returns `tgt: undefined`
 * and the turn runs with every victim-derived read absent (contract §B: "there is no enemy", never
 * "an enemy with neutral stats").
 *
 * ONE RULE, ONE COUNTER (SP-4e, #335). Until this rung there were two counters, because there were
 * two rules: the player side had answered "no victim" since SP-4c-2b, while the ENEMY side still
 * fell back to a per-side stand-in object (`TurnBindings.legacyVictim`, bound to the heal target) —
 * and the second counter existed to measure CONSULTATIONS of that object, which is a strictly
 * different event from "the turn had no victim". SP-4e deleted the field, so both the object and the
 * distinction are gone; `noVictimTurnCount` now covers both sides. The old name
 * (`noVictimPlayerTurnCount`) was renamed with it: a counter whose name has gone false is the exact
 * failure the deleted block warned about.
 *
 * WHAT IT IS NOT. It is not a credit counter — nothing is booked on a no-victim turn by construction
 * (the damage assembly is victim-fenced, so the cast deals literal 0). It counts SELECTIONS, so it
 * moves on turns that go on to do plenty (a supporter's buff/shield/heal still lands) as well as on
 * turns that do almost nothing.
 *
 * WHAT MOVED IT WHEN THE RULE UNIFIED (measured on `af4f05ae`, whole suite, per-file aggregation of
 * the enemy-side fallback consultations this counter absorbed — spec §5's table):
 *   • 1,341 rows / 12 files: `parsedSide=enemy`, DPS mode, every opposing actor dead, no anchor.
 *     Already `tgt: undefined` before this rung, so already skipping; they now run a no-victim turn
 *     and move only where such a turn has a self-effect (a self-buff, a charge step beyond the
 *     cadence, a DoT tick).
 *   • 324 rows / 10 files: `parsedSide=ally`, battle mode, the opposing roster ALIVE and placed.
 *     These are the ones with consequences — an ally-targeted enemy supporter used to resolve the
 *     FOCUS PLAYER as the victim of a cast that never targeted them.
 *   • 15 rows / 3 files stayed on the dead-target skip and did NOT come here. That skip is GONE
 *     since #346 (its surviving precondition — a RESOLVED victim already dead — was
 *     unconstructible), so this bullet is history: at `af4f05ae` the branch still carried the
 *     `|| tgt === undefined` arm those rows entered by.
 *
 * Module-level and NOT reset per run: `__resetNoVictimTurnCount` is the test's job. Vitest isolates
 * modules per test FILE, so each file reads only its own runs.
 */
let noVictimTurnCount = 0;
export function __getNoVictimTurnCount(): number {
    return noVictimTurnCount;
}
export function __resetNoVictimTurnCount(): void {
    noVictimTurnCount = 0;
}
/**
 * TEST-ONLY EXECUTABLE TRIPWIRE: A TURN NEVER BINDS A DEAD VICTIM — ON EITHER SIDE.
 *
 * The property is `resolvePositionalTarget`'s, not any one call site's: it builds its `byCell`
 * from actors with `position !== undefined && currentHp > 0` (positionalBinding.ts) and EVERY one
 * of its return paths draws from that map or returns null — Concentrate Fire, Taunt, Provoke, the
 * stealth filter and `selectTargets` all read it. So a resolved victim is alive by construction.
 *
 * Measured HERE, at `selectTurnTarget`, because that is the resolver's ONLY production consumer
 * and all three turn sites (focus, walked team, enemy) go through it — so one instrument covers
 * every side. #346 widened it from the enemy site alone, where SP-4e first placed it as the gate
 * on `skipDeadTargetTurn`; that branch is now deleted (its precondition was this same
 * unsatisfiable state) and the counters outlived it, because the claim they pin never belonged to
 * the branch.
 *
 *  • `dead` counts turns that bound a victim with `currentHp <= 0`. Zero is the claim.
 *  • `resolved` counts turns that bound a victim at all, and exists so the zero above is not the
 *    repo's fixture-vacuity defect in counter form. Both are incremented from the same two lines,
 *    so a `dead: 0` alongside a `resolved: > 0` proves the instrument is wired to a live site —
 *    the reading `dummyReachability.test.ts` asserts.
 *
 * Deliberately NOT a `throw`: the state is unconstructible today, but a throw at a turn head would
 * turn a future reachability change into a crash in a user's browser rather than a red test.
 *
 * ⚠️ WHAT THESE COUNTS DO NOT SEE. They sit on the arm that returns a RESOLVED victim, so a new
 * fabricated-fallback arm added ahead of them — the pre-#335 `?? healTarget` shape — would bind a
 * victim they never count, and both numbers would read as if nothing happened. That class has its
 * own pin, which does not rely on a counter at all:
 * `noVictimEnemyBindsNobody.integration.test.ts` asserts that an ally-targeted enemy cast's
 * enemy-facing half lands on NOBODY (mutation-verified against exactly that fallback). Keep the two
 * separate: this instrument answers "was a bound victim ever dead", that one answers "was a victim
 * ever fabricated".
 *
 * Module-level and NOT reset per run: `__resetResolvedVictimTurnCounts` is the test's job. Vitest
 * isolates modules per test FILE, so each file reads only its own runs.
 */
let resolvedVictimTurns = 0;
let deadVictimTurns = 0;
export function __getResolvedVictimTurnCounts(): { resolved: number; dead: number } {
    return { resolved: resolvedVictimTurns, dead: deadVictimTurns };
}
export function __resetResolvedVictimTurnCounts(): void {
    resolvedVictimTurns = 0;
    deadVictimTurns = 0;
}
/**
 * The combat-engine turn loop (combat-system.md §10). Each round seeds a per-actor action
 * pool (one pending action each) and repeatedly selects the unacted actor with the highest
 * CURRENT effective speed (selectNextBySpeed) until the pool drains — every actor takes one
 * turn (plus any extra-action grants): the focus attacker (default speed 100) runs the full
 * damage/buff/DoT-application pipeline, and each real actor — team ships and the positioned
 * `enemyAttackers` alike — takes its own turn, ticking on it the DoT containers it carries (DoTs
 * tick at the start of the afflicted ship's turn). An enemy faster than the focus attacker
 * therefore acts first and, carrying no DoTs yet in round 1, defers its first tick to round 2.
 * There is no longer a dummy `enemy` actor in the order at all: SP-4c-2c dropped its turn and
 * SP-4c-2d deleted the actor, so every turn in the pool belongs to a ship on the board. The
 * round's RoundData row is assembled after all turns; events are write-only taps that never read
 * or change a sim value.
 */
export function runCombat(rawInput: CombatEngineInput): {
    rounds: RoundData[];
    rawTotals: {
        direct: number;
        corrosion: number;
        inferno: number;
        detonation: number;
        cumulative: number;
        totalSecondary: number;
        totalConditional: number;
        /** Total non-focus player (team) damage across all rounds — adapter summary. */
        teamTotal: number;
        /** SP-E: total generic (absolute-per-tick) DoT damage across all rounds. Always 0 today
         *  (generic DoTs are never auto-applied from skill text in this task) — not yet consumed
         *  by DPSSimulationSummary; a future task can surface it as totalGenericDamage. */
        generic: number;
    };
    // SP-4c-2d REMOVED `enemyOutcome` (`survived` / `roundsToKill` / `finalHpPct`) from this shape.
    // It was read off the singular dummy `enemy` actor, so it was meaningful only when that actor
    // was the real target — a condition SP-4b-2b made unreachable — and on every run since it
    // described a never-dying billion-HP sink (`survived: true`, `roundsToKill: undefined`,
    // `finalHpPct: 100`) regardless of what happened on the board. It had no production reader
    // after SP-4b-2a: `dpsSimulator` re-derives all three from its own `ship-destroyed` bus tap.
    // A caller that wants an enemy's outcome taps `ship-destroyed` or reads
    // `RoundData.perActorIncoming` — both are per-actor and cannot silently describe one member of
    // a multi-enemy roster.
    /** Healing-mode accounting (additive — present ONLY when healTargetId is set). */
    healing?: { rounds: HealingRoundEngine[]; destroyedRound?: number };
} {
    /**
     * SP-4b: the ONE accommodation boundary. Everything below this line sees a fully positional
     * world — every actor has a slot and active targeting — regardless of how under-specified the
     * caller's input was. Rebinding to `input` means every existing `input.x` read below picks up
     * the normalized values with no further edits.
     *
     * Deliberately the FIRST statement: actor construction (`createActor`, ~line 1779) consumes
     * `input.position`, and `teamTargetById` / `enemyTargetById` consume the target axes.
     */
    const input = normalizeCombatRoster(rawInput);
    const {
        attack,
        crit,
        critDamage,
        defensePenetration,
        chargeCount,
        // shipSkills is intentionally NOT destructured here — the cast/reactive split below
        // rebinds `shipSkills` to the cast-only subset (partitionReactiveAbilities).
        // SP-4d: `enemyDefense` / `enemyHp` / `enemySecurity` / `enemySpeed` are no longer
        // destructured here — they were the deleted dummy actor's stat block, and their last
        // readers were enemy-HP% phantoms this rung retired (the drain ctx's derivation, then the
        // skip row's). Task 6 deleted the fields from `CombatEngineInput` entirely. A victim's
        // real HP/defence come from the positioned `enemyAttackers` roster.
        numRounds,
        selfBuffs,
        enemyDebuffs,
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        defence,
        hp,
        hacking,
        security,
        allyChargePerRound,
        enemyType,
        speed,
        bus: externalBus,
    } = input;

    // A.3 migration: every team actor walks. Synthesize an empty-kit walk for any buff-only actor so the
    // legacy non-walked-team branch is unreachable (and deleted in Task 4). Single const → every downstream
    // teamActors read (teamCombatActors, teamRuntimeById, teamSources, lookups, hp/defence defaults) sees the
    // normalized roster unchanged.
    const teamActors = normalizeTeamActorsToWalked(input.teamActors ?? []);

    // Internal bus — always created (Phase 3). Reactive listeners attach here. When an
    // external bus is provided it is a pure WRITE-ONLY tap: each emit fans out to the
    // external bus FIRST (its listeners stay write-only, registered before the engine's
    // own reactive listeners), then to the internal bus. Everything that flowed through
    // `bus?` now flows through this unconditional `bus`.
    const internalBus = createEventBus();
    const bus: CombatEventBus = externalBus
        ? {
              on: internalBus.on,
              emit: (e) => {
                  externalBus.emit(e);
                  internalBus.emit(e);
              },
          }
        : internalBus;

    // Cast/reactive split (Phase 3). Live-trigger buff/debuff/dot/charge abilities are
    // EXCLUDED from every on-cast pipeline (the registration loop + runPlayerTurn) and
    // instead registered as reactive listeners in slot/text order. Everything else stays
    // on-cast — including any non-buff/debuff/dot/charge ability carrying a live trigger
    // value (the executor only supports those four types).
    const { castSkills: shipSkills, reactiveAbilities } = partitionReactiveAbilities(
        input.shipSkills
    );

    // Actors. The focus attacker (default speed 100) takes the first turn each round unless a real
    // actor outspeeds it. Every actor carries its OWN DoT containers and ticks them at the start of
    // its own turn; no actor holds a fight-wide container on another's behalf any more (SP-4c-2c
    // retired the dummy's turn and SP-4c-2d deleted the actor, and `dotCarrierActors` — what the
    // round row REPORTS — is exactly the positioned enemy attackers). Speeds are configurable per
    // actor, so an enemy faster than the focus attacker acts before that attacker's first DoT
    // application and has nothing to tick in round 1 (lastAttackerCtx is undefined on its round-1
    // turn), delaying the first tick to round 2.
    const attacker = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack,
            crit,
            critDamage,
            defensePenetration,
            shieldPenetration: input.shieldPenetration ?? 0,
            defence,
            hp,
            speed: speed ?? 100,
            // Base hacking (A2 Task 2) — base for effectiveStatsOf.hacking; unread until landing lands (A2 Task 4).
            hacking,
            // Focus actor's own security — base for effectiveStatsOf.security (stats-snapshot
            // display) and the live debuff-landing recompute when the focus is targeted.
            security,
        },
        chargeCount,
        startCharged,
        position: input.position,
        ignoresForcedTargeting: input.ignoresForcedTargeting,
        ignoresStealth: input.ignoresStealth,
        doesntBreakStasis: input.doesntBreakStasis,
        chargeLossImmune: input.chargeLossImmune,
        affinity: input.affinity,
        preFight: input.preFight,
    });
    // SP-4c-2d: the DUMMY `enemy` ACTOR WAS BUILT HERE, and it is gone. It was the enemy side's
    // structural counterpart to the focus attacker — a `createActor({ id: 'enemy', … })` huge-HP
    // sink fed by the four scalar inputs (`enemyHp`/`enemyDefense`/`enemySpeed`/`enemySecurity`).
    // Its roles were retired one rung at a time: SP-4b-2b required a real roster, SP-4c-2a made
    // every roster member hittable, SP-4c-2b stopped any player cast resolving it, SP-4c-2c dropped
    // it from every turn order, and SP-4c-2d Task 1 made a victimless reactive infliction a no-op.
    // Nothing was left but the object. The literal `'enemy'` survives as `SENTINEL_ENEMY_ACTOR_ID`
    // (see its doc) — an id for the side-wide scheduled-debuff BUCKET, not an actor.
    //
    // The four scalars are GONE from `CombatEngineInput` — SP-4d deleted the fields once its
    // earlier rungs had retired their last readers (the drain ctx's derivation, then the skip
    // row's), and `tsc` enumerated the ~1,100 call-site lines that had been passing them. A
    // victim's real HP/defence/security/speed come from its own `enemyAttackers` roster entry.
    // Do not reintroduce a stand-in actor, or a scalar, to describe "the enemy" fight-wide.

    // The reported actor. Internal for now — the DPS adapter's attacker. The engine core
    // keys on this, never on the literal 'attacker' (end-state rule, spec). A later phase
    // lifts this into CombatEngineInput once multi-actor damage rows are needed (YAGNI).
    const focusActorId = 'attacker';

    // The full player-id universe for ally-target routing (Task 5): the focus actor FIRST,
    // then every team actor in INPUT ORDER. This order is FIXED (independent of which actor
    // casts an ally buff) so per-recipient application order is deterministic across the run.
    // For an attacker-only run this is just ['attacker'] → ally/all-allies collapse to the
    // owner, exactly as before Task 5 (zero churn). NOTE: it lists EVERY team actor (walked or
    // legacy) — a legacy team actor carries no walked statuses, but it is still a valid ally
    // recipient of another actor's all-allies buff (status maps are lazy-created per owner).
    const playerIds = [focusActorId, ...teamActors.map((t) => t.id)];

    // #363: actor id → faction, for `factionFilter`'d ally scopes (Fuying's Tianchao Stealth
    // grant). Side-agnostic BY KEY, exactly like roleByActorId/nameByActorId (built further
    // down): seeded from the focus actor, every walked team actor, and every enemy attacker, so
    // an ENEMY-side Fuying scopes to enemy Tianchao allies with no mirrored branch and no `side`
    // check. An actor absent from this map has an UNKNOWN faction and never matches a filter
    // (conservative) — the same contract roleByActorId/matchesRoleCategory already run on.
    // Populated by every caller that supplies factions — the healing team sim AND the DPS
    // calculator's team-actor mode alike, both of which have real casting allies a faction-scoped
    // grant needs to reach. Left empty only for a genuinely single-ship run (no picked ship, or a
    // manual actor/config with no faction data), where there is no ally to narrow anyway.
    //
    // Hoisted here (rather than built alongside roleByActorId/nameByActorId, its siblings) so it
    // exists BEFORE the attacker/team-actor `registerActorAbilityStatuses` calls and the
    // `buildEnemyPlayerActorRuntime` call below — all three now thread it through so the
    // aura/accumulating registration fan-out and the passive combat-start seed also honour
    // `factionFilter`, not just the timed cast-path loop in playerTurn.ts.
    const factionByActorId = new Map<string, FactionKey>();
    if (input.faction) factionByActorId.set(focusActorId, input.faction);
    for (const t of teamActors) if (t.faction) factionByActorId.set(t.id, t.faction);
    for (const e of input.enemyAttackers ?? [])
        if (e.faction) factionByActorId.set(e.id, e.faction);
    const factionOf = (id: string): FactionKey | undefined => factionByActorId.get(id);

    // Team actors (Phase 2). Real speed-ordered actors carrying their own charge cadence;
    // they deal no damage and hold no DoTs/statuses (their buff grants sit on the attacker/
    // enemy via the status engine's per-source timed sets). For a WALKED team actor the real
    // combat stats come from the walk bundle (so the heal target's `currentHp` starts at its
    // true max HP — healing mode needs it); the only combat-actor `stats` reads in the engine
    // are turn-order speed (already real) and `currentHp`'s seeding from `stats.hp` (the heal
    // target). runPlayerTurn reads every stat from the RUNTIME, not the actor — so populating
    // real stats here changes no DPS behaviour (goldens stay byte-identical; verified). A
    // LEGACY team actor (no walk) keeps the dummy stats it always had.
    const teamCombatActors = teamActors.map((t) =>
        createActor({
            id: t.id,
            side: 'player',
            kind: 'team',
            stats: t.walk
                ? {
                      attack: t.walk.stats.attack,
                      crit: t.walk.stats.crit,
                      critDamage: t.walk.stats.critDamage,
                      defensePenetration: t.walk.stats.defensePenetration,
                      shieldPenetration: t.walk.stats.shieldPenetration ?? 0,
                      defence: t.walk.stats.defence,
                      hp: t.walk.stats.hp,
                      speed: t.speed,
                      hacking: t.walk.stats.hacking,
                      security: t.walk.stats.security,
                  }
                : {
                      attack: 0,
                      crit: 0,
                      critDamage: 0,
                      defensePenetration: 0,
                      shieldPenetration: 0,
                      defence: 0,
                      hp: 1,
                      speed: t.speed,
                  },
            chargeCount: t.chargeCount,
            startCharged: t.startCharged,
            position: t.position,
            ignoresForcedTargeting: t.ignoresForcedTargeting,
            ignoresStealth: t.ignoresStealth,
            doesntBreakStasis: t.doesntBreakStasis,
            chargeLossImmune: t.chargeLossImmune,
            // RAW affinity rides on the walk bundle (set by the adapter from TeamActorInput.affinity
            // — the SAME source as the walk's affinityDamageModifier). Legacy (no walk) → undefined.
            affinity: t.walk?.affinity,
            preFight: t.preFight,
        })
    );

    // Per-team-actor parsed positional target (Task C2). The team actor's `position`
    // already rides on its CombatActor (createActor above), but its parsed `target`
    // lives only on the TeamActorEngineInput — thread it to the team-turn call site by
    // id. Empty for every non-positional input (no team actor passes a target) → the
    // gated branch never fires and the legacy binding stays byte-identical.
    const teamTargetById = new Map<string, ParsedTarget>();
    for (const t of teamActors) {
        if (t.target) {
            teamTargetById.set(t.id, t.target);
        }
    }

    // Per-team-actor parsed positional pattern (Task 8a), mirroring teamTargetById. The pattern
    // lives only on the TeamActorEngineInput — thread it to the team-turn call site by id for the
    // Task 8b apply path. Was empty for every non-positional input (no pattern set) and inert when
    // written; since SP-4b-1 `normalizeCombatRoster` fills every team actor's target and pattern
    // before this runs, so both maps are fully populated for every caller.
    const teamPatternById = new Map<string, ParsedPattern>();
    for (const t of teamActors) {
        if (t.pattern) {
            teamPatternById.set(t.id, t.pattern);
        }
    }
    const teamChargedPatternById = new Map<string, ParsedPattern>();
    for (const t of teamActors) {
        const cp = t.chargedPattern ?? t.pattern;
        if (cp) teamChargedPatternById.set(t.id, cp);
    }
    // SP-F F5: per-team-actor parsed CHARGED target selection, mirroring teamChargedPatternById.
    // Falls back to the active `target` when unset (chargedTarget absent) → byte-identical for
    // every existing input (no team actor threads a divergent charged selection today).
    const teamChargedTargetById = new Map<string, ParsedTarget>();
    for (const t of teamActors) {
        const ct = t.chargedTarget ?? t.target;
        if (ct) teamChargedTargetById.set(t.id, ct);
    }

    // Per-enemy-attacker parsed positional target (Task C3, side-symmetric). The enemy's
    // `position` already rides on its CombatActor (buildEnemyPlayerActorRuntime → createActor),
    // but its parsed `target` lives only on the EnemyActorInput — thread it to the enemy-turn
    // call site by id, mirroring teamTargetById. Was empty for every non-positional input (no enemy
    // passed a target), so the gated branch never fired and the legacy heal-target binding stayed
    // byte-identical; since SP-4b-1 the boundary fills it for every supplied enemy, and since
    // SP-4b-2b the roster is provably non-empty (the boundary throws otherwise) — so this map now
    // holds one entry per enemy on EVERY run and can no longer be empty.
    const enemyTargetById = new Map<string, ParsedTarget>();
    for (const e of input.enemyAttackers ?? []) {
        if (e.target) {
            enemyTargetById.set(e.id, e.target);
        }
    }

    // Per-enemy-attacker parsed positional pattern (Task 8a), mirroring enemyTargetById /
    // teamPatternById. The pattern lives only on the EnemyActorInput — thread it to the enemy-turn
    // call site by id for the Task 8b apply path. Same staleness note as enemyTargetById above: the
    // SP-4b-1 boundary fills a pattern for every supplied enemy, so this is no longer inert.
    const enemyPatternById = new Map<string, ParsedPattern>();
    for (const e of input.enemyAttackers ?? []) {
        if (e.pattern) {
            enemyPatternById.set(e.id, e.pattern);
        }
    }
    const enemyChargedPatternById = new Map<string, ParsedPattern>();
    for (const e of input.enemyAttackers ?? []) {
        const cp = e.chargedPattern ?? e.pattern;
        if (cp) enemyChargedPatternById.set(e.id, cp);
    }
    // SP-F F5: per-enemy-attacker parsed CHARGED target selection, mirroring
    // enemyChargedPatternById. Falls back to the active `target` when unset → byte-identical
    // for every existing input (no enemy attacker threads a divergent charged selection today).
    const enemyChargedTargetById = new Map<string, ParsedTarget>();
    for (const e of input.enemyAttackers ?? []) {
        const ct = e.chargedTarget ?? e.target;
        if (ct) enemyChargedTargetById.set(e.id, ct);
    }

    // Deterministic event gates — replace Math.random / expected-value math so
    // identical inputs always produce identical output. Crit uses one gate PER
    // ACTION STREAM so the charged hit crits at exactly the crit rate regardless
    // of how the charge cadence aligns with the crit schedule (no aliasing).
    // Declared BEFORE the status engine so the landing hook can close over the
    // debuff-landing gate (Task 7 — timed enemy applications draw it once).
    const activeCritGate = makeRateGate(`${focusActorId}:active-crit`);
    const chargedCritGate = makeRateGate(`${focusActorId}:charged-crit`);
    // Heal crit gates: SEPARATE streams from the damage crit gates (drawing from those would
    // shift a heal-carrying ship's damage-crit schedule → golden churn). Per-actor isolation.
    const activeHealCritGate = makeRateGate(`${focusActorId}:active-heal-crit`);
    const chargedHealCritGate = makeRateGate(`${focusActorId}:charged-heal-crit`);
    const debuffLandingGate = makeRateGate(`${focusActorId}:landing`);
    const extendChanceGate = makeRateGate(`${focusActorId}:extend`);

    // Affinity-based ('apply') debuffs always hit EXCEPT at an affinity disadvantage,
    // where they are resisted (combat-system.md hit-check). affinityDamageModifier is
    // -25 only on a disadvantage matchup. Constant for the whole run.
    const affinityDisadvantage = affinityDamageModifier < 0;

    // Landing decision for a TIMED enemy application (drawn ONCE at application time):
    // 'apply' (affinity-based) → lands unless at an affinity disadvantage, no gate draw;
    // 'inflict' (and unmarked) → draws the hacking-vs-security landing gate. Threaded
    // into the status engine for scheduled timed enemy upserts (sourceFired) and reused
    // by the engine for ability-sourced timed enemy applications below.
    // Reads the attacker runtime's LIVE per-target landing chance (A2 Task 4 — set each turn by
    // runPlayerTurn). Only invoked at turn time (after attackerRuntime is defined below), so the
    // forward reference is safe. `?? 1` is a neutral guard for a read before the first turn.
    const landsTimedEnemyApplication = (
        application?: 'inflict' | 'apply',
        targetAffinity?: AffinityName,
        targetLandingChance?: number
    ): boolean =>
        application === 'apply'
            ? // Target-aware (Task A): when the ACTUAL target's affinity is supplied, re-resolve the
              // applier's RAW affinity (input.affinity, same value fed to attackerAffinity) vs that
              // target — an 'apply' lands UNLESS the applier is at a disadvantage. Absent
              // (DPS/unit mode, single representative opponent) → the static flag, byte-identical.
              targetAffinity !== undefined
                ? getAffinityMatchup(input.affinity, targetAffinity) !== 'disadvantage'
                : !affinityDisadvantage
            : // SP-4c-2b: per-victim chance when the caller knows its victim (the reactive path);
              // the cached turn-target chance otherwise (the cast path, byte-identical).
              debuffLandingGate(
                  targetLandingChance ?? attackerRuntime.liveDebuffLandingChance ?? 1
              );

    // Boost gear set: per-owner buff-duration extension. Built from the RAW ShipSkills (which
    // already carry the BOOST passive merged by buildShipAbilitiesWithEquipment at the page
    // level) BEFORE the status engine is constructed — the runtime-derived ability maps
    // (incomingAbilitiesById etc.) aren't built until much later (~2257). Covers all actors
    // team-agnostically: attacker + walked team allies + enemy attackers.
    const buffDurationExtensionByOwner = buildBuffDurationExtensionByOwner([
        { id: 'attacker', shipSkills: input.shipSkills },
        ...teamActors.map((t) => ({ id: t.id, shipSkills: t.walk?.shipSkills })),
        ...(input.enemyAttackers ?? []).map((e) => ({ id: e.id, shipSkills: e.shipSkills })),
    ]);

    // Sub-project I, PR I3 (Layer 1) — per-actor-id map of this actor's PASSIVE `all-allies`-
    // targeted `modifier` abilities (Lodolite's "+15% to enemies with Concentrate Fire/
    // Stealth", Panguan's "+40% to Stealthed allies"). Only PASSIVE-slot abilities are
    // gathered — an aura is a standing kit property, not tied to the owner's firing skill
    // this turn (mirrors how runPlayerTurn reads its OWN modifierAbilities from
    // firingSkill + passiveSkill, but a non-acting ally never has a "firing skill" this
    // round). Filtered to `target === 'all-allies'` — a `self`-targeted modifier already
    // lives only in its owner's own list and must not leak to teammates. Keyed by the SAME
    // actor set as `buffDurationExtensionByOwner` immediately above (attacker + walked team
    // + enemy attackers) so distribution covers both sides symmetrically. `buildTurnArgs`
    // below unions each acting actor's LIVING same-side allies (excluding itself, via
    // `sameSideLivingFor`) through this map every turn.
    const allAlliesModifierAbilitiesOf = (skills?: ShipSkills): Ability[] =>
        (skills?.slots.find((s) => s.slot === 'passive')?.abilities ?? []).filter(
            (a) => a.type === 'modifier' && a.target === 'all-allies'
        );
    const allAlliesModifierAbilitiesById = new Map<string, Ability[]>(
        [
            { id: 'attacker', shipSkills: input.shipSkills },
            ...teamActors.map((t) => ({ id: t.id, shipSkills: t.walk?.shipSkills })),
            ...(input.enemyAttackers ?? []).map((e) => ({ id: e.id, shipSkills: e.shipSkills })),
        ].map(({ id, shipSkills }) => [id, allAlliesModifierAbilitiesOf(shipSkills)] as const)
    );

    // Incremental status machine — replaces the precomputed computeBuffTimeline array.
    const statusEngine = createStatusEngine({
        selfBuffs,
        enemyDebuffs,
        // Team actors' buff lists keyed to their own turns (per-source timed sets).
        teamSources: teamActors.map((t) => ({
            sourceId: t.id,
            selfBuffs: t.selfBuffs,
            enemyDebuffs: t.enemyDebuffs,
        })),
        landsTimedEnemyApplication: (buff) => landsTimedEnemyApplication(buff.application),
        buffDurationExtensionFor: (casterId) => buffDurationExtensionByOwner.get(casterId) ?? 0,
    });

    // TEST-ONLY: expose the live status engine so a test can read settled self/enemy state after
    // the run (e.g. cast-path purge removal). Inert in production (field never set).
    input.__testTapStatusEngine?.(statusEngine);

    // Register the attacker's own buff/debuff abilities for in-loop application with live
    // condition gating. These flow from ShipSkills directly — the page no longer feeds the
    // converted SelectedGameBuff arrays into the sim (no-double-count). The attacker registers
    // FIRST (zero-churn ordering gate); walked team actors register AFTER, in input order.
    const { timedSelfBySlot, timedEnemyBySlot } = registerActorAbilityStatuses(
        shipSkills,
        statusEngine,
        'attacker',
        playerIds,
        // Heal target (healing mode) — narrows a single-`ally` Cheat-Death-family firing-slot
        // grant to the tank (Hermes). Undefined in DPS mode → falls back to the caster.
        input.healTargetId,
        factionOf
    );

    // Lookup maps (moved from simulateDPS) — expand the snapshot's buff names back
    // into the underlying SelectedGameBuff effects.
    // Include team-actor buffs: their snapshot entries (applied on team turns) must
    // expand back to their underlying effects exactly like attacker-scheduled ones.
    const selfBuffLookup = new Map<string, SelectedGameBuff[]>();
    for (const b of [...selfBuffs, ...teamActors.flatMap((t) => t.selfBuffs)]) {
        const existing = selfBuffLookup.get(b.buffName) ?? [];
        selfBuffLookup.set(b.buffName, [...existing, b]);
    }
    const enemyDebuffLookup = new Map<string, SelectedGameBuff[]>();
    for (const b of [...enemyDebuffs, ...teamActors.flatMap((t) => t.enemyDebuffs)]) {
        const existing = enemyDebuffLookup.get(b.buffName) ?? [];
        enemyDebuffLookup.set(b.buffName, [...existing, b]);
    }

    // Attacker runtime — everything the focus actor's turns close over, built once.
    // The attacker carries the top-level inputs, the global merged lookups, and the
    // shared gates. Walked team runtimes (Task 4) come from TeamActorInput with their
    // own gate instances and empty lookups. The engine core keys on runtime/actor ids.
    const attackerRuntime: PlayerActorRuntime = {
        actor: attacker,
        focus: attacker.id === focusActorId,
        castSkills: shipSkills,
        reactiveAbilities,
        timedSelfBySlot,
        timedEnemyBySlot,
        hasChargedSkill,
        attack,
        crit,
        critDamage,
        defensePenetration,
        defence,
        hp,
        healModifier: input.healModifier ?? 0,
        selfDotModifier,
        defensePenetrationBuff,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        affinityDisadvantage,
        // RAW focus affinity — sourced from the SAME input.affinity the page resolved into the
        // pre-resolved affinityDamageModifier above, so the two never disagree. Positional
        // plumbing: read by victimHitDamage for per-victim re-resolution (Task 8b/9). Undefined →
        // neutral 'antimatter' default downstream.
        attackerAffinity: input.affinity,
        allyChargePerRound,
        activeCritGate,
        chargedCritGate,
        activeHealCritGate,
        chargedHealCritGate,
        debuffLandingGate,
        extendChanceGate,
        landsTimedEnemyApplication,
        selfBuffLookup,
        enemyDebuffLookup,
    };

    // Walked team runtimes (Task 4). For each team input with a `walk` bundle, build a
    // PlayerActorRuntime so its real turns run the full runPlayerTurn pipeline. Each gets
    // its OWN gate instances (determinism isolation — its draws never interleave with the
    // attacker's or another team actor's), its own landing closure (its affinity disadvantage
    // + its landing gate + its chance), stats from the walk bundle, focus=false, and EMPTY
    // lookups (its walked statuses carry their effects in payloads — no scheduled-buff lookup
    // expansion). Registration order: attacker first (above), then team actors in input order
    // (the loop order here) — fixed order = determinism. The team combat actor (turn-order
    // carrier) is matched by index to its input.
    const teamRuntimeById = new Map<string, PlayerActorRuntime>();
    teamActors.forEach((t, i) => {
        if (!t.walk) return;
        const w = t.walk;
        const teamActor = teamCombatActors[i];
        // Cast/reactive split per walked actor. Reactive abilities are PARTITIONED here but
        // NOT registered as listeners this task — Task 6 registers them per owner. They are
        // stored on the runtime so Task 6 can pick them up without re-partitioning.
        const { castSkills: teamCastSkills, reactiveAbilities: teamReactive } =
            partitionReactiveAbilities(w.shipSkills);
        // Register this walked actor's cast buff/debuff abilities under its own owner id
        // (AFTER the attacker — zero-churn ordering for the attacker-only path).
        const teamTimed = registerActorAbilityStatuses(
            teamCastSkills,
            statusEngine,
            t.id,
            playerIds,
            // Same carve-out narrowing as the attacker — a walked healer's single-`ally`
            // Cheat-Death-family grant lands on the heal target.
            input.healTargetId,
            factionOf
        );
        const teamAffinityDisadvantage = w.affinityDamageModifier < 0;
        // Own gate instances — separate draw streams so a team actor's crit/landing/extend
        // rolls are isolated from the attacker's deterministic schedule. Keyed by this team
        // actor's own id + purpose (SP-0 Task 3) — see the enemy/focus gates above for the
        // same convention.
        const teamActiveCritGate = makeRateGate(`${t.id}:active-crit`);
        const teamChargedCritGate = makeRateGate(`${t.id}:charged-crit`);
        const teamActiveHealCritGate = makeRateGate(`${t.id}:active-heal-crit`);
        const teamChargedHealCritGate = makeRateGate(`${t.id}:charged-heal-crit`);
        const teamDebuffLandingGate = makeRateGate(`${t.id}:landing`);
        const teamExtendChanceGate = makeRateGate(`${t.id}:extend`);
        // Reads this team actor's runtime LIVE per-target landing chance (A2 Task 4 — set each
        // turn by runPlayerTurn). Invoked only at turn time (after `runtime` below is defined),
        // so the forward reference is safe. `?? 1` is a neutral guard for a pre-first-turn read.
        const teamLandsTimedEnemyApplication = (
            application?: 'inflict' | 'apply',
            targetAffinity?: AffinityName,
            targetLandingChance?: number
        ): boolean =>
            application === 'apply'
                ? // Target-aware (mirrors the attacker closure): when the ACTUAL target's affinity
                  // is supplied, re-resolve THIS team actor's RAW affinity (w.affinity) vs that
                  // target — an 'apply' lands UNLESS this actor is at a disadvantage. Absent
                  // (DPS/unit mode, single representative opponent) → the static flag, byte-identical.
                  targetAffinity !== undefined
                    ? getAffinityMatchup(w.affinity, targetAffinity) !== 'disadvantage'
                    : !teamAffinityDisadvantage
                : // SP-4c-2b: mirrors the attacker closure — per-victim chance from the reactive
                  // path, cached turn-target chance for the cast path.
                  teamDebuffLandingGate(
                      targetLandingChance ?? runtime.liveDebuffLandingChance ?? 1
                  );
        const runtime: PlayerActorRuntime = {
            actor: teamActor,
            focus: teamActor.id === focusActorId, // always false today (focus = attacker)
            castSkills: teamCastSkills,
            reactiveAbilities: teamReactive, // stored, NOT registered (Task 6)
            timedSelfBySlot: teamTimed.timedSelfBySlot,
            timedEnemyBySlot: teamTimed.timedEnemyBySlot,
            hasChargedSkill: w.hasChargedSkill,
            attack: w.stats.attack,
            crit: w.stats.crit,
            critDamage: w.stats.critDamage,
            defensePenetration: w.stats.defensePenetration,
            defence: w.stats.defence,
            hp: w.stats.hp,
            healModifier: w.healModifier ?? 0,
            selfDotModifier: w.selfDotModifier,
            defensePenetrationBuff: w.defensePenetrationBuff,
            affinityDamageModifier: w.affinityDamageModifier,
            affinityCritCap: w.affinityCritCap,
            affinityCritPenalty: w.affinityCritPenalty,
            affinityDisadvantage: teamAffinityDisadvantage,
            // RAW affinity — sourced from the SAME w.affinity (TeamActorInput.affinity) the adapter
            // fed to computeAffinityModifiers for w.affinityDamageModifier, so the two never
            // disagree. Positional plumbing: read by victimHitDamage (Task 8b/9). Undefined →
            // neutral 'antimatter' default downstream.
            attackerAffinity: w.affinity,
            allyChargePerRound: undefined, // attacker-only manual input
            activeCritGate: teamActiveCritGate,
            chargedCritGate: teamChargedCritGate,
            activeHealCritGate: teamActiveHealCritGate,
            chargedHealCritGate: teamChargedHealCritGate,
            debuffLandingGate: teamDebuffLandingGate,
            extendChanceGate: teamExtendChanceGate,
            landsTimedEnemyApplication: teamLandsTimedEnemyApplication,
            // Lookup asymmetry by design:
            //  - selfBuffLookup empty: scheduled SELF lists are attacker-granted (the attacker
            //    runtime owns them). A walked actor's self snapshot carries only payload entries
            //    (timedAbilityStatuses / activeAbilityStatuses fold those directly) — there are no
            //    scheduled SelectedGameBuff self-names to expand for this actor.
            //  - enemyDebuffLookup = the engine's GLOBAL map (global enemy picker + every team's
            //    manual enemyDebuffs): the enemy-side scheduled debuffs are SHARED across all
            //    player turns, so the team actor's own damage fold must expand them too. An empty
            //    map here silently zeroes those stat effects on the team's own turn (the attacker
            //    runtime holds the same global map, so attacker turns were already correct).
            selfBuffLookup: new Map(),
            enemyDebuffLookup,
        };
        teamRuntimeById.set(t.id, runtime);
    });

    // Whether ANY walked team actor exists — controls whether RoundData.teamDamage is set
    // (undefined preserves the legacy/attacker-only RoundData shape; goldens stay locked).
    const hasWalkedTeam = teamRuntimeById.size > 0;

    // All player actors (attacker + team turn-order carriers) — the universe ally-charge grants
    // bump. Built once. Used by `actorsBySide`/`bySide` below.
    const allPlayerActors = [attacker, ...teamCombatActors];

    // Live effective speed for ANY actor on EITHER side (Task 2 authority; UNWIRED — Task 3
    // wires it into the turn loop via selectNextBySpeed). Effective speed =
    // baseSpeed × (1 + Σ speedBuff% / 100), where baseSpeed is the actor's construction-time
    // stats.speed and the speedBuff% is folded LIVE from the status engine so a Speed Up/Down
    // applied mid-combat is reflected. Two sources are summed (Task 0 corpus investigation:
    // every corpus speed buff — Speed Up I/II/III, Speed Down I/II, XAOC Swiftness I/II/III — is
    // an UNCONDITIONAL timed status grant; there is NO conditional/gated speed buff, NO
    // always-active/aura speed buff, and NO standing speed modifier, so the ctx-gated
    // activeAbilityStatuses path is intentionally omitted):
    //   1. Scheduled self-buffs: snapshot(id).activeSelfBuffs expanded via selfBuffLookup.
    //   2. Timed ability statuses: timedAbilityStatuses('self', id) payloads.
    // Both fold through toSimBuffs → calculateBuffTotals, taking only .speedBuff. snapshot(id)
    // and timedAbilityStatuses('self', id) are keyed by owner id, so this is correct for any
    // actor regardless of side. Effective speed is UNCAPPED (magnitude only orders turns).
    const effectiveSpeedOf = (actor: CombatActor): number =>
        effectiveStatsOf(statusEngine, selfBuffLookup, actor).speed;

    // All mutable state declared fresh on every call
    let cumulativeDamage = 0;
    let totalTeamRaw = 0;
    let totalDirectRaw = 0;
    let totalCorrosionRaw = 0;
    let totalInfernoRaw = 0;
    // SP-E: total generic (absolute-per-tick) DoT damage — always 0 today (never auto-applied
    // from skill text in this task); mirrors totalCorrosionRaw/totalInfernoRaw.
    let totalGenericRaw = 0;
    let totalDetonationRaw = 0;
    let totalSecondaryRaw = 0;
    let totalConditionalRaw = 0;
    // SP-4c-2d: the SIDE-WIDE reactive-drain DoT containers. These used to be aliases of the dummy
    // `enemy` actor's own arrays; with that actor deleted they are standalone, and that is the
    // honest shape — nothing REPORTS them (`dotCarrierActors` reads the positioned enemies'
    // containers) and nothing TICKS them (the dummy's turn was retired in SP-4c-2c). They survive
    // for exactly one reason: `executeIntent`'s `ctx.corrosionEntries` / `ctx.infernoEntries` /
    // `ctx.genericDoTEntries` / `ctx.pendingBombs`, which `buildDrainContext` reads as the
    // drain-time DoT-count condition scalars (`corrosionEntryCount` & co., triggers.ts). So the
    // containers stay — empty, but present, so the scalars keep answering 0 rather than crashing.
    //
    // ⚠️ This used to say retiring that side-biased read was "a later rung's job". SP-4e is the
    // LAST rung of this epic and it did not retire it, so nothing is scheduled: it is an OPEN
    // RESIDUAL, not a pending deletion. Anyone picking it up owns the read in `buildDrainContext`,
    // not these declarations.
    //
    // `landDotOn`'s `(victim?.corrosionEntries ?? ctx.corrosionEntries)` tail can still reach them
    // if a reactive intent resolves an id no actor carries; SP-4c-2d Task 1 made a VICTIMLESS
    // infliction a no-op, so the only surviving route is an unresolvable id, and a DoT landing here
    // is stranded (never ticks, never expires) exactly as it was on the dummy. Unchanged by the
    // deletion — the strand's host moved, not its behaviour.
    //
    // `pendingAccumulators` had no reader other than the dummy's own (now deleted) turn body, so it
    // is gone rather than re-homed.
    const corrosionEntries: ActiveDoTStack[] = [];
    const infernoEntries: ActiveDoTStack[] = [];
    const genericDoTEntries: ActiveDoTStack[] = [];
    const pendingBombs: PendingBomb[] = [];

    const roundData: RoundData[] = [];

    // Per-actor round-scoped context the enemy's DoT processing reads. Keyed by actor id;
    // every player turn sets its entry after runPlayerTurn. A DoT entry's tick resolves the
    // APPLIER's ctx (effectiveAttack for inferno; dotMult/affinityMult for both) via this map.
    // The focus actor's ctx feeds the row exactly as the old single `lastAttackerCtx` did. An
    // entry whose applier has not yet acted this run (faster-enemy round 1) has no ctx → skip.
    //
    // ⚠️ KNOWN INSTANCE of the CROSS-TURN-CACHE class, recorded here so it is findable — SP-4c-2b
    // review sweep, deliberately NOT fixed. This map is a per-turn snapshot that outlives its turn,
    // and `tickDoTs` reads `ctx.affinityMult` off it to scale a DoT ticking on a victim that is
    // usually NOT the victim that ctx was computed against. That is structurally the same mistake as
    // `PlayerActorRuntime.liveDebuffLandingChance` (see its own doc, and the reactive-landing fix in
    // `reactiveLandingChanceFor`): a value derived from THIS turn's target, later applied to a
    // DIFFERENT target. The honest reading would resolve the applier-vs-TICKING-VICTIM matchup, the
    // way `dotMultFor` already resolves the per-victim dotMult.
    // WHY IT IS INERT TODAY and therefore out of scope: the only actors whose turn can lack a real
    // victim are the ally-targeting supporters, and for them §A.4 measured the ghost's `affinity` as
    // always `undefined` — so the no-victim answer (`'antimatter'`, neutral) is byte-identical to what
    // the ghost produced. Nothing observable changed; the latent wrongness predates this rung.
    // The other two fields read there (`ctx.dotMult`, `ctx.effectiveAttack`) are self-derived and fine.
    const lastTurnCtxByActor = new Map<string, PlayerRoundCtx>();
    // SP-D: per-actor count of enemies DAMAGED by that actor's most recent cast this round,
    // for the `enemies-hit-this-cast` gate at REACTIVE drain time (Berserker's Marauder Rage,
    // drained via the on-deal-damage trigger — a passive-sourced timed self-buff can otherwise
    // only be seeded once at combat start, before any cast has fired). Sourced from the SAME
    // `aoeVictimIds` footprint buildTurnArgs already computes for the AoE-purge fan-out (E3) —
    // the actor's own splash pattern from its resolved anchor position against the LIVE
    // opposing roster, known BEFORE runPlayerTurn returns (unlike the actual HP application,
    // which drivePositionalApply performs AFTER). Set at each of the three turn-firing call
    // sites (focus/team/enemy), mirroring lastTurnCtxByActor's per-turn update. SP-4d Fix wave
    // 1: absent id (no cast yet) → the enemiesHitThisCastFor delegate below now returns
    // `undefined` (footprint UNKNOWN), not a fabricated 1 — see that delegate's own comment.
    const enemiesHitThisCastByActor = new Map<string, number>();

    // --- Heal target resolution (data, not a mode switch) ---
    // Resolve the heal target up front (throw on an unknown id — it must name a player actor,
    // the focus or a team actor). This id no longer decides which mode the engine runs in —
    // that is `input.mode` (see `RunMode` above and the explicitness guards below), which can
    // legally combine with `healTargetId` in `'battle'` runs too. Once resolved, `healTarget`
    // feeds the SHARED HealingRuntimeCtx (assembled a few lines down) that every runPlayerTurn
    // call shares: heals/shields consume against the live target and a per-round
    // HealingRoundEngine is built. Note `healTarget` can end up set even when this id is
    // absent — `'battle'` mode anchors it to the focus actor below — so its presence, not this
    // id, is what keeps the heal pipeline active.
    const healTargetId = input.healTargetId;
    const allPlayerActorsById = new Map<string, CombatActor>([
        [attacker.id, attacker],
        ...teamCombatActors.map((a) => [a.id, a] as const),
    ]);
    const explicitHealTarget = healTargetId ? allPlayerActorsById.get(healTargetId) : undefined;
    if (healTargetId && !explicitHealTarget) {
        throw new Error(`runCombat: healTargetId '${healTargetId}' is not a player actor`);
    }
    // SP-U U5 (R6 decouple): the heal/shield pipeline runs whenever there is an EXPLICIT heal
    // focus (the healing calculator) OR a real positional team battle (the real-vs-real sim,
    // `battleSimulator`). Sim mode has no explicit focus, so anchor `healTarget` to the focus
    // actor there — this is byte-identical to the former vestigial `healTargetId: focus.id`
    // binding `battleSimulator` used purely to keep healingCtx built and unlock the enemy roster.
    // Every downstream focus-carve-out (`healTarget && actor.id === healTarget.id`) and the
    // healingCtx anchor thus resolve exactly as before. The anchor is an ACCOUNTING anchor, not a
    // recipient: since SP-4e a single-`ally` heal routes over the caster's support footprint and a
    // text-named worst-HP ally routes via `lowestHpAllyId`, on either side and in either mode —
    // neither reads this anchor.
    const runMode: RunMode = input.mode ?? 'dps';
    /** Whether the live adjacency / kill counts (Panguan, Centurion, Judge) are a MEASUREMENT on
     *  this run, or a question this run cannot ask.
     *
     *  `mode: 'dps'` is the single-ship DPS calculator: no board, and a synthetic enemy that
     *  exists only to be hit. Its "0 allies adjacent, 0 enemies destroyed" is structurally
     *  permanent, not an observation — so the user's own manual count (`Condition.manualCount`,
     *  the number the skill editor's condition row asks for) is the only honest answer there, and
     *  handing the evaluator a live 0 would silently override it. Withholding the fields entirely
     *  is what routes those conditions back to that manual fallback; see ConditionContext's doc.
     *
     *  Gated on the MODE, never derived from a data field (roster emptiness, position presence) —
     *  see `RunMode`'s own note on why that distinction is the point of the type. */
    const liveCountsMeasurable = (input.mode ?? 'dps') !== 'dps';

    // Explicitness guards. These do NOT infer a mode — they refuse an input whose mode and data
    // disagree, which is the difference between validation and the derivation SP-4 removed.
    // Mirrors the engine's existing style (the enemyAttacker id-collision check below also
    // throws on bad input rather than silently deriving around it).
    if (input.healTargetId && runMode !== 'healing' && runMode !== 'battle') {
        throw new Error(
            `runCombat: healTargetId requires mode 'healing' or 'battle' (got '${runMode}')`
        );
    }
    if (runMode === 'healing' && !input.healTargetId) {
        throw new Error(`runCombat: mode 'healing' requires healTargetId`);
    }

    // SP-U U5 anchored this to the focus in battle mode; #415 extends that to EVERY mode. The
    // anchor's two jobs are now separate flags below: it switches on the heal/shield/leech RUNTIME
    // (which a DPS run needs, so an attacker whose damage comes from a shield or leech basis shows
    // its real output) and it anchors the healing REPORT (which a DPS run has no use for).
    const healTarget = explicitHealTarget ?? attacker;

    /**
     * The healing RESULT BLOCK — NOT the runtime, which is `healTarget` above and is always
     * defined. A DPS run builds the full runtime (heal/shield/leech basis still resolves, so an
     * attacker whose damage comes from a shield or leech basis shows its real output) and emits NO
     * healing report: #415's ruling is that heal ACCOUNTING is unwanted there while a full engine
     * RUN is wanted. Also gates the dead-target turn skip, which is a healing/battle concept: see
     * the comment at that site.
     */
    const healReportActive = !!explicitHealTarget || runMode === 'battle';

    /**
     * A DPS MEASUREMENT run: one focus attacker whose output is the whole point. Load-bearing for
     * the focus-death exit — only here does the focus dying mean there is nothing left to report.
     * Healing and battle runs legitimately continue past it and pin that behaviour in tests.
     */
    const isDpsMeasurementRun = runMode === 'dps';

    // Enemy attackers. Offense actors that bombard the player side (healing/sim mode). The enemy
    // roster is built purely from their presence (SP-U U5): no `healTargetId` is required — sim
    // mode supplies them under `mode: 'battle'` with no explicit heal focus, and a future
    // real DPS enemy (SP-U 5a) supplies one with neither.
    const enemyAttackerInputs = input.enemyAttackers ?? [];
    // SP-4c-2d: a `dpsEnemyTarget` discriminator (`enemyAttackerInputs.length === 0`, "pure DPS
    // mode": no real enemy attackers, so the dummy WAS the destructible target) used to be derived
    // here and gated four branches. It went with the actor. SP-4b-2b made it provably constant
    // FALSE — `normalizeCombatRoster`, `runCombat`'s first statement, throws `enemyAttackers is
    // empty` — so every one of those branches was unreachable from any caller, production or
    // fixture. If a comment further down this file still reads "pure DPS mode", it is describing a
    // shape no caller can express; do not read it as a claim about a live path.
    //
    // Validate enemy attacker ids before building any actors: an id that duplicates another enemy
    // attacker, or collides with a reserved/player id (the focus actor, any team actor, or the
    // scheduled-debuff bucket's sentinel), would silently clobber a map entry (runtime lookup,
    // heal recipient, ctx) and corrupt the simulation.
    //
    // The sentinel stays reserved even though no actor carries it any more — see
    // `SENTINEL_ENEMY_ACTOR_ID`: freeing the string would let a caller name a real actor `'enemy'`
    // and interleave its events with the side-wide bucket's under one id. Both directions are
    // fenced by `sentinelActorIdReservation.test.ts`.
    const reservedActorIds = new Set<string>([SENTINEL_ENEMY_ACTOR_ID, ...playerIds]);
    // The sentinel reservation is SIDE-SYMMETRIC. A TEAM actor carrying the string interleaves its
    // events with the bucket's exactly as an enemy attacker would, so it is rejected the same way.
    // Before this check the reservation only guarded the enemy loop below, and a `teamActors` entry
    // named `'enemy'` was accepted (as it also was before the dummy was deleted — it then silently
    // clobbered the dummy's `allActorsById` entry with no validation either). Not reachable from
    // production: every `teamActors` id is minted from a user ship id (`battleSimulator`'s
    // `p:<shipId>:<i>`, the DPS page's ship ids), so this fences the DIRECT-caller surface.
    // `focusActorId` is the literal `'attacker'`, so it cannot collide.
    for (const t of teamActors) {
        if (t.id === SENTINEL_ENEMY_ACTOR_ID) {
            throw new Error(
                `runCombat: teamActors[].id '${t.id}' collides with a reserved actor id`
            );
        }
    }
    const seenEnemyAttackerIds = new Set<string>();
    for (const e of enemyAttackerInputs) {
        if (reservedActorIds.has(e.id)) {
            throw new Error(
                `runCombat: enemyAttackers[].id '${e.id}' collides with a reserved or player actor id`
            );
        }
        if (seenEnemyAttackerIds.has(e.id)) {
            throw new Error(`runCombat: duplicate enemyAttackers[].id '${e.id}'`);
        }
        seenEnemyAttackerIds.add(e.id);
    }
    // Enemy-team recipient order (mirror of playerIds): enemy ATTACKER ids in input order. Equals
    // enemyAttackerActorIds but computable before the runtimes map.
    const enemyRecipientIds = enemyAttackerInputs.map((e) => e.id);
    // Build a full PlayerActorRuntime for each enemy attacker (Task 5), in input order.
    // Each enemy gets its OWN gate instances (determinism isolation), reactive-partitioned
    // abilities, neutral affinity placeholder, and real defence/hp. The enemy walks
    // runPlayerTurn bound to the heal target (Task 6b) — its damage drains into the target,
    // self-buffs land in its own owner store, debuffs/DoTs on the target's per-target store.
    // Manual flat-card enemies (no shipSkills) are handled inside the builder by synthesizing
    // a single 100%/1-hit basic-attack active slot (parity with the retired EnemyAttackerRuntime).
    const enemyPlayerRuntimes: PlayerActorRuntime[] = enemyAttackerInputs.map((e) =>
        buildEnemyPlayerActorRuntime(e, {
            statusEngine,
            enemyIds: enemyRecipientIds,
            enemyDebuffLookup,
            factionOf,
        })
    );
    const enemyAttackerActors = enemyPlayerRuntimes.map((r) => r.actor);
    const enemyAttackerActorIds = enemyAttackerActors.map((a) => a.id);
    const enemyPlayerRuntimeByActorId = new Map<string, PlayerActorRuntime>(
        enemyPlayerRuntimes.map((r) => [r.actor.id, r])
    );

    // SP-4b-2 D3: every enemy-side actor that can CARRY a DoT container, in board order — the
    // positioned enemy attackers, and (since SP-4c-2d) nothing else. The RoundData DoT-state
    // reporting fields read this.
    //
    // WHY IT EXISTS: it used to lead with the dummy sink, whose `corrosionEntries` /
    // `infernoEntries` / `genericDoTEntries` / `pendingBombs` arrays the reporting fields read
    // ALONE. Application and the per-victim tick both correctly target the REAL positioned
    // victim's own arrays, so once a positioned roster existed the dummy's arrays were never
    // written and the four fields froze at 0/[] on every positional run (measured:
    // `enemy-1.infernoEntries` carried [{stacks:1,tier:15}] on a round the row reported
    // `activeInfernoStacks: 0`). SP-4c-2d deleted that actor, so the phantom member is gone with
    // it — and with it the STRAND it produced (a DoT pushed onto containers that never ticked,
    // never expired, and were still summed into every round's report).
    //
    // The set is DISJOINT — a DoT lands on exactly one victim object — so aggregating across it
    // cannot double-count. Never empty: `normalizeCombatRoster` refuses an absent/empty roster
    // (SP-4b-2b). Read LIVE (`a.corrosionEntries`, not a cached array) because the Cheat-Death
    // wipe REASSIGNS these properties rather than splicing them.
    //
    // A plain array, not a getter: `enemyAttackerActors` is never mutated after construction
    // (verified — no push/splice anywhere), so the MEMBERSHIP is fixed for the run while each
    // member's containers are still read live at reporting time. A future PR that summons an
    // enemy mid-run must revisit this line.
    const dotCarrierActors: CombatActor[] = [...enemyAttackerActors];

    /**
     * SP-4b-2 D3, task-14 finding 3 — is this carrier's DoT container still LIVE state, or a
     * corpse's frozen leftovers?
     *
     * Nothing clears a DoT container on death (`recordDestroyed` in state.ts only stamps
     * `destroyedRound` and emits), so a killed carrier keeps whatever stood on it. Whether that
     * is real depends on ONE thing: does the carrier still take its turn and TICK?
     *
     * This predicate is therefore the enemy-side restriction of the ROUND LOOP'S OWN dead-skip —
     * deliberately derived from it rather than invented, so the two cannot drift into disagreement:
     * a destroyed POSITIONED enemy attacker is `continue`d before its DoT-tick prologue, so its
     * stacks are frozen forever: they deal nothing, never expire, and were still being summed into
     * every remaining round's report. That is the phantom, and it is what this excludes.
     *
     * SP-4c-2d: this used to carry a `|| a.id === enemy.id` disjunct exempting the DUMMY sink, and
     * that exemption was the last surviving shape of the phantom — the dummy took no turn (SP-4c-2c),
     * so its containers never ticked and never expired, yet the disjunct kept REPORTING them. The
     * actor is deleted, so both the exemption and the strand it admitted are gone. The reactive
     * `ctx.*` containers that replaced its arrays are deliberately NOT members of
     * `dotCarrierActors`, so nothing reports them at all.
     *
     * The heal-target exemption in the round loop's predicate has no counterpart here: the heal
     * target is a player-side actor and never a member of `dotCarrierActors`.
     */
    const dotCarrierReports = (a: CombatActor): boolean => a.destroyedRound === undefined;

    // ── Unified roster seam (bySide unification PR1) ───────────────────────────
    // The canonical, side-agnostic actor set, named once. Order MATTERS: it drives
    // the per-round turn order — `roundActors` is assigned to it each round —
    // [team…, attacker, enemy attackers…]. SP-4c-2d removed the dummy `enemy` from
    // between the attacker and the roster; SP-4c-2c had already dropped it from the
    // turn order, so its membership here was structural only. The companion accessor
    // `actorsBySide` arrives in a later PR with its first consumer (deferred — unread
    // now = YAGNI/lint); `allActorsById` has now arrived in PR2 (defined just below).
    const allActors: CombatActor[] = [...teamCombatActors, attacker, ...enemyAttackerActors];

    // TEST-ONLY: hand the full roster out once at construction so unit tests can assert the
    // plumbed base hacking/security on each actor (A2 Task 2). Inert in production (field never set).
    input.__testTapActors?.(allActors);

    // Combined id→actor map over the unified roster (bySide unification PR2 — first
    // consumer). Unlike allPlayerActorsById (attacker + team only), this includes every
    // enemy attacker (and, before SP-4c-2d, the dummy enemy), so a reactive granter on
    // EITHER side resolves. Used by grantExtraAction; companion actorsBySide lands in PR3.
    const allActorsById = new Map<string, CombatActor>(allActors.map((a) => [a.id, a]));

    /** SP-4c-2b: the landing chance the REACTIVE path needs — `ownerId`'s live effective hacking vs
     *  `victimId`'s live effective security, with the two actors' own affinity matchup applied.
     *
     *  WHY THIS EXISTS. Every reactive inflict already knew its victim (`debuffTargetId` /
     *  `victimId` in triggers.ts) but drew its landing gate against
     *  `PlayerActorRuntime.liveDebuffLandingChance` — a number the owner computed on ITS OWN turn,
     *  for ITS OWN turn target. An enemy shoots Flamel; Flamel's passive inflicts Speed Down +
     *  Stasis on THAT enemy, so the roll is Flamel's hacking vs THAT ship's security. Reading a
     *  cached cast-derived value was wrong in kind, and became wrong in effect when SP-4c-2b let an
     *  ally-targeted cast resolve NO victim: the cached chance then went to 0 and auto-resisted
     *  every reactive inflict the owner would ever make (measured on Flamel: 138 landings → 0).
     *
     *  TEAM-SYMMETRIC BY CONSTRUCTION: both ids are looked up in the combat-wide `allActorsById`,
     *  so a player owner inflicting on an enemy and an enemy owner inflicting on a player take the
     *  identical path (the same reason `affinityOf`/`actorById` are wired from this map).
     *
     *  AFFINITY SCOPE, deliberately narrow: the base `computeAffinityModifiers` matchup, with no
     *  `forceOutgoingAdvantage` / defensive-override consultation. That matches the sibling reactive
     *  'apply' arm, which resolves `getAffinityMatchup(rawAffinity, targetAffinity)` and likewise
     *  ignores overrides — those are turn-scoped cast concepts, not reactive ones. The cast path's
     *  `affinityModsVsVictim` DOES honour them; the two are intentionally not unified here.
     *
     *  `selfBuffLookup` is the engine's GLOBAL buffName→effects expansion table — the same one
     *  `effectiveStatsOf` is called with for every actor elsewhere in this file (turn-order speed,
     *  Protection carrier defence), not the per-runtime map (which is empty for team/enemy actors
     *  by design).
     *
     *  RETURNS UNDEFINED for an id that is not in the map, which routes the caller to its own
     *  fallback.
     *
     *  ⚠️ HISTORY, because it explains why this reads so simply now. Until SP-4c-2d there was a
     *  SECOND undefined case and it was the load-bearing one: an explicit refusal to price the
     *  DUMMY SENTINEL, which very much WAS in the map. Two reactive arms fell through to
     *  `ctx.enemy.id` when no real victim was threaded (`applicationTargetId ?? ctx.enemy.id` and
     *  `victim?.id ?? ctx.enemy.id` in triggers.ts — e.g. Burner's on-deal-damage, which carries no
     *  victimId), and without the refusal the lookup SUCCEEDED and the roll was priced against a
     *  phantom: `liveDebuffLandingChance` reads `defender.stats.security ?? 100`, and the dummy's
     *  security was whatever `enemySecurity` was — `undefined` for most callers, i.e. **100**,
     *  which for corpus hacking clamps the chance to 0 so nothing ever lands. SP-4c-2d Task 1 made
     *  both arms a NO-OP and this task deleted the actor, so the sentinel is not in the map and the
     *  generic `!victim` return covers it. The RULE the refusal encoded still stands: an inflict
     *  aimed at nobody real must not be handed a stand-in's security. */
    const reactiveLandingChanceFor = (ownerId: string, victimId: string): number | undefined => {
        const owner = allActorsById.get(ownerId);
        const victim = allActorsById.get(victimId);
        if (!owner || !victim) return undefined;
        const { damageModifier } = computeAffinityModifiers(
            owner.affinity ?? 'antimatter',
            victim.affinity ?? 'antimatter'
        );
        return liveDebuffLandingChance(statusEngine, selfBuffLookup, owner, victim, damageModifier);
    };

    // SP-4c-2d: THE DUMMY `enemy` ACTOR IS GONE. A block here used to inventory what was still
    // true of it; there is nothing left to inventory. It is not built, not a member of `allActors`
    // or `allActorsById`, not a turn-taker, not a player-offense sink, and not a DoT carrier. The
    // literal `'enemy'` survives ONLY as `SENTINEL_ENEMY_ACTOR_ID`, the id the side-wide
    // scheduled-debuff bucket emits `buff-expired` under.
    //
    // Every "keep it so its DoTs still tick" / "keep it so a cast always has a victim" argument in
    // this file's history is dead. Do not resurrect one from an older comment or commit: since
    // SP-4e there is no per-side fallback victim on EITHER side, and an actor that resolves nobody
    // runs a NO-VICTIM turn (`noVictimTurnCount`) — that is the correct answer.
    //
    // ⚠️ `hasPositionedEnemyRoster` WENT WITH IT, and its deletion is the one part of this that is
    // a claim rather than a removal, so state the proof. It asked "does a real, positioned
    // opposing-enemy roster exist" — `enemyAttackerActors.some(isTargetableRosterMember)` — and
    // gated three reactive target resolvers plus the reactive-damage HP path, each with a
    // dummy-aiming `else` arm. It is CONSTANT TRUE below the normalization boundary, by two
    // independent guarantees that must BOTH hold for the deletion to be sound:
    //   1. the roster is never empty — `normalizeCombatRoster` throws `enemyAttackers is empty`
    //      (SP-4b-2b), and it is `runCombat`'s first statement;
    //   2. every member is positioned AND targetable — `placeSide` assigns a slot to each, and
    //      `withTargetableHp` floors max HP to `MIN_TARGETABLE_MAX_HP` (SP-4c-2a). `false` from
    //      `isTargetableRosterMember` is therefore unreachable for an enemy actor.
    // Measured as well as argued: a `console.error` on the false branch over the whole suite hit
    // ZERO times in 535 files. The floor is ENEMY-SIDE ONLY by design, so the sibling predicate
    // `resolvesPositionalVictim` — which asks the same question about the PLAYER roster for an
    // enemy-side actor — is NOT constant and must not be collapsed alongside it.
    //
    // SP-4c-2c had already dropped the dummy from every turn order, so `turnOrderActors` was
    // `allActors.filter(a => a.id !== enemy.id)` — a filter with nothing left to exclude. The use
    // sites read `allActors` directly now; a same-value alias would only read as indirection.

    // Task 7 — NAMES-ONLY condition-context sources for `enemy-buff` / `self-debuff` gates.
    // These read buff/debuff NAMES from the status engine; they NEVER fold effects (effects
    // are folded exactly once via snapshot()/activeAbilityStatuses/timedAbilityStatuses), so
    // there is no double-fold. Recomputed per turn from CURRENT live state.
    //
    //  - PLAYER actor's `enemy-buff` gate → opposing side = the enemy attacker(s). Aggregation:
    //    UNION of every enemy attacker's self-buff names (the condition is "does an enemy have a
    //    buff", not "does THIS enemy"). NOT inert on a DPS run any more (SP-4b-2a): every
    //    `simulateDPS` run supplies a real enemy, so this reads that enemy's self-buffs. It is
    //    empty in PRACTICE for a SYNTHESIZED enemy only because that actor carries no skills and
    //    so grants itself nothing — an emptiness of content, not of roster. Since SP-4b-2b there
    //    is no structurally-empty case left at all: the boundary refuses an absent/empty roster,
    //    so the only way this list empties is every enemy DYING (`livingEnemyAttackerIds`).
    //  - PLAYER actor's `self-debuff` gate → its OWN enemy-applied debuffs (per-target store keyed
    //    by its id — the tank carries the enemy attacker's debuffs).
    //  - ENEMY actor's `enemy-buff` gate → opposing side = the player team (union of player
    //    self-buff names). `self-debuff` → its own per-target debuff store keyed by its id.
    const livingEnemyAttackerIds = (): string[] =>
        enemyAttackerActorIds.filter((id) => allActorsById.get(id)?.destroyedRound === undefined);
    const isActorAlive = (actorId: string): boolean =>
        allActorsById.get(actorId)?.destroyedRound === undefined;
    // Quixilver R2: shield pool at or above max HP. Reads `allActorsById` (both sides) and the
    // shared max-HP lookup, so it is team-symmetric by construction. Guards maxHp > 0 so a
    // fixture actor with no HP stat cannot report a "full" shield of zero.
    const isSelfShieldFull = (actorId: string): boolean => {
        const a = allActorsById.get(actorId);
        if (a === undefined) return false;
        const maxHp = recipientMaxHp(actorId);
        return maxHp > 0 && a.shieldPool >= maxHp;
    };
    const playerEnemyBuffNames = (): string[] =>
        selfBuffNamesForOwners(statusEngine, livingEnemyAttackerIds());
    const enemyEnemyBuffNames = (): string[] => selfBuffNamesForOwners(statusEngine, playerIds);
    // Sub-project I, PR I5 — count (not union) of opposing actors holding Stealth, for
    // Selenite's "10% more direct damage for every enemy with Stealth" count-scaling.
    // Same owner-id sourcing as the buff-NAME unions immediately above (team-symmetric).
    // SP-4b-2a: a DPS run DOES have enemy attackers now, so this counts them; it still reads 0
    // against the synthesized stand-in (no skills → it never gains Stealth). SP-4b-2b removed the
    // structurally-empty case entirely — `livingEnemyAttackerIds()` empties only by DEATH now.
    const playerStealthedEnemyCount = (): number =>
        countOwnersWithSelfBuff(statusEngine, livingEnemyAttackerIds(), 'Stealth');
    const enemyStealthedEnemyCount = (): number =>
        countOwnersWithSelfBuff(statusEngine, playerIds, 'Stealth');
    const ownerDebuffNames = (ownerId: string): string[] =>
        ownerDebuffNamesFor(statusEngine, ownerId);
    // Sub-project I, PR I1: NAMES on a resolved (real) opposing target for name-specific
    // `enemy-debuff` gates (Tygr's "to enemies with Stasis or Disable", Incinerator's "to
    // enemies afflicted with Inferno"). Control/marker debuff names come from the same
    // ownerDebuffNamesFor read used for selfDebuffNames above, keyed by the TARGET's id
    // (not the actor's). DoTs (Inferno/Corrosion/Bomb) carry no names of their own in the
    // status-engine's named stores — they are tracked as counted entry arrays only (see
    // roundContext.ts's landedEnemyDebuffCount fold) — so their base-type name is synthesized
    // here from entry-array presence on the target, matching the exact `buffName` strings
    // `enemyEffectConditions` extracts from the raw skill text (base type, no tier suffix —
    // verified empirically: Incinerator's "afflicted with Inferno" clause parses to
    // buffName:'Inferno', never 'Inferno III'). Called ONLY from buildTurnArgs, gated by the
    // same targetId guard (real/positional target) that already protects DPS parity below —
    // this function itself is side-agnostic (team-symmetric: works for a player actor's enemy
    // target or an enemy actor's player target).
    const enemyDebuffNamesForTarget = (target: CombatActor): string[] => [
        ...ownerDebuffNamesFor(statusEngine, target.id),
        ...(target.infernoEntries.length > 0 ? ['Inferno'] : []),
        ...(target.corrosionEntries.length > 0 ? ['Corrosion'] : []),
        ...(target.pendingBombs.length > 0 ? ['Bomb'] : []),
        // SP-E: generic DoTs have no single named type — synthesize a base "Damage over Time"
        // buff-name so an `enemy-debuff` name-gate can still see them.
        ...(target.genericDoTEntries.length > 0 ? ['Damage over Time'] : []),
    ];
    // Sub-project I, PR I4b/I4c — per-VICTIM, per-TICK resolution of an applier's dotMult.
    // Reads `ctx.victimGatedDotDamage` (set by runPlayerTurn ONLY when the applier's cast
    // carried an enemy-status-name-gated dotDamage modifier — Wildfire's Scorching Radiation
    // crit-power bonus, either the applier's OWN or one distributed from an ally's "all
    // allies deal…" aura). The fast path (no such modifier — every other ship) returns
    // `ctx.dotMult` unchanged: byte-identical. When present, re-folds EACH entry's
    // `abilities` against a ctx whose enemy-status fields are swapped to `victim`'s OWN
    // CURRENT live status (read fresh at TICK time via
    // `enemyDebuffNamesForTarget`/`selfBuffNamesForOwners` — deliberately NOT a pre-turn
    // snapshot: a DoT tick is a later, separate event from the cast that applied it, so
    // there is no anti-causality concern about it seeing that SAME cast's own debuff-
    // infliction, unlike I2's positional-apply delta). I4c: a LIST, not a single entry — the
    // applier's own entry (if any) keeps its own ctx (selfCritPower = the APPLIER's own crit
    // power, unchanged from I4b); each distributed ally-aura entry carries the AURA
    // SOURCE's ctx (selfCritPower = the SOURCE's crit power — the locked rule for Wildfire's
    // team aura). Each entry's `enemyDebuffNames`/`enemyBuffNames` are independently
    // re-pointed at `victim` here, so every entry gates on the SAME victim's live status
    // regardless of whose ctx it originated from. Since the abilities were EXCLUDED from
    // the cast-time `dotMult` bake (see `partitionDotDamageAbilities`), each fresh fold is
    // ADDED directly — no base-ctx subtraction needed (contrast I2's
    // `perVictimOutgoingDeltaPct`, which must subtract because its abilities stay baked
    // into the aggregate).
    const victimDotMult = (ctx: PlayerRoundCtx, victim: CombatActor): number => {
        const gated = ctx.victimGatedDotDamage;
        if (!gated || gated.length === 0) return ctx.dotMult;
        let bonus = 0;
        for (const entry of gated) {
            if (entry.abilities.length === 0) continue;
            const victimCtx: ConditionContext = {
                ...entry.ctx,
                ...(entry.ctx.enemyDebuffNames !== undefined
                    ? { enemyDebuffNames: enemyDebuffNamesForTarget(victim) }
                    : {}),
                enemyBuffNames: selfBuffNamesForOwners(statusEngine, [victim.id]),
            };
            bonus += modifierTotalsFromAbilities(entry.abilities, victimCtx).dotDamage;
        }
        return ctx.dotMult + bonus / 100;
    };
    const isStasised = (actorId: string): boolean => ownerDebuffNames(actorId).some(isStasis);
    const isDisabled = (actorId: string): boolean => ownerDebuffNames(actorId).some(isDisable);
    /** Turn-blocked = cannot take its scheduled action this turn (Stasis OR Disable). Used by the
     *  three turn-action gates AND the reactive drain filter (drainQueue). The Stasis-only break /
     *  immunity sites intentionally keep using isStasised — Disable never breaks. */
    const isTurnBlocked = (actorId: string): boolean => isStasised(actorId) || isDisabled(actorId);

    // Base-HP fallback for recipientMaxHp before an actor has taken its first turn (no ctx yet):
    // attacker → input.hp; walked team → walk stats hp; enemy attackers → their CombatActor hp
    // (E5: enemy ids ARE now queried as recipients once enemy heals restore HP).
    const baseHpById = new Map<string, number>([
        [attacker.id, hp],
        ...teamActors.map((t) => [t.id, t.walk!.stats.hp] as const),
        ...enemyAttackerActors.map((a) => [a.id, a.stats.hp] as const),
    ]);
    const baseHpFor = (id: string): number => baseHpById.get(id) ?? 0;

    // ── Side-context bundle (bySide unification PR3) ───────────────────────────
    // Collapses the four hand-paired side closures — the per-side ally-charge grant and the
    // per-side lowest-speed-ally set (plus the drain-time self-HP% lookup) — into ONE
    // side-parameterized SideContext. `actorsBySide(side)` is the primitive (its first
    // consumers are the closures below + the drain/turn call sites). Built once into cached
    // playerSide/enemySide objects so each field is a stable reference.
    //
    // BYTE-IDENTICAL: the player context reproduces the old player closures verbatim; the enemy
    // context reproduces the old enemy closures verbatim — lowestSpeedIds keeps the enemy
    // `length === 0 → ∅` guard (inert for the player side, which always has the attacker), grant
    // loops the side's own actors, and selfHpPctFor returns 100 for every enemy owner (exactly what
    // the old shared healTarget closure returned for a non-healTarget id; an enemy owner id can
    // never equal healTarget.id — reservedActorIds forbids it). The genuine per-actor enemy
    // self-HP% (real enemy currentHp) lands in PR5 with per-actor accounting.
    type Side = CombatActor['side'];

    const actorsBySide = (side: Side): CombatActor[] =>
        side === 'player' ? allPlayerActors : enemyAttackerActors;

    interface SideContext {
        /** Bump every same-side actor's charges by `amount` (capped at each actor's own
         *  chargeCount; chargeCount 0 skipped — no charge skill to bank). The optional `emitBus`
         *  overrides the captured outer bus for the `charge-changed` emission — reactive callers
         *  pass the stamping wrapper (ctx.bus) so the change is branded `reactive`/`duringTurnOf`
         *  and the log nests it under the triggering turn; on-turn callers omit it (unstamped). */
        grantAllyCharges: (
            amount: number,
            opts?: { recipientIds?: string[]; emitBus?: CombatEventBus }
        ) => void;
        /** Subtract `amount` charges from every OPPOSING-side actor (floored at 0), skipping
         *  actors that are `chargeLossImmune` or have no charged skill (chargeCount 0). The
         *  subtractive mirror of grantAllyCharges; flips the side internally so callers pass
         *  THIS side's context (never pre-flipped).
         *
         *  Charge Manipulation affinity gate: when `applierAffinity` is supplied, an opposing
         *  actor with affinity ADVANTAGE over the applier (applier disadvantaged vs it) is SKIPPED
         *  ("Does not affect enemies with affinity advantage over the applying unit"). Undefined →
         *  no gate (byte-identical to pre-gate behaviour); antimatter/neutral matchups never skip.
         *  The optional `emitBus` overrides the captured outer bus for the `charge-changed`
         *  emission — see grantAllyCharges. */
        removeEnemyCharges: (
            amount: number,
            applierAffinity?: AffinityName,
            emitBus?: CombatEventBus
        ) => void;
        /** Single-target charge removal: subtract `amount` from ONE actor by id (floored at 0,
         *  chargeLossImmune / chargeCount-0 actors skipped). Used for "decrease THAT enemy's
         *  charge" (Zosimos), routed by eventCtx.repairerId. Does NOT require the opposing-side
         *  filter — the caller passes a known-opposing id. Same `applierAffinity` charge-manip gate
         *  as removeEnemyCharges: an affinity-advantaged target is skipped when the affinity is
         *  supplied. The optional `emitBus` overrides the captured outer bus — see grantAllyCharges. */
        removeChargesFrom: (
            targetId: string,
            amount: number,
            applierAffinity?: AffinityName,
            emitBus?: CombatEventBus
        ) => void;
        /** Same-side ids sharing the minimum LIVE effective speed (ties → all). Empty side → ∅ —
         *  since SP-4b-2b a side is empty only once every member is DEAD, never because the caller
         *  supplied no roster. Recomputed per gate eval (speed is dynamic). */
        lowestSpeedIds: () => Set<string>;
        /** Live self-HP% for a same-side drain owner (hp-threshold gates). Player side reads the
         *  heal target's live HP (every other id → 100). #415 anchors `healTarget` to the focus in
         *  every mode, so this is now defined in DPS mode too — it was undefined there pre-#415,
         *  defaulting to 100 via buildDrainContext. Enemy side returns 100 for every owner (no
         *  per-actor enemy HP until PR5). Consumed in Task 2. */
        selfHpPctFor?: (ownerId: string) => number;
        /** Same-side ids adjacent to `ownerId` on the board (living, owner excluded). Positional
         *  → board neighbours; non-positional (no positions wired) → all living same-side allies. */
        adjacentAllyIdsFor: (ownerId: string) => string[];
        /** Living ally ids on the owner's ACTIVE support pattern footprint. */
        footprintAllyIdsFor: (ownerId: string) => string[] | undefined;
    }

    const parsedPatternForActor = (a: CombatActor): ParsedPattern | undefined => {
        if (a.side === 'enemy') return enemyPatternById.get(a.id);
        if (a.kind === 'attacker') return input.pattern;
        return teamPatternById.get(a.id);
    };

    const buildSideContext = (side: Side): SideContext => {
        const actors = actorsBySide(side);
        return {
            grantAllyCharges: (
                amount: number,
                opts?: { recipientIds?: string[]; emitBus?: CombatEventBus }
            ): void => {
                const targets =
                    opts?.recipientIds !== undefined
                        ? actors.filter((a) => opts.recipientIds!.includes(a.id))
                        : actors;
                for (const a of targets) {
                    if (a.chargeCount <= 0) continue;
                    const oldCharge = a.charges;
                    a.charges = Math.min(a.charges + amount, a.chargeCount);
                    if (a.charges !== oldCharge) {
                        (opts?.emitBus ?? bus).emit({
                            type: 'charge-changed',
                            actorId: a.id,
                            round: currentRound,
                            oldCharge,
                            newCharge: a.charges,
                            reason: 'manip',
                        });
                    }
                }
            },
            // Enemy-targeted charge removal: subtract from each opposing actor, floored at 0,
            // skipping immune actors and those with no charged skill. Mirror of grantAllyCharges
            // but on the opposing side, and subtractive.
            removeEnemyCharges: (
                amount: number,
                applierAffinity?: AffinityName,
                emitBus?: CombatEventBus
            ): void => {
                for (const a of actorsBySide(side === 'player' ? 'enemy' : 'player')) {
                    if (a.chargeCount <= 0 || a.chargeLossImmune) continue;
                    // Charge-manip affinity gate: skip an actor with affinity advantage over the
                    // applier (applier disadvantaged vs it). No-op when affinity undefined/neutral.
                    if (
                        applierAffinity &&
                        getAffinityMatchup(applierAffinity, a.affinity) === 'disadvantage'
                    )
                        continue;
                    const oldCharge = a.charges;
                    a.charges = Math.max(0, a.charges - amount);
                    if (a.charges !== oldCharge) {
                        (emitBus ?? bus).emit({
                            type: 'charge-changed',
                            actorId: a.id,
                            round: currentRound,
                            oldCharge,
                            newCharge: a.charges,
                            reason: 'manip',
                        });
                    }
                }
            },
            // Single-target charge removal: subtract from ONE opposing actor (floored at 0,
            // immune actors skipped). Used for "decrease THAT enemy's charge" (Zosimos), routed
            // by eventCtx.repairerId. Mirror of removeEnemyCharges but one actor, not all.
            removeChargesFrom: (
                targetId: string,
                amount: number,
                applierAffinity?: AffinityName,
                emitBus?: CombatEventBus
            ): void => {
                const a = allActorsById.get(targetId);
                if (!a || a.chargeCount <= 0 || a.chargeLossImmune) return;
                // Charge-manip affinity gate: skip a target with affinity advantage over the
                // applier (applier disadvantaged vs it). No-op when affinity undefined/neutral.
                if (
                    applierAffinity &&
                    getAffinityMatchup(applierAffinity, a.affinity) === 'disadvantage'
                )
                    return;
                const oldCharge = a.charges;
                a.charges = Math.max(0, a.charges - amount);
                if (a.charges !== oldCharge) {
                    (emitBus ?? bus).emit({
                        type: 'charge-changed',
                        actorId: a.id,
                        round: currentRound,
                        oldCharge,
                        newCharge: a.charges,
                        reason: 'manip',
                    });
                }
            },
            lowestSpeedIds: (): Set<string> => {
                if (actors.length === 0) return new Set<string>();
                const speeds = actors.map((a) => effectiveSpeedOf(a));
                const min = Math.min(...speeds);
                return new Set(actors.filter((_, i) => speeds[i] === min).map((a) => a.id));
            },
            selfHpPctFor:
                side === 'player'
                    ? healTarget
                        ? (ownerId: string): number => {
                              if (ownerId !== healTarget.id) return 100;
                              // Same denominator as the cast-path selfHpPct (baseHpFor) so the gate
                              // flips at the same threshold at cast vs drain time.
                              const maxHp = baseHpFor(healTarget.id);
                              if (maxHp <= 0) return 100;
                              return Math.max(
                                  0,
                                  Math.min(100, (healTarget.currentHp / maxHp) * 100)
                              );
                          }
                        : undefined
                    : (): number => 100,
            adjacentAllyIdsFor: (ownerId: string): string[] => adjacentAllyIds(ownerId, actors),
            footprintAllyIdsFor: (ownerId: string): string[] | undefined => {
                const owner = allActorsById.get(ownerId);
                if (!owner) return undefined;
                return supportFootprintAllyIds({
                    pattern: parsedPatternForActor(owner),
                    anchor: owner.position,
                    sameSideLiving: actors.filter((a) => a.currentHp > 0),
                });
            },
        };
    };

    const playerSide = buildSideContext('player');
    const enemySide = buildSideContext('enemy');
    const bySide = (side: Side): SideContext => (side === 'player' ? playerSide : enemySide);

    // Base-DEFENCE fallback for an enemy attacker's target-defence read before the target has
    // taken its first turn (no ctx yet): attacker → input.defence; walked team → walk defence;
    // legacy team → 0. After the target's first turn the live ctx.effectiveDefence is preferred.
    const baseDefenceById = new Map<string, number>([
        [attacker.id, defence],
        ...teamActors.map((t) => [t.id, t.walk!.stats.defence] as const),
    ]);
    const baseDefenceFor = (id: string): number => baseDefenceById.get(id) ?? 0;

    // The per-round healing map. Rebound at the top of each round (in healing mode) so the
    // ctx's `credit` always writes into the CURRENT round's entries via this `let`.
    let currentRoundHealing = new Map<string, ActorHealing>();
    const healFor = (id: string): ActorHealing => {
        let h = currentRoundHealing.get(id);
        if (!h) {
            h = emptyActorHealing();
            currentRoundHealing.set(id, h);
        }
        return h;
    };
    // Recipient-keyed companion to `currentRoundHealing` (which is source-keyed). Rebound per
    // round in the same place, for the same reason.
    let currentRoundRecipientHealing = new Map<string, ActorHealing>();
    const recipientHealFor = (id: string): ActorHealing => {
        let h = currentRoundRecipientHealing.get(id);
        if (!h) {
            h = emptyActorHealing();
            currentRoundRecipientHealing.set(id, h);
        }
        return h;
    };
    /** #383: per-SOURCE repair total, keyed by the actor that PERFORMED the repair — the
     *  side-agnostic sibling of `currentRoundHealing`'s `perActor`, which is player-only by design
     *  (E5 §4.1) and must stay that way. A single gross number rather than an `ActorHealing`: the
     *  only consumer is `hp-snapshot.repairPerformed`, which reports the raw that arrived, and
     *  inventing effective/overheal buckets nobody reads would just be more to keep in sync.
     *  Rebound per round in the same place as its siblings, for the same reason. */
    let currentRoundSourceRepair = new Map<string, number>();
    // H1 Task 6: per-round shield-granted accumulator (recipient actor id → total shield
    // actually added to its pool THIS round, post-cap delta). Mirrors `currentRoundHealing`'s
    // lifecycle: declared once here, captured by grantShieldToTarget's live closure, and rebound
    // fresh at the top of each round so it never accumulates across rounds. Surfaced as the
    // `granted` half of RoundData.perActorShield at the post-round push.
    let perActorShieldGranted = new Map<string, number>();
    // Reflect gear set (Task 5): per-round reflected-thorns accumulator (ATTACKER actor id →
    // total reflected damage dealt back to it THIS round). Mirrors perActorShieldGranted's
    // lifecycle — declared once, written by the reflection block inside applyVictimDamage, and
    // rebound fresh each round so it never accumulates across rounds. Surfaced both as the
    // attacker's incoming (automatic via the sink) AND on RoundData.perActorReflected.
    let perActorReflected = new Map<string, number>();
    // Bomb-splash-on-death: per-round accumulator (adjacent-ally actor id → total splash damage
    // dealt to it THIS round by dying bombed allies). Mirrors perActorShieldGranted's lifecycle
    // (declared once, rebound fresh each round at ~3352, captured by the splash block in the death
    // seam). Surfaced as RoundData.perActorSplash at the post-round push (absent when empty →
    // non-positional / no-splash rounds stay byte-identical).
    let perActorSplash = new Map<string, number>();
    // Per-victim skill-triggered detonation (positional): per-round accumulator (detonating
    // actor id → total detonation damage it dealt across footprint victims THIS round). Mirrors
    // perActorSplash's lifecycle (declared once, rebound fresh each round, captured by the
    // positional detonation loop). Sources the focus detonationDamage display row in positional
    // mode (focus.detonation is 0 there — the aggregate credit is suppressed). Absent when empty
    // → non-positional rounds byte-identical.
    let perActorDetonation = new Map<string, number>();
    // Per-round per-applier DoT-tick display tally (sourceId → {corrosion, inferno}). Populated
    // ONLY by the positional per-victim DoT-tick path (Task C2); folded into the FOCUS actor's
    // corrosion/inferno display + raw totals at post-round assembly WITHOUT feeding cumulativeDamage
    // (the per-victim HP already lands via applyVictimDamage — exact mirror of perActorDetonation).
    // Empty on non-positional rounds → byte-identical.
    let perActorDot = new Map<string, { corrosion: number; inferno: number; generic: number }>();

    // Recipient's CURRENT effective max HP: prefer the actor's last-turn ctx (live buffs),
    // else its base HP (pre-first-turn). Same pattern for incoming-heal %: the ctx value
    // already folds the actor's pre-fight incomingHeal baseline (playerTurn folds it into
    // scheduledTotals), so the preFight fallback below fires ONLY before the actor's first
    // turn — never double-counted (F3).
    const recipientMaxHp = (id: string): number =>
        lastTurnCtxByActor.get(id)?.effectiveMaxHp ?? baseHpFor(id);
    // #367: the incoming-repair % for a recipient OTHER than the acting actor. The `preFight` half
    // comes from the recipient's published ctx (or, before its first turn, from its own
    // `preFight`); the ENEMY-APPLIED half is taken LIVE, because a published ctx is only as fresh
    // as that actor's last turn and a debuff applied by a SLOWER enemy lands after it. All of that
    // arithmetic — including the subtraction that stops the live re-read from double-counting what
    // the ctx already carries — lives in `liveHealChannelPct`, which the reactive-heal path in
    // triggers.ts calls for the same two channels.
    //
    // #367 fix wave: the SELF-side half has its own freshness problem, and `freshCtx` is how a
    // caller closes it. `lastTurnCtxByActor` is written BELOW the positional apply on the two
    // player-side turn branches, so a leech paying its own acting actor mid-turn reads that
    // actor's PREVIOUS turn's self-side total: absent in round 1, and one turn behind after a
    // timed self-buff expires. A caller that already holds the acting turn's own `turnCtx` passes
    // it here (see `actingTurnCtx`) instead of hand-rolling a second resolution: `liveHealChannelPct`
    // still owns the arithmetic, so the ENEMY-APPLIED half is re-read live exactly as before and
    // only the ctx the self-side baseline comes from changes. Omitted → the map, unchanged.
    const recipientIncomingHealPct = (id: string, freshCtx?: PlayerRoundCtx): number =>
        liveHealChannelPct(
            statusEngine,
            id,
            'incomingHealPct',
            freshCtx ?? lastTurnCtxByActor.get(id),
            allActorsById.get(id)?.preFight?.incomingHeal ?? 0,
            // #396: the recipient's own named self statuses, so the live enemy half is SHADOWED
            // against them rather than added to them. `victimSelfBuffs` is the same three-channel
            // read `victimIncomingModifiers` uses for the damage-side comparison — scheduled
            // (`selfBuffLookup`, i.e. the manual picker, which is where a straddle actually comes
            // from) plus the timed and aura `'self'` ability statuses.
            victimSelfBuffs(statusEngine, id, selfBuffLookup)
        );

    // #367 fix wave — THE ACTING TURN'S OWN CTX, for the window in which the map does not have it
    // yet. Set to the acting actor's `turnCtx` the moment `runPlayerTurn` returns, on all three
    // turn branches (focus / walked team / enemy), and cleared at every turn start and round
    // boundary alongside `actingActorId` so the pair is never half-set. Read ONLY through
    // `actingSelfCtx` below, i.e. only for a recipient that IS the acting actor.
    //
    // Outside the mid-turn window this is provably a no-op rather than a second source of truth:
    // `lastTurnCtxByActor.set` stores this very object, so once the publish has run the override
    // and the map entry are the SAME reference. The enemy branch publishes ABOVE its positional
    // apply (unlike the two player branches), so on that side the override is already equal when
    // its leeches fire — measured: an enemy-side damage-dealt leech credits the same three-round
    // profile before and after this change.
    let actingTurnCtx: { actorId: string; ctx: PlayerRoundCtx } | undefined;
    /** The acting turn's own ctx IF `id` is the acting actor, else undefined (→ the map). */
    const actingSelfCtx = (id: string): PlayerRoundCtx | undefined =>
        actingTurnCtx?.actorId === id ? actingTurnCtx.ctx : undefined;

    // Heal target's live HP% (0..100) for `hpSubject:'target'` cast-time gates (Task 5). Read at
    // the ACTING actor's turn start (pre-this-cast-heal): healTarget.currentHp already reflects
    // the turn-start DoT tick but not the cast's heal. Pre-#415, DPS mode had no `healTarget`, so
    // this always returned 100 there — a "below N" target gate always failed, inert by
    // construction. #415 anchors `healTarget` to the focus (the attacker, absent an explicit heal
    // target) in every mode, so DPS now reads this actor's real live HP% too. Defined here so
    // every player turn dispatch (attacker + walked team) reads the same denominator
    // (recipientMaxHp).
    const healTargetHpPctNow = (): number => {
        if (!healTarget) return 100;
        const maxHp = recipientMaxHp(healTarget.id);
        return maxHp > 0 ? (100 * Math.max(0, healTarget.currentHp)) / maxHp : 100;
    };

    // The healing rounds + first-destroyed-round seam (target HP can only reach 0 via enemy
    // attacks, which land in Task 8 — the detection just never fires this task).
    const healingRounds: HealingRoundEngine[] = [];
    // Backstop-only local (PR5c): holds ONLY the post-round backstop's independent contribution
    // — the start-dead / no-`recordDestroyed` path where the heal target enters a round at
    // currentHp<=0 without ever being stamped by recordDestroyed (Task-1 OUTCOME B). The normal
    // death round now comes from the per-actor `healTarget.destroyedRound` field; this captures
    // only the case that field never sees.
    let backstopDestroyedRound: number | undefined;
    // Cheat Death consumption (Phase 4b). A 'recurring'/always-active Cheat Death buff is
    // re-derived every round and is NOT stored in the StatusEngine's timed maps, so it cannot
    // be consumed by deleting it from a store (it would regenerate next round). Consumption is
    // therefore a per-actor ENGINE FLAG with combat lifetime: once an actor's intercept fires,
    // its id lands here and a SECOND lethal hit destroys it normally even though the recurring
    // buff is still in the snapshot. Declared OUTSIDE the round loop → persists across rounds.
    const cheatDeathConsumed = new Set<string>();
    // Lifeline (incoming-shield-grant): once-per-BATTLE fired flags, keyed `${victimId}:${abilityId}`.
    // Combat-lifetime (NOT reset per round) — the shield grant occurs at most once per combat.
    const thresholdShieldFired = new Set<string>();
    // Display-only (Phase 4c): a spent Cheat Death keeps reappearing in the displayed buff list
    // for two reasons, depending on how it was granted. (1) Passive/aura grants (Tycho) are
    // re-derived from the persistent aura store every round and clearRemovable leaves auras
    // intact by design. (2) Active/charged cast-path grants (timed, Infinity) ARE deleted by
    // clearRemovable on consumption, but a slot that re-fires each round re-applies them. Either
    // way the chip would keep showing even though no further save is possible (consumption is the
    // flag above, not a permanent store removal). `cheatDeathConsumed` is combat-lifetime and
    // never re-armed (only ever .add'd / .has'd — see the intercept), so an actor present here
    // can never be saved again.
    //
    // We track the round the intercept fired (set alongside the flag) and hide the chip only in
    // rounds STRICTLY AFTER consumption: the consuming round still shows it (that round's chip
    // reflects the protection that was live and actually saved the unit), and every subsequent
    // round drops it. Pure display filter — does NOT touch save logic.
    const cheatDeathConsumedRound = new Map<string, number>();
    const hideSpentCheatDeath = (
        buffs: ActiveBuff[],
        ownerId: string,
        round: number
    ): ActiveBuff[] => {
        const consumedRound = cheatDeathConsumedRound.get(ownerId);
        return consumedRound !== undefined && round > consumedRound
            ? buffs.filter((b) => !CHEAT_DEATH_BUFFS.has(b.buffName))
            : buffs;
    };
    // Once-per-combat reactive repairs (Phase 4b, Task 8). Keyed `${ownerId}:${abilityId}`.
    // Declared OUTSIDE the round loop (combat lifetime, like cheatDeathConsumed) so a flagged
    // repair — Yazid's on-cheat-death-activated 60% repair — fires at most once per battle even
    // across rounds. Threaded into executeIntent's ctx; the executor checks/sets it.
    const oncePerCombatFired = new Set<string>();
    // Combat-lifetime per-(owner, ability, source) event counter for everyNthEvent gates.
    // Keyed `${ownerId}:${abilityId}:${repairerId}`; incremented on every qualifying enqueue-drain
    // and used to trigger removal only on the Nth event (e.g. Zosimos "every second repair").
    const repairCountBySource = new Map<string, number>();
    // Combat-lifetime proc-chance gates for equipment reactive procs (D-PR1). Keyed
    // `${ownerId}:${abilityId}`; each gate is a RateGate that fires with the ability's
    // procChance probability on each draw (random, like the crit/landing gates).
    const procChanceGates = new Map<string, RateGate>();
    // Per-SUB-ATTACK verdict cache for procScope:'per-attack' proc abilities (Insidiousness).
    // Keyed `${ownerId}:${abilityId}:${subAttackIndex}` (multi-hit full-walk epic, PR4 — was
    // `${ownerId}:${abilityId}`, which silently made it per-TURN, so a hits:N skill replayed
    // sub-attack #1's verdict for all N); cleared at each actor turn-start beside
    // reactionFiredThisAttack so a later attack rolls afresh.
    const procDecisionThisSubAttack = new Map<string, boolean>();
    // G PR1: dedicated crit-gate for counterattacks. A NEW map (NOT any existing per-actor
    // crit gate) so it only ever creates keys for counter-carriers → no draw, no perturbation
    // for every existing fixture → byte-identical.
    const counterCritGates = new Map<string, RateGate>();
    // PR4b: dedicated crit-gate for the reactive `damage` executor (Judge/Chakara/Incinerator/
    // Rhodium/Grif/FrontLine start-of-round/end-of-round/on-enemy-cleansed/on-enemy-charged-cast
    // procs). A NEW map, mirroring counterCritGates — keyed `${ownerId}:${abilityId}`, so it only
    // ever draws for ships carrying one of these abilities. `noCrit`-flagged abilities (Grif,
    // Rhodium) never touch this map at all (the `!noCrit &&` short-circuit in applyReactiveDamage
    // skips the roll entirely) — no gate is ever created for them, so they can never crit by
    // construction, independent of the RNG stream.
    const reactiveDamageCritGates = new Map<string, RateGate>();
    // SP-G G3: the last reactive-damage `raw` each owner dealt, so a sibling reactive shield
    // enqueued on the SAME trigger (FrontLine's "Shield equal to 30% of the damage dealt")
    // can scale off the ACTUAL mitigated/crit amount rather than a flat attack approximation.
    // Written by applyReactiveDamage (below), read by the reactive-shield executor via the
    // exec ctx. Damage intent drains before the shield intent (enqueue order), so the value is
    // fresh when the shield reads it.
    const reactiveDealtByOwner = new Map<string, number>();

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // Reactive extra-action timing analysis (Phase 4b Task 10). Two death paths land an
    // extra-action grant in DIFFERENT rounds; the engine's grantExtraAction (below) dispatches
    // by whether the round-local turn queue is still being walked:
    //
    //  PATH A — during-turn deaths (on-destroyed self, on-ally-destroyed ally → Harvester).
    //    These fire from applyIncomingToTarget / the general death path, which run DURING an
    //    actor's turn. They are followed by the per-turn drainIntentsFor(side) (drain point (b))
    //    while the selection loop is still walking → the grant CAN bump the granter's pending
    //    count via processExtraActionGrants(granter, …), and the selection loop then re-picks the
    //    granter at its live speed-rank among the remaining actors (a same-round extra turn).
    //    `inTurnLoop` is true only while the loop body walks; the two drains OUTSIDE the loop
    //    (pre-loop and round-tail, named under Path B) see it false → Path B.
    //
    //  PATH B — out-of-turn-loop death (cross-round buffered grant). Fires when a death is
    //    reconciled while NO turn queue is live, which today means from either of the two drains
    //    that sit outside the selection loop:
    //      • drain point (a), the `round-started` drain, which runs BEFORE `inTurnLoop = true`; and
    //      • the `round-ended` drain at the round TAIL, which runs after the turn loop's `finally`
    //        has reset the flag — see that `finally`'s own comment.
    //    An extra-action grant arriving from either is buffered (inTurnLoop false →
    //    grantExtraAction pushes onto `pendingExtraActions`) and flushed at the top of the NEXT
    //    round, before that round's pre-loop drain and turn loop: the buffered granter's pending
    //    count is bumped one extra (respecting once-per-round via THAT round's extraActionFired
    //    set) → the on-kill extra action lands the round AFTER the kill is registered. Sibling
    //    NON-extra-action reactives on the same death are not buffered at all — they execute in the
    //    next generation of the same drain pass, so an on-enemy-destroyed CHARGE reactive
    //    (Liberator's "all allies add 1 charge") applies immediately and the charges carry into the
    //    next round → correct.
    //    ⚠️ PATH B IS REACHABLE — but no longer through the caller it was written for, and the
    //    history is why the two are easy to confuse. That original caller was the round-tail block
    //    that landed the DPS run's aggregate damage on the dummy `enemy` actor: that HP landed
    //    post-round, so a kill there emitted ship-destroyed with `inTurnLoop` false. SP-4b-2b made
    //    the block unreachable (roster emptiness became impossible) and SP-4c-2d deleted it, the
    //    actor, and the dedicated post-round death drain it fed. What remains are the two drains
    //    named above, and shipped kits reach them: an end-of-round reactive `damage` proc
    //    (Incinerator's "at the end of the round, this unit deals 100% damage to all enemies with
    //    Inferno" — or Judge's "at the start of the round … to all enemies with less than 50% HP"
    //    on the other drain) that lands a kill emits ship-destroyed → the `on-enemy-destroyed`
    //    listener enqueues → drainQueue executes that intent in the SAME pass's next generation →
    //    a Sokol/Liberator `extra-action` grant reaches grantExtraAction with inTurnLoop false →
    //    Path B. Live on a multi-enemy board (the fight has to continue into the next round for the
    //    flush to land). Deaths DURING a turn still take Path A (positional applyOutgoingToEnemy →
    //    recordDestroyed inside the live queue). Enemy-incoming-accounting nuances around the round
    //    tail are deferred to SP-F/F7.
    //
    // pendingExtraActions is COMBAT-lifetime (outside the round loop) so a kill reconciled at the
    // end of round R survives into round R+1's pool build. Each entry is flushed (and removed)
    // exactly once at the next round's start.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const pendingExtraActions: {
        granterId: string;
        abilityId: string;
        oncePerRound: boolean;
        endOfRound: boolean;
    }[] = [];

    // Per-round set of actor ids that received a positive HP repair this round (C2b-3).
    // Cleared at each round top; read in buildTurnArgs for the target-repaired gate.
    const repairedThisRound = new Set<string>();

    // D-PR8: actors hit by a direct attack this round (damage landed on shield or HP).
    // Mirrors repairedThisRound. Feeds the not-hit-this-round gate (Alacrity). Cleared each
    // round alongside repairedThisRound.
    const hitThisRound = new Set<string>();

    // G PR1: once-per-attack guard. Cleared at every actor turn-start so all per-hit `attacked`
    // events of ONE sub-attack collapse to a single counter, while a separate later attack (a
    // different turn) counters again. NOT per-round. PR6: the key itself carries the triggering
    // event's sub-attack index, so a `hits: N` cast — N consecutive full attacks inside ONE turn
    // (R1) — draws N counters rather than collapsing into one.
    const counterFiredThisTurn = new Set<string>();

    // Task 5: sibling once-per-attack guard for SELF-scoped reactive buff/heal/charge riders
    // (Hermes's Everliving Regeneration + charge on on-ally-crit). Same lifecycle as
    // counterFiredThisTurn — cleared at every actor turn-start so a multi-hit / AoE attack applies
    // a self-rider once, while a later attack (a different turn) applies it again.
    const reactionFiredThisAttack = new Set<string>();

    // Installed per ROUND (below, where the deferral flags live — inside the `for (let r …)` body,
    // above the turn loop, so one install serves every turn of that round). Engine scope so the
    // healing ctx — built above the round loop — can route a reversal's consequence log through the
    // same buffer. Default is a direct emit: a reversal that somehow fires before the first round
    // installs one still logs, it just cannot be deferred (there is no window open to defer into).
    let emitConsequenceLog: (ev: CombatEvent) => void = (ev) => bus.emit(ev);
    // Installed per ROUND (below, next to `creditDealt`), for the same reason and by the same
    // pattern as `emitConsequenceLog` above: the reversal branch inside `applyHealToTarget` has to
    // book its burn on the round accumulators (`roundPerTargetDamage` / `roundPerTargetDealt`),
    // and those are declared fresh each round BELOW this ctx. Read through the binding at call
    // time; never copy its value into the healingCtx object literal.
    //
    // Default is a NO-OP, unlike emitConsequenceLog's default direct-emit: a reversal firing before
    // the first round installed one has no round accumulator to book into, so there is nothing
    // meaningful to fall back to.
    let bookReversalDamage: (
        victimId: string,
        applierId: string | undefined,
        amount: number
    ) => void = () => {};
    // The SHARED healing ctx (built once; closures capture the live target + currentRoundHealing
    // through the `let`/the target reference). Constructed whenever `healTarget` is set — which
    // includes `'battle'` runs (battle mode anchors `healTarget` to the focus actor above), NOT
    // healing mode only. The ctx is therefore shared by both modes, and since SP-4e it no longer
    // needs to tell them apart for ROUTING: recipient choice comes from the ability's target, not
    // from the run mode (the `teamBattle: runMode === 'battle'` flag that used to sit here is
    // gone). `perRecipientApply` below is the one mode-derived axis left, and it is APPLICATION
    // only — the healing calculator opts in explicitly, and a battle run always wants it.
    const healingCtx: HealingRuntimeCtx | undefined = healTarget
        ? {
              targetId: healTarget.id,
              perRecipientApply: (input.perRecipientHealApply ?? false) || runMode === 'battle',
              credit: (actorId, bucket, amount) => {
                  healFor(actorId)[bucket] += amount;
              },
              creditRecipient: (recipientId, bucket, amount) => {
                  recipientHealFor(recipientId)[bucket] += amount;
              },
              creditPerformed: (sourceId, amount) => {
                  currentRoundSourceRepair.set(
                      sourceId,
                      (currentRoundSourceRepair.get(sourceId) ?? 0) + amount
                  );
              },
              recipientMaxHp,
              recipientIncomingHealPct,
              recipientIncomingHealAmpPct: (rid) =>
                  incomingHealAmpForRecipient(
                      incomingHealAmpAbilitiesOf(rid),
                      (abilityId, chance) =>
                          rollRateGate(procChanceGates, `${rid}:${abilityId}`, chance)
                  ),
              // Foreign HoT applier max HP (Task 7): lastTurnCtxByActor ONLY, NO base-stat
              // fallback (strict corrosion applier-ctx rule — undefined → the holder skips the tick).
              applierMaxHp: (id) => lastTurnCtxByActor.get(id)?.effectiveMaxHp,
              // `repairSourceId` (Task 4, #362): the actor credited with this repair — the caster
              // for a cast repair, the applier for a HoT tick, the leeching actor for a leech.
              // Every call site is still REQUIRED to supply it (the parameter is not optional, so
              // `tsc` reports an arity error at any site that forgets).
              //
              // Un-parked (#362 fix-wave-1): it went unread for one revision after R7′ moved the
              // reversal's KILL credit to the debuff's applier (`repairSourceId` was that credit's
              // one consumer under the retracted R7). It has a reader again — R11's log row names
              // it as `healerId`, DISPLAY ONLY (see the reversal branch below and the
              // `reversed-repair-log` doc comment in `events.ts`). Do NOT wire it back into the
              // damage/kill attribution: that is the healer-fallback R7′ rejects.
              applyHealToTarget: (raw, victim, repairSourceId) => {
                  // Dead target → all overheal, and NO reversal: a corpse takes no reversed repair.
                  if (victim.currentHp <= 0) {
                      return { reversed: false, consumed: 0, overheal: raw };
                  }
                  // ── #362 Reversed Repairs ────────────────────────────────────────────────
                  // "Incoming repairs damage this unit instead" (Zosimos's charged skill).
                  //
                  // WHY THIS LINE. `raw` arriving here is already post-crit, post-healModifier,
                  // post-outgoingHealBuff and post-`incomingHealPct` — which is where
                  // `Inc. Repair Down` lives — and it is PRE-deficit-clamp (the clamp is three
                  // lines below). So three of the rulings are satisfied by POSITION alone and
                  // must not be recomputed here:
                  //   R3 — a target at full HP takes the FULL amount (pre-clamp),
                  //   R4 — the repair's crit carries into the burn (post-crit),
                  //   R6 — Inc. Repair Down applies FIRST and the reduced amount reverses.
                  // And because this closure is the ONLY line in the engine where HP goes up,
                  // R2 ("every repair, any source") is satisfied by position too: cast repairs,
                  // HoT ticks, leech self-repairs and reactive repairs all funnel through here.
                  // Shield GRANTS are not repairs and go through grantShieldToTarget, untouched.
                  const reversal = reversedRepairsOn(statusEngine, victim);
                  if (reversal) {
                      // R1: a raw HP burn at face value. No shield drain, no Protection redirect,
                      // no defence mitigation, no Barrier — `applyVictimDamage` owns all four and
                      // is deliberately NOT entered. R5 ("nothing reacts") follows from the same
                      // choice: no counterattack, no Reflect thorns, no incoming-leech proc, no
                      // on-damaged passives, because none of those live on this path. A kill by
                      // reversal likewise fires no bomb death-splash — the splash block is at the
                      // `applyVictimDamage` call site, gated on ITS `'destroyed'` outcome, and
                      // this path deliberately has no such block.
                      //
                      // NO `hp-changed` EMIT, DELIBERATELY (#362 fix-wave-2, M-2). `hp-changed` is
                      // the trigger `on-hp-threshold-crossed` subscribes to (`triggers.ts`, the
                      // "when this unit drops below N% HP" passives), so emitting one here would
                      // arm a reaction off the burn. R5 says NOTHING reacts to a reversal, and
                      // this is that ruling applied to the one reaction that does not live inside
                      // `applyVictimDamage` — every other one is fenced by simply not entering the
                      // funnel. Consistent, not an oversight: a player whose ship drops past 50%
                      // to a reversed repair does not get the low-HP passive, exactly as they get
                      // no counterattack, no Reflect and no on-damaged rider. The BAR still moves
                      // (the intake booking below is what the report reads); only the trigger is
                      // withheld. Do not "fix" this by emitting one without re-opening R5.
                      //
                      // `burn` clamps `raw` at 0: a reversal only ever REMOVES HP. The normal
                      // (non-reversed) path below floors its own effect at 0 via the deficit
                      // clamp (`Math.max(0, Math.min(raw, targetMaxHp - victim.currentHp))`), and
                      // this path owes that same guarantee — `incomingHealPct` is unclamped
                      // upstream, so `raw` can already be negative by the time it reaches here,
                      // and a negative `raw` here would silently RAISE `currentHp`, uncapped by
                      // max HP, with no log row and no booked amount.
                      const burn = Math.max(0, raw);
                      victim.currentHp = Math.max(0, victim.currentHp - burn);
                      // ── R7′ ATTRIBUTION: the APPLIER, never the healer ───────────────────────
                      // The damage AND the kill belong to the Zosimos that inflicted the status,
                      // exactly the way a DoT's damage and kills belong to whoever applied the DoT.
                      // `repairSourceId` (the healer whose repair was reversed) is deliberately NOT
                      // used for the damage credit or the kill below — only for the log row's
                      // `healerId`, which is DISPLAY ONLY (see the `emitConsequenceLog` call below).
                      // Naming the healer in the log does not put the healer back in the attribution
                      // path: `applierId` stays the sole `actorId`/`creditDealt`/`killerId` — R7′ is
                      // unaffected by a reader who merely SHOWS who cast the undone repair.
                      //
                      // ⚠️ AN EARLIER RULING SAID THE OPPOSITE and was RETRACTED by the owner. The
                      // healer did not choose this; it cast a repair. Crediting it damage — and a
                      // kill on its own ally — would put an enemy's debuff on a support ship's
                      // damage line and, worse, name a medic as its own team-mate's killer. If you
                      // are here because "the healer caused it", that is the argument that was
                      // already rejected: do not flip it back.
                      //
                      // `applierId` is undefined when the status came from the scheduled channel
                      // (a debuff hand-ticked in the calculator's enemy-debuff picker was never
                      // cast by anyone). NO FALLBACK TO THE HEALER — that is the very attribution
                      // R7′ rejects. No credit, and `killerId: undefined` on the death event, which
                      // `recordDestroyed` already tolerates (a DoT-tick batch has no killer either).
                      //
                      // `byDirectDamage: false` is REQUIRED, not merely defensible: `triggers.ts`
                      // gates the killer-targeted on-destroyed reactions (Faust's purge,
                      // Martyrdom, Paracelsus) on it, so a `true` here would make those triggers
                      // spend on a kill their owner never chose. It is also correct on its own
                      // terms — a reversed repair is not a hit, so the consumables that spend on a
                      // direct hit (Barrier charges, Ironclad's nth-hit counter) must not see one.
                      //
                      // R8: Cheat Death still intercepts, through the ONE shared death path the
                      // damage funnel uses — the only survival layer that reaches a reversed repair.
                      //
                      // The burn's numeric booking (R7′'s damage half) mirrors what the DoT tick
                      // path does — victim-keyed intake plus a per-applier dealt credit — and is
                      // written by `bookReversalDamage`, installed per round below.
                      //
                      // `currentRound`, `actingActorId` and `emitConsequenceLog` are engine-scope
                      // `let`s declared BELOW this ctx. Reading them at CALL time is safe (the run
                      // loop has long since assigned them); copying their values into the ctx
                      // literal at construction time would not be. Route through the bindings.
                      //
                      // `currentRound`, NOT the round loop's `r`: `r` is block-scoped to
                      // `for (let r = 1; …)` and is simply not in scope here — this ctx is built
                      // above the loop. `currentRound` is the engine-scope mirror maintained for
                      // exactly this reason ("so closures defined once outside the loop can stamp
                      // the correct round"), and the charge-changed emitters just above already
                      // read it the same way.
                      bookReversalDamage(victim.id, reversal.applierId, burn);
                      // R11: every reversal writes its own combat-log row, lethal or not. Without
                      // it a non-lethal reversal emits NOTHING — the player watches a repair land,
                      // achieve nothing, and HP drop, with no line connecting the three. Routed
                      // through `emitConsequenceLog` so a reversal firing inside a deferral window
                      // (a reactive repair during a positional apply does exactly that) nests under
                      // the attack that caused it instead of printing above it.
                      //
                      // `burn > 0` (#362 fix-wave-2, M-8): "every reversal" means every reversal
                      // that BURNED something. A 0-magnitude repair reverses into a 0-magnitude
                      // burn — `bookReversalDamage` already drops it on its own `amount <= 0`
                      // guard and `victim.currentHp` does not move — so a row here would announce
                      // "repairs reversed 0" for an event with no observable consequence. The gate
                      // is the same one the CAST path applies upstream (`healRawSum > 0` in
                      // playerTurn.ts silences a repair that resolved to nothing at all); this
                      // extends it to the channels that have no such upstream gate (HoT ticks,
                      // leech self-repairs, reactive repairs).
                      if (burn > 0) {
                          emitConsequenceLog({
                              type: 'reversed-repair-log',
                              victimId: victim.id,
                              ...(reversal.applierId !== undefined
                                  ? { applierId: reversal.applierId }
                                  : {}),
                              // `healerId` (#362 fix-wave-1): the repair's source, for DISPLAY only
                              // — see the guardrail above and the `reversed-repair-log` doc comment
                              // in `events.ts`. `repairSourceId` is always a real id here (the
                              // parameter is required at every `applyHealToTarget` call site), so
                              // this is unconditional, unlike `applierId` which the scheduled
                              // channel can leave undefined.
                              healerId: repairSourceId,
                              amount: burn,
                              round: currentRound,
                          });
                      }
                      resolveLethalHp(victim, {
                          round: currentRound,
                          statusEngine,
                          cheatDeathConsumed,
                          cheatDeathConsumedRound,
                          bus,
                          emitConsequenceLog,
                          actingActorId,
                          killerId: reversal.applierId,
                          byDirectDamage: false,
                      });
                      // Deliberately NOT `repairedThisRound.add(...)` — nothing was repaired, so
                      // the target-repaired gate must stay shut. (Unrelated to R9: Zosimos's own
                      // charge passive keys off an enemy CASTING a repair, upstream of this
                      // closure, and is untouched by any of this.)
                      //
                      // ── R10′: NOTHING books on the healer ────────────────────────────────────
                      // Not repairs cast, not effective healing, not overhealing. "We don't need
                      // to book it as anything other than damage from a debuff" — and that damage
                      // is booked above, on the applier.
                      //
                      // ⚠️ A RETRACTED EARLIER RULING surfaced it as the healer's OVERHEALING, and
                      // this branch used to deliver that by returning `{consumed: 0, overheal: raw}`
                      // — a shape every call site already credited. Returning that today would be
                      // WORSE than useless: it books the raw as overheal, and the call sites' gross
                      // `directHeal`/`hotHeal` credit (written BEFORE this call) would stand too.
                      // Hence the `{ reversed: true }` arm carrying no numbers at all: it makes
                      // every site fail to compile until it moves its gross credit below the call.
                      //
                      // This is also still why the naive `incomingHealPct: -200` sign flip fails:
                      // that fold is unclamped, so it books `consumed: 0` plus a NEGATIVE overheal
                      // — no damage, no healing, garbage statistics, green tests throughout.
                      return { reversed: true };
                  }
                  const targetMaxHp = recipientMaxHp(victim.id);
                  // Clamp the deficit at 0: a max-HP buff expiring can shrink effectiveMaxHp
                  // below currentHp, making (targetMaxHp - currentHp) negative — without the
                  // Math.max a heal would REDUCE the target's HP. Floor at 0 → consumed 0,
                  // overheal = raw (the whole heal is wasted, which is correct in that state).
                  const consumed = Math.max(0, Math.min(raw, targetMaxHp - victim.currentHp));
                  victim.currentHp += consumed;
                  if (consumed > 0) repairedThisRound.add(victim.id);
                  return { reversed: false, consumed, overheal: raw - consumed };
              },
              grantShieldToTarget: (raw, victim = healTarget) => {
                  // dead → no-op. `gross: 0` (not `raw`) is the value that would keep a grant onto
                  // a CORPSE silent at #418's emit gate: a saturated pool and a dead recipient are
                  // both "granted 0", and only `gross` separates "the grant landed and was clipped"
                  // from "nothing was applied at all".
                  //
                  // ⚠️ It is correct but NOT test-observable, measured 2026-08-28: no emit site can
                  // reach this arm. `recipientsFor` never selects a dead ship on the two cast paths,
                  // and the reactive executor `continue`s on `recipientHp <= 0` before its shield
                  // branch. The one channel that DOES reach here — a damage-taken leech shield onto
                  // a fresh corpse — is the standing-leech site below, which emits no
                  // shield-applied by design. Mutating this to `gross: raw` reddens nothing.
                  // See the matching note in shieldAppliedEvent.test.ts before "fixing" a test for it.
                  if (victim.currentHp <= 0) return { granted: 0, gross: 0 };
                  const targetMaxHp = recipientMaxHp(victim.id);
                  // Capped at the CURRENT effective max HP. Note: if a max-HP buff later expires
                  // and shrinks targetMaxHp below an already-granted pool, the larger pool simply
                  // persists (we never shrink an existing shield) — acceptable, as the cap is only
                  // enforced at grant time and a shield is additive, never HP-reducing.
                  // Post-cap delta (Task 6): record the REAL increase, not `raw`. A grant that
                  // exceeds the maxHP cap records only the portion that actually landed, so the
                  // surfaced `granted` matches the pool growth the UI shows.
                  const before = victim.shieldPool;
                  victim.shieldPool = Math.min(victim.shieldPool + raw, targetMaxHp);
                  const actualGranted = victim.shieldPool - before;
                  perActorShieldGranted.set(
                      victim.id,
                      (perActorShieldGranted.get(victim.id) ?? 0) + actualGranted
                  );
                  // H3.6: return the REAL pool growth so the cast path / reactive executor can
                  // build the shield-applied event's `amount`; #418 adds `gross` so those sites
                  // can gate the EMIT on the attempt rather than on the growth. `raw` can be
                  // negative in no shipped path, but Math.max keeps `gross` from ever reporting a
                  // grant that could not have happened.
                  return { granted: actualGranted, gross: Math.max(0, raw) };
              },
              playerIds,
              enemyIds: enemyRecipientIds,
              recipientActor: (id) => allActorsById.get(id),
          }
        : undefined;

    /**
     * SP-4e: the `'lowest-hp-ally'` selector, resolved SIDE-RELATIVE to `ownerId` — over the
     * owner's OWN roster on either side (locked team symmetry). Lowest currentHp/maxHp, owner
     * EXCLUDED, ties broken by source order; `undefined` when the owner is the only living
     * candidate ("the OTHER ally" is nobody, never a self-target).
     *
     * ONE ranking for the whole engine: this delegates to `lowestHpAllyRecipients`, the same
     * helper the cast path (`recipientsFor` in playerTurn) binds — a second hand-copied ranking is
     * the shape that produced the one-directional defects in #306. `allyHpFraction` over the
     * healing ctx supplies the buff-aware max HP the helper's doc requires, and both `playerIds`
     * and `enemyIds` are fixed source-order arrays, which is what makes the tie-break the
     * documented one.
     *
     * Feeds `IntentExecContext.lowestHpAllyIdFor` (reactives) and the standing-leech procs.
     * `undefined` without a healing ctx: there is no live HP view to rank over, and the consumers
     * answer "no recipient" rather than falling back to the owner. Pre-#415 this guard always
     * tripped in DPS mode (no `healTarget` meant no `healingCtx`); #415 anchors `healTarget` to the
     * focus in every mode, so `healingCtx` is now always built — DPS mode ranks a real
     * `lowest-hp-ally` recipient too, rather than defaulting to "no recipient".
     */
    const lowestHpAllyIdForOwner = (ownerId: string): string | undefined => {
        if (!healingCtx) return undefined;
        const ownerActor = allActorsById.get(ownerId);
        if (!ownerActor) return undefined;
        return lowestHpAllyRecipients({
            casterId: ownerId,
            candidateIds: ownerActor.side === 'enemy' ? healingCtx.enemyIds : healingCtx.playerIds,
            hpFractionOf: (id) => allyHpFraction({ id, healing: healingCtx }),
        })[0];
    };

    /**
     * SP-3b Task 7: mirror ONE LANDED repair onto the RECIPIENT axis (`perRecipient`).
     *
     * The axis is defined as "keyed by the actor the repair LANDED ON", but until this change only
     * the direct cast-repair site (playerTurn.ts) credited it — HoT ticks, standing/taken leeches and
     * reactive repairs credited the SOURCE axis alone. That made the axis unusable as the report's
     * consumption basis: pointing `effectiveHealing`/`overheal` at it dropped every non-cast repair
     * (measured on the healing goldens: Magnolia's leech overheal 1258 → 0, the HoT scenario's
     * 2000 → 500, Isha's reactive effective 15000 → 0). Call this wherever a repair's pool
     * application succeeds, with the same RAW bucket the source axis used.
     *
     * ⚠️ GATED on `perRecipientApply` — the guarantee the axis doc leans on is that a legacy
     * single-target run leaves the map EMPTY. Ungated credits here would make it non-empty and break
     * every byte-identical legacy healing result.
     *
     * Only call this where the pool application actually happened. Several sources credit the source
     * axis's RAW bucket for recipients they never repair (a non-heal-target `all-allies` leech share);
     * mirroring those would invent a landing that did not occur.
     */
    const creditLandedRepair = (
        recipientId: string,
        rawBucket: 'directHeal' | 'hotHeal',
        raw: number,
        consumed: number,
        overheal: number
    ): void => {
        if (!healingCtx?.perRecipientApply) return;
        healingCtx.creditRecipient?.(recipientId, rawBucket, raw);
        healingCtx.creditRecipient?.(recipientId, 'effectiveHeal', consumed);
        healingCtx.creditRecipient?.(recipientId, 'overheal', overheal);
    };

    /**
     * #383: mirror a repair onto the per-SOURCE axis (`currentRoundSourceRepair`), keyed by the
     * actor that PERFORMED it. The `runCombat`-local twin of `creditLandedRepair`, with the same
     * three rules — call it wherever a repair's pool application SUCCEEDS, with the same gross
     * `raw` the source bucket used, and only where the application actually happened.
     *
     * ⚠️ GATED on `perRecipientApply` for the same reason the landing axis is: the assembler tells
     * "not measured" (fall back to the `heal-performed` sum) from "measured, none performed" by
     * whether `hp-snapshot.repairPerformed` is present at all, and an ungated credit here would
     * make a legacy healing run look measured when it is not.
     *
     * ⚠️ A HoT TICK MUST NOT CALL THIS (locked ruling R2, #367). Ticking is not performing a
     * repair — the tick books `repairReceived` on its holder and credits no source. If you are
     * adding a credit inside `tickHot`, you are adding the wrong one.
     *
     * Like its twin, this is a closure and not an export: the cast path (playerTurn.ts) and the
     * reactive executor (triggers.ts) live in other modules and reach the same accumulator through
     * `healingCtx.creditPerformed`, which duplicates the flag check inline.
     */
    const creditPerformedRepair = (sourceId: string, raw: number): void => {
        if (!healingCtx?.perRecipientApply) return;
        healingCtx.creditPerformed?.(sourceId, raw);
    };

    // --- Phase 3 reactive triggers ---
    // Intent queues (FIFO), one per side (SP-U U3: merged the former separate `intentQueue` /
    // `enemyIntentQueue` locals into one bySide record). Reactive listeners enqueue follow-up
    // executions; the engine drains them at the drain points. Pure listeners (enqueue only) keep
    // the Phase 1 contract — the executor is the only state mutator.
    const intentQueues: Record<Side, Intent[]> = { player: [], enemy: [] };
    // Per-owner reactive listeners (Task 6): the FOCUS/attacker owner FIRST (zero-churn —
    // its listeners enqueue in the historical order), then every walked team owner in input
    // order. Each owner's guards key on its OWN events; the executor routes the follow-up to
    // the owner's runtime. A legacy team actor (no walk) has no reactive abilities → omitted.
    const reactivePerOwner: { ownerId: string; reactiveAbilities: typeof reactiveAbilities }[] = [
        { ownerId: 'attacker', reactiveAbilities },
        ...teamActors
            .filter((t) => teamRuntimeById.has(t.id))
            .map((t) => ({
                ownerId: t.id,
                reactiveAbilities: teamRuntimeById.get(t.id)!.reactiveAbilities,
            })),
    ];
    // Enemy-side actor ids: every enemy ATTACKER. They walk runPlayerTurn (commit 6c456a14) and
    // emit the full reactive event suite with side === 'enemy'; ally-scoped player listeners MUST
    // treat all of them as non-allies. `seenEnemyAttackerIds` is never empty — the normalization
    // boundary refuses an absent/empty roster (SP-4b-2b).
    //
    // SP-4c-2d dropped an `actorId === enemy.id ||` disjunct here for the dummy wall enemy. It was
    // measured dead before removal: a `console.error` on that disjunct over the whole suite hit
    // ZERO times, because nothing ever asked this predicate about the dummy's id.
    const isEnemySide = (actorId: string): boolean => seenEnemyAttackerIds.has(actorId);
    // Damaged-ally role lookup for role-filtered reactions (Graphite). Roles come from
    // ship data on the healing page (TeamActorInput.role / the focus actor's input.role);
    // built for ALL player actors for uniformity even though in healing mode only the heal
    // target is ever attacked. An actor without a role stays OFF the map → roleOf returns
    // undefined → role-filtered reactions stay dormant for hits on it (conservative).
    // SP-F F5: also seeded from enemyAttackers' own `role` (EnemyActorInput.role) — the map
    // was already side-agnostic BY KEY (any actor id, either side); no enemy caller populated
    // it before this task. Consumed today by Meatshield's defense-substitution gate (via
    // matchesRoleCategory) on EITHER side, in addition to Graphite's existing player-only use.
    const roleByActorId = new Map<string, ShipTypeName>();
    if (input.role) roleByActorId.set(focusActorId, input.role);
    for (const t of teamActors) if (t.role) roleByActorId.set(t.id, t.role);
    for (const e of input.enemyAttackers ?? []) if (e.role) roleByActorId.set(e.id, e.role);
    // SP-F F4: actor id → ship name (mirrors roleByActorId, side-agnostic by key) for the live
    // `ally-on-team` roster check (Isha/Nayra reciprocal Override gate). Only populated when a
    // caller supplies ship names (team sim); left empty in single-ship DPS / manual runs → the
    // gate keeps its assume-met fallback. Threaded into executeIntent's IntentExecContext below.
    const nameByActorId = new Map<string, string>();
    if (input.name) nameByActorId.set(focusActorId, input.name);
    for (const t of teamActors) if (t.name) nameByActorId.set(t.id, t.name);
    for (const e of input.enemyAttackers ?? []) if (e.name) nameByActorId.set(e.id, e.name);
    // #363: `factionByActorId`/`factionOf` (actor id → faction, for `factionFilter`'d ally
    // scopes) is built further up this function, right after `playerIds` — it has to exist
    // BEFORE the attacker/team-actor `registerActorAbilityStatuses` calls and the
    // `buildEnemyPlayerActorRuntime` call, all of which now consult it (site 2/3 of #363's
    // four-site faction-filter sweep). See that construction site's comment for the map's
    // contract (side-agnostic by key, unknown-faction-never-matches).
    // Enemy-side reactive per-owner list (enemy-team PR1): every enemy ATTACKER's own reactive
    // abilities (e.g. Chakara's start-of-round self Attack Up) — before this they were
    // partitioned onto the enemy runtime but never listened for.
    const enemyReactivePerOwner = enemyPlayerRuntimes.map((rt) => ({
        ownerId: rt.actor.id,
        reactiveAbilities: rt.reactiveAbilities,
    }));
    // SP-U U3: one bySide loop replaces the former two separate registerReactiveListeners calls
    // (player unconditional, enemy gated on `enemyReactivePerOwner.length > 0`).
    // registerReactiveListeners holds NO module-level state: it only attaches per-call
    // `bus.on(...)` subscriptions closing over its args, so registering per side independently
    // is safe — a second call adds an independent listener set without disturbing the other
    // side's registration. The length-gate is kept (applies uniformly to both sides here) purely
    // as an early-exit: an empty `perOwner` array already makes registerReactiveListeners a no-op
    // (its body is a single `for (const {..} of perOwner)` loop), so DPS / bare-stat-enemy runs
    // still register nothing on the enemy side (goldens byte-identical); the player side's
    // `perOwner` always has the attacker, so its gate never trips.
    const perOwnerBySide: Record<
        Side,
        { ownerId: string; reactiveAbilities: typeof reactiveAbilities }[]
    > = {
        player: reactivePerOwner,
        enemy: enemyReactivePerOwner,
    };
    for (const side of ['player', 'enemy'] as const) {
        const perOwner = perOwnerBySide[side];
        if (perOwner.length === 0) continue;
        registerReactiveListeners({
            bus,
            perOwner,
            enqueue: (intent) => intentQueues[side].push(intent),
            // Player registration: opposing = enemy-side (isEnemySide). Enemy registration:
            // opposing = player-side, its negation — bySide PR2's per-call isOpposing, so an
            // enemy owner's opposing/ally reactions route against the correct side. Reproduced
            // exactly per side from the pre-merge player/enemy calls.
            isOpposing: side === 'enemy' ? (id: string) => !isEnemySide(id) : isEnemySide,
            roleOf: (id) => roleByActorId.get(id),
            adjacentAllyIdsFor: (ownerId: string) =>
                bySide(isEnemySide(ownerId) ? 'enemy' : 'player').adjacentAllyIdsFor(ownerId),
            // #363: live self-status names for `requireDamagedAllyStatus` (Fuying's "when an ally
            // IN Stealth … is directly damaged"). The SAME closure serves both side
            // registrations: `selfBuffNamesForOwners` keys 'self'-side statuses by the actor's own
            // id and is side-agnostic (the read `isStealthed` and the targeting stealth-filter
            // already share), so an enemy-side Fuying gates on her enemy-side allies' Stealth with
            // no mirrored branch.
            statusNamesOf: (actorId: string) => selfBuffNamesForOwners(statusEngine, [actorId]),
            // #363 Task 9: the owner's ACTIVE support footprint, for the `patternScoped` reactive
            // family's affected-ally gate ("when an ally within the active pattern is directly
            // damaged / has their shield destroyed"). Threaded exactly like `adjacentAllyIdsFor`
            // above — one closure resolving the OWNER's own side, so an enemy-side owner gates on
            // its own side's footprint with no mirrored branch. It is the SAME resolver the
            // recipient-side narrowing (`footprintFilteredRecipients`) already consumes for these
            // abilities, so the two layers can never disagree about who is inside the pattern.
            footprintAllyIdsFor: (ownerId: string) =>
                bySide(isEnemySide(ownerId) ? 'enemy' : 'player').footprintAllyIdsFor(ownerId),
            // D-PR16: owner effective max HP (live ctx ?? base HP) — gates Tenacity's >25% filter.
            // id-keyed and side-agnostic, so the same closure serves both side registrations.
            maxHpOf: (ownerId: string) => recipientMaxHp(ownerId),
        });
    }

    // Owner-routed executor context (Task 6): the executor resolves an intent's owner runtime
    // from this map for per-owner landing gates, charge caps, sourceId, bomb effective-attack.
    const runtimesById = new Map<string, PlayerActorRuntime>([
        ['attacker', attackerRuntime],
        ...teamRuntimeById,
    ]);

    // Every actor's runtime regardless of side. `runtimesById` is PLAYER-side only, which is the
    // right scope for owner-routed player accounting but the wrong one for any per-owner ABILITY
    // scan: a ship carries its kit onto whichever side it is placed. Used by the leech maps and
    // their procs below so an enemy's passive leech is registered and resolvable exactly like a
    // player's. Player entries win a key collision (the focus is keyed 'attacker', so there is
    // none in practice) — same precedence as `runtimeFor`.
    const allRuntimesById = new Map<string, PlayerActorRuntime>([
        ...enemyPlayerRuntimeByActorId,
        ...runtimesById,
    ]);

    // Passive-slot standing leeches per owner (damage-leech spec §4): X% of credited
    // damage repaired/shielded immediately at credit time. Scanned once at setup from each
    // runtime's reactive-partitioned castSkills (passive-slot heal/shield abilities are
    // on-cast, not reactive, so they remain here after partitioning). Healing mode only.
    interface StandingLeech {
        kind: 'heal' | 'shield';
        pct: number;
        target: AbilityTarget;
        noCrit: boolean;
        scope: 'all' | 'detonation';
    }
    const standingLeeches = new Map<string, StandingLeech[]>();
    if (healTarget) {
        for (const [ownerId, rt] of allRuntimesById) {
            const entries: StandingLeech[] = [];
            for (const slot of rt.castSkills.slots) {
                if (slot.slot !== 'passive') continue;
                for (const a of slot.abilities) {
                    const c = a.config;
                    if ((c.type === 'heal' || c.type === 'shield') && c.basis === 'damage-dealt') {
                        entries.push({
                            kind: c.type,
                            pct: c.pct,
                            target: a.target,
                            noCrit: c.type === 'heal' ? (c.noCrit ?? false) : true,
                            scope: c.leechScope ?? 'all',
                        });
                    }
                }
            }
            if (entries.length > 0) standingLeeches.set(ownerId, entries);
        }
    }

    // Passive damage-taken abilities per owner (damage-leech spec §5): each enemy ATTACK on a
    // victim procs that victim's own abilities AFTER the attack's shield-first drain. Sibling
    // shape to the standing leeches above — scanned once at setup from every runtime, keyed by
    // owner id. The non-positional consumption site reads only the heal target's list (enemy
    // attacks land on the heal target in that model), so its behavior is unchanged; the
    // per-owner map prepares the per-victim positional path (Phase-5 follow-up). Healing mode only.
    interface TakenLeech {
        kind: 'heal' | 'shield';
        pct: number;
        noCrit: boolean;
        requiresHpDamage: boolean;
    }
    const takenLeechesByOwner = new Map<string, TakenLeech[]>();
    if (healTarget) {
        for (const [ownerId, rt] of allRuntimesById) {
            const entries: TakenLeech[] = [];
            for (const slot of rt.castSkills.slots) {
                if (slot.slot !== 'passive') continue;
                for (const a of slot.abilities) {
                    const c = a.config;
                    if ((c.type === 'heal' || c.type === 'shield') && c.basis === 'damage-taken') {
                        entries.push({
                            kind: c.type,
                            pct: c.pct,
                            noCrit: c.type === 'heal' ? (c.noCrit ?? false) : true,
                            requiresHpDamage: c.requiresHpDamage ?? false,
                        });
                    }
                }
            }
            if (entries.length > 0) takenLeechesByOwner.set(ownerId, entries);
        }
    }

    // D-PR3: per-actor victim-side incoming-effect abilities (incoming-reduction + incoming-block),
    // side-agnostic (a ship defends on either team). Built once from BOTH runtime maps; empty for
    // actors without the relevant equipment. Consumed today only by the %-reduction fold in the
    // positional path; incoming-block is collected here too for the later block task.
    const incomingAbilitiesById = new Map<string, Ability[]>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        if (incomingAbilitiesById.has(rt.actor.id)) continue; // dedupe if an actor is in both maps
        const incoming: Ability[] = [];
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                // #363: an ALLY-scoped incoming-reduction is NOT a self-effect, so it must not be
                // keyed onto its own carrier here. The second pass below is its sole authority —
                // it is the only place that applies the aura's footprint + faction narrowing, and
                // collecting it here too would hand the carrier an un-narrowed copy (Fuying is
                // Tianchao, so the faction filter would pass, and her Not-Self pattern's exclusion
                // of her own cell would be silently bypassed). Deliberately narrow to
                // 'incoming-reduction': every equipment/skill-text member of the other four
                // families is `target: 'self'`, so nothing else changes.
                if (a.config.type === 'incoming-reduction' && a.target === 'all-allies') continue;
                if (
                    a.config.type === 'incoming-reduction' ||
                    a.config.type === 'incoming-block' ||
                    a.config.type === 'incoming-shield-grant' ||
                    a.config.type === 'damage-reflection' ||
                    // SP-E: Voron/Orel's reactive self-DoT transform, consumed at the
                    // applyVictimDamage funnel below (direct intake only).
                    a.config.type === 'transform-incoming-to-dot'
                ) {
                    incoming.push(a);
                }
            }
        }
        if (incoming.length) incomingAbilitiesById.set(rt.actor.id, incoming);
    }

    // #363 (Fuying): the corpus's first ALLY-scoped incoming reduction — "All Tianchao allies with
    // Stealth take 30% less direct damage". Every other member of this family reduces damage on the
    // CARRIER, so the map above has never needed to fan out: it keys each actor's OWN passive-slot
    // abilities, and the victim-side read (`incomingAbilitiesOf(victim.id)`) therefore never saw a
    // teammate's aura. An ally-scoped aura has to land on the RECIPIENTS' lists instead.
    //
    // Recipients = the carrier's living same-side roster, narrowed by the SAME shared composition
    // every other #363 site uses (`resolveSupportRecipients`: footprint first, then faction):
    //
    //  • FOOTPRINT — the aura carries `patternScoped`, OWNER-RULED 2026-08-22: a Stealthed Tianchao
    //    ally standing OUTSIDE Fuying's active pattern takes FULL damage. `footprintAllyIdsFor`
    //    returns `undefined` for a non-positional / non-support pattern, which per this codebase's
    //    convention means "do not narrow" — so a non-positional fixture still sees the aura.
    //  • FACTION — an actor whose faction is unknown never matches (conservative; the aura can only
    //    under-reach, never over-reach, when faction data is missing).
    //
    // ⚠️ There is NO owner exclusion here, and adding one would be a bug — see
    // `allyScopedIncomingRecipients`'s own doc comment (incomingEffects.ts) for the full owner-
    // inclusion argument; it owns this rule since it sits with the resolver. Short version: Fuying
    // falls out of her own aura's recipient set only because her Not-Self pattern omits her own
    // cell and `self-stealth` never holds true for her, not because of any hardcoded exclusion.
    //
    // The RECIPIENT SET is computed once: positions and patterns are fixed for the fight, and the
    // only dynamic input (which allies are still alive) cannot change an answer that matters — a
    // dead actor takes no damage, so its presence in or absence from the footprint is moot.
    //
    // The OWNER's liveness is emphatically NOT captured here. Each distributed entry records which
    // actor it came from in `allyScopedOwnerByRecipient`, and `incomingAbilitiesOf` filters dead
    // owners out on every read — see `withLiveAllyScopedOwners` for the owner ruling (the aura
    // stops when its carrier dies) and why the filter sits on the LIST accessor rather than inside
    // `incomingReductionForHit`.
    //
    // recipientId → (abilityId → owner actor id). Keyed by ability id to MIRROR
    // `addIncomingAbilityDeduped`'s own id-keyed dedupe: whichever owner won the dedupe race is the
    // owner recorded, so the map can never disagree with the list it annotates.
    const allyScopedOwnerByRecipient = new Map<string, Map<string, string>>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (a.config.type !== 'incoming-reduction') continue;
                if (a.target !== 'all-allies') continue; // self-scoped → handled by the pass above
                const ownerSide = rt.actor.side;
                const recipients = allyScopedIncomingRecipients({
                    ability: a,
                    ownerId: rt.actor.id,
                    livingSameSideIds: actorsBySide(ownerSide)
                        .filter((x) => x.currentHp > 0)
                        .map((x) => x.id),
                    footprintAllyIds: bySide(ownerSide).footprintAllyIdsFor(rt.actor.id),
                    factionOf,
                });
                for (const recipientId of recipients) {
                    const list = incomingAbilitiesById.get(recipientId) ?? [];
                    // #363 item 5: id-keyed dedupe (addIncomingAbilityDeduped) — an actor present
                    // in BOTH runtime maps would otherwise risk two DISTINCT Ability objects for
                    // the same underlying ability contributing twice and doubling the reduction.
                    // Object-identity dedupe (`list.includes(a)`) only caught the narrower case of
                    // the exact same object appearing twice.
                    addIncomingAbilityDeduped(list, a);
                    incomingAbilitiesById.set(recipientId, list);
                    // First writer wins, matching the dedupe above (a second owner offering an
                    // ability with the SAME id never made it into `list`, so it must not claim
                    // ownership of the entry that did).
                    const owners =
                        allyScopedOwnerByRecipient.get(recipientId) ?? new Map<string, string>();
                    if (!owners.has(a.id)) owners.set(a.id, rt.actor.id);
                    allyScopedOwnerByRecipient.set(recipientId, owners);
                }
            }
        }
    }
    // Reads the owner's CURRENT liveness on every call (this closure runs per hit), so a destroyed
    // carrier's aura stops protecting its allies from the moment it dies. Returns the stored array
    // BY REFERENCE for any actor with no ally-scoped entries — i.e. every actor in the corpus's
    // self-scoped incoming families — so that path is byte-identical.
    const incomingAbilitiesOf = (id: string): Ability[] =>
        withLiveAllyScopedOwners(
            incomingAbilitiesById.get(id) ?? [],
            allyScopedOwnerByRecipient.get(id),
            isActorAlive
        );

    // D-PR6: per-actor recipient-side incoming-heal-amplification abilities (Exuberance),
    // side-agnostic (a ship can be a heal recipient on either team). Built once from BOTH runtime
    // maps; empty for actors without the relevant equipment. Consumed by the heal-apply fold (a
    // later task) — nothing reads it yet, so this is byte-identical.
    const incomingHealAmpAbilitiesById = new Map<string, Ability[]>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        if (incomingHealAmpAbilitiesById.has(rt.actor.id)) continue; // dedupe if an actor is in both maps
        const heals: Ability[] = [];
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (a.config.type === 'incoming-heal-amplification') heals.push(a);
            }
        }
        if (heals.length) incomingHealAmpAbilitiesById.set(rt.actor.id, heals);
    }
    const incomingHealAmpAbilitiesOf = (id: string): Ability[] =>
        incomingHealAmpAbilitiesById.get(id) ?? [];

    // D-PR4: per-actor attacker-side outgoing-amplification abilities (Menace/Giant Slayer),
    // side-agnostic (a ship amplifies on either team). Built once from BOTH runtime maps; empty for
    // actors without the relevant equipment. Consumed by the per-victim amplification hook on the
    // positional path.
    const outgoingAbilitiesById = new Map<string, Ability[]>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        if (outgoingAbilitiesById.has(rt.actor.id)) continue; // dedupe if an actor is in both maps
        const outgoing: Ability[] = [];
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (a.config.type === 'outgoing-amplification') {
                    outgoing.push(a);
                }
            }
        }
        if (outgoing.length) outgoingAbilitiesById.set(rt.actor.id, outgoing);
    }
    const outgoingAbilitiesOf = (id: string): Ability[] => outgoingAbilitiesById.get(id) ?? [];

    // SP-F F5 (Meatshield, R4 refit-active passive — APPROXIMATION): per-actor set of ids
    // carrying an active `defense-substitution` passive, side-agnostic (a carrier can be on
    // either team — mirrors incomingAbilitiesById/outgoingAbilitiesById above). Built once from
    // BOTH runtime maps; empty for actors without the ability → substitutedDefenceFor below is a
    // no-op (byte-identical to every existing caller).
    const defenseSubstitutionCarrierIds = new Set<string>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            if (slot.abilities.some((a) => a.config.type === 'defense-substitution')) {
                defenseSubstitutionCarrierIds.add(rt.actor.id);
                break;
            }
        }
    }
    // Wave 4 Task 8 (FrontLine, "While Shielded, it gains 2500 additional Defense"): per-actor
    // flat conditional-defence bonus, keyed by owner id -> flat bonus points. Side-agnostic, built
    // once from BOTH runtime maps, mirroring defenseSubstitutionCarrierIds. The GATE
    // (hasShield(ownerId)) is deliberately NOT checked here — it must be re-evaluated fresh on
    // every substitutedDefenceFor call (hasShield reads the LIVE shieldPool), so the bonus appears
    // the instant the owner holds a shield and reverts the instant it is consumed/expires. Empty
    // for actors without the ability → substitutedDefenceFor's added term is 0 for everyone else
    // (byte-identical to before this task).
    const conditionalDefenceBonusByActorId = new Map<string, number>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (
                    a.config.type === 'conditional-stat' &&
                    a.config.stat === 'defence' &&
                    a.config.condition === 'self-shield'
                ) {
                    conditionalDefenceBonusByActorId.set(rt.actor.id, a.config.flat);
                }
            }
        }
    }
    // Ships whose Protection is consumable (Lionheart R4: "all Protection is removed" after a
    // redirect). Scanned once from both runtime maps, slot-agnostic, mirroring hasAnyProtectionGrant.
    const clearProtectionOnRedirectIds = new Set<string>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        for (const slot of rt.castSkills.slots) {
            if (
                slot.abilities.some(
                    (a) =>
                        a.config.type === 'buff' &&
                        a.config.buffName === 'Protection' &&
                        a.config.clearAllOnRedirect === true
                )
            ) {
                clearProtectionOnRedirectIds.add(rt.actor.id);
                break;
            }
        }
    }
    // Board-level Protection gate: true iff ANY ability on the board grants Protection, OR any
    // actor carries a SCHEDULED Protection self-buff (SelectedGameBuff — the DPS/Healing
    // Calculator's manual "active buffs" input, e.g. protectionAccum in tests; independent of any
    // ability). `selfBuffLookup` (built above from `[...selfBuffs, ...teamActors.flatMap(t =>
    // t.selfBuffs)]`) already indexes every scheduled self-buff by name, so re-using it here is
    // the cheapest correct check for that source. A board-level boolean (not a per-actor carrier
    // Set) is deliberate — Protection can be stolen/transferred onto a ship that carries no grant
    // of its own (deferred mechanic), and the boolean only asserts "Protection is possible here,"
    // which is the gate protectorsFor needs. Scans ALL slots (not just passive, unlike
    // defenseSubstitutionCarrierIds) because Lionheart's round-start grant and a future
    // charge-slot steal are not passive-slot auras.
    const hasAnyProtectionGrant =
        (selfBuffLookup.get('Protection')?.length ?? 0) > 0 ||
        [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()].some((rt) =>
            rt.castSkills.slots.some((slot) =>
                slot.abilities.some(
                    (a) => a.config.type === 'buff' && a.config.buffName === 'Protection'
                )
            )
        );
    // NOTE: neither `hasAnyProtectionGrant` nor `clearProtectionOnRedirectIds` scans
    // `reactiveAbilities` (partitioned out of `castSkills` above) — no ship grants Protection
    // reactively today. If one is added, both gates need a matching branch over the reactive list.
    // Protection damage transfer (deferred mechanic, now consumed). A protector is any living
    // ally that holds >=1 Protection stack; it intercepts a fraction of its allies' direct
    // damage. Side-agnostic by construction (resolves allies via bySide), mirroring
    // defenseSubstitutionCarrierIds. Fastest-first ordering drives the multi-protector cascade.
    const protectorsFor = (victim: CombatActor): { actor: CombatActor; stacks: number }[] => {
        if (!hasAnyProtectionGrant) return [];
        // Protection coverage = ALL living same-side allies (no self-cover), independent of
        // board adjacency. `adjacentAllyIdsFor` narrows to hex-neighbours in positional
        // encounters, which would wrongly shrink coverage — genuinely adjacency-scoped
        // mechanics (Lionheart's pre-combat HP gift, Centurion) keep using it; Protection
        // does not. Behavior-identical to before in non-positional production.
        const allyIds = [...allActorsById.values()]
            .filter((a) => a.side === victim.side && a.currentHp > 0 && a.id !== victim.id)
            .map((a) => a.id);
        const out: { actor: CombatActor; stacks: number }[] = [];
        for (const id of allyIds) {
            if (id === victim.id) continue;
            const actor = allActorsById.get(id);
            if (!actor || actor.currentHp <= 0) continue;
            // Aggregate across ALL status sources (scheduled snapshot + timed + aura/accum ability
            // statuses) — NOT snapshot().activeSelfBuffs alone, which misses aura-granted Protection
            // (real Meatshield / SP-G G1b) and any non-'attacker' owner (the Cheat-Death-detection
            // trap documented below at the Barrier/Cheat-Death read sites).
            const stacks = selfBuffStacksForOwner(statusEngine, id, 'Protection');
            if (stacks > 0) out.push({ actor, stacks });
        }
        out.sort((a, b) => {
            const sa = effectiveStatsOf(statusEngine, selfBuffLookup, a.actor).speed;
            const sb = effectiveStatsOf(statusEngine, selfBuffLookup, b.actor).speed;
            return sb - sa !== 0 ? sb - sa : a.actor.id.localeCompare(b.actor.id);
        });
        return out;
    };
    // "Any direct damage dealt to a non-defender ally that is not transferred by Protection is
    // dealt as if that ally had this Unit's defense." Protection-as-damage-transfer is now
    // IMPLEMENTED (see `protectorsFor` above + the transfer block in `applyVictimDamage`, which
    // peels `redirectFraction × P` off a hit BEFORE this substitution is applied) — so this
    // function only ever substitutes for the NON-TRANSFERRED remainder of a living non-defender
    // ally's damage; the transferred portion is a separate hit re-mitigated on the protector's own
    // defence via `protectionCascade`. Called from EVERY defence-read site (defenseProfileOf, the
    // reactive read, both victimDefenceFor bindings) so every attack type sees the same
    // mitigation — wiring it into only one path would silently diverge across attack types.
    // `fallback` is the site's OWN pre-substitution defence value (raw stats, buffed/effective, or
    // a last-turn-ctx read — whichever that site already computed), so a victim with no applicable
    // carrier is byte-identical to before this task. Multi-carrier tie-break (no known in-game dup
    // case): the HIGHEST effective defence among living, same-side carriers wins.
    const substitutedDefenceFor = (victim: CombatActor, fallback: number): number => {
        if (victim.currentHp <= 0) return fallback; // dead victims are never substituted
        // Wave 4 Task 8 (FrontLine): "While Shielded, it gains 2500 additional Defense" — an
        // ADDITIVE flat bonus on top of whatever defence value this victim would otherwise read
        // (the substitution below, or the site's own fallback), gated live on hasShield(victim.id)
        // so it is re-evaluated fresh on every hit and reverts the instant the shield is consumed
        // or expires. `hasShield` is declared later in this closure (below) but is already
        // initialized by the time this function is actually CALLED (deep in the battle loop) —
        // same closure-ordering convention as every other helper this function reads.
        const conditionalDefenceBonus = conditionalDefenceBonusByActorId.get(victim.id);
        const shieldDefenceBonus =
            conditionalDefenceBonus !== undefined && hasShield(victim.id)
                ? conditionalDefenceBonus
                : 0;
        // DEFENDER victims are never substituted (R4 text: "non-defender ally"). Substitution
        // requires PROVING the victim is a known non-defender role — an unknown/missing role
        // (no role data threaded for this actor) stays dormant (no substitution), matching the
        // codebase's established convention for this exact ambiguity: matchesRoleCategory(undefined,
        // ...) always returns false, so an unknown role can never satisfy "is a non-defender" here
        // either (mirrors Graphite's role-filtered reaction staying dormant on an unknown role —
        // see triggers.ts's forced-targeting/role-filter gates).
        const victimRole = roleByActorId.get(victim.id);
        if (!victimRole || matchesRoleCategory(victimRole, ['DEFENDER'])) {
            return fallback + shieldDefenceBonus;
        }
        let bestDefence: number | undefined;
        for (const carrierId of defenseSubstitutionCarrierIds) {
            if (carrierId === victim.id) continue; // a carrier never substitutes for itself
            const carrier = allActorsById.get(carrierId);
            if (!carrier || carrier.currentHp <= 0 || carrier.side !== victim.side) continue;
            const carrierDefence = effectiveStatsOf(statusEngine, selfBuffLookup, carrier).defence;
            if (bestDefence === undefined || carrierDefence > bestDefence) {
                bestDefence = carrierDefence;
            }
        }
        return (bestDefence ?? fallback) + shieldDefenceBonus;
    };

    // D-PR3: is this actor currently Stealthed? Sibling to isStasised — reads the actor's active
    // self-buff names (snapshot + timed + active ability statuses). 'Stealth' is the buff name the
    // positional targeting stealth-filter also queries (triggers.ts buildForcedTargetingStatus).
    const isStealthed = (actorId: string): boolean =>
        selfBuffNamesForOwners(statusEngine, [actorId]).includes('Stealth');

    // Epic PR12 (C): does the given actor currently carry a live Corrosion or Inferno DoT
    // stack? (Anemone — "takes 25% less direct damage from enemies debuffed with a Damage
    // over Time effect", evaluated against the ATTACKER of an incoming hit.) Sibling to
    // isStealthed/isStasised; reads the DoT containers directly off the CombatActor.
    const attackerHasDot = (actorId: string): boolean => {
        const a = allActorsById.get(actorId);
        return !!a && (a.corrosionEntries.length > 0 || a.infernoEntries.length > 0);
    };
    // Epic PR12 (C): does the given actor currently carry its own "Barrier Recharging"
    // self-status? (Panon — "reduces all incoming damage by 20% when affected by Barrier
    // Recharging.") Local alias kept so this call site's name stays unchanged; the actual
    // lookup now lives in barrierRecharging.ts (shared with triggers.ts's Barrier-grant gate).
    const hasBarrierRecharging = (actorId: string): boolean =>
        holdsBarrierRecharging(statusEngine, actorId);
    // Model-completeness epic (SP-A): does the given actor currently hold an active shield
    // pool? (Malvex — "When Shielded, this Ship takes 10% less damage.") Reads the live
    // absorption pool directly off the CombatActor, mirroring hasBarrierRecharging.
    const hasShield = (actorId: string): boolean =>
        (allActorsById.get(actorId)?.shieldPool ?? 0) > 0;
    // Epic PR12 (C): the given actor's own live HP% (0..100) at this instant, for
    // Tormenter's HP-proportional incoming-reduction scaling. Defaults 100 for an unresolvable
    // actor/zero max HP (inert — no reduction).
    const selfHpPctOf = (actorId: string): number => {
        const a = allActorsById.get(actorId);
        const maxHp = recipientMaxHp(actorId);
        if (!a || maxHp <= 0) return 100;
        return (100 * a.currentHp) / maxHp;
    };
    // SP-E (Orel): does the given actor (the ATTACKER of an incoming hit) currently carry Taunt
    // (a self-buff it granted itself) or Provoke (a debuff placed on it by someone else)? Sibling
    // to attackerHasDot — same "evaluated against the attacker" shape, different status family.
    // An empty/unresolvable actorId (e.g. a DoT-tick batch with no single attacker) resolves via
    // selfBuffNamesForOwners([]) → [] → false, and provokerOf on a nonexistent id → undefined →
    // false — both branches degrade safely to "not gated" without a separate guard.
    const attackerTauntedOrProvoked = (actorId: string): boolean =>
        selfBuffNamesForOwners(statusEngine, [actorId]).includes('Taunt') ||
        provokerOf(statusEngine, actorId) !== undefined;

    // E2 Task 3: PER-VICTIM standing-leech proc for the POSITIONAL apply path.
    //
    // HISTORY: there used to be a second, AGGREGATE proc (`procStandingLeeches`) riding the
    // `creditDamage(... 'direct' ...)` write — but that write is SUPPRESSED for the positional case
    // (the firing-hit damage lands per-victim via applyPositionalDamage, so crediting it again would
    // double-count), so on the positional path NO standing leech fired before E2. E2 restored it
    // here, and #374 DELETED the aggregate proc once it was shown unreachable by construction:
    // every route to `!positional` also zeroes the credited amount, so it could never pay out.
    // THIS IS NOW THE ONLY STANDING-LEECH PROC. It works by
    // running once per FOOTPRINT VICTIM (wired via drivePositionalApply's `onVictimResolved`),
    // leeching off THAT victim's already-role-scaled dealt damage — so origin victims contribute
    // full damage and covered victims contribute half automatically (the caller passes the
    // per-victim `damage`).
    //
    // The entry-level fold is pct → raw → healModifier → heal-crit draw; pool application goes
    // through the Task-1 parametrized closures (applyHealToTarget(raw, actor, repairSourceId) /
    // grantShieldToTarget(raw, actor)), resolving each recipient's actor — so a covered enemy's
    // leech can repair the right ally, not just the heal target. Since #367 task 7 it also folds
    // the RECIPIENT'S incoming-repair channel, applied per `rid` inside the recipient loop (see the
    // block at that line) — a term the deleted aggregate proc never had, which is part of why that
    // proc was not worth keeping alive.
    //
    // TARGET FLAVOURS. `'lowest-hp-ally'` applies to the SELECTED recipient's own pool. `'ally'`
    // answers with the player heal ANCHOR (`[healTarget.id]`) — deliberately NOT the same thing as
    // a cast's `'ally'`, which Task 4 changed to mean the caster's support footprint via
    // `recipientsFor`. That divergence is intentional; `recipientsFor` answers it with
    // the caster's support footprint. That divergence is deliberate and recorded as an OPEN
    // RESIDUAL at the `'ally'` arm below (with the three reasons it was not a drop-in); it belongs
    // to no scheduled task, so do not read this paragraph as a pending deletion. The tests that pin the
    // anchor-only behaviour are named, not line-numbered, in `leech.test.ts`: Test 3
    // "detonation scope: no leech on direct rounds; leech = burst × pct on the burst round" and
    // Test 8 "all-allies: directHeal credited once per recipient (playerIds order)". Note that the
    // aggregate proc is itself UNREACHABLE and tripwired (see its own ⚠️ block) — those two tests
    // exercise THIS per-victim proc.
    //
    // RECIPIENT RESOLUTION: via `allRuntimesById` (NOT allActorsById) — the focus attacker is
    // keyed 'attacker', not its real id. `self` → the acting owner; `ally` → the heal target;
    // `all-allies` → every player id. A recipient with no resolvable runtime actor is credited but
    // not pool-applied (an all-allies leech credits every ally's raw but touches only the pools it
    // can resolve).
    //
    // HEAL-CRIT-GATE CADENCE: this fires once per victim, so a heal-kind leech draws the owner's
    // `activeHealCritGate` ONCE PER VICTIM (an N-victim AoE makes N draws, in footprint order).
    // The perVictimLeech test pins the exact numbers.
    //
    // NO `dmg()`/cumulative accumulator write here (the per-victim apply already landed the HP
    // damage; the aggregate direct credit stays suppressed) → no double-count. Honors `scope` via
    // the `channel` argument: a detonation-scoped leech pays on the `'detonation'` channel (the
    // positional burst) and is skipped on every other channel that reaches this proc — the
    // positional firing hit (`direct`) and, since SP-4b-2b Task 2b, the positional DoT tick.
    //
    // THE LEECH-CHANNEL GAP CLASS'S STATUS AGAINST THIS PROC. It has FOUR instances, and all FOUR
    // now REACH this proc for the outgoing (damage-dealt) direction: the three listed below, plus
    // the passive-slot damage instance, which is documented at its own site (`stagePassiveSlotHit`'s
    // `KNOWN GAPS` block, sub-block (a)) because that is where its apply loop lives. Each entry
    // below also records that same instance's status against the OTHER direction (the
    // damage-taken leech, a different proc — `procTakenLeechesPerVictim`/`procLeechesForVictim`)
    // where the instance correctly does not fire. Fixed items are kept in place, marked, so a
    // reader can see the whole class rather than assume it away:
    //   1. (FIXED in SP-4b-2b Task 2b) the positional per-victim DoT tick — now a caller, see
    //      `procStandingLeechesPerVictim(sourceId, damage, dotType)` at the DoT-tick branch's
    //      `credit`.
    //   2. (FIXED — the positional bomb/accumulator burst) now a caller in BOTH of
    //      `applyPositionedTimedBurst`'s `creditDetonation` callbacks (the `processBombs` one and
    //      the `processAccumulators` one), each passing `channel: 'detonation'`.
    //      STILL TRUE for the OTHER direction: the burst reaches `procTakenLeechesPerVictim`
    //      nowhere, and that is CORRECT rather than a gap — a burst does not proc the victim's
    //      damage-taken leech (owner ruling 2026-08-18; Malvex reads "when directly damaged as a
    //      PRIMARY TARGET"). The sibling "KNOWN GAPS … (a)" block this used to cite for the
    //      "either direction" framing has been corrected on the same grounds — see
    //      `stagePassiveSlotHit`'s `KNOWN GAPS (a)` block, which now carries the same owner ruling.
    //   3. (FIXED — Site 3, spec §3) the HEAL-TARGET DoT tick — its `credit` callback now threads
    //      the applier through to this same proc. It previously discarded `_sourceId` and summed
    //      only into `tankDotDamage`, so nothing could pay. Marked in place at the
    //      `if (tankDotDamage > 0)` branch. This was the instance with no test of its own; see
    //      `positionalDotLeech.test.ts`'s "Site 3" describe block.
    //   4. (FIXED — Site 4, spec §3) the passive-slot damage instance — its apply loop now calls
    //      `procStandingLeechesPerVictim(actor.id, damage, 'direct')` after the `booked > 1e-9`
    //      block. STILL CORRECTLY ABSENT for the other direction: the instance does not proc the
    //      victim's damage-taken leech, since the victim is not its primary target (owner ruling
    //      2026-08-18, spec §2.2) — see `stagePassiveSlotHit`'s `KNOWN GAPS (a)` block.
    const procStandingLeechesPerVictim = (
        sourceId: string,
        amount: number,
        channel: LeechChannel
    ): void => {
        if (!healingCtx || amount <= 0) return;
        const entries = standingLeeches.get(sourceId);
        if (!entries) return;
        const owner = allRuntimesById.get(sourceId);
        if (!owner) return;
        const ownerIsEnemy = owner.actor.side === 'enemy';
        // #424: proc-call scope (every entry, every recipient), not per entry — see the emit below.
        const shieldAcc = new ShieldApplyAccumulator();
        for (const e of entries) {
            // BOTH conjuncts are load-bearing. This copy once kept only the first, which
            // degenerates "a detonation-scoped leech skips non-detonation channels" into "skips
            // everything" — the root cause of the whole four-instance leech-channel class. The
            // `channel` parameter is REQUIRED, not optional: an optional one lets a new call site
            // silently default and re-create the bug.
            if (e.scope === 'detonation' && channel !== 'detonation') continue;
            let raw = amount * (e.pct / 100);
            if (e.kind === 'heal') {
                raw *= 1 + owner.healModifier / 100;
                // One heal-crit draw PER VICTIM (this proc runs per footprint victim).
                if (!e.noCrit && owner.activeHealCritGate(owner.crit / 100)) {
                    raw *= 1 + owner.critDamage / 100;
                }
            }
            // Recipient routing is SIDE-RELATIVE: "allies" means the owner's own side.
            //
            // `ally` (the single designated recipient) is the one arm with no enemy-side
            // equivalent, because it names the PLAYER HEAL ANCHOR — a player-only concept, not
            // "an ally" in any general sense. An enemy owner therefore resolves to NO recipient
            // rather than silently repairing a PLAYER: the same nothing it got before enemy
            // owners were registered at all.
            //
            // SP-4e correction: "no enemy-side equivalent" is no longer a statement about
            // single-recipient ally targeting in general. `lowest-hp-ally` — the selector the
            // ability's own TEXT names (Pallas, Volk, Valkyrie) — IS a single ally target with a
            // symmetric enemy-side answer, because it resolves over the OWNER's own roster on
            // either side. It gets its arm below; only the anchor-flavoured `ally` stays
            // player-only.
            //
            // ⚠️ OPEN RESIDUAL, and NOT a Task-4 deliverable (an earlier draft of this comment
            // promised Task 4 would retire the `ally` arm — it did not, and that promise expired).
            // Task 4 changed what a plain `'ally'` means in `recipientsFor`: the caster's support
            // footprint, on both sides. THIS proc's `ally` arm still says "the player heal anchor,
            // nobody for an enemy owner", so the two now DISAGREE. It was left alone deliberately,
            // for three reasons:
            //   (a) the arm is CORPUS-DEAD. `standingLeeches` is built from passive-slot heal/shield
            //       abilities with basis `'damage-dealt'` that survive the reactive partition, and
            //       the whole corpus contributes exactly TWO, both `self`: Magnolia (heal 40%) and
            //       Valerian (heal 15%) — re-measured over all 149 rows of docs/ship-skills.csv,
            //       SP-4e fix wave 1. (An earlier list also named Malvex and Quixilver: those are
            //       `damage-taken` shields and live in the SIBLING map that feeds
            //       `procTakenLeechesPerVictim`, never here. Valkyrie's ally-facing leech is
            //       `on-own-echoing-burst-detonated` (`on-bomb-detonated` until #345 corrected the
            //       mechanism), hence reactive, and it carries `'lowest-hp-ally'` rather
            //       than a plain `'ally'` — so it would not reach this arm even if it did land in
            //       this map.) Neither ally-facing arm has a live entry today.
            //
            //       RE-MEASURED 2026-08-23 by a SECOND, independent method — every one of the 149
            //       CSV rows built through `buildShipAbilities` and split by
            //       `partitionReactiveAbilities`, enumerating what actually survives into
            //       `castSkills` rather than reading the text. Same answer: passive-slot
            //       `damage-dealt` heals are Magnolia (40%, self) and Valerian (15%, self), full
            //       stop. It also settles Valkyrie explicitly — her two entries come back as
            //       REACTIVE (`on-own-echoing-burst-detonated`, one `self` and one
            //       `lowest-hp-ally`), so they never enter this map and her repair is scaled by the
            //       reactive executor's own incoming-repair fold instead. The corpus's other
            //       `damage-dealt` heals (Iridium, Opal, Pallas, Tithonus) are all ACTIVE-slot and
            //       likewise never enter it.
            //   (b) aligning it needs a footprint route this proc has no access to — it holds no
            //       `supportRecipients` binding.
            //   (c) deleting the arm is NOT a drop-in: control would fall through to the final
            //       `[sourceId]` else-arm, i.e. a self-repair, which is a third answer and the wrong
            //       one.
            // So: no live behaviour rides on it, and closing it is its own task.
            const selectorRecipientId =
                e.target === 'lowest-hp-ally' ? lowestHpAllyIdForOwner(sourceId) : undefined;
            const recipients =
                e.target === 'lowest-hp-ally'
                    ? selectorRecipientId === undefined
                        ? []
                        : [selectorRecipientId]
                    : e.target === 'ally'
                      ? ownerIsEnemy
                          ? []
                          : [healTarget.id]
                      : e.target === 'all-allies'
                        ? ownerIsEnemy
                            ? healingCtx.enemyIds
                            : healingCtx.playerIds
                        : [sourceId];
            for (const rid of recipients) {
                // Resolve the recipient's live actor for the pool application (Task-1 closures
                // take an explicit victim). Runtime maps, not allActorsById: the focus is 'attacker'.
                const recipientActor = allRuntimesById.get(rid)?.actor;
                if (e.kind === 'heal') {
                    // #367 task 7 — THE RECIPIENT'S INCOMING-REPAIR CHANNEL. Owner ruling
                    // (2026-08-23): a leech self-repair IS a repair, so `Inc. Repair Down II` on a
                    // leeching ship halves its leech and an `Inc. Repair Up II` raises it. Before
                    // this line the fold above was `healModifier` + a heal-crit draw and nothing
                    // else, so the channel #367 wired into the cast, HoT and reactive paths reached
                    // every repair channel in the engine EXCEPT the leech ones.
                    //
                    // PER RECIPIENT, not per entry — hence inside this loop rather than beside the
                    // `healModifier` multiply above: the channel belongs to whoever the repair
                    // LANDS on, and an `all-allies` leech lands on a whole side of differently
                    // debuffed ships. `raw` stays the pre-channel amount for the next `rid`.
                    //
                    // HEAL KIND ONLY. A shield GRANT is not a repair (the same line #362 draws at
                    // `grantShieldToTarget`), so the `else` arm below is deliberately untouched.
                    //
                    // `recipientIncomingHealPct` is engine-scope and wraps `liveHealChannelPct` —
                    // the ONE resolution path #367 consolidated (the published ctx's stale
                    // enemy-applied portion subtracted, a live read re-added). A second hand-rolled
                    // resolution here would reintroduce exactly the freshness bug that consolidation
                    // fixed. `incomingHealFactor` floors the multiplier at 0 so a leech suppressed
                    // past -100% lands at 0 rather than crediting a negative gross repair.
                    //
                    // THE SELF-SIDE HALF IS READ FROM THE ACTING TURN, NOT THE MAP (#367 fix wave).
                    // `actingSelfCtx(rid)` returns the acting actor's own `turnCtx` when the
                    // recipient IS that actor — the self leech, i.e. every shipped entry in this map
                    // (Magnolia, Valerian, the Leech gear set; all `target: 'self'`) — and undefined
                    // for anyone else, in which case the map is still the right source and
                    // `liveHealChannelPct` handles its enemy half exactly as before.
                    //
                    // WHY IT WAS NEEDED, MEASURED. `lastTurnCtxByActor.set` sits BELOW the positional
                    // apply that calls this proc on the two player-side branches, so before this the
                    // self-side half came from the actor's PREVIOUS turn: a player-side leecher whose
                    // own kit granted it `Inc. Repair Up III` (+75%) credited 10,000 / 17,500 / 17,500
                    // over three rounds (round 1 blind), and with the same grant lasting 2 turns it
                    // credited 10,000 / 17,500 / 17,500 — the third round a PHANTOM, the status having
                    // already expired. Both profiles now read 17,500 / 17,500 / 17,500 and
                    // 17,500 / 17,500 / 10,000. `leechIncomingRepair.test.ts` section 6 owns both, on
                    // both sides.
                    //
                    // WHICH CHANNEL A USER ACTUALLY REACHES THIS THROUGH — measured, because the
                    // obvious answer is wrong. The only `Inc. Repair Up` in the whole corpus is
                    // MEATSHIELD's self-grant (`Inc. Repair Up III`, 2 turns; 1 occurrence over the
                    // 149 rows of docs/ship-skills.csv, re-swept with a real CSV parser), and
                    // Meatshield can NEVER leech: `buildShipAbilities` gives it ZERO `damage`
                    // abilities on any slot, so a Meatshield wearing the Leech gear set deals nothing
                    // to leech off. No ship grants an `Inc. Repair Up` to an ALLY either. So for a
                    // LEECHING ship the self-side Up arrives only from the calculator's buff picker,
                    // gear, or a pre-fight modifier — all of which are permanent for the fight, which
                    // is why the ROUND-1 half of this fix is the user-visible one (measured: a
                    // picker-set `Inc. Repair Up II` on a leeching focus ship credited
                    // 10,000 / 15,000 / 15,000 before and 15,000 × 3 after) and the EXPIRY half is a
                    // tripwire for the first timed self-side Up that ships.
                    //
                    // STILL STALE BY ONE TURN, deliberately and corpus-inertly: a recipient that is
                    // NOT the acting actor. That is (a) the `all-allies` / `lowest-hp-ally` arms, both
                    // corpus-dead in this map (measured — see the OPEN RESIDUAL block above); (b) the
                    // DoT-tick and detonation call sites, where `sourceId` is the DoT/burst APPLIER
                    // rather than the actor on turn, so `actingSelfCtx` returns undefined unless they
                    // coincide; and (c) the sibling taken-leech proc, whose recipient is the ship
                    // being ATTACKED and therefore never the actor on turn. Closing those needs a
                    // live self-side buff fold outside `runPlayerTurn`, which is a new engine seam,
                    // not a fold.
                    const scaled =
                        raw * incomingHealFactor(recipientIncomingHealPct(rid, actingSelfCtx(rid)));
                    // R10′ (#362): the gross `directHeal` credit moved BELOW the apply so a
                    // reversed repair suppresses it too. An UNRESOLVABLE recipient still credits
                    // gross (unchanged) — nothing was applied there, so nothing was reversed.
                    const applied = recipientActor
                        ? healingCtx.applyHealToTarget(scaled, recipientActor, sourceId)
                        : undefined;
                    if (applied === undefined) {
                        healingCtx.credit(sourceId, 'directHeal', scaled);
                    } else if (!applied.reversed) {
                        healingCtx.credit(sourceId, 'directHeal', scaled);
                        healingCtx.credit(sourceId, 'effectiveHeal', applied.consumed);
                        healingCtx.credit(sourceId, 'overheal', applied.overheal);
                        // Recipient axis (SP-3b Task 7) — this per-victim path repairs whichever
                        // ally it resolved, so the landing id is `rid`, not the heal target.
                        creditLandedRepair(
                            rid,
                            'directHeal',
                            scaled,
                            applied.consumed,
                            applied.overheal
                        );
                        // Source axis (#383) — the LEECHING actor performed this repair, whoever it
                        // landed on. `sourceId`, not `rid`: an `all-allies` leech share repairs an
                        // ally, and the leecher is still the one who did it.
                        creditPerformedRepair(sourceId, scaled);
                    }
                } else {
                    healingCtx.credit(sourceId, 'shield', raw);
                    // #424, sibling arm. CORPUS-DEAD TODAY and wired anyway. Measured 2026-08-29
                    // over all 149 CSV rows: the passive-slot `damage-dealt` entries that reach
                    // this map are Magnolia (heal 40%) and Valerian (heal 15%) — both HEALS, so
                    // nothing shipped enters this `else`. (#424's own text named FrontLine here;
                    // that is wrong. Her 30% damage-dealt shield is an ACTIVE-slot cast rider plus
                    // a reactive `on-enemy-charged` passive, and both of those already emit
                    // through their own accumulators.) It is wired regardless because leaving one
                    // of two sibling arms silent is the precise hand-copied-divergence shape #418
                    // was filed against — the next `damage-dealt` shield to ship must not have to
                    // rediscover this.
                    //
                    // ⚠️ ONE KNOWN GAP, live only if that ship ever ships. The owner's ruling is
                    // ONE ROLL PER ATTACK, and unlike the taken sibling this proc runs once per
                    // VICTIM, so an AoE would emit once per victim rather than once per attack.
                    // Closing that needs an attack-scoped accumulator threaded through
                    // `drivePositionalApply`'s walk, which is a new seam and deliberately not
                    // built for a dead arm. Single-target — every attack in the corpus that could
                    // reach here — is already exactly one emit.
                    if (recipientActor)
                        shieldAcc.add(rid, healingCtx.grantShieldToTarget(raw, recipientActor));
                }
            }
        }
        // ONE event per proc call, keyed on the LEECHER: it is the ship applying the shield, even
        // when an `all-allies` entry lands the pool on someone else. Same gross-attempt gate as
        // the cast sites (#418).
        if (shieldAcc.shouldEmit) {
            bus.emit({
                type: 'shield-applied',
                granterId: sourceId,
                recipientIds: shieldAcc.recipientIds,
                round: currentRound,
                amount: shieldAcc.amount,
                ...shieldAcc.overshieldFields,
                perTarget: shieldAcc.perTarget,
                // No cast behind this grant — see the field's doc in `events.ts`.
                uncast: true,
            });
        }
    };

    // E2 Task 5: PER-VICTIM damage-TAKEN leech proc for the POSITIONAL enemy branch
    // (enemy→player). There used to be a non-positional consumption block crediting ONLY the heal
    // target off the aggregate `damage`, gated by `!enemyPositional` — so on the positional path NO
    // taken leech fired before E2 (each player victim took only its OWN per-victim AoE share, and
    // the heal-target-only single-row credit would have been wrong). E2 restored it here, and #374
    // deleted that block: measurement showed it was never entered on either arm (heal or shield),
    // and no shipped ship even has a heal-kind taken leech (Malvex and Quixilver both grant
    // SHIELDS). THIS IS NOW THE ONLY TAKEN-LEECH PROC. It runs once per FOOTPRINT VICTIM (wired via
    // drivePositionalApply's
    // `onVictimResolved` at the enemy site), procing THAT victim's OWN taken-leeches
    // (takenLeechesByOwner.get(victim.id)) off the per-victim `damage` it took, applying to the
    // victim's OWN pool via the Task-1 closures.
    //
    // SEMANTICS — mirror the non-positional block (~:4025-4060) PER VICTIM:
    //   - Barrier carve-out: skip entirely if the victim was `barriered` (its hit was fully
    //     blocked — no damage taken, nothing to leech). Per victim via `outcome.barriered`.
    //   - requiresHpDamage (Quixilver): only fire an entry with requiresHpDamage when the hit
    //     dealt HP damage PAST shield — per victim via `outcome.shieldBefore > 0 &&
    //     outcome.hpDamage > 0`.
    //   - The leech is off `damage` (the FULL per-victim damage taken — already covered-cell
    //     reduced), NOT the HP portion — matching the non-positional `damage * (e.pct/100)`.
    //   - Same heal/shield fold (pct → raw, healModifier, heal-crit gate/noCrit) and the same
    //     directHeal/effectiveHeal/overheal vs shield bucket split, credited to the victim.
    //
    // ⚠️ THAT MIRROR IS NO LONGER EXACT, as of #367 task 7. A heal-kind leech here additionally
    // folds the VICTIM'S INCOMING-REPAIR channel (`incomingHealFactor(recipientIncomingHealPct)`)
    // — the owner ruled a leech self-repair is a repair, so `Inc. Repair Down` reduces it — and the
    // non-positional block does NOT. Deliberate: that block is executed by no test in the corpus
    // (re-measured 2026-08-23 with an ungated `throw` over the whole 6,414-test suite; it did not
    // fire), and shipping an unverifiable change to unexercised code was ruled out. Its own site
    // carries the matching note. If it is ever made reachable, add the fold there first.
    //
    // HEAL-CRIT-GATE CADENCE: this fires once per victim, so a heal-kind leech draws the
    // victim's `activeHealCritGate` ONCE PER VICTIM (matching procStandingLeechesPerVictim).
    const procTakenLeechesPerVictim = (
        victim: CombatActor,
        damage: number,
        outcome: VictimDamageOutcome
    ): void => {
        if (!healingCtx || damage <= 0) return;
        // Barrier carve-out (per victim): a fully-blocked hit deals no damage taken.
        if (outcome.barriered) return;
        const entries = takenLeechesByOwner.get(victim.id);
        if (!entries) return;
        const rt = allRuntimesById.get(victim.id);
        // #424: scoped to the whole proc call (all entries), not to one entry — see the emit
        // below for the one-roll-per-attack ruling that fixes this scope.
        const shieldAcc = new ShieldApplyAccumulator();
        for (const e of entries) {
            // requiresHpDamage gate (per victim): shield present at hit start AND HP damage dealt.
            if (e.requiresHpDamage && !(outcome.shieldBefore > 0 && outcome.hpDamage > 0)) {
                continue;
            }
            let raw = damage * (e.pct / 100);
            if (e.kind === 'heal' && rt) {
                raw *= 1 + rt.healModifier / 100;
                // One heal-crit draw PER VICTIM (this proc runs per footprint victim).
                if (!e.noCrit && rt.activeHealCritGate(rt.crit / 100)) {
                    raw *= 1 + rt.critDamage / 100;
                }
            }
            if (e.kind === 'heal') {
                // #367 task 7 — the recipient's INCOMING-REPAIR channel, the sibling of the fold
                // in `procStandingLeechesPerVictim` (read its block for the ruling, the reuse
                // argument and the measured staleness note). A damage-TAKEN leech is a self-repair,
                // so the recipient is always `victim` and the channel is always its own — there is
                // no per-recipient loop to sit inside here, unlike the sibling.
                //
                // ⚠️ AND IT IS DEAD CODE FOR THE CURRENT ROSTER — stated here because it was
                // previously stated only in a task report, where the next reader of this line
                // cannot see it. MEASURED 2026-08-23, not reasoned: all 149 rows of
                // `docs/ship-skills.csv` were built through `buildShipAbilities` and split by
                // `partitionReactiveAbilities`, and the passive-slot `basis: 'damage-taken'`
                // abilities that survive into `castSkills` — i.e. everything this map can hold —
                // are exactly MALVEX (15%) and QUIXILVER (25%), and BOTH are `shield`, which this
                // `e.kind === 'heal'` branch never reaches. Nothing in the gear/implant registry
                // adds one either: the only `damage-taken` entry there is Adaptive Plating, also a
                // shield, and also reactive (`on-attacked`) so it never lands in this map at all;
                // the one gear-set LEECH is `basis: 'damage-dealt'` and belongs to the sibling.
                // The same sweep also read the REACTIVE side of the partition, so the claim is not
                // "no cast-path one": NO ship in the corpus repairs for a share of the damage it
                // TAKES on any slot or trigger. The only `damage-taken` abilities anywhere are those
                // two shields.
                //
                // KEPT, NOT DELETED, and for a different reason than the aggregate arm's: this
                // proc's shield branch is very much alive (Malvex and Quixilver run through it
                // every fight), so the site is exercised — only the heal fork is not. A heal-kind
                // `damage-taken` leech is one CSV row away, and the fold has to be here when it
                // arrives, not discovered missing afterwards. The freshness note in the sibling
                // block records what is still one turn stale here, and
                // `leechIncomingRepair.test.ts` section 6 pins that stale profile so it cannot go
                // live unnoticed.
                //
                // A SEPARATE LOCAL, not another `raw *=`, for two reasons. (1) Shape parity with
                // the sibling, where the fold MUST be per-recipient. (2) The `raw *=` chain above
                // is gated on `rt` resolving, and this channel does not depend on a runtime at all
                // — folding it in there would silently skip it for a victim with no runtime entry.
                // Not a claim that the shield arm needed protecting: that arm never enters the
                // chain above either, since it is `e.kind === 'heal' && rt`.
                const scaled = raw * incomingHealFactor(recipientIncomingHealPct(victim.id));
                // R10′ (#362): every bucket, gross included, is booked BELOW the apply and only
                // when the repair was not reversed. This site always applies (the victim is
                // resolved), so there is no third case here.
                const applied = healingCtx.applyHealToTarget(scaled, victim, victim.id);
                if (!applied.reversed) {
                    healingCtx.credit(victim.id, 'directHeal', scaled);
                    healingCtx.credit(victim.id, 'effectiveHeal', applied.consumed);
                    healingCtx.credit(victim.id, 'overheal', applied.overheal);
                    // Recipient axis (SP-3b Task 7): a damage-TAKEN leech repairs its own owner, so
                    // source and recipient coincide here — the axes still differ in meaning.
                    creditLandedRepair(
                        victim.id,
                        'directHeal',
                        scaled,
                        applied.consumed,
                        applied.overheal
                    );
                    // Source axis (#383): same coincidence, same distinction — the victim repaired
                    // ITSELF off the damage it took, so it is credited on both axes.
                    creditPerformedRepair(victim.id, scaled);
                }
            } else {
                healingCtx.credit(victim.id, 'shield', raw);
                // #424: this site now EMITS. The H3.6 comment that stood here declared the
                // silence deliberate ("no shield-application CAST to key on"), and #424 measured
                // what that cost: a damage-taken leech grants a real pool and rolled NOTHING,
                // because `shield-applied` is what drives `on-shield-applied` — the RESONATING
                // FURY implant, which pairs with any hull. OWNER RULING 2026-08-29, from the
                // Quixilver example: a leech-granted shield IS "applying a shield", so the roll
                // happens on that hit. The "no cast to key on" premise was never the right
                // question — the granularity ruling is ONE ROLL PER ATTACK, and this proc runs
                // once per victim per attack, so the attack IS the unit and the accumulator
                // below is its scope.
                shieldAcc.add(victim.id, healingCtx.grantShieldToTarget(raw, victim));
            }
        }
        // ONE event per proc call, i.e. per attack on this victim — never one per entry. A hull
        // carrying two damage-taken shields converts one hit twice, and that is still a single
        // application of shield. Same accumulator, same gross-attempt gate (#418) as all three
        // cast sites: routing the rule through `ShieldApplyAccumulator` rather than a hand-copied
        // `if (granted > 0)` is the whole point of that class existing.
        if (shieldAcc.shouldEmit) {
            bus.emit({
                type: 'shield-applied',
                // A damage-taken leech is a SELF-shield: the victim converts the damage it took,
                // so it is both granter and recipient. Distinct victims of one AoE are distinct
                // GRANTERS and therefore correctly get one event each — the per-attack ruling is
                // per granter, and Resonating Fury is worn by a ship, not by the attack.
                granterId: victim.id,
                recipientIds: shieldAcc.recipientIds,
                round: currentRound,
                amount: shieldAcc.amount,
                ...shieldAcc.overshieldFields,
                perTarget: shieldAcc.perTarget,
                // No cast behind this grant — see the field's doc in `events.ts`.
                uncast: true,
            });
        }
    };

    // BOTH leech directions for one resolved victim, in one place. Every positional attack pays
    // out two independent passives: the ACTOR's damage-dealt standing leech and the VICTIM's
    // damage-taken leech. All three attack sites (focus / walked team / enemy) call exactly this.
    //
    // Deliberately a single helper rather than the two calls hand-written per site: writing them
    // out three times is the very shape that produced the bugs this seam fixes — the enemy site
    // procced only the taken direction and the two player sites only the standing one, so each
    // side ran just one of its two passive leeches. Duplicated call pairs drift; a single one
    // cannot.
    //
    // The two procs act on DISJOINT actors (an actor is never its own victim) and accumulate
    // additively into per-actor maps, so their relative order is not observable — it is fixed
    // here only so no site has to think about it.
    const procLeechesForVictim = (
        actorId: string,
        victim: CombatActor,
        damage: number,
        outcome: VictimDamageOutcome
    ): void => {
        procStandingLeechesPerVictim(actorId, damage, 'direct');
        procTakenLeechesPerVictim(victim, damage, outcome);
    };

    // C2b-2 T5: the id of the actor whose turn is CURRENTLY executing. Set once at the top of
    // each actor's turn (after the dead-actor skips, before any damage is applied), so the
    // DIRECT-damage wrappers can stamp the lethal attacker onto ship-destroyed (Faust reads it
    // in Task 6). NOT used by the DoT-tick batch path (no single killer → byDirectDamage:false).
    // Engine-scope (declared once) but rewritten every turn; the applyVictimDamage closures are
    // rebuilt per round and capture it by reference.
    let actingActorId: string | undefined;

    // Engine-scope mutable round tracker: updated at the top of each round so the
    // buildSideContext closures (defined once outside the loop) can stamp the correct
    // round onto charge-changed events without rebuilding their parent object each round.
    let currentRound = 0;

    // SP-4c-1: the match ends when one side has no living member — the game rule (owner,
    // 2026-08-18): "when there's no more enemies, the match will end mid round, after the turn
    // that kills the last opposing ship ends."
    //
    // READS THE ROSTERS, NOT `actorsBySide`. This mattered while the vestigial dummy `enemy`
    // existed: it was `side: 'enemy'` with billions of HP, so `actorsBySide('enemy')` could never be
    // wiped and this rule would silently never have fired on the enemy side. (Retiring its TURN in
    // SP-4c-2c did not help — it stayed a member of `allActors`/`actorsBySide`, just never
    // scheduled.) SP-4c-2d deleted the actor, and `actorsBySide` is now defined as exactly these two
    // arrays, so the two formulations are the same set; the roster reading is kept because it states
    // the rule directly.
    //
    // KEYED ON `destroyedRound`, NOT ON `currentHp <= 0`. The rule is "the last opposing ship was
    // KILLED", and `recordDestroyed` stamps `destroyedRound` on exactly that event. The two
    // readings come apart on an actor that was NEVER ALIVE — one built with max hp 0, which starts
    // at `currentHp === 0` without ever having been destroyed. That shape is everywhere in the
    // fixture corpus: the focus attacker's `hp` is optional and most direct-engine fixtures omit
    // it (it was unobservable while nothing could kill the focus), and the 0-max-HP "pressure
    // source" roster is a deliberate non-positional trick. Reading `currentHp <= 0` as death
    // declared those sides wiped on turn 1 and ended 346 tests' runs after a single round.
    //
    // A never-alive side is therefore NOT a wipe, and the run continues exactly as before — which
    // is also the honest reading: nothing was killed.
    const sideIsWiped = (): boolean =>
        enemyAttackerActors.every((a) => a.destroyedRound !== undefined) ||
        allPlayerActors.every((a) => a.destroyedRound !== undefined);
    let matchOver = false;

    for (let r = 1; r <= numRounds; r++) {
        // Advance the status engine's round counter (per-round accumulating stacks
        // tick here, before any turn fires). Sources notify via sourceFired in turn.
        currentRound = r;
        statusEngine.beginRound(r);
        // Clear the per-round repaired set HERE (not at the round-started emit) so start-of-round
        // reactive heals fired by that emit correctly count toward THIS round (C2b-3).
        repairedThisRound.clear();
        hitThisRound.clear();
        // SP-G G3 (CodeRabbit): reset the reactive dealt-amount slot each round so a
        // basis:'damage-dealt' shield can never read a stale value from a previous round if its
        // paired reactive-damage proc is gated out (differing procChance/oncePerRound/condition)
        // and applyReactiveDamage never runs — the fallback read then correctly resolves to 0.
        reactiveDealtByOwner.clear();
        // Reset per round so a start-of-round reactive drain (round 2+) stamps duringTurnOf
        // as turn-less (undefined) rather than the previous round's last acting actor.
        actingActorId = undefined;
        // Same reason, same pair: cleared with `actingActorId` so the acting-turn ctx override can
        // never outlive the turn it belongs to (see `actingTurnCtx`).
        actingTurnCtx = undefined;

        // Forced-targeting/stealth lookup for a roster (phase 3). Reads the status engine
        // for each actor's Concentrate Fire / Taunt / Stealth flags so resolvePositionalTarget
        // can redirect or stealth-filter. Identical to phase 2 when no such status is live.
        const statusLookupFor = (roster: CombatActor[]) => {
            const m = buildForcedTargetingStatus(
                statusEngine,
                roster.map((a) => a.id)
            );
            return (id: string) => m.get(id);
        };

        // Combat-start seeding (round 1) for PASSIVE-sourced finite (timed) self-statuses.
        // A player runtime's `enemy-type` gate resolves against the FIGHT-WIDE `input.enemyType`
        // scalar — no per-enemy-attacker class field is plumbed (see the `enemyType: NOT rebuilt`
        // note at the per-victim ctx builder). Before SP-4c-2d that scalar was the deleted dummy
        // enemy's class. Enemy-attacker runtimes face the player heal target (which has no
        // EnemyBaseClass), so their `enemy-type` gate must resolve against undefined.
        if (r === 1) {
            seedPassiveTimedStatuses(
                [...runtimesById.values()],
                statusEngine,
                bus,
                enemyType,
                r,
                factionOf
            );
            seedPassiveTimedStatuses(
                enemyPlayerRuntimes,
                statusEngine,
                bus,
                undefined,
                r,
                factionOf
            );
            // Epic PR4: one-time "at the start of combat" passive shields (Crucialis/FrontLine)
            // — seeded silently ONCE here, never on cast (the cast path skips pre-combat
            // abilities). Same both-collections call shape as the timed seeding above.
            seedPreCombatShields([...runtimesById.values()]);
            seedPreCombatShields(enemyPlayerRuntimes);
        }

        // Selection-based action pool (dynamic-speed turn order, Task 3). Each living actor
        // holds a count of PENDING actions for the round (seeded 1 each; an extra-action grant
        // pushes +1). Team actors listed BEFORE the attacker so the input-order tiebreak yields
        // team → attacker → enemy attackers at equal speeds (selectNextBySpeed requirement — it feeds
        // orderByTurnPriority, whose final tiebreak is this input order). Enemy attackers
        // (healing mode) are appended last in `allActors`; selection reads each actor's LIVE
        // effective speed every step, so a Speed Up/Down applied mid-round reorders the remaining
        // unacted actors automatically (no re-sort hook). Dead actors keep their seeded pending=1
        // — the death-skip below consumes it via a plain `continue` (identical to the old loop
        // visiting then continue-ing).
        //
        // SP-4c-2c dropped the dummy `enemy` from the order (via a `turnOrderActors` filter) and
        // SP-4c-2d deleted the actor, so `allActors` IS the order — every member acts.
        const roundActors = allActors;
        const pending = new Map<string, number>(roundActors.map((a) => [a.id, 1]));
        const pendingOf = (id: string) => pending.get(id) ?? 0;

        // End-of-round action pool (Task 4): "1 extra end of round action" grants (Harvester)
        // land here instead of `pending`. The selection closure drains `pending` (speed-positioned)
        // FIRST and only consults this pool once the normal pool is empty — so end-of-round extra
        // turns fire AFTER every normal-pool action for the round, regardless of the granter's
        // speed-rank. Seeded empty each round (no actor starts with an end-of-round action).
        const endOfRoundPending = new Map<string, number>();
        const endOfRoundPendingOf = (id: string) => endOfRoundPending.get(id) ?? 0;

        // --- Round accumulator, shared by the turn blocks and the post-round assembly.
        // Declared fresh each round (like the old scalar locals). Each actor writes into
        // its own entry; the post-round assembly derives row fields from the focus entry.
        // The helper `dmg(id)` lazily creates entries on first write — actors that never
        // produce damage in a round simply have no entry, keeping the map sparse.
        //
        // E5 §4.5 — CREDIT vs INTAKE are COMPLEMENTARY, not redundant (closing the umbrella
        // spec's "collapse the dual paths" framing). This `roundDamage`/`creditDamage` path is
        // the CREDIT side: damage *dealt*, keyed by SOURCE id, feeding row totals + damage-dealt
        // leeches. The `perActorIncoming`/`intakeFor` path below (~2365) is the INTAKE side:
        // damage *taken*, keyed by VICTIM id, feeding healing-mode rows. They record different
        // facts about the same hit (who dealt it vs who took it); E5 does NOT merge them.
        const roundDamage = new Map<string, ActorDamage>();
        // Per-round per-victim positional damage accumulator (victim actor id → summed damage
        // dealt to it this round). Populated by the positional apply path's emitHit callback (all
        // three attack sites) — and, since #362, by `bookReversalDamage` below, the SECOND writer:
        // a Reversed Repairs burn writes this victim-keyed intake unconditionally, whether or not
        // the debuff's applier is known (see `bookReversalDamage`'s own comment for why an
        // unknown-applier burn still lands here). Stays EMPTY on a round with neither, so the
        // RoundData.perTargetDamage field is set only when non-empty → goldens byte-identical.
        const roundPerTargetDamage = new Map<string, number>();
        // SP-F F1: per-attacker×victim dealt attribution channel — attacker id → victim id →
        // damage dealt THIS round. Mirrors EVERY `roundPerTargetDamage.set` write above with an
        // equal-amount entry keyed to that increment's CORRECT source-attacker (not always
        // `actingActorId` — reflect's source is the reflector, counter's is the counter owner,
        // etc; see the per-site comments at each write) — WITH ONE EXCEPTION, since #362: an
        // applier-less Reversed Repairs burn (the scheduled channel has no caster) writes
        // `roundPerTargetDamage` via `bookReversalDamage` but deliberately skips this map, the same
        // way a redirected DoT-tick chunk with no single attacker does at the Protection-redirect
        // site. Σ over victims for one attacker == that attacker's `damageDealt`; Σ over attackers
        // for one victim == `roundPerTargetDamage` for that victim MINUS any applier-less burns on
        // that victim — so `damageDealt`/`damageTaken` reconcile BY CONSTRUCTION once every site
        // mirrors correctly, short by exactly that one documented gap. Stays EMPTY when
        // roundPerTargetDamage is empty (non-positional rounds), so RoundData.perTargetDealt is set
        // only when non-empty → goldens byte-identical.
        const roundPerTargetDealt = new Map<string, Map<string, number>>();
        const creditDealt = (attackerId: string, victimId: string, amount: number): void => {
            let byVictim = roundPerTargetDealt.get(attackerId);
            if (!byVictim) {
                byVictim = new Map<string, number>();
                roundPerTargetDealt.set(attackerId, byVictim);
            }
            byVictim.set(victimId, (byVictim.get(victimId) ?? 0) + amount);
        };
        // #362 R7′: book a Reversed Repairs burn on this round's accumulators. Reassigns the
        // engine-scope `let` declared above `healingCtx` (which is built before the round loop and
        // therefore cannot see `creditDealt`/`roundPerTargetDamage` directly) — never captured into
        // a copy, so the ctx's closure reads THIS round's accumulators at call time.
        //
        // ALL THREE channels, matching the DoT-tick path (~:9880) — which reaches them by routing
        // through `applyVictimDamage`, and which is the attribution shape R7′ names:
        //   1. `roundPerTargetDamage` — the victim-keyed per-round total (→ `RoundData.perTargetDamage`
        //      → `ShipRoundState.damageTaken`).
        //   2. `creditDealt`          — the per-applier dealt credit (→ `perTargetDealt` →
        //      `ShipRoundState.damageDealt`).
        //   3. `intakeFor(victim).incoming` — the per-victim INTAKE bucket (→ `perActorIncoming` →
        //      `ShipRoundState.incomingDamage` and, through `hpLost`, the HP BAR).
        //
        // (3) was missing for one revision and the omission was NOT cosmetic: `battleSimulator`
        // derives `hpPct` from `maxHp − hpLost + healed`, and `hpLost` accumulates
        // `incoming.incoming − shieldAbsorbed − barrierAbsorbed − convertedToShield` whenever the
        // victim has an intake entry this round (falling back to `damageTaken` only when it has
        // none). A victim that also took an ordinary attack therefore HAS an entry, and the burn
        // vanished from it — the bar read high by exactly the burn, every round, and a ship killed
        // by a reversal rendered as destroyed at a healthy HP%.
        //
        // TDZ NOTE: `intakeFor` is a `const` declared BELOW this assignment in the same round block.
        // Only the closure BODY names it, and the body cannot run until a turn does — long after
        // the whole round block has been evaluated. Same discipline as `creditDealt` above: read
        // through the binding at call time, never hoist a copy.
        //
        // An UNKNOWN applier writes the intake and skips the dealt credit — the same rule, and the
        // same wording, the Protection-redirect site uses for a redirected DoT-tick chunk with no
        // single attacker ("nothing to attribute there, so skip silently; the victim-keyed
        // roundPerTargetDamage write above is unaffected"). The victim demonstrably lost the HP
        // either way; inventing a dealer for it would be the fallback R7′ forbids.
        //
        // ⚠️ KNOWN ASYMMETRY (#362 fix-wave-1): this deliberately does NOT call `creditDamage`
        // (below), the scalar `roundDamage`/`ActorDamage` channel that DPS-mode rows are built
        // from. `ShipRoundState.damageDealt` and `damageTaken` — the BATTLE report's damage
        // numbers — derive from `perTargetDealt`/`perTargetDamage`, which this DOES write, so the
        // battle report's damage columns are complete. What is NOT complete is DPS mode: an
        // applier standing in DPS-mode's focus-ship seat gets a round-total row computed off the
        // scalar channel, so a Zosimos burn is absent from that one row. Not fixed here: wiring
        // `creditDamage` in would need the same consideration `perTargetDealt`'s Task-1 mirroring
        // got (every existing scalar-channel fixture would move), which is outside this pass's scope.
        bookReversalDamage = (victimId, applierId, amount) => {
            if (amount <= 0) return;
            roundPerTargetDamage.set(victimId, (roundPerTargetDamage.get(victimId) ?? 0) + amount);
            // The HP the victim actually lost, on the same bucket an ordinary hit's HP portion
            // lands in. NO `shieldAbsorbed`/`barrierAbsorbed`/`convertedToShield` write: R1 says
            // the burn passes none of those layers, so all of `incoming` is HP loss by construction.
            intakeFor(victimId).incoming += amount;
            if (applierId !== undefined) creditDealt(applierId, victimId, amount);
        };
        // D-PR3: per-victim direct-damage intake index (Ironclad nth-hit) + once-per-round block flags.
        const directIntakeIndex = new Map<string, number>();
        const blockOnceConsumed = new Set<string>(); // key `${victimId}:${abilityId}`
        const dmg = (id: string): ActorDamage => {
            let d = roundDamage.get(id);
            if (!d) {
                d = emptyActorDamage();
                roundDamage.set(id, d);
            }
            return d;
        };
        // Single damage-credit point: every channel write flows through here. It exists for that
        // funnelling alone now — no leech rides this write any more. #374 deleted the aggregate
        // `procStandingLeeches` this used to call, having shown it unreachable by construction
        // (every route to `!positional`, where its two feeds sit, also zeroes the amount).
        // `procStandingLeechesPerVictim` is the only standing-leech proc left, and it is wired at
        // the positional apply sites instead.
        const creditDamage = (sourceId: string, channel: LeechChannel, amount: number): void => {
            dmg(sourceId)[channel] += amount;
            input.__testTapCreditDamage?.(sourceId, channel, amount);
        };
        // ── SP-4b-2 D1: the DIRECT channel's positional twin ──────────────────────────────
        // Per-round, per-attacker direct damage that landed through the POSITIONAL apply, i.e.
        // the exact mirror of the `creditDamage(id, 'direct', …)` writes the positional branches
        // SUPPRESS. There are exactly THREE such writes in this file — the focus cast site, the
        // walked-team cast site and `applyReactiveDamage` — and each sits in an `if (!positional)`
        // / `else` pair with its twin below, so the two channels are MUTUALLY EXCLUSIVE per
        // contribution by construction: nothing can reach both. (The enemy cast site has no
        // scalar direct write at all — `roundDamage` is a player-credit map — so its twin is the
        // enemy side's only direct channel, and it too can only fire on the positional branch.)
        //
        // Why it exists at all: `processAccumulators` (Echoing Burst) gathers "the direct damage
        // the accumulating side dealt this round", and on a positional run the scalar bucket is
        // structurally empty, so the burst detonated for 0 for every user (measured @841e1bc0 vs
        // HEAD, same fixture: 60000 → 0). This is the honest gather input; it is NOT a second
        // accounting channel — `cumulativeDamage`, `perTargetDealt` and the row totals are all
        // untouched by it.
        const roundPositionalDirect = new Map<string, number>();
        const creditPositionalDirect = (sourceId: string, amount: number): void => {
            if (!(amount > 0)) return;
            roundPositionalDirect.set(
                sourceId,
                (roundPositionalDirect.get(sourceId) ?? 0) + amount
            );
        };
        /**
         * Round-to-date DIRECT damage dealt by an EXPLICIT roster, summing BOTH channels.
         *
         * The id list is explicit rather than "everything that is not the other side" on purpose:
         * an inversion is only safe on the player-credit-only scalar map, and this also reads the
         * positional tally, which — like `perTargetDealt`, whose problem `actorsDamagePerRound`
         * in dpsMetricFromDealt.ts solved the same way — is keyed by attacker across BOTH sides.
         * Inverting there would fold the opposing side's output into this side's aggregate.
         *
         * Called at a specific MOMENT in the round (the bursting actor's turn), and both maps are
         * round-scoped, so it reports exactly what that side had dealt so far — the same instant
         * semantics the scalar expression it replaces had.
         */
        const directDealtBy = (roster: readonly CombatActor[]): number =>
            roster.reduce(
                (sum, a) =>
                    sum +
                    (roundDamage.get(a.id)?.direct ?? 0) +
                    (roundPositionalDirect.get(a.id) ?? 0),
                0
            );
        // Healing mode: rebind the per-round healing map (so `credit` writes into THIS round)
        // and snapshot the target's HP%/shield at the ROUND TOP — before any turn. Raw floats;
        // the adapter owns any rounding. No-op in DPS mode (currentRoundHealing stays unread).
        let targetHpPctStart = 0;
        let targetShieldStart = 0;
        // Per-round intake accounting (healing mode): per-actor incoming/shield/barrier buckets,
        // folded into this round's HealingRoundEngine entry at post-round assembly. Enemy attacker
        // turns add to these via the shield-first drain below (`sink` writes intakeFor()).
        // The heal target's row totals (incomingDamage/shieldAbsorbed/barrierAbsorbed) are read off
        // intakeFor(healTarget.id); barrierAbsorbed tracks the total fully blocked by an active
        // Barrier (full damage immunity), kept SEPARATE from shieldAbsorbed (Barrier does NOT drain
        // the shield pool) so the UI can attribute the blocked total to the Barrier, not the shield.
        // Fresh map each round; intakeFor() get-or-creates on first write.
        //
        // E5 §4.5 — this is the INTAKE side (damage *taken*, keyed by VICTIM id); the
        // complementary CREDIT side is `roundDamage`/`creditDamage` (~2331, damage *dealt*,
        // keyed by SOURCE id). Complementary facts, not duplicates — see the note there.
        const perActorIncoming = new Map<string, ActorIntake>();
        const intakeFor = (id: string): ActorIntake => {
            let entry = perActorIncoming.get(id);
            if (!entry) {
                entry = {
                    incoming: 0,
                    incomingRaw: 0,
                    shieldAbsorbed: 0,
                    barrierAbsorbed: 0,
                    convertedToShield: 0,
                };
                perActorIncoming.set(id, entry);
            }
            return entry;
        };
        // Enemy-effects accounting (healing mode, Task 10a): per-enemy self-buffs + the debuffs
        // each enemy lands on the heal target this round, surfaced for the UI's enemy-effects
        // round overview ATTRIBUTED to the source enemy ship. Keyed by the enemy actor id; an
        // entry is created the first time an enemy contributes an effect this round. De-duped by
        // buffName WITHIN each enemy at the post-round push. Empty for a bare/manual enemy → no UI rows.
        const roundEnemyEffects = new Map<
            string,
            {
                selfBuffs: ActiveBuff[];
                debuffs: ActiveBuff[];
                resistedDebuffs: ActiveBuff[];
                resistedDots: EnemyDoTState[];
            }
        >();
        // Display snapshot of the heal target's DoT containers, captured BEFORE the
        // tank's turn-start tickDoTs/expireStacks run.  Merged with the live containers
        // via mergeDoTsForDisplay at end-of-round so that short DoTs (e.g. duration 1)
        // that ticked AND expired in the same round (enemy faster than tank) still appear
        // in enemyEffects[].dots.  Only the display shape is snapshotted (sourceId, tier,
        // stacks); numeric ticking uses the live containers unchanged.  Starts empty
        // every round — mergeDoTsForDisplay's fast-path (snapshot.length === 0) means
        // rounds where the tank never acts (DPS mode, destroyed tank) fall back to live
        // containers automatically, preserving pre-fix behaviour.
        let tankDotSnapshot: {
            corrosion: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[];
            inferno: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[];
        } = { corrosion: [], inferno: [] };
        // The heal target's OWN active self-buffs this round, captured from ITS turn result
        // (whichever branch processes it — focus, walked-team, or the dead-target synthesized
        // focus turn). PlayerTurnResult.activeSelfBuffs is comprehensive for the acting actor, so
        // it includes the target's recurring buffs (Cheat Death / Everliving Regeneration). Take
        // the LAST such turn if the target acts more than once; a destroyed target → []. Surfaced
        // to the UI's Heal Target round overview. NAMES ONLY — never folded into any sim value.
        let healTargetBuffs: ActiveBuff[] = [];
        // Shared incoming-damage intake (healing mode): drains the heal target shield-first
        // (pool before HP), reduces HP, records the destroyed round + emits ship-destroyed once,
        // and folds the totals into the victim's per-actor intake bucket (incoming / shieldAbsorbed
        // via the sink's intakeFor). Returns the
        // shield-before + the post-shield hpDamage the caller needs for any per-attack rider (the
        // taken-leech punch-through gate; hpDamage is 0 under Barrier so the leech reads 0). Both
        // the per-attack enemy intake (below) and the tank DoT-tick intake (turn-start) route
        // through here so the bleed accounting is identical.
        // `victim` defaults to the heal target — the legacy (non-positional) caller passes no
        // arg, so every existing path reads/mutates `healTarget!` exactly as before (byte-
        // identical). The positional enemy-turn path (Task C3) passes the SELECTED player actor
        // so the enemy's incoming drains the actor its parsed target picked. The heal target's
        // death round is read back off its per-actor `destroyedRound` field (stamped by
        // recordDestroyed below) at the result site — no heal-target-gated scalar write here.
        // Shared damage-intake core (Phase 4 PR 1, Task 2): the byte-identical body of the
        // legacy applyIncomingToTarget closure with the four side-specific accounting bits
        // hoisted into `sink`. Everything keyed off `victim` (Barrier full-immunity, shield
        // drain, HP decrement, hp-changed) stays inline here, moved verbatim. Kept inside
        // runCombat — it still captures statusEngine/bus/r/recipientMaxHp/BARRIER_BUFFS/
        // selfBuffNamesForOwners for the Barrier check that remains in this closure. The
        // Cheat-Death intercept and recordDestroyed now live in `resolveLethalHp` (lethalHp.ts)
        // — this closure FORWARDS cheatDeathConsumed/cheatDeathConsumedRound/bus/statusEngine/r
        // to it as opts rather than capturing them for that purpose.
        //
        // Task 3 (combat-log) — deferred reflect log emit. Reflect thorns fire from INSIDE
        // applyVictimDamage. On the POSITIONAL path they run DURING drivePositionalApply, BEFORE
        // the attacker's aggregate `ability-performed` is emitted (emitDeferredAbilityPerformed,
        // post-apply). Emitting the reflect's LOG-ONLY `reactive-damage-performed` inline there
        // would nest it under whatever non-reactive entry already exists in the attacker's turn
        // (e.g. a self charge-gain / self-buff the attacker's active cast emitted BEFORE the
        // attack), not under the attack. So while `deferReflectLogs` is set (⟺ inside
        // drivePositionalApply) we BUFFER the reflect rows and flush them right AFTER
        // emitDeferredAbilityPerformed creates the attack entry, so routeReaction nests them under
        // it. On every NON-deferred path (legacy non-positional apply, where runPlayerTurn already
        // emitted `ability-performed` BEFORE the apply) the flag is false → inline emit, byte-
        // identical, and the attack entry already exists to nest under. NO combat listener
        // subscribes to `reactive-damage-performed` → it can never chain.
        let deferReflectLogs = false;
        /**
         * The sub-attack currently being applied (epic: multi-hit full-walk attacks, PR2 Task 3),
         * or `undefined` outside a positional apply. Set by `drivePositionalApply`'s
         * `applyToVictim` wrapper, which is the ONLY entry point into the funnel during a
         * positional cast, so every row the funnel buffers below can be stamped with the
         * sub-attack that raised it. Needed because the buffers fill during the WHOLE apply (all
         * N sub-attacks) but drain during emission: an untagged flush called once per sub-attack
         * would empty the entire buffer on the FIRST call and nest sub-attack 1..N-1's rows under
         * sub-attack 0's attack row.
         */
        let currentSubAttackIndex: number | undefined;
        const pendingReflectLogs: {
            sourceId: string;
            targetId: string;
            amount: number;
            subAttack?: number;
        }[] = [];
        // Shared LOG-ONLY consequence-event buffer. Carries the log-only twins
        // `shield-destroyed-log` / `cheat-death-log` (NOT the real shield-destroyed /
        // cheat-death-activated events, which emit inline for their combat listeners). NO combat
        // listener subscribes to the twins, so buffering them cannot alter reaction timing.
        // Same defer-flush rationale as pendingReflectLogs above — twins emitted from INSIDE
        // applyVictimDamage during drivePositionalApply must wait until the attack entry exists
        // (post emitDeferredAbilityPerformed) so buildCombatLog's routeReaction nests them under
        // it instead of a preceding sibling entry in the attacker's turn.
        const pendingConsequenceLogs: { ev: CombatEvent; subAttack?: number }[] = [];
        // Flush the log-only consequence twins buffered by an application. Split out of
        // flushReflectLogs so the REACTIVE-damage path can flush consequences alone (it buffers no
        // reflect rows), after its own attack row exists — see `deferConsequenceLogs`.
        //
        // PR2 Task 3: `subAttack` drains ONLY the rows raised by that sub-attack (plus any
        // untagged row, which can only come from a non-positional buffering path), so each
        // sub-attack's twins nest under ITS OWN attack row. Omitted ⟹ drain everything, which is
        // what every non-positional caller (triggers.ts's `ctx.flushConsequenceLogs`) wants and
        // what the positional path's post-loop sweep uses to guarantee nothing leaks into the
        // next turn.
        const flushConsequenceLogs = (subAttack?: number): void => {
            if (pendingConsequenceLogs.length === 0) return;
            const kept: typeof pendingConsequenceLogs = [];
            for (const row of pendingConsequenceLogs) {
                if (subAttack === undefined || row.subAttack === undefined) bus.emit(row.ev);
                else if (row.subAttack === subAttack) bus.emit(row.ev);
                else kept.push(row);
            }
            pendingConsequenceLogs.length = 0;
            pendingConsequenceLogs.push(...kept);
        };
        // A reactive-damage proc (Insidiousness, counters) applies its hit and only THEN emits its
        // own `reactive-damage-performed` log row (triggers.ts emitReactiveDamageLog). Consequence
        // twins raised DURING that application — a Lifeline `shield-applied-log`, a
        // `shield-destroyed-log` — would therefore print ABOVE the attack that caused them, and
        // routeReaction would nest them under whatever entry preceded it. While this flag is set
        // they buffer instead; triggers.ts flushes them via `ctx.flushConsequenceLogs` immediately
        // after the attack row is emitted, so cause precedes consequence.
        let deferConsequenceLogs = false;
        // Install the real emitter for this ROUND now that the deferral flags/buffer/sub-attack
        // index it reads all exist. (This block sits inside the round loop, above the turn loop —
        // the flags and buffer it closes over are per-round state, and every turn of the round
        // shares this one emitter.) Reassigns the engine-scope `let` declared above healingCtx —
        // never captured into a copy — so healingCtx's closures (built before the round loop)
        // read this round's live routing at call time, not the pre-round direct-emit default.
        emitConsequenceLog = (ev: CombatEvent) => {
            if (deferReflectLogs || deferConsequenceLogs)
                pendingConsequenceLogs.push({ ev, subAttack: currentSubAttackIndex });
            else bus.emit(ev);
        };
        // PR2 Task 3: `subAttack` filters exactly as flushConsequenceLogs above — see its note.
        const flushReflectLogs = (subAttack?: number): void => {
            const kept: typeof pendingReflectLogs = [];
            for (const row of pendingReflectLogs) {
                if (
                    subAttack !== undefined &&
                    row.subAttack !== undefined &&
                    row.subAttack !== subAttack
                ) {
                    kept.push(row);
                    continue;
                }
                bus.emit({
                    type: 'reactive-damage-performed',
                    sourceId: row.sourceId,
                    targetId: row.targetId,
                    round: r,
                    amount: row.amount,
                    reactive: true,
                    duringTurnOf: actingActorId,
                    triggerActorId: actingActorId,
                });
            }
            pendingReflectLogs.length = 0;
            pendingReflectLogs.push(...kept);
            flushConsequenceLogs(subAttack);
        };
        const applyVictimDamage = (
            rawDamage: number,
            victim: CombatActor,
            sink: DamageAccountingSink,
            // C2b-2 T5: optional kill attribution stamped onto ship-destroyed. Direct-damage
            // wrappers pass { killerId: actingActorId, byDirectDamage: true }; the DoT-tick batch
            // passes { byDirectDamage: false } (no single killer). No consumer reads these yet
            // (Faust, Task 6), so production stays byte-identical.
            cause?: {
                killerId?: string;
                byDirectDamage?: boolean;
                /** Acting attacker's effective shield penetration % (direct portion only). Default 0. */
                shieldPenetrationPct?: number;
                /** Portion of `rawDamage` that is bomb/detonation damage — drains shield in FULL, no pen. Default 0. */
                bombPortion?: number;
                /** True when THIS application is itself reflected thorns (Reflect gear set). The
                 *  reflection block skips when set → no ping-pong (a reflected hit never reflects). */
                isReflected?: boolean;
                /** G PR1: true when THIS application is a counterattack (Stalwart). The reflect
                 *  re-entry guard skips when set → a counter is never itself reflected (loop-safe). */
                isCounter?: boolean;
                /** Protection transfer: true when THIS application is a redirected Protection
                 *  chunk. The transfer block (Task 4) skips when set → a redirected chunk's own
                 *  cascade was already precomputed, so it never re-triggers (loop-safe). */
                isProtectionTransfer?: boolean;
                /** The DEFENCE mitigation factor the CALLER already folded into `rawDamage` for
                 *  this victim (`victimDefenceMitigation`). Read ONLY by the Protection transfer
                 *  block, which must divide by the exact factor that was applied to recover the
                 *  pre-defence amount. Absent → the block falls back to re-deriving one from the
                 *  victim's live defence (see the fallback's note for what that misses). */
                targetMitigation?: number;
                /** #358 ADDENDUM 2/3: the amount the caller reduced to produce `rawDamage` for this
                 *  victim — pre-defence-mitigation, and (addendum 3) pre EVERY other victim-side
                 *  reduction the caller applied: the `Inc. Damage Down` family, `equipReductionPct`,
                 *  `incomingDotReductionPct`, the reflect channel's incoming-reduction. Recorded on
                 *  the victim's `.incomingRaw` axis alongside `.incoming`, scaled by the Protection
                 *  retention fraction but deliberately NOT by the incoming-block proc (see the
                 *  `damageRaw` block below — a blocked hit was still thrown in full).
                 *  ABSENT means "this path applies NO victim-side reduction whatsoever" (a plain
                 *  DoT tick, a bomb/detonation burst, the flat-basis reactive) and the funnel books
                 *  `rawDamage` on both axes. A DoT tick on a Vortex Veil carrier is NOT such a path
                 *  and must supply this — both tick sites do, and both are pinned (the heal-target
                 *  branch by `defenseSurvivabilitySim.test.ts` channel 6, the per-victim twin by
                 *  `rawIntakeAxis.test.ts` path 8, which went green when it was deleted).
                 *  Never reconstructed by dividing by `targetMitigation` — that is lossy and
                 *  undefined at a factor of 0. */
                preMitigationDamage?: number;
                /** Epic PR12 (A): true when this victim IS the attacker's resolved anchor/primary
                 *  target (Nosorog's `requirePrimaryTarget` reflect gate). Undefined/true for every
                 *  non-positional (inherently single-target) call site; explicitly false only for
                 *  a covered/splash footprint victim. */
                isPrimaryTarget?: boolean;
            }
            // AppliedVictimDamage, not VictimDamageOutcome: this funnel always sets
            // `incomingBooked`, so the booking sites below read it without a fallback.
        ): AppliedVictimDamage => {
            // D-PR3: a hit may be reduced by proc block BEFORE it is recorded/absorbed. `damage`
            // becomes mutable so the block step can shave it; everything downstream (addIncoming,
            // shield drain, hp damage) operates on the post-block value.
            let damage = rawDamage;
            // #358 ADDENDUM 2: the raw (pre-defence) twin of `damage`. `??` — NOT `||` — so a
            // legitimately-zero pre-mitigation figure is honoured instead of falling through.
            let damageRaw = cause?.preMitigationDamage ?? rawDamage;
            // Barrier — FULL DAMAGE IMMUNITY (locked game rule). Hoisted ABOVE addIncoming (it's a
            // pure read of the victim's active self-buffs — moving it earlier is byte-identical) so
            // the block step below can gate on it: a fully-Barrier-immune intake must NOT roll
            // block nor advance the Ironclad nth-hit counter (Barrier already nullifies the hit).
            // While the victim carries an active BARRIER_BUFFS status, ALL incoming damage is fully
            // blocked: direct attacks, DoT ticks, AND bomb detonations (all three funnel here).
            // Precedence: Barrier sits strictly IN FRONT OF both the shield pool AND Cheat Death —
            // so a lethal-sized hit blocked by Barrier neither drains the shield nor triggers the
            // Cheat-Death intercept below. Lifecycle is EITHER duration-based (the normal timed
            // lifecycle) OR hit-counted (the grant's `hits`, spent on a direct hit at the absorb
            // site below) — see barrierBuffs.ts. The damage still "arrives" (the victim's bucket
            // .incoming increments below) but its effect is nullified; the blocked amount is
            // tracked SEPARATELY as the bucket's .barrierAbsorbed (NOT .shieldAbsorbed — Barrier
            // never touches the shield).
            // Detection mirrors the Cheat-Death check in lethalHp.ts (selfBuffNamesForOwners
            // aggregates snapshot + timed + active ability self statuses).
            const carriesBarrier = selfBuffNamesForOwners(statusEngine, [victim.id]).some((n) =>
                BARRIER_BUFFS.has(n)
            );
            // D-PR3: proc block on DIRECT damage only, when not fully Barrier-immune. Reduces the
            // hit before it is recorded/absorbed (silent reduction — no separate surface this PR).
            // Fully inert (no counter touch, no roll) when the victim has no incoming-block ability
            // → byte-identical for every existing fixture.
            if (cause?.byDirectDamage && !carriesBarrier) {
                const blockAbilities = incomingAbilitiesOf(victim.id).filter(
                    (a) => a.config.type === 'incoming-block'
                );
                if (blockAbilities.length > 0) {
                    const idx = (directIntakeIndex.get(victim.id) ?? 0) + 1;
                    directIntakeIndex.set(victim.id, idx);
                    const blocked = incomingBlockForIntake(
                        blockAbilities,
                        {
                            didCrit: false,
                            attackerStealthed: false,
                            victimStealthed: isStealthed(victim.id),
                            victimStasised: isStasised(victim.id),
                            hitIndexThisRound: idx,
                            attackerHasDot: attackerHasDot(cause?.killerId ?? ''),
                            victimHasBarrierRecharging: hasBarrierRecharging(victim.id),
                            victimHasShield: hasShield(victim.id),
                            selfHpPct: selfHpPctOf(victim.id),
                            attackerTauntedOrProvoked: attackerTauntedOrProvoked(
                                cause?.killerId ?? ''
                            ),
                        },
                        (abilityId, chance) => {
                            const cfg = blockAbilities.find((b) => b.id === abilityId)?.config;
                            const onceKey = `${victim.id}:${abilityId}`;
                            // INVARIANT (keep this order): consumed-check BEFORE drawing the gate,
                            // and set consumed ONLY on a successful proc — else a failed early draw
                            // would wrongly lock the round.
                            if (
                                cfg?.type === 'incoming-block' &&
                                cfg.oncePerRound &&
                                blockOnceConsumed.has(onceKey)
                            ) {
                                return false;
                            }
                            let gate = procChanceGates.get(onceKey);
                            if (!gate) {
                                // Keyed by the blocking victim's own id + purpose (SP-0 Task 3) —
                                // `victim.id` is the stable owner of this incoming-block ability.
                                gate = makeRateGate(`${victim.id}:proc`);
                                procChanceGates.set(onceKey, gate);
                            }
                            const proc = gate(chance);
                            if (proc && cfg?.type === 'incoming-block' && cfg.oncePerRound) {
                                blockOnceConsumed.add(onceKey);
                            }
                            return proc;
                        }
                    );
                    damage = damage * (1 - blocked);
                    // #358 ADDENDUM 3 (C2): `damageRaw` is DELIBERATELY NOT scaled here. An
                    // incoming-block proc is a VICTIM-SIDE reduction — the attack was thrown in
                    // full and the defender's ability ate part of it — so it must not shrink the
                    // "damage absorbed" axis. It used to be scaled in lockstep with `damage`,
                    // which made the block ability lower its own owner's headline figure: the same
                    // inversion the defence term and the `Inc. Damage Down` term were each fixed
                    // for, on a third channel. Pinned by the per-channel direction test in
                    // `defenseSurvivabilitySim.test.ts`.
                }
            }
            // Protection damage transfer. A living ally holding Protection stacks intercepts a
            // fraction (10%/stack) of this victim's direct hit. The redirected chunk keeps the
            // ORIGINAL target's affinity/outgoing (both baked into `damage`) and re-mitigates on
            // the PROTECTOR's own defense — realized by the mit-ratio inside protectionCascade.
            // Guards mirror the reflect block: direct damage only, and never a redirected/
            // reflected/counter application (loop-safe).
            // !carriesBarrier: Barrier sits strictly in front of every incoming-effect mechanism
            // (matches the incoming-block step and the transform step) — an invulnerable target
            // has no incoming hit for allies to soak.
            //
            // PR7: how much of this hit a Protection cascade diverted to protectors. Deliberately
            // NOT folded into `incomingBooked` — that is the VICTIM's own booked intake, and the
            // chunk is already booked on each protector's row (the Σ perTargetDealt identity of
            // #293). Reported separately so a sub-attack can reconstruct the FULL amount the attack
            // delivered, which is the locked basis for damage-proportional effects (protector damage
            // + target remainder).
            let protectionRedirected = 0;
            if (
                cause?.byDirectDamage &&
                !carriesBarrier &&
                !cause.isProtectionTransfer &&
                !cause.isReflected &&
                !cause.isCounter &&
                damage > 0
            ) {
                const protectors = protectorsFor(victim);
                if (protectors.length > 0) {
                    // `damage` arrives ALREADY mitigated by the caller's own defence read, and the
                    // cascade recovers the pre-defence amount `P = damage / targetMit` so a
                    // redirected chunk can be re-mitigated on the PROTECTOR's defence instead. So
                    // `targetMit` must be EXACTLY the factor the caller applied — anything else
                    // rescales `P` and skews every chunk.
                    //
                    // The positional apply path (every cast in the sim) therefore hands its own
                    // factor down as `cause.targetMitigation`, computed by the same
                    // `victimDefenceMitigation` that produced the hit. Re-deriving it here instead
                    // drops the attacker's defence PENETRATION (a 50%-pen hit inflated the chunk by
                    // ~7%) — always missing from the re-derivation below, pen or no pen — and,
                    // post-ADDENDUM A2/A5 (#358), can still diverge on an AURA-granted self-defence
                    // buff: `victimDefenseProfileOf`'s `defenceModifierPct` folds all THREE of
                    // `victimSelfBuffs`' self-buff channels (scheduled + timed + aura) for both a
                    // victim's own `Defense Up`/`Overload` and an enemy's `Defense Shred`, while
                    // `effectiveStatsOf(...).defence` below folds only the first two. A SCHEDULED or
                    // TIMED self-defence buff therefore no longer diverges between the two reads (a
                    // +100% Defense buff used to inflate the chunk by ~13% before A2; it no longer
                    // does) — only penetration and an aura-only defence buff can still skew a
                    // re-derived `P` here.
                    //
                    // The fallback below still serves the non-positional direct-damage callers
                    // (bomb/detonation applies, reactive procs), which do not compute a per-victim
                    // profile at all. It is the pre-fix expression, kept byte-identical so those
                    // paths do not move: `substitutedDefenceFor` recovers a defense-substitution
                    // victim's CARRIER defence (Meatshield R4), and is a no-op pass-through to
                    // `victimDef` when no carrier applies. It remains blind to penetration and to
                    // `defenceModifierPct`; closing that would mean threading a profile into those
                    // callers too, which nothing in the corpus currently exercises.
                    const victimDef = effectiveStatsOf(
                        statusEngine,
                        selfBuffLookup,
                        victim
                    ).defence;
                    const targetDef = substitutedDefenceFor(victim, victimDef);
                    const targetMit =
                        cause.targetMitigation ??
                        (targetDef > 0 ? 1 - calculateDamageReduction(targetDef) / 100 : 1);
                    const cascade = protectionCascade(
                        damage,
                        targetMit,
                        protectors.map((p) => ({
                            stacks: p.stacks,
                            mit:
                                effectiveStatsOf(statusEngine, selfBuffLookup, p.actor).defence > 0
                                    ? 1 -
                                      calculateDamageReduction(
                                          effectiveStatsOf(statusEngine, selfBuffLookup, p.actor)
                                              .defence
                                      ) /
                                          100
                                    : 1,
                        }))
                    );
                    // Redirect each protector's chunk BEFORE the victim's own HP is touched.
                    protectors.forEach((p, i) => {
                        const chunk = cascade.chunks[i];
                        if (!chunk || chunk.total <= 0) return;
                        // Apply as `stacks` equal sub-hits (matches the in-game per-stack procs and
                        // sets up the deferred DoT-transform, which acts per redirected chunk).
                        // SP-U U1: `sink` serves both sides (ids are globally unique), so no
                        // per-side selection is needed here.
                        //
                        // `perStackIntake[s]` is sub-hit s's OWN booked intake. Collected rather
                        // than only summed because the log emits ONE row per sub-hit (the player
                        // sees N separate procs in-game — "4643 ×3" is three rows, not one).
                        // Collected DURING the loop but emitted AFTER it, at exactly the point the
                        // single aggregate row used to be emitted, so the event ORDER relative to
                        // everything the sub-hits themselves raise (hp-changed, shield-destroyed,
                        // ship-destroyed, a deferred DoT application) is unchanged — only the row
                        // count and the per-row amount move.
                        let intakeTotal = 0;
                        const perStackIntake: number[] = [];
                        for (let s = 0; s < chunk.stacks; s++) {
                            const outcome = applyVictimDamage(chunk.perStack, p.actor, sink, {
                                killerId: cause.killerId,
                                byDirectDamage: true,
                                isProtectionTransfer: true,
                                shieldPenetrationPct: 0,
                                bombPortion: 0,
                                // #358 ADDENDUM 2: the P-space inflow this chunk was cut from,
                                // BEFORE the protector's own `mit` — read off the cascade, not
                                // recovered by dividing `perStack`.
                                preMitigationDamage: chunk.perStackPreMitigation,
                            });
                            intakeTotal += outcome.incomingBooked;
                            perStackIntake.push(outcome.incomingBooked);
                        }
                        // We sum the intake the funnel RECORDED per sub-hit (`incomingBooked`) rather
                        // than `chunk.total − transformedToDot` — that subtraction wrongly counts a
                        // portion blocked by the protector's own incoming-block ability as damage
                        // taken, when in fact it was neither taken nor transformed. Meatshield's
                        // DoT-transform passive DEFERS the transformed portion to a self-DoT ticked
                        // over the next N rounds (the generic-DoT path books its own
                        // roundPerTargetDamage + .incoming per tick); only the remainder is
                        // credited/logged this round. For a protector without a block/transform
                        // ability, `incomingBooked === chunk.perStack` for every sub-hit, so
                        // `intakeTotal === chunk.total`.
                        //
                        // Was `immediateDamage`, which agrees on both of those but ALSO zeroes a
                        // Barrier-nullified chunk — dropping it from both display channels while the
                        // protector's `barrierAbsorbed` card still showed it, and suppressing the
                        // emission below so nothing in the log explained where that absorption came
                        // from. `.incoming` keeps a barriered amount (netted out downstream against
                        // `barrierAbsorbed`), which is what a DIRECTLY barriered hit books, so this
                        // now matches it.
                        //
                        // In the fully-transformed case a sub-epsilon float sliver can leave
                        // `intakeTotal` at ±~1e-10; the 1e-9 threshold suppresses that phantom
                        // near-zero emission (a real chunk is always >> 1e-9, so this never affects a
                        // genuine remainder).
                        //
                        // The 1e-9 threshold is applied TWICE, deliberately, and the two guards
                        // answer different questions:
                        //   • The OUTER guard (`intakeTotal > 1e-9`, unchanged) still gates the two
                        //     NUMERIC channels — `roundPerTargetDamage` and `creditDealt` — on the
                        //     chunk's TOTAL, so those totals are byte-identical to before. It also
                        //     gates the whole emission block, which is what keeps a fully
                        //     DoT-transformed chunk at ZERO rows.
                        //   • The INNER guard (per row, below) suppresses an individual phantom
                        //     sub-hit. Needed now that rows are per sub-hit: a chunk whose total is
                        //     real but whose s-th sub-hit booked nothing (fully blocked/transformed
                        //     at that sub-hit) would otherwise print a ~0 row that describes no
                        //     damage. It cannot move a numeric total — the totals are summed above
                        //     from every sub-hit, ungated.
                        if (intakeTotal > 1e-9) {
                            protectionRedirected += intakeTotal;
                            roundPerTargetDamage.set(
                                p.actor.id,
                                (roundPerTargetDamage.get(p.actor.id) ?? 0) + intakeTotal
                            );
                            // SP-F F1: this redirected chunk's real source-attacker is the
                            // ORIGINAL hit's killer (cause.killerId), not the protector — the log
                            // sourceId below (victim.id, the protecting wearer) is a DIFFERENT,
                            // reactive-log-only concept (see the audit note §1 row 1). killerId is
                            // absent when the redirected hit originated from a DoT-tick batch (no
                            // single attacker) — nothing to attribute there, so skip silently
                            // (the victim-keyed roundPerTargetDamage write above is unaffected).
                            if (cause.killerId) {
                                creditDealt(cause.killerId, p.actor.id, intakeTotal);
                            }
                            // One LOG-ONLY row per redirected SUB-HIT, each carrying that sub-hit's
                            // own booked intake, so the combat log reads the way the game does (an
                            // N-stack protector shows N procs). Purely a display split:
                            // `reactive-damage-performed` has NO combat listener and feeds only
                            // buildCombatLog's `attack` entry — verified across every consumer
                            // (battleSimulator's LOG_EVENT_TYPES subscription, triggers.ts's
                            // reactive-stamping set, buildCombatLog's handler, and the audit
                            // fingerprint, which reduces entries to a de-duplicated SET of kinds).
                            for (const perStack of perStackIntake) {
                                if (perStack <= 1e-9) continue;
                                bus.emit({
                                    type: 'reactive-damage-performed',
                                    sourceId: victim.id,
                                    targetId: p.actor.id,
                                    round: r,
                                    amount: perStack,
                                    reactive: true,
                                    duringTurnOf: actingActorId,
                                    triggerActorId: actingActorId,
                                });
                            }
                        }
                    });
                    // Lionheart R4: a consumable protector loses ALL Protection after it
                    // redirects a hit. The cascade was precomputed from pre-hit stacks, so THIS
                    // hit already redirected fully; clearing now only affects later hits this
                    // round. `removeSelfBuffByName` zeroes the accumulating stacks (Overload
                    // precedent) → next round's beginRound re-accumulates to maxStacks (=10).
                    // Gate on the protector's OWN chunk having actually redirected something —
                    // a faster protector upstream in the cascade can absorb the hit fully,
                    // leaving THIS protector's chunk at 0 even though it holds Protection stacks;
                    // the kit text ("after taking damage redirected through Protection") only
                    // fires the clear when a redirected chunk was actually taken.
                    protectors.forEach((p, i) => {
                        const chunk = cascade.chunks[i];
                        if (!chunk || chunk.total <= 0) return;
                        if (clearProtectionOnRedirectIds.has(p.actor.id)) {
                            statusEngine.removeSelfBuffByName(p.actor.id, 'Protection');
                        }
                    });
                    // The victim now only takes the non-transferred remainder.
                    damage = cascade.targetRemainder;
                    // Same retention fraction on the raw axis — read off the cascade rather than
                    // derived by dividing `targetRemainder` by the pre-cascade `damage`.
                    damageRaw = damageRaw * cascade.targetRetainedFraction;
                }
            }
            sink.addIncoming(damage, victim.id);
            sink.addIncomingRaw(damageRaw, victim.id);
            // The intake just recorded — post incoming-block, post Protection redirect. Returned as
            // `incomingBooked` (minus any transform reversal below) so every caller that books a
            // per-victim display amount can book the number the funnel actually recorded instead of
            // re-deriving it from the hit it passed in. Captured HERE rather than read back off the
            // sink because the sink is write-only from this side and a nested apply (a redirected
            // Protection chunk, whose recipient is a DIFFERENT actor) may have written to it
            // already.
            const incomingRecorded = damage;
            // SP-E: amount of THIS hit converted into a DoT (Voron/Orel). Reported in the returned
            // outcome so the caller excludes it from the per-victim damage-taken credit.
            let transformedToDot = 0;
            // SP-E: Voron/Orel — "when directly damaged, transforms the damage into a Damage over
            // Time effect lasting N turns". DIRECT INTAKE ONLY (byDirectDamage) — a DoT tick never
            // re-transforms (no recursive conversion). Never fires when Barrier is already
            // nullifying the hit — same precedence the incoming-block step above enforces via its
            // own `!carriesBarrier` guard (Barrier sits strictly in front of every other incoming-
            // effect mechanism; a Barrier-immune hit deals no real damage, so there is nothing to
            // convert). On a match, the FULL post-block direct amount is REPLACED — never drains
            // shield/HP this turn — by a generic self-DoT of `damage / turns` per round for
            // `turns` rounds, credited to the victim itself (sourceId: victim.id, ticked by the
            // existing generic-DoT path both turn-start tick sites already read). Fully inert (no
            // lookup beyond the empty-array default) for every actor without a
            // 'transform-incoming-to-dot' ability → byte-identical for every existing fixture.
            // `bombPortion === 0` (OWNER RULING): "transforms the damage received" on Voron/Orel is
            // specifically DIRECT damage. Bomb detonation damage and bomb-splash damage are
            // DETONATION damage, so neither transforms — a burst and a splash both arrive stamped
            // `byDirectDamage: true` with their whole amount in `bombPortion` (the burst sites'
            // `bombPortion: damage`, the splash site's `bombPortion: splash`), and this clause is
            // what excludes them. Same definition of a direct hit the rest of this funnel uses
            // (`byDirectDamage === true && bombPortion === 0` — the threshold-shield check's
            // `isDirect`, Exposed's consumption guard, and the Hit Mitigation / Shield Converter
            // steps below), which is what now makes this step and its one-shot siblings AGREE about
            // a burst instead of disagreeing.
            //
            // MIXED DIRECT + BOMB HIT: a single apply can carry `byDirectDamage: true` with
            // `0 < bombPortion < damage` (a cast that lands a direct hit AND detonates in the same
            // apply). `bombPortion === 0` is false there, so the whole mixed hit lands untransformed
            // rather than transforming just its direct slice — the same deliberate, conservative
            // consequence of reusing the funnel's `isDirect` definition that the Hit Mitigation step
            // documents, and consistent with it by construction.
            if (
                cause?.byDirectDamage &&
                (cause.bombPortion ?? 0) === 0 &&
                !carriesBarrier &&
                damage > 0
            ) {
                const attackerId = cause?.killerId ?? '';
                const transformAbilities = incomingAbilitiesOf(victim.id).filter(
                    (a) => a.config.type === 'transform-incoming-to-dot'
                );
                if (transformAbilities.length > 0) {
                    const hitCtx: IncomingHitContext = {
                        // didCrit is irrelevant to both Voron ('always') and Orel
                        // ('attacker-taunted-or-provoke') — no crit-gated transform exists in the
                        // corpus, so this mirrors the block step's own unconditioned `false`.
                        didCrit: false,
                        attackerStealthed: isStealthed(attackerId),
                        victimStealthed: isStealthed(victim.id),
                        victimStasised: isStasised(victim.id),
                        hitIndexThisRound: 0, // unused by this condition family
                        attackerHasDot: attackerHasDot(attackerId),
                        victimHasBarrierRecharging: hasBarrierRecharging(victim.id),
                        victimHasShield: hasShield(victim.id),
                        selfHpPct: selfHpPctOf(victim.id),
                        attackerTauntedOrProvoked: attackerTauntedOrProvoked(attackerId),
                        // Meatshield: this hit is a Protection-redirected chunk when the caller
                        // stamped isProtectionTransfer (the per-protector applyVictimDamage below).
                        viaProtectionRedirect: cause?.isProtectionTransfer ?? false,
                    };
                    const transform = transformAbilities.find(
                        (a) =>
                            a.config.type === 'transform-incoming-to-dot' &&
                            conditionMet(a.config.condition, hitCtx)
                    );
                    if (transform && transform.config.type === 'transform-incoming-to-dot') {
                        // The direct hit is REPLACED by the DoT — no shield/HP drain this turn.
                        // convertHitToSelfDot owns the deferral accounting the Hit Mitigation step
                        // below shares; keeping it in one place is what stops the two from drifting.
                        transformedToDot = convertHitToSelfDot(
                            victim,
                            sink,
                            damage,
                            transform.config.turns
                        );
                        // Only zero `damage` on a REAL conversion (see convertHitToSelfDot's
                        // CALLER CONTRACT). `turns` is parser-derived; `detectTransformToDot`
                        // already rejects a non-positive parse so no real ability reaches here
                        // with turns <= 0, but if one ever did, the helper's own guard returns 0
                        // and the hit must fall through to resolve normally rather than vanish.
                        if (transformedToDot > 0) {
                            damage = 0;
                        }
                    }
                }
            }
            // Hit Mitigation ("Blocks the next direct hit, transforming the damage receieved into
            // dot dealt over 3 rounds.", Oleander → all allies) — a NAME-KEYED one-shot sibling of
            // the ability-based transform above. Name-keyed rather than a `parsedEffects` channel
            // because a one-shot block has no honest standing value; see hitMitigation.ts.
            //
            // It repeats the transform step's own three guards for the same reasons:
            //  - `byDirectDamage`: the text says "direct hit", and a DoT tick must never be
            //    re-converted into another DoT (no recursive conversion).
            //  - `!carriesBarrier`: Barrier sits strictly in front of every other incoming-effect
            //    mechanism — a nullified hit deals no real damage, so there is nothing to block and
            //    spending the status on it would waste it.
            //  - `damage > 0`: nothing to convert, so nothing to consume.
            // Plus two of its own, both there because the status is a CONSUMABLE and the sibling
            // step is a free standing passive:
            //  - `bombPortion === 0`: "direct hit" means what the rest of this funnel means by it —
            //    `byDirectDamage === true && bombPortion === 0` (the threshold-shield check's
            //    `isDirect`, and Exposed's own consumption guard). A pure detonation reaches here
            //    stamped `byDirectDamage: true` with the whole amount in `bombPortion`, and burning
            //    a one-shot block on a bomb burst would leave the next real hit unblocked.
            //  - `transformedToDot === 0`: if the Voron/Orel transform already fired it consumed
            //    this hit, and a hit can only be blocked once — the status must survive for a later
            //    one.
            // All five together enforce the Exposed invariant: consume ONLY on a hit that actually
            // READ the block.
            //
            // The `bombPortion === 0` clause used to make the two steps DISAGREE about a bomb
            // burst, because the standing sibling above converted one. RESOLVED (owner ruling,
            // #355): Voron/Orel transform DIRECT damage only, and a bomb burst / bomb splash is
            // DETONATION damage, so the sibling now carries this same clause and the two agree. The
            // reason each one carries it still differs — here it is "never SPEND a one-shot on a
            // hit that did not read it", there it is the magnitude rule — so neither clause should
            // be removed on the strength of the other.
            //
            // MIXED DIRECT + BOMB HIT: a single apply can carry `byDirectDamage: true` with
            // `0 < bombPortion < damage` — a cast that both lands a direct hit and detonates a bomb
            // in the same apply (see the MIXED DIRECT + DETONATE HIT note on the reflect guard
            // below, and the enemy non-positional apply site's `bombPortion: enemyDetonationDamage`).
            // `bombPortion === 0` is false for this case, so this guard skips entirely: the block is
            // NOT consumed (correct — reading `damage` here would spend it on a hit this funnel does
            // not treat as purely direct) but it also does NOT blunt the direct slice — the full
            // mixed `damage` (direct + bomb) lands for real. This is a deliberate, conservative
            // consequence of reusing the funnel's own `isDirect` definition rather than attempting to
            // block just the direct fraction of a mixed hit, and it is consistent with the
            // "consume only on a hit that actually READ the block" invariant above.
            //
            // Deliberately NOT excluded, unlike Exposed's consumption guard further down this
            // funnel, which drops reflected / countered / Protection-transferred hits explicitly:
            // those three genuinely DO read this block. They are real incoming direct damage on this
            // victim and the text is "blocks the next direct hit", so a reflect bouncing back onto
            // the wearer, a counterattack, or a redirected Protection chunk all deserve to be
            // blocked. Exposed excludes them for a reason that does not apply here — none of the
            // three folds the per-victim INCOMING-AMPLIFICATION channel Exposed rides, so spending
            // Exposed on one would charge for an amplification it never received. The difference
            // between the two guards is therefore intentional, not an omission.
            //
            // Hoisted here (single call, shared with the Barrier/Lifeline code below — MINOR 3 of
            // the Shield Converter review): both the Shield Converter branch's cap and the
            // post-transform `maxHp` used further down need the SAME value, and this is the
            // earliest point in the funnel where it is needed.
            const maxHp = recipientMaxHp(victim.id);
            // Set only when the Shield Converter branch below actually fires — the PRE-deposit
            // pool, so the returned `shieldBefore` (shieldWasHit detection at :6406-6411/:8592-8597) reflects
            // the state this hit FOUND, not what its own nullify-and-deposit just grew (IMPORTANT 1
            // of the Shield Converter review). `undefined` for every other hit, meaning "no override
            // — use the real `shieldBefore` captured below".
            let shieldPoolBeforeConversion: number | undefined;
            if (
                cause?.byDirectDamage === true &&
                (cause.bombPortion ?? 0) === 0 &&
                !carriesBarrier &&
                damage > 0 &&
                transformedToDot === 0 &&
                holdsHitMitigation(statusEngine, victim.id)
            ) {
                // Identical deferral accounting to the ability transform above, by construction —
                // see convertHitToSelfDot.
                transformedToDot = convertHitToSelfDot(
                    victim,
                    sink,
                    damage,
                    HIT_MITIGATION_DOT_ROUNDS
                );
                damage = 0;
                consumeHitMitigation(statusEngine, victim.id);
            } else if (
                cause?.byDirectDamage === true &&
                (cause.bombPortion ?? 0) === 0 &&
                !carriesBarrier &&
                damage > 0 &&
                transformedToDot === 0 &&
                holdsShieldConverter(statusEngine, victim.id)
            ) {
                // `Shield Converter` — nullify this direct hit and turn it into Shield.
                //
                // Chained as `else if` onto the Hit Mitigation step above, which is what makes the
                // ordering rule true: ONE HIT SPENDS EXACTLY ONE BLOCK. A victim holding both keeps
                // this one armed for the next hit. The guard is otherwise IDENTICAL to that step's,
                // deliberately - same definition of a direct hit (`byDirectDamage && bombPortion
                // === 0`), same Barrier exclusion, same already-transformed exclusion.
                //
                // ACCOUNTING: `.incoming` is NOT reversed. Hit Mitigation reverses via
                // addIncoming(-damage) only because its damage is DEFERRED and re-books on each DoT
                // tick; a converted hit re-books nowhere, so reversing here would erase the
                // attacker's damage-dealt credit for a hit that genuinely landed. This follows
                // Barrier instead (#293: "Barrier changes the EFFECT, not the accounting"), which
                // keeps the #293 identity holding by construction.
                const nullified = damage;
                const poolBeforeConversion = victim.shieldPool;
                shieldPoolBeforeConversion = poolBeforeConversion;
                // Never SHRINK the pool (MINOR 4 of the review): if a max-HP buff lapsed after an
                // earlier grant, `victim.shieldPool` can already sit above `maxHp` — the same
                // reachable state `grantShieldToTarget` (:2918-2921) documents. `Math.min(pool +
                // nullified, cap)` alone would clamp DOWN to `cap` in that state, destroying shield
                // the victim already held while still crediting the attacker in full via
                // `addConvertedToShield` below. `Math.max(before, …)` floors the result at the
                // pre-deposit pool so a converted hit can only grow the pool, matching Lifeline's
                // own guard at :4346-4348.
                victim.shieldPool = Math.max(
                    poolBeforeConversion,
                    Math.min(poolBeforeConversion + nullified, maxHp)
                );
                // Book the FULL nullified amount regardless of clamping — this channel explains the
                // missing HP damage, not the shield delta (constraint carried over from #293).
                sink.addConvertedToShield(nullified, victim.id);
                damage = 0;
                consumeShieldConverter(statusEngine, victim.id);
                // Third shield source (IMPORTANT 2 of the review, a recurrence of the #277 defect
                // class): credit the REAL post-cap pool growth to the granted accumulator and emit
                // the LOG-ONLY twin, exactly like Lifeline's mid-hit grant below — otherwise
                // `RoundData.perActorShield[id].granted` under-reports, the log shows an unexplained
                // pool jump, and a later hit draining this pool fires `shield-destroyed`/
                // `shield-destroyed-log` reading as "a shield was destroyed that was never granted".
                // Attributed to the VICTIM ITSELF: the attacker did not grant this shield, the
                // victim's own status did — the same self-attribution `convertHitToSelfDot` uses for
                // its converted DoT (`sourceId: victim.id`).
                const grantedFromConversion = victim.shieldPool - poolBeforeConversion;
                if (grantedFromConversion > 0) {
                    perActorShieldGranted.set(
                        victim.id,
                        (perActorShieldGranted.get(victim.id) ?? 0) + grantedFromConversion
                    );
                    const shieldConverterGrantLogEv: CombatEvent = {
                        type: 'shield-applied-log',
                        victimId: victim.id,
                        amount: grantedFromConversion,
                        round: r,
                        reactive: true,
                        duringTurnOf: actingActorId,
                        triggerActorId: actingActorId,
                    };
                    emitConsequenceLog(shieldConverterGrantLogEv);
                }
            }
            // The post-block, non-transformed instant portion of this hit — captured HERE, right
            // after the transform step resolves (transform zeroes `damage` on a match) and BEFORE
            // any shield/HP drain below. For a normal hit (no block/transform/Barrier) this equals
            // the input `damage` argument byte-for-byte; the incoming-block step above is the only
            // thing that can have reduced it by this point. The Protection transfer block sums this
            // per protector sub-hit instead of `chunk.total − transformedToDot`, so a blocked
            // portion is correctly excluded from the instant-damage credit. The Barrier early-return
            // below overrides this to 0 (Barrier nullifies — nothing lands, instant or otherwise).
            const immediateDamage = damage;
            // Capture the pre-drain HP + the target's current effective max HP for the
            // tank-side hp-changed emission below (Phase 4c PR 3). Read BEFORE the drain
            // so oldPct reflects the entering state and a Cheat-Death save's oldPct stays
            // the pre-hit value (not 1).
            const hpBefore = victim.currentHp;
            // `maxHp` is hoisted above the Hit Mitigation / Shield Converter chain (MINOR 3 of the
            // Shield Converter review) — no re-fetch needed here.
            // Barrier branch (carriesBarrier computed above the block step). HP does not move → the
            // emit below is a no-op crossing (oldPct === newPct), still fired once for emission
            // consistency. The damage still "arrives" (the victim's .incoming already incremented)
            // but its effect is nullified; the blocked amount is tracked as .barrierAbsorbed (NOT
            // .shieldAbsorbed — Barrier never touches the shield).
            if (carriesBarrier) {
                sink.addBarrierAbsorbed(damage, victim.id);
                // Hit-counted Barrier: this absorb spends one charge. "for 1 hit" means a DIRECT
                // hit, and the guard spells that out exactly as the funnel's other two consumables
                // do (Hit Mitigation :4271-4272, Shield Converter :4289-4290):
                //  - `byDirectDamage`: a DoT tick is not a hit.
                //  - `bombPortion === 0`: a pure detonation arrives stamped `byDirectDamage: true`
                //    with the whole amount in `bombPortion`, and bomb-death-splash loops once PER
                //    BOMB — burning charges on a burst would leave the next real hit unblocked.
                //    A MIXED direct+bomb apply (0 < bombPortion < damage) also skips: it is not a
                //    hit by this funnel's own definition, so it must not spend either.
                //  - `damage > 0`: a zero-amount intake read nothing, so there is nothing to spend
                //    the charge on.
                // Every case still gets FULL immunity — the guard only decides whether the charge
                // is spent. No-op (returns false) for a turn-duration Barrier, so every existing
                // fixture is byte-identical.
                if (
                    cause?.byDirectDamage === true &&
                    (cause.bombPortion ?? 0) === 0 &&
                    damage > 0
                ) {
                    for (const name of BARRIER_BUFFS) {
                        // True ONLY when the last charge went and the status was removed — the
                        // turn-expiry path (decrementPlayer/decrementEnemy, :8886/:8898) emits the
                        // same event with the same fields, so a hit-consumed Barrier disappears
                        // from the combat log and the round status panel the same way a
                        // turn-expired one does instead of vanishing silently.
                        if (statusEngine.consumeStatusHit(victim.id, name))
                            bus.emit({
                                type: 'buff-expired',
                                actorId: victim.id,
                                round: r,
                                buffName: name,
                            });
                    }
                }
                if (victim.currentHp > 0 && maxHp > 0) {
                    bus.emit({
                        type: 'hp-changed',
                        targetId: victim.id,
                        round: r,
                        oldPct: (100 * hpBefore) / maxHp,
                        newPct: (100 * victim.currentHp) / maxHp,
                    });
                }
                return {
                    shieldBefore: victim.shieldPool,
                    hpDamage: 0,
                    barriered: true,
                    converted: false,
                    // Barrier nullifies the hit's EFFECT but does not un-record it: `.incoming` holds
                    // the amount and an equal `.barrierAbsorbed` nets it back out downstream. So the
                    // display channels book it, exactly as they do for any other barriered hit —
                    // unlike `immediateDamage`, which is 0 here (nothing landed).
                    incomingBooked: incomingRecorded,
                    // Provably always 0 here: this branch is `carriesBarrier === true`, but the
                    // cascade that populates `protectionRedirected` (:4131) is gated on
                    // `!carriesBarrier` and sits upstream of this return, so it never ran. Kept
                    // for shape uniformity with the main `VictimDamageOutcome` return below, not
                    // because this case can populate it.
                    ...(protectionRedirected > 0 ? { protectionRedirected } : {}),
                };
            }
            const shieldBefore = victim.shieldPool;
            // Lifeline (incoming-shield-grant): a PRE-hit threshold shield. When a PURE direct hit
            // (no DoT, no bomb portion) would cross this victim's HP below the configured % of max HP,
            // grant flat + %-of-attack to the pool BEFORE absorbing, so the rest of THIS hit drains
            // shield→HP per the H1 pen rules (the unit can still die). Once per battle. Fully inert
            // (no provisional absorb, no helper call) when the victim carries no such ability →
            // byte-identical for every existing fixture.
            const thresholdShieldAbilities = incomingAbilitiesOf(victim.id).filter(
                (a) => a.config.type === 'incoming-shield-grant'
            );
            if (thresholdShieldAbilities.length > 0) {
                // Provisional absorb against the CURRENT pool → the HP damage the hit would deal pre-Lifeline.
                const provisional = shieldAbsorb({
                    damage,
                    shieldPool: victim.shieldPool,
                    isDot: cause?.byDirectDamage === false,
                    penPct: cause?.shieldPenetrationPct ?? 0,
                    bombPortion: cause?.bombPortion ?? 0,
                });
                const grant = thresholdShieldForHit({
                    abilities: thresholdShieldAbilities,
                    currentHp: victim.currentHp,
                    maxHp,
                    provisionalHpDamage: provisional.hpDamage,
                    effectiveAttack: effectiveStatsOf(statusEngine, selfBuffLookup, victim).attack,
                    isDirect: cause?.byDirectDamage === true && (cause?.bombPortion ?? 0) === 0,
                    alreadyFired: (abilityId) =>
                        thresholdShieldFired.has(`${victim.id}:${abilityId}`),
                });
                if (grant) {
                    // Only ever ADD shield — never shrink a pre-hit pool that already
                    // sits above the current effective max HP (e.g. an HP-down debuff
                    // lowered maxHp after the pool was granted). Clamping the sum alone
                    // would make `granted` negative and could turn a survivable hit lethal.
                    const newPool =
                        shieldBefore >= maxHp
                            ? shieldBefore
                            : Math.min(maxHp, shieldBefore + grant.grant);
                    const granted = Math.max(0, newPool - shieldBefore);
                    victim.shieldPool = newPool;
                    thresholdShieldFired.add(`${victim.id}:${grant.abilityId}`);
                    // Surface the real pool growth on the H1 granted accumulator (StatCard).
                    perActorShieldGranted.set(
                        victim.id,
                        (perActorShieldGranted.get(victim.id) ?? 0) + granted
                    );
                    // LOG-ONLY twin (see the event's doc): this used to be the only shield source
                    // that lands here rather than in a cast / the reactive executor — Shield
                    // Converter above is the second, self-granting the same way for the same
                    // reason — so without it the pool grew with NO log line — while the
                    // `shield-destroyed` emit just below still fired for it, reading as "a shield
                    // was destroyed that was never granted". NOT the real `shield-applied` (that
                    // would fire on-shield-applied listeners from a mid-hit grant).
                    // Buffered/inline on exactly the same condition as `shield-destroyed-log` so it
                    // nests under the triggering attack.
                    if (granted > 0) {
                        const grantLogEv: CombatEvent = {
                            type: 'shield-applied-log',
                            victimId: victim.id,
                            amount: granted,
                            round: r,
                            reactive: true,
                            duringTurnOf: actingActorId,
                            triggerActorId: actingActorId,
                        };
                        emitConsequenceLog(grantLogEv);
                    }
                }
            }
            // SP-F F2 (AEGIS): the pre-absorb pool for the shield-destroyed emit below — read
            // AFTER the Lifeline threshold-shield grant above (NOT the earlier `shieldBefore`,
            // which is deliberately the PRE-Lifeline value other callers rely on) so a shield
            // freshly granted mid-hit by Lifeline and immediately destroyed by the SAME hit still
            // counts as "destroyed" (it went 0 → grant → 0 within this one resolution).
            const shieldBeforeThisAbsorb = victim.shieldPool;
            const { absorbed, hpDamage } = shieldAbsorb({
                damage,
                shieldPool: victim.shieldPool,
                isDot: cause?.byDirectDamage === false,
                penPct: cause?.shieldPenetrationPct ?? 0,
                bombPortion: cause?.bombPortion ?? 0,
            });
            victim.shieldPool -= absorbed;
            sink.addShieldAbsorbed(absorbed, victim.id);
            // AEGIS (SP-F F2): a DIRECT hit that fully depletes a non-empty shield pool. Excludes
            // DoT-tick batches (byDirectDamage:false) — a DoT zeroing a lingering shield is not a
            // "destruction" the game reacts to; a Barrier-blocked hit already returned above and
            // never reaches this line, so it can never false-positive here either.
            if (cause?.byDirectDamage && shieldBeforeThisAbsorb > 0 && victim.shieldPool === 0) {
                // Real event — INLINE for its combat listener (AEGIS on-ally-shield-destroyed).
                // Emitting inline keeps listener enqueue timing byte-identical to pre-log
                // behavior; the LOG-ONLY twin below carries the deferred nesting.
                bus.emit({ type: 'shield-destroyed', victimId: victim.id, round: r });
                const logEv: CombatEvent = {
                    type: 'shield-destroyed-log',
                    victimId: victim.id,
                    round: r,
                    reactive: true,
                    duringTurnOf: actingActorId,
                    triggerActorId: actingActorId,
                };
                emitConsequenceLog(logEv);
            }
            victim.currentHp = Math.max(0, victim.currentHp - hpDamage);
            // At the lethal moment: Cheat-Death intercept, else record the destroy. ONE shared
            // path (`resolveLethalHp`, lethalHp.ts) for the whole engine — the Reversed Repairs
            // reversal (#362) calls the SAME function rather than hand-copying this block, which
            // is the shape that produced the one-directional defects in #306. See lethalHp.ts for
            // the Cheat-Death detection/intercept rationale and the DoT-wipe rules.
            if (victim.currentHp <= 0) {
                // Captured BEFORE resolveLethalHp (which stamps destroyedRound): the destroyed
                // branch can RE-ENTER on a corpse hit, so this gate + the up-front bomb consume
                // make the splash fire once.
                const wasAliveBeforeThisCall = victim.destroyedRound === undefined;
                const outcome = resolveLethalHp(victim, {
                    round: r,
                    statusEngine,
                    cheatDeathConsumed,
                    cheatDeathConsumedRound,
                    bus,
                    emitConsequenceLog,
                    actingActorId,
                    killerId: cause?.killerId,
                    byDirectDamage: cause?.byDirectDamage,
                });
                if (outcome === 'destroyed') {
                    // Bomb-splash-on-death: a ship that dies with un-detonated bombs splashes a
                    // tier-scaled fraction (tier/4%: 100→25,200→50,300→75) of each bomb's damage to
                    // its LIVING same-side adjacent allies (positional only — victim.position gate
                    // enforces this; adjacentAllyIds has an all-allies fallback and does NOT
                    // self-gate, so the position check here is the sole non-positional guard).
                    // NO affinity (bombs aren't affinity-scaled). Bomb-like: full shield drain, no
                    // penetration (bombPortion = full). Credited to the bomb applier (sourceId).
                    // Chains: a splash that kills an adjacent bombed ally re-enters this same
                    // `outcome === 'destroyed'` arm for that ally, firing its splash — naturally finite
                    // (each ship dies once; bombs consumed up-front). Guarded against double-fire on a
                    // second hit to a corpse by (a) the wasAliveBeforeThisCall check and (b) consuming
                    // the bombs before splashing.
                    if (
                        wasAliveBeforeThisCall &&
                        victim.position !== undefined &&
                        victim.pendingBombs.length > 0
                    ) {
                        const bombs = victim.pendingBombs;
                        victim.pendingBombs = []; // consume up-front so a chain re-entry / corpse re-hit won't re-splash
                        const allyIds = bySide(
                            isEnemySide(victim.id) ? 'enemy' : 'player'
                        ).adjacentAllyIdsFor(victim.id);
                        for (const allyId of allyIds) {
                            const ally = allActorsById.get(allyId);
                            if (!ally || ally.destroyedRound !== undefined) continue;
                            for (const bomb of bombs) {
                                const splash = splashDamageForBomb(bomb, bomb.splashModifier);
                                if (splash <= 0) continue;
                                const splashOutcome = applyVictimDamage(splash, ally, sink, {
                                    killerId: bomb.sourceId,
                                    byDirectDamage: true,
                                    bombPortion: splash, // full bomb → full shield drain, no penetration
                                    shieldPenetrationPct: 0,
                                });
                                // perActorSplash stays the FULL splash — it reports what the dying
                                // bomb threw out, the splash counterpart of perActorReflected.
                                perActorSplash.set(
                                    ally.id,
                                    (perActorSplash.get(ally.id) ?? 0) + splash
                                );
                                // The display channels book the intake the funnel RECORDED, so a
                                // splash an ally's incoming-block shaved (or a Protection cascade
                                // diverted onward) is not counted where it never landed.
                                const splashBooked = splashOutcome.incomingBooked;
                                if (splashBooked > 1e-9) {
                                    roundPerTargetDamage.set(
                                        ally.id,
                                        (roundPerTargetDamage.get(ally.id) ?? 0) + splashBooked
                                    );
                                    // SP-F F1: the bomb's original applier (sourceId), not the dying
                                    // bombed ship that splashed.
                                    creditDealt(bomb.sourceId, ally.id, splashBooked);
                                }
                            }
                        }
                    }
                }
            }
            // Tank-side hp-changed (Phase 4c PR 3): ONCE per HP-intake event — this closure
            // is called per enemy attack (aggregate drain) AND per turn-start DoT batch, and
            // the emission covers both deliberately ("when HP drops below N%" includes DoT
            // damage in-game). Emitted after the Cheat-Death intercept (a 100→1-HP save
            // counts as a downward crossing — spec §5). Exact percentages; the other half of a
            // deliberate granularity asymmetry (events.ts) was the enemy dummy's coarse INTEGER
            // post-round emission, which SP-4c-2d deleted with the round-tail HP block.
            // A killed tank emits ship-destroyed above, never a posthumous crossing.
            if (victim.currentHp > 0 && maxHp > 0) {
                bus.emit({
                    type: 'hp-changed',
                    targetId: victim.id,
                    round: r,
                    oldPct: (100 * hpBefore) / maxHp,
                    newPct: (100 * victim.currentHp) / maxHp,
                });
            }
            // D-PR8: record a direct hit for the not-hit-this-round gate. A hit = a direct
            // attack that landed damage on shield or HP (absorbed > 0 || hpDamage > 0). The
            // byDirectDamage guard excludes DoT-tick batches (they pass byDirectDamage:false);
            // fully-Barrier-blocked hits return earlier (barriered:true) and are not recorded.
            // TODO(verify): whether a fully-Barrier-blocked direct attack should count as a hit
            // for Alacrity is unconfirmed in-game; current default is "not a hit".
            if (cause?.byDirectDamage && (absorbed > 0 || hpDamage > 0)) {
                hitThisRound.add(victim.id);
            }
            // Reflect gear set (Task 5): thorns. When a Reflect wearer takes a DIRECT hit that
            // dealt net HP damage, reflect Σpct% of that net HP damage back at the attacker —
            // mitigated by the attacker's affinity matchup (wearer is the source of the reflected
            // hit), defence, and incoming-reduction. Applied via a RECURSIVE applyVictimDamage with
            // isReflected:true so it (a) drains the attacker's shield→HP per the H1 rules, (b) runs
            // its own death handling (a reflected kill records the destroy + fires on-death FOR
            // FREE — recordDestroyed above), and (c) does NOT itself reflect (the isReflected guard
            // below skips). applyVictimDamage emits NO attacked/reaction events (those live in the
            // turn/wrapper layer), so reflection neither re-triggers reactions nor ping-pongs.
            //
            // GUARDS (any → skip): a reflected application (no ping-pong); no net HP damage; a DoT
            // tick (byDirectDamage === false); the victim has no damage-reflection ability. Fully
            // inert (no helper calls) for every fixture without REFLECT equipment → byte-identical.
            //
            // MIXED DIRECT + DETONATE HIT: a single apply can carry damage = directDamage +
            // detonationDamage with byDirectDamage:true AND bombPortion > 0 (a cast that both lands a
            // direct hit and detonates a bomb in the same hit — see the enemy-aggregate apply site).
            // The bomb portion never reflects (bombs full-drain, no reflect); the direct portion does.
            // We split the net HP damage proportionally by the RAW direct fraction of the post-block
            // total (`damage`). This is an intentional approximation: shieldAbsorb mixes the direct
            // and bomb slices into a single hpDamage, so we cannot recover the exact direct HP loss —
            // we apportion it by raw fraction. Pure-direct (bombPortion 0) → fraction 1 → full
            // hpDamage (byte-identical to the pre-split behavior). Pure-bomb (bombPortion === total)
            // → fraction 0 → basis 0 → skip (no reflect).
            //
            // KILLING-BLOW NOTE: no guard on victim.destroyedRound — if the hit that killed the
            // wearer also triggers reflection, the thorns still fire (hit landed before death).
            // The attacker.destroyedRound guard below prevents posthumous reflection TO an
            // already-dead attacker, but the WEARER dying on the same hit is intentional and
            // covered by test case (e).
            // !cause?.isCounter is loop-safe: a counter application must not itself be reflected.
            if (
                !cause?.isReflected &&
                !cause?.isCounter &&
                hpDamage > 0 &&
                cause?.byDirectDamage !== false
            ) {
                // Direct slice of the net HP damage: exclude the bomb portion by the raw direct
                // fraction of the post-block total. bombPortion 0 → directFraction 1 (full reflect);
                // bombPortion === total → directFraction 0 → basis 0 → skipped below.
                const totalRaw = damage;
                const bombPortion = cause?.bombPortion ?? 0;
                const directFraction =
                    totalRaw > 0 ? Math.max(0, (totalRaw - bombPortion) / totalRaw) : 0;
                const reflectBasis = hpDamage * directFraction;
                // Epic PR12 (A): a requirePrimaryTarget reflect ability (Nosorog) only fires when
                // this victim was the attacker's anchor — excluded for a covered/splash footprint
                // victim (cause.isPrimaryTarget === false). Undefined/true (every non-positional
                // call site, and every requirePrimaryTarget-less ability e.g. Reflect gear set)
                // keeps it included — byte-identical there.
                //
                // NIT 4 (latent-safety): the `undefined → treated as primary` default is correct
                // ONLY because every real-roster AoE path today is POSITIONAL — applyPositionalDamage
                // threads isAnchor → applyIncomingToTarget/applyOutgoingToEnemy → isPrimaryTarget, so
                // a covered victim always gets an explicit `false`. The remaining undefined callers are
                // all inherently SINGLE-target (the legacy non-positional applyIncomingToTarget binds
                // one victim, which IS the primary). A FUTURE non-positional real-roster AoE path would
                // have to pass isPrimaryTarget explicitly, or a covered victim would wrongly reflect.
                //
                // NIT 2 (reactive paths do not over-fire): a Nosorog taking REACTIVE damage does NOT
                // reflect, by construction — (a) counterattacks reach applyVictimDamage with
                // isCounter:true, which the `!cause?.isCounter` guard above skips entirely; and (b) the
                // reactive-damage executor (applyReactiveDamage) reaches applyVictimDamage under that
                // SAME isCounter:true flag when it has a real positioned victim, and is credit-only
                // (creditDamage, never reaching this block at all) otherwise. Detonation/
                // bomb reactive hits pass bombPortion===total → directFraction 0 → reflectBasis 0 (no
                // reflect); DoT ticks pass byDirectDamage:false (guard above). So no reactive path
                // leaves isPrimaryTarget undefined in a way that could wrongly reflect — no code change
                // needed (see the PR12 review report for the full call-site enumeration).
                const reflectAbilities =
                    reflectBasis > 0
                        ? incomingAbilitiesOf(victim.id).filter(
                              (a) =>
                                  a.config.type === 'damage-reflection' &&
                                  (!a.config.requirePrimaryTarget ||
                                      cause?.isPrimaryTarget !== false)
                          )
                        : [];
                if (reflectAbilities.length > 0) {
                    const reflectPct = reflectAbilities.reduce(
                        (sum, a) =>
                            sum + (a.config.type === 'damage-reflection' ? a.config.pct : 0),
                        0
                    );
                    const attacker = allActorsById.get(cause?.killerId ?? '');
                    // Skip a missing attacker, self-damage (victim === attacker), and an
                    // already-destroyed attacker (no posthumous reflection).
                    if (
                        attacker &&
                        attacker.id !== victim.id &&
                        attacker.destroyedRound === undefined
                    ) {
                        // The WEARER (victim) is the source of the reflected hit → affinity is
                        // resolved wearer→attacker (computeAffinityModifiers(victim, attacker)).
                        const affinityDamageModifier = computeAffinityModifiers(
                            victim.affinity,
                            attacker.affinity
                        ).damageModifier;
                        const attackerDefence = effectiveStatsOf(
                            statusEngine,
                            selfBuffLookup,
                            attacker
                        ).defence;
                        const attackerDefenceReductionPct =
                            attackerDefence > 0 ? calculateDamageReduction(attackerDefence) : 0;
                        // Attacker's incoming-reduction against the reflected (direct) hit. Minimal
                        // ctx: no crit/stealth, direct scope (dotType undefined). Returns 0 for an
                        // attacker with no incoming-reduction ability → matches the duel-fit default.
                        const reflectVictimIncomingReductionPct = incomingReductionForHit(
                            incomingAbilitiesOf(attacker.id),
                            {
                                didCrit: false,
                                attackerStealthed: false,
                                victimStealthed: false,
                                victimStasised: false,
                                hitIndexThisRound: 0,
                                // The reflected hit's "attacker" is the reflector (victim, outer
                                // scope) and its "victim" is `attacker` (receiving the bounce-back).
                                attackerHasDot: attackerHasDot(victim.id),
                                victimHasBarrierRecharging: hasBarrierRecharging(attacker.id),
                                victimHasShield: hasShield(attacker.id),
                                selfHpPct: selfHpPctOf(attacker.id),
                                // No 'transform-incoming-to-dot' ability reads the reflect ctx
                                // (Voron/Orel's own incoming-reduction, not the reflected hit's
                                // reduction) — default false, mirroring the pattern above.
                                attackerTauntedOrProvoked: false,
                            }
                        );
                        // ONE evaluation, both axes (#358 addendum 3, carried finding 9) — the
                        // pre-defence twin used to be a hand-copied second function.
                        const { damage: reflected, preMitigation: reflectedPreMit } =
                            reflectedDamageParts({
                                reflectPct,
                                // Direct slice only — the bomb portion of a mixed hit never reflects.
                                netHpDamage: reflectBasis,
                                affinityDamageModifier,
                                attackerDefenceReductionPct,
                                reflectVictimIncomingReductionPct,
                            });
                        if (reflected > 0) {
                            // `sink` accumulates the attacker's incoming into the unified
                            // perActorIncoming/intakeFor map under its own id (ids are globally
                            // unique across sides — no per-side selection needed, SP-U U1).
                            const reflectOutcome = applyVictimDamage(reflected, attacker, sink, {
                                killerId: victim.id,
                                byDirectDamage: true,
                                isReflected: true,
                                shieldPenetrationPct: 0,
                                bombPortion: 0,
                                // #358 ADDENDUM 2: the same reflected hit without the reflect
                                // victim's (the original attacker's) defence term.
                                preMitigationDamage: reflectedPreMit,
                            });
                            perActorReflected.set(
                                attacker.id,
                                (perActorReflected.get(attacker.id) ?? 0) + reflected
                            );
                            // Surface the reflected hit as the attacker's per-victim incoming so it
                            // flows into RoundData.perTargetDamage → the attacker's damageTaken /
                            // hpPct (mirrors how a normal direct hit's emitHit accumulates). Without
                            // this, reflected damage would mutate the attacker's live HP but never
                            // appear on the reconstructed HP curve.
                            //
                            // Booked as the intake the funnel RECORDED (`incomingBooked`), not the
                            // bounce we computed. The recipient's own incoming-block can convert a
                            // bounce into a self-DoT (its Hit Mitigation one-shot or a Voron/Orel
                            // transform — a bounce-back DOES read both; see the Hit Mitigation
                            // guard's note), and that converted amount lands LATER as generic DoT
                            // ticks, each booking its own increment into these two maps. Booking the
                            // full bounce here as well would count it twice on both display channels
                            // (damageTaken, and the HP curve for any round that leaves no
                            // `perActorIncoming` bucket for this actor to prefer). A barriered bounce
                            // IS booked, exactly as a barriered direct hit is on the main path.
                            const reflectBooked = reflectOutcome.incomingBooked;
                            if (reflectBooked > 1e-9) {
                                roundPerTargetDamage.set(
                                    attacker.id,
                                    (roundPerTargetDamage.get(attacker.id) ?? 0) + reflectBooked
                                );
                                // SP-F F1: the reflecting WEARER (victim.id) is the source-attacker
                                // of this bounce-back hit; `attacker` (the original attacker, now
                                // the recipient) is the victim key — direction-inverted vs the outer
                                // names. Must move in LOCKSTEP with the write above: `perTargetDealt`
                                // is documented as a per-attacker mirror of EVERY
                                // roundPerTargetDamage increment, and `damageDealt`/`damageTaken`
                                // reconcile by construction. (A converted bounce is credited to the
                                // recipient itself — `convertHitToSelfDot` stamps the self-DoT
                                // `sourceId: victim.id` — so the reflector rightly loses the credit.)
                                creditDealt(victim.id, attacker.id, reflectBooked);
                            }
                            // Log-only reflect surface (see the deferReflectLogs doc above
                            // applyVictimDamage). On the deferred (positional) path we BUFFER the
                            // row and flush it after emitDeferredAbilityPerformed creates the
                            // attack entry, so it nests under the attack (not a preceding
                            // charge/buff entry). Off the deferred path the attacker's
                            // ability-performed already exists → emit inline. Stamp duringTurnOf
                            // with the acting attacker either way; didCrit omitted (reflects don't
                            // crit).
                            if (deferReflectLogs) {
                                pendingReflectLogs.push({
                                    sourceId: victim.id,
                                    targetId: attacker.id,
                                    amount: reflected,
                                    subAttack: currentSubAttackIndex,
                                });
                            } else {
                                bus.emit({
                                    type: 'reactive-damage-performed',
                                    sourceId: victim.id,
                                    targetId: attacker.id,
                                    round: r,
                                    amount: reflected,
                                    reactive: true,
                                    duringTurnOf: actingActorId,
                                    triggerActorId: actingActorId,
                                });
                            }
                        }
                    }
                }
            }
            // ONE stack of 'Exposed' is consumed by the hit it amplified ("removed after taking
            // direct damage"). A hit reads ALL of the victim's stacks (+100% each) and spends
            // exactly one, so Amartya's 2 stacks amplify two consecutive hits — +200%, then +100%
            // (owner ruling, 2026-08-10). WHICH hits spend is unchanged by that ruling: the guard
            // below is untouched and still governs.
            // Placed at the funnel's landing exit so BOTH directions consume identically — and AFTER
            // the caller computed this hit's damage off the amplified modifier, so the hit that pays
            // for the status is the one that benefits from it.
            //
            // The governing rule: consume ONLY on a hit that actually read the amplification. So the
            // exclusions mirror exactly what the incoming-damage channel itself excludes:
            //  - DoT-tick batches and bomb/detonation portions (`byDirectDamage: false` / a non-zero
            //    `bombPortion`) never read `incomingDamageModifierPct`;
            //  - the three SECONDARY hit types compute their damage without that channel too, so
            //    they would spend the status for nothing (found in review, PR #289):
            //      · reflect  — `reflectedDamageForHit` folds only the attacker's incoming-REDUCTION,
            //      · counter  — passes `incomingDamageModifierPct: 0` outright (documented approximation),
            //      · transfer — the redirected chunk comes off the ORIGINAL victim's cascade.
            //    Same three flags, same reasoning as the Protection-transfer eligibility guard above.
            //  - the Barrier branch already returned without reaching here.
            //
            // NOTHING LANDED AT THAT INSTANT is the single premise the final term encodes, and it
            // covers all three ways this funnel can cancel a hit (owner ruling, 2026-08-03; extended
            // to a third path in the Shield Converter review):
            //  - Barrier ANNIHILATES the hit — nothing lands, ever, so the amplification was never
            //    cashed (that path returns above and never reaches this guard);
            //  - a TRANSFORM (Voron/Orel's `transform-incoming-to-dot`, or the `Hit Mitigation`
            //    one-shot) replaces the hit with a DoT, so nothing lands at THIS instant either.
            //    `immediateDamage - transformedToDot` is therefore <= 0 and Exposed stays ARMED.
            //  - `Shield Converter` NULLIFIES the hit into a shield deposit — no DoT, no HP/shield
            //    drain, `damage` is zeroed before `immediateDamage` is captured, so
            //    `immediateDamage - transformedToDot` is 0 here too (`transformedToDot` itself stays
            //    0 — this path doesn't touch it). It follows the BARRIER reading, not the transform
            //    one: like Barrier, the amount never re-books anywhere later (no deferred DoT tick),
            //    so Exposed staying armed costs nothing and matches Barrier's "nothing lands, ever".
            // That is deliberately the SAME reading of `transformedToDot` as the `attacked`
            // suppression in the per-victim `onVictimResolved` hook (`fullyTransformedToDot`): a
            // fully converted hit is not a direct hit, so it neither signals "directly damaged" to
            // on-attacked reactives nor spends a status whose game text is "removed after taking
            // direct damage". The two readings must stay in step — revisit them in the same commit
            // or the tree ends up asserting both premises at once (it briefly did). A hit whose
            // whole amount an incoming-BLOCK erased is excluded by the same term: both parts are 0.
            //
            // ACCEPTED CONSEQUENCE of that ruling: amplification is folded UPSTREAM of this funnel
            // (`victimIncomingModifiers`), so the amount a transform converts already carries the
            // +100% while Exposed also survives for a later hit — banked twice. Deliberate and
            // accepted, not an oversight: making it once-only would mean converting the UNAMPLIFIED
            // amount, which contradicts what a deferral is. Do not "fix" it in this guard.
            //
            // If a secondary path ever starts folding the per-victim incoming channel, drop its flag
            // from this guard in the same commit — amplify and consume must stay in lockstep.
            if (
                cause?.byDirectDamage === true &&
                (cause.bombPortion ?? 0) === 0 &&
                !cause.isProtectionTransfer &&
                !cause.isReflected &&
                !cause.isCounter &&
                immediateDamage - transformedToDot > 0
            ) {
                consumeExposed(statusEngine, victim.id);
            }
            return {
                // IMPORTANT 1 (Shield Converter review): report the PRE-deposit pool for a
                // converted hit, not the post-deposit `shieldBefore` captured above (which, for
                // this one hit, already includes the deposit) — otherwise shieldWasHit detection
                // at :6406-6411/:8592-8597 reads a nullify-and-grow as "the shield absorbed part of this hit".
                shieldBefore: shieldPoolBeforeConversion ?? shieldBefore,
                hpDamage,
                barriered: false,
                // Structurally excludes a converted hit from `shieldWasHit` detection at every
                // consumer site (see the field doc on VictimDamageOutcome.converted) — set whenever
                // the Shield Converter branch above actually fired this hit.
                converted: shieldPoolBeforeConversion !== undefined,
                transformedToDot,
                // A transform REVERSED the `.incoming` recorded above (convertHitToSelfDot), so the
                // net intake this application booked excludes it — the deferred amount is booked
                // later, per tick, by the DoT path.
                incomingBooked: incomingRecorded - transformedToDot,
                ...(protectionRedirected > 0 ? { protectionRedirected } : {}),
            };
        };
        // Legacy healing-mode player intake — a THIN wrapper over applyVictimDamage. The sink
        // accumulates the victim's incoming / shield-absorbed / barrier-absorbed into its per-actor
        // bucket (intakeFor). The heal target's death round is no longer tracked via the sink —
        // it is read back off `healTarget.destroyedRound` (stamped by recordDestroyed) at the
        // result site. Signature, default `victim = healTarget!`, and return value are unchanged,
        // so every existing call site stays byte-identical.
        // SP-U U1: this single sink serves BOTH directions (player-victim and enemy-victim) —
        // ids are globally unique across sides, so one `intakeFor` map is safe for both. Formerly
        // two separate per-side sink objects with byte-identical bodies; collapsed since they
        // never diverged.
        const sink: DamageAccountingSink = {
            addIncoming: (amount, victimId) => {
                intakeFor(victimId).incoming += amount;
            },
            addIncomingRaw: (amount, victimId) => {
                intakeFor(victimId).incomingRaw += amount;
            },
            addShieldAbsorbed: (amount, victimId) => {
                intakeFor(victimId).shieldAbsorbed += amount;
            },
            addBarrierAbsorbed: (amount, victimId) => {
                intakeFor(victimId).barrierAbsorbed += amount;
            },
            addConvertedToShield: (amount, victimId) => {
                intakeFor(victimId).convertedToShield += amount;
            },
        };
        // #355 B1: how much damage a detonation/burst apply actually DELIVERED, for the numeric
        // channels its caller books by hand (`roundPerTargetDamage`, `creditDealt`,
        // `perActorDetonation`, a standing `'detonation'` leech).
        //
        // WHY THE CALLERS CANNOT JUST BOOK THE AMOUNT THEY PASSED IN. A burst arrives at
        // `applyVictimDamage` stamped `byDirectDamage: true` with the whole amount in
        // `bombPortion`, and only the two CONSUMABLE steps (Hit Mitigation, Shield Converter) carry
        // a `bombPortion === 0` guard. The incoming-block step, the Protection cascade and the
        // standing Voron/Orel transform have no such guard, so all three fire on a burst and all
        // three make the funnel record something OTHER than what the caller passed in. #293 swept
        // every direct-damage caller onto `incomingBooked` for exactly this reason; the detonation
        // sites were left behind and double-counted every redirected chunk (Meatshield/Lionheart
        // Protection is live corpus kit, so this was reachable, not theoretical).
        //
        // The two terms, and why the split is not arbitrary:
        //  • `incomingBooked` — the victim's OWN booked intake, so a blocked or DoT-transformed
        //    slice drops out. A transform's deferred amount re-books later, per tick, on the DoT
        //    path; booking it here too would count it twice.
        //  • `protectionRedirected` — the slice a Protection cascade moved to protectors. It DID
        //    land, just on another row, and the cascade already books each protector's
        //    `roundPerTargetDamage` + `creditDealt` itself. So it belongs in the whole-attack totals
        //    (`perActorDetonation`, the leech basis: "% of damage dealt" counts a Protection
        //    redirect and does NOT count a DoT transform — locked rule) but NOT in the victim's own
        //    per-target rows, which is why those read `incomingBooked` alone.
        const detonationDelivered = (outcome: AppliedVictimDamage): number =>
            outcome.incomingBooked + (outcome.protectionRedirected ?? 0);
        // H1 T4: the effective shield penetration % of an attacker, resolved from its static
        // ActorStats.shieldPenetration (threaded in Tasks 1-2). Defaults to 0 for an unknown id
        // or an attacker that never set the stat → byte-identical for fixtures without pen.
        const attackerShieldPenOf = (id?: string): number =>
            (id ? allActorsById.get(id)?.stats.shieldPenetration : undefined) ?? 0;
        const applyIncomingToTarget = (
            damage: number,
            victim: CombatActor = healTarget,
            // C2b-2 T5: defaults to the DIRECT-damage attribution (the acting actor landed this
            // hit). The DoT-tick batch caller overrides with { byDirectDamage: false } — a DoT
            // batch is an aggregate of multiple appliers with NO single killer.
            // H1 T4: callers may also pass a `bombPortion` — the detonation slice of `damage`
            // that drains the shield in FULL (no penetration).
            cause: {
                killerId?: string;
                byDirectDamage?: boolean;
                bombPortion?: number;
                isReflected?: boolean;
                /** A2: the defence mitigation factor already folded into `damage` for this
                 *  victim, supplied by the positional apply. See applyVictimDamage's
                 *  `cause.targetMitigation`. */
                targetMitigation?: number;
                /** #358 ADDENDUM 2/3 — see applyVictimDamage's `cause.preMitigationDamage`. */
                preMitigationDamage?: number;
            } = {
                killerId: actingActorId,
                byDirectDamage: true,
            },
            // Epic PR12 (A): forwarded to applyVictimDamage's cause.isPrimaryTarget (Nosorog's
            // reflect gate). Undefined at every pre-PR12 call site → byte-identical (treated as
            // primary, matching the existing behavior for every ability without
            // requirePrimaryTarget).
            isPrimaryTarget?: boolean
        ): VictimDamageOutcome =>
            applyVictimDamage(damage, victim, sink, {
                ...cause,
                // H1 T4: direct hits respect the ACTING attacker's shield penetration; DoT
                // batches (byDirectDamage:false) force pen 0 and bypass the shield entirely.
                shieldPenetrationPct:
                    cause.byDirectDamage === false
                        ? 0
                        : attackerShieldPenOf(cause.killerId ?? actingActorId),
                bombPortion: cause.bombPortion ?? 0,
                isPrimaryTarget,
            });
        // Player→enemy intake (E1 — symmetric incoming surface). The symmetric THIN wrapper over
        // applyVictimDamage for the direction where a PLAYER attacks an ENEMY victim. The enemy
        // victim runs the FULL HP/shield/Barrier/Cheat-Death/recordDestroyed path AND now records
        // its incoming / shield-absorbed / barrier-absorbed into the same per-actor `intakeFor`
        // bucket `sink` uses — keyed by the ENEMY victim's id (ids are globally unique across
        // sides, so one map serves both directions). `applyOutgoingToEnemy` is only invoked on the
        // positional apply path (drivePositionalApply), so non-positional fixtures never add an
        // enemy key → byte-identical. The enemy victim is never the heal target, so no heal-target
        // death-round bookkeeping applies. E2 (per-victim leech) reads this surface.
        const applyOutgoingToEnemy = (
            damage: number,
            enemyVictim: CombatActor,
            // Epic PR12 (A): forwarded to applyVictimDamage's cause.isPrimaryTarget (Nosorog's
            // reflect gate). Undefined at every pre-PR12 call site → byte-identical.
            isPrimaryTarget?: boolean,
            // A2: the defence mitigation factor already folded into `damage` for this victim,
            // supplied by the positional apply. See applyVictimDamage's `cause.targetMitigation`.
            targetMitigation?: number,
            /** #358 ADDENDUM 2/3 — the pre-REDUCTION twin of `damage` (pre-defence and pre every
             *  other victim-side reduction), supplied by the positional apply. See
             *  applyVictimDamage's `cause.preMitigationDamage`. */
            preMitigationDamage?: number
        ): VictimDamageOutcome =>
            // C2b-2 T5: a player→enemy hit is always DIRECT damage from the acting attacker.
            // H1 T4: positional player→enemy hits are all-direct (no detonation slice here), so
            // they respect the acting attacker's shield penetration with bombPortion 0 (default).
            applyVictimDamage(damage, enemyVictim, sink, {
                killerId: actingActorId,
                byDirectDamage: true,
                shieldPenetrationPct: attackerShieldPenOf(actingActorId),
                isPrimaryTarget,
                targetMitigation,
                preMitigationDamage,
            });
        // TEST-ONLY: hand the genuine wrapper out once (no production caller until Task 8). The
        // closure is per-round-identical in behaviour (only `r` differs), so capturing it on the
        // first round it is built is sufficient. Inert in production (the field is never set).
        input.__testTapApplyOutgoingToEnemy?.(applyOutgoingToEnemy);

        // G PR1: full mitigated/crit counter walk from the counter owner to the attacker.
        // Unreferenced dead code until the executor (Task 4) wires it via ctx.applyCounterAttack
        // → byte-identical now. Reuses applyVictimDamage (no attacked event → no re-counter).
        const applyCounterAttack = (
            ownerId: string,
            attackerId: string,
            abilityId: string,
            multiplier: number,
            hits: number
        ): { dealt: number; didCrit: boolean } | void => {
            const owner = allActorsById.get(ownerId);
            const attacker = allActorsById.get(attackerId);
            // Guards: owner alive, attacker alive, not self (spec rule 6).
            if (!owner || !attacker) return;
            if (owner.destroyedRound !== undefined) return;
            if (attacker.destroyedRound !== undefined || attacker.id === owner.id) return;

            const ownerStats = effectiveStatsOf(statusEngine, selfBuffLookup, owner);
            // #395: the two outgoing-damage channels, which STATUS mode does not carry — the
            // owner's own `Out. Damage Up` plus the shadowed enemy-APPLIED `Attack Down` /
            // `Out. Damage Down`. Everything else below still reads `ownerStats` (crit, crit
            // damage, base pen), which is the correct fold for those.
            const ownerOutgoing = effectiveOutgoingStatsOf(statusEngine, selfBuffLookup, owner);
            const attackerStats = effectiveStatsOf(statusEngine, selfBuffLookup, attacker);

            // Roll the OWNER's crit via the dedicated gate (one stream per counter ability per owner).
            const didCrit = rollRateGate(
                counterCritGates,
                `${ownerId}:${abilityId}`,
                ownerStats.crit / 100
            );

            const rawParts = victimHitDamageParts(
                {
                    effectiveAttack: ownerOutgoing.attack,
                    // `multiplier` is the PER-HIT value, so the full counter total is
                    // multiplier × hits. The counter is modeled as ONE consolidated applied
                    // hit, so fold the count into the multiplier and pass hits:1 — passing the
                    // real `hits` here would make victimHitDamage re-split (preCritDamage / hits)
                    // and silently collapse a multi-hit counter back to a single hit's damage.
                    // Byte-identical for single-hit counters (hits === 1).
                    multiplierPct: multiplier * hits,
                    secondaryStatValue: 0,
                    hits: 1,
                    effectiveCritDamage: ownerStats.critDamage,
                    // #395 CLOSED THE #389 RESIDUAL HERE. This used to be a hardcoded 0, which
                    // dropped BOTH halves of the channel: the enemy-APPLIED `Out. Damage Down` on
                    // the owner (#389's fix reached only the centralised applied-damage path) AND
                    // the owner's OWN `Out. Damage Up` (Grif grants it to all allies; Centurion's
                    // retaliation never saw it, while `Attack Up` from the same cast did).
                    // `effectiveOutgoingStatsOf` folds both, shadowed per named family.
                    //
                    // The gap was corpus-unreachable when filed — 861 counter invocations across
                    // the suite, none with a suppressed owner, measured with a probe validated by
                    // removing its guard — so `reactiveOutgoingFold.test.ts` hand-authors the
                    // shape rather than relying on a ship kit to produce it.
                    outgoingDamageBuffPct: ownerOutgoing.outgoingDamageBuffPct,
                    // APPROXIMATION (asymmetry vs Reflect, which threads the attacker's
                    // incomingReductionForHit): the counter does NOT apply the attacker's
                    // incoming-damage-reduction abilities. Harmless today (no Stalwart fixture);
                    // PR2 may thread incomingReductionForHit(incomingAbilitiesOf(attacker.id))
                    // here to match the Reflect path exactly.
                    incomingDamageModifierPct: 0,
                    // effectiveStatsOf.defensePenetration is BASE-only (buff folds separately) —
                    // acceptable approximation (no Stalwart fixture; counters ignore pen-buffs).
                    defensePenetrationPct: ownerStats.defensePenetration,
                    attackerAffinity: owner.affinity ?? 'antimatter',
                },
                {
                    defence: attackerStats.defence,
                    defenceModifierPct: 0,
                    affinity: attacker.affinity ?? 'antimatter',
                },
                didCrit,
                1 // roleScale: a counter is a single full hit
            );
            const raw = rawParts.damage;
            const rawPreMit = rawParts.preMitigation;
            if (raw <= 0) return;

            // `sink` (outer scope, SP-U U1) accumulates the attacker's incoming regardless of
            // side — ids are globally unique across sides.
            //
            // Buffer this application's log-only consequence twins, exactly as applyReactiveDamage
            // does: a counter also emits its own `reactive-damage-performed` row only AFTER this
            // call returns (triggers.ts emitReactiveDamageLog), so a Lifeline grant / shield-
            // destroyed / cheat-death raised by the counter hit would otherwise print above the
            // counter that caused it. try/finally so a throw can't strand the flag.
            const wasDeferring = deferConsequenceLogs;
            deferConsequenceLogs = true;
            // Annotated (not an inferred `let`): the assignment sits inside the try, so an untyped
            // declaration would evolve to `any` and stop type-checking the `.incomingBooked` read
            // below — a silent typo there would book `raw` and restore the double-count.
            // `AppliedVictimDamage` rather than `VictimDamageOutcome` so `incomingBooked` is
            // non-optional: the `?? 0` below then covers only the (unreachable) case of the throw
            // that skips the assignment, not a silently absent field.
            let counterOutcome: AppliedVictimDamage | undefined;
            try {
                counterOutcome = applyVictimDamage(raw, attacker, sink, {
                    killerId: owner.id,
                    byDirectDamage: true,
                    isCounter: true,
                    // #358 ADDENDUM 2: the counter walk folds the ATTACKER's defence through
                    // `victimHitDamage`; `rawPreMit` is the same walk without it.
                    preMitigationDamage: rawPreMit,
                    // Mirror Reflect (no shield penetration on the reactive hit). EffectiveStats has NO
                    // shieldPenetration field; we deliberately pass 0.
                    shieldPenetrationPct: 0,
                    bombPortion: 0,
                });
            } finally {
                deferConsequenceLogs = wasDeferring;
            }
            // Surface on the attacker's incoming so it appears on the HP curve (mirror Reflect):
            // the intake the funnel RECORDED, so a portion the attacker's own incoming-block
            // converted into a self-DoT is booked by its ticks rather than twice. See the Reflect
            // site's note.
            const counterBooked = counterOutcome?.incomingBooked ?? 0;
            if (counterBooked > 1e-9) {
                roundPerTargetDamage.set(
                    attacker.id,
                    (roundPerTargetDamage.get(attacker.id) ?? 0) + counterBooked
                );
                // SP-F F1: the counter-OWNER is the source-attacker of this counter hit. Moves in
                // lockstep with the write above (perTargetDealt mirrors every increment).
                creditDealt(owner.id, attacker.id, counterBooked);
            }
            // `dealt` stays the FULL counter, converted or not: it feeds only the log row
            // (triggers.ts emitReactiveDamageLog) and the reactive dealt-amount slot, and the main
            // cast path likewise logs its computed `directDamage` when a victim converts the hit
            // (playerTurn's deferredAbilityPerformed). Suppressing it would erase the counter from
            // the play-by-play entirely — a conversion emits no event of its own.
            return { dealt: raw, didCrit };
        };

        // PR4b: the reactive `damage` executor branch (triggers.ts cfg.type==='damage') — Grif's
        // on-enemy-cleansed, FrontLine's on-enemy-charged-cast, and epic PR4's re-tagged Judge/
        // Chakara/Incinerator/Rhodium start-of-round/end-of-round passives. Mirrors
        // applyCounterAttack's mitigated/crit walk (SAME victimHitDamage call, SAME documented
        // approximations: no outgoing-damage buff, no per-victim incoming-damage modifier,
        // base-only defense penetration, no shield penetration). PR4b changed only the NUMBER's
        // formula (now mitigated + crit-eligible instead of a flat effectiveAttack × multiplier fold
        // with no defense and no crit); SP-M M1 then split WHERE it lands. There is now exactly ONE
        // destination: the proc reduces the resolved victim's HP via applyVictimDamage and books
        // per-victim (creditDealt). SP-4c-2d deleted the second one — the credit-only arm that
        // booked into the owner's round damage-dealt scalar bucket (creditDamage, the pre-SP-M
        // contract) when there was "no real victim to reduce" — together with the gate that chose
        // between them; see the SP-4c-2d note on the apply below for why both conjuncts of that gate
        // are gone. So there is no gate in the body any more, and no destination to be mutually
        // exclusive with.
        //
        // Victim resolution is the caller's job — this closure only needs a concrete victim id to
        // mitigate against. triggers.ts resolves it from the event (critVictimIds / counterTargetId
        // / debuffVictimId), and otherwise from `livingOpposingActorIds`. No arm falls back to a sink
        // id any more: the arm that used to (`counterTargetId ?? ctx.enemy.id`) returns early on an
        // empty living roster since SP-4c-2d Task 1, so this closure is reached only with a resolved
        // victim id.
        const applyReactiveDamage = (
            ownerId: string,
            victimId: string,
            abilityId: string,
            multiplier: number,
            hits: number,
            noCrit: boolean,
            hpBasisPct?: number,
            // Ship-kit W8 (Xcellence on-resist): sibling of hpBasisPct — when set (and
            // hpBasisPct is not), raw = owner's CURRENT SHIELD × shieldBasisPct% instead of
            // attack × multiplier. Mutually exclusive with hpBasisPct in the corpus; hpBasisPct
            // takes precedence if both were ever set.
            shieldBasisPct?: number,
            allowDeadOwner?: boolean,
            // Ship-kit W5 Task C3 (Demolisher bomb-splash). `flatBasis`: this proc is a FLAT copy
            // of some OTHER already-resolved damage figure (the bomb's own burst,
            // eventCtx.triggerDamage) rather than owner-attack × multiplier — raw is computed
            // directly, skipping `victimHitDamage` ENTIRELY (no defense, no crit roll, no
            // affinity). `ignoresDefense` (without `flatBasis`): the normal attack-basis/crit walk
            // still runs, but the victim's Defense term is bypassed (defence: 0) — kept minimal,
            // for generality beyond Demolisher's own (flat) path. Both absent (every pre-C3
            // caller) → byte-identical to the pre-C3 body below.
            opts?: { ignoresDefense?: boolean; flatBasis?: number }
        ): { dealt: number; didCrit: boolean } | void => {
            const owner = allActorsById.get(ownerId);
            const victim = allActorsById.get(victimId);
            // allowDeadOwner (PR-B1, Paracelsus): an on-destroyed retaliation is BORN of the
            // owner's own death — the owner is already stamped destroyedRound by the time this
            // drains (recordDestroyed runs before the ship-destroyed emit that enqueues this
            // intent), so the plain "owner must be alive" gate would always no-op it. Mirrors the
            // fromOwnDeath exemption the dead-owner drain gate already grants in triggers.ts
            // (executeIntent) for Martyrdom's killer-Disable / Salvation's heal.
            if (!owner || (owner.destroyedRound !== undefined && !allowDeadOwner)) return;
            // A missing/already-destroyed victim has no defense to mitigate against — skip
            // rather than crediting an un-mitigated number. BEHAVIOR CHANGE vs the pre-#211
            // formula (which never referenced a victim and credited unconditionally): for the
            // now-deleted `ctx.enemy` fallback it was inert (that dummy's HP and
            // `recordDestroyed` only landed in the post-round accounting step, never during this
            // in-turn drain, so `victim.destroyedRound` was never set yet there), but a
            // counterTargetId-routed victim (FrontLine's charging enemy) CAN die to an earlier
            // reactive in the same drain batch — the proc then credits nothing, which is the
            // correct reading (you can't hit a corpse).
            if (!victim || victim.destroyedRound !== undefined) return;

            const ownerStats = effectiveStatsOf(statusEngine, selfBuffLookup, owner);
            // #395: twin of the counter site's read — the two outgoing-damage channels STATUS mode
            // does not carry. Only the ATTACK-basis arm of `basisStat` below consumes `.attack`; an
            // hp-basis or shield-basis proc is not attack-scaled, so an `Attack Down` must not
            // touch its basis, while `Out. Damage Down` still reduces the resulting damage.
            const ownerOutgoing = effectiveOutgoingStatsOf(statusEngine, selfBuffLookup, owner);
            const victimStats = effectiveStatsOf(statusEngine, selfBuffLookup, victim);

            let raw: number;
            /** #358 ADDENDUM 2: the pre-defence twin of `raw`. */
            let rawPreMit: number;
            let didCrit: boolean;

            if (opts?.flatBasis !== undefined) {
                // Ship-kit W5 Task C3 (Demolisher bomb-splash): a FLAT copy of the triggering
                // event's OWN already-resolved damage (the bomb's burst) — raw = flatBasis ×
                // multiplier/100 (100% = a straight copy), computed DIRECTLY with no
                // `victimHitDamage` call at all: no owner-attack basis, no Defense mitigation, no
                // crit roll (a flat copy can never crit by design — `noCrit` is honoured by
                // construction, not by a flag check), and deliberately NO affinity
                // re-application. Affinity rationale: the bomb's `damage` already resolved the
                // ORIGINAL applier's affinity matchup against the BOMBED victim; re-running
                // affinity math here would apply THIS neighbour's affinity to a hit that never
                // actually had a matchup against it — the burst is a single already-realized
                // number being copied, not a new attack being rolled. Mirrors the
                // bomb-splash-on-death precedent (engine.ts ~4187, `splashDamageForBomb`), which
                // is likewise flat/no-affinity.
                raw = Math.round((opts.flatBasis * multiplier) / 100);
                // A flat copy folds NO defence, so raw and pre-defence coincide.
                rawPreMit = raw;
                didCrit = false;
            } else {
                // Deterministic per-(owner, ability) crit gate — a NEW map (reactiveDamageCritGates),
                // never Math.random. `noCrit` short-circuits the roll entirely: a flagged ability
                // (Grif "cannot critically hit", Rhodium "cannot critically hit") never creates a gate
                // key, so it can never crit by construction, matching the flag rather than relying on
                // the executor to withhold crit eligibility. A 0%-crit owner ALSO skips the roll — a
                // guaranteed-miss draw would still consume a value from the shared seeded RNG stream
                // and perturb every later gate's schedule (proc gates, debuff landing) for ships that
                // can never crit anyway. Live-checked per call, so a mid-fight crit buff starts
                // drawing from that point on.
                didCrit =
                    !noCrit &&
                    ownerStats.crit > 0 &&
                    rollRateGate(
                        reactiveDamageCritGates,
                        `${ownerId}:${abilityId}`,
                        ownerStats.crit / 100
                    );

                // Vindicator on-resist: raw = owner effective max HP × hpBasisPct% (mitigated below the
                // same as any direct hit — defence + affinity + crit). Ship-kit W8 (Xcellence):
                // shieldBasisPct sibling uses the owner's CURRENT SHIELD (live shieldPool) as the
                // basis instead. Otherwise attack × multiplier.
                const basisStat =
                    hpBasisPct !== undefined
                        ? recipientMaxHp(ownerId)
                        : shieldBasisPct !== undefined
                          ? owner.shieldPool
                          : ownerOutgoing.attack;
                const basisPct =
                    hpBasisPct !== undefined
                        ? hpBasisPct
                        : shieldBasisPct !== undefined
                          ? shieldBasisPct
                          : multiplier;

                const procParts = victimHitDamageParts(
                    {
                        effectiveAttack: basisStat,
                        // Fold hit count into the multiplier and pass hits:1 (mirrors
                        // applyCounterAttack) — models the reactive proc as ONE consolidated hit.
                        multiplierPct: basisPct * hits,
                        secondaryStatValue: 0,
                        hits: 1,
                        effectiveCritDamage: ownerStats.critDamage,
                        // #395 CLOSED THE #389 RESIDUAL HERE — twin of the counter-attack site's
                        // note. Was a hardcoded 0, dropping the enemy-APPLIED `Out. Damage Down` on
                        // the owner AND the owner's own `Out. Damage Up`. Applies on every basis:
                        // `Out. Damage Down` reduces the DAMAGE, whatever the basis it was computed
                        // from — only the `flatBasis` arm above is exempt, and by construction
                        // (it never reaches `victimHitDamageParts`, being a copy of an
                        // already-resolved number rather than a new attack).
                        outgoingDamageBuffPct: ownerOutgoing.outgoingDamageBuffPct,
                        incomingDamageModifierPct: 0,
                        defensePenetrationPct: ownerStats.defensePenetration,
                        attackerAffinity: owner.affinity ?? 'antimatter',
                    },
                    {
                        // SP-F F5: Meatshield defense-substitution (approximation) — see the
                        // substitutedDefenceFor doc comment above for the full rule. Ship-kit W5
                        // Task C3: `ignoresDefense` (non-flat generality path) bypasses the
                        // victim's Defense term entirely (defence: 0) instead of the normal
                        // substituted defence.
                        defence: opts?.ignoresDefense
                            ? 0
                            : substitutedDefenceFor(victim, victimStats.defence),
                        defenceModifierPct: 0,
                        affinity: victim.affinity ?? 'antimatter',
                    },
                    didCrit,
                    1 // roleScale: a reactive proc is a single full hit
                );
                raw = procParts.damage;
                rawPreMit = procParts.preMitigation;
            }
            // Guard: swallows zero/negative procs (defensive — a 0-attack or 0-multiplier proc
            // credits nothing), matching the pre-fix zero-damage guard.
            if (raw <= 0) {
                // SP-G G3: a non-positive reactive hit still resets the owner's dealt-amount slot,
                // so a paired basis:'damage-dealt' shield (FrontLine) reads 0 for THIS proc rather
                // than a stale prior-round value.
                reactiveDealtByOwner.set(ownerId, 0);
                return;
            }
            reactiveDealtByOwner.set(ownerId, raw);
            // SP-M M1: a reactive proc REDUCES the resolved victim's real HP through the SAME
            // shared funnel counters use (applyVictimDamage) — surfacing on the victim's HP curve
            // (roundPerTargetDamage → damageTaken) and attributed to the owner (creditDealt →
            // perTargetDealt → damageDealt). Mirrors applyCounterAttack EXACTLY (isCounter:true → a
            // reactive hit is never itself reflected and never Protection-redirected; no shield
            // penetration) and deliberately does NOT creditDamage: cumulativeDamage is the scalar
            // aggregate channel, so folding the reactive into it would double-count exactly like
            // the per-victim DoT/detonation split documented at the round tail. The DPS calculator
            // reads the per-victim map instead (dpsSimulator.ts's focusDamageTotal), which this is
            // what feeds.
            //
            // SP-4c-2d: this whole apply used to sit behind `hasPositionedEnemyRoster &&
            // victim.id !== enemy.id`, with a CREDIT-ONLY else arm for "no real victim to reduce".
            // Both conjuncts are gone with the dummy: the first is constant true below the
            // normalization boundary (see the proof at its deleted definition) and the second was a
            // backstop keeping the HP path off the vestigial dummy — an id no actor carries now. So
            // the apply is unconditional, and the credit-only arm went with the conjuncts rather
            // than becoming unreachable code. Any future caller that genuinely has no victim must
            // not arrive here at all: `applyReactiveDamage` requires a concrete `victimId`, and
            // SP-4c-2d Task 1 made a victimless reactive infliction a no-op in the executor. The
            // `{ … }` block that survived the gate's deletion is dedented away with it — it was a
            // phantom nesting level with no scope left to own.
            //
            // Buffer this application's log-only consequence twins (Lifeline shield grant,
            // shield destroyed, cheat death) so they print UNDER this proc's own attack row —
            // which triggers.ts emits only after this call returns. Restored in a `finally`
            // so a throw can never leave the flag stuck on for later applications.
            const wasDeferring = deferConsequenceLogs;
            deferConsequenceLogs = true;
            // Annotated for the same reason as applyCounterAttack's `counterOutcome`.
            let procOutcome: AppliedVictimDamage | undefined;
            try {
                procOutcome = applyVictimDamage(raw, victim, sink, {
                    killerId: ownerId,
                    byDirectDamage: true,
                    isCounter: true,
                    // #358 ADDENDUM 2: equals `raw` on the flat-basis branch (which folds no
                    // defence at all) and the pre-defence walk on the attack-basis branch.
                    preMitigationDamage: rawPreMit,
                    shieldPenetrationPct: 0,
                    bombPortion: 0,
                });
            } finally {
                deferConsequenceLogs = wasDeferring;
            }
            // The intake the funnel RECORDED, mirroring applyCounterAttack (this site is
            // documented as its exact mirror, so booking `raw` here would re-create the
            // double-count for the eight reactive-damage ships). No fixture reaches the case
            // where the two DIVERGE — that needs a reactive `damage` proc onto a block-holding
            // victim — so it is kept correct by construction with its sibling rather than
            // pinned. (The branch itself is well covered; only the raw≠booked split is not.)
            const procBooked = procOutcome?.incomingBooked ?? 0;
            if (procBooked > 1e-9) {
                roundPerTargetDamage.set(
                    victim.id,
                    (roundPerTargetDamage.get(victim.id) ?? 0) + procBooked
                );
                creditDealt(ownerId, victim.id, procBooked);
                // SP-4b-2 D1: the twin of this function's own `creditDamage(ownerId,
                // 'direct', raw)` below — the third and last suppressed direct write. Same
                // if/else, so a proc lands in exactly one channel. A reactive hit IS direct
                // damage its owner dealt, and it counted toward the Echoing Burst gather
                // before the corpus turned positional; without this it would silently stop.
                creditPositionalDirect(ownerId, procBooked);
            }
            // `dealt` stays the full proc — log/dealt-slot only, as in applyCounterAttack.
            return { dealt: raw, didCrit };
        };

        // §4.5 STASIS direct-damage break (B3 Task 2). Fires via the `onHitBreakStasis` hook
        // injected into `runPlayerTurn` (playerTurn.ts), which calls it AFTER the scheduled
        // debuffs (sourceFired) but BEFORE the ability timed-debuff loop. This ordering ensures:
        //  - A pre-existing Stasis IS broken when the hit lands (victim was stasised at mark time).
        //  - A Stasis RE-APPLIED by the SAME attack's debuff ability (e.g. stasisInflictAttack)
        //    is NOT broken — detected via the turn's inflictedEnemyDebuffs at resolution time.
        //  - DoT ticks NEVER call this (they never enter runPlayerTurn's break hook path).
        //
        // DEFERRED-BREAK DESIGN: the hook does NOT immediately remove Stasis. Instead it marks
        // the victim id into a per-turn `stasisHitVictims` Set. Removal happens RIGHT AFTER the
        // attacker's own `drainIntentsFor('player')`/`drainIntentsFor('enemy')` in the same
        // turn-loop iteration. This satisfies two invariants:
        //  (i)  The on-attacked reactive's drainQueue check (Counter Shield suppression — test iii)
        //       sees `isStasised(victim) = true` because drainIntentsFor runs BEFORE the removal.
        //  (ii) The victim is freed BEFORE its own next turn, so it acts in the next round.
        //
        // RE-APPLY CHECK: at resolution time, if the SAME turn's `inflictedEnemyDebuffs` contain
        // a Stasis name for the target, the re-application wins → skip the break for that victim.
        // This is LOCAL to the same turn (no cross-turn casterId state needed), making the check
        // immune to the "same attacker later fires pure-damage hits" bug.
        //
        // (Task 3 adds the Akula doesntBreakStasis exception — placeholder left below.)

        // Per-victim enemy-debuff-derived modifiers (B1/PR7b). Reads the victim's OWN per-actor
        // enemy-debuff store — BOTH channels: scheduled (__enemy__ global) + ability (per-victim
        // payload timed+aura). Delegates to victimEnemyBuffs (triggers.ts) which mirrors
        // ownerDebuffNamesFor's three-source read, ensuring modifier-read and name-read stay in
        // lockstep. Attacker-sourced modifiers (outgoing buff, pen) stay attacker-sourced.
        // NOTE: the aura/accumulating ability channel is an approximation (NEUTRAL ctx, no re-roll)
        // — see the victimEnemyBuffs jsdoc (finding I1) for details and acceptance rationale.
        const victimIncomingModifiers = (
            victimId: string,
            /** SP-4b-2 D4: the ACTING turn's already-gated scheduled enemy effects
             *  (`PlayerTurnResult.scheduledEnemyEffects`), threaded down from the positional apply.
             *  Without it this read hit the status engine's UNGATED `__enemy__` bucket, so a
             *  scheduled debuff the round's hacking-vs-security draw RESISTED still cut the
             *  victim's defence — the reporting channel said "resisted", the damage channel said
             *  "landed". Optional: the test tap and any future non-positional caller pass nothing
             *  and keep the raw read, so nothing off the positional path moves. */
            scheduledEffects?: SelectedGameBuff[]
        ): {
            enemyDefenseModifier: number;
            incomingDamageModifier: number;
            /** #358 ADDENDUM 3 (C2): the VICTIM-SIDE contributions to `incomingDamageModifier`
             *  (`selfIncoming + preFightIncoming`), split out so the pre-mitigation damage axis can
             *  strip them while keeping the attacker-applied amplification. */
            victimSideIncomingModifier: number;
        } => {
            const victimDebuffs = victimEnemyBuffs(
                statusEngine,
                victimId,
                enemyDebuffLookup,
                scheduledEffects
            );
            // 'Exposed' (Amartya/Nayra) is NAME-keyed, not a parsedEffects entry — each stack arms
            // ONE direct hit, which reads every stack the victim holds and spends one of them (see
            // exposedStatus.ts for why it cannot ride parsedEffects.incomingDamage). Folded into the
            // same percentage channel as Inc. Damage Up. Direct damage only, like every other term
            // here — DoT ticks and bombs never read this channel. `defenseProfileOf` calls this per
            // HIT, so the consumption below (applyVictimDamage) makes hit 2 of a multi-hit cast read
            // a store one stack lighter (and, at one stack, empty). It re-reads the status engine
            // rather than folding off `victimDebuffs` above: a one-shot must be read from exactly
            // the channel its removal can spend, which is narrower than the three-channel list
            // `toEnemyModifiers` needs.
            const exposed = exposedIncomingPct(statusEngine, victimId);
            // D-PR12: friendly-side incoming-DIRECT-damage buffs on the victim's OWN 'self' store
            // (Inc. Damage Down/Up — Makoli/Salvation/Shelter/Refine/Battlecry). Summed into the SAME
            // per-victim incomingDamageModifier as enemy debuffs. Team-agnostic for the TIMED + AURA
            // ability channels (victimId keys the actor's own self store regardless of side). The
            // SCHEDULED channel reads selfBuffLookup, which today is populated only for player/team
            // actors (enemy runtimes pass an empty map) — a pre-existing gap, irrelevant until an
            // enemy carries a scheduled self-buff.
            // Direct-damage channel ONLY — by design. Per the game rules, incoming/outgoing
            // damage modifiers (Inc. Damage Down/Up, Out. Damage Up) apply to DIRECT hits
            // only; DoT ticks (corrosion/inferno) and bombs are EXCLUDED. DoT reduction has a
            // dedicated channel (incomingDotReductionPct / Vortex Veil); bombs apply through
            // the detonation/bombPortion path which never reads incomingDamageModifierPct.
            // Locked by bombModifierExclusion.test.ts.
            // ONE read, both terms: victimSelfBuffs is a three-channel status-engine fold and this
            // runs per victim per hit, so it is deliberately not called twice.
            const victimSelf = victimSelfBuffs(statusEngine, victimId, selfBuffLookup);
            const selfIncoming = toSelfIncomingDamageModifier(victimSelf);
            // ADDENDUM A2: the victim's OWN defence modifiers (`parsedEffects.defense`) fold
            // ADDITIVELY into the SAME signed percentage channel enemy-sourced Defense Shred
            // already rides, consumed at victimDamage.ts's
            // `v.defence * (1 + v.defenceModifierPct / 100)`. Positive (Defense Up I/II/III) = more
            // defence = less damage taken.
            //
            // WHY THIS SITE, and not buff-folding `victimDefenseProfileOf`'s `defence` field:
            //  (i) `effectiveStatsOf` folds only TWO of the three self-buff channels (scheduled +
            //      timed, see its module header) — routing through the percentage channel reads the
            //      same three-channel `victimSelfBuffs` the `selfIncoming` twin above uses, so an
            //      AURA-granted defence buff is not silently dropped and the two channels stay in
            //      lockstep.
            //  (ii) `defence` stays `substitutedDefenceFor(v, v.stats.defence)`, so Meatshield
            //      defence-substitution semantics are untouched (buff-folding that field would force
            //      a choice about WHOSE buffs to fold when the carrier's defence is substituted in).
            //
            // WHY IT IS A DEFECT AND NOT A DESIGN CHOICE: every OTHER direct-damage site in this
            // engine already mitigates on the defender's BUFF-FOLDED defence — the counter-attack
            // (`effectiveStatsOf(...attacker).defence`), the reactive proc
            // (`effectiveStatsOf(...victim).defence`) and the Protection-cascade fallback all do.
            // The positional APPLIED path was the sole hold-out, reading the base stat with an
            // enemy-only modifier channel. (The `selfIncoming` twin one line above is the same
            // oversight already fixed for the incoming-damage channel by D-PR12.)
            //
            // SIGN-AGNOSTIC BY RULING (addendum A5): this carries NEGATIVE self-sourced defence too
            // — Overload ('-10% Defense', stacking to 10 -> -100%) and Refine's Supercharged. Those
            // buffs' damage upside was already applied while their stated defensive cost was not.
            // No name-special-casing, no positive-only filter. At -100% the effective defence
            // reaches exactly 0 and victimDefenceMitigation's `effectiveDefense > 0` guard is a
            // NO-OP there (`calculateDamageReduction(0)` is already 0). CORRECTION (addendum
            // A5.1): the guard does not prevent a "damage bonus" — `calculateDamageReduction` is
            // bounded in [0, 88.3505] and can never return a negative, so a bonus is impossible by
            // construction. What the guard prevents is NaN propagation from `log10` of a
            // non-positive effective defence, which only an OVERSHOOT below -100% (this channel
            // stacked with enemy Defense Shred) can produce.
            //
            // NO DOUBLE COUNT: `enemy.enemyDefenseModifier` reads the victim's ENEMY-debuff store
            // only; `defence` above is the RAW base stat; and pre-fight (squad-leader) defence is a
            // raw stat MUTATION (`PreFightStatBlock.defence`), not a modifier channel — unlike the
            // incoming twin, which needs its `preFightIncoming` term for exactly that reason.
            const selfDefense = toSelfDefenseModifier(victimSelf);
            // F3: the victim's pre-fight incomingDamage baseline (squad-leader "±N% incoming
            // direct damage") folds ADDITIVELY into the same per-victim channel the D-PR12
            // self-buff term rides (consumed via defenseProfileOf → incomingDamageModifierPct).
            // Sign convention matches the buff channel: negative = takes less damage
            // (leader protections use negative values). Absent → 0 → byte-identical. Like
            // the buff channel, this is DIRECT damage only (DoTs/bombs never read it).
            const preFightIncoming = allActorsById.get(victimId)?.preFight?.incomingDamage ?? 0;
            // #396: the two channels above are a CROSS-STORE meeting point — `enemy.*` reads the
            // victim's ENEMY store and `self*` reads its SELF store, on the same `parsedEffects`
            // key. Under the locked rule (highest tier wins for all buffs/debuffs regardless of
            // which side applied it) those must SHADOW per named family, not add: a self
            // `Defense Down II` (-30) under an enemy `Defense Down III` (-45) leaves the victim at
            // -45, never -75. The delta carries the whole enemy contribution for any family the
            // self side does not have (`own.sum` is 0 there), which is why it REPLACES
            // `enemy.enemyDefenseModifier` / `enemy.incomingDamageModifier` rather than joining
            // them — adding both would double-count every enemy debuff.
            //
            // The comparison list is `victimSelf`, which is exactly what `selfDefense` and
            // `selfIncoming` were folded from — the invariant `shadowedDelta` requires, or the
            // subtraction removes a contribution the totals never contained.
            //
            // `preFightIncoming` and `exposed` stay OUTSIDE the comparison and keep adding: the
            // squad-leader baseline is not a named family, and `Exposed` is a name-keyed one-shot
            // that deliberately does not ride `parsedEffects` (see exposedStatus.ts). Same
            // exclusion #389 made for `modifierAbilities` and `preFight.outgoingDamage`.
            //
            // This also collapses same-family duplicates WITHIN the enemy list, which the previous
            // plain `reduce` did not. That is the same rule, not a new one: two instances of one
            // family never add, whichever store they came from.
            const shadow = shadowedDelta(
                familiesOf(victimDebuffs, VICTIM_INCOMING_CHANNELS),
                victimSelf,
                VICTIM_INCOMING_CHANNELS
            );
            return {
                enemyDefenseModifier: selfDefense + (shadow.delta.defense ?? 0),
                incomingDamageModifier:
                    selfIncoming + (shadow.delta.incomingDamage ?? 0) + preFightIncoming + exposed,
                // #358 ADDENDUM 3 (C2/C3): the VICTIM-SIDE half of the sum above, published
                // separately because the sum is a MIXED channel and nothing downstream can
                // un-mix it. `enemy.incomingDamageModifier` and `exposed` are amplification the
                // ATTACKER's side applied — part of the attack as thrown; `selfIncoming` and
                // `preFightIncoming` are the DEFENDER reducing what it takes. "Damage absorbed"
                // strips only the latter pair, so only the latter pair travels here.
                // See `VictimDefenseProfile.victimSideIncomingPct` for the failure this fixes.
                // #396: a self-sourced instance the enemy side SHADOWED is no longer in the
                // channel at all, so it must not be reported as a victim-side reduction either —
                // otherwise "damage absorbed" would strip a term the mixed total no longer holds.
                victimSideIncomingModifier:
                    selfIncoming - (shadow.ownSuppressed.incomingDamage ?? 0) + preFightIncoming,
            };
        };
        // TEST-ONLY: expose victimIncomingModifiers (enemy-debuff + friendly self-buff term,
        // D-PR12) to unit tests that assert per-victim modifier reads. Inert in production (never set).
        input.__testTapVictimEnemyModifiers?.(victimIncomingModifiers);
        input.__testTapIsStasised?.(isStasised);

        // Sub-project I, PR I2 (Layer 3) — per-victim OUTGOING modifier delta for enemy-
        // status-gated auras (Tygr "+30% to Stasis/Disable enemies", Incinerator "+30% to
        // Inferno enemies", Lodolite "+15% to Concentrate Fire/Stealth enemies"). The firing
        // turn's `positionalScalars.outgoingDamageBuffPct` already folds `modifierAbilities`
        // ONCE against `primaryCtx` (the bound/primary target's enemy-status, I1). Here we
        // re-fold the SAME abilities against a per-victim ctx (only the enemy-status fields
        // swapped to THIS victim's own status) and subtract the primary-ctx fold — every
        // non-enemy-status modifier (attack/crit/self-buff-gated outgoing, etc.) contributes
        // identically to both folds and cancels, isolating the pure per-victim delta.
        //
        // CAUSALITY: the per-victim status MUST be a PRE-TURN snapshot, not a live re-read at
        // apply time. `drivePositionalApply` runs AFTER `runPlayerTurn` returns, by which point
        // this turn's OWN debuff-inflict ability has already mutated the status engine — a live
        // read at that point would let a skill's own same-turn infliction retroactively satisfy
        // its own per-victim gate (exactly the anti-causality bug I1 guards against for the
        // PRIMARY target via buildTurnArgs's pre-turn `enemyDebuffNamesForTarget(tgt)` call).
        // `snapshotPreTurnVictimStatus` is called by each of the three turn sites BEFORE their
        // `runPlayerTurn` call, capturing every living opposing actor's status at that moment;
        // `perVictimOutgoingDeltaPct` below reads ONLY from that frozen snapshot.
        //
        //  - enemyDebuffNames: rebuilt from the snapshot (I1's per-target name read,
        //    `enemyDebuffNamesForTarget`), but ONLY when primaryCtx already carries the array
        //    (the DPS-parity sentinel: undefined means "not opted in" and must stay undefined
        //    here too — though this path only runs from the positional apply branch, where the
        //    primary ctx is always real/positional and the array is always populated).
        //  - enemyBuffNames: rebuilt from the snapshot for JUST this victim (the per-turn
        //    primaryCtx uses a UNION across every living enemy attacker — see
        //    enemyBuffNamesUnion above — which is correct for "does an enemy have X" REACTIVE
        //    gates but not for a per-victim OUTGOING-damage aura; the locked game rule (spec §2)
        //    requires each victim's OWN status here).
        //  - enemyHpPct: rebuilt from the snapshot's pre-turn currentHp/stats.hp reading (the
        //    primary ctx's value is a turn-start snapshot of the BOUND target only).
        //  - enemyType: NOT rebuilt — no per-enemy-attacker class field is plumbed on
        //    positional inputs today (only one fight-wide `input.enemyType`), so every victim
        //    reuses the primary ctx's value. Inert for every I2-scoped ship (none gate their
        //    outgoing modifier on `enemy-type`); a future enemy-type-gated per-victim aura
        //    needs real per-actor class plumbing first (deferred, not modeled here).
        //
        // For the PRIMARY target in a single-enemy fight this ctx is IDENTICAL to primaryCtx
        // (delta = 0) — byte-identical to I1. A ship with no enemy-status-gated outgoing
        // modifier also gets delta = 0 for every victim (the fold never differs by ctx).
        interface PreTurnVictimStatusSnapshot {
            enemyDebuffNames: string[];
            enemyBuffNames: string[];
            enemyHpPct: number;
        }
        const snapshotPreTurnVictimStatus = (
            opposingLiving: CombatActor[]
        ): Map<string, PreTurnVictimStatusSnapshot> =>
            new Map(
                opposingLiving.map((v) => [
                    v.id,
                    {
                        enemyDebuffNames: enemyDebuffNamesForTarget(v),
                        enemyBuffNames: selfBuffNamesForOwners(statusEngine, [v.id]),
                        enemyHpPct:
                            v.stats.hp > 0
                                ? Math.max(0, Math.min(100, (100 * v.currentHp) / v.stats.hp))
                                : 100,
                    },
                ])
            );
        const perVictimOutgoingDeltaPct = (
            perVictimOutgoing: PlayerTurnResult['perVictimOutgoing'],
            preTurnStatus: Map<string, PreTurnVictimStatusSnapshot> | undefined,
            victim: CombatActor
        ): number => {
            if (!perVictimOutgoing) return 0;
            const { modifierAbilities, primaryCtx } = perVictimOutgoing;
            if (modifierAbilities.length === 0) return 0; // fast path — nothing to re-fold
            // Defensive fallback: a victim absent from the snapshot (should never happen — the
            // snapshot covers the FULL opposing roster captured pre-turn) contributes delta 0
            // rather than crashing.
            const snap = preTurnStatus?.get(victim.id);
            if (!snap) return 0;
            const victimCtx: ConditionContext = {
                ...primaryCtx,
                ...(primaryCtx.enemyDebuffNames !== undefined
                    ? { enemyDebuffNames: snap.enemyDebuffNames }
                    : {}),
                enemyBuffNames: snap.enemyBuffNames,
                enemyHpPct: snap.enemyHpPct,
            };
            const full = modifierTotalsFromAbilities(modifierAbilities, victimCtx).outgoingDamage;
            const base = modifierTotalsFromAbilities(modifierAbilities, primaryCtx).outgoingDamage;
            return full - base;
        };

        /**
         * ONE victim's defensive profile for a positional damage read.
         *
         * Extracted verbatim from `drivePositionalApply`'s inline `defenseProfileOf` (SP-4b-2 D6)
         * so the passive-slot instance resolves against the SAME per-victim modifier state the
         * firing hit does, rather than growing a second, drifting copy. Identical across all three
         * cast sites (B1/PR7b + D-PR12) and direction-agnostic: `victimIncomingModifiers(v.id)`
         * keys the victim's own store whether it is an enemy or a player.
         */
        const victimDefenseProfileOf = (
            v: CombatActor,
            opts: {
                scheduledEnemyEffects?: SelectedGameBuff[];
                perVictimOutgoing?: PlayerTurnResult['perVictimOutgoing'];
                preTurnVictimStatus?: Map<string, PreTurnVictimStatusSnapshot>;
            }
        ): VictimDefenseProfile => {
            const m = victimIncomingModifiers(v.id, opts.scheduledEnemyEffects);
            return {
                // SP-F F5: Meatshield defense-substitution (approximation) — see the
                // substitutedDefenceFor doc comment above for the full rule.
                defence: substitutedDefenceFor(v, v.stats.defence),
                // B1/PR7b: per-victim defense-debuff sourcing (was hardcoded 0).
                // Addendum A2: ALSO the victim's own self-sourced defence modifiers (Defense Up,
                // and by the A5 ruling the negative Overload/Supercharged half) — see the
                // `selfDefense` block in victimIncomingModifiers for why they ride this channel
                // rather than being folded into `defence` above.
                // Direction-agnostic — v.id keys the victim's own enemy-debuff AND self-buff
                // stores regardless of side.
                defenceModifierPct: m.enemyDefenseModifier,
                // B1/PR7b + D-PR12: per-victim incoming-damage modifier; combines
                // enemy-debuff (Out. Damage Up) AND victim's own self-buffs (Inc. Damage
                // Down/Up). Attacker-sourced scalars (outgoing buff, pen) stay attacker-fixed.
                incomingDamageModifierPct: m.incomingDamageModifier,
                // #358 ADDENDUM 3 (C2): the victim-side half of that same sum, so
                // `victimHitDamageParts` can strip it from the PRE-mitigation axis only. `damage`
                // still folds the whole mixed channel — this field never touches it.
                victimSideIncomingPct: m.victimSideIncomingModifier,
                affinity: v.affinity ?? 'antimatter',
                // Sub-project I, PR I2: this footprint victim's own enemy-status-gated
                // outgoing-modifier delta vs the attacker-fixed positionalScalars term.
                outgoingDamageDeltaPct: perVictimOutgoingDeltaPct(
                    opts.perVictimOutgoing,
                    opts.preTurnVictimStatus,
                    v
                ),
                // SP-F F4: this victim's 'Defensive Affinity Override' (Isha/Nayra) forces
                // the incoming attacker to affinity DISADVANTAGE against it. Detected per
                // victim (anchor AND covered) via the victim's own self-buff store — the
                // positional counterpart to playerTurn's `victimHasDefensiveOverride`.
                forceAffinityDisadvantage: selfBuffNamesForOwners(statusEngine, [v.id]).includes(
                    'Defensive Affinity Override'
                ),
            };
        };

        // Shared positional-apply driver (Task 9, Step A) — the ONE place the three attack
        // sites (focus / walked-team / enemy) drive `applyPositionalDamage`. Each site has
        // already GATED (isPositional + non-null target/pattern/positionalScalars) and computed
        // its own `positional` flag (also used for credit suppression); this helper just runs the
        // per-victim apply against the resolved inputs. What differs per site is parameterized:
        //  - `scalars`/`hitCrits` — sourced from that site's turn result,
        //  - `pattern`/`target` — that actor's parsed pattern + parsed target,
        //  - `opposingLiving` — focus/team → enemyAttackerActors; enemy → allPlayerActors,
        //  - `applyToVictim` — focus/team → applyOutgoingToEnemy; enemy → applyIncomingToTarget,
        //  - `acting` — the firing actor's position / ignoresForcedTargeting / id (for provokerOf).
        // `defenseProfileOf` is identical across all three sites (B1/PR7b + D-PR12: wired to
        // victimIncomingModifiers — reads the victim's OWN per-actor enemy-debuff store AND
        // the victim's own self-buff store (both channels: scheduled + ability payload).
        // Direction-agnostic: victimIncomingModifiers(v.id) works for ENEMY victims
        // (focus/team site) and PLAYER victims (enemy site) alike.
        // No emitHit: this pure driver emits nothing. On the positional path runPlayerTurn defers
        // its `ability-performed` to the engine, which emits one per SUB-ATTACK from the outcomes
        // this driver returns (see drivePositionalTurnApply's interleaved emission block).
        // Per-HIT event fidelity below the sub-attack — one event per (hit, victim) pair — remains
        // a documented follow-up.
        const drivePositionalApply = (args: {
            scalars: AttackerDamageScalars;
            // hitCrits is co-populated with positionalScalars by Task 7 (both are set iff a damage
            // ability fired), so the `?? []` below is DEFENSIVE only — never empty when scalars != null.
            hitCrits?: boolean[];
            pattern: ParsedPattern;
            target: ParsedTarget;
            actingPosition: Position;
            ignoresForcedTargeting?: boolean;
            /** W6: ship-wide stealth-targeting bypass. */
            ignoresStealth?: boolean;
            actingId: string;
            opposingLiving: CombatActor[];
            /** SP-4b-2 D4: this turn's landed scheduled enemy effects, from the acting
             *  `PlayerTurnResult`. Feeds `defenseProfileOf` so the per-victim damage read honours
             *  the same landing/resist decision the turn's reporting fold made. */
            scheduledEnemyEffects?: SelectedGameBuff[];
            applyToVictim: (
                victim: CombatActor,
                damage: number,
                isAnchor?: boolean,
                /** A2: the defence mitigation factor already folded into `damage` for this
                 *  victim — forwarded into `cause.targetMitigation` so the Protection cascade
                 *  divides by the factor that was applied instead of re-deriving one. */
                targetMitigation?: number,
                /** #358 ADDENDUM 2 — the pre-defence twin of `damage`. */
                preMitigation?: number
            ) => VictimDamageOutcome;
            // E2 (per-victim leech): OPTIONAL per-direction hook. drivePositionalApply is ONE
            // helper shared by all three sites (focus / team / enemy); since standing (player→
            // enemy) and taken (enemy→player) leech need opposite logic, each site supplies its
            // own callback (Tasks 3/5) rather than branching inside the shared inline path.
            // Unsupplied by every current caller → fully inert.
            // PR2 Task 2: widened with PR1's trailing `subAttackIndex`. PR1 added it to
            // applyPositionalDamage's own callback contract but NOT to this engine-side wrapper
            // type, so the parameter was reachable at runtime (the hook is forwarded verbatim,
            // below) yet un-typeable by a caller. Trailing and optional, so callers that ignore
            // it keep compiling.
            onVictimResolved?: (
                victim: CombatActor,
                damage: number,
                outcome: VictimDamageOutcome,
                didCrit: boolean,
                subAttackIndex?: number
            ) => void;
            // Per-victim crit resolver (per-victim crit). The anchor victim reuses hitCrits[h];
            // each COVERED footprint victim rolls the attacker's crit gate at ITS OWN affinity-
            // capped rate via this callback. Unsupplied → every victim uses hitCrits[h] →
            // byte-identical. Each call site supplies the firing turn's rollVictimCrit.
            rollVictimCrit?: (victim: CombatActor) => boolean;
            // Sub-project I, PR I2: this turn's enemy-status-gated outgoing-modifier ingredients
            // (modifierAbilities + primaryCtx), forwarded from `turn.perVictimOutgoing`.
            // Unsupplied/undefined → perVictimOutgoingDeltaPct short-circuits to 0 for every
            // victim → byte-identical.
            perVictimOutgoing?: PlayerTurnResult['perVictimOutgoing'];
            // Sub-project I, PR I2: the PRE-TURN per-victim status snapshot (captured by the
            // call site via `snapshotPreTurnVictimStatus` BEFORE `runPlayerTurn` ran this turn),
            // keyed by victim id. Required for a non-zero delta — see the causality note above
            // perVictimOutgoingDeltaPct. Unsupplied → delta stays 0 for every victim.
            preTurnVictimStatus?: Map<string, PreTurnVictimStatusSnapshot>;
            // PR8: applyPositionalDamage's sub-attack boundary hooks (Task 2), forwarded verbatim
            // below. Widened here for the same reason PR2 Task 2 had to widen `onVictimResolved`:
            // this engine-side wrapper declares its OWN args type, so a hook that exists on
            // applyPositionalDamage is un-typeable by an engine caller until it is repeated here.
            // Unsupplied by a caller → no boundary work → byte-identical.
            onSubAttackStart?: (sub: {
                index: number;
                anchorId: string;
                victimIds: string[];
            }) => void;
            onSubAttackEnd?: (sub: {
                index: number;
                anchorId: string;
                victimIds: string[];
            }) => void;
        }): {
            anyCrit: boolean;
            critPairs: number;
            critVictimIds: string[];
            // PR2 Task 3: PR1's per-sub-attack outcomes. applyPositionalDamage has always returned
            // them (the object below is forwarded verbatim); this declaration merely stops hiding
            // them from the callers that now emit one `ability-performed` per entry.
            subAttacks: SubAttackOutcome[];
        } => {
            // ONE amplification verdict per (ability, sub-attack), for THIS cast only (multi-hit
            // full-walk epic, PR4 — spec §4.3). A multi-hit skill is N consecutive attacks, each
            // drawing its own roll (R1); an AoE footprint is ONE attack whose victims share a
            // single roll (R3). Declared here, per cast — `drivePositionalApply` runs once per cast
            // — so a later turn's sub-attack 0 can never reuse this turn's verdict.
            //
            // Drawn LAZILY, from inside `outgoingAmplificationForHit`, which checks `conditionMet`
            // before it calls `rollProc`. That is what preserves "eligibility gates the gate": a
            // sub-attack whose every victim is ineligible (nothing crit / no higher-attack target)
            // still advances nothing. It is also why the roll cannot simply be hoisted into
            // runPlayerTurn — eligibility for 'amplify-vs-higher-attack' is per victim, and on this
            // path so is crit.
            const ampVerdictBySubAttack = new Map<string, boolean>();
            // Task 3: this is the ONE deferred (positional) apply path — reflects fired here must
            // buffer their log row until emitDeferredAbilityPerformed creates the attack entry
            // (see the deferReflectLogs doc above applyVictimDamage). try/finally so the flag
            // always clears, even if applyPositionalDamage throws.
            deferReflectLogs = true;
            try {
                return applyPositionalDamage({
                    hitCrits: args.hitCrits ?? [],
                    scalars: args.scalars,
                    pattern: args.pattern,
                    actorPosition: args.actingPosition,
                    target: args.target,
                    opposingLiving: args.opposingLiving,
                    statusOf: statusLookupFor(args.opposingLiving),
                    acting: {
                        ignoresForcedTargeting: args.ignoresForcedTargeting,
                        ignoresStealth: args.ignoresStealth,
                        provokedBy: provokerOf(statusEngine, args.actingId),
                    },
                    defenseProfileOf: (v) =>
                        victimDefenseProfileOf(v, {
                            scheduledEnemyEffects: args.scheduledEnemyEffects,
                            perVictimOutgoing: args.perVictimOutgoing,
                            preTurnVictimStatus: args.preTurnVictimStatus,
                        }),
                    // PR2 Task 3: stamp the sub-attack under application so the funnel's deferred
                    // LOG buffers (reflect rows + consequence twins) can be drained per sub-attack
                    // rather than all under the first attack row. Save/restore rather than clear:
                    // a reflect proc re-enters the funnel from INSIDE this call and still belongs
                    // to the same sub-attack.
                    applyToVictim: (
                        victim,
                        damage,
                        isAnchor,
                        subAttackIndex,
                        targetMitigation,
                        preMitigation
                    ) => {
                        const prevSubAttack = currentSubAttackIndex;
                        currentSubAttackIndex = subAttackIndex;
                        try {
                            return args.applyToVictim(
                                victim,
                                damage,
                                isAnchor,
                                targetMitigation,
                                preMitigation
                            );
                        } finally {
                            currentSubAttackIndex = prevSubAttack;
                        }
                    },
                    // Pure ACCUMULATOR (not a bus emit): record per-victim damage into the
                    // per-round map so the RoundData row can expose perTargetDamage. Identical
                    // across all three sites (focus / team / enemy), so it lives here.
                    // §4.5 NOTE: the Stasis break is NOT wired here. It fires via `onHitBreakStasis`
                    // inside runPlayerTurn (BEFORE the ability timed-debuff loop) so a Stasis
                    // re-application from the same attack's debuff ability is not inadvertently
                    // removed. The break fires for the resolved `targetId` (the selected victim);
                    // AoE footprint victims are a future Task-3 follow-up.
                    emitHit: (victim, damage) => {
                        roundPerTargetDamage.set(
                            victim.id,
                            (roundPerTargetDamage.get(victim.id) ?? 0) + damage
                        );
                        // SP-F F1: args.actingId (closed over from drivePositionalApply's
                        // caller) is the firing attacker for every footprint victim (anchor AND
                        // covered) this hit landed on.
                        creditDealt(args.actingId, victim.id, damage);
                    },
                    // E2: forward the per-direction leech hook (unsupplied by all current callers).
                    onVictimResolved: args.onVictimResolved,
                    // PR8: forward the sub-attack boundary hooks (the per-sub-attack debuff landing).
                    onSubAttackStart: args.onSubAttackStart,
                    onSubAttackEnd: args.onSubAttackEnd,
                    // Per-victim crit: forward the firing turn's per-victim crit resolver.
                    rollVictimCrit: args.rollVictimCrit,
                    // D-PR3: per-victim, per-sub-hit incoming %-reduction. Shared across all three
                    // sites (focus / walked-team / enemy) since drivePositionalApply makes ONE
                    // applyPositionalDamage call. incomingReductionForHit returns 0 for actors with
                    // no incoming-reduction ability → byte-identical when no such equipment exists.
                    //
                    // #358 ADDENDUM 3 — NOT A PURELY VICTIM-SIDE CHANNEL. On a CRIT this used to
                    // return ONE fused number covering three terms, two of which belong to the
                    // victim and one of which belongs to the ATTACKER (its squad-leader
                    // `outgoingCritDamage` penalty). "Damage absorbed" strips victim-side
                    // reductions only, and a fused number cannot be un-mixed downstream — the
                    // atomic-mixed-channel trap that C3 was written about, one layer deeper. The
                    // attacker's own penalty makes the attack smaller AS THROWN, so it must reach
                    // the pre-mitigation axis intact. Hence the SPLIT return on the crit path.
                    // (It is unreachable from `DefenseSimulationInput` today, which is precisely
                    // why it needed writing down rather than leaving to the next reader.)
                    incomingReductionFor: (victim, didCrit) => {
                        const equip = incomingReductionForHit(incomingAbilitiesOf(victim.id), {
                            didCrit,
                            attackerStealthed: isStealthed(args.actingId),
                            victimStealthed: isStealthed(victim.id),
                            victimStasised: isStasised(victim.id),
                            hitIndexThisRound: 0, // unused by reduction (only block reads it)
                            attackerHasDot: attackerHasDot(args.actingId),
                            victimHasBarrierRecharging: hasBarrierRecharging(victim.id),
                            victimHasShield: hasShield(victim.id),
                            selfHpPct: selfHpPctOf(victim.id),
                            attackerTauntedOrProvoked: attackerTauntedOrProvoked(args.actingId),
                        });
                        // A non-crit hit reads no crit-family term at all, so the whole reduction
                        // is victim-side and the bare-number form says exactly that.
                        if (!didCrit) return equip;
                        // F3 crit-conditional pre-fight damage modifiers, gated per sub-hit on
                        // didCrit — the SAME crit-family mechanism as the equip reduction above
                        // (a hit that crits sees the extra reduction on its whole damage).
                        // SIGN CONVENTION: this channel is a REDUCTION (positive = less damage),
                        // while the leader data is benefit/penalty-phrased pct points:
                        //   victim incomingCritDamage  -10 → takes 10% smaller crits → +10 reduction;
                        //   attacker outgoingCritDamage -10 (Negotiator III on enemies) → its crits
                        //   deal 10% less → +10 reduction; positive values invert symmetrically.
                        // Hence both terms are NEGATED. Absent → 0 → byte-identical.
                        const victimCritTerm = -(victim.preFight?.incomingCritDamage ?? 0);
                        const attackerCritTerm = -(
                            allActorsById.get(args.actingId)?.preFight?.outgoingCritDamage ?? 0
                        );
                        // WHICH SIDE OWNS WHICH TERM: `victimCritTerm` is the VICTIM taking
                        // smaller crits (a reduction it owns → comes off "damage absorbed");
                        // `attackerCritTerm` is the ATTACKER's crits landing smaller (the attack
                        // as thrown → stays on both axes). `victimHitDamageParts` re-sums the two
                        // halves in this same left-to-right order before subtracting, so `damage`
                        // is byte-identical to the pre-split fused number.
                        return {
                            victimSidePct: equip + victimCritTerm,
                            attackerSidePct: attackerCritTerm,
                        };
                    },
                    // D-PR4: attacker-side outgoing amplification (Menace/Giant Slayer), per footprint
                    // victim per sub-hit. outgoingAmplificationForHit returns 0 for attackers with no
                    // outgoing-amplification ability → byte-identical when no such equipment exists.
                    outgoingAmplificationFor: (victim, didCrit, subAttackIndex) => {
                        // Fast path: skip the per-victim effectiveStatsOf folds when the attacker has no
                        // outgoing-amplification ability (the overwhelmingly common case) — matches the
                        // aggregate path's `ampAbilities.length > 0` guard. Byte-identical (returns 0).
                        const outs = outgoingAbilitiesOf(args.actingId);
                        if (outs.length === 0) return 0;
                        const attacker = allActorsById.get(args.actingId);
                        if (!attacker) return 0;
                        return outgoingAmplificationForHit(
                            outs,
                            {
                                didCrit,
                                targetHigherAttack:
                                    effectiveStatsOf(statusEngine, selfBuffLookup, victim).attack >
                                    effectiveStatsOf(statusEngine, selfBuffLookup, attacker).attack,
                            },
                            (abilityId, chance) => {
                                // PR4: the verdict belongs to the SUB-ATTACK, not to this victim —
                                // one roll decides *whether*, each victim decides *if it qualifies*
                                // (its own `conditionMet`, checked before this closure is reached).
                                // `subAttackIndex` is optional on PR1's callback contract; `?? 0`
                                // makes a caller that omits it behave as the single sub-attack it
                                // is. Scoped to `ampVerdictBySubAttack`, which is per cast.
                                const key = `${abilityId}:${subAttackIndex ?? 0}`;
                                const cached = ampVerdictBySubAttack.get(key);
                                if (cached !== undefined) return cached;
                                const verdict = rollRateGate(
                                    procChanceGates,
                                    `${args.actingId}:${abilityId}`,
                                    chance
                                );
                                ampVerdictBySubAttack.set(key, verdict);
                                return verdict;
                            }
                        );
                    },
                });
            } finally {
                deferReflectLogs = false;
            }
        };

        // ── SP-4b-2 D6: the passive-slot damage instance's own positional apply ───────────
        /**
         * ONE cast's PASSIVE-SLOT damage instance (`PlayerTurnResult.passiveSlotHit`) — the design
         * notes for the pair below (`passiveSlotPattern` + `stagePassiveSlotHit`).
         *
         * WHY THIS EXISTS. The always-active passive slot can carry its own gated `damage`
         * ability — Judge's "At the start of the round, this Unit deals 60% damage to all enemies
         * with less than 50% HP". `runPlayerTurn` computes it and folds it into the aggregate
         * `directDamage`, which is the whole story on a NON-positional cast. On a POSITIONAL cast
         * the scalar direct credit is suppressed and the round's damage is re-derived from the
         * per-victim apply — whose payload is the FIRING skill's `positionalScalars`. The passive
         * instance reached neither channel: computed, then dropped (measured, Judge fixture:
         * round-4 `directDamage` 23000 where the pre-positional engine reported 29000).
         *
         * FOOTPRINT / TARGETING — the design call, and it is NOT the firing hit's.
         * The instance resolves its OWN footprint from the passive damage ability's OWN `target`.
         * Justification, against the ability's own targeting data rather than against what makes
         * one fixture pass:
         *   1. `target` is a field of the ABILITY, and the two disagree in the real kit: Judge's
         *      passive is `all-enemies` while its firing skill is single-`enemy`. Honouring the
         *      firing hit's footprint would silently rewrite "all enemies" to "one enemy".
         *   2. A PATTERN belongs to a SLOT, not to the ship — `activePattern` and `chargedPattern`
         *      are separate columns of the targeting data, and the passive slot has neither.
         *      Inheriting the firing slot's pattern would make a passive's reach depend on whether
         *      the ship happened to fire its active or its charged skill this round, which is not
         *      a property of the passive at all.
         *   3. It is wrong in BOTH directions, so "share the footprint" cannot be rescued by the
         *      single-target case: an AoE firing cast would also spread a `target: 'enemy'`
         *      passive across the whole footprint, at half damage on covered cells.
         * The multi-victim test pins both directions.
         *
         * WHAT IT DELIBERATELY DOES NOT DO. It emits no `ability-performed` and no `attacked`, and
         * fires no outgoing rider — because the passive instance never had any of those. On the
         * non-positional path it was a pure ADDEND on `directDamage`: no event, no rider, no
         * separate attack row. This restores parity; inventing an event stream for it would be a
         * new mechanic, not a fix. Crit is likewise NOT re-decided here — `hit.didCrit` was fixed
         * in `runPlayerTurn` (`noCrit` honoured, otherwise the round's own draw reused) and every
         * footprint victim reuses that ONE outcome instead of rolling its own, so NO CRIT DRAW is
         * added and the crit stream's schedule is untouched.
         *
         * WHAT IT DOES DRAW AND PROVOKE — read this before repeating "the instance draws no RNG",
         * which is true of CRIT only and false in general. It IS a real damage instance: it goes
         * through the real per-victim funnel (`tb.applyToVictim` → `applyOutgoingToEnemy`, which
         * passes `byDirectDamage: true`) and the real per-victim defence profile, so shields,
         * Barrier, Cheat Death, Protection and the per-victim credit channel (`perTargetDealt`)
         * all see it like any other damage source. Concretely, against a victim that carries one:
         *   • an `incoming-block` ability — the instance ADVANCES that victim's
         *     `directIntakeIndex` (so it counts as an nth direct hit for `nth-hit-2plus`) and
         *     ROLLS a `makeRateGate` draw on the victim's own `<id>:proc` sub-stream, which can
         *     also spend an `oncePerRound` block. Both are pinned in
         *     `passiveSlotDamageFootprint.integration.test.ts`.
         *   • a `damage-reflection` ability — the instance sets neither `isReflected` nor
         *     `isCounter`, so it PROVOKES thorns back at the attacker exactly as the firing hit
         *     does. (`isAnchor: false` below still exempts it from a `requirePrimaryTarget`
         *     reflect — Nosorog — since it is not the cast's primary-target hit.)
         * All of that is the intended reading of "a real damage instance"; it is recorded here so
         * a later change plans around the real footprint rather than a convenient fiction.
         *
         * KNOWN GAPS — (a) below is now FIXED (spec §3, site 4); (b) is real, corpus-bounded
         * today, and deliberately UNFIXED here. Recorded in code rather than in a task report so
         * the next change to this helper does not have to rediscover them.
         *   (a) FIXED (spec §3, site 4) for the OUTGOING direction, and correctly absent for the
         *       incoming one. The apply loop below now calls `procStandingLeechesPerVictim(…,
         *       'direct')`, so the ACTOR's standing damage-dealt leech pays out on this instance —
         *       restoring what the pre-positional path paid when `passiveDamage` folded into the
         *       aggregate `directDamage`.
         *       It deliberately does NOT proc the VICTIM's damage-taken leech, and the earlier
         *       version of this comment was WRONG to call that half a defect. Owner ruling
         *       2026-08-18: a passive-slot instance does not proc a taken leech, because the victim
         *       is not its primary target — Malvex reads "when directly damaged as a PRIMARY
         *       TARGET", Quixilver "when taking HP damage and still having Shield". The repo's
         *       locked granularity rule ("outgoing per attack, incoming per occurrence") governs
         *       HOW OFTEN an incoming proc fires, NOT which channels qualify; which channels
         *       qualify is decided by the ability's own text qualifier. Routing this site through
         *       `procLeechesForVictim` would therefore ship a bug.
         *   (b) A CAST WITH NO FIRING-SLOT DAMAGE ABILITY LOSES ITS PASSIVE INSTANCE ENTIRELY.
         *       Every call site is inside the `positional` branch, and that gate requires
         *       `turn.positionalScalars != null` — the FIRING skill's scalars. A ship whose active
         *       or charged slot carries no `damage` ability therefore never reaches this helper,
         *       and its passive-slot damage is dropped exactly as it was before D6 (the scalar
         *       direct credit is suppressed on a positional run either way). Corpus-inert today:
         *       no shipped kit pairs a damage-dealing passive slot with a damage-less firing slot.
         *
         * It does NOT set `deferReflectLogs`: with no `ability-performed` of its own there is no
         * later row for a buffered reflect to attach to, so a reflect it provokes prints where it
         * happens — the same treatment every non-positional apply gives one.
         *
         * Team-symmetric: ONE helper, called from the focus, walked-team and enemy cast sites with
         * that site's own `tb`.
         */
        const passiveSlotPattern = (abilityTarget: PassiveSlotHit['target']): ParsedPattern => {
            switch (abilityTarget) {
                // The whole opposing board, every occupied cell at ORIGIN role (full damage) —
                // `resolveCells` special-cases shape 'all' and ignores the anchor's geometry.
                case 'all-enemies':
                    return ALL_ENEMIES_PATTERN;
                // ONE enemy: the actor's own resolved anchor. The selector targets
                // (`enemy-most-buffs` / `enemy-highest-attack` / `enemy-highest-speed`) also name
                // exactly one enemy; picking WHICH one needs the drain-time selector machinery in
                // triggers.ts, and every corpus ship carrying one of them fires it through a
                // REACTIVE trigger that already goes through that machinery, so the anchor is both
                // the conservative answer and today's behaviour for them.
                // `adjacent-enemies` / `target-and-adjacent-enemies` genuinely name more than one,
                // but their spread scaling (full or covered-half) is unverified in-game and no
                // corpus passive reaches here with one — they keep today's single-anchor magnitude
                // rather than gaining an invented footprint.
                // Ally-facing targets cannot occur on a `damage` ability; they resolve to the
                // anchor too rather than being silently dropped.
                case 'enemy':
                case 'enemy-most-buffs':
                case 'enemy-highest-attack':
                case 'enemy-highest-speed':
                case 'adjacent-enemies':
                case 'target-and-adjacent-enemies':
                case 'self':
                case 'ally':
                case 'all-allies':
                case 'lowest-hp-ally':
                case 'adjacent-allies':
                    return DEFAULT_BASE_PATTERN;
                default: {
                    // Exhaustiveness guard: a new AbilityTarget variant must be classified here
                    // explicitly rather than silently inheriting a footprint. Ability configs are
                    // user-persisted and unvalidated on read, so a stale/imported config can carry
                    // a target string outside the union at runtime, defeating the compile-time
                    // `never` check — `return _exhaustive` would then hand back that raw string
                    // mistyped as `ParsedPattern`, and a downstream `resolveCells` reading
                    // `.shape`/`.cells` off a string silently yields an empty footprint. Throw
                    // instead: same compile-time exhaustiveness strength, loud instead of silent.
                    const exhaustive: never = abilityTarget;
                    throw new Error(
                        `passiveSlotPattern: unhandled AbilityTarget ${String(exhaustive)}`
                    );
                }
            }
        };
        /**
         * Stage ONE cast's passive-slot instance: RESOLVE its footprint now (before the firing
         * hit lands), return the thunk that APPLIES it afterwards. `undefined` when the instance
         * finds nobody — the caller then has nothing to run.
         *
         * WHY THE SPLIT — the "one turn, one board" invariant. The passive instance and the
         * firing hit are two damage instances of the SAME turn, and neither may gate the other:
         *   • resolve BEFORE, so the firing hit's kill cannot make the passive whiff;
         *   • apply AFTER, so the passive's own kill cannot make the firing hit whiff.
         * That is exactly the invariant the pre-positional engine had for free — it folded both
         * into one `directDamage` lump against one sink, so a lethal round paid out BOTH. Either
         * plain ordering loses one of them on the killing round, and the Judge fixture measures
         * it: firing-first reports 23000 for the final round, passive-first reports 6000, and both
         * of those are the same defect this task exists to remove, merely relocated. The engine's
         * usual live re-resolution (a multi-hit cast's later sub-attacks, `applyPerVictimDetonation`
         * skipping a victim that died to the firing hit) is a WITHIN-CAST rule — R1's "N
         * consecutive full-walk attacks" — and the passive slot is not part of the cast.
         *
         * Overkill is booked, as everywhere else on this path: the pre-positional lump credited
         * the whole 29000 against a 2000-HP enemy too.
         */
        const stagePassiveSlotHit = (
            actor: CombatActor,
            tb: TurnBindings,
            anchor: CombatActor,
            hit: PassiveSlotHit,
            profileOpts: {
                scheduledEnemyEffects?: SelectedGameBuff[];
                perVictimOutgoing?: PlayerTurnResult['perVictimOutgoing'];
                preTurnVictimStatus?: Map<string, PreTurnVictimStatusSnapshot>;
            }
        ): (() => void) | undefined => {
            // The turn's already-resolved anchor IS the turn-start resolution (selectTurnTarget ran
            // before runPlayerTurn). A cast whose selection fell back to the position-less legacy
            // sink has no board anchor, so the instance simply whiffs.
            if (anchor.position === undefined) return undefined;
            const victims = footprintVictims(
                passiveSlotPattern(hit.target),
                anchor.position,
                tb.opposingRoster
            );
            if (victims.length === 0) return undefined;
            return () => {
                let delivered = 0;
                for (const { victim, roleScale } of victims) {
                    // Read the profile ONCE and derive both the hit and the mitigation factor from
                    // it, exactly as the firing hit's positional loop does — so the factor handed
                    // to `applyToVictim` is provably the one baked into `damage`.
                    const defenseProfile = victimDefenseProfileOf(victim, profileOpts);
                    const damageParts = victimHitDamageParts(
                        hit.scalars,
                        defenseProfile,
                        hit.didCrit,
                        roleScale
                    );
                    const damage = damageParts.damage;
                    if (!(damage > 0)) continue;
                    // `isAnchor: false` — this instance is not the cast's primary-target hit, so it
                    // must not satisfy a `requirePrimaryTarget` reflect gate (Nosorog).
                    // 4th arg: this instance is a SECOND positional damage path into the funnel, so
                    // it owes the Protection cascade the same mitigation factor the firing hit
                    // hands down. Omitting it left this path on the fallback re-derivation — the
                    // very defect the firing path was fixed for (penetration and buff-folded
                    // defence both dropped), so a passive-slot instance landing on a protected
                    // victim over-transferred to the protector.
                    const outcome = tb.applyToVictim(
                        victim,
                        damage,
                        false,
                        victimDefenceMitigation(defenseProfile, hit.scalars.defensePenetrationPct),
                        // #358 ADDENDUM 2: the SECOND positional damage path into the funnel owes
                        // it the same pre-defence figure the firing hit hands down.
                        damageParts.preMitigation
                    );
                    // Credit the intake the funnel RECORDED, exactly as the firing hit's emitHit
                    // does — a Protection cascade / incoming block / DoT transform all move the
                    // number, and re-crediting the pre-funnel hit would double-count.
                    const booked = outcome.incomingBooked ?? damage;
                    if (booked > 1e-9) {
                        roundPerTargetDamage.set(
                            victim.id,
                            (roundPerTargetDamage.get(victim.id) ?? 0) + booked
                        );
                        creditDealt(actor.id, victim.id, booked);
                    }
                    // Site 4 of the leech-channel class (spec §3): this instance pays the actor's
                    // standing damage-dealt leech. Channel `'direct'` — it is a direct-damage
                    // intake (it passes `byDirectDamage: true` through `tb.applyToVictim`), so an
                    // `'all'`-scoped leech pays and a `'detonation'`-scoped one does not.
                    //
                    // BASIS: the pre-funnel per-victim `damage`, matching what the firing hit's
                    // seam passes (`positionalApply.ts`'s `onVictimResolved?.(victim, dmg, …)`
                    // hands the leech `dmg`, not `booked`). Whether that basis is right under the
                    // locked "damage dealt = the final on-screen number" rule is a PRE-EXISTING
                    // question for the whole seam and is deliberately out of scope here —
                    // consistency with the existing site beats a unilateral change.
                    //
                    // Standing direction only, never `procLeechesForVictim`: the victim is not this
                    // instance's primary target, so its damage-taken leech does not proc (owner
                    // ruling, spec §2.2).
                    procStandingLeechesPerVictim(actor.id, damage, 'direct');
                    // The ruled "damage dealt" basis (PR7): booked intake PLUS anything a
                    // Protection cascade diverted to protectors.
                    delivered += booked + (outcome.protectionRedirected ?? 0);
                }
                // SP-4b-2 D1: a passive-slot instance is DIRECT damage this actor dealt, so it
                // joins the accumulate-detonate gather exactly like the firing hit does.
                creditPositionalDirect(actor.id, delivered);
            };
        };

        // ── Deferred ability-performed emit helper ────────────────────────────────────
        // Extracted from the four structurally identical bus.emit sites (focus positional,
        // walked-team positional, enemy positional, enemy 0-damage fallback). The caller supplies
        // this event's crit identity — since PR2 that is ONE SUB-ATTACK's `didCrit` /
        // `critVictimIds` on the interleaved path, or the cast-wide per-victim aggregate
        // (`anyCrit` / `critPairs`) on the nothing-landed and 0-damage fallbacks — so each site
        // only passes what it knows.
        //
        // PR2 Task 3: a multi-hit skill is N consecutive full-walk attacks, so a positional cast
        // now calls this ONCE PER SUB-ATTACK (see the interleaved emission block in
        // drivePositionalTurnApply) with that sub-attack's own damage slice and crit identity. `damage` and `subAttack` are therefore explicit
        // parameters rather than being read off `dap`.
        const emitDeferredAbilityPerformed = (
            dap: NonNullable<PlayerTurnResult['deferredAbilityPerformed']>,
            // This event's damage. The cast's `dap.damage` (pre-funnel directDamage) for the
            // single-event paths; that same basis split across the emitting sub-attacks for a
            // multi-hit cast. Deliberately NOT SubAttackOutcome.damage, which is the post-funnel
            // `incomingBooked` sum — a different number, and changing the basis and the
            // cardinality in one PR would conflate two behaviour moves.
            // PR7 resolved that split: the true delivered amount now rides alongside as
            // `deliveredDamage`, and THIS field stays the pre-funnel display basis buildCombatLog reads.
            damage: number,
            didCrit: boolean,
            critHits: number,
            // The DISTINCT enemies this event critically hit (positionalApply's per-victim crit
            // identity). Carried on the event so an `on-ally-crit` reactive can route "that enemy"
            // to the enemies actually crit rather than the cast's SELECTED anchor (which may not
            // have crit at all in an AoE). Empty on the 0-damage fallback path (no apply ran).
            critVictimIds: string[],
            // Which sub-attack this event belongs to, for the deferred-log drain below AND (PR4) as
            // the event's own sub-attack identity. Omitted on the single-event paths ⟹ drain
            // everything (the pre-PR2 behaviour) and emit no index.
            subAttack?: number,
            // PR7: this sub-attack's delivered damage. Omitted on the single-event paths, whose
            // consumers fall back to `damage` — keeping them byte-identical.
            deliveredDamage?: number
        ) => {
            bus.emit({
                type: 'ability-performed',
                actorId: dap.actorId,
                targetId: dap.targetId,
                round: dap.round,
                abilityType: 'damage',
                damage,
                didCrit,
                ...(critHits > 0 ? { critHits } : {}),
                ...(critVictimIds.length > 0 ? { critVictimIds } : {}),
                // PR4: the OUTGOING reactive listeners stamp this onto the intents they enqueue, so
                // the drain (which runs once per turn, after every sub-attack) can gate per
                // sub-attack. Conditional spread → the single-event paths stay byte-identical.
                ...(subAttack !== undefined ? { subAttackIndex: subAttack } : {}),
                ...(deliveredDamage !== undefined ? { deliveredDamage } : {}),
                didHit: true,
            });
            // Task 3: the attack entry now exists — drain the reflect rows THIS sub-attack
            // buffered during the per-victim apply so buildCombatLog nests them UNDER this attack
            // (not a preceding charge/buff entry in the attacker's turn, nor — since PR2 — under
            // an earlier sub-attack's row). No-op when none buffered.
            flushReflectLogs(subAttack);
        };

        // ── Unified per-actor turn resolvers (bySide unification PR6a) ──────────────
        // Resolve the per-actor runtime / parsed target / parsed pattern uniformly so the
        // three runPlayerTurn sites stop hard-coding their own lookups. Each reproduces the
        // exact value its site used before — byte-identical.
        const runtimeFor = (a: CombatActor): PlayerActorRuntime => {
            if (a.side === 'enemy') return enemyPlayerRuntimeByActorId.get(a.id)!;
            if (a.kind === 'attacker') return attackerRuntime;
            return teamRuntimeById.get(a.id)!;
        };
        const parsedTargetFor = (a: CombatActor): ParsedTarget | undefined => {
            if (a.side === 'enemy') return enemyTargetById.get(a.id);
            if (a.kind === 'attacker') return input.target;
            return teamTargetById.get(a.id);
        };
        const parsedPatternFor = (a: CombatActor): ParsedPattern | undefined => {
            if (a.side === 'enemy') return enemyPatternById.get(a.id);
            if (a.kind === 'attacker') return input.pattern;
            return teamPatternById.get(a.id);
        };

        const parsedChargedPatternFor = (a: CombatActor): ParsedPattern | undefined => {
            if (a.side === 'enemy') return enemyChargedPatternById.get(a.id);
            if (a.kind === 'attacker') return input.chargedPattern ?? input.pattern;
            return teamChargedPatternById.get(a.id);
        };

        // SP-F F5: the charged-skill TARGET-selection axis, mirroring parsedChargedPatternFor's
        // contract exactly (falls back to the active target when unset). Together with
        // parsedChargedPatternFor this drives BOTH the damage footprint AND target selection on
        // a charge-firing turn (willFireChargedFor below) at all three damage cast sites.
        const parsedChargedTargetFor = (a: CombatActor): ParsedTarget | undefined => {
            if (a.side === 'enemy') return enemyChargedTargetById.get(a.id);
            if (a.kind === 'attacker') return input.chargedTarget ?? input.target;
            return teamChargedTargetById.get(a.id);
        };

        // SP-F F5: predict whether THIS actor's turn will fire its CHARGED skill, using the
        // EXACT same predicate as runPlayerTurn's own action decision (playerTurn.ts:~1044 —
        // `hasChargedSkill && actor.charges >= chargeCount`). Safe to read here, BEFORE
        // runPlayerTurn is called: advanceChargeCadence (which consumes/resets the charge) runs
        // INSIDE runPlayerTurn, AFTER the decision, so the actor.charges value visible at each
        // engine cast site (before it calls runPlayerTurn) is the SAME value the decision reads.
        // Drives the charge-aware pattern/target resolution below at all three damage cast sites
        // + selectTurnTarget + the buildTurnArgs AoE-purge footprint.
        const willFireChargedFor = (a: CombatActor): boolean =>
            runtimeFor(a).hasChargedSkill && a.charges >= a.chargeCount;

        const sameSideLivingFor = (a: CombatActor): CombatActor[] =>
            actorsBySide(a.side).filter((x) => x.currentHp > 0);

        // ── Unified per-side turn bindings (bySide unification PR6a) ────────────────
        // Per-side values the three runPlayerTurn sites diverge on. Each reproduces the
        // exact value its site used before → byte-identical. PR6b (DONE): decline is now
        // derived inside runPlayerTurn from the struck victim's currentHp — declineFor has
        // been removed from this interface; the credit/intake & emit TAILS stay per-kind (→ PR7).
        interface TurnBindings {
            opposingRoster: CombatActor[];
            // SP-4e (#335): there is NO per-side fallback victim any more. `legacyVictim` used to
            // live here — the dummy sink on the player side (deleted in SP-4c-2d) and the heal
            // target on the enemy side. Both are gone: an actor that resolves no living positional
            // victim runs a NO-VICTIM turn on either side. Do not reintroduce a stand-in; the
            // absence of a victim is the answer, and `runPlayerTurn`/`buildTurnArgs` already speak
            // it (contract §B).
            victimDefenceFor: (tgt: CombatActor) => number;
            victimMaxHpFor: (tgt: CombatActor) => number;
            enemyTypeArg: EnemyBaseClass | undefined;
            enemyBuffNamesUnion: () => string[];
            // Sub-project I, PR I5 — count (not union) of opposing actors holding Stealth.
            stealthedEnemyCount: () => number;
            healEventOnly: boolean;
            // Matches drivePositionalApply's applyToVictim param type exactly. E2: returns the
            // resolved VictimDamageOutcome (both impls wrap applyOutgoingToEnemy /
            // applyIncomingToTarget, which already surface it from E1). Epic PR12 (A): third
            // param forwards drivePositionalApply's isAnchor through to applyVictimDamage's
            // cause.isPrimaryTarget (Nosorog's reflect gate). A2: the fourth param forwards the
            // defence mitigation factor the positional loop already applied, so the Protection
            // cascade can divide by it rather than re-deriving one (see `cause.targetMitigation`).
            applyToVictim: (
                victim: CombatActor,
                damage: number,
                isAnchor?: boolean,
                targetMitigation?: number,
                /** #358 ADDENDUM 2 — the pre-defence twin of `damage`. */
                preMitigation?: number
            ) => VictimDamageOutcome;
        }
        const playerTurnBindings: TurnBindings = {
            opposingRoster: enemyAttackerActors,
            // SP-F F5: Meatshield defense-substitution (approximation) — see the
            // substitutedDefenceFor doc comment above for the full rule.
            victimDefenceFor: (tgt) => substitutedDefenceFor(tgt, tgt.stats.defence),
            victimMaxHpFor: (tgt) => tgt.stats.hp,
            enemyTypeArg: enemyType,
            enemyBuffNamesUnion: playerEnemyBuffNames,
            stealthedEnemyCount: playerStealthedEnemyCount,
            healEventOnly: false,
            applyToVictim: (victim, damage, isAnchor, targetMitigation, preMitigation) =>
                applyOutgoingToEnemy(damage, victim, isAnchor, targetMitigation, preMitigation),
        };
        const enemyTurnBindings: TurnBindings = {
            opposingRoster: allPlayerActors,
            // SP-F F5: Meatshield defense-substitution (approximation) — see the
            // substitutedDefenceFor doc comment above for the full rule.
            victimDefenceFor: (tgt) =>
                substitutedDefenceFor(
                    tgt,
                    lastTurnCtxByActor.get(tgt.id)?.effectiveDefence ?? baseDefenceFor(tgt.id)
                ),
            victimMaxHpFor: (tgt) => recipientMaxHp(tgt.id),
            enemyTypeArg: undefined,
            // Opposing side from the ENEMY's view = the player team, so `enemyBuffNames` here is the
            // UNION of PLAYER self-buff names (fed to the enemy's own `enemy-buff` gates). A bare
            // enemy has no such gate → inert today; computed for the full-kit enemy.
            enemyBuffNamesUnion: enemyEnemyBuffNames,
            stealthedEnemyCount: enemyStealthedEnemyCount,
            healEventOnly: true,
            // An enemy supporter running runPlayerTurn grants charges to its OWN (enemy) team via
            // bySide('enemy').grantAllyCharges (resolved in buildTurnArgs by side), NEVER the player
            // team. Likewise applyToVictim routes the firing hit as INCOMING damage to the struck
            // player actor (applyIncomingToTarget), not as a player damage row.
            applyToVictim: (victim, damage, isAnchor, targetMitigation, preMitigation) =>
                applyIncomingToTarget(
                    damage,
                    victim,
                    // The default `cause` only materializes when the arg is OMITTED, so passing
                    // targetMitigation means restating the direct-damage defaults it carries.
                    {
                        killerId: actingActorId,
                        byDirectDamage: true,
                        targetMitigation,
                        preMitigationDamage: preMitigation,
                    },
                    isAnchor
                ),
        };
        const turnBindings = (side: Side): TurnBindings =>
            side === 'player' ? playerTurnBindings : enemyTurnBindings;

        // Shared per-victim skill-triggered detonation loop. Each victim hit by the cast
        // that is STILL ALIVE detonates its OWN containers (no role-scale). Bombs = full
        // shield drain/no pen; inferno+corrosion BYPASS shield. Credited to the detonating
        // actor's per-round detonation tally + roundPerTargetDamage; NOT into cumulativeDamage
        // (HP lands per-victim via applyVictimDamage). Used by the focus (player→enemy),
        // enemy (enemy→player), and walked-team (player→enemy) sites — the ONLY difference
        // between call sites is the sink + the recipe source + the per-side tb.
        const applyPerVictimDetonation = (
            recipe: DetonationRecipe,
            victims: Map<string, CombatActor>,
            sink: DamageAccountingSink,
            actorId: string,
            tb: TurnBindings
        ): void => {
            for (const victim of victims.values()) {
                if (victim.currentHp <= 0) continue; // died to the firing hit (already splashed)
                const result = detonateContainers(recipe, {
                    corrosionEntries: victim.corrosionEntries,
                    infernoEntries: victim.infernoEntries,
                    pendingBombs: victim.pendingBombs,
                    victimHp: tb.victimMaxHpFor(victim),
                });
                let bombDelivered = 0;
                if (result.bomb > 0) {
                    const bombOutcome = applyVictimDamage(result.bomb, victim, sink, {
                        killerId: actorId,
                        byDirectDamage: true,
                        bombPortion: result.bomb, // full shield drain, no pen
                        shieldPenetrationPct: 0,
                    });
                    bombDelivered = detonationDelivered(bombOutcome);
                    bus.emit({
                        type: 'bomb-detonated',
                        actorId,
                        victimId: victim.id,
                        // Ship-kit W7: the positional detonate caster IS the detonator (the burst
                        // is caused by this cast's detonate ability — SP-F F1: "the detonating
                        // caster (actorId) is the source-attacker").
                        detonatorId: actorId,
                        round: r,
                        stacks: result.bombStacks,
                        damage: result.bomb,
                        // The EVENT keeps the pre-funnel burst value on purpose — it announces what
                        // the bomb was worth, the same way `attacked` reports a hit's pre-transfer
                        // value. Only the numeric channels below move to the delivered amount.
                    });
                    // #355 B1: the victim's own row gets its OWN booked intake — a Protection
                    // cascade already booked the redirected chunk on each protector's row, so
                    // adding it here too counted it twice.
                    roundPerTargetDamage.set(
                        victim.id,
                        (roundPerTargetDamage.get(victim.id) ?? 0) + bombOutcome.incomingBooked
                    );
                    // SP-F F1: the detonating caster (actorId) is the source-attacker.
                    creditDealt(actorId, victim.id, bombOutcome.incomingBooked);
                }
                const bypass = result.inferno + result.corrosion;
                let bypassDelivered = 0;
                if (bypass > 0) {
                    // DoT → bypass shield. `byDirectDamage: false` makes every divergence step in
                    // the funnel skip (block, Protection cascade and both transforms are each gated
                    // on it), so `incomingBooked === bypass` here by construction and the reads
                    // below are byte-identical today. Routed through the same accessor anyway so
                    // this site cannot silently drift the day one of those gates loosens — the
                    // reconciliation suite pins that.
                    const bypassOutcome = applyVictimDamage(bypass, victim, sink, {
                        byDirectDamage: false,
                    });
                    bypassDelivered = detonationDelivered(bypassOutcome);
                    bus.emit({
                        type: 'dot-detonated',
                        targetId: victim.id,
                        round: r,
                        damage: bypass,
                    });
                    roundPerTargetDamage.set(
                        victim.id,
                        (roundPerTargetDamage.get(victim.id) ?? 0) + bypassOutcome.incomingBooked
                    );
                    // SP-F F1: the detonating caster (actorId) is the source-attacker — NOT
                    // whoever originally applied the ticking DoT stacks (the existing,
                    // accepted `perActorDetonation.set(actorId, …)` convention below).
                    creditDealt(actorId, victim.id, bypassOutcome.incomingBooked);
                }
                // The whole-attack tally, so it stays on the SAME basis as `perTargetDealt` (the
                // DPS page derives `direct = dealt - detonation - dots`; the two folds disagreeing
                // is what pushes phantom damage into the Direct row).
                const dealt = bombDelivered + bypassDelivered;
                if (dealt > 0) {
                    perActorDetonation.set(actorId, (perActorDetonation.get(actorId) ?? 0) + dealt);
                }
            }
        };

        // SP-F F3 fix (Critical + Important): routes a FORCED bomb detonation (a caster's
        // countdown-reduce ability driving an existing PendingBomb to <=0, e.g. Lingshe) through
        // the SAME per-victim `applyVictimDamage` sink a natural countdown-0 burst uses
        // (processBombs' `creditDetonation` — see `applyPositionedTimedBurst` above). This is the
        // ONLY correct way to preserve Barrier full-damage-immunity, the Cheat-Death intercept,
        // recordDestroyed/`ship-destroyed` emission (no zombie units), and incoming-block/Lifeline
        // — all of which a hand-rolled shieldPool/currentHp debit would bypass. Credits the
        // round's detonation tally (roundPerTargetDamage + perActorDetonation) to the bomb's
        // ORIGINAL applier (`sourceId`), exactly like `applyPerVictimDetonation`/`creditDetonation`
        // above — never the forcing caster. `sink` is passed in by the CALLER (buildTurnArgs) —
        // the single shared sink (SP-U U1) since a forced detonation's victim is an arbitrary
        // opposing actor, not necessarily the bursting actor's own HP.
        const forceDetonateBombOnVictim = (
            victim: CombatActor,
            sink: DamageAccountingSink,
            sourceId: string,
            damage: number
        ): void => {
            const outcome = applyVictimDamage(damage, victim, sink, {
                killerId: sourceId,
                byDirectDamage: true,
                bombPortion: damage, // full shield drain, no pen — bomb-burst precedent
                shieldPenetrationPct: 0,
            });
            // #355 B1: book what the funnel RECORDED, not the burst we passed in — see
            // `detonationDelivered`. Per-victim rows take `incomingBooked`; the whole-attack tally
            // adds back the Protection-redirected slice (it landed, on the protectors' rows).
            roundPerTargetDamage.set(
                victim.id,
                (roundPerTargetDamage.get(victim.id) ?? 0) + outcome.incomingBooked
            );
            // SP-F F1: the bomb's ORIGINAL applier (sourceId) — never the forcing caster.
            creditDealt(sourceId, victim.id, outcome.incomingBooked);
            perActorDetonation.set(
                sourceId,
                (perActorDetonation.get(sourceId) ?? 0) + detonationDelivered(outcome)
            );
        };

        // Shared positioned timed-burst loop. A POSITIONED actor carrying timed
        // pendingBombs/pendingAccumulators (seeded by the opposing side's earlier bomb/accumulator
        // applications) bursts them at the START of its own turn — against its OWN HP — via
        // applyVictimDamage (the per-victim sink). Bombs + accumulators = full shield drain, NO
        // penetration (bomb-splash precedent). Credited to the per-round detonation tally keyed by
        // the bomb's APPLIER (sourceId, unchanged attribution) + roundPerTargetDamage on the
        // bursting actor. NEVER routed through creditDamage(actor.id,'detonation') — that feeds the
        // SCALAR channel (`cumulativeDamage`), and a per-victim amount must not also book there (the
        // two-channel rule at the round tail). Until SP-4c-2d the scalar also drove the dummy sink's
        // round-tail HP overwrite, making it a literal double-hit on top of the HP `applyVictimDamage`
        // already drained; that write is gone, the double-COUNT hazard is not. STRICT no-op
        // (byte-identical) when the actor carries no timed
        // containers OR is not positioned vs opposingRoster — no fixture seeds actor-side timed
        // containers. Used by the enemy site (PR2: sink=sink, roster=allPlayerActors) and the
        // focus attacker + walked-team sites (PR-B: sink=sink, roster=enemyAttackerActors) — the
        // single shared sink (SP-U U1) works for both since ids are globally unique across sides.
        const applyPositionedTimedBurst = (
            actor: CombatActor,
            sink: DamageAccountingSink,
            opposingRoster: CombatActor[]
        ): void => {
            const hasTimedContainers =
                actor.pendingBombs.length > 0 || actor.pendingAccumulators.length > 0;
            if (!hasTimedContainers || !isPositional(actor.position, opposingRoster)) return;

            processBombs({
                pendingBombs: actor.pendingBombs,
                emitBombDetonated: (actorId, stacks, damage) =>
                    bus.emit({
                        type: 'bomb-detonated',
                        actorId,
                        victimId: actor.id,
                        round: r,
                        stacks,
                        damage,
                    }),
                creditDetonation: (sourceId, damage) => {
                    const outcome = applyVictimDamage(damage, actor, sink, {
                        killerId: sourceId,
                        byDirectDamage: true,
                        bombPortion: damage, // full shield drain, no pen
                        shieldPenetrationPct: 0,
                    });
                    // #355 B1: book what the funnel RECORDED — see `detonationDelivered`.
                    const delivered = detonationDelivered(outcome);
                    roundPerTargetDamage.set(
                        actor.id,
                        (roundPerTargetDamage.get(actor.id) ?? 0) + outcome.incomingBooked
                    );
                    // SP-F F1: the bomb's applier (sourceId) bursting on the bursting actor's own turn.
                    creditDealt(sourceId, actor.id, outcome.incomingBooked);
                    perActorDetonation.set(
                        sourceId,
                        (perActorDetonation.get(sourceId) ?? 0) + delivered
                    );
                    // Site 2 of the leech-channel class (spec §3): the burst channel now pays the
                    // applier's standing damage-dealt leech. `'detonation'` is the channel, so a
                    // `leechScope:'detonation'` leech pays HERE and only here, and an `'all'` one
                    // pays here too — the pre-positional path did both via
                    // `creditDamage(sourceId, 'detonation', damage)`.
                    //
                    // Deliberately NOT `procLeechesForVictim`: that fires the victim's TAKEN leech
                    // as well, and a burst does not proc one (owner ruling, spec §2.2 — Malvex
                    // reads "directly damaged as a primary target"). Standing direction only.
                    //
                    // #355 B1: paid on the DELIVERED amount. "% of damage dealt" is the final
                    // on-screen number — a Protection redirect counts (the damage landed, on the
                    // protector) and a DoT transform does not (it has not been dealt yet; it books
                    // per tick). `detonationDelivered` is exactly that basis.
                    procStandingLeechesPerVictim(sourceId, delivered, 'detonation');
                },
            });

            // Accumulator gather input (SP-4b-2 D1). The accumulators a POSITIONED actor carries
            // were seeded by the OPPOSING side's casts, so the side whose direct damage they
            // gather is exactly `opposingRoster` — which makes this ONE expression correct for
            // BOTH sites, with no side branch: the enemy site passes `allPlayerActors` and the
            // player/team sites pass `enemyAttackerActors`.
            //
            // This replaces a bare sum over the scalar `roundDamage` map, whose comment asserted
            // it was "CORRECT for the enemy site" and an "INERT placeholder" for the player side.
            // Neither half held any more: the scalar map goes structurally empty the moment a cast
            // resolves positionally (its direct credit is suppressed — see `creditPositionalDirect`),
            // so the "correct" side gathered 0, and the player side was inert only because nothing
            // fed it, not because the sum was unreachable.
            const gatheredDirect = directDealtBy(opposingRoster);
            processAccumulators({
                pendingAccumulators: actor.pendingAccumulators,
                gatheredDirect,
                // #345: `actorId` is the accumulator's APPLIER (whose Echoing Burst this is) and
                // `victimId` the holder it burst on — the same actorId/victimId split the sibling
                // `bomb-detonated` emit above uses. Inside the shared `applyPositionedTimedBurst`,
                // so both sides emit it: a player Valkyrie's burst on an enemy and an enemy
                // Valkyrie's burst on a player ship announce themselves identically.
                emitAccumulatorDetonated: (actorId, damage) =>
                    bus.emit({
                        type: 'accumulator-detonated',
                        actorId,
                        victimId: actor.id,
                        round: r,
                        damage,
                    }),
                creditDetonation: (sourceId, damage) => {
                    const outcome = applyVictimDamage(damage, actor, sink, {
                        killerId: sourceId,
                        byDirectDamage: true,
                        bombPortion: damage, // full shield drain, no pen (bomb-style)
                        shieldPenetrationPct: 0,
                    });
                    // #355 B1: book what the funnel RECORDED — see `detonationDelivered`.
                    const delivered = detonationDelivered(outcome);
                    roundPerTargetDamage.set(
                        actor.id,
                        (roundPerTargetDamage.get(actor.id) ?? 0) + outcome.incomingBooked
                    );
                    // SP-F F1: the accumulator's applier (sourceId).
                    creditDealt(sourceId, actor.id, outcome.incomingBooked);
                    perActorDetonation.set(
                        sourceId,
                        (perActorDetonation.get(sourceId) ?? 0) + delivered
                    );
                    // Site 2 of the leech-channel class (spec §3): the burst channel now pays the
                    // applier's standing damage-dealt leech. `'detonation'` is the channel, so a
                    // `leechScope:'detonation'` leech pays HERE and only here, and an `'all'` one
                    // pays here too — the pre-positional path did both via
                    // `creditDamage(sourceId, 'detonation', damage)`.
                    //
                    // Deliberately NOT `procLeechesForVictim`: that fires the victim's TAKEN leech
                    // as well, and a burst does not proc one (owner ruling, spec §2.2 — Malvex
                    // reads "directly damaged as a primary target"). Standing direction only.
                    //
                    // #355 B1: paid on the DELIVERED amount, same basis as the sibling bomb burst
                    // above — a Protection redirect counts, a DoT transform does not.
                    procStandingLeechesPerVictim(sourceId, delivered, 'detonation');
                },
            });
        };

        // Unified positional target selection (bySide unification PR6a). Reproduces the
        // focus(C1)/team(C2)/enemy(C3) selection: resolve the actor's parsed target against its
        // opposing roster. SP-4e: there is no per-side fallback left to fall back TO — an actor
        // that resolves nobody gets `tgt: undefined` whichever side it is on.
        // SP-F F5: on a charge-firing turn, resolve against the CHARGED target axis instead of
        // the active one (parsedChargedTargetFor falls back to the active target when unset →
        // byte-identical for every non-divergent ship).
        const selectTurnTarget = (a: CombatActor): { tgt: CombatActor | undefined } => {
            const tb = turnBindings(a.side);
            const target = willFireChargedFor(a) ? parsedChargedTargetFor(a) : parsedTargetFor(a);
            const selected =
                resolvesPositionalVictim(a.position, tb.opposingRoster) && target
                    ? resolvePositionalTarget(
                          a.position!,
                          target,
                          tb.opposingRoster,
                          statusLookupFor(tb.opposingRoster),
                          {
                              // The static per-ship flag OR the timed, ally-granted `Rogue's
                              // Liberty` — read live here (not baked into the actor at
                              // construction) precisely because the buff can come and go
                              // mid-battle. Same treatment at the positional-apply site below,
                              // which re-resolves the anchor per hit.
                              ignoresForcedTargeting:
                                  a.ignoresForcedTargeting ||
                                  holdsRoguesLiberty(statusEngine, a.id),
                              ignoresStealth: a.ignoresStealth,
                              provokedBy: provokerOf(statusEngine, a.id),
                          }
                      )
                    : null;
            // SP-4e: ONE rule for both sides. An actor that resolves no living positional victim
            // runs a NO-VICTIM turn — the honest answer, and the only one that does not silence a
            // supporter. The turn still RUNS (every call site below runs it rather than skipping,
            // so the repair/buff still lands); every victim-derived read answers "there is no
            // enemy" instead of reading a stand-in's stats (contract §B).
            //
            // The enemy side used to fall back to `legacyVictim: healTarget`, so an ally-targeted
            // enemy supporter resolved the FOCUS PLAYER as the victim of a cast that never targeted
            // them — 324 measured rows (spec §5 class C2), and the class #335's own narrative
            // missed. On the player side this has been the answer since SP-4c-2b (contract §A.1:
            // 100% of the 3,206 measured player-side fallback rows had an ally-side parsed target).
            if (selected == null) {
                noVictimTurnCount++;
                return { tgt: undefined };
            }
            // Tripwire (see __getResolvedVictimTurnCounts): every turn that binds a victim, and how
            // many of those victims were already dead. The second count is the one that must stay
            // 0 — `resolvePositionalTarget` cannot hand back a corpse, and this is where that claim
            // becomes falsifiable for all three turn sites at once.
            resolvedVictimTurns++;
            if (selected.currentHp <= 0) deadVictimTurns++;
            return { tgt: selected };
        };

        // Unified runPlayerTurn argument builder (bySide unification PR6a). Produces the
        // full arg object for any side, folding the per-side divergence through
        // turnBindings(side) + runtimeFor(actor). `healEventOnly` is enemy-side-only. `targetId`
        // now tracks ONE thing — is there a victim — on both sides:
        //   (1) a turn WITH a victim (always a real positional actor): `targetId` IS emitted.
        //   (2) a PLAYER turn with NO victim (4c-2b, an ally-targeted cast): `targetId` omitted
        //       because there is nobody to key a per-victim store by, together with the whole
        //       victim-derived spread below (`enemy`, the five containers, enemyDefense/enemyHp,
        //       targetRepairedThisRound, targetEffectiveAttack, enemyDebuffNames). Consumers must
        //       read that as "no enemy", never as "an enemy with neutral stats" (contract §B).
        // There used to be a THIRD state — a player turn whose victim was the dummy GHOST, where
        // `targetId` was omitted so the ability-status writes routed to the global `__enemy__`
        // store rather than keying by a ghost's id. SP-4c-2b made selection stop returning the
        // ghost and SP-4c-2d deleted it; the two reasons for an absent `targetId` have collapsed
        // back into one. The selfHpPct
        // denom is unified to runtimeFor(actor).hp (proven equal to baseHpFor(id) by
        // construction). The per-kind bookkeeping TAILS after each call stay inline.
        const buildTurnArgs = (a: CombatActor, tgt: CombatActor | undefined) => {
            const tb = turnBindings(a.side);
            const rt = runtimeFor(a);
            const maxHp = rt.hp; // unified denom (baseHpFor(id) === runtimeFor(id).hp)
            // E3 (AoE purge): footprint victim ids for an 'all-enemies' on-cast purge.
            // Computed ONLY when positional — `tgt?.position != null` is the positional
            // discriminator (when nothing positional resolved, `selectTurnTarget` returns NO victim
            // at all — on EITHER side since SP-4e (#335), so `tgt` is `undefined` here and the
            // optional chain short-circuits. The player side has answered that since SP-4c-2b; the
            // ENEMY side used to return the position-less heal-target sink, and the position-less
            // dummy sink stood on the player side before 4c-2b/2d — both are deleted, and there is
            // no per-side fallback victim left. Since SP-4b-1's normalization boundary a null
            // resolution means an absent/never-targetable opposing roster, an ally-side parsed
            // target, or the mid-run whiff window — no longer "the DPS/healing calculators", which
            // now supply real placed enemies). footprintVictims
            // is the same pure resolver the AoE
            // damage path uses; covered cells are included (status removal is uniform across the
            // footprint). Non-positional → undefined → the playerTurn purge loop falls back to
            // the single anchor → byte-identical. The purge ability gates on
            // target === 'all-enemies', so single-'enemy' purges ignore this regardless.
            // SP-F F5: charge-aware, mirroring the 3 damage cast sites — an on-cast purge fired
            // from a CHARGED cast (e.g. Lodolite) must expand its footprint from the charged
            // pattern too, not the active one. `?? ` fallback → byte-identical for every
            // non-divergent ship.
            const aoePattern = willFireChargedFor(a)
                ? parsedChargedPatternFor(a)
                : parsedPatternFor(a);
            const aoeTarget = parsedTargetFor(a); // parse-completeness guard only (not a footprint arg)
            const aoeVictimIds =
                aoePattern != null && aoeTarget != null && tgt?.position != null
                    ? footprintVictims(aoePattern, tgt.position, tb.opposingRoster).map(
                          (h) => h.victim.id
                      )
                    : undefined;
            const opposingVictimById =
                tgt?.position != null
                    ? new Map(tb.opposingRoster.map((v) => [v.id, v]))
                    : undefined;
            // I6: resolve the enemy-most-buffs selector target for an ON-CAST purge (Lodolite's
            // charged skill). mostBuffsAmong (§C2b-2, Rhodium) previously only fed the REACTIVE
            // purge path (triggers.ts's ctx.enemyWithMostBuffs, for end-of-round/on-attacked
            // triggers) — Lodolite's purge trigger is 'on-cast', which stays on THIS (castSkills)
            // path and never reaches triggers.ts. Computed fresh per turn (buff state changes
            // round to round) from THIS actor's opposing roster — same roster mostBuffsAmong's
            // other two call sites use for the reactive path. Undefined for a DPS-mode/empty
            // roster (mostBuffsAmong's own no-buffs-anywhere case) or a non-purge cast — the
            // playerTurn purge loop falls back to the anchor `targetId` in that case. #407 adds a
            // third way to be undefined: every opposing actor carrying a buff is DEAD. The purge
            // loop's anchor fall-back is therefore reachable in a new way, which is BY DESIGN —
            // #403 ruling R4 keeps that fall-back for purge and denies it to the debuff clause
            // path; do not quietly align the two.
            // #407: THE aliveness gate for this seam — one call, in a THUNK. Evaluated at use time
            // because rosters are mutated in place as actors die during a round: a roster filtered
            // at turn start would go stale and re-admit an actor that died after the snapshot.
            // Deliberately UNMEMOIZED for the same reason #403 left `selectorEnemyIdFor`
            // unmemoized — a purge earlier in the SAME cast changes who carries the most buffs, and
            // the later clause must see the post-purge, post-death board.
            const aliveOpposing = (): AliveRoster => aliveTargetsOf(tb.opposingRoster);
            const enemyMostBuffsId = mostBuffsAmong(aliveOpposing());
            return {
                runtime: rt,
                enemyMostBuffsId,
                // #403: resolve a debuff clause's SELECTOR target to one live opposing actor.
                // Closes over the same three resolvers the reactive ctx uses and the same
                // `tb.opposingRoster` the eager `enemyMostBuffsId` above uses — team-symmetric for
                // free, since that roster is already side-relative. Called lazily, only when a
                // clause actually carries a selector target, so a cast with no selector clause
                // folds no extra live stats. NOT memoized (see the arg's doc in playerTurn.ts):
                // resolution must be live at clause time so a purge earlier in the same cast is
                // visible to a later debuff clause.
                // #403 review Finding 2: exhaustive `switch` with a `never`-typed default, same
                // idiom as `passiveSlotPattern`'s exhaustiveness guard above (~line 7988) — a
                // fourth `EnemySelectorKind` variant must be classified here explicitly, loud
                // (throw) rather than silently inheriting `highestSpeedInRoster` the way an
                // unconditional ternary tail would.
                selectorEnemyIdFor: (kind: EnemySelectorKind): string | undefined => {
                    switch (kind) {
                        case 'most-buffs':
                            return mostBuffsAmong(aliveOpposing());
                        case 'highest-attack':
                            return highestAttackInRoster(aliveOpposing());
                        case 'highest-speed':
                            return highestSpeedInRoster(aliveOpposing());
                        default: {
                            const exhaustive: never = kind;
                            throw new Error(
                                `selectorEnemyIdFor: unhandled EnemySelectorKind ${String(exhaustive)}`
                            );
                        }
                    }
                },
                // PR10 (buff steal): THIS caster's own living adjacent allies, resolved fresh
                // per turn from its own side's roster — same adjacentAllyIdsFor helper
                // 'adjacent-allies' targets use elsewhere (adjacency.ts). Team-symmetric via
                // bySide(a.side) (identical for player and enemy casters). Consumed only by a
                // buff-steal ability whose config carries grantAdjacentAllies.
                adjacentAllyIds: bySide(a.side).adjacentAllyIdsFor(a.id),
                // Whether the two ADJACENCY counts derived in runPlayerTurn (from
                // `adjacentAllyIds` / `adjacentEnemyIdsFor` above) are a measurement on this run.
                // Same mode gate, same reason, as `enemyDestroyedCount` below.
                liveCountsMeasurable,
                // Ship-kit W5 Task A3: resolves the board-neighbours of an ENEMY-side anchor
                // (the resolved target `tgt`, not the caster) for the 'adjacent-enemies' /
                // 'target-and-adjacent-enemies' debuff fan-out. Reuses the same side-dispatching
                // adjacentAllyIdsFor the reactive-trigger registration (~2856) and the buff-steal
                // grant above already use — passing the target's id resolves ITS OWN side's
                // neighbours, which (since the target is always opposing this actor) are the
                // adjacent enemies, team-symmetric for free (bySide handles both directions).
                adjacentEnemyIdsFor: (anchorId: string): string[] =>
                    bySide(isEnemySide(anchorId) ? 'enemy' : 'player').adjacentAllyIdsFor(anchorId),
                // #363: actor id → faction, for the recipient FACTION intersection on a
                // `factionFilter`'d ally scope (Fuying's "grants Tianchao allies Stealth").
                // The SAME side-agnostic map the roster is seeded into above — no `a.side`
                // dispatch, so an enemy-side Fuying scopes to enemy Tianchao allies for free.
                factionOf,
                // SP-4c-2b: every victim-derived member lives in this ONE conditional spread.
                // `tgt` is absent exactly when an ally-targeted cast resolved nobody on the
                // opposing side (contract.md §B) — omitting these fields (rather than emitting
                // an empty/zero placeholder) is what routes the consumer to its documented
                // "no enemy" defaults (`?? []` / `?? 0` / `!== undefined` guards in playerTurn.ts),
                // instead of resurrecting the dummy ghost this rung deletes.
                ...(tgt
                    ? {
                          enemy: tgt,
                          corrosionEntries: tgt.corrosionEntries,
                          infernoEntries: tgt.infernoEntries,
                          genericDoTEntries: tgt.genericDoTEntries,
                          pendingBombs: tgt.pendingBombs,
                          pendingAccumulators: tgt.pendingAccumulators,
                          enemyDefense: tb.victimDefenceFor(tgt),
                          enemyHp: tb.victimMaxHpFor(tgt),
                          targetRepairedThisRound: repairedThisRound.has(tgt.id),
                          targetEffectiveAttack: effectiveStatsOf(statusEngine, selfBuffLookup, tgt)
                              .attack,
                      }
                    : {}),
                // B1/PR7b: thread targetId for BOTH directions so player-applied ABILITY debuffs route
                // to the resolved victim's per-actor store (applyTimedAbilityStatus keys off targetId;
                // the aggregate ability-read timedAbilityStatuses('enemy',actor.id,targetId) follows
                // automatically). The scheduled channel stays global __enemy__ (upsertBuff hardcoded).
                //
                // SP-4c-2d: the player side used to carry a `tgt.id !== enemy.id` conjunct here —
                // when `selectTurnTarget` fell back to the dummy sink, `targetId` was left unset so
                // the writes routed to the global `__enemy__` store instead of keying by a ghost's
                // id. SP-4c-2b stopped the player side ever resolving the ghost and this rung
                // deleted it, so `tgt` is a real actor on BOTH sides whenever it is present, and
                // its presence is the whole guard. A no-victim turn (`tgt` undefined) omits
                // targetId — the same answer the ghost case produced, for a different reason.
                ...(tgt ? { targetId: tgt.id } : {}),
                statusEngine,
                enemyType: tb.enemyTypeArg,
                bus,
                round: r,
                grantAllyCharges: bySide(a.side).grantAllyCharges,
                removeEnemyCharges: bySide(a.side).removeEnemyCharges,
                removeChargesFrom: bySide(a.side).removeChargesFrom,
                healing: healingCtx,
                ...(tb.healEventOnly ? { healEventOnly: true } : {}),
                selfHpPct: maxHp > 0 ? (100 * Math.max(0, a.currentHp)) / maxHp : 100,
                // targetHpPct reports the HEAL TARGET's HP% (healTargetHpPctNow()), NOT the struck
                // `tgt`'s — even on the enemy positional path where `tgt` may be a different player
                // actor, this still tracks the heal target. Per-actor target-HP% is deferred to a
                // later phase; inert today (bare enemies have no `hpSubject:'target'` gate).
                targetHpPct: healTargetHpPctNow(),
                // SP-4c-2b: `targetRepairedThisRound` (was the STRUCK victim `tgt` repaired this
                // round? — C2b-3) moved into the victim-derived conditional block above; a
                // no-victim turn omits it and `playerTurn.ts` defaults the destructure to `false`.
                enemyBuffNames: tb.enemyBuffNamesUnion(),
                // Sub-project I, PR I5: count (not union) of opposing actors holding Stealth,
                // for Selenite's "for every enemy with Stealth" count-scaling. Same per-turn
                // cadence as enemyBuffNames above; 0 against a synthesized DPS enemy (it has no
                // skills, so it never gains Stealth). There is no structurally-0 caller left since
                // SP-4b-2b — see `stealthedEnemyCount`'s own note.
                stealthedEnemyCount: tb.stealthedEnemyCount(),
                // Judge R2 ("20% more direct damage for each destroyed enemy, up to max of
                // 100%"): opposing actors destroyed SO FAR THIS BATTLE, regardless of who landed
                // the kill and cumulative across rounds (owner ruling 2026-08-30). `destroyedRound`
                // is the engine's canonical destroyed signal (same one adjacency.ts filters on),
                // and `tb.opposingRoster` is built once and never pruned, so a corpse stays in the
                // array and keeps being counted. Team-symmetric via `tb`: the player side tallies
                // the enemy roster, the enemy side tallies the player roster.
                //
                // WITHHELD under `mode: 'dps'` — see `liveCountsMeasurable`.
                ...(liveCountsMeasurable
                    ? {
                          enemyDestroyedCount: tb.opposingRoster.filter(
                              (x) => x.destroyedRound !== undefined
                          ).length,
                      }
                    : {}),
                // Sub-project I, PR I1: opt-in NAMES on the resolved target for name-specific
                // `enemy-debuff` gates — SAME guard as targetId above, and for the same reason
                // (SP-4c-2d dropped the identical dummy-sink conjunct). Omitted when there is no
                // victim this turn, so buildRoundContext leaves enemyDebuffNames undefined (the
                // no-enemy sentinel) and the round contexts fall back to the name-agnostic
                // enemyDebuffCount path.
                ...(tgt ? { enemyDebuffNames: enemyDebuffNamesForTarget(tgt) } : {}),
                selfDebuffNames: ownerDebuffNames(a.id),
                ...(aoeVictimIds ? { aoeVictimIds } : {}),
                ...(opposingVictimById ? { opposingVictimById } : {}),
                // SP-F F3 fix: forced bomb-detonation sink (Lingshe's countdown-reduce-to-0).
                // SP-U U1: `sink` serves both directions (ids globally unique across sides), so
                // no per-side selection is needed here anymore.
                forceDetonateBomb: (victim: CombatActor, sourceId: string, damage: number) =>
                    forceDetonateBombOnVictim(victim, sink, sourceId, damage),
                // Positional detonation hint: when the engine will take the positional apply path
                // (same predicate that computes aoeVictimIds — pattern + target + position all set),
                // runPlayerTurn SKIPS the anchor detonation (no consume/credit/emit) and instead
                // returns a `positionalDetonation` recipe for the per-victim detonation loop below
                // to apply. Conditional spread → non-positional turns omit the key → byte-identical.
                //
                // ALL THREE CAST-SITES (PR1 + PR3 + PR4): the focus-turn site (PR1), the enemy-
                // attacker site (PR3), and now the WALKED-TEAM site (PR4 — `a.kind === 'team'`) each
                // consume the recipe via their own per-victim detonation loop, so all three get
                // `positional: true` (runPlayerTurn SKIPS the anchor detonation and returns the
                // recipe; detonationDamage stays 0 — the loop applies it per footprint victim). With
                // the walked-team loop now wired, every positional cast-site lands detonation per
                // footprint victim symmetrically; no cast-site silently drops the recipe.
                ...((a.id === focusActorId || a.side === 'enemy' || a.kind === 'team') &&
                aoePattern != null &&
                aoeTarget != null &&
                tgt?.position != null
                    ? { positional: true }
                    : {}),
                // D-PR4: target's effective attack (for 'amplify-vs-higher-attack' eligibility),
                // for a per-(owner,ability) deterministic proc closure. `targetEffectiveAttack`
                // moved into the victim-derived conditional block above (SP-4c-2b) — READ only
                // when the actor's passive slot carries an outgoing-amplification ability →
                // byte-identical for every fixture without one (rollOutgoingProc never invoked).
                rollOutgoingProc: (abilityId: string, chance: number) =>
                    rollRateGate(procChanceGates, `${a.id}:${abilityId}`, chance),
                activePattern: parsedPatternFor(a),
                chargedPattern: parsedChargedPatternFor(a),
                sameSideLiving: sameSideLivingFor(a),
                // F3: the acting actor's pre-fight modifier baseline (outgoingDamage /
                // outgoingHeal / incomingHeal fold into its self-buff totals inside
                // runPlayerTurn). Side-agnostic — enemy attackers walk the same path.
                // Conditional spread → absent for every existing caller (byte-identical).
                ...(a.preFight ? { preFight: a.preFight } : {}),
                // #367: this actor's own enemy-APPLIED heal-channel modifiers (`Inc./Out. Repair
                // Down/Up`), computed fresh per turn from its per-victim ability stores. Folded
                // into the same layer-1 totals as `preFight` inside `runPlayerTurn`. Team-agnostic
                // for free: the enemy store is keyed by victim id regardless of side, and this
                // helper is called for every acting actor on both sides. Spread-guarded like
                // `preFight` so a clean actor omits the key entirely and every existing fixture
                // stays byte-identical.

                // #389/#396: the named families this actor carries in its OWN per-victim enemy
                // store, computed fresh per turn over `TURN_SHADOW_CHANNELS` — the two outgoing-
                // damage channels (`Attack Down` / `Out. Damage Down`, #389) and the two heal
                // channels (`Inc. Repair Down` / `Out. Repair Down`, #367's, shadowed by #396).
                //
                // ONE MAP, not a map plus a scalar. #367 originally passed the heal pair as summed
                // percentages (`enemyAppliedHeal`), which is exactly the shape that cannot express
                // the locked rule: highest tier wins ACROSS the self/enemy boundary, so
                // `runPlayerTurn` has to compare each applied family against the actor's own
                // instance of it rather than just adding, and a pre-summed scalar makes that
                // impossible. Both pairs now travel as families and are folded together.
                //
                // Team-agnostic: the enemy store is keyed by victim id regardless of side, and
                // this runs for every acting actor on both sides. Spread-guarded so a clean actor
                // omits the key entirely and every existing fixture stays byte-identical.
                ...(() => {
                    const fams = victimOwnEnemyFamilies(statusEngine, a.id);
                    return fams.size > 0 ? { enemyAppliedFamilies: fams } : {};
                })(),
                // Sub-project I, PR I3 (Layer 1): team-aura distribution. Union THIS actor's
                // LIVING same-side allies' `all-allies` passive modifier abilities, EXCLUDING
                // the actor's own id (its own aura is already in its own modifierAbilities —
                // no double-count) — reuses `sameSideLivingFor` (the SAME same-side-living
                // roster the support-footprint path uses; team-symmetric via `a.side`). Merged
                // into `modifierAbilities` in playerTurn.ts, so it folds into BOTH the per-turn
                // dmgStats AND (PR I2) perVictimOutgoing for free. Absent-source case → the
                // flatMap is [] → byte-identical.
                allyModifierAbilities: sameSideLivingFor(a)
                    .filter((x) => x.id !== a.id)
                    .flatMap((x) => allAlliesModifierAbilitiesById.get(x.id) ?? []),
                // Sub-project I, PR I4c: per-SOURCE breakdown of ally `all-allies` `dotDamage`-
                // channel modifier abilities (Wildfire's refit-3 team aura) — needed alongside
                // `allyModifierAbilities` above because that flat list loses PROVENANCE (which
                // ally sourced which ability), and the locked game rule requires this bonus to
                // scale by the AURA SOURCE's own crit power, never the recipient's (unlike
                // every other all-allies modifier condition, which correctly reads the
                // recipient's ctx per I3). Filters each ally's all-allies MODIFIER list down to
                // the `dotDamage` channel BEFORE computing crit power, so `effectiveStatsOf` is
                // only paid for actual aura sources (every ship without this shape → `.filter`
                // drops it → `[]`, byte-identical). `sourceCritPower` mirrors the "layers
                // 1+2+3" shape `modifierCtx.selfCritPower` uses for the ACTING actor (base +
                // scheduled/timed self-buffs) — the one difference is it omits the acting-
                // actor-only "active/gated self-ability aura" layer (playerTurn.ts's
                // `activeAbilityStatuses` component), which Wildfire's kit never uses for its
                // own crit power (docs/ship-skills.csv: Wildfire's only passives ARE this
                // dotDamage-scaling ability), so the two are equivalent for this ship.
                allyDotDamageAuraSources: sameSideLivingFor(a)
                    .filter((x) => x.id !== a.id)
                    .map((x) => ({
                        x,
                        abilities: (allAlliesModifierAbilitiesById.get(x.id) ?? []).filter(
                            (ab) =>
                                ab.config.type === 'modifier' && ab.config.channel === 'dotDamage'
                        ),
                    }))
                    .filter((entry) => entry.abilities.length > 0)
                    .map((entry) => ({
                        sourceId: entry.x.id,
                        sourceCritPower: effectiveStatsOf(statusEngine, selfBuffLookup, entry.x)
                            .critDamage,
                        abilities: entry.abilities,
                    })),
            };
        };

        // SP-U U2 (Option B): the triplicated positional-apply block, extracted ONCE. This is the
        // single largest chunk shared near-verbatim (modulo local names) by the focus, walked-team,
        // and enemy cast-sites: it drives the per-victim positional apply against the acting side's
        // opposing roster, wakes each hit victim's on-attacked reactives, breaks covered-victim
        // Stasis, and lands per-victim skill-triggered detonation. The block is ALREADY
        // tb-parameterized (tb.opposingRoster / tb.applyToVictim); the ONLY per-site divergences are
        // injected as callbacks (no `side` branch inside the helper):
        //   • onVictimResolved — the per-victim LEECH direction (Note A in task-2-report.md): the
        //     player→enemy sites proc a STANDING leech off the dealt damage; the enemy→player site
        //     procs a TAKEN leech off the damage each player victim took (+ captures the focus
        //     victim's shield-hit flag). Called at the SAME per-victim point for all three.
        //   • emitAttackedForSubAttack — ONE sub-attack's `attacked` emit (PR2 Task 3). The
        //     player→enemy sites run the whole interleaved sequence HERE (before the per-victim
        //     detonation); the enemy site DEFERS everything but its first `ability-performed` to
        //     AFTER its inline non-positional damage-taken-leech tail (its row-14 accounting, kept
        //     inline → U5) by passing `deferEmission` and running the returned `emitDeferred` there.
        // Returns { critAgg, emitDeferred } so the enemy site can record enemyCritAgg (for its
        // 0-damage deferred-emit fallback) and run that remainder. The signal map itself is NOT
        // returned: since PR2 Task 3 every consumer reads it through `emitAttackedForSubAttack` /
        // `emitDeferred`, so exposing it would only invite a second, out-of-order drain. sel carries
        // the pre-call head-locals the block reads (esp. preTurnVictimStatus, which MUST be the
        // pre-runPlayerTurn snapshot — never recomputed post-hoc).
        /**
         * Intra-cast clause order: apply the landings this cast held back because their clause
         * follows its damage clause (playerTurn's `deferredEnemyApplications`). Called at each of
         * the three turn sites once that turn's damage has landed — and unconditionally, so a cast
         * that resolved non-positionally, whiffed, or killed its target still applies its debuff
         * rather than dropping it. Runs BEFORE the actor's Post-Turn decrement, so the status keeps
         * its normal window; and before the turn's intent drain, so reactions to the
         * `debuff-applied` still resolve within this turn (just after the damage, as the rule says).
         *
         * Empties the list, making a second call a no-op — the sites are allowed to overlap.
         * Team-symmetric: one helper, all three sites (focus / walked team / enemy).
         *
         * NOT the only application point since PR8 (multi-hit full-walk epic). It is now the
         * FALLBACK plus the FINAL flush:
         *   • A multi-hit cast's sub-attack-0 landings are spliced out of this list and applied at
         *     the end of iteration 0 by the `onSubAttackEnd` hook below, so sub-attack 1 can see
         *     them. By the time this runs, that splice has already emptied the list — hence the
         *     early return, not a second application.
         *   • Sub-attacks ≥ 1 never populate this list at all; they roll and apply through
         *     `applyDebuffsForSubAttack` at their own boundaries.
         *   • A single-hit cast, a whiff, a non-positional cast, or any cast the hooks never see
         *     still lands HERE — which is what keeps N=1 on its historical path.
         *
         * PR8 split the thunk into {applyState, emitEvents}. Running them back-to-back here is
         * byte-identical to the pre-PR8 single thunk — the split only matters where the engine
         * deliberately separates them (the sub-attack boundary wiring, Task 4).
         */
        const flushDeferredEnemyApplications = (
            deferred: PlayerTurnResult['deferredEnemyApplications']
        ): void => {
            if (deferred.length === 0) return;
            for (const pending of deferred.splice(0, deferred.length)) {
                pending.applyState();
                pending.emitEvents();
            }
        };
        interface PositionalTurnSel {
            tgt: CombatActor;
            pattern: ParsedPattern;
            target: ParsedTarget;
            preTurnVictimStatus: Map<string, PreTurnVictimStatusSnapshot> | undefined;
            scalars: AttackerDamageScalars;
            hitCrits: boolean[];
            perVictimOutgoing: PlayerTurnResult['perVictimOutgoing'];
            rollVictimCrit?: (victimAffinity: AffinityName) => boolean;
            deferredAbilityPerformed: PlayerTurnResult['deferredAbilityPerformed'];
            positionalDetonation: DetonationRecipe | undefined;
            /**
             * PR8: this cast's per-sub-attack debuff applier and its cast-time deferred list.
             * The helper owns WHEN each landing's state write happens; playerTurn owns the roll.
             * Both optional in effect — `applyDebuffsForSubAttack` is undefined for a cast with no
             * gated debuff clause, and the deferred list is empty for a cast whose clauses all
             * precede its damage, which is almost the whole corpus.
             */
            applyDebuffsForSubAttack: PlayerTurnResult['applyDebuffsForSubAttack'];
            deferredEnemyApplications: PlayerTurnResult['deferredEnemyApplications'];
            /** SP-4b-2 D4: this turn's scheduled enemy effects AFTER its landing/resist draw.
             *  `undefined` only where the turn itself produced none — `victimEnemyBuffs` then keeps
             *  its raw bucket read, which is the pre-fix behaviour. (This used to add "the enemy
             *  site's hoisted capture on a dead-target turn"; #346 deleted both the dead-target
             *  skip and the hoist — the enemy site reads the value straight off its turn result.) */
            scheduledEnemyEffects: PlayerTurnResult['scheduledEnemyEffects'] | undefined;
        }
        /** One footprint victim's `attacked` signal within ONE sub-attack. */
        interface PositionalVictimSignal {
            damage: number;
            shieldWasHit: boolean;
            hitOutcomes: boolean[];
        }
        /**
         * A cast's `attacked` signals grouped by SUB-ATTACK (epic: multi-hit full-walk attacks,
         * PR2 Task 2). Outer key = the 0-based sub-attack index PR1 threads through every
         * per-victim callback; inner key = victim id. A multi-hit skill is N consecutive
         * full-walk attacks, so each sub-attack owns its own footprint and its own signals —
         * which is what lets PR2 Task 3 interleave sub-attack k's `ability-performed` with
         * sub-attack k's `attacked` events.
         *
         * Because a victim appears at most ONCE per sub-attack, every inner signal carries
         * exactly ONE `hitOutcomes` entry. The per-hit `attacked` cardinality that incoming
         * procs (Reactive Ward / Tenacity / Second Wind) depend on is therefore unchanged —
         * it simply moves from "one victim entry with N outcomes" to "N sub-attack entries
         * with one outcome each".
         *
         * PR2 Task 3 consumes the grouping: the buckets are emitted one at a time, each right
         * after its own sub-attack's `ability-performed`. Two payload fields therefore change for
         * a multi-hit cast (and ONLY for a multi-hit cast — with N=1 there is one bucket and the
         * numbers are the cast's): each `attacked` now carries its SUB-ATTACK's damage rather than
         * the victim's cast-wide aggregate, and `shieldWasHit` is that sub-attack's flag rather
         * than an OR across the cast. Both are the corrected values — a per-hit `attacked` that
         * reported the whole cast's damage over-fed Tenacity's >25%-maxHP gate and the log's
         * splash `amount`.
         */
        type PositionalAttackedSignals = Map<number, Map<string, PositionalVictimSignal>>;
        const drivePositionalTurnApply = (
            actor: CombatActor,
            tb: TurnBindings,
            sel: PositionalTurnSel,
            onVictimResolved: (
                victim: CombatActor,
                damage: number,
                outcome: VictimDamageOutcome,
                didCrit: boolean
            ) => void,
            /**
             * Emits ONE sub-attack's `attacked` events (PR2 Task 3 — was one call for the whole
             * cast). Invoked once per sub-attack that produced signals, in ascending index order,
             * immediately after that sub-attack's own `ability-performed`.
             *
             * PR4: the bucket's index is passed too, so it can be stamped onto each `attacked`
             * event. A victim-side once-per-attack rider guard needs it to reset between the
             * attacker's consecutive attacks instead of collapsing all N into one.
             */
            emitAttackedForSubAttack: (
                victims: Map<string, PositionalVictimSignal>,
                subAttackIndex: number
            ) => void,
            /**
             * The enemy site emits its `attacked` AFTER the helper returns (its row-14 accounting
             * tail is kept inline — SP-U U5). Set to defer everything except the FIRST
             * `ability-performed`, which stays exactly where the single aggregate emit has always
             * been (before the per-victim detonation): the returned `emitDeferred` runs the rest
             * of the interleaved sequence at the call site's own emit point. With N=1 that is
             * byte-identical to the pre-PR2 order (event → detonation → attacked).
             */
            deferEmission = false
        ): {
            critAgg: {
                anyCrit: boolean;
                critPairs: number;
                critVictimIds: string[];
                subAttacks: SubAttackOutcome[];
            };
            /** Runs the deferred remainder of the emission sequence. No-op unless `deferEmission`. */
            emitDeferred: () => void;
        } => {
            // Record EACH footprint victim's damage + shield-hit flag so the post-apply emit wakes
            // EVERY hit victim's on-attacked reactives (counters + self-repairs/defensive buffs),
            // not just the anchor. Keyed by (subAttackIndex, victim.id) since PR2 Task 2, and
            // consumed one bucket at a time by the interleaved emit below.
            const attackedSignals: PositionalAttackedSignals = new Map();
            // PR8: buffered `debuff-applied` / `debuff-resisted` emitters, keyed by the sub-attack
            // whose boundary produced them. The STATE writes already ran in the loop (that is the
            // point — sub-attack k's stack must be in the store when sub-attack k+1 reads
            // defenseProfileOf); only the events wait here, so each lands after its own
            // sub-attack's `ability-performed` row exists.
            const debuffEmittersBySubAttack = new Map<
                number,
                ((subAttackIndex?: number) => void)[]
            >();
            const bufferDebuffEmitters = (
                index: number,
                pairs: PlayerTurnResult['deferredEnemyApplications']
            ): void => {
                if (pairs.length === 0) return;
                const at = debuffEmittersBySubAttack.get(index) ?? [];
                for (const pair of pairs) at.push(pair.emitEvents);
                debuffEmittersBySubAttack.set(index, at);
            };
            // Per-footprint Stasis-break: collect EVERY covered footprint victim (≠ anchor) stasised
            // at hit time so its Stasis is broken too — the anchor break is handled at the call site.
            // Covered victims have no same-turn re-apply vector → unconditional break.
            const coveredStasisVictims = new Set<string>();
            // Collect EVERY footprint victim hit by this cast's firing damage (unique by id) so each
            // can detonate its OWN containers after the firing hits land.
            const detonationTargets = new Map<string, CombatActor>();
            const critAgg = drivePositionalApply({
                scalars: sel.scalars,
                hitCrits: sel.hitCrits,
                pattern: sel.pattern,
                target: sel.target,
                actingPosition: actor.position!,
                // Static per-ship flag OR the timed `Rogue's Liberty` (see selectTurnTarget).
                // Both reads are needed: selectTurnTarget picks the cast's `tgt`, while this loop
                // re-resolves the anchor for every hit — a buff read at only one of them would let
                // the two disagree about which victim the cast is actually pointed at.
                ignoresForcedTargeting:
                    actor.ignoresForcedTargeting || holdsRoguesLiberty(statusEngine, actor.id),
                ignoresStealth: actor.ignoresStealth,
                actingId: actor.id,
                opposingLiving: tb.opposingRoster,
                applyToVictim: tb.applyToVictim,
                // SP-4b-2 D4: the acting turn's landed scheduled enemy effects reach
                // defenseProfileOf's per-victim modifier read, so a RESISTED scheduled debuff
                // stops cutting the victim's defence behind the reporting channel's back.
                scheduledEnemyEffects: sel.scheduledEnemyEffects,
                perVictimOutgoing: sel.perVictimOutgoing,
                preTurnVictimStatus: sel.preTurnVictimStatus,
                // Per-victim crit: each covered footprint victim rolls at ITS own affinity-capped
                // rate against this attacker. sel.rollVictimCrit is defined for every positional turn
                // (turn.rollVictimCrit is a required PlayerTurnResult field); the conditional wrap
                // reproduces the enemy site's defensive `? … : undefined` shape exactly.
                rollVictimCrit: sel.rollVictimCrit
                    ? (v) => sel.rollVictimCrit!(v.affinity ?? 'antimatter')
                    : undefined,
                onVictimResolved: (victim, damage, outcome, didCrit, subAttackIndex) => {
                    // Injected per-site leech direction (Note A): standing (player→enemy) vs taken
                    // (enemy→player, which also captures the focus victim's shield-hit flag).
                    onVictimResolved(victim, damage, outcome, didCrit);
                    detonationTargets.set(victim.id, victim);
                    // A hit whose FULL post-block damage was converted into a DoT (Voron/Orel's
                    // transform-incoming-to-dot) dealt NO direct damage — it is not a direct hit,
                    // so it must NOT contribute an `attacked` signal. Otherwise "directly damaged"
                    // reactions (Cultivator's on-ally-attacked repair, counters, Tenacity) fire off
                    // a hit that never landed. The transform is all-or-nothing, so transformedToDot
                    // > 0 ⟺ zero direct damage. When Voron is stasised/disabled the transform never
                    // runs (transformedToDot stays 0) and the hit signals normally — no special case
                    // needed here. Detonation / stasis-break bookkeeping above stays unconditional
                    // (the victim WAS targeted).
                    const fullyTransformedToDot = (outcome.transformedToDot ?? 0) > 0;
                    if (!fullyTransformedToDot) {
                        // PR2 Task 2: bucket by sub-attack first. `subAttackIndex` is optional on
                        // the callback contract (PR1 added it trailing so pre-existing callers keep
                        // compiling); applyPositionalDamage always supplies it, and `?? 0` degrades
                        // to the single-bucket, pre-grouping behaviour for any caller that does not.
                        const subAttack = subAttackIndex ?? 0;
                        let bySubAttack = attackedSignals.get(subAttack);
                        if (!bySubAttack) {
                            bySubAttack = new Map<string, PositionalVictimSignal>();
                            attackedSignals.set(subAttack, bySubAttack);
                        }
                        const prev = bySubAttack.get(victim.id) ?? {
                            damage: 0,
                            shieldWasHit: false,
                            hitOutcomes: [],
                        };
                        prev.damage += damage;
                        prev.shieldWasHit =
                            prev.shieldWasHit ||
                            (!outcome.barriered &&
                                !outcome.converted &&
                                outcome.shieldBefore > 0 &&
                                outcome.hpDamage < damage);
                        prev.hitOutcomes.push(didCrit);
                        bySubAttack.set(victim.id, prev);
                    }
                    // Record covered (non-anchor) victims stasised at hit time for the post-apply break.
                    if (
                        !actor.doesntBreakStasis &&
                        victim.id !== sel.tgt.id &&
                        isStasised(victim.id)
                    ) {
                        coveredStasisVictims.add(victim.id);
                    }
                },
                onSubAttackStart: (sub) => {
                    // Clauses written BEFORE the damage clause apply ahead of this sub-attack's
                    // damage — the locked intra-cast order, now per sub-attack. Sub-attack 0's
                    // before-damage clauses already applied inline at cast time.
                    if (sub.index === 0) return;
                    bufferDebuffEmitters(
                        sub.index,
                        sel.applyDebuffsForSubAttack?.(sub, 'before-damage') ?? []
                    );
                },
                onSubAttackEnd: (sub) => {
                    if (sub.index === 0) {
                        // Sub-attack 0 keeps its CAST-TIME roll (three consumers read that outcome
                        // before this loop runs — see applyDebuffsForSubAttack's doc). What moves is
                        // the state write AND the paired `debuff-applied`'s EMISSION POINT: the
                        // `bufferDebuffEmitters` call below reattaches sub-attack 0's events to
                        // sub-attack 0's own emission step instead of leaving them to the historical
                        // post-walk flush. That ordering is observable — with a victim killed on
                        // sub-attack 0, the cast's first `debuff-applied` names that victim here and
                        // names a LATER sub-attack's victim with this branch forced off. Both effects
                        // are gated on a LATER sub-attack existing to see them: with one sub-attack
                        // there is no next reader, so the write and the emission both stay at the
                        // historical flush site and N=1 is byte-identical BY CONSTRUCTION.
                        if (sub.index < sel.scalars.hits - 1) {
                            const pending = sel.deferredEnemyApplications.splice(
                                0,
                                sel.deferredEnemyApplications.length
                            );
                            for (const pair of pending) pair.applyState();
                            bufferDebuffEmitters(sub.index, pending);
                        }
                        return;
                    }
                    bufferDebuffEmitters(
                        sub.index,
                        sel.applyDebuffsForSubAttack?.(sub, 'after-damage') ?? []
                    );
                },
            });
            // Set the DEFERRED Stasis break for every covered victim (unconditional — covered victims
            // have no same-turn re-apply vector). The victim's own skip branch consumes it next turn.
            // Pure state, no events: hoisted ABOVE the emission block (PR2 Task 3) so the
            // interleaved event/attacked pairs below stay adjacent, with nothing between them.
            for (const victimId of coveredStasisVictims) {
                stasisBreakPending.set(victimId, true);
            }
            // ── Interleaved per-sub-attack emission (PR2 Task 3) ───────────────────────────
            // A multi-hit skill is N consecutive full-walk attacks, so this cast emits ONE
            // `ability-performed` per sub-attack that landed, each IMMEDIATELY followed by that
            // sub-attack's own `attacked` events.
            //
            // The adjacency is load-bearing, not cosmetic: buildCombatLog's `attacked` handler
            // fills `openAttackEntry`, which is whichever attack row was created most recently.
            // Emitting all N events first would leave rows 1..N-1 with zero targets, and
            // `finalizeMissEntry` silently splices a target-less non-miss row out as a phantom —
            // collapsing N rows into one and losing the per-sub-attack detail.
            //
            // Built as a step list rather than emitted inline so the enemy site can run the first
            // step here and the remainder after its own tail (see `deferEmission`).
            const steps: { isEvent: boolean; run: () => void }[] = [];
            /** Push sub-attack `idx`'s buffered debuff events, after that index's `attacked`. */
            const pushDebuffSteps = (idx: number): void => {
                const emitters = debuffEmittersBySubAttack.get(idx);
                if (!emitters || emitters.length === 0) return;
                steps.push({
                    isEvent: false,
                    run: () => {
                        // #413: hand each emitter the index of the bucket it was filed under. This
                        // is the only place that identity still exists — the pairs were built
                        // inside runPlayerTurn's debuff loop, which does not know which sub-attack
                        // it is in — and it is what lets a `debuff-resisted` be attack-scoped.
                        for (const emit of emitters) emit(idx);
                    },
                });
            };
            const signalledIndices = [...attackedSignals.keys()].sort((a, b) => a - b);
            // PR8: the indices that owe an emission step in the two loops that would otherwise walk
            // `attacked` signals ALONE — the nothing-landed fallback and the inline-emitted `else`.
            // A sub-attack can hold buffered debuff events with NO signals: the boundary hooks fire
            // whenever the anchor resolved, including over an EMPTY footprint, and a single-target
            // clause lands on the anchor regardless. Walking signals alone would drop those events.
            // Every signalled index has size > 0 (entries exist only once a signal is pushed), so
            // for a cast with no buffered events this set is `signalledIndices` and both loops stay
            // byte-identical. The main per-index loop below needs no such union: its `indices` is
            // already built over every `critAgg.subAttacks` entry, whiffs included.
            const emissionIndices = [
                ...new Set([...signalledIndices, ...debuffEmittersBySubAttack.keys()]),
            ].sort((a, b) => a - b);
            if (sel.deferredAbilityPerformed) {
                const dap = sel.deferredAbilityPerformed;
                // Gate on the FOOTPRINT ALONE, not on `whiffed` and not on the damage:
                //  • `whiffed` records only that the anchor failed to resolve, so a resolved anchor
                //    over an empty footprint yields {whiffed:false, victimIds:[], damage:0} and
                //    emitting there would be a phantom attack. `on-crit` and `on-debuff-inflicted`
                //    have no damage guard the way `on-deal-damage` incidentally does, so a phantom
                //    event really would fire them.
                //  • `sub.damage` is the POST-funnel `incomingBooked` sum, which is legitimately 0
                //    for a sub-attack whose whole hit was redirected by Protection or transformed
                //    into a DoT. That is a real attack under the locked rule — it struck victims,
                //    it rolled, it must emit — and excluding it ALSO re-inflates the survivors,
                //    because `share = dap.damage / emitting.length` divides the cast's pre-funnel
                //    directDamage by the emitting count. (The plan prescribed `damage === 0` here;
                //    that was a plan defect, corrected in the plan file too.)
                //    PR6 NUANCE: emitting is still right, and the outgoing riders no longer pay out
                //    for it. Such an event carries `deliveredDamage: 0` and the `on-deal-damage`
                //    guard (triggers.ts) now reads THAT rather than `damage`, so the event exists
                //    for the log and for the incoming side while its outgoing riders stay silent.
                //    Note this splits the two cases named above: a DoT transform zeroes
                //    `deliveredDamage`, a Protection REDIRECT does not — the cascade's diverted
                //    chunk still counts as delivered, so a fully-redirected sub-attack still pays
                //    its riders.
                const emitting = critAgg.subAttacks.filter((sub) => sub.victimIds.length > 0);
                if (emitting.length === 0) {
                    // Nothing landed: every sub-attack either whiffed (no anchor) or resolved over
                    // an EMPTY footprint. Note this is a footprint test only — a sub-attack that
                    // struck victims but booked no damage (Protection redirect, DoT transform) is
                    // still an attack and emits above.
                    // The cast still reports ONE attack with the cast-wide aggregate — exactly the
                    // pre-PR2 emit, which is what keeps a whiffed/absorbed N=1 cast byte-identical
                    // (its target-less row is pruned by finalizeMissEntry unless a reactive nested
                    // under it, and that pruning decision must not change).
                    // R5(i): `deliveredDamage: 0` is REQUIRED, not decorative. `damage` here is the
                    // cast's pre-funnel `directDamage` and stays positive, so an omitted delivered
                    // basis let the `on-deal-damage` guard's `(deliveredDamage ?? damage)` chain
                    // fall through to it — and riders (Burner's Inferno, Warpstrike, Zeolite) paid
                    // out for a cast that struck nobody. `subAttack` stays undefined: this row has
                    // no sub-attack identity, and that is also what makes `flushReflectLogs` drain
                    // everything, which is the pre-PR2 behaviour this branch exists to preserve.
                    steps.push({
                        isEvent: true,
                        run: () =>
                            emitDeferredAbilityPerformed(
                                dap,
                                dap.damage,
                                critAgg.anyCrit,
                                critAgg.critPairs,
                                critAgg.critVictimIds,
                                undefined,
                                0
                            ),
                    });
                    for (const idx of emissionIndices) {
                        const victims = attackedSignals.get(idx);
                        if (victims && victims.size > 0) {
                            steps.push({
                                isEvent: false,
                                run: () => emitAttackedForSubAttack(victims, idx),
                            });
                        }
                        pushDebuffSteps(idx);
                    }
                } else {
                    // Per-event damage: the cast's pre-funnel `directDamage` split across the
                    // emitting sub-attacks — today's basis, N ways (see the Decisions table).
                    // N=1 ⟹ the divisor is 1 ⟹ the exact same number as before.
                    const share = dap.damage / emitting.length;
                    const emittingIndices = new Set(emitting.map((sub) => sub.index));
                    const indices = [
                        ...new Set([
                            ...critAgg.subAttacks.map((sub) => sub.index),
                            ...signalledIndices,
                        ]),
                    ].sort((a, b) => a - b);
                    for (const idx of indices) {
                        const sub = critAgg.subAttacks[idx];
                        if (sub && emittingIndices.has(idx)) {
                            steps.push({
                                isEvent: true,
                                run: () =>
                                    emitDeferredAbilityPerformed(
                                        dap,
                                        share,
                                        sub.didCrit,
                                        // THIS sub-attack's critting victims, not the cast-wide
                                        // critPairs — that count is hits × victims and would make
                                        // `on-crit` fire the whole cast's tally N times over. Σ of
                                        // these lengths reproduces critPairs exactly.
                                        sub.critVictimIds.length,
                                        sub.critVictimIds,
                                        idx,
                                        sub.deliveredDamage
                                    ),
                            });
                        }
                        // Emitted unconditionally on the index, independent of whether this bucket
                        // also produced an event: total `attacked` cardinality is invariant across
                        // PR2, which is what keeps incoming procs correct. (Since the gate above
                        // tests the footprint alone, a bucket with signals always has an event too
                        // — signals only exist for victims — but the two are kept independent so a
                        // future gate change cannot silently drop `attacked` events.)
                        const victims = attackedSignals.get(idx);
                        if (victims && victims.size > 0) {
                            steps.push({
                                isEvent: false,
                                run: () => emitAttackedForSubAttack(victims, idx),
                            });
                        }
                        // PR8: this sub-attack's own debuff events, after its `attacked`.
                        // Unconditional on the index — a bucket can hold debuff events with no
                        // `attacked` signals when every hit was transformed into a DoT.
                        pushDebuffSteps(idx);
                    }
                }
                // Sweep: a sub-attack that buffered log rows but emitted no event (nothing landed)
                // would otherwise leak them into the next turn's row. No-op in every normal case.
                steps.push({ isEvent: false, run: () => flushReflectLogs() });
            } else {
                // runPlayerTurn already emitted this cast's `ability-performed` inline — only the
                // `attacked` fan-out is ours. Same events, same per-victim order, now grouped by
                // sub-attack.
                for (const idx of emissionIndices) {
                    const victims = attackedSignals.get(idx);
                    if (victims && victims.size > 0) {
                        steps.push({
                            isEvent: false,
                            run: () => emitAttackedForSubAttack(victims, idx),
                        });
                    }
                    pushDebuffSteps(idx);
                }
            }
            let emitDeferred = (): void => {};
            if (deferEmission) {
                // Keep ONLY a LEADING `ability-performed` here (its historical position); the rest
                // of the sequence — including that event's own `attacked` — runs at the call
                // site's emit point.
                //
                // The hoist tests `steps[0]` specifically, NOT `findIndex(isEvent)`. Searching past
                // leading non-event steps would REORDER the stream whenever sub-attack 0 produced
                // `attacked` signals but no event: it would pull sub-attack 1's event forward past
                // sub-attack 0's `attacked`, which then replays after it and attaches sub-attack 0's
                // victims to sub-attack 1's log row. When step 0 is not an event we defer the whole
                // list, which keeps relative order intact at the cost of the historical position of
                // the first event — the strictly safer trade.
                const hoistFirst = steps.length > 0 && steps[0].isEvent;
                if (hoistFirst) steps[0].run();
                const rest = hoistFirst ? steps.slice(1) : steps;
                emitDeferred = () => {
                    for (const step of rest) step.run();
                };
            } else {
                for (const step of steps) step.run();
            }
            // Per-victim skill-triggered detonation. Each victim HIT by this cast that is STILL ALIVE
            // detonates its OWN containers (no role-scale — full stored stacks). Bombs = full shield
            // drain/no pen; inferno+corrosion BYPASS shield (DoT semantics). Credited to the
            // detonating actor's per-round detonation tally + roundPerTargetDamage; NOT into
            // cumulativeDamage (HP lands per-victim via applyVictimDamage). `sink` serves both
            // directions (SP-U U1). recipe present only when a detonate-dot ability fired.
            const recipe = sel.positionalDetonation;
            if (recipe && recipe.dets.length > 0) {
                applyPerVictimDetonation(recipe, detonationTargets, sink, actor.id, tb);
            }
            return { critAgg, emitDeferred };
        };

        // H1 Task 6: rebind the per-round shield-granted accumulator EVERY round (not gated on
        // healTarget) so DPS-mode and team runs reset it too — grantShieldToTarget can fire in
        // any mode, and a stale carry-over would over-report `granted`.
        perActorShieldGranted = new Map<string, number>();
        // Reflect gear set (Task 5): rebind the per-round reflected-thorns accumulator EVERY round
        // (mirrors perActorShieldGranted), so a stale carry-over never over-reports reflected damage.
        perActorReflected = new Map<string, number>();
        // Bomb-splash-on-death: rebind every round (like perActorShieldGranted) so a stale
        // carry-over never over-reports splash. Written only by the death-seam splash block.
        perActorSplash = new Map<string, number>();
        perActorDetonation = new Map<string, number>();
        perActorDot = new Map();
        if (healTarget) {
            currentRoundHealing = new Map<string, ActorHealing>();
            currentRoundRecipientHealing = new Map<string, ActorHealing>();
            currentRoundSourceRepair = new Map<string, number>();
            const targetMaxHp = recipientMaxHp(healTarget.id);
            // Clamp to [0, 100]: a shrunk effectiveMaxHp (expired max-HP buff) can leave
            // currentHp > targetMaxHp, pushing the ratio above 100 — cap it so the reported
            // start % never exceeds full.
            targetHpPctStart =
                targetMaxHp > 0
                    ? Math.min(100, Math.max(0, 100 * (healTarget.currentHp / targetMaxHp)))
                    : 0;
            targetShieldStart = healTarget.shieldPool;
        }

        // Per-focus-turn results; the post-round assembly reads the LAST one for the
        // row's attacker fields. Numeric damage totals are summed across all turns.
        const focusTurns: PlayerTurnResult[] = [];
        // Team-turn resisted enemy applications recorded BEFORE any attacker turn this
        // round (faster team actors). Drained into the FIRST subsequent attacker turn's
        // resistedEnemyDebuffs head; team turns AFTER an attacker turn append to the LAST
        // attacker turn's list (same observable order as the old attackerHasActed +
        // teamResistedEnemyDebuffs staging).
        const pendingResisted: ActiveBuff[] = [];

        // Dead-target turn skip (healing mode): a destroyed heal target does not act. We skip
        // the ENTIRE turn body for that actor — including turn-started/turn-ended emissions and
        // the post-turn status decrement (a dead ship has no live status to tick). Enemy attacker
        // turns are NOT skipped (they keep banking charges and the dead-target damage path returns
        // 0). When the dead actor IS the focus actor a round would otherwise produce ZERO focus
        // turns and the focusTurns.length throw below would fire — so we synthesize a minimal dead
        // focus-turn result (no sourceFired: it did not act) carrying the entering-round
        // enemyHpPct and a zeroed/last-known ctx, just enough for row assembly.
        //
        // Called at TWO sites with identical behavior: (a) the top-of-turn guard (target already
        // dead entering its turn), and (b) immediately after the heal target's OWN turn-start DoT
        // tick (a lethal Corrosion/Inferno tick kills it mid-turn → it must not fall through and
        // act). Returns true when the actor is the dead heal target and the caller must `continue`.
        const handleDeadTargetSkip = (actor: CombatActor): boolean => {
            // A DESTROYED focus does not act, in ANY mode — independent of `healReportActive`.
            // `destroyedRound` is the canonical death signal (state.ts:167, stamped once by
            // `recordDestroyed`); `currentHp <= 0` is NOT, because a never-alive actor (DPS's
            // `hp`-defaults-to-0 focus, see the gate below) also satisfies it
            // (normalizeRoster.ts:126). Before #415 this case was covered incidentally by the
            // `currentHp` branch below, which DPS mode could never reach (healReportActive was
            // false there) — so a faster enemy killing the focus before its own turn left the
            // focus falling through to act anyway. Checked first, unconditionally.
            if (actor.id === focusActorId && actor.destroyedRound !== undefined) {
                // Mirror the gated branch below: when the destroyed focus IS also the heal
                // target (the default — `healTarget = explicitHealTarget ?? attacker`), it
                // shows no buffs this round.
                if (healTarget && actor.id === healTarget.id) {
                    healTargetBuffs = [];
                }
                pushSynthesizedFocusSkipTurn();
                return true;
            }
            // Gated on `healReportActive`, NOT merely on `healTarget` (#415): `hp` defaults to 0 in
            // `simulateDPS` and on the DPS page, so every DPS focus enters the run at currentHp 0.
            // That is NEVER-ALIVE, not KILLED (normalizeRoster.ts:126) — reading it as a corpse
            // skipped the focus's whole turn and returned 0 damage for the entire calculator.
            // Measured: 124 tests across 11 files fail without this gate.
            if (!(
                healReportActive &&
                healTarget &&
                actor.id === healTarget.id &&
                healTarget.currentHp <= 0
            )) {
                return false;
            }
            // A destroyed heal target shows no buffs this round.
            healTargetBuffs = [];
            if (actor.id === focusActorId) {
                pushSynthesizedFocusSkipTurn();
            }
            return true;
        };

        // E5 §4.4: the synthesized no-action focus turn pushed when the focus skips its
        // turn (dead heal-target OR stasised). Extracted from the two byte-identical sites
        // (handleDeadTargetSkip + the stasis gate) so the shape cannot drift.
        const pushSynthesizedFocusSkipTurn = (): void => {
            // #341: this used to carry the row's `enemyHpPct` — a DISPLAY constant of 100, because a
            // turn that never happened struck no victim to read one off. That was the reported bug:
            // on a round where the focus died the chart said "Enemy HP: 100%" while the real enemy
            // sat at 12%. The row now reads the enemy roster at the round head instead
            // (`enteringEnemyHpPct`), which needs no per-turn value at all, so both the field and
            // the constant are gone.
            const lastKnownCtx = lastTurnCtxByActor.get(focusActorId);
            focusTurns.push({
                action: 'active',
                roundCrit: false,
                hitCrits: [],
                dotsConfig: [],
                dotsLanded: true,
                activeSelfBuffs: [],
                landedEnemyDebuffs: [],
                inflictedEnemyDebuffs: [],
                resistedEnemyDebuffs: [],
                // A skipped turn casts nothing, so it holds back nothing (clause order).
                deferredEnemyApplications: [],
                // A skipped turn takes no landing draw and fires no positional attack.
                scheduledEnemyEffects: [],
                directDamage: 0,
                secondaryDamage: 0,
                conditionalDamage: 0,
                detonationDamage: 0,
                extraActionGrants: [],
                // Synthesized skip turn fires no positional attack (no positionalScalars) → this
                // resolver is never invoked; a no-op keeps the required-field shape.
                rollVictimCrit: () => false,
                turnCtx: lastKnownCtx ?? {
                    effectiveAttack: 0,
                    dotMult: 1,
                    affinityMult: 1,
                    effectiveDefence: 0,
                    effectiveMaxHp: 0,
                    outgoingHealPct: 0,
                    incomingHealPct: 0,
                },
            });
        };

        // Per-round extra-action bookkeeping: oncePerRound abilities fire at most once
        // per actor per round (key `${actorId}:${abilityId}`); total insertions are
        // backstopped. A grant bumps the granter's PENDING count by 1 — the selection
        // loop then re-picks it at its LIVE speed-rank among the remaining unacted actors
        // (game-verified: re-added to the turn order; acts immediately only when fastest
        // remaining). The selection comparator (orderByTurnPriority via selectNextBySpeed)
        // owns the speed-position + equal-speed tiebreak, so there is no splice to position.
        const extraActionFired = new Set<string>();
        let extraTurnInsertions = 0;
        const processExtraActionGrants = (
            granter: CombatActor,
            grants: ExtraActionGrant[]
        ): void => {
            for (const g of grants) {
                const key = `${granter.id}:${g.abilityId}`;
                if (g.oncePerRound && extraActionFired.has(key)) continue;
                if (g.oncePerRound) extraActionFired.add(key);
                extraTurnInsertions += 1;
                if (extraTurnInsertions > MAX_EXTRA_TURNS_PER_ROUND) {
                    throw new Error(
                        `combat round ${r}: extra-action insertions exceeded ` +
                            `MAX_EXTRA_TURNS_PER_ROUND (${MAX_EXTRA_TURNS_PER_ROUND}) — ` +
                            `an extra-action grant is re-firing without bound`
                    );
                }
                // Route by pool (Task 4): end-of-round grants (Harvester) bump the end-of-round
                // pool, drained after the normal speed pool; default grants stay speed-positioned
                // in the normal pool. The oncePerRound gate + MAX_EXTRA_TURNS_PER_ROUND backstop
                // above apply to BOTH pools.
                if (g.endOfRound) {
                    endOfRoundPending.set(granter.id, endOfRoundPendingOf(granter.id) + 1);
                } else {
                    pending.set(granter.id, pendingOf(granter.id) + 1);
                }
            }
        };

        // `inTurnLoop` is true only while the selection loop body walks. The two drains outside the
        // loop — the pre-loop `round-started` drain and the round-tail `round-ended` drain — see
        // inTurnLoop=false → Path B (buffer).
        let inTurnLoop = false;

        // Reactive extra-action bridge (Task 10). PATH A (inTurnLoop): bump the granter's pending
        // count so the selection loop re-picks it at its live speed-rank among the remaining
        // actors (same machinery the attacker/team turn branches use), so a during-turn death
        // grants a SAME-round extra turn. PATH B (no live loop — a death reconciled in one of the
        // drains outside the turn loop, i.e. the `round-started` or `round-ended` drain): buffer
        // onto pendingExtraActions; the next round's pool build flushes it. Since bySide PR2 the
        // granter may be a PLAYER or ENEMY actor (the ship whose death-passive fired), resolved
        // from the combined allActorsById roster; a missing id is impossible (every reactive owner
        // id is in allActors) → skip defensively rather than throw mid-drain.
        const grantExtraAction = (
            granterId: string,
            abilityId: string,
            oncePerRound: boolean,
            endOfRound: boolean
        ): void => {
            const granter = allActorsById.get(granterId);
            if (!granter) return;
            if (inTurnLoop) {
                processExtraActionGrants(granter, [{ abilityId, oncePerRound, endOfRound }]);
            } else {
                pendingExtraActions.push({ granterId, abilityId, oncePerRound, endOfRound });
            }
        };

        // Drain the intent queue FIFO. Listeners may have enqueued during the emission
        // that triggered this drain; executed intents may emit events (chaining) that
        // enqueue MORE — those form the next generation. A generation is the batch
        // present when a drain pass starts; the loop processes one generation per pass
        // and stops when the queue is empty. MAX_INTENT_GENERATIONS converts a
        // pathological self-feeding loop into a thrown error rather than a hang.
        // Side-parameterized drain (enemy-team PR1). The four side-specific fields are
        // `runtimes`, `recipientIds` (→ executeIntent ctx.playerIds), `isLowestSpeedAllyFor`,
        // and `grantAllyCharges`; everything else is shared and moved verbatim. The player
        // drain (`drainIntentsFor('player')`) and the enemy drain (`drainIntentsFor('enemy')`)
        // below each bind their own queue + sideCtx, so the player path is behaviourally unchanged.
        const drainQueue = (queue: Intent[], sideCtx: ReactiveSideCtx): void => {
            let generation = 0;
            while (queue.length > 0) {
                if (++generation > MAX_INTENT_GENERATIONS) {
                    throw new Error(
                        `combat round ${r}: intent queue exceeded MAX_INTENT_GENERATIONS ` +
                            `(${MAX_INTENT_GENERATIONS}) — a reactive trigger is self-amplifying without bound`
                    );
                }
                // Snapshot this generation's batch; new enqueues during execution run next pass.
                const batch = queue.splice(0, queue.length);
                for (const intent of batch) {
                    // §4.4 TURN-BLOCK reactive suppression (B3 / D-PR13): a turn-blocked unit's reactives are
                    // FULLY locked out. Drop every queued intent whose OWNER is currently turn-blocked (Stasis OR
                    // Disable) — on-attacked, on-ally-attacked, on-crit, on-enemy-destroyed, AND start-of-round
                    // self-buffs (Chakara via round-started) all carry intent.ownerId, so this ONE filter covers
                    // every reactive type for BOTH sides (drainIntentsFor('player') and drainIntentsFor('enemy') share this drainQueue).
                    // Filtered at the DRAIN, before executeIntent. Listeners only ENQUEUE (pure), so dropping an
                    // intent leaves NO partial state. Incoming effects (damage/heals/ally buffs/DoT ticks) are
                    // UNTOUCHED — only the turn-blocked unit's OWN outgoing intents drop.
                    // NOTE: Stasis-only sites (break-on-hit, damage-immunity) intentionally keep using isStasised
                    // directly — Disable never breaks and does not grant immunity.
                    if (isTurnBlocked(intent.ownerId)) continue;
                    executeIntent(intent, {
                        round: r,
                        statusEngine,
                        bus,
                        // Combat-log attribution: the actor whose turn is active when this
                        // reactive intent drains. Set per turn (actingActorId); undefined for a
                        // round-1 start-of-round reactive or a post-round death-drain reaction
                        // (no turn active). The executor's stamping bus brands every reactive
                        // emission with this so a later builder nests the reaction under the
                        // triggering turn, not the reactor's own turn.
                        duringTurnOf: actingActorId,
                        corrosionEntries,
                        infernoEntries,
                        genericDoTEntries,
                        pendingBombs,
                        runtimes: sideCtx.runtimes,
                        grantAllyCharges: sideCtx.grantAllyCharges,
                        removeEnemyCharges: sideCtx.removeEnemyCharges,
                        removeChargesFrom: sideCtx.removeChargesFrom,
                        grantExtraAction,
                        playerIds: sideCtx.recipientIds,
                        // Task 7: drain `enemy-buff` gates read the union of enemy attackers'
                        // self-buffs (names only). Empty in DPS mode → byte-identical.
                        enemyAttackerIds: enemyAttackerActorIds,
                        isActorAlive,
                        selfShieldFullFor: isSelfShieldFull,
                        // SP-F F4: name map for the live `ally-on-team` roster check. Empty in DPS
                        // (no ship names supplied) → buildDrainContext leaves allyTeamNames
                        // undefined → assume-met fallback (byte-identical).
                        nameByActorId: nameByActorId.size > 0 ? nameByActorId : undefined,
                        lastTurnCtxByActor,
                        // #396: the resolver `liveHealChannelPct` needs to shadow the live
                        // enemy-applied heal half against the actor's own named statuses.
                        selfNamedBuffsFor: (id) =>
                            victimSelfBuffs(statusEngine, id, selfBuffLookup),
                        reactiveDealtByOwner,
                        enemyType,
                        // SP-4d: `enemyHp` (IntentExecContext) deleted — it fed only the
                        // buildDrainContext fight-wide `enemyHpPct` derivation this rung removed.
                        // Fix wave 1: `cumulativeDamage` (IntentExecContext) is deleted too — it
                        // had zero readers left anywhere in src/ once that derivation was gone
                        // (verified by grep for `ctx.cumulativeDamage` / `.cumulativeDamage` across
                        // src/, distinct from the engine's own local `cumulativeDamage` variable
                        // and the live `RoundData.cumulativeDamage` display field, which are
                        // unrelated). Do not reintroduce it as a "future consumer might want it"
                        // field — that rationale is exactly what this rung exists to remove.
                        // Bomb damagePerStack/affinity now resolve per OWNER inside the executor
                        // (lastTurnCtxByActor.get(intent.ownerId)) — no global effectiveAttack/
                        // affinityMult here. The focus actor's entry resolves identically to the
                        // pre-Task-6 path (its lastTurnCtx feeds the same value).
                        recordResisted: (resisted) => {
                            const lastTurn = focusTurns[focusTurns.length - 1];
                            // After an attacker turn this round → append to its resisted list;
                            // before any → stage into pendingResisted (drained into the next
                            // attacker turn's head), mirroring the Task-2 team-resist staging.
                            if (lastTurn) lastTurn.resistedEnemyDebuffs.push(resisted);
                            else pendingResisted.push(resisted);
                        },
                        // PR4b: reactive direct damage (Grif/FrontLine/Judge/Chakara/Incinerator/
                        // Rhodium) — full mitigated/crit walk, credited via the single credit
                        // point (creditDamage, inside applyReactiveDamage) so leeches still see it.
                        applyReactiveDamage,
                        // Releases the consequence twins applyReactiveDamage buffered, called by
                        // the executor right after the proc's own attack row is emitted.
                        flushConsequenceLogs,
                        applyCounterAttack,
                        counterFiredThisTurn,
                        reactionFiredThisAttack,
                        // The SAME shared ctx the player turns use, so a reactive
                        // heal/shield/cleanse credits the same per-round buckets and mutates the
                        // same live target. #415: this used to read "healing mode only — undefined
                        // in DPS mode → the executor's heal/shield/cleanse branches stay inert".
                        // `healTarget` is now anchored in EVERY mode, so `healingCtx` (`:3724`) is
                        // always built and the reactive heal/shield/cleanse branches are LIVE in
                        // DPS mode too — pinned by `dpsBattleShieldParity.test.ts`. What DPS mode
                        // still omits is the healing REPORT, gated on `healReportActive`.
                        healing: healingCtx,
                        // Combat-lifetime once-per-battle guard (Task 8): a flagged reactive
                        // repair (Yazid) fires at most once across the whole combat.
                        oncePerCombatFired,
                        // Combat-lifetime per-(owner, ability, source) event counter for
                        // everyNthEvent gates (Zosimos "every second repair → remove charge").
                        repairCountBySource,
                        // Combat-lifetime proc-chance gates (D-PR1): equipment reactive procs
                        // that carry a procChance fire at their stated rate via this accumulator.
                        procChanceGates,
                        // Per-attack proc verdict cache (Insidiousness): one roll per attack,
                        // replayed for every debuff event that attack inflicts.
                        procDecisionThisSubAttack,
                        // Phase 4c PR 6: live lowest-speed-ally gate. UNCONDITIONAL (unlike the
                        // healing-only selfHpPctFor spread) — in DPS mode the set is {attacker}, so
                        // the lone attacker resolves true and DPS gating stays byte-identical.
                        isLowestSpeedAllyFor: sideCtx.isLowestSpeedAllyFor,
                        // Phase 4c PR 1 Task 6 / bySide PR3 Task 2: live self-HP% for drain-time
                        // hp-threshold gates, now sourced per-side from sideCtx.selfHpPctFor.
                        // Player side: heal-target current/max HP (every other id → 100). Enemy
                        // side: 100 for every owner until PR5. #415: this used to add "DPS mode has
                        // no closure (undefined → buildDrainContext defaults to 100)" — with
                        // `healTarget` anchored in every mode the player-side closure (`:3362`) is
                        // always built, so a DPS drain-time hp-threshold gate reads the focus's REAL
                        // live HP instead of a hardcoded 100 (both directions pinned by
                        // `dpsFullEngineChannels.test.ts`'s drain-time gate pair).
                        selfHpPctFor: sideCtx.selfHpPctFor,
                        enemyWithMostBuffs: sideCtx.enemyWithMostBuffs,
                        // Task A: resolve any actor's RAW affinity (combat-wide map, both sides) so
                        // the reactive 'apply'-debuff branch lands vs the ACTUAL target's affinity
                        // (e.g. Martyrdom Disable onto the real killer) rather than the applier's
                        // precomputed-vs-representative static disadvantage flag.
                        affinityOf: (id) => allActorsById.get(id)?.affinity,
                        // SP-4c-2b: the OTHER half of Task A's per-target seam. Task A made the
                        // reactive 'apply' arm read the actual target's AFFINITY; the 'inflict' arm
                        // and the reactive DoT were still drawing against the owner's cached
                        // `liveDebuffLandingChance` — a chance the owner computed for ITS OWN turn
                        // target. This resolves the roll the reactive path actually needs: the
                        // owner's live effective hacking vs THIS victim's live effective security.
                        // Same combat-wide `allActorsById` source as affinityOf/actorById, so it is
                        // team-symmetric for free (either id may be on either side).
                        liveDebuffLandingChanceFor: (ownerId, victimId) =>
                            reactiveLandingChanceFor(ownerId, victimId),
                        // SP-E, Task E4: resolve any actor (either side) by id — the convert-dot
                        // executor uses this to find the ACTUAL victim of an ally's DoT
                        // application (eventCtx.victimId) instead of the fixed enemy/
                        // corrosionEntries closures above (side-biased to the player's single
                        // opposing focus). Combat-wide map — no per-side sideCtx field needed.
                        actorById: (id) => allActorsById.get(id),
                        // Live effective attack, for a reactive bomb applied before its owner's
                        // first turn of the run (no lastTurnCtx to snapshot). Same fold
                        // `effectiveSpeedOf` uses, reading `.attack` instead.
                        effectiveAttackFor: (id) => {
                            const a = allActorsById.get(id);
                            return a
                                ? effectiveStatsOf(statusEngine, selfBuffLookup, a).attack
                                : undefined;
                        },
                        // Same shared sink (SP-U U1) the cast-path forced detonation uses — a
                        // reduce-duration shrink can drive a bomb to 0 on EITHER side's actor.
                        forceDetonateBomb: (victim, sourceId, damage) =>
                            forceDetonateBombOnVictim(victim, sink, sourceId, damage),
                        // Ship-kit W8 Task 12: side-agnostic ship-role lookup (the SAME
                        // roleByActorId map Meatshield's defense-substitution and Graphite's
                        // roleFilter already consume) — feeds the reactive `purge` branch's
                        // per-victim `enemy-type` re-check (Zeolite: "when dealing damage to a
                        // Defender"), team-symmetrically.
                        roleOf: (id) => roleByActorId.get(id),
                        // SP-E, Task E4: live hacking/critDamage for `id` (either side), feeding
                        // Belladonna's conversion-chance (hacking) and paired extend-chance
                        // (critDamage) gates. Same statusEngine/selfBuffLookup every other
                        // effectiveStatsOf call site in this scope uses (e.g. mostBuffsAmong).
                        effectiveStatsFor: (id) => {
                            const a = allActorsById.get(id);
                            return a
                                ? effectiveStatsOf(statusEngine, selfBuffLookup, a)
                                : undefined;
                        },
                        // D-PR14: Doomsayer enemy-highest-attack resolver, the round's first
                        // real activator id, and the shared once-per-round consume set. All
                        // inert today — only consumed by the next task's executor branch.
                        enemyWithHighestAttack: sideCtx.enemyWithHighestAttack,
                        // SP-M M1 Task 6: Chakara's live highest-speed opposing-actor resolver.
                        enemyWithHighestSpeed: sideCtx.enemyWithHighestSpeed,
                        // SP-M M1 Task 7: living opposing roster for an 'all-enemies' reactive
                        // damage proc (Judge/Incinerator per-victim-conditional AoE).
                        livingOpposingActorIds: sideCtx.livingOpposingActorIds,
                        // SP-M M1 Task 7: synthesized enemy debuff/DoT NAMES for a victim — the
                        // EXACT synthesis buildTurnArgs uses (enemyDebuffNamesForTarget), so a
                        // per-victim 'enemy-debuff' name-gate (Incinerator's "with Inferno") reads
                        // the same names as an on-cast gate. Combat-wide (both sides) via
                        // allActorsById, mirroring actorById/affinityOf. Empty for a missing id.
                        enemyDebuffNamesFor: (id) => {
                            const a = allActorsById.get(id);
                            return a ? enemyDebuffNamesForTarget(a) : [];
                        },
                        // SP-M M1 Task 7: a victim's current effective max HP (the same
                        // recipientMaxHp denominator every heal/HP-basis site uses) so the
                        // per-victim hp-threshold gate (Judge's "<50% HP") reads a live HP%.
                        recipientMaxHpFor: (id) => recipientMaxHp(id),
                        firstActivatorId: sideCtx.firstActivatorId,
                        lastStandingId: sideCtx.lastStandingId,
                        oncePerRoundConsumed: sideCtx.oncePerRoundConsumed,
                        perRoundFireCounts: sideCtx.perRoundFireCounts,
                        // D-PR8: live not-hit-this-round gate (Alacrity). hitThisRound is a single
                        // combat-wide Set, so the SAME closure serves both sides (team-agnostic) —
                        // no per-side sideCtx field needed (unlike isLowestSpeedAllyFor).
                        wasHitThisRoundFor: (ownerId) => hitThisRound.has(ownerId),
                        // Phase 0 Task 5: live per-actor own-turn counter (Chrono Reaver /
                        // every-n-turns). allActorsById covers both sides in a single combat-wide
                        // map — no per-side sideCtx field needed (mirrors wasHitThisRoundFor).
                        turnsTakenFor: (ownerId) => allActorsById.get(ownerId)?.turnsTaken ?? 0,
                        // SP-D: live per-actor count of enemies damaged by that actor's most
                        // recent cast this round (Berserker's Marauder Rage, drained via
                        // on-deal-damage). Combat-wide map — no per-side sideCtx field needed
                        // (mirrors turnsTakenFor/wasHitThisRoundFor). SP-4d Fix wave 1: no `?? 1`
                        // default — an owner with no recorded footprint (no delegate call has ever
                        // set one for it, e.g. before its first turn this combat) has an UNKNOWN
                        // footprint, not "hit exactly one enemy". Returning `undefined` lets
                        // buildDrainContext's absent-subject guard leave the gate unresolved
                        // instead of answering a fabricated 1. Tygr's `gte 2` and Berserker's
                        // `gte 3` are unaffected — a fabricated 1 already failed both comparators.
                        enemiesHitThisCastFor: (ownerId) => enemiesHitThisCastByActor.get(ownerId),
                        // D-PR11: live adjacent-allies resolver (Fortifying Shroud). Sourced
                        // per-side from sideCtx; positional neighbours, else all same-side allies.
                        adjacentAllyIdsFor: sideCtx.adjacentAllyIdsFor,
                        // Ship-kit W5 Task C3: OPPOSING-side counterpart (Demolisher bomb-splash's
                        // 'adjacent-enemies' anchor resolution). See IntentExecContext.
                        adjacentOpposingIdsFor: sideCtx.adjacentOpposingIdsFor,
                        footprintAllyIdsFor: sideCtx.footprintAllyIdsFor,
                        // SP-4e: the 'lowest-hp-ally' selector. NOT sourced from sideCtx — the
                        // closure is already side-relative to the OWNER it is asked about, which is
                        // the correct scoping for a drain whose intents can carry either side's
                        // owner id, and it shares the cast path's single ranking.
                        lowestHpAllyIdFor: lowestHpAllyIdForOwner,
                        // #363: actor id → faction, for a reactive `factionFilter`'d ally scope
                        // (site 4 of the four-site sweep — `footprintFilteredRecipients` in
                        // triggers.ts). The same side-agnostic map every other #363 site shares —
                        // no `sideCtx`/bySide dispatch needed, exactly like the cast-path's
                        // `buildTurnArgs` spread above.
                        factionOf,
                    });
                }
            }
        };

        // D-PR14: per-round state — reset each round (declared inside the round loop).
        let firstActivatorId: string | undefined;
        const oncePerRoundConsumed = new Set<string>();
        // ship-kit W3 (Sansi): per-round fire counts backing Ability.maxPerRound — reset each round
        // alongside oncePerRoundConsumed, shared across both drain sides.
        const perRoundFireCounts = new Map<string, number>();

        // C2b-2: opposing actor with the most buffs (Rhodium's enemy-most-buffs purge). Buff
        // count via selfBuffNamesForOwners (incl. unremovable — fine for SELECTION; removal still
        // respects the unremovable set). Ties → first by roster order (deterministic for goldens).
        // Returns undefined for an empty roster — and, the case that actually fires, when no
        // opposing actor carries ANY buff. SP-4c-2d: the executor NO-OPS on undefined. It used to
        // fall back to ctx.enemyId, which is how the DPS dummy got picked (Rhodium's end-of-round
        // purge did this in every buff-less round — 73 measured hits suite-wide). No live call site
        // can hand it an empty roster any more: both arguments
        // (`enemyAttackerActors` / `allPlayerActors`) are fixed
        // arrays built from the input rosters and never filtered by death, and since SP-4b-2b the
        // boundary refuses an absent/empty `enemyAttackers`. The guard stays as a total-function
        // contract, not as a live branch.
        // #407 CLOSED what #403 review Finding 5 left open. This loop used to walk the whole
        // roster, dead or alive, while its two siblings below each filtered `destroyedRound` — so a
        // buffed CORPSE won the selection and the status landed on the corpse's store (death does
        // not clear an actor's self statuses, and a dead actor takes no turns to tick them down, so
        // a corpse from ANY earlier round stayed selectable forever).
        //
        // MEASURED, not argued — and measured twice, because the first number misled. Instrumenting
        // this resolver found 1086 calls whose winner was DEAD, but that counts resolver CALLS, and
        // the eager `enemyMostBuffsId` below is computed once per turn for every caster whether or
        // not the cast has a purge clause to read it. The number that matters is CONSUMED changes:
        // 4 suite-wide (3 at the cast-path selector delegate, 1 at the player reactive drain), and
        // the on-cast purge loop reaches its `enemy-most-buffs` arm only 24 times in the whole
        // suite. The corpus barely exercises this mechanic — which is why the entire existing suite
        // is byte-identical across the fix, and why `aliveSelectorTarget.integration.test.ts` had to
        // be written to observe it at all. It was never corpus-UNREACHABLE, though: Rhodium's
        // end-of-round purge and Lodolite's on-cast purge both share this resolver.
        //
        // The fix is NOT a filter added here. Liveness moved UP to the seam: the `AliveRoster`
        // parameter type below can only be produced by `aliveTargetsOf` (targetableActors.ts), so
        // `tsc` rejects any call site that hands this function a raw roster. That is what makes the
        // gate un-forgettable, and why this loop asks nothing about liveness itself.
        const mostBuffsAmong = (roster: AliveRoster): string | undefined => {
            let best: string | undefined;
            let bestCount = -1;
            for (const a of roster) {
                const n = selfBuffNamesForOwners(statusEngine, [a.id]).length;
                if (n > bestCount) {
                    bestCount = n;
                    best = a.id;
                }
            }
            return bestCount > 0 ? best : undefined; // no buffs anywhere → no most-buffs target
        };

        // D-PR14: opposing actor with the greatest LIVE effective attack (Doomsayer's
        // enemy-highest-attack target). Ties → roster order. #407: the roster arrives already
        // narrowed to the living by `aliveTargetsOf` at the seam, so this no longer passes its own
        // `destroyedRound` predicate — see `mostBuffsAmong` above.
        const highestAttackInRoster = (roster: AliveRoster): string | undefined =>
            highestAttackAmong(
                roster.map((a) => a.id),
                (id) => {
                    const a = roster.find((x) => x.id === id);
                    return a ? effectiveStatsOf(statusEngine, selfBuffLookup, a).attack : 0;
                }
            );

        // SP-M M1 (Task 6): opposing actor with the greatest LIVE effective SPEED (Chakara's
        // enemy-highest-speed round-boundary hit). Reuses the generic highestAttackAmong picker (a
        // max-of-a-stat selector) with a speed accessor. Ties → roster order. #407: pre-gated at
        // the seam, same as its sibling above.
        const highestSpeedInRoster = (roster: AliveRoster): string | undefined =>
            highestAttackAmong(
                roster.map((a) => a.id),
                (id) => {
                    const a = roster.find((x) => x.id === id);
                    return a ? effectiveStatsOf(statusEngine, selfBuffLookup, a).speed : 0;
                }
            );

        // D-PR16: the id of the sole living actor in a roster, or undefined if !=1 alive.
        // Drives the `last-standing` condition (Last Stand). Recomputed each drain so it
        // reflects deaths recorded before the reactive drain.
        //
        // #407: DELIBERATELY NOT routed through `aliveTargetsOf`. "How many of my team are still
        // standing" is a survivor COUNT, not a targeting question, and the gate's second conjunct
        // (`currentHp > 0`) would silently re-rule the Last Stand gate for a never-alive 0-hp
        // actor. See targetableActors.ts's "WHAT THIS IS NOT FOR".
        const soleSurvivorOf = (roster: CombatActor[]): string | undefined => {
            const living = roster.filter((a) => a.destroyedRound === undefined);
            return living.length === 1 ? living[0].id : undefined;
        };

        // SP-M M1 (Task 5): a round's co-located Rhodium purge+damage pair BOTH target
        // 'enemy-most-buffs' and are drained TOGETHER off the SAME queue with ONE ctx instance
        // (drainQueue drains every intent in the queue using the single ctx a drainIntentsFor
        // call built). The purge's own buff removal can zero out the very count that identified
        // the target, so a naive LIVE re-resolution by whichever ability drains SECOND (fixed by
        // sentence position — purge precedes "and deals X% damage" — so purge always drains
        // first) would resolve to nobody even though the FIRST-draining ability already found
        // somebody. `onceByOwner()` memoizes PER (CTX-INSTANCE, ownerId) PAIR: the purge and
        // damage intents belonging to the SAME Rhodium (same ownerId) share one resolution, so
        // they still agree on one pre-purge target — but a SECOND, DIFFERENT-ownerId Rhodium
        // draining off the SAME batch (e.g. two same-side Rhodiums both firing at round-end) gets
        // its OWN fresh resolution, re-evaluated live against the buff state AFTER the first
        // Rhodium's purge already ran (review fix: the original single-cell `once()` ignored
        // `ownerId` entirely and would reuse the FIRST owner's cached target for every owner in
        // the batch, causing the second Rhodium to re-hit the already-stripped target instead of
        // the now-most-buffed one). The NEXT separate drain call in the same round (a fresh
        // playerDrainCtx()/enemyDrainCtx() invocation — e.g. a later turn's pre-cast grant drain)
        // still gets an entirely fresh map and re-resolves live, exactly as before. Scoped to
        // enemyWithMostBuffs only — every other resolver (enemyWithHighestAttack,
        // lastStandingId, etc.) is untouched.
        const onceByOwner = <T>(fn: () => T): ((ownerId: string) => T) => {
            const cache = new Map<string, T>();
            return (ownerId: string) => {
                if (!cache.has(ownerId)) cache.set(ownerId, fn());
                return cache.get(ownerId) as T;
            };
        };

        // #407: THE aliveness gate for the two reactive drain contexts below — one thunk per side,
        // read by every selector in that ctx. Thunked, never hoisted into an array: actors die
        // between drains within a round, and a snapshot would re-admit a corpse. The two are exact
        // mirrors (each side's OPPOSING roster), which is what makes the fix team-symmetric by
        // construction rather than by a pair of parallel edits that could drift.
        const alivePlayerDrainOpposing = (): AliveRoster => aliveTargetsOf(enemyAttackerActors);
        const aliveEnemyDrainOpposing = (): AliveRoster => aliveTargetsOf(allPlayerActors);

        // Player drain — binds the player queue + player-side ctx. Behaviourally identical to
        // the pre-refactor drainIntents (same runtimes/playerIds/lowest-speed/grantAllyCharges).
        // Hoisted into a named factory (SP-G G2) so the new pre-cast start-of-turn grant drain
        // can reuse the exact same ctx shape as the full drain.
        const playerDrainCtx = (): ReactiveSideCtx => ({
            runtimes: runtimesById,
            recipientIds: playerIds,
            isLowestSpeedAllyFor: (ownerId) => bySide('player').lowestSpeedIds().has(ownerId),
            grantAllyCharges: bySide('player').grantAllyCharges,
            removeEnemyCharges: bySide('player').removeEnemyCharges,
            removeChargesFrom: bySide('player').removeChargesFrom,
            selfHpPctFor: bySide('player').selfHpPctFor,
            // The three opposing-side resolvers below read the REAL positioned enemy roster,
            // unconditionally.
            //
            // SP-4c-2d: each used to be a ternary on `hasPositionedEnemyRoster` whose else arm
            // handed back the dummy `enemy`'s id — the pre-SP-M behaviour, from when a roster-less
            // "pure DPS mode" made that actor the genuine target. That premise died at SP-4b-2b
            // (an absent/empty roster is refused) and the gate became constant true at SP-4c-2a
            // (every member is floored hittable), so the arms were unreachable before this rung
            // deleted the actor they aimed at. Two OTHER gates were tried for this job and both
            // were wrong; the history is worth keeping because both mistakes are easy to repeat:
            //   • the RETIRED `dummyEnemyIsVestigial` turn-order gate AND'ed in a second conjunct
            //     ("every player actor is positioned with an ENEMY-side parsed target"), which read
            //     false whenever the player team included an ally-targeting ship — a healer — even
            //     in a fully positional battle, misrouting Judge/Incinerator/Chakara/Rhodium's
            //     reactives onto the dummy;
            //   • the then-named `positionalTeamBattle` input field (now `mode: 'battle'`)
            //     over-corrected: only simulateBattle set it, yet direct-engine tests (e.g.
            //     purgeConditionalSources.test.ts) supply a real positioned roster without it.
            enemyWithMostBuffs: onceByOwner(() => mostBuffsAmong(alivePlayerDrainOpposing())),
            enemyWithHighestAttack: () => highestAttackInRoster(alivePlayerDrainOpposing()),
            // SP-M M1 (Task 6): plain arrow, NOT onceByOwner — Chakara has no purge/damage race
            // (its co-located clause is a self-buff), so LIVE re-resolution per drain is correct.
            enemyWithHighestSpeed: () => highestSpeedInRoster(alivePlayerDrainOpposing()),
            // SP-M M1 (Task 7): living opposing roster for an 'all-enemies' reactive damage proc
            // (Judge/Incinerator) — each resolved victim's own hp-threshold/enemy-debuff gates are
            // re-checked per victim downstream. #407: reads the shared gate instead of its own
            // inline `destroyedRound` filter, so it now also excludes the never-alive 0-hp shape.
            livingOpposingActorIds: () => alivePlayerDrainOpposing().map((a) => a.id),
            firstActivatorId,
            lastStandingId: soleSurvivorOf(allPlayerActors),
            oncePerRoundConsumed,
            perRoundFireCounts,
            adjacentAllyIdsFor: bySide('player').adjacentAllyIdsFor,
            // Ship-kit W5 Task C3: a player-owned reactive's 'adjacent-enemies' anchor (the bomb
            // victim) lives on the ENEMY side — mirrors livingOpposingActorIds' direction, not
            // adjacentAllyIdsFor's (which stays bound to this drain's OWN side, player).
            adjacentOpposingIdsFor: bySide('enemy').adjacentAllyIdsFor,
            footprintAllyIdsFor: bySide('player').footprintAllyIdsFor,
        });
        // Enemy drain (enemy-team PR1) — binds the SEPARATE enemy queue + enemy-side ctx.
        // recipientIds is the enemy-attacker ids (PR1 exercises self-target only; this
        // future-proofs PR2 enemy→enemy reactions). grantAllyCharges is bySide('enemy').grantAllyCharges
        // (Gap F — enemy ally-charge grants, done in enemy-team PR3): a reactive enemy
        // ally-charge grant now bumps the enemy attackers' charges, not the player team.
        // Skips entirely when the enemy queue is empty (DPS / no enemy reactives) so the
        // player path is untouched.
        // Use the enemy executor's own runtime map (NOT runtimesById, which drives
        // leech scan / seeding / credit and must stay player-only). This reuses the
        // existing enemyPlayerRuntimeByActorId — same source, key, and values.
        // Hoisted into a named factory (SP-G G2) alongside playerDrainCtx above.
        const enemyDrainCtx = (): ReactiveSideCtx => ({
            runtimes: enemyPlayerRuntimeByActorId,
            recipientIds: enemyAttackerActorIds,
            isLowestSpeedAllyFor: (ownerId) => bySide('enemy').lowestSpeedIds().has(ownerId),
            grantAllyCharges: bySide('enemy').grantAllyCharges,
            removeEnemyCharges: bySide('enemy').removeEnemyCharges,
            removeChargesFrom: bySide('enemy').removeChargesFrom,
            selfHpPctFor: bySide('enemy').selfHpPctFor,
            enemyWithMostBuffs: onceByOwner(() => mostBuffsAmong(aliveEnemyDrainOpposing())),
            enemyWithHighestAttack: () => highestAttackInRoster(aliveEnemyDrainOpposing()),
            // SP-M M1 (Task 6): plain arrow, NOT onceByOwner — see playerDrainCtx's comment.
            enemyWithHighestSpeed: () => highestSpeedInRoster(aliveEnemyDrainOpposing()),
            // SP-M M1 (Task 7): mirror — an enemy owner scans the living player roster. #407: same
            // shared gate as the player mirror above.
            livingOpposingActorIds: () => aliveEnemyDrainOpposing().map((a) => a.id),
            firstActivatorId,
            lastStandingId: soleSurvivorOf(enemyAttackerActors),
            oncePerRoundConsumed,
            perRoundFireCounts,
            adjacentAllyIdsFor: bySide('enemy').adjacentAllyIdsFor,
            // Ship-kit W5 Task C3: mirror of playerDrainCtx's wiring — an enemy-owned reactive's
            // 'adjacent-enemies' anchor lives on the PLAYER side.
            adjacentOpposingIdsFor: bySide('player').adjacentAllyIdsFor,
            footprintAllyIdsFor: bySide('enemy').footprintAllyIdsFor,
        });
        // SP-U U3: side-parameterized drain replacing the former separate `drainIntents`/
        // `drainEnemyIntents` closures. The queue-empty guard (previously only on the enemy
        // side) is byte-identical for the player side too: drainQueue's `while (queue.length > 0)`
        // already no-ops on an empty queue, and playerDrainCtx()/enemyDrainCtx() build pure
        // closures (no side effects) — skipping their construction when the queue is empty
        // changes nothing observable.
        const drainIntentsFor = (side: Side): void => {
            const queue = intentQueues[side];
            if (queue.length === 0) return;
            drainQueue(queue, side === 'player' ? playerDrainCtx() : enemyDrainCtx());
        };

        // SP-G G2: start-of-turn GRANTS (buffs/shields/heals) must apply BEFORE the acting owner
        // casts, so a self-buff boosts the same turn it is granted (matching the game). Scoped to
        // the acting owner only. CHARGE intents are EXCLUDED — they keep their post-cast drain
        // (see the drainIntentsFor('player')/drainIntentsFor('enemy') calls in the turn loop
        // below), on which the Cobalt charge ledger depends. Team-symmetric: drains both side
        // queues, so a ship on either side gets the same pre-cast ordering. Turn-block
        // suppression is inherited from drainQueue's isTurnBlocked filter — a stunned owner's
        // grant is dropped, matching every other reactive.
        const drainStartOfTurnGrants = (ownerId: string): void => {
            // The spliced batch (p/e) is drained in isolation; any follow-up intents a grant
            // chain-enqueues land on the global queues and drain at the normal post-cast point.
            const isGrant = (i: Intent): boolean =>
                i.ownerId === ownerId &&
                i.ability.trigger === 'start-of-turn' &&
                i.ability.type !== 'charge';
            const take = (queue: Intent[]): Intent[] => {
                const ready: Intent[] = [];
                for (let i = 0; i < queue.length;) {
                    if (isGrant(queue[i])) ready.push(queue.splice(i, 1)[0]);
                    else i++;
                }
                return ready;
            };
            const p = take(intentQueues.player);
            if (p.length) drainQueue(p, playerDrainCtx());
            const e = take(intentQueues.enemy);
            if (e.length) drainQueue(e, enemyDrainCtx());
        };

        // Path-B flush (Task 10): grants buffered from a PRIOR round's post-round enemy death
        // (on-enemy-destroyed → Sokol/Liberator) bump the granter's pending count for THIS round,
        // so the selection loop picks it up at its live speed-rank among all actors.
        // The round's extraActionFired set + MAX_EXTRA_TURNS_PER_ROUND backstop still bound them.
        // The buffer is drained (cleared) here — each pending grant lands exactly one round after
        // its kill was registered. The bump happens BEFORE the pre-loop drain/turn loop so the
        // granter takes its extra turn in selection order. Empty in normal DPS/healing runs → no-op.
        if (pendingExtraActions.length > 0) {
            const flush = pendingExtraActions.splice(0, pendingExtraActions.length);
            for (const g of flush) {
                const granter = allActorsById.get(g.granterId);
                if (!granter) continue;
                processExtraActionGrants(granter, [
                    {
                        abilityId: g.abilityId,
                        oncePerRound: g.oncePerRound,
                        endOfRound: g.endOfRound,
                    },
                ]);
            }
        }

        // round-started: the canonical start-of-round trigger (Phase 3). Fires once per
        // round, before any turn-started of that round. Documented deviation from the
        // Phase 1 contract's turn-started mapping: in a multi-actor round turn-started fires
        // once per actor, so round-started is the reliable "start of round" signal. Emitted
        // here (after the accumulator + drainIntentsFor are in scope) so its start-of-round
        // intents execute BEFORE any turn — no observable ordering change vs the old emit
        // site (nothing between beginRound and here emits an event).
        // #341: the row's enemy-HP reading, captured HERE — before any turn of this round — so it
        // is the enemy HP% ENTERING the round, which is the semantics the field has always carried
        // and the one the chart tooltip needs: it is the reading an hp-threshold gate evaluated
        // during this round was gated against, so a row showing 25% next to an execute ability that
        // did not fire would be self-contradicting. (An end-of-round reading is a defensible chart
        // value on its own, but it de-synchronises the number from the gate, so it is not a free
        // swap — see `dpsSimulator.test.ts`'s execute-gate case, which reads this row to explain
        // which round the gate switched on.)
        //
        // The value is the opposing roster's HP-WEIGHTED remainder. The DPS page — the only consumer
        // of `RoundData.enemyHpPct`, via `DPSRoundChart` — fields exactly ONE enemy, so this IS that
        // enemy's own live HP%; the weighting keeps it honest if the page ever fields more, and is
        // the same convention `simulateDPS`'s `finalHpPct` already uses for the summary (HP% is an
        // intensive per-actor ratio, so a mean of two percentages would let a scratch on a big
        // enemy read like a kill on a small one).
        //
        // It used to be `lastAttackerTurn.enemyHpPct` — the focus's STRUCK VICTIM's reading — with a
        // DISPLAY constant of 100 substituted whenever the focus struck nobody: an ally-targeted
        // cast, or the synthesized skip row after the focus died. That is #341: the chart could
        // report "Enemy HP: 100%" on a round where the real enemy sat at 12%. Reading the roster
        // needs no stand-in, and answers a multi-enemy round with one number instead of naming
        // whichever victim the focus happened to hit last.
        const enteringEnemyHpPct = ((): number => {
            const totalMaxHp = enemyAttackerActors.reduce(
                (sum, a) => sum + recipientMaxHp(a.id),
                0
            );
            // No HP anywhere to lose (an unspecified/zero-max roster) → nothing has been taken off
            // it. Unreachable on a DPS run (`normalizeRoster` floors every enemy's max HP), but this
            // expression also serves healing/battle-mode rows, which carry no such floor.
            if (totalMaxHp <= 0) return 100;
            const remaining = enemyAttackerActors.reduce(
                (sum, a) => sum + Math.max(0, Math.min(a.currentHp, recipientMaxHp(a.id))),
                0
            );
            return (remaining / totalMaxHp) * 100;
        })();

        bus.emit({ type: 'round-started', round: r });
        // Drain point (a): start-of-round intents execute before the first turn.
        drainIntentsFor('player');
        drainIntentsFor('enemy');

        // §4.5 Stasis-break pending map (B3 Task 2). Reset fresh each round (new Map here).
        // Keys: victimIds whose Stasis should be removed when their skip branch runs.
        // Values: always true (present = break approved; absent = no break queued).
        // An entry is added by the ATTACKER's turn block AFTER runPlayerTurn returns:
        //   - the onHitBreakStasis hook fires DURING runPlayerTurn, marks a local Set;
        //   - AFTER the turn, if the victim was stasised at hit time AND the turn did NOT
        //     re-inflict Stasis (inflictedEnemyDebuffs check), the victim id is stored here.
        // Consumed inside each actor's own skip branch (focus / team / real-enemy): if the
        // victim id is present, remove Stasis after the turn-skip logic. This ensures the
        // victim STILL skips its current-round turn (invariant preserved), and is freed for
        // its next turn (Stasis gone). The same-round drain guard (drainIntentsFor('player') / drainIntentsFor('enemy'))
        // runs BEFORE the break resolution → on-attacked reactive sees isStasised=true (test iii).
        // Re-apply check is performed at the ATTACKER's turn, not at consume time, so there is
        // NO casterId lookup: the per-turn inflictedEnemyDebuffs signal is sufficient and correct
        // regardless of which attacker fires on later turns (fixes the casterId-identity bug).
        const stasisBreakPending = new Map<string, true>();
        inTurnLoop = true;
        try {
            let selectionGuard = 0;
            // Pick the next actor to act, OWNING the pending decrement (Task 4). Drain the NORMAL
            // pool first — the unacted actor with the highest CURRENT effective speed (reads live
            // speed buffs → mid-round Speed Up/Down reorders the remainder). Only once the normal
            // pool is fully drained do we consult the END-OF-ROUND pool (Harvester-style grants),
            // again picked by speed AMONG end-of-round actors but unconditionally after every normal
            // action. Returns undefined once both pools are empty → the round ends.
            const selectNext = (): CombatActor | undefined => {
                const normal = selectNextBySpeed(roundActors, pendingOf, effectiveSpeedOf);
                if (normal) {
                    pending.set(normal.id, pendingOf(normal.id) - 1);
                    return normal;
                }
                const eor = selectNextBySpeed(roundActors, endOfRoundPendingOf, effectiveSpeedOf);
                if (eor) {
                    endOfRoundPending.set(eor.id, endOfRoundPendingOf(eor.id) - 1);
                    return eor;
                }
                return undefined;
            };
            for (let actor = selectNext(); actor; actor = selectNext()) {
                // SP-4c-1: a side can be wiped OUTSIDE a turn. Both the start-of-round drain
                // (drain point (a), above) and the previous round's end-of-round drain credit real
                // damage — Rhodium, Grif, FrontLine, Chakara and Incinerator all carry passives
                // that fire there. Without this check the loop would go on to select an actor and
                // let it cast into an empty board, reintroducing exactly the whiff this rule
                // deletes. Checked BEFORE the turn body, so no actor acts after the wipe.
                if (sideIsWiped()) {
                    matchOver = true;
                    break;
                }
                if (++selectionGuard > MAX_SELECTION_TICKS) {
                    throw new Error(
                        `combat round ${r}: turn selection did not terminate (pending actions not draining)`
                    );
                }

                // Dead-target turn skip (top-of-turn): the heal target is already destroyed
                // entering its turn → skip the turn body (see handleDeadTargetSkip above).
                if (handleDeadTargetSkip(actor)) {
                    continue;
                }

                // General dead-actor turn skip (correctness): an actor DESTROYED earlier this
                // round (e.g. a player AoE killed an enemy attacker scheduled later in the turn
                // order, or a walked team ship that died) must NOT act when its turn comes up —
                // no turn-started/turn-ended emit, no runPlayerTurn, no damage. A plain `continue`
                // is correct: every per-iteration step below (turn-started emit, the kind-branch
                // turn body, drainIntentsFor('player')/drainIntentsFor('enemy'), turn-ended) is THIS actor's own turn
                // work, which a dead actor does none of. The pending decrement already happened in
                // selectNext (Task 4) BEFORE the body runs, so the dead actor's pending is consumed
                // and termination is preserved. Extra-action grants only fire from inside a live
                // turn body, so a skipped actor produces none.
                //
                // The signal is `destroyedRound !== undefined` (set by recordDestroyed when the
                // actor's HP first reaches 0) — NOT `currentHp <= 0`: a manual/flat enemy attacker
                // is constructed with stats.hp 0 (HP not modelled) → currentHp starts at 0 yet it
                // was never destroyed and MUST keep acting. Only an actor that ACTUALLY died is
                // skipped.
                //
                // ONE actor is deliberately exempt (it keeps flowing through its EXISTING special
                // handling even after destruction): the dead HEAL TARGET → handleDeadTargetSkip
                // above (healTargetBuffs=[] + the synthesized dead-focus turn). It already
                // `continue`d if dead, so reaching here means it's alive; the exemption is
                // belt-and-suspenders.
                //
                // SP-4c-2d: there used to be a SECOND exemption, `!isDummyEnemy`, for the dummy
                // `enemy` sink. SP-4c-2c dropped that actor from `turnOrderActors` unconditionally,
                // so the exemption could not fire on any run, and this rung deleted the actor
                // outright — there is nothing left to exempt. Do not resurrect it from an older
                // comment or commit: every argument that justified it ("the ONE enemy-side DoT
                // carrier that keeps ticking after death", "so a dead `enemy` would still bank
                // charges if the terminal break were removed") described a turn-taker.
                if (
                    actor.destroyedRound !== undefined &&
                    !(healTarget && actor.id === healTarget.id)
                ) {
                    continue;
                }

                // C2b-2 T5: stamp the acting actor as the prospective lethal attacker BEFORE its
                // damage is applied. Every DIRECT-damage path this turn (focus/team→enemy via
                // applyOutgoingToEnemy, enemy→player via applyIncomingToTarget, positional apply,
                // the non-positional firing hit) routes through the wrappers that read this, so a
                // kill they cause is attributed here. The DoT-tick batch (heal-target turn-start)
                // is the one intake that runs in this same turn yet passes byDirectDamage:false,
                // so it never uses this value as a killer.
                actingActorId = actor.id;
                // #367 fix wave: this actor's turn ctx does not exist until its `runPlayerTurn`
                // returns, so clear the override HERE (one site — this assignment is shared by all
                // three turn branches) rather than leaving the previous actor's ctx paired with the
                // new `actingActorId`. Each branch sets it immediately after its own dispatch.
                actingTurnCtx = undefined;

                // G PR1: reset the once-per-attack counter guard at each actor turn-start so a
                // later attack (a different turn) can counter again while all per-hit `attacked`
                // events of ONE sub-attack collapse to a single counter. PR6: the key carries the
                // sub-attack index, so this clear is no longer what separates a `hits: N` cast's
                // N attacks from each other — the key does that on its own, within the turn.
                counterFiredThisTurn.clear();
                // Task 5: reset the self-rider once-per-attack guard beside the counter guard so a
                // later attack re-applies Hermes's Everliving Regeneration / charge.
                reactionFiredThisAttack.clear();
                // Insidiousness: drop the per-sub-attack proc verdicts so each sub-attack of this
                // turn draws its own single roll (and every debuff ONE sub-attack inflicts shares
                // that sub-attack's verdict). Keys carry the sub-attack index since PR4, so this
                // clear is what stops turn N+1's sub-attack 0 reading turn N's verdict.
                procDecisionThisSubAttack.clear();

                // Set the active carrier for the own-turn self-buff reprieve: a TIMED self-buff
                // written during this actor's own turn is flagged appliedThisTurn so it survives
                // one extra Post Turn (lasting through the carrier's next turn, matching the game).
                // Team-symmetric — applies to the focus, team actors, AND the enemy attackers
                // (an enemy ship that self-buffs on its own turn gets the same reprieve). Must run
                // BEFORE the turn body applies any buffs, so it precedes the kind-branch below.
                statusEngine.beginTurn(actor.id);

                bus.emit({ type: 'turn-started', actorId: actor.id, round: r });
                // Task 6a: LOG-ONLY per-turn snapshot of the acting actor's live modelled stats
                // (no listener subscribes — see the events.ts doc comment). Reads the SAME
                // effectiveStatsOf fold every other live-stat call site in this file uses.
                {
                    const snapshotEff = effectiveStatsOf(statusEngine, selfBuffLookup, actor);
                    bus.emit({
                        type: 'stats-snapshot',
                        actorId: actor.id,
                        round: r,
                        stats: {
                            attack: snapshotEff.attack,
                            defence: snapshotEff.defence,
                            crit: snapshotEff.crit,
                            critDamage: snapshotEff.critDamage,
                            defensePenetration: snapshotEff.defensePenetration,
                            speed: snapshotEff.speed,
                            hacking: snapshotEff.hacking,
                            security: snapshotEff.security,
                            currentHp: actor.currentHp,
                            maxHp: actor.stats.hp,
                            shieldPool: actor.shieldPool,
                        },
                    });
                }
                // Phase 0 Task 5: bump the actor's own-turn counter so every-n-turns conditions
                // can evaluate the live N. Incremented AFTER turn-started so end-of-turn
                // (turn-ended) reactive drains — which run later — read the correct N. 1-based
                // (turnsTaken=1 on the first own turn) matches the evaluator's `t % period === offset`.
                //
                // STASIS/DISABLE: this increment is UNCONDITIONAL — it bumps even on a turn the
                // actor skips under Stasis/Disable, unlike advanceChargeCadence (~4249/4314) which
                // is gated behind !isTurnBlocked. Keeping it monotonic is DELIBERATE: turn-ended
                // (~4595) and the reactive drains (~4567) fire on skipped turns too, so freezing the
                // counter on a skip would let an every-n-turns gate spuriously re-fire against the
                // frozen value — instead the cadence loses the skipped tick and resumes on the
                // original residue (the next own-turn that satisfies `t % period === offset`).
                //
                // The every-n-turns periodic proc IS already fully suppressed on a turn-blocked turn
                // — NO gating is needed HERE. A periodic charge (e.g. Chrono Reaver's `end-of-turn`
                // charge) is a REACTIVE intent carrying intent.ownerId; on a blocked owner's turn the
                // §4.4 reactive-intent drain filter (~3403: `if (isTurnBlocked(intent.ownerId)) continue;`)
                // DROPS it before executeIntent applies the charge. So a stasised/disabled unit banks
                // NO periodic charge, matching the +1/turn baseline. Golden: chronoReaverCharge.integration.test.ts
                // ("stasis suppression"). NOTE: the suppression relies on the owner being STILL
                // turn-blocked at the drain pass — for a 1-turn block the Post-Turn decrement (~4651)
                // can clear the block before the deferred end-of-turn intent drains, so that golden
                // uses a ≥2-turn block spanning a proc turn.
                // SP-4c-2c: the dummy-sink enemy is NOT bumped here any more — it takes no turn, so
                // its `turnsTaken` stays 0 for the whole run. Nothing reads it (it has no
                // every-n-turns ability), which is why this is a note rather than a fix.
                actor.turnsTaken += 1;

                // SP-G G2: apply this actor's start-of-turn GRANTS before it acts (see
                // drainStartOfTurnGrants). Runs for every acting actor on both sides.
                drainStartOfTurnGrants(actor.id);

                // Task 11b: tick the HEAL TARGET's own enemy-applied DoTs at ITS turn-start (the
                // universal rule — DoTs tick at the afflicted ship's turn-start; this used to be
                // phrased as "mirroring the dummy enemy's DoT-tick timing", but since SP-4c-2c the
                // dummy has no turn and so no timing to mirror). An enemy attacker lands
                // inferno/corrosion in the tank's containers
                // (Task 6b); without this tick they would never deal damage. Routes the ticked
                // damage into the INCOMING-damage accounting (shield-first → HP → ship-destroyed →
                // the victim's per-actor intake bucket) — NOT the player→enemy damage path. Reuses tickDoTs:
                // the applier's effectiveAttack/dotMult/affinityMult come from the entry's sourceId
                // (the enemy) via lastTurnCtxByActor; corrosion scales with the AFFLICTED ship's
                // (the tank's) max HP. The dead-target guard above already skipped a destroyed tank,
                // so the tank is alive here. DPS mode / no enemy-applied DoTs → empty containers →
                // a no-op (goldens byte-identical).
                // PR-C C2: unified per-victim DoT-tick prologue. EVERY acting actor (attacker,
                // walked-team ally, enemy attacker) ticks its OWN DoT containers against its OWN HP
                // at its turn-start — the last per-victim gap after the firing hit + skill
                // detonation + timed bursts. The heal-target branch is preserved VERBATIM (snapshot
                // + tankDotDamage healing accounting + dead-skip). The per-victim branch lands HP
                // via applyVictimDamage (DoT → bypass shield) and NEVER calls creditDamage (no
                // cumulativeDamage double-feed).
                //
                // SP-4c-2d: this prologue used to sit inside `if (actor.id !== enemy.id)`, which
                // excluded the dummy so it could take the legacy AGGREGATE tick in its own turn
                // branch instead. SP-4c-2c retired that turn (and with it the aggregate tick) and
                // this rung deleted the actor, so there is nothing to exclude and the wrapper is
                // gone. It was never evaluated for the dummy anyway — the dummy was not in the loop.
                //
                // OUTSIDE every `if (!isTurnBlocked)` stasis gate (this prologue precedes all
                // kind-branches) → a STASISED victim STILL ticks, matching the heal-target
                // precedent and the E5-symmetry invariant. Moving this inside a stasis gate would
                // wrongly silence a stasised victim's DoTs.
                //
                // #415 NOTE — this fork is now REACHABLE IN DPS MODE, and it costs accounting.
                // `healTarget = explicitHealTarget ?? attacker` in every mode, so the DPS FOCUS
                // matches `isHealTarget` and its turn-start DoT tick takes the heal-target branch
                // instead of the per-victim one. HP and intake are IDENTICAL (both branches end in
                // `applyVictimDamage(…, sink)`), but the heal-target branch deliberately omits
                // `creditDealt` and `roundPerTargetDamage` — the pre-existing healing-mode gap
                // documented and DECLINED in place at the `tankDotDamage > 0` block below. So in
                // DPS mode an enemy DoT ticking on the focus is absent from
                // `RoundData.perTargetDamage[attacker]` and `perTargetDealt[<enemy>]`. Opt-in (it
                // needs enemy attack > 0 AND a DoT-applying enemy kit) and accounting-only — NOT
                // widened here, for the same reason it was declined below: closing it would move
                // `perTargetDealt` in every healing-mode fixture carrying an enemy DoT on the tank.
                const isHealTarget = !!healTarget && actor.id === healTarget.id;
                if (isHealTarget) {
                    // Snapshot BEFORE tickDoTs so expiring entries still appear in the
                    // display panel (mergeDoTsForDisplay + buildEnemyRoundEffects read it).
                    tankDotSnapshot = {
                        corrosion: healTarget.corrosionEntries.map((e) => ({
                            sourceId: e.sourceId,
                            tier: e.tier,
                            stacks: e.stacks,
                        })),
                        inferno: healTarget.infernoEntries.map((e) => ({
                            sourceId: e.sourceId,
                            tier: e.tier,
                            stacks: e.stacks,
                        })),
                    };
                    let tankDotDamage = 0;
                    // #358 ADDENDUM 3 (C2/C4): the same batch as THROWN — no Vortex Veil
                    // DoT-reduction, and a re-booked `convertHitToSelfDot` slice at its
                    // pre-defence size. Feeds the funnel's raw ("damage absorbed") axis only.
                    let tankDotDamagePreMit = 0;
                    tickDoTs({
                        corrosionEntries: healTarget.corrosionEntries,
                        infernoEntries: healTarget.infernoEntries,
                        genericDoTEntries: healTarget.genericDoTEntries,
                        // Corrosion scales with the afflicted ship's HP — the tank's own max HP.
                        enemyHp: recipientMaxHp(healTarget.id),
                        ctxFor: (sourceId) => lastTurnCtxByActor.get(sourceId),
                        emitTicked: (dotType, damage, stacks, tier) =>
                            bus.emit({
                                type: 'dot-ticked',
                                targetId: healTarget.id,
                                round: r,
                                dotType,
                                damage,
                                stacks,
                                tier,
                            }),
                        // Sum the ticked damage across all appliers; route it as INCOMING to the tank
                        // (NOT into a player damage row). expireStacks inside tickDoTs ages the entries.
                        credit: (sourceId, dotType, damage, preMitigation) => {
                            tankDotDamage += damage;
                            tankDotDamagePreMit += preMitigation;
                            // Site 3 of the leech-channel class (spec §3): the applier is no
                            // longer discarded, so its standing damage-dealt leech pays out on
                            // a tick against the heal target — the same proc the sibling
                            // per-victim branch below uses (instance 1, SP-4b-2b Task 2b).
                            // `dotType` IS a LeechChannel subset, so it passes straight through.
                            //
                            // The aggregate `tankDotDamage` above is still what
                            // `applyIncomingToTarget` books; this proc writes HEAL buckets and
                            // pools only and never touches a damage number, so no DoT figure
                            // moves. Cadence: `tickDoTs` calls `credit` once per ENTRY, so the
                            // owner's heal-crit gate draws once per entry — matching instance 1.
                            procStandingLeechesPerVictim(sourceId, damage, dotType);
                        },
                        // D-PR3 (Vortex Veil): reduce the carrier's incoming DoT ticks when
                        // the tank equips Vortex Veil. The condition 'dot-inferno-corrosion'
                        // gates on dotType being set, so querying with either dotType returns
                        // the same %. Absent → 0 → byte-identical for all existing tests.
                        incomingDotReductionPct: (dotType) =>
                            incomingReductionForHit(incomingAbilitiesOf(healTarget.id), {
                                didCrit: false,
                                attackerStealthed: false,
                                victimStealthed: isStealthed(healTarget.id),
                                victimStasised: isStasised(healTarget.id),
                                hitIndexThisRound: 0,
                                dotType,
                                // A DoT tick has no single attacker (aggregate of appliers) —
                                // 'attacker-has-dot' abilities are scope:'direct' only, so this
                                // never matters (scope-filtered before conditionMet reads it).
                                attackerHasDot: false,
                                victimHasBarrierRecharging: hasBarrierRecharging(healTarget.id),
                                victimHasShield: hasShield(healTarget.id),
                                selfHpPct: selfHpPctOf(healTarget.id),
                                // Same no-single-attacker reasoning as attackerHasDot above —
                                // 'attacker-taunted-or-provoke' abilities are 'transform-
                                // incoming-to-dot' (direct-only, gated inside applyVictimDamage
                                // itself), so this reduction-path ctx never reads it.
                                attackerTauntedOrProvoked: false,
                            }),
                        // PR I4b: the tank is the ticking victim.
                        dotMultFor: (ctx) => victimDotMult(ctx, healTarget),
                    });
                    // Site 3 of the leech-channel class, FIXED (spec §3): this branch's
                    // `credit` callback above now threads the applier through to
                    // `procStandingLeechesPerVictim`, so a standing damage-dealt leech pays out
                    // on a tick against the heal target. It previously discarded `_sourceId`
                    // and summed only into `tankDotDamage`, leaving no source to pay. The
                    // incoming direction is correctly absent — a DoT tick does not proc the
                    // victim's damage-taken leech (owner ruling, spec §2.2).
                    if (tankDotDamage > 0) {
                        // ⚠️ OPEN GAP, distinct from the leech class and deliberately NOT fixed
                        // here: this branch books NO per-victim damage-dealt attribution. The
                        // sibling non-heal-target branch credits one `creditDealt(sourceId,
                        // actor.id, dealt)` per distinct applier off its `tickDealtBySource`
                        // map; this branch keeps only the aggregate `tankDotDamage` and so
                        // writes `perTargetDealt` for nobody. Consequence for tests: `dealtBy`
                        // reads NOTHING for a DoT ticking the heal target, however real the
                        // tick is — use the healing display's `incomingDamage` instead (see
                        // `positionalDotLeech.test.ts`'s "Site 3" block, which does).
                        // Not fixed because wiring `creditDealt` in here would move
                        // `perTargetDealt` in every healing-mode fixture carrying an enemy DoT
                        // on the tank — far wider than the leech-channel class.
                        // C2b-2 T5: a DoT-tick batch is an AGGREGATE of multiple appliers with no
                        // single killer → byDirectDamage:false, killerId undefined (overrides the
                        // wrapper's direct-damage default). A defaulted true would wrongly tag a
                        // DoT kill as a direct hit (Faust, Task 6, distinguishes them).
                        applyIncomingToTarget(tankDotDamage, healTarget, {
                            byDirectDamage: false,
                            // #358 ADDENDUM 3: without this the funnel defaults the raw axis to
                            // `tankDotDamage` (the post-reduction figure) and a deferred
                            // transform slice migrates permanently off the raw axis — see
                            // `ActiveDoTStack.perTickPreMitigation`.
                            preMitigationDamage: tankDotDamagePreMit,
                        });
                    }
                    // Dead-is-dead: if the turn-start DoT tick was LETHAL the tank just died
                    // (recordDestroyed fired inside applyIncomingToTarget). It must NOT fall through
                    // and take a full turn — re-run the SAME dead-target skip as the top-of-turn
                    // guard. (With Cheat Death the intercept floored HP at 1 → not dead → false → it
                    // acts normally.)
                    if (handleDeadTargetSkip(actor)) {
                        continue;
                    }
                } else {
                    // Per-victim DoT tick (both sides). The actor ticks its OWN containers
                    // against its OWN HP only when it is POSITIONAL against its opposing roster
                    // (DPS/healing-only mode has no positioned opposing actors → no-op →
                    // byte-identical for non-positional fixtures).
                    const sideIsPlayer = actor.side === 'player';
                    const opposing = sideIsPlayer ? enemyAttackerActors : allPlayerActors;
                    const hasDots =
                        actor.corrosionEntries.length > 0 ||
                        actor.infernoEntries.length > 0 ||
                        actor.genericDoTEntries.length > 0;
                    if (hasDots && isPositional(actor.position, opposing)) {
                        let total = 0;
                        // SP-F F1 RESHAPE: per-`sourceId` dealt detail for THIS tick batch —
                        // multiple distinct DoT appliers can tick on the same victim in the
                        // same round, so a single collapsed attacker id (like every other
                        // site) would misattribute. Populated on BOTH sides (team-symmetric:
                        // an enemy's DoT ticking on a player ally must attribute too), unlike
                        // the `!sideIsPlayer`-gated `perActorDot` DPS map below, which stays
                        // exactly as it was.
                        const tickDealtBySource = new Map<string, number>();
                        // #358 ADDENDUM 3 (C2/C4): the raw twin of `total`. See the heal-target
                        // branch above — same reason, same axis.
                        let totalPreMit = 0;
                        tickDoTs({
                            corrosionEntries: actor.corrosionEntries,
                            infernoEntries: actor.infernoEntries,
                            genericDoTEntries: actor.genericDoTEntries,
                            // Corrosion scales with the AFFLICTED ship's own max HP.
                            enemyHp: recipientMaxHp(actor.id),
                            ctxFor: (sourceId) => lastTurnCtxByActor.get(sourceId),
                            emitTicked: (dotType, damage, stacks, tier) =>
                                bus.emit({
                                    type: 'dot-ticked',
                                    targetId: actor.id,
                                    round: r,
                                    dotType,
                                    damage,
                                    stacks,
                                    tier,
                                }),
                            credit: (sourceId, dotType, damage, preMitigation) => {
                                total += damage;
                                totalPreMit += preMitigation;
                                tickDealtBySource.set(
                                    sourceId,
                                    (tickDealtBySource.get(sourceId) ?? 0) + damage
                                );
                                // Only PLAYER-applied DoTs ticking on an ENEMY victim are the
                                // focus player's outgoing DPS → surface via perActorDot (keyed
                                // by the DoT APPLIER; the C1 fold reads perActorDot[focus]).
                                // Enemy-applied DoTs on a player victim are NOT the focus's DPS.
                                if (!sideIsPlayer) {
                                    const e = perActorDot.get(sourceId) ?? {
                                        corrosion: 0,
                                        inferno: 0,
                                        generic: 0,
                                    };
                                    e[dotType] += damage;
                                    perActorDot.set(sourceId, e);
                                }
                                // SP-4b-2b Task 2b: this DoT-tick branch now procs the
                                // APPLIER's standing damage-dealt leech too, via the same
                                // per-victim proc the firing hit uses. For the two-proc
                                // landscape, the scope handling and why this makes both sides
                                // team-symmetric by construction, see the canonical block
                                // comment above `procStandingLeechesPerVictim`'s definition
                                // (engine.ts:3868, `// E2 Task 3: PER-VICTIM standing-leech
                                // proc for the POSITIONAL apply path.`, running to the
                                // definition at engine.ts:3931, `const procStandingLeechesPerVictim = (`) — not repeated here.
                                //
                                // SPECIFIC TO THIS CALL SITE: `creditDamage` was not an option
                                // here, because it would also write `dmg(sourceId)[dotType]`,
                                // double-feeding the scalar DoT channel this branch already
                                // feeds via the `total`/`tickDealtBySource` writes above (see
                                // the cumulativeDamage note in the C2 header) — the per-victim
                                // proc touches HEAL buckets/pools only, so no damage number
                                // moves. Cadence: `tickDoTs` calls `credit` once per ENTRY, so
                                // the owner's heal-crit gate draws once per entry here too.
                                procStandingLeechesPerVictim(sourceId, damage, dotType);
                            },
                            // D-PR3 (Vortex Veil): reduce this carrier's incoming DoT ticks.
                            incomingDotReductionPct: (dotType) =>
                                incomingReductionForHit(incomingAbilitiesOf(actor.id), {
                                    didCrit: false,
                                    attackerStealthed: false,
                                    victimStealthed: isStealthed(actor.id),
                                    victimStasised: isStasised(actor.id),
                                    hitIndexThisRound: 0,
                                    dotType,
                                    // See the sibling tank-path call above: no single attacker
                                    // on a DoT tick; harmless (scope:'direct'-only condition).
                                    attackerHasDot: false,
                                    victimHasBarrierRecharging: hasBarrierRecharging(actor.id),
                                    victimHasShield: hasShield(actor.id),
                                    selfHpPct: selfHpPctOf(actor.id),
                                    attackerTauntedOrProvoked: false,
                                }),
                            // PR I4b: this actor IS the ticking victim.
                            dotMultFor: (ctx) => victimDotMult(ctx, actor),
                        });
                        if (total > 0) {
                            // DoT batch: bypass shield (byDirectDamage:false), aggregate of
                            // appliers with no single killer. Mirrors the heal-target route
                            // (applyIncomingToTarget == applyVictimDamage + sink + pen 0).
                            applyVictimDamage(total, actor, sink, {
                                byDirectDamage: false,
                                // #358 ADDENDUM 3 — see the heal-target branch's twin.
                                preMitigationDamage: totalPreMit,
                            });
                            roundPerTargetDamage.set(
                                actor.id,
                                (roundPerTargetDamage.get(actor.id) ?? 0) + total
                            );
                            // SP-F F1 RESHAPE: one roundPerTargetDealt entry PER distinct
                            // applier — do not collapse to a single guessed attacker (see
                            // tickDealtBySource above). Σ over sourceIds here == `total`, so
                            // this write reconciles with the unchanged victim-keyed write above.
                            for (const [sourceId, dealt] of tickDealtBySource) {
                                creditDealt(sourceId, actor.id, dealt);
                            }
                        }
                        // Lethal turn-start tick → skip the rest of the turn. INTENTIONALLY
                        // follows the heal-target lethal convention (skip the shared post-turn
                        // block: decrements / turn-ended), NOT the timed-burst convention.
                        if (actor.destroyedRound !== undefined) {
                            if (actor.id === focusActorId) pushSynthesizedFocusSkipTurn();
                            continue;
                        }
                    }
                }

                if (actor.kind === 'attacker') {
                    // ====================================================================
                    // ATTACKER TURN — the full damage/buff/DoT-application pipeline lives
                    // in runPlayerTurn (playerTurn.ts), minus the DoT-processing calls
                    // (tickDoTs / processBombs / processAccumulators) which run on the enemy
                    // turn. It returns everything the round's RoundData row needs from this
                    // turn; the numeric damage fields fold into the round accumulator below.
                    // The attacker's per-actor config/gates/stats are bundled in
                    // attackerRuntime (built once at setup); Task 4 adds team runtimes.
                    // ====================================================================
                    // §4.3 STASIS GATE (B2 Task 3): a stasised actor SKIPS its action body
                    // (active/charged skill + attack + status applications). The DoT-tick
                    // prologue (healTarget branch above) and the Post-Turn decrements (below)
                    // STILL run — the guard wraps ONLY this action body. Duration N therefore
                    // skips exactly N scheduled actions (each skipped turn decrements Stasis).
                    // A stasised FOCUS actor must push a synthesized focus turn so the
                    // post-round `focusTurns.length` guard does not throw.
                    if (!isTurnBlocked(actor.id)) {
                        // D-PR14: first REAL activation of the round (Stasis/Disable-skipped
                        // actors never enter these blocks). ??= writes once.
                        firstActivatorId ??= actor.id;

                        // PR-B: PER-POSITIONED-PLAYER TIMED BURST (enemy-seeded bombs/accumulators
                        // on the focus attacker burst against its OWN HP at its turn-start, via
                        // sink). Mirror of the PR2 enemy site; strict no-op for every existing
                        // fixture (none seed player-actor timed containers). Canonical turn-start
                        // order is tickDoTs → processBombs → processAccumulators; PR-C will add
                        // tickDoTs AHEAD of this burst.
                        applyPositionedTimedBurst(actor, sink, enemyAttackerActors);

                        // Dead-after-burst guard (PR2 lesson): a lethal self-burst stamps
                        // destroyedRound inside applyVictimDamage AFTER the top-of-turn dead-skip
                        // already ran. Key off destroyedRound (NOT currentHp > 0 — bare actors carry
                        // currentHp 0). healTarget carve-out mirrors the top-of-turn guard. A focus
                        // actor killed by its own burst must still push a synthesized focus turn so
                        // the post-round focusTurns.length guard does not throw.
                        // #415: the `focusActorId` clause is the MID-TURN twin of the unconditional
                        // branch added to handleDeadTargetSkip (`:9533`) — the top-of-turn guard
                        // cannot catch this death, which is the whole reason this second check
                        // exists. Anchoring healTarget to the focus in every mode turned the
                        // healTarget carve-out ON in DPS mode, so a focus killed by its own
                        // turn-start timed burst fell through and cast anyway. A DESTROYED FOCUS
                        // MUST NEVER ACT, in any mode; the carve-out survives only for a heal
                        // target that is NOT the focus (an explicitly-healed walked ally), which is
                        // where it was aimed to begin with.
                        const burstDestroyedActor =
                            actor.destroyedRound !== undefined &&
                            (actor.id === focusActorId ||
                                !(healTarget && actor.id === healTarget.id));
                        if (!burstDestroyedActor) {
                            // SP-F F5: on a charge-firing turn, resolve BOTH the footprint pattern
                            // and the target selection from the CHARGED axes (each falls back to
                            // the active axis when unset) — mirrors runPlayerTurn's own action
                            // predicate exactly (playerTurn.ts:~1044), evaluated here BEFORE
                            // runPlayerTurn consumes the charge (advanceChargeCadence runs inside
                            // it, after the decision, so actor.charges is still the pre-decision
                            // value at this point).
                            const willFireCharged = willFireChargedFor(actor);
                            const target = willFireCharged
                                ? parsedChargedTargetFor(actor)
                                : parsedTargetFor(actor);
                            const pattern = willFireCharged
                                ? parsedChargedPatternFor(actor)
                                : parsedPatternFor(actor);
                            // Positional target selection (Task C1, GATED). When the focus attacker
                            // (`actor`) carries a board position AND the positioned enemy roster
                            // (`enemyAttackerActors`) has positioned actors, resolve the focus's parsed
                            // target (`input.target`) to a single living enemy and bind THIS turn to it.
                            // At Task C1, when the selection was null — not positional, OR positional but
                            // no living positioned enemy target — the turn diverged NOTHING from the
                            // legacy dummy `enemy` binding (byte-identical; the null-target sub-case was a
                            // no-op fallthrough to legacy), and no existing test passed positions, so this
                            // branch never fired for them. Since SP-4b-1's normalization boundary every
                            // actor of every caller is placed and targeted, so it is now the ORDINARY
                            // path; the legacy fallthrough itself is GONE on this side (SP-4c-2b/2d).
                            // Positional target (phase 2): the selected enemy actor, else — when this
                            // was written — the dummy sink. Both were full CombatActors, so all
                            // per-target bindings derive from `tgt` uniformly; on the legacy
                            // (non-positional) path `tgt` WAS the dummy, whose stats and DoT/bomb
                            // containers were the legacy module vars, which is what made deriving every
                            // binding from `tgt` byte-identical.
                            // HP decline is no longer passed in (PR6b): runPlayerTurn derives it from the
                            // struck victim's currentHp (max − currentHp), so both cases read `tgt`
                            // uniformly — no separate decline ternary here.
                            // SP-4c-2b/2d AMEND the two paragraphs above: the legacy fallthrough is GONE
                            // on this (player) side — `selectTurnTarget` answers "no victim" instead, so
                            // `tgt` is either a real positioned actor or absent. See the note under the
                            // call.
                            const { tgt } = selectTurnTarget(actor);
                            // SP-4c-2b: `tgt` is undefined when this cast targets an ALLY — there is
                            // no opposing victim to resolve. The turn still RUNS (a repair/buff must
                            // land); only the victim-derived context is absent. Skipping here would
                            // permanently silence all 24 shipped ally-target support ships.
                            // §4.5: inject break hook into runPlayerTurn. The hook marks stasisHitVictims
                            // only when the victim was stasised at hit time. The actual statusEngine
                            // removal happens AFTER drainIntentsFor('player')/drainIntentsFor('enemy') (below).
                            // §4.5 Akula exception: if the ACTING ATTACKER has doesntBreakStasis, the
                            // victim is never recorded → no break-mark, no stasisBreakPending entry.
                            // SP-4c-2b: no victim ⇒ no hit ⇒ nothing to break out of Stasis, so the
                            // hook is never injected (the honest no-victim answer is `false`, not
                            // "the dummy was not stasised").
                            const tgtWasStasised =
                                !actor.doesntBreakStasis && tgt !== undefined && isStasised(tgt.id);
                            // §4.5: `stasisHitVictims` collects ids of victims stasised at hit time.
                            // Resolved AFTER runPlayerTurn returns (when inflictedEnemyDebuffs is available)
                            // to compute the re-apply check, then stored in `stasisBreakPending` for the
                            // victim's skip branch to consume.
                            const turnStasisHitVictims = new Set<string>();
                            // Task 5: predict whether the engine will resolve this cast POSITIONALLY.
                            // The full `positional` gate below adds `turn.positionalScalars != null`
                            // (⟺ a damage ability fired). runPlayerTurn suppresses its inline
                            // ability-performed emit ONLY when this flag AND hasDamageAbility both
                            // hold — so the suppression condition matches the `positional` gate for
                            // every turn that HAS a victim. A non-damage cast keeps its inline emit
                            // (flag ignored).
                            // SP-4c-2b: this flag is deliberately NOT victim-fenced, even though the
                            // `positional` gate below now is. (1) Fencing it would buy nothing for the
                            // event: with no victim runPlayerTurn emits no `ability-performed` on EITHER
                            // arm — the inline emit and the deferred payload are both fenced on its own
                            // `hasVictim` (playerTurn.ts `if (!deferAbilityPerformed && hasVictim)` and
                            // the `deferredAbilityPerformed` spread) — so the divergence cannot lose an
                            // event. (2) Fencing it would COST: the same flag selects the cast's
                            // landing/crit resolution shape (`positionalLanding` in playerTurn.ts, which
                            // chooses between `realAffinityCappedCrit` and `cappedCrit`), so flipping it
                            // on a no-victim turn would move that turn's RNG draws and with them the
                            // schedule of every later application.
                            //
                            // THE DIVERGENCE HAS A SECOND CONSUMER, and it is not an event — say so here
                            // because (1) alone reads as if `ability-performed` were the only thing
                            // riding this gate. `deferredCastSupport` (playerTurn.ts, set by
                            // `if (deferAbilityPerformed && hasCastDamageDealtRider)`) is pinned to the
                            // SAME unfenced condition, while its resolver's basis `castDelivered` follows
                            // the FENCED `positional` gate below. So a mixed cast (§A.7) reaches
                            // `resolveCastSupport?.(castDelivered ?? turn.directDamage)` on the FALLBACK
                            // arm — a branch the comment at that call used to describe as unreachable.
                            // It is reachable now, its answer is correct (basis 0 for a cast that hit
                            // nobody), and the corrected reasoning lives at that call site.
                            const willApplyPositionally =
                                resolvesPositionalVictim(actor.position, enemyAttackerActors) &&
                                target != null &&
                                pattern != null;
                            // Sub-project I, PR I2: snapshot the opposing roster's enemy-status
                            // BEFORE this turn runs (see the causality note above
                            // perVictimOutgoingDeltaPct) — this turn's own debuff-inflict must
                            // not retroactively satisfy its own per-victim outgoing gate.
                            const preTurnVictimStatus =
                                snapshotPreTurnVictimStatus(enemyAttackerActors);
                            const focusTurnArgs = buildTurnArgs(actor, tgt);
                            const turn = runPlayerTurn({
                                ...focusTurnArgs,
                                deferAbilityPerformedToEngine: willApplyPositionally,
                                onHitBreakStasis: tgtWasStasised
                                    ? (targetId: string) => {
                                          turnStasisHitVictims.add(targetId);
                                      }
                                    : undefined,
                            });
                            // #367 fix wave: publish this turn's ctx to the acting-turn override the
                            // moment it exists. `lastTurnCtxByActor.set(actor.id, turn.turnCtx)` sits
                            // ~240 lines below, AFTER the positional apply that procs this actor's
                            // standing leech — so without this the leech's self-side incoming-repair
                            // half would read the actor's previous turn. Same object either way, so
                            // the two agree from the publish onwards.
                            actingTurnCtx = { actorId: actor.id, ctx: turn.turnCtx };
                            if (turnStasisHitVictims.size > 0) {
                                // KNOWN LIMITATION, deliberate for PR8 (multi-hit full-walk epic):
                                // this reads `inflictedEnemyDebuffs` as it stands the moment
                                // runPlayerTurn returns, which is BEFORE the positional drive runs
                                // the per-sub-attack landings. `inflictedEnemyDebuffs` is not
                                // `collect`-guarded, so a sub-attack ≥ 1's landing does push a row —
                                // but it pushes it too late to be seen here. Consequence: a Stasis
                                // that RESISTED on sub-attack 0 and LANDED on sub-attack 1 reads as
                                // "not re-inflicted", so the break fires anyway and shaves a turn off
                                // the freshly applied Stasis. The walked-team and enemy sites are
                                // asymmetric the same way (the enemy spreads the list into its entry
                                // before its own drive call too).
                                // Corpus-inert today: Enforcer is the only ship with hits > 1 and she
                                // carries no direct debuff-inflict clause, so nothing can reach this
                                // shape. Left as-is on purpose — restructuring the check would move
                                // the N=1 break decision, which PR8 must keep byte-identical.
                                const reInflictedStasis = turn.inflictedEnemyDebuffs.some((ab) =>
                                    isStasis(ab.buffName)
                                );
                                if (!reInflictedStasis) {
                                    for (const victimId of turnStasisHitVictims) {
                                        stasisBreakPending.set(victimId, true);
                                    }
                                }
                                // else: same-turn re-apply wins → break discarded, no pending mark.
                            }

                            // Drain any team-turn resisted entries staged BEFORE this attacker turn
                            // (faster team actors) into the HEAD of this turn's resisted list — same
                            // observable order as the old teamResistedEnemyDebuffs fold-in.
                            if (pendingResisted.length > 0) {
                                turn.resistedEnemyDebuffs.unshift(...pendingResisted);
                                pendingResisted.length = 0;
                            }

                            // AMENDED BY SP-4c-2b at the end of this comment: the gate below now DOES
                            // carry a victim precondition, so read that amendment before trusting the
                            // "DELIBERATELY no `selectedEnemy != null` precondition" paragraph.
                            // Positional APPLY (Task 8b, GATED). When the focus attacker is positional,
                            // carries a parsed target, AND its firing hit produced scalars (a damage
                            // ability fired → turn.positionalScalars is set), drive the per-victim apply
                            // loop against the LIVE enemy roster. Re-resolves anchor + footprint per hit;
                            // origin cells take full damage, covered cells half. Each victim's HP/shield/
                            // Barrier/Cheat-Death/death is mutated through the real applyOutgoingToEnemy.
                            // At Task 8b no production caller threaded position+target+pattern, so this
                            // was false for every existing test/golden → byte-identical. STALE since
                            // SP-4b-1: `normalizeCombatRoster` fills a position, a target and a pattern
                            // for every actor, so this is now the NORMAL path for both calculators.
                            // The pattern is REQUIRED for footprint expansion — without it there is no
                            // apply to perform (the then-existing positionalSelection tests set
                            // position+target to exercise target binding only, never a pattern, so they
                            // kept the legacy single-sink credit and never entered this branch; the
                            // boundary fills the ACTIVE pattern on `runCombat`'s first line, and the
                            // charged axes fall back to it (`chargedPattern ?? pattern`), so no input
                            // reaching HERE is pattern-less any more).
                            //
                            // DELIBERATELY no `selectedEnemy != null` precondition (CodeRabbit raised this).
                            // The rationale as written: in positional/simulator mode there was NO dummy
                            // enemy sink to fall back to (since SP-4c-2d there is none anywhere, so the
                            // counterfactual below can no longer be constructed — the CONCLUSION still
                            // holds, which is why the precondition is still absent).
                            // When per-hit resolution inside applyPositionalDamage finds no living opposing
                            // actor, the correct behaviour is for the attacker to WHIFF (deal 0) — see the
                            // death-fallback all-dead-whiff test. Gating `positional` on a pre-resolved
                            // living target would instead route the firing hit back to the legacy dummy
                            // sink, recording PHANTOM damage against a target that no longer exists. So we
                            // enter the positional branch on pattern/target/scalars alone and let the
                            // per-hit live re-resolution own the whiff. (Credit suppression below pairs with
                            // this: the per-victim apply is the ONLY damage path here.)
                            //
                            // SP-4c-2b: `tgt !== undefined` IS now a precondition, and it does not
                            // reopen the phantom-damage hole the paragraph above guards. The two cases
                            // are different. That hazard is an anchor that RESOLVED and then died,
                            // where routing back to a live sink would book damage against a corpse.
                            // `tgt === undefined` means this cast has no opposing victim AT ALL — an
                            // ally-targeted repair/buff/shield (plan §A.1: 100% of the player-side
                            // fallback rows) — so there is no anchor for the driver to walk from:
                            // `sel.tgt` is its per-victim `primaryId` and its covered-Stasis
                            // exclusion, and `stagePassiveSlotHit` reads the anchor's position for its
                            // footprint. Nor can the `!positional` arm below book a phantom lump in the
                            // apply's place: runPlayerTurn fences its own damage assembly on
                            // `hasVictim`, so `turn.directDamage` is literally 0 and that arm credits
                            // 0. A mixed cast's enemy-facing clause therefore goes INERT on an
                            // ally-targeted turn — the ruled consequence of the no-victim option
                            // (plan §A.7), fixture-only today (13 rows, zero shipped ships).
                            // The fence lives in the GATE, i.e. above every RNG draw the driver and
                            // the staged passive-slot instance would otherwise take.
                            const positional =
                                tgt !== undefined &&
                                resolvesPositionalVictim(actor.position, enemyAttackerActors) &&
                                target != null &&
                                pattern != null &&
                                turn.positionalScalars != null;
                            // R-cast: the delivered total this turn's support pass needs when it deferred
                            // (a firing-slot `damage-dealt` rider). Stays undefined when no positional
                            // apply ran, in which case the fallback below reproduces the inline basis.
                            let castDelivered: number | undefined;
                            if (positional) {
                                // Opposing roster + victim wrapper come from the per-side bindings
                                // (player→enemy here). pattern/target are non-null via the `positional` gate.
                                // SP-U U2: the per-victim apply/emit/detonation body is the shared
                                // drivePositionalTurnApply helper; the focus site injects the player→enemy
                                // STANDING leech (E2 Task 3 — the acting attacker's standing leeches proc
                                // off EACH footprint victim's role-scaled dealt damage) and emits the
                                // per-victim `attacked` inline (before detonation). The turn's deferred
                                // ability-performed carries the anchor firing-hit values for the log.
                                const tb = turnBindings(actor.side);
                                // SP-4b-2 D6: stage the passive-slot damage instance — its footprint
                                // is resolved HERE (against the turn-entry board) and applied after
                                // the firing hit, so neither instance's kill can swallow the other.
                                // See stagePassiveSlotHit for the invariant and the measurements.
                                const landPassiveSlotHit = turn.passiveSlotHit
                                    ? stagePassiveSlotHit(actor, tb, tgt, turn.passiveSlotHit, {
                                          scheduledEnemyEffects: turn.scheduledEnemyEffects,
                                          perVictimOutgoing: turn.perVictimOutgoing,
                                          preTurnVictimStatus,
                                      })
                                    : undefined;
                                const posApply = drivePositionalTurnApply(
                                    actor,
                                    tb,
                                    {
                                        tgt,
                                        pattern,
                                        target,
                                        preTurnVictimStatus,
                                        scalars: turn.positionalScalars!,
                                        hitCrits: turn.hitCrits,
                                        perVictimOutgoing: turn.perVictimOutgoing,
                                        rollVictimCrit: turn.rollVictimCrit,
                                        deferredAbilityPerformed: turn.deferredAbilityPerformed,
                                        positionalDetonation: turn.positionalDetonation,
                                        applyDebuffsForSubAttack: turn.applyDebuffsForSubAttack,
                                        deferredEnemyApplications: turn.deferredEnemyApplications,
                                        scheduledEnemyEffects: turn.scheduledEnemyEffects,
                                    },
                                    (victim, damage, outcome) =>
                                        procLeechesForVictim(actor.id, victim, damage, outcome),
                                    // PR2 Task 3: ONE sub-attack's victims per call, emitted right
                                    // after that sub-attack's own `ability-performed`. PR4 stamps
                                    // the index onto each event.
                                    (victims, subAttackIndex) => {
                                        if (victims.size > 0) {
                                            emitPerVictimAttacked({
                                                bus,
                                                round: r,
                                                attackerId: actor.id,
                                                primaryId: tgt.id,
                                                victims,
                                                subAttackIndex,
                                            });
                                        }
                                    }
                                );
                                castDelivered = posApply.critAgg.subAttacks.reduce(
                                    (sum, sub) => sum + (sub.deliveredDamage ?? 0),
                                    0
                                );
                                // SP-4b-2 D6: the staged passive-slot instance lands now.
                                landPassiveSlotHit?.();
                            }
                            // Clause order: this turn's damage has landed (or the cast had none) —
                            // now apply the debuff clauses that followed it.
                            flushDeferredEnemyApplications(turn.deferredEnemyApplications);
                            // Same seam, same reason: a cast whose repair/shield scales off the damage
                            // it dealt could not resolve until that damage existed. No-op unless this
                            // cast deferred. The `?? turn.directDamage` fallback was written as
                            // unreachable-while-deferral-is-pinned-to-the-positional-gate, and is there so
                            // a future divergence degrades to the old basis instead of silently dropping
                            // the repair.
                            //
                            // SP-4c-2b: that divergence has ARRIVED — the fallback is now REACHABLE, and
                            // it is the second consumer of the gate split documented at
                            // `willApplyPositionally` above. The two sides of the pin no longer move
                            // together on a no-victim turn: DEFERRAL follows `deferAbilityPerformed`
                            // (= the unfenced `willApplyPositionally` AND hasDamageAbility, playerTurn.ts),
                            // which carries NO `hasVictim` term, while `castDelivered` follows the
                            // victim-FENCED `positional` gate and therefore stays undefined. So an
                            // ally-targeted cast that also carries a damage ability and a firing-slot
                            // `damage-dealt` repair/shield rider (plan §A.7's mixed casts — fixture-only,
                            // 13 rows, zero shipped ships) defers its support pass and then lands HERE on
                            // the fallback arm.
                            // The fallback's answer is the CORRECT one, which is why the behaviour is
                            // deliberately left alone: `turn.directDamage` is fenced to literal 0 with no
                            // victim, so the support pass still RUNS (the repair is not dropped) and
                            // resolves off a basis of 0 — a damage-dealt-scaled repair on a cast that hit
                            // nobody correctly repairs nothing. Do not "restore the pin" by fencing
                            // `willApplyPositionally`: that would move the turn's crit draws (see its note).
                            turn.resolveCastSupport?.(castDelivered ?? turn.directDamage);

                            // Fold the focus turn's numeric damage into the round accumulator.
                            // += (not =) on detonation: with a FASTER enemy, the enemy's bomb/
                            // accumulator bursts ran earlier this round — a plain assignment would
                            // clobber them. direct/secondary/conditional are single-focus-turn
                            // today; += keeps the 0..N-turn seam additive.
                            const d = dmg(actor.id);
                            // secondary/conditional are DISPLAY sub-buckets — a view of damage the
                            // firing hit already counted. They feed `rawTotals` only (one read, at
                            // the row assembly below) and never `cumulativeDamage`, the HP decline
                            // or the standing-leech hook, so they are accumulated on BOTH paths.
                            // The `creditDamage` calls stay inside the guard: those DO feed
                            // cumulative accounting, and the positional path lands that damage
                            // per-victim instead.
                            d.secondary += turn.secondaryDamage;
                            d.conditional += turn.conditionalDamage;
                            // Credit SUPPRESSION for the positional case (Task 8b): the firing-hit damage
                            // now lands per-victim via applyPositionalDamage above, so it must NOT also be
                            // folded into cumulativeDamage here (that would double-count it). Skip the
                            // direct credit; KEEP detonation (bombs are a separate mechanic, out of scope).
                            // The single-sink decline that used to be zeroed for the positional path is now
                            // derived from the victim's own currentHp inside runPlayerTurn (PR6b), so no
                            // separate decline suppression is needed here.
                            if (!positional) {
                                creditDamage(actor.id, 'direct', turn.directDamage);
                                // Detonation credit is suppressed in positional mode (turn.detonationDamage
                                // is 0 there anyway — runPlayerTurn returns the recipe instead). Keeping it
                                // inside this guard documents intent and keeps per-victim detonation out of
                                // cumulativeDamage (it lands per-victim via applyVictimDamage above).
                                creditDamage(actor.id, 'detonation', turn.detonationDamage);
                            } else {
                                // SP-4b-2 D1: the suppressed direct credit's positional TWIN. Same
                                // gate, opposite branch — which is the whole proof that the Echoing
                                // Burst gather cannot double-count: a cast reaches exactly one of
                                // these two lines. `castDelivered` (not `turn.directDamage`) is the
                                // basis: it is what the per-victim apply ACTUALLY delivered across
                                // the footprint, the same "damage dealt" basis `perTargetDealt`
                                // records. Defined whenever `positional`, so the `?? 0` is
                                // defensive only.
                                creditPositionalDirect(actor.id, castDelivered ?? 0);
                            }
                            focusTurns.push(turn);

                            // Heal-target buffs: if this focus actor IS the heal target (self-heal case),
                            // its comprehensive activeSelfBuffs are the target's own buffs for the round.
                            if (healTarget && actor.id === healTarget.id) {
                                healTargetBuffs = turn.activeSelfBuffs;
                            }

                            // Record this actor's round-scoped ctx for the enemy's DoT-tick attribution.
                            lastTurnCtxByActor.set(actor.id, turn.turnCtx);
                            // SP-D: record this cast's footprint size (aoeVictimIds — undefined in
                            // DPS/non-positional mode) for the enemies-hit-this-cast drain-time gate.
                            // SP-4d Task 8: `tgt` (not `aoeVictimIds`) is the "did a victim resolve"
                            // discriminator — mirrors playerTurn.ts's `hasVictim` (`enemy !==
                            // undefined`, and `enemy` here IS `tgt`, see buildTurnArgs's conditional
                            // spread). Was `?? 1`, which fabricated a footprint of 1 for a no-victim
                            // turn (an ally-targeted cast that hit NOBODY) — the residual
                            // `noVictimResidualTripwires.test.ts` used to tripwire because no corpus
                            // ship could observe it (neither `enemies-hit-this-cast` reader,
                            // Berserker/Tygr, is one of the 24 ally-target ships). Now books the
                            // honest 0 for that case and still books 1 for a real single-target hit.
                            enemiesHitThisCastByActor.set(
                                actor.id,
                                focusTurnArgs.aoeVictimIds?.length ?? (tgt !== undefined ? 1 : 0)
                            );

                            // Extra-action grants from this turn bump the attacker's pending-action
                            // count, so selectNextBySpeed re-picks it at its live speed-rank (full extra
                            // turn — charge cadence, post-turn decrement, and triggers all run again on
                            // the re-picked iteration).
                            // The extra turn intentionally re-fires statusEngine.sourceFired too:
                            // re-applying timed buffs, adding persistent stacks, and ticking
                            // accumulators are all correct for a real second turn.
                            processExtraActionGrants(actor, turn.extraActionGrants);
                        } else if (actor.id === focusActorId) {
                            // The focus killed itself with its own timed burst → synthesize a
                            // no-action focus turn so the post-round focusTurns.length guard does
                            // not throw (it did not act). A walked-team actor is never the focus.
                            pushSynthesizedFocusSkipTurn();
                        } // end dead-after-burst guard (!burstDestroyedActor)
                    } else {
                        // Stasised focus/attacker turn: skip the action body.
                        // §4.3 STASIS GATE (B2 Task 3).
                        // §4.5 Deferred break: consume any pending Stasis break so this actor
                        // acts on their NEXT scheduled turn. The break was pre-approved by a
                        // direct hit in an earlier turn this round (stored in stasisBreakPending
                        // after verifying the attacker did NOT re-inflict Stasis that same turn).
                        // Consuming here (in the skip body) ensures the CURRENT skip still runs —
                        // the victim misses this turn, then is free from the next round onward.
                        if (stasisBreakPending.has(actor.id)) {
                            stasisBreakPending.delete(actor.id);
                            for (const name of STASIS_BUFFS)
                                statusEngine.reduceTimedEnemyStatus(actor.id, name);
                        }
                        // Synthesize a minimal no-action result so the post-round
                        // `focusTurns.length` guard does not throw (the focus actor
                        // was stasised — it did not act, but the round must still assemble).
                        // Delegated to pushSynthesizedFocusSkipTurn (E5 §4.4 DRY helper).
                        if (actor.id === focusActorId) {
                            pushSynthesizedFocusSkipTurn();
                        }
                    } // end stasis gate (attacker branch)
                } else if (actor.kind === 'team' && teamRuntimeById.has(actor.id)) {
                    // ====================================================================
                    // WALKED TEAM TURN — a real speed-ordered ally that runs the FULL
                    // runPlayerTurn pipeline (its own gates/stats/skills). Its damage reduces
                    // enemy HP but is reported separately (teamDamage); runPlayerTurn also calls
                    // statusEngine.sourceFired(actor.id, …) internally, so this actor's manual
                    // extras (TeamActorInput.selfBuffs/enemyDebuffs) still apply on its turns —
                    // the legacy sourceFired block below is fully superseded for walked actors.
                    // ====================================================================
                    // §4.3 STASIS GATE (B2 Task 3): a stasised walked-team actor skips its action
                    // body. The DoT-tick prologue (healTarget branch above) and Post-Turn decrements
                    // (below) still run. A walked team actor is never the focus → no focusTurns
                    // synthesis needed (no-else). §4.3 deviation: skip action, decrement preserved.
                    if (!isTurnBlocked(actor.id)) {
                        // D-PR14: first REAL activation of the round (Stasis/Disable-skipped
                        // actors never enter these blocks). ??= writes once.
                        firstActivatorId ??= actor.id;

                        // PR-B: per-positioned-player timed burst (walked-team ally). Same as the
                        // focus site; no focusTurns synthesis (a walked-team actor is never the
                        // focus). tickDoTs added ahead by PR-C.
                        applyPositionedTimedBurst(actor, sink, enemyAttackerActors);
                        const burstDestroyedActor =
                            actor.destroyedRound !== undefined &&
                            !(healTarget && actor.id === healTarget.id);
                        if (!burstDestroyedActor) {
                            // Positional target selection (Task C2, GATED). Mirrors the focus-turn
                            // branch (C1) but keyed to THIS team actor's own board position
                            // (`actor.position`) and parsed target (`teamTargetById` lookup), not the
                            // focus attacker's. When positional selection resolves nobody — not
                            // positional, no parsed target, or no living positioned enemy —
                            // `selectTurnTarget` answers "no victim": since SP-4c-2b on this side,
                            // and since SP-4e on both. There is no stand-in victim left to fall
                            // back to anywhere in this file.
                            // SP-F F5: charge-aware (mirrors the focus site) — resolve BOTH the
                            // target and the footprint pattern from the CHARGED axes on a
                            // charge-firing turn (each falls back to the active axis when unset).
                            const teamWillFireCharged = willFireChargedFor(actor);
                            const teamTarget = teamWillFireCharged
                                ? parsedChargedTargetFor(actor)
                                : parsedTargetFor(actor);
                            // Same `tgt` consolidation as the focus turn: every per-target binding
                            // derives from `tgt` uniformly. This used to say the fallback path bound
                            // `tgt === enemy`, "whose stats/containers ARE the legacy module vars
                            // (enemyDefense/enemyHp/…)" — that path is gone twice over: SP-4c-2b made
                            // player-side selection return no victim, SP-4c-2d deleted the actor, and
                            // `enemyDefense` is no longer even a binding in this file. So `tgt` is
                            // EITHER a real positioned CombatActor OR undefined — never a stand-in.
                            const { tgt } = selectTurnTarget(actor);
                            // SP-4c-2b: `tgt` is undefined when this cast targets an ALLY — there is
                            // no opposing victim to resolve. The turn still RUNS (a repair/buff must
                            // land); only the victim-derived context is absent. Skipping here would
                            // permanently silence all 24 shipped ally-target support ships.
                            const teamPattern = teamWillFireCharged
                                ? parsedChargedPatternFor(actor)
                                : parsedPatternFor(actor);
                            // §4.5: inject break hook into runPlayerTurn (mirrors focus site).
                            // §4.5 Akula exception: if the ACTING ATTACKER has doesntBreakStasis,
                            // the victim is never recorded → no break-mark, no stasisBreakPending.
                            // SP-4c-2b: mirror of the focus site — no victim ⇒ no hit ⇒ no break.
                            const teamTgtWasStasised =
                                !actor.doesntBreakStasis && tgt !== undefined && isStasised(tgt.id);
                            const teamTurnStasisHitVictims = new Set<string>();
                            // Task 5 (per-victim crit signal): predict positional apply (mirror of the
                            // focus site) so runPlayerTurn defers its inline ability-performed emit.
                            // SP-4c-2b: NOT victim-fenced, for the two reasons spelled out at the focus
                            // site's own `willApplyPositionally` — no event is lost (runPlayerTurn's own
                            // `hasVictim` already suppresses both emit arms) and fencing it would move
                            // the no-victim turn's landing/crit RNG draws.
                            const teamWillApplyPositionally =
                                resolvesPositionalVictim(actor.position, enemyAttackerActors) &&
                                teamTarget != null &&
                                teamPattern != null;
                            // Sub-project I, PR I2: pre-turn snapshot (mirrors the focus site).
                            const teamPreTurnVictimStatus =
                                snapshotPreTurnVictimStatus(enemyAttackerActors);
                            const teamTurnArgs = buildTurnArgs(actor, tgt);
                            const teamTurn = runPlayerTurn({
                                ...teamTurnArgs,
                                deferAbilityPerformedToEngine: teamWillApplyPositionally,
                                onHitBreakStasis: teamTgtWasStasised
                                    ? (targetId: string) => {
                                          teamTurnStasisHitVictims.add(targetId);
                                      }
                                    : undefined,
                            });
                            // Mirror of the focus site's publish (see it for the ordering argument):
                            // this branch's `lastTurnCtxByActor.set` also sits below its positional
                            // apply.
                            actingTurnCtx = { actorId: actor.id, ctx: teamTurn.turnCtx };
                            if (teamTurnStasisHitVictims.size > 0) {
                                // KNOWN LIMITATION — see the focus site's note above its own
                                // `reInflictedStasis` read (search `turnStasisHitVictims.size > 0`)
                                // for the full explanation; this read has the same
                                // pre-positional-drive ordering.
                                const reInflictedStasis = teamTurn.inflictedEnemyDebuffs.some(
                                    (ab) => isStasis(ab.buffName)
                                );
                                if (!reInflictedStasis) {
                                    for (const victimId of teamTurnStasisHitVictims) {
                                        stasisBreakPending.set(victimId, true);
                                    }
                                }
                            }

                            // AMENDED BY SP-4c-2b at the end of this comment: the gate below now DOES
                            // carry a victim precondition (mirror of the focus site).
                            // Positional APPLY (Task 8b, GATED) — mirror of the focus site, keyed to THIS
                            // team actor's own position / parsed target (teamTargetById) / parsed pattern
                            // (teamPatternById). Drives the per-victim apply loop against the LIVE enemy
                            // roster when this walked team actor is positional, has a parsed target, AND its
                            // firing hit produced scalars. At Task 8b no production caller threaded these,
                            // so it was false for every existing test/golden → byte-identical. STALE since
                            // SP-4b-1: the boundary places and targets every team actor, so this fires for
                            // both calculators' team ships. That flip is what silently cost the DPS page its
                            // team-damage series — the scalar `roundDamage` team writer is gated on
                            // `!teamPositional`, so the credit moved to `perTargetDealt` and the display had
                            // to follow it (`RoundData.teamDamage`; see its note in dpsSimulator.ts).
                            // The pattern (teamPatternById) is REQUIRED for footprint expansion — without
                            // it there is no apply to perform (the then-shipped positionalSelection C2 test
                            // set position+target only, never a pattern, so it kept the legacy single-sink
                            // credit and never entered this branch; the boundary now fills the pattern).
                            // SP-4c-2b: victim-fenced exactly as the focus gate is — an ally-targeted
                            // cast has no opposing anchor to walk a footprint from, and the
                            // `!teamPositional` arm cannot book a phantom lump in its place because
                            // runPlayerTurn fences `directDamage` to 0 with no victim. See the focus
                            // site's `positional` for the full argument (incl. why this is NOT the
                            // `selectedEnemy != null` precondition that was deliberately omitted).
                            const teamPositional =
                                tgt !== undefined &&
                                resolvesPositionalVictim(actor.position, enemyAttackerActors) &&
                                teamTarget != null &&
                                teamPattern != null &&
                                teamTurn.positionalScalars != null;
                            // R-cast: mirror of the focus site — see its note.
                            let teamCastDelivered: number | undefined;
                            if (teamPositional) {
                                // Same direction as the focus site (player→enemy); keyed to THIS team
                                // actor's position / parsed target / parsed pattern. Non-null via the gate.
                                // SP-U U2: shared drivePositionalTurnApply helper (mirror of the focus
                                // site, keyed to THIS walked team actor as the acting attacker) — injects
                                // the player→enemy STANDING leech and emits the per-victim `attacked`
                                // inline (before detonation).
                                const tb = turnBindings(actor.side);
                                // SP-4b-2 D6: mirror of the focus site — stage the walked team
                                // actor's passive-slot instance against the turn-entry board.
                                const landTeamPassiveSlotHit = teamTurn.passiveSlotHit
                                    ? stagePassiveSlotHit(actor, tb, tgt, teamTurn.passiveSlotHit, {
                                          scheduledEnemyEffects: teamTurn.scheduledEnemyEffects,
                                          perVictimOutgoing: teamTurn.perVictimOutgoing,
                                          preTurnVictimStatus: teamPreTurnVictimStatus,
                                      })
                                    : undefined;
                                const teamPosApply = drivePositionalTurnApply(
                                    actor,
                                    tb,
                                    {
                                        tgt,
                                        pattern: teamPattern,
                                        target: teamTarget,
                                        preTurnVictimStatus: teamPreTurnVictimStatus,
                                        scalars: teamTurn.positionalScalars!,
                                        hitCrits: teamTurn.hitCrits,
                                        perVictimOutgoing: teamTurn.perVictimOutgoing,
                                        rollVictimCrit: teamTurn.rollVictimCrit,
                                        deferredAbilityPerformed: teamTurn.deferredAbilityPerformed,
                                        positionalDetonation: teamTurn.positionalDetonation,
                                        applyDebuffsForSubAttack: teamTurn.applyDebuffsForSubAttack,
                                        deferredEnemyApplications:
                                            teamTurn.deferredEnemyApplications,
                                        scheduledEnemyEffects: teamTurn.scheduledEnemyEffects,
                                    },
                                    (victim, damage, outcome) =>
                                        procLeechesForVictim(actor.id, victim, damage, outcome),
                                    // PR2 Task 3 — mirror of the focus site's per-sub-attack emit.
                                    (victims, subAttackIndex) => {
                                        if (victims.size > 0) {
                                            emitPerVictimAttacked({
                                                bus,
                                                round: r,
                                                attackerId: actor.id,
                                                primaryId: tgt.id,
                                                victims,
                                                subAttackIndex,
                                            });
                                        }
                                    }
                                );
                                teamCastDelivered = teamPosApply.critAgg.subAttacks.reduce(
                                    (sum, sub) => sum + (sub.deliveredDamage ?? 0),
                                    0
                                );
                                // SP-4b-2 D6: the staged passive-slot instance lands now.
                                landTeamPassiveSlotHit?.();
                            }
                            // Clause order — mirror of the focus site (see flushDeferredEnemyApplications).
                            flushDeferredEnemyApplications(teamTurn.deferredEnemyApplications);
                            // SP-4c-2b: the `?? teamTurn.directDamage` fallback below is REACHABLE on a
                            // no-victim turn — do NOT read the focus site's pre-SP-4c-2b claim that
                            // deferral is pinned to the positional gate, which this rung falsified at both
                            // sites. Deferral follows the unfenced `teamWillApplyPositionally`;
                            // `teamCastDelivered` follows the victim-fenced `teamPositional` and stays
                            // undefined, so an ally-targeted mixed cast with a firing-slot `damage-dealt`
                            // rider resolves its support off a Task-2-zeroed `directDamage` — the support
                            // pass still runs and correctly repairs 0. Full argument at the focus site's
                            // own `resolveCastSupport` call (search `the fallback is now REACHABLE`).
                            teamTurn.resolveCastSupport?.(
                                teamCastDelivered ?? teamTurn.directDamage
                            );

                            // Fold the team turn's damage into ITS OWN map entry (post-round assembly
                            // sums all non-focus entries into teamDamage). secondary/conditional are
                            // sub-buckets of direct (do NOT double-add) but kept distinct for the
                            // simulator-page seam.
                            //
                            // Credit SUPPRESSION for the positional case (Task 8b): same as the focus site —
                            // the firing-hit damage already landed per-victim via applyPositionalDamage, so
                            // skip the direct credit; KEEP detonation (bombs are out of scope). The
                            // single-sink decline that used to be zeroed for the positional path is now
                            // derived from the victim's own currentHp inside runPlayerTurn (PR6b), so no
                            // separate decline suppression is needed here.
                            const td = dmg(actor.id);
                            // secondary/conditional: a SYMMETRY PLACEHOLDER with NO READER today.
                            // Unlike the focus site's pair — which feeds `rawTotals` at the row
                            // assembly below — nothing consumes the TEAM values: `rawTotals` is
                            // focus-only by design (`totalSecondaryRaw += focus.secondary`, and the
                            // note above that line says so), and the simulator-page seam reads the
                            // per-actor map's `direct`/`detonation` only. So this write is dead in
                            // both directions: removing it changes no output, and adding a reader
                            // later must not have to notice that only one of the two paths fills
                            // the bucket. It is KEPT because team symmetry is a locked rule here —
                            // every walked team actor runs the same code path as the focus — and
                            // because the values are already computed, so keeping them costs one
                            // add. Do NOT "fix" it by moving it inside the guard: like the focus
                            // pair, these are DISPLAY sub-buckets of `direct` and never feed
                            // `cumulativeDamage`, so only the `creditDamage` calls below (which do
                            // feed cumulative accounting) belong behind the positional guard.
                            td.secondary += teamTurn.secondaryDamage;
                            td.conditional += teamTurn.conditionalDamage;
                            if (!teamPositional) {
                                creditDamage(actor.id, 'direct', teamTurn.directDamage);
                                // Detonation credit is suppressed in positional mode (teamTurn.detonationDamage
                                // is 0 there anyway — runPlayerTurn returns the recipe instead). Keeping it
                                // inside this guard documents intent and keeps per-victim detonation out of
                                // cumulativeDamage (it lands per-victim via applyVictimDamage above).
                                creditDamage(actor.id, 'detonation', teamTurn.detonationDamage);
                            } else {
                                // SP-4b-2 D1: the walked team's mirror of the focus site's
                                // positional direct twin — see its note for why the pair cannot
                                // double-count. A walked team actor's direct damage IS part of the
                                // gather (Echoing Burst gathers the whole side's direct), which is
                                // the entire point of the fixture that pins the scaling.
                                creditPositionalDirect(actor.id, teamCastDelivered ?? 0);
                            }

                            // The team turn's result row fields (action/roundCrit/etc.) are NOT consumed
                            // beyond damage + resisted routing + ctx. Stage its resisted enemy applications
                            // EXACTLY like the legacy team block: before any focus turn → pendingResisted;
                            // after → the last focus turn's list.
                            if (teamTurn.resistedEnemyDebuffs.length > 0) {
                                const lastTurn = focusTurns[focusTurns.length - 1];
                                if (lastTurn) {
                                    lastTurn.resistedEnemyDebuffs.push(
                                        ...teamTurn.resistedEnemyDebuffs
                                    );
                                } else {
                                    pendingResisted.push(...teamTurn.resistedEnemyDebuffs);
                                }
                            }

                            // Record this team actor's ctx for the enemy's per-entry DoT-tick attribution
                            // (its inferno entries tick with ITS effectiveAttack/dotMult/affinityMult).
                            lastTurnCtxByActor.set(actor.id, teamTurn.turnCtx);
                            // SP-D: record this cast's footprint size (mirrors the focus site,
                            // including the SP-4d Task 8 `tgt`-gated 0-vs-1 fallback — see its note).
                            enemiesHitThisCastByActor.set(
                                actor.id,
                                teamTurnArgs.aoeVictimIds?.length ?? (tgt !== undefined ? 1 : 0)
                            );

                            // Heal-target buffs: a walked team actor that IS the heal target surfaces its
                            // own comprehensive activeSelfBuffs (incl. recurring Cheat Death/Everliving Regen).
                            if (healTarget && actor.id === healTarget.id) {
                                healTargetBuffs = teamTurn.activeSelfBuffs;
                            }

                            processExtraActionGrants(actor, teamTurn.extraActionGrants);
                        } // end dead-after-burst guard (!burstDestroyedActor)
                    } else {
                        // §4.5 Deferred break: consume any pending Stasis break (team skip).
                        if (stasisBreakPending.has(actor.id)) {
                            stasisBreakPending.delete(actor.id);
                            for (const name of STASIS_BUFFS)
                                statusEngine.reduceTimedEnemyStatus(actor.id, name);
                        }
                    } // end stasis gate (walked-team branch)
                } else if (actor.kind === 'enemy') {
                    // ====================================================================
                    // ENEMY ATTACKER TURN (healing mode) — a bare-stat offense actor that
                    // bombards the heal target by walking the FULL runPlayerTurn pipeline with
                    // the TARGET bound as the `enemy` arg (Task 6b). Its damage drains shield-first
                    // into the live target via the intake below; self-buffs land in its OWN owner
                    // store; debuffs/DoTs land on the target's per-target store (targetId).
                    // Healing mode is guaranteed here in the current corpus: an enemy attacker only
                    // exists under an explicit heal focus OR a positional team battle (whose focus
                    // anchor makes healTarget defined), so healTarget is defined whenever this branch
                    // runs today. A future real DPS enemy (SP-U 5a) with neither will take the
                    // no-victim cadence-only skip before reaching the heal-target-dependent paths.
                    //
                    // DEAD-TARGET GUARD (restores the retired runEnemyAttackerTurn semantic): vs a
                    // dead heal target the enemy must NOT apply debuffs/DoTs or emit application
                    // events to it — but the charge cadence must STILL advance (charges keep banking,
                    // so a revived/re-spawned target would face a correctly-charged attacker). We
                    // therefore SKIP runPlayerTurn entirely when the target is dead (runPlayerTurn is
                    // the sole site that resolves the attack + applies the kit + emits events) and
                    // advance the cadence manually here, mirroring runPlayerTurn's preTurn step
                    // (consume-at-cap-and-reset, else +1) under the old `chargeCount > 0` guard.
                    // ====================================================================
                    // §4.3 STASIS GATE (B2 Task 3): a stasised real-enemy actor skips its
                    // action body. The Post-Turn decrements (below) still run — duration N
                    // therefore skips exactly N actions (decrement fires on the skipped turn).
                    // A stasised enemy banks NO charge (advanceChargeCadence is INSIDE the
                    // action body and is correctly skipped — matches in-game "charges do not
                    // generate while stasised"). §4.3 deviation: skip action, decrement
                    // preserved. No cadence-advance in the skip path.
                    if (!isTurnBlocked(actor.id)) {
                        // D-PR14: first REAL activation of the round (Stasis/Disable-skipped
                        // actors never enter these blocks). ??= writes once.
                        firstActivatorId ??= actor.id;

                        // ============================================================
                        // PR2: PER-POSITIONED-ENEMY TIMED BURST (player → enemy).
                        // ------------------------------------------------------------
                        // Written when the player-side burst path bursts only the (now-deleted)
                        // dummy's own timed containers. A real POSITIONED enemy victim is its own
                        // turn-taking actor carrying its OWN pendingBombs/pendingAccumulators (seeded by
                        // the player's earlier bomb/accumulator applications). Those timed
                        // containers count down + burst at the START of THIS enemy's turn —
                        // against ITS OWN HP — via `applyVictimDamage` (the same per-victim
                        // sink PR1's skill-detonation + bomb-splash-on-death #161 use). The
                        // burst is NEVER routed through `creditDamage(actor.id,'detonation')`:
                        // that feeds the SCALAR channel (`cumulativeDamage`), which would
                        // double-COUNT a per-victim amount (the two-channel rule at the round
                        // tail). Until SP-4c-2d it also drove the dummy sink's round-tail HP
                        // overwrite, i.e. a literal double-hit on HP `applyVictimDamage` had
                        // already drained; that write is deleted, the double-count is not.
                        //
                        // GATE: only a POSITIONED enemy (enemy-site positional sense — the same
                        // `resolvesPositionalVictim(actor.position, allPlayerActors)` predicate the firing-hit
                        // gate uses at `enemyPositional`/`:5011`) that actually carries timed
                        // entries. The non-empty guard makes this a STRICT no-op (byte-identical)
                        // for every existing fixture — none seed enemy-actor timed containers.
                        // Stasis: this burst sits INSIDE the `!isTurnBlocked` gate, so a stasised/
                        // disabled positioned enemy does NOT burst this turn (its whole turn is
                        // skipped per the locked combat rule).
                        applyPositionedTimedBurst(actor, sink, allPlayerActors);

                        // Dead-after-burst guard (spike Fact 3): a lethal timed burst above
                        // fires recordDestroyed inside applyVictimDamage, but the loop's
                        // top-of-turn dead-skip (`:4185`) already ran BEFORE this turn body, so
                        // it cannot catch a same-turn death. A ship the burst just destroyed must
                        // not act — skip the whole action-resolution body. We key off
                        // `destroyedRound` (the canonical death signal stamped by recordDestroyed),
                        // NOT `currentHp > 0`: a bare enemy ATTACKER carries no HP stat
                        // (`currentHp` undefined), yet still acts — only a recordDestroyed stamp
                        // means the burst actually killed it this turn. The healTarget exception
                        // mirrors the `:4185` top-of-turn guard so a dead heal-target enemy still
                        // runs its cadence-only body. The post-turn decrements / `turn-ended`
                        // AFTER this `if/else` still run (a dead ship's turn still consumed its
                        // slot; bomb-splash-on-death already chained inside applyVictimDamage).
                        const burstDestroyedActor =
                            actor.destroyedRound !== undefined &&
                            !(healTarget && actor.id === healTarget.id);
                        if (!burstDestroyedActor) {
                            const enemyRuntime = runtimeFor(actor);
                            // SP-F F5: predict whether THIS enemy turn will fire its CHARGED skill
                            // — the exact same predicate runPlayerTurn's own action decision reads
                            // (playerTurn.ts:~1044). Safe here because advanceChargeCadence (which
                            // consumes/resets the charge) runs INSIDE runPlayerTurn, AFTER the
                            // decision. Drives the charge-aware target/pattern resolution below.
                            // (It also fed a dead-target firing-skill check, via an
                            // `enemyWouldFireAction`/`selectFiringSkill` pair; #346 deleted that
                            // branch and the pair with it.)
                            const enemyWillFireCharged =
                                enemyRuntime.hasChargedSkill && actor.charges >= actor.chargeCount;
                            // Positional target selection (Task C3, side-symmetric, GATED). Mirrors the
                            // focus-turn (C1) and team-turn (C2) branches, but the OPPOSING roster from the
                            // enemy's view is the PLAYER TEAM (`allPlayerActors` = focus + walked team), the
                            // acting position is THIS enemy's board position (`actor.position`), and its
                            // parsed target rides on `enemyTargetById` (keyed by enemy actor id).
                            // SP-4e (#335): when the selection is null — not positional, no parsed
                            // target, or no living positioned player — this side no longer diverges
                            // from the player one. It used to fall back to `legacyVictim: healTarget`
                            // and read that stand-in for the WHOLE turn (defence/hp/decline lookup,
                            // the runPlayerTurn bind, AND the applyIncomingToTarget intake), so an
                            // ally-targeted enemy supporter resolved the FOCUS PLAYER as the victim
                            // of a cast that never targeted them. Now it runs a NO-VICTIM turn, and
                            // every victim-derived read below is conditional on `tgt`.
                            // SP-F F5: resolve from the CHARGED target axis on a charge-firing turn
                            // (falls back to the active target when unset → byte-identical).
                            const enemyTarget = enemyWillFireCharged
                                ? parsedChargedTargetFor(actor)
                                : parsedTargetFor(actor);
                            // The enemy's victim THIS turn: the positionally-selected player actor,
                            // or NOBODY. Every per-victim binding below derives from `tgt` uniformly
                            // (defence/maxHp/decline, the runPlayerTurn `enemy`+containers, and the
                            // applyIncomingToTarget intake), each guarded on its presence.
                            const { tgt } = selectTurnTarget(actor);
                            // This enemy attacker's parsed pattern (Task 9) — REQUIRED for the enemy-site
                            // positional apply (footprint expansion). An enemy with a target but NO pattern
                            // stays on the legacy single-apply path (same `pattern != null` guard as the
                            // focus/team sites). Undefined for every current fixture → enemyPositional false.
                            // SP-F F5: resolve from the CHARGED pattern axis on a charge-firing turn
                            // (falls back to the active pattern when unset → byte-identical).
                            const enemyPattern = enemyWillFireCharged
                                ? parsedChargedPatternFor(actor)
                                : parsedPatternFor(actor);
                            // Task 5: the per-victim crit aggregate from the enemy positional apply, hoisted
                            // out of the `if (damage > 0)` block. Present only when the positional apply
                            // actually ran; when the enemy turn is positional but deals 0 damage (apply
                            // skipped), the deferred emit below falls back to the anchor-based crit values
                            // (byte-identical to the pre-Task-5 inline emit for that 0-damage edge case).
                            let enemyCritAgg:
                                | {
                                      anyCrit: boolean;
                                      critPairs: number;
                                      critVictimIds: string[];
                                      subAttacks: SubAttackOutcome[];
                                  }
                                | undefined;
                            // Task 5: predict enemy positional apply (mirror of focus/team) so runPlayerTurn
                            // defers its inline ability-performed emit. The opposing roster from the enemy's
                            // view is the PLAYER team (allPlayerActors).
                            const enemyWillApplyPositionally =
                                resolvesPositionalVictim(actor.position, allPlayerActors) &&
                                enemyTarget != null &&
                                enemyPattern != null;
                            // §4.5: inject break hook into runPlayerTurn for the enemy turn (mirrors
                            // focus/team sites). Captured BEFORE runPlayerTurn so Stasis re-applied
                            // by the same attack's debuff ability is not inadvertently broken.
                            // §4.5 Akula exception: if the ACTING ATTACKER has doesntBreakStasis,
                            // the victim is never recorded → no break-mark, no stasisBreakPending.
                            const enemyTgtWasStasised =
                                !actor.doesntBreakStasis && tgt !== undefined && isStasised(tgt.id);
                            const enemyTurnStasisHitVictims = new Set<string>();
                            const enemyBreakHook = enemyTgtWasStasised
                                ? (targetId: string) => {
                                      enemyTurnStasisHitVictims.add(targetId);
                                  }
                                : undefined;
                            // D-PR3 Task 9: victim-side incoming %-reduction against the bound
                            // target on the AGGREGATE (non-positional) damage path — Iridium-as-tank.
                            // `tgt` is the victim; `actor` is the acting enemy attacker. The non-crit
                            // baseline is the reduction with didCrit:false; the crit-family DELTA is
                            // the extra reduction a crit adds. Guarded by length so a victim with no
                            // incoming abilities passes 0/0 → byte-identical. (The positional enemy
                            // path applies its own per-sub-hit reduction via drivePositionalApply;
                            // this fold serves the legacy single-apply.)
                            //
                            // SP-4e: fenced on the victim's PRESENCE, not just on the ability list.
                            // With no victim there is nobody whose incoming channel could reduce
                            // anything, and the two args default to 0 inside runPlayerTurn — which is
                            // also what the two PLAYER cast sites pass (they never thread these at
                            // all), so the no-victim enemy turn matches them. Safe to fence: both
                            // args feed ONLY `damageCritMultiplier`/`nonCritFactor`, whose every
                            // consumer (`directDamage`/`secondaryDamage`/`conditionalDamage`, and
                            // `passiveDamage` through `directDamage`) is already `hasVictim`-fenced
                            // in playerTurn.ts. Neither reaches `turnCtx` or `positionalScalars`, the
                            // two things this turn PUBLISHES as standing state — checked, because
                            // fencing a value that is also published is the defect that once silenced
                            // every supporter's reactive debuffs.
                            let incomingReductionNonCritPct = 0;
                            let incomingReductionCritAll = 0;
                            if (tgt !== undefined) {
                                const tgtIncoming = incomingAbilitiesOf(tgt.id);
                                incomingReductionNonCritPct = tgtIncoming.length
                                    ? incomingReductionForHit(tgtIncoming, {
                                          didCrit: false,
                                          attackerStealthed: isStealthed(actor.id),
                                          victimStealthed: isStealthed(tgt.id),
                                          victimStasised: isStasised(tgt.id),
                                          hitIndexThisRound: 0,
                                          attackerHasDot: attackerHasDot(actor.id),
                                          victimHasBarrierRecharging: hasBarrierRecharging(tgt.id),
                                          victimHasShield: hasShield(tgt.id),
                                          selfHpPct: selfHpPctOf(tgt.id),
                                          attackerTauntedOrProvoked: attackerTauntedOrProvoked(
                                              actor.id
                                          ),
                                      })
                                    : 0;
                                incomingReductionCritAll = tgtIncoming.length
                                    ? incomingReductionForHit(tgtIncoming, {
                                          didCrit: true,
                                          attackerStealthed: isStealthed(actor.id),
                                          victimStealthed: isStealthed(tgt.id),
                                          victimStasised: isStasised(tgt.id),
                                          hitIndexThisRound: 0,
                                          attackerHasDot: attackerHasDot(actor.id),
                                          victimHasBarrierRecharging: hasBarrierRecharging(tgt.id),
                                          victimHasShield: hasShield(tgt.id),
                                          selfHpPct: selfHpPctOf(tgt.id),
                                          attackerTauntedOrProvoked: attackerTauntedOrProvoked(
                                              actor.id
                                          ),
                                      })
                                    : 0;
                            }
                            // F3: crit-conditional pre-fight damage modifiers, mirrored from
                            // the positional incomingReductionFor site (crit hits only, via
                            // the crit-family delta). Same sign convention: the channel is a
                            // REDUCTION, leader values are benefit/penalty-phrased, so both
                            // terms are negated (victim incomingCritDamage -10 → +10 reduction
                            // on crits; attacker outgoingCritDamage -10 → its crits deal 10%
                            // less). Absent → 0 → byte-identical.
                            // SP-4e: only the VICTIM term is fenced. The ACTING enemy's own
                            // `outgoingCritDamage` is not victim-derived, so it keeps applying
                            // on a no-victim turn — collapsing the whole expression would have
                            // silently dropped a modifier that has nothing to do with the victim.
                            const preFightCritFamilyPct =
                                -(tgt?.preFight?.incomingCritDamage ?? 0) -
                                (actor.preFight?.outgoingCritDamage ?? 0);
                            const incomingReductionCritFamilyPct =
                                incomingReductionCritAll -
                                incomingReductionNonCritPct +
                                preFightCritFamilyPct;
                            // Sub-project I, PR I2: snapshot BEFORE runPlayerTurn (the enemy's
                            // opposing roster is the PLAYER team — allPlayerActors).
                            const enemyPreTurnVictimStatus =
                                snapshotPreTurnVictimStatus(allPlayerActors);
                            const enemyTurnArgs = buildTurnArgs(actor, tgt);
                            const enemyTurn = runPlayerTurn({
                                ...enemyTurnArgs,
                                deferAbilityPerformedToEngine: enemyWillApplyPositionally,
                                onHitBreakStasis: enemyBreakHook,
                                incomingReductionNonCritPct,
                                incomingReductionCritFamilyPct,
                            });
                            // Set for SYMMETRY, and it is provably a no-op on this branch: unlike the
                            // two player branches, the enemy branch's `lastTurnCtxByActor.set` sits
                            // ABOVE its positional apply, so the map already holds this very object
                            // when the leech fires. Kept so all three branches read one rule and a
                            // future reordering of the enemy publish cannot silently reopen the gap on
                            // this side alone. Measured before and after: an enemy-side damage-dealt
                            // leech's three-round profile is unchanged.
                            actingTurnCtx = { actorId: actor.id, ctx: enemyTurn.turnCtx };
                            // §4.5: resolve Stasis break for player victims hit by this enemy.
                            if (enemyTurnStasisHitVictims.size > 0) {
                                // KNOWN LIMITATION — see the focus site's note above its own
                                // `reInflictedStasis` read (search
                                // `turnStasisHitVictims.size > 0`) for the full explanation;
                                // this read has the same pre-positional-drive ordering.
                                const reInflictedStasis = enemyTurn.inflictedEnemyDebuffs.some(
                                    (ab) => isStasis(ab.buffName)
                                );
                                if (!reInflictedStasis) {
                                    for (const victimId of enemyTurnStasisHitVictims) {
                                        stasisBreakPending.set(victimId, true);
                                    }
                                }
                            }
                            // Total damage the enemy dealt to the bound target this turn. secondary/
                            // conditional are display sub-buckets ALREADY inside directDamage (do NOT
                            // re-add). detonationDamage is the player-turn detonate() portion (0 for a bare
                            // enemy). Credit it as INCOMING damage to the tank — NOT a player damage row.
                            const damage = enemyTurn.directDamage + enemyTurn.detonationDamage;
                            // H1 T4: the detonation slice, passed to the apply call below as
                            // `bombPortion` (a bomb portion drains the shield in FULL, no penetration).
                            const enemyDetonationDamage = enemyTurn.detonationDamage;
                            // Task 8: the cast's any-hit crit outcome, for the `attacked` emit below.
                            const enemyTurnDidCrit = enemyTurn.roundCrit;
                            // Phase 4c Task 3: the per-hit crit array, for the per-hit `attacked` emit.
                            const enemyHitCrits = enemyTurn.hitCrits;
                            // Positional gate (Task 9, enemy site): mirror of the focus/team gates, but
                            // the OPPOSING roster from the enemy's view is the PLAYER team
                            // (allPlayerActors), the parsed target rides on enemyTargetById, and the
                            // parsed pattern on enemyPatternById. When true, the firing-hit damage lands
                            // per-victim via drivePositionalApply (below) against the live player roster
                            // and the legacy single-apply is SUPPRESSED. "No production caller threads
                            // position+target+pattern for an enemy yet → false for every golden" was
                            // true when written and is NOT true now — SP-U U5 already corrected it (see
                            // the note at the `if (enemyPositional)` body below: the 2v2/3v3/healing
                            // goldens thread enemy positions and patterns), and since SP-4b-1 the
                            // normalization boundary places and targets every supplied enemy, so this
                            // is the ordinary path whenever a caller passes `enemyAttackers`.
                            const enemyPositional =
                                resolvesPositionalVictim(actor.position, allPlayerActors) &&
                                enemyTarget != null &&
                                enemyPattern != null &&
                                enemyTurn.positionalScalars != null;
                            const enemyScalars = enemyTurn.positionalScalars;
                            const enemyPassiveSlotHit = enemyTurn.passiveSlotHit;
                            // Sub-project I, PR I2: capture the enemy turn's per-victim
                            // outgoing-modifier ingredients (team-symmetric mirror of the
                            // focus/team sites).
                            const enemyPerVictimOutgoing = enemyTurn.perVictimOutgoing;
                            // SP-4b-2 D4: capture the enemy turn's gated scheduled enemy effects.
                            const enemyScheduledEnemyEffects = enemyTurn.scheduledEnemyEffects;
                            // Per-victim crit: capture the enemy turn's per-victim crit resolver.
                            const enemyRollVictimCrit = enemyTurn.rollVictimCrit;
                            // Task 5: capture the deferred ability-performed payload (present ⟺ the
                            // enemy inline emit was suppressed, i.e. enemyPositional true).
                            const enemyDeferredAbilityPerformed =
                                enemyTurn.deferredAbilityPerformed;
                            const enemyResolveCastSupport = enemyTurn.resolveCastSupport;
                            const enemyDirectDamage = enemyTurn.directDamage;
                            // Clause order: capture the held-back landings for the post-damage flush.
                            // PR8: THIS array identity is what the positional drive splices at a
                            // sub-attack boundary AND what the fallback flush below drains — the
                            // two must be the same object or the enemy path silently keeps
                            // once-per-cast arrival. Both captures happen HERE, before the drive
                            // call, so the helper sees them.
                            const enemyDeferredApplications = enemyTurn.deferredEnemyApplications;
                            const enemyApplyDebuffsForSubAttack =
                                enemyTurn.applyDebuffsForSubAttack;
                            // PR3: capture the per-victim detonation recipe (returned whenever
                            // `positional: true` was set for this enemy turn — see the positional
                            // hint gate). Consumed by the enemy-site per-victim detonation loop below.
                            const enemyPositionalDetonation = enemyTurn.positionalDetonation;
                            // Record the enemy actor's round-scoped ctx (parity with player/team branches;
                            // its own future DoT entries would tick with this ctx).
                            //
                            // This `set` is UNCONDITIONAL, including on a no-victim enemy turn — the
                            // measurement that used to live on the deleted dead-target skip, kept here
                            // because it is a fact about this line. Whole suite: **1,695** enemy
                            // no-victim turns across 26 files reach it. ⚠️ 1,695 is the POPULATION,
                            // not the DELTA — do not restate it as "1,695 turns that previously
                            // published none". Pre-#335 the ~335 ally-side-target rows whose anchor
                            // was alive resolved that anchor as their victim, so they already reached
                            // here; only the rows whose anchor was itself undefined published nothing
                            // (1,341 + 15 = **~1,356**, the delta). The two numbers answer different
                            // questions, and conflating them is the error that rung kept catching.
                            // It moved no golden either way: the only consumer is an enemy DoT tick
                            // attributed to this actor, and a no-victim turn applies no DoT.
                            lastTurnCtxByActor.set(actor.id, enemyTurn.turnCtx);
                            // SP-D: record this cast's footprint size (mirrors the focus/team
                            // sites, including the SP-4d Task 8 `tgt`-gated 0-vs-1 fallback).
                            //
                            // ⚠️ SP-4e (#335) MADE THE `0` ARM LIVE ON THIS SIDE. The comment
                            // that stood here read "`tgt` is guaranteed defined in this branch
                            // (the enclosing `if (skipDeadTargetTurn || tgt === undefined)`
                            // already bailed otherwise — an enemy attacker always resolves a
                            // real victim, the no-victim concept is player-ally-cast-only), so
                            // this is a no-op for the enemy side". Every clause of that is now
                            // false: an enemy attacker that resolves no victim is exactly what
                            // #335 fixed, and the no-victim rule is BOTH sides'. The `if` it
                            // cited no longer exists at all — #335 deleted the `tgt === undefined`
                            // arm and #346 deleted the rest, so this site is unconditional.
                            //
                            // So this is not a no-op here any more. On a no-victim enemy turn
                            // `aoeVictimIds` is `undefined` (`buildTurnArgs` gates it on
                            // `tgt?.position != null`), the `??` falls through, and
                            // `(tgt !== undefined ? 1 : 0)` records a footprint of **0** —
                            // "this cast hit no enemy" — for the first time on this side, on
                            // every one of the ~1,695 measured no-victim enemy turns. That is
                            // the honest reading for a cast that reached nobody, and it is the
                            // same expression the two player sites have recorded since SP-4d
                            // Task 8: all three sites read one expression rather than two
                            // agreeing by construction and one by accident.
                            enemiesHitThisCastByActor.set(
                                actor.id,
                                enemyTurnArgs.aoeVictimIds?.length ?? (tgt !== undefined ? 1 : 0)
                            );
                            // Surface this enemy attacker's effects for the UI's round overview (Task 10a):
                            // its own active self-buffs and the debuffs it landed on the heal target,
                            // ATTRIBUTED to this enemy's actor id. NAMES ONLY for display — never folded
                            // into any sim value. Empty for a bare enemy → no entry recorded for it.
                            // Debuffs use inflictedEnemyDebuffs (source-accurate: only what THIS enemy
                            // applied this turn) rather than landedEnemyDebuffs (the shared per-target
                            // window, which would leak other attackers' debuffs into this enemy's group).
                            // resistedEnemyDebuffs = the TIMED debuffs THIS enemy attempted but were
                            // resisted by its hacking-vs-security landing roll (display-only — Task R1).
                            // resistedEnemyDots = the DoTs THIS enemy attempted this turn that were
                            // resisted by the SAME landing roll (the whole turn's DoTs share one
                            // dotsLanded draw — all land or all miss together). Only corrosion/inferno
                            // are modelled by EnemyDoTState; any bomb entry is skipped (display-only —
                            // Task R3).
                            // The guard also fires on resists alone so a fully-resisted enemy (nothing
                            // landed) still gets an entry and surfaces its resisted debuffs/DoTs.
                            const resistedEnemyDots: EnemyDoTState[] =
                                !enemyTurn.dotsLanded && enemyTurn.dotsConfig.length > 0
                                    ? enemyTurn.dotsConfig
                                          .filter(
                                              (d) => d.type === 'corrosion' || d.type === 'inferno'
                                          )
                                          .map((d) => ({
                                              type: d.type as 'corrosion' | 'inferno',
                                              tier: d.tier,
                                              stacks: d.stacks,
                                          }))
                                    : [];
                            if (
                                enemyTurn.activeSelfBuffs.length > 0 ||
                                enemyTurn.inflictedEnemyDebuffs.length > 0 ||
                                enemyTurn.resistedEnemyDebuffs.length > 0 ||
                                resistedEnemyDots.length > 0
                            ) {
                                let entry = roundEnemyEffects.get(actor.id);
                                if (!entry) {
                                    entry = {
                                        selfBuffs: [],
                                        debuffs: [],
                                        resistedDebuffs: [],
                                        resistedDots: [],
                                    };
                                    roundEnemyEffects.set(actor.id, entry);
                                }
                                entry.selfBuffs.push(...enemyTurn.activeSelfBuffs);
                                entry.debuffs.push(...enemyTurn.inflictedEnemyDebuffs);
                                entry.resistedDebuffs.push(...enemyTurn.resistedEnemyDebuffs);
                                entry.resistedDots.push(...resistedEnemyDots);
                            }
                            // Extra-action grants: bump this enemy's pending-action count so it is re-picked
                            // for an extra turn (full-actor completeness — mirrors the attacker and walked-team branches).
                            // The oncePerRound / MAX_EXTRA_TURNS_PER_ROUND backstops inside
                            // processExtraActionGrants absorb any runaway grants. grantAllyCharges stays
                            // undefined (enemy's "allies" are enemy-side, not the player team).
                            processExtraActionGrants(actor, enemyTurn.extraActionGrants);
                            // ── SP-4b-2 D6, task-18 finding 3: the enemy's passive-slot instance is
                            // STAGED HERE, OUTSIDE the `damage > 0` gate below ──────────────────
                            // Team symmetry is LOCKED, and the two player-side sites stage theirs
                            // inside a plain `if (positional)` with NO damage term: a cast whose
                            // FIRING hit contributes nothing to the aggregate still lands its
                            // passive-slot instance on the victims its OWN footprint reaches. The
                            // enemy's whole apply block sits inside `damage > 0`, so an enemy in
                            // that position dropped the instance entirely — the same defect shape
                            // the `flushDeferredEnemyApplications` note below this block records
                            // ("a cast that … deals no damage still has to apply it").
                            //
                            // MEASURED (the fixture is `passiveSlotDamageFootprint.integration`'s
                            // zero-damage pair). An enemy firing at an anchor carrying a 100%
                            // `incoming-reduction` has aggregate `damage` 0 — `directDamage` is
                            // `firing + passiveDamage`, and BOTH terms share the anchor's
                            // `nonCritFactor`, which that reduction zeroes. Pre-fix the enemy dealt
                            // NOTHING AT ALL (`perTargetDealt` undefined) even though an unmitigated
                            // ally stood in the passive's `all-enemies` footprint; the player-side
                            // mirror credited that victim its full share.
                            //
                            // Resolving the footprint here rather than inside the block is safe:
                            // everything between is comment + `let` declarations, so the board this
                            // sees is the same one the old call site saw. Staging is also side-effect
                            // free (a pure `footprintVictims` read) and the apply skips any victim
                            // whose share is not `> 0`, with `creditPositionalDirect` no-opping on 0
                            // — so a zero-attack enemy (the DPS default) stages, lands nothing and
                            // changes nothing.
                            const stagedEnemyPassiveSlotHit =
                                enemyPositional && enemyPassiveSlotHit && tgt !== undefined
                                    ? stagePassiveSlotHit(
                                          actor,
                                          turnBindings(actor.side),
                                          tgt,
                                          enemyPassiveSlotHit,
                                          {
                                              scheduledEnemyEffects: enemyScheduledEnemyEffects,
                                              perVictimOutgoing: enemyPerVictimOutgoing,
                                              preTurnVictimStatus: enemyPreTurnVictimStatus,
                                          }
                                      )
                                    : undefined;
                            let enemyPassiveSlotLanded = false;
                            /** The staged instance, run AT MOST ONCE — after the firing hit when there
                             *  was one (the "one turn, one board" invariant `stagePassiveSlotHit`
                             *  documents), from the fallback below when there was not. */
                            const landEnemyPassiveSlotHitOnce = (): void => {
                                if (enemyPassiveSlotLanded) return;
                                enemyPassiveSlotLanded = true;
                                stagedEnemyPassiveSlotHit?.();
                            };
                            // `tgt !== undefined` narrows the victim for this block (SP-U U5 R6).
                            //
                            // ⚠️ SP-4e (#335) INVERTED THE REASON, and the reason is what tells the
                            // next reader whether the term is removable. It used to read: "a
                            // positive `damage` is only produced by the non-skip `else` above, which
                            // runs only when `tgt` is defined". The `else` now runs precisely when
                            // `tgt` is UNDEFINED too — that is the no-victim turn. The conjunct is
                            // still always true when `damage > 0`, but for the opposite reason: with
                            // no victim `runPlayerTurn` fences its whole damage assembly on
                            // `hasVictim`, so `damage` comes back 0 and a no-victim turn cannot
                            // enter this block at all. The term is therefore what KEEPS that fence
                            // honest at this seam rather than a redundant narrowing — drop it and a
                            // future non-zero no-victim `damage` falls into a block that
                            // dereferences `tgt` throughout.
                            if (damage > 0 && tgt !== undefined) {
                                // Phase-5 per-victim accounting notes (see detailed notes below): (1) the
                                // damage-taken leech fires PER VICTIM (E2 T5, procTakenLeechesPerVictim at
                                // the enemy site), which since #374 is the only taken-leech path — the
                                // `!enemyPositional` heal-target-only block below was deleted; (2) since PR5b
                                // sink.addIncoming keys each victim's AoE share into ITS OWN per-actor
                                // bucket (the heal-target row is no longer inflated) — surfacing those other
                                // per-actor buckets as result rows is the still-deferred symmetric-accounting
                                // surface.
                                //
                                // Shield-first drain → HP → ship-destroyed → the victim's per-actor bucket. The
                                // shieldBefore/hpDamage are captured for the punch-through gate (Quixilver) below.
                                // hpDamage comes straight from the closure (0 under Barrier — damage fully
                                // blocked, not shield-absorbed — otherwise damage - absorbed). barriered = the
                                // attack was fully blocked by an active Barrier (decision #7, below).
                                // Route the enemy's incoming damage. Two mutually-exclusive paths:
                                //
                                //  - NON-positional (legacy): a SINGLE applyIncomingToTarget(damage, tgt)
                                //    drains the POSITIONALLY-RESOLVED victim. (Until SP-4e this note read
                                //    "tgt === healTarget! on the legacy path → the no-arg-equivalent call,
                                //    byte-identical", because the non-positional path bound the heal anchor
                                //    as a fallback victim. It does not: `tgt` is the resolved victim or
                                //    nothing, and a no-victim turn never reaches here — the
                                //    `damage > 0 && tgt !== undefined` gate above fences it out.) Returns
                                //    the shield/HP/Barrier outcome consumed by the damage-taken leech
                                //    block below.
                                //
                                //  - POSITIONAL (Task 9): drivePositionalApply lands the firing hit per-victim
                                //    across the LIVE PLAYER roster (origin full / covered half) via the
                                //    PLAYER-side applyIncomingToTarget wrapper — each player victim takes REAL
                                //    HP/shield/death damage. The single apply is SUPPRESSED (else the anchor
                                //    victim would be double-hit: once by the AoE loop, once by the single
                                //    apply). enemyPattern is non-null via the enemyPositional gate.
                                //
                                // These aggregate locals feed ONLY the non-positional damage-taken leech
                                // block below; on the positional path they stay at neutral defaults. Per-victim
                                // taken leech on the positional path is now handled by procTakenLeechesPerVictim
                                // (E2 T5), which reads each player victim's OWN {shieldBefore,hpDamage,barriered}
                                // outcome via the onVictimResolved hook — not these heal-target aggregates. The
                                // non-positional path keeps the exact legacy single-target leech values.
                                let shieldBefore = 0;
                                let hpDamage = 0;
                                let barriered = false;
                                let converted = false;
                                // Symmetric shieldWasHit: capture the FOCUS player victim's shield
                                // outcome on the positional path (the non-positional `else` branch binds
                                // shieldBefore/hpDamage/barriered directly; positional leaves them 0).
                                // First-hit-focus victim matched by victim.id === tgt.id; OR'd across the
                                // attack's hits so an early shield-denting hit still counts.
                                let positionalShieldWasHit = false;
                                let positionalShieldCaptured = false;
                                // SP-U U2: the per-victim `attacked` signals from the shared positional
                                // helper, held in the OUTER (enemy-turn) scope because the enemy→player
                                // site emits its per-victim `attacked` AFTER its inline non-positional
                                // damage-taken-leech tail (its row-14 accounting, kept inline → U5) — unlike
                                // the player→enemy sites, which emit inside the helper. Assigned from the
                                // helper return when enemyPositional; stays undefined on the non-positional
                                // path (legacy single emit). The covered-victim Stasis break + detonation
                                // targets are now owned INSIDE the helper.
                                // PR2 Task 3: the deferred remainder of the enemy cast's
                                // interleaved emission sequence (its first `ability-performed`
                                // already fired inside the helper, at the position the single
                                // aggregate emit has always held). Runs in the inline tail below.
                                let enemyEmitDeferred: (() => void) | undefined;
                                if (enemyPositional) {
                                    // Opposing roster + victim wrapper from the per-side bindings
                                    // (enemy→player here). PLAYER-side wrapper: each player victim takes
                                    // real incoming damage; every victim's OWN currentHp/shield/death is
                                    // mutated. Since PR5b the sink keys intake by victim.id, so each covered
                                    // victim's AoE share lands in ITS OWN per-actor bucket. This enemy
                                    // positional path IS exercised in production: the sim goldens
                                    // (2v2/3v3/healing) thread enemy positions+patterns so real enemy
                                    // attackers hit player victims here (SP-U U5 corrected the earlier
                                    // "inert — no production caller" note).
                                    // SP-U U2: shared drivePositionalTurnApply helper. The enemy injects the
                                    // enemy→player TAKEN leech (E2 Task 5 — each player victim procs its OWN
                                    // damage-taken heal/shield leech off the damage IT took) PLUS the focus
                                    // victim's shield-hit capture; and it passes `deferEmission` because
                                    // the enemy defers its per-victim `attacked` emit to its inline row-14
                                    // tail below (after the non-positional damage-taken-leech block) — see the
                                    // U5 deferral note there. enemyRollVictimCrit is defined whenever
                                    // enemyPositional (captured from enemyTurn.rollVictimCrit in the same
                                    // non-dead block). The helper owns the detonation targets + covered-victim
                                    // Stasis break; it returns critAgg (for the 0-damage deferred-emit
                                    // fallback) and emitDeferred (the rest of the interleaved sequence).
                                    const tb = turnBindings(actor.side);
                                    const posApply = drivePositionalTurnApply(
                                        actor,
                                        tb,
                                        {
                                            tgt,
                                            // No `!` needed: `enemyPositional` is a const whose
                                            // conjunction includes both non-null checks, so the
                                            // gate above narrows them (it could not while these
                                            // were `let`s written inside a nested block).
                                            pattern: enemyPattern,
                                            target: enemyTarget,
                                            preTurnVictimStatus: enemyPreTurnVictimStatus,
                                            scalars: enemyScalars!,
                                            hitCrits: enemyHitCrits,
                                            perVictimOutgoing: enemyPerVictimOutgoing,
                                            rollVictimCrit: enemyRollVictimCrit,
                                            deferredAbilityPerformed: enemyDeferredAbilityPerformed,
                                            positionalDetonation: enemyPositionalDetonation,
                                            applyDebuffsForSubAttack: enemyApplyDebuffsForSubAttack,
                                            // The SAME array the fallback flush below drains (see
                                            // the capture note), never a fresh one.
                                            deferredEnemyApplications: enemyDeferredApplications,
                                            // Team symmetry: the enemy's own turn gates its own
                                            // scheduled debuffs on the player side by the same draw.
                                            scheduledEnemyEffects: enemyScheduledEnemyEffects,
                                        },
                                        (victim, dmg, outcome) => {
                                            procLeechesForVictim(actor.id, victim, dmg, outcome);
                                            if (victim.id === tgt.id) {
                                                positionalShieldCaptured = true;
                                                positionalShieldWasHit =
                                                    positionalShieldWasHit ||
                                                    (!outcome.barriered &&
                                                        !outcome.converted &&
                                                        outcome.shieldBefore > 0 &&
                                                        outcome.hpDamage < dmg);
                                            }
                                        },
                                        // PR2 Task 3: ONE sub-attack's victims per call. The enemy
                                        // still DEFERS the whole fan-out to its inline tail (U5),
                                        // so these calls run from `emitDeferred` below, not here.
                                        (victims, subAttackIndex) => {
                                            if (victims.size > 0) {
                                                emitPerVictimAttacked({
                                                    bus,
                                                    round: r,
                                                    attackerId: actor.id,
                                                    primaryId: tgt.id,
                                                    victims,
                                                    subAttackIndex,
                                                });
                                            }
                                        },
                                        true
                                    );
                                    enemyCritAgg = posApply.critAgg;
                                    enemyEmitDeferred = posApply.emitDeferred;
                                    // SP-4b-2 D6: the staged passive-slot instance lands now — after
                                    // the firing hit, exactly as the two player-side sites do it.
                                    landEnemyPassiveSlotHitOnce();
                                    // SP-4b-2 D1: the enemy site's positional direct twin. There is
                                    // no `if (!enemyPositional) creditDamage(...,'direct',…)` to
                                    // pair with — `roundDamage` is a player-credit map, so the
                                    // enemy side never had a scalar direct channel at all. That is
                                    // exactly why the player-side accumulator gather was documented
                                    // as an "inert placeholder": nothing fed it. This write is the
                                    // enemy side's only direct channel, and it can only run on the
                                    // positional branch — so no double-count is reachable here
                                    // either. Team symmetry is LOCKED for this pair.
                                    creditPositionalDirect(
                                        actor.id,
                                        posApply.critAgg.subAttacks.reduce(
                                            (sum, sub) => sum + (sub.deliveredDamage ?? 0),
                                            0
                                        )
                                    );
                                } else {
                                    // SP-U U2: the enemy's non-positional INCOMING-damage accounting tail
                                    // (applyIncomingToTarget + the single legacy `attacked` emit below; the
                                    // damage-taken heal/shield leech block that used to sit here too was
                                    // deleted by #374, measured never entered on either arm) is a different
                                    // model from the
                                    // player→enemy outgoing credit — it is NOT extracted here; its unification
                                    // is deferred to U5 (real DPS enemy keystone), when the scalar sink dies.
                                    ({
                                        shieldBefore,
                                        hpDamage,
                                        barriered,
                                        converted = false,
                                    } = applyIncomingToTarget(damage, tgt, {
                                        // H1 T4: `damage` = directDamage + detonationDamage (above).
                                        // The detonation slice drains the shield in FULL (no pen);
                                        // only the direct slice respects the attacker's penetration.
                                        killerId: actingActorId,
                                        byDirectDamage: true,
                                        bombPortion: enemyDetonationDamage,
                                        // #358 ADDENDUM 2 — KNOWN UNFIXED FOLD PATH, PARKED
                                        // (owner ruling; tracked with the corpus-unreachable group,
                                        // #357). `damage` here is `directDamage + detonationDamage`
                                        // and its DIRECT slice is already post-defence-mitigation
                                        // (playerTurn's `postDefenseFactor` folds
                                        // `1 - damageReduction/100`). It therefore passes NO
                                        // `preMitigationDamage`, so the funnel books the
                                        // post-mitigation figure on the raw axis for this path —
                                        // the one place `.incomingRaw` under-reports.
                                        //
                                        // NOT FIXED DELIBERATELY. This site is CORPUS-UNREACHABLE:
                                        // a stack-frame probe over the whole combat + calculator
                                        // suite (406 files / 3935 tests) recorded ZERO calls
                                        // through it — every enemy attack in every fixture takes
                                        // the positional branch (`enemyPositional`, :11303). The
                                        // fix would need a new `PlayerTurnResult` field that no
                                        // test could exercise, so it would ship unverified. The
                                        // other six folding paths ARE covered; see
                                        // `ActorIntake.incomingRaw`.
                                    }));
                                    // §4.5: the non-positional firing hit is DIRECT-channel. The Stasis
                                    // break already fired via onHitBreakStasis inside runPlayerTurn
                                    // (before the ability debuffs), so no additional break call needed here.
                                }

                                // Per-hit `attacked` (Phase 4c PR 1): one event per hit of the enemy's fired
                                // damage ability, each carrying ITS OWN hit's crit outcome. Emitted after the
                                // aggregate shield-first drain (damage application stays per-attack — spec §3.1),
                                // so every event observes the same post-drain HP/shield state. A turn with
                                // damage > 0 but an empty enemyHitCrits (manual flat enemy, a noCrit damage
                                // ability, or a cast with no damage ability) falls back to one event with the
                                // roundCrit binary — the pre-4c contract.
                                const hitOutcomes =
                                    enemyHitCrits.length > 0 ? enemyHitCrits : [enemyTurnDidCrit];
                                // G PR2: did the attack actually dent the victim's shield this turn?
                                // absorbed = damage - hpDamage when not barriered; shieldBefore>0 guards a
                                // "had a shield" precondition. Non-positional path only (positional leaves
                                // shieldBefore/hpDamage at 0 → false; no fixture threads enemy positions).
                                // Positional path captures the focus victim's per-hit shield outcome
                                // (Step 3); the non-positional else-branch keeps the aggregate fallback.
                                if (enemyPositional) {
                                    // PR7 Task 4: per-victim emit. One `attacked` per footprint player
                                    // victim hit by this enemy cast (isPrimaryTarget only on the anchor,
                                    // tgt.id) → EVERY covered player's on-attacked reactives wake (enemy
                                    // counters land back on it / Second Wind etc.), not just the anchor.
                                    // The gate broadens from "anchor was hit" to "any victim was hit": if
                                    // the anchor whiffs but a covered victim is hit, emission fires for the
                                    // covered victim and no isPrimaryTarget event fires that turn — correct.
                                    // SP-U U2: DEFERRED here (not inside the shared helper) because the enemy
                                    // emits AFTER its non-positional damage-taken-leech tail; enemyAttackedSignals
                                    // is the helper's returned per-victim signals (set whenever enemyPositional).
                                    // PR2 Task 3 — the remainder of the interleaved sequence the
                                    // helper handed back: sub-attack 0's `attacked`, then each
                                    // later sub-attack's `ability-performed` immediately followed
                                    // by its own `attacked`. With N=1 this is exactly the single
                                    // per-victim fan-out that stood here before.
                                    enemyEmitDeferred?.();
                                } else {
                                    // LEGACY non-positional single emit — byte-identical to pre-Task-4.
                                    const shieldWasHit = positionalShieldCaptured
                                        ? positionalShieldWasHit
                                        : !barriered &&
                                          !converted &&
                                          shieldBefore > 0 &&
                                          hpDamage < damage;
                                    emitAttacked({
                                        bus,
                                        round: r,
                                        targetId: tgt.id,
                                        attackerId: actor.id,
                                        hitOutcomes,
                                        isPrimaryTarget: true,
                                        shieldWasHit,
                                        damage,
                                    });
                                }
                            }
                            // SP-4b-2 D6, task-18 finding 3: the firing hit contributed nothing to
                            // the aggregate, so the block above never ran — the passive-slot
                            // instance is not the firing hit's rider and lands anyway. A no-op when
                            // it already landed after the firing hit (the once-guard), and when the
                            // turn staged nothing. Placed BEFORE the deferred-application flush, the
                            // same order the two player-side sites have.
                            landEnemyPassiveSlotHitOnce();
                            // Clause order — mirror of the two player-side sites. Placed OUTSIDE the
                            // `damage > 0 && tgt !== undefined` block above: a cast that inflicts a
                            // debuff but deals no damage (a pure Stasis bot) still has to apply it,
                            // and inside that guard the landings were silently dropped.
                            flushDeferredEnemyApplications(enemyDeferredApplications);
                            // Same seam as both player sites: a deferred cast repair/shield resolves now
                            // that the damage it scales off exists. `enemyCritAgg` is this turn's per-victim
                            // aggregate (undefined when no positional apply ran), so the fallback degrades
                            // to the pre-funnel basis rather than dropping the repair.
                            enemyResolveCastSupport?.(
                                enemyCritAgg
                                    ? enemyCritAgg.subAttacks.reduce(
                                          (sum, sub) => sum + (sub.deliveredDamage ?? 0),
                                          0
                                      )
                                    : enemyDirectDamage
                            );
                            // Task 5 (per-victim crit signal): a positional enemy turn that dealt 0
                            // damage skips the `if (damage > 0)` apply block entirely — so no per-victim
                            // apply ran (enemyCritAgg undefined) and the deferred ability-performed was
                            // never emitted above. Emit it here with the anchor-based FALLBACK crit values
                            // (didCrit/critHits carried on the deferred payload), byte-identical to the
                            // pre-Task-5 inline emit for this 0-damage edge case. Only reachable when the
                            // enemy is positional (deferred payload present) AND the apply was skipped.
                            // R5(i) — why this sibling fallback does NOT also pass `deliveredDamage: 0`,
                            // though the player-side one at the interleaved emit now must.
                            // There the omission was live: that branch is reached by a WHIFF, whose
                            // `dap.damage` (pre-funnel `directDamage`) is positive, so the
                            // `on-deal-damage` guard's `(deliveredDamage ?? damage)` chain fell through
                            // to it and paid out riders for a cast that struck nobody.
                            // Here it cannot be: this branch is gated on the apply block having been
                            // skipped, and `damage = directDamage + detonationDamage` — both
                            // non-negative — so reaching it with a positive `dap.damage` would need
                            // the skip to have fired on a positive total. Verified rather than
                            // reasoned: a temporary `throw` on `dap.damage > 0` here ran the FULL
                            // suite (488 files / 5566 tests) without firing once. `(0 ?? 0) <= 0`
                            // already silences the riders, so adding the field would change the
                            // event's SHAPE for no behavioural gain — and there is no failing test
                            // to justify it. If `directDamage` ever becomes positive on a skipped
                            // enemy apply, this becomes the enemy-side mirror of the player bug and
                            // wants the same `0`.
                            if (enemyDeferredAbilityPerformed && !enemyCritAgg) {
                                const dap = enemyDeferredAbilityPerformed;
                                emitDeferredAbilityPerformed(
                                    dap,
                                    dap.damage,
                                    dap.didCrit,
                                    dap.critHits ?? 0,
                                    []
                                );
                            }
                        } // end dead-after-burst guard (!burstDestroyedActor)
                    } else {
                        // §4.5 Deferred break: consume any pending Stasis break (real-enemy skip).
                        if (stasisBreakPending.has(actor.id)) {
                            stasisBreakPending.delete(actor.id);
                            for (const name of STASIS_BUFFS)
                                statusEngine.reduceTimedEnemyStatus(actor.id, name);
                        }
                    } // end stasis gate (real-enemy branch)
                }

                // Drain point (b): follow-ups triggered by this actor's turn body run as
                // "consecutive actions" within the turn — BEFORE the owner Post Turn, so any
                // status they apply obeys the same-turn decrement rule (the carrier's Post Turn
                // below decrements it). A triggered effect therefore never boosts the hit that
                // triggered it (the hit's damage was already computed in the turn body).
                drainIntentsFor('player');
                drainIntentsFor('enemy');

                // Post Turn (combat-system.md section 4): the status CARRIER decrements ALL its
                // timed statuses by one turn — both its self-buff store and the debuff store of
                // effects landed ON it. (Side-agnostic: PR4 unification of the former 4-branch
                // player/enemy/heal-target split.) Empty stores are a safe no-op.
                //
                for (const buffName of statusEngine.decrementPlayer(actor.id).expired) {
                    bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                }
                // debuffs landed on this actor — closes the decrement gap: every acting actor
                // decrements its own debuff store. Reachable today for a non-heal-target team
                // actor an enemy debuffs in positional mode (decrementUnification Case 5); the
                // player→enemy-attacker variant is fixed by this same line but stays latent (no
                // firing site threads a player→enemy targetId yet — a future per-victim-accounting
                // PR lights it up).
                // SP-4c-2d: this used to be a ternary whose true arm decremented the side-wide
                // '__enemy__' sentinel store on the dummy's own turn (`isDummyEnemy`). SP-4c-2c
                // retired that turn, making the arm dead, and this rung deleted the actor — so
                // every acting actor keys its own per-actor debuff store, unconditionally. The
                // side-wide bucket's sole decrement is the round-tail one below.
                for (const buffName of statusEngine.decrementEnemy(actor.id).expired) {
                    bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                }

                bus.emit({ type: 'turn-ended', actorId: actor.id, round: r });
                // Drain intents enqueued by end-of-turn triggers before the next actor acts.
                drainIntentsFor('player');
                drainIntentsFor('enemy');

                // SP-4c-1: AFTER the turn ends (including its drains, so an on-death reactive
                // that revives or kills still counts), check for a wipe. Breaking HERE — rather
                // than at the round boundary — is what makes termination turn-granular: the
                // remaining actors in this round's order do not act. The round's row is still
                // assembled and pushed below from the partial round, so the wiping turn's damage
                // IS reported. The enclosing `finally` resets `inTurnLoop` on this break, exactly
                // as its own comment anticipated ("a future early exit added to the round loop can
                // no longer leave inTurnLoop stuck true").
                if (sideIsWiped()) {
                    matchOver = true;
                    break;
                }
            }
        } finally {
            // The turn loop is closed: no live queue remains. The reset lives in `finally` so it
            // is structurally guaranteed on ANY loop exit (normal, break, return, throw) — a future
            // early exit added to the round loop can no longer leave `inTurnLoop` stuck true and
            // mis-dispatch a round-tail drain as Path A. Any extra-action grant from here on — the
            // only drain left below is the `round-ended` one at the round tail, the dedicated
            // post-round enemy-death drain having gone with the dummy in SP-4c-2d — sees
            // inTurnLoop=false → Path B (buffered for next round).
            inTurnLoop = false;
            // Same rationale for combat-log attribution: the post-round death-drain and round-ended
            // reactives that follow are turn-less, so clear actingActorId here. Otherwise their
            // reactive emissions would stamp duringTurnOf with the round's last acting actor and
            // buildCombatLog would nest them under that actor's turn instead of the endOfRound group.
            actingActorId = undefined;
            // Cleared with it (see `actingTurnCtx`). Behaviourally a no-op at this point — the last
            // actor's ctx is already in `lastTurnCtxByActor`, and it is the SAME object — but the two
            // are kept in lockstep so no future reader has to know that.
            actingTurnCtx = undefined;
        }

        // SP-4b-2 D5: decrement the GLOBAL enemy-debuff sentinel bucket once per round.
        //
        // A SCHEDULED (input-level `enemyDebuffs`) debuff is always upserted into the
        // side-wide `DEFAULT_ENEMY_TARGET` ('__enemy__') store — `upsertBuff` hardcodes that
        // target — never into a per-actor store. HISTORY of why this statement exists: the bucket's
        // only decrement used to be a no-argument `decrementEnemy()` overload in the Post-Turn
        // block above, reachable ONLY on the dummy actor's own turn. Under the since-retired
        // `dummyEnemyIsVestigial` gate a fully-positional run dropped the dummy from the turn
        // order, so that call never ran and a timed scheduled debuff, once landed, persisted for
        // the rest of the run. Measured against 841e1bc0 on the same fixture and seed: `hasDebuff`
        // per round was [t,t,f,t,t] and became [t,t,t,t,t]; the landing DRAW was unaffected, only
        // the DECAY. Both that overload's call site and the dummy are gone (SP-4c-2c/2d).
        //
        // ONCE-PER-ROUND, guaranteed structurally: this statement sits in the ROUND loop body,
        // outside the turn loop, so it runs exactly once per round iteration regardless of how
        // many enemy actors are on the board. Hooking it to an enemy actor's Post-Turn instead
        // would fire once per enemy and burn a 2-round debuff in a single round on a 2-enemy board.
        //
        // THE SOLE DECREMENT of the side-wide bucket, on every round of every run. It cannot
        // double-fire with the dummy's own Post-Turn call, and since SP-4c-2d the reason is that
        // there is no dummy: SP-4c-2c had already dropped it from every turn order (making its
        // Post-Turn `decrementEnemy()` unreachable) and this rung deleted the actor and that
        // no-argument call site outright. (It used to be conditional on the retired
        // `dummyEnemyIsVestigial` — the two switches had to land together for exactly this reason:
        // dropping the turn while leaving the gate false here would have decremented the bucket
        // nowhere at all.)
        //
        // POSITION: the earliest round boundary after the turn loop. The row's
        // `activeEnemyDebuffs` is a snapshot taken during the focus attacker's TURN
        // (`lastAttackerTurn.landedEnemyDebuffs`), so this decrement lands after that read — the
        // same ordering the dummy's Post-Turn produced back when it acted after the attacker.
        //
        // WHAT THE MOVE OFF THE DUMMY'S POST-TURN ACTUALLY CHANGED, stated precisely because it is
        // easy to overclaim: it is a VALUE-LEVEL NO-OP. Measured across the SP-4c-2c switch on the
        // same fixture and seed — same round, same `actorId`, same expiry count, same
        // `activeEnemyDebuffs` row schedule. The ONLY observable difference is the `buff-expired`
        // emission's POSITION in the ordered event stream: it used to sit mid-walk (right after the
        // dummy's own turn) and now lands after every `turn-started` of its round. Do not describe
        // this as a change in how long a scheduled debuff lasts. `retiredDummyTurn.test.ts`'s second
        // case pins exactly that split — value assertions as the forward regression pin, and the
        // stream-order assertion as the only half that witnesses this rung.
        //
        // actorId on `buff-expired`: `SENTINEL_ENEMY_ACTOR_ID`, whose value is the literal `'enemy'`.
        // The bucket is a SIDE-WIDE store with no single carrier, so attributing its expiry to one
        // positioned enemy would be the same lie `finalHpPct` told when it silently described only
        // `enemyAttackers[0]`. That string is the id this identical bucket emitted under from the
        // dummy's own Post-Turn before SP-4c-2c retired that turn, and SP-4c-2d re-keyed the emit
        // to the CONSTANT rather than changing the value — so the deletion of the actor leaves this
        // event byte-identical, and the id now denotes a BUCKET rather than claiming an actor.
        // IDENTITY only — on a differential fixture the emission's POSITION in the stream DID move
        // at 4c-2c (see the paragraph above); this is NOT a claim that the stream is otherwise
        // unchanged. `buff-expired` has no reactive listeners — it is log-only.
        for (const buffName of statusEngine.decrementEnemy().expired) {
            bus.emit({
                type: 'buff-expired',
                actorId: SENTINEL_ENEMY_ACTOR_ID,
                round: r,
                buffName,
            });
        }

        // The row's attacker fields come from the LAST focus turn this round. Rounds
        // always have exactly one focus turn today (the attacker is in every queue),
        // so this reproduces the old definite-assignment provenance. The throw replaces
        // the implicit definite-assignment crash with an explicit one naming the Phase-3+
        // seam: reactive triggers may APPEND extra focus turns (read the last), but a
        // round with ZERO focus turns is impossible while the focus actor is always queued.
        if (!focusTurns.length) {
            // The focus attacker DIED before acting this round. Reachable since the DPS calculator
            // gained a real, positioned enemy that attacks back: a faster enemy can kill a fragile
            // attacker before its first turn, so "zero focus turns" is no longer impossible — the
            // original invariant below held only while the focus was effectively immortal.
            //
            // Synthesize a zero-damage skip turn rather than breaking out here. Breaking BEFORE the
            // row was assembled discarded the round's per-round maps (`roundDamage`,
            // `roundPerTargetDealt`, `roundPerTargetDamage`), so a TEAM actor that acted earlier in
            // this same round — faster than the enemy, which was faster than the dying attacker —
            // had its damage silently dropped from `cumulativeDamage`, `rawTotals` and
            // `perTargetDealt`, even though it had already reduced the enemy's real HP. The
            // synthesized turn supplies the row's attacker provenance so post-round assembly still
            // runs and credits that damage; the run then terminates just after the row is pushed
            // (see the focus-death exit beside the enemy-death one below), mirroring how the
            // enemy-death path ends AT the kill round rather than before it.
            //
            // SP-4c-1 adds a SECOND way to reach zero focus turns, on a LIVING focus: the match
            // ended earlier in this round's turn walk (a team actor or an enemy landed the kill
            // that wiped a side before the focus's turn came up). The remedy is identical and for
            // the identical reason — the round's per-round maps still hold the earlier actors'
            // damage, and breaking out before assembly would discard it — so the same synthesized
            // skip turn supplies the row's provenance. Without this the round-assembly guard below
            // throws on a living focus, which is what it is there to catch.
            if (attacker.destroyedRound !== undefined || matchOver) pushSynthesizedFocusSkipTurn();
        }
        if (!focusTurns.length) {
            // Still genuinely impossible: a LIVING focus actor is always queued.
            throw new Error(
                `combat round ${r} produced no focus actor turn (Phase-3+ seam: extra turns append, zero turns impossible while the focus actor is alive and always queued)`
            );
        }
        const lastAttackerTurn = focusTurns[focusTurns.length - 1];
        const action = lastAttackerTurn.action;
        const roundCrit = lastAttackerTurn.roundCrit;
        // #341: the row's enemy-HP reading, snapshotted at this round's HEAD (see
        // `enteringEnemyHpPct`). Every row answers with the SAME expression, including the two that
        // used to need a fabricated stand-in.
        const enemyHpPct = enteringEnemyHpPct;
        const dotsConfig = lastAttackerTurn.dotsConfig;
        const dotsLanded = lastAttackerTurn.dotsLanded;
        // Display-only: hide a spent Cheat Death (the focus actor owns activeSelfBuffs).
        const activeSelfBuffsForRound = hideSpentCheatDeath(
            lastAttackerTurn.activeSelfBuffs,
            focusActorId,
            r
        );
        const landedEnemyDebuffs = lastAttackerTurn.landedEnemyDebuffs;
        const resistedEnemyDebuffs = lastAttackerTurn.resistedEnemyDebuffs;

        // --- Post-round assembly: derive row fields from the FOCUS entry, total the
        // round's damage, update cumulative totals, and push the RoundData row. Only the attacker
        // entry exists today — semantically identical to the old scalar locals.
        const focus = dmg(focusActorId);
        // Row fields sourced from the focus entry. secondary/conditional go only to
        // rawTotals (RoundData has no sub-bucket columns) so they're read inline below.
        // `directDamage`/`totalRoundDamage` were `let` for the post-drain re-fold, which SP-4c-2d
        // deleted with the dummy (it was roster-emptiness-gated) — they are `const` now.
        const directDamage = focus.direct;
        const focusDot = perActorDot.get(focusActorId);
        const corrosionDamage = focus.corrosion + (focusDot?.corrosion ?? 0);
        const infernoDamage = focus.inferno + (focusDot?.inferno ?? 0);
        // SP-E: mirrors corrosionDamage/infernoDamage. Always 0 today (generic DoTs are never
        // auto-applied from skill text in this task) — real once E2/E3/E4 populate genericDoTEntries.
        const genericDamage = focus.generic + (focusDot?.generic ?? 0);
        const focusPositionalDetonation = perActorDetonation.get(focusActorId) ?? 0;
        const detonationDamage = focus.detonation + focusPositionalDetonation;

        // Aggregate dot-detonated fires ONLY for the non-positional aggregate path; positional
        // detonation already emitted per-victim bomb-detonated/dot-detonated in the apply loop.
        //
        // SP-4c-2d: `targetId` was the dummy sink's id and is now `SENTINEL_ENEMY_ACTOR_ID` — the
        // same string, so the event is byte-identical. It stays the sentinel rather than naming a
        // positioned enemy because this event describes the AGGREGATE scalar channel, which has no
        // per-victim identity; naming `enemyAttackers[0]` would invent one. Corpus-inert today: a
        // `console.error` here over the whole suite hit ZERO times in 535 files, because
        // `focus.detonation` is only credited on the non-positional cast path.
        if (focus.detonation > 0) {
            bus.emit({
                type: 'dot-detonated',
                targetId: SENTINEL_ENEMY_ACTOR_ID,
                round: r,
                damage: focus.detonation,
            });
        }

        // Deliberately uses focus.corrosion/focus.inferno/focus.generic ONLY (not the
        // perActorDot-folded corrosionDamage/infernoDamage/genericDamage locals) — per-victim DoT
        // ticks land via applyVictimDamage. SP-4c-2d: the old justification was the round-tail dummy
        // HP overwrite (`enemy.currentHp = enemyHp - cumulative…`), which this fold would have
        // drained a second time for a tick that had already reduced a real victim. That overwrite is
        // gone; what remains is the TWO-CHANNEL accounting rule it was a symptom of. A per-victim
        // amount books on the per-victim maps (roundPerTargetDamage / perTargetDealt — what
        // dpsSimulator reads), and `cumulativeDamage` is the separate FOCUS-only scalar aggregate;
        // each amount belongs to exactly ONE of the two. Folding per-victim ticks in here would
        // inflate `rawTotals.cumulative` and depress every drain-time `enemyHpPct` gate (whose
        // denominator is this same cumulative) for damage that is already counted elsewhere. Same
        // guard as the focusPositionalDetonation/detonation comment below.
        const totalRoundDamage =
            focus.direct + focus.corrosion + focus.inferno + focus.detonation + focus.generic;
        cumulativeDamage += totalRoundDamage;
        // Row/summary rawTotals stay FOCUS-only — only the focus actor reaches summary DPS
        // and the damage-type breakdown (config comparison stays meaningful).
        totalDirectRaw += focus.direct;
        totalSecondaryRaw += focus.secondary;
        totalConditionalRaw += focus.conditional;
        totalCorrosionRaw += corrosionDamage;
        totalInfernoRaw += infernoDamage;
        totalGenericRaw += genericDamage;
        // Summary detonation reflects per-victim positional detonation too (focusPositionalDetonation
        // is 0 non-positionally → byte-identical). NOTE: cumulativeDamage/totalRoundDamage above
        // deliberately use focus.detonation ONLY — per-victim detonation lands via applyVictimDamage
        // and is therefore already booked on the per-victim maps, so folding it into cumulativeDamage
        // would count the same damage on both channels (see the two-channel note above).
        totalDetonationRaw += detonationDamage;

        // Team damage = Σ over all NON-focus actor entries of every channel (direct already
        // includes its secondary/conditional sub-buckets, so they are NOT added separately). It is
        // NOT the real roster's HP delta: every per-victim amount (positional casts, reactive
        // procs, per-victim DoT and detonation ticks) books on the per-victim maps instead, per the
        // two-channel rule above. SP-4d deleted the `cumulativeTeamDamage` scalar that used to
        // accumulate this alongside `cumulativeDamage` for the focus-skip enemy-HP% denominator
        // (pushSynthesizedFocusSkipTurn) — that was its only reader, and #341 replaced that
        // derivation entirely: the row now reads the enemy roster at the round head
        // (`enteringEnemyHpPct`), so neither the scalar nor the display constant that briefly
        // stood in for it exists any more. `totalTeamRaw` below is the real (and only remaining)
        // team-damage accumulator, surfaced on the result as `teamTotal`.
        //
        // ⚠️ This scalar fold is INCOMPLETE for a walked team actor that resolved positionally: its
        // credit lands in `perTargetDealt` and never reaches here (#331). It is not the DPS-facing
        // number — `simulateDPS` re-derives `RoundData.teamDamage`/`teamTotalDamage` from
        // `perTargetDealt` for exactly that reason (SP-4b-1), and the fallback to this scalar is
        // taken only when there are no walked team actors at all, where it is 0 either way.
        let teamRoundDamage = 0;
        for (const [id, d] of roundDamage) {
            if (id === focusActorId) continue;
            teamRoundDamage += d.direct + d.corrosion + d.inferno + d.detonation + d.generic;
        }
        totalTeamRaw += teamRoundDamage;

        // SP-4c-2d DELETED THE ROUND-TAIL ENEMY-HP BLOCK. It had two arms and both went:
        //
        //  • the `dpsEnemyTarget` arm landed the round's dealt damage (focus + team) on the dummy
        //    through the shared per-victim funnel, so it could actually DIE and end the run
        //    (rounds-to-kill), with a Path-B `on-enemy-destroyed` drain behind the kill. That arm
        //    was already unreachable: SP-4b-2b's boundary throws on an absent/empty roster, so the
        //    discriminator was constant false. Real positioned enemies take their damage during the
        //    turn walk instead, and their deaths are Path A.
        //  • the `else` arm was the VESTIGIAL SINK's scalar decline —
        //    `enemy.currentHp = max(0, enemyHp - (cumulativeDamage + cumulativeTeamDamage))` plus a
        //    coarse INTEGER `hp-changed` tap on the dummy's id. Nothing read that HP except the
        //    synthesized focus-skip turn's `enemyHpPct` (which now derives the same number from
        //    `cumulativeDamage` directly — see `pushSynthesizedFocusSkipTurn`) and the deleted
        //    `enemyOutcome`. The `hp-changed` emit was measured inert before removal: a
        //    `console.error` on it over the whole suite hit ZERO times in 535 files, because
        //    `enemyHp` is a huge sink and the integer percentage never actually changed.
        //
        // A test-only credit counter used to sit in the `else` arm, counting rounds in which damage
        // was BOOKED against the sink; SP-4c-2c deleted it after measuring 0 hits across the suite
        // (a zero nothing can falsify is not evidence). Its identifier is deliberately not repeated
        // anywhere in this file. `cumulativeDamage` survives — it is the report's scalar damage
        // total, not the dummy's HP ledger. `cumulativeTeamDamage` did not: SP-4d deleted it once
        // its only reader (this block's old enemy-HP% denominator) was gone.

        // Toxic Overflow end-of-round Corrosion spread (ship-kit W3, Task 9, ledger #49). Game rule
        // (constants/buffs.ts): "At the end of the round if a unit has Toxic Overflow and at least 1
        // stack of Corrosion, inflict Corrosion I for 3 turns to all adjacent allies and remove
        // Toxic Overflow." Runs BEFORE the round-ended emit/drain below so each `corrosion-spread`
        // event's enqueued reactions (Hemlock's self-heal, on-corrosion-spread) are flushed by the
        // same drainIntentsFor calls. Team-symmetric: iterates every living actor. (It used to skip
        // the DPS dummy explicitly — `holder.id === enemy.id` — because that actor held no
        // per-victim debuffs; SP-4c-2d deleted the actor, so `allActors` holds only real ships and
        // the skip went with it.) The holder's Toxic Overflow is
        // read out of the per-victim TIMED enemy-debuff store ONLY, via `holdsToxicOverflow` — see
        // the guard below for why that channel and not the broad name union; Corrosion lives on the
        // actor's corrosionEntries. adjacentAllyIdsFor resolves the holder's SAME-SIDE adjacent
        // allies (board-neighbours positionally, all same-side allies otherwise).
        // Snapshot the qualifying spreaders BEFORE applying any spread. Applying spreads inline
        // while iterating would let an EARLIER holder's spread deposit a Corrosion stack on a
        // LATER holder, which — read live via totalStacks below — would then chain-spread that same
        // round off a stack it only just received. That is order-dependent (it hinges on allActors
        // ordering) and breaks combat symmetry/determinism. Collecting the holders that pass every
        // guard against the fixed round-end state first, then applying from that snapshot, makes the
        // spread order-independent: a holder spreads this round only if it already carried Corrosion
        // when the round ended (a stack received THIS round spreads only the FOLLOWING round).
        const toxicSpreaders: CombatActor[] = [];
        for (const holder of allActors) {
            if (holder.destroyedRound !== undefined) continue;
            // TIMED per-victim channel only — deliberately NOT `ownerDebuffNames`, the broad
            // three-channel name union. Toxic Overflow is a CONSUMABLE ("...and remove Toxic
            // Overflow"), and the `removeTimedEnemyStatus` call below reaches only this channel, so
            // reading any wider set would spread every round forever instead of once: the status is
            // selectable in the calculator's debuff picker, which emits no turn count, and an
            // always-active scheduled debuff is injected into EVERY target's snapshot with no
            // per-victim entry to delete. Inert is the faithful rendering of a one-shot the manual
            // model cannot spend (same narrowing as hitMitigation.ts / exposedStatus.ts).
            // `holdsToxicOverflow` also surfaces the ability-sourced PERSISTENT-stacking store, which
            // the removal cannot reach either — unreachable for this status, since that routing is
            // gated solely on `PERSISTENT_STACKING_BUFFS.has(name)` and Toxic Overflow is not a
            // member (constants/persistentStackingBuffs.ts), so it is harmless rather than a second
            // unspendable door. Hemlock's real charged application lands in the timed store,
            // non-expiring, by construction — see constants/toxicOverflow.ts.
            if (!holdsToxicOverflow(statusEngine, holder.id)) continue;
            if (totalStacks(holder.corrosionEntries) < 1) continue;
            toxicSpreaders.push(holder);
        }
        for (const holder of toxicSpreaders) {
            const affectedIds = bySide(
                isEnemySide(holder.id) ? 'enemy' : 'player'
            ).adjacentAllyIdsFor(holder.id);
            // Inflict Corrosion I (SPREAD_CORROSION_TIER, SPREAD_CORROSION_DURATION turns) on each
            // adjacent ally. Attributed to the holder (a live, resolvable applier so the tick is
            // counted — see tickDoTs's corrosion applier-ctx rule). New independent stack (DoTs of
            // the same family stack), mirroring applyNewDoTs's corrosion entry shape.
            for (const allyId of affectedIds) {
                const ally = allActorsById.get(allyId);
                if (!ally) continue;
                ally.corrosionEntries.push({
                    stacks: 1,
                    tier: SPREAD_CORROSION_TIER,
                    remainingRounds: SPREAD_CORROSION_DURATION,
                    sourceId: holder.id,
                });
            }
            // Remove Toxic Overflow from the holder (targeted single-family removal — preserves any
            // co-applied debuffs on the same victim). It landed as a timed enemy debuff (Hemlock's
            // charged), so it lives in the per-victim enemy store keyed by the holder's id.
            statusEngine.removeTimedEnemyStatus(holder.id, TOXIC_OVERFLOW);
            bus.emit({ type: 'corrosion-spread', sourceId: holder.id, affectedIds, round: r });
        }

        // round-ended (C2b-2): end-of-round reactive purge (Rhodium). Emitted at the round TAIL,
        // after every turn and its per-turn drain — so the purge sees post-death state — and before
        // roundData assembly. (It used to be described as sitting after "the post-round death
        // drain"; that dedicated drain served the dummy's post-round HP write and went with the
        // actor in SP-4c-2d. This is now the LAST drain of the round, and the only one after the
        // turn loop.) Drain BOTH queues (player + enemy), mirroring the round-started emit+drain.
        // Drains the single-target reactive executor (most-buffs) — single-target by design, out of E3 scope.
        bus.emit({ type: 'round-ended', round: r });
        drainIntentsFor('player');
        drainIntentsFor('enemy');

        // LOG-ONLY per-actor status snapshot (see the events.ts doc). Emitted at the round TAIL —
        // after every turn, the round-ended reactives AND their drains — so it reports the statuses
        // that genuinely survive into the next round. Team-symmetric: one emit per actor in
        // `allActors`, both sides. Note that the side-wide SCHEDULED enemy-debuff bucket is keyed
        // under the sentinel store (`DEFAULT_ENEMY_TARGET`), not under any actor id, so it never
        // shows up in these per-actor lists — this loop reports only per-actor stores, and since
        // SP-4c-2d there is no dummy actor for the bucket to be attributed to either.
        for (const a of allActors) {
            // Reuses the engine's established three-source name reads (scheduled snapshot +
            // payload-carrying timed + aura/accum ability statuses) rather than a bespoke store
            // walk, so the chips agree with every other live name-gate in this file.
            // `enemyDebuffNamesForTarget` already folds the DoT/bomb families from the actor's own
            // entry containers using the same synthesized base names the assembler labels with
            // (Corrosion / Inferno / Bomb / Damage over Time).
            bus.emit({
                type: 'status-snapshot',
                actorId: a.id,
                round: r,
                buffNames: selfBuffNamesForOwners(statusEngine, [a.id]),
                debuffNames: enemyDebuffNamesForTarget(a),
            });
            // #372: the same tail instant, for the same reason — the Simulator must REPORT HP,
            // not re-derive it. Every actor in `allActors` is read the same way, so this is
            // team-symmetric by construction.
            //
            // #375 ADDED THE REPAIR HALF. `healingReceived` used to accumulate from events, which
            // reaches only the channels that emit one (`heal-performed`, cast-only; `hot-ticked`) —
            // so a ship kept alive all fight by a leech reported 0. This reads the engine's own
            // per-recipient healing axis instead, which every repair channel credits.
            //
            // The axis could not be read here before: its two `healEventOnly` credit arms in
            // `playerTurn.ts` were missing, so it was empty for every enemy and substituting it
            // regressed the enemy rows from correct to 0. #375 lifted both arms first
            // (`recipientAxisTeamSymmetry.test.ts` pins the lift on both sides).
            //
            // GROSS — `directHeal + hotHeal`, pre-overheal-clipping — because that is the contract
            // this axis has always been held to; see the `hp-snapshot` doc in events.ts. OMITTED
            // rather than zeroed when per-recipient accounting is off, so the assembler can tell
            // "not measured" from "measured, none landed".
            //
            // #383 ADDED THE SOURCE HALF (`repairPerformed`) beside it, for the third surface of
            // the same defect: `healingDone` summed `heal-performed.casterId`, so a leecher
            // reported 0 done next to its 800 received. Read off `currentRoundSourceRepair`, the
            // side-agnostic sibling of `perActor` — see the `hp-snapshot` doc in events.ts for why
            // a sibling and not a widening, and for why a HoT tick is deliberately not on it.
            const roundRepair = currentRoundRecipientHealing.get(a.id);
            const roundPerformed = currentRoundSourceRepair.get(a.id);
            bus.emit({
                type: 'hp-snapshot',
                actorId: a.id,
                round: r,
                currentHp: a.currentHp,
                maxHp: recipientMaxHp(a.id),
                shieldPool: a.shieldPool,
                ...(healingCtx?.perRecipientApply
                    ? {
                          repairReceived: roundRepair
                              ? roundRepair.directHeal + roundRepair.hotHeal
                              : 0,
                          repairPerformed: roundPerformed ?? 0,
                      }
                    : {}),
            });
        }

        // SP-4c-2d DELETED THE POST-DRAIN RE-FOLD. It was gated on `dpsEnemyTarget` (roster
        // emptiness), so it had been unreachable since SP-4b-2b's boundary started refusing an
        // absent/empty roster. What it did: end-of-round reactive-damage procs (Rhodium's
        // most-buffed-enemy purge, Incinerator's enemy-debuff AoE) credit into `roundDamage` DURING
        // the `round-ended` drain above — i.e. AFTER this round's scalar snapshot was folded into
        // the persistent accumulators — so on a roster-less run those credits were re-read here,
        // the delta folded into the row and the accumulators, and the same delta landed on the
        // dummy's HP to keep `totalRoundDamage + teamRoundDamage == enemy-HP delta`.
        //
        // Nothing is lost for a real roster, and the reason is worth keeping: a POSITIONAL reactive
        // routes through `applyVictimDamage` and the per-victim maps (serialized into RoundData
        // AFTER this drain), not through `roundDamage`, so the delta this block computed was 0 there
        // anyway. Healing mode was excluded for a different reason — a reactive DOES credit
        // `roundDamage` there, but the healing adapter reads none of the damage scalars, and folding
        // them would have perturbed the dummy's next-round HP decline.

        // Report stacks after expiry (state going into next round)
        roundData.push({
            round: r,
            action,
            // END-OF-ROUND charge state: with extra turns (extraTurns >= 1) the cadence
            // ran more than once this round, so this is NOT "charges going into the
            // turn that produced `action`" — it's the live counter after all turns.
            charges: Math.round(attacker.charges),
            chargeCount: hasChargedSkill ? chargeCount : 0,
            didCrit: roundCrit,
            enemyHpPct: Math.round(enemyHpPct),
            directDamage: Math.round(directDamage),
            corrosionDamage: Math.round(corrosionDamage),
            infernoDamage: Math.round(infernoDamage),
            detonationDamage: Math.round(detonationDamage),
            totalRoundDamage: Math.round(totalRoundDamage),
            cumulativeDamage: Math.round(cumulativeDamage),
            // genericDamage (SP-E): set ONLY when nonzero — generic DoTs are never auto-applied
            // from skill text in this task, so every existing round/golden keeps the field absent
            // (legacy RoundData shape preserved, byte-identical).
            ...(genericDamage > 0 ? { genericDamage: Math.round(genericDamage) } : {}),
            // teamDamage set ONLY when walked team actors exist (undefined preserves the
            // legacy/attacker-only RoundData shape — goldens stay byte-identical).
            ...(hasWalkedTeam ? { teamDamage: Math.round(teamRoundDamage) } : {}),
            // extraTurns set ONLY when ≥ 1 (undefined preserves legacy RoundData shape).
            ...(focusTurns.length > 1 ? { extraTurns: focusTurns.length - 1 } : {}),
            // perTargetDamage set ONLY when the positional path OR a #362 Reversed Repairs burn
            // (`bookReversalDamage`, the second writer — see its declaration above) recorded victim
            // damage this round (map non-empty). A round with neither leaves it absent → goldens
            // byte-identical.
            ...(roundPerTargetDamage.size > 0
                ? { perTargetDamage: Object.fromEntries(roundPerTargetDamage) }
                : {}),
            // perTargetDealt (SP-F F1): attacker id -> victim id -> dealt, mirroring EVERY
            // roundPerTargetDamage increment above to its correct source-attacker — EXCEPT an
            // applier-less #362 reversal, which writes perTargetDamage but has no attacker to
            // mirror to here (same documented exception as a redirected DoT-tick chunk with no
            // single attacker). Set ONLY when non-empty — mirrors perTargetDamage's "absent when
            // empty" rule, goldens byte-identical.
            ...(roundPerTargetDealt.size > 0
                ? {
                      perTargetDealt: Object.fromEntries(
                          [...roundPerTargetDealt].map(([attackerId, byVictim]) => [
                              attackerId,
                              Object.fromEntries(byVictim),
                          ])
                      ),
                  }
                : {}),
            // perActorSplash (bomb-splash-on-death): set ONLY when a dying bombed ally splashed
            // adjacent allies this round (map non-empty). Absent otherwise → byte-identical.
            ...(perActorSplash.size > 0
                ? { perActorSplash: Object.fromEntries(perActorSplash) }
                : {}),
            // perActorDetonation (per-victim skill-triggered detonation, positional): set ONLY when
            // the positional detonation loop dealt damage this round (map non-empty). Absent
            // otherwise → non-positional rounds keep the legacy RoundData shape, goldens byte-identical.
            ...(perActorDetonation.size > 0
                ? { perActorDetonation: Object.fromEntries(perActorDetonation) }
                : {}),
            // perActorShield (H1 Task 6): per-actor shield accounting for THIS round, set only
            // when at least one actor has a nonzero {granted, absorbed, pool}. Mirrors
            // perTargetDamage's "absent when empty" rule so legacy/no-shield rounds stay
            // byte-identical. granted = post-cap grant this round (perActorShieldGranted);
            // absorbed = shield drained by incoming this round (perActorIncoming.shieldAbsorbed,
            // a fresh per-round map like roundPerTargetDamage → already this-round, not cumulative);
            // pool = the actor's live remaining shieldPool at end-of-round assembly.
            ...(() => {
                const ids = new Set<string>([
                    ...perActorShieldGranted.keys(),
                    ...perActorIncoming.keys(),
                    ...allActors.filter((a) => a.shieldPool > 0).map((a) => a.id),
                ]);
                const perActorShield: Record<
                    string,
                    { granted: number; absorbed: number; pool: number }
                > = {};
                for (const id of ids) {
                    const granted = perActorShieldGranted.get(id) ?? 0;
                    const absorbed = perActorIncoming.get(id)?.shieldAbsorbed ?? 0;
                    const pool = allActorsById.get(id)?.shieldPool ?? 0;
                    if (granted === 0 && absorbed === 0 && pool === 0) continue;
                    perActorShield[id] = { granted, absorbed, pool };
                }
                return Object.keys(perActorShield).length > 0 ? { perActorShield } : {};
            })(),
            // perActorIncoming (PR7 Task 6): per-victim incoming-damage accounting for THIS round,
            // keyed by victim id ({incoming, shieldAbsorbed, barrierAbsorbed}). Mirrors
            // perActorShield's "absent when empty" rule — set ONLY when at least one victim has a
            // nonzero entry, so legacy / no-intake rounds keep the RoundData shape byte-identical
            // (perActorIncoming is a fresh per-round map, already this-round, not cumulative).
            ...(() => {
                const out: Record<
                    string,
                    {
                        incoming: number;
                        incomingRaw: number;
                        shieldAbsorbed: number;
                        barrierAbsorbed: number;
                        convertedToShield: number;
                    }
                > = {};
                for (const [id, v] of perActorIncoming) {
                    // #358 ADDENDUM 3: `incomingRaw` IS a term of this emptiness gate, and has to
                    // be. It used to be left out, on the argument that `incoming === 0` implies
                    // `incomingRaw === 0` because both axes are written by the same pair of calls
                    // at the single booking site. BOTH HALVES OF THAT ARGUMENT ARE NOW FALSE:
                    //   • Task 10 stopped scaling `damageRaw` by `(1 - blocked)` — a blocked hit
                    //     was thrown in full. A 100% incoming-block therefore books `incoming: 0`
                    //     with `incomingRaw > 0`, and it is reachable straight from the defense
                    //     calculator's own skill editor: `abilityDefaults.ts` defaults
                    //     `blockPct: 1` (a FULL block) — its `procChance` default is 0, so the
                    //     editor hands the user a full-magnitude block that fires only once they
                    //     set a chance on it. The default MAGNITUDE is 100%, not the default
                    //     CHANCE.
                    //   • Task 11 stopped reversing the raw axis on a DoT transform, so the two no
                    //     longer net to 0 together either.
                    // Without this term such a bucket is DROPPED from the emitted record, silently
                    // losing raw damage that really was thrown. Pinned in `rawIntakeAxis.test.ts`
                    // ("a fully blocked hit still reports on the raw axis").
                    if (
                        v.incoming === 0 &&
                        v.incomingRaw === 0 &&
                        v.shieldAbsorbed === 0 &&
                        v.barrierAbsorbed === 0 &&
                        v.convertedToShield === 0
                    )
                        continue;
                    out[id] = {
                        incoming: v.incoming,
                        incomingRaw: v.incomingRaw,
                        shieldAbsorbed: v.shieldAbsorbed,
                        barrierAbsorbed: v.barrierAbsorbed,
                        convertedToShield: v.convertedToShield,
                    };
                }
                return Object.keys(out).length > 0 ? { perActorIncoming: out } : {};
            })(),
            // perActorReflected (Reflect gear set, Task 5): per-attacker reflected-thorns damage
            // dealt back THIS round. Mirrors perActorShield's "absent when empty" rule so legacy /
            // no-reflect rounds stay byte-identical (perActorReflected is empty unless a Reflect
            // wearer took a direct hit this round).
            ...(perActorReflected.size > 0
                ? { perActorReflected: Object.fromEntries(perActorReflected) }
                : {}),
            // SP-4b-2 D3: the DoT-state fields describe every enemy-side carrier. Before SP-4c-2d
            // they also covered the dummy's own (never-written) containers, which is what made
            // `dotCarrierActors` REPORT a stack the dummy never ticked. See `dotCarrierActors`.
            //
            // CORPSES ARE EXCLUDED (task-14 finding 3) — `dotCarrierReports`, evaluated HERE so
            // each round sees the live death state. A killed positioned enemy never ticks again
            // and nothing clears its containers, so its stacks would otherwise be summed into
            // every remaining round while dealing nothing.
            //
            // MULTI-ENEMY AGGREGATION — deliberate choice: these three are COUNTS, so they SUM
            // across carriers ("how many stacks stand on the enemy side"). Stacks are an
            // EXTENSIVE quantity — they add — unlike `finalHpPct`, an INTENSIVE per-actor ratio
            // that had to become an HP-weighted remainder. Weighting a count would produce a
            // number that is neither the board total nor any one actor's real stack count.
            // Reporting only `enemyAttackers[0]` is the defect class this epic keeps hitting and
            // is explicitly rejected here.
            activeCorrosionStacks: dotCarrierActors
                .filter(dotCarrierReports)
                .reduce((sum, a) => sum + totalStacks(a.corrosionEntries), 0),
            activeInfernoStacks: dotCarrierActors
                .filter(dotCarrierReports)
                .reduce((sum, a) => sum + totalStacks(a.infernoEntries), 0),
            activeBombCount: dotCarrierActors
                .filter(dotCarrierReports)
                .reduce((sum, a) => sum + a.pendingBombs.length, 0),
            activeSelfBuffs: activeSelfBuffsForRound,
            activeEnemyDebuffs: landedEnemyDebuffs,
            resistedEnemyDebuffs,
            appliedDoTs: dotsConfig,
            dotsLanded,
            // SP-4b-2 D3: the UNION of every enemy-side carrier's standing DoT entries. A list is
            // the one shape where the lossless answer exists, so concatenation is the aggregation
            // — reporting one carrier's entries would silently hide the rest of the board's.
            // Grouping stays TYPE-MAJOR (all carriers' corrosion, then inferno, then bombs, then
            // generic), preserving both the single-carrier byte-identity and the type grouping the
            // `extend-dot` consumers filter on. Carrier order within a type is board order.
            activeDoTStates: [
                ...dotCarrierActors.filter(dotCarrierReports).flatMap((a) =>
                    a.corrosionEntries.map((e) => ({
                        type: 'corrosion' as const,
                        tier: e.tier,
                        stacks: e.stacks,
                        ticksRemaining: e.remainingRounds,
                    }))
                ),
                ...dotCarrierActors.filter(dotCarrierReports).flatMap((a) =>
                    a.infernoEntries.map((e) => ({
                        type: 'inferno' as const,
                        tier: e.tier,
                        stacks: e.stacks,
                        ticksRemaining: e.remainingRounds,
                    }))
                ),
                ...dotCarrierActors.filter(dotCarrierReports).flatMap((a) =>
                    a.pendingBombs.map((b) => ({
                        type: 'bomb' as const,
                        tier: b.tier,
                        stacks: b.stacks,
                        ticksRemaining: b.countdown,
                    }))
                ),
                // SP-E: generic DoTs are never auto-applied from skill text in this task, so this
                // is [] on every corpus run today — a no-op spread.
                ...dotCarrierActors.filter(dotCarrierReports).flatMap((a) =>
                    a.genericDoTEntries.map((e) => ({
                        type: 'generic' as const,
                        tier: e.tier,
                        stacks: e.stacks,
                        ticksRemaining: e.remainingRounds,
                    }))
                ),
            ],
        });

        // Healing mode: push this round's healing accounting. incomingDamage/shieldAbsorbed
        // are the per-round intake totals folded from this round's enemy attacker turns.
        // The destroyed-round seam is set the moment the target's HP first reaches 0 (in the
        // enemy attacker turn); this post-round guard is a backstop for any other 0-HP path.
        if (healTarget) {
            // PR5b: the heal target's intake totals are sourced from its per-actor bucket
            // (written by sink, PR5a). In the single-target path this is byte-identical to
            // the legacy per-round scalars this replaced (the heal target is the only recorded
            // victim); in positional AoE it is the correct per-victim share rather than the old
            // tank-sums-everything scalar. The replaced scalars were removed in this same change.
            const healTargetIntake = perActorIncoming.get(healTarget.id);
            healingRounds.push({
                perActor: currentRoundHealing,
                perRecipient: currentRoundRecipientHealing,
                targetHpPctStart,
                targetShieldStart,
                incomingDamage: healTargetIntake?.incoming ?? 0,
                incomingDamageRaw: healTargetIntake?.incomingRaw ?? 0,
                shieldAbsorbed: healTargetIntake?.shieldAbsorbed ?? 0,
                barrierAbsorbed: healTargetIntake?.barrierAbsorbed ?? 0,
                convertedToShield: healTargetIntake?.convertedToShield ?? 0,
                perActorIncoming,
                // Per-enemy effects: de-dupe each enemy's own self-buffs/debuffs by buffName
                // (keep the first occurrence so the UI shows each effect once per enemy per round),
                // preserving the order enemies first acted this round. Active enemy-applied DoTs on
                // the target are attributed by stack `sourceId` and merged in below — a DoT-only
                // enemy that produced no self-buffs/debuffs still gets an entry so its DoTs show.
                // mergeDoTsForDisplay combines the pre-tick snapshot with the live containers:
                // live entries (post-tick/newly-applied) take precedence; snapshot entries absent
                // from live (tick-and-expire case) are appended so the display panel always shows
                // DoTs that were active this round even if they expired before this call.
                // When the tank never acted (DPS mode or destroyed tank) the snapshot is empty
                // and mergeDoTsForDisplay returns the live containers unchanged.
                enemyEffects: buildEnemyRoundEffects(
                    roundEnemyEffects,
                    mergeDoTsForDisplay(tankDotSnapshot.corrosion, healTarget.corrosionEntries),
                    mergeDoTsForDisplay(tankDotSnapshot.inferno, healTarget.infernoEntries)
                ),
                // Display-only: hide a spent Cheat Death (the heal target owns these buffs).
                // The destroyed-tank branch already set this to [] (filtering [] is a no-op).
                healTargetBuffs: hideSpentCheatDeath(healTargetBuffs, healTarget.id, r),
            });
            // Post-round backstop (Task-1 OUTCOME B): captures ONLY the start-dead /
            // no-`recordDestroyed` path — a heal target that ENTERS a round already at
            // currentHp<=0 (e.g. seeded hp:0) takes no damage, so recordDestroyed never stamps
            // its destroyedRound. The `healTarget.destroyedRound === undefined` clause makes that
            // intent explicit (on any recordDestroyed path the field is already set). This must
            // NOT call recordDestroyed (would emit a spurious ship-destroyed the old code never
            // produced) nor stamp the actor field (would leak into the turn-skip dead-actor reader
            // and the combat-end readers, changing subsequent-round behavior). First such round
            // wins (`backstopDestroyedRound === undefined`), matching the old first-wins behavior.
            if (
                backstopDestroyedRound === undefined &&
                healTarget.destroyedRound === undefined &&
                healTarget.currentHp <= 0
            ) {
                backstopDestroyedRound = r;
            }
        }

        // SP-4c-2d: a THIRD exit used to sit beside these two — `if (dpsEnemyTarget &&
        // enemy.destroyedRound !== undefined) break;`, which ended the run on the round the dummy
        // died. It was gated on roster emptiness, so it had been unreachable since SP-4b-2b, and it
        // is gone with the actor. A real positioned enemy's death ends the run through the
        // side-wipe exit below instead (SP-4c-1), which is the honest signal.
        //
        // SP-4c-1: a side was wiped during this round's turn walk. The row is already pushed, so
        // the wiping round is reported in full and the run ends here. Placed with the other two
        // exits and independent of both: this one fires in EVERY mode, whereas the focus-death
        // exit below is DPS-only (two-team and healing runs legitimately continue past the focus's
        // death — twoTeamBattle.test.ts and healingGoldenParity both pin that).
        // Re-evaluated rather than reading the flag alone: the round-ended drain and the
        // post-round death drain both run AFTER the turn loop, so a side can be wiped between the
        // last turn and here. The row for this round is already pushed either way.
        if (matchOver || sideIsWiped()) break;
        // Focus-death exit, sibling of the enemy-death one above. The focus attacker can now be
        // killed (a real positioned enemy attacks back), and in a DPS-style run it never acts again —
        // there is nothing left to measure, so every later round would be an empty skip row.
        // Terminate here, AFTER this round's row is pushed, so the round it died in is reported
        // (including any team damage dealt earlier in that round) rather than discarded.
        //
        // MUST NOT fire in the other two modes, both of which legitimately continue past the focus's
        // death and both of which pin it:
        //  - two-team battle: the rest of the squad keeps fighting (`twoTeamBattle.test.ts` —
        //    "a supporter keeps granting its buff + shield in rounds AFTER the focus dies");
        //  - healing mode: the healer dying does not end the report (`healingGoldenParity` —
        //    "lethal pressure (target dies mid-run, flatline + post-death overheal)").
        // Only a DPS measurement run has nothing left to say once its one attacker is gone.
        if (isDpsMeasurementRun && attacker.destroyedRound !== undefined) break;
    }

    // The heal target's death round comes from its per-actor `destroyedRound` field (stamped by
    // recordDestroyed), falling back to the post-round backstop's start-dead capture for the
    // no-`recordDestroyed` path (Task-1 OUTCOME B). Computed unconditionally. #415: this used to
    // add "in non-healing mode healTarget is undefined → undefined" — `healTarget` is now anchored
    // in every mode, so in DPS mode this resolves the FOCUS's real death round. It is still never
    // read there, but for the other reason the sentence already gave: the healing shape below is
    // gated on `healReportActive`, which a DPS run leaves false.
    const healTargetDestroyedRound = healTarget?.destroyedRound ?? backstopDestroyedRound;

    // SP-4c-2d DELETED `enemyOutcome` (`survived` / `roundsToKill` / `finalHpPct`) and the
    // `enemyFinalHpPct` derivation behind it. All three read the DUMMY, so on every run with a real
    // roster they described a billion-HP sink that never died — `survived: true`,
    // `roundsToKill: undefined`, `finalHpPct: 100` — no matter what actually happened on the board.
    // It had NO production consumer after SP-4b-2a: `dpsSimulator` re-derives all three from its own
    // `ship-destroyed` bus tap, precisely because these fields could not describe a real target.
    // A caller that wants an enemy's outcome reads `ship-destroyed` (per-actor, per-round) or
    // `RoundData.perActorIncoming`.
    return {
        rounds: roundData,
        rawTotals: {
            direct: totalDirectRaw,
            corrosion: totalCorrosionRaw,
            inferno: totalInfernoRaw,
            detonation: totalDetonationRaw,
            cumulative: cumulativeDamage,
            totalSecondary: totalSecondaryRaw,
            totalConditional: totalConditionalRaw,
            teamTotal: totalTeamRaw,
            generic: totalGenericRaw,
        },
        // Additive — present whenever the heal REPORT is active (battle mode too; DPS callers
        // with no heal target see the legacy shape).
        ...(healReportActive
            ? {
                  healing: {
                      rounds: healingRounds,
                      ...(healTargetDestroyedRound !== undefined
                          ? { destroyedRound: healTargetDestroyedRound }
                          : {}),
                  },
              }
            : {}),
    };
}
