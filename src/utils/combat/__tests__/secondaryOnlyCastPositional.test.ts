/**
 * #657 — a cast whose only damage clause is stat-scaled (`additional-damage`, Prophet's "deals
 * damage equal to 50x its security") with no `damage` ability is still a HIT, and lands per
 * victim through the positional apply like every other hit: mitigated by the victim's LIVE
 * defence (`victimDefenseProfileOf`), which folds the victim's own Defense Up.
 *
 * The victim carries a standing Defense Up from its passive slot, so its live defence is
 * 1000 × 1.5 = 1500 while its base stat is 1000. A read of the base stat would mitigate less and
 * land more damage. The victim is SLOWER than the attacker and the fight is one round, so on the
 * enemy-attacks-player arm the victim has no turn context yet either.
 *
 * Every actor kind: the player focus and a walked team ship hitting an enemy, and an enemy hitting
 * the player.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { parsePattern, parseTarget } from '../../targetingParser';
import { calculateDamageReduction } from '../../autogear/statResolution';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

const BIG_HP = 10_000_000;
const SECURITY = 1_000;
const MULTIPLE = 50; // pct 5000 / 100
const SECONDARY = SECURITY * MULTIPLE; // 50,000
const BASE_DEFENCE = 1_000;
const DEFENSE_UP_PCT = 50;
const LIVE_DEFENCE = BASE_DEFENCE * (1 + DEFENSE_UP_PCT / 100); // 1500

const landedAgainst = (defence: number): number =>
    SECONDARY * (1 - calculateDamageReduction(defence) / 100);

const securityBasisDamage: Ability = {
    id: 'ab-security-basis',
    type: 'additional-damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'additional-damage', stat: 'security', pct: MULTIPLE * 100 },
};

const defenseUp: Ability = {
    id: 'self-defense-up',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Defense Up II',
        parsedEffects: { defense: DEFENSE_UP_PCT },
        stacks: 1,
        isStackable: false,
        duration: 10,
    },
};

const attackerSlots: ShipSkills['slots'] = [{ slot: 'active', abilities: [securityBasisDamage] }];
const victimSlots: ShipSkills['slots'] = [{ slot: 'passive', abilities: [defenseUp] }];

const common = {
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    defensePenetration: 0,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    chargeCount: 0,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    attack: 0,
    crit: 0,
    critDamage: 0,
    hacking: 100_000,
    teamActors: [],
} satisfies Partial<CombatEngineInput>;

const enemy = (
    id: string,
    o: { speed: number; defence: number; security: number; slots: ShipSkills['slots'] }
): NonNullable<CombatEngineInput['enemyAttackers']>[number] => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: o.defence,
        hp: BIG_HP,
        speed: o.speed,
        hacking: 100_000,
        security: o.security,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: o.slots },
});

describe('#657 a secondary-only cast lands per victim against LIVE defence', () => {
    it('player attacker → enemy victim holding Defense Up', () => {
        let actors: CombatActor[] = [];
        runCombat({
            ...common,
            defence: 0,
            hp: BIG_HP,
            speed: 900,
            position: 'M4',
            security: SECURITY,
            shipSkills: { slots: attackerSlots },
            enemyAttackers: [
                enemy('victim', {
                    speed: 100,
                    defence: BASE_DEFENCE,
                    security: 0,
                    slots: victimSlots,
                }),
            ],
            __testTapActors: (a) => {
                actors = a;
            },
        });
        const victim = actors.find((a) => a.id.includes('victim'))!;
        expect(BIG_HP - victim.currentHp).toBeCloseTo(landedAgainst(LIVE_DEFENCE), 6);
    });

    it('walked team attacker → enemy victim holding Defense Up', () => {
        let actors: CombatActor[] = [];
        runCombat({
            ...common,
            defence: 0,
            hp: BIG_HP,
            speed: 100,
            position: 'M3',
            security: 0,
            shipSkills: { slots: [] },
            teamActors: [
                {
                    id: 'team-caster',
                    speed: 900,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    walk: {
                        shipSkills: { slots: attackerSlots },
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            defensePenetration: 0,
                            hacking: 100_000,
                            security: SECURITY,
                            defence: 0,
                            hp: BIG_HP,
                        },
                        affinityDamageModifier: 0,
                        affinityCritCap: 100,
                        affinityCritPenalty: 0,
                        hasChargedSkill: false,
                    },
                },
            ],
            enemyAttackers: [
                enemy('victim', {
                    speed: 500,
                    defence: BASE_DEFENCE,
                    security: 0,
                    slots: victimSlots,
                }),
            ],
            __testTapActors: (a) => {
                actors = a;
            },
        });
        const victim = actors.find((a) => a.id.includes('victim'))!;
        expect(BIG_HP - victim.currentHp).toBeCloseTo(landedAgainst(LIVE_DEFENCE), 6);
    });

    it('enemy attacker → player victim holding Defense Up', () => {
        let actors: CombatActor[] = [];
        runCombat({
            ...common,
            defence: BASE_DEFENCE,
            hp: BIG_HP,
            speed: 100,
            position: 'M4',
            security: 0,
            shipSkills: { slots: victimSlots },
            enemyAttackers: [
                enemy('caster', {
                    speed: 900,
                    defence: 0,
                    security: SECURITY,
                    slots: attackerSlots,
                }),
            ],
            __testTapActors: (a) => {
                actors = a;
            },
        });
        const focus = actors.find((a) => a.id === 'attacker')!;
        expect(BIG_HP - focus.currentHp).toBeCloseTo(landedAgainst(LIVE_DEFENCE), 6);
    });
});
