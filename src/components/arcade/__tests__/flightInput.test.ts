import { describe, it, expect, afterEach } from 'vitest';
import {
    isSelectDropdownOpen,
    keyToAction,
    swipeToAction,
    SWIPE_THRESHOLD_PX,
} from '../flightInput';

describe('isSelectDropdownOpen', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('is false with nothing open', () => {
        document.body.innerHTML = '<button aria-expanded="false" id="t">x</button>';
        document.getElementById('t')!.focus();
        expect(isSelectDropdownOpen()).toBe(false);
    });

    it('is true when focus sits on an expanded trigger', () => {
        document.body.innerHTML = '<button aria-expanded="true" id="t">x</button>';
        document.getElementById('t')!.focus();
        expect(isSelectDropdownOpen()).toBe(true);
    });

    it('is true when the portalled listbox is open and focus is inside it', () => {
        document.body.innerHTML =
            '<div id="select-root"><div role="listbox"><input id="s" /></div></div>';
        document.getElementById('s')!.focus();
        expect(isSelectDropdownOpen()).toBe(true);
    });
});

describe('keyToAction', () => {
    it.each([
        ['ArrowLeft', 'left'],
        ['a', 'left'],
        ['A', 'left'],
        ['ArrowRight', 'right'],
        ['d', 'right'],
        ['ArrowUp', 'jump'],
        ['w', 'jump'],
        [' ', 'jump'],
        ['ArrowDown', 'duck'],
        ['s', 'duck'],
    ])('%s → %s', (key, action) => {
        expect(keyToAction(key)).toBe(action);
    });
    it('ignores other keys', () => {
        expect(keyToAction('Enter')).toBeNull();
        expect(keyToAction('x')).toBeNull();
    });
});

describe('swipeToAction', () => {
    it('ignores short drags', () => {
        expect(swipeToAction(SWIPE_THRESHOLD_PX - 1, 0)).toBeNull();
    });
    it('uses the dominant axis', () => {
        expect(swipeToAction(-50, 10)).toBe('left');
        expect(swipeToAction(50, -10)).toBe('right');
        expect(swipeToAction(10, -50)).toBe('jump');
        expect(swipeToAction(-10, 50)).toBe('duck');
    });
});
