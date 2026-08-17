import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { CombatStatBlock, TeamActorInput } from '../../../types/calculator';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ls${++idc}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// Focus deals 100% damage and gains a +100% Attack start-of-round self-buff GATED on
// lowest-speed-ally. The buff couples into the same round's outgoing damage, so directDamage
// doubles (20000) only on rounds the gate passes; otherwise it stays at base 10000.
const skill = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    target: 'enemy',
                    config: { type: 'damage', multiplier: 100 },
                }),
                ab({
                    type: 'buff',
                    target: 'self',
                    trigger: 'start-of-round',
                    conditions: [{ subject: 'lowest-speed-ally', derivable: true }],
                    config: {
                        type: 'buff',
                        buffName: 'Attack Up',
                        parsedEffects: { attack: 100 },
                        stacks: 1,
                        isStackable: false,
                        duration: 99,
                    },
                }),
            ],
        },
    ],
});

const BASE = (o: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: skill(),
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    defence: 2000,
    hp: 1_000_000,
    ...o,
});

describe('lowest-speed-ally live gate', () => {
    it('single attacker (no team) → focus is trivially slowest → buff fires (damage doubles)', () => {
        idc = 0;
        const r = runCombat(BASE({ speed: 100 }));
        expect(r.rounds[0].directDamage).toBe(20000);
    });

    it('focus is the slowest on the team → buff fires', () => {
        idc = 0;
        const r = runCombat(
            BASE({
                speed: 10,
                teamActors: [
                    {
                        id: 't1',
                        speed: 100,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                    },
                ],
            })
        );
        expect(r.rounds[0].directDamage).toBe(20000);
    });

    it('a teammate is slower than focus → focus is NOT lowest → buff gated off (base damage)', () => {
        idc = 0;
        const r = runCombat(
            BASE({
                speed: 100,
                teamActors: [
                    {
                        id: 't1',
                        speed: 10,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                    },
                ],
            })
        );
        expect(r.rounds[0].directDamage).toBe(10000);
    });
});

// ---------------------------------------------------------------------------
// Live lowest-speed-ally gate: speed buff makes a faster actor the NEW slowest
// ---------------------------------------------------------------------------
// Scenario: attacker A (speed 100) vs teammate B (speed 120). Without buffs, A is
// the slowest → the lowest-speed-ally gate fires for A. B then self-applies a
// Speed Down (-30%) on its first turn (B acts first because it is faster). By round 2
// B's effective speed = 120 × 0.70 = 84 < A's 100 → B is now the slowest. The gate
// must NO LONGER fire for A.
//
// Observable: the start-of-round Attack Up on A has duration 1 (expires after each
// round it fires). Round 1: gate passes → damage doubles. Round 2: with the live fix
// the gate is blocked → damage stays at base. With the old STATIC set the gate would
// still pass (A was in the set at construction time) → damage would double again.
describe('lowest-speed-ally live gate — speed buff shifts lowest-speed actor', () => {
    let sdIdc = 0;
    const sdAb = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
        id: `sd${++sdIdc}`,
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        ...p,
    });

    // Attacker's skill: 100% damage + start-of-round Attack Up (+100%, duration 1,
    // gated on lowest-speed-ally). Duration 1 means the buff expires after the turn it
    // was applied → each round is tested independently.
    const attackerSkill = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    sdAb({
                        type: 'damage',
                        target: 'enemy',
                        config: { type: 'damage', multiplier: 100 },
                    }),
                    sdAb({
                        type: 'buff',
                        target: 'self',
                        trigger: 'start-of-round',
                        conditions: [{ subject: 'lowest-speed-ally', derivable: true }],
                        config: {
                            type: 'buff',
                            buffName: 'Attack Up (LSA)',
                            parsedEffects: { attack: 100 },
                            stacks: 1,
                            isStackable: false,
                            duration: 1,
                        },
                    }),
                ],
            },
        ],
    });

    // Team actor B's skill: on-cast self-buff Speed Down (-30%), long duration so it
    // is still active in round 2 when the gate re-evaluates.
    const speedDownSkill = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'b-spd-down',
                        type: 'buff',
                        target: 'self',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'buff',
                            buffName: 'Speed Down',
                            parsedEffects: { speed: -30 },
                            stacks: 1,
                            isStackable: false,
                            duration: 99,
                        },
                    },
                ],
            },
        ],
    });

    const minStats: CombatStatBlock = {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 0,
        defence: 0,
        hp: 0,
    };

    const teamB = (): TeamActorInput => ({
        id: 'b',
        speed: 120, // faster than attacker → acts first each round
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        shipSkills: speedDownSkill(),
        stats: minStats,
    });

    const baseSimInput = (): DPSSimulationInput => ({
        attack: 10000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        rounds: 2,
        selfBuffs: [],
        enemyDebuffs: [],
        hacking: 0,
        enemySecurity: 0,
        speed: 100,
        shipSkills: attackerSkill(),
        teamActors: [teamB()],
    });

    it('round 1: A is still lowest (B not yet debuffed) → gate fires → damage doubles', () => {
        sdIdc = 0;
        const r = simulateDPS(baseSimInput());
        // Round 1: B has no Speed Down yet at start-of-round. A (100) < B (120) → gate fires.
        expect(r.rounds[0].directDamage).toBe(20000);
    });

    it('round 2: Speed Down makes B the slowest → gate blocked for A → base damage', () => {
        sdIdc = 0;
        const r = simulateDPS(baseSimInput());
        // Round 2: B applied Speed Down on its first turn (round 1). B effective speed =
        // 120 × 0.70 = 84 < A's 100 → B is now lowest. Gate must NOT fire for A.
        // With old STATIC set A is still in lowestSpeedAllyIds → gate would wrongly fire.
        expect(r.rounds[1].directDamage).toBe(10000);
    });
});
