import { describe, it, expect } from 'vitest';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import {
    buildKitBundle,
    renderKitBundleMarkdown,
    renderKitReviewMarkdown,
} from '../../../../scripts/lib/kitBundle';

describe('buildKitBundle', () => {
    it('returns an error record for an unknown ship', () => {
        const b = buildKitBundle('NotARealShip_zzz');
        expect('error' in b).toBe(true);
    });

    it.skipIf(!csvAvailable())('produces all three sections for a real ship', () => {
        const b = buildKitBundle('Aegis');
        expect('error' in b).toBe(false);
        if ('error' in b) return;
        expect(b.skillRows.length).toBeGreaterThan(0);
        expect(b.abilities.length).toBeGreaterThan(0);
        expect(b.combatLog.length).toBeGreaterThan(0);
        // At least one clause was observed executing in the standardized scenario.
        expect(b.abilities.some((a) => a.observed)).toBe(true);
    });

    it.skipIf(!csvAvailable())('renders markdown with the three section headers', () => {
        const md = renderKitBundleMarkdown(buildKitBundle('Aegis'));
        expect(md).toContain('## Skill text');
        expect(md).toContain('## Parsed abilities');
        expect(md).toContain('## Execution trace');
    });
});

describe('renderKitReviewMarkdown', () => {
    it.skipIf(!csvAvailable())('renders the compact review sections for a real ship', () => {
        const md = renderKitReviewMarkdown(buildKitBundle('Aegis'));
        expect(md).toContain('## Skill text');
        expect(md).toContain('## Parsed abilities');
        expect(md).toContain('## Execution summary');
        expect(md).toContain('## Focus-actor transcript');
        expect(md).toContain('Focus-actor kinds observed:');
    });

    it('renders a harness error', () => {
        const md = renderKitReviewMarkdown(buildKitBundle('NotARealShip_zzz'));
        expect(md).toContain('**HARNESS-ERROR:**');
    });
});
