import { describe, it, expect } from 'vitest';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';

function timedEnemyStatus(
    buffName: string,
    duration: number
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
    return {
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: { buffName, stacks: 1, parsedEffects: {} },
    };
}

describe('removeTimedEnemyStatus — targeted enemy status removal', () => {
    it('removes ONLY the named family, preserving co-applied debuffs on the same victim', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const stasisStatus = timedEnemyStatus('Stasis', 2);
        const defDownStatus = timedEnemyStatus('Defense Down', 3);

        se.beginRound(1);
        se.applyTimedAbilityStatus(1, stasisStatus, undefined, 'victim-1');
        se.applyTimedAbilityStatus(1, defDownStatus, undefined, 'victim-1');

        // Both are present before removal
        const before = se.timedAbilityStatuses('enemy', undefined, 'victim-1');
        const buffNamesBefore = before.map((s) => s.payload.buffName);
        expect(buffNamesBefore).toContain('Stasis');
        expect(buffNamesBefore).toContain('Defense Down');

        se.removeTimedEnemyStatus('victim-1', 'Stasis');

        // After removal: Stasis gone, Defense Down preserved
        const after = se.timedAbilityStatuses('enemy', undefined, 'victim-1');
        const buffNamesAfter = after.map((s) => s.payload.buffName);
        expect(buffNamesAfter).not.toContain('Stasis');
        expect(buffNamesAfter).toContain('Defense Down');
    });

    it('is a safe no-op for an unknown targetId', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        // No beginRound needed — just verify no throw
        expect(() => se.removeTimedEnemyStatus('nonexistent', 'Stasis')).not.toThrow();
    });

    it('is a safe no-op for an unknown buffName on a real victim', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Defense Down', 2), undefined, 'victim-1');

        // Removing a name that was never applied — no throw, Defense Down still present
        expect(() => se.removeTimedEnemyStatus('victim-1', 'Nonexistent')).not.toThrow();
        const after = se.timedAbilityStatuses('enemy', undefined, 'victim-1');
        expect(after.map((s) => s.payload.buffName)).toContain('Defense Down');
    });
});

describe('reduceTimedEnemyStatus — shave one turn (direct-damage Stasis break)', () => {
    const stasisNames = (se: ReturnType<typeof createStatusEngine>) =>
        se.timedAbilityStatuses('enemy', undefined, 'victim-1').map((s) => s.payload.buffName);

    it('reduces the named status by one turn, deleting it only when it reaches 0', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Stasis', 2), undefined, 'victim-1');

        // Stasis(2): one reduce leaves it at 1 turn (still present)…
        se.reduceTimedEnemyStatus('victim-1', 'Stasis');
        expect(stasisNames(se)).toContain('Stasis');

        // …a second reduce takes it to 0 → deleted.
        se.reduceTimedEnemyStatus('victim-1', 'Stasis');
        expect(stasisNames(se)).not.toContain('Stasis');
    });

    it('reduces ONLY the named family, preserving co-applied debuffs on the same victim', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Stasis', 1), undefined, 'victim-1');
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Defense Down', 3), undefined, 'victim-1');

        // A single reduce clears the 1-turn Stasis but leaves Defense Down untouched.
        se.reduceTimedEnemyStatus('victim-1', 'Stasis');
        const after = se
            .timedAbilityStatuses('enemy', undefined, 'victim-1')
            .map((s) => s.payload.buffName);
        expect(after).not.toContain('Stasis');
        expect(after).toContain('Defense Down');
    });

    it('is a safe no-op for an unknown targetId or unknown buffName', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Defense Down', 2), undefined, 'victim-1');
        expect(() => se.reduceTimedEnemyStatus('nonexistent', 'Stasis')).not.toThrow();
        expect(() => se.reduceTimedEnemyStatus('victim-1', 'Nonexistent')).not.toThrow();
        expect(stasisNames(se)).toContain('Defense Down');
    });
});

// =============================================================================
// consumeTimedEnemyStatusStack — the STACKS axis (Exposed spends one stack per hit).
//
// Deliberately a sibling of the two suites above, on the same store: reduceTimedEnemyStatus moves
// TURNS, this moves STACKS, and removeTimedEnemyStatus wipes the entry outright. Conflating the two
// axes is the mistake these three suites sitting together are meant to prevent.
// =============================================================================

/** A stackable timed enemy status. `isStackable` is what opts a re-application into ADD-and-cap;
 *  omitting it (the default, and what BOTH corpus Exposed appliers do) makes it REFRESH. */
function stackableEnemyStatus(
    buffName: string,
    duration: number,
    stacks: number,
    opts: { isStackable?: boolean; maxStacks?: number } = {}
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
    return {
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: {
            buffName,
            stacks,
            parsedEffects: {},
            ...(opts.isStackable ? { isStackable: true } : {}),
        },
        ...(opts.maxStacks !== undefined ? { maxStacks: opts.maxStacks } : {}),
    };
}

/** The LIVE stack count as a consumer sees it — through `payload.stacks`, which is exactly the
 *  channel `exposedIncomingPct` reads. Undefined when the entry is gone. */
const liveStacks = (
    se: ReturnType<typeof createStatusEngine>,
    victimId: string,
    buffName: string
): number | undefined =>
    se
        .timedAbilityStatuses('enemy', undefined, victimId)
        .find((s) => s.payload.buffName === buffName)?.payload.stacks;

describe('consumeTimedEnemyStatusStack — spend ONE stack, delete on the last', () => {
    it('walks a 2-stack status down one stack at a time and deletes it only when the last goes', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, stackableEnemyStatus('Exposed', 5, 2), undefined, 'victim-1');

        expect(liveStacks(se, 'victim-1', 'Exposed')).toBe(2);
        se.consumeTimedEnemyStatusStack('victim-1', 'Exposed');
        // The distinguishing assertion: 1, not 0-and-gone (spend-all) and not still 2 (spend-none).
        expect(liveStacks(se, 'victim-1', 'Exposed')).toBe(1);
        se.consumeTimedEnemyStatusStack('victim-1', 'Exposed');
        expect(liveStacks(se, 'victim-1', 'Exposed')).toBeUndefined();
    });

    it('deletes a 1-stack status on the first spend (the common case, unchanged)', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Exposed', 5), undefined, 'victim-1');

        expect(liveStacks(se, 'victim-1', 'Exposed')).toBe(1);
        se.consumeTimedEnemyStatusStack('victim-1', 'Exposed');
        expect(liveStacks(se, 'victim-1', 'Exposed')).toBeUndefined();
    });

    it('spends from ONLY the named family, leaving co-applied debuffs untouched', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, stackableEnemyStatus('Exposed', 5, 2), undefined, 'victim-1');
        se.applyTimedAbilityStatus(
            1,
            stackableEnemyStatus('Defense Down', 5, 2),
            undefined,
            'victim-1'
        );

        se.consumeTimedEnemyStatusStack('victim-1', 'Exposed');
        expect(liveStacks(se, 'victim-1', 'Exposed')).toBe(1);
        expect(liveStacks(se, 'victim-1', 'Defense Down')).toBe(2);
    });

    it('leaves another victim holding the same status at its full count', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        for (const vid of ['victim-1', 'victim-2']) {
            se.applyTimedAbilityStatus(1, stackableEnemyStatus('Exposed', 5, 2), undefined, vid);
        }

        se.consumeTimedEnemyStatusStack('victim-1', 'Exposed');
        expect(liveStacks(se, 'victim-1', 'Exposed')).toBe(1);
        // The payload object is SHARED by reference across victims and applications — a spend that
        // mutated it would show up here as victim-2 silently losing a stack it still holds.
        expect(liveStacks(se, 'victim-2', 'Exposed')).toBe(2);
    });

    it('is a safe no-op for an unknown targetId or unknown buffName', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Defense Down', 2), undefined, 'victim-1');
        expect(() => se.consumeTimedEnemyStatusStack('nonexistent', 'Exposed')).not.toThrow();
        expect(() => se.consumeTimedEnemyStatusStack('victim-1', 'Nonexistent')).not.toThrow();
        expect(liveStacks(se, 'victim-1', 'Defense Down')).toBe(1);
    });

    it('does not touch the TURNS axis (orthogonal to reduceTimedEnemyStatus)', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, stackableEnemyStatus('Exposed', 4, 2), undefined, 'victim-1');

        se.consumeTimedEnemyStatusStack('victim-1', 'Exposed');
        const entry = se
            .timedAbilityStatuses('enemy', undefined, 'victim-1')
            .find((s) => s.payload.buffName === 'Exposed');
        expect(entry?.active.turnsRemaining).toBe(4);
        expect(entry?.payload.stacks).toBe(1);
    });
});

describe('timedAbilityStatuses — the live-stack surface is gated on divergence', () => {
    it('returns the REGISTERED payload object itself while nothing has been spent', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const status = stackableEnemyStatus('Exposed', 5, 2);
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, status, undefined, 'victim-1');

        const [entry] = se.timedAbilityStatuses('enemy', undefined, 'victim-1');
        // Identity, not equality: an unspent entry must not even be spread over, so every existing
        // consumer of every timed status sees the byte-identical payload it saw before this field
        // existed. `active` likewise carries no `stacks` key.
        expect(entry.payload).toBe(status.payload);
        expect(entry.active).toEqual({ buffName: 'Exposed', turnsRemaining: 5 });
    });

    it('surfaces the live count in BOTH payload and active once a stack has been spent', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const status = stackableEnemyStatus('Exposed', 5, 3);
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, status, undefined, 'victim-1');
        se.consumeTimedEnemyStatusStack('victim-1', 'Exposed');

        const [entry] = se.timedAbilityStatuses('enemy', undefined, 'victim-1');
        expect(entry.payload.stacks).toBe(2);
        expect(entry.active.stacks).toBe(2);
        // …and the shared registered payload is untouched, which is the whole reason the live count
        // lives on the entry rather than in `payload`.
        expect(status.payload.stacks).toBe(3);
    });

    it('surfaces the live count even though the corpus Exposed payloads are NOT flagged isStackable', () => {
        // Amartya's reactive payload is built by payloadFromConfig, which does not carry the flag at
        // all, and Nayra's cast config declares `isStackable: false`. Gating the surface on
        // isStackable would therefore leave payload.stacks pinned at the declared count and Exposed
        // would re-read its full amplification on every hit — the bug this change exists to fix.
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(
            1,
            stackableEnemyStatus('Exposed', 5, 2, { isStackable: false }),
            undefined,
            'victim-1'
        );

        se.consumeTimedEnemyStatusStack('victim-1', 'Exposed');
        expect(liveStacks(se, 'victim-1', 'Exposed')).toBe(1);
    });
});

describe('applyTimedAbilityStatus — stack re-application semantics', () => {
    it('ADDS the incoming stacks when the payload declares isStackable', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        // Second application carries the LONGER duration so the family rule lets it through — the
        // duration refresh is the pre-existing behaviour and is not what this asserts.
        se.applyTimedAbilityStatus(
            1,
            stackableEnemyStatus('Exposed', 2, 2, { isStackable: true }),
            undefined,
            'victim-1'
        );
        se.applyTimedAbilityStatus(
            1,
            stackableEnemyStatus('Exposed', 3, 2, { isStackable: true }),
            undefined,
            'victim-1'
        );

        expect(liveStacks(se, 'victim-1', 'Exposed')).toBe(4);
    });

    it('CAPS the sum at maxStacks', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(
            1,
            stackableEnemyStatus('Exposed', 2, 2, { isStackable: true, maxStacks: 3 }),
            undefined,
            'victim-1'
        );
        se.applyTimedAbilityStatus(
            1,
            stackableEnemyStatus('Exposed', 3, 2, { isStackable: true, maxStacks: 3 }),
            undefined,
            'victim-1'
        );

        expect(liveStacks(se, 'victim-1', 'Exposed')).toBe(3);
    });

    it('REFRESHES (does not add) when the payload is not stackable — both corpus Exposed appliers', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, stackableEnemyStatus('Exposed', 2, 2), undefined, 'victim-1');
        se.consumeTimedEnemyStatusStack('victim-1', 'Exposed'); // down to 1
        se.applyTimedAbilityStatus(1, stackableEnemyStatus('Exposed', 3, 2), undefined, 'victim-1');

        // Refresh to the declared 2 — NOT 1 + 2 = 3.
        expect(liveStacks(se, 'victim-1', 'Exposed')).toBe(2);
    });

    it('a FIRST application always seeds the declared count, stackable or not', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(
            1,
            stackableEnemyStatus('Exposed', 2, 2, { isStackable: true, maxStacks: 3 }),
            undefined,
            'victim-1'
        );
        // Uncapped by maxStacks on a first application — the cap governs the ADD, not the seed.
        expect(liveStacks(se, 'victim-1', 'Exposed')).toBe(2);
    });
});
