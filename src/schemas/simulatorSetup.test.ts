import { describe, it, expect } from 'vitest';
import { parseSimulatorSetup, parseSimulatorSetupList } from './simulatorSetup';

const valid = {
    version: 1,
    name: 'Setup',
    playerBoard: { T1: { shipId: 'owned-1', overrides: { speed: 150 } } },
    enemyBoard: { B4: { shipId: 'template:t:r0' } },
    seed: 42,
    runCount: 20,
    savedAt: 1_700_000_000_000,
};

describe('parseSimulatorSetup', () => {
    it('accepts a well-formed setup', () => {
        expect(parseSimulatorSetup(valid)).not.toBeNull();
    });

    it('rejects a wrong version rather than upgrading it', () => {
        expect(parseSimulatorSetup({ ...valid, version: 2 })).toBeNull();
    });

    it('rejects an unknown board position', () => {
        expect(parseSimulatorSetup({ ...valid, playerBoard: { Z9: { shipId: 'x' } } })).toBeNull();
    });

    it('rejects an unknown override stat', () => {
        expect(
            parseSimulatorSetup({
                ...valid,
                playerBoard: { T1: { shipId: 'x', overrides: { luck: 5 } } },
            })
        ).toBeNull();
    });

    it('rejects a non-finite override value', () => {
        expect(
            parseSimulatorSetup({
                ...valid,
                playerBoard: { T1: { shipId: 'x', overrides: { speed: Infinity } } },
            })
        ).toBeNull();
    });

    it('rejects a squad leader with a bad stage', () => {
        expect(
            parseSimulatorSetup({
                ...valid,
                playerSquadLeader: { faction: 'TERRAN', name: 'X', stage: 9 },
            })
        ).toBeNull();
    });

    it('rejects a run count outside what the controls can produce', () => {
        // A restored setup does not pass back through clampRunCount, so an out-of-range value
        // would put a sweep-sized workload behind a button the user thinks runs one fight.
        expect(parseSimulatorSetup({ ...valid, runCount: 0 })).toBeNull();
        expect(parseSimulatorSetup({ ...valid, runCount: 100000 })).toBeNull();
        expect(parseSimulatorSetup({ ...valid, runCount: 1000 })).not.toBeNull();
    });

    it('rejects a seed outside the 32-bit range clampSeed enforces', () => {
        expect(parseSimulatorSetup({ ...valid, seed: -1 })).toBeNull();
        expect(parseSimulatorSetup({ ...valid, seed: 2 ** 31 })).toBeNull();
        expect(parseSimulatorSetup({ ...valid, seed: 2 ** 31 - 1 })).not.toBeNull();
    });

    it('rejects an override below its stat floor', () => {
        // hp floors at 1: an actor built at 0 HP starts the fight on the engine's corpse path.
        const withHp = (hp: number) => ({
            ...valid,
            playerBoard: { T1: { shipId: 'owned-1', overrides: { hp } } },
        });
        expect(parseSimulatorSetup(withHp(0))).toBeNull();
        expect(parseSimulatorSetup(withHp(1))).not.toBeNull();
        // A stat with no floor still accepts 0.
        expect(
            parseSimulatorSetup({
                ...valid,
                playerBoard: { T1: { shipId: 'owned-1', overrides: { crit: 0 } } },
            })
        ).not.toBeNull();
    });

    it('rejects a negative or absurd override magnitude', () => {
        const withSpeed = (speed: number) => ({
            ...valid,
            playerBoard: { T1: { shipId: 'owned-1', overrides: { speed } } },
        });
        expect(parseSimulatorSetup(withSpeed(-5))).toBeNull();
        expect(parseSimulatorSetup(withSpeed(1e12))).toBeNull();
    });

    it('rejects a name longer than the stored limit', () => {
        expect(parseSimulatorSetup({ ...valid, name: 'x'.repeat(121) })).toBeNull();
        expect(parseSimulatorSetup({ ...valid, name: 'x'.repeat(120) })).not.toBeNull();
    });

    it('rejects a non-object', () => {
        expect(parseSimulatorSetup('nope')).toBeNull();
        expect(parseSimulatorSetup(null)).toBeNull();
    });
});

describe('parseSimulatorSetupList', () => {
    it('keeps the valid entries and drops only the invalid ones', () => {
        const list = parseSimulatorSetupList([
            valid,
            { ...valid, version: 99 },
            { ...valid, name: 'B' },
        ]);
        expect(list.map((s) => s.name)).toEqual(['Setup', 'B']);
    });

    it('returns an empty list for a non-array', () => {
        expect(parseSimulatorSetupList({})).toEqual([]);
    });
});
