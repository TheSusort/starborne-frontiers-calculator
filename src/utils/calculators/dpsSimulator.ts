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

/** The engine's focus-actor id (engine.ts:1781 `const focusActorId = 'attacker'`). */
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
     *  damage/crit modifiers (computeAffinityModifiers). Absent → neutral defaults. The
     *  attacker's affinity matchup is still passed pre-resolved via affinityDamageModifier
     *  etc. (the page resolves it); this feeds the walked team actors. */
    enemyAffinity?: AffinityName;
    /** Attacker turn-order speed. Default 100. */
    speed?: number;
    /** Enemy turn-order speed. Default 50 — the enemy acts last at default speeds. */
    enemySpeed?: number;
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
    /** Real, positioned enemy ships. A non-empty array flips the engine's `dpsEnemyTarget`
     *  false, so the focus's damage lands per-victim on THESE actors instead of the vestigial
     *  dummy. Reuses the engine's own shape — deliberately not a parallel type. */
    enemyAttackers?: NonNullable<CombatEngineInput['enemyAttackers']>;
    /** Board slot of the focus attacker. Optional since SP-4b-1: `normalizeCombatRoster` — the
     *  engine's accommodation boundary, `runCombat`'s first line — auto-places any actor that
     *  arrives without one (`DEFAULT_ATTACKER_SLOT` for the focus). Supply it to CHOOSE the cell;
     *  omitting it no longer sends the focus to the dummy. */
    position?: Position;
    /** Pre-parsed targeting preference for the focus attacker. Also optional since SP-4b-1 — the
     *  boundary fills an absent one with `DEFAULT_FRONT_ENEMY_TARGET`. Without that fill,
     *  `selectTurnTarget` (which requires `resolvesPositionalVictim(...) && target`) would
     *  short-circuit to `legacyVictim` (the dummy) however well-positioned the roster is, and
     *  `dummyEnemyIsVestigial` (which checks `t?.side === 'enemy'`) would keep the dummy in the
     *  turn order — which is precisely why the boundary fills it. */
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
    /** Enemy HP% ENTERING this round (100 → 0), derived from cumulative damage vs the
     *  enemy HP pool — the value hp-threshold conditions are gated against. */
    enemyHpPct: number;
    directDamage: number;
    corrosionDamage: number;
    infernoDamage: number;
    /** SP-E: absolute-per-tick generic DoT damage this round (Voron/Orel transform, Acidic Decay
     *  family). Optional and set ONLY when nonzero — generic DoTs are never auto-applied from
     *  skill text in this task, so every existing round/golden stays byte-identical (field absent,
     *  legacy RoundData shape preserved). Mirrors corrosionDamage/infernoDamage once populated. */
    genericDamage?: number;
    /** Detonation damage this round: Bomb detonations + DoT detonations (game-categorised together). */
    detonationDamage: number;
    totalRoundDamage: number;
    cumulativeDamage: number;
    /** All-channel non-focus player (team) damage this round: direct (incl. its
     *  secondary/conditional components), DoT ticks from entries team actors applied, and
     *  detonation bursts from their bombs/accumulators. `totalRoundDamage + teamDamage` =
     *  the round's enemy-HP delta by construction. Set ONLY when walked team actors exist;
     *  undefined on legacy/attacker-only runs (legacy RoundData shape preserved). */
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
     *  REACTIVE DAMAGE **IS** INCLUDED on the positional path, and this comment used to say the
     *  opposite. `applyReactiveDamage` writes here via `creditDealt` when `hasPositionedEnemyRoster`
     *  and the victim is a real positioned actor (`engine.ts` ~5784, shipped in #318);
     *  `applyCounterAttack` (~5554) and reflect (~5243) write it unconditionally. Only a run with
     *  NO positioned enemy roster falls back to credit-only `creditDamage`. Verified empirically
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
     *  rounds without per-victim intake (legacy RoundData shape preserved, goldens byte-identical). */
    perActorIncoming?: Record<
        string,
        {
            incoming: number;
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
    /** SP-2: round-tail status names per REAL enemy actor id (the vestigial dummy is filtered out —
     *  it keys its debuffs under the `__enemy__` sentinel and always reports empty). Keyed by id
     *  rather than collapsed to one entry: a roster is not its first member (the defect #318 fixed
     *  in `finalHpPct`). Populated only under `collectStatusTimeline`, and only for actors carrying
     *  at least one name. */
    enemyStatuses?: Record<string, RoundActorStatuses>;
    activeCorrosionStacks: number;
    activeInfernoStacks: number;
    activeBombCount: number;
    activeSelfBuffs: ActiveBuff[];
    activeEnemyDebuffs: ActiveBuff[];
    resistedEnemyDebuffs: ActiveBuff[];
    appliedDoTs: DoTApplicationEntry[];
    dotsLanded: boolean;
    activeDoTStates: ActiveDoTState[];
}

export interface DPSSimulationSummary {
    totalDamage: number;
    avgDamagePerRound: number;
    /** Round the enemy was destroyed; undefined if it survived the window. */
    roundsToKill?: number;
    /** True when the enemy survived all N rounds (never reached 0 HP). */
    survived: boolean;
    /** Enemy HP% remaining at the end of the window (0 when killed). */
    finalHpPct: number;
    totalDirectDamage: number;
    totalCorrosionDamage: number;
    totalInfernoDamage: number;
    totalDetonationDamage: number;
    totalSecondaryDamage: number;
    totalConditionalDamage: number;
    /** Total non-focus player (team) damage across all rounds. Present only when walked
     *  team actors exist; the focus-only DPS fields above are unaffected by team damage. */
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

    // `enemyOutcome` is derived from the vestigial DUMMY (`enemy.destroyedRound`, engine.ts:10192),
    // which has billions of HP and never dies. Against a real enemy it therefore reports
    // `survived: true` / `roundsToKill: undefined` forever. Capture the REAL enemies' deaths off an
    // emit-only bus tap and re-derive below — same defect class as `cumulativeDamage`, same remedy.
    const realEnemyIds = new Set((input.enemyAttackers ?? []).map((e) => e.id));
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

    const { rounds, rawTotals, enemyOutcome } = runCombat({
        attack,
        crit,
        critDamage,
        defensePenetration,
        shieldPenetration: input.shieldPenetration,
        chargeCount,
        shipSkills,
        enemyDefense,
        enemyHp,
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
        defence,
        hp,
        // Base hacking/security (A2 Task 2) — the OLD landing-formula defaults (200 / 100) applied at
        // this boundary, threaded onto the attacker/dummy actor bases. No production reader yet (A2 Task 4).
        hacking,
        enemySecurity,
        allyChargePerRound,
        enemyType,
        speed,
        enemySpeed,
        teamActors: engineTeamActors,
        bus: collectingBus,
        // Real positioned enemy roster, forwarded verbatim. Non-empty → the engine's
        // `dpsEnemyTarget` goes false and the focus's damage lands per-victim on these actors
        // rather than the dummy sink.
        //
        // Position/target/pattern — for these enemies AND for the focus attacker below — are no
        // longer defaulted here. `normalizeCombatRoster` (the engine's ONE accommodation boundary,
        // called on `runCombat`'s first line) fills exactly these axes, so a second derivation at
        // this adapter is redundant. It also fills them UNCONDITIONALLY, where this adapter gated
        // on `enemyAttackers.length > 0`; the widened case is a scalar-path run, which has no
        // TARGETABLE opposing roster for `resolvesPositionalVictim` to match (no enemy at all, or
        // only 0-max-HP pressure sources) and is therefore unaffected by carrying a slot.
        enemyAttackers: input.enemyAttackers,
        position: input.position,
        target: input.target,
        pattern: input.pattern,
    });

    const hasRealEnemy = (input.enemyAttackers?.length ?? 0) > 0;

    // Real-enemy outcome, re-derived from the `ship-destroyed` tap. "Killed" means EVERY real enemy
    // is down (with one enemy — the common case — that is just it); `roundsToKill` is the round the
    // last of them fell.
    const allRealEnemiesDead =
        realEnemyIds.size > 0 && realEnemyDeathRound.size === realEnemyIds.size;
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
        const roster = input.enemyAttackers ?? [];
        const totalMaxHp = roster.reduce((sum, e) => sum + (e.stats.hp ?? 0), 0);
        // No HP anywhere to lose (all-zero or unspecified maxima) → nothing was taken off it.
        if (totalMaxHp <= 0) return 100;
        const remaining = roster.reduce((sum, e) => {
            const pct = realEnemyDeathRound.has(e.id) ? 0 : (realEnemyHpPct.get(e.id) ?? 100);
            return sum + (pct / 100) * (e.stats.hp ?? 0);
        }, 0);
        return (remaining / totalMaxHp) * 100;
    };

    // End the reported run AT the kill, dropping the zero-damage rounds the engine still simulated
    // afterwards. The engine's own early exit (engine.ts:10159) is gated on `dpsEnemyTarget`, which
    // is false once a real enemy is supplied, and `battleSimulator` derives its outcome post-hoc
    // rather than breaking the loop — so the trim belongs here. Matches the documented
    // `dpsEnemyTarget` semantics ("roundData ends AT the kill, no zero-damage rounds past it") and
    // keeps `avgDamagePerRound` dividing by the rounds that actually happened.
    const reportedRounds =
        realRoundsToKill !== undefined ? rounds.filter((r) => r.round <= realRoundsToKill) : rounds;

    // A positional run (a real enemy is present) suppresses the engine's
    // `creditDamage(actor,'direct',…)` fold — `if (!positional)` at engine.ts:8430, because the
    // firing hit lands per-victim via applyPositionalDamage and crediting again would double-count.
    // So `rawTotals.cumulative` reads ~0 here and the per-victim map is the only honest source.
    // Mirrors how battleSimulator derives ShipRoundState.damageDealt from the same map (SP-F F1).
    const perRoundFocusDamage = hasRealEnemy
        ? focusDamagePerRound(reportedRounds, FOCUS_ACTOR_ID)
        : null;
    const totalDamage = hasRealEnemy
        ? Math.round(focusDamageTotal(reportedRounds, FOCUS_ACTOR_ID))
        : Math.round(rawTotals.cumulative);

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
    // (engine.ts:9961-9968) and are already honest; `focus.direct` alone (engine.ts:9960) is not,
    // because `creditDamage(actor,'direct',…)` sits inside `if (!positional)` (engine.ts:8677).
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
    if (perRoundFocusDamage) {
        let running = 0;
        reportedRounds.forEach((r, i) => {
            r.totalRoundDamage = Math.round(perRoundFocusDamage[i]);
            running += perRoundFocusDamage[i];
            r.cumulativeDamage = Math.round(running);

            const nonDirect =
                r.corrosionDamage + r.infernoDamage + (r.genericDamage ?? 0) + r.detonationDamage;
            // Clamped: the subtrahends come from independently-rounded engine folds, and the
            // channel's known exclusions can make the remainder go slightly negative rather than
            // meaning "the focus dealt negative direct damage".
            const direct = Math.max(0, perRoundFocusDamage[i] - nonDirect);
            r.directDamage = Math.round(direct);
            derivedDirectTotal += direct;
        });
    }

    // SP-4b-1: the SAME re-derivation for the walked TEAM actors. `RoundData.teamDamage` /
    // `teamTotalDamage` are folded by the engine out of the scalar `roundDamage` map, whose team
    // writer is gated on `!teamPositional` (engine.ts:8891) exactly like the focus's — so the
    // moment a walked team actor resolves positionally its credit is suppressed there and lands in
    // `perTargetDealt` instead. That is now EVERY DPS-page run: the page always supplies a
    // positioned `enemy-1`, and the normalization boundary places + targets every actor, including
    // team actors the page itself never gave a target/pattern. Left on the scalar, `teamDamage`
    // reads 0 and DPSRoundChart — whose team features are all `> 0`-guarded — silently drops the
    // violet tooltip row, the dashed "with team" overlay and its legend entry, and `killRoundFor`
    // falls back to focus-only and reports a LATER kill round than the sim produced.
    //
    // The group shape is NOT the focus's: an explicit list of walked team ids, because
    // `perTargetDealt` is keyed by attacker across BOTH sides — the engine's "every non-focus
    // entry" subtraction is only safe on the player-credit-only scalar map, and applied here it
    // would fold the ENEMY's output into the player's team aggregate.
    //
    // Replacement (not addition), mirroring the focus: the two channels are mutually exclusive per
    // cast — the `!teamPositional` gate above, `applyReactiveDamage`'s
    // `hasPositionedEnemyRoster ? creditDealt : creditDamage` split (engine.ts:5738/5775), and the
    // positional DoT/detonation sites which call `creditDealt` only. Legacy (no real enemy) runs
    // keep the engine's scalar values untouched, so their goldens cannot move.
    const walkedTeamIds = engineTeamActors?.filter((t) => t.walk).map((t) => t.id) ?? [];
    const perRoundTeamDamage =
        hasRealEnemy && walkedTeamIds.length > 0
            ? actorsDamagePerRound(reportedRounds, walkedTeamIds)
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
            // SP-U U5: rounds-to-kill adapter. The engine drives a real, destructible enemy; when
            // it dies within the window the run terminates on that round and `enemyOutcome` reports
            // it. Wiped → roundsToKill = death round, survived false, finalHpPct 0; else survived
            // true, roundsToKill undefined, finalHpPct = end-of-window enemy HP%.
            //
            // Against a REAL enemy those engine fields read the dummy and are meaningless (it never
            // dies), so they are replaced by the `ship-destroyed`-derived values above.
            survived: realEnemyIds.size > 0 ? !allRealEnemiesDead : enemyOutcome.survived,
            ...(realEnemyIds.size > 0
                ? realRoundsToKill !== undefined
                    ? { roundsToKill: realRoundsToKill }
                    : {}
                : enemyOutcome.roundsToKill !== undefined
                  ? { roundsToKill: enemyOutcome.roundsToKill }
                  : {}),
            // A fully wiped roster is at 0%; otherwise the HP-weighted remainder across every real
            // enemy (see weightedRealEnemyHpPct — with the single enemy the UI ships, that is just
            // its own last `hp-changed` percentage, 100 when never damaged). The engine's
            // `enemyOutcome.finalHpPct` reads the DUMMY here, so it is not a reading of the real
            // enemy at all.
            finalHpPct:
                realEnemyIds.size > 0
                    ? allRealEnemiesDead
                        ? 0
                        : weightedRealEnemyHpPct()
                    : enemyOutcome.finalHpPct,
            // Same suppression, same remedy as the per-round row above: `rawTotals.direct` is fed
            // by the `!positional`-gated credit, so it reads 0 for every real-enemy run and the
            // summary's damage-type breakdown (ShipConfigSummary.tsx:201) showed "0" beside a
            // correct grand total.
            totalDirectDamage: perRoundFocusDamage
                ? Math.round(derivedDirectTotal)
                : Math.round(rawTotals.direct),
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
