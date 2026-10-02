import { describe, it, expect } from 'vitest';
import { getBuffDescription } from '../buffUtils';

describe('getBuffDescription', () => {
    it('resolves a catalogue spelling to the description of the engine name', () => {
        const engine = getBuffDescription('Tianchao Precision II');
        expect(engine).toBeDefined();
        expect(getBuffDescription('Tianchen Precision II')).toBe(engine);
        expect(getBuffDescription('Reverse Repairs')).toBe(getBuffDescription('Reversed Repairs'));
    });

    it('returns undefined for an unknown name', () => {
        expect(getBuffDescription('Not A Status')).toBeUndefined();
    });
});
