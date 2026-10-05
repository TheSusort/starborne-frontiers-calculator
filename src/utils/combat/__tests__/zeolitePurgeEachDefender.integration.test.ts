/**
 * Zeolite's passive "When this Unit deals damage to a defender it purges 1 buff from that enemy"
 * purges EACH struck defender (AoE rulings 1–2: a "defender" gate on a pattern skill is checked per
 * struck enemy, and "that enemy" is each qualifying one). An attacker struck alongside keeps its
 * buff, and a defender outside the pattern is never touched.
 *
 * Real parsed charged + passive (buildTraceShip, refit 4), mounted on both sides. Her charged skill
 * carries no purge of its own, so every purge read here is the passive's. Every enemy grants
 * itself a buff on its own (earlier) turn, so each struck ship has something to lose.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { ShipSkills } from '../../../types/abilities';
import type { ShipTypeName } from '../../../constants/shipTypes';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(7));

const selfBuff = (id: string): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `${id}-buff`,
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Attack Up II',
                        parsedEffects: { attack: 0 },
                        stacks: 1,
                        isStackable: false,
                        duration: 3,
                    },
                },
            ],
        },
    ],
});

type Label = 'A' | 'B' | 'C';
const POS = { A: 'M4', B: 'M3', C: 'B1' } as const;

const teams = (roles: Record<Label, ShipTypeName>): MirrorTeams => ({
    caster: [
        {
            id: 'zeolite',
            position: 'M4',
            attack: 1000,
            speed: 10,
            chargeCount: 1,
            startCharged: true,
            hasChargedSkill: true,
            pattern: 'Pattern-Cone-Range-1',
            chargedPattern: 'Pattern-Burst-Range-1',
            skills: { slots: realSlots('Zeolite', ['charged', 'passive']) },
        },
    ],
    other: (['A', 'B', 'C'] as Label[]).map((l): ShipSpec => ({
        id: `e-${l}`,
        position: POS[l],
        role: roles[l],
        speed: 150,
        skills: selfBuff(`e-${l}`),
    })),
});

const run = (roles: Record<Label, ShipTypeName>, side: 'player' | 'enemy') => {
    const { input, idOf } = mirrorBoard(teams(roles), side);
    const label = new Map((['A', 'B', 'C'] as Label[]).map((l) => [idOf(`e-${l}`), l]));
    const caster = idOf('zeolite');
    const bus = createEventBus();
    const purged: string[] = [];
    const struck = new Set<string>();
    bus.on('purge-performed', (e) => {
        if (e.casterId === caster) purged.push(`${label.get(e.targetId)} x${e.count}`);
    });
    bus.on('attacked', (e) => {
        if (e.attackerId === caster) struck.add(label.get(e.targetId) ?? e.targetId);
    });
    runCombat({ ...input, bus });
    return { purged: purged.sort(), struck: [...struck].sort() };
};

describe("Zeolite: 'deals damage to a defender … purges 1 buff from that enemy' per struck defender", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: aimed attacker A, covered defender B → B is purged, A is not`, () => {
            expect(run({ A: 'ATTACKER', B: 'DEFENDER', C: 'DEFENDER' }, side)).toEqual({
                purged: ['B x1'],
                struck: ['A', 'B'],
            });
        });
        it(`${side}-side reverse board: aimed defender A, covered attacker B → A only`, () => {
            expect(run({ A: 'DEFENDER', B: 'ATTACKER', C: 'DEFENDER' }, side)).toEqual({
                purged: ['A x1'],
                struck: ['A', 'B'],
            });
        });
        it(`${side}-side: both struck ships defenders → both purged, C outside untouched`, () => {
            expect(run({ A: 'DEFENDER', B: 'DEFENDER', C: 'DEFENDER' }, side)).toEqual({
                purged: ['A x1', 'B x1'],
                struck: ['A', 'B'],
            });
        });
        it(`${side}-side: no struck defender → nothing purged`, () => {
            expect(run({ A: 'ATTACKER', B: 'SUPPORTER', C: 'DEFENDER' }, side)).toEqual({
                purged: [],
                struck: ['A', 'B'],
            });
        });
    }
});
