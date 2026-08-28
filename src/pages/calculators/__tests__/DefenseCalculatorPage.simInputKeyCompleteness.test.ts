/**
 * Task 6 final-review item 2 — the memo key's COMPLETENESS.
 *
 * `simInputKey` in `DefenseCalculatorPage.tsx` is a by-value serialization of the config fields
 * the sim call actually reads. The key is correct today, but nothing pinned it: dropping a field
 * from the array left the whole suite green, so a field added to the
 * `simulateDefenseSurvivability({...})` call and forgotten in the key would silently serve STALE
 * results — exactly what the code's own comment above `simInputKey` warns about
 * ("A field added to the type but never passed to the sim cannot silently rejoin the key" — that
 * guard covers the type, not the reverse direction: a field added to the SIM CALL and forgotten
 * in the key).
 *
 * This is a STRUCTURAL test, not a behavioural one: it statically extracts (a) every `config.X`
 * field read inside the `simulateDefenseSurvivability({...})` call, and (b) every `c.X` field
 * listed in the `simInputKey` array, and asserts (a) is a subset of (b). A behavioural test can
 * only ever probe one field at a time and most sim-read fields (e.g. `crit`, `speed`, `hacking`)
 * don't move the OUTPUT for any config this page's default seed produces without a lot of extra
 * setup — a structural check catches an omission of ANY field, immediately, with no fixture
 * tuning.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const PAGE_PATH = join(__dirname, '..', 'DefenseCalculatorPage.tsx');

/** Text from `openIndex` (which must point at an opening bracket) up to and including its
 *  matching close, tracking nesting depth so an inner `{`/`[` of the same kind doesn't end the
 *  scan early. */
function extractBalanced(text: string, openIndex: number, open: string, close: string): string {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
        if (text[i] === open) depth++;
        else if (text[i] === close) {
            depth--;
            if (depth === 0) return text.slice(openIndex, i + 1);
        }
    }
    throw new Error(`unbalanced ${open}${close} starting at ${openIndex}`);
}

/** Every distinct `<prefix>.<field>` access inside `block`, e.g. `config.hp` -> `hp`. */
function fieldsAccessedOn(block: string, prefix: string): Set<string> {
    const re = new RegExp(`\\b${prefix}\\.(\\w+)`, 'g');
    const fields = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) fields.add(m[1]);
    return fields;
}

/** The config fields the `simulateDefenseSurvivability({...})` call reads, extracted from the
 *  live source rather than re-typed by hand — a hand-typed expected list is exactly what the
 *  code's own field-list-derived-from-the-call-site design (see the `simInputKey` comment) is
 *  trying to avoid duplicating. */
function simReadFields(source: string): Set<string> {
    // The real call site, not the import statement or the prose comment above `simInputKey` that
    // quotes this same name (`` `simulateDefenseSurvivability({...})` call directly below ``) —
    // matched on the actual CALL SHAPE: the function name immediately followed by `({` at the
    // start of a line (module-level indentation only), which neither the import nor the comment
    // is.
    const callMatch = /^\s*simulateDefenseSurvivability\(\{/m.exec(source);
    if (!callMatch) throw new Error('simulateDefenseSurvivability call site not found');
    const braceStart = callMatch.index + callMatch[0].length - 1; // the '{' itself
    const callBlock = extractBalanced(source, braceStart, '{', '}');
    return fieldsAccessedOn(callBlock, 'config');
}

/** The fields listed in the `simInputKey` array, in the `configs.map((c) => [ ... ])` literal. */
function simInputKeyFields(source: string): Set<string> {
    const marker = 'configs.map((c) => [';
    const mapStart = source.indexOf(marker);
    if (mapStart === -1) throw new Error('simInputKey configs.map(...) literal not found');
    const bracketStart = mapStart + marker.length - 1; // the '[' itself
    const arrayBlock = extractBalanced(source, bracketStart, '[', ']');
    return fieldsAccessedOn(arrayBlock, 'c');
}

describe('DefenseCalculatorPage simInputKey completeness', () => {
    it('lists every config field the sim call reads', () => {
        const source = readFileSync(PAGE_PATH, 'utf8');
        const simFields = simReadFields(source);
        const keyFields = simInputKeyFields(source);

        // Sanity: both extractions must actually have found something, or this test is vacuously
        // true (an empty subset of anything passes).
        expect(simFields.size).toBeGreaterThan(5);
        expect(keyFields.size).toBeGreaterThan(5);

        const missing = [...simFields].filter((f) => !keyFields.has(f));
        expect(missing).toEqual([]);
    });

    it('the extractors are not vacuous — they see the fields known to be there today', () => {
        // Guards the two regex/bracket walkers themselves: a broken marker string would make the
        // subset assertion above pass by finding nothing on both sides.
        const source = readFileSync(PAGE_PATH, 'utf8');
        const simFields = simReadFields(source);
        const keyFields = simInputKeyFields(source);
        for (const field of ['hp', 'security', 'shipSkills', 'buffs']) {
            expect(simFields.has(field)).toBe(true);
            expect(keyFields.has(field)).toBe(true);
        }
        // `id` is deliberately in the key but never read by the sim call (it's the results-map
        // key) — the subset direction must not require the reverse.
        expect(keyFields.has('id')).toBe(true);
        expect(simFields.has('id')).toBe(false);
    });
});
