/**
 * Protection never redirects a Bomb or a DoT (R181): the holder takes the whole Bomb burst, the
 * Echoing Burst, the death splash and every tick, and the protector's row stays empty, at any
 * defence on either ship. A direct hit on the same holder is still redirected, so the protector is
 * armed in every case.
 *
 * Every case runs with the holder on the player side and on the enemy side.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { CombatActor, PendingAccumulator, PendingBomb } from '../state';
import type { ShipSkills } from '../../../types/abilities';
import { textKit } from '../__testutils__/textKit';
import { mirrorBoard, ShipSpec } from './__fixtures__/mirrorBoard';

beforeEach(() => setupKeyedRng(11));

const SIDES = ['player', 'enemy'] as const;
const BOMB = 1000;

const protectionAura = (stacks: number): ShipSkills => ({
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
                        stacks,
                        isStackable: true,
                    },
                },
            ],
        },
    ],
});

const bomb = (): PendingBomb => ({
    countdown: 1,
    damagePerStack: BOMB,
    stacks: 1,
    tier: 100,
    sourceId: 'seed',
    detonationDamageModifier: 0,
    splashModifier: 0,
});

const accumulator = (): PendingAccumulator => ({
    accumulated: 10_000,
    pct: 10,
    roundsRemaining: 1,
    sourceId: 'seed',
});

interface Board {
    holderDefence?: number;
    protectorDefence?: number;
    holderHp?: number;
    extra?: ShipSpec[];
    other?: ShipSpec[];
    numRounds?: number;
}

const teams = (b: Board) => ({
    caster: [
        { id: 'bystander', position: 'M2', speed: 1 },
        {
            id: 'holder',
            position: 'M4',
            speed: 50,
            defence: b.holderDefence ?? 0,
            hp: b.holderHp,
        },
        {
            id: 'protector',
            position: 'M1',
            speed: 1,
            defence: b.protectorDefence ?? 0,
            skills: protectionAura(3),
        },
        ...(b.extra ?? []),
    ] as ShipSpec[],
    other: b.other ?? ([{ id: 'inert', position: 'M4', speed: 1 }] as ShipSpec[]),
    numRounds: b.numRounds ?? 1,
});

const run = (
    side: 'player' | 'enemy',
    b: Board,
    seed: (actor: (id: string) => CombatActor) => void
) => {
    const { input, idOf } = mirrorBoard(teams(b), side);
    const bus = createEventBus();
    const ticks: { victim: string; damage: number }[] = [];
    bus.on('dot-ticked', (e) => ticks.push({ victim: e.targetId, damage: e.damage }));
    const result = runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => seed((id) => all.find((a) => a.id === idOf(id))!),
    });
    const incoming = (id: string): number =>
        result.rounds.reduce(
            (sum, rd) => sum + (rd.perActorIncoming?.[idOf(id)]?.incoming ?? 0),
            0
        );
    return { incoming, ticks, idOf };
};

describe.each(SIDES)('with the holder on the %s side', (side) => {
    it.each([
        ['no defence on either ship', 0, 0],
        ['holder at 3000 defence', 3000, 0],
        ['protector at 3000 defence', 0, 3000],
        ['both at 3000 defence', 3000, 3000],
    ])('a Bomb burst lands whole on the holder: %s', (_label, holderDefence, protectorDefence) => {
        const r = run(side, { holderDefence, protectorDefence }, (actor) =>
            actor('holder').pendingBombs.push(bomb())
        );
        expect(r.incoming('holder')).toBeCloseTo(BOMB, 6);
        expect(r.incoming('protector')).toBe(0);
    });

    it('an Echoing Burst lands whole on the holder', () => {
        const r = run(side, { protectorDefence: 3000 }, (actor) =>
            actor('holder').pendingAccumulators.push(accumulator())
        );
        expect(r.incoming('holder')).toBeCloseTo(1000, 6);
        expect(r.incoming('protector')).toBe(0);
    });

    it("a dying holder's Bomb splash lands whole on its adjacent ally, not on that ally's protector", () => {
        const r = run(
            side,
            {
                holderHp: 1,
                extra: [{ id: 'neighbour', position: 'M3', speed: 1 }],
            },
            (actor) => actor('holder').pendingBombs.push(bomb())
        );
        // Tier 100 splashes a quarter of the Bomb.
        expect(r.incoming('neighbour')).toBeCloseTo(BOMB / 4, 6);
        expect(r.incoming('protector')).toBe(0);
    });

    it('a DoT tick lands whole on the holder', () => {
        const r = run(
            side,
            {
                protectorDefence: 3000,
                numRounds: 3,
                other: [
                    {
                        id: 'dealer',
                        position: 'M4',
                        speed: 100,
                        attack: 1000,
                        hacking: 1e6,
                        skills: textKit('Dealer', {
                            active: 'This Unit inflicts <unit-skill>Inferno III</unit-skill> for 3 turns.',
                        }),
                    },
                ],
            },
            () => {}
        );
        const holderTicks = r.ticks
            .filter((t) => t.victim === r.idOf('holder'))
            .reduce((sum, t) => sum + t.damage, 0);
        expect(holderTicks).toBeGreaterThan(0);
        expect(r.incoming('holder')).toBeCloseTo(holderTicks, 6);
        expect(r.incoming('protector')).toBe(0);
    });
});
