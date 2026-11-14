import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { bossShip, npcShip } from '../../../constants/bountyBosses';
import type { Ability, ShipSkills } from '../../../types/abilities';

const abilitiesOf = (skills: ShipSkills, name: string): Ability[] =>
    skills.slots.find((s) => s.slot === name)?.abilities ?? [];

describe('Eelun Naphula kit (bounty boss)', () => {
    const skills = buildShipAbilities(bossShip('eelun', 32)!);

    it('is immune to control and charge loss', () => {
        expect(skills.controlImmune).toBe(true);
        expect(skills.chargeLossImmune).toBe(true);
    });

    it.each([
        ['active', 10.5],
        ['charged', 10],
    ])('%s shields every ally for %s% of her max HP', (slot, pct) => {
        const shields = abilitiesOf(skills, slot).filter((a) => a.type === 'shield');
        expect(shields).toHaveLength(1);
        expect(shields[0]).toMatchObject({
            target: 'all-allies',
            trigger: 'on-cast',
            config: { type: 'shield', pct, basis: 'hp' },
        });
    });

    const acidicDecayIII = (duration: number) => ({
        type: 'dot',
        dotType: 'corrosion',
        tier: 9,
        stacks: 1,
        duration,
        family: 'Acidic Decay',
        unremovable: true,
    });

    it('charged inflicts one Acidic Decay III for 3 turns on all enemies', () => {
        const dots = abilitiesOf(skills, 'charged').filter((a) => a.type === 'dot');
        expect(dots).toHaveLength(1);
        expect(dots[0]).toMatchObject({ trigger: 'on-cast', conditions: [] });
        expect(dots[0].config).toEqual(acidicDecayIII(3));
    });

    it('active inflicts Acidic Decay III for 3 turns, plus a 1-turn copy primed by an ally death', () => {
        const dots = abilitiesOf(skills, 'active').filter((a) => a.type === 'dot');
        expect(dots).toHaveLength(2);
        const [always, primed] = dots;
        expect(always).toMatchObject({ trigger: 'on-cast', conditions: [] });
        expect(always.config).toEqual(acidicDecayIII(3));
        expect(primed).toMatchObject({
            trigger: 'on-cast',
            conditions: [{ subject: 'ally-died-since-own-active', derivable: true }],
        });
        expect(primed.config).toEqual(acidicDecayIII(1));
    });

    it('the passive itself carries no Acidic Decay', () => {
        expect(abilitiesOf(skills, 'passive').filter((a) => a.type === 'dot')).toHaveLength(0);
    });
});

describe('Sitri kit (bounty add)', () => {
    const skills = buildShipAbilities(npcShip('sitri', 124)!);

    it.each([
        ['active', 140],
        ['charged', 200],
    ])('%s deals %s% damage and inflicts Corrosion II for 2 turns', (slot, multiplier) => {
        const abilities = abilitiesOf(skills, slot);
        expect(abilities.find((a) => a.type === 'damage')?.config).toMatchObject({ multiplier });
        expect(abilities.find((a) => a.type === 'dot')?.config).toMatchObject({
            dotType: 'corrosion',
            tier: 6,
            duration: 2,
        });
    });
});

describe('Beleth kit (bounty add)', () => {
    const skills = buildShipAbilities(npcShip('beleth', 124)!);

    it.each([
        ['active', ['Defense Up II', 'Attack Up II'], 1],
        ['charged', ['Defense Up III', 'Attack Up III'], 2],
    ])('%s grants %j to all allies for %s turn(s)', (slot, names, duration) => {
        const buffs = abilitiesOf(skills, slot).filter((a) => a.type === 'buff');
        expect(buffs.map((a) => a.config)).toMatchObject(
            names.map((buffName) => ({ buffName, duration }))
        );
        for (const buff of buffs) expect(buff.target).toBe('all-allies');
    });
});

describe('Corson kit (bounty add)', () => {
    const skills = buildShipAbilities(npcShip('corson', 124)!);

    it.each(['active', 'charged'])(
        '%s hits for 120% of his defence and inflicts Corrosion II',
        (slot) => {
            const abilities = abilitiesOf(skills, slot);
            expect(abilities.find((a) => a.type === 'damage')?.config).toMatchObject({
                multiplier: 0,
            });
            expect(abilities.find((a) => a.type === 'additional-damage')?.config).toMatchObject({
                stat: 'defense',
                pct: 120,
            });
            expect(abilities.find((a) => a.type === 'dot')?.config).toMatchObject({
                dotType: 'corrosion',
                tier: 6,
            });
        }
    );

    it('charged gains Taunt on himself for 2 turns', () => {
        const abilities = abilitiesOf(skills, 'charged');
        expect(abilities.find((a) => a.type === 'control')).toMatchObject({
            target: 'self',
            config: { effect: 'taunt' },
        });
        expect(abilities.find((a) => a.type === 'buff')).toMatchObject({
            target: 'self',
            config: { buffName: 'Taunt', duration: 2 },
        });
    });
});
