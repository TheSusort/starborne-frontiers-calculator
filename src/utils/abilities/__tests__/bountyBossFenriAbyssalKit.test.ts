import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { bossShip, npcShip } from '../../../constants/bountyBosses';
import { parseDotImmune } from '../../skillTextParser';
import type { Ability, ShipSkills } from '../../../types/abilities';

const abilitiesOf = (skills: ShipSkills, name: string): Ability[] =>
    skills.slots.find((s) => s.slot === name)?.abilities ?? [];

describe('Abyssal Fenri Khaliriz kit (Lv33)', () => {
    const ship = bossShip('fenri', 33)!;
    const skills = buildShipAbilities(ship);

    it('is named for its level and carries its own kit', () => {
        expect(ship.name).toBe('Abyssal Fenri Khaliriz');
        expect(ship.chargeSkillCharge).toBe(2);
        expect(ship.baseStats).toMatchObject({ hp: 499108, speed: 130 });
        expect(ship.activeSkillText).toContain('White Phosphorus II');
        expect(ship.chargeSkillText).toContain('summons two torpedoes');
        expect(ship.firstPassiveSkillText).toContain('and Bombs');
    });

    it('active hits for 400% and inflicts White Phosphorus II', () => {
        const active = abilitiesOf(skills, 'active');
        expect(active.find((a) => a.type === 'damage')!.config).toMatchObject({ multiplier: 400 });
        expect(active.some((a) => a.config.type === 'dot' && a.config.dotType === 'inferno')).toBe(
            true
        );
    });

    it('charged hits for 450%', () => {
        const charged = abilitiesOf(skills, 'charged');
        expect(charged.find((a) => a.type === 'damage')!.config).toMatchObject({ multiplier: 450 });
    });

    it('passive is control- and charge-loss-immune but not DoT-immune', () => {
        expect(skills.controlImmune).toBe(true);
        expect(skills.chargeLossImmune).toBe(true);
        expect(skills.dotImmune).toBeFalsy();
        expect(parseDotImmune(ship.firstPassiveSkillText)).toBe(false);
    });

    it('takes half damage from DoT ticks and from Bombs only', () => {
        const reductions = abilitiesOf(skills, 'passive')
            .filter((a) => a.config.type === 'incoming-reduction')
            .map((a) => a.config);
        expect(reductions).toMatchObject([
            { scope: 'dot', pct: 50 },
            { scope: 'detonation', pct: 50, bombOnly: true },
        ]);
    });
});

describe('Fenri Lv32 kit', () => {
    it('keeps its own text and name', () => {
        const ship = bossShip('fenri', 32)!;
        expect(ship.name).toBe('Fenri Khaliriz');
        expect(ship.activeSkillText).toContain('Inferno II');
        expect(ship.firstPassiveSkillText).toContain('from DoTs.');
        const reductions = abilitiesOf(buildShipAbilities(ship), 'passive').filter(
            (a) => a.config.type === 'incoming-reduction'
        );
        expect(reductions.map((a) => a.config)).toMatchObject([{ scope: 'dot', pct: 50 }]);
        expect(reductions.some((a) => 'bombOnly' in a.config)).toBe(false);
    });
});

describe('Torpedo add', () => {
    it('resolves npc:torpedo:135', () => {
        const ship = npcShip('torpedo', 135)!;
        expect(ship.id).toBe('npc:torpedo:135');
        expect(ship.affinity).toBe('antimatter');
        expect(ship.type).toBe('ATTACKER');
        expect(ship.baseStats).toMatchObject({ hp: 38160, speed: 93, attack: 29082, defence: 0 });
        expect(ship.chargeSkillCharge).toBe(0);
        expect(ship.activeSkillText).toBe('');
        expect(ship.firstPassiveSkillText).toContain('immune to damage, debuffs, and purge');
    });
});
