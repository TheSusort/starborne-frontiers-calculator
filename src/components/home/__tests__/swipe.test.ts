import { describe, expect, it } from 'vitest';
import { swipeDirection } from '../swipe';

describe('swipeDirection', () => {
    it('swiping left goes to the next slide', () => {
        expect(swipeDirection(-80, 5)).toBe('next');
    });

    it('swiping right goes to the previous slide', () => {
        expect(swipeDirection(80, -5)).toBe('prev');
    });

    it('ignores travel below the threshold', () => {
        expect(swipeDirection(-39, 0)).toBeNull();
        expect(swipeDirection(39, 0)).toBeNull();
    });

    it('accepts travel exactly at the threshold', () => {
        expect(swipeDirection(-40, 0)).toBe('next');
    });

    it('ignores mostly-vertical drags even past the threshold', () => {
        expect(swipeDirection(-60, 120)).toBeNull();
        expect(swipeDirection(60, -120)).toBeNull();
    });

    it('honours a custom threshold', () => {
        expect(swipeDirection(-20, 0, 10)).toBe('next');
    });
});
