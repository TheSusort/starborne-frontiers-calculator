import { describe, it, expect } from 'vitest';
import { foldActorBuffTotals, effectiveOutgoingStatsOf } from '../effectiveStats';
import { victimSelfBuffs } from '../triggers';
import { createStatusEngine, RegisteredAbilityStatus, StatusEngine } from '../statusEngine';
import { SelectedGameBuff } from '../../../types/calculator';
import { CombatActor } from '../state';
import { calculateBuffTotals } from '../buffTotals';
import { toSimBuffs } from '../../calculators/dpsBuffHelpers';

const sel = (
    id: string,
    buffName: string,
    parsedEffects: SelectedGameBuff['parsedEffects']
): SelectedGameBuff => ({ id, buffName, stacks: 1, parsedEffects, isStackable: false });

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

function actor(): CombatActor {
    return {
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 1000,
            hp: 10000,
            speed: 100,
            hacking: 0,
            security: 0,
        },
        currentHp: 10000,
        shieldPool: 0,
        turnMeter: 0,
        charges: 0,
        chargeCount: 0,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        turnsTaken: 0,
        chargeLossImmune: false,
    };
}

/** Engine with the given names scheduled on the attacker plus the given timed self statuses live. */
function engineWith(
    scheduled: SelectedGameBuff[],
    timed: Array<Extract<RegisteredAbilityStatus, { kind: 'timed' }>>
): StatusEngine {
    const eng = createStatusEngine({ selfBuffs: scheduled, enemyDebuffs: [] });
    if (timed.length > 0) eng.registerAbilityStatuses(timed, 'attacker');
    eng.beginRound(1);
    for (const t of timed) eng.applyTimedAbilityStatus(1, t, 'attacker');
    return eng;
}

describe('own buff families count once', () => {
    it('scheduled twice inside layer 1', () => {
        const entries = [
            sel('a1', 'Attack Up III', { attack: 45 }),
            sel('a2', 'Attack Up III', { attack: 45 }),
        ];
        const eng = engineWith([entries[0]], []);
        const lookup = new Map([['Attack Up III', entries]]);
        expect(foldActorBuffTotals(eng, lookup, 'attacker').attackBuff).toBe(45);
        expect(victimSelfBuffs(eng, 'attacker', lookup)).toHaveLength(1);
    });

    it('scheduled + timed of the same family', () => {
        const scheduled = sel('a1', 'Attack Up III', { attack: 45 });
        const eng = engineWith([scheduled], [timedStatus('Attack Up III', { attack: 45 })]);
        const lookup = new Map([['Attack Up III', [scheduled]]]);
        expect(foldActorBuffTotals(eng, lookup, 'attacker').attackBuff).toBe(45);
        expect(effectiveOutgoingStatsOf(eng, lookup, actor()).attack).toBeCloseTo(1000 * 1.45);
    });

    it('every channel: defence, speed and the victim fold', () => {
        const d = sel('d1', 'Defense Up III', { defense: 45 });
        const s = sel('s1', 'Speed Up II', { speed: 30 });
        const eng = engineWith(
            [d, s],
            [
                timedStatus('Defense Up III', { defense: 45 }),
                timedStatus('Speed Up II', { speed: 30 }),
            ]
        );
        const lookup = new Map([
            ['Defense Up III', [d]],
            ['Speed Up II', [s]],
        ]);
        const totals = foldActorBuffTotals(eng, lookup, 'attacker');
        expect(totals.defenceBuff).toBe(45);
        expect(totals.speedBuff).toBe(30);
        expect(
            calculateBuffTotals(toSimBuffs(victimSelfBuffs(eng, 'attacker', lookup))).defenceBuff
        ).toBe(45);
    });
});
