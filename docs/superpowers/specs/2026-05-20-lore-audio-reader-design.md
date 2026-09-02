# Lore Audio Reader — Design Spec

**Date:** 2026-05-20  
**Status:** Approved

## Overview

Add text-to-speech playback to the Lore page so users can listen to ship bios and world lore articles hands-free while doing other things. Built on the browser's Web Speech API. Designed so the voice/synthesis layer can be swapped for ElevenLabs later without restructuring the UI.

## Target voice

Preferred: `"Microsoft Michelle Online (Natural) - English (United States)"` (en-US).  
Fallback chain: first `en-US` female voice → browser default.

## Browser support

`window.speechSynthesis` is not available in all browsers (e.g. Firefox on Android). On mount, check for its existence. If absent, return a no-op player from the hook and hide all audio buttons in the UI.

---

## Architecture

### Hook: `src/hooks/useLoreAudioPlayer.ts`

Owns all speech synthesis state. Returned interface:

```ts
interface LoreAudioPlayer {
    supported: boolean;         // false when window.speechSynthesis is unavailable
    isPlaying: boolean;
    isPlayingAll: boolean;      // true only when a playAll sequence is active
    playingId: string | null;   // ship ID or article slug currently speaking
    play: (id: string, text: string) => void;
    stop: () => void;
    playAll: (items: Array<{ id: string; text: string }>) => void;
}
```

**Behaviour:**

- `play(id, text)` — cancels any in-progress speech (including a running playAll), then speaks `text`. If the same `id` is already playing, acts as a stop toggle instead. Clears `isPlayingAll`.
- `playAll(items)` — compare the incoming list against the currently playing list by joining ordered IDs into a string (e.g. `items.map(i => i.id).join(',')`). If the strings match and `isPlayingAll` is true, stop (toggle). Otherwise, cancel any in-progress speech and play items one after another, updating `playingId` as each item starts. Sets `isPlayingAll = true` for the duration. Store the ID string in a ref so it survives re-renders without triggering the toggle falsely when the filtered array is reconstructed.
- `stop()` — calls `speechSynthesis.cancel()`, clears `isPlaying`, `isPlayingAll`, and `playingId`.
- `isPlaying` — `true` whenever any speech is active, regardless of mode (single-item or playAll). Managed explicitly in React state (not derived from `speechSynthesis.speaking`) to avoid flickering to `false` in the gap between chained utterances. `isPlayingAll` is a narrower signal; both can be `true` at the same time during a playAll sequence.
- Voice selection — attempt `speechSynthesis.getVoices()` eagerly on mount (covers Chrome where voices load synchronously); also register `onvoiceschanged` for browsers that load voices asynchronously. Apply fallback chain: find `"Microsoft Michelle Online (Natural)"` by name → first voice with `lang === 'en-US'` and `name` containing `'female'` or similar heuristic → first `en-US` voice → browser default.
- Cleanup — calls `speechSynthesis.cancel()` on unmount.

---

### Utility: `src/utils/extractLoreText.ts`

Two pure functions, no React dependencies, no DOM manipulation.

**`extractShipText(ship: Ship): string`**

1. If `ship.quote` is present, prepend it as: `"${ship.quote}"${ship.quoteAuthor ? ` — ${ship.quoteAuthor}` : ''}.`  
   (e.g. `"I will find you." — Commander Vex.`)
2. Strip all HTML tags from `ship.bio` using a regex: `bio.replace(/<[^>]*>/g, ' ')`.  
   (`*` not `+` so bare `<br>` and `<hr>` with no attributes are also stripped.)  
   No DOM/innerHTML — pure string replacement to stay clear of the `no-dangerouslySetInnerHTML` rule.
3. Collapse multiple spaces/newlines left by tag removal: `replace(/[ \t]+/g, ' ')`.
4. Join quote block and stripped bio with `\n\n`.
5. If `ship.bio` is absent, return just the quote block (or empty string if both absent).

**`extractArticleText(article: LoreArticle): string`**

Returns `article.body` unchanged (already plain text with `\n\n` paragraph separators).

---

## UI Changes

All audio buttons are hidden when `supported === false`.

### Toolbar (both desktop and mobile layouts)

A `Button variant="secondary" size="sm"` with a play/stop icon placed to the left of the result count label.

- Label: **"Play All"** when idle, **"Stop"** when `isPlayingAll` is true.
- Clicking while `isPlayingAll` is true stops playback (toggle).
- Plays the current tab's **filtered** list in display order (respects active search).

### Per-card header

A `Button variant="secondary" size="xs"` with a play/stop icon added to the right side of the card header row, immediately before the chevron.

- Shows stop icon when `playingId` matches this card's ID.
- On desktop, clicking play also selects the item in the reader pane.
- On mobile, no scroll-into-view or auto-expand behaviour — the user manages navigation themselves.

### Desktop reader pane header

A `Button variant="secondary" size="xs"` with a play/stop icon placed alongside the existing Copy link and Close buttons.

- Plays only the currently open item.
- Shows stop icon when `playingId` matches the open item's ID.
- During a Play All sequence, the reader pane button behaves identically to a per-card button: clicking it calls `play()` for the current item, which clears `isPlayingAll` and plays only that item. The button is not disabled during Play All.

---

## Behaviour Notes

- Clicking any play button while something else is speaking switches to the new item — `play()` cancels automatically, no separate stop step needed.
- Clicking a per-card play button while Play All is running interrupts the queue and plays only that item; the toolbar reverts to idle (since `isPlayingAll` is cleared).
- Play All uses the filtered list, so searching then hitting Play All reads only matching results.
- On desktop, Play All auto-selects each item in the reader pane as it becomes active. On mobile, no visual tracking.

---

## Future: ElevenLabs swap

When ElevenLabs is ready, the intended approach is to pre-generate audio files for each lore entry and serve them as static assets.

The hook's `play(id, text)` signature will need to change — callers will pass an asset URL rather than extracted text. This means the `extractLoreText` utilities become pre-generation tools (run at build time or as a script) rather than runtime helpers, and the calling sites in `ShipLorePage` will pass URLs instead of text. The hook interface and UI structure stay the same; only the `play`/`playAll` signatures and the asset-loading internals change.

---

## Files to create / modify

| File | Action |
|------|--------|
| `src/hooks/useLoreAudioPlayer.ts` | Create |
| `src/utils/extractLoreText.ts` | Create |
| `src/pages/database/ShipLorePage.tsx` | Modify — wire hook + add buttons |

No new UI primitives needed; all buttons use the existing `Button` component.
