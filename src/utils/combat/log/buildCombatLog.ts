import { CombatEvent, CombatEventType } from '../events';
import { dotTierNumeral } from '../debuffImmunity';
import type { DoTType } from '../../../types/calculator';
import {
    CombatLogEntry,
    CombatLogEntryKind,
    CombatLogRound,
    CombatLogTarget,
    CombatLogTurn,
} from './types';

/** Combat-log note for a DoT apply/tick line: "{dotType} {numeral} ×{stacks}" (numeral omitted
 *  for bomb/generic and non-canonical magnitudes). e.g. ('corrosion', 9, 3) → "corrosion III ×3";
 *  ('bomb', 200, 1) → "bomb ×1". */
const dotNote = (dotType: DoTType, tier: number | undefined, stacks: number): string => {
    const numeral = tier === undefined ? '' : dotTierNumeral(dotType, tier);
    return `${dotType}${numeral ? ` ${numeral}` : ''} ×${stacks}`;
};

/**
 * Display rank for a turn's top-level entries — what the SKILL did, then the charge bookkeeping,
 * then everything that FOLLOWED from the skill.
 *
 * Why a display sort rather than reordering the engine's emissions: the log renders events in
 * emission order, and for a POSITIONAL cast the engine deliberately defers its
 * `ability-performed` until AFTER the per-victim apply (engine.ts `emitDeferredAbilityPerformed`),
 * so it can report the TRUE per-victim crit outcome instead of the anchor-only guess. (Since the
 * multi-hit full-walk epic, PR2, there is one such event per SUB-ATTACK rather than one per cast —
 * a `hits: N` skill produces N attack rows, all carrying the same sticky skill tag. The deferral,
 * and therefore this sort, is unchanged.) That is why the attack line landed last, under its own
 * consequences:
 *
 *     Butcher: charge 0→1
 *     Butcher → Enemy Heliodor: Inferno II resisted
 *     Enemy Heliodor: destroyed by Butcher          <- killed by an attack not yet printed
 *     Butcher [active] → Enemy Heliodor: 64,450     <- the attack
 *
 * The emission order is load-bearing (reaction nesting keys off the most-recent non-reactive entry,
 * and the reflect-log flush is sequenced against the attack entry), so it stays as-is and the
 * ordering is corrected at the presentation layer instead.
 *
 * Sorting top-level entries is safe AFTER the fold: reactions already live inside their trigger's
 * `.reactions[]` (they move with it) and `setHp` has already stamped its targets.
 */
const ENTRY_DISPLAY_RANK: Record<CombatLogEntryKind, number> = {
    // 0 — what the skill did.
    attack: 0,
    heal: 0,
    shield: 0,
    buff: 0,
    debuff: 0,
    'dot-applied': 0,
    control: 0,
    cleanse: 0,
    purge: 0,
    bomb: 0,
    // 1 — charge bookkeeping for the turn.
    'charge-changed': 1,
    // 2 — consequences: what the skill (or the round) caused.
    'debuff-resisted': 2,
    detonation: 2,
    'dot-ticked': 2,
    death: 2,
    'shield-destroyed': 2,
    'cheat-death': 2,
    'buff-expired': 2,
    // A consequence of the repair row above it (#362 R11), so it must sort AFTER the `heal` entry
    // that triggered it — otherwise the log reads "repairs reversed" before the repair.
    'reversed-repair': 2,
};

/** Stable rank sort of one turn's top-level entries. Stable, so entries sharing a rank keep their
 *  emission order (an unknown kind ranks 0 and stays where it was relative to other skill rows). */
const sortTurnEntries = (entries: CombatLogEntry[]): void => {
    entries.sort((a, b) => (ENTRY_DISPLAY_RANK[a.kind] ?? 0) - (ENTRY_DISPLAY_RANK[b.kind] ?? 0));
};

export interface RosterEntry {
    actorId: string;
    side: 'player' | 'enemy';
    name: string;
}

/** Internal context threaded through all handlers. */
interface BuildContext {
    rounds: CombatLogRound[];
    /** Mutable current-round pointer — undefined before first round-started. */
    currentRound: CombatLogRound | undefined;
    /** Mutable current-turn pointer — undefined outside a turn. */
    currentTurn: CombatLogTurn | undefined;
    /** True from round-started until the first turn-started of that round. */
    beforeFirstTurn: boolean;
    /** The most-recently opened attack entry (ability-performed → attacked window). */
    openAttackEntry: CombatLogEntry | undefined;
    /** The `damage` from the most-recent `ability-performed` (used for primary-target amount). */
    openAttackAbilityDamage: number | undefined;
    /** The `targetId` from the most-recent `ability-performed` (used for miss synthesis). */
    openAttackAbilityTargetId: string | undefined;
    /** The `didHit` from the most-recent `ability-performed` (used for miss synthesis). */
    openAttackAbilityDidHit: boolean | undefined;
    /** Latest known HP percentages keyed by actorId. */
    hpPct: Map<string, number>;
    /** Set of actorIds present in the roster (for filtering). */
    rosterIds: Set<string>;
    /**
     * Running charge level per actor. Seeded from initialCharge at construction;
     * updated whenever a charge-changed event is processed.
     */
    runningCharge: Map<string, number>;
    /**
     * Max charge per actor, sourced from initialCharge. Immutable after seeding.
     */
    chargeMax: Map<string, number>;
    /**
     * Pending skill-fired data for the current turn, cleared at turn boundaries
     * and consumed by the first action-producing entry (ability-performed).
     */
    pendingSkill: { skillName?: string; slot: 'active' | 'charged' } | undefined;
    /**
     * The skill identity of the cast currently being logged, latched from
     * `pendingSkill` by the first `ability-performed` of the cast.
     *
     * Sticky for the whole cast: a multi-hit skill emits one ability-performed per
     * sub-attack (PR2) and every row must carry the same skill identity. Cleared at
     * turn-started and replaced by the next skill-fired.
     */
    castSkillTag: { skillName?: string; slot: 'active' | 'charged' } | undefined;
    /**
     * Reaction stamp for the event currently being dispatched. Captured in the
     * dispatch loop from the event's ReactiveStamp; consumed by attachEntry to
     * route the produced entry into a trigger entry's `.reactions`.
     */
    currentStamp:
        | {
              duringTurnOf: string;
              /** Captured for the render layer (T10 reserved); not read by the builder. */
              triggerActorId?: string;
          }
        | undefined;
    /**
     * Tracks which entries are themselves reactions, so a reaction can never be
     * picked as the trigger for nesting another reaction.
     */
    reactiveEntries: WeakSet<CombatLogEntry>;

    /** Push a new round and set it as current. */
    openRound(round: number): void;
    /** Push a new turn onto the current round and set it as current. */
    openTurn(actorId: string): void;
    /** Attach an entry to the current turn. */
    attachEntry(entry: CombatLogEntry): void;
    /**
     * Route a reaction entry into the trigger turn's most-recent non-reactive
     * entry's `.reactions[]`, or fall back to `currentRound.endOfRound`.
     * Only called when `currentStamp` is set.
     */
    routeReaction(entry: CombatLogEntry, stamp: { duringTurnOf: string }): void;
    /** Update the running HP map and stamp the most-recent matching target. */
    setHp(actorId: string, pct: number): void;
    /**
     * If the open attack entry has zero targets and didHit was false, synthesize a
     * miss target. Called before closing or replacing the open entry.
     */
    finalizeMissEntry(): void;
    /**
     * Finalize any pending miss entry, then clear all open-attack state.
     * Called at every boundary (openRound, openTurn, turn-ended, round-ended).
     */
    closeOpenAttack(): void;
    /**
     * Returns-and-clears the pending skill-fired data (or undefined if none).
     * Call when creating an action-producing entry so it picks up the skill tag.
     */
    consumePendingSkill(): { skillName?: string; slot: 'active' | 'charged' } | undefined;
    /**
     * Returns the skill tag for the cast currently being logged WITHOUT clearing it.
     *
     * Sticky for the whole cast: a multi-hit skill emits one ability-performed per
     * sub-attack (PR2) and every row must carry the same skill identity. Cleared at
     * turn-started and replaced by the next skill-fired.
     *
     * The first call of a cast still *consumes* `pendingSkill` (latching it into
     * `castSkillTag`), so the non-attack handlers keep their existing single-use
     * semantics — only repeated `ability-performed` rows share the tag.
     */
    currentSkillTag(): { skillName?: string; slot: 'active' | 'charged' } | undefined;
}

function createBuildContext(
    rosterIds: Set<string>,
    initialCharge: Map<string, { charge: number; max: number }>
): BuildContext {
    // Seed running charge and max from initialCharge.
    const runningCharge = new Map<string, number>();
    const chargeMaxMap = new Map<string, number>();
    for (const [actorId, { charge, max }] of initialCharge) {
        runningCharge.set(actorId, charge);
        chargeMaxMap.set(actorId, max);
    }

    const ctx: BuildContext = {
        rounds: [],
        currentRound: undefined,
        currentTurn: undefined,
        beforeFirstTurn: false,
        openAttackEntry: undefined,
        openAttackAbilityDamage: undefined,
        openAttackAbilityTargetId: undefined,
        openAttackAbilityDidHit: undefined,
        hpPct: new Map(),
        rosterIds,
        runningCharge,
        chargeMax: chargeMaxMap,
        pendingSkill: undefined,
        castSkillTag: undefined,
        currentStamp: undefined,
        reactiveEntries: new WeakSet<CombatLogEntry>(),

        openRound(round: number) {
            ctx.closeOpenAttack();
            const r: CombatLogRound = { round, startOfRound: [], turns: [], endOfRound: [] };
            ctx.rounds.push(r);
            ctx.currentRound = r;
            ctx.currentTurn = undefined;
            ctx.beforeFirstTurn = true;
        },

        openTurn(actorId: string) {
            if (!ctx.currentRound) return;
            ctx.beforeFirstTurn = false;
            ctx.closeOpenAttack(); // also clears pendingSkill
            const t: CombatLogTurn = {
                actorId,
                // Read chargeBefore from the running map at the moment the turn opens.
                // Assumes the engine emits turn-started BEFORE any in-turn charge-changed
                // for this actor; pre-turn-started changes ARE included (already folded
                // into runningCharge before openTurn is called).
                chargeBefore: ctx.runningCharge.get(actorId) ?? 0,
                chargeMax: ctx.chargeMax.get(actorId) ?? 0,
                entries: [],
            };
            ctx.currentRound.turns.push(t);
            ctx.currentTurn = t;
        },

        attachEntry(entry: CombatLogEntry) {
            if (ctx.currentStamp) {
                ctx.routeReaction(entry, ctx.currentStamp);
                return;
            }
            if (ctx.currentTurn) {
                ctx.currentTurn.entries.push(entry);
                return;
            }
            // No current turn and no stamp — round-start vs round-end drain window.
            if (ctx.currentRound) {
                if (ctx.beforeFirstTurn) ctx.currentRound.startOfRound.push(entry);
                else ctx.currentRound.endOfRound.push(entry);
            }
        },

        routeReaction(entry: CombatLogEntry, stamp: { duringTurnOf: string }) {
            // Mark the entry reactive so it can't itself be a trigger.
            ctx.reactiveEntries.add(entry);
            // Find the most-recent turn for `duringTurnOf` in the current round.
            const round = ctx.currentRound;
            let triggerTurn: CombatLogTurn | undefined;
            if (round) {
                for (let i = round.turns.length - 1; i >= 0; i--) {
                    if (round.turns[i].actorId === stamp.duringTurnOf) {
                        triggerTurn = round.turns[i];
                        break;
                    }
                }
            }
            // Within that turn, find the most-recent NON-reactive entry.
            let trigger: CombatLogEntry | undefined;
            if (triggerTurn) {
                for (let i = triggerTurn.entries.length - 1; i >= 0; i--) {
                    if (!ctx.reactiveEntries.has(triggerTurn.entries[i])) {
                        trigger = triggerTurn.entries[i];
                        break;
                    }
                }
            }
            if (trigger) {
                trigger.reactions.push(entry);
            } else if (triggerTurn) {
                // The stamped turn EXISTS but has produced no non-reactive entry yet, so there is
                // nothing to nest under. This is the `start-of-turn` grant window (SP-G G2 drains
                // buff/shield/heal grants BEFORE the acting owner casts — the SHIELD gear set's
                // 4%-max-HP pool, Fortifying Shroud's Defense Up): the effect genuinely belongs to
                // THIS actor's turn. Attach it as a top-level entry of that turn rather than
                // exiling it to endOfRound, where it read as an unexplained shield appearing
                // detached from the ship that generated it.
                triggerTurn.entries.push(entry);
            } else if (round) {
                // No matching turn at all (turn-less drain window) — fall back to endOfRound.
                round.endOfRound.push(entry);
            }
        },

        setHp(actorId: string, pct: number) {
            ctx.hpPct.set(actorId, pct);
            // Check the currently-open attack entry first. An hp-changed that follows
            // a reaction's attacked event pertains to the open entry (which may be nested
            // inside a trigger's .reactions[]) rather than a top-level turn entry.
            if (ctx.openAttackEntry) {
                for (let j = ctx.openAttackEntry.targets.length - 1; j >= 0; j--) {
                    if (ctx.openAttackEntry.targets[j].targetId === actorId) {
                        ctx.openAttackEntry.targets[j].resultingHpPct = pct;
                        return;
                    }
                }
            }
            // Fall back: stamp the most-recent matching target in the current turn's entries.
            if (!ctx.currentTurn) return;
            for (let i = ctx.currentTurn.entries.length - 1; i >= 0; i--) {
                const e = ctx.currentTurn.entries[i];
                // Walk targets in reverse to find the most recently added matching target.
                for (let j = e.targets.length - 1; j >= 0; j--) {
                    if (e.targets[j].targetId === actorId) {
                        e.targets[j].resultingHpPct = pct;
                        return;
                    }
                }
            }
        },

        finalizeMissEntry() {
            if (
                ctx.openAttackEntry &&
                ctx.openAttackEntry.targets.length === 0 &&
                ctx.openAttackAbilityDidHit === false &&
                ctx.openAttackAbilityTargetId !== undefined
            ) {
                const missTarget: CombatLogTarget = {
                    targetId: ctx.openAttackAbilityTargetId,
                    didHit: false,
                };
                ctx.openAttackEntry.targets.push(missTarget);
                return;
            }
            // Suppress a phantom attack row: an ability-performed that produced no `attacked`
            // event and was NOT a miss (buff/heal/utility-only cast). Remove it from the current
            // turn's entries if present (the only container an on-turn attack entry lands in).
            //
            // WHY THAT IS THE ONLY CONTAINER (asked in review of PR6 — `attachEntry` has three
            // arms, and the `.reactions[]` arm is not swept here). `attachEntry` routes to
            // `routeReaction` — the arm that would bury this entry inside some other entry's
            // `.reactions[]` — if and only if `ctx.currentStamp` is set, and `currentStamp` is
            // read off the DISPATCHED EVENT's own `duringTurnOf` (dispatch loop, below). The type
            // permits that stamp (`ability-performed` is in `StampedEventType` /
            // `REACTIVE_STAMPED_EVENT_TYPES`, triggers.ts), but no PRODUCER can set it: the stamp
            // is applied only by `makeReactiveStampingBus`, which exists solely as a fresh
            // per-intent wrapper built inside `executeIntent` (triggers.ts) and assigned to that
            // intent's `ctx.bus`; it never replaces the engine's own `bus` binding (engine.ts —
            // a `const` fanning out to the external tap plus the internal bus). Both
            // `ability-performed` emitters — runPlayerTurn's inline emit and the engine's
            // `emitDeferredAbilityPerformed` — emit on THAT engine bus, so the event is always
            // unstamped. Reactive damage cannot sneak one in either: it deliberately emits
            // `reactive-damage-performed` and NO `ability-performed` (events.ts chain guard). Nor
            // can a reactive extra action: `grantExtraAction` only bumps a pending count, so the
            // granted turn runs later in the selection loop on the engine bus like any other.
            // Verified empirically too — a temporary `throw` on a stamped `ability-performed`,
            // run across the whole combat + simulation corpus, fired ONLY on three hand-crafted
            // counterattack fixtures in `log/__tests__/buildCombatLog.test.ts` (synthetic event
            // literals), never on an engine-produced stream. That leaves `attachEntry`'s third arm:
            // with no open turn the row lands in the round's startOfRound / endOfRound drain, which
            // needs an `ability-performed` from an actor whose `turn-started` the roster filter
            // dropped (a non-roster actor). A second probe — `throw` when this prune arm fires on an
            // entry NOT found in `currentTurn.entries` — never fired over that same corpus, so that
            // arm is left as-is rather than swept speculatively; `indexOf` returning -1 already
            // makes the splice a no-op if one ever appears.
            //
            // Normally guarded on `reactions.length === 0`: a reactive trigger (e.g. Ravager's
            // on-own-debuff-resisted Hacking Module Overdrive grant) can nest under this entry
            // via routeReaction BEFORE the boundary that finalizes it — pruning the entry would
            // silently discard that nested reaction along with it, so a non-empty `.reactions[]`
            // keeps the (now target-less) parent row so its children stay visible in the log.
            //
            // UNNAMEABLE TARGET (multi-hit full-walk epic, PR6) overrides that reprieve. When the
            // ability named a target OUTSIDE the roster, keeping the row is not a trade worth
            // making: `roster` is the only id→name map the renderer has, so the parent renders as
            // an attack on nobody. The reactions are re-parented in its place (spliced INTO the
            // slot it occupied) instead of being discarded, so nothing is lost — the same place
            // routeReaction's own no-trigger fallback would have put them. They stay in
            // `reactiveEntries`, so a promoted reaction still cannot be picked as a trigger.
            //
            // Roster membership is the right discriminator because it is precisely the question
            // the log layer has to answer, and the only id the engine produces outside the roster
            // is its vestigial `enemy` sink (engine.ts:1756) — the actor a cast binds when it has
            // no positioned victim, carrying no `position` and never appearing in battleSimulator's
            // roster (built from placed ships only, battleSimulator.ts:1127). What it EXCLUDES: any
            // row that collected a target (a real hit always emits `attacked`, so the arm is
            // unreachable for it), and any miss row (the branch above returns first, having
            // synthesized a target). Event cardinality is untouched — a `hits: N` cast still emits
            // N `ability-performed`, so per-sub-attack riders (`on-deal-damage`, `on-crit`,
            // `on-ally-crit`) still fire N times and each event's crit signalling is unchanged.
            // Only the ROW is suppressed.
            //
            // The `=== undefined` arm just above the roster check can never actually be true here:
            // `ability-performed.targetId` (events.ts) is a required `string`, and
            // `openAttackAbilityTargetId` is set from it (below, on the `ability-performed`
            // handler) and cleared only in `closeOpenAttack` alongside `openAttackEntry` — which
            // the leading `ctx.openAttackEntry &&` condition already requires to be truthy. It is
            // kept solely so `rosterIds.has(...)` below type-checks against the field's declared
            // `string | undefined` type; the sole condition that can actually fire the override is
            // roster non-membership.
            //
            // RE-PARENTING HAZARD — LIVE, NARROW, DISPLAY-ONLY. An earlier draft said this was
            // "only reachable once this arm is, i.e. today it is not". Wrong on both halves: the
            // roster arm is reachable today (it is the point of this change — a multi-hit cast
            // bound to the vestigial sink takes it), and `buildCombatLog.test.ts`'s "keeps the
            // drained rider grants when the parent row is suppressed" already asserts three
            // promoted `buff` entries landing in `currentTurn.entries`. A promoted `buff` reaction
            // keeps its `targets: [{ targetId }]`, so those three are ALREADY inside `setHp`'s
            // top-level reverse fallback scan (above, :315-324) — the exact stale-`resultingHpPct`
            // hazard the `buff-applied` handler's own comment flags for that shape. A later
            // `hp-changed` for that actor can stamp a promoted grant instead of the row that was
            // actually meant.
            // WHY IT IS NOT FIXED HERE: the field is a rendered HP percentage on a log row and
            // nothing downstream computes from it — no damage, no accounting, no test. The
            // mis-stamp is also self-limiting: the scan takes the most recent matching target, so
            // it can only mis-stamp when a promoted grant is the LAST entry naming that actor.
            // The pre-existing hazard on `buff` rows is unchanged in kind by this arm; it is
            // recorded rather than papered over, and behaviour is deliberately left alone.
            if (
                ctx.openAttackEntry &&
                ctx.openAttackEntry.kind === 'attack' &&
                ctx.openAttackEntry.targets.length === 0 &&
                ctx.openAttackAbilityDidHit !== false &&
                (ctx.openAttackEntry.reactions.length === 0 ||
                    ctx.openAttackAbilityTargetId === undefined ||
                    !ctx.rosterIds.has(ctx.openAttackAbilityTargetId))
            ) {
                const entries = ctx.currentTurn?.entries;
                if (entries) {
                    const idx = entries.indexOf(ctx.openAttackEntry);
                    if (idx !== -1) entries.splice(idx, 1, ...ctx.openAttackEntry.reactions);
                }
            }
        },

        closeOpenAttack() {
            ctx.finalizeMissEntry();
            ctx.openAttackEntry = undefined;
            ctx.openAttackAbilityDamage = undefined;
            ctx.openAttackAbilityTargetId = undefined;
            ctx.openAttackAbilityDidHit = undefined;
            // Clear pending skill at every turn/round boundary so it never bleeds.
            ctx.pendingSkill = undefined;
            // The cast-sticky tag is scoped to the turn for the same reason.
            ctx.castSkillTag = undefined;
        },

        consumePendingSkill() {
            const pending = ctx.pendingSkill;
            ctx.pendingSkill = undefined;
            return pending;
        },

        currentSkillTag() {
            // Latch a freshly-fired skill; otherwise keep returning the cast's tag so
            // every sub-attack row of a multi-hit skill reads as the same named skill.
            const pending = ctx.consumePendingSkill();
            if (pending) ctx.castSkillTag = pending;
            return ctx.castSkillTag;
        },
    };
    return ctx;
}

type Handler<T extends CombatEventType> = (
    e: Extract<CombatEvent, { type: T }>,
    ctx: BuildContext
) => void;

/** Handler map — one entry per handled event type. Unknown types are silently skipped. */
const handlers: Partial<{ [K in CombatEventType]: Handler<K> }> = {
    'round-started': (e, ctx) => {
        ctx.openRound(e.round);
    },

    'round-ended': (_e, ctx) => {
        ctx.closeOpenAttack();
    },

    'turn-started': (e, ctx) => {
        if (!ctx.rosterIds.has(e.actorId)) return;
        ctx.openTurn(e.actorId);
    },

    // Task 6c: decorates the current turn with its live modelled stats — creates NO entry.
    'stats-snapshot': (e, ctx) => {
        if (ctx.currentTurn && ctx.currentTurn.actorId === e.actorId) {
            ctx.currentTurn.statsSnapshot = e.stats;
        }
    },

    'turn-ended': (_e, ctx) => {
        ctx.closeOpenAttack(); // also clears pendingSkill
        ctx.currentTurn = undefined;
    },

    'skill-fired': (e, ctx) => {
        if (!ctx.currentTurn) return;
        ctx.pendingSkill = { skillName: e.skillName, slot: e.slot };
        // Drop the previous cast's latched tag: a NEW skill fired, so any sub-attack row from here
        // on belongs to THIS skill. Clearing here rather than relying on `pendingSkill` being
        // non-empty at the next `currentSkillTag()` call is load-bearing — eight other handlers
        // still `consumePendingSkill()`, so a clause that emits before this cast's first
        // `ability-performed` (an intra-cast debuff written ahead of the damage clause, say) would
        // consume `pendingSkill` first and leave `currentSkillTag()` serving the STALE latch,
        // mislabelling the attack row with the previous skill's name.
        ctx.castSkillTag = undefined;
    },

    'charge-changed': (e, ctx) => {
        // Update running charge for this actor regardless of current turn.
        ctx.runningCharge.set(e.actorId, e.newCharge);

        // Produce a log entry (current turn, reaction nesting, or round-end drain).
        if (!ctx.currentTurn && !ctx.currentRound) return;
        let note: string;
        switch (e.reason) {
            case 'gen':
                note = `charge ${e.oldCharge}→${e.newCharge}`;
                break;
            case 'cast-reset':
                note = `charge reset (${e.oldCharge}→${e.newCharge})`;
                break;
            case 'manip':
                note = `charge ${e.oldCharge}→${e.newCharge} (manip)`;
                break;
        }
        const entry: CombatLogEntry = {
            kind: 'charge-changed',
            actorId: e.actorId,
            targets: [],
            reactions: [],
            note,
        };
        ctx.attachEntry(entry);
    },

    'ability-performed': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        // Finalize any pending miss entry before opening a new one.
        ctx.finalizeMissEntry();
        // Stamp the cast's skill tag onto the entry. Sticky, not consuming: a multi-hit
        // skill emits one ability-performed per sub-attack and every row must carry it.
        const entry: CombatLogEntry = {
            kind: 'attack',
            actorId: e.actorId,
            targets: [],
            reactions: [],
            ...(ctx.currentSkillTag() ?? {}),
        };
        ctx.attachEntry(entry);
        ctx.openAttackEntry = entry;
        ctx.openAttackAbilityDamage = e.damage;
        ctx.openAttackAbilityTargetId = e.targetId;
        ctx.openAttackAbilityDidHit = e.didHit;
    },

    attacked: (e, ctx) => {
        if (!ctx.openAttackEntry) return;
        // Find-or-create the target for this victim (dedup by targetId).
        const existing = ctx.openAttackEntry.targets.find((t) => t.targetId === e.targetId);
        if (existing) {
            // Multi-hit on the same victim: OR-accumulate didCrit and shieldWasHit, leave amount unchanged.
            if (e.didCrit) existing.didCrit = true;
            if (e.shieldWasHit) existing.shieldWasHit = true;
            return;
        }
        // New victim — determine amount based on primary vs. splash.
        const isPrimary = e.isPrimaryTarget === true;
        const amount = isPrimary ? ctx.openAttackAbilityDamage : e.damage;
        const target: CombatLogTarget = {
            targetId: e.targetId,
            amount,
            didCrit: e.didCrit,
            shieldWasHit: e.shieldWasHit,
            didHit: true,
        };
        ctx.openAttackEntry.targets.push(target);
    },

    'hp-changed': (e, ctx) => {
        ctx.setHp(e.targetId, e.newPct);
    },

    'heal-performed': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        let targets: CombatLogTarget[];
        if (e.perTarget && e.perTarget.length > 0) {
            targets = e.perTarget.map((pt) => {
                const t: CombatLogTarget = { targetId: pt.targetId, amount: pt.amount };
                if (pt.didCrit !== undefined) t.didCrit = pt.didCrit;
                return t;
            });
        } else {
            // Fallback: one synthetic target per id in targets[], no amount.
            targets = e.targets.map((id) => ({ targetId: id }));
        }
        const entry: CombatLogEntry = {
            kind: 'heal',
            actorId: e.casterId,
            targets,
            reactions: [],
            ...(ctx.consumePendingSkill() ?? {}),
        };
        ctx.attachEntry(entry);
    },

    'shield-applied': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        let targets: CombatLogTarget[];
        if (e.perTarget && e.perTarget.length > 0) {
            targets = e.perTarget.map((pt) => ({ targetId: pt.targetId, amount: pt.amount }));
        } else {
            // Fallback: one synthetic target per id in recipientIds[], no amount.
            targets = e.recipientIds.map((id) => ({ targetId: id }));
        }
        const entry: CombatLogEntry = {
            kind: 'shield',
            actorId: e.granterId,
            targets,
            reactions: [],
            // #424: a LEECH grant has no cast behind it, so it must not take the pending skill
            // tag. `consumePendingSkill` is destructive — the tag is a one-shot token — so a
            // tagless emit calling it would label its own row with an unrelated skill AND leave
            // the cast row that earned the tag bare. Same reasoning as the `shield-applied-log`
            // twin below, which likewise never consumes; the difference is that this event must
            // still fire `on-shield-applied`, so it cannot simply become that log-only twin.
            ...(e.uncast ? {} : (ctx.consumePendingSkill() ?? {})),
        };
        ctx.attachEntry(entry);
    },

    // LOG-ONLY twin for the mid-hit threshold shield (Lifeline). Keyed on the victim, which is
    // also the granter — a self-grant, so there is no separate caster row and no pending skill to
    // consume (unlike 'shield-applied', which belongs to a cast).
    'shield-applied-log': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'shield',
            actorId: e.victimId,
            targets: [{ targetId: e.victimId, amount: e.amount }],
            reactions: [],
        };
        ctx.attachEntry(entry);
    },

    'shield-destroyed-log': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'shield-destroyed',
            actorId: e.victimId,
            targets: [{ targetId: e.victimId }],
            reactions: [],
        };
        ctx.attachEntry(entry);
    },

    // #362 R11. Booked to the debuff's APPLIER — the same actor the burn's damage and kill are
    // credited to — with the burned ship as the target, the source→target shape `debuff` and
    // `dot-applied` already use. A scheduled (hand-picked) Reversed Repairs has no applier, so the
    // entry falls back to the victim and renders as the plain self-line.
    //
    // `healerId` (#362 fix-wave-1) rides along as a DEDICATED field, not folded into `note` (which
    // `debuff-resisted` already owns) — DISPLAY ONLY. `actorId` stays `e.applierId ?? e.victimId`;
    // the healer never becomes this entry's actor/attribution, only a name the formatter may show.
    'reversed-repair-log': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'reversed-repair',
            actorId: e.applierId ?? e.victimId,
            targets: [{ targetId: e.victimId, amount: e.amount }],
            reactions: [],
            ...(e.healerId !== undefined ? { healerId: e.healerId } : {}),
        };
        ctx.attachEntry(entry);
    },

    'cheat-death-log': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'cheat-death',
            actorId: e.actorId,
            targets: [{ targetId: e.actorId }],
            reactions: [],
        };
        ctx.attachEntry(entry);
    },

    'buff-applied': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        // Books to the GRANTER, with the receiver in `targets` — the same shape `heal`
        // (casterId), `shield-applied` (granterId), `control` (casterId), `debuff` and
        // `dot-applied` (sourceId) already use. `buff` was the lone grant-style kind booked to
        // its recipient, which made an ally-only support kit invisible to any actor-scoped
        // reader. Falls back to the receiver when no granter is carried (self-grant).
        //
        // Giving this entry a non-empty `targets` puts it into setHp's reverse fallback scan for
        // the first time (previously `targets: []` made it structurally invisible there).
        // Currently harmless because in playerTurn.ts the buff-grant loop runs BEFORE
        // shield-applied/heal-performed, so those more-recent entries win the reverse scan first —
        // but reordering those emissions would silently let a buff entry's target get stamped with
        // a stale resultingHpPct instead.
        const entry: CombatLogEntry = {
            kind: 'buff',
            actorId: e.granterId ?? e.actorId,
            targets: [{ targetId: e.actorId }],
            reactions: [],
            note: e.buffName,
            ...(ctx.consumePendingSkill() ?? {}),
        };
        ctx.attachEntry(entry);
    },

    'buff-expired': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'buff-expired',
            actorId: e.actorId,
            targets: [],
            reactions: [],
            note: `${e.buffName} expired`,
        };
        ctx.attachEntry(entry);
    },

    // Log-only reactive procs (drain-time damage/heal that emit no ability-performed/heal-performed
    // — chain guard). Self-contained: the event carries its own target(s), so no follow-up
    // `attacked` event fills them in. Both nest under the trigger turn via `currentStamp`.
    'reactive-damage-performed': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const target: CombatLogTarget = { targetId: e.targetId, amount: e.amount, didHit: true };
        if (e.didCrit) target.didCrit = true;
        const entry: CombatLogEntry = {
            kind: 'attack',
            actorId: e.sourceId,
            targets: [target],
            reactions: [],
        };
        ctx.attachEntry(entry);
    },

    'reactive-heal-performed': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'heal',
            actorId: e.casterId,
            targets: e.perTarget.map((pt) => ({ targetId: pt.targetId, amount: pt.amount })),
            reactions: [],
        };
        ctx.attachEntry(entry);
    },

    // Log-only reactive cleanse (drain-time; emits no cleanse-performed — chain guard). Rendered
    // as a `cleanse` entry attributed to the reacting owner, carrying the cleansed ally as a target
    // so the log reads "AEGIS → Ally: cleansed N". Nests under the trigger turn via currentStamp.
    'reactive-cleanse-performed': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const total = e.perTarget.reduce((sum, pt) => sum + pt.count, 0);
        const entry: CombatLogEntry = {
            kind: 'cleanse',
            actorId: e.casterId,
            targets: e.perTarget.map((pt) => ({ targetId: pt.targetId })),
            reactions: [],
            // A duration SHRINK is not a removal — say so, or the reader counts debuffs that are
            // still on the ship as gone. `count` means "debuffs shrunk" in that mode.
            note:
                e.mode === 'reduce-duration'
                    ? `-${e.durationTurns ?? 1} turn on ${total} debuff${total === 1 ? '' : 's'}`
                    : `cleansed ${total}`,
        };
        ctx.attachEntry(entry);
    },

    'debuff-applied': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'debuff',
            actorId: e.sourceId,
            targets: [{ targetId: e.targetId }],
            reactions: [],
            note: e.buffName,
            ...(ctx.consumePendingSkill() ?? {}),
        };
        ctx.attachEntry(entry);
    },

    'debuff-resisted': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'debuff-resisted',
            actorId: e.sourceId ?? e.targetId,
            targets: [{ targetId: e.targetId }],
            reactions: [],
            note: e.buffName,
        };
        ctx.attachEntry(entry);
    },

    'dot-applied': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'dot-applied',
            actorId: e.sourceId,
            targets: [{ targetId: e.targetId }],
            reactions: [],
            note: dotNote(e.dotType, e.tier, e.stacks),
            ...(ctx.consumePendingSkill() ?? {}),
        };
        ctx.attachEntry(entry);
    },

    'dot-ticked': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        // No consumePendingSkill: a tick is not a cast. Note mirrors 'dot-applied''s format so
        // the renderer can show type + stack count alongside the tick amount.
        const entry: CombatLogEntry = {
            kind: 'dot-ticked',
            actorId: e.targetId,
            targets: [{ targetId: e.targetId, amount: e.damage }],
            reactions: [],
            note: dotNote(e.dotType, e.tier, e.stacks),
        };
        ctx.attachEntry(entry);
    },

    'dot-detonated': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        // A detonation is not a fresh cast (the source skill already logged its own entry),
        // so no consumePendingSkill — the damage is attributed to the victim it lands on.
        const entry: CombatLogEntry = {
            kind: 'detonation',
            actorId: e.targetId,
            targets: [{ targetId: e.targetId, amount: e.damage }],
            reactions: [],
            note: 'DoT detonated',
        };
        ctx.attachEntry(entry);
    },

    'bomb-detonated': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'bomb',
            actorId: e.actorId,
            // The burst is a single aggregate payout, carried on the HOLDER the bomb went off on
            // (`victimId`) — `actorId` stays the applier who gets credited. This used to key the
            // target as `actorId` too, on a stale "no per-victim breakdown on the event" comment
            // (victimId has been required since Wave 5 C2), so a bomb Ruiner planted on Heliodor
            // rendered as "Ruiner → Ruiner".
            targets: [{ targetId: e.victimId, amount: e.damage }],
            reactions: [],
            note: `bombs detonated ×${e.stacks}`,
        };
        ctx.attachEntry(entry);
    },

    'control-applied': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'control',
            actorId: e.casterId,
            targets: [],
            reactions: [],
            note: e.effect,
            ...(ctx.consumePendingSkill() ?? {}),
        };
        ctx.attachEntry(entry);
    },

    'cleanse-performed': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'cleanse',
            actorId: e.casterId,
            targets: [],
            reactions: [],
            note: `cleansed ${e.count}`,
            ...(ctx.consumePendingSkill() ?? {}),
        };
        ctx.attachEntry(entry);
    },

    'purge-performed': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'purge',
            actorId: e.casterId,
            targets: [{ targetId: e.targetId }],
            reactions: [],
            note: `purged ${e.count}`,
            ...(ctx.consumePendingSkill() ?? {}),
        };
        ctx.attachEntry(entry);
    },

    'ship-destroyed': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        // Carry the killer as a TARGET (not a raw id baked into the note) so the renderer's
        // `death` formatter resolves it to a ship name via nameOf.
        const entry: CombatLogEntry = {
            kind: 'death',
            actorId: e.actorId,
            targets: e.killerId ? [{ targetId: e.killerId }] : [],
            reactions: [],
        };
        ctx.attachEntry(entry);
    },
};

/**
 * Folds a flat CombatEvent stream into a hierarchical view-model.
 *
 * @param events         Raw event stream from the combat engine.
 * @param roster         Actor roster — maps actorIds to name/side. Used to filter dummy actors.
 * @param initialCharge  Initial charge state per actor — seeds chargeBefore/chargeMax on turns.
 */
export function buildCombatLog(
    events: CombatEvent[],
    roster: RosterEntry[],
    initialCharge: Map<string, { charge: number; max: number }>
): CombatLogRound[] {
    const rosterIds = new Set(roster.map((r) => r.actorId));
    const ctx = createBuildContext(rosterIds, initialCharge);

    for (const event of events) {
        // Capture the reaction stamp (if any) for attachEntry to consume. Only
        // events carrying a ReactiveStamp have `duringTurnOf`; others leave it unset.
        ctx.currentStamp =
            'duringTurnOf' in event && event.duringTurnOf
                ? { duringTurnOf: event.duringTurnOf, triggerActorId: event.triggerActorId }
                : undefined;

        const handler = (handlers as Record<string, Handler<CombatEventType> | undefined>)[
            event.type
        ];
        if (handler) {
            // Safe cast: the map key is the discriminant, so the handler receives the right shape.
            handler(event, ctx);
        }
        // Unknown event types are silently skipped (no-op).

        // Clear the stamp so it never bleeds into the next event.
        ctx.currentStamp = undefined;
    }

    // Presentation pass — see ENTRY_DISPLAY_RANK. Runs once at the END rather than at each
    // turn boundary because a reaction stamped `duringTurnOf` can still be appended to an
    // already-closed turn (routeReaction's no-trigger fallback), so a turn is only truly
    // complete when the whole stream has been folded.
    for (const round of ctx.rounds) {
        for (const turn of round.turns) sortTurnEntries(turn.entries);
    }

    return ctx.rounds;
}
