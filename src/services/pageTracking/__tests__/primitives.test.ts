import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActiveTimer, MAX_ACTIVE_MS } from '../activeTimer';
import { addClick, navTrackId, trackIdFromTarget, MAX_CLICK_KEYS } from '../clicks';
import { errorFingerprint, isIgnoredError, topFrame } from '../errorFingerprint';
import {
    deviceForWidth,
    loadIdentity,
    randomId,
    readTrackingOptOut,
    referrerHost,
    shouldTrack,
    writeTrackingOptOut,
} from '../environment';

describe('ActiveTimer', () => {
    it('counts only visible time', () => {
        const t = new ActiveTimer(0, true);
        t.setVisible(false, 1000);
        t.setVisible(true, 5000);
        expect(t.total(6000)).toBe(2000);
    });

    it('starts paused when created hidden', () => {
        const t = new ActiveTimer(0, false);
        expect(t.total(10_000)).toBe(0);
        t.setVisible(true, 10_000);
        expect(t.total(10_500)).toBe(500);
    });

    it('ignores repeated visibility states', () => {
        const t = new ActiveTimer(0, true);
        t.setVisible(true, 500);
        expect(t.total(1000)).toBe(1000);
    });

    it('caps a visit at MAX_ACTIVE_MS', () => {
        const t = new ActiveTimer(0, true);
        expect(t.total(MAX_ACTIVE_MS * 3)).toBe(MAX_ACTIVE_MS);
    });
});

describe('clicks', () => {
    it('increments and caps a count at 999', () => {
        let m = {};
        for (let i = 0; i < 1005; i++) m = addClick(m, 'autogear.run');
        expect(m).toEqual({ 'autogear.run': 999 });
    });

    it('drops invalid ids and new keys past the key cap', () => {
        expect(addClick({}, 'Not Valid!')).toEqual({});
        let m: Record<string, number> = {};
        for (let i = 0; i < MAX_CLICK_KEYS + 5; i++) m = addClick(m, `k${i}`);
        expect(Object.keys(m)).toHaveLength(MAX_CLICK_KEYS);
        expect(addClick(m, 'k0').k0).toBe(2);
    });

    it('finds the nearest data-track ancestor', () => {
        document.body.innerHTML =
            '<div data-track="outer"><button data-track="inner"><span id="leaf">x</span></button></div><p id="none">y</p>';
        expect(trackIdFromTarget(document.getElementById('leaf'))).toBe('inner');
        expect(trackIdFromTarget(document.getElementById('none'))).toBeNull();
        expect(trackIdFromTarget(null)).toBeNull();
    });

    it('builds nav ids from paths', () => {
        expect(navTrackId('/')).toBe('nav.home');
        expect(navTrackId('/ships/index')).toBe('nav.ships.index');
        expect(navTrackId('/chrono-reaver')).toBe('nav.chrono-reaver');
    });
});

describe('errorFingerprint', () => {
    const stackA =
        'TypeError: x is undefined\n    at run (https://starborneplanner.com/assets/index-DQ3x9kLm.js:12:345)\n    at other (https://starborneplanner.com/assets/vendor-Ab12Cd34.js:1:2)';
    const stackB =
        'TypeError: x is undefined\n    at run (https://starborneplanner.com/assets/index-ZZ99yy88.js:40:1)';

    it('is stable across bundle hashes and line numbers', () => {
        expect(errorFingerprint('x is undefined', stackA)).toBe(
            errorFingerprint('x is undefined', stackB)
        );
        expect(topFrame(stackA)).toBe('at run (/assets/index.js)');
    });

    it('differs for different messages', () => {
        expect(errorFingerprint('a', stackA)).not.toBe(errorFingerprint('b', stackA));
        expect(errorFingerprint('a', undefined)).toMatch(/^[0-9a-f]{8}$/);
    });

    it('ignores browser noise', () => {
        expect(isIgnoredError('Script error.')).toBe(true);
        expect(
            isIgnoredError('ResizeObserver loop completed with undelivered notifications.')
        ).toBe(true);
        expect(isIgnoredError('x is undefined')).toBe(false);
    });
});

describe('environment', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('classifies devices by viewport width', () => {
        expect(deviceForWidth(375)).toBe('mobile');
        expect(deviceForWidth(800)).toBe('tablet');
        expect(deviceForWidth(1440)).toBe('desktop');
    });

    it('reuses the visitor id and marks only the first load of a session as new', () => {
        let n = 0;
        const newId = () => `id-${++n}`;
        const first = loadIdentity(localStorage, sessionStorage, newId);
        expect(first).toEqual({ visitorId: 'id-1', sessionId: 'id-2', isNewSession: true });
        const second = loadIdentity(localStorage, sessionStorage, newId);
        expect(second).toEqual({ visitorId: 'id-1', sessionId: 'id-2', isNewSession: false });
    });

    it('falls back to fresh ids when storage is unavailable', () => {
        let n = 0;
        const id = loadIdentity(null, null, () => `id-${++n}`);
        expect(id).toEqual({ visitorId: 'id-1', sessionId: 'id-2', isNewSession: true });
    });

    it('keeps only external referrer hosts', () => {
        expect(referrerHost('https://www.reddit.com/r/x', 'starborneplanner.com')).toBe(
            'www.reddit.com'
        );
        expect(
            referrerHost('https://starborneplanner.com/gear', 'starborneplanner.com')
        ).toBeNull();
        expect(referrerHost('', 'starborneplanner.com')).toBeNull();
        expect(referrerHost('not a url', 'starborneplanner.com')).toBeNull();
    });

    it('round-trips the opt-out flag', () => {
        expect(readTrackingOptOut(localStorage)).toBe(false);
        writeTrackingOptOut(localStorage, true);
        expect(readTrackingOptOut(localStorage)).toBe(true);
        writeTrackingOptOut(localStorage, false);
        expect(readTrackingOptOut(localStorage)).toBe(false);
    });

    it('never tracks localhost or opted-out visitors', () => {
        expect(shouldTrack('starborneplanner.com', false)).toBe(true);
        expect(shouldTrack('localhost', false)).toBe(false);
        expect(shouldTrack('127.0.0.1', false)).toBe(false);
        expect(shouldTrack('starborneplanner.com', true)).toBe(false);
    });
});

describe('tracking primitive robustness', () => {
    it('fingerprints ignore base64url bundle hashes containing - and _', () => {
        const a = errorFingerprint(
            'm',
            'Error: m\n    at f (https://h/assets/index-Ab-d3_9x.js:1:2)'
        );
        const b = errorFingerprint(
            'm',
            'Error: m\n    at f (https://h/assets/index-QQQQQQQQ.js:5:6)'
        );
        expect(a).toBe(b);
        expect(topFrame('at f (https://h/assets/vendor-react-Ab12Cd34.js:1:2)')).toBe(
            'at f (/assets/vendor-react.js)'
        );
    });

    it('topFrame skips a header line that contains "at"', () => {
        const stack = 'Error: failed at position 5\n    at g (https://h/a-AAAAAAAA.js:1:1)';
        expect(topFrame(stack)).toBe('at g (/a.js)');
    });

    it('topFrame reads Firefox frames and returns empty without frames', () => {
        expect(topFrame('g@https://h/assets/index-DQ3x9kLm.js:1:2')).toBe('g@/assets/index.js');
        expect(topFrame('Error: nothing to see')).toBe('');
    });

    it('addClick counts inherited key names from zero', () => {
        expect(addClick({}, 'constructor')).toEqual({ constructor: 1 });
    });

    it('ActiveTimer total is never negative', () => {
        expect(new ActiveTimer(1000, true).total(500)).toBe(0);
    });
});

describe('randomId', () => {
    it('builds a v4 UUID from getRandomValues when randomUUID is missing', () => {
        const original = globalThis.crypto;
        vi.stubGlobal('crypto', {
            getRandomValues: (a: Uint8Array) => original.getRandomValues(a),
        });
        try {
            expect(randomId()).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
            );
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
