# Positional Combat Phase 3 — Forced Targeting & Stealth

**Date:** 2026-06-14
**Status:** Design approved (pending spec review)
**Phase:** 3 of 5 in the positional-combat decomposition (1 = geometry resolver [#106], 2 = engine positional target-selection [#108], **3 = forced targeting + stealth [this]**, 4 = multi-target consequences/AoE accounting/death-fallback, 5 = simulator page).

## 1. Goal

Make positional target resolution honour the game's forced-targeting and stealth rules
(combat-system.md §9): a stealthed ship is untargetable, a taunting ship pulls attacks,
and a Concentrate-Fire-marked ship is force-targeted (bypassing stealth). This builds
directly on Phase 2's `resolvePositionalTarget` seam and stays a **capability-only
overlay** — no production caller passes positions yet, so all existing DPS/healing
goldens remain byte-identical.

## 2. Scope

**In (the "redirect-marker" family — shared machinery, no applier tracking):**

- **Stealth** — exclude stealthed actors from the targetable set (enemy-side selection
  only); if *all* living opposing actors are stealthed, they all become targetable
  ("unless no targets without stealth are available", per the buff text).
- **Taunt** — a buff on a friendly ship forces opposing attackers to target it.
- **Concentrate Fire** — a debuff applied **only to the anchor/focus target** ("all
  attacks are redirected to this unit"); force-targets that actor and **bypasses stealth**.

**Out — immediate follow-up PR:**

- **Provoke** — a debuff on the *attacker* forcing it to attack *whoever applied it*.
  Requires resolving the debuff's applier back to a living opposing actor. The status
  engine tracks `sourceId` for timed buffs, so it is feasible, but it is distinctly more
  work and gets its own PR.

**Deferred (not in the data model today):**

- The per-ability **"skill can target stealthed ships"** exception. `ParsedTarget` has no
  `canTargetStealth` flag and there is no parser for it. Concentrate Fire's bypass covers
  the main practical case. Add this later with the parsing/data work it needs.

## 3. Game rules (from combat-system.md §9, user-confirmed)

- **Order:** forced targeting is evaluated **before** the stealth filter.
- **Forced-target priority:** Concentrate Fire → Taunt (§9 lists CF first). Provoke joins
  this chain in the follow-up PR.
- **Concentrate Fire** bypasses stealth and is applied **only to the anchor target**
  (user-confirmed) — i.e. it is a single-actor marker, never a team-wide debuff.
  **Note:** combat-system.md §9 (line 210) describes CF as a debuff "applied to a team";
  that description is **stale**. The user-confirmed model is the one used here — CF is a
  debuff on the *target* actor, which is why the `concentrated` flag is read from the
  per-target enemy-debuff store (§4.1), not from the attacker. Treat the spec as
  authoritative over §9 on this point.
- **Taunt:** if multiple ships taunt, "last applied wins". The status query layer exposes
  no application round, so this PR degrades to a deterministic **front-most board order**
  tiebreak; the resolution helper carries an optional `tauntAppliedRound` field so exact
  ordering is a trivial future add if the engine ever supplies it.
- **Stealth** affects **enemy-side (offensive) selection only**. Ally-side selection
  (heals/buffs anchoring on the caster) ignores stealth and forced targeting entirely.

## 4. Components

### 4.1 `buildForcedTargetingStatus` — new helper in `src/utils/combat/triggers.ts`

Co-located with the existing `selfBuffNamesForOwners` / `ownerDebuffNamesFor` query
helpers it composes.

```ts
export interface ActorTargetingStatus {
    stealthed: boolean;     // self-buff 'Stealth'
    taunting: boolean;      // self-buff 'Taunt'
    concentrated: boolean;  // enemy-debuff 'Concentrate Fire' on this actor
    tauntAppliedRound?: number; // UNSET this PR (no round data in query layer)
}

export function buildForcedTargetingStatus(
    statusEngine: StatusEngine,
    actorIds: string[]
): Map<string, ActorTargetingStatus>;
```

- `stealthed` / `taunting`: `selfBuffNamesForOwners(statusEngine, [id])` includes
  `'Stealth'` / `'Taunt'`.
- `concentrated`: `ownerDebuffNamesFor(statusEngine, id)` includes `'Concentrate Fire'`
  (Concentrate Fire is a debuff on the focus target, so it lives in the per-target store,
  not the self-buff store). engine.ts already reads a player actor's own debuffs from this
  store via `ownerDebuffNamesFor(statusEngine, ownerId)` (~line 1440), confirming
  per-actor-id keying works.

**Applier deferral (important):** Phase 3 has **no production path that *applies*
Concentrate Fire** to a specific actor's per-target store — that wiring (an attacker
marking a victim) belongs to the simulator/Phase-4 work, exactly like Provoke's applier.
So `buildForcedTargetingStatus` is the *read* half only. The CF/Taunt/Stealth test
fixtures (§6) therefore set up the status-engine store state directly (or assert against a
stubbed `statusOf`), rather than driving an in-game applier. This keeps Phase 3 a pure
read-and-resolve capability.

Buff-name constants already exist in `src/constants/buffs.ts` (`'Stealth'`, `'Taunt'`,
`'Concentrate Fire'`). Reference them rather than re-typing literals where a constant is
exported; otherwise inline the literal names matching the existing query-helper style.

### 4.2 `resolvePositionalTarget` gains an optional `statusOf` — `src/utils/combat/positionalBinding.ts`

New optional 4th parameter:

```ts
export function resolvePositionalTarget(
    actorPosition: Position,
    target: ParsedTarget,
    opposingLiving: CombatActor[],
    statusOf?: (id: string) => ActorTargetingStatus | undefined
): CombatActor | null;
```

**When `statusOf` is omitted → Phase-2 behaviour verbatim** (the load-bearing
backward-compat guarantee — every existing positional test omits it and stays green).

`statusOf(id)` returns `(ActorTargetingStatus | undefined)`; an `undefined` result (actor
not in the map, or no relevant statuses) **must be treated as all-`false`** — never throw,
never skip the actor. This is the actual production shape (a status map is built but every
actor is statusless), and it is the real basis for the byte-identical-goldens guarantee
(see §5).

When `statusOf` is provided **and `target.side === 'enemy'`**, resolution runs before
delegating to `selectTargets`:

1. Build the `position → actor` map (`byCell`) of living, positioned opposing actors (as
   today; invariant ≤1 actor per cell). If empty → return `null`. **`byCell` stays intact**
   for the final anchor→actor lookup; the stealth filter (step 4) operates on a *derived
   candidate cell list*, never by mutating `byCell`.
2. **Concentrate Fire** (bypasses stealth): among the mapped actors, collect those whose
   status is `concentrated`. If any, force-target one — **front-most when multiple, computed
   by explicitly sorting candidates by `colOf` descending** (do not rely on `byCell`
   insertion/roster order, which is not column-ordered). Return that actor.
3. **Taunt** (evaluated before stealth): else collect `taunting` actors. If any,
   force-target one — most-recent `tauntAppliedRound` if present, otherwise/tie the same
   explicit front-most (`colOf` descending) tiebreak. Return that actor.
4. **Stealth filter**: else build the candidate cell list `[...byCell.keys()]` minus the
   `stealthed` cells. If that list becomes empty (all stealthed), restore the full
   `[...byCell.keys()]` (no-targets-without-stealth fallback). Call `selectTargets` over the
   surviving cells and map the resulting anchor back to its actor via the untouched
   `byCell` (as today).

Ally-side selection (`target.side === 'ally'`) skips the stealth/forced-targeting branch
entirely and returns `null` (the function resolves an *opposing*-side target, and an
ally-side target has no opposing actor; the engine then falls back to its legacy
heal-target binding). This matches the `CombatActor | null` contract — `null` means "no
positional opposing target".

The function still returns a single `CombatActor | null` (the anchor actor); forced
targeting only changes *which* actor is returned. `resolveCells`/splash stay unwired
(Phase 4).

### 4.3 Engine wiring — 3 call sites in `src/utils/combat/engine.ts`

At each existing `resolvePositionalTarget` call (focus ~2430, team ~2542, enemy ~2780):
build the status map for the opposing roster with `buildForcedTargetingStatus(statusEngine,
<opposingIds>)` and pass `(id) => map.get(id)` as the new `statusOf` arg.

- Focus + team sites: opposing roster = `enemyAttackerActors`.
- Enemy site: opposing roster = `allPlayerActors`.

`statusEngine` is already in scope at all three sites. The map can be built per turn at the
call site (small rosters; no need to hoist). Side-symmetric per the team-agnostic principle.

## 5. Why goldens stay byte-identical

The status map is computed unconditionally whenever positional resolution runs, but it only
*changes* selection when an actor carries Stealth / Taunt / Concentrate Fire. No synthetic
golden fixture and no Phase-2 integration test applies any of these statuses, so the map is
all-`false` for them → identical anchor selection → no snapshot churn. The safety check is:
**no golden snapshot file appears in the diff.** If one moves, the gate leaked — fix the
gate, never `vitest -u`.

Note the two distinct code paths: the *omitted-`statusOf`* path (existing Phase-2 tests)
and the *provided-`statusOf`-returning-all-`false`* path (the real production shape once the
simulator passes positions). **Both** must be byte-identical to Phase-2 selection, and §6
asserts both explicitly.

## 6. Testing

- **`positionalBinding.test.ts`** (extend): with `statusOf` —
  - stealth filter excludes a stealthed enemy;
  - all-stealthed fallback (every enemy stealthed → still targetable);
  - Taunt forces the taunting actor even when it is not the default anchor;
  - Concentrate Fire forces the marked actor and reaches it through stealth;
  - priority: Concentrate Fire beats a simultaneous Taunt;
  - multi-taunt → front-most (asserts the explicit `colOf`-descending tiebreak, not roster order);
  - `statusOf` omitted → identical to the Phase-2 result;
  - **`statusOf` provided but returning `undefined` for every id → identical to the
    Phase-2 result** (the production all-statusless shape; the real goldens-invariant basis).
- **`triggers` test**: `buildForcedTargetingStatus` reads `Stealth`/`Taunt` (self-buff) and
  `Concentrate Fire` (enemy-debuff) into the right flags; absent statuses → all `false`.
- **Engine integration test**: a positional scenario where an opposing actor carries Taunt
  → focus-fire redirects to it (asserts the binding, not damage accounting — Phase 4).
  Plus the byte-identical goldens confirmation.

## 7. Non-goals / follow-ups (explicit)

- Provoke (next PR — applier→actor resolution via timed-buff `sourceId`).
- Per-ability "can target stealth" exception (needs `ParsedTarget` + parser work).
- Per-target damage accounting, AoE splash, death-fallback retargeting (Phase 4).
- Exact "last-applied" taunt ordering (needs a status-engine application-round query;
  the `tauntAppliedRound` field is the seam for it).

## 8. References

- combat-system.md §9 (Create Ordered Target List — forced targeting + stealth steps).
- Phase 2: `docs/superpowers/specs/2026-06-14-positional-target-selection-design.md`,
  `src/utils/combat/positionalBinding.ts`, `src/utils/targeting/selectTargets.ts`.
- Buff constants: `src/constants/buffs.ts` (`Stealth`, `Taunt`, `Concentrate Fire`, `Provoke`).
- Status query layer: `selfBuffNamesForOwners` / `ownerDebuffNamesFor` in
  `src/utils/combat/triggers.ts`.
