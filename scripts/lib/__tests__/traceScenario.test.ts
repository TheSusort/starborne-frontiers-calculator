import { describe, it, expect } from 'vitest';
import { buildInertAllyBaseline, buildStandardScenario } from '../traceScenario';
import { canonicalPlacement } from '../../../src/utils/combat/audit/fixtures';
import type { Ship } from '../../../src/types/ship';
import type { BattlePlacement } from '../../../src/utils/calculators/battleSimulator';

const ship = (id: string, name: string, over: Partial<Ship['baseStats']> = {}): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    affinity: 'chemical',
    baseStats: {
        hp: 100_000,
        attack: 2000,
        defence: 1000,
        hacking: 90,
        security: 40,
        crit: 20,
        critDamage: 150,
        speed: 100,
        ...over,
    },
    equipment: {},
    implants: {},
    refits: [],
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

const subject = canonicalPlacement(ship('s-subject', 'Subject', { speed: 111 }), 'T1');
const allyA = canonicalPlacement(ship('s-ally-a', 'AllyA', { speed: 77, hp: 55_555 }), 'M3');
const allyB = canonicalPlacement(ship('s-ally-b', 'AllyB', { speed: 66 }), 'B2');
const playerTeam: BattlePlacement[] = [allyA, subject, allyB]; // subject deliberately NOT index 0
const SUBJECT_INDEX = 1;

const enemies: BattlePlacement[] = [
    canonicalPlacement(ship('s-e1', 'EnemyOne'), 'M2'),
    canonicalPlacement(ship('s-e2', 'EnemyTwo'), 'B3'),
];

const inertPool: Ship[] = [
    ship('inert-1', 'InertOne'),
    ship('inert-2', 'InertTwo'),
    ship('inert-3', 'InertThree'),
    ship('inert-4', 'InertFour'),
];

const build = (seed = 42, team = playerTeam, idx = SUBJECT_INDEX, pool = inertPool) =>
    buildInertAllyBaseline(team, idx, enemies, pool, seed);

describe('buildInertAllyBaseline', () => {
    it('keeps the subject at its own ARRAY INDEX, untouched', () => {
        const input = build();
        expect(input.playerTeam).toHaveLength(3);
        expect(input.playerTeam[SUBJECT_INDEX]).toBe(subject);
    });

    // The index is not cosmetic: `simulateBattle` mints the reserved focus id `'attacker'` for
    // playerTeam[0] and `p:<shipId>:<idx>` for the rest, and the rate-gate RNG is keyed by that
    // id. Moving the subject would change its actor kind AND re-draw every crit/landing roll.
    it('does not move the subject to index 0 (that would change its actor id)', () => {
        expect(build().playerTeam.indexOf(subject)).toBe(SUBJECT_INDEX);
    });

    it('replaces every OTHER slot with an inert ship at the SAME cell and stats', () => {
        const input = build();
        expect(input.playerTeam[0].position).toBe('M3');
        expect(input.playerTeam[0].statOverrides).toBe(allyA.statOverrides);
        expect(input.playerTeam[0].ship.id).not.toBe('s-ally-a');
        expect(input.playerTeam[2].position).toBe('B2');
        expect(input.playerTeam[2].statOverrides).toBe(allyB.statOverrides);
        expect(input.playerTeam[2].ship.id).not.toBe('s-ally-b');
        for (const i of [0, 2]) {
            expect(inertPool.map((s) => s.id)).toContain(input.playerTeam[i].ship.id);
        }
    });

    // Speed decides turn order and HP/defence decide the incoming-damage budget. If the fillers
    // brought their OWN stats, the baseline would differ from the composition in turn order and
    // battle length as well as in kit, which is the confound this whole design exists to remove.
    it('preserves the replaced ally’s speed and hp, so turn order and soak are unchanged', () => {
        const input = build();
        expect(input.playerTeam[0].statOverrides?.speed).toBe(77);
        expect(input.playerTeam[0].statOverrides?.hp).toBe(55_555);
        expect(input.playerTeam[2].statOverrides?.speed).toBe(66);
    });

    it('reuses the caller’s enemy roster verbatim, in order', () => {
        const input = build();
        expect(input.enemyTeam).toHaveLength(2);
        expect(input.enemyTeam[0]).toBe(enemies[0]);
        expect(input.enemyTeam[1]).toBe(enemies[1]);
    });

    it('copies the enemy array so the caller’s roster cannot be mutated through the result', () => {
        build().enemyTeam.pop();
        expect(enemies).toHaveLength(2);
    });

    it('passes `rounds` through, including undefined (engine default)', () => {
        expect(
            buildInertAllyBaseline(playerTeam, SUBJECT_INDEX, enemies, inertPool, 42, 7).rounds
        ).toBe(7);
        expect(build().rounds).toBeUndefined();
    });

    it('is deterministic in the seed — same seed, same board', () => {
        const a = build(9).playerTeam.map((p) => p.ship.id);
        const b = build(9).playerTeam.map((p) => p.ship.id);
        expect(a).toEqual(b);
    });

    // If the draw did not actually consume the seed, the determinism test above would pass
    // vacuously. This is the arm that proves the seed is wired in at all.
    it('...but different seeds really do draw different fillers', () => {
        const boards = new Set<string>();
        for (let seed = 0; seed < 30; seed++) {
            boards.add(
                build(seed)
                    .playerTeam.map((p) => p.ship.id)
                    .join('|')
            );
        }
        expect(boards.size).toBeGreaterThan(1);
    });

    it('never repeats a ship on the player side (duplicate actor ids make runCombat throw)', () => {
        for (let seed = 0; seed < 40; seed++) {
            const ids = build(seed).playerTeam.map((p) => p.ship.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    it('never draws the subject’s own ship as a filler', () => {
        const poolWithSubject = [...inertPool, subject.ship];
        for (let seed = 0; seed < 40; seed++) {
            const fillers = build(seed, playerTeam, SUBJECT_INDEX, poolWithSubject)
                .playerTeam.filter((_, i) => i !== SUBJECT_INDEX)
                .map((p) => p.ship.id);
            expect(fillers).not.toContain('s-subject');
        }
    });

    // The structural guarantee the oracle leans on: no allies means no ally interference, so a
    // one-ship player side must diff against a byte-identical battle.
    it('returns the composition unchanged when the player side is a single ship', () => {
        const input = buildInertAllyBaseline([subject], 0, enemies, inertPool, 42);
        expect(input.playerTeam).toEqual([subject]);
    });

    it('throws on an empty enemy roster rather than emitting an unrunnable battle', () => {
        expect(() => buildInertAllyBaseline(playerTeam, SUBJECT_INDEX, [], inertPool, 42)).toThrow(
            /enemyTeam is empty/
        );
    });

    it('throws on an out-of-range subject index', () => {
        expect(() => buildInertAllyBaseline(playerTeam, 3, enemies, inertPool, 42)).toThrow(
            /subjectIndex 3 is out of range/
        );
    });

    it('throws rather than repeating a ship when the inert pool is too small', () => {
        expect(() =>
            buildInertAllyBaseline(playerTeam, SUBJECT_INDEX, enemies, [inertPool[0]], 42)
        ).toThrow(/need 2 distinct inert filler/);
    });

    // Instrument validity: the point of this builder is that it is NOT the canned scenario. If
    // the oracle were reverted to `buildStandardScenario`, these are the assertions that fail —
    // the canned scenario injects its own fillers on BOTH sides and re-pins the subject to M4.
    it('shares nothing with the canned standard scenario except the subject itself', () => {
        const canned = buildStandardScenario(subject.ship);
        const cannedIds = new Set(
            [...canned.playerTeam, ...canned.enemyTeam].map((p) => p.ship.id)
        );
        expect(cannedIds.has('trace-ally-plain')).toBe(true); // the canned baseline really does add allies
        expect(cannedIds.has('trace-e-1')).toBe(true); // ...and its own enemies
        expect(canned.playerTeam[0].position).toBe('M4'); // ...and re-pins the subject

        const input = build();
        const ids = [...input.playerTeam, ...input.enemyTeam].map((p) => p.ship.id);
        expect(ids).toContain('s-subject');
        expect(ids).toContain('s-e1');
        expect(ids.some((id) => id.startsWith('trace-'))).toBe(false);
        expect(input.playerTeam[SUBJECT_INDEX].position).toBe('T1');
    });
});
