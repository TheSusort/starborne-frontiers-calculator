import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { bossShip, npcShip } from '../../../constants/bountyBosses';
import { BUFFS } from '../../../constants/buffs';
import { UNREMOVABLE_STATUSES } from '../../combat/cheatDeathBuffs';
import {
    classifyEnemyEffect,
    detectCountGateBranches,
    parseDotImmune,
} from '../../skillTextParser';
import { MANUAL_BUFF_ADDITIONS } from '../../dataUpdate/buffDataOverrides';
import { parseBuffEffects, isStackable } from '../../calculators/buffParser';
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

describe('Major Grand kit (bounty add): the own-debuff branches and the death cleanse', () => {
    const skills = buildShipAbilities(npcShip('major-grand', 124)!);
    const under2 = { subject: 'self-debuff', countComparator: 'lte', countThreshold: 1 };
    const twoPlus = { subject: 'self-debuff', countComparator: 'gte', countThreshold: 2 };
    const summary = (a: Ability) => ({
        type: a.type,
        target: a.target,
        trigger: a.trigger,
        conditions: a.conditions.map(({ subject, countComparator, countThreshold }) => ({
            subject,
            countComparator,
            countThreshold,
        })),
        config: a.config,
    });

    it('active: under 2 own debuffs Hacking Up III, the hit and Marked; 2+ the self cleanse and Security Up II', () => {
        expect(abilitiesOf(skills, 'active').map(summary)).toEqual([
            {
                type: 'buff',
                target: 'self',
                trigger: 'on-cast',
                conditions: [under2],
                config: expect.objectContaining({ buffName: 'Hacking Up III', duration: 1 }),
            },
            {
                type: 'damage',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [under2],
                config: { type: 'damage', multiplier: 60 },
            },
            {
                type: 'debuff',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [under2],
                config: expect.objectContaining({
                    buffName: 'Marked',
                    duration: 10,
                    application: 'inflict',
                }),
            },
            {
                type: 'cleanse',
                target: 'self',
                trigger: 'on-cast',
                conditions: [twoPlus],
                config: { type: 'cleanse', count: 2 },
            },
            {
                type: 'buff',
                target: 'self',
                trigger: 'on-cast',
                conditions: [twoPlus],
                config: expect.objectContaining({ buffName: 'Security Up II', duration: 2 }),
            },
        ]);
    });

    it('passive: on its own death, cleanses 3 debuffs from all allies, whatever killed it', () => {
        const passive = abilitiesOf(skills, 'passive');
        expect(passive.map(summary)).toEqual([
            {
                type: 'cleanse',
                target: 'all-allies',
                trigger: 'on-destroyed',
                conditions: [],
                config: { type: 'cleanse', count: 3 },
            },
        ]);
        expect(passive[0].triggerRequiresDirectDeath).toBeUndefined();
    });
});

describe('either/or count-gate branches (parse rule)', () => {
    const gate = (comparator: 'lte' | 'gte', threshold: number) => ({
        subject: 'self-debuff',
        derivable: true,
        countComparator: comparator,
        countThreshold: threshold,
    });

    it('splits a trailing "if fewer than N" and a following "If N or more," into two branches', () => {
        const text =
            'Deals 60% damage if it has less than 2 debuffs. If it has 2 or more debuffs, cleanses 2 debuffs.';
        const branches = detectCountGateBranches(text);
        expect(branches.map((b) => b.gate)).toEqual([gate('lte', 1), gate('gte', 2)]);
        expect(text.slice(branches[0].start, branches[0].end)).toBe(
            'Deals 60% damage if it has less than 2 debuffs.'
        );
        expect(text.slice(branches[1].start, branches[1].end).trim()).toBe(
            'If it has 2 or more debuffs, cleanses 2 debuffs.'
        );
    });

    it('needs the complement: a lone sentence-leading gate is no branch pair', () => {
        expect(
            detectCountGateBranches(
                'Deals 60% damage if it has less than 2 debuffs. If it has 3 or more debuffs, cleanses 2 debuffs.'
            )
        ).toEqual([]);
        expect(
            detectCountGateBranches(
                'Deals 60% damage. If this Unit has no debuffs, it gains one extra action.'
            )
        ).toEqual([]);
    });
});

describe('General Colosso kit (bounty boss): Assimilated Armor (passive)', () => {
    const skills = buildShipAbilities(bossShip('colosso', 32)!);
    const passive = abilitiesOf(skills, 'passive');
    const grantOf = (buffName: string) =>
        passive.filter((a) => a.config.type === 'buff' && a.config.buffName === buffName);

    it('is immune to damage over time effects, beside control and charge loss', () => {
        expect(skills).toMatchObject({
            dotImmune: true,
            controlImmune: true,
            chargeLossImmune: true,
        });
    });

    it.each(['Defense Up III', 'Taunt'])('gains %s for 2 turns on each ally death', (name) => {
        const grants = grantOf(name);
        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({
            target: 'self',
            trigger: 'on-ally-destroyed',
            config: { duration: 2 },
        });
    });

    it('gains one stack of Enrage Damage III after each attack, uncapped and permanent', () => {
        const grants = grantOf('Enrage Damage III');
        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({ target: 'self', trigger: 'on-attack-cast' });
        expect(grants[0].config).toMatchObject({ isStackable: true, duration: 'recurring' });
        expect(grants[0].config.type === 'buff' && grants[0].config.maxStacks).toBeUndefined();
    });

    it('deals 15% more outgoing damage per dead ally, live-counted and uncapped', () => {
        const mods = passive.filter((a) => a.type === 'modifier');
        expect(mods).toHaveLength(1);
        expect(mods[0]).toMatchObject({
            target: 'self',
            conditions: [{ subject: 'ally-destroyed' }],
            config: { type: 'modifier', channel: 'outgoingDamage', isMultiplicative: false },
            scaling: { conditionIndex: 0, perUnit: 15 },
        });
        expect(mods[0].scaling?.cap).toBeUndefined();
    });

    it('emits nothing else on the passive', () => {
        expect(passive.map((a) => a.type).sort()).toEqual(['buff', 'buff', 'buff', 'modifier']);
    });

    it('has 100% shield penetration at level 32', () => {
        expect(bossShip('colosso', 32)!.baseStats.shieldPenetration).toBe(100);
    });
});

describe('DoT immunity parse', () => {
    it('reads "immune to … damage over time effects"', () => {
        expect(
            parseDotImmune(
                'This Unit is immune to Control, damage over time effects and Charge Loss effects.'
            )
        ).toBe(true);
    });

    it('does not read a DoT damage reduction or a control-only immunity', () => {
        expect(parseDotImmune(bossShip('maglienza', 32)!.firstPassiveSkillText)).toBe(false);
        expect(parseDotImmune(bossShip('fenri', 32)!.firstPassiveSkillText)).toBe(false);
        expect(buildShipAbilities(bossShip('maglienza', 32)!).dotImmune).toBeUndefined();
    });
});

describe('Enrage Damage III (status)', () => {
    it('is +6% outgoing damage, stackable without a cap and unremovable', () => {
        const def = BUFFS.find((b) => b.name === 'Enrage Damage III')!;
        expect(def).toMatchObject({ type: 'buff', description: '+6% Outgoing Damage, Stackable' });
        expect(parseBuffEffects(def.name, def.description)).toEqual({ outgoingDamage: 6 });
        expect(isStackable(def.description)).toEqual({ stackable: true, maxStacks: undefined });
        expect(UNREMOVABLE_STATUSES.has('Enrage Damage III')).toBe(true);
        expect(MANUAL_BUFF_ADDITIONS.find((b) => b.name === def.name)).toEqual(def);
    });
});
