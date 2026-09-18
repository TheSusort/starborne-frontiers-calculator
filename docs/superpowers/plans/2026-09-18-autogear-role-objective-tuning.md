# Autogear Role-Objective Tuning Implementation Plan (#544)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help a player find a better autogear config for ships whose kit scores off a stat their
role's formula ignores, by measuring the role's real objective in the combat engine.

**Architecture:** A pure detector queries parsed abilities for effects that scale off a stat the
ship's role formula does not specifically reward. A notice surfaces that in Autogear settings. An
opt-in tuning run then bands that stat inside autogear across the achievable range, replays each
resulting loadout through the engine against three sparring opponents, and scores them on the
role's objective rather than on the formula.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Vitest. Branch `feat/autogear-sim-rerank`
(PR #541, draft) — this work builds on top of it and the combined branch merges together.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-18-autogear-role-objective-tuning-design.md`.
- **Execution PAUSES at each stage boundary** for the repo owner to test in a browser as a real
  user. Do not begin the next stage until they report back.
- Use existing UI components from `src/components/ui/` — never raw `<button>`, never a hand-rolled
  card (use the `card` class), never a custom modal.
- No emojis in UI text; plain text plus colour classes.
- Changelog entries go in `UNRELEASED_CHANGES` in `src/constants/changelog.ts`, area prefix plus
  8-12 words, one entry per user-visible change.
- `npm start` runs the dev server on port 3000. Never `npm run dev`. Never `vitest -u`.
- Spelling trap: `additional-damage.stat` and `heal`/`shield`.`basis` use American `'defense'`,
  while `BaseStats` and `StatPriority.stat` use British `'defence'`. Every comparison must
  normalise. `types/abilities.ts:722-726` documents this.
- Banding requires `AutogearAlgorithm.Genetic`: `hardRequirement` is read only by
  `calculateHardViolation` at `GeneticStrategy.ts:542,627`.
- Never `git add -A` or `git add .`. `docs/` is gitignored — plan and spec need `git add -f`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/utils/autogear/simRerank/offFormulaStats.ts` | Pure detector. Ship + configured role in, findings out. No React, no compute beyond parsing. |
| `src/components/autogear/OffFormulaNotice.tsx` | Renders findings as a notice. Presentation only. |
| `src/utils/autogear/simRerank/roleObjectives.ts` | Role → objective metric + constraint. |
| `src/utils/autogear/simRerank/objectiveMetrics.ts` | Aggregates `ShipRoundState` fields `ActorTotals` does not carry. |
| `src/utils/autogear/simRerank/statBands.ts` | Probes the achievable range, builds bands, checks reachability. |
| `src/utils/autogear/simRerank/sparringOpponents.ts` | Three opponent boards for the judging phase. |
| `src/hooks/useOffFormulaTuning.ts` | Owns the tuning run: phases, progress, cancellation. |
| `src/components/autogear/OffFormulaTuningPanel.tsx` | The band table and the Apply control. |

---

# STAGE 1 — Detection only

**Deliverable the owner tests:** open Autogear, select ships, and see whether the notice is
accurate and whether the flagged set is signal or noise. No compute, no new buttons that run
anything.

**Why first:** this is the cheapest stage and the most likely to reshape or kill the feature. The
spike flagged 46 of 150 ships; many are defenders where the finding may not matter. If the notice
reads as noise, the severity tiering or the whole framing changes before any expensive machinery
is built.

---

### Task 1: The detector

**Files:**
- Create: `src/utils/autogear/simRerank/offFormulaStats.ts`
- Test: `src/utils/autogear/simRerank/__tests__/offFormulaStats.test.ts`

**Interfaces:**
- Consumes: `buildShipAbilities(ship: Ship): ShipSkills` from `src/utils/abilities/buildShipAbilities`;
  `CUSTOM_FORMULA_SEEDS` from `src/utils/autogear/customFormulaSeeds`;
  `matchesRoleCategory`, `ShipTypeName` from `src/constants/shipTypes`.
- Produces:
  ```ts
  export type OffFormulaSeverity = 'severe' | 'substitution';
  export interface OffFormulaFinding {
      stat: 'hp' | 'defence' | 'shield' | 'security' | 'attack';
      produces: 'damage' | 'repair' | 'shield';
      severity: OffFormulaSeverity;
      /** The ability trigger the effect rides. Decides the gating stat in Stage 2. */
      trigger: string;
  }
  export function detectOffFormulaStats(ship: Ship, configuredRole: ShipTypeName | null): OffFormulaFinding[];
  export function gatingStatFor(trigger: string): 'hacking' | 'security' | 'defence';
  ```

**Design notes the implementer must honour:**

The rewarded-stat set is **derived from `CUSTOM_FORMULA_SEEDS[role].rows`**, not hand-written. A
stat counts as *specifically rewarded* only when it appears as its own row. Two seed terms are
AGGREGATES that must NOT be expanded into their components:

```ts
const AGGREGATE_COMPONENTS: Record<string, readonly string[]> = {
    directDamage: ['attack', 'crit', 'critDamage'],
    effectiveHp: ['hp', 'defence'],
};
```

Severity follows from where the stat sits:
- appears as its own seed row → **not flagged at all**
- inside an aggregate present in the seeds → **`'substitution'`** (the formula has it but lets a
  build trade it away — Panon's damage needs Defence specifically while `effectiveHp` does not care)
- absent from the seeds entirely → **`'severe'`** (the formula optimises something else — Chakara,
  Prophet, Howler)

Three carriers must be read, walking `skills.slots[].abilities[]` and reading `ability.config`:

| Carrier | Field | Produces |
| --- | --- | --- |
| `config.type === 'additional-damage'` | `config.stat` | `'damage'` |
| `config.type === 'heal'` / `'shield'` | `config.basis` (only `'hp'`/`'attack'`/`'defense'`) | `'repair'` / `'shield'` |
| `config.type === 'damage'` | `config.hpBasisPct` → hp, `config.shieldBasisPct` → shield | `'damage'` |

**The third is not optional.** Without it Vindicator is invisible and Xcellence is flagged for his
shield-from-HP passive rather than his actual damage channel.

`configuredRole` null means Custom mode — return `[]`, because a custom formula has no role
objective to diverge from.

`gatingStatFor` maps the trigger to the stat an opponent must vary:

| Trigger | Returns |
| --- | --- |
| `'on-debuff-resisted'` | `'hacking'` (this unit resists; its security vs enemy hacking) |
| `'on-own-debuff-resisted'`, `'on-enemy-debuff-resisted'` | `'security'` (own hacking vs enemy security) |
| anything else | `'defence'` (ungated; mitigation only) |

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectOffFormulaStats, gatingStatFor } from '../offFormulaStats';
import { loadShipSkillRecords } from '../../../../../scripts/lib/shipSkillCsv';
import { readFileSync } from 'fs';
import type { Ship } from '../../../../types/ship';

interface Datum { name: string; role: string; hp: number; attack: number; defense: number;
    hacking: number; security: number; speed: number; critRate: number; critDamage: number; }

// 4 refits so the highest-unlocked passive resolves (skillRows.ts gates R4 at 4, R2 at 2).
// Players tune maxed ships; detecting against the R0 passive reads the wrong clause.
const asShip = (rec: ReturnType<typeof loadShipSkillRecords>[number], d: Datum): Ship =>
    ({
        id: rec.name.toLowerCase(), name: rec.name, type: d.role,
        baseStats: { attack: d.attack, crit: d.critRate, critDamage: d.critDamage,
            hacking: d.hacking, security: d.security, defence: d.defense, hp: d.hp, speed: d.speed },
        equipment: {}, implants: {},
        refits: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, stats: [] })),
        activeSkillText: rec.active, chargeSkillText: rec.charge, chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0], secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
        activeTarget: 'front', activePattern: 'Pattern-Base',
        chargedTarget: 'front', chargedPattern: 'Pattern-Base',
    }) as unknown as Ship;

const corpus = () => {
    const data: Datum[] = JSON.parse(readFileSync('docs/ship-data.json', 'utf8'));
    const byName = new Map(data.map((d) => [d.name.toLowerCase(), d]));
    return loadShipSkillRecords()
        .map((rec) => {
            const d = byName.get(rec.name.toLowerCase());
            return d ? { name: rec.name, ship: asShip(rec, d), role: d.role } : null;
        })
        .filter((x): x is { name: string; ship: Ship; role: string } => x !== null);
};

describe('detectOffFormulaStats over the real corpus', () => {
    const flagged = new Map(
        corpus()
            .map((c) => [c.name, detectOffFormulaStats(c.ship, c.role as never)] as const)
            .filter(([, f]) => f.length > 0)
    );

    // NON-VACUITY FIRST. A detector that walks the wrong path returns [] for every ship and a
    // bare "Chakara is flagged" assertion would fail loudly, but a bare "Aegis is not flagged"
    // assertion would PASS. Pin the population so an empty result cannot read as success.
    it('flags a substantial minority of the corpus, not none and not all', () => {
        expect(flagged.size).toBeGreaterThan(20);
        expect(flagged.size).toBeLessThan(80);
    });

    it.each([
        ['Chakara', 'defence', 'severe'],
        ['Nuqtu', 'defence', 'severe'],
        ['Prophet', 'security', 'severe'],
        ['Howler', 'attack', 'severe'],
        ['Graphite', 'attack', 'severe'],
    ])('flags %s on %s as %s — the formula optimises something else', (name, stat, severity) => {
        const findings = flagged.get(name) ?? [];
        expect(findings.some((f) => f.stat === stat && f.severity === severity)).toBe(true);
    });

    // The aggregate rule. DEFENDER's seed is core('effectiveHp'), which CONTAINS defence — a gate
    // asking "is the stat in the formula" returns false here and misses these ships entirely.
    it.each([['Panon'], ['Madax']])(
        '%s is flagged as a substitution trap, not skipped because effectiveHp contains defence',
        (name) => {
            const findings = flagged.get(name) ?? [];
            expect(findings.some((f) => f.stat === 'defence' && f.severity === 'substitution')).toBe(true);
        }
    );

    // The third carrier. Both ride `damage` configs with hpBasisPct/shieldBasisPct on the
    // REACTIVE path, invisible to an 'additional-damage' query.
    it('finds Vindicator, whose damage channel is damage.hpBasisPct', () => {
        const findings = flagged.get('Vindicator') ?? [];
        expect(findings.some((f) => f.stat === 'hp' && f.trigger === 'on-debuff-resisted')).toBe(true);
    });

    it('finds Xcellence for his DAMAGE channel, not merely his shield-from-HP passive', () => {
        const findings = flagged.get('Xcellence') ?? [];
        expect(
            findings.some(
                (f) => f.produces === 'damage' && f.stat === 'shield' &&
                    f.trigger === 'on-enemy-debuff-resisted'
            )
        ).toBe(true);
    });

    // A supporter healing from HP is ALIGNED: SUPPORTER's seed carries core('hp') as its own row.
    // This proves the seed-derived rule actually suppresses, rather than flagging everything.
    it('does not flag a supporter whose repair scales off HP, which its formula rewards directly', () => {
        const meatshield = corpus().find((c) => c.name === 'Meatshield');
        const asSupporter = detectOffFormulaStats(meatshield!.ship, 'SUPPORTER');
        expect(asSupporter.some((f) => f.stat === 'hp' && f.produces === 'repair')).toBe(false);
    });

    it('returns nothing in Custom mode, where there is no role objective to diverge from', () => {
        const chakara = corpus().find((c) => c.name === 'Chakara');
        expect(detectOffFormulaStats(chakara!.ship, null)).toEqual([]);
    });
});

describe('gatingStatFor', () => {
    it.each([
        ['on-debuff-resisted', 'hacking'],
        ['on-own-debuff-resisted', 'security'],
        ['on-enemy-debuff-resisted', 'security'],
        ['on-cast', 'defence'],
    ])('%s gates on the enemy varying %s', (trigger, expected) => {
        expect(gatingStatFor(trigger)).toBe(expected);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/offFormulaStats.test.ts`
Expected: FAIL — `Failed to resolve import "../offFormulaStats"`.

- [ ] **Step 3: Implement the detector**

```ts
import type { Ship } from '../../../types/ship';
import type { ShipTypeName } from '../../../constants/shipTypes';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { CUSTOM_FORMULA_SEEDS } from '../customFormulaSeeds';

export type OffFormulaStat = 'hp' | 'defence' | 'shield' | 'security' | 'attack';
export type OffFormulaSeverity = 'severe' | 'substitution';

export interface OffFormulaFinding {
    stat: OffFormulaStat;
    produces: 'damage' | 'repair' | 'shield';
    severity: OffFormulaSeverity;
    /** The ability trigger the effect rides. `gatingStatFor` turns this into the stat an
     *  opponent must vary for the measurement to mean anything. */
    trigger: string;
}

/** Seed terms that stand for a COMBINATION of stats. They must never be expanded into their
 *  components when deciding whether a stat is rewarded: `effectiveHp` lets a build trade defence
 *  for HP at no scoring cost, so a skill scaling off Defence SPECIFICALLY is still mis-scored.
 *  Expanding them is what makes Panon and Madax invisible. */
const AGGREGATE_COMPONENTS: Record<string, readonly string[]> = {
    // crit and critDamage can never BE a finding — no carrier scales an effect off them — but
    // they are listed because this map documents what each aggregate stands for, and a future
    // carrier that does read them must not silently classify them as severe.
    directDamage: ['attack', 'crit', 'critDamage'],
    effectiveHp: ['hp', 'defence'],
};

/** `additional-damage.stat` and `heal`/`shield`.`basis` spell it the American way; `BaseStats`
 *  and `StatPriority.stat` spell it the British way (types/abilities.ts:722-726). */
const normalise = (stat: string): OffFormulaStat =>
    (stat === 'defense' ? 'defence' : stat) as OffFormulaStat;

export function gatingStatFor(trigger: string): 'hacking' | 'security' | 'defence' {
    // This unit RESISTING is gated by its own security against the enemy's hacking.
    if (trigger === 'on-debuff-resisted') return 'hacking';
    // An enemy resisting is gated by the enemy's security against this unit's hacking.
    if (trigger === 'on-own-debuff-resisted' || trigger === 'on-enemy-debuff-resisted') {
        return 'security';
    }
    // Ungated: no threshold to move, so an opponent can only vary mitigation.
    return 'defence';
}

export function detectOffFormulaStats(
    ship: Ship,
    configuredRole: ShipTypeName | null
): OffFormulaFinding[] {
    // Custom mode: the player wrote the formula, so there is no role objective to diverge from.
    if (!configuredRole) return [];

    const seed = CUSTOM_FORMULA_SEEDS[configuredRole];
    if (!seed) return [];

    const rewardedDirectly = new Set<string>();
    const rewardedViaAggregate = new Set<string>();
    for (const row of seed.rows) {
        const components = AGGREGATE_COMPONENTS[row.stat as string];
        if (components) {
            for (const c of components) rewardedViaAggregate.add(c);
        } else {
            rewardedDirectly.add(normalise(row.stat as string));
        }
    }

    const classify = (stat: OffFormulaStat): OffFormulaSeverity | null => {
        if (rewardedDirectly.has(stat)) return null;
        return rewardedViaAggregate.has(stat) ? 'substitution' : 'severe';
    };

    const findings: OffFormulaFinding[] = [];
    const add = (
        stat: OffFormulaStat,
        produces: OffFormulaFinding['produces'],
        trigger: string
    ): void => {
        const severity = classify(stat);
        if (!severity) return;
        if (findings.some((f) => f.stat === stat && f.produces === produces)) return;
        findings.push({ stat, produces, severity, trigger });
    };

    for (const slot of buildShipAbilities(ship).slots ?? []) {
        for (const ability of slot.abilities ?? []) {
            const config = ability.config as unknown as {
                type?: string;
                stat?: string;
                basis?: string;
                hpBasisPct?: number;
                shieldBasisPct?: number;
            };
            if (!config?.type) continue;
            const trigger = ability.trigger as string;

            if (config.type === 'additional-damage' && config.stat) {
                add(normalise(config.stat), 'damage', trigger);
            }

            if ((config.type === 'heal' || config.type === 'shield') && config.basis) {
                // Only the CASTER-stat bases describe a gearing decision. 'target-hp',
                // 'damage-dealt', 'damage-taken' and 'overheal' scale off something the
                // owner's own stat block does not control.
                if (['hp', 'attack', 'defense'].includes(config.basis)) {
                    add(
                        normalise(config.basis),
                        config.type === 'heal' ? 'repair' : 'shield',
                        trigger
                    );
                }
            }

            // Reactive damage whose raw comes from max HP or the current shield pool instead of
            // attack x multiplier. Invisible to an 'additional-damage' query, and the only way
            // Vindicator and Xcellence's real damage channels are seen at all.
            if (config.type === 'damage') {
                if (config.hpBasisPct) add('hp', 'damage', trigger);
                if (config.shieldBasisPct) add('shield', 'damage', trigger);
            }
        }
    }

    return findings;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/offFormulaStats.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Prove the aggregate rule is load-bearing (mutation probe)**

Temporarily change `AGGREGATE_COMPONENTS` so `effectiveHp` expands into the rewarded-directly set
(move the `components` branch to add into `rewardedDirectly`). Re-run the tests.
Expected: the Panon and Madax cases FAIL. Revert the change.

Then temporarily delete the `config.type === 'damage'` block and re-run.
Expected: the Vindicator and Xcellence cases FAIL. Revert.

Record both probe outcomes in the task report. **Re-run `npx tsc --noEmit` as part of any probe** —
a probe that only re-runs vitest cannot see a type-level guard.

- [ ] **Step 6: Typecheck, lint and commit**

```bash
npx tsc --noEmit && npx eslint src/utils/autogear/simRerank/offFormulaStats.ts src/utils/autogear/simRerank/__tests__/offFormulaStats.test.ts
git add src/utils/autogear/simRerank/offFormulaStats.ts src/utils/autogear/simRerank/__tests__/offFormulaStats.test.ts
git commit -m "feat(autogear): detect stats a ship scores off that its role formula ignores"
```

---

### Task 2: The notice, mounted and visible

**Files:**
- Create: `src/components/autogear/OffFormulaNotice.tsx`
- Create: `src/components/autogear/__tests__/OffFormulaNotice.test.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx` (add the render at the `SimRerankSection`
  mount site, line ~424, and one prop)

**Interfaces:**
- Consumes: `detectOffFormulaStats`, `OffFormulaFinding` from Task 1.
- Produces: `OffFormulaNotice`, `OffFormulaNoticeProps { ship: Ship; configuredRole: ShipTypeName | null }`.

**Copy rules:** name the stat, name the formula that ignores it, and say nothing about what to do
about it — Stage 1 ships no remedy, and copy that promises one is a lie until Stage 2 lands.
No emojis.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OffFormulaNotice } from '../OffFormulaNotice';
import type { Ship } from '../../../types/ship';

vi.mock('../../../utils/autogear/simRerank/offFormulaStats', () => ({
    detectOffFormulaStats: vi.fn(),
    gatingStatFor: () => 'defence',
}));
import { detectOffFormulaStats } from '../../../utils/autogear/simRerank/offFormulaStats';

const ship = { id: 's', name: 'Chakara', type: 'ATTACKER' } as unknown as Ship;
const mocked = vi.mocked(detectOffFormulaStats);

describe('OffFormulaNotice', () => {
    it('names the stat and the role formula that ignores it', () => {
        mocked.mockReturnValue([
            { stat: 'defence', produces: 'damage', severity: 'severe', trigger: 'on-cast' },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" />);
        expect(screen.getByText(/defence/i)).toBeInTheDocument();
        expect(screen.getByText(/Attacker/)).toBeInTheDocument();
    });

    it('renders nothing at all when the ship has no finding', () => {
        mocked.mockReturnValue([]);
        const { container } = render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" />);
        // An empty wrapper div would still push layout and read as a bug in a dense settings
        // panel, so assert on the container rather than on absence of text.
        expect(container).toBeEmptyDOMElement();
    });

    it('separates a substitution finding from a severe one, so the tiers read differently', () => {
        mocked.mockReturnValue([
            { stat: 'defence', produces: 'damage', severity: 'substitution', trigger: 'on-cast' },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="DEFENDER" />);
        expect(screen.getByText(/trade/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/autogear/__tests__/OffFormulaNotice.test.tsx`
Expected: FAIL — cannot resolve `../OffFormulaNotice`.

- [ ] **Step 3: Implement the notice**

```tsx
import React from 'react';
import type { Ship } from '../../types/ship';
import { type ShipTypeName, SHIP_TYPES } from '../../constants/shipTypes';
import {
    detectOffFormulaStats,
    type OffFormulaFinding,
} from '../../utils/autogear/simRerank/offFormulaStats';

export interface OffFormulaNoticeProps {
    ship: Ship;
    /** The CONFIGURED autogear role, which can differ from `ship.type`. Null means Custom mode,
     *  where the detector returns nothing. */
    configuredRole: ShipTypeName | null;
}

const PRODUCES_LABEL: Record<OffFormulaFinding['produces'], string> = {
    damage: 'damage',
    repair: 'repairs',
    shield: 'shields',
};

const STAT_LABEL: Record<string, string> = {
    hp: 'HP',
    defence: 'Defence',
    attack: 'Attack',
    security: 'Security',
    shield: 'its shield pool',
};

export const OffFormulaNotice: React.FC<OffFormulaNoticeProps> = ({ ship, configuredRole }) => {
    const findings = detectOffFormulaStats(ship, configuredRole);
    if (findings.length === 0) return null;

    const roleLabel = configuredRole ? SHIP_TYPES[configuredRole]?.name : '';

    return (
        <div className="card space-y-2">
            {findings.map((finding) => (
                <p
                    key={`${finding.stat}-${finding.produces}`}
                    className="text-xs text-amber-400"
                >
                    {ship.name}&apos;s {PRODUCES_LABEL[finding.produces]} scale off{' '}
                    {STAT_LABEL[finding.stat] ?? finding.stat}.{' '}
                    {finding.severity === 'severe'
                        ? `The ${roleLabel} formula does not score it.`
                        : `The ${roleLabel} formula scores it only as part of a total it can trade away for another stat.`}
                </p>
            ))}
        </div>
    );
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/autogear/__tests__/OffFormulaNotice.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Mount it in AutogearSettings**

In `src/components/autogear/AutogearSettings.tsx`, add the import beside the existing
`SimRerankSection` import:

```tsx
import { OffFormulaNotice } from './OffFormulaNotice';
```

Then at the mount site (currently line ~424), render the notice immediately ABOVE the sim-rerank
section so it reads before the tool that will eventually act on it:

```tsx
{selectedShip && <OffFormulaNotice ship={selectedShip} configuredRole={selectedShipRole} />}
{selectedShip && simRerank && <SimRerankSection ship={selectedShip} {...simRerank} />}
```

`selectedShip` and `selectedShipRole` are already props on this component (lines 68 and 70) — no
new prop is needed.

- [ ] **Step 6: Verify it is actually reachable**

Run: `npm start` and open http://localhost:3000/. Go to Autogear, select a ship the detector flags
(Chakara, Prophet, Xcellence, Panon or Howler), open Settings, and confirm the notice renders with
the right stat and role. Then select an unflagged ship (Aegis) and confirm nothing renders.

**This step is not optional.** #498 shipped eleven tasks of infrastructure that no user could
reach, because nothing mounted the section.

- [ ] **Step 7: Typecheck, lint, changelog and commit**

Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`:

```ts
'Autogear: flags ships that score off a stat their role ignores.',
```

```bash
npx tsc --noEmit && npx eslint src/components/autogear/OffFormulaNotice.tsx src/components/autogear/AutogearSettings.tsx
git add src/components/autogear/OffFormulaNotice.tsx src/components/autogear/__tests__/OffFormulaNotice.test.tsx src/components/autogear/AutogearSettings.tsx src/constants/changelog.ts
git commit -m "feat(autogear): surface off-formula scaling stats in settings"
```

---

## ⛔ STAGE 1 CHECKPOINT — STOP HERE

Report to the repo owner:
- how many of the 150 ships the detector flags, split by severity
- the full list of `severe` findings
- the dev server URL and which ships to look at

**Do not start Stage 2 until they have tested and replied.** The questions their testing answers:
is the notice accurate, is the flagged set signal or noise, does the severity split land in the
right place, and is the copy clear without a remedy attached.

---

# STAGE 2 — Measurement, read-only

**Deliverable the owner tests:** a "Measure it" control that runs the banded optimizer passes and
shows a table of bands against the role's objective. It writes nothing.

**Stage 2 and Stage 3 task detail below is written in full, but the Stage 1 checkpoint may revise
it.** Re-read this section against the owner's Stage 1 feedback before dispatching Task 3.

---

### Task 3: Role objectives, and the defender inversion fix

**Files:**
- Create: `src/utils/autogear/simRerank/roleObjectives.ts`
- Test: `src/utils/autogear/simRerank/__tests__/roleObjectives.test.ts`
- Modify: `src/utils/autogear/simRerank/metricTable.ts` (the `METRIC_LOWER_IS_BETTER` entry and
  `suggestedPrimary`'s DEFENDER branch)

**Interfaces:**
- Consumes: `SimMetric` from `./metricTable`; `matchesRoleCategory`, `ShipTypeName` from
  `src/constants/shipTypes`.
- Produces:
  ```ts
  export interface RoleObjective {
      /** The metric the role is trying to grow. */
      maximise: ObjectiveMetric;
      /** The metric that must not get worse while doing it. */
      constraint: 'winRate' | 'survival';
  }
  export function roleObjective(role: ShipTypeName): RoleObjective;
  ```

**The table, from the spec, confirmed by the repo owner:**

| Role category | maximise | constraint |
| --- | --- | --- |
| ATTACKER | `focusDamageDealt` | `winRate` |
| DEBUFFER | `enemyDebuffUptime` | `winRate` |
| SUPPORTER | `focusSupportOutput` | `survival` |
| DEFENDER | `focusDamageTakenShare` | `survival` |

**The defender fix.** `metricTable.ts` currently carries
`METRIC_LOWER_IS_BETTER: { focusDamageTaken: true, rounds: true }` and `suggestedPrimary` returns
`focusDamageTaken` for DEFENDER, which rewards a defender for taking LESS damage. A defender that
takes zero damage is not tanking, it is being ignored. Remove `focusDamageTaken` from
`METRIC_LOWER_IS_BETTER` **only if** the new `focusDamageTakenShare` metric replaces its use in
`suggestedPrimary`; raw `focusDamageTaken` remains lower-is-better for every other reader.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { roleObjective } from '../roleObjectives';
import { suggestedPrimary } from '../metricTable';

describe('roleObjective', () => {
    it.each([
        ['ATTACKER', 'focusDamageDealt', 'winRate'],
        ['DEFENDER', 'focusDamageTakenShare', 'survival'],
        ['SUPPORTER', 'focusSupportOutput', 'survival'],
        ['DEBUFFER', 'enemyDebuffUptime', 'winRate'],
    ])('%s maximises %s subject to %s', (role, maximise, constraint) => {
        const objective = roleObjective(role as never);
        expect(objective.maximise).toBe(maximise);
        expect(objective.constraint).toBe(constraint);
    });

    // Variants share their family's objective. A hand-written 12-entry map drifts the moment a
    // role is added; this pins that variants resolve through matchesRoleCategory.
    it.each([
        ['DEBUFFER_BOMBER', 'enemyDebuffUptime'],
        ['DEBUFFER_CORROSION', 'enemyDebuffUptime'],
        ['SUPPORTER_SHIELD', 'focusSupportOutput'],
        ['DEFENDER_SECURITY', 'focusDamageTakenShare'],
    ])('%s inherits its family objective %s', (role, maximise) => {
        expect(roleObjective(role as never).maximise).toBe(maximise);
    });
});

describe('the defender objective is no longer inverted', () => {
    it('no longer suggests raw damage-taken, which rewarded a defender for being ignored', () => {
        expect(suggestedPrimary('DEFENDER')).not.toBe('focusDamageTaken');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/roleObjectives.test.ts`
Expected: FAIL — cannot resolve `../roleObjectives`.

- [ ] **Step 3: Implement**

```ts
import { matchesRoleCategory, type ShipTypeName } from '../../../constants/shipTypes';

/** Metrics a tuning run scores on. Distinct from `SimMetric` in `metricTable.ts`: these are
 *  ROLE OBJECTIVES, several of which need round-state fields `ActorTotals` does not carry. */
export type ObjectiveMetric =
    | 'focusDamageDealt'
    | 'focusDamageTakenShare'
    | 'focusSupportOutput'
    | 'enemyDebuffUptime';

export interface RoleObjective {
    maximise: ObjectiveMetric;
    /** What must not get worse. Every single-metric maximiser picks a corner — a build that
     *  dumps everything in two rounds and dies scores best on damage alone. */
    constraint: 'winRate' | 'survival';
}

export function roleObjective(role: ShipTypeName): RoleObjective {
    if (matchesRoleCategory(role, ['DEFENDER'])) {
        return { maximise: 'focusDamageTakenShare', constraint: 'survival' };
    }
    if (matchesRoleCategory(role, ['SUPPORTER'])) {
        return { maximise: 'focusSupportOutput', constraint: 'survival' };
    }
    if (matchesRoleCategory(role, ['DEBUFFER'])) {
        return { maximise: 'enemyDebuffUptime', constraint: 'winRate' };
    }
    return { maximise: 'focusDamageDealt', constraint: 'winRate' };
}
```

In `metricTable.ts`, change `suggestedPrimary`'s DEFENDER branch from `focusDamageTaken` to
`teamDamageDealt` as the closest existing `SimMetric` — the true objective
(`focusDamageTakenShare`) is not a `SimMetric` and arrives in Task 4. Leave
`METRIC_LOWER_IS_BETTER` untouched: raw damage-taken is still lower-is-better for the sim-rerank
table's own readers.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/roleObjectives.test.ts src/utils/autogear/simRerank/__tests__/metricTable.test.ts`
Expected: PASS. If an existing `metricTable` test pins `suggestedPrimary('DEFENDER') === 'focusDamageTaken'`, update it and note in the report that it encoded the inverted objective.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
npx tsc --noEmit && npx eslint src/utils/autogear/simRerank/roleObjectives.ts src/utils/autogear/simRerank/metricTable.ts
git add src/utils/autogear/simRerank/roleObjectives.ts src/utils/autogear/simRerank/__tests__/roleObjectives.test.ts src/utils/autogear/simRerank/metricTable.ts
git commit -m "feat(autogear): name each role's real objective, and un-invert the defender's"
```

---

### Task 4: Objective metrics from round state

**Files:**
- Create: `src/utils/autogear/simRerank/objectiveMetrics.ts`
- Test: `src/utils/autogear/simRerank/__tests__/objectiveMetrics.test.ts`

**Interfaces:**
- Consumes: `ObjectiveMetric` from `./roleObjectives`; `BattleResult` from
  `src/utils/calculators/battleSimulator`.
- Produces:
  ```ts
  export function objectiveSeries(
      result: BattleResult, focusActorId: string, metric: ObjectiveMetric
  ): number;
  export function survived(result: BattleResult, focusActorId: string): boolean;
  ```

**Why this file exists:** `ActorTotals` in `seededRuns.ts` carries only `damageDealt`,
`damageTaken` and `healingDone`. `ShipRoundState` (`battleSimulator.ts:96-139`) additionally
records `shieldGranted`, `shieldsAbsorbed`, `healingReceived`, `incomingBarrierAbsorbed`, `alive`,
and per-round `activeBuffs[]` / `activeDebuffs[]`. Every objective is derivable from those, so this
is an aggregation gap and needs no engine change.

Definitions:
- `focusDamageDealt` — sum of the focus actor's `damageDealt` across rounds.
- `focusDamageTakenShare` — focus `damageTaken` divided by the sum over all PLAYER actors. A share,
  not a raw total, so a tankier team does not read as a worse defender.
- `focusSupportOutput` — focus `healingDone` + `shieldGranted`, summed.
- `enemyDebuffUptime` — count of `(enemy actor, round)` pairs where `activeDebuffs.length > 0`,
  divided by `(enemy count x rounds)`. A fraction in `[0, 1]`.
- `survived` — the focus actor's `alive` in the final round.

Player actors are identified as `!actorId.startsWith('e:')` — player index 0 carries the bare id
`'attacker'`, so a `p:` prefix test silently drops it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { objectiveSeries, survived } from '../objectiveMetrics';
import type { BattleResult } from '../../../calculators/battleSimulator';

const round = (ships: Array<Partial<{ actorId: string; side: string; damageDealt: number;
    damageTaken: number; healingDone: number; shieldGranted: number; alive: boolean;
    activeDebuffs: string[] }>>) => ({
    ships: ships.map((s) => ({
        actorId: 'attacker', side: 'player', damageDealt: 0, damageTaken: 0, healingDone: 0,
        shieldGranted: 0, alive: true, activeDebuffs: [], activeBuffs: [], ...s,
    })),
});

const result = (rounds: ReturnType<typeof round>[]) => ({ rounds }) as unknown as BattleResult;

describe('objectiveSeries', () => {
    it('sums focus damage across rounds, because round fields are rates not cumulatives', () => {
        const r = result([
            round([{ actorId: 'attacker', damageDealt: 100 }]),
            round([{ actorId: 'attacker', damageDealt: 150 }]),
        ]);
        expect(objectiveSeries(r, 'attacker', 'focusDamageDealt')).toBe(250);
    });

    it('reports damage taken as a SHARE of the player side, not a raw total', () => {
        const r = result([
            round([
                { actorId: 'attacker', damageTaken: 300 },
                { actorId: 'p:ally:1', damageTaken: 100 },
                { actorId: 'e:foe:0', side: 'enemy', damageTaken: 9999 },
            ]),
        ]);
        // 300 / (300 + 100). The enemy's 9999 must not enter the denominator, and the bare
        // 'attacker' id must count as a player — a `p:` prefix test drops index 0 entirely.
        expect(objectiveSeries(r, 'attacker', 'focusDamageTakenShare')).toBeCloseTo(0.75);
    });

    it('adds shields granted to repairs, because shielding IS support output', () => {
        const r = result([round([{ actorId: 'attacker', healingDone: 500, shieldGranted: 200 }])]);
        expect(objectiveSeries(r, 'attacker', 'focusSupportOutput')).toBe(700);
    });

    it('measures enemy debuff uptime as a fraction of enemy-rounds', () => {
        const r = result([
            round([
                { actorId: 'e:a:0', side: 'enemy', activeDebuffs: ['Burn'] },
                { actorId: 'e:b:1', side: 'enemy', activeDebuffs: [] },
            ]),
            round([
                { actorId: 'e:a:0', side: 'enemy', activeDebuffs: ['Burn'] },
                { actorId: 'e:b:1', side: 'enemy', activeDebuffs: ['Slow'] },
            ]),
        ]);
        // 3 debuffed enemy-rounds out of 4.
        expect(objectiveSeries(r, 'attacker', 'enemyDebuffUptime')).toBeCloseTo(0.75);
    });

    it('does not count PLAYER debuffs as enemy uptime', () => {
        const r = result([
            round([
                { actorId: 'attacker', activeDebuffs: ['Burn', 'Slow'] },
                { actorId: 'e:a:0', side: 'enemy', activeDebuffs: [] },
            ]),
        ]);
        expect(objectiveSeries(r, 'attacker', 'enemyDebuffUptime')).toBe(0);
    });
});

describe('survived', () => {
    it('reads the FINAL round, not any round', () => {
        const r = result([
            round([{ actorId: 'attacker', alive: true }]),
            round([{ actorId: 'attacker', alive: false }]),
        ]);
        expect(survived(r, 'attacker')).toBe(false);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/objectiveMetrics.test.ts`
Expected: FAIL — cannot resolve `../objectiveMetrics`.

- [ ] **Step 3: Implement**

```ts
import type { BattleResult } from '../../calculators/battleSimulator';
import type { ObjectiveMetric } from './roleObjectives';

/** True for every actor on the player side, including the reserved bare id `'attacker'` that
 *  player index 0 fights under. Only enemy actors carry the `e:` prefix, so this reads as "not an
 *  enemy" rather than "starts with `p:`" — the latter silently drops index 0. */
const isPlayerActor = (actorId: string): boolean => !actorId.startsWith('e:');

/** `ShipRoundState.damageDealt` / `damageTaken` / `healingDone` / `shieldGranted` are PER-ROUND
 *  rates, not running cumulatives, so a fight total is a sum across rounds
 *  (`seededRuns.ts:62` documents the same rule). */
const sumFocus = (
    result: BattleResult,
    focusActorId: string,
    field: 'damageDealt' | 'damageTaken' | 'healingDone' | 'shieldGranted'
): number => {
    let total = 0;
    for (const round of result.rounds) {
        for (const ship of round.ships) {
            if (ship.actorId === focusActorId) {
                total += (ship as unknown as Record<string, number>)[field] ?? 0;
            }
        }
    }
    return total;
};

export function survived(result: BattleResult, focusActorId: string): boolean {
    const finalRound = result.rounds[result.rounds.length - 1];
    if (!finalRound) return false;
    return finalRound.ships.find((s) => s.actorId === focusActorId)?.alive ?? false;
}

export function objectiveSeries(
    result: BattleResult,
    focusActorId: string,
    metric: ObjectiveMetric
): number {
    switch (metric) {
        case 'focusDamageDealt':
            return sumFocus(result, focusActorId, 'damageDealt');

        case 'focusSupportOutput':
            return (
                sumFocus(result, focusActorId, 'healingDone') +
                sumFocus(result, focusActorId, 'shieldGranted')
            );

        case 'focusDamageTakenShare': {
            let playerTotal = 0;
            for (const round of result.rounds) {
                for (const ship of round.ships) {
                    if (isPlayerActor(ship.actorId)) playerTotal += ship.damageTaken ?? 0;
                }
            }
            // A team that takes nothing has no share to report, and 0/0 must not be NaN — a NaN
            // silently poisons every comparison downstream.
            if (playerTotal === 0) return 0;
            return sumFocus(result, focusActorId, 'damageTaken') / playerTotal;
        }

        case 'enemyDebuffUptime': {
            let debuffed = 0;
            let enemyRounds = 0;
            for (const round of result.rounds) {
                for (const ship of round.ships) {
                    if (isPlayerActor(ship.actorId)) continue;
                    enemyRounds++;
                    const debuffs = (ship as unknown as { activeDebuffs?: string[] }).activeDebuffs;
                    if (debuffs && debuffs.length > 0) debuffed++;
                }
            }
            if (enemyRounds === 0) return 0;
            return debuffed / enemyRounds;
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/objectiveMetrics.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
npx tsc --noEmit && npx eslint src/utils/autogear/simRerank/objectiveMetrics.ts
git add src/utils/autogear/simRerank/objectiveMetrics.ts src/utils/autogear/simRerank/__tests__/objectiveMetrics.test.ts
git commit -m "feat(autogear): derive each role's objective from battle round state"
```

---

### Task 5: Stat bands, with a reachability check

**Files:**
- Create: `src/utils/autogear/simRerank/statBands.ts`
- Test: `src/utils/autogear/simRerank/__tests__/statBands.test.ts`

**Interfaces:**
- Consumes: `StatPriority` from `src/types/autogear`; `LimitableStat` from `src/types/stats`.
- Produces:
  ```ts
  export interface StatBand { min: number; max: number; }
  export interface BandOutcome { band: StatBand; landed: number; reachable: boolean; }
  export const BAND_COUNT = 5;
  export function probePriorities(stat: LimitableStat, value: number): StatPriority[];
  export function bandsBetween(floor: number, ceiling: number): StatBand[];
  export function bandPriorities(stat: LimitableStat, band: StatBand): StatPriority[];
  export function classifyOutcome(band: StatBand, landed: number): BandOutcome;
  ```

**The reachability rule, measured.** An unreachable band does NOT fail — the optimizer returns the
nearest reachable build with no signal (`compareIndividuals` ranks feasible over infeasible, so an
escape means no feasible individual existed at all). A spike asked for hacking `0-150` against an
inventory whose floor was 440 and silently got a 440 build. Every outcome must be checked against
its requested band and reported as unreachable rather than presented as a result.

`probePriorities(stat, 0)` finds the floor and `probePriorities(stat, HUGE)` the ceiling, both by
exploiting exactly that behaviour: a band nothing can satisfy lands on the nearest value.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
    bandsBetween, bandPriorities, classifyOutcome, probePriorities, BAND_COUNT,
} from '../statBands';

describe('bandsBetween', () => {
    it('divides the achievable range into BAND_COUNT contiguous bands', () => {
        const bands = bandsBetween(100, 600);
        expect(bands).toHaveLength(BAND_COUNT);
        expect(bands[0].min).toBe(100);
        expect(bands[BAND_COUNT - 1].max).toBe(600);
        // Contiguous: no gap a real build could fall into and be classified unreachable.
        for (let i = 1; i < bands.length; i++) {
            expect(bands[i].min).toBeLessThanOrEqual(bands[i - 1].max);
        }
    });

    it('collapses to a single band when the stat cannot move at all', () => {
        // A floor equal to the ceiling means the inventory offers no choice. Five identical
        // bands would run five identical optimizer passes for one answer.
        expect(bandsBetween(300, 300)).toEqual([{ min: 300, max: 300 }]);
    });

    it('never emits an inverted band when floor exceeds ceiling', () => {
        expect(() => bandsBetween(600, 100)).toThrow();
    });
});

describe('bandPriorities', () => {
    it('emits a HARD requirement, which only Genetic honours', () => {
        const [priority] = bandPriorities('hacking', { min: 150, max: 300 });
        expect(priority.hardRequirement).toBe(true);
        expect(priority.minLimit).toBe(150);
        expect(priority.maxLimit).toBe(300);
        expect(priority.stat).toBe('hacking');
    });
});

describe('classifyOutcome', () => {
    it('marks a landed value inside the band reachable', () => {
        expect(classifyOutcome({ min: 150, max: 300 }, 220).reachable).toBe(true);
    });

    // The measured failure: asking for 0-150 against a 440 floor silently returns 440.
    it('marks a landed value outside the band UNREACHABLE rather than accepting it', () => {
        const outcome = classifyOutcome({ min: 0, max: 150 }, 440);
        expect(outcome.reachable).toBe(false);
        expect(outcome.landed).toBe(440);
    });

    it('treats the boundaries as inside the band', () => {
        expect(classifyOutcome({ min: 150, max: 300 }, 150).reachable).toBe(true);
        expect(classifyOutcome({ min: 150, max: 300 }, 300).reachable).toBe(true);
    });
});

describe('probePriorities', () => {
    it('pins a single value, so the optimizer lands on the nearest reachable one', () => {
        const [priority] = probePriorities('hacking', 0);
        expect(priority.minLimit).toBe(0);
        expect(priority.maxLimit).toBe(0);
        expect(priority.hardRequirement).toBe(true);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/statBands.test.ts`
Expected: FAIL — cannot resolve `../statBands`.

- [ ] **Step 3: Implement**

```ts
import type { StatPriority } from '../../../types/autogear';
import type { LimitableStat } from '../../../types/stats';

export interface StatBand {
    min: number;
    max: number;
}

export interface BandOutcome {
    band: StatBand;
    /** The stat value the optimizer actually reached. */
    landed: number;
    /** False when `landed` falls outside `band` — the inventory cannot satisfy the request, and
     *  the optimizer returns the nearest build WITHOUT signalling it. */
    reachable: boolean;
}

/** Five bands plus a baseline pass plus two probes is eight optimizer passes at roughly 105,000
 *  evaluations each. This is a COST CEILING, not a tuning constant — raising it multiplies the
 *  largest compute spend in the app. */
export const BAND_COUNT = 5;

/** Pins a stat to one value. Used to discover the inventory's floor and ceiling: a band nothing
 *  can satisfy lands on the nearest reachable value, which is exactly the bound we want. */
export function probePriorities(stat: LimitableStat, value: number): StatPriority[] {
    return [{ stat, minLimit: value, maxLimit: value, hardRequirement: true }];
}

export function bandsBetween(floor: number, ceiling: number): StatBand[] {
    if (floor > ceiling) {
        throw new Error(`band floor ${floor} exceeds ceiling ${ceiling}`);
    }
    if (floor === ceiling) return [{ min: floor, max: ceiling }];

    const width = (ceiling - floor) / BAND_COUNT;
    const bands: StatBand[] = [];
    for (let i = 0; i < BAND_COUNT; i++) {
        bands.push({
            min: Math.round(floor + width * i),
            // The last band takes the exact ceiling rather than a rounded one, so the top of the
            // achievable range is always inside a band.
            max: i === BAND_COUNT - 1 ? ceiling : Math.round(floor + width * (i + 1)),
        });
    }
    return bands;
}

/** `hardRequirement` is read only by `calculateHardViolation`, which only `GeneticStrategy` calls
 *  (GeneticStrategy.ts:542,627). Under TwoPass or SetFirst these degrade to a soft penalty that
 *  will not hold a build inside the range. */
export function bandPriorities(stat: LimitableStat, band: StatBand): StatPriority[] {
    return [{ stat, minLimit: band.min, maxLimit: band.max, hardRequirement: true }];
}

export function classifyOutcome(band: StatBand, landed: number): BandOutcome {
    return { band, landed, reachable: landed >= band.min && landed <= band.max };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/statBands.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
npx tsc --noEmit && npx eslint src/utils/autogear/simRerank/statBands.ts
git add src/utils/autogear/simRerank/statBands.ts src/utils/autogear/simRerank/__tests__/statBands.test.ts
git commit -m "feat(autogear): band a stat across its achievable range, flagging unreachable bands"
```

---

### Task 6: Sparring opponents

**Files:**
- Create: `src/utils/autogear/simRerank/sparringOpponents.ts`
- Test: `src/utils/autogear/simRerank/__tests__/sparringOpponents.test.ts`

**Interfaces:**
- Consumes: `practiceBoards` from `./practiceBoard`; `gatingStatFor` from `./offFormulaStats`.
- Produces:
  ```ts
  export interface SparringOpponent { label: string; enemyBoard: BoardState; }
  export function sparringOpponents(
      focus: Ship, gatingStat: 'hacking' | 'security' | 'defence'
  ): { playerBoard: BoardState; opponents: SparringOpponent[]; focusPosition: Position };
  ```

Three opponents differing ONLY in the gating stat, at low / medium / high. Everything else is
`practiceBoard.ts`'s fixture, so any difference across the three is attributable to that one stat.

Measured justification (spec, "The answer depends on the opponent"): sweeping Xcellence's hacking
gave three different answers across enemy security 100 / 300 / 500, the third being "hacking is
irrelevant here".

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { sparringOpponents } from '../sparringOpponents';
import type { Ship } from '../../../../types/ship';

const focus = { id: 'f', name: 'Focus', type: 'ATTACKER',
    baseStats: { attack: 5000, crit: 50, critDamage: 150, hp: 50000, defence: 3000, speed: 110 },
    equipment: {}, implants: {}, refits: [],
    activeSkillText: 'This Unit deals <unit-damage>150% damage</unit-damage>.',
    activeTarget: 'front', activePattern: 'Pattern-Base' } as unknown as Ship;

describe('sparringOpponents', () => {
    it('returns exactly three opponents', () => {
        expect(sparringOpponents(focus, 'security').opponents).toHaveLength(3);
    });

    it('varies ONLY the gating stat, so any difference is attributable to it', () => {
        const { opponents } = sparringOpponents(focus, 'security');
        const securities = opponents.map(
            (o) => Object.values(o.enemyBoard)[0]!.ship!.baseStats.security
        );
        expect(new Set(securities).size).toBe(3);

        // Every other stat is identical across the three. Without this the three columns
        // differ for reasons the UI attributes to the gating stat.
        const attacks = opponents.map(
            (o) => Object.values(o.enemyBoard)[0]!.ship!.baseStats.attack
        );
        expect(new Set(attacks).size).toBe(1);
    });

    it('varies hacking when the gate is the focus resisting', () => {
        const { opponents } = sparringOpponents(focus, 'hacking');
        const hackings = opponents.map(
            (o) => Object.values(o.enemyBoard)[0]!.ship!.baseStats.hacking
        );
        expect(new Set(hackings).size).toBe(3);
    });

    it('seats the focus on the shared player board at the practice position', () => {
        const { playerBoard, focusPosition } = sparringOpponents(focus, 'defence');
        expect(playerBoard[focusPosition]?.ship?.id).toBe('f');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/sparringOpponents.test.ts`
Expected: FAIL — cannot resolve `../sparringOpponents`.

- [ ] **Step 3: Implement**

```ts
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import { practiceBoards } from './practiceBoard';

export interface SparringOpponent {
    /** Shown in the results table header, e.g. "Security 500". */
    label: string;
    enemyBoard: BoardState;
}

/** Low / medium / high for each gate. The security spread is the one the spike measured: at 100
 *  Xcellence's hacking threshold sits below 220, at 300 below 450, and at 500 hacking is inert
 *  across the whole range. */
const LEVELS: Record<'hacking' | 'security' | 'defence', [number, number, number]> = {
    hacking: [100, 300, 500],
    security: [100, 300, 500],
    defence: [2_000, 4_000, 6_000],
};

const LABEL: Record<'hacking' | 'security' | 'defence', string> = {
    hacking: 'Hacking',
    security: 'Security',
    defence: 'Defence',
};

export function sparringOpponents(
    focus: Ship,
    gatingStat: 'hacking' | 'security' | 'defence'
): { playerBoard: BoardState; opponents: SparringOpponent[]; focusPosition: Position } {
    const { playerBoard, enemyBoard } = practiceBoards(focus);
    const focusPosition = (Object.keys(playerBoard) as Position[]).find(
        (position) => playerBoard[position]?.ship?.id === focus.id
    )!;

    const opponents = LEVELS[gatingStat].map((level) => {
        const varied: BoardState = {};
        for (const [position, cell] of Object.entries(enemyBoard)) {
            if (!cell?.ship) continue;
            varied[position as Position] = {
                ...cell,
                ship: {
                    ...cell.ship,
                    baseStats: { ...cell.ship.baseStats, [gatingStat]: level },
                } as Ship,
            };
        }
        return { label: `${LABEL[gatingStat]} ${level}`, enemyBoard: varied };
    });

    return { playerBoard, opponents, focusPosition };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/sparringOpponents.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
npx tsc --noEmit && npx eslint src/utils/autogear/simRerank/sparringOpponents.ts
git add src/utils/autogear/simRerank/sparringOpponents.ts src/utils/autogear/simRerank/__tests__/sparringOpponents.test.ts
git commit -m "feat(autogear): build three sparring opponents varying the gating stat"
```

---

### Task 7: The tuning run and its panel

**Files:**
- Create: `src/hooks/useOffFormulaTuning.ts`
- Create: `src/hooks/__tests__/useOffFormulaTuning.test.ts`
- Create: `src/components/autogear/OffFormulaTuningPanel.tsx`
- Modify: `src/components/autogear/OffFormulaNotice.tsx` (add the "Measure it" control)
- Modify: `src/pages/manager/AutogearPage.tsx` (supply the runner)

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4, 5, 6; `findOptimalGearForShip` from
  `src/utils/autogear/runShipOptimizer`; `applySuggestionsToShip` from `./candidateShip`;
  `runSeedSetAsync` from `src/utils/simulator/seededRuns`.
- Produces:
  ```ts
  export interface TuningRow {
      band: StatBand; landed: number; reachable: boolean;
      /** Objective value per opponent, index-aligned with `opponents`. */
      byOpponent: number[];
      constraintHeld: boolean;
      suggestions: GearSuggestion[];
  }
  export interface TuningState {
      status: 'idle' | 'probing' | 'gearing' | 'simulating' | 'done' | 'cancelled';
      progress: { completed: number; total: number };
      rows: TuningRow[]; opponents: string[]; error?: string;
  }
  export function useOffFormulaTuning(): {
      state: TuningState;
      run: (args: TuningRunArgs) => Promise<void>;
      cancel: () => void;
  };
  ```

**Hard requirements carried from #541's post-mortem:**
- Do NOT memoise the config builder with a dependency list that omits the config getter. An
  `eslint-disable` on `react-hooks/exhaustive-deps` hid a CRITICAL bug where every run scored with
  DEFAULTS. If a suppression seems needed, the design is wrong — drop the memoisation instead.
- The run must **reset results whenever the run context changes** (ship, configured role, stat,
  seed). #541's open CodeRabbit finding is exactly this: completed results survived a context
  change and `Apply` forwarded a stale loadout.
- The optimizer must run under `AutogearAlgorithm.Genetic` regardless of the user's selected
  algorithm, and the panel must say so — bands do not hold otherwise.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOffFormulaTuning } from '../useOffFormulaTuning';

const runArgs = (over: Record<string, unknown> = {}) => ({
    ship: { id: 'x', name: 'X', type: 'ATTACKER', baseStats: {}, equipment: {}, implants: {},
        refits: [] } as never,
    configuredRole: 'ATTACKER' as never,
    stat: 'hacking' as never,
    gatingStat: 'security' as never,
    seed: 1, runCount: 4,
    runOptimizer: vi.fn(),
    deps: { getGearPiece: () => undefined, getEngineeringStatsForShipType: () => undefined } as never,
    ...over,
});

describe('useOffFormulaTuning', () => {
    it('clears previous results when a new run starts, so no stale row survives', async () => {
        const { result } = renderHook(() => useOffFormulaTuning());
        const runOptimizer = vi.fn().mockRejectedValue(new Error('boom'));
        await act(async () => { await result.current.run(runArgs({ runOptimizer })); });
        expect(result.current.state.rows).toEqual([]);
        expect(result.current.state.error).toBeTruthy();
    });

    it('runs the optimizer once per band PLUS a baseline and two probes', async () => {
        const runOptimizer = vi.fn().mockResolvedValue({ suggestions: [], landed: 200 });
        const { result } = renderHook(() => useOffFormulaTuning());
        await act(async () => { await result.current.run(runArgs({ runOptimizer })); });
        await waitFor(() => expect(result.current.state.status).toBe('done'));
        // 2 probes + 1 baseline + 5 bands. Asserting only ">= 5" would pass for an
        // implementation that never probes, which is how an unreachable band goes unnoticed.
        expect(runOptimizer).toHaveBeenCalledTimes(8);
    });

    it('marks a row unreachable when the optimizer lands outside its band', async () => {
        const runOptimizer = vi.fn().mockResolvedValue({ suggestions: [], landed: 440 });
        const { result } = renderHook(() => useOffFormulaTuning());
        await act(async () => { await result.current.run(runArgs({ runOptimizer })); });
        await waitFor(() => expect(result.current.state.status).toBe('done'));
        expect(result.current.state.rows.some((r) => !r.reachable)).toBe(true);
    });

    it('stops on cancel without writing rows', async () => {
        const runOptimizer = vi.fn().mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve({ suggestions: [], landed: 1 }), 50))
        );
        const { result } = renderHook(() => useOffFormulaTuning());
        act(() => { void result.current.run(runArgs({ runOptimizer })); });
        act(() => { result.current.cancel(); });
        await waitFor(() => expect(result.current.state.status).toBe('cancelled'));
        expect(result.current.state.rows).toEqual([]);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useOffFormulaTuning.test.ts`
Expected: FAIL — cannot resolve `../useOffFormulaTuning`.

- [ ] **Step 3: Implement the hook**

Structure it exactly as `useSimRerank.ts` does, which this mirrors deliberately: a plain async
`collectTuningRows(args)` holding all the sequencing (probe floor, probe ceiling, `bandsBetween`,
one optimizer pass per band, `applySuggestionsToShip`, `runSeedSetAsync` per opponent,
`objectiveSeries` per result), with the hook wrapping it only in React state, an `AbortController`,
and a generation ref so a superseded run never writes state. Copy `useSimRerank.ts`'s generation
and abort handling verbatim — it is already reviewed.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/hooks/__tests__/useOffFormulaTuning.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Build the panel and wire the control**

`OffFormulaTuningPanel.tsx` renders `state.rows` as a table: one row per band, one column per
opponent, the landed stat value, and an "unreachable with your gear" marker where
`reachable === false`. Use `Table` from `src/components/ui/tables/` if one exists; otherwise the
`card` class plus a plain `<table>`. Add a `Button` labelled "Measure it" to `OffFormulaNotice`,
which mounts the panel. **No Apply control in this stage** — Stage 2 writes nothing.

- [ ] **Step 6: Verify it is reachable in a browser**

Run `npm start`, open Autogear, pick Chakara or Xcellence, open Settings, press "Measure it", and
confirm the table fills, progress advances, and Cancel stops it.

- [ ] **Step 7: Typecheck, lint, changelog and commit**

Add to `UNRELEASED_CHANGES`:

```ts
'Autogear: measure how a flagged stat changes a ship in real fights.',
```

```bash
npx tsc --noEmit && npx eslint src/hooks/useOffFormulaTuning.ts src/components/autogear/OffFormulaTuningPanel.tsx src/components/autogear/OffFormulaNotice.tsx src/pages/manager/AutogearPage.tsx
git add src/hooks/useOffFormulaTuning.ts src/hooks/__tests__/useOffFormulaTuning.test.ts src/components/autogear/OffFormulaTuningPanel.tsx src/components/autogear/OffFormulaNotice.tsx src/pages/manager/AutogearPage.tsx src/constants/changelog.ts
git commit -m "feat(autogear): measure banded builds against the role's real objective"
```

---

## ⛔ STAGE 2 CHECKPOINT — STOP HERE

Report the measured table for at least Chakara (ungated, additive) and Xcellence (gated), and how
long a run took. **Do not start Stage 3 until the owner has tested and replied.** Their testing
answers: are the numbers believable, does the table show something they did not already know, is
the three-opponent split worth its compute, and is the run fast enough to use.

---

# STAGE 3 — Apply

**Deliverable the owner tests:** choosing a band writes it into the ship's autogear config, and a
normal autogear run then produces that build.

---

### Task 8: Write the chosen band into the config

**Files:**
- Modify: `src/components/autogear/OffFormulaTuningPanel.tsx` (add the Apply control)
- Modify: `src/pages/manager/AutogearPage.tsx` (handler that appends the `StatPriority`)
- Test: `src/pages/manager/__tests__/AutogearPage.offFormulaApply.test.tsx`

**Interfaces:**
- Consumes: `TuningRow` from Task 7; `bandPriorities` from Task 5.
- Produces: `onApplyBand: (row: TuningRow) => void` threaded to the panel.

Applying appends a `StatPriority` for the banded stat to the ship's existing `statPriorities`,
replacing any existing priority on the same stat rather than adding a duplicate. It does NOT set
`hardRequirement` — a hard requirement is right for a measurement pass but would make ordinary
autogear runs fail outright when the player's gear changes.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { applyBandToPriorities } from '../../../utils/autogear/simRerank/statBands';

describe('applyBandToPriorities', () => {
    it('adds a soft priority for the band, not a hard requirement', () => {
        const next = applyBandToPriorities([], 'hacking', { min: 0, max: 150 });
        expect(next).toHaveLength(1);
        expect(next[0].maxLimit).toBe(150);
        // A hard requirement would make ordinary autogear runs FAIL once gear changes.
        expect(next[0].hardRequirement).toBeFalsy();
    });

    it('replaces an existing priority on the same stat instead of duplicating it', () => {
        const existing = [{ stat: 'hacking' as const, maxLimit: 900 }];
        const next = applyBandToPriorities(existing, 'hacking', { min: 0, max: 150 });
        expect(next).toHaveLength(1);
        expect(next[0].maxLimit).toBe(150);
    });

    it('leaves priorities on other stats untouched', () => {
        const existing = [{ stat: 'attack' as const, minLimit: 5000 }];
        const next = applyBandToPriorities(existing, 'hacking', { min: 0, max: 150 });
        expect(next).toHaveLength(2);
        expect(next.find((p) => p.stat === 'attack')?.minLimit).toBe(5000);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/statBands.test.ts`
Expected: FAIL — `applyBandToPriorities` is not exported.

- [ ] **Step 3: Implement**

```ts
/** Writes a chosen band into a ship's ordinary autogear priorities. Deliberately SOFT: a hard
 *  requirement is correct for a measurement pass, where an unsatisfiable band must be visible as
 *  a failure, but it would make a normal autogear run fail outright the moment the player's gear
 *  changes. */
export function applyBandToPriorities(
    existing: StatPriority[],
    stat: LimitableStat,
    band: StatBand
): StatPriority[] {
    const others = existing.filter((priority) => priority.stat !== stat);
    return [...others, { stat, minLimit: band.min, maxLimit: band.max }];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/statBands.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Wire Apply through the panel and page**

Add a `Button` per reachable row labelled "Use this range", calling `onApplyBand(row)`. In
`AutogearPage.tsx`, the handler calls `applyBandToPriorities` and writes through the same
`onAddStatPriority` path the settings form already uses, so the new priority appears in the
existing priority list and can be edited or removed by hand.

- [ ] **Step 6: Verify the whole loop in a browser**

Run `npm start`. Pick Xcellence, open Settings, Measure it, press "Use this range" on the best
band, confirm the priority appears in the priorities list, then run normal Autogear and confirm the
resulting build's stat sits in that range.

- [ ] **Step 7: Typecheck, lint, changelog and commit**

Add to `UNRELEASED_CHANGES`:

```ts
'Autogear: apply a measured stat range straight into a ship config.',
```

```bash
npx tsc --noEmit && npx eslint src/utils/autogear/simRerank/statBands.ts src/components/autogear/OffFormulaTuningPanel.tsx src/pages/manager/AutogearPage.tsx
git add src/utils/autogear/simRerank/statBands.ts src/utils/autogear/simRerank/__tests__/statBands.test.ts src/components/autogear/OffFormulaTuningPanel.tsx src/pages/manager/AutogearPage.tsx src/constants/changelog.ts
git commit -m "feat(autogear): apply a measured stat range to a ship's config"
```

---

### Task 9: Documentation, and the #541 debts

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`
- Modify: `src/utils/autogear/CLAUDE.md`
- Modify: `src/components/autogear/SimRerankSection.tsx` (the open CodeRabbit finding)

- [ ] **Step 1: Fix #541's stale-results defect**

`SimRerankSection.tsx` never consumes `reset` from `useSimRerank`, initialises `sort` once via
`useState(() => ...)` so it never follows a role change, and has no effect that clears results. So
completed results survive changes to the configured role, fight source, seed, run count, compared
roles and equipped gear, and `Apply` forwards that stale row's loadout. Add an effect keyed on the
run context that calls `reset()`, and derive the sort metric from the current role.

- [ ] **Step 2: Write the regression test**

```tsx
it('clears completed results when the configured role changes', () => {
    // Render with results present under ATTACKER, rerender with DEFENDER, assert the table is gone.
    // Without the fix this passes stale rows to Apply.
});
```

Expand that into a real test against the rendered section; a comment-only test is a plan failure.

- [ ] **Step 3: Add the documentation card**

In `DocumentationPage.tsx`, alongside the existing "Simulate Candidates" card, add one describing
the notice and the tuning run: what triggers it, that it measures the role's objective in real
fights rather than the scoring formula, that a range can be unreachable with the player's gear, and
that the answer can differ by opponent.

- [ ] **Step 4: Update the folder guide**

In `src/utils/autogear/CLAUDE.md`, document `offFormulaStats.ts`, `roleObjectives.ts`,
`objectiveMetrics.ts`, `statBands.ts` and `sparringOpponents.ts`, and record that banding requires
`AutogearAlgorithm.Genetic`.

- [ ] **Step 5: Full suite, then commit**

```bash
npm test
```

Expected: 759+ files passing. `kitFingerprintScenarios.test.ts > pins the four ships whose clause is
still silent` fails intermittently under the pre-commit hook while passing standalone — re-run
before investigating.

```bash
git add src/pages/DocumentationPage.tsx src/utils/autogear/CLAUDE.md src/components/autogear/SimRerankSection.tsx
git commit -m "docs(autogear): document role-objective tuning, and clear stale sim-rerank results"
```

---

## Self-Review Notes

**Spec coverage.** Detector → Task 1. Notice → Task 2. Role objectives incl. the defender
inversion → Task 3. Objective metrics from round state → Task 4. Bands and the reachability rule →
Task 5. Three sparring opponents → Task 6. The run, progress and cancellation → Task 7. Apply →
Task 8. Docs plus #541's stale-results debt → Task 9. The spec's deferred open question (whether
the proposal asks which content the player gears for) is NOT implemented — Stage 2's checkpoint is
where it gets decided, with measured tables in hand.

**Known gap, deliberate.** The spec's `focusSupportOutput` folds repairs and shields into one
number with no weighting. Whether a point of shield equals a point of repair is a game question the
owner has not been asked. Task 4 implements the plain sum; if the Stage 2 table looks wrong for a
supporter, that is the first thing to revisit.

**Carried risk.** Task 7 is the largest task by far and the only one with no way to split it that
leaves a testable deliverable — the hook is useless without a panel and the panel is empty without
the hook. Expect it to need a fix round.
