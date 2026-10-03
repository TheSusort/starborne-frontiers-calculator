/**
 * An on-cast enemy clause on a pattern skill reaches every enemy the cast strikes unless its text
 * narrows it to ONE enemy — "the primary target", "that enemy", "the targeted enemy" (owner
 * rulings, `docs/superpowers/specs/2026-10-03-aoe-fanout-design.md`). The parser carries the
 * narrowing as the `'primary-enemy'` target; plain `'enemy'` is the un-narrowed form.
 *
 * This tripwire reads the skill text with its OWN predicate — deliberately independent of the
 * parser's — and requires, for every on-cast purge / debuff / control / DoT / shield-strip /
 * buff-steal ability: object names one enemy ⇒ `'primary-enemy'`; otherwise ⇒ not. A catalogue
 * sync that introduces narrowed wording the parser misses, or a parser change that narrows a
 * fan-out clause, fails here.
 *
 * What the predicate does NOT count as narrowing:
 *  - "that enemy" whose sentence introduces an indefinite enemy first (Crocus: "If an enemy has 3
 *    or more debuffs, … inflicts Stasis … on that enemy") — the gate picks each qualifying enemy;
 *  - "the targeted enemy and all adjacent enemies" — names more than one enemy;
 *  - "the target" — not a ruled narrowing phrase: in a condition the owner reads it as each struck
 *    enemy (Gallant, Nayra), and as a recipient it is unruled and unused by any skill text;
 *  - a phrase that is not the effect's own object ("… and deals 100% damage to the primary
 *    target" does not narrow the debuff before it).
 */
import { describe, it, expect } from 'vitest';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { getSkillRowForSlot } from '../../ship/skillRows';
import { canonicaliseStatusNames } from '../../skillTextParser';
import type { Ability } from '../../../types/abilities';

const ONE_ENEMY = String.raw`(?:the primary target|that enemy|the targeted enemy)`;
const PASSIVE_VOICE_TAIL = new RegExp(
    String.raw`\b${ONE_ENEMY}\s+(?:is|are)\s+(?:inflicted|applied)\s+with\s*$`,
    'i'
);
const OBJECT_PHRASE = new RegExp(String.raw`\b(?:from|on|onto|to|of)\s+(${ONE_ENEMY})\b`, 'i');
const MORE_ENEMIES_FOLLOW = /^\s+(?:and|or)\s+(?:all\s+)?adjacent\b/i;
const INDEFINITE_ENEMY = /\b(?:an|any|each|every)\s+enemy\b/i;

/** Plain text with "Inc." / "Out." masked so they do not end a sentence. */
const plainText = (raw: string): string =>
    raw
        .replace(/<br\s*\/?>/gi, '. ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b(Inc|Out)\.\s/g, '$1~ ');

const sentences = (plain: string): string[] => plain.split(/(?<=[.;])\s+/);

/**
 * Does the clause owning the match of `handle` at `index` in `sentence` name one enemy as its
 * recipient?
 */
const narrowsAt = (sentence: string, index: number, handleLength: number): boolean => {
    const before = sentence.slice(0, index);
    if (PASSIVE_VOICE_TAIL.test(before)) return true;
    const after = sentence.slice(index + handleLength);
    const windowEnd = after.search(/[,.;]|\band\b|\bthen\b/i);
    const window = windowEnd >= 0 ? after.slice(0, windowEnd) : after;
    const m = OBJECT_PHRASE.exec(window);
    if (!m) return false;
    const rest = after.slice(m.index + m[0].length);
    if (MORE_ENEMIES_FOLLOW.test(rest)) return false;
    if (/^that enemy$/i.test(m[1]) && INDEFINITE_ENEMY.test(before)) return false;
    return true;
};

/** Narrowed / un-narrowed / unlocated verdict for every occurrence of `handle` in `rawText`. */
const verdict = (rawText: string, handle: RegExp): 'narrowed' | 'fan-out' | 'unlocated' => {
    let seen = false;
    for (const sentence of sentences(plainText(rawText))) {
        const re = new RegExp(handle.source, 'gi');
        let m: RegExpExecArray | null;
        while ((m = re.exec(sentence)) !== null) {
            seen = true;
            if (narrowsAt(sentence, m.index, m[0].length)) return 'narrowed';
        }
    }
    return seen ? 'fan-out' : 'unlocated';
};

/** A status name as a pattern over `plainText` output (same abbreviation mask). */
const escape = (s: string) =>
    s
        .replace(/\b(Inc|Out)\.\s/g, '$1~ ')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '\\s+');

const CONTROL_TAG: Record<string, string> = {
    stasis: 'Stasis',
    provoke: 'Provoke',
    'concentrate-fire': 'Concentrate Fire',
    disable: 'Disable',
    taunt: 'Taunt',
};

/** The text handle that locates an ability's own clause, plus a short label for messages. */
const handleFor = (a: Ability): { label: string; re: RegExp } | null => {
    const c = a.config;
    switch (c.type) {
        case 'debuff':
            return { label: `debuff:${c.buffName}`, re: new RegExp(escape(c.buffName)) };
        case 'control': {
            const tag = CONTROL_TAG[c.effect];
            return tag ? { label: `control:${tag}`, re: new RegExp(`\\b${escape(tag)}\\b`) } : null;
        }
        case 'dot':
            return { label: `dot:${c.dotType}`, re: new RegExp(`\\b${escape(c.dotType)}\\b`) };
        case 'purge':
            return { label: 'purge', re: /\bpurges?\b/ };
        case 'buff-steal':
            return { label: 'buff-steal', re: /\bsteals?\b/ };
        case 'shield-strip':
            return { label: 'shield-strip', re: /\bremoves?\s+\d+(?:\.\d+)?%/ };
        default:
            return null;
    }
};

const narrowedOf = (text: string, handle: RegExp) => verdict(text, handle) === 'narrowed';

describe('the narrowing predicate', () => {
    it('flags an effect whose object names one enemy', () => {
        expect(narrowedOf('This Unit purges 2 buffs from the primary target.', /purges?/)).toBe(
            true
        );
        expect(
            narrowedOf('This Unit deals 100% damage and purges 1 buff from that enemy.', /purges?/)
        ).toBe(true);
        expect(
            narrowedOf('Purges 1 buff from the targeted enemy, then deals 90%.', /purges?/)
        ).toBe(true);
        expect(
            narrowedOf(
                'This Unit deals 220% damage and inflicts Attack Down II and Out. Damage Down II for 2 turns. If this Unit has an active shield, the primary target is inflicted with Disable for 2 turns.',
                /Disable/
            )
        ).toBe(true);
        expect(
            narrowedOf('This Unit removes 40% of the primary target’s shield.', /removes?\s+\d+%/)
        ).toBe(true);
        expect(narrowedOf('Inflicts Stasis for 1 turn on that enemy.', /Stasis/)).toBe(true);
    });

    it('passes the fan-out wording', () => {
        expect(
            narrowedOf('This Unit purges 2 buffs from the enemy and deals 170% damage.', /purges?/)
        ).toBe(false);
        expect(narrowedOf('This Unit removes 40% of the enemy shield.', /removes?\s+\d+%/)).toBe(
            false
        );
        // Abbreviation periods do not split the sentence away from its verb.
        expect(
            narrowedOf(
                'This Unit deals 220% damage and inflicts Attack Down II and Out. Damage Down II for 2 turns. If this Unit has an active shield, the primary target is inflicted with Disable for 2 turns.',
                /Out~ Damage Down II/
            )
        ).toBe(false);
    });

    it('scopes the object to the effect’s own clause in a multi-verb sentence', () => {
        const tithonus =
            'This Unit steals 1 buff from the primary target, granting it to self and all adjacent allies, then purges 2 buffs from the enemy and deals 190% damage.';
        expect(narrowedOf(tithonus, /steals?/)).toBe(true);
        expect(narrowedOf(tithonus, /purges?/)).toBe(false);
        expect(
            narrowedOf(
                'This Unit inflicts Speed Down II for 1 turn and deals 100% damage to the primary target.',
                /Speed Down II/
            )
        ).toBe(false);
    });

    it('does not narrow an anaphoric, plural or "the target" reference', () => {
        expect(
            narrowedOf(
                'If an enemy has 3 or more debuffs, this Unit inflicts Stasis for 2 turns on that enemy.',
                /Stasis/
            )
        ).toBe(false);
        expect(
            narrowedOf(
                'then inflicts Inferno III for 3 turns on the targeted enemy and all adjacent enemies.',
                /Inferno/
            )
        ).toBe(false);
        // Owner ruling: Asphyxiator's charged Stasis reaches the targeted enemy only (his pattern
        // is single-target); his active's Inferno is the only adjacent reach. Either way the clause
        // stays plain `'enemy'`, which on a single-target pattern is the targeted enemy.
        expect(
            narrowedOf(
                'If the targeted enemy or adjacent enemies have 3 or more debuffs, it inflicts Stasis for 1 turn on the targeted enemy and all adjacent enemies.',
                /Stasis/
            )
        ).toBe(false);
        expect(
            narrowedOf(
                'If the target was repaired this round, inflict Stasis for 1 turn.',
                /Stasis/
            )
        ).toBe(false);
    });
});

const SCANNED_TYPES = new Set(['purge', 'debuff', 'control', 'dot', 'shield-strip', 'buff-steal']);

describe.skipIf(!csvAvailable())('on-cast enemy clauses in the corpus', () => {
    it("parses 'primary-enemy' exactly where the text names one enemy", () => {
        const narrowed: string[] = [];
        const fanOut: string[] = [];
        const mismatches: string[] = [];
        const twinMismatches: string[] = [];
        const unlocated: string[] = [];
        for (const { name } of loadShipSkillRecords()) {
            const ship = buildTraceShip(name);
            if (!ship) continue;
            for (const slot of buildShipAbilities(ship).slots) {
                // Status names as the parser reads them ("Reverse Repairs" → "Reversed Repairs").
                const text = canonicaliseStatusNames(
                    getSkillRowForSlot(ship, slot.slot)?.text ?? ''
                );
                const scoped = slot.abilities.filter(
                    (a) =>
                        SCANNED_TYPES.has(a.config.type) &&
                        a.trigger === 'on-cast' &&
                        (a.target === 'enemy' || a.target === 'primary-enemy')
                );
                for (const a of scoped) {
                    const handle = handleFor(a);
                    if (!handle) continue;
                    const v = verdict(text, handle.re);
                    const key = `${name} ${slot.slot} ${handle.label}`;
                    if (v === 'unlocated') unlocated.push(key);
                    (v === 'narrowed' ? narrowed : fanOut).push(key);
                    const expected = v === 'narrowed' ? 'primary-enemy' : 'enemy';
                    if (a.target !== expected) {
                        mismatches.push(`${key}: parsed ${a.target}, text says ${expected}`);
                    }
                }
                // A control and the named status it pairs with land on the same recipients.
                for (const ctrl of scoped) {
                    if (ctrl.config.type !== 'control') continue;
                    const tag = CONTROL_TAG[ctrl.config.effect];
                    const twin = scoped.find(
                        (a) => a.config.type === 'debuff' && a.config.buffName === tag
                    );
                    if (twin && twin.target !== ctrl.target) {
                        twinMismatches.push(
                            `${name} ${slot.slot} ${tag}: control ${ctrl.target}, debuff ${twin.target}`
                        );
                    }
                }
            }
        }
        // Non-vacuous on both sides: the narrowed corpus clauses and representative fan-out ones.
        expect(narrowed).toEqual(
            expect.arrayContaining([
                'APEX charged debuff:Disable',
                'APEX charged control:Disable',
                'Pallas charged buff-steal',
                'Tithonus charged buff-steal',
            ])
        );
        expect(fanOut).toEqual(
            expect.arrayContaining([
                'Tithonus charged purge',
                'Sefuba active purge',
                'Crocus active debuff:Stasis',
                'APEX charged debuff:Attack Down II',
                'Laika charged shield-strip',
                'Ravager active dot:inferno',
            ])
        );
        // Every scanned ability's clause was found, so no verdict defaulted to fan-out unread.
        expect(unlocated).toEqual([]);
        expect(mismatches).toEqual([]);
        expect(twinMismatches).toEqual([]);
    });

    it("never narrows a reactive clause — its 'enemy' is the triggering enemy", () => {
        const reactive: string[] = [];
        for (const { name } of loadShipSkillRecords()) {
            const ship = buildTraceShip(name);
            if (!ship) continue;
            for (const slot of buildShipAbilities(ship).slots) {
                for (const a of slot.abilities) {
                    if (a.target === 'primary-enemy' && a.trigger !== 'on-cast') {
                        reactive.push(`${name} ${slot.slot} ${a.type} (${a.trigger})`);
                    }
                }
            }
        }
        expect(reactive).toEqual([]);
    });
});
