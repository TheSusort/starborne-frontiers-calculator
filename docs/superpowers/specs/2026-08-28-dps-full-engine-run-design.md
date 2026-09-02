# DPS calculator: full engine run (#415)

**Date:** 2026-08-28
**Issue:** [#415](https://github.com/TheSusort/starborne-frontiers-calculator/issues/415)
**Related:** #417 (re-triaged by this spec, see *Non-goals*), #418 (dependency), #413 (the ship that
surfaced it)

## Goal

A DPS run executes the **full engine runtime** — shields, both leech classes, repair-over-time,
`lowest-hp-ally` routing, real self-HP gates — while the **healing report stays absent** from the
result. Heal *accounting* is not wanted in the DPS calculator; a full engine *run* is.

User ruling (2026-08-28):

> "We don't have use for heal accounting in the DPS calc, that's true, but we still want to have a
> full engine run, so that attackers that depend on the currently dead channel show the full
> potential."

## Root cause

`engine.ts:2809` conflates two unrelated things in a single binding:

```ts
const healTarget = explicitHealTarget ?? (runMode === 'battle' ? attacker : undefined);
```

`healTarget` is simultaneously:

- **(a) the accounting anchor** for the healing report (`engine.ts:13050`), and
- **(b) the on/off switch for a whole runtime layer** — `healingCtx` is built from it
  (`engine.ts:3712`), and so are the two leech setup scans (`engine.ts:4187`, `:4222`).

A DPS run gets `undefined`, so the layer never exists. Supplying `healTargetId` under `mode: 'dps'`
**throws** (`engine.ts:2800`), so it cannot be opted into either.

`playerTurn.ts:4206` already predicted this fix verbatim — the spec was sitting in a comment.

### What is dead today

| # | Channel | Gate | Fails |
|---|---|---|---|
| 1 | Shield grants (cast + reactive) | `grantShieldToTarget` is a `healingCtx` member (`engine.ts:3929`) | closed |
| 2 | Heals (cast + reactive) | `engine.ts:4854`; reactive bails at `triggers.ts:4379` | closed |
| 3 | Repair-over-time ticks | `playerTurn.ts:4194`, fully gated on `args.healing` | closed |
| 4 | Standing leeches | setup scan `engine.ts:4187` wrapped in `if (healTarget)` | closed |
| 5 | Damage-taken leeches | setup scan `engine.ts:4222`, same shape | closed |
| 6 | `lowest-hp-ally` selector | `engine.ts:3975` returns `undefined` | closed |
| 7 | Self HP-threshold gates | `selfHpPctFor` → **100** (`engine.ts:3355`) | **open** |
| 8 | `hpSubject:'target'` gates | `healTargetHpPctNow()` → **100** (`engine.ts:3516`) | **open** |
| 9 | Cheat-Death ally narrowing | `engine.ts:2491` falls back to the caster | **open** |

Rows 1–6 fail **closed** (the effect is absent). Rows 7–9 fail **open** — they answer confidently
wrong: every "when this Unit is below X% HP" gate never fires and every "above X%" always fires,
because the focus is permanently reported at 100%. A dead channel can be found by looking for a
zero; a channel that answers 100 looks like data.

## Fix

Anchor in DPS too — reusing the precedent battle mode set in SP-U U5 — and give the report its own
flag:

```ts
const healTarget = explicitHealTarget ?? attacker;

const healPipelineActive = !!healTarget;                                // the RUNTIME
const healReportActive = !!explicitHealTarget || runMode === 'battle';  // the REPORT
```

`engine.ts:13050` then gates on `healReportActive` instead of `healPipelineActive`.

The two explicitness guards at `engine.ts:2800`/`:2805` stay **untouched**: a DPS caller still may
not *supply* a `healTargetId`. The anchor is derived, not passed.

### Rejected alternative — decouple the ctx from the anchor

Building `healingCtx` while leaving `healTarget` undefined revives only 3 of 9 channels, because the
leech setup scans (`engine.ts:4187`, `:4222`) live **outside** the ctx and would stay empty. It also
crashes: `grantShieldToTarget: (raw, victim = healTarget)` (`engine.ts:3929`) and
`applyIncomingToTarget: (damage, victim = healTarget!)` (`engine.ts:6790`) default their victim to
the anchor, so a default-param caller does `undefined.currentHp` — a TypeError, not a silent no-op.

The ctx-on / anchor-off split is also the write-key-vs-read-key shape that produced #390.

### Rejected alternative — a third mode axis

An explicit `hpApplicationActive` input threaded through `runCombat → runPlayerTurn → triggers` adds
a flag to every signature on the path and still needs the `healTarget` reads fixed separately. More
surface, no extra capability.

## Blast radius

The ~10 sites where `healTarget` flips truthy in a DPS run:

| Site | Effect in DPS | Verdict |
|---|---|---|
| `engine.ts:3712` `healingCtx` | built | the point |
| `engine.ts:4187` `standingLeeches` | scan populates | the point |
| `engine.ts:4222` `takenLeechesByOwner` | scan populates | the point |
| `engine.ts:3929` `grantShieldToTarget` | default victim = focus | the point |
| `engine.ts:6790` `applyIncomingToTarget` | default victim = focus | the point |
| `engine.ts:3355` `selfHpPctFor` | **real HP** instead of hardcoded 100 | fix |
| `engine.ts:3516` `healTargetHpPctNow` | **real HP** instead of 100 | fix |
| `engine.ts:9479` per-round accounting | allocates 3 maps + `targetHpPctStart` per round | overhead, unreported |
| `engine.ts:9518` `handleDeadTargetSkip` | gains a DPS path | inert unless a caller seeds the focus at `hp: 0` |
| `engine.ts:13050` result block | gated off by `healReportActive` | the fix's own guard |

Because #417 is **not** part of this spec (below), rows `3355`/`3516` end up strictly better than
they would under an immortal player side: self-HP gates read **real** HP, rather than a
permanently-correct-by-accident 100.

### Measured, not predicted (probe run on `main` at 741f7527)

| Measurement | Result |
|---|---|
| Self-shield kit in DPS, `perActorShield` | `null` every round — the red baseline |
| Same kit with the anchor fix | 200k granted/round, pool 200k → 400k → 600k |
| Full suite, anchor fix **alone** | **11 files / 124 tests fail** |
| Full suite, anchor fix + dead-target-skip gate | **1 file / 1 test fails** |

**The dead-target skip is a fourth required change, not a side effect.** `hp` defaults to **0** in
`simulateDPS` (`dpsSimulator.ts:532`) and in the page's own ship config (`DPSCalculatorPage.tsx:100`,
`:394`, `:418`). Once `healTarget` is set, `handleDeadTargetSkip` (`engine.ts:9518`) reads
`currentHp <= 0` as a corpse and skips the focus's whole turn: measured `directDamage=[0,0,0]` at
`hp: 0` versus `[7753,7753,7753]` at `hp: 1_000_000`. **The DPS calculator would report zero damage
for every ship whose HP field is left blank, which is the default.** This is the NEVER-ALIVE vs
KILLED conflation `normalizeRoster.ts:126` already documents; the guard must be gated on
`healReportActive` (the skip is a healing/battle concept) and the canonical death signal is
`destroyedRound`, not `currentHp <= 0`.

**One genuine behavioural delta remains** —
`dpsRealEnemyReactions.integration.test.ts`, "still reports the round the focus died in". Fixture:
focus `hp: 1`, team actor at speed 20000, enemy at `attack: 500000, speed: 9999`.

| | `directDamage` | `teamDamage` | `perTargetDealt` sources |
|---|---|---|---|
| `main` | 0 | 23258 | `team-1`, `enemy-1` |
| fix applied | 7753 | 31010 | `team-1`, `enemy-1`, **`attacker`** |

The doomed focus acts after the fix where it did not before. The enemy outspeeds it and kills it
first, so a destroyed actor must not act — `main` is the correct arm.

**Mechanism, corrected during implementation** (verified independently by the implementer and the
reviewer; the prediction above this line was wrong). The accidental pre-#415 coverage was NOT
`handleDeadTargetSkip`'s `currentHp <= 0` branch — that branch cannot fire for a DPS focus either
way, since it is `healReportActive`-gated. It was the **general dead-actor skip**
(`engine.ts:~10333-10343`), whose own comment calls its `healTarget` exemption
"belt-and-suspenders". Pre-#415 `healTarget` was `undefined` in DPS, so the exemption never matched
and the general skip correctly suppressed the dead focus's turn. Anchoring `healTarget` to the focus
turns the exemption ON, and the focus then slips through **both** guards. The fix is an
unconditional `destroyedRound !== undefined` branch placed FIRST in `handleDeadTargetSkip`, which
also needs `healTargetBuffs = []` so a default-heal-target focus dying before its turn does not skip
a side effect the old gated branch performed for that same actor.

### Healing has no observable in a DPS result

Verified: the DPS `RoundData` (`dpsSimulator.ts:278-317`) carries `perActorShield`,
`perActorReflected`, `perActorSplash`, `perActorDetonation` and `perActorIncoming` — and **no heal
field**. The per-recipient healing block that `lowestHpAllyRouting.test.ts` asserts against is
exactly what `healReportActive` omits. So reviving heals in DPS pays off **indirectly** — through HP
level feeding gates, and `repaired-this-round` feeding other procs — never as a reported number, and
every heal/HoT/routing test must observe the event bus (`simulateDPS` accepts one as a write-only
tap, `dpsSimulator.ts:116`) or actor `currentHp`.

## Non-goals

### #417 is re-triaged, not solved here

#417 asked for the player side to be "immortal but hittable". Investigation found the outcome it
wanted is **already the shipped default**: `DPSCalculatorPage.tsx:132` sets the enemy's `attack: 0`,
with the rationale written at the site —

> Attack defaults to 0 so a DPS comparison stays a clean measure of output: the attacker cannot be
> worn down or killed, and every config faces identical conditions.

`synthesizedDpsEnemy` agrees (`dpsSimulator.ts:492`, `attack: 0`), so the scalar-only path matches
the page. #417's measurement (`mate=92→84→76→68`, focus dies and truncates the run) was taken with
an enemy attacking for 8,000 — i.e. on the **opt-in** path, after a user deliberately raised attack
off the default.

So #417 only bites once a user opts in, and at that point they have explicitly asked for incoming
pressure. Whether an immortal focus is still correct there needs a fresh ruling. **Decision
(2026-08-28): spec #415 alone; leave #417 open with this finding recorded.**

Consequence for this spec: enemy damage stays fully real, no `currentHp` write is suppressed, and
the two live suppression sites that an immortality fix would have touched are left alone
(`engine.ts:6321` in `applyVictimDamage`, and `engine.ts:3801`, the Reversed Repairs burn which sits
outside the funnel by design per R5).

For the record, since it was miscounted during design: the *other* two candidate HP-write sites are
not live. `bombCountdown.ts:75` is the `else` branch for callers supplying no `forceDetonateBomb`,
and the engine always supplies one (`engine.ts:8843`, `:9802`), so real bomb bursts route back
through `applyVictimDamage`; `lethalHp.ts:63` is reached only at HP ≤ 0.

### Reaction kits stay opt-in

The 0-attack default is unchanged, and per the comment at `DPSCalculatorPage.tsx:132` a 0-attack
enemy emits **no `attacked` events at all** (a zero-damage hit is skipped, not emitted as a 0). So
on-attacked, counter, reflect and `damage-taken` leech contribute nothing at the default. Unlocking
the runtime does not change that; raising enemy attack is the opt-in.

### #418 rides on this, and is fixed separately

Once shields work in DPS, a saturated pool still emits no `shield-applied` — the heal path gates on
the **gross** amount while all three shield emit sites gate on the **post-cap delta**
(`playerTurn.ts:4853`/`:4893`, `triggers.ts:4632`). Resonating Fury therefore stays dead. #418 is
already a live bug in battle and healing modes; this change makes it reachable from DPS too.

### Other

- **No heal accounting in DPS results.** The buckets accumulate unreported. Accepted overhead, not a
  leak.
- **`on-ally-destroyed` stays unfirable** at the default. Its one shipped consumer is a Barrier grant
  (`buildEquipmentAbilities.ts:1068`) — defensive, irrelevant to DPS.
- **No `DocumentationPage.tsx` change.** It explicitly calls out DPS inertness for Buff Steal
  (`:2632`) and Enemy Adjacency (`:2662`), but its Shields (`:2637`) and shield-source (`:3928`)
  sections describe those as modeled with no DPS caveat. There is no false claim to correct — the
  fix makes the existing text true.

## A comment whose premise this change invalidates

`playerTurn.ts:4194-4211` gates the repair-over-time tick on `args.healing` and records **#371 as
answered "not a defect"** — on an explicitly stated premise:

> DPS mode does not track the holder's live HP anywhere: `healTarget` is `explicitHealTarget ??
> (runMode === 'battle' ? attacker : undefined)`, so a DPS run has none [...] So there is no live
> self-HP gate to mis-fire, no HP bar to under-report, and no focus-side death or termination to
> reach early. A tick would change no output DPS mode produces.

and it names its own expiry condition:

> What WOULD make this a real gap: giving DPS mode a live self-HP read of any kind — an hp-threshold
> gate evaluated against current HP, `lowest-hp-ally` selection, or focus-side termination. If you
> add one of those, revisit this gate first; the fix then has the same shape as #369's — separate
> what the gate genuinely protects (the player healing buckets and the report, which DPS mode has no
> use for) from the HP application, which is side- and mode-independent.

`src/types/abilities.ts:520-523` carries the same expired claim about `hpSubject`:

> `'target'` = the heal target's live HP%, threaded in healing mode only; defaults to 100 elsewhere
> (DPS-mode inert — the condition never fires without a live target HP).

This change adds **all three** of those reads, and makes `hpSubject: 'target'` live in DPS. The second half of the comment is the fix and should
be kept as rationale; the first half is now false and must be rewritten rather than left standing —
otherwise #371 stays closed on a premise that no longer holds. This is the stale-premise class: the
argument that justified a decision expires before the code does.

## Test plan

Every test must be **red on `main` first**, and each states its own red evidence. Memory records
`perActorShield` as null in DPS across every axis (passive/active slot × start-of-turn/-round/on-cast
× hp/attack basis), which is a known-good red baseline — but a test that is green from the start here
proves nothing and must be treated as a broken instrument, not a pass.

Build kits with `buildShipAbilities`, never hand-written ability literals: a `buff` with no
`parsedEffects` throws in `dpsBuffHelpers`, and literals bypass the parser's invariants.

### One test per revived path

Mutating the feature once would leave a second path unproven, so each channel gets its own probe.

| # | Path | Observable | Notes |
|---|---|---|---|
| a | shield grant | `RoundData.perActorShield[id].granted > 0` | red on main: null |
| b | standing leech (`basis: 'damage-dealt'`) | credited shield/heal | red: `standingLeeches` scan empty |
| c | damage-taken leech | credited | needs enemy `attack > 0` in the fixture |
| d | repair-over-time tick | tick applied | red: block never entered |
| e | `lowest-hp-ally` routing | recipient is the right actor | needs an HP differential — seed it or raise enemy attack |
| f | self-HP gate, **both directions** | "below 40%" fires / "above 50%" stops | red: both answer off a hardcoded 100 |

Row f is deliberately two-directional. A gate that reads 100 forever passes any test that checks
only the "above" branch — pinning the MET direction alone is the trap #394 already caught once.

### The fix's own guard gets its own test

`healReportActive` is the least-tested line in the change, and if it regresses the DPS calculator
silently starts emitting a healing report. Three assertions:

- `mode: 'dps'` → result has **no** `healing` key
- `mode: 'battle'` → `healing` present (unchanged)
- `mode: 'healing'` → `healing` present (unchanged)

### One DPS-vs-battle differential

For a single shield kit, with the harness trap written into the test body: **`simulateBattle` builds
its own event bus and IGNORES an injected one**, so the battle arm must read `result.combatLog`; only
the DPS arm may use a `bus` tap (`simulateDPS` accepts one as a write-only tap). A differential that
taps an injected bus on the battle side reports `(NONE)` for everything and reads as agreement.

### RNG

`setupKeyedTestRng(seed)` **alone** — never followed by `resetRateGateRng()`, which un-seeds it. No
cross-side amount comparisons: RNG is keyed by `ownerId`.

## Golden audit

Run the **whole** `npm test`, not a subset — the golden audit spans the full suite. Every moved
golden gets an individual explanation. Never `vitest -u`.

**Measured:** with the anchor fix plus the dead-target-skip gate, **no golden moved** — the only
failure was the behavioural delta above. The earlier draft of this spec predicted
`dpsGoldenParity.test.ts` would move for any fixture carrying a shield, leech or HoT passive; it did
not, which by the rule below is itself a finding about the corpus rather than a clean result.

**If zero goldens move, that is a finding, not a win.** It would mean no DPS golden fixture has such
a passive — i.e. the corpus is blind to this whole feature. Report it as coverage and add a fixture
rather than reading it as "no regressions".

`tsc --noEmit` is required separately: the `healTarget!` non-null assertions at `engine.ts:4775` and
`:6790` change narrowing, and vitest will not see that.

## Files

- `src/utils/combat/engine.ts` — the anchor, the two flags, the result gate
- `src/utils/combat/playerTurn.ts` — rewrite the now-false half of the `4194-4211` comment (see
  *A comment whose premise this change invalidates*); no behaviour change in this file
- new tests under `src/utils/calculators/__tests__/`
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry; DPS numbers change for kits with
  shield/leech/HoT passives, which is user-visible
