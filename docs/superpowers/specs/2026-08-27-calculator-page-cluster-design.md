# Calculator page cluster: #392, #393, #391

Date: 2026-08-27
Issues: #392 (shared roster hook), #393 (sim memo stability + debounce), #391 (Theoretical EHP gates)
Status: approved, ready for implementation planning
Note: `docs/` is gitignored in this repo, so this spec is intentionally uncommitted, matching the
other specs in this directory.

## Why these three together

All three land on `HealingCalculatorPage.tsx` (1158 L) and `DefenseCalculatorPage.tsx` (816 L).
#392 is sequenced **first as an enabler, not as debt payment**: once the shared hook exists, #393's
memo fix lands once instead of twice, and gets one test instead of two.

Three PRs, strictly sequential. Parallel worktrees would conflict in `DefenseCalculatorPage.tsx`.

## Premise corrections found while scoping (do not re-derive)

These contradict the issue text. The issues were written from the shipping session's memory; the
code says otherwise.

1. **#391's gate is NOT dropped by the auto-fill.** `SkillEffect` (`skillTextParser.ts:5230`), the
   record `buildSkillBuffAutoFill` consumes, has **no condition field at all**. The static path never
   had a gate to drop. Gates are attached on a *separate* pass over the same sentence, inside
   `buildShipAbilities`, through **at least three distinct paths**:
   - `detectGrantConditions(rowText, buffName)` — `buildShipAbilities.ts:3299`
   - `crossing()` → `detectHpCrossingTrigger` — `buildShipAbilities.ts:3136`. **This is the one
     Redeemer's below-60% gate actually goes through.** Its own comment states
     `detectGrantConditions` has no rule for "when HP drops below N%", verified corpus-wide.
   - `targetGate()` → `detectTargetHpGate` — the Hermes target-HP gate.
   Re-running any single detector would miss the others and would rot as paths are added.
2. **#393's "fresh `getShipById` per call" applies to the DEFENSE tests only.**
   `HealingCalculatorPage.test.tsx:9` already uses a module-level `mockGetShipById` (identity-stable)
   and `zeroEnemies.test.tsx:27` shares it. `DefenseCalculatorPage.test.tsx:10` returns
   `getShipById: () => undefined` and `zeroPressureRanking.test.tsx:95` returns
   `(id) => SHIPS_BY_ID.get(id)` — both fresh per render.
3. **#393 understates the re-run trigger.** `simResults` depends on the whole `configs` array, so
   editing a config's **name** re-runs N full simulations. Not only the three numeric fields.
4. **#392's "copied verbatim" is not verbatim.** Four real divergences (measured by diffing
   `HealingCalculatorPage.tsx:347-520` against `DefenseCalculatorPage.tsx:298-426`):
   - healing's `removeTeamShip` floors the roster at 1 and resets the survivor; defense allows empty
   - healing has a `shipFinalStats` helper (`:135`); defense inlines the same `calculateTotalStats`
     body twice
   - healing has `teamShipSlot` / `changeTeamShipSlot` with swap-on-collision; defense has neither
   - id-ref seeds differ: healing 2 / defense 1 (deliberate — defense's rosters start empty)
   The two **mapping memos** (`teamActors`, `enemyInputs`) ARE code-identical; only their comments
   differ.
5. **Theoretical EHP has three consumers, not one:** the card figure
   (`DefenseShipCard.tsx:343`), `SecurityEHPChart`'s "tank score = Theoretical EHP x Security"
   (`:183`), and the best-ship badge's tie-break ladder key 2 (`DefenseCalculatorPage.tsx`, the
   documented ladder above `mergedBuffTotals`).
6. **Calculator page state is NOT persisted.** Neither page uses `useStorage`. A new field on
   `SelectedGameBuff` would carry no stored-record migration risk from these pages — but see PR 3,
   which avoids the field entirely for a better reason.
7. **Every self-HP gate in the corpus is a `below` gate.** 7 occurrences in `docs/ship-skills.csv`
   (`below 20/40/50/60%`); no "while above X% HP" buff exists on any shipped ship.

## PR 1 - #392: `useEnemyTeamRoster`

New `src/hooks/useEnemyTeamRoster.ts`. Full hook: all 8 handlers plus both mapping memos, with the
four measured divergences as explicit options.

```ts
useEnemyTeamRoster({
  minTeamShips: 1 | 0,
  enemyIdSeed: number,
  teamIdSeed: number,
  defaultTeamSlot?: (index: number) => Position,
})
// ->
{
  enemies, teamShips,              // state
  enemyInputs, teamActors,         // the two mapping memos
  addEnemy, removeEnemy, selectEnemyShip, updateEnemy,
  addTeamShip, removeTeamShip, selectShipForTeamSlot, updateTeamShip,
  teamShipSlot?, changeTeamShipSlot?,   // present only when defaultTeamSlot is supplied
}
```

`firstFreeSlot` (currently duplicated at `HealingCalculatorPage.tsx:93` and
`DefenseCalculatorPage.tsx:74`) and `shipFinalStats` move in as module helpers.

Call sites:
- healing: `{ minTeamShips: 1, enemyIdSeed: 2, teamIdSeed: 2, defaultTeamSlot: defaultHealingTeamSlot }`
- defense: `{ minTeamShips: 0, enemyIdSeed: 1, teamIdSeed: 1 }`

Out of scope for the hook: the healing page's `targetActor` memo (heal-target-as-team-actor). It is
healing-specific and has no defense twin.

### The load-bearing detail

`enemyInputs` must keep emitting **both `target` and `pattern`** (and `chargedTarget` /
`chargedPattern`). The positional-apply gate needs both, and a missing `pattern` fails **silently** —
crediting nothing per-victim while the damage number still looks plausible. This is the exact reason
#392 was deferred rather than done inline.

### Verification

- Both pages' existing suites green with **no fixture changes**. The healing page's sim-value
  assertions are the real oracle; a mapping that drifts moves those numbers.
- New hook unit test covering each divergence option:
  - `minTeamShips: 1` refuses to empty the roster AND resets the survivor's `buffs` /
    `enemyDebuffs` / `startCharged` / `speed` / `chargeCount` while carrying `position` through
    as-is, `undefined` included
  - `minTeamShips: 0` empties it
  - `enemyIdSeed: 1` labels the first added enemy "Enemy 1"; seed 2 labels it "Enemy 2"
  - `defaultTeamSlot` absent => `teamShipSlot` / `changeTeamShipSlot` are not returned
- Type check: `npx tsc --noEmit`. `tsc` catches what vitest cannot here.

## PR 2 - #393: narrow deps + debounce

Two independent fixes; both are required, and each needs its own proof.

### Fix A - narrow the sim memo key

Derive a memoized projection of only the sim-relevant config fields and key `simResults` on that
instead of on `configs`. Editing a config's name must run **zero** simulations.

The sim-relevant set is exactly the fields the `simulateDefenseSurvivability({...})` call site reads
(`DefenseCalculatorPage.tsx:485-523`): `id, hp, defense, security, attack, crit, critDamage, speed,
hacking, healModifier, shipSkills, buffs, chargeCount, startCharged, affinity, role, faction,
position, shipId`. `name` is the only field it does not read. Derive the list from that call site
rather than from `HealerShipConfig` / the defense config type, so a field added to the type but not
passed to the sim does not silently rejoin the key.

**Implementation trap:** `configs.map(pick)` returns a **new array with new objects every render**,
so a naive projection changes identity exactly as often as `configs` did and fixes nothing. The
projection must be compared **by value** — a stable serialized key, or a
`useMemo` whose own dependency is that serialization. The call-count assertion below is what proves
which of the two you actually built.

### Fix B - debounce the three write-through numeric inputs

`DefenseShipCard.tsx:109` (hp), `:115` (defense), `:121` (security). Local state for the displayed
value so typing stays responsive; 250 ms debounce before it reaches `onUpdate`.

Leave the `name` input alone — Fix A already makes it free.

### Test harness fixes (the actual issue)

- `DefenseCalculatorPage.test.tsx:10` and `DefenseCalculatorPage.zeroPressureRanking.test.tsx:95`:
  hoist to module-level stable mocks, matching `HealingCalculatorPage.test.tsx:9`.
- Add the assertion neither page has: spy the sim boundary
  (`simulateDefenseSurvivability` / `simulateHealing`) and assert **call counts**:
  - 0 on a name edit
  - 1 per settled numeric edit (not 7 for a 7-digit entry)
  - N on a roster change

### Mutation proof (required, not optional)

Revert Fix A and Fix B **separately** and confirm the new assertions redden for that fix
specifically. One assertion that only catches one of the two means the other is unmeasured — and a
call-count spy is exactly the instrument that goes quietly vacuous.

## PR 3 - #391: gated buffs out of Theoretical EHP

### Decisions taken

- Gated auto-filled buffs are **dropped** from Theoretical EHP, and the card **names** them with
  their condition in words.
- All three consumers move together: card figure, chart tank score, badge tie-break.
- Rejected: "resolve gates at full HP". It gives the identical number for every shipped ship (all 7
  corpus HP gates are `below` gates), and non-HP gates (Stealth, enemy-debuff-present, enemy-type)
  have no full-health answer, so they would drop anyway.
- Rejected: caption only. Leaves the overstatement in place next to the correct figure.

### Detection: read the built ability, do not re-parse

Each config already stores `shipSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece)`. The
gate is already on those objects, put there by whichever of the three paths applies. Read
`ability.conditions?.length` and the whole class is covered, including paths added later.

**Compute gatedness as a derived `Set<buffId>` at the page level. Do NOT add a field to
`SelectedGameBuff`.** That record is consumed across ~10 engine modules; a new field obliges
sweeping every producer that re-enumerates it (`toSelectedBuffs`, the picker path, the
ability->buff round trip). A derived set touches no shared type and no engine surface.

### The join, and its hazard

`SelectedGameBuff.skillSource` has five values (`active | charge | passive1 | passive2 | passive3`).
`Skill.slot` has **three** (`active | charged | passive`, `abilities.ts:5`). The join is therefore
lossy in two ways: `charge` maps to `charged`, and all three passives collapse into one `passive`
slot.

Rule: map the source to its slot, then match abilities in that slot with
`config.type === 'buff' && config.buffName === buff.buffName`.

**A buff is gated only when EVERY matching ability is gated.** If any grant path for that name is
unconditional, the buff genuinely can stand always-on and must keep counting. Mitigating fact: only
the refit-active passive applies in-game (resolved via `getShipSkillRows()`), so multi-match is rare
in practice — but the rule must be conservative regardless.

### What drops, and what does not

- Only `autoFilled` buffs. A buff the user picked by hand in the picker is deliberate and always
  counts, gate or no gate. Same for `globalBuffs`.
- `mergedBuffTotals` (`DefenseCalculatorPage.tsx:543`) skips gated buffs in all three of its
  reducers (`defense`, `incomingDamage`, `security`).

### The "why" line

Card shows, under the figure:

```
Theoretical EHP:  96,025
  Not counted (conditional):
  - Defense Up II - below 60% HP
```

`ConditionRow.tsx:38` already holds condition-subject labels (`EXTRA_SUBJECT_LABELS` plus
`CONDITIONAL_CONDITION_LABELS`), but they are file-local and generic ("when HP crosses a
threshold"). Extract a shared `conditionSummary(condition): string` that renders the *specific*
phrasing ("below 60% HP") and have `ConditionRow` and the card line share one vocabulary. Do not
duplicate the labels.

### Blast radius must be MEASURED, not assumed

Sweep `docs/ship-skills.csv` x every slot through `buildShipAbilities`, and list every ship whose
Theoretical EHP moves and by how much. **If that list is empty the fix is unreachable and the PR is
vacuous** — report that instead of shipping it. The known instance is Redeemer: 40,000 HP /
5,000 Defense reads 113,250 today (Defense 6,500, 64.7% reduction) and should read 96,025
(Defense 5,000, 58.3%).

Reachability is a measurement, not a reading: prove the sweep can report a non-empty answer before
believing an empty one.

### Changelog

Required, user-facing. Must state that on the zero-pressure default page (no enemies configured,
where the ladder falls through to Theoretical EHP) the "Best ship configuration" badge can now land
on a **different card** for the same inputs.

## Game example, for the whole of PR 3

Redeemer, first passive refit-active: *"This Unit gains Shield equal to 2.5% of its Max HP every
turn. When HP drops below 60% it gains Defense Up II for 4 turns."*

Put it on the Defense calculator at 40,000 HP / 5,000 Defense. It starts the fight at full health,
so that buff is not on it. The engine-backed **Damage absorbed** figure already holds the buff back
until HP crosses 60%. **Theoretical EHP**, sitting right beside it, reads 113,250 as though Defense
Up II were standing from turn one — an 18% overstatement against the correct 96,025. After this PR
both figures agree about the gate, and the card says which buff it left out and why.

## Out of scope

- The healing page's `targetActor` memo (PR 1).
- Any change to `skillTextParser.ts` or `SkillEffect` (PR 3 - the abilities already carry the gate).
- Debouncing the name input (PR 2 - Fix A makes it free).
- #390 and #357, which form the other backlog cluster (corpus-unreachable engine gates).
