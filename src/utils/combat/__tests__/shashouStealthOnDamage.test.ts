/**
 * Shashou: "This Unit gains Stealth for 2 turns after damaging a Debuffer or Supporter and gains
 * 1 stack of Blast each turn." Ruling: he gains Stealth WHENEVER he damages a Debuffer or
 * Supporter — any ship his attack hits counts, not only the one it targeted — and the Blast
 * clause's "each turn" does not make the Stealth recur.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ship, Refit } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { CombatLogEntry } from '../log/types';

const NO_REFITS: Refit[] = [];

const SHASHOU_PASSIVE_R0 =
    'This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns after damaging a Debuffer or ' +
    'Supporter and gains 1 stack of <unit-skill>Blast</unit-skill> each turn.';

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
    chargeSkillCharge: 0,
    activeSkillText: 'This Unit deals <unit-damage>10% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

/** Shashou's real active + R0 passive, on a single-target pattern. */
const shashou = (speed = 300, pattern = 'Pattern-Base'): Ship => ({
    ...shipBase(`shashou-${speed}`, 'Shashou', 'ATTACKER', speed),
    activeSkillText:
        'This Unit deals <unit-damage>90% damage</unit-damage> and inflicts ' +
        '<unit-skill>Inc. Repair Down I</unit-skill> for 2 turns.',
    activeTarget: 'front',
    activePattern: pattern,
    firstPassiveSkillText: SHASHOU_PASSIVE_R0,
});

const body = (id: string, type: ShipTypeName, speed = 100): Ship =>
    shipBase(id, `Body-${type}`, type, speed);

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

/** Stealth grants landing on a Shashou, per side, across round 1. */
function shashouStealthGrants(playerTeam: BattlePlacement[], enemyTeam: BattlePlacement[]) {
    const result = simulateBattle({ playerTeam, enemyTeam, rounds: 1 }, () => undefined);
    const byId = new Map(result.roster.map((r) => [r.actorId, r]));
    const flat = (entries: CombatLogEntry[]): CombatLogEntry[] =>
        entries.flatMap((e) => [e, ...flat(e.reactions)]);
    const round1 = result.combatLog.find((r) => r.round === 1);
    expect(round1).toBeDefined();
    const all = flat([
        ...round1!.startOfRound,
        ...round1!.turns.flatMap((t) => t.entries),
        ...round1!.endOfRound,
    ]);
    const grants = all.filter(
        (e) => e.kind === 'buff' && e.note === 'Stealth' && byId.get(e.actorId)?.name === 'Shashou'
    );
    const side = (s: 'player' | 'enemy') =>
        grants.filter((e) => byId.get(e.actorId)?.side === s).length;
    return { player: side('player'), enemy: side('enemy') };
}

describe('Shashou gains Stealth after damaging a Debuffer or Supporter', () => {
    it('parses the Stealth clause as an on-deal-damage self-buff gated on the victim role', () => {
        const passive = buildShipAbilities(shashou()).slots.find((s) => s.slot === 'passive');
        const stealth = passive?.abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Stealth'
        );
        expect(stealth?.trigger).toBe('on-deal-damage');
        expect(stealth?.target).toBe('self');
        expect(stealth?.conditions.map((c) => [c.subject, c.requiredEnemyType])).toEqual([
            ['enemy-type', 'Debuffer'],
            ['enemy-type', 'Supporter'],
        ]);
    });

    it.each<[ShipTypeName, number]>([
        ['DEBUFFER', 1],
        ['SUPPORTER', 1],
        ['ATTACKER', 0],
        ['DEFENDER', 0],
    ])('hitting a %s grants Stealth %i time(s)', (role, expected) => {
        const g = shashouStealthGrants(
            [at(shashou(), 'M4')],
            [at(body('target', role), 'M4'), at(body('back', 'ATTACKER', 50), 'M1')]
        );
        expect(g.player).toBe(expected);
    });

    it('is team-symmetric: an ENEMY Shashou gains Stealth after damaging a player Supporter', () => {
        const g = shashouStealthGrants(
            [at(body('target', 'SUPPORTER'), 'M4'), at(body('back', 'ATTACKER', 50), 'M1')],
            [at(shashou(), 'M4')]
        );
        expect(g.enemy).toBe(1);
        expect(g.player).toBe(0);
    });

    it('counts a Supporter struck anywhere in an AoE, not only the targeted ship', () => {
        // Pattern-All strikes every enemy; the targeted (front) ship is an Attacker and only the
        // ship behind it is a Supporter.
        const g = shashouStealthGrants(
            [at(shashou(300, 'Pattern-All'), 'M4')],
            [at(body('anchor', 'ATTACKER'), 'M4'), at(body('beside', 'SUPPORTER', 50), 'M3')]
        );
        expect(g.player).toBe(1);
    });
});
