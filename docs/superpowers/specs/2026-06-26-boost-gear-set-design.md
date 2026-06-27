# Boost gear set — design

**Status:** Approved (scope + Approach A ratified by user 2026-06-26)
**Sub-project:** Combat-realism epic, sub-project D (implants + gear-set abilities) — the final special-effect gear set leftover.
**Branch:** `feat/combat-d-pr-boost-set` (worktree `.worktrees/boost-set`), off main `bd2b6aa8` (Reflect/Revenge/Smokescreen #160).

## 1. Effect

The **Boost** gear set (4-piece bonus, `GEAR_SETS.BOOST`, `minPieces: 4`, description *"All buffs last an extra turn"*) makes every **buff the wearer applies** last **+1 turn**, wherever that buff lands:

- the wearer's own self-buffs (e.g. Attack Up it grants itself from a skill), and
- buffs the wearer grants to allies (e.g. a buffer casting Attack Up on all allies).

This is **caster-side**: the determinant is whether the *applying* (casting) ship wears 4-piece Boost, not whose buff it ultimately sits on. This matches Boost being the recommended set for the buffer role in `shipTypes.ts` ("big bonus if boost set") — a buffer's value is the buffs it puts on allies, and Boost extends those.

It is a **binary set bonus**: +1 turn flat at ≥4 pieces. 6 pieces is still +1 (not per-2-pieces like Decimation).

### Out of scope (ratified design decisions)

- **Debuffs the wearer inflicts on enemies are NOT extended.** "All *buffs*" = positive statuses only. The engine separates these by side (buffs land self-side, debuffs enemy-side), so gating the +1 to the self side excludes enemy debuffs for free.
- **Permanent / recurring / persistent-stacking buffs get no +1.** They carry no finite duration; the existing early-returns at the application seams skip them before the duration is ever written.
- **No stacking with itself.** One Boost set on the caster = +1. (Two Boost wearers do not compound on the same buff — each buff has exactly one caster.)

## 2. Why Boost is structurally different from prior D effects

Every prior D gear-set / implant effect folds into a damage / heal / shield / targeting channel via an `Ability` consumed by the ability executor or an in-flight seam. Boost changes **buff durations**, which live in `src/utils/combat/statusEngine.ts`. The +1 is applied at the moment a timed buff's `turnsRemaining` is written, conditioned on the caster wearing Boost — not in the ability fold.

## 3. Mechanism

### 3.1 The two application seams

Timed self-side buffs get their `turnsRemaining` written in exactly two places in `statusEngine.ts`:

| Seam | Buff kind | Caster identity available |
|---|---|---|
| `upsertBuff(buff, 'self')`, called inside `sourceFired(sourceId, slot, round)` (~711) | scheduled ship-skill self-buffs | `sourceId` (the firing source = caster) — **at the call site, NOT in the closure** (see below) |
| `applyTimedAbilityStatus(round, status, recipientId)` | ability-granted buffs (self + ally targets, including reactive grants) | `status.casterId` (the registering owner = caster) |

**`upsertBuff` needs a signature change.** Its closure is `(buff, side)` today and scheduled self-buffs are deliberately routed to the `'attacker'` *carrier* owner regardless of `sourceId`. The caster (the ship whose Boost membership matters) is the firing `sourceId`, available in `sourceFired` at the call site but not inside `upsertBuff`. Thread `sourceId` (or the resolved extension turns) into `upsertBuff` as a new parameter, and gate on the **firing source**, not the `'attacker'` carrier the buff is stored under — these differ for team-actor casts. Confirm there are no other `upsertBuff(..., 'self')` callers where the caster would be wrong/unavailable.

At each seam, before writing `turnsRemaining = <duration>`, add `buffDurationExtensionFor(casterId)` (0 or 1 turn). Gated so the +1 only applies to:

- **self-side** statuses (`side === 'self'`) — excludes enemy debuffs;
- **finite-duration** entries — the persistent-stacking early-return (`PERSISTENT_STACKING_BUFFS.has(...)`, statusEngine.ts ~639 / ~1114) and permanent/recurring kinds (seeded via separate sentinel paths that never reach the numeric writes) already return before the numeric duration write, so they are untouched without extra guards. *(Verified: the only two numeric `turnsRemaining` writes are `upsertBuff` ~649 and `applyTimedAbilityStatus` ~1138, both after these early-returns.)*

**Compute the extended duration ONCE and use it in BOTH the family-rule check and the store.** Each seam references the duration twice — `familyApplicationWins(existing, tier, <dur>)` AND `turnsRemaining: <dur>` (upsertBuff ~646/~649; applyTimedAbilityStatus ~1135/~1138). The +1 MUST feed the comparison too, not only the stored value: otherwise a Boost re-cast of an N-turn buff against an existing `turnsRemaining === N` fails the `> N` win-check and silently drops the extension. Compute `const dur = baseDuration + extension;` before the win-check and use `dur` in both spots.

**`casterId` fail-safe.** Read sites already default a missing `casterId` to `'attacker'`. In production `casterId` is reliably stamped (`engine.ts` registration `casterId: ownerId`; reactive grants `casterId: intent.ownerId`), so real ally-targeted/reactive self-buffs carry the wearer id. Use `buffDurationExtensionFor(status.casterId ?? 'attacker')` so an undefined caster (unit-test fixtures only) fails safe to the attacker's membership rather than throwing — `'attacker'` is not a Boost wearer in any byte-identical fixture, so this returns 0.

### 3.2 How the wearer-set reaches the status engine (Approach A — registry + collected map)

Consistent with the REFLECT precedent (a config type the ability fold ignores, read by the engine at a dedicated seam):

1. **Registry entry** — `GEAR_SET_ABILITIES.BOOST` in `buildEquipmentAbilities.ts` emits an `Ability` with a new no-op config `{ type: 'buff-duration-extension', turns: 1 }`. Top-level `type: 'modifier'` is a placeholder (the engine keys on `config.type`, exactly as REFLECT does with `damage-reflection`). Gated by the existing `minPieces` check (4) in `buildEquipmentAbilities`.
2. **New `AbilityConfig` variant** — `buff-duration-extension` added to the `AbilityConfig` union in `types/abilities.ts` (`{ type: 'buff-duration-extension'; turns: number }`).
3. **Engine collection** — build a `buffDurationExtensionByOwner: Map<string, number>` (owner id → max extension turns; absent → 0). Owners with no Boost ability are absent (lookup → 0).
4. **Thread into the status engine** — add `buffDurationExtensionFor?: (casterId: string) => number` to `StatusEngineInput` (returns extra turns, default 0). The engine passes a lookup backed by the map.

   **ORDERING (blocker — must be handled explicitly):** `createStatusEngine(...)` is constructed **early** in `engine.ts` (~1422), but the existing per-owner ability maps (`incomingAbilitiesById` / `outgoingAbilitiesById`) are built **much later** (~2257–2315) from the assembled runtimes. So a lookup passed into `createStatusEngine` **cannot** close over a map that doesn't exist yet at line ~1422. The seams (`sourceFired` / `applyTimedAbilityStatus`) only fire at turn time (after ~2539), so two resolutions are viable — the plan must pick one and test it:
   - **(a) Hoist a minimal BOOST scan before ~1422.** Boost membership needs only the equipped-set counts per actor (not the full runtime), so a small `buildBoostWearerSet(actors, getGearPiece)` can run before construction and back the lookup directly. *(Preferred — simplest, no mutable-ref aliasing.)*
   - **(b) Closure over a mutable ref** populated before the first turn (alongside the existing `ByOwner` collection at ~2300). Requires a test asserting the lookup is live by the first `sourceFired`.
5. The config type is **inert in the ability fold** — it is purely a marker read at collection time, never executed by the ability executor. *(If resolution (a) is chosen, the registry ability is optional — the BOOST scan could read set counts directly. Keeping the registry entry is still preferred for coverage-tracker consistency and a single source of the "+1 turns" value; the plan decides.)*

### 3.3 DPS calculator

No separate DPS wiring needed. `simulateDPS` (`dpsSimulator.ts` ~274) calls `runCombat`, and the DPS path does **not** construct its own `StatusEngineInput` — it routes through the single `createStatusEngine` in `engine.ts`. So threading the lookup once into the engine's status-engine input covers the DPS path automatically (confirmed: one `createStatusEngine` call site). A self-buffing attacker wearing Boost gets longer self-buff uptime → higher DPS, which is correct. **No separate DPS construction file is touched** (§7 corrected accordingly).

## 4. Surfacing & editor

- **Ability editor** — no stub needed. The editor's exhaustiveness switches key on `AbilityType` (top-level `type`), not `config.type`, with a permissive default — same as REFLECT's `damage-reflection`. Confirm during implementation.
- **Pre-existing presence indicator** — `src/components/simulation/statLines/BoostSetStatus.tsx` already renders "Boost Set: Active/Inactive" from `simulation.activeSets?.includes('BOOST')`. It is purely cosmetic and does NOT model the duration effect. The new combat modeling is independent of it — no change needed there, and there is no double-count (the component reads set presence, not buff durations).
- **Coverage tracker** — add `BOOST` to the implemented gear-set set in `equipmentCoverage.test.ts`.
- **Changelog** — add a plain-English `UNRELEASED_CHANGES` entry (`src/constants/changelog.ts`).
- **DocumentationPage** — note Boost is now modeled in the combat + DPS simulators.

## 5. Golden / byte-identical guarantee

Like every prior D PR: the +1 only fires when `buffDurationExtensionFor(casterId) > 0`, i.e. when the caster actually wears 4-piece Boost. No combat or DPS golden fixture equips a 4-piece Boost set (verified: no `simulateBattle`/`runCombat` fixture sets `setBonus: 'BOOST'` on 4+ pieces). Therefore the lookup returns 0 everywhere in the existing suites → `turnsRemaining` is written exactly as today → **goldens and `.snap` files are byte-identical**. This must be re-confirmed by running the full suite during implementation.

Note: this is unrelated to the separate "universal decrement-timing" bug (a global rule change that *would* move every golden). Boost is a caster-gated, application-time additive — it changes nothing for non-wearers.

## 6. Testing strategy

1. **Pure status-engine unit tests** — construct a `StatusEngine` with a `buffDurationExtensionFor` that returns 1 for a designated caster id:
   - a self-side timed buff applied by that caster gets `turnsRemaining + 1`;
   - a buff applied by a non-wearer caster is untouched;
   - an enemy-side debuff by the wearer is untouched;
   - a persistent-stacking / permanent / recurring buff is untouched;
   - the family rule still picks the longer (extended) duration.
2. **Engine integration (real registry)** — a ship with `setBonus: 'BOOST'` on 4 pieces (override `getGearPiece`): its self-buff and an ally-targeted buff each persist one turn longer than without Boost; a debuff it inflicts on an enemy is unchanged. Route through the real `buildShipAbilitiesWithEquipment` + a registry-shape assertion (mutation-resistant, per the D-PR16 Last Stand lesson).
3. **DPS integration** — a self-buffing attacker wearing Boost yields measurably higher DPS than the same ship without Boost (buff uptime extended).
4. **Full suite + goldens** — byte-identical; `audit:skills` unchanged; `tsc`/`lint` clean.

## 7. Files touched (anticipated)

- `src/types/abilities.ts` — new `buff-duration-extension` `AbilityConfig` variant.
- `src/utils/abilities/buildEquipmentAbilities.ts` — `GEAR_SET_ABILITIES.BOOST` entry (registry; kept for coverage-tracker consistency even if resolution (a) reads set counts directly).
- `src/utils/combat/statusEngine.ts` — `StatusEngineInput.buffDurationExtensionFor?`; `upsertBuff` signature gains the firing-source/extension param; +1 (computed once, used in both the family-check and the store) at the two seams.
- `src/utils/combat/engine.ts` — build `buffDurationExtensionByOwner` (hoisted before `createStatusEngine` ~1422 per §3.2 resolution (a), or mutable-ref per (b)); thread the lookup into the status-engine input. **No DPS file is touched — DPS routes through this same construction.**
- `src/utils/abilities/__tests__/equipmentCoverage.test.ts` — add BOOST.
- New test files for the unit + integration + DPS cases above.
- `src/constants/changelog.ts`, `src/pages/DocumentationPage.tsx`.
