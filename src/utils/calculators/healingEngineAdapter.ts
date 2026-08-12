import { ShipSkills } from '../../types/abilities';
import { SelectedGameBuff, TeamActorInput } from '../../types/calculator';
import { AffinityName } from '../../types/ship';
import type { ShipTypeName } from '../../constants/shipTypes';
import type { Position } from '../../types/encounters';
import type { ActiveBuff } from '../combat/statusEngine';
import type { CombatEventBus } from '../combat/events';
import { runCombat, EnemyRoundEffects } from '../combat/engine';
import { selectFiringSkill } from '../abilities/applyAbilities';
import type { ParsedTarget, ParsedPattern, ShipTargeting } from '../targetingParser';
import { computeAffinityModifiers } from './affinityUtils';
import { toDotAndPenModifiers } from './dpsBuffHelpers';
import { deriveTeamEngineActors } from './dpsSimulator';
import {
    DEFAULT_BASE_PATTERN,
    DEFAULT_FRONT_ENEMY_TARGET,
    resolvePlayerSlots,
} from './dpsEnemyPlacement';
import {
    DEFAULT_HEALER_SLOT,
    defaultEnemySlot,
    defaultHealTargetSlot,
    defaultHealingTeamSlot,
    resolveEnemySlots,
} from './healingPlacement';

export interface HealerStats {
    hp: number;
    attack: number;
    defence: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    /** Shield penetration (H1 Task 2). Optional — threaded onto the focus (healer) actor's
     *  stats.shieldPenetration. No production reader until H1 Task 4. */
    shieldPenetration?: number;
    healModifier: number;
    hacking: number;
    speed: number;
}

export interface EnemyAttackerInput {
    id: string;
    stats: {
        attack: number;
        crit: number;
        critDamage: number;
        speed: number;
        /** Shield penetration (H1 Task 2). Optional — threaded onto the engine enemy actor's
         *  stats.shieldPenetration. No production reader until H1 Task 4. */
        shieldPenetration?: number;
        /** Enemy's own defence. Load-bearing since SP-3: the healer's damage cast now lands on
         *  this enemy, and that number is the basis for `damage-dealt` heal/shield riders.
         *  Absent → the legacy sink's 10,000 (the pre-SP-3 punching bag), NOT the engine's 0. */
        defence?: number;
        /** Enemy's own max HP. Load-bearing since SP-3: enemies can now be killed, which reduces
         *  incoming pressure over the window. Absent → the legacy sink's 1,000,000, NOT the
         *  engine's 0 — a 0-HP enemy is already at 0 HP, so the healer's cast delivers nothing to
         *  it and every `basis:'damage-dealt'` rider silently pays out zero. */
        hp?: number;
        /** Enemy's own security — resists the HEALER's outbound debuffs. Absent → the pre-SP-3
         *  fixed 100, which is also what the engine's LANDING path would have used on its own:
         *  `debuffLandingChance` reads `defender.stats.security ?? 100` (effectiveStats.ts:137).
         *  (`effectiveStatsOf`'s `?? 0` exists but has no landing reader.) So the default is a
         *  belt-and-braces no-op here, kept explicit so the sink's numbers all live in one place —
         *  unlike `hp`/`defence` above, whose engine defaults genuinely ARE 0
         *  (engine.ts:668,718). */
        security?: number;
    };
    chargeCount: number;
    startCharged: boolean;
    /** Full kit walk. Absent → one synthesized basic attack per turn. */
    shipSkills?: ShipSkills;
    /** Enemy attacker's affinity. Combined with the heal target's affinity via
     *  computeAffinityModifiers(enemyAffinity, targetAffinity) to produce the matchup.
     *  Absent → neutral defaults (modifier 0, cap 100, penalty 0). */
    affinity?: AffinityName;
    /** Enemy attacker's hacking stat — threaded onto the engine enemy actor so the engine's
     *  live per-turn landing recompute (hacking vs heal-target security) drives inbound debuff
     *  landing. Absent → engine defaults hacking to 200 (100% landing at neutral security). */
    hacking?: number;
    /** Board slot. Required for `isPositional` to resolve a real target: it needs BOTH this and
     *  an opposing actor's position, or `selectTurnTarget` falls back to the vestigial dummy. */
    position?: Position;
    /** Parsed target selection. Position alone does NOT route a cast — with no ParsedTarget,
     *  `selectTurnTarget` short-circuits to `legacyVictim` however well-positioned the roster. */
    target?: ParsedTarget;
    /** Parsed pattern. Required by the SAME positional-apply gate as `target`: with a target but
     *  no pattern the cast resolves onto the real enemy yet skips the per-victim apply, leaving
     *  `perTargetDealt` empty while the damage number still looks plausible. */
    pattern?: ParsedPattern;
    /** Charged-axis targeting when it differs from active. Falls back to `target` / `pattern`. */
    chargedTarget?: ParsedTarget;
    chargedPattern?: ParsedPattern;
}

export interface HealingSimulationInput {
    healer: HealerStats;
    chargeCount: number;
    startCharged?: boolean;
    shipSkills: ShipSkills;
    selfBuffs: SelectedGameBuff[];
    /** Which player actor the enemies bombard: 'healer' or a team actor id. */
    healTargetId: string;
    /** Affinity of the heal target — used to compute each enemy attacker's matchup via
     *  computeAffinityModifiers(enemyAffinity, targetAffinity). Absent → neutral for all
     *  enemies (byte-identical to prior behaviour when enemy affinity was also absent). */
    healTargetAffinity?: AffinityName;
    /** The HEALER ship's role (Ship.type) — maps to the engine's focus-actor `role` for
     *  role-filtered on-ally-attacked reactions (Graphite) when the healer is the heal target.
     *  Team actors carry their own `role` on TeamActorInput (passed through untouched by the
     *  team walk). Absent (manual stats / no ship picked) → the focus actor never matches a
     *  role filter — the reaction stays dormant for hits on it (conservative). */
    healerRole?: ShipTypeName;
    /** The heal target's security stat. Deprecated — reserved for future per-target live landing
     *  recompute; currently unused by the adapter (inbound enemy landing is driven by the live
     *  hacking-vs-security recompute from enemy.hacking / heal-target's effective security). */
    healTargetSecurity?: number;
    teamActors?: TeamActorInput[];
    enemies: EnemyAttackerInput[];
    rounds: number;
    /** The healer's board slot. Required for `isPositional`: it needs BOTH this and an opposing
     *  actor's position, else `selectTurnTarget` falls back to the vestigial dummy. */
    healerPosition?: Position;
    /** The healer's own parsed skill targeting (`parseShipTargeting`). Real patterns drive both
     *  the offensive cast AND — via the support footprint — which allies its heals reach. */
    healerTargeting?: ShipTargeting;
    /** Optional emit-only event tap (write-only listeners). */
    bus?: CombatEventBus;
}

export interface HealingRoundData {
    round: number;
    action: 'active' | 'charged';
    charges: number;
    chargeCount: number;
    didCrit: boolean;
    directHeal: number;
    hotHeal: number;
    shield: number;
    cleanseCount: number;
    effectiveHealing: number;
    overheal: number;
    incomingDamage: number;
    shieldAbsorbed: number;
    /** Full-immunity blocked total this round; distinct from shieldAbsorbed — Barrier never
     *  touches the shield pool. */
    barrierAbsorbed: number;
    targetHpPct: number; // ENTERING the round
    targetShieldPool: number; // ENTERING the round
    totalRoundHealing: number; // directHeal + hotHeal (raw; shield separate)
    cumulativeHealing: number;
    teamHealing?: number; // non-focus actors' raw (direct+HoT) healing; only when team actors exist
    activeSelfBuffs: ActiveBuff[];
    /** The HEAL TARGET's OWN active self-buffs this round (Cheat Death, Everliving Regeneration,
     *  Barrier, etc.) — captured comprehensively from the target's turn (PlayerTurnResult.
     *  activeSelfBuffs), so recurring/always-active buffs are included. Empty when there is no
     *  heal target, the target never acted, or the target is destroyed. NAMES ONLY for the
     *  round-overview panel — never folded into any heal value. */
    healTargetBuffs: ActiveBuff[];
    /** Per-enemy effects this round (Task 10a) — one entry per enemy attacker that produced an
     *  effect, carrying its own self-buffs + the debuffs it landed on the heal target, keyed by
     *  the enemy's actor id. For the UI's enemy-effects round overview, grouped/attributed to the
     *  source enemy ship. Empty for a bare/manual enemy with no effects. */
    enemyEffects: EnemyRoundEffects[];
    extraTurns?: number;
    /** Per-victim damage this round, `attackerId → victimId → damage`, forwarded from RoundData.
     *  Present only on a positional run. This is the ONLY reliable proof the per-victim apply ran:
     *  with a target but no pattern the cast still resolves onto the real enemy and still produces a
     *  plausible damage number, while `perTargetDealt` comes back EMPTY (engine.ts:8344). */
    perTargetDealt?: Record<string, Record<string, number>>;
}

export interface HealingSimulationResult {
    rounds: HealingRoundData[];
    summary: {
        totalHealing: number; // RAW (direct + HoT), focus actor
        totalDirectHeal: number;
        totalHotHeal: number;
        totalShield: number;
        totalCleanses: number;
        totalEffectiveHealing: number;
        totalOverheal: number;
        totalShieldAbsorbed: number;
        totalBarrierAbsorbed: number;
        totalIncomingDamage: number;
        /** RAW healing / rounds — NOT effective. */
        avgHealingPerRound: number;
        destroyedRound?: number; // present only if the target died
        teamTotalHealing?: number;
    };
}

/** The engine's internal focus actor id. */
const FOCUS_ID = 'attacker';

/**
 * Thin adapter over the combat engine (`src/utils/combat/engine.ts`) running in HEALING
 * mode. Mirrors `simulateDPS`: it derives the engine's input from the public healing input —
 * the heal-target id mapping, the debuff landing chance (hacking vs a fixed dummy security),
 * the static defPen/dot self-buff fold, the charged-skill widening, and the per-team-actor
 * walk (shared `deriveTeamEngineActors`) — then calls `runCombat` and assembles the public
 * result from the additive `healing` block.
 *
 * Enemy affinity IS resolved per attacker via computeAffinityModifiers(enemyAffinity,
 * healTargetAffinity) (the enemy is the attacker, the heal target the defender) — producing
 * each enemy's affinityDamageModifier / affinityCritCap / affinityCritPenalty. Absent enemy
 * or target affinity → neutral (modifier 0, cap 100, penalty 0). The HEALER's own offense still
 * passes the pre-resolved affinityDamageModifier 0 / cap 100 / penalty 0, and the team walk is
 * derived with no enemy affinity.
 *
 * ⚠️ AFFINITY ASYMMETRY, deliberate. `healTargetAffinity` is threaded as the RAW `affinity` of
 * whichever actor IS the heal target, because the positional path re-resolves every matchup from
 * raw affinities per victim and ignores the pre-resolved scalars. When the healer self-heals, that
 * raw affinity lands on the FOCUS actor, where the engine also reads it as `attackerAffinity`
 * (engine.ts:2088) — so the healer's OWN offensive matchup vs each enemy goes live, and its damage
 * cast (and any `damage-dealt` rider off it) swings ±25%. When healing an ALLY the focus carries no
 * affinity at all, so the healer's offence stays neutral. The clean long-term shape is a dedicated
 * `healerAffinity` input rather than borrowing `healTargetAffinity` for two jobs; until then the
 * self-heal case is the more faithful of the two and the ally case the more conservative.
 *
 * POSITIONAL (SP-3). Both rosters are placed on the board and both sides fight for real: every
 * player ship and every enemy gets a cell (`resolvePlayerSlots` / `resolveEnemySlots`, so no two
 * same-side actors share one — a collision silently ERASES the earlier actor from that cell), and
 * every actor on BOTH sides — focus, team actors, enemies — carries a ParsedTarget + ParsedPattern,
 * defaulted to front/base when the caller supplies none. That default is load-bearing, not tidiness:
 * a team actor's axes are sourced exclusively from `teamTargetById`/`teamPatternById`
 * (engine.ts:1869-1885), so an actor missing them has `selectTurnTarget` short-circuit to
 * `legacyVictim` — the dummy — and its `basis:'damage-dealt'` riders then scale off the sink's
 * 10,000 defence instead of the real enemy's.
 *
 * Consequences the pre-SP-3 dummy run did not have: every player cast lands per-victim on a real
 * enemy (so `basis:'damage-dealt'` riders scale off that enemy's own defence), enemies can be
 * KILLED and stop bombarding, and heals reach exactly the allies the caster's support footprint
 * covers (`perRecipientHealApply`). An off-footprint heal target receives nothing at all; that is
 * game-faithful and deliberately not softened — correct default placement (`healingPlacement.ts`,
 * via `defaultHealTargetSlot`) is the only mitigation.
 *
 * The vestigial dummy is the opponent only where positional resolution yields nothing: when
 * `enemies` is EMPTY (a test-only shape — the page seeds one enemy and offers no delete), or when a
 * placed actor's target/pattern resolves to no victim at all, since `selectTurnTarget` ends in
 * `selected ?? legacyVictim` (engine.ts:6465). See the LEGACY_SINK_* comment below.
 *
 * Rounding: every healing number is rounded with Math.round (mirroring RoundData's damage
 * rounding). Raws are accumulated UNROUNDED and rounded LAST — per-row summed buckets and the
 * cumulative/summary totals round once at the point of presentation, avoiding drift.
 */
export function simulateHealing(input: HealingSimulationInput): HealingSimulationResult {
    const {
        healer,
        chargeCount,
        shipSkills,
        selfBuffs,
        enemies,
        rounds: numRounds,
        teamActors,
        healTargetAffinity,
    } = input;

    // SP-3: the healer's `damage` cast now lands on a REAL positioned enemy whenever an enemy
    // roster is supplied, which is exactly what F7's `basis:'damage-dealt'` riders needed — that
    // finding was conditional on the run being non-positional, not permanent. Production always
    // supplies at least one enemy (HealingCalculatorPage seeds one and offers no delete), so the
    // dummy punching bag is unreachable from the app.
    //
    // These scalars are the LEGACY SINK, and they now do DOUBLE duty:
    //
    //  1. they still describe the dummy, which is the only opponent when `enemies` is EMPTY (a
    //     test-only shape today). Do NOT "tidy" them to 0/huge: with no real roster the sink's
    //     defence is still the basis for every `damage-dealt` rider, its security still gates the
    //     healer's outbound debuffs, and `enemySpeed 0` still pins it last in the turn order;
    //  2. they are the per-enemy DEFAULTS for a real enemy that leaves `defence`/`hp`/`security`
    //     unspecified — which is every caller the UI produces today, since the enemy panel only
    //     collects attack/crit/critDamage/speed/hacking. Defaulting matters, and NOT to the
    //     engine's own zeros: `hp ?? 0` makes an enemy that already sits at 0 HP, so the healer's
    //     cast delivers NOTHING to it and every `basis:'damage-dealt'` rider silently pays out
    //     zero (measured: scenario 12's shield went 1258 → 0). `LEGACY_SINK_SECURITY` is the odd
    //     one out: it is a NO-OP, not a bug-preventer, because the engine's landing path already
    //     defaults an absent target security to 100 (`defender.stats.security ?? 100`,
    //     effectiveStats.ts:137 — `effectiveStatsOf`'s `?? 0` has no landing reader). It stays
    //     explicit only so the sink's three numbers live together. So an unspecified enemy keeps
    //     behaving exactly like the pre-SP-3 punching bag — just positioned, and killable the
    //     moment a caller gives it real numbers.
    //
    // SP-4 retires the dummy outright; until then these keep their pre-SP-3 values.
    const LEGACY_SINK_DEFENCE = 10000;
    const LEGACY_SINK_HP = 1_000_000;
    const LEGACY_SINK_SECURITY = 100;

    // Self-side static folds (defPen / dot from self-buffs) — same discipline as simulateDPS.
    const { defensePenetrationBuff, dotDamageModifier: selfDotModifier } = toDotAndPenModifiers(
        selfBuffs,
        []
    );

    // hasChargedSkill widening: chargeCount >= 1 AND the charged slot carries ANY ability.
    const chargedSkill = selectFiringSkill(shipSkills, 'charged');
    const hasChargedSkill = chargeCount >= 1 && (chargedSkill?.abilities.length ?? 0) > 0;

    // Heal-target id mapping: 'healer' → the engine's focus id; otherwise pass through (must be
    // a team actor id — the engine throws on an unknown id, which we let propagate).
    const healTargetId = input.healTargetId === 'healer' ? FOCUS_ID : input.healTargetId;

    // Player-side slots (SP-3). resolvePlayerSlots is load-bearing, not tidiness: the positional
    // maps are keyed by cell, so on a collision the LATER actor silently ERASES the earlier one
    // from that cell. slots[0] is the healer and keeps its slot.
    const healerSlot = input.healerPosition ?? DEFAULT_HEALER_SLOT;
    const healerActivePattern = input.healerTargeting?.active?.pattern;
    const playerWanted: Position[] = [
        healerSlot,
        ...(teamActors ?? []).map((t, i) => {
            if (t.position) return t.position;
            // The HEAL TARGET's default is coverage-aware, and that is load-bearing: heals apply
            // only to the recipients the caster's support footprint covers, and an off-footprint
            // heal target receives NOTHING (measured: directHeal 0 / totalHealing 0 under
            // `Pattern-Line-Support-Range-1` with the target on the generic team slot). The zero is
            // game-faithful and deliberately not softened, so the DEFAULT must simply not walk into
            // it — `defaultHealTargetSlot` seeds a cell the healer's own footprint covers (and
            // returns the neutral mid-board slot when there is no support pattern to reason about).
            return t.id === healTargetId
                ? defaultHealTargetSlot(healerSlot, healerActivePattern)
                : defaultHealingTeamSlot(i);
        }),
    ];
    const playerSlots = resolvePlayerSlots(playerWanted);
    // SP-3, load-bearing: on the POSITIONAL path the pre-resolved `affinityDamageModifier` scalars
    // below are BYPASSED — `victimHitDamage` recomputes each matchup from the attacker's RAW
    // affinity against the VICTIM's own `CombatActor.affinity` (playerTurn.ts:1250). The heal
    // target therefore has to actually CARRY `healTargetAffinity`, or every enemy's matchup
    // collapses to neutral and the documented ±25% swing silently disappears. Threaded onto
    // whichever actor IS the heal target; an actor's own `affinity` always wins.
    // The parsed axes mirror the enemy branch below EXACTLY, and for the same reason: a team
    // actor's target/pattern are sourced ONLY from `teamTargetById`/`teamPatternById`
    // (engine.ts:1869-1885, read at :6134-6142), which are populated only from `t.target`/
    // `t.pattern`. With neither, `selectTurnTarget` short-circuits to `legacyVictim` — the dummy —
    // however well-positioned the roster is, and the actor's `basis:'damage-dealt'` riders then
    // compute against the sink's 10,000 defence instead of the real enemy's (measured 2579 vs 7753
    // on a walked ally with attack 10,000 vs an enemy at defence 1,000 — a ~3× error that surfaces
    // as `teamHealing`). It bites the DEFAULT production config, whose heal target walks
    // `buildDefaultShipSkills()` — a kit that carries a damage ability.
    const positionedTeamActors = (teamActors ?? []).map((t, i) => ({
        ...t,
        position: playerSlots[i + 1],
        affinity: t.affinity ?? (t.id === healTargetId ? healTargetAffinity : undefined),
        target: t.target ?? DEFAULT_FRONT_ENEMY_TARGET,
        pattern: t.pattern ?? DEFAULT_BASE_PATTERN,
        chargedTarget: t.chargedTarget,
        chargedPattern: t.chargedPattern,
    }));
    /** The focus actor is the HEALER, so it is the heal target only in the self-heal case. */
    const focusAffinity = healTargetId === FOCUS_ID ? healTargetAffinity : undefined;

    // Walked team actors via the shared helper (security 100, no enemy affinity — a walked actor's
    // own OFFENSIVE matchup is irrelevant to healing output; what matters is each ENEMY's matchup
    // vs the heal target, resolved above). healModifier IS threaded from CombatStatBlock.
    // healModifier (default 0 when absent), so walked team actors fold their own heal-modifier
    // into heal casts.
    const engineTeamActors = deriveTeamEngineActors(positionedTeamActors, undefined);
    const hasTeamActors = !!teamActors && teamActors.length > 0;

    // Pre-resolve each enemy attacker's affinity matchup vs the heal target (Task 9).
    // Argument order: computeAffinityModifiers(ATTACKER affinity, DEFENDER affinity) —
    // the enemy is the attacker and the heal target is the defender.
    // Absent enemy or target affinity → neutral (damageMod 0, cap 100, penalty 0):
    // byte-identical to prior behaviour for all fixtures that omit affinity.
    // Enemy-side slots are resolved separately — sides are independent boards.
    const enemySlots = resolveEnemySlots(enemies.map((e, i) => e.position ?? defaultEnemySlot(i)));
    const engineEnemyAttackers = enemies.map((e, i) => {
        const aff = computeAffinityModifiers(e.affinity, healTargetAffinity);
        return {
            ...e,
            // Unspecified defence/hp/security fall back to the legacy sink's numbers, NOT the
            // engine's zeros — see the LEGACY_SINK_* block above for why a 0-HP enemy silently
            // zeroes every damage-dealt rider.
            stats: {
                ...e.stats,
                defence: e.stats.defence ?? LEGACY_SINK_DEFENCE,
                hp: e.stats.hp ?? LEGACY_SINK_HP,
                security: e.stats.security ?? LEGACY_SINK_SECURITY,
            },
            affinityDamageModifier: aff.damageModifier,
            affinityCritCap: aff.critCap,
            affinityCritPenalty: aff.critPenalty,
            position: enemySlots[i],
            // A kitless/manual enemy has no parsed targeting, so it would have NO ParsedTarget and
            // fall back to `legacyVictim` — the dummy — leaving SP-4 blocked. The synthetic
            // fallback keeps every enemy resolving onto a real player actor.
            target: e.target ?? DEFAULT_FRONT_ENEMY_TARGET,
            pattern: e.pattern ?? DEFAULT_BASE_PATTERN,
            chargedTarget: e.chargedTarget,
            chargedPattern: e.chargedPattern,
        };
    });

    const { rounds: engineRounds, healing } = runCombat({
        attack: healer.attack,
        crit: healer.crit,
        critDamage: healer.critDamage,
        defensePenetration: healer.defensePenetration,
        shieldPenetration: healer.shieldPenetration,
        chargeCount,
        shipSkills,
        enemyDefense: LEGACY_SINK_DEFENCE,
        enemyHp: LEGACY_SINK_HP,
        numRounds,
        selfBuffs,
        enemyDebuffs: [],
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged: input.startCharged ?? false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        // RAW focus affinity — see `focusAffinity` above. Absent unless the healer IS the heal
        // target, in which case every enemy's matchup vs it must survive the positional recompute.
        affinity: focusAffinity,
        defence: healer.defence,
        hp: healer.hp,
        speed: healer.speed,
        // Base hacking/security (holistic review #1) — thread onto the focus (healer) actor and
        // the dummy enemy actor so the engine's live per-turn recompute drives landing uniformly
        // across all three modes (DPS / battle-sim / healing). Walked team-actor hacking flows via
        // the walk bundle (deriveTeamEngineActors → engine reads walk.stats.hacking).
        hacking: healer.hacking,
        enemySecurity: LEGACY_SINK_SECURITY,
        enemySpeed: 0,
        healModifier: healer.healModifier,
        role: input.healerRole,
        healTargetId,
        enemyAttackers: engineEnemyAttackers,
        teamActors: engineTeamActors,
        bus: input.bus,
        // Positional plumbing (SP-3). Both position AND target AND pattern are required: with a
        // target but no pattern the cast resolves onto the real enemy yet skips the per-victim
        // apply, so `perTargetDealt` comes back EMPTY while the damage number looks plausible.
        position: playerSlots[0],
        target: input.healerTargeting?.active?.target ?? DEFAULT_FRONT_ENEMY_TARGET,
        pattern: input.healerTargeting?.active?.pattern ?? DEFAULT_BASE_PATTERN,
        chargedTarget: input.healerTargeting?.charged?.target,
        chargedPattern: input.healerTargeting?.charged?.pattern,
        // Heals apply to each recipient the caster's support pattern covers — WITHOUT
        // teamBattle's lowest-HP routing, which is not the game's rule (only Volk's passive is).
        perRecipientHealApply: true,
    });

    // healing is always present (healTargetId is always set in this adapter), but guard anyway.
    const healingRounds = healing?.rounds ?? [];

    // Raw (unrounded) accumulators — rounded once at presentation (per row / summary).
    let cumulativeRaw = 0;
    let totalDirectRaw = 0;
    let totalHotRaw = 0;
    let totalShieldRaw = 0;
    let totalCleansesRaw = 0;
    let totalEffectiveRaw = 0;
    let totalOverhealRaw = 0;
    let totalShieldAbsorbedRaw = 0;
    let totalBarrierAbsorbedRaw = 0;
    let totalIncomingRaw = 0;
    let totalTeamRaw = 0;

    const rows: HealingRoundData[] = engineRounds.map((rd, i) => {
        const hr = healingRounds[i];
        const focus = hr?.perActor.get(FOCUS_ID);
        const directHealRaw = focus?.directHeal ?? 0;
        const hotHealRaw = focus?.hotHeal ?? 0;
        const shieldRaw = focus?.shield ?? 0;
        const cleanseRaw = focus?.cleanseCount ?? 0;
        const effectiveRaw = focus?.effectiveHeal ?? 0;
        const overhealRaw = focus?.overheal ?? 0;
        const incomingRaw = hr?.incomingDamage ?? 0;
        const shieldAbsorbedRaw = hr?.shieldAbsorbed ?? 0;
        const barrierAbsorbedRaw = hr?.barrierAbsorbed ?? 0;

        // teamHealing = Σ non-focus entries' raw (direct + HoT). Team shield contributes to the
        // pool mechanically (the engine consumes it) but is NOT separately reported here.
        let teamRoundRaw = 0;
        if (hr) {
            for (const [id, h] of hr.perActor) {
                if (id === FOCUS_ID) continue;
                teamRoundRaw += h.directHeal + h.hotHeal;
            }
        }

        // Round the per-round raws AFTER summing (totalRoundHealing = directHeal + hotHeal raw,
        // rounded last). cumulativeRaw accumulates the unrounded direct+HoT raw, rounded per row.
        const totalRoundRaw = directHealRaw + hotHealRaw;
        cumulativeRaw += totalRoundRaw;

        totalDirectRaw += directHealRaw;
        totalHotRaw += hotHealRaw;
        totalShieldRaw += shieldRaw;
        totalCleansesRaw += cleanseRaw;
        totalEffectiveRaw += effectiveRaw;
        totalOverhealRaw += overhealRaw;
        totalShieldAbsorbedRaw += shieldAbsorbedRaw;
        totalBarrierAbsorbedRaw += barrierAbsorbedRaw;
        totalIncomingRaw += incomingRaw;
        totalTeamRaw += teamRoundRaw;

        return {
            round: rd.round,
            action: rd.action,
            charges: rd.charges,
            chargeCount: rd.chargeCount,
            didCrit: rd.didCrit,
            directHeal: Math.round(directHealRaw),
            hotHeal: Math.round(hotHealRaw),
            shield: Math.round(shieldRaw),
            cleanseCount: Math.round(cleanseRaw),
            effectiveHealing: Math.round(effectiveRaw),
            overheal: Math.round(overhealRaw),
            incomingDamage: Math.round(incomingRaw),
            shieldAbsorbed: Math.round(shieldAbsorbedRaw),
            barrierAbsorbed: Math.round(barrierAbsorbedRaw),
            targetHpPct: Math.round(hr?.targetHpPctStart ?? 100),
            targetShieldPool: Math.round(hr?.targetShieldStart ?? 0),
            totalRoundHealing: Math.round(totalRoundRaw),
            cumulativeHealing: Math.round(cumulativeRaw),
            ...(hasTeamActors ? { teamHealing: Math.round(teamRoundRaw) } : {}),
            activeSelfBuffs: rd.activeSelfBuffs,
            // Heal-target's OWN active buffs this round (Cheat Death, Everliving Regen, Barrier,
            // etc.), captured from the target's turn in the engine. Names only — never folded
            // into any heal value. Default [] when absent (DPS mode / no heal target).
            healTargetBuffs: hr?.healTargetBuffs ?? [],
            // Enemy-effects overview (Task 10a): per-enemy, attributed by enemy id. Names only,
            // never folded into any value.
            enemyEffects: hr?.enemyEffects ?? [],
            ...(rd.extraTurns !== undefined ? { extraTurns: rd.extraTurns } : {}),
            ...(rd.perTargetDealt !== undefined ? { perTargetDealt: rd.perTargetDealt } : {}),
        };
    });

    return {
        rounds: rows,
        summary: {
            totalHealing: Math.round(totalDirectRaw + totalHotRaw),
            totalDirectHeal: Math.round(totalDirectRaw),
            totalHotHeal: Math.round(totalHotRaw),
            totalShield: Math.round(totalShieldRaw),
            totalCleanses: Math.round(totalCleansesRaw),
            totalEffectiveHealing: Math.round(totalEffectiveRaw),
            totalOverheal: Math.round(totalOverhealRaw),
            totalShieldAbsorbed: Math.round(totalShieldAbsorbedRaw),
            totalBarrierAbsorbed: Math.round(totalBarrierAbsorbedRaw),
            totalIncomingDamage: Math.round(totalIncomingRaw),
            avgHealingPerRound:
                numRounds > 0 ? Math.round((totalDirectRaw + totalHotRaw) / numRounds) : 0,
            ...(healing?.destroyedRound !== undefined
                ? { destroyedRound: healing.destroyedRound }
                : {}),
            ...(hasTeamActors ? { teamTotalHealing: Math.round(totalTeamRaw) } : {}),
        },
    };
}
