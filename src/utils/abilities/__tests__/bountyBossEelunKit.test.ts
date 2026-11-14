import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { bossShip, npcShip } from '../../../constants/bountyBosses';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { LIVE_TRIGGERS } from '../../../types/abilities';
import { BUFFS } from '../../../constants/buffs';
import { MANUAL_BUFF_ADDITIONS } from '../../dataUpdate/buffDataOverrides';
import { UNREMOVABLE_STATUSES } from '../../combat/cheatDeathBuffs';
import { parseBuffEffects, isStackable } from '../../calculators/buffParser';

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

    it('charged gives one end-of-round action to every other ally, not to herself', () => {
        const grants = abilitiesOf(skills, 'charged').filter((a) => a.type === 'extra-action');
        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({ trigger: 'on-cast', conditions: [] });
        expect(grants[0].config).toEqual({
            type: 'extra-action',
            oncePerRound: false,
            endOfRound: true,
            recipients: 'other-allies',
        });
    });

    it('the active grants no extra action', () => {
        expect(abilitiesOf(skills, 'active').filter((a) => a.type === 'extra-action')).toEqual([]);
    });

    it('the passive itself carries no Acidic Decay', () => {
        expect(abilitiesOf(skills, 'passive').filter((a) => a.type === 'dot')).toHaveLength(0);
    });

    describe('passive', () => {
        const passive = abilitiesOf(skills, 'passive');

        it('emits the charge grant, the round-start repair and the Enrage Hacking gain', () => {
            expect(passive.map((a) => a.type).sort()).toEqual(['buff', 'charge', 'heal']);
        });

        it('each ally death adds 1 charge to every ally, herself included', () => {
            const charge = passive.find((a) => a.type === 'charge')!;
            expect(charge).toMatchObject({
                target: 'all-allies',
                trigger: 'on-ally-destroyed',
                conditions: [],
                config: { type: 'charge', amount: 1 },
            });
            expect(charge.oncePerRound).toBeUndefined();
        });

        it('repairs 12% of her max HP per other living ally at the start of each round', () => {
            const heal = passive.find((a) => a.type === 'heal')!;
            expect(heal).toMatchObject({
                target: 'self',
                trigger: 'start-of-round',
                conditions: [],
                config: { type: 'heal', pct: 12, basis: 'hp' },
                scaling: { perUnit: 12, countSource: 'other-living-ally-count' },
            });
        });

        it('gains one durationless stack of Enrage Hacking III at the end of each of her turns', () => {
            const grants = passive.filter(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Enrage Hacking III'
            );
            expect(grants).toHaveLength(1);
            expect(grants[0]).toMatchObject({ target: 'self', trigger: 'end-of-turn' });
            expect(grants[0].config).toMatchObject({ isStackable: true, duration: 'recurring' });
            expect(grants[0].config.type === 'buff' && grants[0].config.maxStacks).toBeUndefined();
            expect(
                grants[0].config.type === 'buff' && grants[0].config.stackTrigger
            ).toBeUndefined();
            expect(LIVE_TRIGGERS.has('end-of-turn')).toBe(true);
        });

        it('Enrage Hacking III is +3 flat hacking, stackable without a cap and unremovable', () => {
            const def = BUFFS.find((b) => b.name === 'Enrage Hacking III')!;
            expect(def.type).toBe('buff');
            expect(parseBuffEffects(def.name, def.description)).toEqual({ hacking: 3 });
            expect(isStackable(def.description)).toEqual({ stackable: true, maxStacks: undefined });
            expect(UNREMOVABLE_STATUSES.has('Enrage Hacking III')).toBe(true);
            expect(MANUAL_BUFF_ADDITIONS.find((b) => b.name === def.name)).toEqual(def);
        });
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

    it('charged adds 2 charges to her own charged skill', () => {
        const charges = abilitiesOf(skills, 'charged').filter((a) => a.type === 'charge');
        expect(charges).toHaveLength(1);
        expect(charges[0]).toMatchObject({
            target: 'self',
            trigger: 'on-cast',
            conditions: [{ subject: 'always', derivable: true }],
            config: { type: 'charge', amount: 2 },
        });
    });

    it('the active adds no charge', () => {
        expect(abilitiesOf(skills, 'active').filter((a) => a.type === 'charge')).toEqual([]);
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
