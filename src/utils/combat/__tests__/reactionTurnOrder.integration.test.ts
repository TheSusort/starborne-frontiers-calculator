/**
 * Reactions to the SAME event resolve in turn order across both sides — fastest owner first, the
 * usual tiebreaks — and a reaction CAUSED by a reaction resolves after the event that caused it,
 * inside the same turn (owner ruling 39, 2026-10-05).
 *
 * The owner's example: Cultivator cleanses a debuff off itself. Two passives react to that cleanse:
 * the opposing Grif ("When an enemy cleanses a debuff, deals 75% damage") and Cultivator's own
 * "When this Unit cleanses a debuff, it also repairs that ally for 4%". They resolve in turn order.
 * Grif's hit then wakes Cultivator's "when an ally is directly damaged … repairs that ally 8%",
 * which comes after both.
 *
 * Real passives (Grif, Cultivator) and Cultivator's real active ("cleanses 1 debuff"); Cultivator
 * is alone on its side and starts with one Corrosion stack, so its cast cleanses itself.
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
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data)'
        );
    }
});
beforeEach(() => setupKeyedRng(7));

const [cultivatorActive, cultivatorPassive] = realSlots('Cultivator', ['active', 'passive']);
const CULTIVATOR: ShipSkills = { slots: [cultivatorActive, cultivatorPassive] };
const GRIF: ShipSkills = {
    slots: [{ slot: 'active', abilities: [] }, ...realSlots('Grif', ['passive'])],
};
const repair4Id = cultivatorPassive.abilities.find((a) => a.trigger === 'on-own-cleanse')!.id;
const repair8Id = cultivatorPassive.abilities.find((a) => a.trigger === 'on-ally-attacked')!.id;

/** The reactions inside Cultivator's round-1 turn, in the order they resolved. */
const reactionsInCultivatorTurn = (
    side: 'player' | 'enemy',
    grifSpeed: number,
    cultivatorSpeed: number,
    withGrif = true
): string[] => {
    const teams: MirrorTeams = {
        caster: withGrif
            ? [{ id: 'grif', position: 'M4', speed: grifSpeed, attack: 1000, skills: GRIF }]
            : [{ id: 'grif', position: 'M4', speed: grifSpeed, skills: { slots: [] } }],
        other: [
            {
                id: 'cultivator',
                position: 'M4',
                speed: cultivatorSpeed,
                hp: 100_000,
                skills: CULTIVATOR,
            },
        ],
        numRounds: 1,
    };
    const { input, idOf } = mirrorBoard(teams, side);
    const cultivator = idOf('cultivator');
    const grif = idOf('grif');
    const bus = createEventBus();
    const order: string[] = [];
    let inTurn = false;
    bus.on('turn-started', (e) => {
        inTurn = e.actorId === cultivator;
    });
    bus.on('turn-ended', (e) => {
        if (e.actorId === cultivator) inTurn = false;
    });
    bus.on('reactive-damage-performed', (e) => {
        if (inTurn && e.sourceId === grif && e.targetId === cultivator) order.push('grif 75%');
    });
    bus.on('reactive-heal-performed', (e) => {
        if (!inTurn || e.casterId !== cultivator) return;
        if (e.sourceAbilityId === repair4Id) order.push('repair 4%');
        else if (e.sourceAbilityId === repair8Id) order.push('repair 8%');
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            all.find((a) => a.id === cultivator)!.corrosionEntries.push({
                stacks: 1,
                tier: 3,
                remainingRounds: 5,
                sourceId: grif,
            });
        },
    });
    return order;
};

describe.each(['player', 'enemy'] as const)(
    "Cultivator's self-cleanse: Grif on the %s side",
    (side) => {
        it('Grif faster: Grif’s hit, then the 4% repair, then the 8% repair Grif’s hit woke', () => {
            expect(reactionsInCultivatorTurn(side, 200, 100)).toEqual([
                'grif 75%',
                'repair 4%',
                'repair 8%',
            ]);
        });

        it('reverse board, Cultivator faster: the 4% repair, then Grif’s hit, then the 8%', () => {
            expect(reactionsInCultivatorTurn(side, 100, 200)).toEqual([
                'repair 4%',
                'grif 75%',
                'repair 8%',
            ]);
        });

        it('negative: no Grif → only the 4% repair', () => {
            expect(reactionsInCultivatorTurn(side, 200, 100, false)).toEqual(['repair 4%']);
        });
    }
);
