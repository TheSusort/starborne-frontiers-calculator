/**
 * How attack and outgoing-damage terms compose on a direct hit — owner in-game measurements
 * R198–R201 (2026-10-16):
 *
 *   attack   = base × (1 + leader attack% + Σ attack buffs)                       (R200)
 *   outgoing = (1 + Σ Out. Damage buffs + Menace/Giant Slayer proc%)                (R198)
 *            × (1 + leader outgoing%)                                              (R199)
 *            × (1 + Arcane Siege%)                                                 (R201)
 *
 * Every case compares two one-round runs that differ ONLY in the term under test, so the ratio
 * of damage dealt is exactly the composition factor (no defence, no affinity, no crit variance).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import { emptyPreFightModifiers } from '../preFight';
import type { PreFightCombatModifiers } from '../preFight';
import { attackingEnemy, bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';
import { dealtBy } from '../__testutils__/perTargetDealt';
import { Ability } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';

beforeEach(() => setupKeyedRng(198));

const preFight = (overrides: Partial<PreFightCombatModifiers>): PreFightCombatModifiers => ({
    ...emptyPreFightModifiers(),
    ...overrides,
});

const damageAb: Ability = {
    id: 'dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
};

/** Legendary Menace with a forced proc: every crit is amplified by 45%. */
const forcedMenace: Ability = {
    id: 'menace',
    type: 'outgoing-amplification',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'outgoing-amplification',
        condition: 'amplify-on-crit',
        ampPct: 45,
        procChance: 1,
    },
};

const buff = (buffName: string, parsedEffects: SelectedGameBuff['parsedEffects']) => ({
    id: buffName,
    buffName,
    stacks: 1,
    isStackable: false,
    parsedEffects,
});
const OUT_DAMAGE_UP_III = buff('Out. Damage Up III', { outgoingDamage: 45 });
const ATTACK_UP_III = buff('Attack Up III', { attack: 45 });

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [damageAb] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 40_000,
    ...overrides,
});

const dealt = (input: CombatEngineInput): number => dealtBy(runCombat(input).rounds, 'attacker');

describe('R198 — a Menace proc adds into the Out. Damage buff sum', () => {
    it('under Out. Damage Up III, a +45% proc scales the crit by 1.90/1.45, not 1.45', () => {
        const critting = { crit: 100, critDamage: 50, selfBuffs: [OUT_DAMAGE_UP_III] };
        const noProc = dealt(BASE(critting));
        const proc = dealt(
            BASE({
                ...critting,
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb] },
                        { slot: 'passive', abilities: [forcedMenace] },
                    ],
                },
            })
        );
        expect(noProc).toBeGreaterThan(0);
        expect(proc / noProc).toBeCloseTo(1.9 / 1.45, 9);
    });
});

describe('R199 — the squad-leader outgoing bonus is its own multiplier', () => {
    it('Viper II (+7.5%) plus Out. Damage Up III is 1.45 × the leader-only hit', () => {
        const leaderOnly = dealt(BASE({ preFight: preFight({ outgoingDamage: 7.5 }) }));
        const leaderAndBuff = dealt(
            BASE({ preFight: preFight({ outgoingDamage: 7.5 }), selfBuffs: [OUT_DAMAGE_UP_III] })
        );
        expect(leaderOnly).toBeCloseTo(10_000 * 1.075, 6);
        expect(leaderAndBuff / leaderOnly).toBeCloseTo(1.45, 9);
    });
});

describe('R200 — the squad-leader attack bonus adds with attack buffs', () => {
    it('Viper I (+10% attack) alone raises the hit by 10%', () => {
        expect(dealt(BASE({ preFight: preFight({ attackPct: 10 }) }))).toBeCloseTo(11_000, 6);
    });

    it('Viper I (+10%) with Attack Up III (+45%) hits for base × 1.55, not 1.10 × 1.45', () => {
        const plain = dealt(BASE());
        const both = dealt(
            BASE({ preFight: preFight({ attackPct: 10 }), selfBuffs: [ATTACK_UP_III] })
        );
        expect(plain).toBeCloseTo(10_000, 6);
        expect(both / plain).toBeCloseTo(1.55, 9);
    });

    it('an enemy attacker carries its leader attack % and outgoing factor the same way', () => {
        const enemyDealt = (preFightOverrides?: Partial<PreFightCombatModifiers>) =>
            dealtBy(
                runCombat(
                    BASE({
                        shipSkills: { slots: [] },
                        enemyAttackers: attackingEnemy({
                            stats: { hp: 10_000_000 },
                            ...(preFightOverrides ? { preFight: preFight(preFightOverrides) } : {}),
                        }),
                    })
                ).rounds,
                BARE_ENEMY_ID
            );
        const plain = enemyDealt();
        expect(plain).toBeGreaterThan(0);
        expect(enemyDealt({ attackPct: 10, outgoingDamage: 7.5 }) / plain).toBeCloseTo(
            1.1 * 1.075,
            9
        );
    });
});

describe('R201 — Arcane Siege is its own multiplier', () => {
    const arcaneSiege = (): Ability => {
        const ship: Ship = {
            id: 'siege-ship',
            name: 'Siege Ship',
            rarity: 'legendary',
            faction: 'AURELIAN_SOVEREIGNTY',
            type: 'ATTACKER',
            baseStats: {} as Ship['baseStats'],
            equipment: {},
            implants: { implant_minor_alpha: 'arcane-siege-legendary' },
            refits: [],
        };
        const piece: GearPiece = {
            id: 'arcane-siege-legendary',
            slot: 'implant_minor_alpha',
            level: 16,
            stars: 6,
            rarity: 'legendary',
            mainStat: null,
            subStats: [],
            setBonus: 'ARCANE_SIEGE',
        };
        const found = buildEquipmentAbilities(ship, (id) => (id === piece.id ? piece : undefined));
        const ability = found.find((a) => a.id.startsWith('equip-implant-ARCANE_SIEGE'));
        if (!ability) throw new Error('Arcane Siege ability not built');
        return ability;
    };

    it('shielded, with Out. Damage Up III and a +10% leader: 1.45 × 1.10 × 1.20', () => {
        const shielded = preFight({ startingShieldPctOfHp: 50 });
        const plain = dealt(BASE({ preFight: shielded }));
        const all = dealt(
            BASE({
                preFight: { ...shielded, outgoingDamage: 10 },
                selfBuffs: [OUT_DAMAGE_UP_III],
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb] },
                        { slot: 'passive', abilities: [arcaneSiege()] },
                    ],
                },
            })
        );
        expect(plain).toBeCloseTo(10_000, 6);
        expect(all / plain).toBeCloseTo(1.45 * 1.1 * 1.2, 9);
    });

    it('unshielded, the implant stays dormant', () => {
        const plain = dealt(BASE());
        const withImplant = dealt(
            BASE({
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb] },
                        { slot: 'passive', abilities: [arcaneSiege()] },
                    ],
                },
            })
        );
        expect(withImplant).toBeCloseTo(plain, 9);
    });
});
