# Combat Engine Phase 4c — Enemy-Action Reactions + Generic Damage Triggers

**Date:** 2026-06-10
**Status:** Approved (user-validated design)
**Baseline:** `main` at `bf13abe0` (PR #94, aura-classification fix merged). Phases 0–4b all shipped.
**Canonical context:** `docs/skill-model-coverage.md` §5 (rules) / §6 (backlog items 10–12).

## 1. Goal

Make the remaining reactive-trigger family live: "when directly damaged" (self + ally),
HP-threshold crossings, and enemy-action (repair/cleanse) reactions — plus the three §6
realism orphans (item 11 derivable flip, item 12 enemy hacking roll, item 10 Chakara
lowest-speed parsing). After 4c the only annotation-only reactive cells left are the
4d (targeting/multi-enemy) and 4e (consumption) families.

**Ships unlocked:** Warden, Isha, Makoli, Guardian, Heliodor (partial), Cultivator,
Graphite, Refine, Tycho, Hermes (gate fix), Zosimos, Arum, Yarrow, Larkspur, Grif,
Chakara — plus every ship with an `enemy-buff`/Provoke `self-debuff` gate (item 11)
and security-stacked-tank realism vs debuff-heavy enemies (item 12).

## 2. Locked decisions (user-approved, do not re-litigate)

1. **Scope:** full bucket (A–F below) in one spec, sliced into six independently
   shippable PRs.
2. **Enemy repair/cleanse reactions fire from live events only** (ship-backed enemy
   attackers in healing mode). No manual DPS-mode cadence knob — the future DPS-enemy
   skill walk will trigger them on that side eventually.
3. **"When directly damaged" reactives fire per HIT** of a multi-hit enemy attack,
   not per attack turn. The `attacked` event itself moves to per-hit emission.
4. **Architecture:** new trigger values + existing condition machinery (Approach 1).
   No condition-encoded scoping, no event-filter DSL.

## 3. Event & trigger architecture

### 3.1 Per-hit `attacked`

The enemy-intake block (engine.ts ~2464) currently emits ONE aggregate `attacked`
event per enemy attack turn with an any-hit `didCrit`. It changes to **one event per
hit** of the enemy's damage ability, each carrying its own per-hit `didCrit` (the
per-hit crit draws already exist inside `runPlayerTurn`; the hit-level outcomes are
threaded out to the intake block).

- **Damage application stays aggregate**: the shield-first drain runs once per attack
  (no restructuring of the drain arithmetic, no float churn). The `attacked` event
  carries no damage field and every 4c reaction is a flat %-of-max-HP or status grant,
  so per-hit damage amounts are not needed.
- `additional-damage` riders fold into their parent hit (no separate event).
- **NOT "directly damaged"**: DoT ticks, bomb detonations, detonations. No `attacked`
  event for these.
- Existing `on-attacked` consumers now fire per hit. Healing goldens with multi-hit
  enemy attacks churn — **audited diff review** (explicit exception to the
  never-`vitest -u` rule).
- Emission stays after the drain (target HP/shield state already updated when
  listeners fire) and only for live targets — both unchanged.

### 3.2 New events

- `cleanse-performed { casterId, count, round }` — new.
- Enemy repairs reuse the existing `heal-performed`.
- **Event-only enemy emission:** when an enemy actor's cast skill carries heal/cleanse
  abilities, emit `heal-performed`/`cleanse-performed` with the enemy `casterId` but
  simulate NO numeric effect (nothing tracks enemy-attacker HP as a damageable pool).
  Fired on every qualifying cast — **cast-fires-regardless approximation** (no check
  that a debuff actually existed to cleanse). Documented in §5 + the in-game
  verification list.
- **Player-side `hp-changed`:** today emitted only for the enemy dummy post-round at
  integer granularity. Add emission for the **heal target** at damage-intake time
  (after the shield-first drain), so downward crossings are visible mid-round.
  **Granularity asymmetry (intended):** `attacked` is per-hit; `hp-changed` at intake
  fires ONCE per attack, after the aggregate drain — do not emit it per hit.

### 3.3 New triggers (AbilityTrigger + LIVE_TRIGGERS + listener cases)

| Trigger | Event guard | Notes |
|---|---|---|
| `on-ally-attacked` | `attacked` where `targetId !== ownerId && !isEnemySide(targetId)` | per hit; mirrors the established ally-scoping pattern |
| `on-hp-threshold-crossed` | `hp-changed` where `targetId === ownerId` and downward crossing `oldPct >= N > newPct` (N from the ability's `hp-threshold` condition) | `oncePerCombat` support extended from heal-only to buff follow-ups (Tycho) |
| `on-enemy-repaired` | `heal-performed` where `isEnemySide(casterId)` | |
| `on-enemy-cleansed` | `cleanse-performed` where `isEnemySide(casterId)` | |

### 3.4 Crit filter

New optional `triggerCritFilter: 'crit' | 'non-crit'` field on `Ability`, honored by
the `on-attacked` / `on-ally-attacked` listeners (event `didCrit` vs the filter).

- Isha parses as TWO mutually exclusive abilities: 3% repair (`non-crit`) + 6% repair
  (`crit`) — "instead" semantics, never both on one hit.
- Guardian's Binderburg Resilience (self, crit-only) and ally-crit-hit Provoke
  (crit-only) use the same field.

### 3.5 Intent event context

`Intent` gains an optional `eventCtx` (initially `{ counterTargetId?: string }`) so a
reaction can reference the triggering event's actor:

- Warden's counter-Corrosion and Guardian's Provoke route to **the attacking enemy's**
  per-target debuff store (`counterTargetId` = the event's `attackerId`).
- Counter-debuffs land as named statuses — visible in the Enemy Effects panel and
  feeding condition reads — but **counter-DoT tick damage against enemy attackers is
  NOT simulated** (no enemy HP race exists in healing mode; the self-repair component
  is the simulated part). Documented approximation.

### 3.6 Executor additions

- **`damage` reactive branch** (new `ReactiveAbilityType`): Grif's "deals 75% Damage
  that cannot critically hit". Resolves with the owner's last-turn effective
  attack/affinity (same `lastTurnCtxByActor` pattern as bombs; skip with no ctx),
  honors `noCrit`, credits the owner's damage map against the shared enemy pool.
  Emits NO `attacked` / `ability-performed` → cannot chain.
- **Live drain-time `selfHpPct`:** `buildDrainContext` currently leaves `selfHpPct`
  at its 100 default. Feed the owner's live HP% (healing mode: real for the tank;
  100 for un-damaged actors and in DPS mode). This is what makes Makoli/Guardian's
  flipped-derivable below-40% gates evaluate against real HP at drain time.

## 4. PR slicing (six PRs, in order)

### PR 1 — Per-hit `attacked` + self-damage reactives (`feat/combat-engine-phase4c-self-damage`)

- Engine: per-hit `attacked` emission; `triggerCritFilter` listener support;
  `eventCtx.counterTargetId` threading; live drain-time `selfHpPct`.
- Parser: "When directly damaged…" → `on-attacked` reactives (heal/debuff/buff
  follow-ups); "while below X% HP" on those flips to **derivable** `hp-threshold`
  (today emitted non-derivable at `skillTextParser.ts:485,599`); "but when critically
  hit, it instead…" emits the crit/non-crit ability pair.
- Ships: Warden (counter-Corrosion name-only + 3% repair), Isha (3%/6% pair),
  Makoli + Guardian (below-40% gated 20% repair), Guardian (crit-only Binderburg
  Resilience I), Heliodor first passive (8% self-repair; the "reduces debuff durations
  by 1 turn" half **defers to 4e** — cleanse-family mechanics — documented).
- Golden churn: healing goldens with multi-hit enemy attacks (audited). DPS goldens
  byte-identical (nothing attacks the player side in DPS mode).

### PR 2 — `on-ally-attacked` reactives (`…-ally-damage`)

- Ships: Cultivator (repairs **the damaged ally** — heal routes to the event's target,
  i.e. the tank; "within the active pattern" approximated as ANY ally → real fix in
  4d), Refine (Inc. Damage Down I grant to the damaged ally), Heliodor second passive
  (ally repair + deferred duration-reduction), Guardian third passive (when an ally is
  critically hit → Provoke on the attacker; crit-only + `eventCtx`), Graphite
  (**role-filtered**: fires only when the damaged ally's ship role is attacker or
  debuffer).
- New `roleFilter` on the ability config (Graphite's clause), typed against the real
  role type `ShipTypeName` (`src/constants/shipTypes.ts`) as CATEGORY matchers:
  "attacker or debuffer" matches the Attacker role and ALL Debuffer variants
  (`DEBUFFER`, `DEBUFFER_DEFENSIVE`, `DEBUFFER_BOMBER`, …) via prefix/category match.
  Role is auto-filled from ship data on the heal-target/team cards. A defender tank
  correctly keeps Graphite dormant rather than inflating survival numbers; unknown
  role = no match (conservative).

### PR 3 — HP-threshold-crossed reactives (`…-hp-crossing`)

- Tank-side `hp-changed` at intake; `on-hp-threshold-crossed` listener; `oncePerCombat`
  extended to buff follow-ups.
- Tycho: Barrier grant on crossing below 40%, once per battle. Name-only (Barrier
  shield effect still UNMODELED — same convention as Yazid's 4b grant).
- Hermes: the charged-skill Cheat-Death grant gains its below-40% gate as a
  **cast-path** condition evaluated against the heal target's live HP, and the grant
  narrows from all-allies to the heal target. Fixes the 4b over-fire (KNOWN LIMITATION
  1); Hermes becomes advertisable in the changelog Cheat-Death ship list.

### PR 4 — Enemy-action events (`…-enemy-actions`)

- Event-only enemy heal/cleanse emission; `cleanse-performed` event; the two enemy
  triggers; `damage` executor branch.
- Ships: Zosimos (charge per enemy repair; its "decrease that enemy's charge for every
  second repair" clause stays UNMODELED — enemy charge sabotage — documented), Arum
  (Out. Damage Down I on cleanse + Gelecek Contagion II all-allies grant), Yarrow /
  Larkspur (Gelecek Contagion self-grants), Grif (75% no-crit damage proc on
  **`on-enemy-cleansed`** — "When an enemy cleanses a Debuff, this Unit deals 75%
  Damage that cannot critically hit").

### PR 5 — Enemy realism pair (`…-enemy-realism`)

- **Item 11:** flip `enemy-buff` / Provoke `self-debuff` ship gates to
  `derivable: true` (parser + `buildShipAbilities.ts`). Regenerate the 22 DPS goldens
  under **controlled known-diff review** — every diff explained before committing
  (affected ships move from assume-active-1 to live 0-at-start counts).
- **Item 12:** optional `enemyHacking` on the enemy attacker config + UI input. The
  landing roll `hacking − security, floor 0, no minimum` replaces the hard-coded
  `debuffLandingChance: 1` (engine.ts ~382). Tank security comes from the heal
  target's stats.

### PR 6 — Chakara lowest-speed (`…-chakara-lowest-speed`)

- **Item 10:** new `lowest-speed-ally` condition subject (derivable: owner speed vs
  live ally speeds from the runtimes). Parser emits the two start-of-round buff
  abilities (Attack Up II + Defense Up II) from Chakara's third passive. Parser +
  condition-context only; smallest PR.

Every PR: editor updates (Trigger select options, "not simulated" label removals,
new config fields), `docs/skill-model-coverage.md` §5 block + §6 item closure, and
folds into the ONE evolving UNRELEASED changelog entry (never a second entry).

## 5. Edge cases & determinism

- **Drain ordering unchanged:** all new triggers enqueue intents drained at the
  existing drain points (after each turn body, before Post Turn). A reaction never
  boosts or absorbs the hit that triggered it. Per-hit `attacked` events enqueue in
  hit order; registration order (focus first, then team in input order) keeps
  multi-owner runs deterministic.
- **Chain guards:** reactive heals still emit NO `heal-performed` (a player reactive
  heal cannot trigger heal listeners; `on-enemy-repaired` is enemy-scoped anyway).
  The `damage` executor branch emits no events → cannot chain.
  `MAX_INTENT_GENERATIONS` backstop unchanged.
- **Dead actors:** reactions don't fire for destroyed owners (existing dead-is-dead
  guards). A hit that kills the tank emits `ship-destroyed`, not a posthumous
  crossing. **Cheat Death intercepts resolve BEFORE `hp-changed` evaluation** — a
  100→1-HP save counts as crossing below 40% (Tycho's Barrier can proc on the save).
- **DPS-mode inertness:** every PR 1–4 trigger keys on events only emitted in healing
  mode (enemy attacks, tank HP intake, enemy casts). DPS goldens stay byte-identical
  except PR 5's audited regeneration.
- **Reactive-heal conventions carry over:** drain-time heals never crit, simplified
  fold, owner last-turn ctx stats (unchanged from 4b).

## 6. Testing

- **Unit tests** per trigger in `src/utils/combat/__tests__/` (existing per-trigger
  file pattern): per-hit enqueue counts; crit-filter pair exclusivity (never both on
  one hit); downward-crossing detection incl. crossing-on-Cheat-Death and
  no-re-fire under `oncePerCombat`; counter-debuff routing to the correct enemy
  per-target store; role-filter matching (incl. unknown-role no-match); event-only
  enemy heal/cleanse emission (no numeric credit).
- **New healing golden scenarios:** multi-hit enemy vs an on-attacked tank (locks the
  per-hit contract); Makoli-style gated reactive heal crossing 40%; Tycho
  once-per-battle Barrier; Cultivator ally-heal routing; one enemy-cleanse reaction.
- **Golden discipline:** goldens are synthetic (hand-built `ab()`) — any diff = bug,
  never `vitest -u`. PR 1's healing-golden churn and PR 5's DPS regeneration are the
  two explicit audited exceptions.
- **Parser lock tests** per ship phrasing in the `skillTextParser` suites +
  `audit:skills` parity — the Inc./Out. abbreviation-period masking rule applies to
  any new clause splitting (both parser AND auditSkills sides).

## 7. Documentation & changelog

- §5 gains a "Phase 4c" block per shipped PR (rules + approximations:
  aggregate-drain/per-hit-events split, cast-fires-regardless enemy events,
  counter-DoT-no-tick, any-ally pattern approximation, Zosimos charge-sabotage
  unmodeled, Heliodor duration-reduction deferred).
- §6 items 10 / 11 / 12 close as shipped.
- In-game verification list gains: per-hit repair cadence (Isha multi-hit), enemy
  cast-fires-regardless cleanse events, Hermes grant-narrowed-to-target.
- `DocumentationPage.tsx` only where user-facing knobs change (enemy hacking input,
  PR 5).

## 8. Workflow reminders (from project memory)

- `gh auth switch --hostname github.com --user TheSusort` before every PR/merge op.
- Hold pushes while the user iterates UI on the local tree (dev server :3000).
- CodeRabbit: poll `mergeState=CLEAN`, not check status.
- For "wrong number" disputes: temporary console.log breakdown against the user's
  real fleet.
