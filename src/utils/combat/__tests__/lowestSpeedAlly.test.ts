import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';

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
    debuffLandingChance: 1,
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
