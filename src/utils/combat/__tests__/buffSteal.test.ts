import { describe, it, expect } from 'vitest';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';

// statusEngine.steal — moves the newest stealable buff(s) from a source actor to one or
// more recipients, remaining duration intact. Mirrors purgeRemoval.test.ts's harness (a minimal
// timed RegisteredAbilityStatus applied via applyTimedAbilityStatus, then read back via
// timedAbilityStatuses).
const mkTimedBuff = (
    buffName: string,
    duration = 3,
    hits?: number
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    kind: 'timed',
    side: 'self',
    sourceSlot: 'active',
    conditions: [],
    duration,
    payload: { buffName, stacks: 1, parsedEffects: { attack: 30 } },
    ...(hits !== undefined ? { hits } : {}),
});

describe('statusEngine.steal (PR10 — buff steal)', () => {
    it('(a) moves the NEWEST buff from source to a single recipient; the older buff stays behind', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up'), 'victim');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Defense Up'), 'victim');

        const stolen = eng.steal('victim', ['thief'], 1);
        expect(stolen).toEqual(['Defense Up']);

        // The source keeps the older buff; the newest is gone.
        expect(eng.timedAbilityStatuses('self', 'victim').map((s) => s.payload.buffName)).toEqual([
            'Attack Up',
        ]);
        // The recipient now holds the stolen buff.
        expect(eng.timedAbilityStatuses('self', 'thief').map((s) => s.payload.buffName)).toEqual([
            'Defense Up',
        ]);
    });

    it('(b) the REMAINING duration travels with the stolen buff, not a fresh full window', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up', 3), 'victim');
        // Decrement once — Attack Up now has 2 turns remaining on the victim.
        eng.decrementPlayer('victim');

        eng.steal('victim', ['thief'], 1);

        const [thiefEntry] = eng.timedAbilityStatuses('self', 'thief');
        expect(thiefEntry.active.turnsRemaining).toBe(2);
    });

    it('(c) count 2 moves the two newest buffs, oldest of three remains on the source', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up'), 'victim');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Defense Up'), 'victim');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Speed Up'), 'victim');

        const stolen = eng.steal('victim', ['thief'], 2);
        expect(stolen.sort()).toEqual(['Defense Up', 'Speed Up']);
        expect(eng.timedAbilityStatuses('self', 'victim').map((s) => s.payload.buffName)).toEqual([
            'Attack Up',
        ]);
    });

    it('(d) grants the SAME stolen buff to EVERY recipient (self + adjacent allies) — not a fan-out split', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up'), 'victim');

        eng.steal('victim', ['thief', 'ally1', 'ally2'], 1);

        for (const id of ['thief', 'ally1', 'ally2']) {
            expect(eng.timedAbilityStatuses('self', id).map((s) => s.payload.buffName)).toEqual([
                'Attack Up',
            ]);
        }
        // Only ONE buff disappeared from the source, even though 3 recipients got a copy.
        expect(eng.timedAbilityStatuses('self', 'victim')).toHaveLength(0);
    });

    it('(e) skips UNREMOVABLE_STATUSES (e.g. Protection) — steals the next newest stealable buff instead', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up'), 'victim');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Protection'), 'victim');

        const stolen = eng.steal('victim', ['thief'], 1);
        expect(stolen).toEqual(['Attack Up']);
        // Protection stays on the source — never stealable.
        expect(eng.timedAbilityStatuses('self', 'victim').map((s) => s.payload.buffName)).toEqual([
            'Protection',
        ]);
    });

    it('(f) unknown source id returns [] and does not throw', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        expect(() => eng.steal('nobody', ['thief'], 1)).not.toThrow();
        expect(eng.steal('nobody', ['thief'], 1)).toEqual([]);
    });

    it('(g) a source with NO removable buffs returns [] and grants nothing', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Protection'), 'victim');
        expect(eng.steal('victim', ['thief'], 1)).toEqual([]);
        expect(eng.timedAbilityStatuses('self', 'thief')).toHaveLength(0);
    });

    it('(h) is unaffected by the Buff Protection holder-guard (distinct mechanism from purge — steals through it)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Buff Protection'), 'victim');
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up'), 'victim');

        // A purge against this holder would remove 0 (Buff Protection blocks the whole purge).
        // steal is a distinct mechanism and is NOT gated by it.
        const stolen = eng.steal('victim', ['thief'], 1);
        expect(stolen).toEqual(['Attack Up']);
    });

    // Finding 2 (own-turn reprieve): a buff stolen onto the CASTER on the caster's OWN turn must
    // NOT be decremented at that same turn's Post-Turn — its remaining duration travels intact
    // (PR176 own-turn reprieve). SMALL duration (2, not 99) so a single spurious decrement is
    // observable.
    it("(i) a buff stolen onto the caster on the caster's own turn keeps its full remaining duration through that turn's Post-Turn (own-turn reprieve)", () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        // Victim holds a 2-turn buff; the victim is NOT the active actor when it's applied.
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up', 2), 'victim');
        // The CASTER ('thief') is now the acting actor (mirrors the engine's beginTurn at
        // turn-start), then steals the buff onto itself.
        eng.beginTurn('thief');
        eng.steal('victim', ['thief'], 1);
        // The caster's Post-Turn runs. WITHOUT the reprieve the stolen buff would tick to 1 here.
        eng.decrementPlayer('thief');

        const [entry] = eng.timedAbilityStatuses('self', 'thief');
        expect(entry.active.turnsRemaining).toBe(2);
    });

    // Complementary semantic lock (Finding 2): an ADJACENT-ALLY recipient is NOT the active
    // actor, so it gets NO reprieve — the stolen buff decrements normally on the ALLY's own turn
    // (its remaining duration was already preserved by the transfer; the reprieve is caster-only).
    it("(j) an adjacent-ally recipient (not the active actor) gets NO reprieve — its copy decrements on the ally's own turn", () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up', 2), 'victim');
        eng.beginTurn('thief');
        eng.steal('victim', ['thief', 'ally1'], 1);
        // The ally's own Post-Turn: no reprieve → normal decrement 2 → 1.
        eng.decrementPlayer('ally1');

        const [entry] = eng.timedAbilityStatuses('self', 'ally1');
        expect(entry.active.turnsRemaining).toBe(1);
    });

    // Finding 1 (critical): a hit-counted status (Barrier for N hits) carries `hitsRemaining`
    // alongside `turnsRemaining`. Both the `stolen` projection and the recipient's BuffState
    // literal used to hand-enumerate their fields and silently drop it — the thief received a
    // BuffState with hitsRemaining undefined (turn-duration-governed, i.e. permanent, since a
    // hit-counted grant is stored with turnsRemaining: Infinity) and consumeStatusHit could never
    // spend it: unspendable, permanent damage immunity. This pins that the charge count travels
    // with the theft, exactly like the REMAINING turnsRemaining does.
    it('(k) a stolen hit-counted Barrier carries its hitsRemaining to the thief — still spendable, still expires', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(
            1,
            mkTimedBuff('Barrier', Number.POSITIVE_INFINITY, 2),
            'victim'
        );

        eng.steal('victim', ['thief'], 1);

        // Still hit-counted on the thief's side: the first hit only partially spends it...
        expect(eng.consumeStatusHit('thief', 'Barrier')).toBe(false);
        expect(eng.timedAbilityStatuses('self', 'thief').map((s) => s.active.buffName)).toContain(
            'Barrier'
        );
        // ...and the second hit fully spends it — a permanent/unspendable grant would never
        // reach false→true here; it would stay present forever (turnsRemaining: Infinity, no
        // hitsRemaining to decrement).
        expect(eng.consumeStatusHit('thief', 'Barrier')).toBe(true);
        expect(
            eng.timedAbilityStatuses('self', 'thief').map((s) => s.active.buffName)
        ).not.toContain('Barrier');
    });
});
