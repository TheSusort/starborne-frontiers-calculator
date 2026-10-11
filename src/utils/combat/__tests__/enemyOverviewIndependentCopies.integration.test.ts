/**
 * The per-round enemy overview lists one row per Repair Over Time copy an enemy holds, the same
 * as the player panels: every Repair Over Time and Power Infused Nanobots grant is its own copy
 * (`isIndependentInstance`), so two enemy healers granting it to all allies leave each of them
 * holding two copies. Every other enemy self-buff still collapses to one row per name.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { ShipSkills } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

const rotKit = (id: string): ShipSkills => {
    const ship: Ship = {
        id,
        name: id,
        rarity: 'legendary',
        faction: 'MPL',
        type: 'SUPPORTER',
        baseStats: {
            hp: 1e9,
            attack: 0,
            defence: 0,
            hacking: 0,
            security: 0,
            crit: 0,
            critDamage: 0,
            speed: 150,
        },
        equipment: {},
        implants: {},
        refits: [],
        affinity: 'antimatter',
        activeSkillText:
            'This Unit grants <unit-skill>Repair Over Time II</unit-skill> to all allies for 2 turns.',
        activeTarget: 'self',
        activePattern: 'Pattern-Base',
        chargeSkillCharge: 0,
    };
    return {
        slots: buildShipAbilities(ship).slots.filter(
            (s) => s.slot === 'active' || s.slot === 'passive'
        ),
    };
};

const healer = (id: string, position: Position, speed: number): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: rotKit(id),
    role: 'SUPPORTER',
});

const run = () =>
    runCombat({
        enemyAttackers: [healer('healA', 'T1', 150), healer('healB', 'T2', 140)],
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: NO_SKILLS,
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1e9,
        hacking: 0,
        security: 0,
        mode: 'battle',
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        speed: 100,
    });

describe('enemy round overview lists each independent Repair Over Time copy', () => {
    it('an enemy holding two Repair Over Time copies lists two rows', () => {
        const effects = run().healing?.rounds[0]?.enemyEffects ?? [];
        const rows = effects.map(
            (e) => e.selfBuffs.filter((b) => b.buffName === 'Repair Over Time II').length
        );
        expect(Math.max(...rows, 0)).toBe(2);
    });
});
