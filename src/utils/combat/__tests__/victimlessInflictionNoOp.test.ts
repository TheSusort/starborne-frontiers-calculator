/**
 * SP-4c-2d, rung 1 — THE NO-OP RULING.
 *
 * A "reactive infliction" is a passive that fires on an EVENT rather than on a cast and lands
 * something on an enemy. Normally the triggering event stamps WHICH enemy, in
 * `intent.eventCtx.victimId` or `.counterTargetId`. Four executor branches in `triggers.ts` had a
 * fallback for when neither was stamped: aim at the vestigial DPS dummy, the hidden actor with id
 * `'enemy'`. Since SP-4c-2c that actor takes no turn on any run, so anything landing on it never
 * ticks and never expires — while `dotCarrierActors` still REPORTS it. The rule adopted here is the
 * one the reactive `damage` branch already documented above its selector arms:
 *
 *     "A selector that resolves nothing is a NO-OP — it never falls back to the dummy."
 *
 * ── WHAT EACH CASE WITNESSES, AND WHY IT IS NOT VACUOUS ───────────────────────────────────────
 *
 * Every negative case here is paired with a POSITIVE half that runs the same branch with a victim
 * genuinely stamped. That pairing is the point: it pins VICTIMLESSNESS as the axis, so a future
 * change that silenced reactive DoTs/debuffs/purges outright would break the positive half rather
 * than sail through on the negative one. It is the correction to 4c-2c's shipped defect — a
 * tripwire that passed byte-identical against pre-rung semantics.
 *
 * All six cases were confirmed to FAIL (the three negatives) / PASS (the three positives) against
 * the pre-rung tree, and the three negatives were re-confirmed to fail again with the production
 * guards stashed out. The negatives' pre-fix failure messages name the sentinel `'enemy'` directly
 * (`dot-applied → enemy`, `debuff-applied → enemy`, `purge('enemy', 2)`), which is stronger
 * evidence that the arm was REACHED than a temporary `console.error` probe would be.
 *
 * ── THE SHAPES ────────────────────────────────────────────────────────────────────────────────
 *
 * `start-of-round` is the victimless trigger of choice: its listener is `bus.on('round-started',
 * () => enqueue(intent))` — a bare enqueue with NO eventCtx at all — so neither victim channel is
 * stamped and the branch's resolution is genuinely empty. The victim-stamped counterparts are
 * `on-deal-damage` (stamps `victimId`) for the DoT branch and `on-attacked` (stamps
 * `counterTargetId`) for the debuff branch; the two channels are NOT interchangeable across
 * branches — the `dot` branch reads `victimId ?? counterTargetId` while the `debuff` branch reads
 * `counterTargetId ?? debuffVictimId` and never looks at `victimId` — which is why the two positive
 * halves ride different triggers.
 *
 * The PURGE branch is the only one of the four with a SHIPPED consumer (spec §10.1 measured 73
 * hits suite-wide): Rhodium's `end-of-round` + `enemy-most-buffs` purge, in every round where no
 * enemy carried a buff, because `mostBuffsAmong` returns undefined there (`engine.ts`). It is also
 * the one branch whose fallback is INVISIBLE in the event log: purging the buff-less dummy removes
 * 0 statuses, and `purge-performed` is emitted only when `removed > 0`. An event-based negative
 * would therefore have passed before the fix as well — vacuous. So this file spies on the live
 * `statusEngine.purge` (through `__testTapStatusEngine`, which the engine calls before the fight
 * loop) and reads the CALL, not its consequence.
 *
 * ⚠️ No shipped kit builds the victimless DoT/debuff shape — all 40 corpus shapes resolve a target
 * (spec §10.1) — so those four cases are synthetic BY NECESSITY. The purge pair is the shipped one.
 *
 * ⚠️ SEEDING: `setupKeyedTestRng` only, never followed by `resetRateGateRng()` — that pair un-seeds
 * both streams and is flagged by `rateGateSeedingOrder.test.ts`. `src/setupTests.ts` already resets
 * after every test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import {
    bareInput,
    bareEnemy,
    attackingEnemy,
    BARE_ENEMY_ID,
} from '../__testutils__/bareRosterFixture';

/** The vestigial DPS dummy's actor id — the sink every branch here used to aim at. */
const DUMMY_ID = 'enemy';
const FOCUS_ID = 'attacker';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `vino${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/** A 100%-multiplier damage active (so the focus lands real hits) plus ONE reactive passive. */
const kitWith = (reactive: Ability): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
        },
        { slot: 'passive', abilities: [reactive] },
    ],
});

const corrosion = (trigger: Ability['trigger']): Ability =>
    ab({
        type: 'dot',
        target: 'enemy',
        trigger,
        config: { type: 'dot', dotType: 'corrosion', stacks: 1, tier: 3, duration: 3 },
    });

const DEBUFF_NAME = 'Attack Down II';

const attackDown = (trigger: Ability['trigger']): Ability =>
    ab({
        type: 'debuff',
        target: 'enemy',
        trigger,
        config: {
            type: 'debuff',
            buffName: DEBUFF_NAME,
            parsedEffects: { attack: -10 },
            stacks: 1,
            isStackable: false,
            // 'apply' is the GUARANTEED (non-resistible) verb — it takes the landing RNG out of
            // these cases entirely, so a negative can never read as a no-op that was really a
            // failed landing roll.
            application: 'apply',
            duration: 3,
        },
    });

const PURGE_COUNT = 2;

const rhodiumPurge = (): Ability =>
    ab({
        type: 'purge',
        target: 'enemy-most-buffs',
        trigger: 'end-of-round',
        config: { type: 'purge', count: PURGE_COUNT },
    });

interface Observed {
    dotApplied: Extract<CombatEvent, { type: 'dot-applied' }>[];
    debuffApplied: Extract<CombatEvent, { type: 'debuff-applied' }>[];
    purgePerformed: Extract<CombatEvent, { type: 'purge-performed' }>[];
    /** Every `statusEngine.purge(actorId, count)` the run made — the ONLY channel the purge
     *  fallback is visible on (a buff-less dummy removes 0, so no event is emitted). */
    purgeCalls: [string, number | 'all'][];
    dummy?: CombatActor;
    realEnemy?: CombatActor;
}

/** `bareInput()` + real hacking/security so a DoT's landing gate resolves to 1, plus the taps. */
const observe = (over: Partial<CombatEngineInput> = {}): Observed => {
    const bus = createEventBus();
    const o: Observed = {
        dotApplied: [],
        debuffApplied: [],
        purgePerformed: [],
        purgeCalls: [],
    };
    bus.on('dot-applied', (e) => o.dotApplied.push(e));
    bus.on('debuff-applied', (e) => o.debuffApplied.push(e));
    bus.on('purge-performed', (e) => o.purgePerformed.push(e));
    let tapped = false;
    runCombat({
        ...bareInput(),
        // The focus's own reactive applications must LAND, so the DoT branch's landing draw is not
        // what a negative case is really measuring.
        hacking: 200,
        ...over,
        bus,
        // Called immediately after `createStatusEngine`, BEFORE the fight loop — so a spy installed
        // here sees every purge the run performs. `vi.spyOn` calls through by default, keeping the
        // real removal behaviour intact for the positive half.
        // The wrapper CALLS THROUGH, so the real removal still happens and the positive half stays
        // a genuine end-to-end purge — it only records that the call was made.
        __testTapStatusEngine: (se) => {
            tapped = true;
            const inner = se.purge.bind(se);
            se.purge = (actorId, count) => {
                o.purgeCalls.push([actorId, count]);
                return inner(actorId, count);
            };
        },
        __testTapActors: (actors) => {
            o.dummy = actors.find((a) => a.id === DUMMY_ID);
            o.realEnemy = actors.find((a) => a.id === BARE_ENEMY_ID);
        },
    });
    if (!o.realEnemy) throw new Error('__testTapActors never handed out the real roster member');
    if (!tapped) throw new Error('__testTapStatusEngine never handed out the status engine');
    return o;
};

describe('SP-4c-2d: a victimless reactive infliction is a no-op — the `dot` branch', () => {
    beforeEach(() => {
        idc = 0;
        setupKeyedTestRng(12345);
    });

    it('a start-of-round DoT with target:enemy applies NOTHING and emits no dot-applied', () => {
        const o = observe({ shipSkills: kitWith(corrosion('start-of-round')) });

        // NEGATIVE: nothing landed ANYWHERE — not on the dummy, not on the real roster member.
        expect(o.dotApplied).toEqual([]);
        expect(o.dummy?.corrosionEntries ?? []).toEqual([]);
        expect(o.realEnemy!.corrosionEntries).toEqual([]);
    });

    it('POSITIVE HALF: the same DoT on a victim-stamping trigger still lands, on the REAL enemy', () => {
        // `on-deal-damage` stamps `eventCtx.victimId` (the enemy the focus actually hit), which is
        // the channel the `dot` branch resolves. Same ability, same `target: 'enemy'`, same slot —
        // the ONLY difference from the case above is that the event names a victim.
        const o = observe({ shipSkills: kitWith(corrosion('on-deal-damage')) });

        expect(o.dotApplied.length).toBeGreaterThan(0);
        for (const e of o.dotApplied) {
            expect(e.sourceId).toBe(FOCUS_ID);
            expect(e.targetId).toBe(BARE_ENEMY_ID);
            expect(e.targetId).not.toBe(DUMMY_ID);
        }
        expect(o.realEnemy!.corrosionEntries.some((e) => e.sourceId === FOCUS_ID)).toBe(true);
        // The dummy stays empty on the positive half too — routing, not suppression.
        expect(o.dummy?.corrosionEntries ?? []).toEqual([]);
    });
});

describe('SP-4c-2d: a victimless reactive infliction is a no-op — the `debuff` branch', () => {
    beforeEach(() => {
        idc = 0;
        setupKeyedTestRng(12345);
    });

    it('a start-of-round debuff with target:enemy applies NOTHING and emits no debuff-applied', () => {
        const o = observe({ shipSkills: kitWith(attackDown('start-of-round')) });

        expect(o.debuffApplied).toEqual([]);
    });

    it('POSITIVE HALF: the same debuff on a victim-stamping trigger still lands, on the REAL enemy', () => {
        // `on-attacked` stamps `eventCtx.counterTargetId` (the attacker), which is the channel the
        // `debuff` branch resolves — deliberately a DIFFERENT trigger from the DoT positive above,
        // because the two branches read different eventCtx fields (`victimId` is invisible to this
        // branch). The roster member must actually ATTACK for the event to exist.
        const o = observe({
            shipSkills: kitWith(attackDown('on-attacked')),
            enemyAttackers: attackingEnemy(),
        });

        expect(o.debuffApplied.length).toBeGreaterThan(0);
        for (const e of o.debuffApplied) {
            expect(e.buffName).toBe(DEBUFF_NAME);
            expect(e.targetId).toBe(BARE_ENEMY_ID);
            expect(e.targetId).not.toBe(DUMMY_ID);
        }
    });
});

describe('SP-4c-2d: a victimless reactive infliction is a no-op — the `purge` branch', () => {
    beforeEach(() => {
        idc = 0;
        setupKeyedTestRng(12345);
    });

    /** An enemy that self-buffs on its turn, so `mostBuffsAmong` has something to resolve. */
    const buffingEnemy = () =>
        attackingEnemy({
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({
                                type: 'buff',
                                target: 'self',
                                config: {
                                    type: 'buff',
                                    buffName: 'Attack Up',
                                    parsedEffects: { attack: 10 },
                                    stacks: 1,
                                    isStackable: false,
                                    duration: 99,
                                },
                            }),
                            ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        ],
                    },
                ],
            },
        });

    it("Rhodium's end-of-round purge no-ops when no enemy carries a buff", () => {
        // THE ONE SHIPPED CONSUMER (spec §10.1, 73 measured hits). `mostBuffsAmong` returns
        // undefined when no enemy carries any buff, and the purge branch alone fell through to the
        // dummy. Rhodium's `damage` half on the same trigger and target already returned; now both
        // halves agree.
        //
        // Read off the purge CALL, not `purge-performed`: purging the buff-less dummy removed 0, so
        // no event was ever emitted and an event-based assertion would have passed pre-fix too.
        const o = observe({ shipSkills: kitWith(rhodiumPurge()), enemyAttackers: bareEnemy() });

        expect(o.purgeCalls).toEqual([]);
        expect(o.purgePerformed).toEqual([]);
    });

    it('POSITIVE HALF: the same purge fires when an enemy IS buffed, and names a REAL enemy', () => {
        const o = observe({
            shipSkills: kitWith(rhodiumPurge()),
            enemyAttackers: buffingEnemy(),
        });

        expect(o.purgeCalls.length).toBeGreaterThan(0);
        // ...and it named a REAL enemy, never the sentinel string.
        for (const [targetId, count] of o.purgeCalls) {
            expect(targetId).toBe(BARE_ENEMY_ID);
            expect(targetId).not.toBe(DUMMY_ID);
            expect(count).toBe(PURGE_COUNT);
        }
    });
});
