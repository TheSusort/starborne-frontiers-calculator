import { ShipSkills } from '../../types/abilities';
import { SelectedGameBuff, TeamActorInput } from '../../types/calculator';
import { AffinityName } from '../../types/ship';
import type { ShipTypeName } from '../../constants/shipTypes';
import type { FactionKey } from '../../constants/factions';
import type { Position } from '../../types/encounters';
import type { ActiveBuff } from '../combat/statusEngine';
import type { CombatEventBus } from '../combat/events';
import { runCombat, EnemyRoundEffects } from '../combat/engine';
import { selectFiringSkill } from '../abilities/applyAbilities';
import type { ParsedTarget, ParsedPattern, ShipTargeting } from '../targetingParser';
import { computeAffinityModifiers } from './affinityUtils';
import { toDotAndPenModifiers } from './dpsBuffHelpers';
import { deriveTeamEngineActors } from './dpsSimulator';
import { DEFAULT_FRONT_ENEMY_TARGET } from './dpsEnemyPlacement';
import {
    defaultEnemySlot,
    resolveEnemySlots,
    resolveHealingPlayerPlacement,
} from './healingPlacement';
import {
    DEFAULT_ENEMY_DEFENCE,
    DEFAULT_ENEMY_HP,
    DEFAULT_ENEMY_SECURITY,
    DEFAULT_ENEMY_SPEED,
} from './healingDefaultEnemy';

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
         *  (engine.ts:675-676 and :726-727, the two `defence: e.stats.defence ?? 0` /
         *  `hp: e.stats.hp ?? 0` pairs in the enemy-actor constructors). */
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
    /** Board slot. Optional since SP-4b-1 — `normalizeCombatRoster` auto-places an enemy that
     *  arrives without one (`defaultEnemySlot`, walked from the front column). Supply it to choose
     *  the cell; an EXPLICIT cell also beats another enemy's invented one on a collision. */
    position?: Position;
    /** Parsed target selection. Position alone does NOT route a cast — with no ParsedTarget,
     *  `selectTurnTarget` short-circuits to NO VICTIM however well-positioned the roster.
     *  The boundary fills that gap now (`DEFAULT_FRONT_ENEMY_TARGET`), so the short-circuit is
     *  unreachable from here; the adapter still SUBSTITUTES an ally-side target, which is a
     *  matchup policy the boundary deliberately does not apply — see `offensiveTarget`. */
    target?: ParsedTarget;
    /** Parsed pattern. Governed by the SAME positional-apply gate as `target`: with a target but
     *  no pattern the cast resolves onto the real enemy yet skips the per-victim apply, leaving
     *  `perTargetDealt` empty while the damage number still looks plausible. Also filled by the
     *  boundary (`DEFAULT_BASE_PATTERN`) when absent, so that half-filled state cannot arise. */
    pattern?: ParsedPattern;
    /** Charged-axis targeting when it differs from active. Falls back to `target` / `pattern`. */
    chargedTarget?: ParsedTarget;
    chargedPattern?: ParsedPattern;
    /** #363: this enemy attacker's faction — maps to the engine's `enemyAttackers[].faction`,
     *  seeding the actor→faction map that a faction-scoped ally grant intersects against
     *  (Fuying's "grants Tianchen allies Stealth"). Absent → unknown faction → an enemy-side
     *  faction-scoped grant never reaches this enemy (conservative). Spread straight through by
     *  `engineEnemyAttackers` below, same as every other passthrough field on this interface. */
    faction?: FactionKey;
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
    /** #363: the HEALER ship's faction — maps to the engine's focus-actor `faction`, seeding the
     *  actor→faction map that a faction-scoped ally grant intersects against (Fuying's "grants
     *  Tianchen allies Stealth"). Team actors carry their own `faction` on TeamActorInput (passed
     *  through untouched). Absent (manual config, no ship picked) → unknown faction → the healer
     *  never receives a faction-scoped grant. */
    healerFaction?: FactionKey;
    /** #426: the HEALER ship's NAME, for the live `ally-on-team` roster check (Isha/Nayra's
     *  reciprocal Affinity Override gate). Team actors carry their own `name` on `TeamActorInput`
     *  (passed through untouched). Supply the picked ship's real name, never a display label —
     *  absent (manual config, no ship picked) → `ally-on-team` keeps its assume-met fallback,
     *  which is the right answer when there is no ship to ask about. Mirrors `healerRole` and
     *  `healerFaction`'s contract exactly. */
    healerName?: string;
    /** The heal target's security stat. Deprecated — reserved for future per-target live landing
     *  recompute; currently unused by the adapter (inbound enemy landing is driven by the live
     *  hacking-vs-security recompute from enemy.hacking / heal-target's effective security). */
    healTargetSecurity?: number;
    teamActors?: TeamActorInput[];
    enemies: EnemyAttackerInput[];
    rounds: number;
    /** The healer's board slot. Optional, but the engine's auto-placement never sees it absent:
     *  `resolveHealingPlayerPlacement` substitutes `DEFAULT_HEALER_SLOT` (M2) before the input is
     *  built, and the coverage-aware heal-target default is derived FROM the resolved healer cell —
     *  so omitting it moves the heal target too, not just the healer. */
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
    /** SOURCE-axis: shield RAW cast by the healer. There is no recipient-axis shield credit
     *  (`credit(actor.id, 'shield', raw)` is source-keyed and the pool lands per-recipient via
     *  `grantShieldToTarget`), so this — like `cleanseCount` — deliberately stays source-keyed. */
    shield: number;
    cleanseCount: number;
    /** RECIPIENT-axis (SP-3b Task 7): the HEAL TARGET's OWN share of the repairs that landed on
     *  it, read from `HealingRoundEngine.perRecipient[healTargetId]` — NOT the healer's whole
     *  output. Since per-recipient application went live, the source-axis bucket
     *  (`perActor[FOCUS_ID]`) aggregates repairs that landed on OTHER allies too, so reading it
     *  here silently answered "everything the healer produced, wherever it went" instead of "how
     *  much actually landed on the ship I am keeping alive". The throughput fields
     *  (directHeal/hotHeal/totalRoundHealing/cumulativeHealing) stay on the source axis.
     *
     *  Every repair whose pool application succeeds is mirrored onto the recipient axis (cast, HoT,
     *  leech, reactive) — see `HealingRoundEngine.perRecipient`. A future source that forgets to
     *  mirror would silently under-report here, which is why that contract is spelled out there. */
    effectiveHealing: number;
    /** RECIPIENT-axis (SP-3b Task 7) — the heal target's OWN clipped over-repair. Same axis and
     *  the same known gap as `effectiveHealing`. */
    overheal: number;
    incomingDamage: number;
    shieldAbsorbed: number;
    /** Full-immunity blocked total this round; distinct from shieldAbsorbed — Barrier never
     *  touches the shield pool. */
    barrierAbsorbed: number;
    /** #358 ADDENDUM 2/3: `incomingDamage` BEFORE EVERY victim-side reduction — the RAW damage
     *  thrown at the focus this round. Not just defence: also its own `Inc. Damage Down` family,
     *  its pre-fight incoming baseline, `equipReductionPct`, `incomingDotReductionPct` and the
     *  reflect channel's incoming-reduction. `incomingDamage` is post-reduction, so it FALLS as a
     *  ship gets tankier; this is the axis the "Damage absorbed" headline reads.
     *  `>= incomingDamage` OVER A WINDOW SUM, equal when the victim applies no reduction at all —
     *  NOT per round. A DoT transform books the full raw amount at throw time and the re-booking
     *  ticks carry `perTickPreMitigation: 0` while contributing real post damage, so a single later
     *  round can read lower on this axis than on `incomingDamage`. NOT part of the intake breakdown —
     *  `shieldAbsorbed`/`barrierAbsorbed`/`convertedToShield` partition `incomingDamage`, and
     *  mixing the two axes breaks that identity. */
    incomingDamageRaw: number;
    /** Direct-hit damage nullified by `Shield Converter` and turned into Shield. A FOURTH mitigation
     *  channel alongside shieldAbsorbed/barrierAbsorbed, and like them already contained in
     *  `incomingDamage` — never add these together. */
    convertedToShield: number;
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
     *  plausible damage number, while `perTargetDealt` comes back EMPTY (engine.ts:4174,
     *  `const roundPerTargetDealt = new Map<...>()`, which "stays EMPTY when roundPerTargetDamage
     *  is empty (non-positional rounds)" and is then omitted from RoundData altogether). */
    perTargetDealt?: Record<string, Record<string, number>>;
    /** Per-recipient breakdown (SP-3b Task 7): keyed by the ally a repair LANDED ON, forwarded from
     *  `HealingRoundEngine.perRecipient` — the counterpart to the source-keyed `perActor` the
     *  throughput fields read. Follows the "absent when empty" convention of
     *  perActorShield/perActorIncoming, so a run with no per-recipient data keeps the legacy row
     *  shape byte-identical.
     *
     *  Every repair whose pool application succeeded is on this axis — cast repairs, HoT ticks,
     *  leeches and reactive repairs (SP-3b Task 7). `shield`/`cleanseCount` are NOT: they have no
     *  recipient-side total, which is exactly why the row keeps them source-keyed.
     *
     *  ⚠️ FOR THE PER-ALLY TABLE (Task 9) THAT READS THIS: two invariants people expect from the
     *  legacy source-only report do NOT hold once you sum across this map.
     *    1. `Σ perRecipient[*].directHeal` is ≤ the row's own `directHeal` — NOT equal to it. Only
     *       LANDED repairs are mirrored here (an `all-allies` leech credits the source's raw for
     *       every ally but only mirrors the one(s) it actually repaired), so the per-recipient
     *       rows never sum back up to the source row.
     *    2. The row-level `effectiveHealing + overheal <= totalRoundHealing` invariant, true on
     *       the OLD single-axis report, no longer holds once `effectiveHealing`/`overheal` are
     *       recipient-axis and `totalRoundHealing` stays source-axis. E.g. the role-filtered
     *       regeneration scenario legitimately shows `effectiveHealing: 1000, overheal: 1500,
     *       totalRoundHealing: 0` (the repairs came from an ally, not the focus healer). Do not
     *       "fix" a table that renders numbers like that — it is the two axes disagreeing by
     *       design, not a bug. */
    perRecipient?: Record<
        string,
        { directHeal: number; hotHeal: number; effectiveHealing: number; overheal: number }
    >;
}

export interface HealingSimulationResult {
    rounds: HealingRoundData[];
    summary: {
        totalHealing: number; // RAW (direct + HoT), focus actor
        totalDirectHeal: number;
        totalHotHeal: number;
        totalShield: number;
        totalCleanses: number;
        /** RECIPIENT-axis (SP-3b Task 7): Σ over rounds of the HEAL TARGET's OWN landed share —
         *  identically `perRecipient[healTargetId].totalEffectiveHealing`. NOT the team-wide sum:
         *  the per-recipient totals sum to MORE than this whenever the caster's support footprint
         *  reaches another ally. */
        totalEffectiveHealing: number;
        /** RECIPIENT-axis (SP-3b Task 7) — the heal target's OWN over-repair. See above. */
        totalOverheal: number;
        totalShieldAbsorbed: number;
        totalBarrierAbsorbed: number;
        totalIncomingDamage: number;
        /** RAW healing / rounds — NOT effective. */
        avgHealingPerRound: number;
        destroyedRound?: number; // present only if the target died
        teamTotalHealing?: number;
        /** Window totals on the RECIPIENT axis (SP-3b Task 7), keyed by the ally a repair landed
         *  on. `perRecipient[healTargetId].totalEffectiveHealing === totalEffectiveHealing` by
         *  construction — the top-level number IS the heal target's row. "Absent when empty",
         *  mirroring the per-round field. */
        perRecipient?: Record<string, { totalEffectiveHealing: number; totalOverheal: number }>;
    };
}

/**
 * The engine's internal focus actor id — i.e. the HEALER.
 *
 * Exported because the RECIPIENT-axis maps (`HealingRoundData.perRecipient` and its summary
 * counterpart) are keyed by ENGINE actor id, and the healer's key is this one, not the public
 * `healTargetId: 'healer'` the input takes. A UI that labels those rows therefore has to know it.
 */
export const FOCUS_ID = 'attacker';

/** The id the synthesized opponent carries. Exported so tests can assert on it by name. */
export const PRACTICE_TARGET_ID = 'practice-target';

/**
 * "No enemies" is a legitimate healing scenario — the user wants to read pure output, where every
 * heal is overheal. The engine requires a non-empty roster (SP-4b-2b), so the adapter represents
 * that scenario as ONE inert opponent: a default enemy card with `attack: 0` and no kit. The
 * difference between it and a real card is precisely that it does not act.
 *
 * It is killable, exactly as a real default card is. A healer whose cast carries a damage clause
 * can destroy it and spend the rest of the window with no targetable opponent — the same shape as
 * killing your only real enemy today, and SP-4c has since removed the sink underneath both.
 *
 * HP stays at the card default rather than being inflated to make it immortal, because an HP-scaled
 * damage channel is exactly what a huge number would distort: corrosion is
 * `const corrosionBaseHp = Math.min(args.enemyHp, 500_000);` (engine.ts) per 1% per stack and
 * detonation is `min(victimHp, 500_000)` (detonation.ts:14). Both already read the real VICTIM's
 * own max HP today: corrosion's per-victim positional DoT-tick branch passes
 * `enemyHp: recipientMaxHp(actor.id)` (engine.ts, that exact line) — the only site that credits a
 * DoT tick per-victim (`creditDealt(sourceId, actor.id, dealt)`) — and that is the branch the
 * practice target actually runs, since it sits in `baseHpById` via `enemyAttackerActors`
 * (`const baseHpById = new Map<string, number>([`, whose entries include
 * `...enemyAttackerActors.map((a) => [a.id, a.stats.hp])`). The
 * bare fight-wide `enemyHp` scalar reaches `tickDoTs` on NO path any more: both of its call sites
 * pass a `recipientMaxHp(...)`, and the vestigial dummy branch that passed the bare scalar went
 * with the actor in SP-4c-2d. So inflating this HP to make the target
 * immortal would immediately multiply every corrosion tick against it by the same ratio — e.g. 40,000
 * → 500,000 is 12.5×. Inferno is unaffected either way: measured at 5,000 against a 1,000,000-HP
 * victim and a 40,000-HP one alike, because it scales off the APPLIER's attack (engine.ts:1066,
 * `ctx.effectiveAttack` inside the inferno `tickByTier`), not HP.
 *
 * `hacking` is deliberately absent rather than zeroed: absent means the engine's own 200, which is
 * what the page's card seeds, and a kitless actor lands no debuffs either way. Targeting axes are
 * absent for the same reason a manual card's are — `normalizeCombatRoster` fills front/base.
 */
const practiceTarget = (): EnemyAttackerInput => ({
    id: PRACTICE_TARGET_ID,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        speed: DEFAULT_ENEMY_SPEED,
        defence: DEFAULT_ENEMY_DEFENCE,
        hp: DEFAULT_ENEMY_HP,
        security: DEFAULT_ENEMY_SECURITY,
    },
    chargeCount: 0,
    startCharged: false,
});

/**
 * Thin adapter over the combat engine (`src/utils/combat/engine.ts`) running in HEALING
 * mode. Mirrors `simulateDPS`: it derives the engine's input from the public healing input —
 * the heal-target id mapping, the debuff landing chance (the healer's hacking vs the VICTIM's
 * security — per-enemy since SP-3, defaulted to `LEGACY_SINK_SECURITY` when the card leaves it
 * unspecified, which is every card the UI produces; the fight-wide `enemySecurity` scalar has no
 * engine reader left since SP-4c-2d deleted the dummy actor it described),
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
 * (engine.ts:2251, `attackerAffinity: input.affinity,` on the focus runtime) — so the healer's OWN
 * offensive matchup vs each enemy goes live, and its damage
 * cast (and any `damage-dealt` rider off it) swings ±25%. When healing an ALLY the focus carries no
 * affinity at all, so the healer's offence stays neutral. The clean long-term shape is a dedicated
 * `healerAffinity` input rather than borrowing `healTargetAffinity` for two jobs; until then the
 * self-heal case is the more faithful of the two and the ally case the more conservative.
 *
 * POSITIONAL (SP-3). Both rosters are placed on the board and both sides fight for real: every
 * player ship and every enemy gets a cell (`resolvePlayerSlots` / `resolveEnemySlots`, so no two
 * same-side actors share one — a collision silently ERASES the earlier actor from that cell), and
 * every actor on BOTH sides — focus, team actors, enemies — carries a ParsedTarget + ParsedPattern,
 * defaulted to front/base when the caller supplies none. Since SP-4b-1 that defaulting is the
 * ENGINE's, not this adapter's: `normalizeCombatRoster` fills both axes on `runCombat`'s first line
 * and the duplicate derivation here was retired. It is load-bearing, not tidiness: a team actor's
 * axes are sourced exclusively from `teamTargetById`/`teamPatternById`, so an actor missing them
 * would resolve NO opposing victim at all — `selectTurnTarget` returns `tgt: undefined` (on the
 * player side since SP-4c-2b, on both since SP-4e) — and its offensive clause would deliver
 * nothing. Before SP-4c-2d that same miss short-circuited to the dummy sink, and the actor's
 * `basis:'damage-dealt'` riders then scaled off that sink's 10,000 defence instead of the real
 * enemy's.
 * What this adapter still owns is the ally-side SUBSTITUTION (`offensiveTarget`), which is
 * a matchup policy rather than a fill — the boundary only fills what is ABSENT.
 *
 * Consequences the pre-SP-3 dummy run did not have: every player cast lands per-victim on a real
 * enemy (so `basis:'damage-dealt'` riders scale off that enemy's own defence), enemies can be
 * KILLED and stop bombarding, and heals reach exactly the allies the caster's support footprint
 * covers (`perRecipientHealApply`). An off-footprint heal target receives nothing at all; that is
 * game-faithful and deliberately not softened — correct default placement (`healingPlacement.ts`,
 * via `defaultHealTargetSlot`) is the only mitigation.
 *
 * There is no fallback opponent on EITHER side any more. Every case that used to route a player
 * cast to the vestigial dummy — a roster with no targetable member (every enemy at max hp 0), a
 * placed actor whose target resolves to no living victim (the mid-run whiff window), missing
 * target/pattern axes, and an EMPTY roster — now yields "no victim": SP-4c-2b made
 * `selectTurnTarget` return `tgt: undefined` for a player actor that resolves nobody, and SP-4c-2d
 * deleted the actor itself. The ENEMY side used to end in a fallback to the HEAL TARGET — a real,
 * positioned player actor, not the dummy — and SP-4e (#335) deleted that too: an ally-targeted
 * enemy support ship now resolves NO victim instead of anchoring on the focus player. See the
 * LEGACY_SINK_* comment below.
 *
 * `enemies: []` is a SUPPORTED shape and reaches this function from production: it means "nothing
 * shoots back", and `effectiveEnemies` turns it into ONE inert PRACTICE TARGET (`practiceTarget`
 * above) so the run reads as pure healing output with everything overhealed. The page no longer
 * floors its roster at one — the floor existed only because an empty roster used to be handed to
 * the dummy, and the practice target removed that reason.
 *
 * History, and why the practice target carries a real defence rather than 0: while the empty case
 * fell to the dummy, every `basis:'damage-dealt'` rider silently rebased off the sink's fixed
 * 10,000 defence and `perTargetDealt` disappeared — measured totalDirectHeal 3,876 with one real
 * enemy at defence 1,000 → 1,290 with none, a 3x move from a single click on a fresh page. The
 * practice target reuses the page's default card numbers (`healingDefaultEnemy.ts`) precisely so
 * that emptying the roster changes only the incoming damage, not the STAT BASIS of the healer's own
 * output.
 *
 * The claim is exact equality, not merely "same stat basis": swapping a 0-attack default card for
 * the practice target changes only the incoming damage (0 either way here), never the healer's own
 * output — verified under a seeded RNG (`setupKeyedTestRng`) at healer crit 0, 50 and 100, all three
 * giving byte-identical `totalDirectHeal` AND per-round series between the two runs (see
 * `healingPracticeTarget.test.ts`'s `it.each([0, 50, 100])` stat-basis case, which asserts both).
 * Measured there at `critDamage: 100` — 6,248 / [2083, 2083, 2083] at crit 0, 16,662 /
 * [4166, 4166, 8331] at crit 50, 24,994 / [8331, 8331, 8331] at crit 100 — so the sweep spans a
 * no-crit, a MIXED and an always-crit profile. A live `critDamage` is load-bearing to that: with
 * `critDamage: 0` a crit multiplies by 1 and all three crit settings collapse onto the same 6,248,
 * which would make the sweep three copies of one case rather than three profiles. Reproducing that equality
 * at all requires a seeded harness: production draws are unseeded `Math.random`
 * (`rateAccumulator.ts:11-14`), so two live page runs are never expected to match — the equality is
 * a property of the simulation given the same random stream, not a promise about two independent
 * clicks.
 *
 * The ally-side substitution below is the other half of the same claim: a support healer's ACTIVE
 * target is ally-side, which resolves to no opposing victim at all.
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

    // An empty roster means "nothing shoots back", not "hand the run to the dummy" (which is what
    // it used to mean, before the practice target and before SP-4c-2d). Every reader
    // below MUST use this, not `enemies` — there are four (the three slot-resolution arguments
    // and the map).
    const effectiveEnemies = enemies.length ? enemies : [practiceTarget()];

    // SP-3: the healer's `damage` cast now lands on a REAL positioned enemy, which is exactly what
    // F7's `basis:'damage-dealt'` riders needed — that finding was conditional on the run being
    // non-positional, not permanent. Since SP-4b-2b that holds for EVERY run: `effectiveEnemies`
    // above guarantees a non-empty roster, so an empty input fights the practice target rather than
    // the dummy and the sink's defence is no longer the basis for anything. The ally-side target
    // substitution further down is the other half of the same claim.
    //
    // These scalars are the LEGACY SINK. They used to do DOUBLE duty; only the one job is left:
    //
    //  1. GONE. They described the dummy actor, which SP-4c-2d deleted, and SP-4d rung Task 6
    //     removed the fight-wide `enemyDefense`/`enemyHp`/`enemySecurity`/`enemySpeed` fields from
    //     `CombatEngineInput` entirely — the `runCombat` call below no longer passes them;
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
    // SP-4c-2d retired the dummy outright; these keep their pre-SP-3 values because job 2 above
    // still needs them.
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

    /**
     * The actor-level `target` axis exists to bind the OFFENSIVE cast — which opposing cell this
     * actor's damage anchors on. An ALLY-side target cannot do that job and must not be forwarded.
     *
     * ⚠️ NOT a normalisation nicety, and NOT something the engine's boundary covers — it fills an
     * ABSENT axis, it never rewrites a supplied one. `resolvePositionalTarget` returns `null` for
     * `target.side === 'ally'`, and the consequence is side-dependent:
     *   - PLAYER side (the healer and its team actors): `selectTurnTarget` answers `tgt: undefined`
     *     (SP-4c-2b). The engine's `positional` gate is fenced on `tgt !== undefined`, and
     *     `runPlayerTurn` fences its own damage assembly on `hasVictim`, so an offensive clause in
     *     the cast delivers exactly ZERO and `perTargetDealt` stays empty.
     *   - ENEMY side (a support ship the user picked as an opponent): the SAME answer since
     *     SP-4e. It used to fall back to the HEAL TARGET, so the cast anchored on that one player
     *     actor instead of the cell its own pattern was meant to walk; that fallback is deleted.
     * Either way the supplied ally-side axis cannot do the offensive job, which is why it is
     * substituted here rather than forwarded.
     *
     * History (measured before SP-4c-2b, when the player side ALSO fell back): the bound victim was
     * the position-less dummy, `willApplyPositionally` never tested the target's SIDE so it stayed
     * TRUE, and the positional apply resolved footprint victims from `tgt.position === undefined`,
     * found none, and delivered ZERO. Measured on a Volk-shaped `allies` target with
     * `Pattern-Cone-Support-Range-1` over a `damage` + 50% `damage-dealt` rider kit: `perTargetDealt`
     * undefined and the rider heal 0 at enemy defence 1,000 AND at 9,000 — no sensitivity at all —
     * where the same kit with `front` targeting pays 3,876. The zero survived the dummy's deletion;
     * only the route to it changed.
     *
     * This is the MAJORITY production config, not an edge case: `docs/ship-targeting.csv` lists 20
     * ships with an ally-side `active_target` (AEGIS, Chimei, Cultivator, Flamel, Graphite, Grif,
     * Harvester, Hayyan, Heliodor, Hermes, Howler, Makoli, Meatshield, Nyxen, Oleander, Paracelsus,
     * Salvation, Sentinel, Shelter, Volk) — i.e. the entire healer roster this calculator exists for,
     * plus any of them picked as an ENEMY. No shipped ship reports a wrong number today only because
     * all 20 wrap a repair/shield percentage in `<unit-damage>` and none carries a real damage clause.
     *
     * The SUPPORT footprint is unaffected: `supportFootprintAllyIds` derives it from `pattern`
     * (playerTurn.ts:1143) which is threaded separately, and `resolveSupportRecipients` never reads
     * this axis. Substituting here therefore costs the support side nothing.
     */
    const offensiveTarget = (t: ParsedTarget | undefined): ParsedTarget =>
        t !== undefined && t.side !== 'ally' ? t : DEFAULT_FRONT_ENEMY_TARGET;
    /** Same rule for the charged axis — but `undefined` must STAY undefined, because the engine's
     *  own fallback is "charged axis absent ⇒ reuse the active one". Substituting a default here
     *  would silently override a charged-target-less actor's active binding. */
    const chargedOffensiveTarget = (t: ParsedTarget | undefined): ParsedTarget | undefined =>
        t === undefined ? undefined : offensiveTarget(t);

    // Player-side slots (SP-3), resolved by the SHARED helper the page's placement warning also
    // calls — so the warning reasons about the cells this run really uses. Collision resolution is
    // load-bearing, not tidiness: the positional maps are keyed by cell, so on a collision the LATER
    // actor silently ERASES the earlier one from that cell. The healer never moves.
    //
    // Two rules the helper owns (see `resolveHealingPlayerPlacement` for the measurements):
    //  - an unplaced HEAL TARGET gets the COVERAGE-AWARE default, because heals apply only to the
    //    recipients the caster's support footprint covers and an off-footprint heal target receives
    //    NOTHING. That zero is game-faithful and deliberately not softened — the default simply must
    //    not walk into it;
    //  - that default is nominated for collision PRIORITY over the generic team defaults (which draw
    //    from the same small pool, e.g. T2 is both the Cone-Support pick from M2 and
    //    `defaultHealingTeamSlot(1)`) — but only while it IS a default: an explicit user placement
    //    never loses its cell to another actor's default.
    const { healerSlot: resolvedHealerSlot, allySlots: playerAllySlots } =
        resolveHealingPlayerPlacement({
            healerSlot: input.healerPosition,
            healerPattern: input.healerTargeting?.active?.pattern,
            healTargetId,
            allies: teamActors ?? [],
        });
    // SP-3, load-bearing: on the POSITIONAL path the pre-resolved `affinityDamageModifier` scalars
    // below are BYPASSED — `victimHitDamage` recomputes each matchup from the attacker's RAW
    // affinity against the VICTIM's own `CombatActor.affinity` (playerTurn.ts:1250). The heal
    // target therefore has to actually CARRY `healTargetAffinity`, or every enemy's matchup
    // collapses to neutral and the documented ±25% swing silently disappears. Threaded onto
    // whichever actor IS the heal target; an actor's own `affinity` always wins.
    // The parsed axes mirror the enemy branch below EXACTLY, and for the same reason: a team
    // actor's target/pattern are sourced ONLY from `teamTargetById`/`teamPatternById`, which are
    // populated only from `t.target`/`t.pattern`. With neither, `selectTurnTarget` WOULD resolve NO
    // victim at all (`tgt: undefined` on the player side since SP-4c-2b, on both since SP-4e)
    // however well-positioned the roster is, and the actor's offensive clause would deliver
    // nothing. Before SP-4c-2d the same
    // miss short-circuited to the dummy sink, and the actor's `basis:'damage-dealt'`
    // riders then computed against the sink's 10,000 defence instead of the real enemy's (measured
    // 2579 vs 7753 on a walked ally with attack 10,000 vs an enemy at defence 1,000 — a ~3× error
    // that surfaced as `teamHealing`). It bit the DEFAULT production config, whose heal target walks
    // `buildDefaultShipSkills()` — a kit that carries a damage ability. SP-4b-1 moved that
    // guarantee INTO the engine (`normalizeCombatRoster` fills both axes for every team actor), so
    // what remains here is only the ally-side substitution, which the boundary must not do.
    const positionedTeamActors = (teamActors ?? []).map((t, i) => ({
        ...t,
        position: playerAllySlots[i],
        affinity: t.affinity ?? (t.id === healTargetId ? healTargetAffinity : undefined),
        // Ally-side axes are substituted, not forwarded — see `offensiveTarget`. A team actor with an
        // ally-side active target would otherwise resolve no victim and deliver zero, exactly as the
        // focus would.
        target: offensiveTarget(t.target),
        // `pattern` is NOT defaulted here: `normalizeCombatRoster` (runCombat's first line) fills an
        // absent pattern with the same DEFAULT_BASE_PATTERN. `target` still is — substituting an
        // ALLY-side target is this calculator's matchup POLICY, and the boundary only FILLS.
        pattern: t.pattern,
        chargedTarget: chargedOffensiveTarget(t.chargedTarget),
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
    //
    // An INVENTED slot must yield to an EXPLICIT one — the same binding constraint
    // `normalizeRoster.ts`'s `placeSide` obeys, for the same reason. `e.position ?? defaultEnemySlot(i)`
    // collapses "the caller asked for this cell" and "we made this cell up" into one array, and
    // `resolvePlayerSlots` reserves index 0 before everything else, so an unplaced enemy #0 used to
    // claim its invented `defaultEnemySlot(0)` (M4) ahead of an enemy the caller had explicitly put
    // there — silently evicting that explicit enemy to the first free cell. Restoring the distinction
    // takes the two extra arguments commit 3952a6a0 added for exactly this: every explicitly-placed
    // index is nominated so it survives a collision against anything invented, and `anchorIsExplicit`
    // says whether index 0's own wanted cell was the caller's choice or ours. Both arguments are inert
    // when every enemy is explicitly placed (nothing is invented to lose to) and when none is (there
    // is no explicit cell to protect), so the common healing-page shapes are unchanged.
    const enemySlots = resolveEnemySlots(
        effectiveEnemies.map((e, i) => e.position ?? defaultEnemySlot(i)),
        effectiveEnemies.flatMap((e, i) => (i !== 0 && e.position !== undefined ? [i] : [])),
        effectiveEnemies[0]?.position !== undefined
    );
    const engineEnemyAttackers = effectiveEnemies.map((e, i) => {
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
            // resolve NO victim at all. (Before SP-4e the enemy side fell back to the HEAL TARGET
            // here, and before SP-4c-2d the player side fell back to the dummy; both are gone.)
            // That ABSENT case is now the engine boundary's job
            // (`normalizeCombatRoster` fills the same
            // `DEFAULT_FRONT_ENEMY_TARGET`); `offensiveTarget` is kept here for the half it owns —
            // an ALLY-side parsed target is SUBSTITUTED rather than forwarded, which a fill cannot
            // do because the axis is present. That half is live: the page feeds every enemy its
            // REAL parsed targeting, so a support ship picked as an enemy — 20 of them have an
            // ally-side active target — would otherwise run its offensive clause with no victim at
            // all (before SP-4e: against the fabricated heal-target anchor).
            target: offensiveTarget(e.target),
            // Filled by `normalizeCombatRoster`, not here — see the team-actor branch above.
            pattern: e.pattern,
            chargedTarget: chargedOffensiveTarget(e.chargedTarget),
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
        // Base hacking (holistic review #1) — threaded onto the focus (healer) actor so the engine's
        // live per-turn recompute drives landing uniformly across all three modes (DPS / battle-sim /
        // healing). Walked team-actor hacking flows via the walk bundle (deriveTeamEngineActors →
        // engine reads walk.stats.hacking). Each real enemy's own `stats.security`/`stats.speed`
        // (set above) is what counts for a fought enemy; the engine has no fight-wide
        // `enemySecurity`/`enemySpeed` fields to accept a scalar for either any more (SP-4d).
        hacking: healer.hacking,
        healModifier: healer.healModifier,
        role: input.healerRole,
        faction: input.healerFaction,
        // #426: seeds `nameByActorId` so `ally-on-team` is a live roster check whenever a real
        // ship was picked, instead of silently assuming the named ally is present.
        name: input.healerName,
        healTargetId,
        enemyAttackers: engineEnemyAttackers,
        mode: 'healing',
        teamActors: engineTeamActors,
        bus: input.bus,
        // Positional plumbing (SP-3). Both position AND target AND pattern are required: with a
        // target but no pattern the cast resolves onto the real enemy yet skips the per-victim
        // apply, so `perTargetDealt` comes back EMPTY while the damage number looks plausible.
        position: resolvedHealerSlot,
        // A support healer's parsed ACTIVE target is ALLY-side for 20 of the roster's ships, and an
        // ally-side target resolves NO opposing victim (`tgt: undefined` since SP-4c-2b) — so any
        // offensive clause in the cast delivers exactly zero. Substituted here; the support footprint
        // rides `pattern` below and is untouched. See `offensiveTarget` for the measurements.
        target: offensiveTarget(input.healerTargeting?.active?.target),
        // Filled by `normalizeCombatRoster` when absent — see the team-actor branch above.
        pattern: input.healerTargeting?.active?.pattern,
        chargedTarget: chargedOffensiveTarget(input.healerTargeting?.charged?.target),
        chargedPattern: input.healerTargeting?.charged?.pattern,
        // Heals apply to each recipient the caster's support pattern covers. Recipient CHOICE is
        // no longer a mode flag: a ship whose text names a worst-HP ally (Pallas, Volk, Valkyrie)
        // carries the 'lowest-hp-ally' target and routes there on any run; everything else routes
        // over the pattern. SP-4e retired `teamBattle`, which conflated the two.
        perRecipientHealApply: true,
    });

    // healing is always present (healTargetId is always set in this adapter), but guard anyway.
    const healingRounds = healing?.rounds ?? [];

    /**
     * The PLAYER-side recipient axis — every id a repair may legitimately be REPORTED against.
     *
     * ⚠️ NOT defensive tidiness: the engine's recipient axis is side-AGNOSTIC and enemy actors
     * genuinely land on it. `creditLandedRepair` (engine.ts) carries no side check, and two of its
     * call sites are reachable by an enemy owner:
     *   - `procTakenLeechesPerVictim(victim, …)` — `takenLeechesByOwner` is built from BOTH runtime
     *     maps, and the player→enemy attack sites call `procLeechesForVictim`, so an ENEMY victim
     *     with a `basis:'damage-taken'` repair passive credits itself as the "recipient";
     *   - `procStandingLeechesPerVictim` — its `self` branch resolves `recipients = [sourceId]`,
     *     which is the enemy's own id when the enemy is the attacker. Magnolia's real passive shape
     *     (`heal`, `basis:'damage-dealt'`, `target:'self'` — Valerian's too) hits exactly this, and
     *     the enemy panel explicitly invites the user to pick such a ship.
     *
     * Left unfiltered, the page's "Healing by ally" table renders that enemy as a healed ALLY
     * (measured: a single row `enemy-1 | 0 | 18,606` under a heading promising allies, with the real
     * heal target absent entirely). Filtered HERE rather than in the engine on purpose: an
     * `isEnemySide` guard inside `creditLandedRepair` is the more principled home but touches the
     * engine's enemy-side symmetry work, and the adapter is the layer that actually knows the whole
     * player id set — the focus, the resolved heal target, and every team actor.
     *
     * This drops enemy keys from the REPORT only; the engine still applies the enemy's own repair to
     * the enemy, so its survival is unaffected.
     */
    const playerRecipientIds = new Set<string>([
        FOCUS_ID,
        healTargetId,
        ...(teamActors ?? []).map((t) => t.id),
    ]);

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
    /** RECIPIENT-axis window totals, raw. Folded per round from `hr.perRecipient`, rounded LAST. */
    const perRecipientRaw = new Map<string, { effective: number; overheal: number }>();

    const rows: HealingRoundData[] = engineRounds.map((rd, i) => {
        const hr = healingRounds[i];
        const focus = hr?.perActor.get(FOCUS_ID);
        const directHealRaw = focus?.directHeal ?? 0;
        const hotHealRaw = focus?.hotHeal ?? 0;
        const shieldRaw = focus?.shield ?? 0;
        const cleanseRaw = focus?.cleanseCount ?? 0;
        // RECIPIENT axis (SP-3b Task 7) for the consumption split ONLY. `perActor` is keyed by the
        // actor that CAST the repair, so with per-recipient application live its
        // effectiveHeal/overheal aggregate everything the healer produced — including repairs that
        // landed on OTHER allies. The report's `effectiveHealing`/`overheal` must answer "how much
        // landed on the ship I am keeping alive", so they read the heal target's OWN entry.
        // Keyed by `healTargetId` (the RESOLVED id — FOCUS_ID only in the self-heal case), never
        // by FOCUS_ID, which would report the healer's own share when healing an ally.
        //
        // ⚠️ This read REQUIRES a COMPLETE recipient axis, and it was not complete when SP-3a
        // Task 2 introduced it — only the direct cast-repair site credited it. Repointing onto a
        // cast-only axis silently DELETED every non-cast repair from the report (measured on the
        // healing goldens: Magnolia's standing-leech overheal 1258 → 0, the HoT scenario's 2000 →
        // 500, Isha's reactive effectiveHealing 15000 → 0 — all repairs that genuinely landed on
        // the heal target). SP-3b Task 7 therefore completed the axis at the six non-cast
        // consumption sites (engine.ts `creditLandedRepair` ×4, playerTurn.ts `tickHot`,
        // triggers.ts's reactive executor). If a future source applies a repair without mirroring
        // it, this row silently under-reports again — see `HealingRoundEngine.perRecipient`.
        const recipient = hr?.perRecipient.get(healTargetId);
        const effectiveRaw = recipient?.effectiveHeal ?? 0;
        const overhealRaw = recipient?.overheal ?? 0;
        const incomingRaw = hr?.incomingDamage ?? 0;
        const shieldAbsorbedRaw = hr?.shieldAbsorbed ?? 0;
        const barrierAbsorbedRaw = hr?.barrierAbsorbed ?? 0;
        const incomingRawPreDefence = hr?.incomingDamageRaw ?? 0;
        const convertedToShieldRaw = hr?.convertedToShield ?? 0;

        // teamHealing = Σ non-focus PLAYER entries' raw (direct + HoT). Team shield contributes to
        // the pool mechanically (the engine consumes it) but is NOT separately reported here.
        //
        // ⚠️ The SOURCE axis is side-agnostic too, for the same reason the recipient axis is: an
        // enemy's own leech calls `healingCtx.credit(sourceId, 'directHeal', raw)` with the ENEMY's
        // id. "Every non-focus key" therefore counted enemy self-repair as TEAM healing — measured
        // on a Magnolia-shaped enemy passive: `teamHealing` 15,000/round (45,000 over the window)
        // that drops to 0 the moment the leech passive is removed, surfaced in the chart tooltip as
        // "Team Heal". Same `playerRecipientIds` gate as the recipient axis below.
        let teamRoundRaw = 0;
        if (hr) {
            for (const [id, h] of hr.perActor) {
                if (id === FOCUS_ID) continue;
                if (!playerRecipientIds.has(id)) continue;
                teamRoundRaw += h.directHeal + h.hotHeal;
            }
        }

        // Fold this round's recipient-axis entries into the window totals. RAW (unrounded) —
        // rounded once at presentation, like every other accumulator here. ENEMY-side keys are
        // dropped (see `playerRecipientIds`): the engine's axis is side-agnostic, so an enemy that
        // self-repairs off its own leech lands on it and would otherwise be reported as an ally.
        if (hr) {
            for (const [id, h] of hr.perRecipient) {
                if (!playerRecipientIds.has(id)) continue;
                const acc = perRecipientRaw.get(id) ?? { effective: 0, overheal: 0 };
                acc.effective += h.effectiveHeal;
                acc.overheal += h.overheal;
                perRecipientRaw.set(id, acc);
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
            incomingDamageRaw: Math.round(incomingRawPreDefence),
            convertedToShield: Math.round(convertedToShieldRaw),
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
            // Per-recipient breakdown (SP-3b Task 7): keyed by the ally a repair LANDED ON. Follows
            // the "absent when empty" convention of perActorShield/perActorIncoming so a run with no
            // per-recipient data keeps the legacy row shape byte-identical.
            ...(() => {
                const out: Record<
                    string,
                    {
                        directHeal: number;
                        hotHeal: number;
                        effectiveHealing: number;
                        overheal: number;
                    }
                > = {};
                for (const [id, h] of hr?.perRecipient ?? []) {
                    // Enemy-side keys never reach the report — see `playerRecipientIds`.
                    if (!playerRecipientIds.has(id)) continue;
                    if (
                        h.directHeal === 0 &&
                        h.hotHeal === 0 &&
                        h.effectiveHeal === 0 &&
                        h.overheal === 0
                    ) {
                        continue;
                    }
                    out[id] = {
                        directHeal: Math.round(h.directHeal),
                        hotHeal: Math.round(h.hotHeal),
                        effectiveHealing: Math.round(h.effectiveHeal),
                        overheal: Math.round(h.overheal),
                    };
                }
                return Object.keys(out).length > 0 ? { perRecipient: out } : {};
            })(),
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
            // SP-4c-1: divide by the ELAPSED rounds (`rows.length`), not the configured window
            // (`numRounds`). A healing run can now end early — a wiped side terminates the match —
            // and dividing by the window under-reports the pace of a short fight. This is the same
            // fix dpsSimulator already carries under SP-U U6; runs that survive the window are
            // unaffected, since rows.length === numRounds there.
            avgHealingPerRound:
                rows.length > 0 ? Math.round((totalDirectRaw + totalHotRaw) / rows.length) : 0,
            ...(healing?.destroyedRound !== undefined
                ? { destroyedRound: healing.destroyedRound }
                : {}),
            ...(hasTeamActors ? { teamTotalHealing: Math.round(totalTeamRaw) } : {}),
            // Recipient-axis window totals, rounded LAST from the raw accumulator. "Absent when
            // empty", mirroring the per-round field.
            ...(() => {
                const out: Record<
                    string,
                    { totalEffectiveHealing: number; totalOverheal: number }
                > = {};
                for (const [id, acc] of perRecipientRaw) {
                    if (acc.effective === 0 && acc.overheal === 0) continue;
                    out[id] = {
                        totalEffectiveHealing: Math.round(acc.effective),
                        totalOverheal: Math.round(acc.overheal),
                    };
                }
                return Object.keys(out).length > 0 ? { perRecipient: out } : {};
            })(),
        },
    };
}
