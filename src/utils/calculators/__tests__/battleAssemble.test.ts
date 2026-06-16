/**
 * Combat Simulator Phase 5 — PR 1, Task 2: pure event-driven battle assembler.
 *
 * These tests feed HAND-BUILT synthetic CombatEvent[] + perRoundPerTarget (NO runCombat)
 * into `assembleBattleResult` and assert the symmetric result surface. The data-source
 * contract they encode is pinned in twoTeamBattle.test.ts (Task 1):
 *   - damage DEALT per attacker = ability-performed.damage summed by actorId
 *   - damage TAKEN per victim   = perRoundPerTarget[round][victimId]
 *   - heals = heal-performed { casterId, targets[], amount }
 *   - death = ship-destroyed { actorId }
 *   - buffs = buff-applied / buff-expired / debuff-applied
 *   - hpPct = maxHp - cumulative(damageTaken) over rounds <= r
 */
import { describe, it, expect } from 'vitest';
import { assembleBattleResult } from '../battleSimulator';
import type { CombatEvent } from '../../combat/events';
import type { Position } from '../../../types/encounters';

const roster = (): Array<{
    actorId: string;
    side: 'player' | 'enemy';
    name: string;
    position: Position;
    maxHp: number;
}> => [
    { actorId: 'attacker', side: 'player', name: 'Focus', position: 'M4', maxHp: 10000 },
    { actorId: 'player-team', side: 'player', name: 'Team', position: 'M3', maxHp: 10000 },
    { actorId: 'enemy-front', side: 'enemy', name: 'EnemyFront', position: 'M4', maxHp: 10000 },
    { actorId: 'enemy-back', side: 'enemy', name: 'EnemyBack', position: 'M1', maxHp: 10000 },
];

const find = (result: ReturnType<typeof assembleBattleResult>, round: number, actorId: string) =>
    result.rounds.find((r) => r.round === round)!.ships.find((s) => s.actorId === actorId)!;

describe('assembleBattleResult — symmetric damage dealt/taken', () => {
    it('credits ability-performed.damage to the attacker (dealt) both directions', () => {
        const events: CombatEvent[] = [
            {
                type: 'ability-performed',
                actorId: 'attacker',
                targetId: 'enemy-front',
                round: 1,
                abilityType: 'damage',
                damage: 5000,
            },
            {
                type: 'ability-performed',
                actorId: 'enemy-front',
                targetId: 'attacker',
                round: 1,
                abilityType: 'damage',
                damage: 3000,
            },
        ];
        const perRoundPerTarget = { 1: { 'enemy-front': 5000, attacker: 3000 } };
        const result = assembleBattleResult({
            events,
            perRoundPerTarget,
            roster: roster(),
            numRounds: 1,
        });

        expect(find(result, 1, 'attacker').damageDealt).toBe(5000);
        expect(find(result, 1, 'attacker').damageTaken).toBe(3000);
        expect(find(result, 1, 'enemy-front').damageDealt).toBe(3000);
        expect(find(result, 1, 'enemy-front').damageTaken).toBe(5000);
    });

    it('sums multiple ability-performed for the same attacker in a round', () => {
        const events: CombatEvent[] = [
            {
                type: 'ability-performed',
                actorId: 'attacker',
                targetId: 'enemy-front',
                round: 1,
                abilityType: 'damage',
                damage: 1000,
            },
            {
                type: 'ability-performed',
                actorId: 'attacker',
                targetId: 'enemy-back',
                round: 1,
                abilityType: 'damage',
                damage: 1500,
            },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        expect(find(result, 1, 'attacker').damageDealt).toBe(2500);
    });
});

describe('assembleBattleResult — hpPct from cumulative taken', () => {
    it('derives hpPct from maxHp minus cumulative damage taken', () => {
        const perRoundPerTarget = {
            1: { attacker: 3000 },
            2: { attacker: 2000 },
        };
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget,
            roster: roster(),
            numRounds: 2,
        });
        // round 1: 3000 of 10000 taken => 70%
        expect(find(result, 1, 'attacker').hpPct).toBe(70);
        // round 2: cumulative 5000 of 10000 => 50%
        expect(find(result, 2, 'attacker').hpPct).toBe(50);
        // untouched actor stays at 100
        expect(find(result, 1, 'player-team').hpPct).toBe(100);
    });

    it('clamps hpPct to 0 when cumulative taken exceeds maxHp', () => {
        const perRoundPerTarget = { 1: { attacker: 99999 } };
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget,
            roster: roster(),
            numRounds: 1,
        });
        expect(find(result, 1, 'attacker').hpPct).toBe(0);
    });

    it('yields hpPct 0 (not NaN) for an actor with maxHp 0', () => {
        const zeroHpRoster: ReturnType<typeof roster> = [
            { actorId: 'attacker', side: 'player', name: 'Focus', position: 'M4', maxHp: 0 },
            {
                actorId: 'enemy-front',
                side: 'enemy',
                name: 'EnemyFront',
                position: 'M4',
                maxHp: 10000,
            },
        ];
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: {},
            roster: zeroHpRoster,
            numRounds: 1,
        });
        const hp = find(result, 1, 'attacker').hpPct;
        expect(hp).toBe(0);
        expect(Number.isNaN(hp)).toBe(false);
    });
});

describe('assembleBattleResult — heals', () => {
    it('credits healingDone to caster (full amount) and splits received across targets', () => {
        const events: CombatEvent[] = [
            {
                type: 'heal-performed',
                casterId: 'attacker',
                targets: ['attacker', 'player-team'],
                round: 1,
                amount: 4000,
            },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        expect(find(result, 1, 'attacker').healingDone).toBe(4000);
        // 4000 split evenly across 2 recipients => 2000 each (approximation: no per-recipient breakdown)
        expect(find(result, 1, 'attacker').healingReceived).toBe(2000);
        expect(find(result, 1, 'player-team').healingReceived).toBe(2000);
        expect(find(result, 1, 'attacker').shieldsAbsorbed).toBe(0);
    });
});

describe('assembleBattleResult — death + outcome + trim', () => {
    it('marks actor dead from the destroy round onward and wipes side -> winner + trim', () => {
        const events: CombatEvent[] = [
            { type: 'ship-destroyed', actorId: 'enemy-front', round: 2 },
            { type: 'ship-destroyed', actorId: 'enemy-back', round: 2 },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 4,
        });
        expect(find(result, 1, 'enemy-front').alive).toBe(true);
        expect(find(result, 2, 'enemy-front').alive).toBe(false);
        expect(result.outcome.winner).toBe('player');
        expect(result.outcome.lastRound).toBe(2);
        // trimmed: no rounds after lastRound
        expect(result.rounds.map((r) => r.round)).toEqual([1, 2]);
    });

    it('does not declare a spurious winner when one side is empty (empty enemy side)', () => {
        // Only player actors present; enemy side empty. [].every(...) === true would
        // mark the empty side as "wiped" at round 1 and award a bogus winner. The guard
        // (members.length > 0) makes this fail safe to draw at numRounds instead.
        const playerOnlyRoster: ReturnType<typeof roster> = [
            { actorId: 'attacker', side: 'player', name: 'Focus', position: 'M4', maxHp: 10000 },
            { actorId: 'player-team', side: 'player', name: 'Team', position: 'M3', maxHp: 10000 },
        ];
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: {},
            roster: playerOnlyRoster,
            numRounds: 3,
        });
        expect(result.outcome.winner).toBe('draw');
        expect(result.outcome.lastRound).toBe(3);
        expect(result.rounds.map((r) => r.round)).toEqual([1, 2, 3]);
    });

    it('returns draw at numRounds when neither side fully wiped', () => {
        const events: CombatEvent[] = [
            { type: 'ship-destroyed', actorId: 'enemy-front', round: 2 },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 3,
        });
        expect(result.outcome.winner).toBe('draw');
        expect(result.outcome.lastRound).toBe(3);
        expect(result.rounds.map((r) => r.round)).toEqual([1, 2, 3]);
    });
});

describe('assembleBattleResult — buff tracking', () => {
    it('tracks activeBuffs / activeDebuffs membership across rounds', () => {
        const events: CombatEvent[] = [
            {
                type: 'buff-applied',
                actorId: 'attacker',
                round: 1,
                buffName: 'Inc. ATK',
                duration: 2,
            },
            {
                type: 'debuff-applied',
                sourceId: 'attacker',
                targetId: 'enemy-front',
                round: 1,
                buffName: 'Defense Shred',
            },
            { type: 'buff-expired', actorId: 'attacker', round: 2, buffName: 'Inc. ATK' },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 3,
        });
        // round 1: attacker has buff, enemy-front has debuff
        expect(find(result, 1, 'attacker').activeBuffs).toContain('Inc. ATK');
        expect(find(result, 1, 'enemy-front').activeDebuffs).toContain('Defense Shred');
        // round 2: buff expired
        expect(find(result, 2, 'attacker').activeBuffs).not.toContain('Inc. ATK');
        // debuff persists (no expiry event)
        expect(find(result, 2, 'enemy-front').activeDebuffs).toContain('Defense Shred');
    });
});

describe('assembleBattleResult — per-round event log', () => {
    it('logs damage, heal, death lines (not attacked)', () => {
        const events: CombatEvent[] = [
            {
                type: 'ability-performed',
                actorId: 'attacker',
                targetId: 'enemy-front',
                round: 1,
                abilityType: 'damage',
                damage: 5000,
            },
            { type: 'attacked', attackerId: 'enemy-front', targetId: 'attacker', round: 1 },
            {
                type: 'heal-performed',
                casterId: 'attacker',
                targets: ['attacker'],
                round: 1,
                amount: 1000,
            },
            { type: 'ship-destroyed', actorId: 'enemy-front', round: 1 },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        const log = result.rounds[0].events;
        expect(log).toContainEqual({
            round: 1,
            kind: 'damage',
            actorId: 'attacker',
            targetId: 'enemy-front',
            amount: 5000,
        });
        expect(log).toContainEqual({
            round: 1,
            kind: 'heal',
            actorId: 'attacker',
            targetId: 'attacker',
            amount: 1000,
        });
        expect(log).toContainEqual({ round: 1, kind: 'death', actorId: 'enemy-front' });
        // `attacked` is NOT logged (no amount)
        expect(log.some((e) => (e as { kind: string }).kind === 'attacked')).toBe(false);
    });
});

describe('assembleBattleResult — per-round turn order', () => {
    it('collects distinct acting roster actorIds per round in emission order', () => {
        const events: CombatEvent[] = [
            { type: 'turn-started', actorId: 'enemy-front', round: 1 },
            { type: 'turn-started', actorId: 'attacker', round: 1 },
            // duplicate in the same round is collapsed (distinct)
            { type: 'turn-started', actorId: 'enemy-front', round: 1 },
            { type: 'turn-started', actorId: 'player-team', round: 1 },
            // round 2 has its own ordering
            { type: 'turn-started', actorId: 'attacker', round: 2 },
            { type: 'turn-started', actorId: 'enemy-back', round: 2 },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 2,
        });
        expect(result.rounds.find((r) => r.round === 1)!.turnOrder).toEqual([
            'enemy-front',
            'attacker',
            'player-team',
        ]);
        expect(result.rounds.find((r) => r.round === 2)!.turnOrder).toEqual([
            'attacker',
            'enemy-back',
        ]);
    });

    it('filters out turn-started for ids not on the roster (the dummy "enemy")', () => {
        const events: CombatEvent[] = [
            { type: 'turn-started', actorId: 'enemy', round: 1 },
            { type: 'turn-started', actorId: 'attacker', round: 1 },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        expect(result.rounds[0].turnOrder).toEqual(['attacker']);
    });
});

describe('assembleBattleResult — roster passthrough', () => {
    it('returns the roster without maxHp', () => {
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        expect(result.roster).toEqual([
            { actorId: 'attacker', side: 'player', name: 'Focus', position: 'M4' },
            { actorId: 'player-team', side: 'player', name: 'Team', position: 'M3' },
            { actorId: 'enemy-front', side: 'enemy', name: 'EnemyFront', position: 'M4' },
            { actorId: 'enemy-back', side: 'enemy', name: 'EnemyBack', position: 'M1' },
        ]);
    });
});
