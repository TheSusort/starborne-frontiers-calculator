# Ship Kit Correctness Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible trace-bundle harness (skill text + parsed abilities + real combat-log) over all 147 ships, then run a batched review→escalate→adversarial-verify Workflow that produces a ranked, verified ship-kit correctness ledger.

**Architecture:** A set of headless `scripts/` modules (siblings to `auditSkills.ts`) build a per-ship "kit bundle". A standardized `simulateBattle` scenario runs each reviewed ship as the focus actor against a fixed roster; the mature combat log (`LOG_EVENT_TYPES`) is the execution oracle. A Workflow fans the 147 ships across review subagents, escalates untriggered/wrong-exec branches to forced micro-scenarios, adversarially verifies every candidate finding, and emits the ledger. This project ends at the ledger — fixes are scoped separately.

**Tech Stack:** TypeScript, `tsx` (script runner), Vitest (harness smoke tests), the existing combat engine (`buildShipAbilities`, `simulateBattle`), the Workflow tool.

## Global Constraints

- **Skill-text source of truth:** `docs/ship-skills.csv` (tagged), NOT `src/constants/ships.ts`. Parsed abilities and the combat trace both derive from CSV text. Copy verbatim; do not re-word.
- **docs/ is gitignored.** Design/plan docs under `docs/superpowers/` are force-tracked (`git add -f`); the CSV and generated bundles/ledger are dev-only and NOT committed.
- **CSV-dependent tests must skip when the CSV is absent** (clean checkouts / CI) via a `csvAvailable()` guard — mirror `skillAuditCoverage.test.ts`.
- **Tests live under `src/**/__tests__/`** (vitest `include: ['src/**/*']`) and import script code by relative path (e.g. `../../../../scripts/...`), exactly like `skillAuditCoverage.test.ts`.
- **Never run `vitest -u`** and never touch golden snapshots. The golden audit spans the WHOLE `npm test`.
- **`.env` must be present** before running the full suite (husky pre-commit runs vitest); copy the main repo's `.env` into any worktree.
- **Refit resolution:** only the refit-active passive applies, resolved by `getShipSkillRows` (R4 needs ≥4 refits, R2 needs ≥2, else R0). Default trace = highest available passive (synthesize 4 refits); escalate to R0/R2 only when a ship's passives differ meaningfully.
- **Engine gotcha (must respect in scenario design):** giving ANY player-side ship an ally-targeted heal active flips `engine.ts`'s `dummyEnemyIsVestigial` gate to false and silently zeroes every player ship's `all-enemies` reactive against the real roster. Filler allies in the standard scenario therefore use enemy-targeted DAMAGE actives only. A reviewed ship that is itself a healer is flagged for escalation of any `all-enemies` reactive passive it carries.

---

## File Structure

- `scripts/lib/shipSkillCsv.ts` — **create.** Shared CSV primitives (`parseCsvLine`, `readCsvRecords`, `csvAvailable`) + `loadShipSkillRecords()` returning structured per-ship skill text. Consumed by `auditSkills.ts` (refactored to use it) and the harness.
- `scripts/lib/traceShipFactory.ts` — **create.** `buildTraceShip(name, opts)` merges CSV skill text + `SHIPS[name]` stats into a full `Ship`; `SHIP_DATA_BY_NAME` lookup.
- `scripts/lib/traceScenario.ts` — **create.** `buildStandardScenario(reviewed, overrides?)` → `BattleSimulationInput` (reviewed ship at focus + fixed fillers + fixed enemy roster); `ScenarioOverrides` type.
- `scripts/lib/kitBundle.ts` — **create.** `buildKitBundle(name, overrides?)` (text + parsed abilities + combat-log + per-clause observed labels) and `renderKitBundleMarkdown(bundle)`.
- `scripts/lib/kitLedger.ts` — **create.** `renderLedgerMarkdown(findings)` + `renderLedgerJson(findings)` from confirmed findings.
- `scripts/traceShip.ts` — **create.** CLI: `--all` or ship names + override flags → writes `docs/kit-bundles/<Name>.{json,md}`.
- `scripts/writeKitLedger.ts` — **create.** CLI: reads a findings JSON → writes `docs/ship-kit-correctness-ledger.{md,json}`.
- `scripts/auditSkills.ts` — **modify.** Delete its local `parseCsvLine`/`readCsvRecords`; import from `scripts/lib/shipSkillCsv.ts`. Behavior must stay identical (audit still reports 0 findings).
- Tests (create): `src/utils/abilities/__tests__/shipSkillCsv.test.ts`, `traceShipFactory.test.ts`, `traceScenario.test.ts`, `kitBundle.test.ts`, `kitLedger.test.ts` (co-located with existing audit tests).

---

### Task 1: Shared CSV reader

**Files:**
- Create: `scripts/lib/shipSkillCsv.ts`
- Modify: `scripts/auditSkills.ts` (remove local `parseCsvLine` + `readCsvRecords`; import from the lib)
- Test: `src/utils/abilities/__tests__/shipSkillCsv.test.ts`

**Interfaces:**
- Produces:
  - `parseCsvLine(line: string): string[]`
  - `readCsvRecords(raw: string): string[]`
  - `csvAvailable(csvPath?: string): boolean`
  - `interface ShipSkillRecord { name: string; active: string; charge: string; chargeCharge: number; passives: [string, string, string]; }`
  - `loadShipSkillRecords(csvPath?: string): ShipSkillRecord[]`
  - `const CSV_PATH = 'docs/ship-skills.csv'`

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/abilities/__tests__/shipSkillCsv.test.ts
import { describe, it, expect } from 'vitest';
import {
    parseCsvLine,
    csvAvailable,
    loadShipSkillRecords,
} from '../../../../scripts/lib/shipSkillCsv';

describe('shipSkillCsv', () => {
    it('parses a quoted field containing commas and escaped quotes', () => {
        expect(parseCsvLine('a,"b,c","d""e"')).toEqual(['a', 'b,c', 'd"e']);
    });

    it.skipIf(!csvAvailable())('loads structured records with a resolvable name', () => {
        const records = loadShipSkillRecords();
        expect(records.length).toBeGreaterThan(100);
        const aegis = records.find((r) => r.name === 'Aegis');
        expect(aegis).toBeDefined();
        expect(aegis!.active.length).toBeGreaterThan(0);
        expect(aegis!.passives).toHaveLength(3);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/utils/abilities/__tests__/shipSkillCsv.test.ts`
Expected: FAIL — cannot resolve `../../../../scripts/lib/shipSkillCsv`.

- [ ] **Step 3: Write the shared module**

Move the CSV primitives out of `auditSkills.ts` verbatim (the `parseCsvLine` and `readCsvRecords` functions — including the multi-line-record accumulation logic) and add the structured loader:

```ts
// scripts/lib/shipSkillCsv.ts
import { readFileSync, existsSync } from 'fs';

export const CSV_PATH = 'docs/ship-skills.csv';

// Verbatim copy from auditSkills.ts — handles quoted fields, escaped quotes, embedded commas.
export function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else inQuotes = false;
            } else cur += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') {
            fields.push(cur);
            cur = '';
        } else cur += c;
    }
    fields.push(cur);
    return fields;
}

// Verbatim copy from auditSkills.ts — accumulates physical lines until quotes balance so
// multi-line quoted passives (Centurion, Chimei, Curator, Enforcer, Graphite, Lingshe) survive.
export function readCsvRecords(raw: string): string[] {
    const physicalLines = raw.split('\n');
    const records: string[] = [];
    let buffer: string[] = [];
    let quoteCount = 0;
    for (const line of physicalLines) {
        buffer.push(line);
        quoteCount += (line.match(/"/g) ?? []).length;
        if (quoteCount % 2 === 0) {
            records.push(buffer.join('\n'));
            buffer = [];
        }
    }
    if (buffer.length) records.push(buffer.join('\n'));
    return records;
}

export function csvAvailable(csvPath: string = CSV_PATH): boolean {
    return existsSync(csvPath);
}

export interface ShipSkillRecord {
    name: string;
    active: string;
    charge: string;
    chargeCharge: number;
    passives: [string, string, string];
}

const clean = (s: string | undefined): string =>
    s && s !== 'null' && s.trim().length > 0 ? s : '';

export function loadShipSkillRecords(csvPath: string = CSV_PATH): ShipSkillRecord[] {
    // Header: name,active_skill_text,charge_skill_charge,charge_skill_text,
    //         first_passive_skill_text,second_passive_skill_text,third_passive_skill_text
    const records = readCsvRecords(readFileSync(csvPath, 'utf8'));
    const out: ShipSkillRecord[] = [];
    for (let i = 1; i < records.length; i++) {
        const f = parseCsvLine(records[i]);
        if (f.length < 7) continue;
        const [name, active, chargeCharge, charge, p1, p2, p3] = f;
        out.push({
            name: name.trim(),
            active: clean(active),
            charge: clean(charge),
            chargeCharge: Number(chargeCharge) || 0,
            passives: [clean(p1), clean(p2), clean(p3)],
        });
    }
    return out;
}
```

- [ ] **Step 4: Refactor `auditSkills.ts` to import from the lib**

In `scripts/auditSkills.ts`: delete the local `parseCsvLine` and `readCsvRecords` function definitions and the local `existsSync` CSV check; add at the top with the other imports:

```ts
import { parseCsvLine, readCsvRecords, csvAvailable, CSV_PATH } from './lib/shipSkillCsv';
```

Keep `auditSkills.ts`'s own `readShips()` (it builds the `{name, slots}` shape the audit rules need) — it now calls the imported `readCsvRecords`/`parseCsvLine`. If `auditSkills.ts` already exports a `csvAvailable`, re-export the lib's instead of redefining.

- [ ] **Step 5: Run harness test + verify the audit is unchanged**

Run: `npx vitest --run src/utils/abilities/__tests__/shipSkillCsv.test.ts`
Expected: PASS.

Run: `npm run audit:skills`
Expected: `Audited 147 ships → 0 findings.` (byte-identical to before this task).

Run: `npx vitest --run src/utils/abilities/__tests__/skillAuditCoverage.test.ts`
Expected: PASS (the audit regression guard still green).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/shipSkillCsv.ts scripts/auditSkills.ts src/utils/abilities/__tests__/shipSkillCsv.test.ts
git commit -m "refactor: extract shared ship-skill CSV reader for the kit-audit harness"
```

---

### Task 2: Trace-ship factory

**Files:**
- Create: `scripts/lib/traceShipFactory.ts`
- Test: `src/utils/abilities/__tests__/traceShipFactory.test.ts`

**Interfaces:**
- Consumes: `loadShipSkillRecords`, `csvAvailable` (Task 1); `SHIPS` (`src/constants/ships.ts`); `Ship`, `Refit` (`src/types/ship.ts`).
- Produces:
  - `type RefitLevel = 0 | 2 | 4`
  - `interface BuildTraceShipOpts { refitLevel?: RefitLevel; }`
  - `buildTraceShip(name: string, opts?: BuildTraceShipOpts): Ship | null` — null when `name` is not in `SHIPS` (no baseStats available → caller records HARNESS-ERROR).
  - `const SHIP_DATA_BY_NAME: Map<string, import('../../src/constants/ships').` ... (a `Map<string, ShipData>` keyed on display name).

Notes on construction:
- Skill text comes from the CSV record (authoritative). Stats/affinity/rarity/faction/role come from `SHIPS[key]`, matched **case-insensitively** (the CSV `name` column is inconsistently cased — `AEGIS`, `APEX` are all-caps while `Akula`, `Amartya` are mixed-case — but `ShipData.name` is always canonical mixed-case). Both the SHIPS lookup and the CSV-record lookup key on `name.toUpperCase()`.
- The returned `Ship.name` is the **canonical** `SHIPS` name (`data.name`, e.g. `Aegis`), NOT the raw CSV casing — so bundles/ledger use one consistent spelling regardless of whether the caller passed `AEGIS` or `Aegis`.
- `refits` is synthesized as an array of `refitLevel` empty objects (`[{}, {}, {}, {}]` for R4) so `getShipSkillRows` selects the intended passive tier. `refitLevel` defaults to 4.
- `baseStats` maps `ShipData` fields → `BaseStats` (`hp, attack, defence, hacking, security, crit=critRate, critDamage, speed`).

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/abilities/__tests__/traceShipFactory.test.ts
import { describe, it, expect } from 'vitest';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';

describe('buildTraceShip', () => {
    it.skipIf(!csvAvailable())('merges CSV skill text with SHIPS base stats', () => {
        const ship = buildTraceShip('Aegis');
        expect(ship).not.toBeNull();
        expect(ship!.name).toBe('Aegis');
        expect(ship!.baseStats.hp).toBeGreaterThan(0);
        expect(ship!.baseStats.attack).toBeGreaterThan(0);
        expect(ship!.affinity).toBe('antimatter');
        // CSV active text flows onto the ship (authoritative source).
        expect(ship!.activeSkillText).toContain('shield');
        // Default refit level 4 → four synthesized refits so R4 passive resolves if present.
        expect(ship!.refits).toHaveLength(4);
    });

    it('returns null for a name with no SHIPS base stats', () => {
        expect(buildTraceShip('NotARealShip_zzz')).toBeNull();
    });

    it.skipIf(!csvAvailable())('honours a lower refit level', () => {
        const r0 = buildTraceShip('Aegis', { refitLevel: 0 });
        expect(r0!.refits).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/utils/abilities/__tests__/traceShipFactory.test.ts`
Expected: FAIL — cannot resolve `traceShipFactory`.

- [ ] **Step 3: Write the factory**

```ts
// scripts/lib/traceShipFactory.ts
import type { Ship, Refit, ShipData } from '../../src/types/ship';
import { SHIPS } from '../../src/constants/ships';
import { loadShipSkillRecords, ShipSkillRecord } from './shipSkillCsv';

export type RefitLevel = 0 | 2 | 4;
export interface BuildTraceShipOpts {
    refitLevel?: RefitLevel;
}

// Keyed on the UPPERCASED name because the CSV name column is inconsistently cased
// (AEGIS/APEX all-caps vs Akula/Amartya mixed) while ShipData.name is canonical mixed-case.
export const SHIP_DATA_BY_NAME: Map<string, ShipData> = new Map(
    Object.values(SHIPS).map((d) => [d.name.toUpperCase(), d])
);

let recordCache: Map<string, ShipSkillRecord> | null = null;
function recordFor(name: string): ShipSkillRecord | undefined {
    if (!recordCache) {
        recordCache = new Map(loadShipSkillRecords().map((r) => [r.name.toUpperCase(), r]));
    }
    return recordCache.get(name.toUpperCase());
}

export function buildTraceShip(name: string, opts: BuildTraceShipOpts = {}): Ship | null {
    const data = SHIP_DATA_BY_NAME.get(name.toUpperCase());
    if (!data) return null;
    const rec = recordFor(name);
    const refitLevel = opts.refitLevel ?? 4;
    const refits: Refit[] = Array.from({ length: refitLevel }, () => ({}) as Refit);

    return {
        id: `trace:${data.name}`,
        name: data.name, // canonical SHIPS casing, not the raw CSV casing
        rarity: data.rarity ?? 'legendary',
        faction: data.faction ?? 'MPL',
        type: data.role ?? 'ATTACKER',
        affinity: data.affinity ?? 'antimatter',
        baseStats: {
            hp: data.hp ?? 200_000,
            attack: data.attack ?? 2000,
            defence: data.defense ?? 300,
            hacking: data.hacking ?? 200,
            security: data.security ?? 150,
            crit: data.critRate ?? 50,
            critDamage: data.critDamage ?? 150,
            speed: data.speed ?? 100,
        },
        equipment: {},
        implants: {},
        refits,
        // CSV skill text is authoritative; fall back to SHIPS text only if the CSV lacks a record.
        activeSkillText: rec?.active || data.activeSkillText,
        chargeSkillText: rec?.charge || data.chargeSkillText,
        chargeSkillCharge: rec?.chargeCharge ?? data.chargeSkillCharge ?? 0,
        firstPassiveSkillText: rec?.passives[0] || data.firstPassiveSkillText,
        secondPassiveSkillText: rec?.passives[1] || data.secondPassiveSkillText,
        thirdPassiveSkillText: rec?.passives[2] || data.thirdPassiveSkillText,
        activeTarget: data.activeTarget,
        activePattern: data.activePattern,
        chargedTarget: data.chargedTarget,
        chargedPattern: data.chargedPattern,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/utils/abilities/__tests__/traceShipFactory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/traceShipFactory.ts src/utils/abilities/__tests__/traceShipFactory.test.ts
git commit -m "feat: buildTraceShip merges CSV skill text with SHIPS base stats for the kit-audit harness"
```

---

### Task 3: Standardized scenario builder

**Files:**
- Create: `scripts/lib/traceScenario.ts`
- Test: `src/utils/abilities/__tests__/traceScenario.test.ts`

**Interfaces:**
- Consumes: `Ship` (`src/types/ship.ts`); `BattlePlacement`, `BattleSimulationInput`, `simulateBattle` (`src/utils/calculators/battleSimulator.ts`); `Position` (`src/types/encounters.ts`).
- Produces:
  - `interface ScenarioOverrides { rounds?: number; reviewedCrit?: number; reviewedHpScale?: number; enemyAttackScale?: number; enemyAffinity?: import('../../src/types/ship').AffinityName; includeFragileAlly?: boolean; }`
  - `buildStandardScenario(reviewed: Ship, overrides?: ScenarioOverrides): BattleSimulationInput`

Design (mirrors `simGoldenFixtures.ts`):
- Reviewed ship at **`M4`** (focus, `player[0]`), `statOverrides` copied from its `baseStats` (× `reviewedHpScale` on hp, `reviewedCrit` wins on crit when set).
- **Filler allies** (fixed): one ATTACKER (`M1`) + one DEFENDER with an on-attacked counter (`B4`), both with enemy-targeted **damage** actives only (never an ally-heal — respects the `dummyEnemyIsVestigial` gotcha). When `includeFragileAlly` is set, add a low-HP ATTACKER (`B1`) that dies early to fire on-ally-death triggers.
- **Fixed enemy roster:** three attackers across rows T/M/B (`T1/M1→use distinct cells/B1`) with real damage actives + one applying a debuff, tuned to (a) drop the reviewed ship's HP through gates and (b) plausibly kill the fragile ally, without one-round-lethality. Enemy attack × `enemyAttackScale` (default 1); first enemy's affinity set from `enemyAffinity` when provided.
- **Rounds:** default **30** (charge branches fire; multi-round DoT/reactive repeat).

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/abilities/__tests__/traceScenario.test.ts
import { describe, it, expect } from 'vitest';
import { buildStandardScenario } from '../../../../scripts/lib/traceScenario';
import { simulateBattle } from '../../../../src/utils/calculators/battleSimulator';
import type { Ship } from '../../../../src/types/ship';

const reviewed: Ship = {
    id: 'trace:Test',
    name: 'Test',
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    affinity: 'antimatter',
    baseStats: { hp: 250_000, attack: 3000, defence: 300, hacking: 220, security: 150, crit: 50, critDamage: 150, speed: 120 },
    equipment: {},
    implants: {},
    refits: [],
    activeSkillText: 'This Unit deals <unit-damage>120% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
};

describe('buildStandardScenario', () => {
    it('places the reviewed ship as the focus actor with fillers and enemies', () => {
        const input = buildStandardScenario(reviewed);
        expect(input.playerTeam[0].ship.name).toBe('Test');
        expect(input.playerTeam[0].position).toBe('M4');
        expect(input.playerTeam.length).toBeGreaterThanOrEqual(3);
        expect(input.enemyTeam.length).toBeGreaterThanOrEqual(3);
        expect(input.rounds).toBe(30);
    });

    it('produces a runnable battle with a non-empty combat log', () => {
        const result = simulateBattle(buildStandardScenario(reviewed));
        expect(result.combatLog.length).toBeGreaterThan(0);
        // The reviewed ship acted at least once (its active fired).
        const acted = result.combatLog.some((round) =>
            JSON.stringify(round).includes('Test')
        );
        expect(acted).toBe(true);
    });

    it('adds a fragile ally when requested', () => {
        const input = buildStandardScenario(reviewed, { includeFragileAlly: true });
        expect(input.playerTeam.length).toBe(4);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/utils/abilities/__tests__/traceScenario.test.ts`
Expected: FAIL — cannot resolve `traceScenario`.

- [ ] **Step 3: Write the scenario builder**

```ts
// scripts/lib/traceScenario.ts
import type { Ship } from '../../src/types/ship';
import type { AffinityName } from '../../src/types/ship';
import type { Position } from '../../src/types/encounters';
import type { BattlePlacement, BattleSimulationInput } from '../../src/utils/calculators/battleSimulator';

export interface ScenarioOverrides {
    rounds?: number;
    reviewedCrit?: number;
    reviewedHpScale?: number;
    enemyAttackScale?: number;
    enemyAffinity?: AffinityName;
    includeFragileAlly?: boolean;
}

const placement = (
    ship: Ship,
    position: Position,
    over: Partial<{ hp: number; crit: number; attack: number }> = {}
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: over.attack ?? ship.baseStats.attack,
        crit: over.crit ?? ship.baseStats.crit,
        critDamage: ship.baseStats.critDamage,
        defensePenetration: 0,
        hacking: ship.baseStats.hacking,
        security: ship.baseStats.security,
        defence: ship.baseStats.defence,
        hp: over.hp ?? ship.baseStats.hp,
        speed: ship.baseStats.speed,
    },
});

const fillerBase = (id: string, name: string, type: Ship['type'], stats: Partial<Ship['baseStats']>): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'MPL',
    type,
    affinity: 'antimatter',
    baseStats: {
        hp: 260_000, attack: 1500, defence: 300, hacking: 200, security: 150,
        crit: 50, critDamage: 150, speed: 100, ...stats,
    },
    equipment: {},
    implants: {},
    refits: [],
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

// Filler ally with an on-attacked counter (a real reactive to co-exist alongside the reviewed
// ship). Enemy-targeted damage active only — NEVER an ally-heal (dummyEnemyIsVestigial gotcha).
const counterAlly = (): Ship => ({
    ...fillerBase('trace-ally-counter', 'CounterAlly', 'DEFENDER', { attack: 1200, defence: 500, speed: 95 }),
    firstPassiveSkillText:
        'When this Unit is directly damaged as a primary target, it deals <unit-damage>70% damage</unit-damage> to that enemy.',
});

const plainAlly = (): Ship => fillerBase('trace-ally-plain', 'PlainAlly', 'ATTACKER', { attack: 1800, speed: 110 });

const fragileAlly = (): Ship =>
    fillerBase('trace-ally-fragile', 'FragileAlly', 'ATTACKER', { hp: 40_000, defence: 100, speed: 105 });

const enemyAttacker = (id: string, name: string, affinity: AffinityName, attack: number): Ship => ({
    ...fillerBase(id, name, 'ATTACKER', { attack, hp: 240_000, speed: 100 }),
    affinity,
});

const enemyDebuffer = (id: string, name: string, attack: number): Ship => ({
    ...fillerBase(id, name, 'ATTACKER', { attack, hp: 240_000, speed: 105, hacking: 260 }),
    activeSkillText:
        'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.',
});

export function buildStandardScenario(reviewed: Ship, overrides: ScenarioOverrides = {}): BattleSimulationInput {
    const hpScale = overrides.reviewedHpScale ?? 1;
    const atkScale = overrides.enemyAttackScale ?? 1;
    const enemyAff = overrides.enemyAffinity ?? 'chemical';

    const playerTeam: BattlePlacement[] = [
        placement(reviewed, 'M4', {
            hp: Math.round(reviewed.baseStats.hp * hpScale),
            crit: overrides.reviewedCrit ?? reviewed.baseStats.crit,
        }),
        placement(plainAlly(), 'M1'),
        placement(counterAlly(), 'B4'),
    ];
    if (overrides.includeFragileAlly) playerTeam.push(placement(fragileAlly(), 'B1'));

    const enemyTeam: BattlePlacement[] = [
        placement(enemyAttacker('trace-e-1', 'EnemyA', enemyAff, Math.round(1600 * atkScale)), 'T1'),
        placement(enemyDebuffer('trace-e-2', 'EnemyB', Math.round(1600 * atkScale)), 'M2'),
        placement(enemyAttacker('trace-e-3', 'EnemyC', 'electric', Math.round(1500 * atkScale)), 'B2'),
    ];

    return { playerTeam, enemyTeam, rounds: overrides.rounds ?? 30 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/utils/abilities/__tests__/traceScenario.test.ts`
Expected: PASS.

If the "reviewed ship acted" assertion fails, the reviewed ship's `activeTarget`/`activePattern` may be undefined for a real ship whose CSV row lacks targeting — that is handled in Task 4 (the CLI supplies targeting fallbacks); this synthetic-ship test already sets them.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/traceScenario.ts src/utils/abilities/__tests__/traceScenario.test.ts
git commit -m "feat: standardized battle scenario builder for the kit-audit harness"
```

---

### Task 4: Kit-bundle builder + observed-clause labeler

**Files:**
- Create: `scripts/lib/kitBundle.ts`
- Test: `src/utils/abilities/__tests__/kitBundle.test.ts`

**Interfaces:**
- Consumes: `buildTraceShip` (Task 2); `buildStandardScenario`, `ScenarioOverrides` (Task 3); `getShipSkillRows` (`src/utils/ship/skillRows.ts`); `buildShipAbilities` (`src/utils/abilities/buildShipAbilities.ts`); `simulateBattle` (`src/utils/calculators/battleSimulator.ts`); `Ability` (`src/types/abilities.ts`).
- Also consumes: `CombatLogRound`, `CombatLogEntry`, `CombatLogEntryKind` (`src/utils/combat/log/types.ts`).
- Produces:
  - `interface ClauseTrace { slot: string; type: string; target?: string; trigger?: string; summary: string; observed: boolean; }`
  - `interface KitBundle { name: string; refitLevel: number; skillRows: { label: string; text: string }[]; abilities: ClauseTrace[]; combatLog: CombatLogRound[]; outcome: unknown; }`
  - `type KitBundleResult = KitBundle | { name: string; error: string };`
  - `buildKitBundle(name: string, overrides?: ScenarioOverrides & { refitLevel?: 0 | 2 | 4 }): KitBundleResult`
  - `renderKitBundleMarkdown(bundle: KitBundleResult): string`
  - `const ABILITY_TYPE_TO_LOG_KINDS: Record<string, CombatLogEntryKind[]>`

**CRITICAL — combat-log structure (confirmed against `src/utils/combat/log/types.ts`):** the log is `CombatLogRound[]`, each round has `startOfRound: CombatLogEntry[]`, `turns: CombatLogTurn[]` (each turn `{ actorId, entries: CombatLogEntry[] }`), and `endOfRound: CombatLogEntry[]`. Every `CombatLogEntry` carries `{ kind: CombatLogEntryKind, actorId, targets, reactions: CombatLogEntry[] }` — entries key on **`actorId`, never a ship name**. The reviewed ship is ALWAYS `player[0]` → the reserved focus id `'attacker'` (minted by `simulateBattle`). So the observed-labeler walks the log, collects the `kind`s of every entry whose `actorId === 'attacker'` (recursing into nested `reactions` — reactive/counter/start-and-end-of-round procs land there), and marks an ability `observed` when that kind-set intersects `ABILITY_TYPE_TO_LOG_KINDS[ability.type]`. Do NOT substring-search a ship name — the name never appears in the log. This is a routing aid for escalation; the reviewer makes the actual correctness judgment.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/abilities/__tests__/kitBundle.test.ts
import { describe, it, expect } from 'vitest';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { buildKitBundle, renderKitBundleMarkdown } from '../../../../scripts/lib/kitBundle';

describe('buildKitBundle', () => {
    it('returns an error record for an unknown ship', () => {
        const b = buildKitBundle('NotARealShip_zzz');
        expect('error' in b).toBe(true);
    });

    it.skipIf(!csvAvailable())('produces all three sections for a real ship', () => {
        const b = buildKitBundle('Aegis');
        expect('error' in b).toBe(false);
        if ('error' in b) return;
        expect(b.skillRows.length).toBeGreaterThan(0);
        expect(b.abilities.length).toBeGreaterThan(0);
        expect(b.combatLog.length).toBeGreaterThan(0);
        // At least one clause was observed executing in the standardized scenario.
        expect(b.abilities.some((a) => a.observed)).toBe(true);
    });

    it.skipIf(!csvAvailable())('renders markdown with the three section headers', () => {
        const md = renderKitBundleMarkdown(buildKitBundle('Aegis'));
        expect(md).toContain('## Skill text');
        expect(md).toContain('## Parsed abilities');
        expect(md).toContain('## Execution trace');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/utils/abilities/__tests__/kitBundle.test.ts`
Expected: FAIL — cannot resolve `kitBundle`.

- [ ] **Step 3: Write the bundle builder**

```ts
// scripts/lib/kitBundle.ts
import { buildTraceShip } from './traceShipFactory';
import { buildStandardScenario, ScenarioOverrides } from './traceScenario';
import { getShipSkillRows } from '../../src/utils/ship/skillRows';
import { buildShipAbilities } from '../../src/utils/abilities/buildShipAbilities';
import { simulateBattle } from '../../src/utils/calculators/battleSimulator';
import type { Ability } from '../../src/types/abilities';
import type { CombatLogRound, CombatLogEntry, CombatLogEntryKind } from '../../src/utils/combat/log/types';

// The reviewed ship is always player[0], whose engine actor id is the reserved 'attacker'.
const FOCUS_ACTOR_ID = 'attacker';

// Maps a parsed ability's `type` to the combat-log entry `kind`s it would produce when it fires.
export const ABILITY_TYPE_TO_LOG_KINDS: Record<string, CombatLogEntryKind[]> = {
    damage: ['attack'],
    counter: ['attack'],
    'additional-damage': ['attack'],
    heal: ['heal'],
    shield: ['shield'],
    buff: ['buff'],
    debuff: ['debuff', 'debuff-resisted'],
    dot: ['dot-applied', 'dot-ticked'],
    control: ['control'],
    cleanse: ['cleanse'],
    purge: ['purge'],
    charge: ['charge-changed'],
    modifier: ['buff'],
};

export interface ClauseTrace {
    slot: string;
    type: string;
    target?: string;
    trigger?: string;
    summary: string;
    observed: boolean;
}
export interface KitBundle {
    name: string;
    refitLevel: number;
    skillRows: { label: string; text: string }[];
    abilities: ClauseTrace[];
    combatLog: CombatLogRound[];
    outcome: unknown;
}
export type KitBundleResult = KitBundle | { name: string; error: string };

const TARGETING_FALLBACK = { activeTarget: 'front', activePattern: 'Pattern-Base' };

// Collect the entry kinds of every log entry whose actor is `actorId`, recursing into nested
// reactions (counters / start-and-end-of-round procs land there). Entries key on actorId, never
// a ship name — so the reviewed ship is found by its reserved focus id, not by its display name.
function collectActorEntryKinds(log: CombatLogRound[], actorId: string): Set<CombatLogEntryKind> {
    const kinds = new Set<CombatLogEntryKind>();
    const visit = (entries: CombatLogEntry[]): void => {
        for (const e of entries) {
            if (e.actorId === actorId) kinds.add(e.kind);
            if (e.reactions?.length) visit(e.reactions);
        }
    };
    for (const round of log) {
        visit(round.startOfRound ?? []);
        for (const turn of round.turns ?? []) visit(turn.entries ?? []);
        visit(round.endOfRound ?? []);
    }
    return kinds;
}

export function buildKitBundle(
    name: string,
    overrides: ScenarioOverrides & { refitLevel?: 0 | 2 | 4 } = {}
): KitBundleResult {
    const ship = buildTraceShip(name, { refitLevel: overrides.refitLevel });
    if (!ship) return { name, error: 'no SHIPS base stats for this name' };
    // Supply targeting fallbacks so the reviewed ship's active resolves a victim in the sim.
    if (!ship.activeTarget) ship.activeTarget = TARGETING_FALLBACK.activeTarget;
    if (!ship.activePattern) ship.activePattern = TARGETING_FALLBACK.activePattern;

    const skillRows = getShipSkillRows(ship).map((r) => ({ label: r.label, text: r.text }));
    const built = buildShipAbilities(ship);
    const allAbilities: { slot: string; ability: Ability }[] = built.slots.flatMap((s) =>
        s.abilities.map((ability) => ({ slot: s.slot, ability }))
    );

    let combatLog: CombatLogRound[] = [];
    let outcome: unknown = null;
    try {
        const result = simulateBattle(buildStandardScenario(ship, overrides));
        combatLog = result.combatLog;
        outcome = result.outcome;
    } catch (e) {
        return { name, error: `simulateBattle threw: ${(e as Error).message}` };
    }

    // Kinds the reviewed ship (focus actor) actually produced in this scenario.
    const focusKinds = collectActorEntryKinds(combatLog, FOCUS_ACTOR_ID);
    const abilities: ClauseTrace[] = allAbilities.map(({ slot, ability }) => {
        const expectedKinds = ABILITY_TYPE_TO_LOG_KINDS[ability.type] ?? [];
        return {
            slot,
            type: ability.type,
            target: (ability as { target?: string }).target,
            trigger: ability.trigger,
            summary: JSON.stringify(ability.config),
            observed: expectedKinds.some((k) => focusKinds.has(k)),
        };
    });

    return { name: ship.name, refitLevel: overrides.refitLevel ?? 4, skillRows, abilities, combatLog, outcome };
}

export function renderKitBundleMarkdown(bundle: KitBundleResult): string {
    if ('error' in bundle) return `# ${bundle.name}\n\n**HARNESS-ERROR:** ${bundle.error}\n`;
    const rows = bundle.skillRows.map((r) => `- **${r.label}:** ${r.text}`).join('\n');
    const abils = bundle.abilities
        .map((a) => `- [${a.observed ? 'x' : ' '}] \`${a.slot}\` **${a.type}** (target=${a.target ?? '-'}, trigger=${a.trigger ?? '-'}) — ${a.summary}`)
        .join('\n');
    return [
        `# ${bundle.name} (refit R${bundle.refitLevel})`,
        `\n## Skill text\n\n${rows}`,
        `\n## Parsed abilities\n\n_(checkbox = observed executing in the standardized scenario)_\n\n${abils}`,
        `\n## Execution trace\n\nOutcome: \`${JSON.stringify(bundle.outcome)}\`\n\n\`\`\`json\n${JSON.stringify(bundle.combatLog, null, 2)}\n\`\`\``,
    ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/utils/abilities/__tests__/kitBundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/kitBundle.ts src/utils/abilities/__tests__/kitBundle.test.ts
git commit -m "feat: kit-bundle builder (text + parsed abilities + combat-log trace) for the kit audit"
```

---

### Task 5: traceShip CLI + ledger writer

**Files:**
- Create: `scripts/traceShip.ts`
- Create: `scripts/lib/kitLedger.ts`
- Create: `scripts/writeKitLedger.ts`
- Test: `src/utils/abilities/__tests__/kitLedger.test.ts`
- Modify: `package.json` (add `trace:ship` and `audit:kit-ledger` scripts)

**Interfaces:**
- Consumes: `buildKitBundle`, `renderKitBundleMarkdown` (Task 4); `loadShipSkillRecords`, `csvAvailable` (Task 1).
- Produces (kitLedger):
  - `interface Finding { ship: string; slot: string; layer: 'parser' | 'executor' | 'both'; verdict: 'WRONG-PARSE' | 'WRONG-EXEC' | 'MISSING'; expected: string; observed: string; severity: 'high' | 'med' | 'low'; fixPointer: string; }`
  - `interface LedgerInput { shipsAudited: number; clausesReviewed: number; findings: Finding[]; refuted: number; untriggeredVerified: number; }`
  - `renderLedgerMarkdown(input: LedgerInput): string`
  - `renderLedgerJson(input: LedgerInput): string`

The `traceShip.ts` CLI iterates `--all` (every CSV record name) or the named ships, calls `buildKitBundle`, and writes `docs/kit-bundles/<Name>.json` + `<Name>.md` (creating the dir). This is a plain CLI (no unit test beyond the kitBundle test); its smoke check is Step 4 below.

- [ ] **Step 1: Write the failing ledger test**

```ts
// src/utils/abilities/__tests__/kitLedger.test.ts
import { describe, it, expect } from 'vitest';
import { renderLedgerMarkdown, renderLedgerJson, LedgerInput } from '../../../../scripts/lib/kitLedger';

const input: LedgerInput = {
    shipsAudited: 147,
    clausesReviewed: 500,
    refuted: 3,
    untriggeredVerified: 12,
    findings: [
        { ship: 'Zeta', slot: 'charged', layer: 'parser', verdict: 'WRONG-PARSE', expected: 'heal 30%', observed: 'heal 20%', severity: 'high', fixPointer: 'skillTextParser.ts' },
        { ship: 'Alpha', slot: 'passive', layer: 'executor', verdict: 'MISSING', expected: 'on-ally-death buff', observed: 'never fires', severity: 'low', fixPointer: 'combat/triggers.ts' },
    ],
};

describe('kitLedger', () => {
    it('ranks findings high → low in the markdown', () => {
        const md = renderLedgerMarkdown(input);
        expect(md.indexOf('Zeta')).toBeLessThan(md.indexOf('Alpha'));
        expect(md).toContain('147');
        expect(md).toContain('| Zeta |');
    });

    it('emits valid JSON with the same finding count', () => {
        const parsed = JSON.parse(renderLedgerJson(input));
        expect(parsed.findings).toHaveLength(2);
        expect(parsed.shipsAudited).toBe(147);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/utils/abilities/__tests__/kitLedger.test.ts`
Expected: FAIL — cannot resolve `kitLedger`.

- [ ] **Step 3: Write kitLedger, the CLIs, and package.json scripts**

```ts
// scripts/lib/kitLedger.ts
export interface Finding {
    ship: string;
    slot: string;
    layer: 'parser' | 'executor' | 'both';
    verdict: 'WRONG-PARSE' | 'WRONG-EXEC' | 'MISSING';
    expected: string;
    observed: string;
    severity: 'high' | 'med' | 'low';
    fixPointer: string;
}
export interface LedgerInput {
    shipsAudited: number;
    clausesReviewed: number;
    findings: Finding[];
    refuted: number;
    untriggeredVerified: number;
}

const RANK: Record<Finding['severity'], number> = { high: 0, med: 1, low: 2 };

export function renderLedgerMarkdown(input: LedgerInput): string {
    const sorted = [...input.findings].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    const bySev = (s: Finding['severity']) => input.findings.filter((f) => f.severity === s).length;
    const rows = sorted
        .map((f) => `| ${f.ship} | ${f.slot} | ${f.layer} | ${f.verdict} | ${f.severity} | ${f.expected} | ${f.observed} | ${f.fixPointer} |`)
        .join('\n');
    return [
        `# Ship Kit Correctness Ledger`,
        ``,
        `- Ships audited: **${input.shipsAudited}**`,
        `- Clauses reviewed: **${input.clausesReviewed}**`,
        `- Confirmed findings: **${input.findings.length}** (high ${bySev('high')} / med ${bySev('med')} / low ${bySev('low')})`,
        `- Candidates refuted in verify: **${input.refuted}**`,
        `- Untriggered clauses verified clean via escalation: **${input.untriggeredVerified}**`,
        ``,
        `| Ship | Slot | Layer | Verdict | Severity | Expected | Observed | Fix pointer |`,
        `| --- | --- | --- | --- | --- | --- | --- | --- |`,
        rows,
        ``,
    ].join('\n');
}

export function renderLedgerJson(input: LedgerInput): string {
    return JSON.stringify(input, null, 2);
}
```

```ts
// scripts/traceShip.ts
/* eslint-disable no-console */
import { mkdirSync, writeFileSync } from 'fs';
import { loadShipSkillRecords, csvAvailable } from './lib/shipSkillCsv';
import { buildKitBundle, renderKitBundleMarkdown } from './lib/kitBundle';

const OUT_DIR = 'docs/kit-bundles';

function main() {
    if (!csvAvailable()) {
        console.error('docs/ship-skills.csv not found — nothing to trace.');
        process.exit(1);
    }
    const args = process.argv.slice(2);
    const names = args.includes('--all')
        ? loadShipSkillRecords().map((r) => r.name)
        : args.filter((a) => !a.startsWith('--'));
    if (names.length === 0) {
        console.error('Usage: npm run trace:ship -- --all | <ShipName> [<ShipName> ...]');
        process.exit(1);
    }
    mkdirSync(OUT_DIR, { recursive: true });
    let errors = 0;
    for (const name of names) {
        const bundle = buildKitBundle(name);
        if ('error' in bundle) errors++;
        const safe = name.replace(/[^\w-]/g, '_');
        writeFileSync(`${OUT_DIR}/${safe}.json`, JSON.stringify(bundle, null, 2));
        writeFileSync(`${OUT_DIR}/${safe}.md`, renderKitBundleMarkdown(bundle));
    }
    console.log(`Wrote ${names.length} kit bundles to ${OUT_DIR}/ (${errors} harness errors).`);
}
main();
```

```ts
// scripts/writeKitLedger.ts
/* eslint-disable no-console */
import { readFileSync, writeFileSync } from 'fs';
import { renderLedgerMarkdown, renderLedgerJson, LedgerInput } from './lib/kitLedger';

function main() {
    const inPath = process.argv[2];
    if (!inPath) {
        console.error('Usage: npm run audit:kit-ledger -- <findings.json>');
        process.exit(1);
    }
    const input = JSON.parse(readFileSync(inPath, 'utf8')) as LedgerInput;
    writeFileSync('docs/ship-kit-correctness-ledger.md', renderLedgerMarkdown(input));
    writeFileSync('docs/ship-kit-correctness-ledger.json', renderLedgerJson(input));
    console.log('Wrote docs/ship-kit-correctness-ledger.{md,json}');
}
main();
```

In `package.json` `"scripts"`, add alongside `audit:skills`:

```json
"trace:ship": "tsx scripts/traceShip.ts",
"audit:kit-ledger": "tsx scripts/writeKitLedger.ts"
```

- [ ] **Step 4: Run ledger test + a CLI smoke check**

Run: `npx vitest --run src/utils/abilities/__tests__/kitLedger.test.ts`
Expected: PASS.

Run: `npm run trace:ship -- Aegis Akula`
Expected: `Wrote 2 kit bundles to docs/kit-bundles/ (0 harness errors).` and `docs/kit-bundles/Aegis.md` exists with the three section headers.

- [ ] **Step 5: Commit**

```bash
git add scripts/traceShip.ts scripts/writeKitLedger.ts scripts/lib/kitLedger.ts src/utils/abilities/__tests__/kitLedger.test.ts package.json
git commit -m "feat: traceShip CLI + kit-correctness ledger writer"
```

---

### Task 6: Author and run the audit Workflow, then write the ledger

This task produces the deliverable. It is an **execution task** (no TDD cycle): it (1) generates all bundles, (2) runs a review→escalate→verify Workflow over them, (3) assembles the findings JSON, (4) writes the ledger. Requires explicit Workflow opt-in (already given during brainstorming).

**Files:**
- Uses: `scripts/traceShip.ts`, `scripts/writeKitLedger.ts` (Task 5).
- Produces (dev-only, not committed): `docs/kit-bundles/*.{json,md}`, `docs/ship-kit-correctness-ledger.{md,json}`.

- [ ] **Step 1: Generate all kit bundles**

Run: `npm run trace:ship -- --all`
Expected: `Wrote 147 kit bundles to docs/kit-bundles/ (N harness errors).` Record N and the erroring ship names (they become HARNESS-ERROR rows in the ledger, not silent skips).

- [ ] **Step 2: Verify the full test suite is green before the audit run**

Run: `npm test`
Expected: all green (baseline confirmed; `.env` present per Global Constraints).

- [ ] **Step 3: Author and run the review Workflow**

Invoke the `Workflow` tool with a script that:
- **Batch/pipeline stage** — reads the 147 bundle markdown files (batched ~10–12 per review agent), each agent given `docs/combat-system.md` + the locked game-rules reference (combat-realism memory). Each agent emits, per clause, a `{verdict, layer, expected, observed, severity}` record using the Task 4 verdict taxonomy. Schema-constrained output.
- **Escalation stage** — for every `UNTRIGGERED` and `WRONG-EXEC` record, re-run `buildKitBundle` with scenario overrides (`reviewedHpScale: 0.1` to force low-HP gates, `reviewedCrit: 100` to force crits, `includeFragileAlly: true` for on-ally-death, `enemyAffinity`/`refitLevel` as needed) and re-verdict.
- **Verify stage** — every surviving `WRONG-PARSE`/`WRONG-EXEC`/`MISSING` candidate goes to a fresh adversarial agent tasked to REFUTE it (default "not a bug" when uncertain). Only survivors are kept, tagged `CONFIRMED`; refuted ones counted into `refuted`.
- **Return** — a `LedgerInput` object (`shipsAudited`, `clausesReviewed`, `findings`, `refuted`, `untriggeredVerified`).

Write the returned object to `docs/kit-findings.json`.

- [ ] **Step 4: Write the ledger**

Run: `npm run audit:kit-ledger -- docs/kit-findings.json`
Expected: `Wrote docs/ship-kit-correctness-ledger.{md,json}`.

- [ ] **Step 5: Orchestrator spot-check of confirmed findings**

Manually verify a sample of `high`-severity findings against the ship's CSV text + a fresh `buildKitBundle` run (the false-positive guard — memory warns agent audit findings can be stale-doc/mis-read false positives). Downgrade or drop any that don't reproduce; note the spot-check in the ledger summary.

- [ ] **Step 6: Present the ledger**

Surface `docs/ship-kit-correctness-ledger.md` to the user (SendUserFile) as the deliverable. Do NOT commit generated bundles/ledger (docs/ is gitignored; these are dev-only). Fixes for confirmed findings are scoped as a separate follow-up effort.

---

## Self-Review

**Spec coverage:**
- Trace-bundle harness (text + parsed abilities + combat-log) → Tasks 2–4. ✓
- Standardized scenario, reviewed ship as focus, fixed roster, ~30 rounds, charge fires → Task 3. ✓
- Refit-active resolution + default highest passive → Task 2 (`refitLevel` default 4) + Global Constraints. ✓
- Batch → per-clause verdict taxonomy → escalate → adversarial verify → Task 6 Step 3 + Task 4 taxonomy. ✓
- Ledger `.md` + `.json`, ranked, summary, HARNESS-ERROR rows, suggested-fix pointer → Task 5 + Task 6 Steps 1/4. ✓
- CSV = source of truth; docs gitignored; CSV-absent test skips; no `vitest -u`; `.env` for suite → Global Constraints. ✓
- Engine `dummyEnemyIsVestigial` gotcha respected in scenario (fillers never heal) → Task 3 design + Global Constraints. ✓
- Analysis-only scope (fixes separate) → Task 6 Step 6. ✓

**Placeholder scan:** No TBD/TODO; every code step carries complete code; no "similar to Task N" references. ✓

**Type consistency:** `ShipSkillRecord`, `buildTraceShip`, `ScenarioOverrides`, `buildStandardScenario`, `KitBundle`/`ClauseTrace`/`buildKitBundle`/`renderKitBundleMarkdown`, `Finding`/`LedgerInput`/`renderLedgerMarkdown`/`renderLedgerJson` names are consistent across the tasks that define and consume them. `refitLevel` typed `0 | 2 | 4` in both `traceShipFactory` and `kitBundle`. ✓
