/**
 * `Ability.recipientFilter` — the shared narrowing helper, axis by axis.
 *
 * The engine wiring is proven separately, end-to-end on Chimei's real kit, in
 * `chimeiRecipientFilter.integration.test.ts`. This file pins the helper's OWN rules, and in
 * particular the direction it fails in: every axis EXCLUDES a recipient whose state it cannot
 * read. That is the half a happy-path test never sees, and getting it backwards would silently
 * widen a grant instead of narrowing it — a "non-defender" filter that admits every actor whose
 * role the caller forgot to supply reaches strictly more ships than no filter was ever meant to.
 */
import { describe, it, expect } from 'vitest';
import { narrowByRecipientFilter } from '../supportRecipients';
import type { ShipTypeName } from '../../../constants/shipTypes';

const IDS = ['a', 'b', 'c'];

const roles: Record<string, ShipTypeName> = {
    a: 'ATTACKER',
    b: 'DEFENDER',
    c: 'SUPPORTER',
};
const roleOf = (id: string): ShipTypeName | undefined => roles[id];

const stealthed = new Set(['a']);
const holdsStatus = (id: string, buffName: string): boolean =>
    buffName === 'Stealth' && stealthed.has(id);

const hpFractions: Record<string, number> = { a: 0.2, b: 0.35, c: 0.9 };
const hpFractionOf = (id: string): number | undefined => hpFractions[id];

const readers = { roleOf, holdsStatus, hpFractionOf };

describe('narrowByRecipientFilter', () => {
    it('an ABSENT filter narrows nothing', () => {
        expect(narrowByRecipientFilter(IDS, undefined, readers)).toEqual(IDS);
    });

    it('an EMPTY filter object narrows nothing (a stale `{}` cannot mute a grant)', () => {
        expect(narrowByRecipientFilter(IDS, {}, readers)).toEqual(IDS);
    });

    it('hasStatus keeps only the holders', () => {
        expect(narrowByRecipientFilter(IDS, { hasStatus: 'Stealth' }, readers)).toEqual(['a']);
    });

    it('hasStatus for a status NOBODY holds keeps nobody', () => {
        expect(narrowByRecipientFilter(IDS, { hasStatus: 'Barrier' }, readers)).toEqual([]);
    });

    it('notRole drops the named role and keeps the rest', () => {
        expect(narrowByRecipientFilter(IDS, { notRole: ['DEFENDER'] }, readers)).toEqual([
            'a',
            'c',
        ]);
    });

    it('hpBelowPct is STRICTLY below', () => {
        // b sits at exactly 35% — below 40, above 35.
        expect(narrowByRecipientFilter(IDS, { hpBelowPct: 40 }, readers)).toEqual(['a', 'b']);
        expect(narrowByRecipientFilter(IDS, { hpBelowPct: 35 }, readers)).toEqual(['a']);
    });

    it('axes AND together (Chimei R2: non-defender AND below 40%)', () => {
        expect(
            narrowByRecipientFilter(IDS, { notRole: ['DEFENDER'], hpBelowPct: 40 }, readers)
        ).toEqual(['a']);
    });

    // ── The failure direction. Each axis must EXCLUDE, never admit, when its reader is missing.
    it('a missing holdsStatus reader keeps NOBODY, not everybody', () => {
        expect(
            narrowByRecipientFilter(IDS, { hasStatus: 'Stealth' }, { roleOf, hpFractionOf })
        ).toEqual([]);
    });

    it('a missing roleOf reader keeps NOBODY under notRole', () => {
        expect(
            narrowByRecipientFilter(IDS, { notRole: ['DEFENDER'] }, { holdsStatus, hpFractionOf })
        ).toEqual([]);
    });

    it('an actor with an UNKNOWN role is excluded by notRole, not admitted', () => {
        expect(
            narrowByRecipientFilter(['a', 'unknown-ship'], { notRole: ['DEFENDER'] }, readers)
        ).toEqual(['a']);
    });

    it('a missing hpFractionOf reader keeps NOBODY under hpBelowPct', () => {
        expect(narrowByRecipientFilter(IDS, { hpBelowPct: 40 }, { roleOf, holdsStatus })).toEqual(
            []
        );
    });

    it('an actor whose HP cannot be read (dead / unknown) is excluded', () => {
        expect(narrowByRecipientFilter(['a', 'corpse'], { hpBelowPct: 40 }, readers)).toEqual([
            'a',
        ]);
    });
});
