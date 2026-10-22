import { describe, it, expect } from 'vitest';
import { parseAuditArgs } from '../auditArgs';

const defaults = { seed: 1, count: 150, allowCalibrationResidual: false };

describe('parseAuditArgs', () => {
    it('defaults to seed=1, count=150, residual not allowed, with no flags', () => {
        expect(parseAuditArgs([])).toEqual(defaults);
    });

    it('parses --seed and --count', () => {
        expect(parseAuditArgs(['--seed', '42', '--count', '7'])).toEqual({
            ...defaults,
            seed: 42,
            count: 7,
        });
    });

    it('parses the flags in either order', () => {
        expect(parseAuditArgs(['--count', '3', '--seed', '9'])).toEqual({
            ...defaults,
            seed: 9,
            count: 3,
        });
    });

    it('leaves the default when only one flag is given', () => {
        expect(parseAuditArgs(['--seed', '5'])).toEqual({ ...defaults, seed: 5 });
        expect(parseAuditArgs(['--count', '2'])).toEqual({ ...defaults, count: 2 });
    });

    it('parses --allow-calibration-residual', () => {
        expect(parseAuditArgs(['--allow-calibration-residual', '--seed', '5'])).toEqual({
            ...defaults,
            seed: 5,
            allowCalibrationResidual: true,
        });
    });
});
