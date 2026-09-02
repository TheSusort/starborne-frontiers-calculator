import { describe, it, expect } from 'vitest';
import { calculateBuffTotals } from '../playerTurn';
import { foldSpeedBuffPct } from '../engine';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { toSimBuffs } from '../../calculators/dpsBuffHelpers';
import { SelectedGameBuff } from '../../../types/calculator';

const makeSpeedBuff = (
    overrides: Partial<SelectedGameBuff['parsedEffects']>,
    stacks = 1
): SelectedGameBuff => ({
    id: 'x',
    buffName: 'Test Speed Buff',
    stacks,
    parsedEffects: overrides,
    isStackable: false,
});

describe('calculateBuffTotals — speed channel', () => {
    it('sums positive and negative speed buffs', () => {
        const result = calculateBuffTotals([
            { id: 'a', stat: 'speed', value: 30 },
            { id: 'b', stat: 'speed', value: -15 },
        ]);
        expect(result.speedBuff).toBe(15);
    });

    it('returns speedBuff: 0 when no speed buffs present', () => {
        const result = calculateBuffTotals([{ id: 'c', stat: 'attack', value: 25 }]);
        expect(result.speedBuff).toBe(0);
    });

    it('returns speedBuff: 0 for empty buff array', () => {
        const result = calculateBuffTotals([]);
        expect(result.speedBuff).toBe(0);
    });
});

describe('toSimBuffs — speed channel', () => {
    it('maps speed effect to stat: speed entry', () => {
        const result = toSimBuffs([makeSpeedBuff({ speed: 30 })]);
        expect(result).toEqual([{ id: 'x-spd', stat: 'speed', value: 30 }]);
    });

    it('multiplies speed by stacks', () => {
        const result = toSimBuffs([makeSpeedBuff({ speed: 15 }, 2)]);
        expect(result).toEqual([{ id: 'x-spd', stat: 'speed', value: 30 }]);
    });

    it('omits speed entry when speed is undefined', () => {
        const result = toSimBuffs([makeSpeedBuff({ attack: 10 })]);
        expect(result.every((b) => b.stat !== 'speed')).toBe(true);
    });

    it('includes speed alongside other effects', () => {
        const result = toSimBuffs([makeSpeedBuff({ attack: 20, speed: 30 })]);
        expect(result).toHaveLength(2);
        const speedEntry = result.find((b) => b.stat === 'speed');
        expect(speedEntry).toEqual({ id: 'x-spd', stat: 'speed', value: 30 });
    });
});

// foldSpeedBuffPct is the live-speed authority behind effectiveSpeedOf — it reads the
// status engine's two timed sources (scheduled self-buffs + timed ability statuses) for an
// owner and sums only the speed channel. Exercised against a real status engine (no mocks).
// effectiveSpeedOf itself = base × (1 + foldSpeedBuffPct / 100); the multiply is trivial and
// tested at the pct level here.
const timedSpeedStatus = (
    buffName: string,
    speed: number,
    duration = 5,
    // #398: `side` was HARDCODED to 'self' here, so this file — the only speed-fold coverage in the
    // repo — never once exercised the per-victim ENEMY store. That is one of the three reasons an
    // entirely dead enemy-side speed channel stayed green for months: an enemy-applied
    // `Speed Down II` landed, displayed, ticked down and reduced nothing at all. Parameterised
    // with a default so every pre-existing call site is byte-identical.
    side: 'self' | 'enemy' = 'self'
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    payload: { buffName, stacks: 1, parsedEffects: { speed } },
    side,
    sourceSlot: 'active',
    duration,
    conditions: [],
    kind: 'timed',
});

describe('foldSpeedBuffPct — live two-source speed fold', () => {
    const emptyLookup = new Map<string, SelectedGameBuff[]>();
    const OWNER = 'ship-1';

    it('returns 0 when the actor has no speed buff', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        expect(foldSpeedBuffPct(eng, emptyLookup, OWNER)).toBe(0);
        // effectiveSpeedOf would be base × (1 + 0/100) = base.
    });

    it('reflects a Speed Up II (+30%) timed status applied mid-combat', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const speedUp = timedSpeedStatus('Speed Up II', 30);
        eng.registerAbilityStatuses([speedUp], OWNER);
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, speedUp, OWNER);
        expect(foldSpeedBuffPct(eng, emptyLookup, OWNER)).toBe(30);
        // effectiveSpeedOf would be base × 1.30.
    });

    it('sums a Speed Up II (+30%) and a Speed Down I (-15%) → +15% net', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const speedUp = timedSpeedStatus('Speed Up II', 30);
        const speedDown = timedSpeedStatus('Speed Down I', -15);
        eng.registerAbilityStatuses([speedUp, speedDown], OWNER);
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, speedUp, OWNER);
        eng.applyTimedAbilityStatus(1, speedDown, OWNER);
        expect(foldSpeedBuffPct(eng, emptyLookup, OWNER)).toBe(15);
        // effectiveSpeedOf would be base × 1.15.
    });

    it('folds an ENEMY-APPLIED speed debuff from the per-victim enemy store (#398)', () => {
        // The direction this file could not see before #398. An enemy-applied `Speed Down II`
        // lands in the victim's per-victim ENEMY store, keyed by the victim's id — a store
        // `foldActorBuffTotals` did not read, so the debuff changed nothing.
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const speedDown = timedSpeedStatus('Speed Down II', -50, 5, 'enemy');
        eng.registerAbilityStatuses([speedDown], OWNER);
        eng.beginRound(1);
        // Enemy-side writes are keyed by the ENEMY TARGET id (4th arg), not the recipient.
        eng.applyTimedAbilityStatus(1, speedDown, undefined, OWNER);
        expect(foldSpeedBuffPct(eng, emptyLookup, OWNER)).toBe(-50);
        // effectiveSpeedOf would be base × 0.50.
    });

    it('shadows an enemy-applied instance against the victim own weaker one (#398)', () => {
        // Highest tier wins ACROSS the store boundary: own `Speed Down I` (-20) plus an applied
        // `Speed Down II` (-50) resolves to -50, never the -70 sum.
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const own = timedSpeedStatus('Speed Down I', -20);
        const applied = timedSpeedStatus('Speed Down II', -50, 5, 'enemy');
        eng.registerAbilityStatuses([own, applied], OWNER);
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, own, OWNER);
        eng.applyTimedAbilityStatus(1, applied, undefined, OWNER);
        expect(foldSpeedBuffPct(eng, emptyLookup, OWNER)).toBe(-50);
    });

    it('folds a scheduled self-buff via the selfBuffLookup source', () => {
        const speedBuff: SelectedGameBuff = {
            id: 'sched-spd',
            buffName: 'Recurring Speed',
            stacks: 1,
            parsedEffects: { speed: 20 },
            isStackable: false,
        };
        // No skillSource/skillDuration → classified always-active (isAlwaysActive), so it is
        // attacker-owned and appears every round in the 'attacker' snapshot as 'recurring'.
        const eng = createStatusEngine({
            selfBuffs: [speedBuff],
            enemyDebuffs: [],
        });
        const lookup = new Map<string, SelectedGameBuff[]>([['Recurring Speed', [speedBuff]]]);
        eng.beginRound(1);
        expect(foldSpeedBuffPct(eng, lookup, 'attacker')).toBe(20);
    });

    it('is keyed by owner id — a buff on one owner does not leak to another', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const speedUp = timedSpeedStatus('Speed Up III', 50);
        eng.registerAbilityStatuses([speedUp], OWNER);
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, speedUp, OWNER);
        expect(foldSpeedBuffPct(eng, emptyLookup, OWNER)).toBe(50);
        expect(foldSpeedBuffPct(eng, emptyLookup, 'other-ship')).toBe(0);
    });
});
