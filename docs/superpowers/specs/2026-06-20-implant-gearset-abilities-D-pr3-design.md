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
additive-channel factor). Block is applied **inside the damage-apply funnel** (`applyVictimDamage`,
§4.3.3), gated on `byDirectDamage`, **after** the Barrier full-immunity check and **before** the
shield/HP drain — so a blocked amount reduces what shields/HP absorb, and a fully-Barrier-immune
intake never burns the proc accumulator.

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

**Two pure evaluators** in a new leaf module (e.g. `src/utils/combat/incomingEffects.ts`). They are
split because %-reduction and block live at **different** apply sites (see §4.3):

```
// M1 + M2 — folded at the crit-aware damage-COMPUTATION sites
incomingReductionForHit(
  victimEquipAbilities: Ability[],
  ctx: IncomingHitContext,
): number   // reductionPct, applying §3: take-max crit family + additive others (gated by condition vs ctx)

// M3 — rolled at the damage-APPLY funnel (applyVictimDamage)
incomingBlockForIntake(
  victimEquipAbilities: Ability[],
  ctx: IncomingHitContext,
  rollBlock: (abilityId: string, chance: number) => boolean, // engine-supplied (rate-gate)
): number   // blockedFraction: Shadowguard full (1.0) supersedes Ironclad partial; 0 if none roll
```

Both are pure (block is pure *given* `rollBlock`); all RNG/state lives in the engine wrapper.

### 4.3 State & wiring in the engine

- **`rollBlock`** reuses D-PR1's per-`(owner,ability)` deterministic `procChanceGates` rate-gate
  (`makeRateGate`, engine-owned at `engine.ts:1860`, key `${ownerId}:${abilityId}`). This adds a
  **second consumer** of that map — today it is read only inside `executeIntent` for reactive heals
  (`triggers.ts:1138-1146`); D-PR3 adds a victim-side read inside `applyVictimDamage`. Same map / same
  key on purpose (one accumulator per owner+ability across the whole battle). Ironclad and
  Shadowguard get **distinct** ability ids so their gates never collide. Plus two
  per-victim-per-round trackers the engine owns and resets each round (at `beginRound`):
  - **direct-intake index** per victim (incremented on each `byDirectDamage` intake) → drives
    Ironclad's `nth-hit-2plus`.
  - **once-per-round** flag per `(victim, abilityId)` → drives Shadowguard.
- **Self-status** (`victimStealthed`, `victimStasised`) read from the `statusEngine` by victim id:
  `isStasised` is **already tapped** at the engine apply scope (`engine.ts:2664`); stealth via
  `selfBuffNamesForOwners` / the Phase-3 `buildForcedTargetingStatus` seam.
- **`attackerStealthed`** read from the acting attacker's status (same stealth query) — needed only
  by Hyperion Gaze (a %-reduction), at the computation site.

**Apply sites — %-reduction (M1) at the crit-aware computation sites; block (M3) at the single funnel.**

The key data-flow facts that drive this split:
- The **positional** path calls `applyToVictim(victim, dmg)` **per sub-hit** (`positionalApply.ts:139-165`).
- The **aggregate** enemy-attack path calls `applyIncomingToTarget(damage, victim)` **once per attack**
  (`engine.ts:2818`, `:3408` for DoT batches with `byDirectDamage:false`).
- Both funnel through **`applyVictimDamage(damage, victim, sink, cause)`** (the shared delegate;
  `engine.ts:2592`/`:2618`), which carries `cause.byDirectDamage`. Block doesn't need crit info → this
  is the natural unified home, working in **both** paths automatically.

1. **%-reduction — positional per-hit:** `victimHitDamage` (`victimDamage.ts:71`). Here `didCrit` is
   the genuine per-hit boolean. **Signature change:** add an optional final arg
   `equipReductionPct = 0` (computed by the caller via `incomingReductionForHit` from the per-hit
   `IncomingHitContext`), keeping `victimHitDamage` PURE and its `??`-fallback direct-call tests green
   (default `0` → byte-identical). It adds into the existing `incoming` term (`victimDamage.ts:96`,
   alongside the per-victim enemy-debuff incoming modifier). **No block here** — block is applied at
   the funnel.
2. **%-reduction — aggregate enemy-attack** (e.g. Iridium as a healing-calc tank):
   `playerTurn.ts` `nonCritFactor`/`damageCritMultiplier` (~1300–1320). Both families fold
   **additively into the incoming channel** — exactly like the positional path (`victimHitDamage`),
   so the two damage paths compose identically when a crit-family reduction co-occurs with an
   enemy "+N% damage taken" debuff on the same victim. Non-crit-family reductions (Voidshade/Nebula,
   `equipNonCrit`) subtract from the incoming term for **all** hits; the crit-family take-max
   reduction `R` subtracts from the incoming term for the **crit fraction only**.
   Let `incBase = incomingDamageModifier − equipNonCrit` be the all-hits incoming channel. The crit
   fraction sees channel `(incBase − R)`. To keep the clean `postDefenseFactor =
   damageCritMultiplier · nonCritFactor` structure (and the passive-hit path that reuses both),
   express the crit-fraction's extra reduction as a **ratio** against the non-crit incoming factor:
   ```
   incDenom          = 1 + incBase/100
   critIncomingRatio = incDenom !== 0 ? (1 + (incBase − R)/100) / incDenom : 1
   damageCritMultiplier = (1 − critFraction) + critFraction·(1 + cd/100)·critIncomingRatio
   nonCritFactor        = (1 − dr/100)·(1 + odb/100)·(1 + incBase/100)·affinityMult
   ```
   At `R = 0` the ratio is `1`, so `damageCritMultiplier` reduces to the pre-D-PR3
   `(1 − cf) + cf·(1 + cd/100)` and `nonCritFactor` (with `equipNonCrit = 0`) to
   `(1 + incomingDamageModifier/100)` — byte-identical to every existing fixture. Multiplying out
   the crit-fraction contribution confirms the crit hit sees incoming channel `(incBase − R)`
   additively, matching positional `victimHitDamage` (no multiplicative `(1 − R/100)` split).
3. **Block (M3) — `applyVictimDamage`** (`engine.ts:2592`), gated on `cause.byDirectDamage === true`
   (so DoT batches never count as "directly damaged"). Roll `incomingBlockForIntake` against the
   victim's equip abilities (looked up by `victim.id`) and the engine's per-victim trackers; multiply
   the intake `damage` by `(1 − blockedFraction)` **before** the Barrier/shield/HP path. Skip the roll
   when the victim is fully Barrier-immune (don't burn the deterministic accumulator on a 0-damage
   intake). Because the funnel is per-sub-hit in the sim and per-attack in the healing calc, **Ironclad
   counts direct-damage intakes** at sub-hit granularity in the sim (a 3-hit skill = hits 1/2/3, so
   2nd/3rd can proc) and per-attack granularity in the healing calc (the coarser legacy path). This
   matches the in-game "hit multiple times in a round, from the second time"; the cross-path
   granularity difference is documented and acceptable (the sim is the high-fidelity consumer).
   Single-enemy single-hit rounds never reach a 2nd intake → Ironclad inert (mirrors Barrier's
   single-enemy turn-model consequence).
4. **DoT-tick (M2 — Vortex Veil):** the inferno/corrosion tick loop (`engine.ts` ~714–740). Build
   `IncomingHitContext{ dotType }`, fold the `scope:'dot'` reductions via `incomingReductionForHit`,
   multiply the tick by `(1 − reductionPct/100)`. No crit, no block on DoTs.

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
  - The new `applyVictimDamage` block step and the per-victim direct-intake counter must be **inert
    when the victim has no `incoming-block` ability** (skip the counter/roll entirely in that case) →
    byte-identical for every existing fixture. Likewise the computation-site `equipReductionPct`
    defaults to 0 when the victim has no `incoming-reduction` ability.
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
- **Block reaches BOTH damage paths** (corrected from an earlier draft): a tank with Shadowguard/
  Ironclad takes damage via the aggregate `applyIncomingToTarget` path in the (non-positional) healing
  calc, and via the per-sub-hit positional path in the simulator. Block lives at the shared
  `applyVictimDamage` funnel so it works in both; the only difference is hit-counting granularity
  (sub-hit in the sim, per-attack in the healing calc), which is documented and accepted.
- **Ironclad hit-counting granularity.** "Directly damaged for the 2nd+ time" counts direct-damage
  *intake events*. The plan must confirm the per-victim direct-intake counter resets per round and
  excludes DoT batches (`byDirectDamage:false`) and Barrier-fully-absorbed intakes (decision: a
  Barrier-immune intake should NOT advance the counter, since nothing was "damaged").
