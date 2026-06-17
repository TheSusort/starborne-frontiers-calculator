import { describe, it, expect } from 'vitest';
import {
    effectiveStatsOf,
    foldActorBuffTotals,
    effectiveDamageStatsOf,
    liveDebuffLandingChance,
} from '../effectiveStats';
import { foldSpeedBuffPct } from '../engine';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { SelectedGameBuff } from '../../../types/calculator';
import { CombatActor } from '../state';
import { calculateBuffTotals } from '../playerTurn';
import { toSimBuffs, toDotAndPenModifiers } from '../../calculators/dpsBuffHelpers';
import { modifierTotalsFromAbilities } from '../../abilities/applyAbilities';
import { Ability } from '../../../types/abilities';
import type { ConditionContext } from '../../abilities/evaluateConditions';

// Helper: build a timed status (mirrors effectiveSpeed.test.ts pattern)
const timedStatus = (
    buffName: string,
    parsedEffects: SelectedGameBuff['parsedEffects'],
    duration = 5
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    payload: { buffName, stacks: 1, parsedEffects },
    side: 'self',
    sourceSlot: 'active',
    duration,
    conditions: [],
    kind: 'timed',
});

interface BuildHarnessOptions {
    base: {
        attack: number;
        crit: number;
        critDamage: number;
        defensePenetration: number;
        defence: number;
        hp: number;
        speed: number;
        hacking?: number;
        security?: number;
    };
    selfBuffs: Array<{ stat: keyof SelectedGameBuff['parsedEffects']; value: number }>;
}

function buildHarness({ base, selfBuffs }: BuildHarnessOptions) {
    // Build SelectedGameBuff entries for scheduled self-buffs
    const selectedGameBuffs: SelectedGameBuff[] = selfBuffs.map((b, i) => ({
        id: `test-buff-${i}`,
        buffName: `Test Buff ${b.stat} ${i}`,
        stacks: 1,
        parsedEffects: { [b.stat]: b.value } as SelectedGameBuff['parsedEffects'],
        isStackable: false,
    }));

    const eng = createStatusEngine({
        selfBuffs: selectedGameBuffs,
        enemyDebuffs: [],
    });

    // selfBuffLookup maps buffName → [SelectedGameBuff]
    const selfBuffLookup = new Map<string, SelectedGameBuff[]>();
    for (const buf of selectedGameBuffs) {
        selfBuffLookup.set(buf.buffName, [buf]);
    }

    eng.beginRound(1);

    const actor: CombatActor = {
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: base.attack,
            crit: base.crit,
            critDamage: base.critDamage,
            defensePenetration: base.defensePenetration,
            defence: base.defence,
            hp: base.hp,
            speed: base.speed,
            hacking: base.hacking,
            security: base.security,
        },
        currentHp: base.hp,
        shieldPool: 0,
        turnMeter: 0,
        charges: 0,
        chargeCount: 0,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
    };

    return { statusEngine: eng, selfBuffLookup, actor };
}

describe('effectiveStatsOf — characterization vs piecemeal formulas', () => {
    it('reproduces attack/speed folds and passes through unbuffed stats', () => {
        const { statusEngine, selfBuffLookup, actor } = buildHarness({
            base: {
                attack: 1000,
                crit: 10,
                critDamage: 50,
                defensePenetration: 0,
                defence: 200,
                hp: 5000,
                speed: 100,
                hacking: 120,
                security: 80,
            },
            selfBuffs: [
                { stat: 'attack', value: 50 },
                { stat: 'speed', value: 30 },
            ],
        });
        const eff = effectiveStatsOf(statusEngine, selfBuffLookup, actor);
        expect(eff.attack).toBe(1000 * (1 + 50 / 100)); // 1500
        expect(eff.speed).toBe(100 * (1 + 30 / 100)); // 130 — must match effectiveSpeedOf
        expect(eff.defence).toBe(200);
        expect(eff.crit).toBe(10);
        expect(eff.critDamage).toBe(50);
        expect(eff.hp).toBe(5000);
        expect(eff.hacking).toBe(120); // base pass-through (no fold in A1a)
        expect(eff.security).toBe(80);
    });

    it('treats undefined hacking/security as 0', () => {
        const { statusEngine, selfBuffLookup, actor } = buildHarness({
            base: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 1,
                speed: 50,
            },
            selfBuffs: [],
        });
        const eff = effectiveStatsOf(statusEngine, selfBuffLookup, actor);
        expect(eff.hacking).toBe(0);
        expect(eff.security).toBe(0);
    });

    it('foldActorBuffTotals folds speedBuff to the summed buff percentage', () => {
        const { statusEngine, selfBuffLookup, actor } = buildHarness({
            base: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 1,
                speed: 100,
            },
            selfBuffs: [{ stat: 'speed', value: 30 }],
        });
        expect(foldActorBuffTotals(statusEngine, selfBuffLookup, actor.id).speedBuff).toBe(30);
        // foldSpeedBuffPct delegates to foldActorBuffTotals, so parity still holds
        expect(foldSpeedBuffPct(statusEngine, selfBuffLookup, actor.id)).toBe(30);
    });

    it('folds timed ability statuses (attack + speed) via timedAbilityStatuses path', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const attackStatus = timedStatus('Attack Up I', { attack: 40 });
        const speedStatus = timedStatus('Speed Up II', { speed: 30 });
        eng.registerAbilityStatuses([attackStatus, speedStatus], 'ship-1');
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, attackStatus, 'ship-1');
        eng.applyTimedAbilityStatus(1, speedStatus, 'ship-1');

        const actor: CombatActor = {
            id: 'ship-1',
            side: 'player',
            kind: 'attacker',
            stats: {
                attack: 1000,
                crit: 10,
                critDamage: 50,
                defensePenetration: 0,
                defence: 200,
                hp: 5000,
                speed: 100,
            },
            currentHp: 5000,
            shieldPool: 0,
            turnMeter: 0,
            charges: 0,
            chargeCount: 0,
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
        };

        const emptyLookup = new Map<string, SelectedGameBuff[]>();
        const eff = effectiveStatsOf(eng, emptyLookup, actor);
        expect(eff.attack).toBe(1000 * (1 + 40 / 100)); // 1400
        expect(eff.speed).toBe(100 * (1 + 30 / 100)); // 130
    });

    it('hp is a pure pass-through (never folded with buffs)', () => {
        // hp buffs flow through parsedEffects.hp → toSimBuffs → hpBuff channel,
        // but effectiveStatsOf intentionally returns s.hp unchanged (the fold formula
        // is written but hp is excluded from the EffectiveStats formula; in-fight HP
        // changes only matter as currentHp, not the base stat).
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const hpStatus = timedStatus('HP Shield I', { hp: 25 });
        eng.registerAbilityStatuses([hpStatus], 'ship-2');
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, hpStatus, 'ship-2');

        const actor: CombatActor = {
            id: 'ship-2',
            side: 'player',
            kind: 'attacker',
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 10000,
                speed: 50,
            },
            currentHp: 10000,
            shieldPool: 0,
            turnMeter: 0,
            charges: 0,
            chargeCount: 0,
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
        };

        const emptyLookup = new Map<string, SelectedGameBuff[]>();
        const eff = effectiveStatsOf(eng, emptyLookup, actor);
        // hp is always the base stat — effectiveStatsOf returns s.hp directly.
        expect(eff.hp).toBe(10000);
    });

    it('crit and critDamage are additive (not multiplicative)', () => {
        const { statusEngine, selfBuffLookup, actor } = buildHarness({
            base: {
                attack: 100,
                crit: 10,
                critDamage: 50,
                defensePenetration: 0,
                defence: 0,
                hp: 1,
                speed: 50,
            },
            selfBuffs: [
                { stat: 'crit', value: 25 },
                { stat: 'critDamage', value: 100 },
            ],
        });
        const eff = effectiveStatsOf(statusEngine, selfBuffLookup, actor);
        expect(eff.crit).toBe(35); // 10 + 25 additive
        expect(eff.critDamage).toBe(150); // 50 + 100 additive
    });

    // A2: hacking/security buff-fold tests
    it('folds a hacking buff flat-additively onto base hacking', () => {
        const { statusEngine, selfBuffLookup, actor } = buildHarness({
            base: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 1,
                speed: 50,
                hacking: 200,
                security: 100,
            },
            selfBuffs: [{ stat: 'hacking', value: 40 }],
        });
        const eff = effectiveStatsOf(statusEngine, selfBuffLookup, actor);
        expect(eff.hacking).toBe(240); // 200 + 40 flat
        expect(eff.security).toBe(100); // unchanged
    });

    it('folds a security buff flat-additively onto base security', () => {
        const { statusEngine, selfBuffLookup, actor } = buildHarness({
            base: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 1,
                speed: 50,
                hacking: 200,
                security: 100,
            },
            selfBuffs: [{ stat: 'security', value: 20 }],
        });
        const eff = effectiveStatsOf(statusEngine, selfBuffLookup, actor);
        expect(eff.hacking).toBe(200); // unchanged
        expect(eff.security).toBe(120); // 100 + 20 flat
    });

    it('folds hacking + security buffs together (undefined base treated as 0)', () => {
        const { statusEngine, selfBuffLookup, actor } = buildHarness({
            base: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 1,
                speed: 50,
                // hacking/security intentionally absent → undefined → treated as 0
            },
            selfBuffs: [
                { stat: 'hacking', value: 40 },
                { stat: 'security', value: 20 },
            ],
        });
        const eff = effectiveStatsOf(statusEngine, selfBuffLookup, actor);
        expect(eff.hacking).toBe(40); // 0 + 40
        expect(eff.security).toBe(20); // 0 + 20
    });
});

// ---------------------------------------------------------------------------
// effectiveDamageStatsOf — characterization tests (A1b)
// ---------------------------------------------------------------------------

describe('effectiveDamageStatsOf — four-layer fold characterization', () => {
    // Shared base stats used across both tests.
    const base = {
        attack: 2000,
        defence: 500,
        crit: 15,
        critDamage: 150,
        hp: 10000,
        defensePenetration: 10,
        defensePenetrationBuff: 5,
    };

    it('reproduces four-layer fold for attack/defence/crit/critDamage/hp/pen/dot with concrete fixtures', () => {
        // --- Layer 1: scheduledTotals (scheduled self-buffs via toSimBuffs) ---
        const scheduledBuffs: SelectedGameBuff[] = [
            {
                id: 'sched-1',
                buffName: 'Attack Up',
                stacks: 1,
                parsedEffects: { attack: 30, outgoingDamage: 10 },
                isStackable: false,
            },
            {
                id: 'sched-2',
                buffName: 'Defence Up',
                stacks: 1,
                parsedEffects: { defense: 20 },
                isStackable: false,
            },
        ];
        const scheduledTotals = calculateBuffTotals(toSimBuffs(scheduledBuffs));

        // --- Layer 2+3: abilitySelfEffects (timed ability statuses + gated auras) ---
        const abilitySelfEffects: SelectedGameBuff[] = [
            {
                id: 'abl-1',
                buffName: 'Crit Up',
                stacks: 1,
                parsedEffects: { crit: 20, critDamage: 50 },
                isStackable: false,
            },
            {
                id: 'abl-2',
                buffName: 'Pen Up',
                stacks: 1,
                parsedEffects: { defensePenetration: 15, dotDamage: 25 },
                isStackable: false,
            },
            {
                id: 'abl-3',
                buffName: 'HP Up',
                stacks: 1,
                parsedEffects: { hp: 10 },
                isStackable: false,
            },
        ];

        // --- Layer 4: modifierAbilities (modifier-type abilities, conditions pass) ---
        // A modifier ability with no conditions always passes conditionsMet([]).
        const modifierAbilities: Ability[] = [
            {
                id: 'mod-1',
                type: 'modifier',
                target: 'self',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'modifier', channel: 'attack', value: 25, isMultiplicative: false },
            },
            {
                id: 'mod-2',
                type: 'modifier',
                target: 'self',
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: 'modifier',
                    channel: 'defensePenetration',
                    value: 8,
                    isMultiplicative: false,
                },
            },
        ];
        // A ConditionContext with empty/default values so all conditionsMet([]) pass trivially.
        const modifierCtx: ConditionContext = {
            selfBuffNames: [],
            selfDebuffNames: [],
            enemyBuffNames: [],
            enemyDebuffCount: 0,
            effectiveCritRate: 0,
            adjacentAllyCount: 0,
            enemyAdjacentCount: 0,
            enemyDestroyedCount: 0,
            selfHpPct: 100,
            enemyHpPct: 100,
        };

        const dmg = effectiveDamageStatsOf({
            base,
            scheduledTotals,
            abilitySelfEffects,
            modifierAbilities,
            modifierCtx,
        });

        // --- Compute expectations inline exactly as playerTurn.ts does ---
        const abilityTotals = calculateBuffTotals(toSimBuffs(abilitySelfEffects));
        const mod = modifierTotalsFromAbilities(modifierAbilities, modifierCtx);
        const dotPen = toDotAndPenModifiers(abilitySelfEffects, []);

        const attackBuff = scheduledTotals.attackBuff + abilityTotals.attackBuff + mod.attack;
        const defenceBuff = scheduledTotals.defenceBuff + abilityTotals.defenceBuff + mod.defence;
        const critBuff = scheduledTotals.critBuff + abilityTotals.critBuff + mod.crit;
        const critDamageBuff =
            scheduledTotals.critDamageBuff + abilityTotals.critDamageBuff + mod.critDamage;
        const hpBuff = scheduledTotals.hpBuff + abilityTotals.hpBuff + mod.hp;

        expect(dmg.attack).toBe(base.attack * (1 + attackBuff / 100));
        expect(dmg.defence).toBe(base.defence * (1 + defenceBuff / 100));
        // crit: UNCAPPED (base + total crit buff)
        expect(dmg.crit).toBe(base.crit + critBuff);
        expect(dmg.critDamage).toBe(base.critDamage + critDamageBuff);
        expect(dmg.hp).toBe(base.hp * (1 + hpBuff / 100));

        // effectivePen = base defPen + base defPenBuff + modifier defPen + dotPen defPenBuff
        const expectedPen =
            base.defensePenetration +
            base.defensePenetrationBuff +
            mod.defensePenetration +
            dotPen.defensePenetrationBuff;
        expect(dmg.effectivePen).toBe(expectedPen);

        // selfDotDamageModifier comes from toDotAndPenModifiers(abilitySelfEffects, [])
        expect(dmg.selfDotDamageModifier).toBe(dotPen.dotDamageModifier);

        // totals.outgoingDamageBuff = scheduled + ability + mod.outgoingDamage
        const expectedOutgoingDamage =
            scheduledTotals.outgoingDamageBuff +
            abilityTotals.outgoingDamageBuff +
            mod.outgoingDamage;
        expect(dmg.totals.outgoingDamageBuff).toBe(expectedOutgoingDamage);

        // Full calculateBuffTotals shape is present on totals
        expect(dmg.totals).toHaveProperty('attackBuff');
        expect(dmg.totals).toHaveProperty('critBuff');
        expect(dmg.totals).toHaveProperty('critDamageBuff');
        expect(dmg.totals).toHaveProperty('defenceBuff');
        expect(dmg.totals).toHaveProperty('hpBuff');
        expect(dmg.totals).toHaveProperty('outgoingHealBuff');
        expect(dmg.totals).toHaveProperty('incomingHealBuff');
        expect(dmg.totals).toHaveProperty('speedBuff');
    });

    it('with empty abilitySelfEffects + empty modifiers, attack matches base * (1 + scheduledAttackBuff/100)', () => {
        // This is the "status-mode" agreement test: when no ability layer or modifier layer
        // is present, effectiveDamageStatsOf.attack reduces to base.attack * (1 + scheduled/100),
        // the same formula effectiveStatsOf uses.
        const scheduledBuffs: SelectedGameBuff[] = [
            {
                id: 'sched-only',
                buffName: 'Simple Attack Up',
                stacks: 1,
                parsedEffects: { attack: 40 },
                isStackable: false,
            },
        ];
        const scheduledTotals = calculateBuffTotals(toSimBuffs(scheduledBuffs));

        const modifierCtx: ConditionContext = {
            selfBuffNames: [],
            selfDebuffNames: [],
            enemyBuffNames: [],
            enemyDebuffCount: 0,
            effectiveCritRate: 0,
            adjacentAllyCount: 0,
            enemyAdjacentCount: 0,
            enemyDestroyedCount: 0,
            selfHpPct: 100,
            enemyHpPct: 100,
        };

        const dmg = effectiveDamageStatsOf({
            base,
            scheduledTotals,
            abilitySelfEffects: [],
            modifierAbilities: [],
            modifierCtx,
        });

        // With no ability or modifier layers, only scheduledTotals contributes.
        expect(dmg.attack).toBe(base.attack * (1 + scheduledTotals.attackBuff / 100));
        // mod.defensePenetration and dotPen.defensePenetrationBuff are both zero when those layers
        // are empty — this proves the pen formula reduces to base-only (not the full 4-source form).
        expect(dmg.effectivePen).toBe(base.defensePenetration + base.defensePenetrationBuff);
        expect(dmg.selfDotDamageModifier).toBe(0);
        expect(dmg.totals.outgoingDamageBuff).toBe(scheduledTotals.outgoingDamageBuff);
    });
});

describe('liveDebuffLandingChance — reproduces the static landing formula with no buffs (holistic review #3)', () => {
    // The OLD static formula every adapter baked at its input boundary:
    //   clamp(hacking * (1 + affinityDamageModifier/100) - security, 0, 100) / 100
    // This locks DIRECTLY (not via a turn-driven run) that liveDebuffLandingChance reduces to it
    // when no hacking/security buffs are active — the reproduction invariant the DPS / battle-sim /
    // healing adapters all rely on for byte-identical neutral goldens.
    const staticFormula = (hacking: number, security: number, affMod: number): number =>
        Math.min(100, Math.max(0, hacking * (1 + affMod / 100) - security)) / 100;

    // Build an attacker + defender on a SINGLE no-buff status engine (no folds occur for either,
    // so effectiveStatsOf returns the raw base hacking/security).
    const buildPair = (attackerHacking: number, defenderSecurity: number) => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        const mkActor = (
            id: string,
            stats: { hacking?: number; security?: number }
        ): CombatActor => ({
            id,
            side: id === 'attacker' ? 'player' : 'enemy',
            kind: id === 'attacker' ? 'attacker' : 'enemy',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 1,
                speed: 100,
                ...stats,
            },
            currentHp: 1,
            shieldPool: 0,
            turnMeter: 0,
            charges: 0,
            chargeCount: 0,
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
        });
        return {
            eng,
            attacker: mkActor('attacker', { hacking: attackerHacking }),
            defender: mkActor('enemy', { security: defenderSecurity }),
        };
    };

    const cases: Array<{ hacking: number; security: number; affMod: number }> = [
        { hacking: 200, security: 100, affMod: 0 }, // ceiling-clamped (1.0)
        { hacking: 200, security: 150, affMod: 0 }, // partial (0.5)
        { hacking: 50, security: 100, affMod: 0 }, // floor-clamped (0)
        { hacking: 200, security: 230, affMod: 25 }, // affinity advantage flips a resist into a partial
        { hacking: 200, security: 150, affMod: -25 }, // affinity disadvantage lowers the chance
    ];

    for (const { hacking, security, affMod } of cases) {
        it(`hacking ${hacking} / security ${security} / affMod ${affMod}`, () => {
            const { eng, attacker, defender } = buildPair(hacking, security);
            const live = liveDebuffLandingChance(eng, new Map(), attacker, defender, affMod);
            expect(live).toBe(staticFormula(hacking, security, affMod));
        });
    }
});
