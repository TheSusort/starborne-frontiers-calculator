import { describe, it, expect } from 'vitest';
import { protectionCascade } from '../protectionTransfer';

describe('protectionCascade', () => {
    it('single protector: target keeps (1 - 0.1*stacks), protector chunk swaps defense via mit ratio', () => {
        // D=1000, targetMit=0.25, protector mit=0.5, 2 stacks -> frac=0.2
        const r = protectionCascade(1000, 0.25, [{ mit: 0.5, stacks: 2 }]);
        expect(r.targetRemainder).toBeCloseTo(800, 6);
        // total = 0.2 * 1000 * (0.5/0.25) = 400 ; per stack = 200
        expect(r.chunks).toHaveLength(1);
        expect(r.chunks[0].total).toBeCloseTo(400, 6);
        expect(r.chunks[0].perStack).toBeCloseTo(200, 6);
        expect(r.chunks[0].stacks).toBe(2);
    });

    it('multi-protector cascade: each protector skims the PREVIOUS protector chunk, not the original', () => {
        // D=1000, targetMit=0.25 -> P=4000. P1 mit=0.5 stacks=2 (frac1=0.2); P2 mit=0.4 stacks=1 (frac2=0.1)
        const r = protectionCascade(1000, 0.25, [
            { mit: 0.5, stacks: 2 },
            { mit: 0.4, stacks: 1 },
        ]);
        expect(r.targetRemainder).toBeCloseTo(800, 6); // target loses only frac1
        // flow1 = 0.2*4000 = 800 ; P1 keeps (1-0.1)*800*0.5 = 360
        expect(r.chunks[0].total).toBeCloseTo(360, 6);
        // flow2 = 0.1*800 = 80 ; P2 keeps 80*0.4 = 32
        expect(r.chunks[1].total).toBeCloseTo(32, 6);
    });

    it('caps redirect at 100% (10 stacks) so target can reach zero', () => {
        const r = protectionCascade(1000, 0.25, [{ mit: 0.5, stacks: 12 }]);
        expect(r.targetRemainder).toBeCloseTo(0, 6);
        // total = 1.0 * 1000 * (0.5/0.25) = 2000
        expect(r.chunks[0].total).toBeCloseTo(2000, 6);
    });

    it('no protectors: target keeps everything, no chunks', () => {
        const r = protectionCascade(1000, 0.25, []);
        expect(r.targetRemainder).toBe(1000);
        expect(r.chunks).toEqual([]);
    });
});
