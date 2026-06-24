import { describe, it, expect, vi } from 'vitest';
import { reactiveRecipients, executeIntent, Intent, IntentExecContext } from '../triggers';
import { createEventBus } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';

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

describe('C2b-1 T2: reactiveRecipients helper', () => {
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

// ---------------------------------------------------------------------------
// C2b-1 Task 3: executeIntent — purge branch
//
// Verifies the new `cfg.type === 'purge'` executor branch:
//   (a) target routing: counterTargetId when set, else ctx.enemyId
//   (b) emits purge-performed when removed > 0 and !eventCtx.fromPurgeEvent
//   (c) does NOT emit when fromPurgeEvent is true (removal still happens)
//   (d) does NOT emit when removed === 0
// ---------------------------------------------------------------------------

/** Minimal purge intent for the executor tests */
function makePurgeIntent(opts?: {
    count?: number | 'all';
    counterTargetId?: string;
    fromPurgeEvent?: boolean;
}): Intent {
    const { count = 1, counterTargetId, fromPurgeEvent } = opts ?? {};
    return {
        ownerId: 'caster1',
        sourceSlot: 'passive',
        ability: {
            id: 'purge-ab',
            type: 'purge',
            target: 'enemy',
            trigger: 'on-enemy-purged',
            conditions: [],
            config: { type: 'purge', count },
        },
        eventCtx:
            counterTargetId !== undefined || fromPurgeEvent !== undefined
                ? { counterTargetId, fromPurgeEvent }
                : undefined,
    } as unknown as Intent;
}

/** Minimal IntentExecContext for executeIntent purge tests.
 *  purge spy returns a controllable removed count. */
function makePurgeCtx(removedCount: number): {
    ctx: IntentExecContext;
    purgedCalls: Array<[string, number | 'all']>;
    emitted: Array<{
        type: string;
        casterId?: string;
        targetId?: string;
        count?: number;
        round?: number;
    }>;
} {
    const purgedCalls: Array<[string, number | 'all']> = [];
    const emitted: Array<{
        type: string;
        casterId?: string;
        targetId?: string;
        count?: number;
        round?: number;
    }> = [];

    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    const purgeSpy = vi.spyOn(se, 'purge').mockImplementation((actorId, count) => {
        purgedCalls.push([actorId, count]);
        return removedCount;
    });

    const bus = createEventBus();
    bus.on('purge-performed', (e) => emitted.push(e));

    const ctx: IntentExecContext = {
        round: 3,
        enemy: { id: 'enemy-default' } as CombatActor,
        enemyId: 'enemy-default',
        statusEngine: se,
        bus,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        runtimes: new Map([
            [
                'caster1',
                {
                    actor: { id: 'caster1' } as CombatActor,
                    healModifier: 0,
                    attack: 0,
                    defence: 0,
                    hp: 1000,
                } as never,
            ],
        ]),
        grantAllyCharges: () => {},
        removeEnemyCharges: () => {},
        grantExtraAction: () => {},
        playerIds: ['caster1'],
        lastTurnCtxByActor: new Map(),
        enemyHp: 100000,
        cumulativeDamage: 0,
        recordResisted: () => {},
    };

    // Suppress the unused-variable warning on purgeSpy
    void purgeSpy;

    return { ctx, purgedCalls, emitted };
}

describe('C2b-1 T3: executeIntent — purge branch', () => {
    it('(a) uses counterTargetId when set', () => {
        const { ctx, purgedCalls } = makePurgeCtx(1);
        executeIntent(makePurgeIntent({ counterTargetId: 'routed-enemy' }), ctx);
        expect(purgedCalls).toHaveLength(1);
        expect(purgedCalls[0]).toEqual(['routed-enemy', 1]);
    });

    it('(a) falls back to ctx.enemyId when counterTargetId is absent', () => {
        const { ctx, purgedCalls } = makePurgeCtx(1);
        executeIntent(makePurgeIntent(), ctx);
        expect(purgedCalls).toHaveLength(1);
        expect(purgedCalls[0]).toEqual(['enemy-default', 1]);
    });

    it('(b) emits purge-performed when removed > 0 and fromPurgeEvent unset', () => {
        const { ctx, emitted } = makePurgeCtx(2);
        executeIntent(makePurgeIntent({ counterTargetId: 'routed-enemy' }), ctx);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toMatchObject({
            type: 'purge-performed',
            casterId: 'caster1',
            targetId: 'routed-enemy',
            count: 2,
            round: 3,
        });
    });

    it('(c) does NOT emit when fromPurgeEvent is true, but removal still happens', () => {
        const { ctx, purgedCalls, emitted } = makePurgeCtx(1);
        executeIntent(makePurgeIntent({ fromPurgeEvent: true }), ctx);
        // removal still happens
        expect(purgedCalls).toHaveLength(1);
        // no re-emission
        expect(emitted).toHaveLength(0);
    });

    it('(d) does NOT emit when removed === 0', () => {
        const { ctx, emitted } = makePurgeCtx(0);
        executeIntent(makePurgeIntent(), ctx);
        expect(emitted).toHaveLength(0);
    });
});
