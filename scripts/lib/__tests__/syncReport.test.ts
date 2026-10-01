import { describe, it, expect } from 'vitest';
import { ISSUE_SUMMARY_LIMIT, renderIssueSummary, renderReport, syncStatus } from '../syncReport';
import type { PinnedSlot, RowPatch, SyncPlan } from '../catalogueSyncPlan';

const manifest = {
    build: '33566', gameVersion: '3.22.33566', unitCount: 150,
    unitsSha256: 'a', statusEffectsSha256: 'b', localeSha256: { en: 'c' },
};
const plan = (over: Partial<SyncPlan> = {}): SyncPlan => ({
    halted: null, bulkTextHold: null, patches: [], inserts: [], refusedInserts: [], mappingHeld: [], metadata: [],
    idMismatches: [], missingFromCatalogue: [], matchedCount: 150, pinned: [], ...over,
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
        expect(syncStatus(plan({ bulkTextHold: { changed: 2, matched: 3 } }), [])).toBe('held');
        expect(syncStatus(plan({ halted: 'x' }), [])).toBe('failed');
        expect(syncStatus(plan(), ['A'])).toBe('failed');
    });

    it('raises accepted structural changes to attention', () => {
        const accepted = rowPatch({ gate: { pass: true, newFindings: [], accepted: ['passive R0 · lost x'] } });
        expect(syncStatus(plan({ patches: [accepted] }), [])).toBe('attention');
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
        expect(md).not.toContain('held by the skill gate');
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
        expect(md).not.toContain('held by the skill gate');
    });

    it('explains a bulk text hold with its ratio and labels each ship', () => {
        const md = renderReport(
            plan({
                bulkTextHold: { changed: 120, matched: 150 },
                patches: [rowPatch({
                    name: 'Aegis',
                    heldText: [{ kind: 'skill-text', column: 'active_skill_text', before: 'A', after: 'B' }],
                    textHold: 'bulk-text',
                })],
            }),
            ctx
        );
        expect(md).toContain('120/150 matched ships (80%) changed skill text');
        expect(md).toContain('--allow-bulk-text');
        expect(md).toMatch(/\*\*Aegis\*\* — held: bulk-text hold/);
        expect(md).not.toContain('held by the skill gate');
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

const slot = (over: Partial<PinnedSlot>): PinnedSlot => ({
    name: 'S', column: 'active_skill_text', reason: 'r', state: 'overrides-catalogue', suppressed: null,
    ruledAgainst: 'RULED', catalogueText: 'RULED', shipHeld: false, ...over,
});
const pins: PinnedSlot[] = [
    slot({
        name: 'Tormenter', reason: 'User ruling: also buffs itself', ruledAgainst: 'CATALOGUE_TEXT', catalogueText: 'CATALOGUE_TEXT',
        suppressed: { kind: 'skill-text', column: 'active_skill_text', before: 'OURS_TEXT', after: 'CATALOGUE_TEXT' },
    }),
    slot({ name: 'Chimei', column: 'first_passive_skill_text', reason: 'User ruling: redirect', state: 'catalogue-agrees' }),
    slot({ name: 'Gone_1', column: 'charge_skill_text', reason: 'User ruling: x', state: 'no-matched-ship', catalogueText: null }),
];
const drifted = slot({
    name: 'Drifter', reason: 'User ruling: ours', state: 'catalogue-changed', ruledAgainst: 'RULED_AGAINST_TEXT',
    catalogueText: 'NEWER_CATALOGUE_TEXT',
    suppressed: { kind: 'skill-text', column: 'active_skill_text', before: 'OURS', after: 'NEWER_CATALOGUE_TEXT' },
});

describe('pinned text', () => {
    it('renders every pin under a "Pinned text" heading in the full report, with the text it kept out', () => {
        const md = renderReport(plan({ pinned: pins }), ctx);
        expect(md).toMatch(/### Pinned text \(3\)/);
        expect(md).toMatch(/\*\*Tormenter\*\* active_skill_text — User ruling: also buffs itself/);
        expect(md).toContain('CATALOGUE_TEXT');
        expect(md).toMatch(/\*\*Chimei\*\* first_passive_skill_text[^\n]*catalogue text now equals ours/);
        expect(md).toMatch(/\*\*Gone_1\*\* charge_skill_text[^\n]*no matched ship/);
    });

    it('lists pins in the issue summary without their text, and leaves the status alone', () => {
        const md = renderIssueSummary(plan({ pinned: pins }), ctx);
        expect(md).toContain('### Pinned text (3)');
        expect(md).toContain('**Tormenter** active_skill_text');
        expect(md).not.toContain('CATALOGUE_TEXT');
        expect(syncStatus(plan({ pinned: pins }), [])).toBe('clean');
    });

    it('raises attention for a pin whose catalogue text changed since the ruling', () => {
        expect(syncStatus(plan({ pinned: [...pins, drifted] }), [])).toBe('attention');
    });

    it.each([
        ['full report', renderReport],
        ['issue summary', renderIssueSummary],
    ] as const)('shows a changed pin with the ruled-against and new text in the %s', (_label, render) => {
        const md = render(plan({ pinned: [...pins, drifted] }), ctx);
        const heading = md.indexOf('### Pinned text changed since the ruling (1)');
        expect(heading).toBeGreaterThan(-1);
        expect(md.indexOf('**Drifter** active_skill_text')).toBeGreaterThan(heading);
        expect(md).toContain('RULED_AGAINST_TEXT');
        expect(md).toContain('NEWER_CATALOGUE_TEXT');
        expect(md).toContain('### Pinned text (3)');
    });

    it('labels a pin on a ship held for mapping errors as held, not as kept text', () => {
        const md = renderReport(plan({ pinned: [slot({ name: 'Crocus', shipHeld: true })] }), ctx);
        expect(md).toMatch(/\*\*Crocus\*\*[^\n]*ship held for mapping errors/);
        expect(md).not.toContain('kept our text');
    });

    it('renders no heading when nothing is pinned', () => {
        expect(renderReport(plan(), ctx)).not.toContain('Pinned text');
    });
});

describe('renderIssueSummary', () => {
    const textChange = { kind: 'skill-text' as const, column: 'active_skill_text' as const, before: 'OLD_TEXT_BODY', after: 'NEW_TEXT_BODY' };

    it('counts applied ships in one line and never prints their text', () => {
        const md = renderIssueSummary(
            plan({
                patches: [
                    rowPatch({ name: 'Aegis', applied: [textChange] }),
                    rowPatch({ name: 'Bedrock', applied: [{ kind: 'stats', field: 'hp', before: 1, after: 2 }] }),
                ],
            }),
            ctx
        );
        expect(md).toContain('2 ships updated; full diff in the job summary and artifact');
        expect(md).not.toContain('NEW_TEXT_BODY');
        expect(md).not.toContain('Aegis');
        expect(md).toContain('3.22.33566');
    });

    it('omits the timestamped snapshot line', () => {
        expect(renderIssueSummary(plan(), ctx)).not.toContain('Snapshot before writing');
        expect(renderIssueSummary(plan(), ctx)).not.toContain('docs/backups/x.json');
    });

    it('lists held text by ship, reason, findings and columns, without the text', () => {
        const md = renderIssueSummary(
            plan({
                patches: [rowPatch({
                    name: 'Curator',
                    heldText: [textChange],
                    textHold: 'gate',
                    gate: { pass: false, newFindings: ['active · base-damage: deals'] },
                })],
            }),
            ctx
        );
        expect(md).toContain('**Curator** — held by the skill gate');
        expect(md).toContain('active · base-damage: deals');
        expect(md).toContain('active_skill_text');
        expect(md).not.toContain('OLD_TEXT_BODY');
        expect(md).not.toContain('NEW_TEXT_BODY');
    });

    it('carries every section that needs a human', () => {
        const md = renderIssueSummary(
            plan({
                patches: [rowPatch({ name: 'Bedrock', heldDrops: [{ kind: 'charge-cost', before: 4, after: null }] })],
                mappingHeld: [{ template: { id: 'CROCUS', name: 'Crocus' } as never, unit: {} as never, reasons: ['bad'] }],
                inserts: [{
                    row: { id: 'NEW' },
                    unit: { name: 'Newcomer', imageKey: 'XAOC_9', images: { avatar: 'av', bigPortrait: 'big' } } as never,
                    findings: [],
                }],
                refusedInserts: [{ unit: { name: 'Refused', definitionId: 'R1' } as never, reason: 'id R already exists' }],
                idMismatches: [{ unit: { name: 'Ghost', definitionId: 'new' } as never, template: { id: 'GHOST', name: 'Ghost', definition_id: 'old' } as never }],
                metadata: [{ template: { name: 'Drifter' } as never, change: { kind: 'metadata', field: 'type', before: 'SUPPORTER', after: 'DEFENDER' } }],
                missingFromCatalogue: [{ id: 'RELIC', name: 'Relic' } as never],
            }),
            ctx
        );
        for (const s of ['Bedrock', 'Crocus', 'Newcomer', 'Refused', 'Ghost', 'Drifter', 'Relic']) expect(md).toContain(s);
    });

    it('names ships under a run-wide text hold in one line, not one entry each', () => {
        const held = (name: string) => rowPatch({
            name,
            heldText: [{ kind: 'skill-text', column: 'active_skill_text', before: 'A', after: 'B' }],
            textHold: 'bulk-text',
        });
        const md = renderIssueSummary(
            plan({ bulkTextHold: { changed: 2, matched: 2 }, patches: [held('Aegis'), held('Bedrock')] }),
            ctx
        );
        expect(md).toContain('2/2 matched ships (100%) changed skill text');
        expect(md).toMatch(/bulk-text hold[^\n]*: Aegis, Bedrock/);
        expect(md).not.toContain('**Aegis**');
    });

    it('truncates to 60,000 characters with a trailing note', () => {
        const many = Array.from({ length: 3000 }, (_, i) => ({
            template: { id: `S${i}`, name: `Ship ${i}` } as never,
            unit: {} as never,
            reasons: ['x'.repeat(40)],
        }));
        const md = renderIssueSummary(plan({ mappingHeld: many }), ctx);
        expect(md.length).toBeLessThanOrEqual(ISSUE_SUMMARY_LIMIT);
        expect(ISSUE_SUMMARY_LIMIT).toBe(60_000);
        expect(md).toMatch(/truncated[^\n]*job summary[^\n]*\n$/);
    });

    it('leaves a short summary untruncated', () => {
        expect(renderIssueSummary(plan(), ctx)).not.toMatch(/truncated/);
    });
});

describe('accepted structural changes', () => {
    const lost = 'passive R0 · lost buff|self|on-enemy-destroyed|Legion Discipline I';
    const accepted = rowPatch({
        name: 'Gallant',
        applied: [{ kind: 'skill-text', column: 'first_passive_skill_text', before: 'a', after: 'b' }],
        gate: { pass: true, newFindings: [], accepted: [lost] },
    });
    const stillHeld = rowPatch({
        name: 'Sokol',
        heldText: [{ kind: 'skill-text', column: 'active_skill_text', before: 'a', after: 'b' }],
        textHold: 'gate',
        gate: { pass: false, newFindings: ['active · always-crit: x'], accepted: ['active · gained y'] },
    });
    const withAccepts = { ...ctx, acceptStructural: ['Gallant', 'sokol', 'Typo'] };

    it('lists each accepted ship with its structural findings, in the report and the issue summary', () => {
        for (const md of [renderReport(plan({ patches: [accepted] }), withAccepts), renderIssueSummary(plan({ patches: [accepted] }), withAccepts)]) {
            expect(md).toMatch(/### Accepted structural changes \(1 ships\)/);
            expect(md).toContain('**Gallant**');
            expect(md).toContain(`- ${lost}`);
        }
    });

    it('notes an accepted ship whose text another gate still held', () => {
        const md = renderReport(plan({ patches: [stillHeld] }), withAccepts);
        expect(md).toMatch(/\*\*Sokol\*\* — text still held by the skill gate/);
    });

    it('names accept-list entries that matched no structural change', () => {
        const md = renderReport(plan({ patches: [accepted, stillHeld] }), withAccepts);
        expect(md).toContain('--accept-structural names with no structural change: Typo');
    });

    it('renders nothing without an accept list or accepted findings', () => {
        expect(renderReport(plan(), ctx)).not.toContain('Accepted structural changes');
    });

    it('labels a gate hold with the skill gate, not the audit alone', () => {
        const md = renderReport(plan({ patches: [stillHeld] }), ctx);
        expect(md).toContain('**Sokol** — held by the skill gate; new findings:');
    });
});
