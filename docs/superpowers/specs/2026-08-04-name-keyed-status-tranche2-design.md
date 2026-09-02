# Name-keyed status tranche 2 + Quixilver R2 passive — design

**Date:** 2026-08-04
**Baseline:** `main` @ `91cba2d5`
**Follows:** #289 (Exposed), #290/#291/#292 (tranche 1), #293 (per-victim accounting)

---

## 1. Context

Tranche 1 shipped three of the eight name-keyed statuses that land as genuine timed statuses but
carry empty `parsedEffects` — Hit Mitigation, Rogue's Liberty, Out. Detonation Damage Up III.
Five remain inert. This spec covers the two cheapest (`Shield Converter`, `Charged Overdrive II`)
and, pulled in during brainstorming because it is the same ship, the Quixilver R2 passive that
currently parses wrongly on three separate axes.

**Blast radius is one ship per status**, verified against `docs/ship-skills.csv`:

| Status | Granted by | Slot | Target | Parsed duration |
|---|---|---|---|---|
| `Shield Converter` | Quixilver | charged | self | none |
| `Charged Overdrive II` | Sentinel | charged | all-allies | 3 (inherited — see §6.1) |

`Block Repair` (Zosimos), `Block Shield` (APEX) and `Leech II` (Pallas) stay out of scope: each
needs a genuinely new mechanism, and Leech II's grant is withheld behind a `derivable: false`
manual gate regardless.

**Ship in two PRs.** Part A and Part B are independent and Part B grew two new engine mechanisms
during design. They share this spec but must not share a branch.

---

## 2. The governing invariant (inherited, do not weaken)

From #291's defect class:

> **A one-shot status must read ONLY the channels its consume call can actually spend.**

`selfBuffNamesForOwners` / `ownerDebuffNamesFor` union three channels; `removeSelfBuffByName` /
`removeTimedEnemyStatus` reach only the per-actor stores. `isAlwaysActive` returns true whenever
`!buff.skillSource`, and the manual buff pickers never stamp `skillSource` — so **every
hand-picked entry is always-active**, whatever duration the user typed. A broad read therefore
makes a hand-picked one-shot permanent and unspendable.

Both new statuses in Part A read `timedAbilityStatuses` **only**. A hand-picked instance is
consequently **inert**, which is the faithful rendering: there is no standing value for "blocks
the next hit" or "the next charged cast".

---

## 3. Part A1 — shared one-shot persistent channel

Both statuses are one-shots with no honest expiry: they persist until consumed. The codebase
already has a game-verified pattern for "a buff name overrides the parsed duration" —
`PERSISTENT_STACKING_BUFFS` (`statusEngine.ts:1408`):

> *"The status.duration (text value) is intentionally ignored — the buff-name rule overrides it
> (game-verified 2026-06-05)."*

**New file `src/constants/oneShotPersistentBuffs.ts`**, sibling to `persistentStackingBuffs.ts`.
It lives outside `src/constants/buffs.ts` for the same stated reason: `npm run fetch-buffs`
regenerates `buffs.ts` and would clobber hand-authored entries.

```ts
export const ONE_SHOT_PERSISTENT_BUFFS: ReadonlySet<string> = new Set([
    'Shield Converter',
    'Charged Overdrive II',
]);
```

These route to the same persistent store as the stacking family, capped at 1 stack. That store is
already surfaced by `timedAbilityStatuses` and already cleared by `removeSelfBuffByName`, which is
exactly the read/consume pair §2 demands — no new channel is introduced.

### Consult sites

`PERSISTENT_STACKING_BUFFS` has four live consult sites. Routing must go through **one shared
predicate**, not four ad-hoc `||` additions:

| Site | Role | Change |
|---|---|---|
| `statusEngine.ts:610` | stack cap inside `addPersistentStack` | one-shots cap at 1 |
| `statusEngine.ts:739` | scheduled / manual buff routing | route one-shots too |
| `statusEngine.ts:1408` | ability-status routing (`applyTimedAbilityStatus`) | route one-shots too |
| `shared.ts:19` | resisted-display row → `'permanent'` | **unchanged** (see below) |

`shared.ts:19` stays as-is deliberately: `synthesizeResisted` handles *debuffs* that failed to
land, and both new entries are self-granted buffs that are never rolled against. Adding them there
would be dead code.

**Why not a parser change.** The alternative was fixing `findLeadingDuration`
(`skillTextParser.ts:5067`), whose backward scan `continue`s past intervening `unit-skill` tags and
so cannot tell a genuinely shared leading duration from a preceding tag's trailing one:

- Oleander (**correct today**): `…Repair Over Time II for 2 turns and, for 3 turns, grants both <A> and <B>`
- Sentinel (**wrong today**): `<A> for 3 turns and <B>`

The obvious rule — *reject any candidate duration lying after a crossed tag* — **does not work**.
Oleander's `for 3 turns` also sits after a tag (`Repair Over Time II`), so that rule would break a
case that is correct today. The real distinguisher is that Oleander interposes a fresh governing
verb (`grants both`) between the duration and the tags it governs, while Sentinel does not. Any fix
has to key on that, which is materially harder than a positional test.

Empirically verified live consequences (corpus scan **with** `Inc.`/`Out.` abbreviation masking —
without masking the scan silently drops Sentinel's own clause, since `Out. Damage Up III` contains
a period):

| Ship | Trailing buff | Effect today |
|---|---|---|
| Sentinel | `Charged Overdrive II` | gets duration 3 — **leak**, neutralised here by name-keying |
| Sansi | `Barrier` (charged) | gets duration 1 from Taunt — **leak**, left untouched |
| Yazid ×2 | `Cheat Death` | none — already special-cased to `'recurring'` |
| Oleander | `Out. DoT Damage Up II`, `Hit Mitigation` | none — **correct**, must not regress |

Name-keying reaches the required behaviour with zero parser risk and leaves Sansi and Oleander
untouched. The parser bug is logged in §7.

---

## 4. Part A2 — Shield Converter

> "Nullifies the damage of the next direct hit, turning it into a Shield instead."
> Granted by Quixilver's charged skill, to self.

**New module `src/utils/combat/shieldConverter.ts`** — `SHIELD_CONVERTER` name constant,
`holdsShieldConverter(statusEngine, actorId)` reading `timedAbilityStatuses('self', actorId)`,
`consumeShieldConverter(statusEngine, actorId)` calling `removeSelfBuffByName`. Same shape as
`hitMitigation.ts`, including the doc comment explaining the narrowed read.

### Engine site

A new `else if` branch immediately after the Hit Mitigation block at `engine.ts:4207`, under the
**identical** guard:

```text
cause?.byDirectDamage === true && (cause.bombPortion ?? 0) === 0
  && !carriesBarrier && damage > 0 && transformedToDot === 0
```

**Ordering is locked: Hit Mitigation wins, and one hit spends exactly one block.** A victim holding
both keeps Shield Converter for the next hit. This preserves the existing step byte-for-byte and
makes the new one a pure fallback.

```text
nullified = damage
granted   = min(shieldPool + nullified, maxHp) - shieldPool
sink.addConvertedToShield(nullified, victim.id)
victim.shieldPool += granted
damage = 0
consumeShieldConverter(statusEngine, victim.id)
```

**Cap.** `granted` clamps at `maxHp`, consistent with every other shield grant (`engine.ts:2916`)
and with Quixilver's own R2 passive keying off "shield equal to 100% of its max HP", which only
makes sense if that is the ceiling. When the nullified amount exceeds the cap the hit is still
nullified **in full** — only the shield gain is clamped. `convertedToShield` records the full
nullified amount, because that is what explains the missing HP damage.

### Accounting

`.incoming` is **not** reversed. This follows Barrier, not Hit Mitigation. Hit Mitigation reverses
via `sink.addIncoming(-damage)` because its damage is *deferred* and re-books on tick; a converted
hit re-books nowhere, so reversing would erase the attacker's contribution. #293 settled the
equivalent question for Barrier: *"Barrier now changes the EFFECT, not the accounting."*

So `incomingBooked` stays at the full amount and the invariant holds by construction:

```text
Σ perTargetDealt == Σ perTargetDamage == Σ perActorIncoming[].incoming
```

Required plumbing:

- `ActorIntake` (`engine.ts:1441`) gains `convertedToShield: number`.
- `DamageAccountingSink` (`engine.ts:1483`) gains `addConvertedToShield`.
- Round assembly (`engine.ts:9110`) — the "absent when empty" guard currently tests three fields.
  **It must test the fourth too**, or a round whose only intake was a conversion is dropped from
  `RoundData` entirely.

---

## 5. Part A3 — Charged Overdrive II

> "Grants the next Charged Skill activation 20% Defense Penetration."
> Granted by Sentinel's charged skill, to all allies.

Distinct from the standing `Charge Overdrive II` (+20% Defense Penetration) 120 lines above it in
`buffs.ts`. Same magnitude, different scope — one-shot and charged-only. **Do not normalize the
two together.**

**New module `src/utils/combat/chargedOverdrive.ts`** — name constant,
`CHARGED_OVERDRIVE_II_PEN = 20` (percentage points), `holdsChargedOverdriveII`,
`consumeChargedOverdriveII`. Same narrowed read as §4.

### Engine site

`playerTurn.ts`, on the `action === 'charged'` path (`action` is resolved at :1035-1045; the
existing `statusEngine.sourceFired(actor.id, 'charge', r)` call at :1256 is the natural sequence
point). Consumption is **unconditional** — any charged activation spends it, damaging or not.

Accepted consequence, deliberate: Sentinel grants to `all-allies` including itself, and Sentinel's
own charged skill deals no damage, so Sentinel wastes its own copy. This is the literal reading of
"the next Charged Skill activation" and avoids both a post-damage consume point and a
kit-inspecting grant, neither of which has precedent in this engine.

### The one fiddly part

`effectiveStats.ts:216-219` sums Defense Penetration from four sources
(`base + baseBuff + mod + dotPen`). A one-shot per-cast bonus **must not** be folded into the
standing stat, or it leaks into every later hit and into the DPS/UI scalars. It has to be threaded
into this cast's damage computation only. Pinning the exact seam is the first task of the Part A
plan, not a design assumption.

---

## 6. Part B — Quixilver R2 passive (separate PR)

> "At the end of this Unit's turn, if it has shield equal to 100% of its max HP, this Unit grants
> all allies **Barrier** for 1 hit and applies **Barrier Recharging** for 3 turns."

Parses wrongly on three axes today and is `observed: false`:

| Axis | Today | Correct |
|---|---|---|
| Trigger | `on-cast` | `end-of-turn` |
| Condition | none | shield ≥ 100% max HP |
| `Barrier Recharging` target | `enemy` | all-allies |

The wrong target traces to `Barrier Recharging` being typed `debuff` in `buffs.ts`. It *is* a
negative status, but a friendly-side one — Panon only gets `target: self` because its text says
"to itself" explicitly.

### 6.1 Hit-counted Barrier (new mechanism)

`BARRIER_BUFFS` (`barrierBuffs.ts:8`) is documented as *"Duration-based … NOT consumed on first
hit"*. Four corpus sites say "Barrier **for 1 hit**": Malvex, Panon (charged), Quixilver, Sansi.

This cannot be deferred, because of a lock-in specific to Quixilver. A durationless buff ability
classifies as an **aura** (`engine.ts:267-270`: `cfg.duration === undefined` → `isAura`), and
`carriesBarrier` detection at `engine.ts:3880` uses `selfBuffNamesForOwners`, which includes auras.
An aura is re-evaluated per round against its conditions, so a durationless Barrier is permanent
**for as long as its gate holds**. Quixilver's gate would be "shield is full", and Quixilver's kit
*gains shield from damage taken* — Barrier blocks the damage, the shield never drops, the gate
never clears. It self-sustains into permanent team-wide immunity.

(Panon's charged Barrier is durationless today and does *not* show this, because its grant is
condition-gated on holding Taunt — verified: Panon keeps taking damage after its round-4 charged
cast. So the mechanism is latent, not currently live.)

**Design:** add `hitsRemaining` to the Barrier status, decremented in the `carriesBarrier` branch
(`engine.ts:4246`) when it actually absorbs, expiring at 0. Turn-duration Barriers are unaffected —
`hitsRemaining` absent means the existing timed lifecycle governs, so every current fixture is
byte-identical.

### 6.2 `self-shield-full` condition (new primitive)

`self-shielded` exists but only tests `shieldPool > 0`. A new primitive tests
`shieldPool >= maxHp`. Added to the `ConditionKind` union (`abilities.ts` ~507, beside
`self-shielded`) and to the condition evaluator.

### 6.3 Barrier Recharging as an enforced lockout

Its text is *"Cannot be granted Barrier. Cannot be reduced. Unremovable."* Today it is **read**
(`hasBarrierRecharging`, `engine.ts:3347`, used by Panon's incoming-reduction via the
`self-barrier-recharging` condition) but **never enforced** — nothing gates a Barrier grant on it.

**Design:** a Barrier grant is skipped for any recipient already holding Barrier Recharging.
Quixilver's passive then re-fires each turn but is a no-op for 3 turns — a real cooldown — and
Panon's existing self-application starts meaning something.

---

## 7. Out of scope — logged, not fixed

1. **`findLeadingDuration` between-tags leak** (§3). Real parser bug. Two live leak sites
   (Sentinel, Sansi); Sentinel's is neutralised here by name-keying, Sansi's is left standing.
   Deferred for two reasons, not one:
   - the naive positional rule would **regress Oleander**, so a correct fix must key on the
     interposed governing verb — a genuine piece of parser work, not a one-liner;
   - fixing it would make Sansi's charged Barrier durationless, which is unsafe until §6.1's
     hit-counted Barrier exists (durationless → aura → permanent while gated).

   So it is *sequenced after* Part B, not abandoned. Any attempt needs the abbreviation-masking
   caveat above, or its own corpus scan will lie to it.
2. **Panon's passive triggers** parse as `on-cast` though the text says "If this Unit is directly
   damaged" (should be `on-attacked`). Pre-existing, unrelated ship.
3. **Remaining inert statuses**: `Block Repair`, `Block Shield`, `Leech II`.
4. **Affinity Overrides** — one-shot by text, no consume call anywhere in `src`. Needs a game-rule
   decision.

---

## 8. Testing

**Part A**

- Unit, per module: a hand-picked always-active instance is **inert** (the §2 invariant, and the
  exact bug tranche 1 found in Toxic Overflow).
- Shield Converter integration: nullify + shield gain + status cleared; cap clamps the gain but not
  the nullification; a bomb portion, a Barrier-nullified hit and a DoT batch each leave it intact;
  a victim holding both blocks spends only Hit Mitigation.
- Charged Overdrive II integration: an ally's next **charged** cast gets +20 pen and clears the
  status; an **active** cast does not spend it; the bonus does not persist into the following cast.
- Accounting: `Σ dealt == Σ taken == Σ incoming` across a shield-converted hit, asserted on a
  **positional** fixture — `emitHit` is positional-only, so victim-row assertions are otherwise
  vacuous.

**Part B**

- Hit-counted Barrier: expires after N absorbs; a turn-duration Barrier is unchanged; no golden moves.
- `self-shield-full`: true only at `shieldPool >= maxHp`.
- Quixilver end-to-end: fires at end of turn only when shield is full; allies get Barrier +
  Barrier Recharging; re-fire within 3 turns is a no-op.

**Both:** full `npm test` (the golden audit spans the whole run), `tsc`, lint. Never `vitest -u`.

---

## 9. Risks

- **§5's pen threading** is the most likely place to introduce a leak into standing stats. Mitigated
  by an explicit "does not persist into the following cast" test.
- **§6.1 touches the Barrier lifecycle**, which sits in front of shield, Cheat Death and the
  Protection cascade. Mitigated by making `hitsRemaining` opt-in so absent means byte-identical.
- **§6.3 adds a gate on Barrier grants**, which could silently suppress an intended grant elsewhere.
  Only Panon and Quixilver apply Barrier Recharging today, so the reachable surface is small.
