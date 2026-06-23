import { describe, it, expect } from 'vitest';
import { mkNamedBuffGrant } from '../buildEquipmentAbilities';

// D-PR16 Task 5: multi-buff co-grant infrastructure. `mkNamedBuffGrant` can carry extra
// named buffs (alsoGrantBuffNames) that are granted ALONGSIDE the primary in the SAME
// application (one proc roll → all of them). No implant uses it yet (Task 6 wires Last
// Stand) — these tests pin the registry SHAPE.
describe('mkNamedBuffGrant — additionalBuffs co-grant (D-PR16 Task 5)', () => {
    it('attaches a populated additionalBuffs array with resolved parsedEffects', () => {
        const ability = mkNamedBuffGrant('Barrier', 'self', 'on-ally-destroyed', 1, {
            procChance: 0.32,
            alsoGrantBuffNames: ['Block Debuff'],
        });

        expect(ability).toBeDefined();
        expect(ability!.config.type).toBe('buff');
        if (ability!.config.type !== 'buff') throw new Error('expected buff config');

        // Primary buff unchanged.
        expect(ability!.config.buffName).toBe('Barrier');
        expect(ability!.procChance).toBeCloseTo(0.32);

        // Co-granted buff present with a resolved (non-undefined) parsedEffects.
        const extras = ability!.config.additionalBuffs;
        expect(extras).toBeDefined();
        expect(extras).toHaveLength(1);
        expect(extras![0].buffName).toBe('Block Debuff');
        expect(extras![0].parsedEffects).toBeDefined();
        expect(extras![0].duration).toBe(1);
    });

    it('omits additionalBuffs entirely when alsoGrantBuffNames is absent (byte-identical)', () => {
        const ability = mkNamedBuffGrant('Barrier', 'self', 'on-ally-destroyed', 1, {
            procChance: 0.32,
        });
        expect(ability).toBeDefined();
        if (ability!.config.type !== 'buff') throw new Error('expected buff config');
        expect('additionalBuffs' in ability!.config).toBe(false);
    });

    it('omits additionalBuffs when alsoGrantBuffNames is empty', () => {
        const ability = mkNamedBuffGrant('Barrier', 'self', 'on-ally-destroyed', 1, {
            procChance: 0.32,
            alsoGrantBuffNames: [],
        });
        if (ability!.config.type !== 'buff') throw new Error('expected buff config');
        expect('additionalBuffs' in ability!.config).toBe(false);
    });
});
