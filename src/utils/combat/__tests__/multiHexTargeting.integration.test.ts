/**
 * A two-hex enemy (a bounty boss) through the whole battle path: `BattlePlacement.footprint` →
 * engine actor → target selection → AoE expansion. The player attacker fires
 * Pattern-Line-Range-2 at `front`; the boss sits at M3+M4 (anchor M3) and a second enemy at M1.
 * Front targeting aims at the boss's front-most hex M4, so the line covers M4, M3, M2 and the
 * boss is struck ONCE, as the primary target; the M1 ship is outside the line. Aimed at the
 * anchor M3 instead, the line would reach M1.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

const DAMAGE_ONLY = 'This Unit deals <unit-damage>100% damage</unit-damage>.';

const makeShip = (id: string, activePattern: string, activeSkillText = DAMAGE_ONLY): Ship => ({
    id,
    name: id,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'ATTACKER',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText,
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern,
});

const placement = (
    ship: Ship,
    position: Position,
    attack: number,
    footprint?: Position[]
): BattlePlacement => ({
    ship,
    position,
    ...(footprint ? { footprint } : {}),
    statOverrides: {
        attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 10_000,
        defence: 0,
        hp: 1_000_000_000,
        speed: 100,
    },
});

describe('multi-hex enemy — end-to-end targeting', () => {
    it('Line-Range-2 at front aims at the boss’s front hex and strikes it once', () => {
        const result = simulateBattle({
            playerTeam: [placement(makeShip('p1', 'Pattern-Line-Range-2'), 'M1', 5000)],
            enemyTeam: [
                placement(makeShip('boss', 'Pattern-Base'), 'M3', 0, ['M3', 'M4']),
                placement(makeShip('back', 'Pattern-Base'), 'M1', 0),
            ],
            rounds: 1,
        });

        const r1 = result.combatLog.find((r) => r.round === 1)!;
        const attackerTurn = r1.turns.find((t) => t.actorId === 'attacker')!;
        const attackEntries = attackerTurn.entries.filter(
            (e) => e.kind === 'attack' && e.actorId === 'attacker'
        );
        expect(attackEntries).toHaveLength(1);
        const [entry] = attackEntries;
        expect(entry.kind === 'attack' && entry.targets.map((t) => t.targetId)).toEqual([
            'e:boss:0',
        ]);
    });

    it('mirrored: an enemy attacker strikes a player-side two-hex unit once, at its front hex', () => {
        const result = simulateBattle({
            playerTeam: [
                placement(makeShip('boss', 'Pattern-Base'), 'M3', 0, ['M3', 'M4']),
                placement(makeShip('back', 'Pattern-Base'), 'M1', 0),
            ],
            enemyTeam: [placement(makeShip('e1', 'Pattern-Line-Range-2'), 'M1', 5000)],
            rounds: 1,
        });

        const bossId = result.roster.find(
            (r) => r.side === 'player' && r.position === 'M3'
        )!.actorId;
        const r1 = result.combatLog.find((r) => r.round === 1)!;
        const enemyEntries = r1.turns
            .flatMap((t) => t.entries)
            .filter((e) => e.kind === 'attack' && e.actorId.startsWith('e:'));
        expect(enemyEntries).toHaveLength(1);
        const [entry] = enemyEntries;
        expect(entry.kind === 'attack' && entry.targets.map((t) => t.targetId)).toEqual([bossId]);
    });

    it('the cast’s AoE recipients expand from the same hex: a debuff lands on the boss alone', () => {
        const result = simulateBattle({
            playerTeam: [
                placement(
                    makeShip(
                        'p1',
                        'Pattern-Line-Range-2',
                        'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Defense Down I</unit-skill> for 2 turns.'
                    ),
                    'M1',
                    5000
                ),
            ],
            enemyTeam: [
                placement(makeShip('boss', 'Pattern-Base'), 'M3', 0, ['M3', 'M4']),
                placement(makeShip('back', 'Pattern-Base'), 'M1', 0),
            ],
            rounds: 1,
        });

        const debuffTargets = result.combatLog[0].turns
            .flatMap((t) => t.entries)
            .filter((e) => e.kind === 'debuff')
            .flatMap((e) => e.targets.map((t) => t.targetId));
        expect(debuffTargets).toEqual(['e:boss:0']);
    });

    it('a two-hex TEAM actor (not the focus) is struck once, at its front hex', () => {
        const result = simulateBattle({
            playerTeam: [
                placement(makeShip('focus', 'Pattern-Base'), 'T1', 0),
                placement(makeShip('boss', 'Pattern-Base'), 'M3', 0, ['M3', 'M4']),
                placement(makeShip('back', 'Pattern-Base'), 'M1', 0),
            ],
            enemyTeam: [placement(makeShip('e1', 'Pattern-Line-Range-2'), 'M1', 5000)],
            rounds: 1,
        });

        const bossId = result.roster.find(
            (r) => r.side === 'player' && r.position === 'M3'
        )!.actorId;
        const enemyEntries = result.combatLog[0].turns
            .flatMap((t) => t.entries)
            .filter((e) => e.kind === 'attack' && e.actorId.startsWith('e:'));
        expect(enemyEntries).toHaveLength(1);
        const [entry] = enemyEntries;
        expect(entry.kind === 'attack' && entry.targets.map((t) => t.targetId)).toEqual([bossId]);
    });
});
