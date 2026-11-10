/**
 * `cellIndex` unit tests, plus the multi-hex TRIPWIRE: every `.position` reader in the non-test
 * sources under `src/utils/combat` and `src/utils/targeting` is either routed through
 * `cellsOf`/`buildCellIndex` or classified on `ANCHOR_ONLY_READERS` with why the anchor alone is
 * right there. A new reader fails this test until someone decides whether a multi-hex unit (a
 * bounty boss, footprint M1+M2) needs its whole footprint at that site.
 *
 * Scope: `.ts` files outside `__tests__`/`__testutils__`, `*.test.ts` excluded. Comment lines
 * (starting `//`, `*` or `/*`) are not readers and are skipped.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, it, expect } from 'vitest';
import { buildCellIndex, cellsOf, hitCellOf, representativeCells } from '../cellIndex';
import type { Position } from '../../../types/encounters';

const unit = (id: string, position: Position, footprint?: Position[]) => ({
    id,
    position,
    footprint,
});

describe('cellsOf', () => {
    it('a single-hex unit occupies its anchor', () => {
        expect(cellsOf({ position: 'M3' })).toEqual(['M3']);
    });
    it('a multi-hex unit occupies its footprint', () => {
        expect(cellsOf({ position: 'M1', footprint: ['M1', 'M2'] })).toEqual(['M1', 'M2']);
    });
    it('an unplaced unit occupies nothing', () => {
        expect(cellsOf({})).toEqual([]);
    });
});

describe('buildCellIndex', () => {
    it('indexes a multi-hex unit under every cell it occupies', () => {
        const boss = unit('boss', 'M1', ['M1', 'M2']);
        const add = unit('add', 'T3');
        const index = buildCellIndex([boss, add]);
        expect(index.get('M1')).toBe(boss);
        expect(index.get('M2')).toBe(boss);
        expect(index.get('T3')).toBe(add);
        expect(index.size).toBe(3);
    });
});

describe('hitCellOf', () => {
    const boss = unit('boss', 'M1', ['M1', 'M2']);
    it('front targeting hits the front-most hex (column 4 = front)', () => {
        expect(hitCellOf(boss, 'M3', 'front')).toBe('M2');
    });
    it('back targeting hits the back-most hex', () => {
        expect(hitCellOf(boss, 'M3', 'back')).toBe('M1');
    });
    it('a caster in a row the unit does not occupy scans on to the unit’s row', () => {
        expect(hitCellOf(boss, 'T2', 'front')).toBe('M2');
    });
    it('a single-hex unit is hit at its own cell', () => {
        expect(hitCellOf(unit('s', 'B3'), 'T1', 'back')).toBe('B3');
    });
});

describe('representativeCells', () => {
    it('collapses a multi-hex unit to one cell per row — front-most, back-most for back', () => {
        const boss = unit('boss', 'M3', ['M3', 'M4']);
        const other = unit('other', 'M1');
        expect(representativeCells([boss, other], 'skip')).toEqual(['M4', 'M1']);
        expect(representativeCells([boss, other], 'back')).toEqual(['M3', 'M1']);
    });
});

// ---------------------------------------------------------------------------------------------
// Tripwire
// ---------------------------------------------------------------------------------------------

const UTILS_DIR = join(__dirname, '..', '..');
const SCANNED_DIRS = ['combat', 'targeting'].map((d) => join(UTILS_DIR, d));

/** An anchor-only `.position` reader: `file` (path under `src/utils`) and a `snippet` that
 *  appears on the reading line, with why the anchor cell alone is right there. */
interface AnchorOnlyReader {
    file: string;
    snippet: string;
    reason: string;
}

const ANCHOR_ONLY_READERS: AnchorOnlyReader[] = [
    // --- routed through the footprint helpers ---
    {
        file: 'combat/cellIndex.ts',
        snippet: 'a.footprint ?? (a.position !== undefined ? [a.position] : [])',
        reason: '`cellsOf` itself: the single-hex fallback of the footprint.',
    },
    // --- presence / mode gates: "is this actor placed at all", not "which cells" ---
    {
        file: 'combat/positionalBinding.ts',
        snippet: 'return a.position !== undefined && a.stats.hp > 0;',
        reason: 'Targetability gate: placed or not; every placed unit has an anchor.',
    },
    {
        file: 'combat/positionalBinding.ts',
        snippet: 'opposingLiving.some((a) => a.position !== undefined)',
        reason: '`isPositional` mode gate: placed or not.',
    },
    {
        file: 'combat/positionalBinding.ts',
        snippet: 'opposingLiving.filter((a) => a.position !== undefined && a.currentHp > 0)',
        reason: 'Living placed candidates; their cells are read through `buildCellIndex`.',
    },
    {
        file: 'combat/positionalBinding.ts',
        snippet: '?? actor.position!',
        reason: 'Unreachable fallback of `hitCellOf`, which only misses for an unplaced unit.',
    },
    {
        file: 'combat/positionalApply.ts',
        snippet: 'a.id === firstAnchorId && a.currentHp > 0 && a.position !== undefined',
        reason: 'Locked-anchor presence check; its cell comes from `firstAnchorCell`/`hitCellOf`.',
    },
    {
        file: 'combat/adjacency.ts',
        snippet: 'x.id !== ownerId && x.position != null',
        reason: 'Positional-mode gate; neighbours are read through `cellsOf`.',
    },
    {
        file: 'combat/adjacency.ts',
        snippet: 'if (owner.position != null && anyOtherPositioned)',
        reason: 'Positional-mode gate; neighbours are read through `cellsOf`.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'if (anchor.position === undefined || anchorCell === undefined)',
        reason: 'Passive-slot presence gate; the footprint expands from `anchorCell`.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'tgt?.position != null',
        reason: 'Positional-turn discriminator; AoE purge expands from `tgtCell`.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'victim.position !== undefined &&',
        reason: 'Bomb-splash positional gate; the splash recipients come from `adjacentAllyIds`.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'isPositional(actor.position, ',
        reason: 'Mode gate on the actor’s own state.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'resolvesPositionalVictim(a.position, tb.opposingRoster)',
        reason: 'Mode gate: is the caster placed and is any opposing unit targetable.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'resolvesPositionalVictim(actor.position, ',
        reason: 'Mode gate: is the caster placed and is any opposing unit targetable.',
    },
    // --- the CASTER's own cell: a multi-hex caster casts from its anchor ---
    {
        file: 'combat/engine.ts',
        snippet: 'a.position!,',
        reason: 'Caster row-scan origin for target selection (`selectTurnTarget`).',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'actingPosition: actor.position!',
        reason: 'Caster row-scan origin for the per-hit re-resolution.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'anchor: owner.position,',
        reason: 'Caster-cell anchor of a support footprint.',
    },
    {
        file: 'combat/playerTurn.ts',
        snippet: 'anchor: actor.position,',
        reason: 'Caster-cell anchor of a support footprint.',
    },
    // --- turn order: `positionTurnRank` breaks ties on the anchor ---
    {
        file: 'combat/state.ts',
        snippet: 'position: a.position }',
        reason: 'Turn-queue entry; ranked by `positionTurnRank` on the anchor.',
    },
    {
        file: 'combat/state.ts',
        snippet: 'positionTurnRank(x.item.position)',
        reason: 'Turn-order tiebreak on the anchor.',
    },
    {
        file: 'combat/state.ts',
        snippet: 'positionTurnRank(y.item.position)',
        reason: 'Turn-order tiebreak on the anchor.',
    },
    {
        file: 'combat/state.ts',
        snippet: 'position: actor.position,',
        reason: 'Turn-order entry; ranked by `positionTurnRank` on the anchor.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'positionTurnRank(a.actor.position)',
        reason: 'Turn-order tiebreak on the anchor.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'positionTurnRank(b.actor.position)',
        reason: 'Turn-order tiebreak on the anchor.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'positionTurnRank(v.position) < positionTurnRank(best.position)',
        reason: 'Board-position tiebreak on the anchor.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'position: entry.rt.actor.position,',
        reason: 'Turn-order entry for combat-start seeding.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'position: actor?.position,',
        reason: 'Turn-order entry for queued intents.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'position: granter?.position,',
        reason: 'Turn-order entry for start-of-round gains.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'position: holder.position,',
        reason: 'Turn-order entry for Toxic Overflow spreads.',
    },
    {
        file: 'combat/playerTurn.ts',
        snippet: '? actor.position',
        reason: 'Board-order rank of announced gains (`positionTurnRank`).',
    },
    {
        file: 'combat/playerTurn.ts',
        snippet: 'sameSideLiving?.find((a) => a.id === ownerId)?.position',
        reason: 'Board-order rank of announced gains (`positionTurnRank`).',
    },
    // --- plumbing: copies the anchor; the footprint is copied beside it ---
    {
        file: 'combat/state.ts',
        snippet: 'position: partial.position,',
        reason: '`createActor` copy; `footprint` is copied beside it.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'position: e.position,',
        reason: 'Enemy actor construction; `footprint` is copied beside it.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'position: input.position,',
        reason: 'Focus actor construction; `footprint` is copied beside it.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'position: t.position,',
        reason: 'Team actor construction; `footprint` is copied beside it.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'footprint: input.footprint }',
        reason: 'Static adjacency placement; carries the footprint.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'footprint: t.footprint }',
        reason: 'Static adjacency placement; carries the footprint.',
    },
    {
        file: 'combat/engine.ts',
        snippet: 'footprint: e.footprint }',
        reason: 'Static adjacency placement; carries the footprint.',
    },
    {
        file: 'combat/normalizeRoster.ts',
        snippet: '[input.position, ...teamActors.map((t) => t.position)]',
        reason: 'Anchor-slot placement; `footprint` rides through the spread.',
    },
    {
        file: 'combat/normalizeRoster.ts',
        snippet: 'enemyAttackers.map((e) => e.position)',
        reason: 'Anchor-slot placement; `footprint` rides through the spread.',
    },
    // --- audit / log tooling: reads a result roster keyed by the anchor ---
    {
        file: 'combat/audit/sideMirror.ts',
        snippet: 'rx.position !== ry.position',
        reason: 'Audit tooling: compares result-roster anchors.',
    },
    {
        file: 'combat/audit/sideMirror.ts',
        snippet: 'position: r.position }',
        reason: 'Audit tooling: labels a result-roster ship by its anchor.',
    },
    {
        file: 'combat/audit/ablation.ts',
        snippet: 'r.position === position',
        reason: 'Audit tooling: finds a result-roster ship by its anchor.',
    },
    {
        file: 'combat/audit/placementSymmetry.ts',
        snippet: 'r.position === cell',
        reason: 'Audit tooling: finds a result-roster ship by its anchor.',
    },
    {
        file: 'combat/audit/kitFingerprintScenarios.ts',
        snippet: 'a.position === subjectCell',
        reason: 'Audit tooling: finds the fingerprint subject by its anchor.',
    },
    {
        file: 'combat/audit/kitFingerprintScenarios.ts',
        snippet: 'occupied.has(c.position)',
        reason: 'Reads a resolved pattern CELL’s position, not an actor’s.',
    },
    {
        file: 'combat/log/formatText.ts',
        snippet: '@${r.position}',
        reason: 'Log text labels a ship by its anchor.',
    },
];

const POSITION_READ = /\.position\b/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory())
            return name === '__tests__' || name === '__testutils__' ? [] : sourceFiles(full);
        return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [full] : [];
    });

interface ReaderLine {
    file: string;
    line: number;
    text: string;
}

const readerLines = (file: string, source: string): ReaderLine[] =>
    source
        .split('\n')
        .flatMap((text, i) =>
            POSITION_READ.test(text) && !COMMENT_LINE.test(text)
                ? [{ file, line: i + 1, text }]
                : []
        );

const classify = (reader: ReaderLine, allowlist: readonly AnchorOnlyReader[]) =>
    allowlist.find((entry) => entry.file === reader.file && reader.text.includes(entry.snippet));

const allReaders = (): ReaderLine[] =>
    SCANNED_DIRS.flatMap(sourceFiles).flatMap((full) =>
        readerLines(relative(UTILS_DIR, full), readFileSync(full, 'utf8'))
    );

describe('multi-hex tripwire: every `.position` reader is classified', () => {
    it('every reader is on ANCHOR_ONLY_READERS', () => {
        const unclassified = allReaders()
            .filter((r) => classify(r, ANCHOR_ONLY_READERS) === undefined)
            .map((r) => `${r.file}:${r.line}: ${r.text.trim()}`);
        expect(unclassified).toEqual([]);
    });

    it('every ANCHOR_ONLY_READERS entry still matches a reader', () => {
        const readers = allReaders();
        const stale = ANCHOR_ONLY_READERS.filter(
            (entry) => !readers.some((r) => classify(r, [entry]) === entry)
        ).map((e) => `${e.file}: ${e.snippet}`);
        expect(stale).toEqual([]);
    });

    it('NON-VACUITY: a new reader is reported as unclassified, a comment is not', () => {
        const fake = readerLines(
            'combat/engine.ts',
            [
                '    const cell = victim.position;',
                '    // victim.position in a comment',
                '     * victim.position in a doc',
            ].join('\n')
        );
        expect(fake.map((r) => r.text.trim())).toEqual(['const cell = victim.position;']);
        expect(classify(fake[0], ANCHOR_ONLY_READERS)).toBeUndefined();
    });

    it('NON-VACUITY: the scan finds the readers it classifies', () => {
        expect(allReaders().length).toBeGreaterThan(ANCHOR_ONLY_READERS.length / 2);
    });
});
