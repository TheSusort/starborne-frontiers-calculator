import type { InputAction } from '../../utils/arcade/types';

export const SWIPE_THRESHOLD_PX = 30;

export function keyToAction(key: string): InputAction | null {
    switch (key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
            return 'left';
        case 'ArrowRight':
        case 'd':
        case 'D':
            return 'right';
        case 'ArrowUp':
        case 'w':
        case 'W':
        case ' ':
            return 'jump';
        case 'ArrowDown':
        case 's':
        case 'S':
            return 'duck';
        default:
            return null;
    }
}

export function swipeToAction(dx: number, dy: number): InputAction | null {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD_PX) return null;
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'jump' : 'duck';
}

/** True while a project `Select` dropdown is open: its trigger exposes `aria-expanded`, and the
 *  listbox is portalled into `#select-root` (focus may sit in its search input). */
export const isSelectDropdownOpen = (doc: Document = document): boolean =>
    !!doc.activeElement?.closest('[aria-expanded="true"]') ||
    !!doc.querySelector('#select-root [role="listbox"]');

/** True when a key event came from a field the player types into. */
export function isTextTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}
