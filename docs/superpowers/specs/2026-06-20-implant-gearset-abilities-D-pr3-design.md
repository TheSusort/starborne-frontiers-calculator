# D-PR3 — Conditional incoming-damage reduction (victim side)

**Sub-project D, PR3.** Date: 2026-06-20. Branch: `feat/combat-d-pr3-incoming-reduction`,
stacked on D-PR2 tip `21c6fc33` (rebase to main when the D stack merges).

## 1. Context & framing

Sub-project D adds combat abilities sourced from **implants and gear sets** (data lives as
`description` strings on `IMPLANTS` variants in `src/constants/implants.ts` and special-effect
`GEAR_SETS` in `src/constants/gearSets.ts`; stat-only portions are already in combat stats).

The D stack so far:

- **D-PR1** built the *source* pipeline: `buildEquipmentAbilities(ship, getGearPiece)` →
  `buildShipAbilitiesWithEquipment` merges equipment abilities into the **passive** slot;
  `simulateBattle` threads `getGearPiece` to **both** teams' `planPlacement`. Consumed nothing new
  on the engine side beyond riding existing reactive heal/leech machinery (Leech set, Bloodthirst).
- **D-PR2** consumed the **attacker-side outgoing** channel: three implants modeled as passive
  `modifier`/`outgoingDamage` abilities, folded by `modifierTotalsFromAbilities`
  (`applyAbilities.ts`) at the firing actor's turn and applied multiplicatively in `nonCritFactor`.

**D-PR3 consumes the victim side**: conditional reductions to *incoming* damage. There is **no new
page wiring** — incoming reduction is defensive (it does not change DPS-calculator output), and the
simulator already routes equipment abilities onto both teams via D-PR1. The work is entirely in the
ability model, the source emitters (registry + one parser rule), and the engine's victim-side apply
sites.

## 2. Effects in scope

Three distinct engine mechanisms. (Per-rarity values from `implants.ts`/`gearSets.ts`.)

### M1 — Conditional incoming %-reduction (additive into the victim's incoming channel)

| Effect | Source | Condition | Reduction (by rarity / set) |
|---|---|---|---|
| **Voidshade** | implant `VOIDSHADE` (ultimate) | self-**Stealth** active, on direct damage | 4 / 8 / 12 / 16 / 20% |
| **Nebula Nullifier** | implant `NEBULA_NULLIFIER` (ultimate) | self in **Stasis** *(or Disable)*, on direct damage | 7 / 14 / 21 / 28 / 35% |
| **Hyperion Gaze** | implant `HYPERION_GAZE` (ultimate) | **critically hit by a stealthed attacker** | 7 / 14 / 21 / 28 / 35% |
| **Hardened** | gear set `HARDENED` (2-pc) | **critically hit** | 5% |
| **Iridium** | ship skill (3rd passive, parser) | **critically hit** | 35% |

Notes:

- **Disable is not modeled** in the engine (grep finds no Disable control; Stasis is modeled by
  sub-project B). Nebula's "or Disable" half is therefore dormant — the condition fires on Stasis
  only, and lights up automatically if/when Disable is added. Documented, not blocked.
- **Hardened's `damageReduction: 5%` stat is inert in combat** — the combat engine consumes only
  defense-derived `calculateDamageReduction`, never the `damageReduction` stat (verified: the only
  references are `calculateDamageReduction(effectiveDefense)` in `playerTurn.ts`/`victimDamage.ts`).
  So modeling Hardened's crit-only special effect is purely additive — **no double-count**.
- **Iridium** ("This Unit takes 35% less damage from Critical hits, and this effect does not stack
  with similar effects") is currently unmodeled. It is the **only** ship in the corpus with
  crit-damage-taken phrasing (grep-verified). It is emitted by a new `skillTextParser` rule onto the
  passive slot — the same ability shape the equipment registry emits.

### M2 — DoT-source reduction (folds into the DoT-tick path)

| Effect | Source | Condition | Reduction |
|---|---|---|---|
| **Vortex Veil** | implant `VORTEX_VEIL` (ultimate) | damage from **Inferno or Corrosion** | 6 / 12 / 18 / 24 / 30% |

### M3 — Proc-based block (chance to negate part/all of a hit)

| Effect | Source | Condition | Proc chance | Block |
|---|---|---|---|---|
| **Ironclad** | implant `IRONCLAD` (major) | **2nd+ direct hit in a round** | 10 / 14 / 16 / 20% | **30 / 40 / 45 / 50%** of the hit (partial) |
| **Shadowguard** | implant `SHADOWGUARD` (major) | direct hit **while in Stealth**, **once per round** | 7 / 12 / 16% | **100%** of the hit (full) |

## 3. Composition rules (user-ratified)

For a single incoming **direct** hit, the total reduction is:

```
reductionPct = max(applicable crit-reduction-family entries)   // "does not stack with similar effects"
             + sum(applicable non-crit-family entries)          // Voidshade, Nebula
```

- **Crit-reduction family** = Hyperion Gaze, Hardened, Iridium (all "reduce critical damage taken").
  They are "similar effects" → **take the max** among those that apply (only on crit hits), never
  sum. Example: a crit hit on a ship with Hardened (−5%) + Iridium (−35%) → −35%, not −40%.
- **Non-crit family** = Voidshade (self-stealth), Nebula (self-stasis). These **add** to the
  crit-family max and to each other. Example: stealthed ship taking a crit from a stealthed attacker
  with Voidshade(−20%) + Hyperion(−35%) → −55%.
- The summed `reductionPct` folds **additively** into the existing incoming channel alongside any
  enemy-applied incoming-damage debuffs (which increase damage). The channel is applied as
  `(1 + incoming/100)` exactly as today; the implant reductions contribute negative percentage
  points. (Example: enemy "+30% damage taken" debuff on a Voidshade ship → +30 + (−20) = +10%.)

**Proc-block (M3)** is a separate **multiplicative** factor applied to the hit's damage:

```
blockedFraction = (Shadowguard proc succeeds) ? 1.0 : (Ironclad proc succeeds ? ironcladBlockPct : 0)
finalHitDamage  = baseHitDamage × (1 + incoming/100) × … × (1 − blockedFraction)
```

A full block (Shadowguard) supersedes a partial block. Two partial blocks never co-occur (one
Ironclad per ship). Multiplicative order is irrelevant to the final number (commutes with the
additive-channel factor). Block sits at the **damage-computation** step — it reduces the hit amount
*before* it enters `applyIncomingToTarget` (so Barrier/shield/HP intercepts see the reduced amount).

**Surfacing:** blocked damage is **reduced silently** in D-PR3 (visible only via lower damage-taken).
A `damageBlocked` per-round accumulator + StatCard (mirroring `barrierAbsorbed`/`shieldsAbsorbed`) is
an explicit fast-follow, out of scope here.

## 4. Architecture

### 4.1 Why not the D-PR2 modifier/ConditionContext path

D-PR2 rode `modifierTotalsFromAbilities` + `ConditionContext`, which is an **attacker-turn standing
snapshot**. The incoming conditions here are fundamentally **per-incoming-hit facts**: *this hit
crit*, *the attacker is stealthed*, *this is the Nth hit this round*, *the damage came from a DoT
type*. These are not standing facts about the acting actor, and proc-block (chance + block fraction)
is not an additive `modifier` at all. Overloading `ConditionSubject`/`ConditionContext` with
hit-context fields would muddy that contract. **Rejected.**

### 4.2 The victim-side incoming-effects model (chosen)

A dedicated, typed model emitted onto the passive slot by both the equipment registry and the Iridium
parser rule, evaluated by a pure function at the victim apply sites.

**New ability configs.** Both `'incoming-reduction'` and `'incoming-block'` are added as members of
`AbilityType` (`src/types/abilities.ts:6`) **and** of the `AbilityConfig` union
(`src/types/abilities.ts:190`), so the standard discriminator pattern
(`ability.type !== 'X' || ability.config.type !== 'X'`, as in `applyAbilities.ts:36`) works. They are
emitted with the full `Omit<Ability,'id'>` envelope the registry already uses
(`buildEquipmentAbilities.ts:35-43`): `target:'self'`, `trigger:'on-cast'` (a passive carrier; the
trigger is inert — the new evaluator filters by `config.type`, never by `Ability.trigger`),
`conditions:[]` (gating lives entirely in the config's `condition` field below, **not** in
`Ability.conditions`).

```
// M1 + M2
config: { type: 'incoming-reduction',
  scope: 'direct' | 'dot',                 // 'dot' = inferno/corrosion ticks (Vortex Veil)
  condition: IncomingCondition,            // see below — this is the GATE
  pct: number,                             // positive magnitude; folded as a reduction
  critFamily: boolean }                    // grouping ONLY: true → take-max family, false → additive.
                                           // Orthogonal to the gate: the crit GATE is enforced by
                                           // condition='incoming-crit*' requiring ctx.didCrit.

// M3
config: { type: 'incoming-block',
  condition: IncomingCondition,            // 'self-stealth' (Shadowguard) | 'nth-hit-2plus' (Ironclad)
  procChance: number,                      // 0..1 (reuses D-PR1 procChance semantics)
  blockPct: number,                        // 0..1 fraction blocked (1.0 = full)
  oncePerRound: boolean }
```

```
type IncomingCondition =
  | 'self-stealth'              // Voidshade, Shadowguard
  | 'self-stasis'              // Nebula (Disable folded in here when modeled)
  | 'incoming-crit'            // Hardened, Iridium
  | 'incoming-crit-by-stealthed' // Hyperion Gaze
  | 'nth-hit-2plus'            // Ironclad
  | 'dot-inferno-corrosion';   // Vortex Veil
```

These conditions live in the model's own `condition` field — **not** in `ConditionSubject` — because
they are evaluated against an incoming-hit context, not the attacker-standing `ConditionContext`.

**`IncomingHitContext`** assembled by the engine at each apply site:

```
interface IncomingHitContext {
  didCrit: boolean;            // direct paths: per-hit (positional) or crit-fraction (aggregate)
  attackerStealthed: boolean;
  victimStealthed: boolean;
  victimStasised: boolean;
  hitIndexThisRound: number;   // 1-based, per victim per round (Ironclad)
  dotType?: 'inferno' | 'corrosion'; // set only on the DoT-tick path
}
```

**Pure evaluator** in a new leaf module (e.g. `src/utils/combat/incomingEffects.ts`):

```
incomingEffectsForHit(
  victimEquipAbilities: Ability[],
  ctx: IncomingHitContext,
  rollBlock: (abilityId: string, chance: number) => boolean, // engine-supplied (rate-gate + counters)
): { reductionPct: number; blockedFraction: number }
```

`reductionPct` applies the §3 composition (take-max crit family + additive others). `blockedFraction`
rolls the applicable block abilities (Shadowguard full supersedes Ironclad partial). The function is
pure given `rollBlock`; all RNG/state lives in the engine wrapper.

### 4.3 State & wiring in the engine

- **`rollBlock`** reuses D-PR1's per-`(owner,ability)` deterministic `procChanceGates` rate-gate
  (`makeRateGate`, engine-owned at `engine.ts:1860`, key `${ownerId}:${abilityId}`). This adds a
  **second consumer** of that map — today it is read only inside `executeIntent` for reactive heals
  (`triggers.ts:1138-1146`); D-PR3 adds a victim-side read at the positional driver. Same map / same
  key on purpose (one accumulator per owner+ability across the whole battle). Ironclad and
  Shadowguard get **distinct** ability ids so their gates never collide. Plus two
  per-victim-per-round trackers the engine owns and resets each round:
  - **hit-index** per victim (incremented on each direct hit) → drives Ironclad's `nth-hit-2plus`.
  - **once-per-round** flag per `(victim, abilityId)` → drives Shadowguard.
- **Self-status** (`victimStealthed`, `victimStasised`) read from the `statusEngine` at the apply
  site: `isStasised` is **already tapped** there (`engine.ts:2664`); stealth via
  `selfBuffNamesForOwners` / the Phase-3 `buildForcedTargetingStatus` seam.
- **`attackerStealthed`** read from the acting attacker's status (same stealth query).

**Apply sites:**

1. **Positional per-hit (primary — the simulator's path):** `victimHitDamage` (`victimDamage.ts:71`),
   driven via `drivePositionalApply`/`applyPositionalDamage`. Here `didCrit` is the genuine per-hit
   boolean. **Signature change:** add an optional final arg
   `incoming?: { reductionPct: number; blockedFraction: number }` (computed by the caller from the
   per-hit `IncomingHitContext`), keeping `victimHitDamage` PURE and its existing `??`-fallback
   direct-call tests green (default `{reductionPct:0, blockedFraction:0}` → byte-identical). Inside:
   `reductionPct` adds into the existing `incoming` term (`victimDamage.ts:96`, alongside the
   per-victim enemy-debuff incoming modifier); `blockedFraction` multiplies the return
   (`victimDamage.ts:106`) by `(1 − blockedFraction)`. The engine assembles `IncomingHitContext` per
   victim per hit in the driver and calls the evaluator (with the engine-supplied `rollBlock`) to
   produce that `incoming` arg.
2. **Aggregate enemy-attack (non-positional — Iridium as a healing-calc tank):**
   `playerTurn.ts` `nonCritFactor`/`damageCritMultiplier` (~1295–1305). The **only in-scope effect
   that can reach this path is Iridium's crit-reduction** (reduction-only): the aggregate path's
   victims are the bound healing-mode target, and **no in-scope block effect can reach it** — Ironclad
   and Shadowguard are *implants* that only attach to positioned sim actors, never to the aggregate
   non-positional target. So the aggregate path needs **reduction only, no block**. Non-crit-family
   reductions (none reach this path today — Voidshade/Nebula are also implants; included for
   uniformity) fold into the incoming term (all hits). The crit-family take-max reduction `R` applies
   to the **crit fraction only**, via the documented algebraic split (verified algebra:
   `1 + cf·cd/100 = (1−cf) + cf·(1+cd/100)`):
   `damageCritMultiplier_adj = (1 − critFraction) + critFraction·(1 + cd/100)·(1 − R/100)`,
   using the locally-available `effectiveCritDamage` and `critFraction`. **No aggregate-path block
   model is needed** — this removes the §7 "plan to settle" hole.
3. **DoT-tick (M2 — Vortex Veil):** the inferno/corrosion tick loop (`engine.ts` ~714–740). Compute
   `IncomingHitContext{ dotType }`, fold the `scope:'dot'` reductions, multiply the tick by
   `(1 − reductionPct/100)`. No crit, no block on DoTs.

### 4.4 Source emitters

- **Registry** (`buildEquipmentAbilities.ts`): add `IMPLANT_ABILITIES` entries for `VOIDSHADE`,
  `NEBULA_NULLIFIER`, `HYPERION_GAZE`, `VORTEX_VEIL`, `IRONCLAD`, `SHADOWGUARD`, and a
  `GEAR_SET_ABILITIES` entry for `HARDENED`. Values baked per-rarity / per-set from the constants;
  graceful skip on missing/unparseable input (D-PR1 invariant). Stable ids (`equip-implant-*`,
  `equip-set-*`).
- **Parser** (`skillTextParser.ts` + `buildShipAbilities.ts`): one new rule detecting
  "takes N% less damage from Critical hits" → emit `incoming-reduction { scope:'direct',
  condition:'incoming-crit', pct:N, critFamily:true }` onto the passive slot. Lights up **Iridium**
  only. `audit:skills` must remain green.

## 5. Testing & invariants

- **Byte-identical goldens.** DPS goldens cannot move (the DPS attacker is never a victim). Healing /
  battle-sim goldens cannot move: no existing fixture carries these equipment effects (D-PR1
  established this), and Iridium is **not** in any healing/sim golden (it appears only in C-era
  *unit* tests as a purge-on-damaged source — those are non-golden and auditable). **If a golden
  moves, the gate leaked — fix the gate, never `vitest -u`.**
- **Unit — `incomingEffectsForHit`:** the §3 composition (crit-family take-max; non-crit additive;
  crit-gated entries inert on non-crit hits; Shadowguard full supersedes Ironclad partial; block
  roll honored). Cover each condition's predicate against `IncomingHitContext`.
- **Unit — `buildEquipmentAbilities`:** per-rarity / set-piece value baking, id/source tagging,
  stat-only skip, graceful skip.
- **Unit — parser:** Iridium crit-reduction emission; non-matching texts unaffected.
- **Integration (via `simulateBattle` / `runCombat`):** a ship with each implant takes reduced
  damage from a qualifying hit and full damage from a non-qualifying hit (e.g. Voidshade reduces only
  while stealthed; Hyperion only on crit-by-stealthed; Ironclad's 1st hit unblocked, 2nd+ rolls;
  Shadowguard once per round; Vortex Veil reduces inferno/corrosion ticks).
- **Coverage tracker** (`equipmentCoverage.test.ts`): implemented set updated to include the seven
  new **equipment** effects (Voidshade, Nebula Nullifier, Hyperion Gaze, Vortex Veil, Ironclad,
  Shadowguard, Hardened). **Iridium is NOT an equipment-coverage entry** — it is a ship skill,
  tracked by the parser + `audit:skills` path; do not add it to `equipmentCoverage` (avoids an
  apparent off-by-one).
- **Iridium integration test confound:** Iridium's 3rd passive also grants start-of-combat Taunt and
  an on-directly-damaged purge-2 (`ship-skills.csv` row). A fixture must isolate the crit-reduction —
  assert on a single controlled hit and neutralize/account for the Taunt (forced targeting) + purge
  riders so they don't perturb the measured hit.
- `npm run lint` (max-warnings 0), `tsc`, `npx vitest run` (NOT watch), `npm run audit:skills`
  all green in every task gate.

## 6. Out of scope / deferred

- Surfacing `damageBlocked` (StatCard + round-data accumulator) — fast-follow.
- Disable control modeling (Nebula's "or Disable" half stays dormant).
- Other incoming-reduction families in sub-project D's bucket map (reactive self/ally buffs,
  on-death, charge/DoT/cleanse appliers, net-new mechanics) — their own PRs.
- Any ship-skill incoming reductions *other than* crit-damage-taken (none exist in the corpus today).

## 7. Risks

- **Stealth query timing.** Phase-3 noted passive-slot self-buffs may not surface at certain
  resolution points; integration tests must apply Stealth via a path that is live at the victim apply
  site (mirror the Phase-3 active-slot-Taunt test workaround if needed). The same applies to
  `attackerStealthed` (Hyperion Gaze) — the test must put real Stealth on the *attacker* at its turn.
- **Aggregate-path block: resolved, not a risk.** §4.3.2 establishes no in-scope block effect can
  reach the aggregate path, so there is no aggregate-block model to settle.
