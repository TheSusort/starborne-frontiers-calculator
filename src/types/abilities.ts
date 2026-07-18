import type { ShipRoleCategory } from '../constants/shipTypes';
import { EnemyBaseClass, DoTType, StackTrigger, ParsedBuffEffects } from './calculator';

export type SkillSlot = 'active' | 'charged' | 'passive';

export type AbilityType =
    | 'damage'
    | 'counter'
    | 'additional-damage'
    | 'shield-strip'
    | 'modifier'
    | 'buff'
    | 'debuff'
    | 'dot'
    | 'extend-dot'
    // Wave 4 (Sokol/Ripper/Lev): generic extend-status — grows every eligible timed
    // buff or debuff by N turns (StatusEngine selfMaps/enemyMaps), the clean inverse of
    // the shipped duration-reduce ('cleanse' mode:'reduce-duration'). Distinct from
    // 'extend-dot', which operates on the separate DoT tick-stack store, not these maps.
    | 'extend-status'
    | 'detonate-dot'
    | 'accumulate-detonate'
    | 'charge'
    | 'extra-action'
    | 'heal'
    | 'shield'
    | 'cleanse'
    | 'purge'
    // PR10: buff steal (Pallas/Thresh/Tithonus charged skills) — moves the target's newest
    // stealable buff(s) to the caster (remaining duration travels with each), optionally also
    // granting them to the caster's adjacent allies (Tithonus). Reuses purge's stealable/
    // unremovable classification; see AbilityConfig's 'buff-steal' variant.
    | 'buff-steal'
    | 'control'
    | 'remove-self-buff'
    | 'incoming-reduction'
    | 'incoming-block'
    | 'incoming-shield-grant'
    | 'outgoing-amplification'
    | 'heal-amplification'
    | 'incoming-heal-amplification'
    // PR F4: permanent pre-fight base-stat grant, adjacency-conditioned (Lionheart/Centurion/
    // Enforcer/Defiant/Stalwart "At the start of combat …" / "when adjacent to a Supporter …"
    // passives). Applied ONCE to PlacementPlan stats by the battle sim's pre-fight layer (F5) —
    // never a status (hidden, non-purgeable, not reset on death). DPS calculators ignore it.
    | 'pre-combat-stat'
    // SP-E: Voron/Orel "transforms the [incoming direct] damage into a DoT lasting N turns" —
    // reactive self-ability (trigger:'on-attacked', target:'self'). See AbilityConfig's
    // 'transform-incoming-to-dot' variant.
    | 'transform-incoming-to-dot'
    // SP-E, Task E4: Belladonna's ally-Corrosion→Acidic-Decay conversion — reactive enemy-target
    // ability (trigger:'on-ally-debuff-inflicted'). See AbilityConfig's 'convert-dot' variant.
    | 'convert-dot'
    // SP-F F5 (Meatshield, R4 refit-active passive — APPROXIMATION): "Any direct damage dealt
    // to a non-defender ally that is not transferred by Protection is dealt as if that ally
    // had this Unit's defense." Protection-as-damage-transfer (a living ally holding Protection
    // stacks intercepting a fraction of an ally's direct hit, BEFORE the ally's own defence
    // applies) IS implemented (engine.ts's `protectorsFor` + the transfer block in
    // `applyVictimDamage`, via `protectionCascade`). This variant applies to the NON-TRANSFERRED
    // REMAINDER only: the transferred portion is re-mitigated on the protector's own defence, and
    // the ally's retained `(1 − redirectFraction)` share is what gets substituted with the
    // carrier's effective defence instead of the ally's own. So the R4 wording is realized
    // literally, not vacuously satisfied. Always-on passive, target:'all-allies'. See
    // AbilityConfig's 'defense-substitution' variant (a no-op marker — consumed at the engine's
    // defence-read sites, never through the ability-fold/executor pipeline).
    | 'defense-substitution'
    // SP-F F3 (Lingshe): "reduces all Bombs on the enemy targets by N turn(s), Bombs reduced
    // to 0 turns by this skill will detonate. This reduction effect requires hacking." Enemy-
    // targeted (all-enemies), hacking-gated (runtime always draws the 'inflict' landing roll —
    // see AbilityConfig's 'bomb-countdown-reduce' variant). Structurally distinct from the
    // generic `cleanse`/`reduce-duration` primitive (which deliberately excludes bombs and only
    // ever targets self/allies) — this shrinks the ENEMY's own PendingBomb.countdown, and any
    // bomb reaching <= 0 detonates immediately (bespoke runtime loop in playerTurn.ts,
    // `reduceEnemyBombs` — NOT detonateContainers/detonate(), which credit the CASTER
    // unconditionally and ignore countdown).
    | 'bomb-countdown-reduce'
    // Wave 4 Task 8 (FrontLine passive): "While Shielded, it gains N additional Defense" — a
    // FLAT-points DEFENSIVE stat bonus gated on the owner CURRENTLY holding a shield
    // (CombatActor.shieldPool > 0). No-op marker config (mirrors 'defense-substitution' /
    // 'damage-reflection' / 'buff-duration-extension') — the engine collects every carrier into
    // a dedicated per-owner map and folds the bonus into `substitutedDefenceFor`'s defensive
    // read, never through the on-cast ability-fold/executor pipeline. See AbilityConfig's
    // 'conditional-stat' variant doc comment for why neither `modifier` (percentage-only,
    // attacker-side DAMAGE-mode fold only) nor `pre-combat-stat` (permanent, no `defence`
    // option) can express this.
    | 'conditional-stat';

export type AbilityTarget =
    | 'self'
    | 'ally'
    | 'all-allies'
    | 'adjacent-allies' // Fortifying Shroud: living same-side allies on neighbouring board
    // cells (non-positional → all same-side allies). Resolved via
    // IntentExecContext.adjacentAllyIdsFor.
    | 'adjacent-enemies' // living opposing actors adjacent to the anchor (target excluded).
    // Resolved via adjacentAllyIdsFor(anchorId) with the enemy TARGET as anchor.
    | 'target-and-adjacent-enemies' // the anchor (primary target) PLUS its adjacent enemies.
    | 'enemy'
    | 'all-enemies'
    | 'enemy-most-buffs'
    | 'enemy-highest-attack' // D-PR14 Doomsayer: living opposing actor with the greatest
    //                           live effective attack (global selector, resolved at drain).
    | 'enemy-highest-speed'; // SP-M M1 Task 6 Chakara: living opposing actor with the greatest
//                           live effective speed (global selector, resolved LIVE at drain — no
//                           memo needed, Chakara's co-located clause is a self-buff that never
//                           changes an enemy's speed).

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
    // Phase 3 PR-I: fires when an OPPOSING-side actor receives a timed buff (rides the
    // existing `buff-applied` event, opposing-scoped on actorId — the buff RECIPIENT).
    // Nuqtu's self-cleanse + Terran Bolster III grant ("when an enemy gets buffed"),
    // promoted from a manual, non-derivable `enemy-buff` CONDITION (single-ship DPS has
    // no enemy casting buffs, so it never fires there) to a live reactive trigger for the
    // team simulator. Both effects are self-target — no capture needed.
    | 'on-enemy-buffed'
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
    | 'on-enemy-charged-cast' // Phase 4: opposing-scoped reaction to an ENEMY casting its
    // charged skill (Curator purge/Block-Buff, FrontLine damage+shield). Mirror of
    // on-charged-cast but gated isOpposing(actorId). Reuses eventCtx.counterTargetId to
    // route the reaction onto the casting enemy.
    // Fired when the owner applies repair to at least one OTHER ally (own heal-performed
    // event with a non-self recipient). Used by the Font of Power implant (grants the
    // repaired allies a buff). Distinct from on-ally-critically-repaired (no crit filter).
    | 'on-own-repair-to-ally'
    // D-PR16 Firewall: fires when THIS unit receives a timed debuff (rides the existing
    // `debuff-applied` event, self-scoped on targetId === ownerId). Does NOT fire for DoTs
    // (separate `dot-applied` event) — matches "when debuffed".
    | 'on-debuffed'
    // Phase 3 PR-E: fires when a same-side ALLY (not the owner) receives a timed debuff
    // (rides the existing `debuff-applied` event, ally-scoped on targetId being a same-side
    // actor other than the owner). The ally counterpart of `on-debuffed`. Does NOT fire for
    // DoTs (dot-applied), matching on-debuffed's debuff-applied-only scoping.
    | 'on-ally-debuffed'
    // Phase 3 PR-H: fires when THIS unit performs a cleanse that actually removes >= 1 debuff
    // (rides the existing `cleanse-performed` event, self-scoped on casterId === ownerId).
    // Cultivator ("when this Unit cleanses a Debuff, it also repairs that ally") is 'ally'-target
    // — routed to the cleansed ally via eventCtx.cleansedAllyIds; Morao ("upon Cleansing a
    // Debuff, repairs an additional 5% ... and gains Defense Up II") is 'self'-target — no
    // capture needed. Distinct from `on-enemy-cleansed` (opposing-scoped) — this is the
    // OWN-cleanse counterpart, mirroring on-debuffed/on-ally-debuffed's self/ally pairing.
    | 'on-own-cleanse'
    // D-PR16 Lockdown: fires when THIS unit resists an incoming debuff (rides the existing
    // `debuff-resisted` event, self-scoped on targetId === ownerId). Chains off D-PR15's
    // Block-Debuff auto-resist emission AND normal hacking/affinity resists.
    | 'on-debuff-resisted'
    // Fires when a debuff THIS unit inflicted is RESISTED by its target (inflictor-scoped on
    // sourceId === ownerId). Mirror of on-debuff-resisted (resister-scoped). Ravager's Hacking
    // Module Overdrive grant.
    | 'on-own-debuff-resisted'
    // Fired once per shield-application CAST. Reaction is keyed on the granter (acting actor)
    // and targets the shield recipient set — used by Resonating Fury to grant Crit Power Up 3
    // to everyone the carrier just shielded.
    | 'on-shield-applied'
    // SP-F F2: fires when a same-side ALLY (not the owner) has their shield pool FULLY DEPLETED
    // by a direct hit (rides the new `shield-destroyed` event, ally-scoped on victimId — mirrors
    // on-ally-debuffed's ally scoping). AEGIS's "grants Defense Up II and cleanses all debuffs
    // when an ally within the Active pattern has their Shield destroyed" — the sole corpus user.
    // Opposite direction of on-shield-applied (grant vs loss).
    | 'on-ally-shield-destroyed'
    // Ship-kit Wave 3, Task 4: fires when an OPPOSING-side actor gains the named "Taunt" buff
    // (rides the existing `buff-applied` event, opposing-scoped on actorId — the buff RECIPIENT
    // — AND filtered on buffName === 'Taunt'). Narrow, single-purpose trigger deliberately
    // separate from `on-enemy-buffed` (which fires for ANY buff, unfiltered) — Amartya's "When an
    // enemy defender gains Taunt, this Unit inflicts 2 stacks of Exposed on that defender" needs
    // the Taunt-specific gate, not a broad any-buff reaction. Routes onto the actual Taunt
    // recipient via eventCtx.counterTargetId — this is a debuff ability, whose executor reads
    // counterTargetId (NOT victimId, which only dot/convert-dot consume; see triggers.ts).
    | 'on-enemy-taunt-gained'
    // Ship-kit Wave 3, Task 6: fires when an OPPOSING-side actor takes a Damage over Time TICK
    // (rides the existing `dot-ticked` event — combat/events.ts — opposing-scoped on targetId,
    // ANY dotType). Anemone's "When an enemy takes damage from a Damage over Time effect,
    // repair 5% of this Unit's Max HP" — a SELF-target heal, so eventCtx.victimId (stamped by
    // the triggers.ts case) only documents the DoT-tick target; the self-heal recipient
    // resolves via reactiveRecipients' target==='self' branch and never reads victimId.
    | 'on-enemy-dot-damage'
    // Ship-kit Wave 3, Task 7: fires when THIS unit's own action actually removed Shield from an
    // OPPOSING actor (rides the NEW `shield-stripped` bus event — combat/events.ts — self-scoped
    // on casterId === ownerId, mirroring `on-own-cleanse`'s self-scoped shape). Laika's "This Unit
    // gains a Shield equal to 30% of its Max HP upon removing Shield from an enemy" — a SELF-target
    // shield, so no eventCtx capture is needed to route the recipient (reactiveRecipients' target
    // === 'self' branch always resolves to [ownerId] regardless); the case exists purely to GATE
    // the fire to casts that actually stripped shield (Laika's CHARGED skill only — the active
    // skill's cleanse+damage never reaches stripShieldPct).
    | 'on-own-shield-strip'
    // Ship-kit Wave 3, Task 9: fires when Corrosion SPREADS on the battlefield (the NEW
    // `corrosion-spread` bus event — combat/events.ts — emitted by the engine's end-of-round Toxic
    // Overflow mechanic, ledger #49). Hemlock's "When Corrosion spreads this Unit repairs 5% of its
    // max HP per enemy affected" rides this: a SELF-target heal whose amount count-scales by the
    // number of enemies the spread affected (eventCtx.spreadAffectedIds.length). Scoped in
    // triggers.ts to spreads whose SOURCE is opposing the owner (the affected units are the owner's
    // enemies — "per enemy affected"), which is also what makes it team-symmetric.
    | 'on-corrosion-spread'
    // PR F4: annotation-only marker for pre-fight stat grants ("At the start of combat, …").
    // Deliberately NOT in LIVE_TRIGGERS — there is no combat event for it; the battle sim's
    // pre-fight layer (F5) reads these abilities off the plan BEFORE actors exist, so the
    // engine's reactive listener machinery must never bind it.
    | 'pre-combat';

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
    // Phase 3 PR-E: ally-scoped counterpart of on-debuffed.
    'on-ally-debuffed',
    // Phase 3 PR-H: self-scoped reaction to THIS unit's own cleanse actually removing a debuff.
    'on-own-cleanse',
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
    // Phase 3 PR-I: opposing-scoped reaction to an enemy actor receiving a timed buff.
    'on-enemy-buffed',
    // Purge ecosystem C2b: Sefuba self-purge / Salvation ally-purged
    'on-enemy-purged',
    'on-ally-purged',
    // Spearhead: all-allies buff grant after the owner's charged skill.
    'on-charged-cast',
    // Phase 4: opposing-scoped mirror — reaction to an ENEMY's charged cast.
    'on-enemy-charged-cast',
    // Font of Power: buff grant to allies the owner repairs.
    'on-own-repair-to-ally',
    // D-PR16 Firewall: self-scoped reaction to receiving a timed debuff.
    'on-debuffed',
    // D-PR16 Lockdown: self-scoped reaction to RESISTING an incoming debuff.
    'on-debuff-resisted',
    // PR-B2: inflictor-scoped mirror — reaction to a debuff THIS unit inflicted being resisted.
    'on-own-debuff-resisted',
    // Warpstrike: owner dealt direct damage on its turn.
    'on-deal-damage',
    // Resonating Fury: granter-scoped reaction fired once per shield-application cast.
    'on-shield-applied',
    // SP-F F2: ally-scoped reaction to an ally's shield pool being fully depleted (AEGIS).
    'on-ally-shield-destroyed',
    // Ship-kit Wave 3, Task 4: opposing-scoped reaction to an enemy actor gaining Taunt (Amartya
    // Exposed).
    'on-enemy-taunt-gained',
    // Ship-kit Wave 3, Task 6: opposing-scoped reaction to an enemy actor taking a DoT tick
    // (Anemone heal).
    'on-enemy-dot-damage',
    // Ship-kit Wave 3, Task 7: self-scoped reaction to THIS unit stripping an enemy's shield
    // (Laika self-shield).
    'on-own-shield-strip',
    // Ship-kit Wave 3, Task 9: opposing-scoped reaction to Corrosion spreading (the end-of-round
    // Toxic Overflow mechanic, ledger #49) — Hemlock's count-scaled self-heal.
    'on-corrosion-spread',
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
    // SELF variant: 100 - selfHpPct. Used by the Revenge gear set ("Increase damage by
    // +25% * lost HP%") — perUnit 0.25, cap 25. At full HP evaluates to 0 → inert in
    // DPS mode.
    | 'self-hp-missing-pct'
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
    | 'every-n-turns'
    // COUNT subject (sub-project I, PR I5): the number of living OPPOSING actors
    // currently holding the Stealth self-buff. Distinct from 'enemy-buff' (which reads
    // `enemyBuffNames`, a DEDUPED UNION — it can tell "is at least one enemy Stealthed"
    // but never "how many"). Used as a SCALING source, e.g. Selenite's "10% more direct
    // damage for every enemy with Stealth" (perUnit 10, no cap). Live-derived by the
    // combat engine from ConditionContext.stealthedEnemyCount; defaults to 0 (DPS mode
    // has no enemy attackers to count) — inert/byte-identical there. Always derivable:true.
    | 'enemy-stealth-count'
    // SCALING-SOURCE subject (sub-project I, PR I4a): the ACTING unit's own live crit
    // power (effective critDamage stat, e.g. 150), as a continuous magnitude — not a
    // count of entities like the other scaling sources above. Used by Wildfire's
    // "…for every 10% crit power" dotDamage bonus (perUnit 0.1 → critDamage 150 scales
    // to +15). As a BARE gate (no scaling rule) it reads sensibly too: any crit power
    // > 0 satisfies the default count>0 presence rule. Live-derived by
    // ConditionContext.selfCritPower (runPlayerTurn's modifierCtx only); defaults to 0
    // elsewhere (no other ConditionContext builder populates it — inert/byte-identical
    // for every ship that doesn't reference this subject). Always derivable:true.
    | 'self-crit-power'
    // Model-completeness SP-C: owner-vs-target stat comparison gate. `Condition.compareStat`
    // picks the stat (crit power / speed / absolute current HP); `Condition.statComparator`
    // the direction ('gt' = owner's stat strictly greater than target's, 'lt' = strictly less).
    // Reads ctx.self{CritPower|Speed|CurrentHp} vs ctx.target{CritPower|Speed|CurrentHp}. DPS
    // defaults compare the acting ship's stats against the CONFIGURED enemy (unset stat → 0);
    // the positional engine uses real actor stats (Chakara's aggregate: targetSpeed = MIN speed
    // among damaged enemies). Always derivable:true.
    | 'stat-vs-target'
    // Model-completeness SP-D: COUNT subject — the number of enemies DAMAGED by THIS cast
    // (Berserker's "gains Marauder Rage II ... when hitting 3 or more enemies"; Tygr's "if it
    // damages 2 or more enemies, adds 1 charge"). DPS mode has no multi-target concept → defaults
    // to 1 (the single configured enemy), so a ≥2/≥3 gate is inert (not met) in single-target DPS
    // — the faithful behaviour (Tygr genuinely doesn't add charge against a single target). The
    // positional engine live-derives the real per-cast footprint size. Always derivable:true.
    | 'enemies-hit-this-cast'
    // Model-completeness SP-D: COUNT subject — per-target DoT ENTRY count (corrosion + inferno +
    // bomb entry-array lengths, +acidicDecay once SP-E adds it). Bare (no buffName) = the sum of
    // ALL DoT entries, regardless of family (Anemone's charged "If the primary enemy has 3 or
    // more Damage over Time effects" — generic). With `buffName` set = ONE named family only
    // (Belladonna's charged "If the enemy has 3 or more Acidic Decay" — runtime-inert until SP-E
    // actually introduces the Acidic Decay DoT family; ConditionContext.enemyDotFamilyCounts
    // defaults every family to 0 until then, so this gate never fires yet). DoT-ONLY — distinct
    // from `enemy-debuff`, whose legacy count also folds in landed CONTROL/marker debuffs; this
    // subject must never be satisfied by e.g. a landed Stasis. Also a SCALING source (Snakeroot's
    // "for every 4 stacks of damage over time" — reads the raw count, not just a gate). Always
    // derivable:true.
    | 'enemy-dot-count';

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
    /** For 'stat-vs-target': which stat to compare (owner vs target). */
    compareStat?: 'crit-power' | 'speed' | 'hp';
    /** For 'stat-vs-target': direction of the OWNER-vs-target comparison.
     *  'gt' = owner's stat strictly greater; 'lt' = owner's stat strictly less. */
    statComparator?: 'gt' | 'lt';
}

/** Gate for a victim-side incoming-effect ability (D-PR3). Evaluated against an
 *  IncomingHitContext at the victim apply site — NOT a ConditionSubject (those are
 *  attacker-turn standing facts; these are per-incoming-hit facts). */
export type IncomingCondition =
    | 'self-stealth' // Voidshade (reduction), Shadowguard (block); Wusheng (epic PR12)
    | 'self-stasis' // Nebula Nullifier (Disable folds in here when modeled)
    | 'incoming-crit' // Hardened set, Iridium
    | 'incoming-crit-by-stealthed' // Hyperion Gaze
    | 'nth-hit-2plus' // Ironclad (block)
    | 'dot-inferno-corrosion' // Vortex Veil
    // Epic PR12 (C): the ATTACKER carries a live Corrosion/Inferno DoT stack (Anemone —
    // "takes 25% less direct damage from enemies debuffed with a Damage over Time effect").
    // Distinct from `dot-inferno-corrosion` (a fact about THIS hit being a DoT tick); this is a
    // fact about the ATTACKER's own status, checked on an ordinary direct hit.
    | 'attacker-has-dot'
    // Epic PR12 (C): the VICTIM currently carries its own "Barrier Recharging" self-status
    // (Panon — "reduces all incoming damage by 20% when affected by Barrier Recharging").
    // A literal named-status check, mirroring the self-stealth/self-stasis precedent.
    | 'self-barrier-recharging'
    // Model-completeness epic (SP-A): the VICTIM currently holds an active shield pool
    // (Malvex — "When Shielded, this Ship takes 10% less damage"). Context-driven, not
    // side-gated — evaluated per-hit against the victim's live shieldPool.
    | 'self-shielded'
    // Epic PR12 (C): unconditional — used with `hpScaling` (Tormenter's HP-proportional
    // reduction, which carries no trigger/status gate, only continuous HP scaling).
    | 'always'
    // SP-E: Orel — the transform fires only when the ATTACKER of this hit currently carries
    // Taunt (self-buff) or Provoke (debuff placed on it by someone else). Distinct from
    // 'attacker-has-dot' (a DoT-status fact) — this checks control-status membership.
    | 'attacker-taunted-or-provoke'
    // Meatshield refit-active passive — the transform fires only when THIS hit is a chunk
    // redirected onto the unit through Protection (cause.isProtectionTransfer). Distinct from
    // every other arm (which are attacker/victim status facts) — this is a fact about how the
    // hit arrived. Evaluated ONLY by the engine's transform-incoming-to-dot block.
    | 'self-protection-redirect';

/** Per-incoming-hit context assembled by the engine at each victim apply site. */
export interface IncomingHitContext {
    didCrit: boolean;
    attackerStealthed: boolean;
    victimStealthed: boolean;
    victimStasised: boolean;
    /** 1-based direct-damage intake index for this victim this round (Ironclad). */
    hitIndexThisRound: number;
    /** Set only on the DoT-tick path (Vortex Veil). SP-E: widened to DoTType (was
     *  'inferno' | 'corrosion') so a generic-DoT tick can flow through the same reduction path;
     *  the 'dot-inferno-corrosion' condition still matches only inferno/corrosion (correctly
     *  false for 'generic'/'bomb'). */
    dotType?: DoTType;
    /** Epic PR12 (C): true when the ATTACKER of this hit carries a live Corrosion or Inferno
     *  stack (Anemone). Live-derived by the engine; defaults false everywhere no such ability
     *  is present → byte-identical. */
    attackerHasDot: boolean;
    /** Epic PR12 (C): true when the VICTIM currently carries its own "Barrier Recharging"
     *  self-status (Panon). Live-derived by the engine; defaults false. */
    victimHasBarrierRecharging: boolean;
    /** Victim currently holds an active shield pool (shieldPool > 0) — gates self-shielded. */
    victimHasShield: boolean;
    /** SP-E (Orel): the ATTACKER currently carries Taunt (self-buff) or Provoke (debuff).
     *  Live-derived by the engine off the real attacker id where one exists (the block-step ctx,
     *  the positional per-hit reduction ctx, the aggregate enemy-path ctx); defaults false at
     *  sites with no single real attacker (reflect ping-back, DoT-tick reduction) — inert unless
     *  an ability's config carries `condition:'attacker-taunted-or-provoke'`. */
    attackerTauntedOrProvoked: boolean;
    /** Epic PR12 (C): the VICTIM's own live HP% (0..100) at hit time, for HP-proportional
     *  incoming-reduction scaling (Tormenter's `hpScaling`). Live-derived by the engine;
     *  defaults 100 (full HP) where unused/inapplicable — inert unless an ability's config
     *  carries `hpScaling`. */
    selfHpPct: number;
    /** Meatshield: true when THIS hit is a chunk redirected onto the victim via Protection
     *  (engine sets it from `cause.isProtectionTransfer` at the transform block). OPTIONAL —
     *  every other construction site omits it (→ undefined → treated as false in conditionMet),
     *  keeping those sites byte-identical. */
    viaProtectionRedirect?: boolean;
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

/** Source of a reactive event-count scaling multiplier (ship-kit W3). Distinct from the
 *  live-state Condition counts an additive `conditionIndex` scaling reads: the count comes
 *  from the triggering reactive event's eventCtx, not from a drain-time ConditionContext.
 *  - 'repaired-enemy-count' → eventCtx.repairedEnemyIds.length (Sansi's "5% for every enemy
 *    repaired").
 *  - 'spread-affected-count' → eventCtx.spreadAffectedIds.length (Hemlock's "5% per enemy
 *    affected" — the number of adjacent allies a Corrosion spread landed Corrosion I on, ship-kit
 *    W3 Task 9). Reuses the exact same primitive as 'repaired-enemy-count'. */
export type ReactiveScalingCountSource = 'repaired-enemy-count' | 'spread-affected-count';

export interface ScalingRule {
    /** Index into Ability.conditions of the live-state count Condition (additive PR6b / damage
     *  scaling: base + perUnit×count). OMITTED for reactive event-count scaling (`countSource`),
     *  where the count comes from the triggering event rather than a Condition. */
    conditionIndex?: number;
    perUnit: number;
    cap?: number;
    /** ship-kit W3: reactive event-count MULTIPLICATIVE scaling. When set, the reactive
     *  heal/shield executor computes the effective % as `perUnit × count`, where `count` is
     *  drawn from the triggering event (see ReactiveScalingCountSource) — NOT the additive
     *  base + perUnit×count form the conditionIndex path uses. `conditionIndex` is unused when
     *  this is present (there is no live-state Condition to reference). */
    countSource?: ReactiveScalingCountSource;
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
    | 'dotDamage'
    | 'detonationDamage'
    | 'bombSplashDamage'
    | 'outgoingHeal'
    | 'incomingDamage';

export type AbilityConfig =
    | {
          type: 'damage';
          multiplier: number;
          hits?: number;
          noCrit?: boolean;
          /** Vindicator on-resist: when set, the REACTIVE damage executor computes the
           *  pre-mitigation raw from the owner's effective max HP × hpBasisPct (percent) instead
           *  of attack × multiplier. Reactive-damage path only (applyReactiveDamage); the on-cast
           *  damage path ignores it. */
          hpBasisPct?: number;
          /** SP-F F4 (Wusheng): the charged skill "deals 220% damage WITH affinity advantage".
           *  When set, this cast (and its paired 'apply' debuff landing) is forced to affinity
           *  ADVANTAGE regardless of the real attacker/target matchup — damageMod +25, critCap
           *  100, critPenalty 0, no debuff-landing disadvantage. Read at the three affinity seams
           *  in playerTurn.ts. Absent → the real computed matchup (byte-identical default). */
          forceAffinityAdvantage?: boolean;
          /** Ship-kit W5 (Demolisher bomb-splash): this damage bypasses the target's Defense
           *  mitigation term. Consumed by the REACTIVE damage executor (applyReactiveDamage,
           *  Task C3); the on-cast damage path ignores it. Absent → normal mitigation. */
          ignoresDefense?: boolean;
          /** Ship-kit W6 (Lodolite/Rhodium/Selenite): this attack can target Stealthed enemies.
           *  Single source for the bypass; battleSimulator derives ParsedTarget.ignoresStealth
           *  (active vs charged slot) from this and the positional resolver skips the stealth
           *  filter. Absent → normal stealth filtering. */
          ignoresStealth?: boolean;
      }
    | {
          type: 'counter';
          /** raw percentage of the OWNER's effective attack, e.g. 30/70/100/200. */
          multiplier: number;
          hits?: number;
          /** Stalwart: fire only when this unit was the directly-targeted (primary) victim,
           *  not a splash/covered AoE victim. Gated on `attacked.isPrimaryTarget`. */
          requirePrimaryTarget?: boolean;
          /** Nyxen (PR2): fire only when the hit reduced the shield pool. Plumbed in PR2. */
          requireShieldHit?: boolean;
      }
    | { type: 'additional-damage'; stat: 'hp' | 'defense' | 'shield'; pct: number }
    | {
          /** PR9: a STANDALONE "removes X% of the enemy Shield" clause carried on its own
           *  merit, NOT gated on a purge landing (APEX/Laika/Malvex — "the other 3 corpus rows
           *  carry no purge language at all", per detectPurgeStripsShield's comment). Distinct
           *  from the 'purge'-type stripsShield flag (Lodolite's I6 clause, "when this Unit
           *  Purges a buff from an enemy, it removes 100% of the enemy's shield") — that stays
           *  gated on the purge landing; this fires unconditionally on-cast. Shares the same
           *  percentage-of-CURRENT-pool strip semantics (stripShieldPct helper in playerTurn.ts).
           *  Team-symmetric: applies identically to a player or enemy caster's target. */
          type: 'shield-strip';
          pct: number;
      }
    | { type: 'modifier'; channel: ModifierChannel; value: number; isMultiplicative: boolean }
    | {
          type: 'buff';
          buffName: string;
          parsedEffects: ParsedBuffEffects;
          stacks: number;
          isStackable: boolean;
          maxStacks?: number;
          stackTrigger?: StackTrigger;
          /** Lionheart: a redirected hit clears the WHOLE Protection pool (distinct from a normal
           *  per-hit consume). Absent → no clear-on-redirect behavior. */
          clearAllOnRedirect?: boolean;
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
              clearAllOnRedirect?: boolean;
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
          clearAllOnRedirect?: boolean;
          application: 'inflict' | 'apply';
          duration?: number | 'recurring';
      }
    | { type: 'dot'; dotType: DoTType; tier: number; stacks: number; duration: number }
    // SP-F F3 (Lingshe charged skill): shrinks every living enemy's PendingBomb.countdown by
    // `turns`; any bomb reaching <= 0 detonates immediately, crediting the bomb's ORIGINAL
    // applier (bomb.sourceId), not this ability's caster. Always hacking-gated at the runtime
    // call site (`landsTimedEnemyApplicationLive('inflict')`) — no `application` field needed
    // here since there is only one landing behavior for this ability (unlike 'debuff', which
    // supports both 'inflict' and 'apply').
    | { type: 'bomb-countdown-reduce'; turns: number }
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
    // Wave 4: generic extend-status (Sokol/Ripper/Lev) — extends every eligible timed
    // buff ('buff') or debuff ('debuff') on the StatusEngine selfMaps/enemyMaps store by
    // `turns`. See src/utils/combat/statusEngine.ts extendAllBuffsDuration/
    // extendAllDebuffsDuration.
    | { type: 'extend-status'; statusKind: 'buff' | 'debuff'; turns: number }
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
           *  slot, procs only while the actor is the heal target) / 'overheal'
           *  (X% of an over-repair's CLIPPED EXCESS — heal raw minus the HP actually
           *  consumed — on the over-repaired ally; reactive shield on
           *  on-own-repair-to-ally; Abundant Renewal). */
          basis:
              | 'hp'
              | 'attack'
              | 'defense'
              | 'target-hp'
              | 'damage-dealt'
              | 'damage-taken'
              | 'overheal';
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
          /** Epic PR5 finding 3: a TYPED cleanse restricts removal to one debuff category
           *  rather than any debuff. Nyxen: "Cleanses 2 bombs" (bomb) / "Cleanses 2 damage
           *  over time debuffs" (dot). Absent → untyped (removes any debuffs, unchanged).
           *  cleanse-only; purge never sets this. */
          debuffType?: 'bomb' | 'dot';
          /** I6: when this unit lands a purge (this ability), it also removes 100% of the
           *  purged victim's shield (Lodolite legendary refit: "When this Unit Purges a buff
           *  from an enemy, it removes 100% of the enemy's shield"). Set on EVERY 'purge'-type
           *  config buildShipAbilities emits for a ship whose skill text carries that clause
           *  (parseable via detectPurgeStripsShield) — gated on the parsed ability, never a
           *  hardcoded ship name. purge-only; cleanse never sets this. Consumed at the
           *  purge-performed apply site in playerTurn.ts, same victim id, right after the purge
           *  resolves. Absent → byte-identical (no ship besides Lodolite carries it today). */
          stripsShield?: boolean;
      }
    // PR10: buff steal — moves `count` of the target's newest stealable buffs to the caster,
    // remaining duration intact (statusEngine.steal, keyed off the ability's `target` like purge:
    // 'enemy' in every corpus case — "the primary target"). Does NOT check the Buff Protection
    // holder-guard (purge-only per buffProtectionBuffs.ts); DOES skip UNREMOVABLE_STATUSES/
    // 'permanent' entries, same as purge.
    | {
          type: 'buff-steal';
          count: number;
          /** Tithonus: also grant the stolen buff(s) to every living adjacent ally of the caster
           *  (same application, same remaining duration — NOT a fan-out split). Absent → caster
           *  only (Pallas/Thresh). */
          grantAdjacentAllies?: boolean;
      }
    | {
          type: 'control';
          effect: ControlEffect;
      }
    // Overload lifecycle: "loses/removes Overload on kill". Removes a named self-buff family from
    // ALL of the owner's self stores. target:'self'; trigger carries the reactive moment.
    | { type: 'remove-self-buff'; buffName: string; scope: 'all' }
    // D-PR3 victim-side incoming-damage reduction (folded at the crit-aware computation sites).
    | {
          type: 'incoming-reduction';
          scope: 'direct' | 'dot';
          condition: IncomingCondition;
          /** Positive magnitude (percentage points); folded as a reduction into the incoming channel.
           *  IGNORED when `hpScaling` is set (Tormenter) — the effective reduction is computed
           *  from `hpScaling` instead. */
          pct: number;
          /** Grouping ONLY: true → take-max crit-reduction family; false → additive.
           *  Orthogonal to the gate — the crit gate is enforced by condition='incoming-crit*'. */
          critFamily: boolean;
          /** Epic PR12 (C): HP-proportional reduction (Tormenter — "gains up to 30% damage
           *  reduction as its health decreases"). When set, the effective pct is
           *  `min(cap, perUnit * (100 - victim's live HP%))` — mirrors the Revenge gear set's
           *  self-hp-missing-pct formula (perUnit = cap/100 reaches the cap exactly at 0 HP).
           *  Requires `condition: 'always'`. Absent → flat `pct` (unchanged for every ability
           *  without it). */
          hpScaling?: { perUnit: number; cap: number };
      }
    // SP-E: Voron/Orel "transforms the [incoming direct] damage into a DoT lasting N turns".
    // Reactive self-ability (trigger:'on-attacked', target:'self'). At the apply site the direct
    // hit is REPLACED by a generic self-DoT of perTickAmount = D/turns. `condition` gates the
    // transform per-hit (Voron:'always', Orel:'attacker-taunted-or-provoke').
    | { type: 'transform-incoming-to-dot'; turns: number; condition: IncomingCondition }
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
    | {
          /** Lifeline: a PRE-hit threshold shield. When a pure direct hit would cross the
           *  carrier's HP below `hpThresholdPct`% of max HP, grant `flatAmount` + `attackPct`%
           *  of the carrier's own effective attack to the shield pool (capped at max HP) BEFORE
           *  the hit's absorb step — so the rest of the same hit drains shield→HP per the H1 pen
           *  rules (the unit can still die). Victim-side / self-scoped; consumed in
           *  applyVictimDamage, NOT via the reactive executor. Once per battle. */
          type: 'incoming-shield-grant';
          hpThresholdPct: number;
          flatAmount: number;
          attackPct: number;
          oncePerCombat: boolean;
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
      }
    // Reflect gear set (thorns): reflect `pct`% of each direct hit back to the attacker.
    // Victim-side passive — collected into incomingAbilitiesById. Apply seam wired in Task 5.
    | {
          type: 'damage-reflection';
          /** Percentage of incoming direct damage reflected back to the attacker (e.g. 10). */
          pct: number;
          /** Epic PR12 (A) — Nosorog: "reflects 40% of the Damage taken back to the enemy when
           *  directly damaged AS A PRIMARY TARGET." Mirrors counter's `requirePrimaryTarget`
           *  (Stalwart): fires only when this hit's victim was the attacker's anchor/primary
           *  target, not a splash/covered footprint victim. Absent → unconditional (Reflect
           *  gear set, byte-identical). */
          requirePrimaryTarget?: boolean;
      }
    // Boost gear set: caster-side +1-turn extension on every buff the wearer applies.
    // No-op marker config (mirrors damage-reflection) — read by the engine when building
    // the per-owner extension map, NEVER executed by the ability fold.
    | {
          type: 'buff-duration-extension';
          /** Extra turns added to buffs this wearer applies (Boost = 1). */
          turns: number;
      }
    // PR F4: pre-fight base-stat grant (trigger 'pre-combat', target 'self'/'adjacent-allies').
    // Consumed ONCE by the battle sim's pre-fight layer (F5), which mutates plan stats from a
    // frozen post-leader snapshot; adjacency gates live HERE (evaluated against board geometry
    // at apply time), so `conditions` stays empty.
    | {
          type: 'pre-combat-stat';
          stat: 'hp' | 'attack' | 'crit' | 'hacking';
          value: number;
          /** 'flat': absolute points. 'percent-of-own': % of the RECIPIENT's pre-fight stat.
           *  'percent-of-donor': % of the GRANTING ship's pre-fight stat (Lionheart). */
          valueKind: 'flat' | 'percent-of-own' | 'percent-of-donor';
          /** Multiply value by count of adjacent living allies (Centurion). */
          perAdjacentAlly?: boolean;
          /** Gate: at least one adjacent ally of this role category (Enforcer/Defiant/Stalwart). */
          requiresAdjacentRole?: ShipRoleCategory;
      }
    // SP-E, Task E4 (Belladonna): "When an ally inflicts `fromDotType`, chance to convert it into
    // a named DoT family `buffName` of the same level" — retags the ally's just-applied entries
    // (family + unremovable), preserving tier/stacks/remainingRounds. Rides
    // trigger:'on-ally-debuff-inflicted', target:'enemy' (widened gate — see buildShipAbilities'
    // mergeBuff). `chanceFromStat` is the conversion-chance stat scaling (1% per 10 Hacking →
    // pctPerPoint 0.1). `extendTurns`/`extendChanceFromCritPower` fold Belladonna's paired
    // "extends the newly applied <family> for N turns, chance = crit power" clause (otherwise
    // parsed standalone by parseCritPowerExtend into an `extend-dot` ability — suppressed for
    // this row to avoid a double-extend) directly into the SAME conversion executor.
    | {
          type: 'convert-dot';
          fromDotType: DoTType;
          buffName: string;
          chanceFromStat: { stat: 'hacking'; pctPerPoint: number };
          extendTurns?: number;
          extendChanceFromCritPower?: boolean;
      }
    // SP-F F5 (Meatshield defense-substitution, approximation — see AbilityType's
    // 'defense-substitution' doc comment for the full rule + how it composes with the now-
    // implemented Protection transfer). No fields: a bare presence marker, mirroring
    // 'damage-reflection'/
    // 'buff-duration-extension'. The engine collects every carrier of this config into a
    // dedicated per-owner set and substitutes the carrier's effective defence for a living
    // non-defender ally's own defence at every defence-read site.
    | { type: 'defense-substitution' }
    // Wave 4 Task 8 (FrontLine passive): "While Shielded, it gains 2500 additional Defense" — a
    // flat-points DEFENSIVE stat bonus, gated on the owner CURRENTLY holding a shield
    // (CombatActor.shieldPool > 0). Distinct from every existing stat-bonus path: `modifier` is
    // percentage-only and folds ONLY into the attacker-side/DAMAGE-mode read
    // (effectiveDamageStatsOf via modifierTotalsFromAbilities), never the defensive read;
    // `pre-combat-stat` is a permanent one-shot with no `defence` option (abilities.ts:887) and
    // cannot toggle. This is a bare condition+flat marker (mirrors 'defense-substitution' /
    // 'damage-reflection' / 'buff-duration-extension') — never executed through the ability-fold/
    // executor pipeline. The engine collects every carrier into a per-owner map
    // (conditionalDefenceBonusByActorId) and folds `flat` into `substitutedDefenceFor`
    // (engine.ts), gated live on `hasShield(ownerId)` at EVERY call — so the bonus is
    // re-evaluated fresh per hit and reverts the instant the shield is consumed/expires, no
    // separate turn-tick logic needed. `stat`/`condition` are single-member literal unions today
    // (only a defence flat-bonus gated on self-shield exists in the corpus); widen them if a
    // second shape is ever needed.
    | { type: 'conditional-stat'; stat: 'defence'; flat: number; condition: 'self-shield' };

/** Crowd-control effects a `control` ability can apply. The combat effect of each
 *  (Stasis/Disable turn-lockout, Provoke/Taunt/Concentrate-Fire forced-targeting) is
 *  simulated via the parallel named-status path; all control effects are now simulated.
 *  The `control-applied` event (events.ts) additionally exposes the application moment so
 *  reactions (e.g. Defiant's shield-on-Stasis) can fire. */
export type ControlEffect = 'provoke' | 'taunt' | 'stasis' | 'concentrate-fire' | 'disable';

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
    /** ship-kit W3: this reactive applies at most N times per round (keyed on (owner, ability)),
     *  a numeric GENERALIZATION of the boolean `oncePerRound` above. Sansi's on-enemy-repaired
     *  heal ("limited to 3 times per Round") sets `maxPerRound: 3`: at most three qualifying
     *  repair EVENTS trigger the heal each round (a multi-recipient AoE repair is one event).
     *  Enforced executor-side via IntentExecContext.perRoundFireCounts (incremented on each
     *  successful fire, blocked once the count reaches the cap). Absent → no per-round limit. */
    maxPerRound?: number;
    /** Phase 3 PR-E: this reactive applies at most once per round PER ALLY (keyed on
     *  (owner, ability, eventCtx.damagedAllyId)), rather than once per round overall.
     *  Oleander's "once per ally per round" RoT grant: a different ally inflicting a
     *  debuff still procs even if another ally already consumed the cap this round.
     *  Gated executor-side via IntentExecContext.oncePerRoundConsumed, keyed with the
     *  ally id (distinct from the plain `oncePerRound` flag above). Absent → no cap. */
    oncePerRoundPerAlly?: boolean;
    /** Phase 3 PR-F: this reactive applies at most once per round PER ENEMY (keyed on
     *  (owner, ability, eventCtx.repairerId)), rather than once per round overall. Ruiner's
     *  "once per round per enemy" Bomb-on-repair: a DIFFERENT enemy repairing still procs
     *  even if one enemy already consumed the cap this round. Gated executor-side via
     *  IntentExecContext.oncePerRoundConsumed (mirrors oncePerRoundPerAlly above, keyed with
     *  the repairer id instead of an ally id). Absent → no cap. */
    oncePerRoundPerEnemy?: boolean;
    /** Phase 3 PR-F: an on-enemy-repaired debuff lands on the REPAIRED RECIPIENT(S)
     *  (eventCtx.repairedEnemyIds — "that defender", Amartya's Defense Shred) instead of the
     *  default single counterTargetId/ctx.enemy.id route every other debuff applier uses
     *  (including Ruiner's REPAIRER-targeted Bomb sharing the same trigger + event). A
     *  multi-recipient heal fans the debuff out to EVERY repaired recipient. Absent → the
     *  normal single-target route. */
    repairedRecipientTargeted?: boolean;
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
    /** Reactive event-frequency gate: fire this ability only every Nth qualifying trigger
     *  event, counted per SOURCE (the triggering actor). N=2 → every second event. Gated
     *  executor-side via IntentExecContext.repairCountBySource, keyed
     *  `${ownerId}:${abilityId}:${repairerId}`. Currently only the charge branch on
     *  `on-enemy-repaired` honors it (Zosimos "every second repair"). Absent → fires every event. */
    everyNthEvent?: number;
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
    /** True when the ship's skill text declares its attacks ignore Taunt and Provoke
     *  (Judge, Stalwart, Yuyan, Huanying, Valkyrie, Vanguard). Threaded onto
     *  CombatActor.ignoresForcedTargeting by the engine adapter and consumed by
     *  positionalBinding.ts to skip Taunt/Provoke forced-targeting redirects (Concentrate
     *  Fire is unaffected). */
    ignoresForcedTargeting?: boolean;
    /** True when the ship's passive text declares it ignores Stealth effects (Lodolite).
     *  Threaded onto CombatActor.ignoresStealth by the engine adapter and consumed by
     *  positionalBinding.ts to skip the stealth targeting filter on ALL of this ship's casts
     *  (the per-cast `config.ignoresStealth` handles single-skill bypasses like Rhodium/Selenite). */
    ignoresStealth?: boolean;
}
