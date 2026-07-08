/**
 * SP-F F4 — Isha/Nayra reciprocal `ally-on-team` gate, LIVE in the team sim.
 *
 * End-to-end proof that the start-of-round 'Defensive Affinity Override' grant gated
 * `ally-on-team: Nayra` fires ONLY when a "Nayra"-named ally is actually on the roster — the
 * engine now threads ship names (nameByActorId → buildDrainContext.allyTeamNames → the
 * `ally-on-team` evaluator) instead of the old manual assume-met. Exercises the full threading:
 * CombatEngineInput.name → nameByActorId → the drain-time condition context.
 */
import { describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `g${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

// Isha: an active damage skill + a passive start-of-round self-grant of 'Defensive Affinity
// Override' gated on Nayra being on the same team (the reciprocal `ally-on-team` gate).
const ishaSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } })],
        },
        {
            slot: 'passive',
            abilities: [
                ab({
                    type: 'buff',
                    target: 'self',
                    trigger: 'start-of-round',
                    conditions: [{ subject: 'ally-on-team', derivable: false, buffName: 'Nayra' }],
                    config: {
                        type: 'buff',
                        buffName: 'Defensive Affinity Override',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                    },
                }),
            ],
        },
    ],
});

const baseInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: ishaSkills(),
    name: 'Isha',
    enemyDefense: 8000,
    enemyHp: 400000,
    numRounds: 2,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 6000,
    hp: 30000,
    ...overrides,
});

const overrideApplications = (input: CombatEngineInput): number => {
    idCounter = 0;
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('buff-applied', (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events.filter(
        (e) => e.type === 'buff-applied' && e.buffName === 'Defensive Affinity Override'
    ).length;
};

const teamMate = (name: string) => ({
    id: `${name.toLowerCase()}-1`,
    speed: 90,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    name,
});

describe('SP-F F4 — reciprocal ally-on-team gate is live in the team sim', () => {
    it('grants Defensive Affinity Override when Nayra IS on the team', () => {
        expect(
            overrideApplications(baseInput({ teamActors: [teamMate('Nayra')] }))
        ).toBeGreaterThan(0);
    });

    it('does NOT grant it when Nayra is NOT on the team (a differently-named ally)', () => {
        expect(overrideApplications(baseInput({ teamActors: [teamMate('Corvus')] }))).toBe(0);
    });
});
