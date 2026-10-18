import { describe, it, expect } from 'vitest';
import { keyToAction, swipeToAction, SWIPE_THRESHOLD_PX } from '../flightInput';

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
