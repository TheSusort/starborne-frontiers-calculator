/**
 * An All Targetable cast (`Pattern-All-Targetable`) strikes only the enemies its caster could
 * target (`targetableEnemies`, positionalBinding.ts): a Taunter when one stands, else every enemy
 * not in Stealth. Every enemy it strikes is a primary target (R110). Every case runs with the
 * attacker on the player side and on the enemy side.
 *
 * Control arm: plain `Pattern-All` on the same boards strikes every enemy.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import {
    boardInput,
    hitKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';

beforeEach(() => setupKeyedRng(17));

const SIDES: Placement[] = ['player', 'enemy'];

const selfGrant = (buffName: string): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `grant-${buffName}`,
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName,
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 3,
                    },
                },
            ],
        },
    ],
});

const attacker = (pattern: string): BoardUnit => ({
    id: 'caster',
    kit: hitKit(100),
    position: 'M4',
    speed: 10,
    attack: 1_000,
    target: parseTarget('front'),
    pattern: parsePattern(pattern),
});

const unit = (id: string, position: BoardUnit['position'], kit: ShipSkills): BoardUnit => ({
    id,
    kit,
    position,
    speed: 300,
    hp: 1e9,
});

/** Round-1 victims of the caster's cast, each with its isPrimaryTarget flags. */
const castVictims = (
    placement: Placement,
    caster: BoardUnit,
    opponents: BoardUnit[]
): Record<string, (boolean | undefined)[]> => {
    const { input, id } = boardInput(placement, caster, [], opponents, 1);
    const all = [caster, ...opponents];
    const nameOf = (actorId: string) => all.find((u) => id(u) === actorId)?.id ?? actorId;
    const casterId = id(caster);
    const out: Record<string, (boolean | undefined)[]> = {};
    const bus = createEventBus();
    bus.on('attacked', (e) => {
        if (e.attackerId !== casterId || e.round !== 1 || e.reactiveHitId !== undefined) return;
        (out[nameOf(e.targetId)] ??= []).push(e.isPrimaryTarget);
    });
    runCombat({ ...input, bus });
    return out;
};

describe.each(SIDES)('All Targetable (caster on the %s side)', (placement) => {
    const board = (taunter: boolean): BoardUnit[] => [
        unit('front', 'M4', NO_KIT),
        unit('taunter', 'T4', taunter ? selfGrant('Taunt') : NO_KIT),
        unit('hidden', 'B4', selfGrant('Stealth')),
    ];

    it('a Taunter standing → only the Taunter is struck, as a primary target', () => {
        expect(castVictims(placement, attacker('Pattern-All-Targetable'), board(true))).toEqual({
            taunter: [true],
        });
    });

    it('no Taunt → every enemy not in Stealth, each a primary target', () => {
        expect(castVictims(placement, attacker('Pattern-All-Targetable'), board(false))).toEqual({
            front: [true],
            taunter: [true],
        });
    });

    it('control: plain Pattern-All strikes every enemy', () => {
        expect(castVictims(placement, attacker('Pattern-All'), board(true))).toEqual({
            front: [true],
            taunter: [true],
            hidden: [true],
        });
    });
});
