# Charge Manipulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model charge-manipulation effects (self charge gains parsed from skill text + a flat ally/supporter charge contribution) so the DPS calculator's charged skill fires on a realistic cadence.

**Architecture:** Feed extra charges into the existing per-round charge accumulator in `runSinglePass`. A new `parseChargeGain` parser auto-fills a `selfChargeGain` (amount + condition, reusing the conditional-condition machinery) from the attacker's own skill text; a flat manual `allyChargePerRound` represents supporters. Both accumulate every round; charged round resets to 0. A new global enemy-type input feeds the Thresh-style "if Defender" condition. No new damage slice — cadence changes redistribute existing damage.

**Tech Stack:** React 18, TypeScript, Vite, Vitest. Follows the established skill-parsed-mechanic pipeline (secondary damage, conditional scaling).

**Spec:** `docs/superpowers/specs/2026-05-31-charge-manipulation-design.md`

---

## File Structure

- `src/types/calculator.ts` — `EnemyBaseClass`, `ChargeGain`, extend `ConditionalCondition` + labels, extend `DPSShipConfig` + `autoFilledFields` union.
- `src/utils/skillTextParser.ts` — new `parseChargeGain` + a charge-specific condition classifier.
- `src/utils/__tests__/skillTextParser.test.ts` — parser tests.
- `src/utils/calculators/dpsSimulator.ts` — extend `DPSSimulationInput`, thread fields through `runSinglePass`, add the per-round charge-gain block.
- `src/utils/calculators/__tests__/dpsSimulator.test.ts` — cadence tests.
- `src/pages/calculators/DPSCalculatorPage.tsx` — auto-fill, seeding, `simulateDPS` call, updaters, global `enemyType` state.
- `src/components/calculator/CombatSettingsPanel.tsx` — enemy-type `Select`.
- `src/components/calculator/ShipConfigCard.tsx` — "Charge Manipulation" collapsible section + re-sync `useEffect`.
- `src/components/calculator/ShipConfigSummary.tsx` — charged-skill cadence line.
- `src/pages/DocumentationPage.tsx` + `src/constants/changelog.ts` — docs + changelog.

---

## Task 1: Types

**Files:**
- Modify: `src/types/calculator.ts`

- [ ] **Step 1: Extend `ConditionalCondition` and its labels**

In `src/types/calculator.ts`, change the `ConditionalCondition` union (currently lines 12-18) to add three variants, and add labels:

```ts
export type ConditionalCondition =
    | 'self-buff' // derivable
    | 'enemy-debuff' // derivable
    | 'enemy-buff' // manual
    | 'adjacent-ally' // manual
    | 'enemy-adjacent' // manual
    | 'enemy-destroyed' // manual
    | 'always' // unconditional / always-true under sim assumptions (charge gains)
    | 'self-crit' // derivable from crit rate (charge gains)
    | 'enemy-type'; // derivable from the global enemy-type input (charge gains)
```

Add to `CONDITIONAL_CONDITION_LABELS` (currently lines 28-35):

```ts
    always: 'every round',
    'self-crit': 'on critical hit',
    'enemy-type': 'when enemy matches type',
```

- [ ] **Step 2: Add `EnemyBaseClass` and `ChargeGain` types**

After the `ConditionalDamage` interface (around line 26), add:

```ts
export type EnemyBaseClass = 'Attacker' | 'Defender' | 'Debuffer' | 'Supporter';

export interface ChargeGain {
    amount: number; // charges per trigger (e.g. 1, 2)
    condition: ConditionalCondition;
    derivable: boolean; // true → read sim state; false → use manualCount
    manualCount?: number; // used when !derivable (default 1)
    requiredEnemyType?: EnemyBaseClass; // only for condition 'enemy-type'
}
```

- [ ] **Step 3: Extend `DPSShipConfig` and `autoFilledFields`**

In `DPSShipConfig` (around lines 120-130), after `startCharged: boolean;` add:

```ts
    selfChargeGain?: ChargeGain;
    allyChargePerRound?: number;
```

And extend the `autoFilledFields` Set union (lines 122-130) by adding `| 'selfChargeGain'`.

- [ ] **Step 4: Verify compile**

Run: `npm run lint`
Expected: PASS (no new errors). Type-only change; downstream `simulateDPS` call already omits these (optional fields).

- [ ] **Step 5: Commit**

```bash
git add src/types/calculator.ts
git commit -m "feat: add ChargeGain types for charge manipulation"
```

---

## Task 2: Parser — `parseChargeGain`

**Files:**
- Modify: `src/utils/skillTextParser.ts`
- Test: `src/utils/__tests__/skillTextParser.test.ts`

Reference siblings already in the file: `parseConditionalDamage` (~line 211), `mapConditionPhrase` (~line 180). Charge phrases in `docs/ship-skills.csv` are wrapped in `<unit-aid>…</unit-aid>` tags; conditions are plain text around them. Do NOT reuse `mapConditionPhrase` (it only handles "for each …" grammar).

- [ ] **Step 1: Write the failing tests**

Add to `src/utils/__tests__/skillTextParser.test.ts` (import `parseChargeGain` from `../skillTextParser`):

```ts
describe('parseChargeGain', () => {
    it('parses always-true (speed) self gain — Chakara', () => {
        const text =
            'This Unit deals <unit-damage>180% damage</unit-damage>. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'always',
            derivable: true,
        });
    });

    it('parses full-HP self gain as always-true — Cobalt', () => {
        const text =
            "This Unit <unit-aid>adds 1 charge</unit-aid> to its charged skill at the start of the turn if it is at full HP.";
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'always',
            derivable: true,
        });
    });

    it('parses enemy-buff threshold gain (manual) — Nuqtu', () => {
        const text =
            'If the target has 3 or more buffs, the Unit <unit-aid>gains 2 charges</unit-aid> to its Charged Skill.';
        expect(parseChargeGain(text)).toEqual({
            amount: 2,
            condition: 'enemy-buff',
            derivable: false,
        });
    });

    it('parses "equal to the number of buffs" per-buff gain — Rhodium', () => {
        const text =
            'Unit adds charges to the <unit-aid>Charged Skill</unit-aid> equal to the number of <unit-aid>Buffs</unit-aid> on the target.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'enemy-buff',
            derivable: false,
        });
    });

    it('parses enemy-type (Defender) gain and ignores the removal clause — Thresh', () => {
        const text =
            "If the target is a Defender, this Unit <unit-aid>removes 1 charge</unit-aid> from the enemy and <unit-aid>adds 1 charge</unit-aid> to this Unit's Charged Skill.";
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'enemy-type',
            derivable: true,
            requiredEnemyType: 'Defender',
        });
    });

    it('parses stealth condition as enemy-buff (manual) — Selenite', () => {
        const text =
            "If any target is <unit-aid>Stealthed</unit-aid>, it <unit-aid>adds 1 charge</unit-aid> to this Unit's Charged Skill.";
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'enemy-buff',
            derivable: false,
        });
    });

    it('parses "2 or more enemies" as enemy-adjacent (manual) — Tygr', () => {
        const text =
            'If it damages 2 or more enemies, it adds <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'enemy-adjacent',
            derivable: false,
        });
    });

    it('parses debuff-infliction as enemy-debuff (derivable) — Hemlock', () => {
        const text =
            'This Unit <unit-aid>gains 1 charge</unit-aid> to its charged skill after it inflicts a <unit-aid>debuff</unit-aid>.';
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'enemy-debuff',
            derivable: true,
        });
    });

    it('parses crit-based self gain as self-crit (derivable) — Asphodel', () => {
        const text =
            "This Unit's attacks are always critical and <unit-aid>adds 1 charge</unit-aid> to its Charged Skill after critically damaging an enemy.";
        expect(parseChargeGain(text)).toEqual({
            amount: 1,
            condition: 'self-crit',
            derivable: true,
        });
    });

    it('returns null for enemy charge removal — Demolisher', () => {
        const text =
            "When a bomb explodes on an enemy, this unit removes 2 charges from the enemy's charged skill.";
        expect(parseChargeGain(text)).toBeNull();
    });

    it('returns null for on-kill gain — Valiant', () => {
        const text =
            'This Unit <unit-aid>gains 1 charge</unit-aid> for its Charged Skill upon killing an enemy.';
        expect(parseChargeGain(text)).toBeNull();
    });

    it('returns null for ally-grant — Liberator', () => {
        const text =
            'When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills.';
        expect(parseChargeGain(text)).toBeNull();
    });

    it('returns null when there is no charge phrase', () => {
        expect(parseChargeGain('This Unit deals <unit-damage>140% damage</unit-damage>.')).toBeNull();
        expect(parseChargeGain('')).toBeNull();
        expect(parseChargeGain(null)).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- skillTextParser`
Expected: FAIL with "parseChargeGain is not a function" (or import error).

- [ ] **Step 3: Implement `parseChargeGain`**

Add to `src/utils/skillTextParser.ts` (import `ChargeGain`, `EnemyBaseClass` from `../types/calculator` alongside the existing `ConditionalDamage`, `ConditionalCondition` imports). Place after `parseConditionalDamage`.

**Key approach:** strip the `<unit-aid>` / `<unit-skill>` / `<unit-damage>` tags first, then match plain text. The tags wrap the amount in some skills (Chakara: `<unit-aid>adds 1 charge</unit-aid>`) but wrap the *nouns* in others (Rhodium: `<unit-aid>Charged Skill</unit-aid>` … `<unit-aid>Buffs</unit-aid>`), so tag-spanning regexes are brittle. Stripping tags makes both forms plain. Self-vs-removal is distinguished by the verb (`adds`/`gains` vs `removes`), not the tag.

> First check whether the file already has a tag-stripping helper near line 40 (there is a tag-matching comment there). If one exists, reuse it; otherwise add `stripUnitTags` below.

```ts
function stripUnitTags(text: string): string {
    return text.replace(/<\/?unit-(?:aid|skill|damage)>/gi, '');
}

// Phrases that disqualify a charge phrase from being a self-gain we model:
// ally-grant to others, on-kill (enemy never dies), enemy-repair (never repairs).
const CHARGE_DISQUALIFY_RE =
    /all allies|their charged skill|charged skill of all allies|upon killing|killing an enemy|when an enemy dies|when an enemy repairs|enemy performs a repair|enemy repairs/i;

// "adds/gains N charge(s)" (self-add). "removes" is excluded by the verb set, so
// Thresh's "removes 1 charge ... and adds 1 charge" matches only the add.
const SELF_CHARGE_ADD_RE = /\b(?:adds?|gains?)\s+(\d+|a|an)\s+charges?\b/i;

// Rhodium-style form: "adds charges to the Charged Skill equal to the number of
// buffs on the target" (amount is per-buff = 1). Runs on tag-stripped text.
const PER_BUFF_CHARGE_RE =
    /adds?\s+charges?\s+to\s+the\s+charged skill[^.]*equal to the number of/i;

function classifyChargeCondition(
    text: string // already tag-stripped, any case
): { condition: ConditionalCondition; derivable: boolean; requiredEnemyType?: EnemyBaseClass } {
    const p = text.toLowerCase();
    if (p.includes('is a defender'))
        return { condition: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' };
    if (p.includes('critically damag') || p.includes('critically hit'))
        return { condition: 'self-crit', derivable: true };
    if (p.includes('inflict') && p.includes('debuff'))
        return { condition: 'enemy-debuff', derivable: true };
    if (p.includes('stealth')) return { condition: 'enemy-buff', derivable: false };
    if (
        p.includes('buffs on the target') ||
        p.includes('buff on the target') ||
        p.includes('or more buffs') ||
        p.includes('buffs on the enemy') ||
        p.includes('number of buffs')
    )
        return { condition: 'enemy-buff', derivable: false };
    if (
        p.includes('2 or more enemies') ||
        p.includes('two or more enemies') ||
        p.includes('damages 2')
    )
        return { condition: 'enemy-adjacent', derivable: false };
    // speed / full-HP / lowest-speed and anything else → always-true under sim assumptions
    return { condition: 'always', derivable: true };
}

/**
 * Parses a self-targeted Charged-Skill charge gain from skill text. Returns null
 * for ally-grant, enemy-removal, on-kill, and enemy-repair phrasings (out of
 * scope or never-fire under the sim assumptions). Conditions are classified into
 * the (shared) ConditionalCondition set; `derivable` follows the same meaning as
 * ConditionalDamage. Reference data: docs/ship-skills.csv.
 */
export function parseChargeGain(text: string | null | undefined): ChargeGain | null {
    if (!text) return null;
    const plain = stripUnitTags(text);
    if (CHARGE_DISQUALIFY_RE.test(plain)) return null;

    // Rhodium "equal to the number of buffs" form (amount is per-buff = 1).
    if (PER_BUFF_CHARGE_RE.test(plain)) {
        return { amount: 1, condition: 'enemy-buff', derivable: false };
    }

    const m = SELF_CHARGE_ADD_RE.exec(plain);
    if (!m) return null;
    const raw = m[1].toLowerCase();
    const amount = raw === 'a' || raw === 'an' ? 1 : parseInt(raw, 10);
    if (!amount || isNaN(amount)) return null;

    const { condition, derivable, requiredEnemyType } = classifyChargeCondition(plain);
    return {
        amount,
        condition,
        derivable,
        ...(requiredEnemyType ? { requiredEnemyType } : {}),
    };
}
```

> Note for the test in Step 1: the Rhodium fixture's `<unit-aid>` tags around "Charged Skill"/"Buffs" are stripped before matching, so `PER_BUFF_CHARGE_RE` and the `number of buffs` classifier both hit. Verify mentally: stripped Rhodium = "Unit adds charges to the Charged Skill equal to the number of Buffs on the target." → matches `PER_BUFF_CHARGE_RE` → returns `{ amount: 1, condition: 'enemy-buff', derivable: false }`. ✓

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- skillTextParser`
Expected: PASS (all `parseChargeGain` cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat: parse charge-gain effects from skill text"
```

---

## Task 3: Simulator — charge-gain accumulation

**Files:**
- Modify: `src/utils/calculators/dpsSimulator.ts`
- Test: `src/utils/calculators/__tests__/dpsSimulator.test.ts`

- [ ] **Step 1: Extend `DPSSimulationInput`**

In `src/utils/calculators/dpsSimulator.ts`, import `ChargeGain` and `EnemyBaseClass` from `../../types/calculator` (alongside existing imports). Add to `DPSSimulationInput` (after `chargedConditional?`, ~line 55):

```ts
    /** Per-round self charge gain parsed from the attacker's skill text. */
    selfChargeGain?: ChargeGain;
    /** Flat extra charges per round contributed by allies/supporters. */
    allyChargePerRound?: number;
    /** Enemy base class, for the 'enemy-type' charge-gain condition. */
    enemyType?: EnemyBaseClass;
```

- [ ] **Step 2: Write the failing cadence tests**

Add to `src/utils/calculators/__tests__/dpsSimulator.test.ts`. Use the existing test convention (`crit: 100, critDamage: 0` → critMultiplier 1; `enemyDefense: 0`). Build a minimal input via the existing helper/pattern in that file (mirror an existing `simulateDPS({...})` test for required fields). The key field under test is the round `action` sequence.

```ts
describe('charge manipulation', () => {
    // Helper: indices (1-based round numbers) where the charged skill fired.
    const chargedRounds = (result: ReturnType<typeof simulateDPS>) =>
        result.rounds.filter((r) => r.action === 'charged').map((r) => r.round);

    const base = {
        attack: 1000,
        crit: 100,
        critDamage: 0,
        defensePenetration: 0,
        activeMultiplier: 100,
        chargedMultiplier: 200,
        chargeCount: 3,
        activeDoTs: [],
        chargedDoTs: [],
        enemyDefense: 0,
        enemyHp: 500000,
        rounds: 12,
        selfBuffs: [],
        enemyDebuffs: [],
    };

    it('baseline: charged fires once charges reach chargeCount (every 4th round for 3 charges)', () => {
        // R1..R3 bank +1 each → charges 1,2,3; R4 sees 3 → charged. Then repeats.
        const result = simulateDPS({ ...base });
        expect(chargedRounds(result)).toEqual([4, 8, 12]);
    });

    it('allyChargePerRound speeds up cadence', () => {
        // Per active round banks 1+1=2; charged round banks 0+1=1.
        // R1: 0<3 active → 2. R2: 2<3 active → 4. R3: 4>=3 charged → 0, +1 → 1.
        // R4: 1<3 active → 3. R5: 3>=3 charged → 0,+1 → 1. R6: active → 3. R7: charged...
        const result = simulateDPS({ ...base, allyChargePerRound: 1 });
        expect(chargedRounds(result)).toEqual([3, 5, 7, 9, 11]);
    });

    it('always-true self gain speeds up cadence', () => {
        const result = simulateDPS({
            ...base,
            selfChargeGain: { amount: 1, condition: 'always', derivable: true },
        });
        // Same accumulation as allyChargePerRound: 1 (active banks 1+1, charged banks 1).
        expect(chargedRounds(result)).toEqual([3, 5, 7, 9, 11]);
    });

    it('self-crit at 100% crit contributes +1/round', () => {
        const result = simulateDPS({
            ...base,
            selfChargeGain: { amount: 1, condition: 'self-crit', derivable: true },
        });
        expect(chargedRounds(result)).toEqual([3, 5, 7, 9, 11]);
    });

    it('enemy-type gain only applies when enemy type matches', () => {
        const gain = {
            amount: 1,
            condition: 'enemy-type' as const,
            derivable: true,
            requiredEnemyType: 'Defender' as const,
        };
        const matched = simulateDPS({ ...base, selfChargeGain: gain, enemyType: 'Defender' });
        const unmatched = simulateDPS({ ...base, selfChargeGain: gain, enemyType: 'Attacker' });
        expect(chargedRounds(matched)).toEqual([3, 5, 7, 9, 11]);
        expect(chargedRounds(unmatched)).toEqual([4, 8, 12]); // same as baseline
    });

    it('does nothing when there is no charged skill', () => {
        const result = simulateDPS({
            ...base,
            chargedMultiplier: 0,
            allyChargePerRound: 5,
        });
        expect(chargedRounds(result)).toEqual([]);
    });
});
```

> Note: confirm `base` includes every required `DPSSimulationInput` field by checking an existing test in the same file; add any missing required fields (e.g. it may already default optional ones). Re-derive the expected arrays by hand if the file's existing baseline test shows a different reset/increment timing than assumed here, then make the assertions match the actual semantics (do not loosen to "~every N").

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- dpsSimulator`
Expected: FAIL — charge-manipulation cases fail (cadence unchanged / fields ignored). The baseline test should PASS already (documents current behavior).

- [ ] **Step 4: Thread the fields into `runSinglePass`**

In `simulateDPS` (~line 483), destructure the three new fields from `input` and pass them into the `runSinglePass` call (mirror how `chargedConditional` is threaded ~lines 502-571). Add to `runSinglePass`'s params interface/destructure: `selfChargeGain?: ChargeGain`, `allyChargePerRound?: number`, `enemyType?: EnemyBaseClass`.

- [ ] **Step 5: Add the per-round charge-gain block**

In the round loop, immediately **after** the conditional-bonus block (the `conditionalBonusPct` computation, ~lines 332-352) and before Step 1 damage — so `effectiveCrit` (~line 294) and `landedEnemyDebuffs`/DoT arrays (~line 341) are in scope — add:

```ts
        // Charge manipulation: bonus charges accumulate every round (active and
        // charged). Charged round already reset charges to 0 at the top, so
        // post-fire rounds still bank bonus/ally charges. Gated on hasChargedSkill.
        if (hasChargedSkill) {
            let chargeGainCount = 0;
            if (selfChargeGain) {
                switch (selfChargeGain.condition) {
                    case 'always':
                        chargeGainCount = 1;
                        break;
                    case 'self-crit':
                        chargeGainCount = effectiveCrit / 100;
                        break;
                    case 'self-buff':
                        chargeGainCount = entry.activeSelfBuffs.filter(
                            (ab) => ab.stacks === undefined || ab.stacks > 0
                        ).length;
                        break;
                    case 'enemy-debuff':
                        chargeGainCount =
                            landedEnemyDebuffs.length +
                            corrosionEntries.length +
                            infernoEntries.length +
                            pendingBombs.length;
                        break;
                    case 'enemy-type':
                        chargeGainCount =
                            enemyType === selfChargeGain.requiredEnemyType ? 1 : 0;
                        break;
                    default:
                        // enemy-buff, enemy-adjacent, adjacent-ally, enemy-destroyed
                        chargeGainCount = selfChargeGain.manualCount ?? 1;
                        break;
                }
            }
            const bonusCharges = selfChargeGain ? chargeGainCount * selfChargeGain.amount : 0;
            charges += bonusCharges + (allyChargePerRound ?? 0);
        }
```

- [ ] **Step 6: Round charges for display**

Charges can now be fractional. In the `roundData.push({...})` (~line 428), change `charges,` to `charges: Math.round(charges),` so the timeline shows whole numbers.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- dpsSimulator`
Expected: PASS (baseline + all charge-manipulation cases). If a hand-derived array is off by the reset/increment timing, re-derive against the actual loop and correct the test — do not change the production semantics to match a guess.

- [ ] **Step 8: Run the full suite + lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/utils/calculators/dpsSimulator.ts src/utils/calculators/__tests__/dpsSimulator.test.ts
git commit -m "feat: accumulate manipulated charges in DPS sim"
```

---

## Task 4: Page wiring

**Files:**
- Modify: `src/pages/calculators/DPSCalculatorPage.tsx`

- [ ] **Step 1: Parse `selfChargeGain` in `buildSkillAutoFill`**

In `buildSkillAutoFill` (~line 43): import `parseChargeGain` and the `ChargeGain` / `EnemyBaseClass` types. Scan active + all passive skill texts (the gain is often on a passive, e.g. Hemlock/Asphodel/Cobalt) and take the first match. Seed `manualCount: 1` for non-derivable, mirroring `seedManual`:

```ts
    const seedChargeManual = (c: ChargeGain | null): ChargeGain | undefined => {
        if (!c) return undefined;
        return !c.derivable && c.manualCount === undefined ? { ...c, manualCount: 1 } : c;
    };
    const selfChargeGain = seedChargeManual(
        parseChargeGain(ship.activeSkillText) ??
            parseChargeGain(ship.firstPassiveSkillText) ??
            parseChargeGain(ship.secondPassiveSkillText) ??
            parseChargeGain(ship.thirdPassiveSkillText)
    );
```

Add `'selfChargeGain'` to the local `autoFilledFields` Set type union (lines 54-62), add `if (selfChargeGain) autoFilledFields.add('selfChargeGain');`, and add `selfChargeGain` to the returned object (lines 69-77).

- [ ] **Step 2: Seed in `getInitialConfig` (ship branch + default branch)**

In the ship branch (~lines 107-149): destructure `selfChargeGain` from `buildSkillAutoFill`, and add to the returned config object: `selfChargeGain,` and `allyChargePerRound: 0,`.

In the default (no-ship) branch (~lines 155-178): add `allyChargePerRound: 0,` to the config (leave `selfChargeGain` undefined).

- [ ] **Step 3: Add global `enemyType` state**

Near the other enemy state (`enemyDefense`/`enemyHp`/`enemySecurity`, ~lines 184-194), add:

```ts
    const [enemyType, setEnemyType] = useState<EnemyBaseClass | undefined>(undefined);
```

- [ ] **Step 4: Pass new fields into `simulateDPS`**

In the `simulateDPS({...})` call (~lines 271-298) add:

```ts
                    selfChargeGain: config.selfChargeGain,
                    allyChargePerRound: config.allyChargePerRound,
                    enemyType,
```

Add `enemyType` to the `simResults` `useMemo` dependency array (~lines 302-313).

- [ ] **Step 5: Seed in `selectShipForConfig`**

In `selectShipForConfig` (~lines 406-454): destructure `selfChargeGain` from `buildSkillAutoFill`, and in the returned merged config add `selfChargeGain,` (next to `activeConditional`). Leave `allyChargePerRound` as `c.allyChargePerRound ?? 0` to preserve any user value.

- [ ] **Step 6: Add updaters**

After `updateConfigConditional` (~line 550) add:

```ts
    const updateConfigChargeGain = (id: string, value: ChargeGain | undefined) => {
        setConfigs((prev) =>
            prev.map((c) => {
                if (c.id !== id) return c;
                const next = new Set(c.autoFilledFields);
                next.delete('selfChargeGain');
                return { ...c, selfChargeGain: value, autoFilledFields: next };
            })
        );
    };

    const updateConfigAllyCharge = (id: string, value: number) => {
        setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, allyChargePerRound: value } : c)));
    };
```

- [ ] **Step 7: Wire props into `<ShipConfigCard>` and `<CombatSettingsPanel>`**

On `<ShipConfigCard>` (~lines 663-702) add:

```tsx
                                onChargeGainChange={(value) =>
                                    updateConfigChargeGain(config.id, value)
                                }
                                onAllyChargeChange={(value) =>
                                    updateConfigAllyCharge(config.id, value)
                                }
```

On `<CombatSettingsPanel>` (~lines 629-657) add:

```tsx
                        enemyType={enemyType}
                        onEnemyTypeChange={setEnemyType}
```

- [ ] **Step 8: Verify build**

Run: `npm run lint`
Expected: errors only about the not-yet-added `ShipConfigCard` / `CombatSettingsPanel` props (resolved in Task 5). If other errors appear, fix them.

- [ ] **Step 9: Commit**

```bash
git add src/pages/calculators/DPSCalculatorPage.tsx
git commit -m "feat: wire charge manipulation into DPS calculator page"
```

---

## Task 5: UI — config card, combat panel, summary

**Files:**
- Modify: `src/components/calculator/CombatSettingsPanel.tsx`
- Modify: `src/components/calculator/ShipConfigCard.tsx`
- Modify: `src/components/calculator/ShipConfigSummary.tsx`

- [ ] **Step 1: Enemy-type selector in CombatSettingsPanel**

In `src/components/calculator/CombatSettingsPanel.tsx`: import `EnemyBaseClass` from `../../types/calculator`. Add to `CombatSettingsPanelProps`:

```ts
    enemyType?: EnemyBaseClass;
    onEnemyTypeChange: (v: EnemyBaseClass | undefined) => void;
```

Destructure them in the component. Near the enemy-affinity `Select` (~line 108), add a new `Select` (mirror the affinity one):

```tsx
                    <Select
                        label="Enemy Type"
                        value={enemyType ?? ''}
                        options={[
                            { value: '', label: 'Any / Unknown' },
                            { value: 'Attacker', label: 'Attacker' },
                            { value: 'Defender', label: 'Defender' },
                            { value: 'Debuffer', label: 'Debuffer' },
                            { value: 'Supporter', label: 'Supporter' },
                        ]}
                        onChange={(v) =>
                            onEnemyTypeChange(v === '' ? undefined : (v as EnemyBaseClass))
                        }
                    />
```

> Check the exact `Select` API used by the affinity selector in this file (options array vs children `<option>`) and match it.

- [ ] **Step 2: Charge Manipulation section in ShipConfigCard — props**

In `src/components/calculator/ShipConfigCard.tsx`: import `ChargeGain`, `EnemyBaseClass`, and `CONDITIONAL_CONDITION_LABELS` (already imported). Add to the props interface (near `onConditionalChange`, ~line 55):

```ts
    onChargeGainChange: (value: ChargeGain | undefined) => void;
    onAllyChargeChange: (value: number) => void;
```

Destructure both in the component signature.

- [ ] **Step 3: Re-sync open-state**

Add an `openCharge` state next to `openConditional` (~line 91):

```ts
    const [openCharge, setOpenCharge] = useState(
        Boolean(config.selfChargeGain || config.allyChargePerRound)
    );
```

Extend the existing re-sync `useEffect` (~lines 97-104) to also set it and add the deps:

```ts
        setOpenCharge(Boolean(config.selfChargeGain || config.allyChargePerRound));
```
deps add: `config.selfChargeGain, config.allyChargePerRound`.

- [ ] **Step 4: Charge Manipulation section markup**

After the Conditional Damage `CollapsibleForm` (closes ~line 448), add a sibling section mirroring it:

```tsx
                    <Button
                        variant="link"
                        onClick={() => setOpenCharge((v) => !v)}
                        className="w-full flex justify-between items-center mt-4"
                    >
                        <span className="flex items-center gap-2">
                            <ChevronDownIcon
                                className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${openCharge ? 'rotate-180' : ''}`}
                            />
                            Charge Manipulation
                        </span>
                    </Button>
                    <CollapsibleForm isVisible={openCharge}>
                        {config.selfChargeGain ? (
                            <div className="mb-4">
                                <div className="text-sm font-semibold mb-1">
                                    Self: +{config.selfChargeGain.amount} charge
                                    {config.selfChargeGain.amount !== 1 ? 's' : ''}/round{' '}
                                    {CONDITIONAL_CONDITION_LABELS[config.selfChargeGain.condition]}
                                </div>
                                {config.selfChargeGain.derivable ? (
                                    <p className="text-xs text-theme-text-secondary">
                                        Auto-counted each round from sim state.
                                    </p>
                                ) : (
                                    <Input
                                        label="Trigger count / round"
                                        type="number"
                                        min="0"
                                        value={config.selfChargeGain.manualCount ?? 1}
                                        helpLabel={
                                            config.autoFilledFields?.has('selfChargeGain')
                                                ? 'auto-filled'
                                                : undefined
                                        }
                                        onChange={(e) =>
                                            onChargeGainChange({
                                                ...config.selfChargeGain!,
                                                manualCount: parseInt(e.target.value) || 0,
                                            })
                                        }
                                    />
                                )}
                            </div>
                        ) : (
                            <p className="text-xs text-theme-text-secondary mb-2">
                                No self charge gain detected.
                            </p>
                        )}
                        <Input
                            label="Ally charges / round"
                            type="number"
                            min="0"
                            step="0.5"
                            value={config.allyChargePerRound ?? 0}
                            helpLabel="from supporters (e.g. Castor, Liberator)"
                            onChange={(e) =>
                                onAllyChargeChange(parseFloat(e.target.value) || 0)
                            }
                        />
                    </CollapsibleForm>
```

- [ ] **Step 5: Cadence line in ShipConfigSummary**

In `src/components/calculator/ShipConfigSummary.tsx`, after the Total Damage block (~line 66), add a charged-skill cadence line shown when a charged skill exists:

```tsx
            {config.chargedMultiplier > 0 && config.chargeCount > 0 && (
                <div className="flex justify-between mb-2">
                    <span className="text-theme-text-secondary">Charged skill fires:</span>
                    <span>
                        {(() => {
                            const fires = simResult.rounds.filter(
                                (r) => r.action === 'charged'
                            ).length;
                            return fires > 0
                                ? `every ${(simResult.rounds.length / fires).toFixed(1)} rounds`
                                : '—';
                        })()}
                    </span>
                </div>
            )}
```

- [ ] **Step 6: Build + lint**

Run: `npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Manual smoke test**

Run: `npm start`. Open the DPS calculator. Select a ship with a charge gain (e.g. Chakara, Cobalt, Thresh). Confirm: the "Charge Manipulation" section auto-opens and shows the parsed self gain; setting "Ally charges / round" or "Enemy Type" (for Thresh) changes the "Charged skill fires: every X rounds" line and the damage totals.

- [ ] **Step 8: Commit**

```bash
git add src/components/calculator/CombatSettingsPanel.tsx src/components/calculator/ShipConfigCard.tsx src/components/calculator/ShipConfigSummary.tsx
git commit -m "feat: charge manipulation UI section + enemy-type selector"
```

---

## Task 6: Docs + changelog

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Update in-app docs**

In `src/pages/DocumentationPage.tsx`, find the DPS calculator section and the "About the Simulation" prose (search "Conditional" / "Secondary" added in prior features). Add a short paragraph describing charge manipulation: self charge gains parsed from skill text (conditions auto-counted from sim state, or a manual trigger count), the flat "Ally charges / round" supporter input, the enemy-type selector, and that these change how often the charged skill fires.

- [ ] **Step 2: Add changelog entry**

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES` a plain-English entry, e.g.:

> "DPS calculator now models charge manipulation: ships that add charges to their Charged Skill (and supporter ships that feed charges to allies) make the charged skill fire sooner. Includes a new enemy-type selector for type-conditional charge gains."

- [ ] **Step 3: Build + lint**

Run: `npm run lint && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "docs: document charge manipulation in DPS calculator"
```

---

## Final verification

- [ ] Run `npm test` — all pass.
- [ ] Run `npm run lint` — zero warnings (max-warnings: 0).
- [ ] Manual: charge gain auto-fills for Chakara/Cobalt/Thresh/Nuqtu; ally-charge + enemy-type inputs shift cadence and totals; ships without a charged skill ignore the inputs.
- [ ] Update memory: mark charge manipulation shipped in `project_dps_skill_mechanic_pipeline.md` and pick the next target.
