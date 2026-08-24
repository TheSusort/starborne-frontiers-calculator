import { describe, it, expect } from 'vitest';
import {
    buffDurationExtensionTurns,
    buildBuffDurationExtensionByOwner,
} from '../buffDurationExtension';
import type { ShipSkills } from '../../../types/abilities';

// Minimal ShipSkills with one passive slot carrying the given ability configs.
const skillsWithPassiveConfigs = (configs: Array<{ type: string; turns?: number }>): ShipSkills =>
    ({
        slots: [
            {
                slot: 'passive',
                abilities: configs.map((config, i) => ({
                    id: `a${i}`,
                    type: 'modifier',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config,
                })),
            },
        ],
    }) as unknown as ShipSkills;

describe('buffDurationExtensionTurns', () => {
    it('returns the turns of a passive buff-duration-extension config', () => {
        expect(
            buffDurationExtensionTurns(
                skillsWithPassiveConfigs([{ type: 'buff-duration-extension', turns: 1 }])
            )
        ).toBe(1);
    });

    it('returns 0 when no buff-duration-extension config is present', () => {
        expect(
            buffDurationExtensionTurns(skillsWithPassiveConfigs([{ type: 'damage-reflection' }]))
        ).toBe(0);
    });

    it('returns 0 for undefined skills', () => {
        expect(buffDurationExtensionTurns(undefined)).toBe(0);
    });

    it('takes the max when multiple extension configs are present', () => {
        expect(
            buffDurationExtensionTurns(
                skillsWithPassiveConfigs([
                    { type: 'buff-duration-extension', turns: 1 },
                    { type: 'buff-duration-extension', turns: 2 },
                ])
            )
        ).toBe(2);
    });
});

describe('buildBuffDurationExtensionByOwner', () => {
    it('maps only owners that carry an extension; lookup of others returns 0', () => {
        const map = buildBuffDurationExtensionByOwner([
            {
                id: 'attacker',
                shipSkills: skillsWithPassiveConfigs([
                    { type: 'buff-duration-extension', turns: 1 },
                ]),
            },
            {
                id: 'ally-1',
                shipSkills: skillsWithPassiveConfigs([{ type: 'damage-reflection' }]),
            },
        ]);
        expect(map.get('attacker')).toBe(1);
        expect(map.has('ally-1')).toBe(false);
    });
});
