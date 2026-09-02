# Autogear Selection Reorder + Team Order Persistence — Design

Date: 2026-07-29
Status: Approved (user-approved 2026-07-29)
Builds on: `2026-07-29-autogear-saved-teams-design.md` (PR #284, branch `feat/autogear-saved-teams`)

## Problem

Autogear processes ships in selection order — index 0 gets first pick of the gear inventory — but the only way to change that order is to remove ships and re-add them in the order you want. And when the selection came from a saved team, there is no way to persist a corrected order at all: the teams feature deliberately shipped with no update-in-place.

## Goal

Up/down arrows on each selected-ship row. When the selection is a loaded team and only its order has changed, write the new order back to that team automatically.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| Save trigger | Auto-save, no confirm | Matches the request literally. A toast naming the team keeps it from being invisible. |
| What auto-save covers | **Order only.** Adding, removing or swapping a ship breaks the link | Keeps the existing "delete and re-save to change a team's membership" rule, and bounds the blast radius: auto-save can rearrange a saved team but can never silently drop a ship from one. |
| Write cadence | Debounced ~600ms | Moving a ship three positions is three clicks; undebounced that is three Supabase writes and three toasts. Local state still updates per click, so the arrows stay instant. |
| Link liveness | Derived from set comparison, not cleared imperatively | One check in one place beats clearing the link at four mutation sites, any of which is easy to miss. |
| After `Save Team` | The newly created team becomes the loaded team | Otherwise "save the team, then nudge the order" silently fails to persist, which is indefensible once auto-save exists elsewhere. |

## The arrows

`src/components/autogear/AutogearQuickSettings.tsx` gains a leading arrow column on each selected-ship row, mirroring `StatPriorityRow.tsx:44-71` exactly:

- `flex flex-col` wrapper
- `Button variant="secondary" size="xs" className="!p-0.5"` with `ChevronUpIcon` / `ChevronDownIcon` at `w-3 h-3`
- Each button rendered **only when the move is possible** — up when `index > 0`, down when `index < selectedShips.length - 1`. (`StatPriorityRow` conditionally renders rather than disabling; match it.)
- `aria-label="Move ship up"` / `"Move ship down"`

New props: `onMoveShipUp: (index: number) => void`, `onMoveShipDown: (index: number) => void`.

Reordering operates on the raw `selectedShips` array, `null` placeholder rows included, via the existing `arrayMove` util — so what the user sees is what moves.

## Tracking the loaded team

Page state: `loadedTeam: { id: string; shipIds: string[] } | null`.

`handleLoadTeam` needs to know whether the ships came from a saved team or an encounter, so `AutogearTeamsModal`'s callback gains a third argument:

```ts
onLoadTeam: (shipIds: string[], suggestedName: string, teamId?: string) => boolean;
```

Saved-team rows pass their `team.id`; encounter rows pass nothing. `handleLoadTeam` sets `loadedTeam` when `teamId` is present and clears it otherwise.

**Liveness is derived.** A new pure helper in `src/utils/autogear/teamShips.ts`:

```ts
/** True when both lists contain the same ship ids, ignoring order and duplicates. */
export const isSameShipSet = (a: string[], b: string[]): boolean;
```

The link is live when `loadedTeam !== null` and `isSameShipSet(currentRealShipIds, loadedTeam.shipIds)`. Reordering preserves the set, so the link survives; any membership change makes the sets differ and the link goes dead without anything having to remember to clear it.

`currentRealShipIds` means the page's existing **deduped** real-ship list (`dedupedSelectedShips`, already derived for the `Save Team` gate and preview) mapped to ids — the same list `saveTeam` writes. `isSameShipSet` ignores duplicates regardless, but the order written back to a team must be the deduped one, so that both write paths agree on what a team's `shipIds` contains.

## Persisting the order

`useAutogearTeams` gains:

```ts
updateTeamOrder: (id: string, shipIds: string[]) => Promise<void>;
```

Optimistic local update of that team's `shipIds`, then `supabase.from('autogear_teams').update({ ship_ids: shipIds }).eq('id', id).eq('user_id', activeProfileId)`. Targeted rollback of just that team on failure, `console.error` plus an error notification — same shape as `saveTeam`/`deleteTeam`. On success: `addNotification('success', 'Saved new order for "<name>"')`. No name is written, so the `(user_id, lower(name))` unique index cannot be violated.

`saveTeam`'s signature changes from `Promise<void>` to `Promise<string>`, returning the team id (the client-generated `uuid` on the local-only path, the server row's id when synced) so the page can adopt the new team as `loadedTeam`. Both early-return paths must return the id.

## Debounce

Page-level, two refs:

- `pendingOrderRef: React.MutableRefObject<string[] | null>` — the latest order to write
- `orderSaveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>`

Each arrow click updates `selectedShips`, writes the new real-ship-id order into `pendingOrderRef`, clears any existing timer, and sets a fresh 600ms one. The timeout callback reads the order **from the ref** (never from a closure, so it cannot write a stale array), re-checks that the link is still live, and calls `updateTeamOrder`.

**The guard must live inside the timeout callback, not around the `setTimeout`.** React 18 Strict Mode double-invokes effects in development; a guard evaluated outside would be checked against pre-cleanup state. (This exact trap is recorded in project memory.)

An unmount cleanup clears the pending timer. A pending order is deliberately **not** flushed on unmount: navigating away mid-reorder should not persist a half-finished arrangement.

## Edge cases

| Case | Behaviour |
|---|---|
| Reorder with no team loaded | Order changes locally; nothing persisted; no toast |
| Reorder a loaded team, then add a ship before the debounce fires | The queued write is dropped — the timeout re-checks liveness and finds the sets no longer match |
| Reorder, then load a different team before the debounce fires | Same: liveness re-check fails against the new `loadedTeam`, no write |
| Arrows with `null` placeholder rows present | Rows move as displayed; only real ships are written to the team |
| Team's ships partially missing from the fleet | Load already drops unresolvable ids and the link compares against what loaded, so a reorder writes back the resolvable set. Accepted: the alternative is refusing to reorder a partially-stale team. |
| Signed out | localStorage only, same as every other team write |
| Supabase write fails | That team's order rolls back locally, error notification, local selection order unchanged (the user's working order is not disturbed by a persistence failure) |

## Testing

- `isSameShipSet` — same set reordered, added, removed, swapped, duplicates on either side, empty lists.
- Component test on `AutogearQuickSettings` arrows: clicking down on row 0 swaps rows 0 and 1; first row renders no up arrow; last row renders no down arrow. (No test file exists for this component yet — this creates one.)
- `updateTeamOrder` follows the established untested-hook precedent (`useAutogearTeams` has no unit tests because the codebase has no `renderHook` usage anywhere); its coverage is the helper plus a manual pass.
- Manual: load a team, reorder, confirm one toast after ~600ms; reload the page and confirm the order stuck; reorder then immediately remove a ship and confirm nothing was written.

## Out of scope

- Drag-and-drop reordering (arrows match the existing priority-list pattern)
- Persisting membership changes to a loaded team (still delete and re-save)
- Rename
- Any change to `TeamLoadout` on the Loadouts page
