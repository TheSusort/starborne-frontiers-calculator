# One aliveness gate for the selector-targeting layer (#407)

Design for issue #407, the four-part residual of #403. Measurements below were taken before any
code changed; every number in this document is a measurement, not an estimate.

## Rulings (locked by the owner, 2026-08-27)

- **R1 — dead ships are never targetable.** "Most buffs" must skip the dead the way "highest
  attack" and "highest speed" already do. The check goes **up the chain**, at the seam where a
  roster becomes a targeting question, not as a fourth per-resolver predicate.
- **R2 — the gate is aliveness, and covers the never-alive shape too.** Not destroyed AND currently
  holding HP. This matches what the positional path already refuses to target.
- **R3 — Stealth does NOT gate selector targeting.** A stealthed enemy IS hit by a
  selector-targeted clause: Stealth hides you from being *picked as an attack target*, but a
  global "highest attack" effect finds you anyway. This is correct game behaviour, not a gap —
  no follow-up issue.
- **R4 — the buff-typed-at-enemy half is fixed at the AUTHORING boundary, not in the engine.** The
  Skill Editor stops offering enemy targets for ally-side ability types. The engine's
  `matchingAbility` predicate is left alone.

## Measurements

Both censuses #407 asked for, plus the one that decided part 2's shape.

### M1 — corpse selection is REACHABLE (1086 hits)

`mostBuffsAmong` was instrumented to log whenever the actor it returns is dead, and the whole
`npm test` suite run:

| outcome under an aliveness gate | hits |
| --- | --- |
| retargets to a LIVING buffed enemy | 525 |
| fizzles (no living enemy carries a buff) | 561 |
| **total corpse selections** | **1086** |

Attribution is dominated by `realKitFingerprints` (Zeolite / Razi / Prospect / Forsythia 78 each,
Faust 78, Panguan 60, Rys 59, **Lodolite 57** — the corpus purge ship), plus
`interactionInvariants` seeds, `differentialBaseline`, `DefenseCalculatorPage` and
`HealingCalculatorPage`.

This closes #407's explicit "reachability is UNMEASURED — do not call it corpus-unreachable"
question: it is not merely reachable, it is the common case wherever a purge ship meets a corpse.
Both columns are behaviour changes, so this is not a symmetry tidy.

### M2 — buff-typed enemy-aimed configs: ZERO in the corpus

Swept all 1140 abilities `buildShipAbilities` produces from `docs/ship-skills.csv` (every ship,
every slot, refit-resolved). Enemy-targeted configs by type:

```
damage 258, debuff 151, dot 58, additional-damage 48, control 37, purge 24,
counter 8, charge 8, shield-strip 3, detonate-dot 3, buff-steal 3, extend-dot 3,
convert-dot 2, extend-status 2, bomb-countdown-reduce 1, accumulate-detonate 1
```

No `buff`. But `AbilityCard.tsx`'s `TARGET_OPTIONS` is **not filtered by ability type**, so a user
can author `type: 'buff'` + `all-enemies` / `adjacent-enemies` / `target-and-adjacent-enemies` and
persist it. The three selector targets are absent from the editor list, so the selector half of
this defect is reachable only through hand-edited saved data.

### M3 — which ability types genuinely span sides

The census that decides part 2's map. Per type, the targets seen in real data:

- **spans both sides:** `charge` (self=24, enemy=8, all-allies=5), `control` (enemy=35, **self=6**,
  target-and-adjacent-enemies=1, adjacent-enemies=1), `extend-status` (all-allies=2, all-enemies=1,
  enemy=1).
- **ally-side only:** `buff` (self=160, all-allies=87, ally=12, adjacent-allies=3), `heal`,
  `shield`, `cleanse`, `modifier`, `incoming-reduction`, `pre-combat-stat`,
  `transform-incoming-to-dot`, `remove-self-buff`, `extra-action`, `conditional-stat`,
  `defense-substitution`.
- **enemy-side only:** `damage`, `counter`, `additional-damage`, `shield-strip`, `debuff`, `dot`,
  `extend-dot`, `detonate-dot`, `accumulate-detonate`, `purge`, `buff-steal`, `convert-dot`,
  `bomb-countdown-reduce`.

`control`'s self arm is Taunt (`parseControlInflicts` emits `ctrl.side === 'self'` for it);
`extend-status` legitimately extends ally buffs and enemy debuffs. A filter derived from the
target's *side alone* would therefore be wrong for those three — the map has to be a per-type
**permitted sides** classification, not a single default side.

### M4 — part 3's corpus-unreachability, confirmed

The only selector-targeted abilities in the corpus are:

```
Chakara/passive2/damage/enemy-highest-speed/start-of-round
Lodolite/charged/purge/enemy-most-buffs/on-cast
Rhodium/passive1/purge/enemy-most-buffs/end-of-round
Rhodium/passive2/purge/enemy-most-buffs/end-of-round
Rhodium/passive2/damage/enemy-most-buffs/end-of-round
Selenite/passive2/debuff/enemy-highest-attack/start-of-round
```

Nothing emits `shield-strip`, `extend-status` or `bomb-countdown-reduce` with a selector target.
`purge` / `damage` / `debuff` only.

## Part 1 — one aliveness gate at the selector seam

### The unit

New `src/utils/combat/targetableActors.ts`:

```ts
isAliveTarget(a: CombatActor): boolean   // a.destroyedRound === undefined && a.currentHp > 0
aliveTargetsOf(roster: CombatActor[]): CombatActor[]
```

Both conjuncts are load-bearing and must not be collapsed. `currentHp <= 0` is not the same
question as `destroyedRound !== undefined`: a **never-alive** actor (max hp 0, never killed) has
`currentHp === 0` and no `destroyedRound`, and a killed one has both. The NEVER-ALIVE vs KILLED
distinction is a standing rule in this engine; the conjunction covers both shapes without
conflating them.

`aliveTargetsOf` must be called **at use time, never hoisted into a `const` array**: rosters are
mutated in place as actors die during a round, so a filtered array captured at turn start goes
stale mid-round. Every seam below wraps it in a thunk.

### tsc, not a test, is the tripwire

`aliveTargetsOf` returns a BRANDED type — `AliveRoster = CombatActor[] & { readonly [brand]: true }`,
where the brand is a module-private `unique symbol` so only `aliveTargetsOf` can produce one. The
three selector resolvers take `AliveRoster`, not `CombatActor[]`. A seam that hands one of them a
raw roster then **fails to compile**, which is the same instrument the two total `Record`s in
`abilityTargetSide.ts` use: the key set is derived, so `tsc` rejects the omission. A convention
enforced only by a coverage test is exactly how the four hand-written `||` chains #399 replaced
went stale.

Scope of the guarantee, stated honestly: a compile-time brand gates AUTHORING, not INPUT. It is
sound here because every roster reaching these seams is built inside the engine from
`enemyAttackerActors` / `allPlayerActors` — none of it is user-persisted data that could arrive
unbranded at runtime. That is what makes the brand adequate here and would NOT make it adequate
for an ability config.

### The three seams

| seam | roster | consumers gated |
| --- | --- | --- |
| `buildTurnArgs` (~engine.ts:8704) | `tb.opposingRoster` | the eager `enemyMostBuffsId`, and all three arms of the `selectorEnemyIdFor` delegate |
| `playerDrainCtx` (~engine.ts:10016) | `enemyAttackerActors` | `enemyWithMostBuffs`, `enemyWithHighestAttack`, `enemyWithHighestSpeed`, `livingOpposingActorIds` |
| `enemyDrainCtx` (~engine.ts:10056) | `allPlayerActors` | the same four, mirrored |

Each seam declares one local thunk (`aliveOpposing`) and every selector in that scope reads it.
The delegate stays deliberately UNMEMOIZED, as #403 established, so an earlier same-cast purge is
visible to a later clause.

### What loses its own check

Because the roster arrives pre-gated, these stop asking:

- `highestAttackAmong` (`src/utils/combat/highestAttack.ts`) — the `isLiving` parameter is
  **removed**. Only the two engine callers below pass it; its own unit test is updated.
- `highestAttackInRoster`, `highestSpeedInRoster` — drop their `destroyedRound === undefined`
  predicate argument.
- `livingOpposingActorIds` (both drain contexts) — drops its inline
  `.filter((a) => a.destroyedRound === undefined)`.
- `mostBuffsAmong` — needs no filter added; its long OPEN comment about the missing death filter is
  replaced by a pointer to the gate.

Net: one gate replaces three checks and one gap. Four call sites can no longer disagree.

### Deliberately NOT swept, and why (both get a code comment)

- **`soleSurvivorOf` / `lastStandingId`.** "How many of my team are still standing" is a survivor
  count, not a targeting question. It filters on `destroyedRound` today; folding `currentHp > 0`
  into it would silently re-rule the Last Stand gate for a never-alive actor. Different question,
  different predicate, left alone.
- **The positional path.** `resolvePositionalTarget`'s `byCell` already indexes only
  `position !== undefined && currentHp > 0` cells, and `footprintVictims` mirrors it.
  `isTargetableRosterMember`'s doc comment records that its keying on MAX hp rather than current hp
  is load-bearing in two directions; re-pointing that path at the new gate would reopen a shape two
  earlier rungs closed. The positional layer keeps its own gate.
- **Stealth** (ruling R3). The positional path's stealth filter stays positional. The gate's doc
  comment records the ruling — a selector-targeted clause hits a stealthed enemy, and that is
  correct — so the next reader does not "fix" it.

### Expected fallout

`realKitFingerprints` snapshots may move. The suite is FOCUS-ACTOR-ONLY and structural (token
sets), so a purge landing on a different victim does not automatically move a token — but Lodolite
and the four 78-hit ships are the candidates. Any snapshot that moves is audited individually and
explained in the commit message. `vitest -u` on that file is forbidden; the golden audit spans the
whole `npm test`, not just the fingerprint file.

## Part 2 — make the buff-typed-at-enemy combination unauthorable

Ruling R4: fix the authoring boundary, leave the engine's `matchingAbility` predicate alone.

### The unit

`ABILITY_TYPE_TARGET_SIDES: Record<AbilityType, 'self' | 'enemy' | 'both'>`, added beside
`ABILITY_TARGET_SIDE` and `ABILITY_TARGET_SELECTOR` in `src/utils/abilities/abilityTargetSide.ts` —
the file whose stated job is answering side/footprint questions about one union with a total
`Record`, so `tsc` rejects a new `AbilityType` until somebody classifies it. Seeded exactly from
M3: `charge`, `control` and `extend-status` are `'both'`; everything else is `'self'` or `'enemy'`
per M3's two lists. `buff` is `'self'`, which is what closes the hole.

### The editor

`AbilityCard.tsx` filters `TARGET_OPTIONS` through it. One rule for saved data: if the ability's
**current** `target` is not in the filtered list, it is still rendered as an option, labelled as
not valid for this ability type. A `Select` whose value is absent from its options misrepresents
what is stored — the user would see a different target than the one saved. Plain text label, no
emoji.

### The gate

The M3 census becomes a test: for every ability `buildShipAbilities` derives from the CSV, the
side of its `target` must be permitted by `ABILITY_TYPE_TARGET_SIDES[ability.type]`. A future
parser change that emits a new spanning combination fails there instead of silently widening the
editor's own contract. The test asserts a floor on the swept ability count so a shrunken CSV read
cannot make it vacuous.

`selectorTargetStoreSide.test.ts`'s RESIDUAL arm stays exactly as it is — it pins what the engine
does, which is unchanged. Its comment gains one sentence: the combination is no longer authorable
through the editor, but remains possible in hand-edited persisted data (which is #404's axis).

## Part 3 — selector arm for three on-cast loops

`playerTurn.ts`'s `bomb-countdown-reduce` (`reduceEnemyBombs`), standalone `shield-strip`, and
`extend-status` debuff branch each resolve recipients with a bare
`ab.target === 'all-enemies' && aoeVictimIds ? aoeVictimIds : [targetId]` and have no selector arm.
They get one, resolved through the same `selectorEnemyIdFor` delegate `debuffRecipients.ts` uses,
so all four cast-path sites agree on which enemy a selector names.

Corpus-unreachable (M4), so hand-authored unit tests only, and no fingerprint movement is expected.
If a fingerprint moves here, that is a finding, not a rebaseline.

## Part 4 — `CHARGE_TARGET_KIND` derivation

`triggers.ts`'s `CHARGE_TARGET_KIND` re-lists the same three selector targets that
`ABILITY_TARGET_SELECTOR` classifies. Its three selector arms are derived from `enemySelectorKind`
instead of hand-authored, so the two maps cannot disagree about which targets are selectors. It
stays a total `Record` for its non-selector arms, including the two documented KNOWN GAP entries,
which are unchanged.

Pure refactor. Zero behaviour change; the existing charge-removal tests are the gate.

## Testing

- `targetableActors` unit test: killed, never-alive, alive, empty roster. The brand is checked by
  `tsc --noEmit`, not by a runtime assertion — a test cannot observe it.
- Engine integration test, team-symmetric: an opposing ship buffed in an early round and killed
  later; a purge aimed at `enemy-most-buffs` skips the corpse for a living buffed enemy, and
  fizzles when the only buffed enemy is dead. Written for both sides — a player-owned purge and an
  enemy-owned one.
- Seam coverage is `tsc`'s job via the brand (see "tsc, not a test, is the tripwire"), so there is
  no coverage test to write here.
- `highestAttack.test.ts` updated for the dropped parameter.
- Part 2's corpus census gate, plus an `AbilityCard` test for the out-of-range saved target.
- Part 3: hand-authored ability unit tests, one per loop.
- Full `npm test` plus `tsc --noEmit` and `eslint`; the whole-suite golden audit, not just the
  fingerprint file.

## Out of scope

- The engine's `matchingAbility` predicate (ruling R4) — the residual arm keeps measuring it.
- `#404`, persisted-ability reachability pins — the axis part 2 explicitly does not close.
- Stealth in the selector layer (ruling R3, decided game behaviour).
- `soleSurvivorOf` and the positional path (part 1, "deliberately NOT swept").
