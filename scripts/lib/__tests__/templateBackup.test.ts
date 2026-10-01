import { describe, it, expect } from 'vitest';
import { buildBackup, backupFileName, parseBackup, planRestore } from '../templateBackup';

const at = new Date('2026-10-01T05:17:00.000Z');
const r = (id: string, hp = 1) => ({ id, name: id, base_stats: { hp, speed: 1 } });

describe('backup format', () => {
    it('round-trips', () => {
        const b = buildBackup([r('A'), r('B')], at);
        expect(parseBackup(JSON.stringify(b))).toEqual(b);
        expect(b.rowCount).toBe(2);
    });

    it('names files by timestamp', () => {
        expect(backupFileName(at)).toBe('ship_templates-2026-10-01T05-17-00-000Z.json');
    });

    it('rejects a count mismatch and rows without ids', () => {
        const b = buildBackup([r('A')], at);
        expect(() => parseBackup(JSON.stringify({ ...b, rowCount: 2 }))).toThrow(/rowCount/);
        expect(() => parseBackup(JSON.stringify({ ...b, rows: [{ name: 'x' }] }))).toThrow();
    });
});

describe('planRestore', () => {
    const backup = buildBackup([r('A', 1), r('B', 1)], at);

    it('upserts only rows that differ, naming the changed columns', () => {
        const p = planRestore(backup, [r('A', 2), r('B', 1)], { pruneAdded: false });
        expect(p.upserts.map((u) => [u.id, u.changedColumns])).toEqual([['A', ['base_stats']]]);
        expect(p.unchanged).toEqual(['B']);
    });

    it('treats jsonb key order as equal', () => {
        const p = planRestore(backup, [{ id: 'A', name: 'A', base_stats: { speed: 1, hp: 1 } }, r('B')], { pruneAdded: false });
        expect(p.upserts).toEqual([]);
    });

    it('re-creates rows deleted since the backup', () => {
        const p = planRestore(backup, [r('A')], { pruneAdded: false });
        expect(p.upserts.map((u) => u.id)).toEqual(['B']);
    });

    it('reports rows added since the backup, pruning only on request', () => {
        expect(planRestore(backup, [r('A'), r('B'), r('C')], { pruneAdded: false })).toMatchObject({ added: ['C'], prune: [] });
        expect(planRestore(backup, [r('A'), r('B'), r('C')], { pruneAdded: true }).prune).toEqual(['C']);
    });

    it('limits to the named ids and reports unknown ones', () => {
        const p = planRestore(backup, [r('A', 2), r('B', 2), r('C')], { ids: ['B', 'Z'], pruneAdded: true });
        expect(p.upserts.map((u) => u.id)).toEqual(['B']);
        expect(p.unknownIds).toEqual(['Z']);
        expect(p.prune).toEqual([]);
    });
});
