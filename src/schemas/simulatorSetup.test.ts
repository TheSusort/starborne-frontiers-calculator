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
