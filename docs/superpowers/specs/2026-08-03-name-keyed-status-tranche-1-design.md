# Name-keyed status tranche 1 — Rogue's Liberty, Hit Mitigation, Out. Detonation Damage Up III

**Date:** 2026-08-03
**Baseline:** `main` @ `4bc437bd` (PR #289 merged)
**Related:** PR #289 (Exposed status, intra-cast clause order)

## Background

PR #289 left eight on-cast statuses untriaged, recorded at the time as "name-only, no
implementation anywhere in `src`". That framing was wrong on both counts, and the triage
that opened this spec established the real picture:

1. **All eight have real mechanical definitions** in `src/constants/buffs.ts` — they are not
   cosmetic markers.
2. **All eight already land as genuine timed statuses** in the StatusEngine with the correct
   target and duration. Verified via `npx tsx scripts/traceShip.ts` across the whole corpus:
   six report `observed: true`; the two `false` ones are legitimately withheld (Pallas's grant
   carries a `derivable: false` team-dependent gate, by design; Quixilver's needs a charged
   cast the standard scenario never reaches).
3. Only the **payload** is missing — `parsedEffects: {}` for all eight, confirmed against
   `scripts/verify-buff-parsing.ts` (they sit in its "No DPS effects" bucket, while siblings
   such as `Charge Overdrive I/II` parse cleanly).

So every one of the eight is a **name-keyed read at one site** — the Exposed pattern. No
parser work and no status-delivery plumbing is required for any of them.

The full corpus mapping (one ship each, no others):

| Status | Ship | Slot / target / duration | Engine support today |
|---|---|---|---|
| Rogue's Liberty | Chimei | charged / all-allies / 2 | `ignoresForcedTargeting` exists as a **static** actor flag |
| Hit Mitigation | Oleander | charged / all-allies / 3 | whole `transform-incoming-to-dot` step exists |
| Out. Detonation Damage Up III | Chimei | active / ally / 1 | `detonationDamageModifier` channel exists in bomb math |
| Shield Converter | Quixilver | charged / self / none | — deferred |
| Charged Overdrive II | Sentinel | charged / all-allies / 3 | — deferred |
| Block Repair | Zosimos | charged / enemy / 2 | no gate anywhere — deferred |
| Block Shield | APEX | passive / enemy / 1 | no gate anywhere — deferred |
| Leech II | Pallas | passive / self / 1 | setup-time-only leech scan — deferred |

This spec covers the first three: the ones whose mechanism already exists in the engine.

## Organizing principle

The tranche divides along the rule locked by #289's Exposed work: **is this a standing stat,
or not?**

- **A standing stat for its duration → `parsedEffects` channel.** Every reader should see it,
  including DPS-mode aggregates, effective-HP, and the buff-display UI.
- **Not a stat (one-shot interceptor, or a rule override) → name-keyed module.** Routing these
  through `parsedEffects` leaks: a one-shot block has no honest standing value, so effective-HP
  and the DPS aggregate would read it as permanent damage immunity — precisely the failure mode
  that made Exposed name-keyed.

Unit 1 is a standing stat. Units 2 and 3 are not. This is why the three do not share an
implementation, despite superficially all being "empty-payload named statuses".

### Approaches considered and rejected

- **Name-key all three.** Superficially consistent, but wrong for Unit 1: it *is* a standing
  multiplier, so name-keying forces a bespoke read at every consumer and leaves the buff UI and
  DPS aggregate silently under-reporting a real +45%.
- **A general named-status registry** mapping names to behaviours in one table. Attractive with
  five more statuses queued, but landing it means refactoring five existing name-keyed families
  (Barrier, Cheat Death, Exposed, persistent-stacking, Toxic Overflow), which swamps a
  three-item tranche. Revisit once the remaining five are in and the abstraction's shape is
  evidence-backed rather than guessed.

## Unit 1 — `detonationDamage`, a new `parsedEffects` channel

**Status:** `Out. Detonation Damage Up III` — "+45% Outgoing Detonation Damage" (Chimei, ally,
1 turn).

Four touch points, each following the established `defensePenetration` / `dotDamage` precedent
(both of which fold through the `toDotAndPenModifiers` sibling path rather than
`calculateBuffTotals`, for exactly this reason):

1. `src/types/calculator.ts` — add `detonationDamage?: number` to `ParsedBuffEffects`.
2. `src/utils/calculators/buffParser.ts` — add
   `extract(/([+-]\d+)%\s*Outgoing\s*Detonation\s*Damage/)`. No collision with the existing
   `outgoingDamage` pattern, which requires the literal "Direct".
3. `src/utils/calculators/dpsBuffHelpers.ts` — `toDotAndPenModifiers` returns a third field,
   `detonationDamageModifier`, summed as `parsedEffects.detonationDamage * stacks` over the
   attacker list.
4. `src/utils/combat/effectiveStats.ts:219` — becomes
   `detonationDamageModifier: mod.detonationDamage + dotPen.detonationDamageModifier`.

**Why this channel reaches both detonation paths for free.**
`EffectiveDamageStats.detonationDamageModifier` is the single source for both:

- the **applier's snapshot** onto `PendingBomb.detonationDamageModifier` at bomb application
  (`playerTurn.ts:2425` / `:2517`), consumed at burst by `detonation.ts:126`,
  `engine.ts:832`, `bombCountdown.ts:60`; and
- the **detonating actor's live** `detonationMult` for container detonations
  (`playerTurn.ts:2360` / `:2370`).

One fold therefore covers both without per-site work. This split is deliberate and documented
at `playerTurn.ts:757-760`: bombs burst with the applier's snapshotted modifier, container
detonations use the detonating actor's live stats. Unit 1 does not change that split.

**No `Out.`/`Inc.` split.** Unlike `dotDamage`, the regex requires the literal "Outgoing" and
the corpus contains no incoming-detonation buff, so the name-prefix branch `dotDamage` needs is
unnecessary here.

## Unit 2 — `hitMitigation.ts`, a name-keyed one-shot interceptor

**Status:** `Hit Mitigation` — "Blocks the next direct hit, transforming the damage receieved
into dot dealt over 3 rounds." (Oleander, all allies, 3 turns). Note the typo is in the game
data; do not "fix" it in `buffs.ts`, as the description string is matched against game text.

**Resolved semantics:** the DoT lands on **the holder** — the blocked damage is spread over the
holder itself, same net damage paid slowly. This matches the existing `transform-incoming-to-dot`
behaviour (Voron/Orel) verbatim, and both "mitigation" and "damage received" point this way.

**Placement.** A sibling step to the existing `transform-incoming-to-dot` block in
`applyVictimDamage` (`engine.ts:3995-4050`), pushing an identical self-DoT onto
`genericDoTEntries`:

```
{ stacks: 1, tier: 0, remainingRounds: 3, sourceId: victim.id, perTickAmount: damage / 3 }
```

The `3` comes from a named constant in the new module, **not** from the status's own duration.
They coincide at 3 today; tying them would be a coincidence-shaped bug.

`damage` here is the **post-incoming-block** amount — the same variable the existing transform
step reads at that point in the funnel, after any `incoming-block` reduction and before any
shield/HP drain. Hit Mitigation converts what would actually have landed, not the pre-reduction
figure.

**Read / consume APIs** — the Affinity Override pattern at `playerTurn.ts:1144-1146`:

- read: `selfBuffNamesForOwners(statusEngine, [victimId]).includes('Hit Mitigation')`
- consume: `statusEngine.removeSelfBuffByName(victimId, 'Hit Mitigation')`

**Precedence rules.** Both are restatements of the Exposed invariant — *consume only on a hit
that actually did the work*:

1. **Barrier nullifies first.** Barrier sits strictly in front of every other incoming-effect
   mechanism (`barrierBuffs.ts`), so a Barrier-immune hit must **not** consume Hit Mitigation.
   The existing transform step already guards on `!carriesBarrier`; mirror it.
2. **The ability-based transform is checked first.** Voron/Orel's permanent passive already
   zeroes the damage on a match, so Hit Mitigation must **not** be consumed in that case. An
   Oleander-buffed ally who is also Voron can hold both simultaneously.

Because it is one-shot, it must also not fire on DoT ticks (`cause?.byDirectDamage` only) or
on a hit already reduced to zero (`damage > 0`) — the same guard triple the existing step uses.

**Accounting.** It must set `transformedToDot` exactly as the existing step does — reversing the
recorded `sink.addIncoming(damage, victim.id)` and reporting the converted amount — or both the
`attacked` signal (gated on `immediateDamage - transformedToDot > 0`, `engine.ts:4554`) and the
per-victim damage-taken credit go wrong.

## Unit 3 — `rogueLiberty.ts`, a name-keyed targeting override

**Status:** `Rogue's Liberty` — "Ignores Taunt and Provoke." (Chimei, all allies, 2 turns).

**This is a change in kind, not just a new caller.** `ignoresForcedTargeting` already exists and
is wired to production — `detectIgnoresForcedTargeting` (`skillTextParser.ts:756`) →
`buildShipAbilities.ts:3631` → `battleSimulator.ts:921/963/1049` → `createActor` →
`resolvePositionalTarget`. Nine ships carry it: Akula, Anjian, Huanying, Judge, Meiying,
Stalwart, Valkyrie, Vanguard, Yuyan. But it is a **static, construction-time actor flag**
derived from a ship's *own* skill text. Rogue's Liberty is a **timed buff granted to allies**,
so the flag must become dynamic at its read sites.

Note that most of those nine state the clause on a *specific cast* ("This Unit's attack ignores
Taunt and Provoke") yet the flag is modelled **actor-wide**. Rogue's Liberty's actor-wide
semantics therefore match existing precedent rather than introducing a new scope.

The `// not yet populated by a production caller` comments at `engine.ts:479`, `1026`, `1165`
and `1204` are **stale** and should be corrected as part of this work.

**Two read sites**, both of which already hold `statusEngine` in scope (they call `provokerOf`),
making the change local:

- `engine.ts:5673` — `selectTurnTarget` → `resolvePositionalTarget`
- `engine.ts:5966` — `drivePositionalApply` → forwarded to `applyPositionalDamage`'s
  `acting.ignoresForcedTargeting` at `engine.ts:5189`

Each becomes `a.ignoresForcedTargeting || holdsRogueLiberty(statusEngine, a.id)`.

The other three occurrences (`engine.ts:605`, `1592`, `1676`) are construction-time copies from
input, **not** reads — leave them alone.

**Semantics match the existing flag exactly**, including that it does **not** bypass Concentrate
Fire (`state.ts:154-156`; `positionalBinding.ts` keeps CF above Taunt, and its tests at
`positionalBinding.test.ts:100/162/172` pin that ordering).

## Team symmetry

All three are symmetric by construction; no enemy-side lift is required.

- **Unit 1** folds inside `effectiveDamageStatsOf`, and `runPlayerTurn` serves the enemy turn
  too (`engine.ts:7965`, alongside `7213` and `7463`).
- **Unit 2** sits in `applyVictimDamage`, the side-agnostic per-victim funnel.
- **Unit 3**'s two sites key off `a.side` / `tb.opposingRoster` after the `bySide` unification.

## Scope boundaries

Stated explicitly so they do not read as oversights:

- **Rogue's Liberty is positional-mode only.** Forced targeting is a positional concept;
  aggregate mode has no per-target selection to override.
- **Hit Mitigation via the manually-selected DPS-mode channel** may have no per-actor entry to
  consume — the same pre-existing limitation documented for Exposed in `exposedStatus.ts`.
  Check during implementation and document the outcome either way; do not fix it here.
- **The other five statuses are out of scope**: `Shield Converter`, `Charged Overdrive II`,
  `Block Repair`, `Block Shield`, `Leech II`.
- **Exposed's stack rule stays open and untouched.** Whether 2 stacks arm one hit at +200% or
  two hits at +100% each is unresolved and only affects a refit-3 Amartya (the sole applier of
  more than one stack; R2 Amartya and Nayra both apply 1). Settle by in-game observation:
  land one direct hit on a 2-stack target and watch whether the icon vanishes or drops to ×1.

### Noted for later, not actioned here

`buffs.ts` contains both `Charge Overdrive I` / `Charge Overdrive II` (+10% / +20% Defense
Penetration, which parse cleanly) and `Charged Overdrive II` (prose, unparseable). These are
**not** duplicates: "the next Charged Skill activation" makes the latter one-shot and
charged-only. Decide deliberately when that status is picked up — do not normalize it away.

## Testing

- **TDD, with the red test driven through production slot routing.** The recorded lesson from
  the skill-model gap sweep is that three whole families looked like gaps but were dump-fidelity
  false positives, caught only because the test drove the real path. A test that asserts against
  a parsed-ability dump proves nothing here.
- **RNG pinned** with `setupKeyedTestRng` / `resetRateGateRng` + `mulberry32`. No cross-side
  amount comparisons — the RNG is keyed by `ownerId`, so mirrored assertions across teams
  diverge for reasons unrelated to the change.
- **Never `vitest -u`.** The golden audit spans the whole `npm test`.

### Expected golden movement

Predicted up front so that surprises are signal rather than noise:

- **Unit 2 is the big one** — all-allies for 3 turns changes damage taken across team sims.
  Every changed line should be a damage magnitude or a DoT row; no vanished rows, no reordering.
- **Unit 1** only bites when a buffed ally actually applies or detonates a bomb. Chimei carries
  no bombs itself, so single-ship traces likely move not at all.
- **Unit 3** only bites when a Taunt or Provoke is live in a positional fight.

## Delivery

Three independent PRs:

- Unit 1 is disjoint — `types/calculator.ts`, `buffParser.ts`, `dpsBuffHelpers.ts`,
  `effectiveStats.ts`.
- Units 2 and 3 both touch `engine.ts` but in unrelated regions, so they parallelize in
  worktrees with per-diff review.

Each gets an `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts` — all three are
user-visible sim behaviour changes. No `DocumentationPage.tsx` update: these are engine
fidelity fixes, not new user-facing features.
