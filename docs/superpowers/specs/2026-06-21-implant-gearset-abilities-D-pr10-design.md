# D-PR10 — Dynamic caster-attack-snapshot flat-attack buff subsystem

**Date:** 2026-06-21
**Sub-project:** D (implant + gear-set abilities), combat-realism epic
**Stacks on:** D-PR9 tip `be3ae187` (branch `feat/combat-d-pr10-flat-attack-buff`, worktree `.worktrees/d-pr10-flat-attack-buff`)

## 1. Goal

Light up the `Power Infused Nanobots` buff — the effect granted by the **Font of Power** implant (Font of Power's `on-own-repair-to-ally` reactive grant shipped in D-PR9, which already lands the buff on the correct allies, but as an **emit-only** status with zero stat effect).

Buff definition (`src/constants/buffs.ts`):

```ts
{ name: 'Power Infused Nanobots', description: "Grants attack equal to 100% of the caster's attack", type: 'buff' }
```

The recipient gains **flat attack equal to 100% of the casting unit's effective attack, snapshotted at the moment of the grant.** This requires an engine primitive that does not exist today: a per-instance, dynamic-magnitude, **flat (absolute)** attack buff whose value is **frozen from a different actor (the caster)** at apply time.

## 2. Why the engine cannot model this today

- Attack buffs fold as **percentages of the holder's own attack**: `effectiveStatsOf` computes `attack: s.attack * (1 + attackBuff/100)` (`src/utils/combat/effectiveStats.ts`). There is no absolute-units attack channel.
- Buff magnitudes are **re-derived from static `BUFFS`** at fold time via `selfBuffLookup` / `parseBuffEffects`. Buff instances carry no per-instance value.
- The fold has **no caster identity**: a recipient folds *its own* active buffs without knowing who cast each. So a value defined as "% of the caster's attack" cannot be resolved at fold time — it must be resolved (snapshotted) at **apply** time.

`parseBuffEffects` currently cannot parse this description (D-PR9 noted: the attack regex requires a leading `[+-]` sign; `100%` has none, and there is no flat-attack channel). The buff therefore lands with empty effects → no stat change. D-PR10 closes this.

## 3. Locked decisions (from brainstorming)

1. **Snapshot source = caster's EFFECTIVE attack.** The value frozen is the caster's live buffed attack at the moment it performs the repair — `ownerCtx.effectiveAttack` (the same last-turn-context value bombs and reactive-damage already snapshot via `ctx.lastTurnCtxByActor`), falling back to `owner.attack` (base) when no last-turn ctx exists. A Font-of-Power healer that is itself buffed grants more.
2. **Fold order = additive flat, after the percentage.** The recipient's resolved attack is `recipientBase * (1 + recipientAttackBuff%/100) + grantedFlatAttack`. The frozen amount is added on top of the recipient's own (possibly buffed) attack — a flat stat addition, mirroring the hacking/security additive channel. It is NOT folded into the multiplicative base (which would re-scale the caster's buffs through the recipient's multipliers).
3. **Freeze at apply, not re-derive per round.** The buff carries the value the caster had when it granted it. (PIN is a 1-turn buff so this is currently moot, but the principle is locked: the timed-ability-status payload is per-instance and holds the frozen value.)

## 4. Architecture — the sentinel → concrete split

Two distinct fields on `ParsedBuffEffects` (`src/types/calculator.ts`), because the snapshot happens at apply time but the description is parsed statically:

| Field | Meaning | Origin | Behavior in fold |
| --- | --- | --- | --- |
| `attackFlatPctOfCaster?: number` | **Sentinel** — "needs a caster-attack snapshot of this %". | Parsed from the static buff description (`100` for PIN). | **Inert (0 attack).** No caster context at fold time. |
| `attackFlat?: number` | **Concrete** frozen absolute attack amount. | Materialized ONLY at apply time, written into the per-instance status payload. | **Summed** into the fold's flat-attack channel. |

This split is self-protecting: if PIN ever reaches a holder via the static re-derive path (scheduled self-buff, `selfBuffLookup`), it carries only the sentinel → contributes 0 — never a broken or double-counted value. Only the snapshot path materializes a concrete `attackFlat`.

## 5. Components & changes

### 5.1 Parser — `src/utils/calculators/buffParser.ts`

Add to `parseBuffEffects`: a regex capturing the percentage in "...equal to N% of the caster's attack" → `effects.attackFlatPctOfCaster = N`. Must NOT false-match ordinary `+N% Attack` buffs (the existing `attack` regex requires the leading sign and the literal `Attack`; the new one keys on the `of the caster's attack` phrasing). Apostrophe-tolerant (`caster's` / `casters`).

### 5.2 Type — `src/types/calculator.ts`

Add `attackFlat?` and `attackFlatPctOfCaster?` to `ParsedBuffEffects` with doc comments distinguishing concrete vs sentinel.

### 5.3 Buff leaf emit + fold totals — `src/utils/calculators/dpsBuffHelpers.ts`, `src/utils/combat/buffTotals.ts`, `Buff` type

The per-stat `Buff` leaves consumed by `calculateBuffTotals` are produced by `toSimBuffs` (`dpsBuffHelpers.ts`), one push per defined `parsedEffects` channel (× stacks) — exactly how `hacking`/`security` were wired in A2. Changes:

- **`Buff.stat` union** (`src/types/calculator.ts`): add `'attackFlat'`.
- **`toSimBuffs`**: `if (parsedEffects.attackFlat !== undefined) entries.push({ id: \`${s.id}-attackFlat\`, stat: 'attackFlat', value: parsedEffects.attackFlat * stacks })`. (The sentinel `attackFlatPctOfCaster` is deliberately NOT emitted — it has no concrete value and must stay inert.)
- **`calculateBuffTotals`**: `attackFlatBuff = buffs.filter(b => b.stat === 'attackFlat').reduce((s, b) => s + b.value, 0)`; add `attackFlatBuff` to the returned object.

### 5.4 Effective-stats fold — `src/utils/combat/effectiveStats.ts`

- `foldActorBuffTotals`: sum `attackFlatBuff` across the scheduled + timed layers (the explicit field-by-field sum).
- `effectiveStatsOf`: `attack: s.attack * (1 + t.attackBuff / 100) + t.attackFlatBuff`.
- `effectiveDamageStatsOf`: thread `attackFlatBuff` through the `totals` assembly (it has no modifier-channel equivalent, so just `scheduledTotals.attackFlatBuff + ability.attackFlatBuff`) and apply `attack: base.attack * (1 + totals.attackBuff / 100) + totals.attackFlatBuff`.

### 5.5 Snapshot at the grant site — `src/utils/combat/triggers.ts` (buff branch, ~1080)

In `executeIntent`'s `cfg.type === 'buff'` block, before constructing the hoisted `status`:

- If `cfg.parsedEffects.attackFlatPctOfCaster` is defined, resolve `const casterAttack = ownerCtx?.effectiveAttack ?? owner.attack` (resolve `ownerCtx = ctx.lastTurnCtxByActor.get(intent.ownerId)` exactly as the existing damage/heal branches do) and compute `attackFlat = casterAttack * (pct / 100)`.
- Build a per-instance `parsedEffects` copy `{ ...cfg.parsedEffects, attackFlat }` and pass it into `payloadFromConfig` (or a small per-instance payload override) so the timed-ability-status payload carries the concrete frozen value.
- The snapshot is one value for all recipients (the caster's attack), so a single shared payload remains correct — the existing hoist-above-the-loop structure is unchanged.
- When the sentinel is absent (every other buff), the payload is byte-identical to today.

### 5.6 Coverage tracker — `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

`FONT_OF_POWER` moves from the emit-only set to the fully-modeled set (PIN now has a real stat effect). Keep both the `.toEqual` decl-order array and the implemented Set in sync (known pitfall).

## 6. Byte-identical guarantee

No buff in the corpus other than `Power Infused Nanobots` carries `attackFlat`/`attackFlatPctOfCaster` (verified — PIN is the sole match of the `of the caster's attack` phrasing). The new fold channel is `+0` everywhere it is summed → zero golden / `.snap` drift, consistent with every prior D-PR. The grant-site snapshot only triggers when the sentinel is present (PIN only), so all existing buff grants emit identical payloads.

## 7. Testing

- **`buffParser` unit:** the new regex extracts `100` from PIN's description; does not match `+N% Attack` / `Atlas Coordination` buffs (no false positives).
- **`calculateBuffTotals` / `toSimBuffs` unit:** an `attackFlat` parsedEffect produces an `attackFlatBuff` total (× stacks); a sentinel-only (`attackFlatPctOfCaster`) parsedEffect contributes 0.
- **`effectiveStats` unit:** `effectiveStatsOf` / `effectiveDamageStatsOf` add `attackFlatBuff` after the percentage term; absent → unchanged.
- **Engine integration:** a Font-of-Power healer repairs a non-self ally → recipient gains PIN → recipient's effective attack rises by the caster's effective attack (assert magnitude bounded to the caster's snapshot, not the recipient's base), and the recipient subsequently deals correspondingly higher damage. Snapshot-vs-recipient distinction proven by using a caster and recipient with different attack stats. Enemy-side mirror (team-agnostic — Font of Power on an enemy healer grants its enemy ally).
- **Suite-wide:** goldens byte-identical; `npm run audit:skills` unchanged (141/0); lint/tsc clean.

## 8. Out of scope / follow-ups

- No new buff sources, no other implants. PIN is the only effect this PR lights up.
- `EffectiveStats` interface shape is unchanged (attack stays a resolved number); only internal arithmetic changes.
- Stacks: PIN is non-stackable; the `× stacks` term is correct but exercises only the 1× path today.
- No UI surfacing of the flat magnitude (the buff already displays by name in round status).
