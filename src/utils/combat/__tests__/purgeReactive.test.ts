import { describe, it, expect } from 'vitest';
import { reactiveRecipients, Intent, IntentExecContext } from '../triggers';

// ---------------------------------------------------------------------------
// C2b-1 Task 2: reactiveRecipients() helper unit tests (pure refactor).
//
// Verifies the four routing cases without running the full engine. Stubs are
// minimal — the helper only reads:
//   intent.ability.target, intent.eventCtx?.damagedAllyId, intent.ownerId
//   ctx.playerIds
// ---------------------------------------------------------------------------

/** Minimal Intent stub sufficient for reactiveRecipients */
function makeIntent(
    target: 'ally' | 'all-allies' | 'self' | 'enemy',
    ownerId = 'owner1',
    damagedAllyId?: string
): Intent {
    return {
        ability: {
            id: 'ab1',
            type: 'heal',
            target,
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'heal', pct: 10, basis: 'attack' },
        },
        sourceSlot: 'passive',
        ownerId,
        eventCtx: damagedAllyId !== undefined ? { damagedAllyId } : undefined,
    } as unknown as Intent;
}

/** Minimal IntentExecContext stub sufficient for reactiveRecipients */
function makeCtx(playerIds = ['p1', 'p2', 'p3']): Pick<IntentExecContext, 'playerIds'> {
    return { playerIds } as IntentExecContext;
}

describe("C2b-1 T2: reactiveRecipients helper", () => {
    it("target:'ally' + damagedAllyId → returns damagedAllyId", () => {
        const intent = makeIntent('ally', 'owner1', 'a2');
        const ctx = makeCtx();
        expect(reactiveRecipients(intent, ctx as IntentExecContext, 'fallback-id')).toEqual(['a2']);
    });

    it("target:'ally' + no damagedAllyId → returns fallbackTargetId", () => {
        const intent = makeIntent('ally', 'owner1', undefined);
        const ctx = makeCtx();
        expect(reactiveRecipients(intent, ctx as IntentExecContext, 'fallback-id')).toEqual([
            'fallback-id',
        ]);
    });

    it("target:'all-allies' → returns ctx.playerIds", () => {
        const intent = makeIntent('all-allies', 'owner1');
        const ctx = makeCtx(['p1', 'p2', 'p3']);
        expect(reactiveRecipients(intent, ctx as IntentExecContext, 'fallback-id')).toEqual([
            'p1',
            'p2',
            'p3',
        ]);
    });

    it("target:'self' → returns [ownerId]", () => {
        const intent = makeIntent('self', 'owner1');
        const ctx = makeCtx();
        expect(reactiveRecipients(intent, ctx as IntentExecContext, 'fallback-id')).toEqual([
            'owner1',
        ]);
    });

    it("target:'enemy' (other) → returns [ownerId]", () => {
        const intent = makeIntent('enemy', 'owner1');
        const ctx = makeCtx();
        expect(reactiveRecipients(intent, ctx as IntentExecContext, 'fallback-id')).toEqual([
            'owner1',
        ]);
    });
});
