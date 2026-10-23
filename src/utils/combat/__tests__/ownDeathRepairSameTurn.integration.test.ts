/**
 * A ship killed by the DoT tick at the start of its own turn resolves its own on-death effects in
 * THAT turn, as the last thing it does (owner ruling 2026-10-22), before the next ship acts.
 *
 * Real kit: Salvation ("When this Unit is destroyed it repairs 60% of its max HP to all allies"),
 * docs/ship-skills.csv through the production parser. An igniter lays a lethal Inferno on her;
 * she dies to its tick at her round-1 turn start, and her slower ally acts after her.
 *
 * A lethal start-of-turn tick has two engine sites, split by whether the dying ship is the focus
 * (the heal-target tick) or any other ship (the per-victim tick), so the board runs with her as
 * the focus, as a walked player ally, and on the enemy side.
 */
import { describe, it, expect } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { boardInput, NO_KIT, realKit, type BoardUnit } from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';

/** Inferno III ×3 on the front enemy: one tick is 1,350 off a 1,000-attack igniter. */
const infernoKit: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'inferno',
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'dot', dotType: 'inferno', tier: 45, stacks: 3, duration: 3 },
                },
            ],
        },
    ],
};

type Arm = 'focus' | 'player-ally' | 'enemy';

interface Timeline {
    /** Turn-starts, deaths and repairs, in emit order. */
    steps: string[];
    salvationRepairs: number;
}

const run = (arm: Arm): Timeline => {
    const salvation: BoardUnit = {
        id: 'salvation',
        kit: realKit('Salvation'),
        position: 'M4',
        speed: 200,
        hp: 1000,
    };
    const ally: BoardUnit = { id: 'ally', kit: NO_KIT, position: 'T4', speed: 100, hp: 1e6 };
    const igniter: BoardUnit = {
        id: 'igniter',
        kit: infernoKit,
        position: 'M4',
        speed: 300,
        attack: 1000,
        hacking: 1e6,
    };
    const { input, id } =
        arm === 'focus'
            ? boardInput('player', salvation, [ally], [igniter], 1)
            : arm === 'player-ally'
              ? boardInput('player', ally, [salvation], [igniter], 1)
              : boardInput('enemy', salvation, [ally], [igniter], 1);
    const name = new Map([salvation, ally, igniter].map((u) => [id(u), u.id]));
    const bus = createEventBus();
    const timeline: Timeline = { steps: [], salvationRepairs: 0 };
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        timeline.steps.push(`turn ${name.get(e.actorId)}`);
    });
    bus.on('ship-destroyed', (e: Extract<CombatEvent, { type: 'ship-destroyed' }>) => {
        timeline.steps.push(`dies ${name.get(e.actorId)}`);
    });
    bus.on(
        'reactive-heal-performed',
        (e: Extract<CombatEvent, { type: 'reactive-heal-performed' }>) => {
            if (e.casterId !== id(salvation)) return;
            timeline.salvationRepairs += e.amount;
            timeline.steps.push('salvation repairs');
        }
    );
    runCombat({ ...input, bus });
    return timeline;
};

describe("Salvation's own-death repair resolves in the turn she dies", () => {
    for (const arm of ['focus', 'player-ally', 'enemy'] as const) {
        it(`as ${arm}: the repair follows her death before her ally's turn`, () => {
            const t = run(arm);
            expect(t.salvationRepairs).toBeGreaterThan(0);
            expect(t.steps).toEqual([
                'turn igniter',
                'turn salvation',
                'dies salvation',
                'salvation repairs',
                'turn ally',
            ]);
        });
    }
});
