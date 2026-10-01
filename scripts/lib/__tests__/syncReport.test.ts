import { describe, it, expect } from 'vitest';
import { renderReport, syncStatus } from '../syncReport';
import type { SyncPlan } from '../catalogueSyncPlan';

const manifest = {
    build: '33566', gameVersion: '3.22.33566', unitCount: 150,
    unitsSha256: 'a', statusEffectsSha256: 'b', localeSha256: { en: 'c' },
};
const plan = (over: Partial<SyncPlan> = {}): SyncPlan => ({
    halted: null, patches: [], inserts: [], refusedInserts: [], metadata: [],
    idMismatches: [], missingFromCatalogue: [], matchedCount: 150, ...over,
});
const ctx = { manifest, mode: 'write' as const, backupPath: 'docs/backups/x.json', writeFailures: [] };

describe('syncStatus', () => {
    it('ranks failed > held > attention > clean', () => {
        expect(syncStatus(plan(), [])).toBe('clean');
        expect(syncStatus(plan({ missingFromCatalogue: [{} as never] }), [])).toBe('attention');
        expect(
            syncStatus(plan({ patches: [{ id: 'A', name: 'A', patch: {}, applied: [], heldText: [{} as never], gate: null }] }), [])
        ).toBe('held');
        expect(syncStatus(plan({ halted: 'x' }), [])).toBe('failed');
        expect(syncStatus(plan(), ['A'])).toBe('failed');
    });
});

describe('renderReport', () => {
    it('shows the build, applied changes and held text with findings', () => {
        const md = renderReport(
            plan({
                patches: [
                    {
                        id: 'CURATOR', name: 'Curator', patch: { base_stats: {} },
                        applied: [{ kind: 'stats', field: 'hp', before: 15730, after: 17797 }],
                        heldText: [{ kind: 'skill-text', column: 'active_skill_text', before: 'old', after: 'new' }],
                        gate: { pass: false, newFindings: ['active · base-damage: deals'] },
                    },
                ],
            }),
            ctx
        );
        expect(md).toContain('3.22.33566');
        expect(md).toContain('Curator');
        expect(md).toContain('hp: 15730 → 17797');
        expect(md).toContain('active · base-damage: deals');
        expect(md).toContain('docs/backups/x.json');
    });

    it('lists the image a new ship needs', () => {
        const md = renderReport(
            plan({
                inserts: [{
                    row: { id: 'NEW' },
                    unit: { name: 'New', imageKey: 'XAOC_9', images: { avatar: 'av', bigPortrait: 'https://img/big.png' } } as never,
                    findings: [],
                }],
            }),
            ctx
        );
        expect(md).toContain('XAOC_9_BigPortrait.jpg');
        expect(md).toContain('https://img/big.png');
        expect(md).toMatch(/targeting/i);
    });

    it('leads with the halt reason', () => {
        expect(renderReport(plan({ halted: '40/150 matched ships changed stats' }), ctx)).toMatch(/HALTED[^\n]*40\/150/);
    });
});
