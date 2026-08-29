# Community Recommendations Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a shared community recommendation carry the whole build-shaping autogear config, display it in the same vocabulary as the autogear settings panel, list every build for a ship instead of hiding alternatives, and let the user apply a build to their config in one click.

**Architecture:** A new `shared_config` jsonb column on `community_recommendations` holds a versioned `SharedAutogearBuild`. It is Zod-validated on write and on read (it is user-authored data read by every other user, then fed to the autogear engine). A pure adapter turns a database row into a `CommunityBuild` read-model, falling back to the three legacy columns for pre-migration rows. The UI becomes a browsable list of one-line rows; the expanded row renders the build using the settings panel's exact wording, and its Apply button writes only the seven build fields into page config via the existing `updateShipConfig`.

**Tech Stack:** React 18 + TypeScript, TailwindCSS, Supabase (Postgres + RLS), Zod 4, Vitest + React Testing Library.

## Global Constraints

- **Shared fields (the "build"):** `shipRole`, `statPriorities`, `setPriorities`, `statBonuses`, `fleetBuffs`, `excludedImplantTypes`, `optimizeImplants`. Exactly these seven — no more.
- **Personal fields, never shared and never written by Apply:** `algorithm`, `ignoreEquipped`, `ignoreUnleveled`, `useUpgradedStats`, `tryToCompleteSets`, `includeCalibratedGear`, `assumeCalibrated`, `useArenaModifiers`.
- **UI primitives:** always use `src/components/ui/` — `Button`, `Select`, `ConfirmModal`, `CollapsibleAccordion`, the `card` class. Never a raw `<button>` except a full-width accordion/expand toggle. Never `dangerouslySetInnerHTML` (ESLint `react/no-danger` is an error).
- **No emojis in UI text.** Plain text plus colour classes.
- **Total-safe lookups.** `STATS`, `GEAR_SETS`, `SHIP_TYPES`, `IMPLANTS` are `Record<string, …>`; they gate authoring, not input. Every lookup keyed by data from a community payload must use `?.` with a fallback, or `getLimitStatLabel()`.
- **`in` is unsafe for membership on these records** — `'toString' in STATS` is `true`. Always use `Object.prototype.hasOwnProperty.call(RECORD, key)`.
- **Percentage stats are stored as integers** (`crit: 70`, not `0.70`). Fixtures must match.
- **Husky pre-commit runs the full `npm test` suite**, so every commit step is also a full-suite gate. Expect it to take a few minutes.
- **`docs/` is gitignored** — spec and plan files were added with `git add -f`. Source files are not affected.
- Run tests with `npx vitest run <path>`; run the whole suite with `npm test`. Typecheck with `npx tsc --noEmit`.

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260829000001_community_recommendation_shared_config.sql` | Adds the `shared_config jsonb` column |
| `src/schemas/sharedAutogearBuild.ts` | Zod schema + `validateSharedAutogearBuild` |
| `src/schemas/sharedAutogearBuild.test.ts` | Schema tests |
| `src/utils/communityBuild.ts` | Pure adapter, sort, config↔build conversion, emptiness test |
| `src/utils/__tests__/communityBuild.test.ts` | Adapter/sort tests |
| `src/utils/communityBuildSummary.ts` | The one-line row summary string |
| `src/utils/__tests__/communityBuildSummary.test.ts` | Summary tests |
| `src/components/autogear/CommunityBuildDetails.tsx` | Expanded build body (settings-panel vocabulary) |
| `src/components/autogear/CommunityBuildRow.tsx` | One collapsed list row |
| `src/components/autogear/CommunityBuildList.tsx` | The list, sort control, expansion state |
| `src/components/autogear/__tests__/CommunityBuildDetails.test.tsx` | Details rendering tests |
| `src/components/autogear/__tests__/CommunityBuildList.test.tsx` | List/expand/apply tests |

**Modify:** `src/types/communityRecommendation.ts`, `src/services/communityRecommendations.ts`, `src/hooks/useCommunityRecommendations.ts`, `src/components/autogear/CommunityRecommendations.tsx`, `RecommendationHeader.tsx`, `ShareRecommendationForm.tsx`, `StatBonusRow.tsx`, `FleetBuffRow.tsx`, `AutogearQuickSettings.tsx`, `src/pages/manager/AutogearPage.tsx`, `src/pages/DocumentationPage.tsx`, `src/constants/changelog.ts`.

**Delete:** `src/components/autogear/AlternativeRecommendations.tsx`, `src/components/autogear/RecommendationContent.tsx`, `src/components/autogear/CommunityActions.tsx` (its vote buttons move into `CommunityBuildDetails` and its share button into `CommunityRecommendations`).

---

### Task 1: `SharedAutogearBuild` type and Zod schema

The payload type and its validator. Everything else depends on this.

**Files:**
- Modify: `src/types/communityRecommendation.ts`
- Create: `src/schemas/sharedAutogearBuild.ts`
- Test: `src/schemas/sharedAutogearBuild.test.ts`

**Interfaces:**
- Consumes: `StatPriority`, `SetPriority`, `StatBonus`, `FleetBuff` from `src/types/autogear`; `STATS`, `DERIVED_STAT_LABELS` from `src/constants/stats`; `GEAR_SETS` from `src/constants/gearSets`; `IMPLANTS` from `src/constants/implants`; `SHIP_TYPES` from `src/constants/shipTypes`.
- Produces:
  - `interface SharedAutogearBuild` (in `src/types/communityRecommendation.ts`)
  - `sharedAutogearBuildSchema` (Zod)
  - `validateSharedAutogearBuild(raw: unknown): SharedAutogearBuild | null`

- [ ] **Step 1: Add the `SharedAutogearBuild` type**

Append to `src/types/communityRecommendation.ts` (keep the existing `AIRecommendation` for now; Task 8 deletes it):

Extend the existing first import line to `import { StatPriority, SetPriority, StatBonus, FleetBuff } from './autogear';`, add `import type { ShipTypeName } from '../constants/shipTypes';`, then append:

```ts
/**
 * The portion of a SavedAutogearConfig that is shared with the community.
 *
 * Deliberately excludes the personal toggles (algorithm, ignoreEquipped,
 * ignoreUnleveled, useUpgradedStats, tryToCompleteSets, includeCalibratedGear,
 * assumeCalibrated, useArenaModifiers) — those describe the sharer's own
 * inventory and preferences, not the build.
 *
 * `version` exists so a future shape change can be migrated on read.
 */
export interface SharedAutogearBuild {
    version: 1;
    shipRole: ShipTypeName;
    /** Order IS the priority — StatPriority.weight is hardcoded to 1 everywhere. */
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    fleetBuffs: FleetBuff[];
    excludedImplantTypes: string[];
    optimizeImplants: boolean;
}
```

Add the column to the row type, on `CommunityRecommendation`:

```ts
    /** Present on rows written after the 2026-08-29 migration; null on older rows. */
    shared_config?: unknown;
```

It is typed `unknown` on purpose: it is untrusted until `validateSharedAutogearBuild` has run.

- [ ] **Step 2: Write the failing schema test**

Create `src/schemas/sharedAutogearBuild.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateSharedAutogearBuild } from './sharedAutogearBuild';
import type { SharedAutogearBuild } from '../types/communityRecommendation';

const validBuild: SharedAutogearBuild = {
    version: 1,
    shipRole: 'ATTACKER',
    statPriorities: [
        { stat: 'crit', minLimit: 100, hardRequirement: true },
        { stat: 'critDamage' },
        { stat: 'effectiveHp', minLimit: 30000 },
    ],
    setPriorities: [
        { setName: 'CRITICAL', count: 4 },
        { setName: 'MARTYRDOM', count: 1, kind: 'implant' },
    ],
    statBonuses: [
        { stat: 'attack', percentage: 30, mode: 'additive' },
        { stat: 'speed', percentage: 50, mode: 'multiplier' },
    ],
    fleetBuffs: [{ stat: 'attack', percentage: 30 }],
    excludedImplantTypes: ['MARTYRDOM'],
    optimizeImplants: true,
};

describe('validateSharedAutogearBuild', () => {
    it('accepts a full valid build and round-trips it unchanged', () => {
        expect(validateSharedAutogearBuild(structuredClone(validBuild))).toEqual(validBuild);
    });

    it('accepts a derived limit stat (effectiveHp) as a stat priority', () => {
        const build = { ...structuredClone(validBuild), statPriorities: [{ stat: 'effectiveHp' }] };
        expect(validateSharedAutogearBuild(build)?.statPriorities[0].stat).toBe('effectiveHp');
    });

    it('rejects an unknown stat in statPriorities', () => {
        const build = { ...structuredClone(validBuild), statPriorities: [{ stat: 'defense' }] };
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('rejects a derived stat in statBonuses (bonuses are real stats only)', () => {
        const build = {
            ...structuredClone(validBuild),
            statBonuses: [{ stat: 'effectiveHp', percentage: 10, mode: 'additive' }],
        };
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('rejects an unknown gear set name', () => {
        const build = {
            ...structuredClone(validBuild),
            setPriorities: [{ setName: 'NOT_A_SET', count: 4 }],
        };
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('rejects an unknown ship role', () => {
        const build = { ...structuredClone(validBuild), shipRole: 'WIZARD' };
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('does not treat inherited Object keys as valid stats', () => {
        const build = { ...structuredClone(validBuild), statPriorities: [{ stat: 'toString' }] };
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('rejects a missing version', () => {
        const build = structuredClone(validBuild) as Record<string, unknown>;
        delete build.version;
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('rejects a future version', () => {
        expect(validateSharedAutogearBuild({ ...structuredClone(validBuild), version: 2 })).toBeNull();
    });

    it('rejects wrong types', () => {
        expect(validateSharedAutogearBuild({ ...structuredClone(validBuild), optimizeImplants: 'yes' })).toBeNull();
    });

    it('rejects null and non-objects', () => {
        expect(validateSharedAutogearBuild(null)).toBeNull();
        expect(validateSharedAutogearBuild('nope')).toBeNull();
        expect(validateSharedAutogearBuild(undefined)).toBeNull();
    });

    it('strips unknown top-level keys rather than failing', () => {
        const build = { ...structuredClone(validBuild), evil: 'payload' };
        const result = validateSharedAutogearBuild(build);
        expect(result).not.toBeNull();
        expect(result as unknown as Record<string, unknown>).not.toHaveProperty('evil');
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/schemas/sharedAutogearBuild.test.ts`
Expected: FAIL — cannot resolve `./sharedAutogearBuild`.

- [ ] **Step 4: Implement the schema**

Create `src/schemas/sharedAutogearBuild.ts`:

```ts
import { z } from 'zod';
import { STATS, DERIVED_STAT_LABELS } from '../constants/stats';
import { GEAR_SETS } from '../constants/gearSets';
import { IMPLANTS } from '../constants/implants';
import { SHIP_TYPES } from '../constants/shipTypes';
import type { SharedAutogearBuild } from '../types/communityRecommendation';

// `key in RECORD` is unsafe here: these are plain objects, so 'toString' and
// friends would pass. Own-property only.
const isKeyOf = (record: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(record, key);

/** Real gear/base stats — valid for stat bonuses and fleet buffs. */
const statNameSchema = z
    .string()
    .refine((v) => isKeyOf(STATS, v), { message: 'Unknown stat' });

/** Base stats plus derived limit stats (effectiveHp) — valid for stat priorities. */
const limitableStatSchema = z
    .string()
    .refine((v) => isKeyOf(STATS, v) || isKeyOf(DERIVED_STAT_LABELS, v), {
        message: 'Unknown limit stat',
    });

/** Gear set keys and implant keys share the setPriorities list (kind: 'implant'). */
const setNameSchema = z
    .string()
    .refine((v) => isKeyOf(GEAR_SETS, v) || isKeyOf(IMPLANTS, v), { message: 'Unknown set' });

const implantKeySchema = z
    .string()
    .refine((v) => isKeyOf(IMPLANTS, v), { message: 'Unknown implant' });

const shipRoleSchema = z
    .string()
    .refine((v) => isKeyOf(SHIP_TYPES, v), { message: 'Unknown ship role' });

const statPrioritySchema = z.object({
    stat: limitableStatSchema,
    weight: z.number().optional(),
    minLimit: z.number().optional(),
    maxLimit: z.number().optional(),
    hardRequirement: z.boolean().optional(),
});

const setPrioritySchema = z.object({
    setName: setNameSchema,
    count: z.number().int().min(0).max(6),
    kind: z.literal('implant').optional(),
});

const statBonusSchema = z.object({
    stat: statNameSchema,
    percentage: z.number(),
    mode: z.enum(['additive', 'multiplier']).optional(),
});

const fleetBuffSchema = z.object({
    stat: statNameSchema,
    percentage: z.number(),
});

// Object schemas strip unknown keys by default (zod's .strip()), which is what
// we want for a foreign payload: sanitise rather than reject on an extra field.
export const sharedAutogearBuildSchema = z.object({
    version: z.literal(1),
    shipRole: shipRoleSchema,
    statPriorities: z.array(statPrioritySchema),
    setPriorities: z.array(setPrioritySchema),
    statBonuses: z.array(statBonusSchema),
    fleetBuffs: z.array(fleetBuffSchema),
    excludedImplantTypes: z.array(implantKeySchema),
    optimizeImplants: z.boolean(),
});

/**
 * Validate an untrusted shared build. Returns null rather than throwing —
 * callers fall back to the legacy columns or drop the row.
 *
 * This runs on every row read from `community_recommendations.shared_config`,
 * which is authored by other users and ends up in the autogear engine.
 */
export const validateSharedAutogearBuild = (raw: unknown): SharedAutogearBuild | null => {
    const result = sharedAutogearBuildSchema.safeParse(raw);
    return result.success ? (result.data as SharedAutogearBuild) : null;
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/schemas/sharedAutogearBuild.test.ts`
Expected: PASS, 12 tests.

If the `MARTYRDOM` / `CRITICAL` / `ATTACKER` keys used in the fixture do not exist, check the real keys with:
`grep -o "^    [A-Z_]*:" src/constants/gearSets.ts src/constants/implants.ts src/constants/shipTypes.ts | head -40`
and update the fixture. Do not weaken the schema to accommodate a wrong fixture.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/types/communityRecommendation.ts src/schemas/sharedAutogearBuild.ts src/schemas/sharedAutogearBuild.test.ts
git commit -m "feat(community): add SharedAutogearBuild payload type and Zod validator"
```

---

### Task 2: Pure adapter, sort, and config conversion

Everything that turns a raw database row into something the UI can render, and back. Pure functions, no I/O, fully unit-testable.

**Files:**
- Create: `src/utils/communityBuild.ts`
- Test: `src/utils/__tests__/communityBuild.test.ts`

**Interfaces:**
- Consumes: `SharedAutogearBuild`, `CommunityRecommendation` (Task 1); `validateSharedAutogearBuild` (Task 1).
- Produces:
  - `interface CommunityBuild`
  - `type CommunityBuildSort = 'top' | 'newest'`
  - `toCommunityBuild(row: CommunityRecommendation): CommunityBuild | null`
  - `sortCommunityBuilds(builds: CommunityBuild[], equippedUltimateImplant: string | null, sort: CommunityBuildSort): CommunityBuild[]`
  - `isImplantMatch(build: CommunityBuild, equippedUltimateImplant: string | null): boolean`
  - `configToSharedBuild(config: AutogearBuildFields): SharedAutogearBuild | null`
  - `hasExistingBuildConfig(config: AutogearBuildFields): boolean`
  - `interface AutogearBuildFields`

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/communityBuild.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    toCommunityBuild,
    sortCommunityBuilds,
    isImplantMatch,
    configToSharedBuild,
    hasExistingBuildConfig,
} from '../communityBuild';
import type { CommunityRecommendation, SharedAutogearBuild } from '../../types/communityRecommendation';

const sharedConfig: SharedAutogearBuild = {
    version: 1,
    shipRole: 'ATTACKER',
    statPriorities: [{ stat: 'crit', minLimit: 100, hardRequirement: true }],
    setPriorities: [{ setName: 'CRITICAL', count: 4 }],
    statBonuses: [{ stat: 'attack', percentage: 30, mode: 'additive' }],
    fleetBuffs: [{ stat: 'attack', percentage: 30 }],
    excludedImplantTypes: ['MARTYRDOM'],
    optimizeImplants: true,
};

const makeRow = (over: Partial<CommunityRecommendation> = {}): CommunityRecommendation =>
    ({
        id: 'r1',
        ship_name: 'Ares',
        ship_refit_level: 3,
        title: 'Crit Bruiser',
        description: 'caps crit',
        is_implant_specific: false,
        ship_role: 'ATTACKER',
        stat_priorities: [{ stat: 'crit', minLimit: 100, hardRequirement: true }],
        stat_bonuses: [{ stat: 'attack', percentage: 30, mode: 'additive' }],
        set_priorities: [{ setName: 'CRITICAL', count: 4 }],
        upvotes: 10,
        downvotes: 1,
        total_votes: 11,
        score: 0.9,
        created_at: '2026-08-01T00:00:00Z',
        ...over,
    }) as CommunityRecommendation;

describe('toCommunityBuild', () => {
    it('uses shared_config when it is present and valid', () => {
        const build = toCommunityBuild(makeRow({ shared_config: sharedConfig }));
        expect(build?.isLegacy).toBe(false);
        expect(build?.build.fleetBuffs).toEqual([{ stat: 'attack', percentage: 30 }]);
        expect(build?.build.optimizeImplants).toBe(true);
        expect(build?.build.excludedImplantTypes).toEqual(['MARTYRDOM']);
    });

    it('synthesises from the legacy columns when shared_config is absent', () => {
        const build = toCommunityBuild(makeRow());
        expect(build?.isLegacy).toBe(true);
        expect(build?.build.shipRole).toBe('ATTACKER');
        expect(build?.build.statPriorities).toEqual([
            { stat: 'crit', minLimit: 100, hardRequirement: true },
        ]);
        expect(build?.build.fleetBuffs).toEqual([]);
        expect(build?.build.excludedImplantTypes).toEqual([]);
        expect(build?.build.optimizeImplants).toBe(false);
    });

    it('falls back to the legacy columns when shared_config is corrupt rather than throwing', () => {
        const build = toCommunityBuild(makeRow({ shared_config: { version: 1, shipRole: 'WIZARD' } }));
        expect(build?.isLegacy).toBe(true);
        expect(build?.build.shipRole).toBe('ATTACKER');
    });

    it('drops a row whose legacy columns are unusable too', () => {
        expect(toCommunityBuild(makeRow({ shared_config: null, ship_role: 'WIZARD' }))).toBeNull();
    });

    it('carries the row metadata onto the read model', () => {
        const build = toCommunityBuild(makeRow({ shared_config: sharedConfig }));
        expect(build).toMatchObject({
            id: 'r1',
            title: 'Crit Bruiser',
            shipRefitLevel: 3,
            upvotes: 10,
            downvotes: 1,
        });
    });
});

describe('sortCommunityBuilds', () => {
    const generic = toCommunityBuild(makeRow({ id: 'generic', score: 0.5, created_at: '2026-01-01T00:00:00Z' }))!;
    const mine = toCommunityBuild(
        makeRow({
            id: 'mine',
            score: 0.1,
            created_at: '2026-02-01T00:00:00Z',
            is_implant_specific: true,
            ultimate_implant: 'Havoc',
        })
    )!;
    const theirs = toCommunityBuild(
        makeRow({
            id: 'theirs',
            score: 0.99,
            created_at: '2026-03-01T00:00:00Z',
            is_implant_specific: true,
            ultimate_implant: 'Martyrdom',
        })
    )!;

    it('groups matching implant first, generic second, other implant last', () => {
        const sorted = sortCommunityBuilds([theirs, generic, mine], 'Havoc', 'top');
        expect(sorted.map((b) => b.id)).toEqual(['mine', 'generic', 'theirs']);
    });

    it('puts implant-specific builds last when no ultimate implant is equipped', () => {
        const sorted = sortCommunityBuilds([theirs, generic, mine], null, 'top');
        expect(sorted[0].id).toBe('generic');
    });

    it('orders by score within a group for "top"', () => {
        const low = toCommunityBuild(makeRow({ id: 'low', score: 0.2 }))!;
        const high = toCommunityBuild(makeRow({ id: 'high', score: 0.8 }))!;
        expect(sortCommunityBuilds([low, high], null, 'top').map((b) => b.id)).toEqual(['high', 'low']);
    });

    it('orders by created_at within a group for "newest"', () => {
        const old = toCommunityBuild(makeRow({ id: 'old', score: 0.9, created_at: '2026-01-01T00:00:00Z' }))!;
        const recent = toCommunityBuild(makeRow({ id: 'recent', score: 0.1, created_at: '2026-06-01T00:00:00Z' }))!;
        expect(sortCommunityBuilds([old, recent], null, 'newest').map((b) => b.id)).toEqual([
            'recent',
            'old',
        ]);
    });

    it('does not mutate its input', () => {
        const input = [theirs, generic, mine];
        sortCommunityBuilds(input, 'Havoc', 'top');
        expect(input.map((b) => b.id)).toEqual(['theirs', 'generic', 'mine']);
    });
});

describe('isImplantMatch', () => {
    it('is true only for an implant-specific build matching the equipped implant', () => {
        const specific = toCommunityBuild(
            makeRow({ is_implant_specific: true, ultimate_implant: 'Havoc' })
        )!;
        const generic = toCommunityBuild(makeRow())!;
        expect(isImplantMatch(specific, 'Havoc')).toBe(true);
        expect(isImplantMatch(specific, 'Martyrdom')).toBe(false);
        expect(isImplantMatch(specific, null)).toBe(false);
        expect(isImplantMatch(generic, 'Havoc')).toBe(false);
    });
});

describe('configToSharedBuild', () => {
    const config = {
        shipRole: 'ATTACKER' as const,
        statPriorities: [{ stat: 'crit' as const, minLimit: 100 }],
        setPriorities: [{ setName: 'CRITICAL', count: 4 }],
        statBonuses: [{ stat: 'attack', percentage: 30, mode: 'additive' as const }],
        fleetBuffs: [{ stat: 'attack' as const, percentage: 30 }],
        excludedImplantTypes: ['MARTYRDOM'],
        optimizeImplants: true,
    };

    it('produces a version-1 build carrying all seven fields', () => {
        expect(configToSharedBuild(config)).toEqual({ version: 1, ...config });
    });

    it('returns null without a ship role', () => {
        expect(configToSharedBuild({ ...config, shipRole: null })).toBeNull();
    });

    it('defaults the optional arrays', () => {
        const build = configToSharedBuild({
            shipRole: 'ATTACKER',
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
        });
        expect(build).toEqual({
            version: 1,
            shipRole: 'ATTACKER',
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
            fleetBuffs: [],
            excludedImplantTypes: [],
            optimizeImplants: false,
        });
    });
});

describe('hasExistingBuildConfig', () => {
    const empty = {
        shipRole: 'ATTACKER' as const,
        statPriorities: [],
        setPriorities: [],
        statBonuses: [],
        fleetBuffs: [],
        excludedImplantTypes: [],
        optimizeImplants: false,
    };

    it('is false for an empty config even though shipRole is always set', () => {
        expect(hasExistingBuildConfig(empty)).toBe(false);
    });

    it('is true when any build list has an entry', () => {
        expect(hasExistingBuildConfig({ ...empty, statPriorities: [{ stat: 'crit' }] })).toBe(true);
        expect(hasExistingBuildConfig({ ...empty, setPriorities: [{ setName: 'CRITICAL', count: 4 }] })).toBe(true);
        expect(hasExistingBuildConfig({ ...empty, statBonuses: [{ stat: 'attack', percentage: 1 }] })).toBe(true);
        expect(hasExistingBuildConfig({ ...empty, fleetBuffs: [{ stat: 'attack', percentage: 1 }] })).toBe(true);
        expect(hasExistingBuildConfig({ ...empty, excludedImplantTypes: ['MARTYRDOM'] })).toBe(true);
    });

    it('is true when optimizeImplants is on', () => {
        expect(hasExistingBuildConfig({ ...empty, optimizeImplants: true })).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/__tests__/communityBuild.test.ts`
Expected: FAIL — cannot resolve `../communityBuild`.

- [ ] **Step 3: Implement the adapter**

Create `src/utils/communityBuild.ts`:

```ts
import type { ShipTypeName } from '../constants/shipTypes';
import type { StatPriority, SetPriority, StatBonus, FleetBuff } from '../types/autogear';
import type {
    CommunityRecommendation,
    SharedAutogearBuild,
} from '../types/communityRecommendation';
import { validateSharedAutogearBuild } from '../schemas/sharedAutogearBuild';

/** The build-shaping slice of the autogear page's per-ship config. */
export interface AutogearBuildFields {
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    fleetBuffs?: FleetBuff[];
    excludedImplantTypes?: string[];
    optimizeImplants?: boolean;
}

/** A community recommendation resolved into something the UI can render. */
export interface CommunityBuild {
    id: string;
    shipName: string;
    shipRefitLevel: number;
    title: string;
    description?: string;
    isImplantSpecific: boolean;
    ultimateImplant?: string;
    upvotes: number;
    downvotes: number;
    score: number;
    createdAt: string;
    build: SharedAutogearBuild;
    /** True when the build was synthesised from the pre-2026-08-29 columns. */
    isLegacy: boolean;
}

export type CommunityBuildSort = 'top' | 'newest';

/**
 * Resolve a database row into a CommunityBuild.
 *
 * Prefers `shared_config`. Falls back to the legacy ship_role/stat_priorities/
 * stat_bonuses/set_priorities columns when it is absent OR fails validation —
 * a corrupt payload must degrade, not throw. Returns null when the legacy
 * columns cannot be validated either, in which case the caller drops the row.
 */
export const toCommunityBuild = (row: CommunityRecommendation): CommunityBuild | null => {
    const meta = {
        id: row.id,
        shipName: row.ship_name,
        shipRefitLevel: row.ship_refit_level ?? 0,
        title: row.title,
        description: row.description,
        isImplantSpecific: !!row.is_implant_specific,
        ultimateImplant: row.ultimate_implant,
        upvotes: row.upvotes ?? 0,
        downvotes: row.downvotes ?? 0,
        score: row.score ?? 0,
        createdAt: row.created_at,
    };

    const fromSharedConfig = validateSharedAutogearBuild(row.shared_config);
    if (fromSharedConfig) {
        return { ...meta, build: fromSharedConfig, isLegacy: false };
    }

    const fromLegacy = validateSharedAutogearBuild({
        version: 1,
        shipRole: row.ship_role,
        statPriorities: row.stat_priorities ?? [],
        setPriorities: row.set_priorities ?? [],
        statBonuses: row.stat_bonuses ?? [],
        fleetBuffs: [],
        excludedImplantTypes: [],
        optimizeImplants: false,
    });
    if (fromLegacy) {
        return { ...meta, build: fromLegacy, isLegacy: true };
    }

    console.warn(`Dropping unusable community recommendation ${row.id}`);
    return null;
};

/** True when this build is tagged for the ultimate implant the ship has equipped. */
export const isImplantMatch = (
    build: CommunityBuild,
    equippedUltimateImplant: string | null
): boolean =>
    build.isImplantSpecific &&
    !!equippedUltimateImplant &&
    build.ultimateImplant === equippedUltimateImplant;

// 0 = tagged for my implant, 1 = generic, 2 = tagged for a different implant.
const implantGroup = (build: CommunityBuild, equipped: string | null): number => {
    if (isImplantMatch(build, equipped)) return 0;
    if (!build.isImplantSpecific) return 1;
    return 2;
};

/**
 * Group by implant relevance, then order within each group by the chosen sort.
 * Implant grouping always applies and is not user-controllable — a build for a
 * different ultimate implant stays visible, just last.
 */
export const sortCommunityBuilds = (
    builds: CommunityBuild[],
    equippedUltimateImplant: string | null,
    sort: CommunityBuildSort
): CommunityBuild[] =>
    [...builds].sort((a, b) => {
        const groupDelta =
            implantGroup(a, equippedUltimateImplant) - implantGroup(b, equippedUltimateImplant);
        if (groupDelta !== 0) return groupDelta;

        if (sort === 'newest') {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }

        if (b.score !== a.score) return b.score - a.score;
        const votesDelta = b.upvotes + b.downvotes - (a.upvotes + a.downvotes);
        if (votesDelta !== 0) return votesDelta;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

/** Build the shareable payload from the page's per-ship config. Null without a role. */
export const configToSharedBuild = (config: AutogearBuildFields): SharedAutogearBuild | null => {
    if (!config.shipRole) return null;
    return {
        version: 1,
        shipRole: config.shipRole,
        statPriorities: config.statPriorities,
        setPriorities: config.setPriorities,
        statBonuses: config.statBonuses,
        fleetBuffs: config.fleetBuffs ?? [],
        excludedImplantTypes: config.excludedImplantTypes ?? [],
        optimizeImplants: config.optimizeImplants ?? false,
    };
};

/**
 * Whether applying a build would overwrite something. shipRole is excluded on
 * purpose: it always defaults to the ship's own type, so it is never empty and
 * would make every config look non-empty.
 */
export const hasExistingBuildConfig = (config: AutogearBuildFields): boolean =>
    config.statPriorities.length > 0 ||
    config.setPriorities.length > 0 ||
    config.statBonuses.length > 0 ||
    (config.fleetBuffs?.length ?? 0) > 0 ||
    (config.excludedImplantTypes?.length ?? 0) > 0 ||
    config.optimizeImplants === true;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/__tests__/communityBuild.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/utils/communityBuild.ts src/utils/__tests__/communityBuild.test.ts
git commit -m "feat(community): add CommunityBuild adapter, implant-aware sort, config conversion"
```

---

### Task 3: The one-line row summary

The second line of a collapsed list row. Must never crash on an unknown key.

**Files:**
- Create: `src/utils/communityBuildSummary.ts`
- Test: `src/utils/__tests__/communityBuildSummary.test.ts`

**Interfaces:**
- Consumes: `SharedAutogearBuild` (Task 1); `SHIP_TYPES`, `GEAR_SETS`, `IMPLANTS`, `STATS`, `getLimitStatLabel`.
- Produces: `communityBuildSummary(build: SharedAutogearBuild): string`

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/communityBuildSummary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { communityBuildSummary } from '../communityBuildSummary';
import type { SharedAutogearBuild } from '../../types/communityRecommendation';

const base: SharedAutogearBuild = {
    version: 1,
    shipRole: 'ATTACKER',
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    fleetBuffs: [],
    excludedImplantTypes: [],
    optimizeImplants: false,
};

describe('communityBuildSummary', () => {
    it('leads with the role name', () => {
        expect(communityBuildSummary(base)).toContain('Attacker');
    });

    it('includes set piece counts, so a 4-piece differs from a 2-piece', () => {
        const four = communityBuildSummary({ ...base, setPriorities: [{ setName: 'CRITICAL', count: 4 }] });
        const two = communityBuildSummary({ ...base, setPriorities: [{ setName: 'CRITICAL', count: 2 }] });
        expect(four).toContain('4x Critical');
        expect(four).not.toEqual(two);
    });

    it('names an implant-kind set priority without a piece count', () => {
        const summary = communityBuildSummary({
            ...base,
            setPriorities: [{ setName: 'MARTYRDOM', count: 1, kind: 'implant' }],
        });
        expect(summary).toContain('Martyrdom');
        expect(summary).not.toContain('1x Martyrdom');
    });

    it('includes only limit-carrying stat priorities', () => {
        const summary = communityBuildSummary({
            ...base,
            statPriorities: [
                { stat: 'crit', minLimit: 100 },
                { stat: 'critDamage' },
                { stat: 'speed', maxLimit: 200 },
            ],
        });
        expect(summary).toContain('Crit Rate min 100');
        expect(summary).toContain('Speed max 200');
        expect(summary).not.toContain('Crit Damage');
    });

    it('distinguishes an additive bonus from a multiplier bonus', () => {
        const additive = communityBuildSummary({
            ...base,
            statBonuses: [{ stat: 'attack', percentage: 30, mode: 'additive' }],
        });
        const multiplier = communityBuildSummary({
            ...base,
            statBonuses: [{ stat: 'attack', percentage: 30, mode: 'multiplier' }],
        });
        expect(additive).toContain('Attack 30% additive');
        expect(multiplier).toContain('Attack 30% multiplier');
        expect(additive).not.toEqual(multiplier);
    });

    it('treats a bonus with no mode as additive, matching StatBonusRow', () => {
        expect(
            communityBuildSummary({ ...base, statBonuses: [{ stat: 'attack', percentage: 30 }] })
        ).toContain('Attack 30% additive');
    });

    it('falls back to the raw key for an unknown set rather than crashing', () => {
        expect(() =>
            communityBuildSummary({ ...base, setPriorities: [{ setName: 'MYSTERY', count: 4 }] })
        ).not.toThrow();
        expect(
            communityBuildSummary({ ...base, setPriorities: [{ setName: 'MYSTERY', count: 4 }] })
        ).toContain('4x MYSTERY');
    });

    it('joins parts with a middot separator', () => {
        const summary = communityBuildSummary({
            ...base,
            setPriorities: [{ setName: 'CRITICAL', count: 4 }],
        });
        expect(summary).toBe('Attacker · 4x Critical');
    });

    it('returns just the role when nothing else is configured', () => {
        expect(communityBuildSummary(base)).toBe('Attacker');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/__tests__/communityBuildSummary.test.ts`
Expected: FAIL — cannot resolve `../communityBuildSummary`.

- [ ] **Step 3: Implement the summary**

Create `src/utils/communityBuildSummary.ts`:

```ts
import { SHIP_TYPES } from '../constants/shipTypes';
import { GEAR_SETS } from '../constants/gearSets';
import { IMPLANTS } from '../constants/implants';
import { STATS, getLimitStatLabel } from '../constants/stats';
import type { StatName } from '../types/stats';
import type { SharedAutogearBuild } from '../types/communityRecommendation';

// Every lookup below is keyed by community-authored data, so every one falls
// back to the raw key rather than indexing a Record and trusting the result.
const setLabel = (setName: string): string =>
    GEAR_SETS[setName]?.name ?? IMPLANTS[setName]?.name ?? setName;

/**
 * One-line config summary for a collapsed community build row, in the same
 * style as the per-ship summary in AutogearConfigList.
 *
 * e.g. "Attacker · 4x Critical, 2x Power · Crit Rate min 100 · Attack 30% additive"
 */
export const communityBuildSummary = (build: SharedAutogearBuild): string => {
    const parts: string[] = [];

    parts.push(SHIP_TYPES[build.shipRole]?.name ?? build.shipRole);

    if (build.setPriorities.length > 0) {
        parts.push(
            build.setPriorities
                .map((set) =>
                    set.kind === 'implant'
                        ? setLabel(set.setName)
                        : `${set.count}x ${setLabel(set.setName)}`
                )
                .join(', ')
        );
    }

    // Only limit-carrying priorities say anything in one line; an unlimited
    // priority's strength is its position in the list, which a summary can't show.
    const limits = build.statPriorities
        .filter((priority) => priority.minLimit !== undefined || priority.maxLimit !== undefined)
        .map((priority) => {
            const bounds: string[] = [];
            if (priority.minLimit !== undefined) bounds.push(`min ${priority.minLimit}`);
            if (priority.maxLimit !== undefined) bounds.push(`max ${priority.maxLimit}`);
            return `${getLimitStatLabel(priority.stat)} ${bounds.join(' ')}`;
        });
    if (limits.length > 0) parts.push(limits.join(', '));

    if (build.statBonuses.length > 0) {
        parts.push(
            build.statBonuses
                .map(
                    (bonus) =>
                        `${STATS[bonus.stat as StatName]?.label ?? bonus.stat} ${bonus.percentage}% ${
                            bonus.mode === 'multiplier' ? 'multiplier' : 'additive'
                        }`
                )
                .join(', ')
        );
    }

    return parts.join(' · ');
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/__tests__/communityBuildSummary.test.ts`
Expected: PASS, 9 tests.

If `SHIP_TYPES.ATTACKER.name` is not the string `'Attacker'`, or `GEAR_SETS.CRITICAL.name` is not `'Critical'`, correct the *expectations* to the real labels — do not change the implementation to match a wrong guess. Check with:
`node -e "console.log(1)"` is not enough; read the constants directly with `grep -n "name:" src/constants/shipTypes.ts | head`.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/utils/communityBuildSummary.ts src/utils/__tests__/communityBuildSummary.test.ts
git commit -m "feat(community): add one-line community build summary"
```

---

### Task 4: Migration and service layer

The column, the single list query, and the dual-write share path.

**Files:**
- Create: `supabase/migrations/20260829000001_community_recommendation_shared_config.sql`
- Modify: `src/services/communityRecommendations.ts`
- Modify: `src/types/communityRecommendation.ts`

**Interfaces:**
- Consumes: `SharedAutogearBuild`, `validateSharedAutogearBuild` (Task 1).
- Produces:
  - `CommunityRecommendationService.listForShip(shipName: string): Promise<CommunityRecommendation[]>`
  - `CreateCommunityRecommendationInput` gains `sharedConfig: SharedAutogearBuild` and `shipRefitLevel: number`
  - `getBestRecommendation` and `getAlternatives` are removed.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260829000001_community_recommendation_shared_config.sql`:

```sql
-- Community recommendations previously stored only stat_priorities, stat_bonuses
-- and set_priorities, so a shared build could not reproduce the result its author
-- saw: fleet buffs, implant inclusion and implant exclusions were all lost.
--
-- shared_config holds a versioned SharedAutogearBuild (see
-- src/schemas/sharedAutogearBuild.ts). The legacy columns keep being written in
-- parallel so a stale cached client bundle keeps working, and rows written
-- before this migration are read back through those columns.
--
-- No new RLS policies: community_recommendations already has RLS enabled with
-- row-level SELECT/INSERT/UPDATE/DELETE policies (20260424000003_alt_accounts_rls.sql),
-- and a new column on an existing table is covered by them.

ALTER TABLE public.community_recommendations
  ADD COLUMN IF NOT EXISTS shared_config jsonb;

COMMENT ON COLUMN public.community_recommendations.shared_config IS
  'Versioned SharedAutogearBuild payload. Validated client-side on read; null on pre-2026-08-29 rows.';
```

Note for the implementer: this migration is not applied automatically. Tell the user it needs applying via the Supabase CLI or dashboard; the code paths below tolerate a missing column only in the sense that `shared_config` comes back `undefined`, which the adapter treats as a legacy row.

- [ ] **Step 2: Extend the create input type**

In `src/types/communityRecommendation.ts`, change `CreateCommunityRecommendationInput` to:

```ts
export interface CreateCommunityRecommendationInput {
    shipName: string;
    shipRefitLevel: number;
    title: string;
    description?: string;
    isImplantSpecific: boolean;
    ultimateImplant?: string;
    /** The full shared build. Its fields are also mirrored into the legacy columns. */
    sharedConfig: SharedAutogearBuild;
}
```

The old `shipRole` / `statPriorities` / `statBonuses` / `setPriorities` members are gone — the service derives the legacy columns from `sharedConfig`, so a caller cannot let the two disagree.

- [ ] **Step 3: Rewrite the read and write paths in the service**

In `src/services/communityRecommendations.ts`, delete `getBestRecommendation` and `getAlternatives` entirely and add in their place:

```ts
    /**
     * Every community recommendation for a ship, best-scored first.
     *
     * Implant relevance is applied client-side (sortCommunityBuilds) rather than
     * filtered in SQL, so a build tagged for a different ultimate implant stays
     * visible instead of disappearing.
     */
    static async listForShip(shipName: string): Promise<CommunityRecommendation[]> {
        const { data, error } = await supabase
            .from('community_recommendations')
            .select('*')
            .eq('ship_name', shipName)
            .order('score', { ascending: false })
            .order('total_votes', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching community recommendations:', error);
            return [];
        }

        return data || [];
    }
```

Then replace the body of `createRecommendation`'s `.insert({...})` with:

```ts
            .insert({
                ship_name: input.shipName,
                ship_refit_level: input.shipRefitLevel,
                title: input.title,
                description: input.description,
                is_implant_specific: input.isImplantSpecific,
                ultimate_implant: input.ultimateImplant,
                // Dual write: shared_config is the source of truth, but the legacy
                // columns keep being populated so a stale cached bundle still reads
                // a usable build. Derived from the same object so they cannot drift.
                shared_config: JSON.parse(JSON.stringify(input.sharedConfig)),
                ship_role: input.sharedConfig.shipRole,
                stat_priorities: JSON.parse(JSON.stringify(input.sharedConfig.statPriorities)),
                stat_bonuses: JSON.parse(JSON.stringify(input.sharedConfig.statBonuses)),
                set_priorities: JSON.parse(JSON.stringify(input.sharedConfig.setPriorities)),
                // activeProfileId passed from call site — one recommendation per alt profile
                created_by: createdBy,
            })
```

Add a validation guard at the top of `createRecommendation`, before the insert:

```ts
        if (!validateSharedAutogearBuild(input.sharedConfig)) {
            console.error('Refusing to share an invalid autogear build');
            return null;
        }
```

and import it: `import { validateSharedAutogearBuild } from '../schemas/sharedAutogearBuild';`

The vote methods (`voteOnRecommendation`, `getUserVote`, `removeVote`) are unchanged — including their deliberate use of the auth user rather than the active profile. Do not touch them.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/hooks/useCommunityRecommendations.ts` and `src/components/autogear/CommunityRecommendations.tsx`, which still call the deleted methods and the old input shape. Tasks 7 and 8 fix them. Note the exact errors — they are your checklist.

- [ ] **Step 5: Commit**

Because `tsc` is currently red, commit with the tests still green (the pre-commit hook runs `npm test`, not `tsc`):

```bash
git add supabase/migrations/20260829000001_community_recommendation_shared_config.sql src/services/communityRecommendations.ts src/types/communityRecommendation.ts
git commit -m "feat(community): add shared_config column and single listForShip query"
```

---

### Task 5: `CommunityBuildDetails` — the expanded body

The build rendered in the settings panel's exact vocabulary. Also fixes the two unguarded `STATS` lookups in the existing rows.

**Files:**
- Create: `src/components/autogear/CommunityBuildDetails.tsx`
- Modify: `src/components/autogear/StatBonusRow.tsx:75` (the `STATS[bonus.stat as StatName].label` expression)
- Modify: `src/components/autogear/FleetBuffRow.tsx` (the `STATS[buff.stat].label` expression)
- Test: `src/components/autogear/__tests__/CommunityBuildDetails.test.tsx`

**Interfaces:**
- Consumes: `CommunityBuild` (Task 2).
- Produces:

```ts
interface CommunityBuildDetailsProps {
    build: CommunityBuild;
    userVote: 'upvote' | 'downvote' | null;
    canVote: boolean;
    canApply: boolean;
    onVote: (voteType: 'upvote' | 'downvote') => void;
    onApply: () => void;
}
```

- [ ] **Step 1: Write the failing test**

Create `src/components/autogear/__tests__/CommunityBuildDetails.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import type React from 'react';
import { CommunityBuildDetails } from '../CommunityBuildDetails';
import type { CommunityBuild } from '../../../utils/communityBuild';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest. Same workaround as the other
// component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const makeBuild = (over: Partial<CommunityBuild['build']> = {}): CommunityBuild => ({
    id: 'r1',
    shipName: 'Ares',
    shipRefitLevel: 3,
    title: 'Crit Bruiser',
    description: 'caps crit',
    isImplantSpecific: false,
    upvotes: 10,
    downvotes: 1,
    score: 0.9,
    createdAt: '2026-08-01T00:00:00Z',
    isLegacy: false,
    build: {
        version: 1,
        shipRole: 'ATTACKER',
        statPriorities: [],
        setPriorities: [],
        statBonuses: [],
        fleetBuffs: [],
        excludedImplantTypes: [],
        optimizeImplants: false,
        ...over,
    },
});

const renderDetails = (build: CommunityBuild, props: Partial<React.ComponentProps<typeof CommunityBuildDetails>> = {}) => {
    const onApply = vi.fn();
    const onVote = vi.fn();
    render(
        <CommunityBuildDetails
            build={build}
            userVote={null}
            canVote
            canApply
            onVote={onVote}
            onApply={onApply}
            {...props}
        />
    );
    return { onApply, onVote };
};

describe('CommunityBuildDetails', () => {
    it('renders a stat priority with no limits as its stat name, not a blank row', () => {
        renderDetails(makeBuild({ statPriorities: [{ stat: 'critDamage' }] }));
        expect(screen.getByText(/Crit Damage/)).toBeInTheDocument();
    });

    it('renders stat priorities in payload order, because order is the priority', () => {
        renderDetails(
            makeBuild({ statPriorities: [{ stat: 'crit' }, { stat: 'speed' }, { stat: 'attack' }] })
        );
        const items = screen.getAllByTestId('community-build-priority');
        expect(items.map((el) => el.textContent)).toEqual([
            expect.stringContaining('Crit Rate'),
            expect.stringContaining('Speed'),
            expect.stringContaining('Attack'),
        ]);
    });

    it('renders min, max and hard requirement in the settings-panel wording', () => {
        renderDetails(
            makeBuild({
                statPriorities: [{ stat: 'crit', minLimit: 100, maxLimit: 200, hardRequirement: true }],
            })
        );
        const row = screen.getByTestId('community-build-priority');
        expect(row.textContent).toContain('min: 100');
        expect(row.textContent).toContain('max: 200');
        expect(row.textContent).toContain('Hard Requirement');
    });

    it('distinguishes a 4-piece set from a 2-piece set', () => {
        renderDetails(makeBuild({ setPriorities: [{ setName: 'CRITICAL', count: 4 }] }));
        expect(screen.getByTestId('community-build-set').textContent).toContain('4 pieces');
    });

    it('names an implant-kind set priority with no piece count', () => {
        renderDetails(
            makeBuild({ setPriorities: [{ setName: 'MARTYRDOM', count: 1, kind: 'implant' }] })
        );
        const row = screen.getByTestId('community-build-set');
        expect(row.textContent).toContain('Martyrdom');
        expect(row.textContent).not.toContain('pieces');
    });

    it('distinguishes an additive bonus from a multiplier bonus', () => {
        renderDetails(
            makeBuild({
                statBonuses: [
                    { stat: 'attack', percentage: 30, mode: 'additive' },
                    { stat: 'speed', percentage: 50, mode: 'multiplier' },
                ],
            })
        );
        const rows = screen.getAllByTestId('community-build-bonus');
        expect(rows[0].textContent).toContain('Additive');
        expect(rows[1].textContent).toContain('Multiplier');
    });

    it('renders fleet buffs and implant settings', () => {
        renderDetails(
            makeBuild({
                fleetBuffs: [{ stat: 'attack', percentage: 30 }],
                excludedImplantTypes: ['MARTYRDOM'],
                optimizeImplants: true,
            })
        );
        expect(screen.getByText(/Fleet Buffs/i)).toBeInTheDocument();
        expect(screen.getByText(/Optimize implants/i)).toBeInTheDocument();
        expect(screen.getByText(/Martyrdom/)).toBeInTheDocument();
    });

    it('omits a section that has no entries', () => {
        renderDetails(makeBuild());
        expect(screen.queryByText(/Fleet Buffs/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Gear Sets/i)).not.toBeInTheDocument();
    });

    it('does not crash on an unknown stat key from a foreign payload', () => {
        expect(() =>
            renderDetails(makeBuild({ statBonuses: [{ stat: 'mystery', percentage: 5 }] }))
        ).not.toThrow();
    });

    it('calls onApply when Apply is clicked', () => {
        const { onApply } = renderDetails(makeBuild());
        fireEvent.click(screen.getByRole('button', { name: /apply to autogear/i }));
        expect(onApply).toHaveBeenCalledTimes(1);
    });

    it('calls onVote with the vote type', () => {
        const { onVote } = renderDetails(makeBuild());
        fireEvent.click(screen.getByRole('button', { name: /^helpful$/i }));
        expect(onVote).toHaveBeenCalledWith('upvote');
    });

    it('hides the vote buttons and shows a sign-in hint when the user cannot vote', () => {
        renderDetails(makeBuild(), { canVote: false });
        expect(screen.queryByRole('button', { name: /^helpful$/i })).not.toBeInTheDocument();
        expect(screen.getByText(/sign in to vote/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/autogear/__tests__/CommunityBuildDetails.test.tsx`
Expected: FAIL — cannot resolve `../CommunityBuildDetails`.

- [ ] **Step 3: Implement the component**

Create `src/components/autogear/CommunityBuildDetails.tsx`:

```tsx
import React from 'react';
import { Button } from '../ui/Button';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { GEAR_SETS } from '../../constants/gearSets';
import { IMPLANTS } from '../../constants/implants';
import { STATS, getLimitStatLabel } from '../../constants/stats';
import type { StatName } from '../../types/stats';
import type { CommunityBuild } from '../../utils/communityBuild';

interface CommunityBuildDetailsProps {
    build: CommunityBuild;
    userVote: 'upvote' | 'downvote' | null;
    canVote: boolean;
    canApply: boolean;
    onVote: (voteType: 'upvote' | 'downvote') => void;
    onApply: () => void;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div>
        <h5 className="text-xs uppercase tracking-wide font-semibold text-theme-text-secondary mb-1">
            {title}
        </h5>
        <div className="space-y-1">{children}</div>
    </div>
);

// Every constant lookup below is keyed by community-authored data. STATS,
// GEAR_SETS, SHIP_TYPES and IMPLANTS are Record<string, …> — they gate authoring,
// not input — so a foreign key yields undefined and must fall back, never index.
const setLabel = (setName: string): string =>
    GEAR_SETS[setName]?.name ?? IMPLANTS[setName]?.name ?? setName;

export const CommunityBuildDetails: React.FC<CommunityBuildDetailsProps> = ({
    build,
    userVote,
    canVote,
    canApply,
    onVote,
    onApply,
}) => {
    const { build: config } = build;
    const roleInfo = SHIP_TYPES[config.shipRole];
    const hasImplantSettings = config.optimizeImplants || config.excludedImplantTypes.length > 0;

    return (
        <div className="space-y-3 text-sm">
            {build.description && (
                <p className="text-theme-text-secondary italic">
                    &ldquo;{build.description}&rdquo;
                </p>
            )}

            <Section title="Role">
                <span className="inline-flex items-center gap-2">
                    {roleInfo?.iconUrl && (
                        <img src={roleInfo.iconUrl} alt="" className="w-4 h-4" />
                    )}
                    {roleInfo?.name ?? config.shipRole}
                </span>
            </Section>

            {/* Rendered as an ordered list: a priority's strength is its position,
                not a number on the row (StatPriority.weight is always 1). */}
            {config.statPriorities.length > 0 && (
                <Section title="Stat Priorities">
                    <ol className="list-decimal list-inside space-y-1">
                        {config.statPriorities.map((priority, index) => (
                            <li key={index} data-testid="community-build-priority">
                                {getLimitStatLabel(priority.stat)}
                                {priority.minLimit !== undefined && ` (min: ${priority.minLimit})`}
                                {priority.maxLimit !== undefined && ` (max: ${priority.maxLimit})`}
                                {priority.hardRequirement && (
                                    <span className="text-amber-400"> — Hard Requirement</span>
                                )}
                            </li>
                        ))}
                    </ol>
                </Section>
            )}

            {config.setPriorities.length > 0 && (
                <Section title="Gear Sets">
                    {config.setPriorities.map((set, index) => (
                        <div key={index} data-testid="community-build-set">
                            {set.kind === 'implant'
                                ? setLabel(set.setName)
                                : `${setLabel(set.setName)} ( ${set.count} pieces)`}
                        </div>
                    ))}
                </Section>
            )}

            {config.statBonuses.length > 0 && (
                <Section title="Stat Bonuses">
                    {config.statBonuses.map((bonus, index) => (
                        <div key={index} data-testid="community-build-bonus">
                            {STATS[bonus.stat as StatName]?.label ?? bonus.stat} ( {bonus.percentage}
                            {'%) — '}
                            <span className="text-xs text-theme-text-secondary">
                                {bonus.mode === 'multiplier' ? 'Multiplier' : 'Additive'}
                            </span>
                        </div>
                    ))}
                </Section>
            )}

            {config.fleetBuffs.length > 0 && (
                <Section title="Fleet Buffs">
                    {config.fleetBuffs.map((buff, index) => (
                        <div key={index} data-testid="community-build-fleet-buff">
                            {STATS[buff.stat]?.label ?? buff.stat} +{buff.percentage}%
                        </div>
                    ))}
                </Section>
            )}

            {hasImplantSettings && (
                <Section title="Implants">
                    {config.optimizeImplants && <div>Optimize implants</div>}
                    {config.excludedImplantTypes.map((key) => (
                        <div key={key}>Excluded: {IMPLANTS[key]?.name ?? key}</div>
                    ))}
                </Section>
            )}

            {build.isLegacy && (
                <p className="text-xs text-theme-text-secondary">
                    Shared before fleet buffs and implant settings were captured, so this build
                    covers role, stat priorities, gear sets and stat bonuses only.
                </p>
            )}

            <div className="pt-2 border-t border-dark-border flex flex-wrap gap-2 items-center">
                <Button
                    size="sm"
                    variant="primary"
                    onClick={onApply}
                    disabled={!canApply}
                    title={canApply ? undefined : 'Select a ship to apply this build'}
                >
                    Apply to autogear
                </Button>
                {canVote ? (
                    <>
                        <Button
                            size="sm"
                            variant={userVote === 'upvote' ? 'primary' : 'secondary'}
                            onClick={() => onVote('upvote')}
                        >
                            Helpful
                        </Button>
                        <Button
                            size="sm"
                            variant={userVote === 'downvote' ? 'danger' : 'secondary'}
                            onClick={() => onVote('downvote')}
                        >
                            Not Helpful
                        </Button>
                    </>
                ) : (
                    <span className="text-xs text-theme-text-secondary">Sign in to vote</span>
                )}
            </div>
        </div>
    );
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/autogear/__tests__/CommunityBuildDetails.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 5: Guard the two existing unsafe lookups**

In `src/components/autogear/StatBonusRow.tsx`, change:

```tsx
                {STATS[bonus.stat as StatName].label} ({' '}
```

to:

```tsx
                {STATS[bonus.stat as StatName]?.label ?? bonus.stat} ({' '}
```

In `src/components/autogear/FleetBuffRow.tsx`, change:

```tsx
                {STATS[buff.stat].label} +
```

to:

```tsx
                {STATS[buff.stat]?.label ?? buff.stat} +
```

Both are `Record<string, …>` lookups that throw on a key not present — reachable once an applied community build can put a stat into the page config.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/autogear/CommunityBuildDetails.tsx src/components/autogear/__tests__/CommunityBuildDetails.test.tsx src/components/autogear/StatBonusRow.tsx src/components/autogear/FleetBuffRow.tsx
git commit -m "feat(community): render a shared build in the settings-panel vocabulary"
```

`tsc` may still be red from Task 4 in `useCommunityRecommendations.ts` and `CommunityRecommendations.tsx`. That is expected until Task 8; confirm no NEW errors appear in files this task touched.

---

### Task 6: `CommunityBuildRow` and `CommunityBuildList`

The browsable list: one-line rows, sort control, one build expanded at a time.

**Files:**
- Create: `src/components/autogear/CommunityBuildRow.tsx`
- Create: `src/components/autogear/CommunityBuildList.tsx`
- Test: `src/components/autogear/__tests__/CommunityBuildList.test.tsx`

**Interfaces:**
- Consumes: `CommunityBuild`, `CommunityBuildSort`, `sortCommunityBuilds`, `isImplantMatch` (Task 2); `communityBuildSummary` (Task 3); `CommunityBuildDetails` (Task 5).
- Produces:

```ts
interface CommunityBuildRowProps {
    build: CommunityBuild;
    isExpanded: boolean;
    isImplantMatch: boolean;
    onToggle: () => void;
}

interface CommunityBuildListProps {
    builds: CommunityBuild[];              // unsorted; the list sorts
    equippedUltimateImplant: string | null;
    sort: CommunityBuildSort;
    onSortChange: (sort: CommunityBuildSort) => void;
    expandedId: string | null;
    onToggleExpand: (id: string) => void;
    userVote: 'upvote' | 'downvote' | null;
    canVote: boolean;
    canApply: boolean;
    onVote: (voteType: 'upvote' | 'downvote') => void;
    onApply: (build: CommunityBuild) => void;
}
```

- [ ] **Step 1: Write the failing test**

Create `src/components/autogear/__tests__/CommunityBuildList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import type React from 'react';
import { CommunityBuildList } from '../CommunityBuildList';
import type { CommunityBuild } from '../../../utils/communityBuild';

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const makeBuild = (over: Partial<CommunityBuild> = {}): CommunityBuild => ({
    id: 'r1',
    shipName: 'Ares',
    shipRefitLevel: 3,
    title: 'Crit Bruiser',
    isImplantSpecific: false,
    upvotes: 10,
    downvotes: 1,
    score: 0.9,
    createdAt: '2026-08-01T00:00:00Z',
    isLegacy: false,
    build: {
        version: 1,
        shipRole: 'ATTACKER',
        statPriorities: [],
        setPriorities: [{ setName: 'CRITICAL', count: 4 }],
        statBonuses: [],
        fleetBuffs: [],
        excludedImplantTypes: [],
        optimizeImplants: false,
    },
    ...over,
});

const renderList = (
    builds: CommunityBuild[],
    props: Partial<React.ComponentProps<typeof CommunityBuildList>> = {}
) => {
    const onApply = vi.fn();
    const onToggleExpand = vi.fn();
    const onSortChange = vi.fn();
    render(
        <CommunityBuildList
            builds={builds}
            equippedUltimateImplant={null}
            sort="top"
            onSortChange={onSortChange}
            expandedId={null}
            onToggleExpand={onToggleExpand}
            userVote={null}
            canVote
            canApply
            onVote={vi.fn()}
            onApply={onApply}
            {...props}
        />
    );
    return { onApply, onToggleExpand, onSortChange };
};

describe('CommunityBuildList', () => {
    it('renders one row per build with its title and summary', () => {
        renderList([makeBuild(), makeBuild({ id: 'r2', title: 'Speed Opener' })]);
        expect(screen.getByText('Crit Bruiser')).toBeInTheDocument();
        expect(screen.getByText('Speed Opener')).toBeInTheDocument();
        expect(screen.getAllByText(/4x Critical/)).toHaveLength(2);
    });

    it('shows the vote sum with a sign', () => {
        renderList([makeBuild({ upvotes: 10, downvotes: 1 })]);
        expect(screen.getByText('+9')).toBeInTheDocument();
    });

    it('shows a refit chip', () => {
        renderList([makeBuild({ shipRefitLevel: 3 })]);
        expect(screen.getByText(/Refit 3/)).toBeInTheDocument();
    });

    it('shows an implant chip only for implant-specific builds', () => {
        renderList([
            makeBuild({ id: 'a', isImplantSpecific: true, ultimateImplant: 'Havoc' }),
            makeBuild({ id: 'b', title: 'Generic' }),
        ]);
        expect(screen.getByText('Havoc')).toBeInTheDocument();
    });

    it('sorts matching-implant builds first', () => {
        renderList(
            [
                makeBuild({ id: 'generic', title: 'Generic', score: 0.99 }),
                makeBuild({ id: 'mine', title: 'Mine', score: 0.1, isImplantSpecific: true, ultimateImplant: 'Havoc' }),
            ],
            { equippedUltimateImplant: 'Havoc' }
        );
        const titles = screen.getAllByTestId('community-build-title').map((el) => el.textContent);
        expect(titles).toEqual(['Mine', 'Generic']);
    });

    it('calls onToggleExpand with the build id when a row is clicked', () => {
        const { onToggleExpand } = renderList([makeBuild()]);
        fireEvent.click(screen.getByRole('button', { name: /crit bruiser/i }));
        expect(onToggleExpand).toHaveBeenCalledWith('r1');
    });

    it('renders the details body only for the expanded build', () => {
        renderList([makeBuild(), makeBuild({ id: 'r2', title: 'Speed Opener' })], {
            expandedId: 'r1',
        });
        expect(screen.getAllByRole('button', { name: /apply to autogear/i })).toHaveLength(1);
    });

    it('calls onApply with the expanded build', () => {
        const { onApply } = renderList([makeBuild()], { expandedId: 'r1' });
        fireEvent.click(screen.getByRole('button', { name: /apply to autogear/i }));
        expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    });

    it('renders an empty-state message with no builds', () => {
        renderList([]);
        expect(screen.getByText(/be the first to share/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/autogear/__tests__/CommunityBuildList.test.tsx`
Expected: FAIL — cannot resolve `../CommunityBuildList`.

- [ ] **Step 3: Implement `CommunityBuildRow`**

Create `src/components/autogear/CommunityBuildRow.tsx`:

```tsx
import React from 'react';
import { ChevronDownIcon } from '../ui/icons';
import { communityBuildSummary } from '../../utils/communityBuildSummary';
import type { CommunityBuild } from '../../utils/communityBuild';

interface CommunityBuildRowProps {
    build: CommunityBuild;
    isExpanded: boolean;
    isImplantMatch: boolean;
    onToggle: () => void;
}

const VoteSum: React.FC<{ upvotes: number; downvotes: number }> = ({ upvotes, downvotes }) => {
    const sum = upvotes - downvotes;
    if (sum > 0) return <span className="text-green-400 font-medium">+{sum}</span>;
    if (sum < 0) return <span className="text-red-400 font-medium">{sum}</span>;
    return <span className="text-theme-text-secondary">0</span>;
};

/**
 * One collapsed build. The whole row is the expand toggle, which is the
 * accordion-header exception to the "no raw <button>" rule.
 */
export const CommunityBuildRow: React.FC<CommunityBuildRowProps> = ({
    build,
    isExpanded,
    isImplantMatch,
    onToggle,
}) => (
    <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full text-left p-2 border border-dark-border bg-dark hover:bg-dark-lighter transition-colors flex items-start justify-between gap-2"
    >
        <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 flex-wrap">
                <ChevronDownIcon
                    className={`w-3 h-3 text-theme-text-secondary flex-shrink-0 transition-transform duration-200 ${
                        isExpanded ? 'rotate-180' : ''
                    }`}
                />
                <span className="text-sm text-white truncate" data-testid="community-build-title">
                    {build.title}
                </span>
                {build.isImplantSpecific && build.ultimateImplant && (
                    <span
                        className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                            isImplantMatch
                                ? 'bg-purple-900/50 text-purple-200'
                                : 'bg-dark-lighter text-theme-text-secondary'
                        }`}
                    >
                        {build.ultimateImplant}
                    </span>
                )}
                <span className="text-xs px-1.5 py-0.5 rounded bg-dark-lighter text-theme-text-secondary flex-shrink-0">
                    Refit {build.shipRefitLevel}
                </span>
            </span>
            <span className="block text-xs text-theme-text-secondary mt-1 truncate">
                {communityBuildSummary(build.build)}
            </span>
        </span>
        <span className="text-xs flex-shrink-0">
            <VoteSum upvotes={build.upvotes} downvotes={build.downvotes} />
        </span>
    </button>
);
```

- [ ] **Step 4: Implement `CommunityBuildList`**

Create `src/components/autogear/CommunityBuildList.tsx`:

```tsx
import React, { useMemo } from 'react';
import { Select } from '../ui/Select';
import { CommunityBuildRow } from './CommunityBuildRow';
import { CommunityBuildDetails } from './CommunityBuildDetails';
import {
    sortCommunityBuilds,
    isImplantMatch,
    type CommunityBuild,
    type CommunityBuildSort,
} from '../../utils/communityBuild';

interface CommunityBuildListProps {
    builds: CommunityBuild[];
    equippedUltimateImplant: string | null;
    sort: CommunityBuildSort;
    onSortChange: (sort: CommunityBuildSort) => void;
    expandedId: string | null;
    onToggleExpand: (id: string) => void;
    userVote: 'upvote' | 'downvote' | null;
    canVote: boolean;
    canApply: boolean;
    onVote: (voteType: 'upvote' | 'downvote') => void;
    onApply: (build: CommunityBuild) => void;
}

export const CommunityBuildList: React.FC<CommunityBuildListProps> = ({
    builds,
    equippedUltimateImplant,
    sort,
    onSortChange,
    expandedId,
    onToggleExpand,
    userVote,
    canVote,
    canApply,
    onVote,
    onApply,
}) => {
    const sorted = useMemo(
        () => sortCommunityBuilds(builds, equippedUltimateImplant, sort),
        [builds, equippedUltimateImplant, sort]
    );

    if (sorted.length === 0) {
        return (
            <p className="text-sm text-theme-text-secondary text-center py-2">
                Be the first to share a recommendation for this ship!
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <div className="flex justify-end">
                <Select
                    aria-label="Sort community builds"
                    className="w-36"
                    options={[
                        { value: 'top', label: 'Top rated' },
                        { value: 'newest', label: 'Newest' },
                    ]}
                    value={sort}
                    onChange={(value) => onSortChange(value as CommunityBuildSort)}
                />
            </div>

            {sorted.map((build) => (
                <div key={build.id}>
                    <CommunityBuildRow
                        build={build}
                        isExpanded={expandedId === build.id}
                        isImplantMatch={isImplantMatch(build, equippedUltimateImplant)}
                        onToggle={() => onToggleExpand(build.id)}
                    />
                    {expandedId === build.id && (
                        <div className="border border-t-0 border-dark-border bg-dark-lighter p-3">
                            <CommunityBuildDetails
                                build={build}
                                userVote={userVote}
                                canVote={canVote}
                                canApply={canApply}
                                onVote={onVote}
                                onApply={() => onApply(build)}
                            />
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/autogear/__tests__/CommunityBuildList.test.tsx`
Expected: PASS, 9 tests.

If the `Select` component's rendered markup makes `getByRole('button', { name: /crit bruiser/i })` ambiguous, prefer `screen.getByTestId('community-build-title')` and click its closest button via `fireEvent.click(screen.getByTestId('community-build-title').closest('button')!)`. Do not add a test id to the row button just to satisfy the query if the accessible name already works.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/autogear/CommunityBuildRow.tsx src/components/autogear/CommunityBuildList.tsx src/components/autogear/__tests__/CommunityBuildList.test.tsx
git commit -m "feat(community): browsable build list replacing the best/alternatives split"
```

---

### Task 7: Rewrite `useCommunityRecommendations`

One fetch, a resolved build list, expansion and sort state, and a share path that sends the full build.

**Files:**
- Modify: `src/hooks/useCommunityRecommendations.ts`

**Interfaces:**
- Consumes: `listForShip`, the new `CreateCommunityRecommendationInput` (Task 4); `toCommunityBuild`, `CommunityBuild`, `CommunityBuildSort` (Task 2).
- Produces:

```ts
interface UseCommunityRecommendationsProps {
    selectedShip: Ship | null;
    currentBuild: SharedAutogearBuild | null;
}

interface UseCommunityRecommendationsReturn {
    builds: CommunityBuild[];
    loading: boolean;
    error: string | null;
    expandedId: string | null;
    toggleExpanded: (id: string) => void;
    sort: CommunityBuildSort;
    setSort: (sort: CommunityBuildSort) => void;
    userVote: 'upvote' | 'downvote' | null;
    handleVote: (voteType: 'upvote' | 'downvote') => Promise<void>;
    showShareForm: boolean;
    setShowShareForm: (show: boolean) => void;
    ultimateImplantName: string | null;
    canShare: boolean;
    handleShare: (title: string, description: string, isImplantSpecific: boolean) => Promise<boolean>;
}
```

- [ ] **Step 1: Replace the hook body**

Rewrite `src/hooks/useCommunityRecommendations.ts` in full:

```ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { Ship } from '../types/ship';
import { SharedAutogearBuild } from '../types/communityRecommendation';
import { CommunityRecommendationService } from '../services/communityRecommendations';
import {
    toCommunityBuild,
    type CommunityBuild,
    type CommunityBuildSort,
} from '../utils/communityBuild';
import { IMPLANTS } from '../constants/implants';
import { useInventory } from '../contexts/InventoryProvider';
import { useActiveProfile } from '../contexts/ActiveProfileProvider';

interface UseCommunityRecommendationsProps {
    selectedShip: Ship | null;
    /** The user's current build for this ship, or null when no role is set. */
    currentBuild: SharedAutogearBuild | null;
}

interface UseCommunityRecommendationsReturn {
    builds: CommunityBuild[];
    loading: boolean;
    error: string | null;
    expandedId: string | null;
    toggleExpanded: (id: string) => void;
    sort: CommunityBuildSort;
    setSort: (sort: CommunityBuildSort) => void;
    userVote: 'upvote' | 'downvote' | null;
    handleVote: (voteType: 'upvote' | 'downvote') => Promise<void>;
    showShareForm: boolean;
    setShowShareForm: (show: boolean) => void;
    ultimateImplantName: string | null;
    canShare: boolean;
    handleShare: (
        title: string,
        description: string,
        isImplantSpecific: boolean
    ) => Promise<boolean>;
}

export const useCommunityRecommendations = ({
    selectedShip,
    currentBuild,
}: UseCommunityRecommendationsProps): UseCommunityRecommendationsReturn => {
    const { getGearPiece } = useInventory();
    const { activeProfileId } = useActiveProfile();

    const canShare = !!selectedShip && !!currentBuild;

    const [builds, setBuilds] = useState<CommunityBuild[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [sort, setSort] = useState<CommunityBuildSort>('top');
    const [userVote, setUserVote] = useState<'upvote' | 'downvote' | null>(null);
    const [showShareForm, setShowShareForm] = useState(false);
    const [lastShipName, setLastShipName] = useState<string | null>(null);

    const isFetchingRef = useRef(false);

    const getUltimateImplantName = useCallback((): string | null => {
        if (!selectedShip?.implants?.['implant_ultimate']) {
            return null;
        }

        const implantPiece = getGearPiece(selectedShip.implants['implant_ultimate']);
        if (!implantPiece?.setBonus) {
            return null;
        }

        const implantData = IMPLANTS[implantPiece.setBonus];
        return implantData && implantData.type === 'ultimate' ? implantData.name : null;
    }, [selectedShip, getGearPiece]);

    const ultimateImplantName = getUltimateImplantName();

    const fetchBuilds = useCallback(async () => {
        if (!selectedShip || isFetchingRef.current) return;

        isFetchingRef.current = true;
        setLoading(true);
        setError(null);
        setBuilds([]);
        setExpandedId(null);
        setUserVote(null);

        try {
            const rows = await CommunityRecommendationService.listForShip(selectedShip.name);
            // A row whose payload cannot be validated is dropped, not rendered.
            setBuilds(rows.map(toCommunityBuild).filter((b): b is CommunityBuild => b !== null));
        } catch (err) {
            console.error('Error fetching community recommendations:', err);
            setError('Failed to load community recommendations');
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
        }
    }, [selectedShip]);

    // Votes are per expanded build, so the vote is fetched on expand rather than
    // for every row in the list.
    const toggleExpanded = useCallback(
        (id: string) => {
            setExpandedId((current) => (current === id ? null : id));
            setUserVote(null);
            if (expandedId !== id) {
                void CommunityRecommendationService.getUserVote(id).then(setUserVote);
            }
        },
        [expandedId]
    );

    const refresh = useCallback(async () => {
        if (!selectedShip) return;
        const rows = await CommunityRecommendationService.listForShip(selectedShip.name);
        setBuilds(rows.map(toCommunityBuild).filter((b): b is CommunityBuild => b !== null));
    }, [selectedShip]);

    const handleVote = useCallback(
        async (voteType: 'upvote' | 'downvote') => {
            if (!expandedId) return;

            try {
                if (userVote === voteType) {
                    await CommunityRecommendationService.removeVote(expandedId);
                    setUserVote(null);
                } else {
                    await CommunityRecommendationService.voteOnRecommendation(expandedId, voteType);
                    setUserVote(voteType);
                }
                await refresh();
            } catch (err) {
                console.error('Error voting:', err);
            }
        },
        [expandedId, userVote, refresh]
    );

    const handleShare = useCallback(
        async (
            title: string,
            description: string,
            isImplantSpecific: boolean
        ): Promise<boolean> => {
            if (!selectedShip || !currentBuild) {
                setError('No configuration to share');
                return false;
            }

            if (isImplantSpecific && !ultimateImplantName) {
                setError('Cannot mark as implant-specific without an ultimate implant equipped');
                return false;
            }

            if (!activeProfileId) {
                setError('No active profile. Please sign in to share a recommendation.');
                return false;
            }

            try {
                const result = await CommunityRecommendationService.createRecommendation(
                    {
                        shipName: selectedShip.name,
                        shipRefitLevel: selectedShip.refits?.length ?? 0,
                        title,
                        description,
                        isImplantSpecific,
                        ultimateImplant: isImplantSpecific
                            ? (ultimateImplantName ?? undefined)
                            : undefined,
                        sharedConfig: currentBuild,
                    },
                    // Authorship is per active profile, so alt profiles can share
                    // independently. Voting stays per auth user.
                    activeProfileId
                );

                if (result) {
                    setShowShareForm(false);
                    await refresh();
                    return true;
                }

                setError('Failed to share recommendation. Please make sure you are signed in.');
                return false;
            } catch (err) {
                console.error('Error sharing recommendation:', err);
                setError('Failed to share recommendation');
                return false;
            }
        },
        [selectedShip, currentBuild, ultimateImplantName, activeProfileId, refresh]
    );

    useEffect(() => {
        if (selectedShip?.name && selectedShip.name !== lastShipName && !isFetchingRef.current) {
            setLastShipName(selectedShip.name);
            void fetchBuilds();
        }
    }, [selectedShip?.name, lastShipName, fetchBuilds]);

    return {
        builds,
        loading,
        error,
        expandedId,
        toggleExpanded,
        sort,
        setSort,
        userVote,
        handleVote,
        showShareForm,
        setShowShareForm,
        ultimateImplantName,
        canShare,
        handleShare,
    };
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: remaining errors only in `src/components/autogear/CommunityRecommendations.tsx` (Task 8) and `AutogearQuickSettings.tsx` (Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useCommunityRecommendations.ts
git commit -m "refactor(community): hook returns a resolved build list and shares the full build"
```

---

### Task 8: Recompose `CommunityRecommendations`, header, share preview; delete dead files

**Files:**
- Modify: `src/components/autogear/CommunityRecommendations.tsx`
- Modify: `src/components/autogear/RecommendationHeader.tsx`
- Modify: `src/components/autogear/ShareRecommendationForm.tsx`
- Modify: `src/types/communityRecommendation.ts`
- Delete: `src/components/autogear/AlternativeRecommendations.tsx`
- Delete: `src/components/autogear/RecommendationContent.tsx`
- Delete: `src/components/autogear/CommunityActions.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2, 3, 5, 6, 7.
- Produces:

```ts
interface CommunityRecommendationsProps {
    selectedShip: Ship | null;
    currentBuild: SharedAutogearBuild | null;
    /** Null when the page cannot apply (no ship). */
    onApplyBuild: ((build: SharedAutogearBuild) => void) | null;
    /** Whether the ship already has build config that Apply would overwrite. */
    hasExistingConfig: boolean;
}
```

- [ ] **Step 1: Rewrite `RecommendationHeader`**

Replace `src/components/autogear/RecommendationHeader.tsx` in full:

```tsx
import React from 'react';
import { Loader } from '../ui/Loader';
import { ChevronDownIcon } from '../ui/icons';

interface RecommendationHeaderProps {
    buildCount: number;
    loading: boolean;
    isExpanded: boolean;
    onToggleExpand: () => void;
}

export const RecommendationHeader: React.FC<RecommendationHeaderProps> = ({
    buildCount,
    loading,
    isExpanded,
    onToggleExpand,
}) => (
    <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        className="w-full card hover:bg-dark-lighter transition-colors cursor-pointer border-none text-left"
    >
        <div className="flex items-center gap-2">
            <ChevronDownIcon
                className={`w-4 h-4 text-theme-text-secondary flex-shrink-0 transition-transform duration-200 ${
                    isExpanded ? 'rotate-180' : ''
                }`}
            />
            {loading ? (
                <span className="flex items-center gap-2">
                    <Loader size="sm" />
                    <span className="text-theme-text-secondary text-sm">Loading...</span>
                </span>
            ) : buildCount > 0 ? (
                <span className="text-sm font-medium text-white">
                    {buildCount} community {buildCount === 1 ? 'build' : 'builds'}
                </span>
            ) : (
                <span className="text-sm text-theme-text-secondary">
                    No community builds yet
                </span>
            )}
        </div>
    </button>
);
```

- [ ] **Step 2: Add the share preview to `ShareRecommendationForm`**

Add a `build` prop and render what will be captured, so the sharer can see it before publishing. In `src/components/autogear/ShareRecommendationForm.tsx`:

Add to the imports:

```tsx
import { communityBuildSummary } from '../../utils/communityBuildSummary';
import type { SharedAutogearBuild } from '../../types/communityRecommendation';
```

Add to the props interface:

```tsx
    /** The config that will be published — shown read-only so the sharer can check it. */
    build: SharedAutogearBuild;
```

Add `build` to the destructured parameters, and insert this block immediately after the opening `<form ...>` tag, before the Title `<Input>`:

```tsx
            <div className="p-3 bg-dark-lighter text-xs space-y-1">
                <p className="font-semibold text-theme-text">This build will be shared as:</p>
                <p className="text-theme-text-secondary">{communityBuildSummary(build)}</p>
                <p className="text-theme-text-secondary">
                    Your algorithm choice and your gear filters (ignore equipped, ignore unleveled,
                    use upgraded stats, complete sets, calibration, arena modifiers) stay private.
                </p>
            </div>
```

- [ ] **Step 3: Rewrite `CommunityRecommendations`**

Replace `src/components/autogear/CommunityRecommendations.tsx` in full:

```tsx
import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { SharedAutogearBuild } from '../../types/communityRecommendation';
import { CollapsibleAccordion } from '../ui/CollapsibleAccordion';
import { ConfirmModal } from '../ui/layout/ConfirmModal';
import { Button } from '../ui/Button';
import { useCommunityRecommendations } from '../../hooks/useCommunityRecommendations';
import { useTutorialTrigger } from '../../hooks/useTutorialTrigger';
import { useAuth } from '../../contexts/AuthProvider';
import { useActiveProfile } from '../../contexts/ActiveProfileProvider';
import { RecommendationHeader } from './RecommendationHeader';
import { CommunityBuildList } from './CommunityBuildList';
import { ShareRecommendationForm } from './ShareRecommendationForm';
import type { CommunityBuild } from '../../utils/communityBuild';

interface CommunityRecommendationsProps {
    selectedShip: Ship | null;
    currentBuild: SharedAutogearBuild | null;
    onApplyBuild: ((build: SharedAutogearBuild) => void) | null;
    hasExistingConfig: boolean;
}

export const CommunityRecommendations: React.FC<CommunityRecommendationsProps> = ({
    selectedShip,
    currentBuild,
    onApplyBuild,
    hasExistingConfig,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [pendingApply, setPendingApply] = useState<CommunityBuild | null>(null);

    // Votes are one-per-human: gated on the auth user, not the active profile,
    // so alt profiles cannot cast duplicate votes.
    const { user } = useAuth();
    // Authorship is per active profile.
    const { activeProfileId } = useActiveProfile();

    const {
        builds,
        loading,
        error,
        expandedId,
        toggleExpanded,
        sort,
        setSort,
        userVote,
        handleVote,
        showShareForm,
        setShowShareForm,
        ultimateImplantName,
        canShare,
        handleShare,
    } = useCommunityRecommendations({ selectedShip, currentBuild });

    useTutorialTrigger('autogear-community');

    if (!selectedShip) {
        return null;
    }

    const applyBuild = (build: CommunityBuild) => {
        onApplyBuild?.(build.build);
    };

    // Confirm only when Apply would actually overwrite something.
    const requestApply = (build: CommunityBuild) => {
        if (hasExistingConfig) {
            setPendingApply(build);
            return;
        }
        applyBuild(build);
    };

    const handleShareSubmit = async (
        title: string,
        description: string,
        isImplantSpecific: boolean
    ): Promise<boolean> => {
        setIsSubmitting(true);
        try {
            return await handleShare(title, description, isImplantSpecific);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="mt-4 border border-dark-border overflow-hidden"
            data-tutorial="autogear-community-recommendations"
        >
            <RecommendationHeader
                buildCount={builds.length}
                loading={loading}
                isExpanded={isExpanded}
                onToggleExpand={() => setIsExpanded(!isExpanded)}
            />

            <CollapsibleAccordion isOpen={isExpanded}>
                <div className="p-3 space-y-3">
                    {error && (
                        <div className="text-red-400 bg-red-900/20 border border-red-700 p-2 text-sm">
                            Error: {error}
                        </div>
                    )}

                    {!loading && (
                        <CommunityBuildList
                            builds={builds}
                            equippedUltimateImplant={ultimateImplantName}
                            sort={sort}
                            onSortChange={setSort}
                            expandedId={expandedId}
                            onToggleExpand={toggleExpanded}
                            userVote={userVote}
                            canVote={!!user}
                            canApply={!!onApplyBuild}
                            onVote={(voteType) => void handleVote(voteType)}
                            onApply={requestApply}
                        />
                    )}

                    {!showShareForm && (
                        <div className="pt-2 border-t border-dark-border flex justify-center">
                            {!activeProfileId ? (
                                <span className="text-sm text-theme-text-secondary">
                                    Sign in to share your build
                                </span>
                            ) : canShare ? (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => setShowShareForm(true)}
                                    className="w-full"
                                >
                                    Share your build
                                </Button>
                            ) : (
                                <span className="text-sm text-theme-text-secondary">
                                    Configure autogear settings to share your build
                                </span>
                            )}
                        </div>
                    )}

                    {showShareForm && currentBuild && (
                        <div className="pt-2 border-t border-dark-border">
                            <h4 className="text-sm font-semibold text-theme-text mb-3">
                                Share Your Build
                            </h4>
                            <ShareRecommendationForm
                                build={currentBuild}
                                onSubmit={handleShareSubmit}
                                onCancel={() => setShowShareForm(false)}
                                ultimateImplantName={ultimateImplantName}
                                isSubmitting={isSubmitting}
                            />
                        </div>
                    )}
                </div>
            </CollapsibleAccordion>

            <ConfirmModal
                isOpen={pendingApply !== null}
                onClose={() => setPendingApply(null)}
                onConfirm={() => {
                    if (pendingApply) applyBuild(pendingApply);
                    setPendingApply(null);
                }}
                title="Apply this build?"
                confirmLabel="Apply"
                message={
                    <div className="space-y-2 text-sm">
                        <p>
                            This replaces your role, stat priorities, gear sets, stat bonuses, fleet
                            buffs and implant settings for {selectedShip.name}.
                        </p>
                        <p className="text-theme-text-secondary">
                            Your algorithm choice and gear filters (ignore equipped, ignore
                            unleveled, use upgraded stats, complete sets, calibration, arena
                            modifiers) are not changed.
                        </p>
                    </div>
                }
            />
        </div>
    );
};
```

- [ ] **Step 4: Delete the dead files and the dead type**

```bash
git rm src/components/autogear/AlternativeRecommendations.tsx src/components/autogear/RecommendationContent.tsx src/components/autogear/CommunityActions.tsx
```

In `src/types/communityRecommendation.ts`, delete the entire `AIRecommendation` interface and its doc comment — nothing references it once `AlternativeRecommendations` is gone.

Check that nothing else imports the deleted modules:

```bash
grep -rn "AlternativeRecommendations\|RecommendationContent\|CommunityActions\|AIRecommendation" src
```

Expected: no output. If `src/types/autogearSuggestion.ts` is now unreferenced too, leave it — it is outside this feature's scope.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `AutogearQuickSettings.tsx` (it still passes the old `currentConfig` prop). Task 9 fixes it.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/autogear src/types/communityRecommendation.ts
git commit -m "feat(community): recompose the section around the build list and add the apply confirm"
```

---

### Task 9: Wire Apply through to the autogear page

**Files:**
- Modify: `src/components/autogear/AutogearQuickSettings.tsx:26-38` (the `getShipConfig` return type) and `:180-198` (the `CommunityRecommendations` usage)
- Modify: `src/pages/manager/AutogearPage.tsx:1186` (the `AutogearQuickSettings` usage)
- Test: `src/components/autogear/__tests__/AutogearQuickSettings.test.tsx`

**Interfaces:**
- Consumes: `configToSharedBuild`, `hasExistingBuildConfig` (Task 2); the `CommunityRecommendations` props (Task 8).
- Produces: `AutogearQuickSettings` gains `onApplyBuild: (shipId: string, build: SharedAutogearBuild) => void`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/autogear/__tests__/AutogearQuickSettings.test.tsx`. First give `CONFIG` an explicit type and the two fields the panel now forwards. The explicit type matters: `typeof CONFIG` on an untyped literal would pin `shipRole` to `null` and reject `'ATTACKER'` in the tests below.

```ts
import type { ShipTypeName } from '../../../constants';
import type { StatPriority, SetPriority, StatBonus, FleetBuff } from '../../../types/autogear';

type ShipConfig = {
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    fleetBuffs: FleetBuff[];
    excludedImplantTypes: string[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    useUpgradedStats: boolean;
    tryToCompleteSets: boolean;
    selectedAlgorithm: AutogearAlgorithm;
    showSecondaryRequirements: boolean;
    optimizeImplants: boolean;
};

const CONFIG: ShipConfig = {
    shipRole: null,
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    fleetBuffs: [],
    excludedImplantTypes: [],
    ignoreEquipped: false,
    ignoreUnleveled: true,
    useUpgradedStats: false,
    tryToCompleteSets: false,
    selectedAlgorithm: AutogearAlgorithm.Genetic,
    showSecondaryRequirements: false,
    optimizeImplants: false,
};
```

Then replace the `CommunityRecommendations` mock so the test can observe what the panel passes down, and add `onApplyBuild` to `renderPanel`:

```tsx
const communityProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('../CommunityRecommendations', () => ({
    CommunityRecommendations: (props: Record<string, unknown>) => {
        communityProps.current = props;
        return null;
    },
}));
```

and add `onApplyBuild={vi.fn()}` to the `<AutogearQuickSettings …>` element inside the existing `renderPanel` helper (its return value is unchanged — it still returns the two move mocks).

Then add this describe block at the end of the file:

```tsx
describe('AutogearQuickSettings community build wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        communityProps.current = null;
    });

    it('passes a null currentBuild when the ship has no role configured', () => {
        renderPanel([makeShip('1', 'Lodolite')]);
        expect(communityProps.current?.currentBuild).toBeNull();
    });

    it('passes the full build, including fleet buffs and implant exclusions', () => {
        renderPanelWithConfig([makeShip('1', 'Lodolite')], {
            ...CONFIG,
            shipRole: 'ATTACKER',
            fleetBuffs: [{ stat: 'attack', percentage: 30 }],
            excludedImplantTypes: ['MARTYRDOM'],
            optimizeImplants: true,
        });
        expect(communityProps.current?.currentBuild).toEqual({
            version: 1,
            shipRole: 'ATTACKER',
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
            fleetBuffs: [{ stat: 'attack', percentage: 30 }],
            excludedImplantTypes: ['MARTYRDOM'],
            optimizeImplants: true,
        });
    });

    it('reports hasExistingConfig false for an untouched config', () => {
        renderPanelWithConfig([makeShip('1', 'Lodolite')], { ...CONFIG, shipRole: 'ATTACKER' });
        expect(communityProps.current?.hasExistingConfig).toBe(false);
    });

    it('reports hasExistingConfig true once anything is configured', () => {
        renderPanelWithConfig([makeShip('1', 'Lodolite')], {
            ...CONFIG,
            shipRole: 'ATTACKER',
            statPriorities: [{ stat: 'crit', minLimit: 100 }],
        });
        expect(communityProps.current?.hasExistingConfig).toBe(true);
    });
});
```

Add the `renderPanelWithConfig` helper next to `renderPanel` (it is the same render with an overridable `getShipConfig`):

```tsx
const renderPanelWithConfig = (ships: (Ship | null)[], config: ShipConfig) => {
    render(
        <AutogearQuickSettings
            selectedShips={ships}
            onShipSelect={vi.fn()}
            onAddShip={vi.fn()}
            onAddTeam={vi.fn()}
            onSaveTeam={vi.fn()}
            canSaveTeam={false}
            onRemoveShip={vi.fn()}
            onOpenSettings={vi.fn()}
            onFindOptimalGear={vi.fn()}
            onMoveShipUp={vi.fn()}
            onMoveShipDown={vi.fn()}
            onApplyBuild={vi.fn()}
            getShipConfig={() => config}
        />
    );
};
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/autogear/__tests__/AutogearQuickSettings.test.tsx`
Expected: FAIL — `currentBuild` is `undefined` (the panel still passes `currentConfig`).

- [ ] **Step 3: Update `AutogearQuickSettings`**

In `src/components/autogear/AutogearQuickSettings.tsx`:

Add to the imports:

```tsx
import { configToSharedBuild, hasExistingBuildConfig } from '../../utils/communityBuild';
import type { SharedAutogearBuild } from '../../types/communityRecommendation';
```

Add `excludedImplantTypes` to the `getShipConfig` return type (it is already returned by the page but was missing from the declared shape):

```tsx
    getShipConfig: (shipId: string) => {
        shipRole: ShipTypeName | null;
        statPriorities: StatPriority[];
        setPriorities: SetPriority[];
        statBonuses: StatBonus[];
        fleetBuffs: FleetBuff[];
        excludedImplantTypes?: string[];
        ignoreEquipped: boolean;
        ignoreUnleveled: boolean;
        useUpgradedStats: boolean;
        tryToCompleteSets: boolean;
        selectedAlgorithm: AutogearAlgorithm;
        showSecondaryRequirements: boolean;
        optimizeImplants: boolean;
    };
```

Add the new prop to the interface and the destructured parameters:

```tsx
    onApplyBuild: (shipId: string, build: SharedAutogearBuild) => void;
```

Replace the whole `{ship && (<CommunityRecommendations … />)}` block with:

```tsx
                        {/* Community builds — one section per selected ship. */}
                        {ship && (
                            <CommunityRecommendations
                                selectedShip={ship}
                                currentBuild={configToSharedBuild(getShipConfig(ship.id))}
                                hasExistingConfig={hasExistingBuildConfig(getShipConfig(ship.id))}
                                onApplyBuild={(build) => onApplyBuild(ship.id, build)}
                            />
                        )}
```

The hand-built object that dropped `fleetBuffs`, `excludedImplantTypes` and the calibration flags is gone.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/autogear/__tests__/AutogearQuickSettings.test.tsx`
Expected: PASS — the existing reorder-arrow tests plus the four new ones.

- [ ] **Step 5: Wire the page handler**

In `src/pages/manager/AutogearPage.tsx`, add this handler next to the other `handle*` functions (near `handleShipSelect`, around line 995):

```tsx
    /**
     * Apply a community build to a ship's config.
     *
     * Writes ONLY the seven build-shaping fields. The user's personal toggles —
     * algorithm, ignoreEquipped, ignoreUnleveled, useUpgradedStats,
     * tryToCompleteSets, includeCalibratedGear, assumeCalibrated,
     * useArenaModifiers — are absent from the update object and so cannot be
     * touched. Like the settings modal, this writes page state; it is persisted
     * by the existing saveConfig call when autogear runs.
     */
    const handleApplyCommunityBuild = (shipId: string, build: SharedAutogearBuild) => {
        updateShipConfig(shipId, {
            shipRole: build.shipRole,
            statPriorities: build.statPriorities,
            setPriorities: build.setPriorities,
            statBonuses: build.statBonuses,
            fleetBuffs: build.fleetBuffs,
            excludedImplantTypes: build.excludedImplantTypes,
            optimizeImplants: build.optimizeImplants,
        });
        addNotification('success', 'Community build applied');
    };
```

Add the import:

```tsx
import type { SharedAutogearBuild } from '../../types/communityRecommendation';
```

and pass it at the `AutogearQuickSettings` usage (line ~1186):

```tsx
                            onApplyBuild={handleApplyCommunityBuild}
```

Confirm `addNotification` is already in scope in this component — it is used by `applySavedConfigs`. If not, pull it from `useNotification()` as that function does.

- [ ] **Step 6: Typecheck, run the full suite, and commit**

```bash
npx tsc --noEmit
npm test
git add src/components/autogear/AutogearQuickSettings.tsx src/components/autogear/__tests__/AutogearQuickSettings.test.tsx src/pages/manager/AutogearPage.tsx
git commit -m "feat(community): apply a community build to the autogear config"
```

`npx tsc --noEmit` must now be **clean**. If it is not, the remaining errors are real — fix them before committing.

---

### Task 10: Documentation and changelog

**Files:**
- Modify: `src/pages/DocumentationPage.tsx:1688-1775` (the Community Recommendations section)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1: Update the in-app documentation**

In `src/pages/DocumentationPage.tsx`, inside the `id="community-recommendations"` section, replace the "Viewing Recommendations" `<ul>` contents with:

```tsx
                                    <li>
                                        When you select a ship, every community build shared for
                                        that ship is listed, best rated first
                                    </li>
                                    <li>
                                        Builds tagged for the ultimate implant you have equipped
                                        sort to the top; builds for a different implant stay
                                        visible at the bottom
                                    </li>
                                    <li>
                                        Click a build to expand its full configuration — role,
                                        stat priorities, gear sets, stat bonuses, fleet buffs and
                                        implant settings
                                    </li>
                                    <li>
                                        Sort by top rated or newest, and see each build&apos;s
                                        refit level
                                    </li>
```

Replace the "Sharing Your Build" `<ol>` contents with:

```tsx
                                    <li>
                                        Configure your autogear settings (role, stat priorities,
                                        gear sets, stat bonuses, fleet buffs, implant settings)
                                    </li>
                                    <li>
                                        Click &quot;Share your build&quot; to open the share form —
                                        it previews exactly what will be published
                                    </li>
                                    <li>
                                        Add a descriptive title (e.g., &quot;High Crit DPS
                                        Build&quot;)
                                    </li>
                                    <li>Optionally add a description explaining your strategy</li>
                                    <li>
                                        Check &quot;Only show to users with same ultimate
                                        implant&quot; if your build is implant-specific
                                    </li>
                                    <li>Click &quot;Share&quot; to publish</li>
```

Add a new block after the "Voting" block, before the "Pro Tips" block:

```tsx
                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Applying a Build
                                </h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        Click &quot;Apply to autogear&quot; on an expanded build to
                                        copy it into your configuration for that ship
                                    </li>
                                    <li>
                                        It replaces role, stat priorities, gear sets, stat bonuses,
                                        fleet buffs and implant settings
                                    </li>
                                    <li>
                                        Your own preferences are never changed: algorithm, ignore
                                        equipped, ignore unleveled, use upgraded stats, complete
                                        sets, calibration and arena modifiers all stay as you set
                                        them
                                    </li>
                                    <li>
                                        You are asked to confirm whenever applying would overwrite
                                        an existing configuration
                                    </li>
                                    <li>
                                        Builds shared before August 2026 carry role, stat
                                        priorities, gear sets and stat bonuses only
                                    </li>
                                </ul>
                            </div>
```

- [ ] **Step 2: Add changelog entries**

Add these three strings to the front of the `UNRELEASED_CHANGES` array in `src/constants/changelog.ts`. Match the existing entries' plain-English, full-sentence style — they explain what changed and what a user will notice, not what the code does.

```ts
    'Community builds now carry your whole build. Sharing a recommendation used to capture only the ship role, stat priorities, stat bonuses and gear sets, so fleet buffs and implant settings were silently dropped and nobody could reproduce the result you actually got. A shared build now also carries your fleet buffs, whether implants are optimized, and which implant types you excluded. Your personal settings are still yours and are never published: algorithm choice, ignore equipped, ignore unleveled, use upgraded stats, complete sets, calibration options and arena modifiers all stay private. The share form now shows you exactly what is about to be published before you publish it.',
    'The community recommendation section is now a browsable list. Instead of one "best" build with everything else hidden behind a "show alternatives" toggle, you see every build shared for the ship, sorted top rated or newest, with a one-line summary of each. Builds tagged for the ultimate implant you have equipped sort to the top, and builds tagged for a different implant stay visible at the bottom rather than disappearing. Click a build to expand its full configuration, now written in the same wording as the autogear settings panel — so a 4-piece set no longer reads the same as a 2-piece one, an additive stat bonus no longer reads the same as a multiplier, and a stat priority with no min or max shows its name instead of an empty row.',
    'Community builds can now be applied in one click. Expand a build and press "Apply to autogear" to copy its role, stat priorities, gear sets, stat bonuses, fleet buffs and implant settings into your configuration for that ship. Your own preferences are left alone. If applying would overwrite a configuration you have already set up, you are asked to confirm first.',
];
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npm test
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "docs: document the community build list, richer shared builds, and apply"
```

- [ ] **Step 4: Manual verification in the running app**

```bash
npm start
```

Open the autogear page on `:3000` (note: `npm start`, not `npm run dev`) and check, in order:

1. Select a ship with existing community recommendations. The header reads "N community builds".
2. Expand it. Every build for the ship is listed with a summary line, refit chip, and vote sum.
3. Change the sort between "Top rated" and "Newest" and confirm the order changes.
4. Expand a build. Its sections match what the settings modal would show for the same config.
5. Press "Apply to autogear" on a ship with no config — it applies with no modal, and the ship's config summary under the ship selector updates.
6. Press it again on a ship that now has config — the confirm modal appears; cancel leaves the config untouched.
7. Open the settings modal for that ship and confirm the algorithm and the gear-filter checkboxes are exactly as you left them.
8. Configure fleet buffs and an implant exclusion, then share a build and confirm the preview lists them and the new row shows them after reload.

Report anything that does not match. The migration must be applied to the Supabase project before step 8 will work.

---

## Post-Implementation Notes

- **The migration is not auto-applied.** `supabase/migrations/20260829000001_community_recommendation_shared_config.sql` must be run against the Supabase project (CLI or dashboard) before shared builds carry the new fields. Until then, every new row still writes its legacy columns and every read falls back to them, so the feature degrades rather than breaks.
- **`get_best_community_recommendation`** is an RPC that exists in prod but not in `supabase/migrations/`. This work stops calling it and deliberately does not drop it, so no migration drift is introduced.
- **`src/types/autogearSuggestion.ts`** becomes unreferenced when `RecommendationContent` is deleted. Left in place — removing it is outside this feature's scope.
