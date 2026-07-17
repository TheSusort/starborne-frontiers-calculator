import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    shipDataAvailable,
    loadShipDataRecords,
    loadShipDataByName,
} from '../shipDataSnapshot';

// Inline fixture — deliberately NOT the real gitignored docs/ship-data.json (absent in CI).
const FIXTURE: unknown[] = [
    {
        name: 'Judge',
        rarity: 'legendary',
        faction: 'MPL',
        role: 'ATTACKER',
        affinity: 'thermal',
        imageKey: 'MPL_1',
        hp: 12345,
        attack: 6789,
        defense: 2222,
        hacking: 100,
        security: 50,
        critRate: 25,
        critDamage: 75,
        speed: 90,
        shield: 0,
        shieldPenetration: 0,
        defensePenetration: 0,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    },
];

describe('shipDataSnapshot', () => {
    let tmpDir: string | null = null;

    afterEach(() => {
        if (tmpDir) {
            rmSync(tmpDir, { recursive: true, force: true });
            tmpDir = null;
        }
    });

    it('reports unavailable and returns [] / empty map when the snapshot file is absent', () => {
        const missingPath = join(tmpdir(), 'sf-delete-ships-does-not-exist', 'ship-data.json');
        expect(shipDataAvailable(missingPath)).toBe(false);
        expect(loadShipDataRecords(missingPath)).toEqual([]);
        expect(loadShipDataByName(missingPath).size).toBe(0);
    });

    it('parses fields correctly from a fixture snapshot', () => {
        tmpDir = mkdtempSync(join(tmpdir(), 'sf-delete-ships-'));
        const path = join(tmpDir, 'ship-data.json');
        writeFileSync(path, JSON.stringify(FIXTURE));

        expect(shipDataAvailable(path)).toBe(true);

        const records = loadShipDataRecords(path);
        expect(records).toHaveLength(1);
        expect(records[0].name).toBe('Judge');
        expect(records[0].hp).toBe(12345);
        expect(records[0].attack).toBe(6789);
        expect(records[0].defense).toBe(2222);
        expect(records[0].activeTarget).toBe('front');

        const byName = loadShipDataByName(path);
        expect(byName.get('JUDGE')?.hp).toBe(12345);
        expect(byName.has('judge')).toBe(false); // keyed uppercased, not verbatim
    });

    it('returns [] for a malformed (non-array) snapshot rather than throwing', () => {
        tmpDir = mkdtempSync(join(tmpdir(), 'sf-delete-ships-'));
        const path = join(tmpDir, 'ship-data.json');
        writeFileSync(path, JSON.stringify({ not: 'an array' }));

        expect(loadShipDataRecords(path)).toEqual([]);
    });
});
