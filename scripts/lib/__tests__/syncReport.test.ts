import { describe, it, expect } from 'vitest';
import { renderReport, syncStatus } from '../syncReport';
import type { RowPatch, SyncPlan } from '../catalogueSyncPlan';

const manifest = {
    build: '33566', gameVersion: '3.22.33566', unitCount: 150,
    unitsSha256: 'a', statusEffectsSha256: 'b', localeSha256: { en: 'c' },
};
const plan = (over: Partial<SyncPlan> = {}): SyncPlan => ({
    halted: null, patches: [], inserts: [], refusedInserts: [], mappingHeld: [], metadata: [],
    idMismatches: [], missingFromCatalogue: [], matchedCount: 150, ...over,
});
const rowPatch = (over: Partial<RowPatch> = {}): RowPatch => ({
    id: 'A', name: 'A', patch: {}, applied: [], heldText: [], textHold: null, heldDrops: [], gate: null, ...over,
});
const ctx = { manifest, mode: 'write' as const, backupPath: 'docs/backups/x.json', writeFailures: [] };

describe('syncStatus', () => {
    it('ranks failed > held > attention > clean', () => {
        expect(syncStatus(plan(), [])).toBe('clean');
        expect(syncStatus(plan({ missingFromCatalogue: [{} as never] }), [])).toBe('attention');
        expect(syncStatus(plan({ patches: [rowPatch({ heldText: [{} as never], textHold: 'gate' })] }), [])).toBe('held');
        expect(syncStatus(plan({ patches: [rowPatch({ heldDrops: [{} as never] })] }), [])).toBe('held');
        expect(syncStatus(plan({ mappingHeld: [{} as never] }), [])).toBe('held');
        expect(syncStatus(plan({ halted: 'x' }), [])).toBe('failed');
        expect(syncStatus(plan(), ['A'])).toBe('failed');
    });
});

describe('renderReport', () => {
    it('shows the build, applied changes and held text with findings', () => {
        const md = renderReport(
            plan({
                patches: [
                    rowPatch({
                        id: 'CURATOR', name: 'Curator', patch: { base_stats: {} },
                        applied: [{ kind: 'stats', field: 'hp', before: 15730, after: 17797 }],
                        heldText: [{ kind: 'skill-text', column: 'active_skill_text', before: 'old', after: 'new' }],
                        textHold: 'gate',
                        gate: { pass: false, newFindings: ['active · base-damage: deals'] },
                    }),
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

    it('lists a ship held for mapping errors, with its reasons', () => {
        const md = renderReport(
            plan({
                mappingHeld: [{
                    template: { id: 'CROCUS', name: 'Crocus' } as never,
                    unit: { definitionId: 'Gelecek_2' } as never,
                    reasons: ['empty named effect "Corrosion"', 'charged skill without chargesRequired'],
                }],
            }),
            ctx
        );
        expect(md).toMatch(/### Mapping errors[^\n]*\(1\)/);
        expect(md).toContain('**Crocus** (`CROCUS`): empty named effect "Corrosion"; charged skill without chargesRequired');
    });

    it('labels text held because the catalogue dropped a field, and a held charge-cost drop', () => {
        const md = renderReport(
            plan({
                patches: [
                    rowPatch({
                        name: 'Aegis',
                        heldText: [{ kind: 'skill-text', column: 'charge_skill_text', before: 'C', after: null }],
                        textHold: 'dropped-field',
                    }),
                    rowPatch({ name: 'Bedrock', heldDrops: [{ kind: 'charge-cost', before: 4, after: null }] }),
                ],
            }),
            ctx
        );
        expect(md).toMatch(/\*\*Aegis\*\* — held: the catalogue dropped this field \(charge_skill_text\)/);
        expect(md).not.toContain('new audit findings');
        expect(md).toMatch(/### Dropped values held/);
        expect(md).toContain('**Bedrock** charge cost: 4 → ∅ — the catalogue dropped this field');
    });

    it('labels text held because text writes are off', () => {
        const md = renderReport(
            plan({
                patches: [rowPatch({
                    name: 'Aegis',
                    heldText: [{ kind: 'skill-text', column: 'active_skill_text', before: 'A', after: 'B' }],
                    textHold: 'text-writes-off',
                })],
            }),
            ctx
        );
        expect(md).toMatch(/\*\*Aegis\*\* — held: text writes disabled \(--stats-only run\)/);
        expect(md).not.toContain('new audit findings');
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

    it('still shows join diagnostics after a halt', () => {
        const md = renderReport(
            plan({
                halted: 'no catalogue unit matched a template',
                idMismatches: [{
                    unit: { name: 'Ghost', definitionId: 'new-id' } as never,
                    template: { id: 'GHOST', name: 'Ghost', definition_id: 'old-id' } as never,
                }],
                missingFromCatalogue: [{ id: 'RELIC', name: 'Relic' } as never],
            }),
            ctx
        );
        const haltedIdx = md.indexOf('HALTED');
        const mismatchIdx = md.indexOf('definition_id mismatches');
        const missingIdx = md.indexOf('In ship_templates but not in the catalogue');
        expect(haltedIdx).toBeGreaterThan(-1);
        expect(mismatchIdx).toBeGreaterThan(haltedIdx);
        expect(missingIdx).toBeGreaterThan(haltedIdx);
        expect(md).toContain('Ghost');
        expect(md).toContain('Relic');
    });
});
