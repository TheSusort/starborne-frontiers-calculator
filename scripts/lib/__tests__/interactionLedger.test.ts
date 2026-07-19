import { describe, it, expect } from 'vitest';
import { buildLedgerJson, renderLedgerMarkdown } from '../interactionLedger';
import type { Finding } from '../../../src/utils/combat/audit/types';

describe('interactionLedger', () => {
  const invariantFinding: Finding = {
    oracle: 'invariant',
    ships: ['Ship1', 'Ship2'],
    slots: ['p1', 'p2'],
    seed: 12345,
    invariant: 'hp-bounds',
    severity: 'high',
  };

  const differentialFinding: Finding = {
    oracle: 'differential',
    ships: ['Ship3'],
    slots: ['p3'],
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
    slots: ['p4'],
    seed: 11111,
    ablationDetail: 'Diverges from single-ship behavior',
    severity: 'low',
  };

  describe('buildLedgerJson', () => {
    it('should split ablation findings into needsTriage and others into confirmed', () => {
      const findings = [invariantFinding, differentialFinding, ablationFinding];
      const meta = { compositionsRun: 100 };

      const result = buildLedgerJson(findings, meta);

      expect(result).toEqual({
        compositionsRun: 100,
        confirmed: [invariantFinding, differentialFinding],
        needsTriage: [ablationFinding],
        refuted: [],
      });
    });

    it('should echo compositionsRun in the output', () => {
      const findings: Finding[] = [];
      const meta = { compositionsRun: 42 };

      const result = buildLedgerJson(findings, meta);

      expect(result.compositionsRun).toBe(42);
    });

    it('should always have refuted as empty array', () => {
      const findings = [invariantFinding];
      const meta = { compositionsRun: 1 };

      const result = buildLedgerJson(findings, meta);

      expect(result.refuted).toEqual([]);
    });
  });

  describe('renderLedgerMarkdown', () => {
    it('should include ship names and seed in the markdown', () => {
      const findings = [invariantFinding];
      const meta = { compositionsRun: 100 };

      const markdown = renderLedgerMarkdown(findings, meta);

      expect(markdown).toContain('Ship1');
      expect(markdown).toContain('Ship2');
      expect(markdown).toContain('12345');
    });

    it('should include oracle type in the markdown', () => {
      const findings = [invariantFinding];
      const meta = { compositionsRun: 100 };

      const markdown = renderLedgerMarkdown(findings, meta);

      expect(markdown).toContain('invariant');
    });

    it('should separate ablation findings under "Needs Triage" section', () => {
      const findings = [invariantFinding, ablationFinding];
      const meta = { compositionsRun: 100 };

      const markdown = renderLedgerMarkdown(findings, meta);

      expect(markdown).toContain('Needs Triage');
      expect(markdown).toContain('Confirmed');
    });

    it('should include count information', () => {
      const findings = [invariantFinding, differentialFinding, ablationFinding];
      const meta = { compositionsRun: 100 };

      const markdown = renderLedgerMarkdown(findings, meta);

      expect(markdown).toContain('2');
      expect(markdown).toContain('1');
    });
  });
});
