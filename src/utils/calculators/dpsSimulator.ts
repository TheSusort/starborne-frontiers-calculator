import {
    ChargeGain,
    ConditionalDamage,
    DoTApplicationConfig,
    DoTApplicationEntry,
    DoTType,
    EnemyBaseClass,
    SecondaryDamage,
    SelectedGameBuff,
    TeamActorInput,
} from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { AffinityName } from '../../types/ship';
import type { FactionKey } from '../../constants/factions';
import type { ActiveBuff } from '../combat/statusEngine';
import { runCombat, TeamActorEngineInput, CombatEngineInput } from '../combat/engine';
import type { Position } from '../../types/encounters';
import type { ParsedTarget, ParsedPattern } from '../targetingParser';
import type { CombatEventBus, CombatEvent } from '../combat/events';
import { flatInputToAbilities } from '../abilities/flatInputToAbilities';
import { selectFiringSkill } from '../abilities/applyAbilities';
import { toDotAndPenModifiers } from './dpsBuffHelpers';
import { computeAffinityModifiers } from './affinityUtils';
import { actorsDamagePerRound, focusDamagePerRound, focusDamageTotal } from './dpsMetricFromDealt';

/** The engine's focus-actor id (engine.ts:1912 `const focusActorId = 'attacker'`). */
const FOCUS_ACTOR_ID = 'attacker';

// Re-exported so existing importers (e.g. RoundData consumers) keep a single home.
export type { ActiveBuff } from '../combat/statusEngine';

export interface DPSSimulationInput {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    /** Shield penetration for the focus attacker (H1 Task 2). Optional — threaded onto the
     *  attacker actor's stats.shieldPenetration. No production reader until H1 Task 4. */
    shieldPenetration?: number;
    // Flat damage fields are only read by the flatInputToAbilities fallback (when
    // `shipSkills` is omitted). Callers that pass `shipSkills` (the DPS page) skip them.
    activeMultiplier?: number;
    chargedMultiplier?: number;
    chargeCount: number;
    activeDoTs?: DoTApplicationConfig;
    chargedDoTs?: DoTApplicationConfig;
    enemyDefense: number;
    enemyHp: number;
    rounds: number;
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
    startCharged?: boolean;
    /** Percentage additive modifier from affinity (e.g. 25, -25, 0). Applied to all damage types. */
    affinityDamageModifier?: number;
    /** Hard ceiling on effective crit rate from affinity matchup (75 for disadvantage, 100 otherwise). */
    affinityCritCap?: number;
    /** Additive pp reduction on effective crit rate (25 for disadvantage, 0 otherwise). */
    affinityCritPenalty?: number;
    /** RAW affinity of the focus attacker — the SAME matchup the page resolved into the pre-resolved
     *  affinityDamageModifier/affinityCritCap/affinityCritPenalty above, so the two never disagree
     *  (positional plumbing; forwarded to the engine's attackerAffinity). Absent → neutral default. */
    affinity?: AffinityName;
    /** Attacker hacking stat. Landing chance = clamp(hacking - enemySecurity, 0, 100) / 100. Default 200. */
    hacking?: number;
    /** Defender security stat. Default 100. */
    enemySecurity?: number;
    /** Source stat for Defense-based secondary damage. */
    defence?: number;
    /** Source stat for HP-based secondary damage. */
    hp?: number;
    /** Secondary damage applied on active-skill rounds. */
    activeSecondary?: SecondaryDamage;
    /** Secondary damage applied on charged-skill rounds. */
    chargedSecondary?: SecondaryDamage;
    /** Conditional scaling bonus applied on active-skill rounds. */
    activeConditional?: ConditionalDamage;
    /** Conditional scaling bonus applied on charged-skill rounds. */
    chargedConditional?: ConditionalDamage;
    /** Per-round self charge gain parsed from the attacker's skill text. */
    selfChargeGain?: ChargeGain;
    /** Flat extra charges per round contributed by allies/supporters. */
    allyChargePerRound?: number;
    /** Enemy base class, for the 'enemy-type' charge-gain condition. */
    enemyType?: EnemyBaseClass;
    /** Enemy affinity — vs each walked team actor's affinity yields that actor's own
     *  damage/crit modifiers (computeAffinityModifiers). Absent → neutral defaults.
     *
     *  It ALSO reaches the enemy actor itself: `synthesizedDpsEnemy` stamps it onto the
     *  synthesized enemy's `affinity`, so the positional apply can recompute each matchup
     *  per victim. That is now the ONLY channel by which affinity moves the focus's damage.
     *  This doc used to say the attacker's matchup "is still passed pre-resolved via
     *  affinityDamageModifier etc. (the page resolves it)" — true of the pre-resolved fields
     *  above, but MISLEADING as a statement about what damage reads: on the positional path
     *  those scalars are inert, and the apply recomputes from the raw `affinity` pair
     *  (focus `affinity` + this field). SP-4b-2a Task 5 fixed the page to pass both raw
     *  values; before that, changing the affinity selection did not move the number at all. */
    enemyAffinity?: AffinityName;
    /** Attacker turn-order speed. Default 100. */
    speed?: number;
    /** Enemy turn-order speed. Default 50 — the enemy acts last at default speeds. */
    enemySpeed?: number;
    /** #363 follow-up: the focus attacker's own ship faction, for `factionFilter`'d ally scopes
     *  (Fuying's "grants Tianchao allies Stealth"). Team actors carry their own `faction` on
     *  `TeamActorInput` (already threaded — `deriveTeamEngineActors` spreads it through
     *  unchanged). Absent (manual config, no ship picked) → unknown faction → the focus never
     *  matches a faction filter (conservative), mirroring the healing adapter's `healerFaction`. */
    faction?: FactionKey;
    /** #426: the focus attacker's SHIP name, for the live `ally-on-team` roster check
     *  (Isha/Nayra's reciprocal Affinity Override gate). Supply the picked ship's real name —
     *  NOT the config's display label, which is a placeholder like "Ship 1" for a manual config.
     *
     *  Absent → `nameByActorId` may stay empty → `allyTeamNames` is undefined → `ally-on-team`
     *  keeps its assume-met fallback, which is the correct answer for a manual config (there is no
     *  ship, so "is X on the same team" cannot be asked). Present → the gate goes LIVE, and since
     *  `allyTeamNames` excludes the owner itself, a solo named focus yields `[]` and a
     *  "if X is on the same team" gate correctly reads NOT-met. */
    name?: string;
    /** Skill model. When omitted, derived from the flat fields via flatInputToAbilities. */
    shipSkills?: ShipSkills;
    /** Team ships as real speed-ordered actors (Phase 2). When present, their buffs enter
     *  the sim HERE — keyed to their own turns. Do NOT also merge them into selfBuffs/
     *  enemyDebuffs (no-double-count). */
    teamActors?: TeamActorInput[];
    /** Optional emit-only event tap forwarded to the combat engine. Listeners must not
     *  read or mutate combat state (Phase 3 contract). */
    bus?: CombatEventBus;
    /** SP-2: opt in to the display-only status timeline (`focusStatsSnapshots`, `focusStatuses`,
     *  `enemyStatuses` on each RoundData row). OFF by default and deliberately so: a focus stats
     *  snapshot exists in every round of every run, so attaching it unconditionally would rewrite
     *  the whole 8900-line `dpsGoldenParity` snapshot with display payload. Collection is a pure
     *  emit-only tap — no sim number depends on it, in either position. */
    collectStatusTimeline?: boolean;
    /** Real, positioned enemy ships. Reuses the engine's own shape — deliberately not a
     *  parallel type.
     *
     *  OPTIONAL, but no longer the switch between two run shapes: since SP-4b-2a a caller that
     *  supplies none gets one SYNTHESIZED from the scalar fields (`synthesizedDpsEnemy`), so
     *  `simulateDPS` always hands `runCombat` a non-empty roster — the focus's damage always
     *  lands per-victim on real actors. (The engine's roster-emptiness discriminator and the
     *  vestigial dummy it selected were deleted in SP-4c-2d.) Supply this to CHOOSE the
     *  enemy (a real ship with skills, several enemies, an explicit slot); omit it to accept the
     *  0-attack stream-inert stand-in built from `enemyHp`/`enemyDefense`/`enemySpeed`/
     *  `enemySecurity`/`enemyAffinity`. Past `effectiveEnemyAttackers` the two are
     *  indistinguishable. */
    enemyAttackers?: NonNullable<CombatEngineInput['enemyAttackers']>;
    /** Board slot of the focus attacker. Optional since SP-4b-1: `normalizeCombatRoster` — the
     *  engine's accommodation boundary, `runCombat`'s first line — auto-places any actor that
     *  arrives without one (`DEFAULT_ATTACKER_SLOT` for the focus). Supply it to CHOOSE the cell;
     *  omitting it no longer sends the focus to the dummy. */
    position?: Position;
    /** Pre-parsed targeting preference for the focus attacker. Also optional since SP-4b-1 — the
     *  boundary fills an absent one with `DEFAULT_FRONT_ENEMY_TARGET`. Without that fill,
     *  `selectTurnTarget` (which requires `resolvesPositionalVictim(...) && target`) would resolve
     *  NO victim however well-positioned the roster is — the focus would run a no-victim turn and
     *  its offensive clause would deliver nothing — which is precisely why the boundary fills it.
     *  History: before SP-4c-2b the same miss short-circuited to `legacyVictim` (the dummy), and
     *  before SP-4c-2c it ALSO kept the dummy in the turn order via the `dummyEnemyIsVestigial`
     *  gate's `t?.side === 'enemy'` conjunct. Both the gate and the actor are gone (SP-4c-2c /
     *  SP-4c-2d). */
    target?: ParsedTarget;
    /** Pre-parsed positional pattern for the focus attacker — drives footprint expansion at the
     *  positional apply site. A single-target 1v1 wants shape 'base', which is exactly what the
     *  boundary's `DEFAULT_BASE_PATTERN` fill supplies when this is absent. */
    pattern?: ParsedPattern;
}

/** SP-2: one focus-actor turn-start stat reading. Derived from the engine's `stats-snapshot`
 *  payload rather than redeclared, so a stat added to the event cannot silently go missing here. */
export type RoundStatsSnapshot = Extract<CombatEvent, { type: 'stats-snapshot' }>['stats'];

/** SP-2: one actor's ROUND-TAIL status names (post decrement + drain). */
export interface RoundActorStatuses {
    buffNames: string[];
    debuffNames: string[];
}

export interface RoundData {
    round: number;
    action: 'active' | 'charged';
    charges: number;
    /** Charges required to fire the charged skill; 0 when the ship has no charged skill. */
    chargeCount: number;
    /** This round's deterministic binary crit outcome (per-stream schedule). */
    didCrit: boolean;
    /** Enemy HP% ENTERING this round (100 → 0) — the value hp-threshold conditions evaluated during
     *  the round were gated against, which is why it stays the ENTERING reading rather than the
     *  more obvious end-of-round one: a row showing 25% beside an execute rider that did not fire
     *  would contradict itself.
     *
     *  #341: this is the enemy ROSTER's HP-weighted remainder, snapshotted at the round head. It
     *  used to be read off the focus's STRUCK VICTIM at its last turn of the round, which was wrong
     *  in two ways. A row whose focus struck nobody — an ally-targeted cast, or a synthesized skip
     *  row after the focus died — had no victim to read, and took a fabricated 100: the chart said
     *  "Enemy HP: 100%" with the real enemy at 12%. And on a round where a faster ally acted first,
     *  the "entering" value silently included that ally's damage. The DPS page fields exactly one
     *  enemy, so this IS that enemy's own live HP%; the weighting (same convention as `finalHpPct`)
     *  keeps it honest if the page ever fields more. */
    enemyHpPct: number;
    /** Direct (non-DoT, non-detonation) damage the focus dealt this round.
     *
     *  RE-DERIVED BY SUBTRACTION on the DPS path, not read from the engine's row: the positional
     *  apply suppresses `creditDamage(actor,'direct',…)`, so the engine's own `directDamage`
     *  reads ~0 for a real-enemy run. `simulateDPS` recomputes it as the focus's `perTargetDealt`
     *  total minus the honest per-kind rows below (corrosion + inferno + generic + detonation),
     *  clamped at 0. It is the ONLY per-kind row that needs this — see the derivation comment in
     *  `simulateDPS` for why reading `perTargetDealt` directly would double-count DoT ticks. */
    directDamage: number;
    corrosionDamage: number;
    infernoDamage: number;
    /**
     * Absolute-per-tick generic DoT damage this round: a direct hit the VICTIM converted into a
     * DoT (`convertHitToSelfDot` — Voron/Orel's transform, Oleander's Hit Mitigation), credited
     * to whoever threw the converted hit.
     *
     * DIAGNOSTIC, not a display row. Unlike corrosionDamage/infernoDamage this damage is already
     * INSIDE `directDamage` — the owner's ruling is that a converted hit stays part of the normal
     * Direct total rather than earning a fifth tooltip row. So a consumer summing the rows must
     * NOT add this one, and a consumer asking "how much of Direct arrived as a converted hit?"
     * reads it.
     *
     * Set ONLY when nonzero, so a round in which nothing was converted keeps the legacy shape.
     */
    genericDamage?: number;
    /** Detonation damage this round: Bomb detonations + DoT detonations (game-categorised together). */
    detonationDamage: number;
    /** All-channel damage the focus dealt this round, and the running sum of it. Both are
     *  RE-DERIVED by `simulateDPS` from the focus's `perTargetDealt` totals (same reason
     *  `directDamage` is) and INTEGERS — the engine wrote `Math.round(...)` into them and the
     *  chart prints them with `toLocaleString()`. The running sum accumulates the RAW values and
     *  rounds only for display, so the last row's `cumulativeDamage` equals
     *  `summary.totalDamage` exactly. */
    totalRoundDamage: number;
    cumulativeDamage: number;
    /** All-channel damage the WHOLE PLAYER SIDE dealt this round — the focus INCLUDED, plus every
     *  walked team actor: direct (incl. its secondary/conditional components), DoT ticks from
     *  entries any of them applied, and detonation bursts from their bombs/accumulators. Set ONLY
     *  when walked team actors exist; undefined on attacker-only runs (legacy RoundData shape
     *  preserved), so PRESENCE means "this run had team ships" and the VALUE is the side total.
     *
     *  ⚠️ The focus is IN this number (#331, owner ruling). It used to be non-focus-only, which
     *  made it unusable for the comparison the DPS page exists for: swapping the focus ship changes
     *  what the rest of the team does — its buffs raise their damage, its casts feed their reactions
     *  — so the question is "what does this side put out with this ship in it", and neither the
     *  focus's own total nor the others' total answers it alone. Subtract `totalRoundDamage` if you
     *  want the team's own contribution back.
     *
     *  RE-DERIVED alongside the focus's rows (SP-4b-1), from `perTargetDealt` over the whole
     *  player-side id list. The engine's own scalar fold reads 0 for any actor that resolved
     *  positionally — which is now every DPS-page run — so it is not a usable source; see the
     *  ⚠️ note at `teamRoundDamage` in engine.ts. As a DAMAGE-DEALT sum this books overkill on a
     *  killing round. */
    teamDamage?: number;
    /** Number of EXTRA focus-actor turns this round (extra actions). Set only when
     *  ≥ 1 — undefined preserves the legacy RoundData shape (golden snapshots). */
    extraTurns?: number;
    /** Victim actor id → total damage dealt TO it this round, keyed by victim regardless of
     *  attacker side. In a round where both sides act positionally this map contains BOTH enemy
     *  victims (from player/team fire) AND player victims (from enemy fire) — do NOT sum it as
     *  one-directional output. Populated ONLY by the positional apply path (gated on positions +
     *  pattern); absent in non-positional runs. */
    perTargetDamage?: Record<string, number>;
    /** SP-F F1: attacker id -> victim id -> total damage DEALT to that victim THIS round by that
     *  attacker, mirroring EVERY supported `roundPerTargetDamage`/`perTargetDamage` increment above
     *  to its correct source-attacker (not always the acting/turn-owning actor — reflect's source
     *  is the reflector, counter's is the counter owner, a DoT tick's is that tick's own applier,
     *  etc). For attackers/victims covered by this channel, Σ over victims for one attacker ==
     *  that attacker's `damageDealt` (battleSimulator.ts) and Σ over attackers for one victim ==
     *  `perTargetDamage[victim]` — so `damageDealt`/`damageTaken` reconcile for supported targeted
     *  positional writes. This is NOT an unconditional guarantee: it excludes actors with no
     *  targeting data (case-c) and focus-target DoT (healTarget defaults to focus, so it never
     *  books here); it also
     *  inherits the Protection redirect double-count and the Protection DoT-tick-batch redirect
     *  gap (no single source attacker to mirror to). Set ONLY when non-empty (mirrors
     *  `perTargetDamage`'s "absent when empty" rule, goldens byte-identical). DoT-tick
     *  contributions land in the TICK round (the ticking victim's own turn-start), not the cast
     *  round — same pre-existing timing `perTargetDamage` already has for DoT ticks.
     *
     *  REACTIVE DAMAGE **IS** INCLUDED, and this comment used to say the opposite.
     *  `applyReactiveDamage` writes here via `creditDealt` (shipped in #318); `applyCounterAttack`
     *  and reflect write it unconditionally too. It used to fall back to credit-only
     *  `creditDamage` on a run with no positioned enemy roster, but SP-4c-2d deleted that arm —
     *  the roster is always positioned below the normalization boundary. Verified empirically
     *  across four reactive shapes — start-of-round proc, adjacent-ally retaliation, reflect, and a
     *  true on-attacked counter — each crediting this channel keyed by the reacting actor.
     *
     *  The stale claim was not harmless: it is what made a reviewer report `teamDamage` as
     *  under-counting reactive damage (PR #324), a Major finding that measurement disproved. A
     *  comment describing a channel's CONTENTS is load-bearing documentation — reviewers reason
     *  from it. */
    perTargetDealt?: Record<string, Record<string, number>>;
    /** Per-actor shield accounting for THIS round (H1 Task 6), keyed by actor id. For each actor:
     *  `granted` = total shield actually added to its pool this round (post-cap delta);
     *  `absorbed` = shield drained by incoming damage this round; `pool` = its live remaining
     *  shieldPool at end-of-round. Set ONLY when at least one actor has a nonzero entry — absent
     *  on shield-free rounds (legacy RoundData shape preserved, goldens byte-identical). Consumed
     *  by the battle simulator surfacing (Task 8). */
    perActorShield?: Record<string, { granted: number; absorbed: number; pool: number }>;
    /** Per-actor reflected-thorns damage dealt back to it THIS round (Reflect gear set), keyed by
     *  the ATTACKER's actor id. Set ONLY when at least one actor took reflected damage — absent on
     *  reflection-free rounds (legacy RoundData shape preserved, goldens byte-identical). The
     *  reflected amount also surfaces automatically as the attacker's incoming damage (via the
     *  intake sink); this map is the dedicated attribution for surfacing. */
    perActorReflected?: Record<string, number>;
    /** Bomb-splash-on-death: adjacent-ally actor id → total splash damage dealt to it THIS round
     *  by dying bombed allies (positional only). Set ONLY when at least one ally took splash —
     *  absent otherwise (non-positional / no-splash rounds keep the legacy RoundData shape,
     *  goldens byte-identical). The splash is ALSO folded into perTargetDamage for that ally. */
    perActorSplash?: Record<string, number>;
    /** Per-victim skill-triggered detonation (positional only): detonating actor id → total
     *  detonation damage it dealt across footprint victims THIS round. Set ONLY when the positional
     *  detonation loop dealt damage (map non-empty) — absent otherwise (non-positional rounds keep
     *  the legacy RoundData shape, goldens byte-identical). The detonation also lands per-victim via
     *  applyVictimDamage (surfaced in perTargetDamage); this map is the dedicated attribution. */
    perActorDetonation?: Record<string, number>;
    /** Per-victim incoming-damage accounting for THIS round (PR7), keyed by victim id:
     *  `incoming` = total damage taken, `shieldAbsorbed` = shield drained, `barrierAbsorbed`
     *  = barrier-blocked, `convertedToShield` = nullified by `Shield Converter` and turned into
     *  Shield instead. Set ONLY when at least one actor has a nonzero entry — absent on
     *  rounds without per-victim intake (legacy RoundData shape preserved, goldens byte-identical).
     *
     *  #358 ADDENDUM 2/3: `incomingRaw` is `incoming` BEFORE **every victim-side reduction** — the
     *  raw damage THROWN at it. Not just defence: also the victim's own `Inc. Damage Down` family,
     *  its pre-fight incoming baseline, `equipReductionPct`, `incomingDotReductionPct` and the
     *  reflect channel's incoming-reduction. (Addendum 2 stripped only the defence factor; addendum
     *  3 widened it to the full list, so "before the victim's defence-mitigation factor" now
     *  under-states what this axis excludes.) Attacker-side modifiers and enemy-APPLIED
     *  amplification (`Out. Damage Up`, `Exposed`) stay IN.
     *  `incoming` is what got THROUGH, so it FALLS as a ship gets tankier; `incomingRaw` is
     *  therefore the axis the "Damage absorbed" headline reads, and is `>= incoming` OVER A WINDOW
     *  SUM — equal when the victim applies no reduction at all. NOT per round: the DoT transform
     *  books the full raw amount at THROW time while the ticks that re-book the deferred slice carry
     *  `perTickPreMitigation: 0` and contribute real post damage, so a single later round can read
     *  lower on this axis than on `incoming`. It is NOT a term of the intake breakdown:
     *  `shieldAbsorbed`/`barrierAbsorbed`/`convertedToShield` partition `incoming`, and mixing the
     *  two axes breaks that identity. */
    perActorIncoming?: Record<
        string,
        {
            incoming: number;
            incomingRaw: number;
            shieldAbsorbed: number;
            barrierAbsorbed: number;
            convertedToShield: number;
        }
    >;
    /** SP-2: every focus-actor `stats-snapshot` of this round, in turn order — 2+ entries when an
     *  extra action gave the focus a second turn, which is exactly what makes the summary's
     *  turn-weighted average expressible. Each reading is taken AT TURN START; round 1 therefore
     *  reads PRE-cast (an on-cast self-buff first appears in the next snapshot). Populated only under
     *  `collectStatusTimeline` — display-only, never read by the sim. */
    focusStatsSnapshots?: RoundStatsSnapshot[];
    /** SP-2: the focus actor's ROUND-TAIL status names — what it still carries after every
     *  decrement and drain. Distinct from `activeSelfBuffs`, which is the focus's own TURN-time
     *  view: a self-buff granted on the focus's own turn shows in both, but one that expires at
     *  the round tail shows only in the turn-time list. Populated only under
     *  `collectStatusTimeline`, and only when at least one name is present. */
    focusStatuses?: RoundActorStatuses;
    /** SP-2: round-tail status names per REAL enemy actor id — only ids in
     *  `effectiveEnemyAttackers` are kept, so the focus's and the team's own snapshots stay out.
     *  (The vestigial dummy this filter also used to exclude was deleted in SP-4c-2d.) The side-wide
     *  SCHEDULED enemy-debuff bucket keys under the `__enemy__` sentinel store rather than any actor
     *  id, so it never appears in these per-actor lists either. Keyed by id
     *  rather than collapsed to one entry: a roster is not its first member (the defect #318 fixed
     *  in `finalHpPct`). Populated only under `collectStatusTimeline`, and only for actors carrying
     *  at least one name. */
    enemyStatuses?: Record<string, RoundActorStatuses>;
    /** SP-4b-2 D3: BOARD-WIDE totals — the SUM across every enemy-side DoT carrier at round tail
     *  (every positioned enemy; the vestigial dummy sink was a carrier too until SP-4c-2d deleted
     *  it) that still REPORTS. Stacks and bomb
     *  entries are extensive quantities, so they add; this is deliberately not `finalHpPct`'s
     *  HP-weighted treatment, which exists because HP% is an intensive per-actor ratio. On the
     *  usual 1-enemy board these are that enemy's own totals. `activeBombCount` counts bomb
     *  ENTRIES, not stacks.
     *
     *  CORPSES ARE EXCLUDED (`dotCarrierReports`, engine.ts): a destroyed POSITIONED enemy is
     *  skipped before its DoT-tick prologue and nothing clears its containers, so its stacks are
     *  frozen leftovers that deal nothing and never expire. The dummy sink used to be EXEMPT from
     *  that exclusion and kept reporting after it died; `dotCarrierReports` lost the exemption along
     *  with the actor in SP-4c-2d, so the corpse exclusion is now unconditional. */
    activeCorrosionStacks: number;
    activeInfernoStacks: number;
    activeBombCount: number;
    activeSelfBuffs: ActiveBuff[];
    activeEnemyDebuffs: ActiveBuff[];
    resistedEnemyDebuffs: ActiveBuff[];
    appliedDoTs: DoTApplicationEntry[];
    dotsLanded: boolean;
    /** SP-4b-2 D3: the UNION of every STILL-REPORTING enemy-side carrier's standing DoT entries
     *  (same `dotCarrierReports` corpse exclusion as the three counts above), grouped TYPE-MAJOR
     *  (all carriers' corrosion, then inferno, then bombs, then generic) with board order inside
     *  each type. A list is the one shape with a lossless multi-carrier answer, so entries are
     *  concatenated rather than collapsed onto a representative enemy. */
    activeDoTStates: ActiveDoTState[];
}

export interface DPSSimulationSummary {
    totalDamage: number;
    avgDamagePerRound: number;
    /** Round the LAST real enemy fell; undefined while any of them survived the window.
     *  Re-derived from `ship-destroyed`. The engine used to expose an `enemyOutcome` block, but it
     *  read the never-dying dummy and was deleted with it in SP-4c-2d. */
    roundsToKill?: number;
    /** True while ANY real enemy is still standing at the end of the window. */
    survived: boolean;
    /** HP-WEIGHTED remainder across the WHOLE real enemy roster (0 when every one is dead), not
     *  `enemyAttackers[0]`'s percentage — weighted by max HP so a big enemy counts for more.
     *  With the single enemy the UI ships this is just that enemy's own HP%. */
    finalHpPct: number;
    /** Total direct damage across all rounds — the sum of the re-derived per-round
     *  `RoundData.directDamage` (see its note), NOT the engine's `rawTotals.direct`, which the
     *  positional path's suppressed credit leaves at 0. */
    totalDirectDamage: number;
    totalCorrosionDamage: number;
    totalInfernoDamage: number;
    totalDetonationDamage: number;
    totalSecondaryDamage: number;
    totalConditionalDamage: number;
    /** Total damage the WHOLE PLAYER SIDE dealt across all rounds — the focus INCLUDED (#331; see
     *  `RoundData.teamDamage` for why). Present only when walked team actors exist. The focus-only
     *  DPS fields above are unaffected: subtract `totalDamage` to recover the team's own share. */
    teamTotalDamage?: number;
}

export interface DPSSimulationResult {
    rounds: RoundData[];
    summary: DPSSimulationSummary;
}

export interface ActiveDoTState {
    // SP-E: widened to DoTType (was 'corrosion' | 'inferno' | 'bomb') so a generic entry can
    // surface in the active-DoT display panel.
    type: DoTType;
    tier: number;
    stacks: number;
    ticksRemaining: number;
}

/**
 * Per-walked-team-actor engine-input derivation, shared by the DPS and healing adapters.
 * For each team actor carrying shipSkills (and stats), resolve its OWN rates exactly as the
 * attacker's are resolved — landing chance from ITS hacking vs the enemy security with ITS
 * affinity damage modifier, and affinity damage/crit modifiers from ITS affinity vs the enemy.
 * The walked actor's selfDotModifier/defensePenetrationBuff start at 0 (its walked statuses
 * produce those in-loop). A legacy team actor (no shipSkills/stats) passes through unchanged.
 *
 * `healModifier` IS threaded from `CombatStatBlock.healModifier` (default 0 when absent) into
 * the walk bundle, so walked team actors fold their own heal-modifier into heal casts (the
 * engine reads it off the walk bundle). Fixtures without it default to modifier 0 (unchanged).
 *
 * Returns undefined when `teamActors` is undefined (preserves the DPS-path shape).
 */
export function deriveTeamEngineActors(
    teamActors: TeamActorInput[] | undefined,
    enemyAffinity: AffinityName | undefined
): TeamActorEngineInput[] | undefined {
    return teamActors?.map((t) => {
        if (!t.shipSkills || !t.stats) return t;
        const aff = computeAffinityModifiers(t.affinity, enemyAffinity);
        const teamCharged = selectFiringSkill(t.shipSkills, 'charged');
        const teamHasChargedSkill = t.chargeCount >= 1 && (teamCharged?.abilities.length ?? 0) > 0;
        return {
            ...t,
            walk: {
                shipSkills: t.shipSkills,
                stats: t.stats,
                healModifier: t.stats.healModifier ?? 0,
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: aff.damageModifier,
                affinityCritCap: aff.critCap,
                affinityCritPenalty: aff.critPenalty,
                // RAW affinity — the SAME t.affinity fed to computeAffinityModifiers above, so the
                // walk bundle's affinityDamageModifier and attackerAffinity never disagree
                // (positional plumbing; the engine threads it onto the runtime's attackerAffinity).
                affinity: t.affinity,
                hasChargedSkill: teamHasChargedSkill,
            },
        };
    });
}

/** The id every synthesized DPS enemy carries — the same one `DPSCalculatorPage` gives its explicit
 *  roster entry, so a caller that graduates from synthesis to a real ship keeps its per-victim keys. */
export const SYNTHESIZED_DPS_ENEMY_ID = 'enemy-1';

/**
 * The real enemy a scalar-only DPS caller gets (SP-4b-2a).
 *
 * `attack: 0` and no `shipSkills` are load-bearing, not laziness: a 0-attack, skill-less positioned
 * enemy is RNG-stream-INERT (rate gates are keyed per actor id), so supplying it moves neither the
 * totals nor the crit sequence of the run it joins. An enemy that ACTS would move every number.
 *
 * INERT IS NOT ABSENT, and the distinction is measured, not assumed. This actor still takes a turn:
 * it appears in the turn order and emits one zero-damage `ability-performed` per round. So a fixture
 * counting EVENTS or asserting a turn-order array sees it, while one asserting damage totals or crit
 * sequences does not. A consumer that wants focus-only accounting filters on the actor id — it does
 * not get to assume the roster is a singleton.
 *
 * Position and targeting are deliberately absent — `normalizeCombatRoster`, the engine's ONE
 * accommodation boundary, places and targets it (SP-4b-1). Filling them here would be a second
 * derivation of the same defaults.
 */
function synthesizedDpsEnemy(args: {
    enemyHp: number;
    enemyDefense: number;
    enemySpeed: number | undefined;
    enemySecurity: number;
    enemyAffinity: AffinityName | undefined;
}): NonNullable<CombatEngineInput['enemyAttackers']>[number] {
    return {
        id: SYNTHESIZED_DPS_ENEMY_ID,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            // 50 was the engine's own dummy-actor default (`enemySpeed ?? 50`) before SP-4c-2d
            // deleted that actor and every read of the field — this line is now the only place the
            // default lives. Kept at 50 so the enemy still acts last at default speeds: turn order
            // must not shift for a caller that set nothing.
            speed: args.enemySpeed ?? 50,
            defence: args.enemyDefense,
            hp: args.enemyHp,
            security: args.enemySecurity,
        },
        chargeCount: 0,
        startCharged: false,
        ...(args.enemyAffinity ? { affinity: args.enemyAffinity } : {}),
    };
}

/**
 * Thin adapter over the combat engine (`src/utils/combat/engine.ts`). This derives
 * the engine's input from the public DPS input — landing chance, the static
 * defPen/dot self-buff fold, the flat-fields fallback, and the charged-skill check —
 * then calls `runCombat` and builds the summary. The per-round simulation itself
 * lives in the engine (relocated from the former `runSinglePass`).
 */
export function simulateDPS(input: DPSSimulationInput): DPSSimulationResult {
    const {
        attack,
        crit,
        critDamage,
        defensePenetration,
        chargeCount,
        enemyDefense,
        enemyHp,
        rounds: numRounds,
        selfBuffs,
        enemyDebuffs,
        defence = 0,
        hp = 0,
        allyChargePerRound,
        enemyType,
        speed,
        enemySpeed,
        teamActors,
    } = input;
    const { affinityDamageModifier = 0, affinityCritCap = 100, affinityCritPenalty = 0 } = input;

    const hacking = input.hacking ?? 200;
    const enemySecurity = input.enemySecurity ?? 100;

    // A DPS run ALWAYS faces a real, positioned enemy now (SP-4b-2a). A caller that supplies none
    // gets one built from the scalar inputs it did supply — which is what `DPSCalculatorPage` has
    // passed explicitly since SP-1, so this closes the last DPS path that reached the dummy sink.
    // `DPSSimulationInput.enemyAttackers` stays OPTIONAL: it is the UI-facing input, and the
    // scalars stay with it (they are calculator fields, not engine dummy scalars — SP-4 §9).
    // Every downstream reader of "the real enemy roster" uses THIS, not `input.enemyAttackers`
    // directly, so a scalar-only caller is indistinguishable from an explicit one past this point.
    const effectiveEnemyAttackers: NonNullable<CombatEngineInput['enemyAttackers']> = input
        .enemyAttackers?.length
        ? input.enemyAttackers
        : [
              synthesizedDpsEnemy({
                  enemyHp,
                  enemyDefense,
                  enemySpeed,
                  enemySecurity,
                  enemyAffinity: input.enemyAffinity,
              }),
          ];

    // Self-side constants (not subject to rolls)
    const { defensePenetrationBuff, dotDamageModifier: selfDotModifier } = toDotAndPenModifiers(
        selfBuffs,
        []
    );
    const shipSkills = input.shipSkills ?? flatInputToAbilities(input);
    const chargedSkill = selectFiringSkill(shipSkills, 'charged');
    // A charged skill "exists" when the slot carries ANY ability — damage or pure
    // utility (buffs/debuffs). Utility charged skills bank charges and fire
    // zero-damage charged turns whose statuses apply (spec: hasChargedSkill widening).
    const hasChargedSkill = chargeCount >= 1 && (chargedSkill?.abilities.length ?? 0) > 0;

    // Per-walked-team-actor derivation (Task 4), extracted into a shared helper so the
    // healing adapter reuses byte-identical walk logic (goldens prove the extraction is
    // behaviour-preserving).
    const engineTeamActors = deriveTeamEngineActors(teamActors, input.enemyAffinity);
    const hasWalkedTeam = !!engineTeamActors?.some((t) => t.walk);

    // The engine used to return an `enemyOutcome` block derived from the vestigial DUMMY, which had
    // billions of HP and never died — so it always reported `survived: true` /
    // `roundsToKill: undefined` and was unusable here. SP-4c-2d deleted the field for exactly that
    // reason; there is no engine-side outcome to prefer any more. Capture the REAL enemies' deaths
    // off an emit-only bus tap and re-derive below — same defect class as `cumulativeDamage`, same
    // remedy.
    const realEnemyIds = new Set(effectiveEnemyAttackers.map((e) => e.id));
    const realEnemyDeathRound = new Map<string, number>();
    /** Last `hp-changed` percentage seen per real enemy. Integer-granular and only emitted on
     *  change, so a missing entry legitimately means "untouched" → 100. */
    const realEnemyHpPct = new Map<string, number>();

    // SP-2 display timeline, keyed by round. Collected only under the opt-in flag so the goldens
    // (whole-result snapshots) stay byte-identical for every existing caller.
    const collectTimeline = input.collectStatusTimeline === true;
    const focusStatsByRound = new Map<number, RoundStatsSnapshot[]>();
    const focusStatusByRound = new Map<number, RoundActorStatuses>();
    const enemyStatusByRound = new Map<number, Record<string, RoundActorStatuses>>();

    // Always a wrapper now (SP-1 built it only when a real enemy was present). `runCombat` treats
    // an external bus as a WRITE-ONLY tap that fans out before its own reactive listeners
    // (engine.ts:1695-1709), so wrapping is observation, never mutation — and forwarding to
    // `input.bus` last preserves the caller's view of the stream.
    const collectingBus: CombatEventBus = {
        on: () => {},
        emit: (e) => {
            if (
                e.type === 'ship-destroyed' &&
                realEnemyIds.has(e.actorId) &&
                !realEnemyDeathRound.has(e.actorId)
            ) {
                realEnemyDeathRound.set(e.actorId, e.round);
            }
            if (e.type === 'hp-changed' && realEnemyIds.has(e.targetId)) {
                realEnemyHpPct.set(e.targetId, e.newPct);
            }
            if (collectTimeline) {
                if (e.type === 'stats-snapshot' && e.actorId === FOCUS_ACTOR_ID) {
                    const forRound = focusStatsByRound.get(e.round);
                    if (forRound) forRound.push(e.stats);
                    else focusStatsByRound.set(e.round, [e.stats]);
                }
                if (e.type === 'status-snapshot') {
                    const statuses = { buffNames: e.buffNames, debuffNames: e.debuffNames };
                    if (e.actorId === FOCUS_ACTOR_ID) {
                        focusStatusByRound.set(e.round, statuses);
                    } else if (realEnemyIds.has(e.actorId)) {
                        const byId = enemyStatusByRound.get(e.round) ?? {};
                        byId[e.actorId] = statuses;
                        enemyStatusByRound.set(e.round, byId);
                    }
                }
            }
            input.bus?.emit(e);
        },
    };

    const { rounds, rawTotals } = runCombat({
        attack,
        crit,
        critDamage,
        defensePenetration,
        shieldPenetration: input.shieldPenetration,
        chargeCount,
        shipSkills,
        mode: 'dps',
        numRounds,
        selfBuffs,
        enemyDebuffs,
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged: input.startCharged ?? false,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        // RAW focus affinity — same matchup as the pre-resolved affinityDamageModifier above
        // (positional plumbing; the engine threads it onto the focus runtime's attackerAffinity).
        affinity: input.affinity,
        // #363 follow-up: the focus's own faction, mirroring how `affinity` is threaded above —
        // this was missing entirely before, so a Fuying focus attacker's faction-scoped grant
        // could never include herself as a recipient (see DPSSimulationInput.faction's doc).
        faction: input.faction,
        // #426: threaded so `nameByActorId` is non-empty whenever a real ship was picked, which is
        // what switches `ally-on-team` from assume-met to a live roster check. Mirrors `faction`
        // above; team actors carry their own `name` through `deriveTeamEngineActors`' spread.
        name: input.name,
        defence,
        hp,
        // Base hacking/security (A2 Task 2) — the OLD landing-formula defaults (200 / 100) applied at
        // this boundary. `hacking` is threaded onto the focus attacker's base; `enemySecurity`'s
        // resolved value reaches the fight through `synthesizedDpsEnemy`'s `security` instead — the
        // engine no longer has a fight-wide `enemySecurity` field to accept it. No production reader
        // yet for `hacking` (A2 Task 4).
        hacking,
        allyChargePerRound,
        enemyType,
        speed,
        teamActors: engineTeamActors,
        bus: collectingBus,
        // A DPS run ALWAYS faces a real, positioned enemy now (`effectiveEnemyAttackers`, derived
        // above from `input.enemyAttackers` when supplied, else synthesized from the scalars). This
        // closes the last DPS path that reached the dummy sink.
        //
        // Position/target/pattern — for these enemies AND for the focus attacker below — are no
        // longer defaulted here. `normalizeCombatRoster` (the engine's ONE accommodation boundary,
        // called on `runCombat`'s first line) fills exactly these axes, so a second derivation at
        // this adapter is redundant.
        enemyAttackers: effectiveEnemyAttackers,
        position: input.position,
        target: input.target,
        pattern: input.pattern,
    });

    // Real-enemy outcome, re-derived from the `ship-destroyed` tap. "Killed" means EVERY real enemy
    // is down (with one enemy — the common case — that is just it); `roundsToKill` is the round the
    // last of them fell. `realEnemyIds` is never empty (a scalar-only caller still gets the
    // synthesized enemy), so there is no "no real enemy at all" case left to guard against here.
    const allRealEnemiesDead = realEnemyDeathRound.size === realEnemyIds.size;
    const realRoundsToKill = allRealEnemiesDead
        ? Math.max(...realEnemyDeathRound.values())
        : undefined;

    /**
     * HP-weighted remainder across the WHOLE real roster: how much of the enemy team's HP pool is
     * still standing. `finalHpPct` is a single number, and reading `enemyAttackers[0]` made that
     * number describe one member — so a run that wiped one of two enemies reported either 0 or 100
     * depending only on listing order, and `rankDpsConfigs` (which sorts surviving configs by
     * "closer to death wins") ranked on it. Weighted by max HP rather than a mean of percentages so
     * a big enemy counts for more, which is what "closer to killing the roster" means.
     *
     * A destroyed enemy contributes 0 from the `ship-destroyed` tap, not from `hp-changed` — a
     * lethal hit does not reliably leave a final 0% `hp-changed` behind it.
     */
    const weightedRealEnemyHpPct = (): number => {
        const roster = effectiveEnemyAttackers;
        const totalMaxHp = roster.reduce((sum, e) => sum + (e.stats.hp ?? 0), 0);
        // No HP anywhere to lose (all-zero or unspecified maxima) → nothing was taken off it.
        if (totalMaxHp <= 0) return 100;
        const remaining = roster.reduce((sum, e) => {
            const pct = realEnemyDeathRound.has(e.id) ? 0 : (realEnemyHpPct.get(e.id) ?? 100);
            return sum + (pct / 100) * (e.stats.hp ?? 0);
        }, 0);
        return (remaining / totalMaxHp) * 100;
    };

    // End the reported run AT the kill, dropping any zero-damage rounds the engine still simulated
    // afterwards. The engine used to carry its own early exit for this, gated on roster emptiness —
    // false on every DPS run, and deleted in SP-4c-2d — while `battleSimulator` derives its outcome
    // post-hoc rather than breaking the loop, so the trim belongs here. (SP-4c-1's side-wipe rule
    // now ends the run on the turn that kills the last enemy, so this trim is usually a no-op; it
    // still covers a run that reports rounds past a kill for any other reason.) Keeps
    // `avgDamagePerRound` dividing by the rounds that actually happened.
    const reportedRounds =
        realRoundsToKill !== undefined ? rounds.filter((r) => r.round <= realRoundsToKill) : rounds;

    // A positional run — which since SP-4b-2a is every DPS run — suppresses the engine's
    // `creditDamage(actor,'direct',…)` fold — `if (!positional)` at engine.ts:9082, because the
    // firing hit lands per-victim via applyPositionalDamage and crediting again would double-count.
    // So `rawTotals.cumulative` reads ~0 here and the per-victim map is the only honest source.
    // Mirrors how battleSimulator derives ShipRoundState.damageDealt from the same map (SP-F F1).
    const perRoundFocusDamage = focusDamagePerRound(reportedRounds, FOCUS_ACTOR_ID);
    const totalDamage = Math.round(focusDamageTotal(reportedRounds, FOCUS_ACTOR_ID));

    // Keep the per-round rows consistent with the re-derived total — DPSRoundChart and the
    // summary must not disagree. Index-aligned with `rounds` by construction (a round with no
    // entry contributes 0 and keeps its slot).
    //
    // ROUNDING: the engine wrote `Math.round(...)` into both fields and the chart prints them with
    // `toLocaleString()`, so the re-derivation owes the same integer contract — 4b-1 assigned the
    // raw float and shipped `Total (with team): 179,514.401` to the page. The running sum
    // accumulates the RAW values and rounds only for display, so the last row's cumulative equals
    // `summary.totalDamage` (which rounds the same raw total once) exactly.
    // `directDamage` is the ONLY per-kind row the positional path zeroes. `corrosionDamage`,
    // `infernoDamage` and `detonationDamage` fold `perActorDot`/`perActorDetonation`
    // (engine.ts:10483-10490) and are already honest; `focus.direct` alone (engine.ts:10482) is
    // not, because `creditDamage(actor,'direct',…)` sits inside `if (!positional)`
    // (engine.ts:9082-9083).
    //
    // Recovered by SUBTRACTION, not by reading `perTargetDealt` directly: that channel INCLUDES
    // the focus's DoT ticks and its detonation (measured — a corrosion round reads
    // `dealt = direct + ticks`), so assigning it whole would report the ticks twice, once as
    // Direct and once as Corr, and the tooltip's four rows would stop summing to the round total.
    //
    // Two channel properties ride along and are correct rather than accidental: reactive damage
    // the focus deals lands in `perTargetDealt` (#318) and is therefore counted as Direct — it IS
    // direct damage the focus dealt; and the channel's documented exclusions (focus-target DoT,
    // the Protection redirect double-count) are inherited, not introduced here.
    let derivedDirectTotal = 0;
    let runningFocusDamage = 0;
    reportedRounds.forEach((r, i) => {
        r.totalRoundDamage = Math.round(perRoundFocusDamage[i]);
        runningFocusDamage += perRoundFocusDamage[i];
        r.cumulativeDamage = Math.round(runningFocusDamage);

        // `genericDamage` is deliberately NOT subtracted: it has no tooltip row of its own, so
        // carving it out here would delete it from the display entirely. It is FOLDED INTO
        // Direct — read `RoundData.genericDamage`'s doc for the rule.
        const nonDirect = r.corrosionDamage + r.infernoDamage + r.detonationDamage;
        // Clamped: the subtrahends come from independently-rounded engine folds, and the
        // channel's known exclusions can make the remainder go slightly negative rather than
        // meaning "the focus dealt negative direct damage".
        const direct = Math.max(0, perRoundFocusDamage[i] - nonDirect);
        r.directDamage = Math.round(direct);
        derivedDirectTotal += direct;
    });

    // SP-4b-1: the SAME re-derivation for the walked TEAM actors. `RoundData.teamDamage` /
    // `teamTotalDamage` are folded by the engine out of the scalar `roundDamage` map, whose team
    // writer is gated on `!teamPositional` (engine.ts:9350) exactly like the focus's — so the
    // moment a walked team actor resolves positionally its credit is suppressed there and lands in
    // `perTargetDealt` instead. That is now EVERY DPS-page run: the page always supplies a
    // positioned `enemy-1`, and the normalization boundary places + targets every actor, including
    // team actors the page itself never gave a target/pattern. Left on the scalar, `teamDamage`
    // reads 0 and DPSRoundChart — whose team features are all `> 0`-guarded — silently drops the
    // violet tooltip row, the dashed "with team" overlay and its legend entry, and `killRoundFor`
    // falls back to focus-only and reports a LATER kill round than the sim produced.
    //
    // The group is an EXPLICIT id list — the focus plus the walked team ids — never "every entry
    // that is not the focus". `perTargetDealt` is keyed by attacker across BOTH sides, so that
    // subtraction (which is what the engine's scalar map does, safely, being player-credit-only)
    // would fold the ENEMY's output into the player's side total here.
    //
    // Replacement (not addition), mirroring the focus: the two channels are mutually exclusive per
    // cast — the `!teamPositional` gate above, `applyReactiveDamage` (which since SP-4c-2d calls
    // `creditDealt` unconditionally, its credit-only arm having been roster-emptiness-gated), and
    // the positional DoT/detonation sites which call `creditDealt` only. A run with no walked team
    // actors at all (`walkedTeamIds.length === 0`) has nothing to re-derive here.
    const walkedTeamIds = engineTeamActors?.filter((t) => t.walk).map((t) => t.id) ?? [];
    // The group is the WHOLE PLAYER SIDE — the focus INCLUDED. Swapping the focus ship changes what
    // the rest of the team does (its buffs raise their damage, its casts feed their reactions), so
    // "what does this side put out with this ship in it" is the number that makes two configs
    // comparable; the focus's own output alone cannot answer it. Presence still means "this run had
    // team ships" (the `walkedTeamIds.length > 0` gate), so a run with no team keeps the field
    // absent and the legacy RoundData shape.
    const perRoundTeamDamage =
        walkedTeamIds.length > 0
            ? actorsDamagePerRound(reportedRounds, [FOCUS_ACTOR_ID, ...walkedTeamIds])
            : null;
    if (perRoundTeamDamage) {
        // Rounded per row, preserving the integer contract the engine's own
        // `Math.round(teamRoundDamage)` gave this field (the chart prints it with toLocaleString).
        reportedRounds.forEach((r, i) => {
            r.teamDamage = Math.round(perRoundTeamDamage[i]);
        });
    }
    const teamTotalDamage = perRoundTeamDamage
        ? Math.round(perRoundTeamDamage.reduce((sum, n) => sum + n, 0))
        : Math.round(rawTotals.teamTotal);

    // Hang the display timeline on the REPORTED rows (post-kill-trim) — a round the run never
    // reported gets nothing, and each field stays absent when it has nothing to say, so a caller
    // that renders `?? []` shows an empty section rather than an empty-object artifact.
    if (collectTimeline) {
        for (const row of reportedRounds) {
            const stats = focusStatsByRound.get(row.round);
            if (stats && stats.length > 0) row.focusStatsSnapshots = stats;

            const focus = focusStatusByRound.get(row.round);
            if (focus && (focus.buffNames.length > 0 || focus.debuffNames.length > 0)) {
                row.focusStatuses = focus;
            }

            const enemies = enemyStatusByRound.get(row.round);
            if (enemies) {
                const carrying = Object.entries(enemies).filter(
                    ([, s]) => s.buffNames.length > 0 || s.debuffNames.length > 0
                );
                if (carrying.length > 0) row.enemyStatuses = Object.fromEntries(carrying);
            }
        }
    }

    return {
        rounds: reportedRounds,
        summary: {
            totalDamage,
            // SP-U U6: divide by the ELAPSED rounds (rounds.length), not the configured window
            // (numRounds). When the enemy dies early the run terminates on the kill round and
            // `rounds` is trimmed to that length — dividing by numRounds under-reports the
            // per-round pace of a fast kill. Survived runs are unaffected (rounds.length ===
            // numRounds there).
            avgDamagePerRound: Math.round(totalDamage / reportedRounds.length),
            // SP-U U5: rounds-to-kill adapter, re-derived from the `ship-destroyed` tap (see above —
            // the engine's own outcome fields read the DUMMY and were deleted with it in SP-4c-2d,
            // so there is nothing engine-side left to prefer). Wiped → roundsToKill
            // = death round, survived false, finalHpPct 0; else survived true, roundsToKill
            // undefined, finalHpPct = end-of-window enemy HP%.
            survived: !allRealEnemiesDead,
            ...(realRoundsToKill !== undefined ? { roundsToKill: realRoundsToKill } : {}),
            // A fully wiped roster is at 0%; otherwise the HP-weighted remainder across every real
            // enemy (see weightedRealEnemyHpPct — with the single enemy the UI ships, that is just
            // its own last `hp-changed` percentage, 100 when never damaged).
            finalHpPct: allRealEnemiesDead ? 0 : weightedRealEnemyHpPct(),
            // Same suppression, same remedy as the per-round row above: `rawTotals.direct` is fed
            // by the `!positional`-gated credit, so it reads 0 for every real-enemy run and the
            // summary's damage-type breakdown (ShipConfigSummary.tsx:201) showed "0" beside a
            // correct grand total.
            totalDirectDamage: Math.round(derivedDirectTotal),
            totalCorrosionDamage: Math.round(rawTotals.corrosion),
            totalInfernoDamage: Math.round(rawTotals.inferno),
            totalDetonationDamage: Math.round(rawTotals.detonation),
            totalSecondaryDamage: Math.round(rawTotals.totalSecondary),
            totalConditionalDamage: Math.round(rawTotals.totalConditional),
            // Team total only when any walked team actor exists (legacy shape preserved).
            ...(hasWalkedTeam ? { teamTotalDamage } : {}),
        },
    };
}
