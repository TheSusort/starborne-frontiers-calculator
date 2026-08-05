/**
 * The three real-kit fingerprint scenarios. These tests pin the SHAPE of each battle (roster,
 * positions, seeded state) — the fingerprint snapshots themselves live in
 * src/utils/calculators/__tests__/realKitFingerprints.test.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    buildScenarioBattle,
    FILLER_NAMES,
    FOCUS_POSITION,
    SCENARIOS,
} from '../kitFingerprintScenarios';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import type { Ship } from '../../../../types/ship';

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — tests need them to resolve real ship skill text/stats.'
        );
    }
}

describe('buildScenarioBattle', () => {
    let focus: Ship;

    beforeAll(() => {
        requireReferenceData();
        const m = buildTraceShip('Malvex');
        if (!m) throw new Error('Malvex did not resolve from the corpus');
        focus = m;
    });

    it('exposes exactly three scenarios', () => {
        expect([...SCENARIOS]).toEqual(['plain', 'richEnemy', 'hurtAllies']);
    });

    it('puts the focus ship first on the player side at the focus position', () => {
        const battle = buildScenarioBattle(focus, 'plain');
        expect(battle.playerTeam[0].ship.name).toBe('Malvex');
        expect(battle.playerTeam[0].position).toBe(FOCUS_POSITION);
    });

    it('builds a 4v4 of distinct ships within each side (a repeat is an illegal game state)', () => {
        const battle = buildScenarioBattle(focus, 'plain');
        expect(battle.playerTeam).toHaveLength(4);
        expect(battle.enemyTeam).toHaveLength(4);
        const ids = (side: typeof battle.playerTeam) => side.map((p) => p.ship.id);
        expect(new Set(ids(battle.playerTeam)).size).toBe(4);
        expect(new Set(ids(battle.enemyTeam)).size).toBe(4);
    });

    it('uses distinct board positions across the whole battle', () => {
        const battle = buildScenarioBattle(focus, 'plain');
        const positions = [...battle.playerTeam, ...battle.enemyTeam].map((p) => p.position);
        expect(new Set(positions).size).toBe(positions.length);
    });

    it('plain seeds nothing at all (no tap — the baseline scenario)', () => {
        // plain must leave initial state untouched: it is the scenario where a wrongly-ungated
        // clause shows up, so any seeding here would mask exactly what it exists to reveal.
        expect(buildScenarioBattle(focus, 'plain').__testTapActors).toBeUndefined();
    });

    it('richEnemy seeds a positive shield pool on enemy actors only', () => {
        const battle = buildScenarioBattle(focus, 'richEnemy');
        const actors = [
            { id: 'e', side: 'enemy', shieldPool: 0, currentHp: 1000, stats: { hp: 1000 } },
            { id: 'p', side: 'player', shieldPool: 0, currentHp: 1000, stats: { hp: 1000 } },
        ];
        battle.__testTapActors?.(actors as never);
        expect(actors[0].shieldPool).toBeGreaterThan(0);
        expect(actors[1].shieldPool).toBe(0);
    });

    it('hurtAllies damages player actors and leaves enemies at full HP', () => {
        const battle = buildScenarioBattle(focus, 'hurtAllies');
        const actors = [
            { id: 'p', side: 'player', shieldPool: 0, currentHp: 1000, stats: { hp: 1000 } },
            { id: 'e', side: 'enemy', shieldPool: 0, currentHp: 1000, stats: { hp: 1000 } },
        ];
        battle.__testTapActors?.(actors as never);
        expect(actors[0].currentHp).toBeLessThan(1000);
        expect(actors[0].currentHp).toBeGreaterThan(0);
        expect(actors[1].currentHp).toBe(1000);
    });

    it('gives filler enough HP to survive, so kill timing cannot churn fingerprints', () => {
        const battle = buildScenarioBattle(focus, 'plain');
        for (const p of battle.enemyTeam) {
            expect(p.statOverrides?.hp).toBeGreaterThan(p.ship.baseStats.hp);
        }
    });

    it('names 7 filler ships, all resolvable from the corpus', () => {
        expect(FILLER_NAMES).toHaveLength(7);
        for (const name of FILLER_NAMES) expect(buildTraceShip(name)).not.toBeNull();
    });
});

describe('filler inertness guard', () => {
    // Every one of the 147 fingerprint snapshots assumes the filler ships contribute NOTHING. If a
    // data refresh gives one a passive or a charge skill, that assumption breaks and every snapshot
    // moves at once. This test makes that a single, named, explained failure instead.
    const BARE_DAMAGE = /^This Unit deals <unit-damage>\d+% damage<\/unit-damage>\.?$/;

    beforeAll(requireReferenceData);

    it.each(FILLER_NAMES.map((n) => [n] as const))(
        '%s is still inert: no passives, no charge skill, bare damage active',
        (name) => {
            const row = loadShipSkillRecords().find(
                (r) => r.name.toUpperCase() === name.toUpperCase()
            );
            expect(row, `filler ship "${name}" is no longer in the corpus`).toBeDefined();
            expect(
                row!.passives.filter((p) => p && p.trim() !== ''),
                `filler ship "${name}" gained a passive — it can no longer be inert scaffolding. ` +
                    'Swap it for another inert ship (Trydent, Umayl, Xiaodao are spare) and expect ' +
                    'the fingerprint snapshots to move.'
            ).toEqual([]);
            expect(
                row!.charge.trim(),
                `filler ship "${name}" gained a charge skill — same remedy as a new passive.`
            ).toBe('');
            expect(row!.active.trim()).toMatch(BARE_DAMAGE);
        }
    );
});
