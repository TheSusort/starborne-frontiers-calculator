import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { bossShip, npcShip } from '../../../constants/bountyBosses';
import type { Ability, ShipSkills } from '../../../types/abilities';

const abilitiesOf = (skills: ShipSkills, name: string): Ability[] =>
    skills.slots.find((s) => s.slot === name)?.abilities ?? [];

const penetrationOf = (abilities: Ability[]) =>
    abilities.flatMap((a) =>
        a.config.type === 'modifier' && a.config.channel === 'defensePenetration'
            ? [a.config.value]
            : []
    );

describe('General Colosso kit (bounty boss): damage basis and penetration', () => {
    const skills = buildShipAbilities(bossShip('colosso', 32)!);
    const active = abilitiesOf(skills, 'active');
    const charged = abilitiesOf(skills, 'charged');

    it('active hits for 175% of his defence, not of his attack', () => {
        const damage = active.find((a) => a.type === 'damage')!;
        expect(damage.config).toMatchObject({ type: 'damage', multiplier: 0 });
        const extra = active.find((a) => a.type === 'additional-damage')!;
        expect(extra.config).toMatchObject({ stat: 'defense', pct: 175 });
    });

    it('charged hits for 200% of his defence, not of his attack', () => {
        const damage = charged.find((a) => a.type === 'damage')!;
        expect(damage.config).toMatchObject({ type: 'damage', multiplier: 0 });
        const extra = charged.find((a) => a.type === 'additional-damage')!;
        expect(extra.config).toMatchObject({ stat: 'defense', pct: 200 });
    });

    it('both skills carry their own 50% defence penetration', () => {
        expect(penetrationOf(active)).toEqual([50]);
        expect(penetrationOf(charged)).toEqual([50]);
    });
});

describe('Major Grand kit (bounty add): no charged skill', () => {
    const skills = buildShipAbilities(npcShip('major-grand', 124)!);

    it('never mints a charged slot with abilities', () => {
        expect(abilitiesOf(skills, 'charged')).toEqual([]);
    });
});
