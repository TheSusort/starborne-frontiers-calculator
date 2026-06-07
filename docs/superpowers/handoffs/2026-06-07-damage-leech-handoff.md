# Handoff: Combat Engine — Damage-Leech Heals (and beyond)

> Paste a prompt section into a fresh session. Context baseline: **PR #87 MERGED**
> (merge `a3c30447`, 2026-06-07) — the Healing Calculator runs on the combat engine.
> Memory `project_combat_engine_roadmap.md` has the running state. Coverage:
> **~77% of genuine healing text cells parse + simulate** (112/146; the rest are
> classified gaps below). 22 DPS + 8 healing golden snapshots; ~1500 tests / 98 files.

## End-state goal (user-stated 2026-06-05 — unchanged)

Close-to-full combat simulator: swappable focus actor, per-actor damage/healing/defense.
DPS ✅ → healing ✅ (this milestone) → defense (needs Phase 4 enemy offense) → simulator
page. Engine honors it: `focusActorId`, per-actor `ActorDamage`/`ActorHealing` maps, one
`runPlayerTurn` pipeline, healing mode gated on `healTargetId` (provably inert for DPS).

## What shipped in PR #87 (orient before any prompt)

- **Engine healing mode** (`src/utils/combat/`): heal/shield/cleanse consumption vs a
  live heal target (`effective = min(raw, maxHp − currentHp)`, overheal tracked, clamped
  vs max-HP shrink); SEPARATE per-actor heal crit gates (damage schedules untouched —
  the golden-protection decision); shield = additive absorption pool capped at target
  max HP (user-verified), drains before HP, no expiry; HoT (`hotPct` from "Repair Over
  Time" buffs) ticks applier-HP-at-tick-time (corrosion rule; self-HoT ticks on cast
  turn — documented approximation, in-game verify list); enemy attackers (manual flat
  or ship-backed **basics walk**: damage abilities only, team-mirror charge cadence,
  per-hit crits, id-collision validation); dead-is-dead (`destroyedRound`, dead target
  skips turns + synthesized focus turn protects the focusTurns invariant).
- **Events**: `heal-performed` {casterId,targets,amount,critHits?}. (CORRECTION: there is
  NO `damage-taken` event — that was never shipped. Enemy attacker turns produce one
  aggregate damage number per turn via `runEnemyAttackerTurn`, with per-hit crit draws
  folded into a blended multiplier; nothing emits a per-hit `damage-taken` event.)
- **TWO new live triggers** (now 8 total — NOT 11): `on-ally-critically-repaired` (OWN
  crit repair of an ally — Pallas cleanse) and `on-ally-crit` (per ally critting hit —
  Pallas charge), plus executor heal/shield/cleanse follow-ups (drain-time fold:
  basis × pct × (1+healModifier) for heals, basis × pct for shields, NO crit draw,
  NO heal-performed re-emission — chain guard). (CORRECTION: there are NO
  `on-ally-damaged` / `on-self-damaged` triggers and NO `onCritHit?` field on heal/shield
  configs — none of those shipped. Cultivator/Isha-style "when an ally is directly
  damaged" repairs are on-cast per-turn passive heals; the PR #87 fix
  (`b36866b7`) corrected their parsed RECIPIENT — ally vs self — not a trigger.)
- **Parser target-routing rules (all user-verified 2026-06-07)**: bare repairs/cleanses
  on PURE SUPPORT actives/charged (no damage component) → **ally** (one-target-per-skill;
  Hermes/Mender/Salvation/Makoli + 13 more); damage-skill repair riders stay self;
  passives stay self; "**grants** a/the shield" (receiver-less, pure support) → ally
  (Aegis/Nyxen) while "**gains** a Shield" stays self; self-damage-conditional repairs
  stay self (Meatshield carve-out); cleanse-trigger repairs → ally when the ship class
  is SUPPORTER (Cultivator), self for DEFENDER (Morao); leech guard widened ("of
  the damage it deals" — Magnolia misparse fixed). (CORRECTION: the "when an ally is
  directly damaged" / "when directly damaged" repairs did NOT become triggers — they
  remain on-cast per-turn passive heals routed to the correct recipient; see the trigger
  correction above.)

> **Damage-leech increment note (post-PR #87):** the damage-leech feature on
> `feat/damage-leech` shipped leech heals/shields via the engine's damage CREDIT-POINT
> hooks — a `creditDamage(sourceId, channel, amount)` wrapper for standing leeches plus a
> per-attack proc in the enemy-attack block for damage-taken shields — NOT via the
> (nonexistent) `damage-taken` event or `on-ally-damaged`/`on-self-damaged` trigger seams
> this handoff originally implied. New heal/shield bases `'damage-dealt'`/`'damage-taken'`
> (with an optional `leechScope`) carry it; no new events or triggers were added.
- **Adapter** `simulateHealing` (`healingEngineAdapter.ts`); shared
  `deriveTeamEngineActors` extracted from dpsSimulator (byte-identical goldens).
- **UI**: HealingCalculatorPage rebuilt (DPS-page image): healer config cards (compare),
  HealTargetPanel ("use healer as target" or ship/manual), EnemyAttackersPanel (≤4,
  ship autofill w/ basics-walk note or manual), TeamPanel reuse (`showSharedBuffs` gate),
  Skill Editor with heal/shield/cleanse fields + new trigger options + onCritHit
  tri-state, **TurnOrderStrip** (shared with the DPS card, `orderByTurnPriority`),
  HealingTimelineChart (HP%/shield/incoming/effective + dashed "Destroyed" ReferenceLine)
  + cumulative comparison chart (ringed death dot).
- **Live-verified on the fleet**: Hermes→Isha routing, Cultivator per-hit ally heal
  (60 hits × 90 = 5,400 exact), Aegis shield absorption, Flamel HoT ticks, Makoli/
  Meiying scenarios, death marks, turn-order strip, effective+overheal=raw invariant.

## Increment menu (recommended order)

| # | Increment | Size | Notes |
|---|---|---|---|
| 1 | **Damage-leech heals/shields** | Small-medium, own mini-spec | THE user-chosen next step. 14 text cells / ~11 ships: Magnolia ("repairs itself for 20% of the damage it deals"), Valerian (15% of damage dealt incl. DoTs), Opal, Iridium, Tithonus ("repairs all allies 7% of the damage dealt", noCrit), Pallas (lowest-HP ally heals 20% of damage dealt), Valkyrie (burst-heal on Echoing Burst explosion — `bomb-detonated`/accumulator events carry damage), Quixilver/FrontLine ("gains Shield equal to X% of the damage taken/dealt"), Malvex, Laika. MECHANISM EXISTS: `ability-performed.damage` (own direct damage), `damage-taken.amount` (hits on the target), detonation events. Design: new heal/shield basis `'damage-dealt'`/`'damage-taken'` OR reactive abilities with a pct-of-event-amount payload (leaning reactive: listener reads the event amount → intent carries it → executor heals pct × amount; needs an amount-carrying Intent extension — today intents are static abilities). Parser: lift the disqualify guards into real parses. Watch: leech heals are per-ATTACK (ride the caster's own turn), leech-shields-from-taken are per-hit. |
| 2 | **Healing backlog batch** | Small | (a) `buildSkillBuffAutoFill` scans ALL passive rows → duplicate buff abilities for tier-inclusive texts (PRE-EXISTING, DPS-wide — use `getShipSkillRows`; golden-churn risk, check fixtures); (b) Pallas "Everliving Regeneration 3" grant unparsed (no application verb — "gains X and Y *for 2 turns*" shape); (c) Graphite/Refine reactive BUFF grants ("when an ally ... damaged, grants Repair Over Time III") — route buffs through on-ally-damaged (buff executor branch exists); (d) team-actor healModifier (CombatStatBlock lacks the stat — widen TeamActorInput.stats or thread separately); (e) status-conditional shield procs: APEX ("when an enemy gets debuffed" → on-debuff-inflicted EXISTS), Defiant (on applying Stasis — needs a status-applied trigger), Laika (Phase 4). |
| 3 | **Phase 4: enemy offensive actions** | Large, own spec cycle | Enemy kits beyond damage (debuffs on players, enemy self-buffs, enemy DoTs/heals), on-attacked/on-destroyed, taunt/stealth targeting, multi-enemy player offense, whole-team intake, revive/Cheat Death (5 cells: Hayyan/Yazid/Tycho), enemy-action reactions (13 cells: Zosimos/Arum/Yarrow/Larkspur/Grif), purge consumption (Sefuba), real `selfHpPct` (retro-activates Makoli/Guardian below-40% gates — parsed but DROPPED today, documented), defense-calc adoption. |
| 4 | **Simulator page** | Phase-sized | Per-round damage/healing/defense per ship; per-actor maps are the data source. |

## In-game verification list (user can check; coverage doc §6 has the full list)

Shields don't crit + ignore heal channels (assumption); shield pool no-expiry; self-HoT
cast-turn tick; Warding Screen persistent stacking (still unverified).

## Hard constraints (unchanged)

- DPS public API untouched; healing types additive. Goldens (22 DPS + 8 healing) =
  referee — zero churn, delete+rerun only, NEVER `vitest -u`.
- Zero-RNG determinism (makeRateGate per actor/stream; heal gates separate from damage
  gates); listeners pure (enqueue/static-config reads only); executor sole mutator.
- No `'attacker'` literals in engine core; no RegExp lookbehind (iOS 15); ESLint zero
  warnings; pre-commit full suite, no `--no-verify` for code.
- docs/ gitignored — `git add -f`. Changelog: ONE evolving healing entry — fold, never
  append (implementer subagents keep appending; watch them).

## Workflow gotchas (this session's lessons)

- Dev server :3002 = the fleet origin. If a subagent kills it: `npx vite --port 3002
  --strictPort`. NEVER let implementer agents manage the dev server.
- ship-skills.csv columns: `name, active_skill_text, charge_skill_charge,
  charge_skill_text, first_passive, second_passive, third_passive` — passives are
  tier-ordered R0/R2/R4 (the refit-active row applies; getShipSkillRows). Miscounting
  charge_skill_text shifts every tier (it bit twice this session).
- `src/constants/ships.ts` texts are UNTAGGED (no unit-skill markup) — buff-pipeline
  scratches against it silently parse nothing; use docs/ship-skills.csv or the fleet.
- ShipSelector: "Select a Ship" button opens the modal; the SELECTED-ship banner
  reopens it via ShipDisplay onClick (click the LEAF node, full pointer sequence).
  CollapsibleForm keeps collapsed children in DOM — scope queries or you'll click the
  wrong panel's selector.
- Live-verify with weak fleet ships in mind: a 1-star Makoli has ~966 HP — "destroyed
  round 1" at modest enemy attack is correct, not a bug.
- CodeRabbit: triage → fix or skip-with-reason → reply in-thread → confirmations carry
  `review_comment_addressed` markers → merge when the check passes (merge commit,
  branch kept).
