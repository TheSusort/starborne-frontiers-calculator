/**
 * statsSnapshot.integration.test.ts — Task 6a: a LOG-ONLY `stats-snapshot` event emitted once
 * per turn for the acting actor, immediately after `turn-started`.
 *
 * `simulateBattle`/`simulateDPS` expose no per-event callback hook — the only way to observe an
 * engine emission from a test is to subscribe to the engine's OWN event bus, which `runCombat`
 * (via `simulateDPS`) accepts as a write-only tap (`input.bus`). This mirrors the pattern used by
 * `dynamicSpeed.smoke.test.ts` (bus passed into `simulateDPS`, listeners registered before the run).
 *
 * Non-vacuity: the attacker starts with a pre-resolved "Attack Up" self-buff (a start-of-combat
 * buff, present from round 1 via `selfBuffs`/`toSimBuffs` — Layer 1 of the effective-stats fold),
 * so the snapshot's `attack` must exceed the raw base `attack` input. Pre-fix (no `stats-snapshot`
 * emission at all) this test is RED — no listener ever fires.
 */
import { describe, it, expect } from 'vitest';
import { simulateDPS } from '../../calculators/dpsSimulator';
import {
    simulateBattle,
    BattlePlacement,
    BattleSimulationInput,
} from '../../calculators/battleSimulator';
import { createEventBus, CombatEvent } from '../events';
import { Ability } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

const damageAbility = (multiplier: number, id = 'dmg'): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

const BASE_ATTACK_A = 1000;

describe('stats-snapshot event (Task 6a)', () => {
    it('emits a stats-snapshot per turn reflecting live buffed stats', () => {
        const bus = createEventBus();
        const seen: Extract<CombatEvent, { type: 'stats-snapshot' }>[] = [];
        bus.on('stats-snapshot', (e) => seen.push(e));

        simulateDPS({
            attack: BASE_ATTACK_A,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            chargeCount: 0,
            enemyDefense: 0,
            enemyHp: 1_000_000,
            hp: 500_000,
            rounds: 2,
            selfBuffs: [
                {
                    id: 'atk-up',
                    buffName: 'Attack Up',
                    stacks: 1,
                    parsedEffects: { attack: 30 },
                    isStackable: false,
                },
            ],
            enemyDebuffs: [],
            shipSkills: { slots: [{ slot: 'active', abilities: [damageAbility(100)] }] },
            hacking: 250,
            enemySecurity: 100,
            bus,
        });

        expect(seen.length).toBeGreaterThan(0);
        const snap = seen.find((e) => e.actorId === 'attacker');
        expect(snap).toBeDefined();
        expect(snap!.stats.attack).toBeGreaterThan(BASE_ATTACK_A); // buff folded in
        expect(snap!.stats.currentHp).toBeGreaterThan(0);
        expect(snap!.round).toBeGreaterThan(0);
    });

    /** Bug repro: the FOCUS player's own `security` (e.g. Code Guard's hacking→security fold)
     *  never reached the engine's `attacker` actor — `effectiveStatsOf(...).security` read
     *  `(undefined ?? 0) + buff`, so the per-turn snapshot always showed 0 for the focus,
     *  regardless of the ship's real (gear-resolved) security. Team actors and enemies were
     *  unaffected (they thread security via toWalkStats/toEnemyStats already). */
    it("surfaces the FOCUS actor's own security in its stats-snapshot turn (not 0)", () => {
        const FOCUS_SECURITY = 359;

        const focusShip: Ship = {
            id: 'focus-ship',
            name: 'Focus',
            rarity: 'legendary',
            faction: 'MPL',
            type: 'ATTACKER',
            baseStats: {
                hp: 100_000,
                attack: 1000,
                defence: 0,
                hacking: 200,
                security: FOCUS_SECURITY,
                crit: 0,
                critDamage: 0,
                speed: 100,
            },
            equipment: {},
            implants: {},
            refits: [],
            affinity: 'antimatter',
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            activeTarget: 'back',
            activePattern: 'Pattern-Base',
            chargeSkillCharge: 0,
        };

        const enemyShip: Ship = {
            id: 'enemy-ship',
            name: 'Enemy',
            rarity: 'legendary',
            faction: 'MPL',
            type: 'ATTACKER',
            baseStats: {
                hp: 100_000,
                attack: 0,
                defence: 0,
                hacking: 200,
                security: 100,
                crit: 0,
                critDamage: 0,
                speed: 50,
            },
            equipment: {},
            implants: {},
            refits: [],
            affinity: 'antimatter',
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            activeTarget: 'front',
            activePattern: 'Pattern-Base',
            chargeSkillCharge: 0,
        };

        const placement = (ship: Ship, position: Position): BattlePlacement => ({
            ship,
            position,
            statOverrides: {
                attack: ship.baseStats.attack,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: ship.baseStats.hacking,
                defence: ship.baseStats.defence,
                hp: ship.baseStats.hp,
                speed: ship.baseStats.speed,
            },
        });

        const input: BattleSimulationInput = {
            playerTeam: [placement(focusShip, 'M4')],
            enemyTeam: [placement(enemyShip, 'T1')],
            rounds: 1,
        };

        const result = simulateBattle(input);
        const turn = result.combatLog[0]?.turns.find((t) => t.actorId === 'attacker');
        expect(turn).toBeDefined();
        expect(turn!.statsSnapshot).toBeDefined();
        expect(turn!.statsSnapshot!.security).toBe(FOCUS_SECURITY);
    });
});
