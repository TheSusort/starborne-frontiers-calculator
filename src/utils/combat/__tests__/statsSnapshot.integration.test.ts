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
import { createEventBus, CombatEvent } from '../events';
import { Ability } from '../../../types/abilities';

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
});
