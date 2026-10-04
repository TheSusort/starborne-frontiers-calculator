/**
 * Paracelsus: "Upon being destroyed by direct damage, this Unit deals damage equal to 50% of its
 * max HP and grants all allies Everliving Regeneration II for 4 turns." One condition heads the
 * whole sentence: a death to a damage-over-time tick fires neither half. Salvation's unqualified
 * "When this Unit is destroyed" still fires on any death.
 *
 * Real parsed passives (buildTraceShip, refit 4), mounted on both sides. The dying ship sits at M4
 * at 1 HP with an ally behind it at M3. A faster enemy either hits it (attack 1000) or carries no
 * attack and leaves it to a seeded Corrosion stack the enemy itself applied.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import { mirrorBoard, realSlots, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(7));

const hit: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'killer-hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
};

const teams = (ship: string, by: 'hit' | 'corrosion'): MirrorTeams => ({
    caster: [
        {
            id: 'dying',
            position: 'M4',
            speed: 10,
            hp: 1000,
            skills: { slots: [{ slot: 'active', abilities: [] }, ...realSlots(ship, ['passive'])] },
        },
        { id: 'ally', position: 'M3', speed: 5 },
    ],
    other: [
        {
            id: 'killer',
            position: 'M4',
            speed: 150,
            attack: by === 'hit' ? 1000 : 0,
            skills: by === 'hit' ? hit : undefined,
        },
    ],
});

const run = (ship: string, by: 'hit' | 'corrosion', side: 'player' | 'enemy') => {
    const { input, idOf } = mirrorBoard(teams(ship, by), side);
    const dying = idOf('dying');
    const killer = idOf('killer');
    const bus = createEventBus();
    let death: { direct: boolean } | undefined;
    const grants: string[] = [];
    let retaliation = 0;
    let repairs = 0;
    bus.on('ship-destroyed', (e) => {
        if (e.actorId === dying) death = { direct: e.byDirectDamage === true };
    });
    bus.on('buff-applied', (e) => {
        if (e.buffName === 'Everliving Regeneration II') grants.push(e.actorId);
    });
    bus.on('reactive-damage-performed', (e) => {
        if (e.sourceId === dying) retaliation++;
    });
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === dying) repairs++;
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            const d = all.find((a) => a.id === dying)!;
            d.currentHp = 1;
            if (by === 'corrosion')
                d.corrosionEntries.push({
                    stacks: 1,
                    tier: 9,
                    remainingRounds: 3,
                    sourceId: killer,
                });
        },
    });
    return { death, grants: grants.length, retaliation, repairs };
};

describe("Paracelsus: 'Upon being destroyed by direct damage' gates both halves", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: killed by a direct hit → retaliation and Everliving Regeneration II`, () => {
            const r = run('Paracelsus', 'hit', side);
            expect(r.death).toEqual({ direct: true });
            expect(r.retaliation).toBe(1);
            expect(r.grants).toBeGreaterThan(0);
        });
        it(`${side}-side: killed by a Corrosion tick → neither half`, () => {
            expect(run('Paracelsus', 'corrosion', side)).toEqual({
                death: { direct: false },
                grants: 0,
                retaliation: 0,
                repairs: 0,
            });
        });
    }
});

describe("Salvation: 'When this Unit is destroyed' still fires on any death", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: killed by a Corrosion tick → still repairs`, () => {
            const r = run('Salvation', 'corrosion', side);
            expect(r.death).toEqual({ direct: false });
            expect(r.repairs).toBe(1);
        });
    }
});
