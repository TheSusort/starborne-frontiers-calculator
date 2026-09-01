/**
 * #438: `resolveBuffClause` resolves the sentence that owns the REQUESTED occurrence.
 *
 * It used to be a plain first-match, so a second SENTENCE mentioning the same name was
 * unreachable: every occurrence resolved from sentence one and `findNthOccurrencePos` degraded to
 * its LAST match there rather than failing, so a second grant silently inherited the first
 * clause's receiver — "grants X to itself. grants X to all allies." emitted both as `self`.
 * Everything scoped through the resolver inherited that: scopes on both sides, conditions, faction
 * scope, recipient filter, and the trigger detectors.
 *
 * This file holds two things: the regression suite for the fix, and the standing guard that was
 * landed first (when the fix was still deferred) and is kept because it still earns its place.
 *
 * THE GUARD is a differential, not a homogeneity census. Asserting that a repeated name's parsed
 * targets AGREE would have asserted the bug — first-match collapse IS agreement. Instead each row
 * is parsed twice, whole and one sentence at a time, and the two must match. Feeding a single
 * sentence in leaves the resolver nothing else to pick, so the per-sentence walk is the answer a
 * correctly-scoped resolver owes. Post-fix the two agree by construction, which makes this a
 * regression test on the resolver AND a tripwire on its occurrence BASIS: the caller counts
 * `<unit-skill>` tags while the resolver counts word-boundary matches over stripped text, and the
 * ordinal mapping is only sound while those two countings agree (asserted separately below).
 *
 * WHAT IT COVERS. The differential reads what `parseSkillEffects` emits — name, target — which is
 * the ally and enemy scope axes. The other consumers run through `buildShipAbilities` and are
 * covered by `buffClauseOccurrencePlumbing.test.ts`.
 *
 * READING A RED. Confirm which shape arrived before acting. Besides a genuine resolver or basis
 * regression, the differential is conservative: a grant verb in sentence one governing a tag in
 * sentence TWO would make the per-sentence walk under-emit, because it loses the backward verb
 * scan. That is a false positive of this instrument, not a defect — the whole-row parse is right
 * there to compare against.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    parseSkillEffects,
    splitSentences,
    maskAbbrev,
    findBuffNamePos,
    ABBR_MARK,
    type SkillEffect,
    type SkillSource,
} from '../skillTextParser';
import {
    csvAvailable,
    loadShipSkillRecords,
    type ShipSkillRecord,
} from '../../../scripts/lib/shipSkillCsv';

function requireReferenceData(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                'this census walks every ship in it.'
        );
    }
}

/**
 * The row's sentences, split exactly where `resolveBuffClause` splits: `<br>` normalised to a
 * sentence boundary and "Inc."/"Out." abbreviation periods masked across the split. Unlike
 * `resolveBuffClause` the `<unit-skill>` tags are KEPT, since `parseSkillEffects` reads them.
 */
function sentencesOf(rowText: string): string[] {
    return splitSentences(maskAbbrev(rowText.replace(/<br\s*\/?>/gi, '. '))).map((s) =>
        s.split(ABBR_MARK).join(' ')
    );
}

const fingerprint = (effects: SkillEffect[]): string[] =>
    effects.map((e) => `${e.buffName}:${e.target}`);

/** Word-boundary occurrence count — the basis the resolver's ordinal mapping counts on. */
function countBoundary(haystack: string, needle: string): number {
    let n = 0;
    let rest = haystack;
    for (;;) {
        const i = findBuffNamePos(rest, needle);
        if (i === -1) return n;
        n++;
        rest = rest.slice(i + needle.length);
    }
}

const TAG_RE = /<unit-skill>(.*?)<\/unit-skill>/gi;
const stripTags = (t: string) => t.replace(/<\/?unit-(?:aid|skill|damage)>/gi, '');

const SKILL_ROWS: { src: SkillSource; get: (r: ShipSkillRecord) => string }[] = [
    { src: 'active', get: (r) => r.active },
    { src: 'charge', get: (r) => r.charge },
    { src: 'passive1', get: (r) => r.passives[0] },
    { src: 'passive2', get: (r) => r.passives[1] },
    { src: 'passive3', get: (r) => r.passives[2] },
];

interface RowWalk {
    row: string;
    whole: string[];
    perSentence: string[];
    sentenceCount: number;
    /** Distinct sentences each tagged buff name appears in, whether granted or merely mentioned. */
    repeatedNames: string[];
    /** Per name: tagged occurrences vs word-boundary occurrences over the stripped row. */
    counts: { name: string; tagged: number; boundary: number }[];
}

function walkCorpus(): RowWalk[] {
    return loadShipSkillRecords().flatMap((rec) =>
        SKILL_ROWS.filter(({ get }) => get(rec)).map(({ src, get }) => {
            const text = get(rec);
            const sentences = sentencesOf(text);
            const nameSentences = new Map<string, Set<number>>();
            sentences.forEach((sentence, i) => {
                for (const m of sentence.matchAll(TAG_RE)) {
                    if (!nameSentences.has(m[1])) nameSentences.set(m[1], new Set());
                    nameSentences.get(m[1])!.add(i);
                }
            });
            const tags = [...text.matchAll(TAG_RE)].map((m) => m[1]);
            const masked = maskAbbrev(stripTags(text)).toLowerCase();
            return {
                row: `${rec.name}/${src}`,
                whole: fingerprint(parseSkillEffects(text, src)),
                perSentence: sentences.flatMap((s) => fingerprint(parseSkillEffects(s, src))),
                sentenceCount: sentences.length,
                repeatedNames: [...nameSentences]
                    .filter(([, idxs]) => idxs.size >= 2)
                    .map(([name]) => name),
                counts: [...new Set(tags)].map((name) => ({
                    name,
                    tagged: tags.filter((t) => t === name).length,
                    boundary: countBoundary(masked, maskAbbrev(name).toLowerCase()),
                })),
            };
        })
    );
}

describe('whole-row and per-sentence parses agree across the corpus (#438)', () => {
    let walk: RowWalk[];
    beforeAll(() => {
        requireReferenceData();
        walk = walkCorpus();
    });

    // The differential compares two parses of the same text; a corpus that emitted nothing, or
    // had no multi-sentence rows, would satisfy the guard below while observing nothing at all.
    it('the walk has something to compare', () => {
        const multi = walk.filter((w) => w.sentenceCount >= 2);
        expect(multi.length).toBeGreaterThan(50); // 150 rows, 2026-09-01
        expect(multi.flatMap((w) => w.whole).length).toBeGreaterThan(50); // 142 effects
    });

    // The population that makes the guard meaningful: rows that actually exercise a non-zero
    // occurrence index. Floored well under the measured 20 so a routine ship-data refresh does not
    // fail here, but a collapse to nothing (empty CSV, changed markup) cannot pass silently.
    it('rows repeating a tagged buff name across sentences still exist', () => {
        const repeats = walk.filter((w) => w.repeatedNames.length > 0);
        expect(repeats.length).toBeGreaterThanOrEqual(10); // 20 row/name pairs, 2026-09-01
    });

    it('every row parses identically whole and sentence-by-sentence', () => {
        const diverged = walk
            .filter((w) => w.whole.join(' | ') !== w.perSentence.join(' | '))
            .map((w) => `${w.row}: whole=[${w.whole}] per-sentence=[${w.perSentence}]`);
        expect(diverged).toEqual([]);
    });

    /**
     * THE OCCURRENCE BASIS. `parseSkillEffects` counts `<unit-skill>` tags; the resolver counts
     * word-boundary matches over the tag-stripped text. The global-index-to-sentence mapping is
     * only sound while those agree, and only names tagged twice or more ever receive an index
     * above 0. Measured 2026-09-01: 33 such name/row pairs, all agreeing. (Seven pairs corpus-wide
     * disagree — untagged prose mentions like Panon's `Barrier`, plus "Stealth" inside "Stealthed"
     * for Panguan — every one of them tagged exactly once, so index 0 resolves the same either
     * way.) A ship-data refresh that adds an untagged prose mention of a name granted twice would
     * shift the ordinal and mis-resolve the clause; this reddens instead.
     */
    it('the tagged and word-boundary countings agree wherever an index above 0 is used', () => {
        const multiTagged = walk.flatMap((w) =>
            w.counts.filter((c) => c.tagged >= 2).map((c) => ({ row: w.row, ...c }))
        );
        expect(multiTagged.length).toBeGreaterThanOrEqual(20); // 33, 2026-09-01
        expect(
            multiTagged
                .filter((c) => c.tagged !== c.boundary)
                .map((c) => `${c.row}/"${c.name}": tagged=${c.tagged} boundary=${c.boundary}`)
        ).toEqual([]);
    });
});

describe('a divergent-grant pair resolves per sentence (#438)', () => {
    // The shape the guard above was written for, and the issue's worked example. Pre-#438 the
    // whole-row parse emitted BOTH grants as `self`. Mutation-checked: reverting the resolver's
    // occurrence-awareness turns every assertion in this block red.
    const DIVERGENT =
        'This Unit grants itself <unit-skill>Attack Up III</unit-skill> for 2 turns. ' +
        'This Unit grants all allies <unit-skill>Attack Up III</unit-skill> for 2 turns.';

    it('reads each sentence for its own receiver, parsed one at a time', () => {
        expect(
            sentencesOf(DIVERGENT).flatMap((s) => fingerprint(parseSkillEffects(s, 'active')))
        ).toEqual(['Attack Up III:self', 'Attack Up III:all-allies']);
    });

    it('and reaches the same answer parsing the whole row', () => {
        expect(fingerprint(parseSkillEffects(DIVERGENT, 'active'))).toEqual([
            'Attack Up III:self',
            'Attack Up III:all-allies',
        ]);
    });

    it('resolves a third sentence too, not just the second', () => {
        const three =
            'This Unit grants itself <unit-skill>Attack Up III</unit-skill> for 2 turns. ' +
            'This Unit grants all adjacent allies <unit-skill>Attack Up III</unit-skill> for 2 turns. ' +
            'This Unit grants all allies <unit-skill>Attack Up III</unit-skill> for 2 turns.';
        expect(fingerprint(parseSkillEffects(three, 'active'))).toEqual([
            'Attack Up III:self',
            'Attack Up III:adjacent-allies',
            'Attack Up III:all-allies',
        ]);
    });

    // The enemy axis has the identical bug shape and its own resolver call
    // (`detectEnemyGrantScope`), so a fix threaded through the ally side only would leave this red.
    it('applies to the enemy axis as well', () => {
        const enemy =
            'This Unit inflicts <unit-skill>Defense Down III</unit-skill> for 2 turns. ' +
            'This Unit inflicts <unit-skill>Defense Down III</unit-skill> on all enemies for 2 turns.';
        expect(fingerprint(parseSkillEffects(enemy, 'active'))).toEqual([
            'Defense Down III:enemy',
            'Defense Down III:all-enemies',
        ]);
    });

    // Ship-kit W8 Task 2's case: two occurrences inside ONE sentence, disambiguated by the
    // within-clause index. The new global-to-local mapping must not disturb it.
    it('leaves a one-sentence two-occurrence grant alone (Centurion)', () => {
        const centurion =
            'This Unit gains 4 stacks of <unit-skill>Core Charge I</unit-skill> and grants all ' +
            'adjacent allies 2 stacks of <unit-skill>Core Charge I</unit-skill>.';
        expect(fingerprint(parseSkillEffects(centurion, 'active'))).toEqual([
            'Core Charge I:self',
            'Core Charge I:adjacent-allies',
        ]);
    });
});

/**
 * Post-#438 the two parses agree on every text shape that can be produced — divergent grants,
 * three-receiver chains, the enemy axis, shared and leading durations were all checked — which is
 * the point of the fix and leaves the corpus arm with no shipped fixture that violates it. So the
 * COMPARATOR is exercised directly here instead: this proves the comparison is not blind,
 * independently of whether any parseable text can currently trip it.
 */
describe('the corpus differential can still report a mismatch (#438)', () => {
    const flags = (whole: string[], perSentence: string[]): boolean =>
        whole.join(' | ') !== perSentence.join(' | ');

    it('flags a whole/per-sentence pair that disagrees', () => {
        expect(flags(['X:self', 'X:self'], ['X:self', 'X:all-allies'])).toBe(true);
    });

    it('passes a pair that agrees', () => {
        expect(flags(['X:self', 'X:all-allies'], ['X:self', 'X:all-allies'])).toBe(false);
    });
});
