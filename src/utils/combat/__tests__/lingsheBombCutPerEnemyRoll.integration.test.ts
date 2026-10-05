/**
 * Lingshe's charged skill "reduces all Bomb on the enemy targets by 1 turn. This reduction effect
 * requires hacking." rolls the cut PER ENEMY, against each enemy's own security — the AoE rule
 * (every effect reaches every enemy in the pattern) with the inflict rule (hacking vs that
 * enemy's security). One well-defended enemy keeps its countdown; the others still lose a turn.
 * A failed cut emits no resist (whether it should count as one is unruled).
 *
 * Real parsed charged skill (buildTraceShip, refit 4) on her Backline-Range-1 pattern aimed at the
 * back-most enemy A (M1), mounted on both sides. The pattern covers B (M2) one step forward; OUT
 * (M4) stands outside it. Every enemy holds a seeded Bomb at countdown 5 and acts after Lingshe, so a
 * cut Bomb ends the round at 3 (her cut, then its holder's own tick) and an uncut one at 4.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { CombatActor, PendingBomb } from '../state';
import type { Position } from '../../../types/encounters';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(7));

type Label = 'A' | 'B' | 'OUT';
const LABELS: Label[] = ['A', 'B', 'OUT'];
const POS: Record<Label, Position> = { A: 'M1', B: 'M2', OUT: 'M4' };
const HIGH = 2e6;

const teams = (guarded: Label[]): MirrorTeams => ({
    caster: [
        {
            id: 'lingshe',
            position: 'M4',
            speed: 150,
            hacking: 1e6,
            chargeCount: 1,
            startCharged: true,
            hasChargedSkill: true,
            target: 'back',
            pattern: 'Pattern-Base',
            chargedPattern: 'Pattern-Backline-Range-1',
            skills: { slots: realSlots('Lingshe', ['charged']) },
        },
    ],
    other: LABELS.map((l): ShipSpec => ({
        id: `e-${l}`,
        position: POS[l],
        speed: 1,
        security: guarded.includes(l) ? HIGH : 0,
    })),
});

const seededBomb = (): PendingBomb => ({
    countdown: 5,
    damagePerStack: 1,
    stacks: 1,
    tier: 100,
    sourceId: 'seed',
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

const run = (guarded: Label[], side: 'player' | 'enemy') => {
    const { input, idOf } = mirrorBoard(teams(guarded), side);
    const label = new Map(LABELS.map((l) => [idOf(`e-${l}`), l]));
    const seeded = new Map<Label, PendingBomb>();
    const bus = createEventBus();
    const resisted: string[] = [];
    bus.on('debuff-resisted', (e) => {
        if (e.round === 1) resisted.push(`${label.get(e.targetId)}`);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            for (const l of LABELS) {
                const bomb = seededBomb();
                all.find((a) => a.id === idOf(`e-${l}`))!.pendingBombs.push(bomb);
                seeded.set(l, bomb);
            }
        },
    });
    return {
        countdown: Object.fromEntries(LABELS.map((l) => [l, seeded.get(l)!.countdown])),
        resisted: resisted.sort(),
    };
};

describe("Lingshe charged: the 'requires hacking' Bomb cut rolls per enemy", () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: nobody guarded → A and B cut; OUT untouched`, () => {
            expect(run([], side)).toEqual({
                countdown: { A: 3, B: 3, OUT: 4 },
                resisted: [],
            });
        });
        it(`${side}-side: covered B out-secures her → B keeps its countdown, A is cut`, () => {
            expect(run(['B'], side)).toEqual({
                countdown: { A: 3, B: 4, OUT: 4 },
                // B's one resist is her Bomb III; the failed cut emits none.
                resisted: ['B'],
            });
        });
        it(`${side}-side reverse board: aimed A out-secures her → only A keeps its countdown`, () => {
            expect(run(['A'], side)).toEqual({
                countdown: { A: 4, B: 3, OUT: 4 },
                resisted: ['A'],
            });
        });
        it(`${side}-side: both struck enemies out-secure her → no cut anywhere`, () => {
            expect(run(['A', 'B'], side)).toEqual({
                countdown: { A: 4, B: 4, OUT: 4 },
                resisted: ['A', 'B'],
            });
        });
    }
});
