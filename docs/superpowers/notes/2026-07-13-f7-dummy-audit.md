# F7 audit: dummy `enemy` sink — DPS-mode load-bearing vs positional-vestigial

**Task:** SP-F PR1 Task 1 (audit-only, no code changes).
**Scope:** `src/utils/combat/engine.ts`, `src/utils/calculators/battleSimulator.ts`.
**Branch:** `epic/sp-f-accounting-fidelity`. Line numbers verified against the files as of this
audit (2026-07-13) — the brief's hinted line numbers were close but not exact; corrected below.

---

## 0. The three production callers of `runCombat`

Before classifying references, note there are **three** real callers, not two — the brief's
"DPS-calc mode" vs "sim/healing (positional) mode" split maps as follows:

| Caller | `positionalTeamBattle` | `enemyAttackers` | `enemyHp`/`enemyDefense` | `dpsEnemyTarget` | Consumes `rawTotals`/`enemyOutcome`? |
|---|---|---|---|---|---|
| `src/utils/calculators/dpsSimulator.ts` (:307-316) | not set | not set | **real, user-configured** | `true` | **Yes** — destructures `{ rounds, rawTotals, enemyOutcome }` |
| `src/utils/calculators/healingEngineAdapter.ts` (:217-250) | not set | set (`engineEnemyAttackers`) | placeholder consts `ENEMY_DEFENSE=10000` / `ENEMY_HP=1_000_000` (:177-178) | `false` | No — destructures only `{ rounds: engineRounds, healing }` |
| `src/utils/calculators/battleSimulator.ts` (:850-907) | `true` | set (`enemyAttackers`) | placeholder `enemyDefense: 0` / `enemyHp: 1_000_000_000` (:860-861) | `false` | No — destructures only `{ rounds: engineRounds }`, and only ever reads `rd.perTargetDamage` / `rd.perActorShield` / `rd.perActorIncoming` off each round (:912-935) |

So "sim/healing (positional) mode" in the brief covers **two** callers (`battleSimulator.ts` and
`healingEngineAdapter.ts`), both of which pass placeholder `enemyHp`/`enemyDefense` and never read
the dummy-derived outputs. `dpsSimulator.ts` is the one and only load-bearing consumer.
`positionalTeamBattle: true` is unique to `battleSimulator.ts`; `healingEngineAdapter.ts` reaches
`dpsEnemyTarget === false` purely via `enemyAttackers.length > 0`. Task 2's target is explicitly
`battleSimulator.ts`'s call (per the brief), but the same vestigial-dummy argument applies
verbatim to `healingEngineAdapter.ts` — worth flagging for a follow-up, not required for PR1.

---

## 1. Raw grep output

### `engine.ts` — `legacyVictim|1_000_000_000|enemyHp|cumulativeDamage|focus-dummy|dummy sink|dummy enemy`

```
337:            enemyHpPct: 100,
843:    enemyHp: number;
863:    const corrosionBaseHp = Math.min(args.enemyHp, 500_000);
989:    enemyHp: number;
1018:    /** DPS dummy enemy's base security (A2 Task 2). Optional — base for effectiveStatsOf.security on the
1019:     *  dummy enemy actor. The adapter passes `input.enemySecurity ?? 100` (the OLD landing-formula default);
1398:        enemyHp,
1502:            hp: enemyHp,
1927:    let cumulativeDamage = 0;
1929:    // cumulativeDamage + cumulativeTeamDamage; the row/summary cumulativeDamage stays focus-only.
2027:    // NOT the dummy enemy.id (the victim stand-in). Equals enemyAttackerActorIds but computable
2053:    // [team…, attacker, dummy enemy, enemy attackers…], identical to the array
2065:    // dummy enemy and every enemy attacker, so a reactive granter on EITHER side
2073:    // (it stays in allActors/allActorsById as the `legacyVictim` fallback object — only the turn
2077:    // fall back to the dummy sink, keep it in the turn order so its accumulated DoTs still tick.
2452:    // corrosion/inferno display + raw totals at post-round assembly WITHOUT feeding cumulativeDamage
2590:    //    terminates the round the DPS enemy dies. In sim/healing mode the vestigial dummy sink
3321:        // Player runtimes face the dummy enemy, so an `enemy-type` gate resolves against
4615:        //  - enemyHpPct: rebuilt from the snapshot's pre-turn currentHp/stats.hp reading (the
4629:            enemyHpPct: number;
4640:                        enemyHpPct:
4666:                enemyHpPct: snap.enemyHpPct,
4934:            legacyVictim: CombatActor | undefined;
4955:            legacyVictim: enemy,
4969:            legacyVictim: healTarget,
4998:        // actor's per-round detonation tally + roundPerTargetDamage; NOT into cumulativeDamage
5095:        // cumulativeDamage → the focus-dummy HP overwrite → double-hit (HP already drained inside
5139:            // focus-dummy path). CORRECT for the enemy site; for the player side it is an INERT
5184:            return { tgt: selected ?? tb.legacyVictim };
5250:                enemyHp: tb.victimMaxHpFor(tgt),
5501:            // cumulativeDamage (HP lands per-victim via applyVictimDamage). `sink` serves both
5552:        // enemyHpPct and a zeroed/last-known ctx, just enough for row assembly.
5565:                // PR6b: read the dummy sink's live currentHp instead of the scalar (identical
5566:                // value — the sink update at ~3771 keeps enemy.currentHp == enemyHp - cumulative).
5576:            const enemyHpDecline = Math.max(0, enemyHp - enemy.currentHp);
5577:            const enemyHpPct =
5578:                enemyHp > 0 ? Math.max(0, 100 * (1 - enemyHpDecline / enemyHp)) : 100;
5584:                enemyHpPct,
5743:                        enemyHp,
5745:                        // accumulators below are folded into cumulativeDamage only at
5754:                        cumulativeDamage:
5755:                            cumulativeDamage +
6093:                //  - the `enemy` actor (DPS opponent / sim-mode dummy sink). This exemption is
6102:                //    the vestigial dummy sink never dies at all, so `destroyedRound` is never set
6198:                // (mirroring the dummy enemy's DoT-tick timing — DoTs tick at the afflicted ship's
6216:                // creditDamage (no cumulativeDamage double-feed against the dummy HP overwrite).
6245:                            enemyHp: recipientMaxHp(healTarget.id),
6324:                                enemyHp: recipientMaxHp(actor.id),
6443:                            // Positional target (phase 2): the selected enemy actor, else the dummy sink.
6527:                            // in positional/simulator mode there is NO dummy enemy sink to fall back to.
6594:                            // folded into cumulativeDamage here (that would double-count it). Skip the
6606:                                // cumulativeDamage (it lands per-victim via applyVictimDamage above).
6700:                            // vars (enemyDefense/enemyHp/corrosionEntries/…) → byte-identical.
6816:                                // cumulativeDamage (it lands per-victim via applyVictimDamage above).
6874:                        enemyHp,
6887:                        // PR I4b: the dummy sink `enemy` is the ticking victim.
6958:                        // The focus-dummy `:4794` path bursts ONLY the dummy's own timed
6966:                        // that feeds `cumulativeDamage`→the focus-dummy HP overwrite (`:5432`),
7671:        const enemyHpPct = lastAttackerTurn.enemyHpPct;
7718:        cumulativeDamage += totalRoundDamage;
7728:        // is 0 non-positionally → byte-identical). NOTE: cumulativeDamage/totalRoundDamage above
7730:        // so folding it into cumulativeDamage would double-count the enemy-HP decline.
7776:            const enemyHpDecline = cumulativeDamage + cumulativeTeamDamage;
7777:            enemy.currentHp = Math.max(0, enemyHp - enemyHpDecline);
7779:                enemyHp > 0 ? Math.round(Math.max(0, 100 * (1 - enemyHpDecline / enemyHp))) : 100;
7810:            enemyHpPct: Math.round(enemyHpPct),
7816:            cumulativeDamage: Math.round(cumulativeDamage),
8013:            : enemyHp > 0
8014:              ? Math.max(0, (100 * enemy.currentHp) / enemyHp)
8023:            cumulative: cumulativeDamage,
```

No literal `1_000_000_000` hit inside `engine.ts` — that constant only appears in
`battleSimulator.ts`; `engine.ts` just receives whatever `enemyHp` number the caller passes.
No literal `focus-dummy`/`dummy sink`/`dummy enemy` string exists either — those only occur inside
comments (captured above via the alternation on `dummy`-prefixed words already present, cross-
checked with a plain `grep -n "dummy"` sweep, ~40 comment hits, all covered by the same
classification as their nearest code line below).

### `battleSimulator.ts` — `1_000_000_000|enemyHp|enemyDefense|dummy`

```
21: * `ability-performed` — actorId=attacker, targetId, amount; dummy-'enemy' target lines are
22: * kept), heals, buffs, debuffs, dots, deaths. (The dummy-'enemy' targetId on ally/self-
23: * targeting ships means some damage lines read as "X → enemy"; that's accepted — the
24: * per-victim unification is a deferred follow-up.)
138:     * `turn-started`). Only roster actorIds — the dummy player-offense `'enemy'` id is
300:    // Roster id set: turn-started for a non-roster id (the dummy player-offense 'enemy')
753:    // Representative enemy security (threaded onto the dummy target for live landing recompute).
858:        // The dummy player-offense enemy target (vestigial alongside the positioned roster):
860:        enemyDefense: 0,
861:        enemyHp: 1_000_000_000,
877:        // the focus actor and the vestigial dummy enemy. The dummy carries the representative
```

---

## 2. Classification

### DPS-mode load-bearing (MUST preserve — do not touch these code paths in `engine.ts`)

These are only meaningful/reachable when `dpsEnemyTarget === true`, i.e. `enemyAttackers.length === 0`
(only true today for `dpsSimulator.ts`):

- `engine.ts:843,863` — `tickDoTs`'s generic `enemyHp` **parameter name** (corrosion base-HP cap).
  **Not the dummy actor** — this helper is reused for any DoT-carrying victim's max HP (see the
  `:6245`/`:6324`/`:6874` call sites below, which pass a real victim's HP under the same parameter
  name). Purely a naming coincidence; flagged so Task 2 doesn't grep-and-replace it by mistake.
- `engine.ts:989` (`CombatEngineInput.enemyDefense`/`enemyHp` field decls) — required fields read
  by `dpsSimulator.ts` as the user's configured enemy stats. Load-bearing for DPS mode; Task 2 will
  likely need to make them **optional** (see §5) rather than delete them.
- `engine.ts:1398,1486-1507` — dummy `enemy` actor construction (`createActor({id:'enemy', ...})`).
  Always constructed regardless of mode (see §2 "always constructed" note below) — this is where
  `enemyDefense`/`enemyHp` land as `stats.defence`/`stats.hp`.
- `engine.ts:2008` (`dpsEnemyTarget = enemyAttackerInputs.length === 0`) — the mode switch itself.
- `engine.ts:7745-7770` (`if (dpsEnemyTarget) { ... applyVictimDamage(roundEnemyDamage, enemy, sink, ...) }`)
  — the SP-U-added real per-victim HP drain for the DPS dummy. Load-bearing.
- `engine.ts:7671,7810,7816,8023,8010-8032` — `enemyHpPct`, `cumulativeDamage` (round field +
  `rawTotals.cumulative`), `enemyOutcome` (`survived`/`roundsToKill`/`finalHpPct`) returned from
  `runCombat`. `dpsSimulator.ts:307` destructures `rawTotals` + `enemyOutcome` directly — confirmed
  load-bearing consumer.
- `engine.ts:5552-5578` (`pushSynthesizedFocusSkipTurn`'s `enemyHpDecline`/`enemyHpPct` calc) — feeds
  the row's `enemyHpPct` field, which is DPS-mode-visible (round table). Also fires in
  healing-mode when the focus IS the dead heal target — but since the field itself is only READ by
  `dpsSimulator.ts`, this stays classified load-bearing/inert-elsewhere rather than vestigial.
- `engine.ts:6093-6107` (`isDummyEnemy` turn-skip exemption) — the comment says this exemption is
  "effectively DORMANT today" and only matters if the terminal `dpsEnemyTarget` break were ever
  removed; keep as-is, out of scope for Task 2.

### Positional vestigial (Task 2 removes / makes inert for `battleSimulator.ts`'s call)

Reachable only when `dpsEnemyTarget === false` (`enemyAttackers.length > 0` — both
`battleSimulator.ts` and `healingEngineAdapter.ts`), and proven below (§3) to never affect the real
per-victim result:

- `engine.ts:7771-7790` (the `else` branch: `enemyHpDecline = cumulativeDamage + cumulativeTeamDamage;
  enemy.currentHp = Math.max(0, enemyHp - enemyHpDecline); ...hp-changed emit...`) — the "vestigial
  sink" scalar-decline branch itself. Its output (`enemy.currentHp`, the `hp-changed` event for
  `targetId: enemy.id`) is never read by `battleSimulator.ts` (confirmed: only `rd.perTargetDamage`/
  `perActorShield`/`perActorIncoming` are read off each round, §0 table).
- `engine.ts:1927-1930` (`cumulativeDamage`/`cumulativeTeamDamage` let-bindings) — vestigial as
  **inputs to the dummy decline above**, though the variables also legitimately feed
  `rawTotals`/`RoundData.cumulativeDamage` for DPS mode. Cannot be deleted outright (DPS mode needs
  them); only the write-to-`enemy.currentHp` step (`:7776-7777`) is prunable per-caller.
- `engine.ts:7718` (`cumulativeDamage += totalRoundDamage`) and `:6602-6607`/`:6812-6817`
  (`creditDamage(actor.id,'direct'/'detonation', ...)` in the `!positional`/`!teamPositional`
  branches) — see §3 nuance: this credit is **already suppressed** whenever the true per-victim
  apply path (`positional`/`teamPositional` gate) fires, which it does for every damage-dealing cast
  that has both a parsed `target` and `pattern` (true for every ship listed in
  `docs/ship-targeting.csv`/`ship_templates.active_target`+`active_pattern`). It is NOT suppressed,
  and DOES feed the vestigial `cumulativeDamage`, for a ship with **no targeting data at all**
  (`target === undefined`) — see §3's third fallback case. This is the one place Task 2 must be
  careful about; do not assume `cumulativeDamage` is always zero in positional mode.
- `engine.ts:2069-2089` (`dummyEnemyIsVestigial` calc + `turnOrderActors` gate) — this ALREADY
  exists and already drops the dummy's own turn from the turn order whenever every player actor is
  positioned with an enemy-side target. This is the precedent/pattern Task 2 should follow, not new
  code to remove — it's evidence the engine already treats the dummy as removable-per-static-check
  in positional mode. Leave as-is (it's a turn-order optimization, orthogonal to the `enemyHp`/
  `enemyDefense` input plumbing Task 2 is about).
- `battleSimulator.ts:858-861,877-884` — the literal `enemyDefense: 0, enemyHp: 1_000_000_000`
  fields passed into the positional `runCombat` call. **This is Task 2's primary edit target.**

### Fallback binding (the crux — traced in full in §3)

- `engine.ts:4934,4953-4966` — `TurnBindings.legacyVictim`; `playerTurnBindings.legacyVictim = enemy`
  (line **4955**, not 4955 vs the brief's estimate — confirmed exact).
- `engine.ts:5168-5185` — `selectTurnTarget`, fallback `return { tgt: selected ?? tb.legacyVictim }`
  at line **5184** (brief's hint was exact).
- `engine.ts:6451,6455,6483` (focus site) and `:6701,6705,6722` (walked-team site) — the two
  production call sites of `selectTurnTarget` on the player side, each followed by
  `if (tgt === undefined) continue;` (a no-op today — see comment: "player side's legacy victim is
  the always-present dummy sink → tgt is never undefined here") and `buildTurnArgs(actor, tgt)`.
- `engine.ts:4967-4991` — `enemyTurnBindings.legacyVictim = healTarget` (line 4969). **Different
  binding, different actor** (the heal target, a real player ship — not the dummy `enemy`). Out of
  scope for this audit (already handled by the SP-U U5 R6 "no vestigial healTargetId" decouple); not
  re-classified here.

---

## 3. The crux: does a positional player turn ever actually read the dummy `enemy` as a victim?

Traced `selectTurnTarget` (`engine.ts:5168-5185`) → `resolvePositionalTarget`
(`src/utils/combat/positionalBinding.ts:46-122`) → the two production apply sites
(`drivePositionalTurnApply` `engine.ts:5406-5508` → `drivePositionalApply` `engine.ts:4690-…` →
`applyPositionalDamage`). Three distinct paths reach `tb.legacyVictim` (the dummy):

**(a) Ally-side parsed target (self-heal/self-buff active skills).**
`resolvePositionalTarget` returns `null` immediately for `target.side === 'ally'`
(`positionalBinding.ts:64-66`), so `selectTurnTarget` falls back to the dummy. Confirmed
**verified non-gap**: per `docs/superpowers/notes` memory
(`project_sim_dead_target_skip.md`, 2026-07-09), the set of ships that both self/ally-target AND
deal damage that "needs a victim" is empty corpus-wide — an ally-target skill's `turn.directDamage`
is 0, so the `!positional` credit branch is a no-op even though it technically runs. This matches
`battleSimulator.ts:21-24`'s own docstring: dummy-`'enemy'` targetId lines on ally/self-targeting
ships are accepted display noise, not a damage-accounting bug.

**(b) All real `enemyAttackers` already dead, mid-battle, before `numRounds` elapses.**
Positional mode has NO "team wipe" early-exit (only `dpsEnemyTarget && enemy.destroyedRound` breaks
the loop, `:7996`) — so a player can still take turns after every enemy attacker's `currentHp <= 0`.
`resolvePositionalTarget`'s `byCell.size === 0` guard (`positionalBinding.ts:59-61`) returns `null`
in this case too → dummy fallback for `tgt`. **Traced and confirmed harmless**: the real apply gate
(`positional`/`teamPositional`, `engine.ts:6536-6540`/`:6753-6757`) depends on `target`/`pattern`
(the ability's *static* parsed target, independent of `tgt`/liveness) plus `turn.positionalScalars`
— not on `tgt` or on any pre-checked liveness. So whenever a ship has real targeting+pattern data
and its ability deals damage, the code enters the true per-victim path
(`drivePositionalTurnApply` → `drivePositionalApply` → `applyPositionalDamage`), which resolves its
own victims from `tb.opposingRoster` (the REAL `enemyAttackerActors`/`allPlayerActors` array — the
dummy is never a member of this array) independently of `tgt`. When that independent resolution
finds no living opposing actor, the documented behavior (`engine.ts:6526-6535`, "DELIBERATELY no
`selectedEnemy != null` precondition... the correct behaviour is for the attacker to WHIFF") is a
0-damage whiff — not a route to the dummy. `cumulativeDamage` crediting is explicitly suppressed
(`if (!positional) { ...creditDamage... }`, `:6599`/`:6809`) whenever this gate fires. Net: **no
damage lands anywhere** in this window; `tgt` (dummy) is read only for `buildTurnArgs`'s stat
lookups (defence/hp of the dummy, discarded once the whiff happens) and for the
Stasis-break/covered-victim bookkeeping (`victim.id !== sel.tgt.id`), which is vacuously true for
every one of the zero victims and therefore inert.

**(c) A ship with NO targeting data at all (`target === undefined`, not merely `'ally'`-side).**
`ShipsContext.tsx:260` sets `activeTarget: data.ship_templates.active_target ?? undefined` — a ship
whose `ship_templates` row hasn't been backfilled with targeting metadata yet gets `activeTarget:
undefined`, and `parseShipTargeting` (`targetingParser.ts:225`) only populates `result.active` when
BOTH `activeTarget` and `activePattern` are truthy, else leaves it `undefined`. For such a ship in
`battleSimulator.ts`, `plan.targeting?.target`/`pattern` are both `undefined`. **This is the one
case where the fallback is NOT provably inert**: `selectTurnTarget` returns the dummy as `tgt`
(same as (a)/(b)), but this time the apply gate (`target != null && pattern != null && ...`) is
FALSE purely because `target`/`pattern` are undefined — regardless of whether the ability deals real
damage — so the code takes the `!positional` branch and calls `creditDamage(actor.id, 'direct',
turn.directDamage)` with a REAL nonzero `turn.directDamage` (computed against the dummy's stats:
0 defence, huge HP). This genuinely feeds `cumulativeDamage`/`cumulativeTeamDamage`, and that damage
is **lost** from the real per-victim result — it never reaches any `enemyAttackerActors` member, so
it never appears in `rd.perTargetDamage` (the only field `battleSimulator.ts` reads). This is a
**pre-existing data-completeness gap**, not something Task 2 introduces or need fix — it is the
SAME mechanism a non-positional legacy fixture would use — but Task 2's edit must not assume
`cumulativeDamage` is provably always 0 in positional mode; it should instead confirm the *engine's*
own output for this scalar is simply never consumed by `battleSimulator.ts` (which is true — see §0
table — independent of whether the scalar itself is ever nonzero).

---

## 4. THE ANSWER

In positional mode, the dummy `enemy` object is **read as `tgt`** in three cases — an ally/self-
targeting skill, a transient window where every real enemy attacker is already dead, and a ship
with no targeting data configured at all — but in the first two cases that reference is provably
inert (no damage lands on it, verified by tracing the independent live re-resolution inside
`drivePositionalApply` and the `!positional`-gated credit suppression), and only the third
(targeting-data-incomplete ships) can route real, but currently-already-lost, damage into the
vestigial `cumulativeDamage`/`enemy.currentHp` scalar. **Removing `enemyHp`/`enemyDefense` from
`battleSimulator.ts`'s positional `runCombat` call (`:858-861`) is safe**, because: (1) the engine's
own return value for every scalar those two inputs feed — `rawTotals.cumulative`, `enemyOutcome`,
`rd.cumulativeDamage`, `rd.enemyHpPct` — is never read by `battleSimulator.ts` (confirmed: it only
destructures `rounds` and only reads `rd.perTargetDamage`/`perActorShield`/`perActorIncoming` off
each round); (2) the real per-victim accounting for every ship WITH targeting data flows entirely
through `applyOutgoingToEnemy`/`applyVictimDamage` against the REAL `enemyAttackerActors` roster,
never the dummy; and (3) the one residual case where a targeting-data-incomplete ship's damage
currently reaches the dummy is *already* silently discarded today (never surfacing in
`perTargetDamage`) — so removing the dummy's real `enemyHp`/`enemyDefense` values does not change
that ship's *observable* outcome in `battleSimulator.ts`, it only changes what (unread) number the
dummy's HP happens to decline to internally. The engine still needs to *construct* the `enemy` actor
unconditionally (it's referenced structurally — `allActors`, `TurnBindings.legacyVictim`,
`isDummyEnemy` turn-skip, `resolvePositionalTarget`'s always-safe null-target return) — Task 2's
scope is making `enemyHp`/`enemyDefense` **optional** on `CombatEngineInput` with an internal
default for the positional/no-DPS-target case, not deleting the actor construction itself.

---

## 5. Recommendation for Task 2 — minimal edit set

**Change:**
1. `engine.ts:988-989` — make `enemyDefense`/`enemyHp` **optional** on `CombatEngineInput`
   (`enemyDefense?: number; enemyHp?: number;`), defaulting internally (e.g. `enemyDefense ?? 0`,
   `enemyHp ?? 1_000_000_000` right where they're destructured, `:1397-1398`) so the dummy actor
   construction (`:1486-1507`) and every DPS-mode-only read of `enemyHp`/`enemyDefense` keep working
   byte-identically for `dpsSimulator.ts` without a required-field change there.
2. `battleSimulator.ts:858-861` — delete the `enemyDefense: 0, enemyHp: 1_000_000_000,` lines (and
   trim the two comments at `:858-859`/`:877-884` referencing them) now that they're optional.
3. Leave `healingEngineAdapter.ts:225-226` (`ENEMY_DEFENSE`/`ENEMY_HP` consts) untouched for PR1 —
   same vestigial argument applies, but it's a separate caller outside this PR's stated scope
   (flagged as a candidate follow-up, not required).

**Do NOT touch (preserve byte-identical for `dpsSimulator.ts`):**
- The dummy actor construction block (`:1486-1507`).
- `dpsEnemyTarget` (`:2008`) and both its branches (`:7745-7790`).
- `cumulativeDamage`/`cumulativeTeamDamage` accumulation logic itself (`:1927-1930`, `:7718`,
  `:6599-6607`, `:6809-6817`) — these still legitimately feed DPS-mode `rawTotals`/`RoundData`.
  Only the CALLER's input values change; the accumulation code is unconditional and mode-agnostic.
- `TurnBindings.legacyVictim`/`selectTurnTarget`'s fallback (`:4934`, `:4955`, `:5184`) — still
  structurally required (§4's "engine still needs to construct `enemy`" point); not a Task-2 target.
- `dummyEnemyIsVestigial`/`turnOrderActors` gate (`:2069-2089`) — pre-existing, orthogonal.

**Tests to check/update (dummy-behavior assertions):**
Ran three greps to separate REQUIRED-field boilerplate from genuine dummy-behavior assertions:

1. `grep -rl "enemyDefense\s*:\s*0\|enemyHp\s*:\s*1_000_000_000\|1_000_000_000" src/utils/combat/__tests__ src/utils/calculators/__tests__` → ~140 files. This is almost entirely boilerplate: `enemyHp`/`enemyDefense` are currently REQUIRED on `CombatEngineInput`, so every test that calls `runCombat` directly (including `twoTeamBattle.test.ts`'s positional fixtures, `:187`/`:244-245`/`:278-279`) must supply *some* value, and `1_000_000_000` is the shared convention. This is NOT evidence of a dummy-behavior assertion by itself.
2. Narrowed to `grep -rl "\.cumulativeDamage\b|\.enemyHpPct\b|rawTotals\b|enemyOutcome\b"` → 11 files actually read these fields off a result: `enemyReactiveSelfBuffs.test.ts`, `enemyTeamRouting.test.ts`, `equipmentAbilities.integration.test.ts`, `indestructibleDeath.test.ts`, `leech.test.ts`, `perVictimDotTick.integration.test.ts`, `perVictimEnemyDetonation.integration.test.ts`, `teamWalk.test.ts`, `turnArgsUnification.test.ts`, `dpsSimulator.test.ts`, `judgeStartOfRoundDamage.integration.test.ts`.
3. Inspected the ones that also pass `enemyAttackers`/`positionalTeamBattle` (i.e. exercise the vestigial branch): `enemyTeamRouting.test.ts:275` and `turnArgsUnification.test.ts:149` fold `cumulativeDamage` into an object used for an EQUALITY comparison between two runs (leak-detector pattern), not an absolute-value check — unaffected by what default `enemyHp` resolves to, as long as both runs in the comparison use the same one. `perVictimDotTick.integration.test.ts:586` (`expect(result.rounds[0].cumulativeDamage).toBeGreaterThanOrEqual(500)`, comment: "fed the dummy aggregate — legacy behaviour") is the one **real** dummy-behavior assertion in the positional-adjacent test surface — but it calls `runCombat` **directly** with its own explicit `enemyHp`, so it is unaffected by Task 2's recommended edit (which only removes the two literal fields from `battleSimulator.ts`'s call and makes them optional with an internal default — every test that still supplies its own value, which is 100% of today's direct-`runCombat` tests, is untouched).

**Conclusion for Task 2:** because `enemyHp`/`enemyDefense` are TODAY required, no existing test exercises the "field absent, engine falls back to an internal default" code path Task 2 introduces — that path is net-new, currently only reachable via `battleSimulator.ts`. The three `battleSimulatorSquadLeaders.test.ts` / `battleSimulatorPreFightModifiers.test.ts` / `battleSimulatorDefenseSubstitution.test.ts` files call `simulateBattle()` (never `runCombat` directly, never set `enemyHp` themselves) and will be the tests that exercise the new default path once Task 2 lands — worth running the full suite (not just these three) after the edit to confirm nothing downstream keys off the dummy's exact declining-HP number in a way this audit missed. Re-run all three greps above against the live tree before editing — do not trust this snapshot if tests have landed since 2026-07-13.
