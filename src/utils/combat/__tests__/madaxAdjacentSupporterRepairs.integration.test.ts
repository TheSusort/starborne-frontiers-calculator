/**
 * Madax: "When adjacent to a supporter, this Unit receives 30% more repairs and increases that
 * supporter's defense by 20% of this Unit's defense." The extra repairs cover EVERY repair he
 * receives (R147): his own reactive self-repair, another ship's cast repair, his own cast repair, a
 * Repair Over Time tick and a leech. "Adjacent" is board adjacency read when the repair lands.
 *
 * Real parsed passive (Madax, refit 4), mounted on both sides. Madax starts at 50% HP; nothing
 * damages him, so his HP gain over the round IS the repair that landed.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import type { CombatActor } from '../state';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import { hitKit } from '../__testutils__/realKitBoard';
import {
    mirrorBoard,
    realSlots,
    NO_SKILLS,
    type MirrorTeams,
    type ShipSpec,
} from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(7));

const MAX_HP = 100_000;
const START_HP = MAX_HP / 2;

const selfRepairActive = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'madax-self-repair',
            type: 'heal',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'heal', pct: 10, basis: 'hp' },
        },
    ],
});

const selfHotActive = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'madax-hot',
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Repair Over Time II',
                parsedEffects: { hotPct: 10 },
                stacks: 1,
                isStackable: false,
                duration: 5,
            },
        },
    ],
});

const allyRepairKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'ally-repair',
                    type: 'heal',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                },
            ],
        },
    ],
});

type Scenario = 'enemy-death' | 'ally-repair' | 'own-repair' | 'hot-tick';

interface Neighbour {
    role: ShipTypeName;
    position: Position;
}

/** HP Madax gained over one round. */
const madaxGain = (
    side: 'player' | 'enemy',
    scenario: Scenario,
    neighbour: Neighbour,
    neighbourDestroyed = false
): number => {
    const passive = realSlots('Madax', ['passive']);
    const madaxSlots =
        scenario === 'own-repair'
            ? [selfRepairActive(), ...passive]
            : scenario === 'hot-tick'
              ? [selfHotActive(), ...passive]
              : passive;
    const madax: ShipSpec = {
        id: 'madax',
        position: 'M4',
        speed: 1,
        role: 'DEFENDER',
        hp: MAX_HP,
        skills: { slots: madaxSlots },
    };
    const neighbourSpec: ShipSpec = {
        id: 'neighbour',
        position: neighbour.position,
        speed: scenario === 'ally-repair' ? 150 : 1,
        role: neighbour.role,
        // The repair is 10% of the healer's own max HP, so the healer matches Madax's.
        hp: scenario === 'ally-repair' ? MAX_HP : 1e9,
        skills: scenario === 'ally-repair' ? allyRepairKit() : NO_SKILLS,
    };
    const killer: ShipSpec = {
        id: 'killer',
        position: 'M1',
        speed: 150,
        role: 'ATTACKER',
        attack: 1_000,
        hp: 1e9,
        skills: scenario === 'enemy-death' ? hitKit(100) : NO_SKILLS,
    };
    const teams: MirrorTeams = {
        caster: [madax, neighbourSpec, killer],
        other: [
            { id: 'weak', position: 'M4', speed: 1, hp: scenario === 'enemy-death' ? 10 : 1e9 },
        ],
    };
    const { input, idOf } = mirrorBoard(teams, side);
    let live: CombatActor | undefined;
    runCombat({
        ...input,
        __testTapActors: (all: CombatActor[]) => {
            live = all.find((a) => a.id === idOf('madax'));
            if (live) live.currentHp = START_HP;
            const nb = all.find((a) => a.id === idOf('neighbour'));
            if (nb && neighbourDestroyed) {
                nb.currentHp = 0;
                nb.destroyedRound = 0;
            }
        },
    });
    return Math.round((live?.currentHp ?? 0) - START_HP);
};

const SUPPORTER_NEXT_TO_HIM: Neighbour = { role: 'SUPPORTER', position: 'M3' };
const ATTACKER_NEXT_TO_HIM: Neighbour = { role: 'ATTACKER', position: 'M3' };
const SUPPORTER_FAR_AWAY: Neighbour = { role: 'SUPPORTER', position: 'M1' };

const PLAIN: Record<Scenario, number> = {
    'enemy-death': 13_000, // his passive: repairs 13% of his max HP when an enemy dies
    'ally-repair': 10_000, // an ally repairs 10% of its max HP to all allies
    'own-repair': 10_000,
    'hot-tick': 10_000,
};

describe('Madax: 30% more repairs while adjacent to a supporter', () => {
    for (const side of ['player', 'enemy'] as const) {
        describe(`${side}-side`, () => {
            for (const scenario of Object.keys(PLAIN) as Scenario[]) {
                it(`${scenario}: ${PLAIN[scenario]} becomes ${Math.round(PLAIN[scenario] * 1.3)} beside a supporter`, () => {
                    expect(madaxGain(side, scenario, SUPPORTER_NEXT_TO_HIM)).toBe(
                        Math.round(PLAIN[scenario] * 1.3)
                    );
                });
                it(`${scenario}: control, beside an attacker the repair is the plain ${PLAIN[scenario]}`, () => {
                    expect(madaxGain(side, scenario, ATTACKER_NEXT_TO_HIM)).toBe(PLAIN[scenario]);
                });
                // The healer IS the neighbour in the ally-repair board, so it cannot be destroyed.
                if (scenario !== 'ally-repair') {
                    it(`${scenario}: control, a destroyed supporter beside him no longer counts`, () => {
                        expect(madaxGain(side, scenario, SUPPORTER_NEXT_TO_HIM, true)).toBe(
                            PLAIN[scenario]
                        );
                    });
                }
                it(`${scenario}: control, a supporter that is not adjacent changes nothing`, () => {
                    expect(madaxGain(side, scenario, SUPPORTER_FAR_AWAY)).toBe(PLAIN[scenario]);
                });
            }
        });
    }
});

describe('Madax: the extra repairs also cover a leech', () => {
    const PIECES: Record<string, { setBonus: string; rarity: string }> = {
        'leech-a': { setBonus: 'LEECH', rarity: 'legendary' },
        'leech-b': { setBonus: 'LEECH', rarity: 'legendary' },
    };
    const getGearPiece = (id: string): GearPiece | undefined =>
        PIECES[id] ? ({ id, ...PIECES[id] } as unknown as GearPiece) : undefined;
    const placement = (
        ship: Ship,
        position: Position,
        attack: number,
        speed: number
    ): BattlePlacement => ({
        ship,
        position,
        statOverrides: {
            attack,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            security: 0,
            defence: 0,
            hp: 1_000_000,
            speed,
        },
    });
    const plainShip = (id: string, type: Ship['type'], text: string): Ship => ({
        ...buildTraceShip('Madax')!,
        id,
        name: id,
        type,
        activeSkillText: text,
        chargeSkillText: undefined,
        firstPassiveSkillText: undefined,
        secondPassiveSkillText: undefined,
        thirdPassiveSkillText: undefined,
        refits: [],
        equipment: {},
    });
    const leechRepairs = (where: 'player' | 'enemy', neighbourRole: Ship['type']) => {
        const madaxShip: Ship = {
            ...buildTraceShip('Madax', { refitLevel: 4 })!,
            id: 'madax',
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            equipment: { weapon: 'leech-a', hull: 'leech-b' },
        };
        const madax = placement(madaxShip, 'M4', 1_000, 100);
        const neighbour = placement(
            plainShip(
                'neighbour',
                neighbourRole,
                'This Unit deals <unit-damage>0% damage</unit-damage>.'
            ),
            'M3',
            0,
            1
        );
        const dummy = placement(
            plainShip('dummy', 'ATTACKER', 'This Unit deals <unit-damage>0% damage</unit-damage>.'),
            'M4',
            0,
            1
        );
        const result = simulateBattle(
            where === 'player'
                ? { playerTeam: [madax, neighbour], enemyTeam: [dummy], rounds: 1 }
                : { playerTeam: [dummy], enemyTeam: [madax, neighbour], rounds: 1 },
            getGearPiece
        );
        const madaxId = where === 'player' ? 'attacker' : 'e:madax:0';
        return flattenCombatLog(result)
            .filter((e) => e.kind === 'heal' && e.actorId === madaxId)
            .flatMap((e) => e.targets)
            .filter((t) => t.targetId === madaxId)
            .map((t) => Math.round((t.amount ?? 0) + (t.overheal ?? 0)));
    };
    for (const where of ['player', 'enemy'] as const) {
        it(`${where}-side: a 150 leech is 195 beside a supporter`, () => {
            expect(leechRepairs(where, 'SUPPORTER')).toEqual([195]);
        });
        it(`${where}-side: control, beside an attacker the leech is the plain 150`, () => {
            expect(leechRepairs(where, 'ATTACKER')).toEqual([150]);
        });
    }
});
