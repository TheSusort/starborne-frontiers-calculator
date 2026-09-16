import { describe, it, expect } from 'vitest';
import { resolveFight } from '../fightSources';
import type { Ship } from '../../../../types/ship';
import type { LocalEncounterNote } from '../../../../types/encounters';
import type { SimulatorSetup } from '../../../simulator/simulatorSetup';
import { SIMULATOR_SETUP_VERSION } from '../../../simulator/simulatorSetup';

const mkShip = (id: string): Ship =>
    ({
        id,
        name: id,
        type: 'ATTACKER',
        baseStats: { attack: 4000, hp: 40000, defence: 3000, speed: 100 },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as unknown as Ship;

const focus = mkShip('focus');
const fleet: Record<string, Ship> = { focus, mate: mkShip('mate'), foe: mkShip('foe') };
const resolveShip = (id: string) => fleet[id] ?? null;

describe('resolveFight', () => {
    it('practice: places the focus and reports no real opponent', () => {
        const fight = resolveFight({ kind: 'practice' }, focus, resolveShip);
        expect(fight.boardShipIds).toContain('focus');
        expect(fight.realOpponent).toBe(false);
    });

    it('encounter: uses the real player formation and the practice enemy', () => {
        const note: LocalEncounterNote = {
            id: 'e1',
            name: 'My team',
            createdAt: 0,
            formation: [
                { shipId: 'focus', position: 'M4' },
                { shipId: 'mate', position: 'T2' },
            ],
        };
        const fight = resolveFight({ kind: 'encounter', note }, focus, resolveShip);
        expect(fight.boardShipIds.sort()).toEqual(['focus', 'mate']);
        expect(Object.keys(fight.enemyBoard).length).toBeGreaterThan(0);
        expect(fight.realOpponent).toBe(false);
    });

    it('setup: uses both stored boards and reports a real opponent', () => {
        const setup: SimulatorSetup = {
            version: SIMULATOR_SETUP_VERSION,
            name: 'saved',
            playerBoard: { M4: { shipId: 'focus' }, T2: { shipId: 'mate' } },
            enemyBoard: { M4: { shipId: 'foe' } },
            seed: 7,
            runCount: 20,
            savedAt: 0,
        };
        const fight = resolveFight({ kind: 'setup', setup }, focus, resolveShip);
        expect(fight.boardShipIds.sort()).toEqual(['focus', 'mate']);
        expect(fight.enemyBoard.M4?.ship.id).toBe('foe');
        expect(fight.realOpponent).toBe(true);
    });

    it('names the one cell the focus fights from', () => {
        const fight = resolveFight({ kind: 'practice' }, focus, resolveShip);
        expect(fight.playerBoard[fight.focusPosition]?.ship.id).toBe('focus');
    });

    it('throws when the focus is not on the player side, rather than reporting an ally', () => {
        const note: LocalEncounterNote = {
            id: 'e1',
            name: 'Other team',
            createdAt: 0,
            formation: [{ shipId: 'mate', position: 'T2' }],
        };
        expect(() => resolveFight({ kind: 'encounter', note }, focus, resolveShip)).toThrow();
    });

    it('throws when a board holds the focus twice, rather than picking one', () => {
        const note: LocalEncounterNote = {
            id: 'e1',
            name: 'Doubled',
            createdAt: 0,
            formation: [
                { shipId: 'focus', position: 'M4' },
                { shipId: 'focus', position: 'T2' },
            ],
        };
        expect(() => resolveFight({ kind: 'encounter', note }, focus, resolveShip)).toThrow();
    });

    it('setup: throws when the focus id does not resolve, rather than fighting without it', () => {
        const setup: SimulatorSetup = {
            version: SIMULATOR_SETUP_VERSION,
            name: 'saved',
            playerBoard: { M4: { shipId: 'unknown-focus' }, T2: { shipId: 'mate' } },
            enemyBoard: { M4: { shipId: 'foe' } },
            seed: 7,
            runCount: 20,
            savedAt: 0,
        };
        expect(() => resolveFight({ kind: 'setup', setup }, focus, resolveShip)).toThrow();
    });

    it('setup: substitutes the live focus ship, so a re-geared focus is the one that fights', () => {
        const setup: SimulatorSetup = {
            version: SIMULATOR_SETUP_VERSION,
            name: 'saved',
            playerBoard: { M4: { shipId: 'focus' } },
            enemyBoard: { M4: { shipId: 'foe' } },
            seed: 7,
            runCount: 20,
            savedAt: 0,
        };
        const regeared = { ...focus, equipment: { weapon: 'w1' } } as Ship;
        const fight = resolveFight({ kind: 'setup', setup }, regeared, resolveShip);
        expect(fight.playerBoard.M4?.ship.equipment.weapon).toBe('w1');
    });

    it('setup: throws when every enemy ship id fails to resolve, rather than fighting an empty board', () => {
        const setup: SimulatorSetup = {
            version: SIMULATOR_SETUP_VERSION,
            name: 'Old Rival',
            playerBoard: { M4: { shipId: 'focus' } },
            enemyBoard: { M4: { shipId: 'gone-1' }, T2: { shipId: 'gone-2' } },
            seed: 7,
            runCount: 20,
            savedAt: 0,
        };
        expect(() => resolveFight({ kind: 'setup', setup }, focus, resolveShip)).toThrow(
            /Old Rival.*enemy ships.*resolve/
        );
    });

    it('setup: reports a partially unresolvable enemy board in dropped, and still fights the rest', () => {
        const setup: SimulatorSetup = {
            version: SIMULATOR_SETUP_VERSION,
            name: 'saved',
            playerBoard: { M4: { shipId: 'focus' } },
            enemyBoard: { M4: { shipId: 'foe' }, T2: { shipId: 'gone' } },
            seed: 7,
            runCount: 20,
            savedAt: 0,
        };
        const fight = resolveFight({ kind: 'setup', setup }, focus, resolveShip);
        expect(fight.enemyBoard.M4?.ship.id).toBe('foe');
        expect(fight.enemyBoard.T2).toBeUndefined();
        expect(fight.dropped).toEqual([{ side: 'enemy', position: 'T2' }]);
    });

    it('setup: reports an unresolvable ally in dropped, and still fights without it', () => {
        const setup: SimulatorSetup = {
            version: SIMULATOR_SETUP_VERSION,
            name: 'saved',
            playerBoard: { M4: { shipId: 'focus' }, T2: { shipId: 'gone' } },
            enemyBoard: { M4: { shipId: 'foe' } },
            seed: 7,
            runCount: 20,
            savedAt: 0,
        };
        const fight = resolveFight({ kind: 'setup', setup }, focus, resolveShip);
        expect(fight.playerBoard.T2).toBeUndefined();
        expect(fight.dropped).toEqual([{ side: 'player', position: 'T2' }]);
    });

    it('encounter: reports an unresolvable ally in dropped rather than silently dropping it', () => {
        const note: LocalEncounterNote = {
            id: 'e1',
            name: 'My team',
            createdAt: 0,
            formation: [
                { shipId: 'focus', position: 'M4' },
                { shipId: 'unknown-mate', position: 'T2' },
            ],
        };
        const fight = resolveFight({ kind: 'encounter', note }, focus, resolveShip);
        expect(fight.playerBoard.T2).toBeUndefined();
        expect(fight.dropped).toEqual([{ side: 'player', position: 'T2' }]);
    });

    it('practice and a fully-resolvable encounter report no dropped cells', () => {
        const practiceFight = resolveFight({ kind: 'practice' }, focus, resolveShip);
        expect(practiceFight.dropped).toEqual([]);

        const note: LocalEncounterNote = {
            id: 'e1',
            name: 'My team',
            createdAt: 0,
            formation: [
                { shipId: 'focus', position: 'M4' },
                { shipId: 'mate', position: 'T2' },
            ],
        };
        const encounterFight = resolveFight({ kind: 'encounter', note }, focus, resolveShip);
        expect(encounterFight.dropped).toEqual([]);
    });
});
