/**
 * A protector is not "directly damaged" by its Protection share (R139b), so the share rolls no
 * incoming block (Ironclad, Shadowguard) and does not advance Ironclad's per-round hit counter:
 *  - an ally hit for 10,000 sends a 3-stack protector three 1,000 pieces, none blocked;
 *  - the protector's first real hit of the round is its first direct hit, so Ironclad
 *    ("from the 2nd hit onward") does not block it.
 * Ironclad still blocks the protector's own second direct hit (control).
 *
 * The block rolls are pinned to always proc (procChance 1, blockPct 0.5). Every case runs with the
 * protector on the player side and on the enemy side.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { ShipSkills } from '../../../types/abilities';
import { hitKit } from '../__testutils__/realKitBoard';
import { mirrorBoard, ShipSpec } from './__fixtures__/mirrorBoard';

beforeEach(() => setupKeyedRng(3));

const SIDES = ['player', 'enemy'] as const;
const HIT = 10_000;

const protectorKit = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'protection-aura',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Protection',
                        parsedEffects: {},
                        stacks: 3,
                        isStackable: true,
                    },
                },
                {
                    id: 'ironclad-always',
                    type: 'incoming-block',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'incoming-block',
                        condition: 'nth-hit-2plus',
                        procChance: 1,
                        blockPct: 0.5,
                        oncePerRound: false,
                    },
                },
            ],
        },
    ],
});

const hitter = (id: string, speed: number, target: string): ShipSpec => ({
    id,
    position: 'M4',
    speed,
    attack: HIT,
    target,
    skills: hitKit(100),
});

const run = (side: 'player' | 'enemy', hitters: ShipSpec[]) => {
    const { input, idOf } = mirrorBoard(
        {
            caster: [
                { id: 'victim', position: 'M4', speed: 1 },
                { id: 'protector', position: 'M1', speed: 1, skills: protectorKit() },
            ],
            other: hitters,
        },
        side
    );
    const rounds = runCombat(input).rounds;
    return (id: string) =>
        rounds.reduce((sum, rd) => sum + (rd.perActorIncoming?.[idOf(id)]?.incoming ?? 0), 0);
};

describe.each(SIDES)('with the protector on the %s side', (side) => {
    it('rolls no block on any piece of the share', () => {
        const incoming = run(side, [hitter('a', 50, 'front')]);
        expect(incoming('victim')).toBeCloseTo(HIT * 0.7, 6);
        // Three 1,000 pieces, all whole.
        expect(incoming('protector')).toBeCloseTo(HIT * 0.3, 6);
    });

    it("leaves the protector's first direct hit unblocked after it took a share", () => {
        const incoming = run(side, [hitter('a', 50, 'front'), hitter('b', 40, 'back')]);
        expect(incoming('protector')).toBeCloseTo(HIT * 0.3 + HIT, 6);
    });

    it("still blocks the protector's second direct hit (control)", () => {
        const incoming = run(side, [hitter('b', 40, 'back'), hitter('c', 30, 'back')]);
        expect(incoming('protector')).toBeCloseTo(HIT + HIT * 0.5, 6);
    });
});
