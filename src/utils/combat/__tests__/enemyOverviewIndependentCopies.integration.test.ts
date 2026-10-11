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

const ROT =
    'This Unit grants <unit-skill>Repair Over Time II</unit-skill> to all allies for 2 turns.';
const EXTRA = 'Once per round, this Unit <unit-skill>gains one extra action</unit-skill>.';

const kit = (id: string, activeSkillText: string): ShipSkills => {
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
        activeSkillText,
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

const healer = (id: string, position: Position, speed: number, text = ROT): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: kit(id, text),
    role: 'SUPPORTER',
});

const run = (extraTurnActor: boolean, rot = ROT) =>
    runCombat({
        enemyAttackers: [
            healer('healA', 'T1', 150, rot),
            healer('healB', 'T2', 140, rot),
            healer(
                'actor',
                'T3',
                130,
                extraTurnActor ? EXTRA : 'This Unit deals <unit-damage>100% damage</unit-damage>.'
            ),
        ],
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

const copiesOn = (id: string, extraTurnActor: boolean, rot = ROT): number => {
    const e = run(extraTurnActor, rot).healing?.rounds[0]?.enemyEffects.find(
        (x) => x.enemyId === id
    );
    return e?.selfBuffs.filter((b) => b.buffName === 'Repair Over Time II').length ?? 0;
};

describe('enemy round overview lists each independent Repair Over Time copy', () => {
    it('an enemy holding two Repair Over Time copies lists two rows', () => {
        expect(copiesOn('actor', false)).toBe(2);
    });

    it('an enemy that takes an extra turn still lists each copy once', () => {
        expect(copiesOn('actor', true)).toBe(2);
    });

    it('an enemy whose copies expired before its extra turn lists none', () => {
        const ONE_TURN =
            'This Unit grants <unit-skill>Repair Over Time II</unit-skill> to all allies for 1 turn.';
        expect(copiesOn('actor', true, ONE_TURN)).toBe(0);
    });
});
