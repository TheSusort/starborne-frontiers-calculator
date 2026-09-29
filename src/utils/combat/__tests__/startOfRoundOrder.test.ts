/**
 * Start-of-round resolution order, and the side an `enemy-buff` gate reads.
 *
 * Rulings under test:
 *  - The Cloaking set's Stealth is START OF COMBAT: it lands before any round-1 start-of-round
 *    effect on either side resolves.
 *  - Start-of-round effects resolve in turn order, owner by owner: live speed DESC, then board
 *    position, then the player side on a cross-team tie (`orderByTurnPriority`).
 *  - A drain-time `enemy-buff` gate reads the OWNER's opposing side, whichever side owns it.
 *
 * The reader is Graphite's refit passive ("at the start of the round, if an enemy Unit has
 * Stealth, add 2 charges to all allies within the active pattern") parsed from its real text; the
 * observable is the round-1 `charge 0→2 (manip)` entries in the combat log, per side.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship, Refit } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { Position } from '../../../types/encounters';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { CombatLogEntry } from '../log/types';

const NO_REFITS: Refit[] = [];

const GRAPHITE_STEALTH_CHARGE_PASSIVE =
    'At the start of the round, if an enemy Unit has <unit-skill>Stealth</unit-skill>, this Unit ' +
    '<unit-aid>adds 2 charges</unit-aid> to the charged skill of all allies within the active pattern.';

const CLOAK_IDS = ['cloak-a', 'cloak-b'];
const getGearPiece = (id: string): GearPiece | undefined =>
    CLOAK_IDS.includes(id)
        ? ({
              id,
              slot: id === 'cloak-a' ? 'weapon' : 'hull',
              level: 16,
              stars: 6,
              rarity: 'legendary',
              mainStat: { name: 'attack', value: 0, type: 'flat' },
              subStats: [],
              setBonus: 'CLOAKING',
          } as unknown as GearPiece)
        : undefined;

const shipBase = (id: string, name: string, type: ShipTypeName, speed: number): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'MPL',
    type,
    baseStats: {
        hp: 1_000_000,
        attack: 1_000,
        defence: 0,
        hacking: 0,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed,
    },
    equipment: {},
    implants: {},
    refits: NO_REFITS,
    level: 60,
    rank: 5,
    affinity: 'antimatter',
    chargeSkillCharge: 4,
    activeSkillText: 'This Unit deals <unit-damage>10% damage</unit-damage>.',
    chargeSkillText: 'This Unit deals <unit-damage>10% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

/** The Stealth reader. Defaults to an all-allies footprint, so every ally is inside its active
 *  pattern; `pattern` swaps in another support footprint. */
const granter = (speed: number, pattern = 'Pattern-Support-All'): Ship => ({
    ...shipBase(`granter-${speed}`, 'Granter', 'SUPPORTER', speed),
    activeSkillText:
        'This unit grants <unit-skill>Attack Up I</unit-skill> for 1 turn to all allies.',
    activeTarget: 'allies',
    activePattern: pattern,
    firstPassiveSkillText: GRAPHITE_STEALTH_CHARGE_PASSIVE,
});

/** A ship whose ONLY Stealth source is the Cloaking set (start of combat). */
const cloaker = (speed: number): Ship => ({
    ...shipBase(`cloaker-${speed}`, 'Cloaker', 'ATTACKER', speed),
    equipment: { weapon: 'cloak-a', hull: 'cloak-b' },
});

/** A ship whose ONLY Stealth source is a start-of-ROUND self-grant (a ship passive). */
const selfStealther = (speed: number): Ship => ({
    ...shipBase(`stealther-${speed}`, 'Stealther', 'ATTACKER', speed),
    firstPassiveSkillText:
        'At the start of each round, it gains <unit-skill>Stealth</unit-skill> for 1 turn.',
});

/** A plain body, so a side without a Stealth source still has a second ship. */
const filler = (speed: number): Ship => shipBase(`filler-${speed}`, 'Filler', 'ATTACKER', speed);

const at = (ship: Ship, position: Position): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: ship.baseStats.attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 0,
        security: 0,
        defence: 0,
        hp: ship.baseStats.hp,
        speed: ship.baseStats.speed,
    },
});

/** Round-1 start-of-round manip charge grants, counted per receiving side. */
function round1Grants(playerTeam: BattlePlacement[], enemyTeam: BattlePlacement[]) {
    const result = simulateBattle({ playerTeam, enemyTeam, rounds: 1 }, getGearPiece);
    const sideOf = new Map(result.roster.map((r) => [r.actorId, r.side]));
    const flat = (entries: CombatLogEntry[]): CombatLogEntry[] =>
        entries.flatMap((e) => [e, ...flat(e.reactions)]);
    const round1 = result.combatLog.find((r) => r.round === 1);
    expect(round1).toBeDefined();
    const grants = flat(round1!.startOfRound).filter((e) => e.note === 'charge 0→2 (manip)');
    return {
        player: grants.filter((e) => sideOf.get(e.actorId) === 'player').length,
        enemy: grants.filter((e) => sideOf.get(e.actorId) === 'enemy').length,
    };
}

describe('start-of-round order and the enemy-buff gate side', () => {
    it('mirrored Cloaking teams: both readers see the other side’s start-of-combat Stealth', () => {
        // The reader is FASTER than the cloaker, so only a start-of-combat Stealth (not a
        // start-of-round one resolved in speed order) is up in time for it.
        const team = () => [at(granter(300), 'M3'), at(cloaker(100), 'M4')];
        const g = round1Grants(team(), team());
        expect(g.player).toBeGreaterThan(0);
        expect(g.enemy).toBe(g.player);
    });

    it('mirrored Cloaking teams on Graphite’s real support footprint grant on both sides', () => {
        const team = () => [
            at(granter(300, 'Pattern-Support-Double-Pickaxe-Range-0'), 'M3'),
            at(cloaker(100), 'M4'),
        ];
        const g = round1Grants(team(), team());
        expect(g.player).toBeGreaterThan(0);
        expect(g.enemy).toBe(g.player);
    });

    it('only the ENEMY side is cloaked: the PLAYER reader grants, the enemy reader does not', () => {
        const g = round1Grants(
            [at(granter(300), 'M3'), at(filler(100), 'M4')],
            [at(granter(300), 'M3'), at(cloaker(100), 'M4')]
        );
        expect(g.player).toBeGreaterThan(0);
        expect(g.enemy).toBe(0);
    });

    it('only the PLAYER side is cloaked: the ENEMY reader grants, the player reader does not', () => {
        const g = round1Grants(
            [at(granter(300), 'M3'), at(cloaker(100), 'M4')],
            [at(granter(300), 'M3'), at(filler(100), 'M4')]
        );
        expect(g.enemy).toBeGreaterThan(0);
        expect(g.player).toBe(0);
    });

    it('a start-of-round Stealth from a FASTER enemy lands before a slower player reader', () => {
        const g = round1Grants(
            [at(granter(200), 'M3'), at(filler(100), 'M4')],
            [at(filler(100), 'M3'), at(selfStealther(300), 'M4')]
        );
        expect(g.player).toBeGreaterThan(0);
    });

    it('a start-of-round Stealth from a SLOWER enemy lands after a faster player reader', () => {
        const g = round1Grants(
            [at(granter(300), 'M3'), at(filler(100), 'M4')],
            [at(filler(100), 'M3'), at(selfStealther(200), 'M4')]
        );
        expect(g.player).toBe(0);
    });

    it('a start-of-round Stealth from a SLOWER player lands after a faster enemy reader', () => {
        const g = round1Grants(
            [at(filler(100), 'M3'), at(selfStealther(200), 'M4')],
            [at(granter(300), 'M3'), at(filler(100), 'M4')]
        );
        expect(g.enemy).toBe(0);
    });

    it('a start-of-round Stealth from a FASTER player lands before a slower enemy reader', () => {
        const g = round1Grants(
            [at(filler(100), 'M3'), at(selfStealther(300), 'M4')],
            [at(granter(200), 'M3'), at(filler(100), 'M4')]
        );
        expect(g.enemy).toBeGreaterThan(0);
    });

    // Equal speed on the mirrored cell: the cross-team tie goes to the PLAYER side.
    it('a speed tie on the mirrored cell resolves the PLAYER owner first (enemy reader sees it)', () => {
        const g = round1Grants(
            [at(selfStealther(200), 'M3'), at(filler(100), 'M4')],
            [at(granter(200), 'M3'), at(filler(100), 'M4')]
        );
        expect(g.enemy).toBeGreaterThan(0);
    });

    it('a speed tie on the mirrored cell resolves the PLAYER owner first (player reader misses it)', () => {
        const g = round1Grants(
            [at(granter(200), 'M3'), at(filler(100), 'M4')],
            [at(selfStealther(200), 'M3'), at(filler(100), 'M4')]
        );
        expect(g.player).toBe(0);
    });
});
