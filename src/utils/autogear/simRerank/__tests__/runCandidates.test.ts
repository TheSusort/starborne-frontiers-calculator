import { describe, it, expect } from 'vitest';
import { focusActorId, runCandidate } from '../runCandidates';
import { resolveFight } from '../fightSources';
import type { Ship } from '../../../../types/ship';
import type { SeedSetAggregate } from '../../../simulator/seededRuns';

const mkShip = (id: string, name: string): Ship =>
    ({
        id,
        name,
        type: 'ATTACKER',
        baseStats: {
            attack: 5000,
            crit: 50,
            critDamage: 150,
            hp: 50000,
            defence: 3000,
            speed: 110,
        },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>150% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as unknown as Ship;

const deps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

describe('focusActorId', () => {
    it('finds the focus when it is not player index 0', () => {
        // Index 0 is named 'attacker' and here it is the ALLY, because T2 precedes M4 in
        // buildTeam's POSITION_ORDER. Reading 'attacker' would report the ally's damage.
        const aggregate = {
            roster: [
                { actorId: 'attacker', side: 'player', name: 'Ally', position: 'T2' },
                { actorId: 'p:focus:1', side: 'player', name: 'Focus', position: 'M4' },
                { actorId: 'e:foe:0', side: 'enemy', name: 'Foe', position: 'M4' },
            ],
        } as unknown as SeedSetAggregate;
        expect(focusActorId(aggregate, 'M4')).toBe('p:focus:1');
    });

    it('finds the focus when it IS player index 0, where the id carries no ship id', () => {
        const aggregate = {
            roster: [
                { actorId: 'attacker', side: 'player', name: 'Focus', position: 'T1' },
                { actorId: 'p:ally:1', side: 'player', name: 'Ally', position: 'M2' },
            ],
        } as unknown as SeedSetAggregate;
        expect(focusActorId(aggregate, 'T1')).toBe('attacker');
    });

    it('never returns an enemy standing in the same cell', () => {
        // The enemy is listed FIRST: a `find` without the side filter would return it, so this
        // only pins the filter if the enemy entry comes before the player's.
        const aggregate = {
            roster: [
                { actorId: 'e:foe:0', side: 'enemy', name: 'Foe', position: 'M4' },
                { actorId: 'attacker', side: 'player', name: 'Focus', position: 'M4' },
            ],
        } as unknown as SeedSetAggregate;
        expect(focusActorId(aggregate, 'M4')).toBe('attacker');
    });

    it('throws rather than guessing when no player holds that cell', () => {
        const aggregate = { roster: [] } as unknown as SeedSetAggregate;
        expect(() => focusActorId(aggregate, 'M4')).toThrow();
    });
});

describe('runCandidate', () => {
    it('reports the focus ship totals when the focus is not in the earliest position', async () => {
        const focus = mkShip('focus', 'Focus');
        const fight = resolveFight({ kind: 'practice' }, focus, () => null);
        const run = await runCandidate({
            id: 'equipped',
            fight,
            deps,
            seed: 5,
            runCount: 2,
        });
        expect(run).not.toBeNull();
        // Pins rule 1: the practice board seats the focus at M4 behind a T2 ally, so index 0
        // (`'attacker'`) is the ally. Asserting only damageDealt > 0 would still pass if
        // focusActorId had returned the ally's id.
        expect(run!.focusActorId).not.toBe('attacker');
        expect(run!.focusActorId).toMatch(/^p:focus:/);
        expect(run!.aggregate.perActorMean[run!.focusActorId].damageDealt).toBeGreaterThan(0);
    });

    it('runs the seed set it was given, so candidates can be paired', async () => {
        const focus = mkShip('focus', 'Focus');
        const fight = resolveFight({ kind: 'practice' }, focus, () => null);
        const run = await runCandidate({ id: 'a', fight, deps, seed: 11, runCount: 3 });
        expect(run!.aggregate.baseSeed).toBe(11);
        expect(run!.aggregate.count).toBe(3);
    });

    it('resolves null when aborted, never a partial aggregate', async () => {
        const focus = mkShip('focus', 'Focus');
        const fight = resolveFight({ kind: 'practice' }, focus, () => null);
        const controller = new AbortController();
        controller.abort();
        const run = await runCandidate({
            id: 'a',
            fight,
            deps,
            seed: 1,
            runCount: 5,
            signal: controller.signal,
        });
        expect(run).toBeNull();
    });
});
