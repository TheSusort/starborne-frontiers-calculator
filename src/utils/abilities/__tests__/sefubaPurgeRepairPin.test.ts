/**
 * Sefuba's passive ("... repairs 8% of its max HP for each buff removed", with or without the extra
 * purge) repairs 12% per buff in game on both tiers; the text's 8% is wrong. Real parsed kits
 * (buildTraceShip).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildTraceShip, type RefitLevel } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../buildShipAbilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});

const purgeRepair = (refitLevel: RefitLevel) => {
    const built = buildTraceShip('Sefuba', { refitLevel });
    if (!built) throw new Error('Sefuba missing from reference data');
    const passive = buildShipAbilities(built).slots.find((s) => s.slot === 'passive');
    const abilities = passive?.abilities ?? [];
    const heal = abilities.find((a) => a.type === 'heal' && a.trigger === 'on-enemy-purged');
    if (!heal || heal.config.type !== 'heal') throw new Error('Sefuba purge repair not found');
    return {
        pct: heal.config.pct,
        perUnit: heal.scaling?.perUnit,
        hasExtraPurge: abilities.some((a) => a.type === 'purge' && a.trigger === 'on-enemy-purged'),
    };
};

describe('Sefuba purge repair', () => {
    it('the extra-purge passive repairs 12% per buff removed', () => {
        expect(purgeRepair(4)).toEqual({ pct: 12, perUnit: 12, hasExtraPurge: true });
    });

    it('the base passive (no extra purge) repairs 12% per buff removed', () => {
        expect(purgeRepair(0)).toEqual({ pct: 12, perUnit: 12, hasExtraPurge: false });
    });
});
