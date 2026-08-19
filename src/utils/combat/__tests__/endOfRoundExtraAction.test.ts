import { describe, it, expect } from 'vitest';
import {
    simulateDPS,
    DPSSimulationInput,
    SYNTHESIZED_DPS_ENEMY_ID,
} from '../../calculators/dpsSimulator';
import { TeamActorInput, CombatStatBlock } from '../../../types/calculator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { createEventBus, CombatEvent } from '../events';

// Task 4 integration test: prove an "end of round" extra action drains AFTER the whole normal
// speed pool, regardless of the granter's speed-rank, while a DEFAULT extra action stays
// speed-positioned in the normal pool.
//
// Scenario: a FAST attacker (base speed 150) and a SLOWER walked team ship (base speed 100).
//   - Default extra action (oncePerRound on-cast, endOfRound:false): the attacker grants itself
//     +1 NORMAL action on its turn → re-picked by speed (150 > 100) → its extra fires BEFORE the
//     team → order [attacker, attacker, team].
//   - End-of-round extra action (endOfRound:true): the +1 lands in the end-of-round pool, drained
//     only after the normal pool empties → the team's normal turn fires first, the attacker's
//     extra turn fires LAST → order [attacker, team, attacker]. Despite the attacker being faster.

const teamStats = (overrides: Partial<CombatStatBlock> = {}): CombatStatBlock => ({
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    hacking: 250,
    defence: 0,
    hp: 0,
    ...overrides,
});

const damageAbility = (multiplier: number, id = 'dmg'): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

// On-cast self extra-action grant. oncePerRound bounds it to one grant per round; endOfRound
// selects which pool the engine routes the +1 into.
const extraActionSelf = (endOfRound: boolean, id = 'extra'): Ability => ({
    id,
    type: 'extra-action',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'extra-action', oncePerRound: true, endOfRound },
});

const slowTeam = (overrides: Partial<TeamActorInput> = {}): TeamActorInput => ({
    id: 'team',
    speed: 100, // slower than the attacker (150) → acts AFTER the attacker's normal turn
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: { slots: [{ slot: 'active', abilities: [damageAbility(100, 'tdmg')] }] },
    stats: teamStats(),
    ...overrides,
});

const baseInput = (overrides: Partial<DPSSimulationInput> = {}): DPSSimulationInput => ({
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 100_000_000,
    rounds: 1,
    speed: 150, // faster than the team (100)
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: { slots: [{ slot: 'active', abilities: [damageAbility(100)] }] },
    hacking: 250,
    enemySecurity: 100,
    ...overrides,
});

/**
 * Per-round PLAYER turn order from turn-started events (drops the opposing actor).
 *
 * SP-4b-2a: a scalar-only `simulateDPS` run now fights a REAL, positioned enemy
 * (`SYNTHESIZED_DPS_ENEMY_ID`); the vestigial dummy `enemy` no longer takes a turn — and since
 * SP-4c-2c not on any run at all (`turnOrderActors` drops it unconditionally; the
 * `dummyEnemyIsVestigial` gate is deleted). The id to drop moved from `'enemy'` to `'enemy-1'`; the
 * player orders asserted below are unchanged (the synthesized enemy keeps the dummy's default
 * speed 50, so it still sorts last, and carries `attack: 0` with no `shipSkills`).
 */
const playerTurnOrder = (events: CombatEvent[]): string[][] => {
    const byRound = new Map<number, string[]>();
    for (const e of events) {
        if (e.type !== 'turn-started') continue;
        if (e.actorId === SYNTHESIZED_DPS_ENEMY_ID) continue;
        const list = byRound.get(e.round) ?? [];
        list.push(e.actorId);
        byRound.set(e.round, list);
    }
    return [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
};

const runOrder = (attackerExtra: Ability): string[][] => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('turn-started', (e) => events.push(e));
    const attacker: ShipSkills = {
        slots: [{ slot: 'active', abilities: [damageAbility(100), attackerExtra] }],
    };
    simulateDPS(baseInput({ shipSkills: attacker, teamActors: [slowTeam()], bus }));
    return playerTurnOrder(events);
};

describe('end-of-round extra actions (Task 4)', () => {
    it('a DEFAULT extra action on the faster actor stays speed-positioned (fires before the slower actor)', () => {
        const order = runOrder(extraActionSelf(false));
        expect(order.length).toBe(1);
        // Attacker (150) acts, grants itself +1 NORMAL action, re-picked by speed before team (100).
        expect(order[0]).toEqual(['attacker', 'attacker', 'team']);
    });

    it('an END-OF-ROUND extra action drains after the whole normal pool (fires LAST despite being faster)', () => {
        const order = runOrder(extraActionSelf(true));
        expect(order.length).toBe(1);
        // Attacker (150) acts, grants itself an END-OF-ROUND action → the team's normal turn fires
        // first, then the attacker's extra turn drains last. The extra turn is NOT speed-positioned.
        expect(order[0]).toEqual(['attacker', 'team', 'attacker']);
    });
});
