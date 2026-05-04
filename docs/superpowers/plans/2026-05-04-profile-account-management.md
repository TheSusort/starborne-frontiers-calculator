# Profile & Account Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move data management out of the homepage into Profile, make Profile accessible to anonymous users, add a Supabase sync toggle, and add a Connected Integrations placeholder section.

**Architecture:** New utility/service layer (`syncUtils.ts`, `userDataService.ts`) is added first, then contexts are updated to respect the sync flag, then UI is built on top. Each layer is independently testable. The Profile page gets new collapsible sections using existing `CollapsibleAccordion` / `CollapsibleForm` components.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Supabase JS client, Vitest + React Testing Library

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `src/utils/syncUtils.ts` | `isSupabaseSyncEnabled()` — single source of truth for sync flag |
| `src/services/userDataService.ts` | `deleteUserSupabaseData()` + `reuploadLocalDataToSupabase()` |
| `src/constants/integrations.ts` | Static array of integration definitions |

### Modified files
| File | Change |
|---|---|
| `src/constants/storage.ts` | Add `SUPABASE_SYNC_ENABLED` key |
| `src/components/auth/LoginButton.tsx` | Add anon dropdown (Profile / Sign in) |
| `src/pages/ProfilePage.tsx` | Remove auth guard; add Data Management + Integrations sections |
| `src/pages/HomePage.tsx` | Remove backup/restore card section |
| `src/contexts/ShipsContext.tsx` | Add sync flag guard before all Supabase writes |
| `src/contexts/InventoryProvider.tsx` | Add sync flag guard before all Supabase writes |
| `src/contexts/AutogearConfigContext.tsx` | Add sync flag guard before all Supabase writes |
| `src/contexts/EngineeringStatsProvider.tsx` | Add sync flag guard before all Supabase writes |
| `src/hooks/useLoadouts.ts` | Add sync flag guard before all Supabase writes |
| `src/hooks/useEncounterNotes.ts` | Add sync flag guard before all Supabase writes |
| `src/pages/DocumentationPage.tsx` | Document new Profile capabilities |

---

## Task 1: Storage constant + sync flag utility

**Files:**
- Modify: `src/constants/storage.ts`
- Create: `src/utils/syncUtils.ts`
- Create: `src/utils/__tests__/syncUtils.test.ts`

- [ ] **Step 1: Add storage key**

In `src/constants/storage.ts`, add `SUPABASE_SYNC_ENABLED` to the existing object alongside the other keys (values are lowercase snake_case strings):

```ts
SUPABASE_SYNC_ENABLED: 'supabase_sync_enabled',
```

- [ ] **Step 2: Write failing tests for syncUtils**

Create `src/utils/__tests__/syncUtils.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { isSupabaseSyncEnabled } from '../syncUtils';

describe('isSupabaseSyncEnabled', () => {
    afterEach(() => {
        localStorage.removeItem('supabase_sync_enabled');
    });

    it('returns true when flag is absent (default)', () => {
        expect(isSupabaseSyncEnabled()).toBe(true);
    });

    it('returns true when flag is set to "true"', () => {
        localStorage.setItem('supabase_sync_enabled', 'true');
        expect(isSupabaseSyncEnabled()).toBe(true);
    });

    it('returns false when flag is set to "false"', () => {
        localStorage.setItem('supabase_sync_enabled', 'false');
        expect(isSupabaseSyncEnabled()).toBe(false);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- --run src/utils/__tests__/syncUtils.test.ts
```

Expected: FAIL — `syncUtils` does not exist yet.

- [ ] **Step 4: Create syncUtils**

Create `src/utils/syncUtils.ts`:

```ts
import { StorageKey } from '../constants/storage';

export function isSupabaseSyncEnabled(): boolean {
    return localStorage.getItem(StorageKey.SUPABASE_SYNC_ENABLED) !== 'false';
}

export function setSupabaseSyncEnabled(enabled: boolean): void {
    localStorage.setItem(StorageKey.SUPABASE_SYNC_ENABLED, String(enabled));
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --run src/utils/__tests__/syncUtils.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/constants/storage.ts src/utils/syncUtils.ts src/utils/__tests__/syncUtils.test.ts
git commit -m "feat: add supabase sync flag utility"
```

---

## Task 2: Data service — delete and reupload

**Files:**
- Modify: `src/hooks/useStorage.ts` (export `getFromIndexedDB`)
- Create: `src/services/userDataService.ts`

The delete function must remove tables in child-before-parent order to avoid FK violations (no CASCADE constraints exist). Tables without a `user_id` column must be scoped via subquery through their parent.

The reupload function reads current local state (localStorage + IndexedDB) and upserts everything to Supabase. Use `syncMigratedDataToSupabase` in `src/utils/migratePlayerData.ts` as reference for data shapes and upsert patterns — but **do not call it**: that function does UUID remapping for new users, which must not run here.

- [ ] **Step 1: Export `getFromIndexedDB` from useStorage**

In `src/hooks/useStorage.ts`, find line 44:
```ts
const getFromIndexedDB = async (key: string): Promise<any> => {
```
Change `const` to `export const`:
```ts
export const getFromIndexedDB = async (key: string): Promise<any> => {
```

- [ ] **Step 2: Create userDataService.ts with deleteUserSupabaseData**

Create `src/services/userDataService.ts`:

```ts
import { supabase } from '../config/supabase';
import { StorageKey } from '../constants/storage';
import { getFromIndexedDB } from '../hooks/useStorage';

export async function deleteUserSupabaseData(userId: string): Promise<void> {
    // Delete in child-before-parent order. Tables without user_id use subqueries.
    const steps: Array<() => Promise<void>> = [
        // team_loadout_equipment → team_loadouts → user_id
        async () => {
            const { data: tl } = await supabase.from('team_loadouts').select('id').eq('user_id', userId);
            if (!tl?.length) return;
            const ids = tl.map(r => r.id);
            await supabase.from('team_loadout_equipment').delete().in('team_loadout_id', ids);
            await supabase.from('team_loadout_ships').delete().in('team_loadout_id', ids);
        },
        async () => { await supabase.from('team_loadouts').delete().eq('user_id', userId); },
        // loadout_equipment → loadouts → user_id
        async () => {
            const { data: lo } = await supabase.from('loadouts').select('id').eq('user_id', userId);
            if (!lo?.length) return;
            await supabase.from('loadout_equipment').delete().in('loadout_id', lo.map(r => r.id));
        },
        async () => { await supabase.from('loadouts').delete().eq('user_id', userId); },
        // encounter_formations → encounter_notes → user_id (also has ship_id FK, deleted before ships below)
        async () => {
            const { data: en } = await supabase.from('encounter_notes').select('id').eq('user_id', userId);
            if (!en?.length) return;
            await supabase.from('encounter_formations').delete().in('note_id', en.map(r => r.id));
        },
        // ship child tables — scope via ships → user_id
        async () => {
            const { data: sh } = await supabase.from('ships').select('id').eq('user_id', userId);
            if (!sh?.length) return;
            const shipIds = sh.map(r => r.id);
            await supabase.from('ship_equipment').delete().in('ship_id', shipIds);
            const { data: imp } = await supabase.from('ship_implants').select('id').in('ship_id', shipIds);
            if (imp?.length) {
                await supabase.from('ship_implant_stats').delete().in('implant_id', imp.map(r => r.id));
            }
            await supabase.from('ship_implants').delete().in('ship_id', shipIds);
            const { data: ref } = await supabase.from('ship_refits').select('id').in('ship_id', shipIds);
            if (ref?.length) {
                await supabase.from('ship_refit_stats').delete().in('refit_id', ref.map(r => r.id));
            }
            await supabase.from('ship_refits').delete().in('ship_id', shipIds);
            await supabase.from('ship_base_stats').delete().in('ship_id', shipIds);
        },
        async () => { await supabase.from('encounter_notes').delete().eq('user_id', userId); },
        // inventory_items must go before ships (calibration_ship_id FK)
        async () => { await supabase.from('inventory_items').delete().eq('user_id', userId); },
        async () => { await supabase.from('ships').delete().eq('user_id', userId); },
        async () => { await supabase.from('engineering_stats').delete().eq('user_id', userId); },
        async () => { await supabase.from('autogear_configs').delete().eq('user_id', userId); },
    ];

    for (const step of steps) {
        await step();
    }
}
```

- [ ] **Step 3: Add reuploadLocalDataToSupabase**

Append to `src/services/userDataService.ts`. Reference `syncMigratedDataToSupabase` in `src/utils/migratePlayerData.ts` for the exact JSON shapes each table expects. Use upsert (not insert) throughout so this is idempotent.

Key data sources:
- `ships`, `loadouts`, `team_loadouts`, `encounter_notes`, `autogear_configs`, `engineering_stats` → `localStorage.getItem(StorageKey.X)`
- `inventory_items` → IndexedDB under the **profile-scoped key** `` `${StorageKey.INVENTORY}:${userId}` `` (the app stores inventory per-profile). Use `await getFromIndexedDB(\`${StorageKey.INVENTORY}:${userId}\`)`.
- `gear_upgrades` has no Supabase table — skip it

```ts
export async function reuploadLocalDataToSupabase(userId: string): Promise<void> {
    // Ships (upsert parents before children)
    const rawShips = localStorage.getItem(StorageKey.SHIPS);
    if (rawShips) {
        const ships = JSON.parse(rawShips);
        // Mirror the upsert logic from syncMigratedDataToSupabase in src/utils/migratePlayerData.ts
        // for ships, ship_base_stats, ship_refits, ship_refit_stats, ship_implants,
        // ship_implant_stats, ship_equipment — refer to that file for exact field mapping.
        // Use .upsert(..., { onConflict: 'id' }) for each table.
        void ships; // replace with actual implementation
    }

    // Inventory (IndexedDB — profile-scoped key)
    const inventory = await getFromIndexedDB(`${StorageKey.INVENTORY}:${userId}`);
    if (inventory) {
        // Upsert inventory_items. Refer to syncMigratedDataToSupabase for field mapping.
        void inventory;
    }

    // Encounter notes
    const rawEncounters = localStorage.getItem(StorageKey.ENCOUNTERS);
    if (rawEncounters) {
        // Upsert encounter_notes then encounter_formations.
        void rawEncounters;
    }

    // Loadouts
    const rawLoadouts = localStorage.getItem(StorageKey.LOADOUTS);
    if (rawLoadouts) {
        // Upsert loadouts then loadout_equipment.
        void rawLoadouts;
    }

    // Team loadouts
    const rawTeamLoadouts = localStorage.getItem(StorageKey.TEAM_LOADOUTS);
    if (rawTeamLoadouts) {
        // Upsert team_loadouts, team_loadout_ships, team_loadout_equipment.
        void rawTeamLoadouts;
    }

    // Engineering stats
    const rawEngineering = localStorage.getItem(StorageKey.ENGINEERING_STATS);
    if (rawEngineering) {
        // Upsert engineering_stats rows.
        void rawEngineering;
    }

    // Autogear configs
    const rawConfigs = localStorage.getItem(StorageKey.AUTOGEAR_CONFIGS);
    if (rawConfigs) {
        // Upsert autogear_configs with onConflict: 'user_id, ship_id'.
        void rawConfigs;
    }
}
```

> **Implementation note:** Fill in each `void X` block by mirroring the corresponding section in `syncMigratedDataToSupabase` (`src/utils/migratePlayerData.ts`). The field mappings and JSON structure are identical — the only difference is using `.upsert()` with `onConflict` on `id` instead of `.insert()`, and skipping `migratePlayerData()` and UUID remapping.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: No errors. Fix any type errors before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useStorage.ts src/services/userDataService.ts
git commit -m "feat: add deleteUserSupabaseData and reuploadLocalDataToSupabase"
```

---

## Task 3: Add sync flag check to all contexts

All Supabase write functions follow the same pattern: they check `if (!activeProfileId) return;` before making any Supabase calls. Add `if (!isSupabaseSyncEnabled()) return;` immediately after that guard in each function. This skips the cloud write while still updating local state normally.

Import `isSupabaseSyncEnabled` from `'../utils/syncUtils'` (adjust path depth per file).

**Files:**
- Modify: `src/contexts/ShipsContext.tsx`
- Modify: `src/contexts/InventoryProvider.tsx`
- Modify: `src/contexts/AutogearConfigContext.tsx`
- Modify: `src/contexts/EngineeringStatsProvider.tsx`
- Modify: `src/hooks/useLoadouts.ts`
- Modify: `src/hooks/useEncounterNotes.ts`

- [ ] **Step 1: Update ShipsContext.tsx**

Add `import { isSupabaseSyncEnabled } from '../utils/syncUtils';` at the top.

Then in every function that writes to Supabase (addShip, updateShip, deleteShip, addRefit, updateRefit, deleteRefit, assignGear, unassignGear, addImplant, removeImplant, etc.), add the guard immediately after the `activeProfileId` check:

```ts
if (!activeProfileId) return;
if (!isSupabaseSyncEnabled()) return; // ← add this line
```

- [ ] **Step 2: Update InventoryProvider.tsx**

Same pattern — add `isSupabaseSyncEnabled` import and guard in `addGear`, `updateGear`, `deleteGear`, and any other Supabase-writing function.

- [ ] **Step 3: Update AutogearConfigContext.tsx**

Add guard in `saveConfig` and `resetConfig` (or `deleteConfig`) functions.

- [ ] **Step 4: Update EngineeringStatsProvider.tsx**

Add guard in `saveEngineeringStats`.

- [ ] **Step 5: Update useLoadouts.ts**

Add guard in `addLoadout`, `updateLoadout`, `deleteLoadout`, `addTeamLoadout`, `updateTeamLoadout`, `deleteTeamLoadout`.

- [ ] **Step 6: Update useEncounterNotes.ts**

Add guard in `addEncounter`, `updateEncounter`, `deleteEncounter`.

- [ ] **Step 7: Lint check**

```bash
npm run lint
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/contexts/ShipsContext.tsx src/contexts/InventoryProvider.tsx src/contexts/AutogearConfigContext.tsx src/contexts/EngineeringStatsProvider.tsx src/hooks/useLoadouts.ts src/hooks/useEncounterNotes.ts
git commit -m "feat: respect supabase sync flag in all write contexts"
```

---

## Task 4: LoginButton — anonymous dropdown

The current `LoginButton` (`src/components/auth/LoginButton.tsx`, ~76 lines) shows a sign-in button when `!user`. Change it to show a "Profile / Sign in" text button that opens a dropdown identical in style to the authenticated dropdown, with two items: "Profile" (→ `/profile`) and "Sign in" (opens AuthModal).

**Files:**
- Modify: `src/components/auth/LoginButton.tsx`

- [ ] **Step 1: Read the current file**

Read `src/components/auth/LoginButton.tsx` in full to understand its current structure before editing.

- [ ] **Step 2: Update the anonymous state**

Replace the `return <button>Sign in</button>` (or equivalent) branch with a `Dropdown` component that matches the authenticated dropdown's visual style.

The anonymous dropdown has two `DropdownItem` entries:
1. "Profile" — `onClick: () => navigate('/profile')` (import `useNavigate` from `react-router-dom` if not already imported)
2. "Sign in" — `onClick: () => setShowAuthModal(true)` (or however `AuthModal` is currently triggered)

The trigger button should display the text "Profile / Sign in" with no avatar image.

- [ ] **Step 3: Lint check**

```bash
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/auth/LoginButton.tsx
git commit -m "feat: add profile/sign-in dropdown for anonymous users"
```

---

## Task 5: Profile page — open access + auth-gate sections

**Files:**
- Modify: `src/pages/ProfilePage.tsx`

- [ ] **Step 1: Read the current ProfilePage**

Read `src/pages/ProfilePage.tsx` in full to understand the current structure before editing.

- [ ] **Step 2: Remove the auth guard**

Find and remove the `if (!user) return <...sign-in prompt...>` block near the top of the component.

- [ ] **Step 3: Fix the loading state**

Find where `loading` state is initialized. Ensure it initializes to `false` when `!user` so anonymous users don't see a loader. The `useEffect` that fetches profile data already short-circuits when there is no user, so this is typically just adjusting the initial state value or the early-return logic.

- [ ] **Step 4: Add AuthModal state to ProfilePage**

`AuthModal` has no shared context — it is triggered by local state. Add to `ProfilePage`:

```tsx
import { AuthModal } from '../components/auth/AuthModal';

// inside the component:
const [showAuthModal, setShowAuthModal] = useState(false);
```

And render at the bottom of the JSX (alongside any other modals):
```tsx
<AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
```

- [ ] **Step 5: Wrap auth-required sections**

Create a small inline helper component at the top of the file (not exported — it's private to ProfilePage):

```tsx
function AuthRequired({ label, onSignIn }: { label: string; onSignIn: () => void }) {
    return (
        <div className="card p-6 text-center text-theme-text-secondary">
            <p className="mb-3">Sign in to view {label}</p>
            <Button variant="primary" size="sm" onClick={onSignIn}>
                Sign in
            </Button>
        </div>
    );
}
```

Use it in each auth-required section:
```tsx
{user ? (
    <ProfileSettingsSection ... />
) : (
    <AuthRequired label="your profile settings" onSignIn={() => setShowAuthModal(true)} />
)}
```

Apply to: Profile Settings, Alt Accounts, App Preferences, Statistics, Usage Statistics, Engineering Leaderboards, Top Ship Rankings.

- [ ] **Step 6: Lint check**

```bash
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/ProfilePage.tsx
git commit -m "feat: make profile page accessible to anonymous users"
```

---

## Task 6: Data Management section on Profile

This task adds the new collapsible "Data Management" section containing:
1. Supabase Sync Toggle (auth-required, main account only)
2. Clear Cloud Data button (auth-required, sync-on only)
3. BackupRestoreData component (moved from HomePage)
4. Delete Local Storage button (moved from HomePage)
5. Delete Account button (moved from HomePage, auth-required)

**Files:**
- Modify: `src/pages/ProfilePage.tsx`

- [ ] **Step 1: Locate the BackupRestoreData, delete buttons in HomePage**

Read `src/pages/HomePage.tsx` lines 260-300 to see exactly what needs to be moved. The section to move includes `<BackupRestoreData />`, the delete local storage button, and the delete account button (and their surrounding markup/state).

- [ ] **Step 2: Add local state for sync toggle**

In `ProfilePage.tsx`, add state to track sync enabled status and a loading flag for the async operations:

```tsx
const [syncEnabled, setSyncEnabled] = useState<boolean>(isSupabaseSyncEnabled());
const [syncLoading, setSyncLoading] = useState(false);
```

Import `isSupabaseSyncEnabled` and `setSupabaseSyncEnabled` from `'../utils/syncUtils'` and `deleteUserSupabaseData`, `reuploadLocalDataToSupabase` from `'../services/userDataService'`.

- [ ] **Step 3: Add toggle handlers**

```tsx
const handleSyncToggleOff = async () => {
    setSyncLoading(true);
    try {
        await deleteUserSupabaseData(user!.id);
        setSupabaseSyncEnabled(false);
        setSyncEnabled(false);
    } finally {
        setSyncLoading(false);
    }
};

const handleSyncToggleOn = async () => {
    setSyncLoading(true);
    try {
        setSupabaseSyncEnabled(true);
        setSyncEnabled(true);
        await deleteUserSupabaseData(user!.id);
        await reuploadLocalDataToSupabase(user!.id);
    } finally {
        setSyncLoading(false);
    }
};

const handleClearAndReSync = async () => {
    setSyncLoading(true);
    try {
        await deleteUserSupabaseData(user!.id);
        await reuploadLocalDataToSupabase(user!.id);
    } finally {
        setSyncLoading(false);
    }
};
```

- [ ] **Step 4: Build the Data Management section**

Add a new collapsible section to `ProfilePage` (use `CollapsibleAccordion` or `CollapsibleForm` — follow the same pattern used by other sections on the page):

```tsx
<CollapsibleAccordion title="Data Management">
    {/* Supabase Sync Toggle — auth-required, main account only */}
    {user && !isOnAlt && (
        <div className="card p-4 mb-4">
            <h3 className="text-theme-text font-semibold mb-1">Cloud Sync</h3>
            <p className="text-theme-text-secondary text-sm mb-3">
                When enabled, your data is automatically saved to the cloud and accessible on any device.
            </p>
            <div className="flex items-center justify-between">
                <span className="text-theme-text text-sm">
                    {syncEnabled ? 'Sync enabled' : 'Sync disabled (local only)'}
                </span>
                <Button
                    variant={syncEnabled ? 'danger' : 'primary'}
                    size="sm"
                    disabled={syncLoading}
                    onClick={() => {
                        if (syncEnabled) {
                            // show confirm modal for toggle off
                        } else {
                            handleSyncToggleOn();
                        }
                    }}
                >
                    {syncEnabled ? 'Disable sync' : 'Enable sync'}
                </Button>
            </div>
            {/* Confirm modal for toggle off — use ConfirmModal component */}

            {/* Clear & re-sync — only shown when sync is on */}
            {syncEnabled && (
                <div className="mt-3 pt-3 border-t border-dark-border">
                    <Button
                        variant="danger"
                        size="sm"
                        disabled={syncLoading}
                        onClick={() => { /* show clear confirm modal */ }}
                    >
                        Clear & re-sync
                    </Button>
                    <p className="text-theme-text-secondary text-xs mt-1">
                        Wipes cloud data and re-uploads from local. Sync stays enabled.
                    </p>
                </div>
            )}
        </div>
    )}

    {/* Backup & Restore — always visible */}
    <BackupRestoreData />

    {/* Delete Local Storage — always visible */}
    {/* Move the existing delete local storage button/logic here */}

    {/* Delete Account — auth-required */}
    {user && (
        {/* Move the existing delete account button/logic here */}
    )}
</CollapsibleAccordion>
```

Use `ConfirmModal` (from `src/components/ui/`) for the sync-off and clear-and-re-sync confirmations:
- Sync off: "This will delete all your cloud data and disable sync. Your local data is unaffected. This cannot be undone."
- Clear & re-sync: "This will delete all your cloud data and immediately re-upload from your local data. Sync remains enabled."

- [ ] **Step 5: Lint check**

```bash
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProfilePage.tsx
git commit -m "feat: add data management section to profile page"
```

---

## Task 7: Connected Integrations section

**Files:**
- Create: `src/constants/integrations.ts`
- Modify: `src/pages/ProfilePage.tsx`

- [ ] **Step 1: Create integration definitions**

Create `src/constants/integrations.ts`:

```ts
export type IntegrationStatus = 'deprecated' | 'coming-soon' | 'available' | 'connected';

export interface Integration {
    id: string;
    name: string;
    description: string;
    status: IntegrationStatus;
}

export const INTEGRATIONS: Integration[] = [
    {
        id: 'cubedweb',
        name: 'Cubedweb Hangar',
        description: 'Shared hangar viewing — a new system is in development.',
        status: 'deprecated',
    },
    {
        id: 'sf-api',
        name: 'Starborne Frontiers API',
        description: 'Official game API access for community toolers.',
        status: 'coming-soon',
    },
];
```

- [ ] **Step 2: Add Connected Integrations section to ProfilePage**

Add a new collapsible section below Data Management. When `!user`, show a placeholder. When `user` is set, map over `INTEGRATIONS` and render a card per integration:

```tsx
<CollapsibleAccordion title="Connected Integrations">
    {!user ? (
        <div className="card p-6 text-center text-theme-text-secondary">
            <p>Sign in to manage integrations</p>
        </div>
    ) : (
        <div className="space-y-3">
            {INTEGRATIONS.map(integration => (
                <div key={integration.id} className="card p-4 flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-theme-text font-medium">{integration.name}</span>
                            <StatusBadge status={integration.status} />
                        </div>
                        <p className="text-theme-text-secondary text-sm">{integration.description}</p>
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={integration.status === 'deprecated' || integration.status === 'coming-soon'}
                    >
                        {integration.status === 'connected' ? 'Disconnect' : 'Connect'}
                    </Button>
                </div>
            ))}
        </div>
    )}
</CollapsibleAccordion>
```

Add a small `StatusBadge` inline component in the same file (not exported):

```tsx
function StatusBadge({ status }: { status: IntegrationStatus }) {
    const labels: Record<IntegrationStatus, string> = {
        deprecated: 'Deprecated',
        'coming-soon': 'Coming Soon',
        available: 'Available',
        connected: 'Connected',
    };
    const colors: Record<IntegrationStatus, string> = {
        deprecated: 'bg-red-900/40 text-red-400',
        'coming-soon': 'bg-yellow-900/40 text-yellow-400',
        available: 'bg-green-900/40 text-green-400',
        connected: 'bg-blue-900/40 text-blue-400',
    };
    return (
        <span className={`text-xs px-2 py-0.5 rounded ${colors[status]}`}>
            {labels[status]}
        </span>
    );
}
```

- [ ] **Step 3: Lint check**

```bash
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/constants/integrations.ts src/pages/ProfilePage.tsx
git commit -m "feat: add connected integrations section to profile page"
```

---

## Task 8: Remove backup/restore from HomePage

**Files:**
- Modify: `src/pages/HomePage.tsx`

- [ ] **Step 1: Remove the backup/restore section**

In `src/pages/HomePage.tsx`, find and delete the following block (approximately lines 269-292):

```tsx
{/* Backup & Restore */}
<section className="card p-8">
    <div className="max-w-3xl mx-auto text-center">
        ...
        <BackupRestoreData />
    </div>
</section>
```

Also remove the `BackupRestoreData` import at the top of the file, and any delete account / delete local storage buttons that lived in this section (they should already be moved to ProfilePage in Task 6).

- [ ] **Step 2: Lint check**

```bash
npm run lint
```

Expected: No unused import warnings. Fix if any remain.

- [ ] **Step 3: Commit**

```bash
git add src/pages/HomePage.tsx
git commit -m "feat: remove backup/restore section from homepage"
```

---

## Task 9: Documentation update

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Update documentation**

Find the relevant section(s) in `DocumentationPage.tsx` (search for "backup", "profile", or "account"). Add or update entries to document:

1. **Profile page is accessible without signing in** — anonymous users can access backup/restore and data management without an account.
2. **Data Management section** — describes the sync toggle (what enabling/disabling does, note about localStorage persistence across devices), the "Clear & re-sync" option, and the backup/restore location.
3. **Connected Integrations section** — brief mention that this is a placeholder for future integrations (Cubedweb and SF API).

Follow the existing style and structure of documentation entries in that file.

- [ ] **Step 2: Lint check**

```bash
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/DocumentationPage.tsx
git commit -m "docs: update documentation for profile & account management changes"
```

---

## Task 10: Manual verification

- [ ] **Step 1: Start dev server**

```bash
npm start
```

- [ ] **Step 2: Verify anonymous access**

Open the app without signing in. Verify:
- Sidebar shows "Profile / Sign in" button (no avatar)
- Clicking it opens a dropdown with "Profile" and "Sign in" options
- "Profile" navigates to `/profile` without redirecting to sign-in
- Profile page shows auth-gated placeholders for settings/stats sections
- Data Management section is fully visible with Backup & Restore
- Connected Integrations section shows "Sign in to manage integrations"

- [ ] **Step 3: Verify authenticated experience**

Sign in with Google. Verify:
- Sidebar still shows avatar + username dropdown with "Profile" and "Sign Out"
- Profile page shows all sections normally
- Data Management section shows sync toggle and "Clear & re-sync"
- Connected Integrations shows the two integration cards with Deprecated/Coming Soon badges

- [ ] **Step 4: Verify sync toggle**

With sync enabled (default), toggle it off:
- Confirm modal appears with correct wording
- After confirm, toggle shows "disabled" state
- Make a change (add a ship) — verify it saves locally but no Supabase write occurs (check Supabase dashboard or network tab)

Re-enable sync:
- Delete-then-reupload runs — verify data appears in Supabase

- [ ] **Step 5: Verify HomePage cleanup**

Navigate to Home — verify the "Backup & Restore" section is gone with no visible gap or broken layout.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: All existing tests pass.
