import { describe, it, expect } from 'vitest';
import { createActor } from '../state';

describe('ActorStats — hacking/security', () => {
    it('carries hacking/security when supplied', () => {
        const a = createActor({
            id: 'x',
            side: 'player',
            kind: 'team',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 1,
                speed: 50,
                hacking: 120,
                security: 80,
            },
        } as any);
        expect(a.stats.hacking).toBe(120);
        expect(a.stats.security).toBe(80);
    });

    it('leaves hacking/security undefined when omitted (back-compat fixtures)', () => {
        const a = createActor({
            id: 'y',
            side: 'player',
            kind: 'team',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 1,
                speed: 50,
            },
        } as any);
        expect(a.stats.hacking).toBeUndefined();
        expect(a.stats.security).toBeUndefined();
    });
});
