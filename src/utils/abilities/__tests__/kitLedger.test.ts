import { describe, it, expect } from 'vitest';
import {
    renderLedgerMarkdown,
    renderLedgerJson,
    LedgerInput,
} from '../../../../scripts/lib/kitLedger';

const input: LedgerInput = {
    shipsAudited: 147,
    clausesReviewed: 500,
    refuted: 3,
    untriggeredVerified: 12,
    findings: [
        {
            ship: 'Zeta',
            slot: 'charged',
            layer: 'parser',
            verdict: 'WRONG-PARSE',
            expected: 'heal 30%',
            observed: 'heal 20%',
            severity: 'high',
            fixPointer: 'skillTextParser.ts',
        },
        {
            ship: 'Alpha',
            slot: 'passive',
            layer: 'executor',
            verdict: 'MISSING',
            expected: 'on-ally-death buff',
            observed: 'never fires',
            severity: 'low',
            fixPointer: 'combat/triggers.ts',
        },
    ],
};

describe('kitLedger', () => {
    it('ranks findings high → low in the markdown', () => {
        const md = renderLedgerMarkdown(input);
        expect(md.indexOf('Zeta')).toBeLessThan(md.indexOf('Alpha'));
        expect(md).toContain('147');
        expect(md).toContain('| Zeta |');
    });

    it('emits valid JSON with the same finding count', () => {
        const parsed = JSON.parse(renderLedgerJson(input));
        expect(parsed.findings).toHaveLength(2);
        expect(parsed.shipsAudited).toBe(147);
    });
});
