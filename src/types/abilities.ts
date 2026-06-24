import type { ShipRoleCategory } from '../constants/shipTypes';
import { EnemyBaseClass, DoTType, StackTrigger, ParsedBuffEffects } from './calculator';

export type SkillSlot = 'active' | 'charged' | 'passive';

export type AbilityType =
    | 'damage'
    | 'additional-damage'
    | 'modifier'
    | 'buff'
    | 'debuff'
    | 'dot'
    | 'extend-dot'
    | 'detonate-dot'
    | 'accumulate-detonate'
    | 'charge'
    | 'extra-action'
    | 'heal'
    | 'shield'
    | 'cleanse'
    | 'purge'
    | 'control'
    | 'incoming-reduction'
    | 'incoming-block'
    | 'outgoing-amplification'
    | 'heal-amplification'
    | 'incoming-heal-amplification';

export type AbilityTarget =
    | 'self'
    | 'ally'
    | 'all-allies'
    | 'adjacent-allies' // Fortifying Shroud: living same-side allies on neighbouring board
    // cells (non-positional → all same-side allies). Resolved via
    // IntentExecContext.adjacentAllyIdsFor.
    | 'enemy'
    | 'all-enemies'
    | 'enemy-most-buffs'
    | 'enemy-highest-attack'; // D-PR14 Doomsayer: living opposing actor with the greatest
//                           live effective attack (global selector, resolved at drain).

// NOTE on the live subset: `round-started` is the engine event key for the
// `start-of-round` trigger (a deviation from the Phase 1 contract's `turn-started`
// mapping — in a multi-actor round `turn-started` fires once per actor, so
// `round-started` is the canonical "start of round" signal). See LIVE_TRIGGERS
// below for which values the Phase 4b engine consumes via listeners; the rest are
// annotation-only (assume-active conditions, normal on-cast pipelines).
export type AbilityTrigger =
    | 'on-cast'
    | 'start-of-round'
    | 'start-of-turn' // Fortifying Shroud: fires at the OWNER's own turn-start (rides the
    // per-actor turn-started event; self-scoped on actorId === ownerId)
    | 'end-of-turn' // Fires at the OWNER's own turn-END (rides the existing per-actor
    // `turn-ended` event, self-scoped on actorId === ownerId). Mirror of `start-of-turn`.
    // Used by Chrono Reaver (end-of-turn + every-n-turns charge gain).
    | 'end-of-round' // Rhodium end-of-round purge — C2b-2
    | 'on-crit'
    | 'on-debuff-inflicted'
    | 'on-ally-debuff-inflicted'
    | 'on-ally-crit-dot'
    | 'on-ally-critically-repaired'
    | 'on-ally-crit'
    | 'on-stasis-applied'
    | 'on-bomb-detonated'
    | 'on-attacked'
    | 'on-ally-attacked'
    | 'on-ally-destroyed'
    | 'on-destroyed'
    | 'on-enemy-destroyed'
    | 'on-cheat-death-activated'
    // Fired by the engine when the owner's HP crosses below a watched threshold
    // (downward only — heals/upward changes emit nothing). The buff executor uses this
    // to grant conditional buffs, once-per-combat where the game says so (Tycho/Shelter/
    // Los "once per battle, when HP drops below X%"; Kafa/Redeemer re-fire each crossing).
    | 'on-hp-threshold-crossed'
    // Fired when an ENEMY-SIDE actor repairs (reuses heal-performed) or cleanses a
    // debuff (cleanse-performed). Player reactions: Zosimos charge gain on enemy
    // repair; Arum/Yarrow/Larkspur/Grif reactions on enemy cleanse. Phase 4c PR 4.
    | 'on-enemy-repaired'
    | 'on-enemy-cleansed'
    // Purge ecosystem C2b: Sefuba self-purge / Salvation ally-purged
    | 'on-enemy-purged'
    | 'on-ally-purged'
    // Fired when the owner performs its CHARGED skill (rides the existing skill-fired
    // event's slot discriminator). Self-scoped: the listener matches actorId === ownerId
    // && slot === 'charged'. Used by the Spearhead implant (all-allies Attack Up grant).
    | 'on-charged-cast'
    // Warpstrike: owner dealt direct damage on its turn. Rides the aggregate
    // ability-performed event emitted once per damage-dealing turn (runPlayerTurn
    // emits exactly one; positional path emits none — engine.ts ~2887).
    | 'on-deal-damage'
    // Fired when the owner applies repair to at least one OTHER ally (own heal-performed
    // event with a non-self recipient). Used by the Font of Power implant (grants the
    // repaired allies a buff). Distinct from on-ally-critically-repaired (no crit filter).
    | 'on-own-repair-to-ally'
    // D-PR16 Firewall: fires when THIS unit receives a timed debuff (rides the existing
    // `debuff-applied` event, self-scoped on targetId === ownerId). Does NOT fire for DoTs
    // (separate `dot-applied` event) — matches "when debuffed".
    | 'on-debuffed'
    // D-PR16 Lockdown: fires when THIS unit resists an incoming debuff (rides the existing
    // `debuff-resisted` event, self-scoped on targetId === ownerId). Chains off D-PR15's
    // Block-Debuff auto-resist emission AND normal hacking/affinity resists.
    | 'on-debuff-resisted';

/**
 * Triggers the combat engine consumes via listeners (the machinery lives in
 * src/utils/combat/triggers.ts). All four death/revive triggers are live as of
 * Phase 4b: on-destroyed, on-ally-destroyed, on-enemy-destroyed, and
 * on-cheat-death-activated. Defined here next to AbilityTrigger (not in the
 * engine module) so UI consumers — e.g. the editor's Trigger select note — don't
 * pull the combat engine's module graph in for one constant.
 */
export const LIVE_TRIGGERS = new Set<AbilityTrigger>([
    'start-of-round',
    'start-of-turn',
    'end-of-turn',
    'end-of-round', // Rhodium end-of-round purge — C2b-2
    'on-crit',
    'on-debuff-inflicted',
    'on-ally-debuff-inflicted',
    'on-ally-crit-dot',
    'on-ally-critically-repaired',
    'on-ally-crit',
    'on-stasis-applied',
    'on-bomb-detonated',
    'on-attacked',
    'on-ally-attacked',
    'on-destroyed',
    'on-ally-destroyed',
    'on-enemy-destroyed',
    'on-cheat-death-activated',
    'on-hp-threshold-crossed',
    'on-enemy-repaired',
    'on-enemy-cleansed',
    // Purge ecosystem C2b: Sefuba self-purge / Salvation ally-purged
    'on-enemy-purged',
    'on-ally-purged',
    // Spearhead: all-allies buff grant after the owner's charged skill.
    'on-charged-cast',
    // Font of Power: buff grant to allies the owner repairs.
    'on-own-repair-to-ally',
    // D-PR16 Firewall: self-scoped reaction to receiving a timed debuff.
    'on-debuffed',
    // D-PR16 Lockdown: self-scoped reaction to RESISTING an incoming debuff.
    'on-debuff-resisted',
    // Warpstrike: owner dealt direct damage on its turn.
    'on-deal-damage',
]);

export type ConditionSubject =
    | 'always'
    | 'self-buff'
    | 'self-debuff'
    | 'enemy-buff'
    | 'enemy-debuff'
    | 'enemy-type'
    | 'self-crit'
    | 'adjacent-ally'
    | 'enemy-adjacent'
    | 'enemy-destroyed'
    | 'hp-threshold'
    // HP-percentage COUNT subjects: the count IS the enemy's current (or missing)
    // HP percentage (0..100), for HP-proportional scaling — Akula ("up to 30% more,
    // the higher the target's HP") scales on enemy-hp-pct with perUnit 0.3; Tithonus
    // ("up to 40%, max below 10% HP") on enemy-hp-missing-pct with perUnit 40/90 +
    // cap 40. Distinct from 'hp-threshold', which is a binary above/below gate.
    | 'enemy-hp-pct'
    | 'enemy-hp-missing-pct'
    | 'ally-inflicts-debuff'
    | 'ally-critically-repaired'
    | 'ally-crit-dot'
    // A specific named ally is on the team (roster/team-composition gate; manual,
    // team-dependent). The ally's name is carried in `buffName` (e.g. "Isha").
    | 'ally-on-team'
    // Binary gate: the condition owner has the lowest Speed among its (player) team
    // (ties → all tied qualify). Used by Chakara's start-of-round self-buffs.
    // Evaluated from ConditionContext.isLowestSpeedAlly; defaults true (lone-actor
    // DPS assumption: a single attacker is trivially the slowest).
    | 'lowest-speed-ally'
    // Binary gate: the acting attacker's TARGET was repaired (HP healed) earlier this
    // round. Live-derived by the engine (ConditionContext.targetRepairedThisRound);
    // defaults false (DPS mode / un-repaired target). Nayra's charged purge + Stasis/
    // Exposed inflicts. derivable:true — a derivable:false condition would always be met
    // (evaluateConditions.ts:30), defeating the gate.
    | 'target-repaired-this-round'
    // Binary gate: the condition owner currently has a shield (CombatActor.shieldPool > 0).
    // Live-derived (ConditionContext.selfShielded); defaults false (no shield / DPS mode).
    // Dormant until sub-project H grants shields in the sim. Used by the Arcane Siege implant.
    | 'self-shield'
    // Binary gate: the condition owner received ZERO direct hits this round (a "hit" =
    // a direct attack that landed damage on shield or HP; DoT ticks and fully-Barrier-blocked
    // attacks do not count). Live-derived (ConditionContext.wasHitThisRound); defaults false
    // (DPS / not-yet-hit → "not hit" ⇒ met). Used by the Alacrity implant.
    | 'not-hit-this-round'
    | 'first-activator' // D-PR14 Doomsayer: this owner was the first actor to take a REAL
    //                      (non-Stasis/Disable-skipped) turn this round.
    // D-PR16: binary gate — this owner is the SOLE living actor on its own side. Live-derived by
    // the engine each drain (ConditionContext.isLastStanding); defaults false (DPS / not-alone).
    // derivable:true — a derivable:false condition would always be met (evaluateConditions.ts:30).
    // Infrastructure for the Last Stand implant (wired in a later task).
    | 'last-standing'
    // Binary periodic gate: met when the owner's own-turn counter satisfies
    // turnsTaken % period === (offset ?? 0). period/offset live on Condition.
    // Used by Chrono Reaver (every other/third turn). Always derivable:true.
    | 'every-n-turns';

export interface Condition {
    subject: ConditionSubject;
    derivable: boolean;
    manualCount?: number;
    anyOf?: boolean;
    requiredEnemyType?: EnemyBaseClass;
    // For 'enemy-type': when true, the gate means the enemy is NOT `requiredEnemyType`
    // (e.g. "when targeting non-Defenders").
    negate?: boolean;
    buffName?: string;
    hpComparator?: 'below' | 'above';
    hpPercent?: number;
    // For 'hp-threshold': whose HP the threshold applies to. Defaults to 'enemy' (offensive
    // scaling). 'target' = the heal target's live HP%, threaded in healing mode only; defaults
    // to 100 elsewhere (DPS-mode inert — the condition never fires without a live target HP).
    hpSubject?: 'self' | 'enemy' | 'target';
    // Threshold gating for count subjects (buff/debuff/adjacency/destroyed counts).
    // When set, the condition is "met" only when the derived/manual count satisfies
    // the comparator against `countThreshold` (e.g. enemy has ≥3 debuffs, self has 0
    // debuffs). Absent → the default presence rule (count > 0) applies. This gates
    // (conditionsMet) only; per-count scaling (scaledBonus) always uses the raw count.
    countComparator?: 'gte' | 'lte' | 'eq';
    countThreshold?: number;
    /** For 'every-n-turns': the modulo period (e.g. 2 = every other turn). */
    period?: number;
    /** For 'every-n-turns': the residue to match, in [0, period-1] (default 0). E.g.
     *  period 3 + offset 1 → turns 1, 4, 7, …. Out-of-range values never match. */
    offset?: number;
}

/** Gate for a victim-side incoming-effect ability (D-PR3). Evaluated against an
 *  IncomingHitContext at the victim apply site — NOT a ConditionSubject (those are
 *  attacker-turn standing facts; these are per-incoming-hit facts). */
export type IncomingCondition =
    | 'self-stealth' // Voidshade (reduction), Shadowguard (block)
    | 'self-stasis' // Nebula Nullifier (Disable folds in here when modeled)
    | 'incoming-crit' // Hardened set, Iridium
    | 'incoming-crit-by-stealthed' // Hyperion Gaze
    | 'nth-hit-2plus' // Ironclad (block)
    | 'dot-inferno-corrosion'; // Vortex Veil

/** Per-incoming-hit context assembled by the engine at each victim apply site. */
export interface IncomingHitContext {
    didCrit: boolean;
    attackerStealthed: boolean;
    victimStealthed: boolean;
    victimStasised: boolean;
    /** 1-based direct-damage intake index for this victim this round (Ironclad). */
    hitIndexThisRound: number;
    /** Set only on the DoT-tick path (Vortex Veil). */
    dotType?: 'inferno' | 'corrosion';
}

/**
 * Attacker-side condition for an in-flight outgoing-amplification proc, evaluated against the
 * OutgoingHitContext at the attacker's per-hit seam — NOT a ConditionSubject (those gate the
 * buff/modifier fold). Mirrors IncomingCondition on the victim side (D-PR3).
 */
export type OutgoingCondition = 'amplify-on-crit' | 'amplify-vs-higher-attack';

/**
 * Condition for a heal-cast amplification, evaluated against the HealAmpContext at the cast-heal
 * seam (per recipient) — NOT a global ConditionSubject. Mirrors OutgoingCondition (D-PR4).
 */
export type HealAmpCondition = 'target-hp-below-self' | 'target-below-25';

export interface HealAmpContext {
    /** The heal recipient's HP% at cast time. */
    targetHpPct: number;
    /** The caster's HP% at cast time. */
    selfHpPct: number;
}

export interface OutgoingHitContext {
    /** Did this individual hit critically strike? (Menace.) */
    didCrit: boolean;
    /** Is the target's live effective attack higher than the attacker's? (Giant Slayer.) */
    targetHigherAttack: boolean;
}

export interface ScalingRule {
    conditionIndex: number;
    perUnit: number;
    cap?: number;
}

// NOTE: spelling mirrors the existing codebase intentionally — ModifierChannel /
// additional-damage.stat use American 'defense' (like SecondaryDamageStat), while
// ParsedBuffEffects use British 'defence'. Phase 2's applyAbility must map both
// to the same underlying defence stat.
export type ModifierChannel =
    | 'attack'
    | 'defense'
    | 'defensePenetration'
    | 'hp'
    | 'crit'
    | 'critDamage'
    | 'outgoingDamage'
    | 'outgoingHeal'
    | 'incomingDamage';

export type AbilityConfig =
    | { type: 'damage'; multiplier: number; hits?: number; noCrit?: boolean }
    | { type: 'additional-damage'; stat: 'hp' | 'defense'; pct: number }
    | { type: 'modifier'; channel: ModifierChannel; value: number; isMultiplicative: boolean }
    | {
          type: 'buff';
          buffName: string;
          parsedEffects: ParsedBuffEffects;
          stacks: number;
          isStackable: boolean;
          maxStacks?: number;
          stackTrigger?: StackTrigger;
          duration?: number | 'recurring';
          /** "Once per battle" reactive buff grant (Tycho/Shelter/Los on-hp-threshold-crossed
           *  crossing grants): the executor fires AT MOST ONCE per combat, tracked by a
           *  combat-lifetime Set keyed `${ownerId}:${abilityId}` in IntentExecContext.
           *  Absent → unbounded (fires on every qualifying trigger). */
          oncePerCombat?: boolean;
          /** D-PR16: extra buffs granted ALONGSIDE the primary in the SAME application (one proc
           *  roll → all of them). Each carries its own resolved effects + duration. Absent → the
           *  single-buff path is unchanged. */
          additionalBuffs?: Array<{
              buffName: string;
              parsedEffects: ParsedBuffEffects;
              stacks: number;
              isStackable: boolean;
              maxStacks?: number;
              duration: number;
          }>;
      }
    | {
          type: 'debuff';
          buffName: string;
          parsedEffects: ParsedBuffEffects;
          stacks: number;
          isStackable: boolean;
          maxStacks?: number;
          stackTrigger?: StackTrigger;
          application: 'inflict' | 'apply';
          duration?: number | 'recurring';
      }
    | { type: 'dot'; dotType: DoTType; tier: number; stacks: number; duration: number }
    // `scope`: 'active'/undefined extends ALL standing DoT entries (Provider's
    // "extends active Damage Over Time effects"; default + back-compat for stored
    // configs). 'inflicted' extends ONLY the DoT entries this cast just applied
    // (Valerian's "the newly applied Corrosion ... extended by 1 turn").
    | {
          type: 'extend-dot';
          turns: number;
          chanceFromCritPower?: boolean;
          scope?: 'active' | 'inflicted';
      }
    | { type: 'detonate-dot'; dotType: DoTType; powerPct: number }
    // Echoing Burst-style debuff: gathers the direct damage dealt to the enemy while
    // active (`turns`), then detonates for `pct`% of the accumulated total on expiry.
    | { type: 'accumulate-detonate'; turns: number; pct: number }
    | { type: 'charge'; amount: number }
    // A full extra turn: the engine re-inserts the granting actor into the round's
    // remaining turn queue at its speed position (game-verified 2026-06-06).
    | { type: 'extra-action'; oncePerRound: boolean; endOfRound?: boolean }
    | {
          type: 'heal' | 'shield';
          pct: number;
          /** Stat the amount scales from: caster max HP / attack / defence, the
           *  RECIPIENT's max HP ('target-hp' — "of their Max HP"), or a damage-leech
           *  basis: 'damage-dealt' (X% of damage this actor deals — cast rider on
           *  active/charged slots, standing leech on the passive slot) /
           *  'damage-taken' (X% of an enemy attack's damage on this actor; passive
           *  slot, procs only while the actor is the heal target). */
          basis: 'hp' | 'attack' | 'defense' | 'target-hp' | 'damage-dealt' | 'damage-taken';
          /** Pallas/Tithonus: "repair cannot critically hit". Shields never crit regardless. */
          noCrit?: boolean;
          /** Passive-slot 'damage-dealt' only: which credited damage procs the leech.
           *  'all' (default — direct + DoT ticks + detonations, user decision 2026-06-07)
           *  or 'detonation' (Valkyrie: Echoing Burst explosions only). */
          leechScope?: 'all' | 'detonation';
          /** 'damage-taken' only (Quixilver "when taking HP damage and still having
           *  Shield"): proc only when the attack started with shield > 0 AND dealt HP
           *  damage (punched through the pool). Absent → unconditional (Malvex). */
          requiresHpDamage?: boolean;
          /** "Once per battle" reactive repair (Yazid's on-cheat-death-activated 60%
           *  repair): the executor fires its consumption AT MOST ONCE per combat, tracked
           *  by a combat-lifetime Set keyed `${ownerId}:${abilityId}` in IntentExecContext.
           *  Absent → unbounded (fires on every qualifying trigger). */
          oncePerCombat?: boolean;
      }
    | {
          type: 'cleanse' | 'purge';
          count: number | 'all';
          /** E4: purge count scales with a caster stat — total purged =
           *  count × floor(effectiveStat / per). Only `critDamage` (crit power) is
           *  used today (Amartya: "purges 1 buff … for every 50% crit power").
           *  Absent → static `count`. cleanse never sets this. */
          countScaling?: { stat: 'critDamage'; per: number };
          /** Reactive Ward: debuffs to cleanse when the triggering hit was a crit (else `count`).
           *  Read from intent.eventCtx.didCrit by the reactive cleanse executor. cleanse-only. */
          critCount?: number;
          /** 'remove' (default) deletes whole debuffs (cleanse); 'reduce-duration' shaves
           *  `durationTurns` off the newest debuff (Warpstrike). cleanse-only. */
          mode?: 'remove' | 'reduce-duration';
          /** Turns to reduce in 'reduce-duration' mode (default 1). cleanse-only. */
          durationTurns?: number;
      }
    | {
          type: 'control';
          effect: ControlEffect;
      }
    // D-PR3 victim-side incoming-damage reduction (folded at the crit-aware computation sites).
    | {
          type: 'incoming-reduction';
          scope: 'direct' | 'dot';
          condition: IncomingCondition;
          /** Positive magnitude (percentage points); folded as a reduction into the incoming channel. */
          pct: number;
          /** Grouping ONLY: true → take-max crit-reduction family; false → additive.
           *  Orthogonal to the gate — the crit gate is enforced by condition='incoming-crit*'. */
          critFamily: boolean;
      }
    // D-PR3 victim-side proc block (rolled at the applyVictimDamage funnel, byDirectDamage only).
    | {
          type: 'incoming-block';
          condition: IncomingCondition;
          /** 0..1 — reuses D-PR1 procChance semantics (deterministic rate-gate). */
          procChance: number;
          /** 0..1 fraction of the hit blocked (1.0 = full block). */
          blockPct: number;
          oncePerRound: boolean;
      }
    // D-PR4 attacker-side outgoing-damage amplification (folded at the per-hit seam before victim apply).
    | {
          type: 'outgoing-amplification';
          /** Eligibility condition evaluated per hit. */
          condition: OutgoingCondition;
          /** Amplification added to this hit when the proc fires, in percentage points (e.g. 50). */
          ampPct: number;
          /** Per-(owner,ability) proc chance in (0,1). Rolled per eligible hit. */
          procChance: number;
      }
    // D-PR5 caster-side heal amplification (folded at the cast-heal seam per recipient).
    | {
          type: 'heal-amplification';
          condition: HealAmpCondition;
          /** Amplification added to the cast repair when it fires, in percentage points. */
          ampPct: number;
          /** Proc chance in (0,1); ABSENT = deterministic (always fires when gated). */
          procChance?: number;
      }
    // D-PR6 recipient-side incoming heal amplification (unconditional — no condition field).
    | {
          type: 'incoming-heal-amplification';
          /** Amplification added to a repair RECEIVED when it fires, in percentage points. */
          ampPct: number;
          /** Proc chance in (0,1). Rolled once per repair received. */
          procChance: number;
      };

/** Crowd-control effects a `control` ability can apply. The engine does not simulate
 *  these combat effects; the `control-applied` event (events.ts) only exposes the
 *  application moment so reactions (e.g. Defiant's shield-on-Stasis) can fire. */
export type ControlEffect = 'provoke' | 'taunt' | 'stasis' | 'overload' | 'concentrate-fire';

export interface Ability {
    id: string;
    type: AbilityType;
    target: AbilityTarget;
    trigger: AbilityTrigger;
    conditions: Condition[];
    /** Hit filter for attacked-family reactive triggers (on-attacked): 'crit' fires only
     *  on critting hits, 'non-crit' only on non-critting hits. Absent → fires on any hit.
     *  Isha parses as a mutually exclusive pair (3% non-crit / 6% crit — "instead"). */
    triggerCritFilter?: 'crit' | 'non-crit';
    /** Ally-role filter for on-ally-attacked (Graphite "when an ally attacker or
     *  debuffer is directly damaged"): the reaction fires only when the DAMAGED
     *  ally's ship role matches one of these categories (prefix match over
     *  ShipTypeName — 'DEBUFFER' matches every DEBUFFER_* variant). Absent → any
     *  ally. A filter with an UNKNOWN ally role never matches (conservative). */
    roleFilter?: ShipRoleCategory[];
    /** D-PR14 Bulwark: this reactive applies at most once per round per (owner, ability).
     *  Gated executor-side via IntentExecContext.oncePerRoundConsumed (check BEFORE the
     *  proc draw, mark only on a successful proc). Absent → no per-round limit.
     *  NOTE: distinct from the `oncePerRound` flag on the extra-action / incoming-block
     *  AbilityConfig variants — this is the top-level Ability flag (read via
     *  `intent.ability.oncePerRound`), honoring the spec's "no AbilityConfig change". */
    oncePerRound?: boolean;
    /** D-PR14 Bulwark: an on-ally-attacked reactive fires only when the DAMAGED ally is
     *  adjacent to this owner (board neighbours; non-positional → any living same-side ally).
     *  Filtered in the listener via registerReactiveListeners' adjacentAllyIdsFor. Absent →
     *  any ally (existing behavior). */
    requireDamagedAllyAdjacent?: boolean;
    /** D-PR16 Tenacity: gate an `on-attacked` reaction on the per-attack aggregate damage
     *  exceeding this fraction of the owner's effective max HP (e.g. 0.25). Absent → no gate
     *  (byte-identical for every existing on-attacked ability). */
    requireIncomingDamageFracOfMaxHp?: number;
    /** Probabilistic proc gate for equipment-sourced reactive abilities ("N% chance to …").
     *  A value in (0,1) means the ability fires at that rate via a combat-lifetime per-(owner,
     *  ability) RateGate (deterministic accumulator, like crit/landing). Absent or out of (0,1)
     *  → fires on every qualifying trigger. */
    procChance?: number;
    scaling?: ScalingRule;
    config: AbilityConfig;
    autoFilled?: boolean;
}

export interface Skill {
    slot: SkillSlot;
    name?: string;
    abilities: Ability[];
}

export interface ShipSkills {
    slots: Skill[];
    /** True when the ship's passive text declares its attacks don't break Stasis
     *  (Akula / Tygr). Threaded onto CombatActor.doesntBreakStasis by the engine adapter
     *  and gated at the break-mark site (§4.5 Akula exception). */
    doesntBreakStasis?: boolean;
    /** True when the ship's passive text declares immunity to charge loss effects (Lev).
     *  Threaded onto CombatActor.chargeLossImmune by the engine adapter; enemy-sourced
     *  charge removal is a no-op against actors with this flag set. */
    chargeLossImmune?: boolean;
}
