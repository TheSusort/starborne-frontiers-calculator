import { describe, it, expect } from 'vitest';
import { effectiveStatsOf, foldActorBuffTotals } from '../effectiveStats';
import { foldSpeedBuffPct } from '../engine';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { SelectedGameBuff } from '../../../types/calculator';
import { CombatActor } from '../state';

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

    it('foldActorBuffTotals.speedBuff equals legacy foldSpeedBuffPct', () => {
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
        expect(foldActorBuffTotals(statusEngine, selfBuffLookup, actor.id).speedBuff).toBe(
            foldSpeedBuffPct(statusEngine, selfBuffLookup, actor.id)
        );
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
});
