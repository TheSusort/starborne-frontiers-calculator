import { describe, it, expect } from 'vitest';
import {
    buildLedgerJson,
    LEDGER_BLIND_SPOTS,
    renderLedgerMarkdown,
    type LedgerCoverage,
} from '../interactionLedger';
import type { Finding } from '../../../src/utils/combat/audit/types';

const coverage: LedgerCoverage = {
    calibration: { comparable: 151, total: 160 },
    differential: { comparable: 148, total: 160 },
    ablation: { comparable: 0, total: 480 },
};

const calibrationResidual = { count: 0, rate: 0, tolerance: 0.01, histogram: '' };

describe('interactionLedger', () => {
    const invariantFinding: Finding = {
        oracle: 'invariant',
        ships: ['Ship1', 'Ship2'],
        slots: ['T1', 'T2'],
        seed: 12345,
        invariant: 'hp-bounds',
        severity: 'high',
    };

    const differentialFinding: Finding = {
        oracle: 'differential',
        ships: ['Ship3'],
        slots: ['T3'],
        seed: 54321,
        fingerprintDiff: {
            actorId: 'a1',
            shipName: 'Ship3',
            missingInComposition: ['attack'],
            extraInComposition: ['heal'],
        },
        severity: 'med',
    };

    const ablationFinding: Finding = {
        oracle: 'ablation',
        ships: ['Ship4'],
        slots: ['T4'],
        seed: 11111,
        ablationDetail: 'Diverges from single-ship behavior',
        severity: 'low',
    };

    describe('buildLedgerJson', () => {
        it('should split ablation findings into needsTriage and others into confirmed', () => {
            const findings = [invariantFinding, differentialFinding, ablationFinding];
            const meta = { compositionsRun: 100, coverage, calibrationResidual };

            const result = buildLedgerJson(findings, meta);

            expect(result).toEqual({
                compositionsRun: 100,
                coverage,
                calibrationResidual,
                blindSpots: LEDGER_BLIND_SPOTS,
                confirmed: [invariantFinding, differentialFinding],
                needsTriage: [ablationFinding],
                refuted: [],
            });
        });

        it('should echo compositionsRun in the output', () => {
            const findings: Finding[] = [];
            const meta = { compositionsRun: 42, coverage, calibrationResidual };

            const result = buildLedgerJson(findings, meta);

            expect(result.compositionsRun).toBe(42);
        });
    });

    describe('renderLedgerMarkdown', () => {
        it('should include ship names and seed in the markdown', () => {
            const findings = [invariantFinding];
            const meta = { compositionsRun: 100, coverage, calibrationResidual };

            const markdown = renderLedgerMarkdown(findings, meta);

            expect(markdown).toContain('Ship1');
            expect(markdown).toContain('Ship2');
            expect(markdown).toContain('12345');
        });

        it('should include oracle type in the markdown', () => {
            const findings = [invariantFinding];
            const meta = { compositionsRun: 100, coverage, calibrationResidual };

            const markdown = renderLedgerMarkdown(findings, meta);

            expect(markdown).toContain('invariant');
        });

        it('should separate ablation findings under "Needs Triage" section', () => {
            const findings = [invariantFinding, ablationFinding];
            const meta = { compositionsRun: 100, coverage, calibrationResidual };

            const markdown = renderLedgerMarkdown(findings, meta);

            expect(markdown).toContain('Needs Triage');
            expect(markdown).toContain('Confirmed');
        });

        it('should include count information', () => {
            // invariantFinding + differentialFinding are non-ablation -> 2 confirmed;
            // ablationFinding alone -> 1 needing triage. Assert the specific rendered labels
            // rather than bare '2'/'1' substrings, which would coincidentally match seeds/counts
            // elsewhere in the document regardless of whether the counts were actually correct.
            const findings = [invariantFinding, differentialFinding, ablationFinding];
            const meta = { compositionsRun: 100, coverage, calibrationResidual };

            const markdown = renderLedgerMarkdown(findings, meta);

            expect(markdown).toContain('Confirmed findings: **2**');
            expect(markdown).toContain('Findings needing triage: **1**');
        });

        // A finding count means nothing without the number of checks behind it: a check that
        // compared nothing reports exactly like a clean one.
        it('reports each oracle’s coverage in the header, flagging a vacuous one', () => {
            const markdown = renderLedgerMarkdown([], {
                compositionsRun: 40,
                coverage,
                calibrationResidual,
            });
            const header = markdown.slice(0, markdown.indexOf('## Blind spots'));

            expect(header).toContain('Differential: **148/160 (93%)**');
            expect(header).toContain('Calibration: **151/160 (94%)**');
            expect(header).toContain('Ablation: **0/480 (0%) VACUOUS: compared nothing**');
        });

        it('records the calibration residual, its rate and the tolerance in the header and JSON', () => {
            const residual = {
                count: 3,
                rate: 3 / 1926,
                tolerance: 0.01,
                histogram: '+buff×2, -buff×1',
            };
            const meta = { compositionsRun: 500, coverage, calibrationResidual: residual };

            expect(renderLedgerMarkdown([], meta)).toContain(
                'Calibration residual: **3** inert diff(s), **0.16%** of compared placements ' +
                    '(tolerance 1.00%): +buff×2, -buff×1'
            );
            expect(buildLedgerJson([], meta).calibrationResidual).toEqual(residual);
        });

        it('lists the known blind spots of the comparison setup', () => {
            const markdown = renderLedgerMarkdown([], {
                compositionsRun: 40,
                coverage,
                calibrationResidual,
            });

            expect(markdown).toContain('## Blind spots');
            for (const spot of LEDGER_BLIND_SPOTS) expect(markdown).toContain(spot);
            expect(LEDGER_BLIND_SPOTS.join(' ')).toMatch(/OWN HP/);
            expect(LEDGER_BLIND_SPOTS.join(' ')).toMatch(/wipes a side/);
        });
    });
});
