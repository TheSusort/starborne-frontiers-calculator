/**
 * Two statuses that grant FLAT defence, each checked by the hit its holder takes, against a
 * control unit that simply has that much defence and no status:
 *
 *  - Terran Guard (Panon, Makoli). Catalogue: "Increases Defense by 5/10/15% of the applying
 *    unit's Defense." Panon at defence 5000 gives an ally at 1000 +500 (Terran Guard II), so the
 *    ally takes a 1500-defence hit; Panon at 1000 gives +100.
 *  - Magnetized Shielding (Vindicator). Catalogue: "Increases Defense by 10 times the Unit's
 *    Security and is unremovable." Vindicator at defence 2000 and security 100 takes a
 *    3000-defence hit; at security 300, a 5000-defence one. The security is read live: a Security
 *    Down II (-40) landed by the attacker's own cast first gives 2000 + 10 x 260 = 4600.
 *
 * The opponent hits for 10,000 attack, crit 0, so a hit's size depends only on the struck unit's
 * defence. Every case runs with the carrier on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parseBuffEffects } from '../../calculators/buffParser';
import { BUFFS } from '../../../constants/buffs';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const withoutPassive = (ship: string): ShipSkills => ({
    slots: realKit(ship).slots.filter((s) => s.slot !== 'passive'),
});

/** The opponent's hits on `targetUnit`, per round (what it TOOK). */
const takenByRound = (
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    targetUnit: BoardUnit,
    opponentKit: ShipSkills,
    rounds: number
): Record<number, number> => {
    const opponent: BoardUnit = {
        id: 'opponent',
        kit: opponentKit,
        position: 'M4',
        speed: 200,
        attack: 10_000,
        chargeCount: 99,
    };
    const { input, id } = boardInput(placement, carrier, allies, [opponent], rounds);
    const bus = createEventBus();
    const out: Record<number, number> = {};
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId !== id(opponent) || e.targetId !== id(targetUnit)) return;
        out[e.round] = (out[e.round] ?? 0) + Math.round(e.takenDamage ?? 0);
    });
    runCombat({ ...input, bus });
    return out;
};

/** A unit with `defence` and no status, hit by the same opponent. */
const controlTaken = (placement: Placement, defence: number, opponentKit = hitKit()) => {
    const plain: BoardUnit = { id: 'plain', kit: NO_KIT, position: 'M4', speed: 1, defence };
    return takenByRound(placement, plain, [], plain, opponentKit, 1)[1];
};

describe.each<Placement>(['player', 'enemy'])('carrier on the %s side', (placement) => {
    describe('Terran Guard snapshots the APPLIER’s defence', () => {
        const panonBoard = (panonDefence: number) => {
            const panon: BoardUnit = {
                id: 'panon',
                kit: withoutPassive('Panon'),
                position: 'M3',
                speed: 300,
                defence: panonDefence,
                chargeCount: 4,
            };
            const ally: BoardUnit = {
                id: 'ally',
                kit: NO_KIT,
                position: 'M4',
                speed: 1,
                defence: 1000,
            };
            return takenByRound(placement, panon, [ally], ally, hitKit(), 1)[1];
        };

        it('Panon at 5000 defence: the ally takes a 1500-defence hit', () => {
            expect(panonBoard(5000)).toBe(controlTaken(placement, 1500));
        });

        it('Panon at 1000 defence: the ally takes an 1100-defence hit', () => {
            expect(panonBoard(1000)).toBe(controlTaken(placement, 1100));
        });

        it('Panon on himself, recasting every round: 5500 both rounds (no compounding)', () => {
            const panon: BoardUnit = {
                id: 'panon',
                kit: withoutPassive('Panon'),
                position: 'M4',
                speed: 300,
                defence: 5000,
                chargeCount: 99,
            };
            const taken = takenByRound(placement, panon, [], panon, hitKit(), 2);
            const control = controlTaken(placement, 5500);
            expect(taken).toEqual({ 1: control, 2: control });
        });
    });

    describe('Magnetized Shielding adds 10x the holder’s live Security', () => {
        const vindicator = (security: number): BoardUnit => ({
            id: 'vindicator',
            kit: realKit('Vindicator'),
            position: 'M4',
            speed: 1,
            defence: 2000,
            security,
            chargeCount: 4,
        });

        it('security 100: a 3000-defence hit', () => {
            const v = vindicator(100);
            expect(takenByRound(placement, v, [], v, hitKit(), 1)[1]).toBe(
                controlTaken(placement, 3000)
            );
        });

        it('security 300: a 5000-defence hit', () => {
            const v = vindicator(300);
            expect(takenByRound(placement, v, [], v, hitKit(), 1)[1]).toBe(
                controlTaken(placement, 5000)
            );
        });

        it('a Security Down II landed first lowers it: a 4600-defence hit', () => {
            const entry = BUFFS.find((b) => b.name === 'Security Down II')!;
            const shredThenHit: ShipSkills = {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'sec-down',
                                type: 'debuff',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: {
                                    type: 'debuff',
                                    buffName: entry.name,
                                    parsedEffects: parseBuffEffects(entry.name, entry.description),
                                    stacks: 1,
                                    isStackable: false,
                                    duration: 2,
                                    application: 'apply',
                                },
                            },
                            ...hitKit().slots[0].abilities,
                        ],
                    },
                ],
            };
            const v = vindicator(300);
            expect(takenByRound(placement, v, [], v, shredThenHit, 1)[1]).toBe(
                controlTaken(placement, 4600, shredThenHit)
            );
        });
    });
});
