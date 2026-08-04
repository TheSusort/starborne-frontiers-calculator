/**
 * Hit-counted `Barrier` — "grants Barrier for 1 hit" (Malvex / Panon / Quixilver / Sansi).
 *
 * Barrier is FULL DAMAGE IMMUNITY while it is up (barrierBuffs.ts). Its lifecycle used to be
 * duration-only; a grant may now instead — or additionally — carry a hit count, spent at the
 * engine's Barrier absorb site via `StatusEngine.consumeStatusHit`. A grant with a hit count and
 * no turn window is stored with duration Infinity, so only the count can expire it.
 *
 * NOTHING CARRIES `hits` FROM REAL SKILL TEXT YET (the parser lands in a later task), so every
 * fixture here builds a SYNTHETIC `hits`-carrying buff config. That is the point: this file is the
 * only thing exercising the lifecycle end-to-end until the corpus catches up.
 *
 * The engine-level fixtures are POSITIONAL (teamActors + positions + a targeted enemy). The legacy
 * non-positional path folds a multi-hit attack into a single damage multiplier, so "hit 1 blocked,
 * hit 2 lands" is not observable there at all — a per-hit assertion on that path would be vacuous.
 * Harness (helpers, `collectFor`, `simHpLossFor`, `barrierAbsorbedFor`, `timedBomb`) is modelled on
 * hitMitigation.integration.test.ts, the sibling one-shot with the same absorb-site guard.
 */
import { describe, it, expect, vi } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { RegisteredAbilityStatus } from '../statusEngine';
import { executeIntent, type Intent, type IntentExecContext } from '../triggers';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingBomb } from '../state';
import type { PlayerActorRuntime } from '../playerTurn';

// =============================================================================
// Status layer — consumeStatusHit itself.
// =============================================================================

/** A hit-counted Barrier carries no turn window: it is stored with duration Infinity
 *  (Infinity − 1 === Infinity, expiry compares <= 0) so only the hit count expires it —
 *  the TOXIC_OVERFLOW_DURATION / castPathCheatDeath shape. Overrides let a case opt into
 *  a real turn duration instead (the Panon p1 canary). */
const timedBarrier = (
    over: Partial<Extract<RegisteredAbilityStatus, { kind: 'timed' }>> = {}
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    payload: { buffName: 'Barrier', stacks: 1, parsedEffects: {} },
    side: 'self',
    sourceSlot: 'charged',
    conditions: [],
    kind: 'timed',
    duration: Number.POSITIVE_INFINITY,
    ...over,
});

const barrierNames = (eng: ReturnType<typeof createStatusEngine>, id: string): string[] =>
    eng.timedAbilityStatuses('self', id).map((s) => s.active.buffName);

describe('hit-counted Barrier — status layer', () => {
    it('spends one charge per call and removes the status at zero', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedBarrier({ hits: 2 }), 'q1');

        // The return answers "did the status just expire?", NOT "was a charge spent?" — it is
        // what the absorb site uses to emit `buff-expired` exactly once, on the same edge the
        // turn-expiry path emits it. A partial spend therefore returns false.
        expect(eng.consumeStatusHit('q1', 'Barrier')).toBe(false);
        expect(barrierNames(eng, 'q1')).toContain('Barrier');

        expect(eng.consumeStatusHit('q1', 'Barrier')).toBe(true);
        expect(barrierNames(eng, 'q1')).not.toContain('Barrier');
    });

    it('is a no-op for a turn-duration Barrier (hitsRemaining absent)', () => {
        // The Panon p1 regression canary: "Barrier for 1 turn" must survive any number of hits.
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedBarrier({ duration: 1 }), 'p1');

        expect(eng.consumeStatusHit('p1', 'Barrier')).toBe(false);
        expect(eng.consumeStatusHit('p1', 'Barrier')).toBe(false);
        expect(barrierNames(eng, 'p1')).toContain('Barrier');
    });

    it('is a no-op when the actor holds no such status', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        expect(eng.consumeStatusHit('nobody', 'Barrier')).toBe(false);
    });
});

// =============================================================================
// The family rule vs the Infinity encoding — RECORDED, NOT ENDORSED.
//
// `familyApplicationWins` compares `duration > existing.turnsRemaining`. Encoding "no turn window"
// as Infinity therefore has three consequences for a name that carries BOTH kinds of grant in the
// corpus (Panon has a turn-duration Barrier and a hit-counted one). All three are pinned below as
// they ACTUALLY BEHAVE, so a future change to the family rule or to the encoding shows up as a test
// diff rather than a silent behaviour change. None of the three is claimed to be the desired game
// behaviour — the owner has not ruled on it, and the family rule is deliberately left alone.
// =============================================================================

describe('hit-counted Barrier vs the buff-family rule (known Infinity-encoding consequences)', () => {
    it('cannot be refreshed while active — Infinity > Infinity is false, so the charge count is NOT topped up', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedBarrier({ hits: 2 }), 'a1');
        // A second, RICHER grant (5 charges) while the first is still up.
        eng.applyTimedAbilityStatus(1, timedBarrier({ hits: 5 }), 'a1');

        // Still the original 2 charges, not 5: the second application was family-blocked.
        expect(eng.consumeStatusHit('a1', 'Barrier')).toBe(false);
        expect(eng.consumeStatusHit('a1', 'Barrier')).toBe(true);
        expect(barrierNames(eng, 'a1')).not.toContain('Barrier');
    });

    it('always replaces an active turn-duration Barrier, discarding its remaining turns', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedBarrier({ duration: 5 }), 'a2');
        // Infinity > 5, so the hit-counted grant wins and the 5-turn window is thrown away.
        eng.applyTimedAbilityStatus(1, timedBarrier({ hits: 1 }), 'a2');

        // One hit now removes the Barrier entirely — the 5 turns it replaced are gone with it.
        expect(eng.consumeStatusHit('a2', 'Barrier')).toBe(true);
        expect(barrierNames(eng, 'a2')).not.toContain('Barrier');
    });

    it('suppresses a later turn-duration grant until it is consumed', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedBarrier({ hits: 1 }), 'a3');
        // 5 > Infinity is false, so this grant is silently absorbed by the family rule.
        eng.applyTimedAbilityStatus(1, timedBarrier({ duration: 5 }), 'a3');

        // The single charge is still the whole lifecycle: spending it leaves NOTHING behind, which
        // is only true if the 5-turn grant never landed.
        expect(eng.consumeStatusHit('a3', 'Barrier')).toBe(true);
        expect(barrierNames(eng, 'a3')).not.toContain('Barrier');
    });
});

// =============================================================================
// The REACTIVE path — triggers.ts executeIntent's `cfg.type === 'buff'` branch.
//
// A grant reaches the status store by one of two routes: the CAST path
// (registerActorAbilityStatuses in engine.ts, exercised end-to-end by every test above and
// below) and this REACTIVE path (executeIntent, used by any ability carrying a LIVE trigger —
// `end-of-turn` is the one a later task's Quixilver R2 passive actually takes). The two routes
// thread `hits` through SEPARATE code — triggers.ts's duration ternary and the hoisted status
// literal's `hits` spread — so a cast-path-only suite would miss a divergence between them
// entirely, which is the whole reason this finding exists.
//
// Unit-level on executeIntent directly (the ctx-construction pattern triggers.test.ts's
// damagedAllyId suite already uses for this same buff branch), NOT a multi-round runCombat
// fixture: the duration bookkeeping under test (Infinity vs a real turn count) only diverges
// observably several ROUNDS apart — engine.ts runs a carrier's own Post Turn decrement BEFORE
// its turn-ended emission, so a same-round grant is immune to its own decrement either way, cast
// path or reactive — and keeping an incoming attack from accidentally spending the SAME grant's
// hit charge before the duration difference ever gets a chance to show up is exactly the kind of
// fixture that goes vacuous by accident. Spying on the real `applyTimedAbilityStatus` call instead
// reads the two lines' actual output directly and non-vacuously.
// =============================================================================

describe('hit-counted Barrier — reactive path (triggers.ts executeIntent, cfg.type === "buff")', () => {
    const makeHolderRuntime = (id: string): PlayerActorRuntime =>
        ({
            actor: { id } as CombatActor,
            healModifier: 0,
            attack: 0,
            defence: 0,
            hp: 1000,
        }) as unknown as PlayerActorRuntime;

    /** A self-target Barrier grant on a LIVE trigger — the shape a reactive ship passive (an
     *  end-of-turn Barrier, e.g.) actually carries into executeIntent's buff branch. */
    const reactiveBarrierIntent = (opts: { hits?: number; duration?: number }): Intent => ({
        ownerId: 'holder',
        sourceSlot: 'passive',
        ability: {
            id: 'reactive-barrier',
            type: 'buff',
            target: 'self',
            trigger: 'end-of-turn',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Barrier',
                stacks: 1,
                parsedEffects: {},
                isStackable: false,
                ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
                ...(opts.hits !== undefined ? { hits: opts.hits } : {}),
            },
        },
    });

    /** Minimal IntentExecContext for a self-buff intent — lifted from triggers.test.ts's
     *  damagedAllyId suite (same cfg.type === 'buff' branch), re-keyed to a single 'holder'. */
    const buildCtx = (): IntentExecContext => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        return {
            round: 1,
            enemy: { id: 'enemy-default' } as CombatActor,
            enemyId: 'enemy-default',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['holder', makeHolderRuntime('holder')]]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: ['holder'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
        };
    };

    it('a. duration-less + hits-carrying: stored hit-counted, spent by one direct hit — same as the cast path', () => {
        const ctx = buildCtx();
        const applySpy = vi.spyOn(ctx.statusEngine, 'applyTimedAbilityStatus');

        executeIntent(reactiveBarrierIntent({ hits: 1 }), ctx);

        // The stored status itself: duration Infinity (no turn window — the hit count is the
        // only thing that can expire it) AND hits threaded onto it. A single-call unit test
        // never decrements, so `duration`'s actual value is otherwise unobservable here — this
        // direct read is what makes the assertion below non-vacuous.
        expect(applySpy).toHaveBeenCalledTimes(1);
        const status = applySpy.mock.calls[0][1];
        expect(status.duration).toBe(Infinity);
        expect(status.hits).toBe(1);

        expect(barrierNames(ctx.statusEngine, 'holder')).toContain('Barrier');
        // The absorb site's exact API: one direct hit fully spends a 1-charge grant, exactly
        // like the status-layer test at the top of this file pins for the cast path.
        expect(ctx.statusEngine.consumeStatusHit('holder', 'Barrier')).toBe(true);
        expect(barrierNames(ctx.statusEngine, 'holder')).not.toContain('Barrier');
    });

    it('b. duration-less, hits ABSENT: keeps the pre-existing 1-turn window, not Infinity', () => {
        const ctx = buildCtx();
        const applySpy = vi.spyOn(ctx.statusEngine, 'applyTimedAbilityStatus');

        executeIntent(reactiveBarrierIntent({}), ctx);

        // arg[1] is the status object applyTimedAbilityStatus actually received — the
        // byte-identical-when-absent guarantee, read directly off the real call.
        expect(applySpy).toHaveBeenCalledTimes(1);
        const status = applySpy.mock.calls[0][1];
        expect(status.duration).toBe(1);
        expect(status.hits).toBeUndefined();
        // Confirmed NOT hit-counted: a direct hit does nothing to a turn-window Barrier.
        expect(ctx.statusEngine.consumeStatusHit('holder', 'Barrier')).toBe(false);
        expect(barrierNames(ctx.statusEngine, 'holder')).toContain('Barrier');
    });

    it("c. explicit numeric duration AND hits: the ternary's first arm still wins", () => {
        const ctx = buildCtx();
        const applySpy = vi.spyOn(ctx.statusEngine, 'applyTimedAbilityStatus');

        executeIntent(reactiveBarrierIntent({ duration: 2, hits: 3 }), ctx);

        expect(applySpy).toHaveBeenCalledTimes(1);
        const status = applySpy.mock.calls[0][1];
        expect(status.duration).toBe(2); // NOT Infinity — hits does not override a stated duration.
        expect(status.hits).toBe(3); // ...but hits is still threaded onto the same status.
    });
});

// =============================================================================
// Engine level — a synthetic `hits`-carrying config driven through real positional combat.
// =============================================================================

const DIRECT_HIT = 5000; // attack 5000 × 100% × 1 hit vs defence 0.
const HP = 10_000_000; // large enough nothing ever dies; small enough pct math stays precise.

/** A self-cast Barrier. `hits` present → hit-counted (no turn window: the engine stores it with
 *  duration Infinity). `hits` absent → the pre-existing turn-duration grant, unchanged. */
const barrierSelfBuff = (opts: { hits?: number; duration?: number }): Ability => ({
    id: 'barrier-self',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Barrier',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
        ...(opts.hits !== undefined ? { hits: opts.hits } : {}),
    },
});

/** The same grant aimed at the whole team — the only way to arm a holder BEFORE its own turn
 *  starts, which the detonation fixture needs (its bomb bursts at the holder's turn start). */
const allAlliesBarrier = (hits: number): Ability => ({
    id: 'barrier-allies',
    type: 'buff',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Barrier',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        hits,
    },
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const noopDamage = (): Ability => ({
    id: 'noop-dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

let atkCounter = 0;
/** `hits` separate applications of attack × 100% each — the funnel sees one hit per application,
 *  which is exactly what a per-charge assertion needs and what the non-positional path cannot do. */
const basicAttack = (hits = 1): Ability => ({
    id: `basic-${++atkCounter}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits },
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

/** The Barrier holder: fast (acts first, so the buff is up before any hit lands) and dealing no
 *  damage of its own. `abilities` is the active slot — pass `[noopDamage()]` when the grant has to
 *  come from elsewhere. */
const holderTeamActor = (
    id: string,
    position: Position,
    abilities: Ability[],
    extraSlots: ShipSkills['slots'] = []
): TeamActor =>
    ({
        id,
        speed: 1000,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [{ slot: 'active', abilities }, ...extraSlots] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: extraSlots.some((s) => s.slot === 'charged'),
        },
    }) as TeamActor;

/** Slower than every holder above, so its hit always lands after the Barrier is armed. */
const offensiveEnemy = (
    id: string,
    position: Position,
    abilities: Ability[] = [basicAttack()],
    speed = 1
): EnemyAttacker =>
    ({
        id,
        stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities }] },
    }) as EnemyAttacker;

/** Bursts for damagePerStack once `countdown` reaches 0 on the holder's own turn. */
const timedBomb = (damagePerStack: number, countdown: number): PendingBomb => ({
    countdown,
    damagePerStack,
    stacks: 1,
    tier: 100,
    sourceId: 'enemy-applier',
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

const BASE_PLAYER_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [noopDamage()] }] },
    enemyDefense: 0,
    enemyHp: HP,
    numRounds: 2,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HP,
    healTargetId: 'attacker',
    ...overrides,
});

/** Runs the fixture and taps the `buff-expired` stream for one actor. */
function collectFor(input: CombatEngineInput, targetId: string) {
    const bus = createEventBus();
    const expired: { round: number; buffName: string }[] = [];
    bus.on('buff-expired', (e: Extract<CombatEvent, { type: 'buff-expired' }>) => {
        if (e.actorId === targetId) expired.push({ round: e.round, buffName: e.buffName });
    });
    const result = runCombat({ ...input, bus });
    return { expired, result };
}

/** battleSimulator's `incomingHpThisRound` derivation, verbatim, for one round/target. */
function simHpLossFor(
    result: ReturnType<typeof runCombat>,
    round: number,
    targetId: string
): number {
    const entry = result.rounds.find((r) => r.round === round)!;
    const taken = entry.perTargetDamage?.[targetId] ?? 0;
    const inc = entry.perActorIncoming?.[targetId];
    return inc ? Math.max(0, inc.incoming - inc.shieldAbsorbed - inc.barrierAbsorbed) : taken;
}

/** The round's Barrier-nullified total for one target — how much this Barrier actually stopped. */
function barrierAbsorbedFor(
    result: ReturnType<typeof runCombat>,
    round: number,
    targetId: string
): number {
    const entry = result.rounds.find((r) => r.round === round)!;
    return entry.perActorIncoming?.[targetId]?.barrierAbsorbed ?? 0;
}

describe('hit-counted Barrier — engine level (positional)', () => {
    it('a direct hit spends exactly one charge: hit 1 is blocked, hit 2 lands in full', () => {
        // One enemy attacking twice in the same cast — two separate applications through the
        // damage funnel. Barrier is armed for 1 hit, so exactly one of them is nullified.
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            teamActors: [
                holderTeamActor('holder', 'M4', [barrierSelfBuff({ hits: 1 }), noopDamage()]),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', [basicAttack(2)])],
        });
        const { expired, result } = collectFor(input, 'holder');

        expect(barrierAbsorbedFor(result, 1, 'holder')).toBeCloseTo(DIRECT_HIT, 6);
        expect(simHpLossFor(result, 1, 'holder')).toBeCloseTo(DIRECT_HIT, 6);
        // The charge-spend removal is announced, exactly like a turn expiry — without this the
        // Barrier would vanish from the combat log and the round status panel silently.
        expect(expired).toEqual([{ round: 1, buffName: 'Barrier' }]);
    });

    it('honours the COUNT, not just one-shot-ness: 2 charges block 2 hits and the 3rd lands', () => {
        // Guards against a "remove on first hit" implementation, which the case above alone
        // would not catch.
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            teamActors: [
                holderTeamActor('holder', 'M4', [barrierSelfBuff({ hits: 2 }), noopDamage()]),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', [basicAttack(3)])],
        });
        const { expired, result } = collectFor(input, 'holder');

        expect(barrierAbsorbedFor(result, 1, 'holder')).toBeCloseTo(2 * DIRECT_HIT, 6);
        expect(simHpLossFor(result, 1, 'holder')).toBeCloseTo(DIRECT_HIT, 6);
        // Exactly ONE buff-expired, on the spend that removed it — not one per charge.
        expect(expired).toEqual([{ round: 1, buffName: 'Barrier' }]);
    });

    it('a turn-duration Barrier (no hits) is untouched by any number of hits', () => {
        // The regression canary for the whole feature: absent `hits`, nothing about the absorb
        // site may change. Three hits a round, two rounds, all six fully blocked.
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            teamActors: [
                holderTeamActor('holder', 'M4', [barrierSelfBuff({ duration: 99 }), noopDamage()]),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', [basicAttack(3)])],
        });
        const { expired, result } = collectFor(input, 'holder');

        expect(barrierAbsorbedFor(result, 1, 'holder')).toBeCloseTo(3 * DIRECT_HIT, 6);
        expect(barrierAbsorbedFor(result, 2, 'holder')).toBeCloseTo(3 * DIRECT_HIT, 6);
        expect(simHpLossFor(result, 1, 'holder')).toBe(0);
        expect(simHpLossFor(result, 2, 'holder')).toBe(0);
        expect(expired).toEqual([]);
    });

    it('a hit-counted grant that ALSO looks accumulating still lands somewhere the spend can reach', () => {
        // `stackTrigger + isStackable` normally routes a grant into the accumulating store, which
        // `consumeStatusHit` cannot reach — a hit-counted grant landing there would be permanent
        // and unspendable (the one-shot-in-an-unreachable-channel defect class). No corpus config
        // combines the two today; the classification guard in registerActorAbilityStatuses makes
        // `hits` win, and this pins it. Drop the `!hitCounted` from `accumulating` and the charge
        // is never spent: barrierAbsorbed becomes 2 × DIRECT_HIT and nothing lands.
        const accumulatingHitCountedBarrier = (): Ability => ({
            id: 'barrier-accum',
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Barrier',
                parsedEffects: {},
                stacks: 1,
                isStackable: true,
                stackTrigger: 'per-round',
                hits: 1,
            },
        });
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            teamActors: [
                holderTeamActor('holder', 'M4', [accumulatingHitCountedBarrier(), noopDamage()]),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', [basicAttack(2)])],
        });
        const { expired, result } = collectFor(input, 'holder');

        expect(barrierAbsorbedFor(result, 1, 'holder')).toBeCloseTo(DIRECT_HIT, 6);
        expect(simHpLossFor(result, 1, 'holder')).toBeCloseTo(DIRECT_HIT, 6);
        expect(expired).toEqual([{ round: 1, buffName: 'Barrier' }]);
    });

    it('is team-symmetric — an enemy-side holder spends its charge on a player hit', () => {
        // The absorb site is side-agnostic (applyIncomingToTarget), and this pins that: the same
        // fixture with the holder on the ENEMY side and the player focus as the attacker. No
        // amount is compared ACROSS sides (RNG is keyed by ownerId) — each side is checked against
        // its own DIRECT_HIT.
        const enemyHolder = (): EnemyAttacker =>
            ({
                id: 'holder',
                stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1000 },
                chargeCount: 0,
                startCharged: false,
                position: 'M4' as Position,
                target: parsedTarget('front'),
                pattern: basePattern(),
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [barrierSelfBuff({ hits: 1 }), noopDamage()] },
                    ],
                },
            }) as EnemyAttacker;

        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            attack: DIRECT_HIT, // the player focus deals the hits
            shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack(2)] }] },
            speed: 1, // slower than the holder, so the Barrier is up when the hits land
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [enemyHolder()],
        });
        const { expired, result } = collectFor(input, 'holder');

        expect(barrierAbsorbedFor(result, 1, 'holder')).toBeCloseTo(DIRECT_HIT, 6);
        expect(simHpLossFor(result, 1, 'holder')).toBeCloseTo(DIRECT_HIT, 6);
        expect(expired).toEqual([{ round: 1, buffName: 'Barrier' }]);
    });
});

// =============================================================================
// REGRESSION for the absorb-site guard: a bomb detonation must NOT spend a charge.
//
// A pure detonation arrives stamped `byDirectDamage: true` with the whole amount in `bombPortion`.
// Guarding the consume on `byDirectDamage` ALONE therefore lets a burst spend the charge and leaves
// the next real hit unblocked — and bomb-death-splash loops once per bomb, so one adjacent death
// could spend several charges at once. The funnel's real definition of a hit is
// `byDirectDamage === true && bombPortion === 0`, which is what Hit Mitigation and Shield Converter
// both use and what this guard now uses too.
//
// Fixture (the ally-grant shape hitMitigation.integration.test.ts uses for the same reason): the
// burst goes off at the START of the holder's own turn, so the holder cannot self-arm in time — the
// fast focus actor grants Barrier to all allies first. The holder deliberately does NOT self-cast:
// a re-cast later in its own turn would re-arm the charge and mask a burst that wrongly spent it.
// =============================================================================

describe('a bomb detonation does not spend a Barrier charge', () => {
    const BURST = 2000; // deliberately ≠ DIRECT_HIT so the two amounts are never confusable.

    it('the burst is blocked for free and the charge survives for the real hit that follows', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            speed: 2000, // the granting focus acts first, so the Barrier is up before the burst
            shipSkills: {
                slots: [{ slot: 'active', abilities: [allAlliesBarrier(1), noopDamage()] }],
            },
            teamActors: [holderTeamActor('holder', 'M4', [noopDamage()])],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
            __testTapActors: (actors: CombatActor[]) => {
                // countdown 1 → bursts at the START of the holder's round-1 turn, after the focus
                // has already granted the Barrier and before the enemy's attack lands.
                actors.find((a) => a.id === 'holder')?.pendingBombs.push(timedBomb(BURST, 1));
            },
        });
        const { expired, result } = collectFor(input, 'holder');

        // BOTH the burst and the enemy attack were nullified — the charge survived the burst and
        // was still there for the real hit. Pre-fix: BURST only (the burst ate the charge) and the
        // DIRECT_HIT landed for real.
        expect(barrierAbsorbedFor(result, 1, 'holder')).toBeCloseTo(BURST + DIRECT_HIT, 6);
        expect(simHpLossFor(result, 1, 'holder')).toBe(0);
        // And the charge was spent by the ATTACK, not the burst — one expiry, after both landed.
        expect(expired).toEqual([{ round: 1, buffName: 'Barrier' }]);
    });
});
