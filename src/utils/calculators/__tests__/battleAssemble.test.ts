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
 *   - buffs = buff-applied / buff-expired / debuff-applied / dot-applied
 *   - hpPct = maxHp - cumulative(damageTaken) over rounds <= r
 *   - per-round LOG is chronological (emission order) + attacker-centric damage
 *     (ability-performed: actorId=attacker, targetId, amount), with turn delimiters
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

describe('assembleBattleResult — per-round event log (chronological + attacker-centric)', () => {
    it('logs attacker-centric damage from ability-performed (actorId=attacker, targetId, amount)', () => {
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
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        const log = result.rounds[0].events;
        // Attacker-centric damage from ability-performed.
        expect(log).toContainEqual({
            round: 1,
            kind: 'damage',
            actorId: 'attacker',
            targetId: 'enemy-front',
            amount: 5000,
        });
        // `attacked` is NOT logged.
        expect(log.some((e) => (e as { kind: string }).kind === 'attacked')).toBe(false);
    });

    it('keeps damage lines targeting the dummy "enemy" (attacker-centric, dummy target accepted)', () => {
        const events: CombatEvent[] = [
            {
                type: 'ability-performed',
                actorId: 'attacker',
                targetId: 'enemy',
                round: 1,
                abilityType: 'damage',
                damage: 4321,
            },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        expect(result.rounds[0].events).toContainEqual({
            round: 1,
            kind: 'damage',
            actorId: 'attacker',
            targetId: 'enemy',
            amount: 4321,
        });
    });

    it("emits log lines in chronological (emission) order — turn-started before that turn's damage", () => {
        const events: CombatEvent[] = [
            { type: 'turn-started', actorId: 'attacker', round: 1 },
            {
                type: 'ability-performed',
                actorId: 'attacker',
                targetId: 'enemy-front',
                round: 1,
                abilityType: 'damage',
                damage: 1000,
            },
            { type: 'turn-started', actorId: 'enemy-front', round: 1 },
            {
                type: 'ability-performed',
                actorId: 'enemy-front',
                targetId: 'attacker',
                round: 1,
                abilityType: 'damage',
                damage: 2000,
            },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        const log = result.rounds[0].events;
        expect(log).toEqual([
            { round: 1, kind: 'turn', actorId: 'attacker' },
            {
                round: 1,
                kind: 'damage',
                actorId: 'attacker',
                targetId: 'enemy-front',
                amount: 1000,
            },
            { round: 1, kind: 'turn', actorId: 'enemy-front' },
            {
                round: 1,
                kind: 'damage',
                actorId: 'enemy-front',
                targetId: 'attacker',
                amount: 2000,
            },
        ]);
    });

    it('emits a turn delimiter per roster turn-started and skips the dummy "enemy"', () => {
        const events: CombatEvent[] = [
            { type: 'turn-started', actorId: 'attacker', round: 1 },
            { type: 'turn-started', actorId: 'enemy', round: 1 },
            { type: 'turn-started', actorId: 'enemy-front', round: 1 },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        const turns = result.rounds[0].events.filter((e) => e.kind === 'turn');
        // Dummy 'enemy' filtered; roster ids kept in emission order.
        expect(turns).toEqual([
            { round: 1, kind: 'turn', actorId: 'attacker' },
            { round: 1, kind: 'turn', actorId: 'enemy-front' },
        ]);
    });

    it('logs heal lines (caster + per-target even-split amount)', () => {
        const events: CombatEvent[] = [
            {
                type: 'heal-performed',
                casterId: 'attacker',
                targets: ['attacker', 'player-team'],
                round: 1,
                amount: 1000,
            },
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
            kind: 'heal',
            actorId: 'attacker',
            targetId: 'attacker',
            amount: 500,
        });
        expect(log).toContainEqual({
            round: 1,
            kind: 'heal',
            actorId: 'attacker',
            targetId: 'player-team',
            amount: 500,
        });
    });

    it('logs buff lines with the buff carrier as actorId and buffName as label', () => {
        const events: CombatEvent[] = [
            {
                type: 'buff-applied',
                actorId: 'player-team',
                round: 1,
                buffName: 'Attack Up',
                duration: 2,
            },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        expect(result.rounds[0].events).toContainEqual({
            round: 1,
            kind: 'buff',
            actorId: 'player-team',
            label: 'Attack Up',
        });
    });

    it('logs debuff lines with the victim (targetId) as actorId and buffName as label', () => {
        const events: CombatEvent[] = [
            {
                type: 'debuff-applied',
                sourceId: 'attacker',
                targetId: 'enemy-front',
                round: 1,
                buffName: 'Def Down',
            },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        expect(result.rounds[0].events).toContainEqual({
            round: 1,
            kind: 'debuff',
            actorId: 'enemy-front',
            label: 'Def Down',
        });
    });

    it('logs dot lines with the victim (targetId) as actorId and dotType as label', () => {
        const events: CombatEvent[] = [
            {
                type: 'dot-applied',
                sourceId: 'attacker',
                targetId: 'enemy-back',
                round: 1,
                dotType: 'corrosion',
                stacks: 3,
            },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        expect(result.rounds[0].events).toContainEqual({
            round: 1,
            kind: 'dot',
            actorId: 'enemy-back',
            label: 'corrosion',
        });
    });

    it('logs death lines with the destroyed actor as actorId', () => {
        const events: CombatEvent[] = [
            { type: 'ship-destroyed', actorId: 'enemy-front', round: 1 },
        ];
        const result = assembleBattleResult({
            events,
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });
        expect(result.rounds[0].events).toContainEqual({
            round: 1,
            kind: 'death',
            actorId: 'enemy-front',
        });
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

describe('assembleBattleResult — shield fields (H1 Task 8)', () => {
    // Scenario: 'attacker' is shielded (granted 10000) and takes a 3000 hit this round.
    // The shield absorbs 3000 and the remaining pool is 7000.
    // perRoundPerShield threads these values in; the ShipRoundState fields must reflect them.
    it('populates shieldGranted, shieldsAbsorbed, and currentShieldPool from perRoundPerShield', () => {
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: { 1: { attacker: 3000 } },
            perRoundPerShield: {
                1: {
                    attacker: { granted: 10000, absorbed: 3000, pool: 7000 },
                },
            },
            roster: roster(),
            numRounds: 1,
        });

        const ship = find(result, 1, 'attacker');
        expect(ship.shieldGranted).toBe(10000);
        expect(ship.shieldsAbsorbed).toBe(3000);
        expect(ship.currentShieldPool).toBe(7000);
    });

    it('defaults all shield fields to 0 when perRoundPerShield is absent', () => {
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });

        const ship = find(result, 1, 'attacker');
        expect(ship.shieldGranted).toBe(0);
        expect(ship.shieldsAbsorbed).toBe(0);
        expect(ship.currentShieldPool).toBe(0);
    });

    it("defaults all shield fields to 0 for an actor not present in that round's shield map", () => {
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: {},
            perRoundPerShield: {
                1: {
                    'enemy-front': { granted: 5000, absorbed: 1000, pool: 4000 },
                },
            },
            roster: roster(),
            numRounds: 1,
        });

        // 'attacker' has no entry in round 1's shield map
        const ship = find(result, 1, 'attacker');
        expect(ship.shieldGranted).toBe(0);
        expect(ship.shieldsAbsorbed).toBe(0);
        expect(ship.currentShieldPool).toBe(0);

        // 'enemy-front' has an entry
        const enemy = find(result, 1, 'enemy-front');
        expect(enemy.shieldGranted).toBe(5000);
        expect(enemy.shieldsAbsorbed).toBe(1000);
        expect(enemy.currentShieldPool).toBe(4000);
    });

    it('carries independent shield values across two rounds', () => {
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: {},
            perRoundPerShield: {
                1: { attacker: { granted: 10000, absorbed: 3000, pool: 7000 } },
                2: { attacker: { granted: 3000, absorbed: 3000, pool: 7000 } },
            },
            roster: roster(),
            numRounds: 2,
        });

        const r1 = find(result, 1, 'attacker');
        expect(r1.shieldGranted).toBe(10000);
        expect(r1.shieldsAbsorbed).toBe(3000);
        expect(r1.currentShieldPool).toBe(7000);

        const r2 = find(result, 2, 'attacker');
        // Round 2: only the top-up grant (3000), not the cumulative 13000
        expect(r2.shieldGranted).toBe(3000);
        expect(r2.shieldsAbsorbed).toBe(3000);
        expect(r2.currentShieldPool).toBe(7000);
    });
});

describe('assembleBattleResult — per-victim incoming fields (PR7 Task 7)', () => {
    // perRoundPerIncoming threads each covered victim's own damage-taken bucket
    // ({incoming, shieldAbsorbed, barrierAbsorbed}) into the ShipRoundState incoming fields.
    it('populates incomingDamage (NET HP = incoming - shield - barrier) plus raw absorbed fields', () => {
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: {},
            perRoundPerIncoming: {
                1: {
                    attacker: { incoming: 2800, shieldAbsorbed: 1200, barrierAbsorbed: 700 },
                },
            },
            roster: roster(),
            numRounds: 1,
        });

        const ship = find(result, 1, 'attacker');
        // incomingDamage is NET HP landed: 2800 - 1200 - 700 = 900.
        expect(ship.incomingDamage).toBe(900);
        // absorbed fields stay raw.
        expect(ship.incomingShieldAbsorbed).toBe(1200);
        expect(ship.incomingBarrierAbsorbed).toBe(700);
    });

    it('yields incomingDamage 0 when the hit is fully absorbed by shield/barrier', () => {
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: {},
            perRoundPerIncoming: {
                1: {
                    attacker: { incoming: 1000, shieldAbsorbed: 1000, barrierAbsorbed: 0 },
                },
            },
            roster: roster(),
            numRounds: 1,
        });

        const ship = find(result, 1, 'attacker');
        expect(ship.incomingDamage).toBe(0);
        expect(ship.incomingShieldAbsorbed).toBe(1000);
        expect(ship.incomingBarrierAbsorbed).toBe(0);
    });

    it('defaults all incoming fields to 0 when perRoundPerIncoming is absent', () => {
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: {},
            roster: roster(),
            numRounds: 1,
        });

        const ship = find(result, 1, 'attacker');
        expect(ship.incomingDamage).toBe(0);
        expect(ship.incomingShieldAbsorbed).toBe(0);
        expect(ship.incomingBarrierAbsorbed).toBe(0);
    });

    it("defaults all incoming fields to 0 for an actor not present in that round's incoming map", () => {
        const result = assembleBattleResult({
            events: [],
            perRoundPerTarget: {},
            perRoundPerIncoming: {
                1: {
                    'enemy-front': { incoming: 500, shieldAbsorbed: 0, barrierAbsorbed: 0 },
                },
            },
            roster: roster(),
            numRounds: 1,
        });

        // 'attacker' has no entry in round 1's incoming map
        const ship = find(result, 1, 'attacker');
        expect(ship.incomingDamage).toBe(0);
        expect(ship.incomingShieldAbsorbed).toBe(0);
        expect(ship.incomingBarrierAbsorbed).toBe(0);

        // 'enemy-front' carries its own bucket
        const enemy = find(result, 1, 'enemy-front');
        expect(enemy.incomingDamage).toBe(500);
    });
});
