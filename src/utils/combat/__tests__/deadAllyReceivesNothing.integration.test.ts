/**
 * A destroyed ally receives nothing from an ally-wide grant, on the cast path or the reactive path.
 *
 * Board: Ravager kills LUXX on its round-1 turn. Her allies then keep granting to "all allies":
 *  - Panon (active, cast): "grants all allies Terran Guard II for 2 turns";
 *  - Tithonus (active, cast): "repairs all allies 7% of the damage dealt";
 *  - Liberator (charged, cast): "grants Legion Discipline III to all allies";
 *  - Heliodor (passive, reactive): "When directly damaged … reduces the duration of all active
 *    debuffs on all allies by 1 turn and repairs all allies 8% of this Unit's max HP";
 *  - Liberator (passive, reactive): "When an enemy is destroyed, all allies add 1 charge to their
 *    charged skills" (he kills Mangler in round 2).
 * None of these patterns is a support footprint, so each reaches the caster's whole side. Real kits
 * from docs/ship-skills.csv, both mounts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { corpseBattle, type CorpseRow, type CorpseRun } from './__fixtures__/corpseBoard';

beforeAll(() => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the reference data into this worktree'
        );
    }
});

const HUGE = 1_000_000_000;

const run = (mirror: boolean): CorpseRun =>
    corpseBattle(
        [
            { name: 'LUXX', position: 'M4', hp: 3000, attack: 0, speed: 50 },
            { name: 'Heliodor', position: 'M3', hp: HUGE, attack: 0, speed: 1 },
            { name: 'Panon', position: 'T3', hp: HUGE, attack: 1000, speed: 40 },
            { name: 'Tithonus', position: 'B3', hp: HUGE, attack: 1000, speed: 30 },
            { name: 'Liberator', position: 'B4', hp: HUGE, attack: 30_000, speed: 20 },
        ],
        [
            { name: 'Ravager', position: 'M4', hp: HUGE, attack: 50_000, speed: 100 },
            { name: 'Mangler', position: 'T4', hp: 60_000, attack: 0, speed: 10 },
        ],
        { mirror, rounds: 4 }
    );

/** Grant rows reaching `id`, labelled `granter:kind[:note]`. A charge grant is a
 *  `charge-changed` row whose actor is the recipient. */
const grantsTo = (r: CorpseRun, rows: CorpseRow[], id: string): string[] => {
    const nameOf = new Map(r.result.roster.map((x) => [x.actorId, x.name]));
    const out = new Set<string>();
    for (const { entry: e } of rows) {
        if (e.kind === 'charge-changed' && e.actorId === id && e.note?.includes('manip'))
            out.add('charge');
        if (!['buff', 'heal', 'shield', 'cleanse'].includes(e.kind) || e.actorId === id) continue;
        if (!e.targets.some((t) => t.targetId === id)) continue;
        const note = e.kind === 'buff' ? `:${e.note}` : '';
        out.add(`${nameOf.get(e.actorId)}:${e.kind}${note}`);
    }
    return [...out].sort();
};

const EVERY_GRANT = [
    'Heliodor:cleanse',
    'Heliodor:heal',
    'Liberator:buff:Legion Discipline III',
    'Panon:buff:Terran Guard II',
    'Tithonus:heal',
    'charge',
];

describe.each([false, true])('a dead ally receives no ally-wide grant (mirror=%s)', (mirror) => {
    it('after LUXX dies, none of her allies’ grants reach her', () => {
        const r = run(mirror);
        expect(r.deathRound('Luxx')).toBe(1);
        expect(grantsTo(r, r.afterDeathOf('Luxx'), r.idOf('Luxx'))).toEqual([]);
    });

    it('a living ally on the same board receives every one of those grants', () => {
        const r = run(mirror);
        expect(r.deathRound('Panon')).toBeUndefined();
        // Panon receives every grant but his own Terran Guard; Heliodor receives his.
        const toPanon = grantsTo(r, r.afterDeathOf('Luxx'), r.idOf('Panon'));
        const toHeliodor = grantsTo(r, r.afterDeathOf('Luxx'), r.idOf('Heliodor'));
        expect([...new Set([...toPanon, ...toHeliodor])].sort()).toEqual(EVERY_GRANT);
    });
});
