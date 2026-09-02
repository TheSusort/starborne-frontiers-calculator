# Unreleased Changelog Entries — Design Spec

**Date:** 2026-05-11  
**Status:** Approved

## Summary

Add an `UNRELEASED_CHANGES` string array to the changelog constants so developers can accumulate feature descriptions without triggering the auto-popup. The modal renders them as an "Unreleased" section at the top. On weekly release, the strings are moved into a new versioned `ChangelogEntry` and `CURRENT_VERSION` is bumped.

---

## 1. Data Layer

**File:** `src/constants/changelog.ts`

Add at the top of the file, above `CHANGELOG`:

```typescript
// RELEASE CHECKLIST: move these strings into a new ChangelogEntry at the top of
// CHANGELOG (with the new version + today's date), clear this array back to [],
// and bump CURRENT_VERSION. All three steps must happen together.
export const UNRELEASED_CHANGES: string[] = [
    // Add new feature descriptions here — they appear in the changelog
    // but do NOT trigger the auto-popup until promoted to a release.
];
```

`CURRENT_VERSION` is left unchanged between weekly releases.

---

## 2. Changelog Modal

**File:** `src/components/changelog/ChangelogModal.tsx`

- Import `UNRELEASED_CHANGES` alongside the existing imports.
- When `UNRELEASED_CHANGES.length > 0`, render an "Unreleased" section **unconditionally** at the very top of the modal list — it must be placed **outside** (and before) the existing `entries.map(...)` loop that gates entries with `compareVersions`. No version comparison is applied to the unreleased section.
- The section heading is the plain string `"Unreleased"` — no `"Version "` prefix, no dash, no date.
- The changes list uses the same layout as a regular entry's `changes` list.
- The auto-popup trigger is unchanged — it still fires only when `CURRENT_VERSION !== lastSeenVersion`.

**Manual-open behavior (intentional):** The existing `compareVersions` filter means a user who opens the modal manually after the auto-popup has already updated their `lastSeenVersion` to `CURRENT_VERSION` will see only the unreleased section (no versioned entries, since none are newer). This is acceptable — the unreleased section is always visible when non-empty, which is the primary value of the feature.

---

## 3. Weekly Release Workflow

On release day, three edits are required in `src/constants/changelog.ts` — they must all happen in the same commit to avoid inconsistent state:

1. Move all strings from `UNRELEASED_CHANGES` into a new `ChangelogEntry` at the top of `CHANGELOG` with the new version number and today's date.
2. Clear `UNRELEASED_CHANGES` back to `[]`.
3. Bump `CURRENT_VERSION` to the new version string.

The co-located `// RELEASE CHECKLIST` comment (see §1) serves as the reminder. The popup fires automatically for users on next app load.

---

## Behavior Notes

- `UNRELEASED_CHANGES` is always visible in the modal when non-empty — no version comparison is involved.
- No changes to `ChangelogEntry` type, `ChangelogState` type, or storage logic.
- No changes to version comparison logic.
