import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { bossShip, npcShip } from '../../../constants/bountyBosses';
import { BUFFS } from '../../../constants/buffs';
import { UNREMOVABLE_STATUSES } from '../../combat/cheatDeathBuffs';
import { classifyEnemyEffect } from '../../skillTextParser';
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

describe('General Colosso kit (bounty boss): the Marked / no-Marked branches', () => {
    const skills = buildShipAbilities(bossShip('colosso', 32)!);
    const noMarkedGate = {
        subject: 'enemy-debuff-holder-count',
        derivable: true,
        buffName: 'Marked',
        countComparator: 'eq',
        countThreshold: 0,
    };

    it.each([
        ['active', 'Hacking Up II'],
        ['charged', 'Hacking Up III'],
    ])('%s grants %s to all allies for 1 turn, only when no enemy is Marked', (slot, buffName) => {
        const grants = abilitiesOf(skills, slot).filter((a) => a.type === 'buff');
        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({
            target: 'all-allies',
            trigger: 'on-cast',
            conditions: [noMarkedGate],
            config: { buffName, duration: 1 },
        });
    });

    it.each(['active', 'charged'])(
        '%s mints one damage ability and removes Marked from its targets',
        (slot) => {
            const abilities = abilitiesOf(skills, slot);
            expect(abilities.filter((a) => a.type === 'damage')).toHaveLength(1);
            const removal = abilities.filter((a) => a.type === 'remove-target-status');
            expect(removal).toHaveLength(1);
            expect(removal[0]).toMatchObject({
                target: 'enemy',
                trigger: 'on-cast',
                config: { type: 'remove-target-status', buffName: 'Marked' },
            });
        }
    );

    it('never inflicts or grants Marked itself', () => {
        const names = skills.slots.flatMap((s) =>
            s.abilities.flatMap((a) =>
                a.type === 'buff' || a.type === 'debuff'
                    ? [(a.config as { buffName: string }).buffName]
                    : []
            )
        );
        expect(names).not.toContain('Marked');
    });
});

describe('Marked (status)', () => {
    it('is a debuff with no stat effect', () => {
        expect(BUFFS.find((b) => b.name === 'Marked')).toMatchObject({ type: 'debuff' });
        expect(classifyEnemyEffect('Marked')).toBe('debuff');
    });

    it('is unremovable', () => {
        expect(UNREMOVABLE_STATUSES.has('Marked')).toBe(true);
    });
});

describe('Major Grand kit (bounty add): no charged skill', () => {
    const skills = buildShipAbilities(npcShip('major-grand', 124)!);

    it('never mints a charged slot with abilities', () => {
        expect(abilitiesOf(skills, 'charged')).toEqual([]);
    });
});
