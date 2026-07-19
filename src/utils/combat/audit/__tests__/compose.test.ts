import { describe, it, expect, beforeAll } from 'vitest';
import { composeBattle, type TaggedShip } from '../compose';
import { tagShip } from '../classes';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { loadShipSkillRecords, csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';

// Real ships resolved from docs/ship-skills.csv + docs/ship-data.json via buildTraceShip —
// same corpus-loading pattern as classes.test.ts, since buildTraceShip is the only path that
// yields a full `Ship` (with baseStats) that canonicalPlacement/tagShip can consume. Names are
// collected from BOTH sources and de-duped case-insensitively (the CSV name casing is
// inconsistent — e.g. "AEGIS" vs "Aegis" — while buildTraceShip itself resolves case-
// insensitively), then filtered for the (should-be-zero, per manual audit) ships that resolve
// to null from neither source.
function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — tests need them to resolve real ship skill text/stats.'
        );
    }
}

function buildTaggedCorpus(): TaggedShip[] {
    const namesByUpper = new Map<string, string>();
    for (const r of loadShipSkillRecords()) namesByUpper.set(r.name.toUpperCase(), r.name);
    for (const [upper, data] of loadShipDataByName()) {
        if (!namesByUpper.has(upper)) namesByUpper.set(upper, data.name);
    }

    const tagged: TaggedShip[] = [];
    for (const name of namesByUpper.values()) {
        const ship = buildTraceShip(name);
        if (!ship) continue; // filtered out — no CSV record and no snapshot entry
        tagged.push({ ship, classes: tagShip(ship) });
    }
    return tagged;
}

describe('composeBattle', () => {
    let tagged: TaggedShip[];

    beforeAll(() => {
        requireReferenceData();
        tagged = buildTaggedCorpus();
    });

    it('produces an identical composition for the same seed', () => {
        const one = composeBattle(7, tagged);
        const two = composeBattle(7, tagged);
        expect(JSON.stringify(one)).toEqual(JSON.stringify(two));
    });

    it('fills 4 distinct positions per side', () => {
        const result = composeBattle(7, tagged);
        expect(result.playerTeam).toHaveLength(4);
        expect(result.enemyTeam).toHaveLength(4);
        expect(new Set(result.playerTeam.map((p) => p.position)).size).toBe(4);
        expect(new Set(result.enemyTeam.map((p) => p.position)).size).toBe(4);
    });

    it('places real ships with baseStats-derived statOverrides', () => {
        const result = composeBattle(11, tagged);
        for (const placement of [...result.playerTeam, ...result.enemyTeam]) {
            expect(placement.ship.baseStats).toBeDefined();
            expect(placement.statOverrides?.attack).toBe(placement.ship.baseStats.attack);
            expect(placement.statOverrides?.hp).toBe(placement.ship.baseStats.hp);
        }
    });

    it('produces different compositions for different seeds', () => {
        const a = composeBattle(1, tagged);
        const b = composeBattle(2, tagged);
        expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
    });

    it('throws on an empty corpus rather than silently producing an empty battle', () => {
        expect(() => composeBattle(1, [])).toThrow();
    });
});
