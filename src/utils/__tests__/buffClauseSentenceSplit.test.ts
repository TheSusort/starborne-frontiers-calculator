/**
 * STANDING GUARD (#438): `resolveBuffClause` cannot reach a SECOND sentence.
 *
 * It selects the buff's clause with a plain first-match — `sentences.find(...)` — and
 * `occurrenceIndex` then disambiguates occurrences WITHIN that one clause, which is what it was
 * built for (Centurion's `self` + `adjacent-allies` pair inside a single sentence). A second
 * SENTENCE granting the same name is unreachable, and `findNthOccurrencePos` degrades to its LAST
 * match rather than failing, so the second grant silently inherits the FIRST clause's receiver.
 * Worked example, pinned below: "grants X to itself. grants X to all allies." emits both as
 * `self`.
 *
 * Everything scoped through `resolveBuffClause` inherits this — `detectGrantScopes`,
 * `detectGrantFactionScope`, `detectGrantConditions`, `detectGrantRecipientFilter` — so a
 * divergent-shape clause would land on several features at once.
 *
 * THE ORACLE is a differential, not a homogeneity census. Asserting that a repeated name's
 * parsed targets AGREE would assert the bug: first-match collapses every occurrence onto sentence
 * one, so agreement is the failure's own symptom. Instead this parses each row TWICE — whole, and
 * one sentence at a time — and requires the two to match. Feeding a single sentence in gives
 * `resolveBuffClause` nothing else to pick, so the per-sentence walk is what the row WOULD parse
 * to if clause selection were occurrence-aware. Measured 2026-09-01: identical on every corpus
 * row (142 effects across the 150 multi-sentence rows, zero disagreements).
 *
 * WHAT IT COVERS. The differential reads the `target` axis only, since that is all
 * `parseSkillEffects` emits — the other three consumers run through `buildShipAbilities`. That is
 * still sufficient for the whole class, because every consumer shares one precondition: the same
 * buff name must be GRANTED in two sentences. A name emitting effects from two sentences IS that
 * precondition, so this walk trips on the trigger rather than on one consumer's symptom.
 *
 * "Identical today" is a MEASUREMENT and a measurement decays. 20 row/name pairs already repeat a
 * tagged buff name across sentences (Asphyxiator/Butcher/Ravager `Overload`, Lionheart and
 * Meatshield `Protection`, Chimei/Fuying/Lodolite/Wusheng `Stealth`, …); all are harmless only
 * because the second mention carries no governing grant verb. A ship-data refresh that gives one
 * of them a verb — or adds a ship written that way — turns this red. That is the point: the
 * resolver fix is deferred, so this converts the deferral into a tripwire.
 *
 * If it fails, the choice is to make clause selection occurrence-aware (threading through all
 * four consumers) — not to relax this test.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    parseSkillEffects,
    splitSentences,
    maskAbbrev,
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
}

function walkCorpus(): RowWalk[] {
    return loadShipSkillRecords().flatMap((rec) =>
        SKILL_ROWS.filter(({ get }) => get(rec)).map(({ src, get }) => {
            const text = get(rec);
            const sentences = sentencesOf(text);
            const nameSentences = new Map<string, Set<number>>();
            sentences.forEach((sentence, i) => {
                for (const m of sentence.matchAll(/<unit-skill>(.*?)<\/unit-skill>/gi)) {
                    if (!nameSentences.has(m[1])) nameSentences.set(m[1], new Set());
                    nameSentences.get(m[1])!.add(i);
                }
            });
            return {
                row: `${rec.name}/${src}`,
                whole: fingerprint(parseSkillEffects(text, src)),
                perSentence: sentences.flatMap((s) => fingerprint(parseSkillEffects(s, src))),
                sentenceCount: sentences.length,
                repeatedNames: [...nameSentences]
                    .filter(([, idxs]) => idxs.size >= 2)
                    .map(([name]) => name),
            };
        })
    );
}

describe('resolveBuffClause first-match is safe on the corpus (#438)', () => {
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

    // The population that makes the guard meaningful: rows one grant-verb edit away from tripping
    // it. Floored well under the measured 20 so a routine ship-data refresh does not fail here,
    // but a collapse to nothing (empty CSV, changed markup) cannot pass silently.
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
});

describe('the differential detects the divergence it guards against (#438)', () => {
    // Two grants of ONE name in TWO sentences, with different receivers — the shape no corpus
    // ship has today. Without this, the guard above could pass because the comparison is blind.
    const DIVERGENT =
        'This Unit grants itself <unit-skill>Attack Up III</unit-skill> for 2 turns. ' +
        'This Unit grants all allies <unit-skill>Attack Up III</unit-skill> for 2 turns.';

    it('reads each sentence for its own receiver', () => {
        expect(
            sentencesOf(DIVERGENT).flatMap((s) => fingerprint(parseSkillEffects(s, 'active')))
        ).toEqual(['Attack Up III:self', 'Attack Up III:all-allies']);
    });

    // KNOWN WRONG, and pinned deliberately: this is #438's worked example. The second grant reads
    // sentence one's receiver, so an "all allies" grant is emitted as `self`. When clause
    // selection becomes occurrence-aware this flips to ['self', 'all-allies'] — update it then,
    // and the guard above becomes a regression test rather than a tripwire.
    it('but the whole-row parse collapses the second grant onto the first receiver', () => {
        expect(fingerprint(parseSkillEffects(DIVERGENT, 'active'))).toEqual([
            'Attack Up III:self',
            'Attack Up III:self',
        ]);
    });

    it('so the differential the corpus guard runs would flag this row', () => {
        const whole = fingerprint(parseSkillEffects(DIVERGENT, 'active')).join(' | ');
        const perSentence = sentencesOf(DIVERGENT)
            .flatMap((s) => fingerprint(parseSkillEffects(s, 'active')))
            .join(' | ');
        expect(whole).not.toEqual(perSentence);
    });
});
