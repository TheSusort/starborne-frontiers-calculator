import { describe, it, expect } from 'vitest';
import {
    DEFAULT_ATTACKER_SLOT,
    DEFAULT_ENEMY_SLOT,
    ATTACKER_SLOT_OPTIONS,
    DEFAULT_FRONT_ENEMY_TARGET,
    DEFAULT_BASE_PATTERN,
    defaultTeamSlot,
    resolvePlayerSlots,
} from '../dpsEnemyPlacement';

describe('dpsEnemyPlacement', () => {
    it('defaults both sides to the front column (column 4)', () => {
        // Column 4 is the FRONT of the board. A back-column default would silently change
        // targeting semantics for any pattern-bearing kit.
        expect(DEFAULT_ATTACKER_SLOT).toBe('M4');
        expect(DEFAULT_ENEMY_SLOT).toBe('M4');
    });

    it('offers every one of the 12 slots as an attacker option', () => {
        expect(ATTACKER_SLOT_OPTIONS).toHaveLength(12);
        expect(ATTACKER_SLOT_OPTIONS).toContain(DEFAULT_ATTACKER_SLOT);
        expect(new Set(ATTACKER_SLOT_OPTIONS).size).toBe(12);
    });

    it('keeps team-ship defaults distinct AND off the attacker slot', () => {
        // A team ship stacked on the attacker's slot would put two actors on one cell in the
        // SAME simulation (unlike two attacker configs, which never share a run).
        const first4 = [0, 1, 2, 3].map(defaultTeamSlot);
        expect(new Set(first4).size).toBe(4);
        first4.forEach((slot) => expect(slot).not.toBe(DEFAULT_ATTACKER_SLOT));
    });

    it('targets the opposing side, which is correct for BOTH sides', () => {
        // `side: 'enemy'` is relative to the acting actor, so the same value serves the focus
        // attacker and an enemy attacker shooting back.
        expect(DEFAULT_FRONT_ENEMY_TARGET.side).toBe('enemy');
    });

    describe('resolvePlayerSlots', () => {
        it('leaves a already-unique roster untouched', () => {
            expect(resolvePlayerSlots(['M4', 'M3', 'M2'])).toEqual(['M4', 'M3', 'M2']);
        });

        it('keeps the ATTACKER slot and moves the colliding team ship', () => {
            // The attacker is index 0. Were it the one to move, the enemy would target a different
            // cell than the user chose for the ship being measured.
            const [attacker, team] = resolvePlayerSlots(['M4', 'M4']);
            expect(attacker).toBe('M4');
            expect(team).not.toBe('M4');
        });

        it('resolves several collisions onto distinct free slots', () => {
            const out = resolvePlayerSlots(['M4', 'M4', 'M4', 'M4', 'M4']);
            expect(out[0]).toBe('M4');
            expect(new Set(out).size).toBe(5);
            out.forEach((p) => expect(ATTACKER_SLOT_OPTIONS).toContain(p));
        });

        it('returns a same-length array', () => {
            expect(resolvePlayerSlots(['M4', 'M4', 'M3'])).toHaveLength(3);
        });

        // `priorityIndices` exists for the healing calculator, whose heal target has a
        // coverage-aware default cell while the generic team ships do not — and which the page
        // appends LAST, so it would otherwise lose every collision.
        it('reserves a priority index wanted slot ahead of an EARLIER generic ship', () => {
            // Index 2 (the privileged ship) wants T2 and index 1 also wants T2. Without priority
            // index 1 would win and index 2 be evicted; with it, index 1 moves instead.
            const out = resolvePlayerSlots(['M2', 'T2', 'T2'], [2]);
            expect(out[0]).toBe('M2');
            expect(out[2]).toBe('T2');
            expect(out[1]).not.toBe('T2');
            expect(new Set(out).size).toBe(3);
        });

        it('never lets a priority index displace index 0', () => {
            // The attacker/healer at index 0 still outranks everything — the enemy must keep
            // targeting the cell the user chose for it.
            const out = resolvePlayerSlots(['M4', 'M4'], [1]);
            expect(out[0]).toBe('M4');
            expect(out[1]).not.toBe('M4');
        });

        it('keeps the original ascending single-pass order when no priority is given', () => {
            // Backward-compatibility guard for the DPS calculator, which shares this function and
            // passes no second argument. Hand-computed against the ORIGINAL single-pass algorithm
            // (ascending index, each collision pushed to the first free ATTACKER_SLOT_OPTIONS cell):
            // T1 kept → T1 collides, first free is T2 → T2 wanted but now taken, first free is T3 →
            // M4 free. A comparison against another call of this same function would be vacuous, so
            // the expectation is spelled out.
            expect(resolvePlayerSlots(['T1', 'T1', 'T2', 'M4'])).toEqual(['T1', 'T2', 'T3', 'M4']);
        });
    });

    it('uses a base pattern of range 0, the only signature with an offset table', () => {
        // `patternSignature` builds "base|0|" → [ORIGIN]. "base|1|" has no table and throws.
        expect(DEFAULT_BASE_PATTERN.shape).toBe('base');
        expect(DEFAULT_BASE_PATTERN.range).toBe(0);
    });
});
