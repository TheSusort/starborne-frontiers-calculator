/**
 * An Echoing Burst whose holder is destroyed before it bursts never bursts: no detonation on the
 * wreck, so none of Valkyrie's "when an Echoing Burst explodes on an enemy … repair 5%" either
 * (owner ruling 2026-10-26). A burst goes off only at its holder's own turn start, which a dead
 * holder never reaches.
 *
 * Board: Valkyrie (real kit, charged at the start, speed 200) lands Echoing Burst on a sturdy
 * target at M4 without killing it. Her ally Crusher (real kit, speed 100) then hits the same
 * target: lethal at high attack, harmless in the control. The target (speed 1) acts last, so in
 * the lethal arm it dies holding the burst. A sturdy bystander at B1 keeps the side alive.
 * Both mounts.
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

const valkyrie: ShipSpec = {
    id: 'valkyrie',
    position: 'M4',
    speed: 200,
    attack: 1000,
    hacking: 1e6,
    hp: 1e9,
    chargeCount: 2,
    startCharged: true,
    hasChargedSkill: true,
    skills: { slots: realSlots('Valkyrie', ['active', 'charged', 'passive']) },
};

const crusher = (attack: number): ShipSpec => ({
    id: 'crusher',
    position: 'T4',
    speed: 100,
    attack,
    hp: 1e9,
    skills: { slots: realSlots('Crusher', ['active']) },
});

const run = (side: 'player' | 'enemy', crusherAttack: number) => {
    const foes: ShipSpec[] = [
        { id: 'target', position: 'M4', speed: 1, hp: 1e6 },
        { id: 'bystander', position: 'B1', speed: 1, hp: 1e9 },
    ];
    const { input, idOf } = mirrorBoard(
        { caster: [valkyrie, crusher(crusherAttack)], other: foes, numRounds: 4 },
        side
    );
    const bus = createEventBus();
    const burstOn: string[] = [];
    bus.on('accumulator-detonated', (e: Extract<CombatEvent, { type: 'accumulator-detonated' }>) =>
        burstOn.push(e.victimId)
    );
    let actors: CombatActor[] = [];
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            actors = all;
        },
    });
    const target = actors.find((a) => a.id === idOf('target'));
    return {
        targetDestroyedRound: target?.destroyedRound,
        /** Echoing Bursts the target holds at the end: the lethal arm's proof it died holding one. */
        targetHeld: target?.pendingAccumulators.length ?? 0,
        burstOnTarget: burstOn.filter((id) => id === idOf('target')).length,
    };
};

describe('an Echoing Burst on a holder destroyed before it bursts never bursts', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side control: the target survives and its Echoing Burst bursts`, () => {
            const r = run(side, 1);
            expect(r.targetDestroyedRound).toBeUndefined();
            expect(r.burstOnTarget).toBeGreaterThan(0);
        });
        it(`${side}-side: the ally kills the holder in round 1, and nothing bursts on the wreck`, () => {
            const r = run(side, 1e7);
            expect(r.targetDestroyedRound).toBe(1);
            expect(r.targetHeld).toBe(1);
            expect(r.burstOnTarget).toBe(0);
        });
    }
});
