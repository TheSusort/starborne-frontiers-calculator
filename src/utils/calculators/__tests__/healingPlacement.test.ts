import { describe, it, expect } from 'vitest';
import {
    DEFAULT_HEALER_SLOT,
    defaultHealTargetSlot,
    defaultHealingTeamSlot,
    defaultEnemySlot,
    resolveEnemySlots,
    resolveHealingPlayerPlacement,
    uncoveredAllyIds,
} from '../healingPlacement';
import { parsePattern } from '../../targetingParser';
import { resolveCells } from '../../targeting/resolvePattern';

describe('healing calculator default placement', () => {
    it('the healer, heal target, and team ships never share a default slot', () => {
        const slots = [
            DEFAULT_HEALER_SLOT,
            defaultHealTargetSlot(),
            ...[0, 1, 2, 3].map(defaultHealingTeamSlot),
        ];
        expect(new Set(slots).size).toBe(slots.length);
    });

    it('gives the heal target NO front bias (decision 2)', () => {
        // Column 4 is the FRONT. The heal target must not be seeded there just to keep taking
        // damage — the owner ruled placement is explicit.
        //
        // NOTE: called with no arguments, this only exercises the unconditional
        // `!healerPattern?.modifiers.support` neutral-fallback early return — it never reaches the
        // `covered.find((p) => !p.endsWith('4'))` front-avoidance line below. That line's actual
        // front-column *priority* is covered by 'prefers a non-front covered cell over the naive
        // first match' in the decision-9 describe block below.
        expect(defaultHealTargetSlot().endsWith('4')).toBe(false);
    });

    it('seeds distinct enemy slots', () => {
        const slots = [0, 1, 2, 3].map(defaultEnemySlot);
        expect(new Set(slots).size).toBe(slots.length);
    });

    it('resolveEnemySlots pushes a colliding enemy to a free slot', () => {
        expect(resolveEnemySlots(['M4', 'M4'])).toEqual(['M4', 'T1']);
    });

    it('resolveEnemySlots keeps non-colliding slots untouched', () => {
        expect(resolveEnemySlots(['M4', 'M3', 'B2'])).toEqual(['M4', 'M3', 'B2']);
    });

    it('returns a same-length array', () => {
        expect(resolveEnemySlots(['M4', 'M4', 'M4'])).toHaveLength(3);
    });
});

// ── Decision 9: minimal autoplace ───────────────────────────────────────────
// Seed the heal target into a cell the HEALER's own support footprint covers, so a default board
// does not silently produce zero healing. Only SUPPORT patterns filter ally recipients
// (`supportFootprintAllyIds` returns undefined otherwise), so a non-support pattern needs no
// autoplace at all.
describe('defaultHealTargetSlot — minimal autoplace (decision 9)', () => {
    it('seeds a cell the healer support footprint covers', () => {
        // Pattern-Line-Support-Range-1 @ M2 covers {M2, M3} (resolvePattern.test.ts:83-87 shows the
        // M3 anchor case; from M2 the forward cell is M3). M2 is the healer's own cell, so the heal
        // target must land on M3.
        expect(defaultHealTargetSlot('M2', parsePattern('Pattern-Line-Support-Range-1'))).toBe(
            'M3'
        );
    });

    it('never returns the healer own cell — covered branch', () => {
        const slot = defaultHealTargetSlot('M2', parsePattern('Pattern-Line-Support-Range-3'));
        expect(slot).not.toBe('M2');
    });

    // The neutral fallback (`NEUTRAL_HEAL_TARGET_SLOT` = 'M3') is reachable from THREE paths: an
    // absent/non-support pattern, an unresolvable pattern, and the covered branch's own last
    // resort. All three returned the bare constant unguarded until this fence, so a healer parked
    // on M3 (reachable via the slot dropdown) got its OWN cell handed back — the exact invariant
    // this describe block is named for. Cover all three, not just the covered branch above.
    it('never returns the healer own cell — neutral fallback, no pattern', () => {
        expect(defaultHealTargetSlot('M3', undefined)).not.toBe('M3');
    });

    it('never returns the healer own cell — neutral fallback, non-support pattern', () => {
        expect(defaultHealTargetSlot('M3', parsePattern('Pattern-Cone-Range-1'))).not.toBe('M3');
    });

    it('never returns the healer own cell — neutral fallback, tableless (unresolvable) pattern', () => {
        const pattern = parsePattern('Pattern-Line-Support-Range-2');
        // Precondition: the underlying call really does throw, or this test guards nothing.
        expect(() => resolveCells(pattern, 'M3')).toThrow();
        expect(defaultHealTargetSlot('M3', pattern)).not.toBe('M3');
    });

    it('still respects decision 2 — no front bias when an alternative exists', () => {
        // Range-3 @ M1 covers {M1, M2, M3, M4}. M4 is the FRONT column and must not be preferred
        // while M2/M3 are available.
        const slot = defaultHealTargetSlot('M1', parsePattern('Pattern-Line-Support-Range-3'));
        expect(slot).not.toBe('M4');
        expect(['M2', 'M3']).toContain(slot);
    });

    it('falls back to the neutral default when no pattern is known (manual entry)', () => {
        expect(defaultHealTargetSlot('M2', undefined)).toBe('M3');
    });

    it('falls back to the neutral default for a NON-support pattern', () => {
        // A non-support pattern never filters ally recipients, so coverage is irrelevant.
        expect(defaultHealTargetSlot('M2', parsePattern('Pattern-Cone-Range-1'))).toBe('M3');
    });

    it('falls back gracefully when the footprint covers only the healer own cell', () => {
        // Line-Support-Range-1 @ M4: the forward cell clips off-board, leaving {M4} — the healer's
        // own cell. No covered cell is available for the heal target, so take the neutral default
        // rather than returning M4 (two actors cannot share a cell).
        expect(defaultHealTargetSlot('M4', parsePattern('Pattern-Line-Support-Range-1'))).toBe(
            'M3'
        );
    });

    it('falls back to the neutral default instead of THROWING on a tableless pattern', () => {
        // `Pattern-Line-Support-Range-2` parses cleanly to signature `line|2|support`, which has NO
        // offset table, so `resolveCells` throws (resolvePattern.ts:40) — and this helper is on
        // `simulateHealing`'s hot path, so an unguarded throw becomes a React render crash once the
        // UI threads real ship targeting. No ship in `docs/ship-targeting.csv` currently uses it, so
        // this is a tripwire for a future offset-table gap, not a live bug.
        const pattern = parsePattern('Pattern-Line-Support-Range-2');
        // Precondition: the underlying call really does throw, or this test guards nothing.
        expect(() => resolveCells(pattern, 'M2')).toThrow();
        expect(defaultHealTargetSlot('M2', pattern)).toBe('M3');
    });

    it('prefers a non-front covered cell over the naive first match', () => {
        // Every other case in this file uses a forward-LINE pattern, where traversal order always
        // places the column-4 cell last in `covered` — so "prefer non-front" and "take the first
        // covered cell" coincide and neither this describe block nor the top-level no-front-bias
        // test can distinguish `covered.find((p) => !p.endsWith('4'))` from a naive `covered[0]`.
        // Pickaxe breaks that coincidence: its traversal visits the front cell FIRST.
        const pattern = parsePattern('Pattern-Support-Double-Pickaxe-Range-0');
        const covered = resolveCells(pattern, 'M3')
            .map((c) => c.position)
            .filter((p) => p !== 'M3');

        // Precondition: the naive-first choice really is a front-column cell. This is what makes
        // the test load-bearing — it guarantees the assertion below actually exercises
        // front-avoidance rather than agreeing with it by coincidence. If a future change to the
        // pickaxe offset table makes this false, this assertion is the tripwire: it will fail
        // first and say so, instead of the test silently stopping protecting anything.
        expect(covered[0].endsWith('4')).toBe(true);

        expect(defaultHealTargetSlot('M3', pattern)).toBe('M2');
    });
});

// ── resolveHealingPlayerPlacement: explicit beats default, both directions ──
// The shared resolver `simulateHealing` and the page's placement warning both call. Losing a
// collision silently MOVES a ship, which can change which ship is front-most and therefore who the
// enemy shoots — so which placement wins is behaviour, not cosmetics.
describe('resolveHealingPlayerPlacement', () => {
    // Cone-Support-Range-1 @ M2 covers {M2,T2,M3,B2}; the heal target's coverage-aware default is
    // therefore T2 — which is ALSO defaultHealingTeamSlot(1). That overlap is what makes these
    // collisions reachable at all.
    const cone = parsePattern('Pattern-Cone-Support-Range-1');
    const place = (allies: ReadonlyArray<{ id: string; position?: 'T2' | 'M1' }>) =>
        resolveHealingPlayerPlacement({
            healerSlot: 'M2',
            healerPattern: cone,
            healTargetId: 'tank',
            allies,
        });

    it('the coverage-aware default really is the contested cell (precondition)', () => {
        expect(defaultHealTargetSlot('M2', cone)).toBe('T2');
        expect(defaultHealingTeamSlot(1)).toBe('T2');
    });

    it("an EXPLICIT ally keeps its cell against the heal target's DEFAULT", () => {
        // Before this fence: the ally was evicted to T1 to make room for a default pick.
        const { allySlots } = place([{ id: 'a1', position: 'T2' }, { id: 'tank' }]);
        expect(allySlots[0]).toBe('T2');
        expect(allySlots[1]).not.toBe('T2');
    });

    it("the heal target's DEFAULT still outranks a generic ally's DEFAULT", () => {
        // The crowded-board guard: both cells are defaults, so the coverage-aware one must win or
        // the heal target is evicted to a cell chosen with no knowledge of coverage.
        const { allySlots } = place([{ id: 'a0' }, { id: 'a1' }, { id: 'tank' }]);
        expect(allySlots[2]).toBe('T2');
        expect(allySlots[1]).not.toBe('T2');
    });

    it("an EXPLICIT heal target keeps its cell against a generic ally's DEFAULT", () => {
        // The other direction: the heal target is appended LAST, so without nominating explicit
        // placements the earlier ally's default would win on index order alone.
        const { allySlots } = place([{ id: 'a0' }, { id: 'a1' }, { id: 'tank', position: 'T2' }]);
        expect(allySlots[2]).toBe('T2');
        expect(allySlots[1]).not.toBe('T2');
    });

    it('leaves the healer cell untouched and returns one cell per ally', () => {
        const { healerSlot, allySlots } = place([{ id: 'a0' }, { id: 'tank' }]);
        expect(healerSlot).toBe('M2');
        expect(allySlots).toHaveLength(2);
        expect(new Set([healerSlot, ...allySlots]).size).toBe(3);
    });
});

// ── Decision 8: the uncovered-placement warning ─────────────────────────────
// An ally on a cell no supporter's footprint covers receives EXACTLY ZERO healing —
// `resolveSupportRecipients` filters recipients by the caster's footprint and never expands it.
// That zero is owner-ruled game-faithful and is never softened; making it VISIBLE is the only
// permitted mitigation, and this helper is what the UI warning reads.
describe('uncoveredAllyIds (decision 8)', () => {
    const line1 = parsePattern('Pattern-Line-Support-Range-1'); // @M2 covers {M2, M3}

    // Preconditions for every expectation below, verified against `resolveCells` itself rather
    // than trusted from a comment — if an offset table ever moves, THIS fails first and says so
    // instead of the assertions silently drifting into agreeing by coincidence.
    it('footprint preconditions hold', () => {
        expect(resolveCells(line1, 'M2').map((c) => c.position)).toEqual(['M2', 'M3']);
        // @M4 the forward cell clips off-board → the CASTER-ONLY footprint.
        expect(resolveCells(line1, 'M4').map((c) => c.position)).toEqual(['M4']);
        expect(resolveCells(line1, 'B1').map((c) => c.position)).toEqual(['B1', 'B2']);
    });

    it('flags an ally off every supporter footprint', () => {
        expect(
            uncoveredAllyIds([
                { id: 'healer', position: 'M2', pattern: line1 },
                { id: 'covered', position: 'M3' },
                { id: 'stranded', position: 'B1' },
            ])
        ).toEqual(['stranded']);
    });

    it('flags the ally when the caster-only footprint covers nobody else', () => {
        // Line-Support-Range-1 @ M4 clips forward off-board → covers only {M4}. The caster itself
        // still stands on a covered cell (its own), so it is NOT flagged — the stranded ally is.
        const ids = uncoveredAllyIds([
            { id: 'healer', position: 'M4', pattern: line1 },
            { id: 'stranded', position: 'M1' },
        ]);
        expect(ids).toEqual(['stranded']);
    });

    it('unions coverage across MULTIPLE supporters', () => {
        // A second supporter at B1 covers B2, rescuing an ally the healer cannot reach.
        expect(
            uncoveredAllyIds([
                { id: 'healer', position: 'M2', pattern: line1 },
                { id: 'support2', position: 'B1', pattern: line1 },
                { id: 'rescued', position: 'B2' },
            ])
        ).toEqual([]);
    });

    it('returns EMPTY when no ship has a support pattern (damage-only team)', () => {
        expect(
            uncoveredAllyIds([
                { id: 'a', position: 'M2' },
                { id: 'b', position: 'B1' },
            ])
        ).toEqual([]);
    });

    it('treats a NON-support pattern as contributing no coverage', () => {
        expect(
            uncoveredAllyIds([
                { id: 'a', position: 'M2', pattern: parsePattern('Pattern-Cone-Range-1') },
                { id: 'b', position: 'B1' },
            ])
        ).toEqual([]);
    });

    it('does not THROW on a tableless support pattern — it contributes no coverage', () => {
        // Same guard as `defaultHealTargetSlot`: `line|2|support` parses but has no offset table,
        // and this helper runs on every render of the healing page.
        const tableless = parsePattern('Pattern-Line-Support-Range-2');
        // Precondition: the underlying call really does throw, or this test guards nothing.
        expect(() => resolveCells(tableless, 'M2')).toThrow();
        // The only supporter contributes nothing, so every ally — including the caster — sits
        // outside the (empty) covered set.
        expect(
            uncoveredAllyIds([
                { id: 'healer', position: 'M2', pattern: tableless },
                { id: 'ally', position: 'M3' },
            ])
        ).toEqual(['healer', 'ally']);
    });
});
