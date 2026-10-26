/**
 * Valkyrie's charged skill "deals 240% damage, inflicts Inc. Damage Up II and Echoing Burst for 2
 * turns". Clauses resolve in written order, so the damage lands first, and an Echoing Burst written
 * after it does not land on a ship that damage destroyed (owner ruling 2026-10-22, #738): the wreck
 * holds no Echoing Burst, and the log records the dropped landing.
 *
 * Board: Valkyrie (real kit, 1,000 attack, charged at the start) strikes the enemy front cell M4.
 * A 1,000-HP ship there dies to the 2,400 hit; a sturdy one survives (control). A sturdy
 * bystander at B1 keeps the side alive. The covered-victim path runs the same with a Circle
 * pattern: the M4 anchor survives and a 1,000-HP ship at M3 dies to the covered half-hit.
 * Every case runs with Valkyrie on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { CombatActor } from '../state';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(11));

const valkyrie = (chargedPattern?: string): ShipSpec => ({
    id: 'valkyrie',
    position: 'M4',
    speed: 200,
    attack: 1000,
    hacking: 1e6,
    hp: 1e9,
    chargeCount: 2,
    startCharged: true,
    hasChargedSkill: true,
    ...(chargedPattern ? { chargedPattern } : {}),
    skills: { slots: realSlots('Valkyrie', ['active', 'charged']) },
});

const run = (side: 'player' | 'enemy', foes: ShipSpec[], chargedPattern?: string) => {
    const { input, idOf } = mirrorBoard(
        { caster: [valkyrie(chargedPattern)], other: foes, numRounds: 1 },
        side
    );
    const bus = createEventBus();
    const dropped: { target: string; label: string }[] = [];
    const specOf = (id: string) => foes.find((f) => idOf(f.id) === id)?.id ?? id;
    bus.on('landing-dropped', (e: Extract<CombatEvent, { type: 'landing-dropped' }>) =>
        dropped.push({ target: specOf(e.targetId), label: e.label })
    );
    const inflicted: string[] = [];
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.buffName === 'Echoing Burst') inflicted.push(specOf(e.targetId));
    });
    let actors: CombatActor[] = [];
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            actors = all;
        },
    });
    const ship = (spec: string) => actors.find((a) => a.id === idOf(spec));
    return {
        held: (spec: string) => ship(spec)?.pendingAccumulators.length,
        destroyed: (spec: string) => ship(spec)?.destroyedRound !== undefined,
        dropped,
        inflicted,
    };
};

const bystander: ShipSpec = { id: 'bystander', position: 'B1', speed: 1, hp: 1e9 };
const target = (hp: number): ShipSpec => ({ id: 'target', position: 'M4', speed: 1, hp });

describe('an Echoing Burst written after the damage does not land on a ship that damage destroyed', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side control: the target survives and holds the Echoing Burst`, () => {
            const r = run(side, [target(1e9), bystander]);
            expect(r.destroyed('target')).toBe(false);
            expect(r.held('target')).toBe(1);
            expect(r.inflicted).toEqual(['target']);
        });
        it(`${side}-side: the hit destroys the target, which holds no Echoing Burst`, () => {
            const r = run(side, [target(1000), bystander]);
            expect(r.destroyed('target')).toBe(true);
            expect(r.held('target')).toBe(0);
            expect(r.inflicted).toEqual([]);
            expect(r.dropped).toContainEqual({ target: 'target', label: 'Echoing Burst' });
        });
        it(`${side}-side covered victim: the half-hit destroys it, which holds no Echoing Burst`, () => {
            const covered: ShipSpec = { id: 'covered', position: 'M3', speed: 1, hp: 1000 };
            const r = run(side, [target(1e9), covered, bystander], 'Pattern-Circle-Range-1');
            expect(r.destroyed('covered')).toBe(true);
            expect(r.held('covered')).toBe(0);
            expect(r.held('target')).toBe(1);
            expect(r.inflicted).toEqual(['target']);
            expect(r.dropped).toContainEqual({ target: 'covered', label: 'Echoing Burst' });
        });
        it(`${side}-side covered control: a sturdy covered victim holds its Echoing Burst`, () => {
            const covered: ShipSpec = { id: 'covered', position: 'M3', speed: 1, hp: 1e9 };
            const r = run(side, [target(1e9), covered, bystander], 'Pattern-Circle-Range-1');
            expect(r.held('covered')).toBe(1);
            expect(r.held('target')).toBe(1);
        });
    }
});
