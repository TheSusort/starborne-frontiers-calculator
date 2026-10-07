/**
 * Belladonna's convert-dot executor spends one queued conversion roll (`preDecidedConversions`)
 * per landed Corrosion stack, in order — including a stack whose landed entry is gone by the time
 * the reaction resolves. That stack's roll is discarded, never handed to the next stack.
 *
 * Unit-level: `executeIntent` on two convert-dot intents for the same (Belladonna, victim, ally).
 * The queue holds [miss, hit]. The first intent names an entry the victim no longer holds; the
 * second names the entry it does hold. That entry converts on the second roll (hit).
 */
import { describe, it, expect } from 'vitest';
import { executeIntent, dotConversionKey, type Intent, type IntentExecContext } from '../triggers';
import { createEventBus } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { PlayerActorRuntime } from '../playerTurn';
import type { CombatActor } from '../state';
import type { Ability } from '../../../types/abilities';

const convert: Ability = {
    id: 'belladonna-convert',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-ally-debuff-inflicted',
    conditions: [],
    config: {
        type: 'convert-dot',
        fromDotType: 'corrosion',
        buffName: 'Acidic Decay',
        chanceFromStat: { stat: 'hacking', pctPerPoint: 0.1 },
    },
};

const intentFor = (dotAppliedSeq: number): Intent => ({
    ownerId: 'belladonna',
    sourceSlot: 'passive',
    ability: convert,
    eventCtx: { dotType: 'corrosion', damagedAllyId: 'ally', victimId: 'victim', dotAppliedSeq },
});

describe('Belladonna: a vanished stack spends its own queued roll', () => {
    it('the held entry converts on the second roll, not the vanished stack’s', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        const victim = {
            id: 'victim',
            corrosionEntries: [
                { stacks: 1, tier: 6, remainingRounds: 3, sourceId: 'ally', appliedSeq: 2 },
            ],
            infernoEntries: [],
            genericDoTEntries: [],
        } as unknown as CombatActor;
        const key = dotConversionKey('belladonna', convert.id, 'victim', 'ally', 'corrosion');
        const preDecidedConversions = new Map<string, boolean[]>([[key, [false, true]]]);
        const ctx = {
            round: 1,
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([
                [
                    'belladonna',
                    { actor: { id: 'belladonna' } as CombatActor } as PlayerActorRuntime,
                ],
            ]),
            grantAllyCharges: () => {},
            grantExtraAction: () => {},
            playerIds: ['belladonna', 'ally'],
            lastTurnCtxByActor: new Map(),
            recordResisted: () => {},
            actorById: (id: string) => (id === 'victim' ? victim : undefined),
            preDecidedConversions,
        } as unknown as IntentExecContext;

        // Stack 1: its entry (appliedSeq 1) is gone.
        executeIntent(intentFor(1), ctx);
        // Stack 2: the held entry (appliedSeq 2).
        executeIntent(intentFor(2), ctx);

        expect(victim.corrosionEntries[0].family).toBe('Acidic Decay');
        expect(preDecidedConversions.has(key)).toBe(false);
    });
});
