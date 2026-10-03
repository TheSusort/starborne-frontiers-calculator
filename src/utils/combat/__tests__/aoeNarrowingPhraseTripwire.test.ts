/**
 * Owner rule: every on-cast effect of a pattern skill reaches every enemy the cast strikes. No
 * wording narrows that — "the primary target", "that enemy", "the targeted enemy" included (e.g.
 * Tithonus on a Circle hitting A, B and C steals 1 buff from EACH of them). So the parser keeps
 * every on-cast enemy clause on its plain enemy-side target and the engine fans it.
 *
 * Wording that LOOKS narrowed is therefore a question for the owner, not for the parser. This
 * tripwire finds every on-cast purge / debuff / control / DoT / shield-strip / buff-steal clause
 * whose own recipient is one of those phrases (or "the target") and requires it to be on
 * `RULED_FAN_OUT` — clauses the owner has already ruled. A catalogue sync that introduces new such
 * wording fails here until somebody asks.
 *
 * A phrase only counts in RECIPIENT position — the effect's own object ("… from the primary
 * target", "… on that enemy") or a passive subject ("the primary target is inflicted with …").
 * The same phrase inside a condition ("If the target was repaired this round") is not a recipient.
 */
import { describe, it, expect } from 'vitest';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { isEnemyTarget } from '../../abilities/abilityTargetSide';
import { getSkillRowForSlot } from '../../ship/skillRows';
import { canonicaliseStatusNames } from '../../skillTextParser';
import type { Ability } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';

/** Ruled clauses whose recipient wording looks narrowed but reaches every struck enemy. */
const RULED_FAN_OUT: Record<string, string> = {
    // "the primary target is inflicted with Disable" lands on every struck enemy.
    'APEX charged debuff:Disable': 'owner 2026-10-03: "the primary target" does not narrow',
    'APEX charged control:Disable': 'owner 2026-10-03: the control twin of the Disable above',
    // Tithonus on a Circle hitting A, B, C steals 1 buff from each of A, B, C; Pallas likewise.
    'Pallas charged buff-steal': 'owner 2026-10-03: "from the primary target" does not narrow',
    'Tithonus charged buff-steal': 'owner 2026-10-03: steals from each struck enemy',
    // "If an enemy has 3 or more debuffs … on that enemy" = each qualifying struck enemy.
    'Crocus active debuff:Stasis': 'owner 2026-10-03: "that enemy" = each qualifying struck enemy',
    'Crocus active control:Stasis': 'owner 2026-10-03: the control twin of the Stasis above',
    // Asphyxiator is single-target by pattern; his charged Stasis reaches the targeted enemy only.
    'Asphyxiator charged debuff:Stasis': 'owner 2026-10-03: single-target pattern, targeted enemy',
    'Asphyxiator charged control:Stasis': 'owner 2026-10-03: the control twin of the Stasis above',
    // His active's Inferno is his only adjacent reach ('target-and-adjacent-enemies').
    'Asphyxiator active dot:inferno': 'owner 2026-10-03: targeted enemy plus all adjacent enemies',
};

const PHRASE = String.raw`(?:the primary target|that enemy|the targeted enemy|the target)`;
const PASSIVE_SUBJECT = new RegExp(
    String.raw`\b(${PHRASE})\s+(?:is|are)\s+(?:inflicted|applied)\s+with\s*$`,
    'i'
);
const OBJECT = new RegExp(String.raw`\b(?:from|on|onto|to|of)\s+(${PHRASE})\b`, 'i');

/** Plain text with "Inc." / "Out." masked so they do not end a sentence. */
const plainText = (raw: string): string =>
    raw
        .replace(/<br\s*\/?>/gi, '. ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b(Inc|Out)\.\s/g, '$1~ ');

/** The narrowing-looking phrase in recipient position of the clause owning `handle`, if any. */
const recipientPhrase = (rawText: string, handle: RegExp): string | null => {
    for (const sentence of plainText(rawText).split(/(?<=[.;])\s+/)) {
        const re = new RegExp(handle.source, 'gi');
        let m: RegExpExecArray | null;
        while ((m = re.exec(sentence)) !== null) {
            const passive = PASSIVE_SUBJECT.exec(sentence.slice(0, m.index));
            if (passive) return passive[1];
            const after = sentence.slice(m.index + m[0].length);
            const end = after.search(/[,.;]|\band\b|\bthen\b/i);
            const obj = OBJECT.exec(end >= 0 ? after.slice(0, end) : after);
            if (obj) return obj[1];
        }
    }
    return null;
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

/** The text handle that locates an ability's own clause, plus its label in `RULED_FAN_OUT`. */
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

interface Scan {
    /** Every on-cast enemy clause whose recipient is a narrowing-looking phrase. */
    matched: { key: string; phrase: string; target: string }[];
    /** Scanned abilities whose clause the handle could not find in the text. */
    unlocated: string[];
    scanned: string[];
}

function scanShip(name: string, ship: Ship): Scan {
    const out: Scan = { matched: [], unlocated: [], scanned: [] };
    for (const slot of buildShipAbilities(ship).slots) {
        // Status names as the parser reads them ("Reverse Repairs" → "Reversed Repairs").
        const text = canonicaliseStatusNames(getSkillRowForSlot(ship, slot.slot)?.text ?? '');
        for (const a of slot.abilities) {
            if (a.trigger !== 'on-cast' || !isEnemyTarget(a.target)) continue;
            const handle = handleFor(a);
            if (!handle) continue;
            const key = `${name} ${slot.slot} ${handle.label}`;
            out.scanned.push(key);
            if (!new RegExp(handle.re.source, 'i').test(plainText(text))) {
                out.unlocated.push(key);
                continue;
            }
            const phrase = recipientPhrase(text, handle.re);
            if (phrase) out.matched.push({ key, phrase, target: a.target });
        }
    }
    return out;
}

const unruled = (scan: Scan): string[] =>
    scan.matched
        .filter((m) => !(m.key in RULED_FAN_OUT))
        .map(
            (m) =>
                `${m.key}: recipient "${m.phrase}" (parsed '${m.target}') — ask the owner whether ` +
                `it reaches every struck enemy, then add a ruled RULED_FAN_OUT entry`
        );

describe('the recipient-phrase predicate', () => {
    it('finds the phrase as the effect’s own object or passive subject', () => {
        expect(
            recipientPhrase(
                'If this Unit has an active shield, the primary target is inflicted with Disable for 2 turns.',
                /Disable/
            )
        ).toBe('the primary target');
        expect(recipientPhrase('This Unit purges 1 buff from the target.', /purges?/)).toBe(
            'the target'
        );
        const tithonus =
            'This Unit steals 1 buff from the primary target, granting it to self and all adjacent allies, then purges 2 buffs from the enemy and deals 190% damage.';
        expect(recipientPhrase(tithonus, /steals?/)).toBe('the primary target');
        expect(recipientPhrase(tithonus, /purges?/)).toBeNull();
    });

    it('ignores the phrase in a condition or on another verb', () => {
        expect(
            recipientPhrase(
                'If the target was repaired this round, inflict Stasis for 1 turn.',
                /Stasis/
            )
        ).toBeNull();
        expect(
            recipientPhrase(
                'This Unit inflicts Speed Down II for 1 turn and deals 100% damage to the primary target.',
                /Speed Down II/
            )
        ).toBeNull();
    });
});

describe.skipIf(!csvAvailable())('narrowing-looking recipient phrases in the corpus', () => {
    const scans = loadShipSkillRecords().flatMap(({ name }) => {
        const ship = buildTraceShip(name);
        return ship ? [scanShip(name, ship)] : [];
    });
    const matched = scans.flatMap((s) => s.matched);

    it('matches only clauses the owner has ruled to reach every struck enemy', () => {
        // Every scanned clause was found in its text, so no verdict defaulted to "no phrase".
        expect(scans.flatMap((s) => s.unlocated)).toEqual([]);
        // Non-vacuous: the scan reached the fan-out clauses this rule governs.
        expect(scans.flatMap((s) => s.scanned)).toEqual(
            expect.arrayContaining(['Sefuba active purge', 'Laika charged shield-strip'])
        );
        expect(scans.flatMap(unruled)).toEqual([]);
    });

    it('keeps every ruled entry live — a stale entry is deleted, not kept', () => {
        expect(Object.keys(RULED_FAN_OUT).filter((k) => !matched.some((m) => m.key === k))).toEqual(
            []
        );
    });
});

describe('a new narrowing-looking phrase', () => {
    it('fails the tripwire with an ask-the-owner message', () => {
        const injected = {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({} as any),
            refits: [],
            activeSkillText:
                'This Unit deals <unit-damage>160% damage</unit-damage> and <unit-skill>purges 1 buff</unit-skill> from the primary target.',
            chargeSkillText: '',
        } as Ship;
        expect(unruled(scanShip('Injected', injected))).toEqual([
            'Injected active purge: recipient "the primary target" (parsed \'enemy\') — ask the owner whether it reaches every struck enemy, then add a ruled RULED_FAN_OUT entry',
        ]);
    });
});
