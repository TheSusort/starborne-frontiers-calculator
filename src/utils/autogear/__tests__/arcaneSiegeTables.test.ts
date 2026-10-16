/**
 * Arcane Siege's value lives in two tables: the autogear scorers' (`ARCANE_SIEGE_MULTIPLIERS`)
 * and the combat engine's (the modifier `buildEquipmentAbilities` builds). They must agree for
 * every rarity, and both must match the implant text in `IMPLANTS`.
 */
import { describe, expect, it } from 'vitest';
import { ARCANE_SIEGE_MULTIPLIERS } from '../arcaneSiegeUtils';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { IMPLANTS } from '../../../constants/implants';
import { RARITIES, type RarityName } from '../../../constants/rarities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

const engineValue = (rarity: RarityName): number | undefined => {
    const ship: Ship = {
        id: 's',
        name: 'S',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: { implant_minor_alpha: 'siege' },
        refits: [],
    };
    const piece: GearPiece = {
        id: 'siege',
        slot: 'implant_minor_alpha',
        level: 16,
        stars: 6,
        rarity,
        mainStat: null,
        subStats: [],
        setBonus: 'ARCANE_SIEGE',
    };
    const ability = buildEquipmentAbilities(ship, (id) =>
        id === 'siege' ? piece : undefined
    ).find((a) => a.id.startsWith('equip-implant-ARCANE_SIEGE'));
    return ability?.config.type === 'modifier' ? ability.config.value : undefined;
};

describe('Arcane Siege tables', () => {
    for (const rarity of Object.keys(RARITIES) as RarityName[]) {
        it(`${rarity}: autogear, engine and implant text agree`, () => {
            const textPct = IMPLANTS.ARCANE_SIEGE.variants
                .find((v) => v.rarity === rarity)
                ?.description.match(/by (\d+)%/)?.[1];
            expect(textPct).toBeDefined();
            expect(ARCANE_SIEGE_MULTIPLIERS[rarity]).toBe(Number(textPct));
            expect(engineValue(rarity)).toBe(Number(textPct));
        });
    }
});
