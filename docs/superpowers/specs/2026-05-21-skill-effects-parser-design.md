# Skill Effects Parser — Design Spec

**Date:** 2026-05-21  
**Status:** Approved

## Problem

The calculators (DPS, Defense, Healing, Speed) require users to manually enter the buffs their ship has and the debuffs it applies to enemies. This information is already encoded in ship skill text — it just hasn't been parsed. The goal is to auto-populate the buff/debuff pickers when a ship is selected, reducing manual entry and surfacing effects users might overlook.

## Scope

- New `parseSkillEffects()` and `parseAllSkillEffects()` functions in `src/utils/skillTextParser.ts`
- Auto-population wired into: DPS Calculator, Defense Calculator, Healing Calculator, Speed Calculator
- Out of scope: Chrono Reaver and Recruitment calculators (no buff picker)
- No conditionals — all effects assumed to land (assume hacking sufficient, assume no affinity penalty)

## Known Limitation: Untagged Skill Text

Skill text in `src/constants/ships.ts` (the static fallback) may be untagged plain text. The parser produces zero results for untagged text and silently no-ops — no error is shown to the user. Auto-fill only activates meaningfully for ships whose skill text contains `<unit-skill>` tags (i.e. ships loaded from Supabase template data). This is acceptable and should be noted in code comments.

## Data Shape

```ts
type SkillSource = 'active' | 'charge' | 'passive1' | 'passive2' | 'passive3';

interface SkillEffect {
  buffName: string;
  target: 'self' | 'enemy';
  duration: number | 'recurring' | null;
  stacks?: number;
  source: SkillSource;
}
```

`SkillSource` uses `'charge'` to match the `chargeSkillText` field name on `Ship`.

`target: 'self'` covers both self-buffs and ally-granted buffs. For ships that are pure supporters (e.g. Aegis grants buffs to allies but not to itself), this will incorrectly auto-populate attacker buffs for the granting ship. This is a known approximation — caller beware, and the "from skill" badge helps users spot and remove incorrect entries.

`duration: null` means no "for N turns" was resolved for this tag. Preferable to a wrong value; the BUFFS constant is authoritative on effect mechanics.

## Parser Architecture

### `parseSkillEffects(skillText: string, source: SkillSource): SkillEffect[]`

Built on top of the existing `parseSkillText()` tokenizer. Walks the returned segment array. For each `unit-skill` segment:

**Step 1 — Verb lookup with boundary**  
Scan backward through preceding text segments to find the nearest verb, stopping at the most recent sentence boundary (`.`, `;`, or `<br>` in the original text). Hard cap: do not scan more than 120 characters back.

- Application verbs (proceed): `grants`, `gains`, `inflicts`, `applies`
- Skip verbs (discard tag): `ignoring`, `loses`, `removes`, `resists`, `when`
- No relevant verb found within boundary → discard tag

**Step 2 — Target via verb + BUFFS type**  
Use the verb as the primary signal, then cross-check against the `BUFFS` constant `type` field to resolve ambiguous cases (especially `applies`, which appears on both buffs and debuffs):

| Verb | BUFFS type | Target |
|---|---|---|
| `gains` | any | `self` |
| `grants` | any | `self` *(known approximation — see above)* |
| `inflicts` | any | `enemy` |
| `applies` | `'debuff'` or `'effect'` | `enemy` |
| `applies` | `'buff'` | `self` |

If the `buffName` is not found in `BUFFS`, fall back to verb-only: `inflicts`/`applies` → `enemy`, `grants`/`gains` → `self`.

**Step 3 — Duration from following text**  
Check the immediately following text segment (before the next tag):
- `/for (\d+) turns?/i` → that integer
- `/every turn/i` → `'recurring'`
- Neither → `null`

Duration binds to the current tag immediately. This means:
- `inflicts X for 1 turn and Y for 2 turns` → X=1, Y=2 ✓
- `inflicts X and Y for 2 turns` → X=null, Y=2 (intentional approximation — do not "fix")

**Step 4 — Stack detection**  
If preceding text matches `/(\d+) stacks? of/i`, set `stacks: N`. Only override `duration` to `'recurring'` if Step 3 did not already find a finite duration — a "3 stacks for 2 turns" pattern should keep `duration: 2`.

### `parseAllSkillEffects(ship: Ship): SkillEffect[]`

```ts
[
  ...parseSkillEffects(ship.activeSkillText,        'active'),
  ...parseSkillEffects(ship.chargeSkillText,         'charge'),
  ...parseSkillEffects(ship.firstPassiveSkillText,   'passive1'),
  ...parseSkillEffects(ship.secondPassiveSkillText,  'passive2'),
  ...parseSkillEffects(ship.thirdPassiveSkillText,   'passive3'),
]
```

## Calculator Integration

Applied to: `DPSCalculatorPage`, `DefenseCalculatorPage`, `HealingCalculatorPage`, `SpeedCalculatorPage`.

When a ship is selected (or changed) in a calculator:

1. Call `parseAllSkillEffects(ship)`
2. Split results: `target === 'self'` → own buffs, `target === 'enemy'` → enemy debuffs
3. Cross-reference each `buffName` against `BUFFS` — discard any not found
4. Deduplicate by `buffName` before merging — if a buff is already present (manually added or from a prior auto-fill), skip the incoming auto-fill entry rather than duplicating
5. Convert to `SelectedGameBuff` shape using `id: buff.name` (same convention as manually-added entries — dedup in step 4 prevents id collisions), set `autoFilled: true`, and merge into existing buff state
6. User can remove auto-filled entries; they are not re-added unless the ship selection changes

### Per-calculator mapping

| Calculator | Self buffs go to | Enemy debuffs go to |
|---|---|---|
| DPS | `config.buffs` for that ship's `DPSShipConfig` (not global `attackerBuffs`) | enemy debuffs state |
| Defense | `globalBuffs` | *(ignored — no enemy debuff picker exists)* |
| Healing | per-ship `buffs` in healer config | *(ignored — no enemy debuff input)* |
| Speed | `forwardBuffs` only | *(ignored — no enemy debuff concept in speed calc)* |

**Speed Calculator note:** Auto-fill targets `forwardBuffs` only. The reverse mode (`reverseBuffs`) is not auto-populated — users configuring a reverse lookup are solving for an unknown base speed, not picking a known ship.

**`incomingHeal` edge case (Healing):** Skill effects that grant incoming-heal buffs to an ally (parsed as `target: 'self'` via `grants`) will land in the healer's own buff list rather than the healing target's config. This is an accepted approximation — the Healing Calculator has no separate "healing target buffs" input.

## Accuracy Expectations

~80–85% of skills parse correctly. Known approximations:
- Shared-duration pattern (`inflicts X and Y for 2 turns`): X gets `null`, Y gets the correct value
- `grants` → `self` for supporter ships that buff allies only (inflates self-buff list)
- Skip-verb false negatives: a tag whose verb is outside the scan boundary is discarded
- Stack-based recurring effects (Blast, Overload): captured as `stacks: N, duration: 'recurring'` — correct semantically but calculators may not model per-stack scaling

Errors are conservative (skipping or over-adding effects) rather than silently wrong. The "from skill" badge lets users spot and remove incorrect auto-fills.

## Files Touched

- `src/utils/skillTextParser.ts` — add `SkillEffect` type, `SkillSource` type, `parseSkillEffects()`, `parseAllSkillEffects()`
- `src/types/calculator.ts` — add `autoFilled?: boolean` to `SelectedGameBuff`
- `src/pages/calculators/DPSCalculatorPage.tsx` — wire auto-fill into per-ship `config.buffs` on ship select
- `src/pages/calculators/DefenseCalculatorPage.tsx` — wire auto-fill on ship select
- `src/pages/calculators/HealingCalculatorPage.tsx` — wire auto-fill on ship select
- `src/pages/calculators/SpeedCalculatorPage.tsx` — wire self-buffs only on ship select
- `src/components/calculator/GameBuffPicker.tsx` — render "from skill" badge on auto-filled entries
