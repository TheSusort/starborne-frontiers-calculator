import { describe, it, expect } from 'vitest';
import {
    simulateDPS,
    DPSSimulationInput,
    SYNTHESIZED_DPS_ENEMY_ID,
} from '../../calculators/dpsSimulator';
import { TeamActorInput, CombatStatBlock } from '../../../types/calculator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { createEventBus, CombatEvent } from '../events';

// Task 3 smoke test: prove the selection-based action pool reads LIVE effective speed each step,
// so a speed buff applied mid-combat reorders the remaining/next-round turns. The per-turn WORK
// is unchanged — this asserts ONLY that turn ORDER responds to a live speed change.
//
// Scenario: attacker (base speed 100) vs one walked team ship (base speed 120). With no speed
// buff the team is always faster → every round emits team-then-attacker. The attacker's active
// skill applies a +50% Speed Up to ITSELF (effective speed 150 once live), so from the round
// AFTER it first fires, the attacker outranks the team → the order flips to attacker-then-team.

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

// A self-targeted timed Speed Up (+50%). Folds through toSimBuffs → calculateBuffTotals →
// foldSpeedBuffPct, which effectiveSpeedOf reads live each selection step.
const speedUpSelf = (id = 'spd'): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Speed Up',
        parsedEffects: { speed: 50 },
        stacks: 1,
        isStackable: false,
        duration: 10,
    },
});

const walkedTeam = (overrides: Partial<TeamActorInput> = {}): TeamActorInput => ({
    id: 'team',
    speed: 120, // faster than the unbuffed attacker (100) → acts first when no speed buff is live
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
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: { slots: [{ slot: 'active', abilities: [damageAbility(100)] }] },
    hacking: 250,
    enemySecurity: 100,
    ...overrides,
});

/**
 * Collect per-round PLAYER turn order from turn-started events (drops the opposing actor).
 *
 * SP-4b-2a: a scalar-only `simulateDPS` run now fights a REAL, positioned enemy
 * (`SYNTHESIZED_DPS_ENEMY_ID`), and the vestigial dummy `enemy` no longer takes a turn at all
 * (`dummyEnemyIsVestigial`, engine.ts). So the id to drop moved from `'enemy'` to `'enemy-1'`.
 * The player order this asserts is unchanged — the synthesized enemy has `attack: 0`, no
 * `shipSkills` and the dummy's old default speed (50), so it neither reorders the pool nor
 * touches the damage math.
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

describe('dynamic-speed turn order (Task 3 smoke)', () => {
    it('a self Speed Up on the slower actor flips the emitted turn order vs the no-buff baseline', () => {
        // Baseline: attacker has NO speed buff → team (120) always precedes attacker (100).
        const baselineBus = createEventBus();
        const baselineEvents: CombatEvent[] = [];
        baselineBus.on('turn-started', (e) => baselineEvents.push(e));
        simulateDPS(baseInput({ teamActors: [walkedTeam()], bus: baselineBus }));

        const baselineOrder = playerTurnOrder(baselineEvents);
        // Every round: team before attacker.
        expect(baselineOrder.length).toBe(3);
        for (const round of baselineOrder) {
            expect(round).toEqual(['team', 'attacker']);
        }

        // Buffed: the attacker's active skill applies a +50% self Speed Up (→ effective 150).
        const buffedBus = createEventBus();
        const buffedEvents: CombatEvent[] = [];
        buffedBus.on('turn-started', (e) => buffedEvents.push(e));
        const buffedAttacker: ShipSkills = {
            slots: [{ slot: 'active', abilities: [damageAbility(100), speedUpSelf()] }],
        };
        simulateDPS(
            baseInput({
                shipSkills: buffedAttacker,
                teamActors: [walkedTeam()],
                bus: buffedBus,
            })
        );

        const buffedOrder = playerTurnOrder(buffedEvents);
        expect(buffedOrder.length).toBe(3);

        // Round 1: attacker still base speed (100) at selection time (the buff lands on its
        // own turn, AFTER selection) → team (120) acts first, unchanged from baseline.
        expect(buffedOrder[0]).toEqual(['team', 'attacker']);

        // Rounds 2+: the live +50% Speed Up makes the attacker (150) outrank the team (120) at
        // selection time → the order FLIPS to attacker-then-team. This is the mechanism: the
        // selection loop read the buffed effective speed, not the static base speed.
        expect(buffedOrder[1]).toEqual(['attacker', 'team']);
        expect(buffedOrder[2]).toEqual(['attacker', 'team']);

        // And the flip is a genuine divergence from the baseline (guards against both being equal).
        expect(buffedOrder[1]).not.toEqual(baselineOrder[1]);
    });
});
