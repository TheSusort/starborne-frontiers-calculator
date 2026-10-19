import { describe, expect, it } from 'vitest';
import { createPinSet, isModelPinned, isModelUrgent, pinModel } from '../modelPins';

describe('modelPins', () => {
    it('counts pins per key and releases each once', () => {
        const a = pinModel('K1');
        const b = pinModel('K1', { urgent: true });
        expect(isModelPinned('K1')).toBe(true);
        expect(isModelUrgent('K1')).toBe(true);
        b();
        b();
        expect(isModelUrgent('K1')).toBe(false);
        expect(isModelPinned('K1')).toBe(true);
        a();
        expect(isModelPinned('K1')).toBe(false);
    });

    it('keeps a pin set in step with the keys it is given', () => {
        const set = createPinSet();
        set.set(['K2', 'K3', null]);
        expect([isModelPinned('K2'), isModelPinned('K3')]).toEqual([true, true]);
        set.set(['K3', 'K4']);
        expect([isModelPinned('K2'), isModelPinned('K3'), isModelPinned('K4')]).toEqual([
            false,
            true,
            true,
        ]);
        set.clear();
        expect([isModelPinned('K3'), isModelPinned('K4')]).toEqual([false, false]);
    });
});
