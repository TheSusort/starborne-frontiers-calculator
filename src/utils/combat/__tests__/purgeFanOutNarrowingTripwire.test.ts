/**
 * An on-cast purge aimed at `'enemy'` fans out over every enemy the cast strikes (see the purge
 * loop in `runPlayerTurn`). That is right for "purges N buffs from the enemy" on a pattern skill,
 * but wording that names ONE enemy — "from the primary target", "from that enemy", "from the
 * targeted enemy" — must stay single-victim, and the fan-out does not model that. No such on-cast
 * text exists today; this tripwire fails the moment a skill text (for example from a catalogue
 * sync) introduces one, so the narrowing is modelled instead of silently fanning out.
 */
import { describe, it, expect } from 'vitest';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { getSkillRowForSlot } from '../../ship/skillRows';

const NARROWING = /\b(primary target|that enemy|the targeted enemy|the target)\b/i;

/** The object of each "purge(s) … from <object>" clause in a skill text. */
const purgeObjects = (text: string): string[] => {
    const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const out: string[] = [];
    for (const m of plain.matchAll(
        /\bpurges?\b[^.;]*?\bfrom\s+(.+?)(?=\s+and\b|\s+then\b|[.,;]|$)/gi
    )) {
        out.push(m[1].trim());
    }
    return out;
};

const narrowedObjects = (text: string): string[] =>
    purgeObjects(text).filter((o) => NARROWING.test(o));

describe('the narrowing predicate', () => {
    it('flags a purge whose object names one enemy', () => {
        expect(narrowedObjects('This Unit purges 2 buffs from the primary target.')).toEqual([
            'the primary target',
        ]);
        expect(
            narrowedObjects('This Unit deals 100% damage and purges 1 buff from that enemy.')
        ).toEqual(['that enemy']);
        expect(narrowedObjects('Purges 1 buff from the targeted enemy, then deals 90%.')).toEqual([
            'the targeted enemy',
        ]);
    });

    it('passes the fan-out wording', () => {
        expect(
            narrowedObjects('This Unit purges 2 buffs from the enemy and deals 170% damage.')
        ).toEqual([]);
        // A steal from the primary target in the same sentence is not the purge's object.
        expect(
            narrowedObjects(
                'This Unit steals 1 buff from the primary target, then purges 2 buffs from the enemy and deals 190% damage.'
            )
        ).toEqual([]);
    });
});

describe.skipIf(!csvAvailable())('on-cast enemy purges in the corpus', () => {
    it("no on-cast 'enemy' purge's text narrows it to one enemy", () => {
        const scanned: string[] = [];
        const narrowed: string[] = [];
        for (const { name } of loadShipSkillRecords()) {
            const ship = buildTraceShip(name);
            if (!ship) continue;
            for (const slot of buildShipAbilities(ship).slots) {
                const purges = slot.abilities.filter(
                    (a) =>
                        a.config.type === 'purge' && a.trigger === 'on-cast' && a.target === 'enemy'
                );
                if (purges.length === 0) continue;
                const text = getSkillRowForSlot(ship, slot.slot)?.text ?? '';
                scanned.push(`${name} ${slot.slot}`);
                for (const o of narrowedObjects(text)) narrowed.push(`${name} ${slot.slot}: ${o}`);
            }
        }
        // Non-vacuous: the scan reached the fan-out purges this rule governs.
        expect(scanned).toEqual(expect.arrayContaining(['Sefuba active', 'Tithonus active']));
        expect(narrowed).toEqual([]);
    });
});
