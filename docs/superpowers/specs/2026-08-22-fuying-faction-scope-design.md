# Fuying: faction-scoped recipients, the Stealth DR aura, and three sibling gaps (#363)

Issue: [#363](https://github.com/TheSusort/starborne-frontiers-calculator/issues/363).
Base: `2168ccf0` (PR #365, the 2026-08-22 ship-data refresh's five parser/engine defects).

The refresh added Fuying (legendary Tianchao supporter). PR #365 killed the phantom outgoing
`damage{30}` her DR aura was being built as, and deliberately left the modelling gaps open. This
spec covers those gaps, plus a fifth found while specifying them.

**Out of scope:** #362 (`Reversed Repairs`). The owner ruled 2026-08-22 that it converts incoming
repairs into damage, which is a new engine channel — damage originating at a heal-apply site, with
its own attribution / mitigation / shield / leech / logging / death questions. Its own spec.

---

## 1. Gap 0 — Fuying has no targeting data (NEW, and it blocks gaps 1 and 4)

### The finding

**Fuying is the only ship of 149 with no targeting data.** She is absent from
`docs/ship-targeting.csv` and has null `activeTarget` / `activePattern` in `docs/ship-data.json`.
Prophet, added by the same refresh, got its row.

Measured, not assumed:

```
ships: 149    targeting rows: 148
ship-data rows lacking activeTarget/activePattern: ['Fuying']
```

The three other names that differ between the two files (`AEGIS`/`Aegis`, `APEX`/`Apex`,
`LUXX`/`Luxx`) are case skew only — `populate-ship-targeting.ts` matches case-insensitively, so
they are not gaps.

### Why it is load-bearing

`parseShipTargeting` requires **both** axes and returns `{}` when either is missing
(`targetingParser.ts:221`). That propagates:

| Step | Site | Value for Fuying today |
| --- | --- | --- |
| `parseShipTargeting(ship)` | `targetingParser.ts:227` | `{}` — no `active`, no `charged` |
| `firingPattern` | `playerTurn.ts:1341` | `undefined` |
| `footprintAllyIds` | `playerTurn.ts:1342` | `undefined` |
| `supportRecipients` | `playerTurn.ts:1371` | "don't narrow" |

So **every ally-scoped cast clause she has reaches her whole own side, herself included.** Gaps 1
and 4 are both questions of *which allies she reaches*; fixing either while the footprint is
"everyone" measures against a moving baseline.

### The fix

Owner-supplied 2026-08-22: **Fuying's pattern is Purifier's.**

```csv
Fuying,other-allies,Pattern-Wings-Support-Not-Self-Range-2,,
```

Both charged columns stay empty: `parseShipTargeting` inherits active for the charged slot when a
ship has a charged skill, and Fuying's `charge_skill_charge` is 3. That matches the owner's
description of the extension as reaching "all allies within her **active** pattern".

The app reads targeting from Supabase `ship_templates`, not the CSV, so the CSV edit must be
followed by `scripts/populate-ship-targeting.ts`. Re-running `npm run fetch:ship-data` afterwards
is what makes `docs/ship-data.json` agree.

### A ruling this makes unnecessary

Purifier's pattern is `Not-Self`, and the Stealth grant is a **cast**, so it is footprint-narrowed.
Fuying therefore never grants herself Stealth, and her own DR aura is inert on her.

Note carefully **why** it is inert, because the two available reasons are not interchangeable and
only one is correct — see §3: the aura is a *passive* and is not footprint-narrowed at all, so its
recipient set **does** include her. What makes it inert is the `self-stealth` condition failing,
not her absence from the recipient set. The "does *ally* include the caster" question therefore
needs no owner ruling here, but it is not answered by excluding her.

---

## 2. Gap 1 — the faction scope is dropped

### Current behaviour

```
active: "This Unit cleanses 1 debuff, grants Security Up III for 2 turns
         and grants Tianchao allies <unit-skill>Stealth</unit-skill> for 1 turn."

built:  buff{Stealth} target:'all-allies'      <- faction word discarded
```

Stealth is a *targeting-immunity* status, so over-granting it does not merely inflate a number —
it makes allies unselectable who should be selectable. **14 of 149 ships are Tianchao**, so on a
typical five-ship team most allies are wrongly protected.

### `all-allies` is not itself the bug

The issue reads the built `target: 'all-allies'` as the defect. It is not. On the cast path
`'ally'` and `'all-allies'` resolve **identically**, and both **are** footprint-scoped
(`playerTurn.ts:3934-3947`, owner ruling 2026-08-21, pinned by
`plainAllyCleanseFootprintReach.integration.test.ts`). The target stays as parsed; what is missing
is the faction predicate.

### Design

A recipient-attribute filter, mirroring the existing `roleFilter` at every layer:

| Layer | `roleFilter` (existing) | `factionFilter` (new) |
| --- | --- | --- |
| Type | `Ability.roleFilter?: ShipRoleCategory[]` | `Ability.factionFilter?: FactionKey[]` |
| Engine map | `roleByActorId` (`engine.ts:3592`) | `factionByActorId` |
| Engine lookup | `roleOf: (id) => …` | `factionOf: (id) => …` |
| Actor input | `TeamActorInput.role?` | `TeamActorInput.faction?` |
| Parser | `detect…roleFilter` | faction-word detector over the recipient phrase |
| Editor | `AbilityCard.tsx` `CheckboxGroup` | same, see §2.3 |

**Side-agnostic by key.** `roleByActorId` and `nameByActorId` are both keyed by any actor id on
either side and seeded from the player focus actor, walked team actors, and `input.enemyAttackers`.
`factionByActorId` follows that exactly — combat-engine work is team-symmetric, so an enemy Fuying
scopes her grant to enemy Tianchao allies with no mirrored branch.

**Plumbing already half-done.** `PlacementPlan.faction` exists in `battleSimulator.ts:772` and
`PreFightUnit.faction` in `preFight/types.ts:73`, both fed from `Ship.faction`. Only the engine
actor inputs lack the field.

**Applied after footprint narrowing**, as an intersection, inside the support-recipient resolution
— not at parse time. The footprint is positional and live; the faction is static. Composing them
at the resolution site keeps one place where "who receives this" is decided.

### 2.1a `FactionName` is a fake type, and this change cannot rely on it

`FactionName` provides **no** compile-time protection today:

```ts
export const FACTIONS: Record<string, Faction> = { … } satisfies Record<string, Faction>;
export type FactionName = keyof typeof FACTIONS;   // ⇒ `string`, not a literal union
```

The explicit `Record<string, Faction>` annotation defeats `keyof typeof`. Verified by compiling
`const probe: FactionName = 'NOT_A_REAL_FACTION'` — clean, exit 0.

This is the same defect class as `STAT_NORMALIZERS` (#295), where a `Record<string, number>`
annotation let two dead keys (`defense`, `critChance`) sit unused for months. It is *worse* here
because of §2.2: a typo'd `factionFilter: ['TIANCHOA']` would compile, match nothing, and — under
unknown-never-matches — grant Stealth to **nobody**. Silent under-grant instead of the current
silent over-grant.

Tightening `FACTIONS` itself is **out of scope**: 15 call sites index it with a plain `string`
(`SquadLeaderPicker`'s `factionLabel(faction: string)`, `ArenaModifiersTab`'s `rule.factions.map`,
`ShipInventory`, `ShipSelector`, `ShipIndexPage`, …) and would all need narrowing. Contained fix
instead — one new literal union, no duplicated key list, zero churn at those sites:

```ts
const FACTION_DEFS = { ATLAS_SYNDICATE: { … }, … } satisfies Record<string, Faction>;
export const FACTIONS: Record<string, Faction> = FACTION_DEFS;  // loose indexing preserved
export type FactionKey = keyof typeof FACTION_DEFS;             // a REAL literal union
```

`factionFilter` and `factionOf` use `FactionKey`. `FactionName` is left exactly as it is — this
spec does not migrate its existing consumers.

### 2.2 Unknown faction → never matches (owner-approved)

Conservative, matching `matchesRoleCategory`'s existing rule, rather than the assume-met fallback
the `name`-keyed `ally-on-team` gate uses.

This only bites manually-configured actors. Single-ship DPS has no allies at all, so the grant is
moot there; every team-sim actor is derived from a picked ship and carries a faction. The failure
mode of the rejected alternative is worse: assume-met silently preserves today's over-grant for
exactly the actors whose faction we could not confirm.

### 2.3 Editor exposure (owner-approved: same as `roleFilter`)

`roleFilter`'s `CheckboxGroup` is gated on `ability.trigger === 'on-ally-attacked'`, and the
trigger `Select`'s `onChange` **strips** `roleFilter` when the new trigger cannot carry it
(`AbilityCard.tsx:988-999`), so a stored ability stays canonical.

`factionFilter` is not trigger-scoped — it is a recipient scope. The same pattern therefore hangs
off the **target** axis: render the group when `ability.target` is an ally-plural target
(`'ally' | 'all-allies' | 'adjacent-allies'`), and strip `factionFilter` in the target `Select`'s
`onChange` when the new target cannot carry it. Empty selection normalizes to an **absent key**,
never `[]`, exactly as `roleFilter` does.

This ships in the same change as the field. Per the deferral-expiry rule, "a later task exposes it"
is not an answer to what this commit does — the editor would otherwise render an unset control or
silently drop a parsed filter on any unrelated edit.

### 2.4 Accepted cost: this is a one-ship feature

Measured over all 149 ships: **Fuying's four clauses are the only faction-scoped *recipient*
clauses in the corpus** (the active Stealth grant plus the DR aura at all THREE refit tiers — R2
and R3 carry character-identical text, which is what made an earlier count of 3 wrong: the
measuring script deduped on (ship, sentence) and silently dropped one real observation). Every
other faction mention — 31 clauses across 9 factions — is a buff
*name* (`Tianchao Precision II`, `XAOC Swiftness III`, `Binderburg Resilience III`,
`Everliving Regeneration II`, `Gelecek Contagion II`), which the parser already handles as an
opaque `buffName` and which this change must not touch.

Owner-approved 2026-08-22 despite that: the over-grant is *actively wrong* today, not merely
absent, and Stealth's targeting immunity makes it distorting rather than cosmetic.

---

## 3. Gap 2 — the DR aura is unapplied

```
R2: "All Tianchao allies with <unit-skill>Stealth</unit-skill> take 15% less direct damage."
R3: same, 15%
R4: same, 30%
```

### Design

An **ally-scoped** `incoming-reduction`:

```
{ type: 'incoming-reduction', scope: 'direct', condition: 'self-stealth',
  pct: 15 | 30, critFamily: false }
target: 'all-allies'   factionFilter: ['TIANCHAO']
```

Both the config type and the `'self-stealth'` `IncomingCondition` already exist and are already
used by Voidshade and Wusheng — the *gate* needs no new work.

- `scope: 'direct'` only. The text says "direct damage", so DoT ticks stay unreduced; the
  `(scope === 'dot') !== isDot` guard in `incomingReductionForHit` enforces that for free.
- `critFamily: false` — additive with other non-crit reductions, per that function's composition
  rule (`max(crit-family) + sum(non-crit)`).
- **`patternScoped: true`. OWNER-RULED 2026-08-22 — do not re-derive this from the locked rule.**
  Asked directly with an in-fight example (Anjian Stealthed INSIDE her pattern, Wusheng Stealthed
  OUTSIDE it, both hit): **Wusheng takes FULL damage.** The aura is footprint-scoped.

  This REVERSES what this spec originally said. The earlier text argued "not patternScoped" from
  the locked rule that a passive not naming the pattern is never footprint-narrowed. That was a
  GUESS: the locked rule records owner rulings about *other* ships' clauses and does not settle a
  new mechanic. The clause's own wording ("All Tianchao allies with Stealth", no pattern words)
  genuinely reads the other way — so the text is not self-evident and had to be asked.
  See [[feedback_ask_game_examples_dont_guess]].

  Consequence: the aura's recipients are `footprint ∩ Tianchao`, the same composition the Stealth
  GRANT uses — not a team-wide aura. (Her sibling reactive Stasis clause says "within the active
  pattern" explicitly and already carries `patternScoped: true`; both clauses in this passive are
  therefore pattern-limited, one by wording and one by ruling.)

### The plumbing that is actually new

`incomingAbilitiesById` (`engine.ts:3739`) is built by walking **each actor's own** passive slot
and keying the result on `rt.actor.id`. Every existing member of the family — `incoming-reduction`,
`incoming-block`, `incoming-shield-grant`, `damage-reflection`, `transform-incoming-to-dot` — is
self-scoped, so the map has never needed to fan out.

**Fuying is the corpus's first ally-scoped incoming reduction.** Her ability must be collected onto
every qualifying same-side actor's list rather than only her own. The faction filter is applied at
that fan-out, where `factionOf` is in scope, so `incomingReductionForHit` stays pure and unchanged.

**The fan-out includes the owner.** This is the one place where §1's `Not-Self` reasoning does not
carry, and getting it wrong is easy: the aura is a *passive* whose clause does not name the pattern,
so it is not footprint-narrowed, so Fuying — herself a Tianchao ally — is in its recipient set. It
is inert on her only because the `self-stealth` condition fails, since the *grant* (a cast) is
Not-Self.

So the recipient set must be derived from the ability's target and `factionFilter` alone. Do **not**
exclude the owner as an optimisation on the grounds that "Fuying never has Stealth" — that hardcodes
a fact about her *grant's pattern* into the *aura's* recipient resolution, and it breaks silently
the day any ship self-grants Stealth or a teammate grants it to her. Let the condition gate do the
work it already does correctly.

The existing per-actor collection must keep its current behaviour byte-for-byte: only an ability
whose `target` is ally-plural fans out at all.

---

## 4. Gap 3 — the cleanse count does not scale

```
charged: "This Unit cleanses 1 debuff for every 50% crit power this Unit has …"
built:   cleanse{count: 1}          <- scaling discarded
```

`countScaling?: { stat: 'critDamage'; per: number }` **already exists** on the shared
`cleanse | purge` config (`abilities.ts:862`) for Amartya's identically-worded purge. Two things
stand in the way:

1. The field's own doc comment says "cleanse never sets this", and the parser only emits it on the
   purge path.
2. The arithmetic — `count × max(0, floor(effectiveCritDamage / per))` — lives **inside** the
   `ab.config.type === 'purge'` branch (`playerTurn.ts:3679-3691`), including its defensive
   `per > 0 && Number.isFinite(per)` guard against a hand-built config making the quotient
   `Infinity`/`NaN`.

Design: lift that arithmetic into one shared helper, call it from the cleanse branch as well, emit
`countScaling` from the parser for the cleanse phrasing, and update the doc comment. `count: 'all'`
must remain unscaled — the existing guard's `typeof count === 'number'` check already expresses
that and must be preserved by the lift.

`effectiveCritDamage` is the caster's **live** crit power with buffs and debuffs folded, integer
percent. At 150% crit power Fuying's charged skill cleanses 3.

---

## 5. Gap 4 — the Stealth duration extension

```
charged: "… and extends <unit-skill>Stealth</unit-skill> by 1 turn."
built:   nothing
```

### Owner ruling (2026-08-22)

**All allies within her active pattern — faction-blind.** Not Tianchao-scoped, unlike the grant.
The text supports it: the clause names no faction, where the active clause does.

### Design

A named-status duration extension on the **charged** slot, `target: 'all-allies'`, **no**
`factionFilter`. Footprint scoping comes free once Gap 0 lands: a cast-slot ally-plural target is
always narrowed by `footprintAllyIds`, and the charged slot inherits the active pattern.

**This is not `buff-duration-extension`.** That config exists, but it is the Boost gear set's
always-on caster-side marker for buffs the wearer *applies* — collected into a per-owner map and
never executed through the ability fold. Fuying's clause extends an **existing** named status on
**existing holders** at cast time.

**It is, however, `extend-status`** — a config that already exists and already does almost all of
this. Found while planning; it is a much smaller change than "a new config variant":

```ts
| { type: 'extend-status'; statusKind: 'buff' | 'debuff'; turns: number }
```

Its executor (`playerTurn.ts:3780-3812`) already handles the `statusKind: 'buff'` +
`target: 'all-allies'` case for Ripper, **already narrows through `supportRecipients`** (so the
pattern scoping is free), and already runs side-symmetrically outside the healing gate. Its
`StatusEngine.extendAllBuffsDuration` (`statusEngine.ts:1341`) iterates the recipient's `selfMaps`
entries, each carrying a `buffName`.

So gap 4 is: an optional `buffName?: string` on the config (absent → today's extend-everything),
a `buffName` filter in the StatusEngine method, a parser regex for the named phrasing, and the
executor passing the name through. Fuying does not match the existing
`EXTEND_STATUS_ACTIVE_RE`/`_PASSIVE_RE`, which both require a literal `buffs`/`debuffs` token, so
adding a named-status regex cannot disturb Sokol, Ripper, or Lev.

Consequence worth stating: the extension composes with the aura. An ally whose Stealth would have
expired keeps the 15%/30% reduction one round longer.

---

## 6. Ordering, and why

```
Gap 0  targeting data        <- blocks 1 and 4; changes the measured baseline
Gap 1  factionFilter         <- and Gap 2 keys on Tianchao-allies-with-Stealth,
Gap 2  the DR aura           <-   so 1 before 2 or the two gaps compound
Gap 3  cleanse countScaling  <- independent; smallest
Gap 4  Stealth extension     <- needs Gap 0's footprint
```

Gaps 1 and 2 compound if separated in the wrong order: the aura keys on *Tianchao allies with
Stealth*, so applying the aura while the grant still over-grants Stealth spreads the reduction to
allies who should have neither.

Gap 3 is independent of all of it and can land in any position.

---

## 7. Testing and measurement

- **Red test through production slot routing first**, never against a hand-built ability. Three
  earlier sweep families turned out to be dump-fidelity false positives for exactly this reason.
- **Measure each gap corpus-wide before the fix**, so each blast radius is known rather than
  assumed — the standard this ship's own PR #365 set.
- **Verify each fix at the built-kit and combat-log level**, not only at the parser. A parser unit
  test does not prove the engine feeds the ability the right input.
- **Prove each instrument could report the opposite** before believing a green result. A fixture
  that observes nothing passes.

### Expected movement, called out in advance

- **Fuying's kit fingerprint will move.** It was pinned only days ago by PR #365 against the
  no-targeting-data behaviour; Gap 0 changes her footprint from the whole own side to a narrowed
  Not-Self pattern. Re-baseline by hand, never `vitest -u`.
- **Any golden containing Fuying will move** for the same reason.
- Gap 1 must be shown **inert for all 148 other ships** — no other ship carries a faction-scoped
  recipient clause (§2.4), so a corpus-wide diff outside Fuying is a defect in the parser change.
- Gap 3's lift must be shown **byte-identical for Amartya**, the existing `countScaling` consumer.

### Specific traps for this work

- `Stealth` over-granting is visible in *targeting*, not in a damage total. A test that only
  asserts damage cannot see gap 1. Assert the recipient set.
- The DR aura is `observed: false` in the current trace scenarios. A fixture must put a Tianchao
  ally **holding Stealth** in front of incoming **direct** damage, or it observes nothing.
- Gap 2's fan-out changes a map every incoming hit reads. The existing self-scoped members of that
  family must be pinned unchanged.
- Gap 2's owner-inclusion (§3) cannot be tested through Fuying, because she never holds Stealth —
  every observable outcome is identical whether the implementation includes her in the fan-out or
  excludes her. Assert the **recipient set** directly, or the wrong implementation ships green.

---

## 7a. LOCKED Stealth mechanics — owner-ruled 2026-08-22, do not re-derive

All three were asked with concrete in-fight examples after an earlier draft of this spec guessed
one of them wrong. Read these before touching anything Stealth-gated.

1. **Stealth affects only being CHOSEN as a target. Damage lands normally.** A Stealthed ally is
   removed from the enemy's target-selection pool, but anything that resolves onto them hurts them
   at the full rate unless something reduces it — including a single-target attack forced there.
   So a "takes N% less direct damage while Stealthed" aura is **frequently live**, not a corner
   case. (This is why the DR aura is worth modelling at all; had Stealth meant damage immunity it
   would have been near-dead weight.)

2. **The DR aura is PATTERN-LIMITED** — see §3. Anjian Stealthed inside her pattern gets the
   reduction; Wusheng Stealthed outside it takes FULL damage.

   **"within the active pattern" governs the WHOLE passive, not just the sentence it sits in.**
   That phrase appears only in sentence 2 (the Stasis reactive); the aura is sentence 1 and never
   contains it, and at **R2 the aura ships alone with no pattern phrase anywhere in the passive**.
   The limit therefore comes from the mechanic, not from the aura's own words — so it holds at R2
   too, where there is no text to hang it on.

   This runs AGAINST this codebase's convention, which is why it had to be asked rather than read:
   `Ability.patternScoped` is documented as "the opt-BACK-IN for the handful of passives that name
   the pattern **themselves**", and the locked rule treats a passive as un-narrowed unless its own
   clause names the pattern. Both read the phrase as clause-scoped. For Fuying it is
   passive-scoped. Do not generalise this to other ships without asking — it is a ruling about
   THIS passive.

3. **Being hit does NOT consume Stealth.** It ends by expiry (or the holder's own action), not by
   taking damage. Two consequences: the reactive "when an ally in Stealth … is directly damaged"
   gate needs no pre/post-hit ordering rule — the ally simply still holds Stealth — and the
   reaction can fire on **every** qualifying hit within the window, so any once-per-round or
   once-per-ally cap must come from the ability's own TEXT, never be invented to tame it.

### Consequence: an unenforced gate, measured

Fuying's R3/R4 passive reactive — "When an ally in Stealth within the active pattern is directly
damaged, this Unit inflicts Stasis for 1 turn onto the enemy" — **does not check Stealth at all.**
Measured at Task 3's HEAD in the `plain` fingerprint scenario: **40 `Stasis` log mentions, 0
`Stealth`.** It fires with nobody Stealthed anywhere.

Not introduced by any task here, and the faction fix makes it *more* visibly wrong (on a team with
no Tianchao ally, nobody is ever Stealthed and it still fires). Ruling 3 above makes it fully
specifiable now: gate on the damaged ally holding Stealth, pattern-scoped, no invented cap.
**Owner decision needed on scope** — widen this branch, or file as its own issue.

## 8. Not gaps — do not re-open

- **The reactive Stasis passive** parses correctly, `patternScoped: true` included. Fuying is the
  corpus's first *reactive* Stasis, which raises a question about the multi-hit tripwire's
  coverage — that is noted on #357 and stays there.
- **Prophet's innate 45% shield penetration** is allowlisted because `docs/ship-data.json` already
  carries `shieldPenetration: 45`; parsing it would double-count. Nothing here touches it.
- **`Tianchao Precision`, `XAOC Swiftness`, and the other 32 faction-named buffs** are buff names,
  not scopes. The faction detector must not match them.
