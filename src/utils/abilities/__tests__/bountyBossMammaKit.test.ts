import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { bossShip, npcShip } from '../../../constants/bountyBosses';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { LIVE_TRIGGERS } from '../../../types/abilities';
import { BUFFS } from '../../../constants/buffs';
import { MANUAL_BUFF_ADDITIONS } from '../../dataUpdate/buffDataOverrides';
import { UNREMOVABLE_STATUSES } from '../../combat/cheatDeathBuffs';
import { parseBuffEffects, isStackable } from '../../calculators/buffParser';
import { isIndependentInstance } from '../../combat/statusEngine';

const abilitiesOf = (skills: ShipSkills, name: string): Ability[] =>
    skills.slots.find((s) => s.slot === name)?.abilities ?? [];

describe('Mamma Maglienza kit (bounty boss)', () => {
    const skills = buildShipAbilities(bossShip('maglienza', 32)!);
    const active = abilitiesOf(skills, 'active');
    const charged = abilitiesOf(skills, 'charged');
    const passive = abilitiesOf(skills, 'passive');

    it('active: 120% damage and two Inferno II applications for 12 turns', () => {
        expect(active.map((a) => a.type)).toEqual(['damage', 'dot']);
        expect(active[0].config).toMatchObject({ type: 'damage', multiplier: 120 });
        expect(active[0].conditions).toEqual([]);
        expect(active[1].trigger).toBe('on-cast');
        expect(active[1].config).toMatchObject({
            type: 'dot',
            dotType: 'inferno',
            tier: 30,
            stacks: 2,
            duration: 12,
        });
    });

    it('charged: unconditional 155% damage, purge 3, Reversed Repairs for 3 turns', () => {
        expect(charged.map((a) => a.type)).toEqual(['damage', 'purge', 'debuff']);
        expect(charged[0].config).toMatchObject({ type: 'damage', multiplier: 155 });
        expect(charged[0].conditions).toEqual([]);
        expect(charged[1].config).toMatchObject({ type: 'purge', count: 3 });
        expect(charged[2].config).toMatchObject({
            type: 'debuff',
            buffName: 'Reversed Repairs',
            duration: 3,
            application: 'inflict',
        });
    });

    it('has infinite hacking: its debuffs always land', () => {
        expect(skills.alwaysLandsDebuffs).toBe(true);
    });

    it('is immune to control and charge loss', () => {
        expect(skills.controlImmune).toBe(true);
        expect(skills.chargeLossImmune).toBe(true);
    });

    it('takes 50% less damage from DoTs and from detonations', () => {
        const reductions = passive.filter((a) => a.type === 'incoming-reduction');
        expect(reductions.map((a) => a.config)).toEqual([
            {
                type: 'incoming-reduction',
                scope: 'dot',
                condition: 'always',
                pct: 50,
                critFamily: false,
            },
            {
                type: 'incoming-reduction',
                scope: 'detonation',
                condition: 'always',
                pct: 50,
                critFamily: false,
            },
        ]);
        for (const r of reductions) expect(r.target).toBe('self');
    });

    it('gains Repair Self Over Time I for 6 turns whenever a ship on its own side dies', () => {
        const grants = passive.filter(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Repair Self Over Time I'
        );
        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({ target: 'self', trigger: 'on-ally-destroyed' });
        expect(grants[0].config).toMatchObject({ duration: 6, isStackable: false });
        expect(grants[0].triggerRequiresDirectDeath).toBeUndefined();
        expect(grants[0].triggerKillerScope).toBeUndefined();
    });

    it('gains one stack of Enrage Attack III after each of its attacks, uncapped and permanent', () => {
        const grants = passive.filter(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Enrage Attack III'
        );
        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({ target: 'self', trigger: 'on-attack-cast' });
        expect(grants[0].config).toMatchObject({ isStackable: true, duration: 'recurring' });
        expect(grants[0].config.type === 'buff' && grants[0].config.maxStacks).toBeUndefined();
        expect(grants[0].config.type === 'buff' && grants[0].config.stackTrigger).toBeUndefined();
    });

    it('emits nothing else on the passive', () => {
        expect(passive.map((a) => a.type)).toEqual([
            'incoming-reduction',
            'incoming-reduction',
            'buff',
            'buff',
        ]);
    });
});

describe('Capo kit (bounty add)', () => {
    const skills = buildShipAbilities(npcShip('capo', 124)!);
    const active = abilitiesOf(skills, 'active');
    const charged = abilitiesOf(skills, 'charged');
    const passive = abilitiesOf(skills, 'passive');

    it('active: defence-scaled damage that removes 2 charges from every enemy hit', () => {
        expect(active.map((a) => a.type)).toEqual(['damage', 'additional-damage', 'charge']);
        expect(active[0].config).toMatchObject({ type: 'damage', multiplier: 0 });
        expect(active[1].config).toMatchObject({ stat: 'defense', pct: 100 });
        // An enemy-target charge amount is a removal (see the `charge` config doc).
        expect(active[2]).toMatchObject({
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'charge', amount: 2 },
        });
    });

    it('charged: defence-scaled damage and Disable for 1 turn', () => {
        expect(charged.map((a) => a.type)).toEqual([
            'damage',
            'additional-damage',
            'control',
            'debuff',
        ]);
        expect(charged[1].config).toMatchObject({ stat: 'defense', pct: 120 });
        expect(charged[3].config).toMatchObject({ buffName: 'Disable', duration: 1 });
    });

    it('passive: Stasis for 2 turns on its killer, only on a direct-damage death', () => {
        expect(passive).toHaveLength(1);
        expect(passive[0]).toMatchObject({
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-destroyed',
            triggerRequiresDirectDeath: true,
            config: { buffName: 'Stasis', duration: 2, application: 'inflict' },
        });
    });

    it('carries no immunity or always-land flags', () => {
        expect(skills.alwaysLandsDebuffs).toBeUndefined();
        expect(skills.controlImmune).toBeUndefined();
        expect(skills.chargeLossImmune).toBeUndefined();
    });
});

describe('Mamma passive statuses', () => {
    it('Repair Self Over Time I heals 10% of max HP per turn, each copy on its own timer', () => {
        const def = BUFFS.find((b) => b.name === 'Repair Self Over Time I')!;
        expect(def.type).toBe('buff');
        expect(parseBuffEffects(def.name, def.description).hotPct).toBe(10);
        expect(isIndependentInstance('Repair Self Over Time I')).toBe(true);
        expect(MANUAL_BUFF_ADDITIONS.find((b) => b.name === def.name)).toEqual(def);
    });

    it('Enrage Attack III is +6% attack, stackable without a cap and unremovable', () => {
        const def = BUFFS.find((b) => b.name === 'Enrage Attack III')!;
        expect(def.type).toBe('buff');
        expect(parseBuffEffects(def.name, def.description).attack).toBe(6);
        expect(isStackable(def.description)).toEqual({ stackable: true, maxStacks: undefined });
        expect(UNREMOVABLE_STATUSES.has('Enrage Attack III')).toBe(true);
        expect(MANUAL_BUFF_ADDITIONS.find((b) => b.name === def.name)).toEqual(def);
    });

    it('both passive triggers are live', () => {
        expect(LIVE_TRIGGERS.has('on-ally-destroyed')).toBe(true);
        expect(LIVE_TRIGGERS.has('on-attack-cast')).toBe(true);
    });
});
