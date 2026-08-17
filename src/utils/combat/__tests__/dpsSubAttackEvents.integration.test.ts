/**
 * Multi-hit full-walk epic, PR5 — one `ability-performed` per SUB-ATTACK on the NON-POSITIONAL
 * (DPS / healing) path.
 *
 * A multi-hit skill is N consecutive FULL-WALK attacks (locked game rule), so outgoing riders
 * fire N times. The positional simulator has emitted one event per sub-attack since PR2; this
 * file pins the same shape on the path `simulateDPS`/`simulateHealing` drive (both call
 * `runPlayerTurn`'s inline emit), which folded the whole cast into one event until PR5. That fold
 * is why the DPS calculator reported ONE Inferno stack for Enforcer + Burner while the simulator
 * reported three.
 *
 * What each assertion is load-bearing for:
 *  1. CARDINALITY — `hits: 3` gives 3 events per active round, `hits: 1` gives exactly 1, and
 *     `hits: 0` is clamped to exactly 1 (not 0 — a silent drop — and not a `0/0` NaN damage). The
 *     N=1 control is the cheapest correctness check in the epic: every corpus ship except
 *     Enforcer is single-hit.
 *  2. PAYLOAD — each event carries its OWN `subAttackIndex` and its OWN crit outcome, with
 *     `critHits` counting critting VICTIMS in that one sub-attack (1 or absent for the single
 *     bound enemy) rather than critting HITS across the cast. That convergence with the
 *     positional meaning is what lets `triggers.ts` drop its second `on-crit` branch (Task 2 —
 *     see the `non-positional outgoing riders` describe block below).
 *  3. DAMAGE EQUIVALENCE — Σ of the N events' `damage`, and the round total, are UNCHANGED.
 *     `victimDamage.ts:16-30` proves the fold is algebraically identical to N separate hits;
 *     this asserts it rather than trusting the comment. Looping buys zero damage accuracy — it
 *     buys ONE derivation of "a sub-attack" instead of two that can drift.
 *  4. RIDER FAN-OUT (`non-positional outgoing riders` describe block) — the actual user-visible
 *     payload, built via `multiHit`'s `riders` parameter: `on-deal-damage` (Burner) and `on-crit`
 *     (Bloodthirst) riders now fire once per sub-attack, off THAT sub-attack's own damage — not
 *     once per cast off the cast total. The on-crit case is driven through `simulateHealing`, not
 *     `simulateDPS`: a reactive heal only DRAINS when `ctx.healing` is populated
 *     (`if (!ctx.healing) return;`, triggers.ts), which `simulateDPS` never sets.
 *
 * RNG: the first describe block's tests run at crit 100 or crit 0, where the gate is rate >= 1 /
 * rate <= 0 and draws no randomness. The `non-positional outgoing riders` tests pin BOTH gates
 * explicitly (`setRateGateRng` + `setKeyedRng`, reset via `afterEach`) — the engine is NOT
 * deterministic (`rateAccumulator.ts` uses `Math.random`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resetRateGateRng, setRateGateRng, setKeyedRng } from '../../calculators/rateAccumulator';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { simulateHealing, HealerStats } from '../../calculators/healingEngineAdapter';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';

type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `dsa${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/**
 * multiplier=100 with `hits: N` — the folded multiplier is 100*N (playerTurn's
 * `effectiveMultiplier = rawMultiplier * hits`). NOTE: this MULTIPLIES; it does not re-split.
 * An N-hit cast therefore deals N x a single-hit cast, which is why the equivalence assertion
 * below compares against a closed form and not against `one/3`.
 */
const multiHit = (hits: number, riders: Ability[] = []): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'damage', config: { type: 'damage', multiplier: 100, hits } }),
                ...riders,
            ],
        },
    ],
});

/**
 * Zero defence, zero pen, no charged skill: every active round is one cast of the active skill
 * and the damage reduces to attack * (100*hits/100) * critMultiplier.
 * `hacking: 200` / `enemySecurity: 0` opens the debuff-landing gate for the rider tests
 * (landing = clamp(hacking - security, 0, 100) / 100 = 1).
 */
const BASE: DPSSimulationInput = {
    attack: 10000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 10_000_000,
    rounds: 4,
    selfBuffs: [],
    enemyDebuffs: [],
    hacking: 200,
    enemySecurity: 0,
    defence: 0,
    hp: 30000,
};

/** The focus attacker's own actor id — every cardinality assertion below counts ITS sub-attacks. */
const FOCUS = 'attacker';

/**
 * Collect the FOCUS ATTACKER's `ability-performed` events from one `simulateDPS` run.
 *
 * The `actorId === FOCUS` filter is load-bearing since SP-4b-2a: a scalar-only `simulateDPS` run
 * now fights a real, positioned enemy (`enemy-1`), and an enemy supplied without `shipSkills` gets
 * the engine's synthesized flat-card basic attack (engine.ts:618-638). With `hp: 30000` on the
 * attacker (BASE below) that enemy has a living target, so it casts once per round and emits one
 * extra `ability-performed { actorId: 'enemy-1', damage: 0 }` per round — zero damage, because the
 * synthesized enemy carries `attack: 0`. That event is the OTHER actor's cast and has nothing to
 * do with the focus's per-sub-attack fan-out this file pins, so it is filtered out rather than
 * counted: every expected length here (12 / 4 / 3 / 1) is the pre-SP-4b-2a number, unchanged.
 */
const runCollectingPerformed = (
    input: DPSSimulationInput
): { performed: AbilityPerformed[]; result: ReturnType<typeof simulateDPS> } => {
    const bus = createEventBus();
    const performed: AbilityPerformed[] = [];
    bus.on('ability-performed', (e) => {
        if (e.actorId !== FOCUS) return;
        performed.push(e);
    });
    const result = simulateDPS({ ...input, bus });
    return { performed, result };
};

describe('non-positional ability-performed — one event per sub-attack', () => {
    afterEach(() => resetRateGateRng());

    it('a hits:3 DPS cast emits THREE ability-performed events per round; hits:1 emits ONE', () => {
        idc = 0;
        const three = runCollectingPerformed({ ...BASE, shipSkills: multiHit(3) });
        // 4 rounds x 3 sub-attacks.
        expect(three.performed).toHaveLength(12);

        idc = 0;
        const one = runCollectingPerformed({ ...BASE, shipSkills: multiHit(1) });
        // N=1 control: unchanged, one event per round.
        expect(one.performed).toHaveLength(4);
    });

    it('each event carries its own subAttackIndex and per-sub-attack crit identity', () => {
        idc = 0;
        const { performed } = runCollectingPerformed({ ...BASE, shipSkills: multiHit(3) });
        // First round's three events, in order.
        const r1 = performed.filter((e) => e.round === 1);
        expect(r1).toHaveLength(3);
        expect(r1.map((e) => e.subAttackIndex)).toEqual([0, 1, 2]);
        // crit 100 -> every sub-attack crits, and `critHits` is THIS sub-attack's critting
        // victim count (1 for the single bound enemy), NOT the cast-wide 3.
        for (const e of r1) {
            expect(e.didCrit).toBe(true);
            expect(e.critHits).toBe(1);
        }
    });

    it('a 0% crit hits:3 cast emits three non-critting events with no critHits', () => {
        idc = 0;
        const { performed } = runCollectingPerformed({
            ...BASE,
            crit: 0,
            shipSkills: multiHit(3),
        });
        const r1 = performed.filter((e) => e.round === 1);
        expect(r1).toHaveLength(3);
        for (const e of r1) {
            expect(e.didCrit).toBe(false);
            expect(e.critHits).toBeUndefined();
        }
    });

    /**
     * THE EQUIVALENCE GATE (epic spec PR5 section 6). victimDamage.ts:16-30 proves
     *   sum_h [1 + (hitCrits[h]?1:0) * cd/100] = hits * damageCritMultiplier
     * i.e. splitting the cast N ways and critting each hit is algebraically identical to the
     * blended fold. That identity is a comment in production; here it is an assertion.
     *
     * Closed form for this fixture (0 defence, 0 pen, no buffs):
     *   effectiveMultiplier = 100 * hits
     *   preCritDamage       = attack * effectiveMultiplier / 100 = 10000 * hits
     *   directDamage        = preCritDamage * (1 + critFraction * critDamage/100)
     * At crit 100 / critDamage 100, hits 3: 30000 * 2.0 = 60000.
     * At crit   0,              hits 3: 30000 * 1.0 = 30000.
     * These are the SAME numbers perHitCrit.test.ts has pinned since the per-hit-crit increment.
     *
     * ANTI-VACUITY: the event count is asserted first. Without it a still-folded path would
     * satisfy every sum below trivially, and the test would pass while observing nothing.
     */
    it('looped damage equals folded damage exactly (no-proc hits:3)', () => {
        idc = 0;
        const crit100 = runCollectingPerformed({ ...BASE, shipSkills: multiHit(3) });
        const r1 = crit100.performed.filter((e) => e.round === 1);
        // Anti-vacuity: we are measuring the LOOPED path, not the fold.
        expect(r1).toHaveLength(3);
        // Each event carries an equal share...
        for (const e of r1) expect(e.damage).toBeCloseTo(20000, 6);
        // ...and the cast total is the number the single folded event carried.
        expect(r1.reduce((s, e) => s + (e.damage ?? 0), 0)).toBeCloseTo(60000, 6);
        // The round total the DPS calculator reports is unmoved.
        expect(crit100.result.rounds[0].totalRoundDamage).toBe(60000);

        idc = 0;
        const crit0 = runCollectingPerformed({ ...BASE, crit: 0, shipSkills: multiHit(3) });
        const z1 = crit0.performed.filter((e) => e.round === 1);
        expect(z1).toHaveLength(3);
        for (const e of z1) expect(e.damage).toBeCloseTo(10000, 6);
        expect(crit0.result.rounds[0].totalRoundDamage).toBe(30000);
    });

    /**
     * The N=1 damage control. Single-hit casts must be byte-identical, which for the damage
     * payload means `directDamage / 1 === directDamage`.
     */
    it('hits:1 damage payload is unchanged (divisor 1)', () => {
        idc = 0;
        const { performed, result } = runCollectingPerformed({ ...BASE, shipSkills: multiHit(1) });
        const r1 = performed.filter((e) => e.round === 1);
        expect(r1).toHaveLength(1);
        expect(r1[0].damage).toBeCloseTo(20000, 6); // 10000 * 1.0 * 2.0
        expect(result.rounds[0].totalRoundDamage).toBe(20000);
    });

    /**
     * D2: the `hits: 0` clamp (`playerTurn.ts`'s `emitHits = hits > 0 ? hits : 1`), added
     * alongside PR5's per-sub-attack loop, has no fixture anywhere else in the corpus. Without
     * this test a future refactor back to a bare `h < hits` loop would silently drop every event
     * for a hits:0 skill — and the whole suite would stay green, because nothing else ever
     * constructs one.
     *
     * CORRECTION (verified against source before writing the assertion): `hits: 0` also zeroes
     * the ability's OWN `effectiveMultiplier` (`rawMultiplier * hits`, playerTurn.ts:2212), so the
     * true damage for this degenerate config is 0 — not the hits:1 undivided value. The clamp's
     * job is CARDINALITY (still emit exactly one event) and avoiding a `0 / 0` NaN in the damage
     * divisor (`directDamage / emitHits`), not preserving a nonzero amount.
     */
    it('hits:0 is clamped to ONE event per round with damage 0 (not a silent drop, not NaN)', () => {
        idc = 0;
        const { performed, result } = runCollectingPerformed({ ...BASE, shipSkills: multiHit(0) });
        const r1 = performed.filter((e) => e.round === 1);
        // Without the clamp, `h < hits` with hits:0 never executes the loop body -> ZERO events.
        expect(r1).toHaveLength(1);
        // 0 hits -> 0 effective multiplier -> 0 damage; and NOT NaN (0 / 0), which a clamp that
        // fixed only the loop bound but not the divisor would produce.
        expect(r1[0].damage).toBe(0);
        expect(Number.isNaN(r1[0].damage)).toBe(false);
        expect(result.rounds[0].totalRoundDamage).toBe(0);
    });
});

/**
 * Outgoing reactive riders on the non-positional path, measured against PR5's cardinality.
 *
 * Each rider is a hand-built stand-in for the equipment ability of the same shape (the corpus
 * versions are gear/implant-sourced and drag their own proc rolls in).
 *
 * TRAP (cost real time in PR4): `procChance` is deliberately OMITTED. `passesProcChanceGate`
 * early-returns when it is `undefined`, so the effect fires unconditionally — which is what you
 * want when measuring COUNTS rather than gates. Including it adds a second RNG dependency and is
 * exactly what made a PR4 test vacuous.
 */
describe('non-positional outgoing riders — per-sub-attack fan-out', () => {
    afterEach(() => resetRateGateRng());

    /** Same attack/crit shape as BASE, reformatted for `simulateHealing`'s `HealerStats` input
     *  (the on-crit test needs `ctx.healing` populated — see that test's CORRECTION comment). */
    const HEALER: HealerStats = {
        hp: 30000,
        attack: 10000,
        defence: 0,
        crit: 100,
        critDamage: 100,
        defensePenetration: 0,
        healModifier: 0,
        hacking: 200,
        speed: 100,
    };

    /** Burner: "applies Inferno" off the wearer's own damage. */
    const burnerLike = (): Ability =>
        ab({
            type: 'dot',
            target: 'enemy',
            trigger: 'on-deal-damage',
            config: { type: 'dot', dotType: 'inferno', tier: 15, stacks: 1, duration: 2 },
        });

    /** Bloodthirst: "repair itself for 20% of the damage dealt" on a crit. No procChance so
     *  every enqueue lands — the fixture measures fan-out and amount, not the proc roll. */
    const bloodthirstLike = (): Ability =>
        ab({
            type: 'heal',
            target: 'self',
            trigger: 'on-crit',
            config: { type: 'heal', pct: 20, basis: 'damage-dealt' },
        });

    it('on-deal-damage fires once per SUB-ATTACK: a hits:3 Burner lands three Infernos', () => {
        idc = 0;
        setRateGateRng(() => 0);
        setKeyedRng(() => 0);

        const run = (hits: number): number => {
            const bus = createEventBus();
            let applied = 0;
            bus.on('dot-applied', (e) => {
                if (e.dotType === 'inferno') applied += 1;
            });
            simulateDPS({ ...BASE, rounds: 1, shipSkills: multiHit(hits, [burnerLike()]), bus });
            return applied;
        };

        // THE headline fix: pre-PR5 the whole cast collapsed into ONE ability-performed, so the
        // rider fired once however many hits landed. Verified in-game 2026-08-08: Burner on
        // Enforcer's 3-hit active applies THREE Inferno stacks.
        expect(run(3)).toBe(3);
        // N=1 control: the single-hit path is untouched.
        expect(run(1)).toBe(1);
    });

    /**
     * CORRECTION (Step 2 verification): the brief's snippet drove this rider through
     * `simulateDPS`. That never populates `ctx.healing` (guarded by `if (!ctx.healing) return;`
     * at triggers.ts — see the heal/shield executor branch), so the reactive heal never actually
     * DRAINS on a pure DPS run: it enqueues but the executor bails before crediting anything or
     * emitting `reactive-heal-performed`. Running the brief's snippet verbatim asserts
     * `heals` has length 3 and gets 0 — not a pass, and not this task's bug either; it is a
     * fixture gap in the plan. `simulateHealing` (healingEngineAdapter.ts) is the OTHER caller of
     * the same non-positional `runPlayerTurn` inline emit and always sets `healTargetId` (hence
     * `ctx.healing`, per its own comment: "healing is always present"), so it is the one entry
     * point that can actually observe the reactive heal execute. The opponent's defence/HP are fixed
     * by the adapter — since SP-4b-2b this `enemies: []` fights the synthesized PRACTICE TARGET
     * (defence 5,000 / hp 40,000) rather than the old dummy sink (10,000 / 1,000,000), which moved
     * the absolute damage numbers. Irrelevant here: all three sub-attacks are identical and every
     * assertion compares against the fixture's OWN `slice`/`castTotal`, never a hand-computed
     * number — which is why this test survived that basis change untouched.
     */
    it('on-crit repairs off THIS sub-attack’s damage, not the whole cast', () => {
        idc = 0;
        setRateGateRng(() => 0);
        setKeyedRng(() => 0);

        const bus = createEventBus();
        const performed: AbilityPerformed[] = [];
        const heals: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
        // FOCUS filter, for exactly the reason `runCollectingPerformed` above documents — this call
        // site just reached it later. Since SP-4b-2b an EMPTY `enemies` array is no longer an empty
        // board: `simulateHealing` synthesizes an inert PRACTICE TARGET, which is a real positioned
        // actor and so takes its own turn, emitting one extra
        // `ability-performed { actorId: 'practice-target', damage: 0 }` per round (probed exactly
        // that). The `3` below is the pre-SP-4b-2b number and is UNCHANGED — the focus's three
        // sub-attacks are byte-identical (8331.187302073396 each). Counting the other actor's cast
        // instead would turn a cardinality assertion about the fan-out into an assertion about how
        // many actors happen to be on the board.
        bus.on('ability-performed', (e) => {
            if (e.actorId !== FOCUS) return;
            performed.push(e);
        });
        // TRAP: a reactive heal emits `reactive-heal-performed`, NOT `heal-performed`, and keys
        // the caster as `casterId`, not `actorId` (events.ts). Subscribing to the wrong event
        // asserts against an empty array — and passes.
        bus.on('reactive-heal-performed', (e) => heals.push(e));
        simulateHealing({
            healer: HEALER,
            chargeCount: 0,
            shipSkills: multiHit(3, [bloodthirstLike()]),
            selfBuffs: [],
            healTargetId: 'healer',
            enemies: [],
            rounds: 1,
            bus,
        });

        // Three critting sub-attacks -> three events -> three enqueues.
        expect(performed).toHaveLength(3);
        expect(heals).toHaveLength(3);

        const slice = performed[0].damage!;
        expect(slice).toBeGreaterThan(0);
        const castTotal = performed.reduce((s, e) => s + (e.damage ?? 0), 0);
        // EQUAL-SPLIT invariant, NOT an anti-vacuity guard (it was mislabelled as one): given the
        // three events asserted above, `castTotal === 3 * slice` follows from the loop dividing
        // `directDamage` equally, so it can only catch an UNEQUAL split — not a reverted fold.
        // What actually discriminates the fold is the `toHaveLength(3)` pair above (both
        // mutation-confirmed: reverting the loop to a single emit fails them).
        expect(castTotal).toBeCloseTo(3 * slice, 6);
        // THE REAL ANTI-VACUITY GUARD: the two candidate repair bases must be distinguishable in
        // this fixture, or `0.2 * slice` and `0.2 * castTotal` would be the same number and the
        // per-sub-attack assertion below would pass for a cast-total repair too.
        expect(castTotal).toBeGreaterThan(slice);
        // Each fire repairs 20% of ITS OWN sub-attack, so the cast repairs 20% of the CAST —
        // not 60%, which is what the pre-PR5 fold produced (three fires off the full total).
        for (const h of heals) expect(h.amount).toBeCloseTo(0.2 * slice, 6);
        expect(heals.reduce((s, h) => s + h.amount, 0)).toBeCloseTo(0.2 * castTotal, 6);
    });
});

/**
 * The PROC GATE on the non-positional path — the one real BEHAVIOUR change PR5 makes beyond
 * event cardinality, and the one nothing else pins.
 *
 * Stamping `subAttackIndex: h` on the inline emit moves `passesProcChanceGate`'s memo key from
 * `${owner}:${ability}:x` to `…:0..N-1`. A `procScope:'per-attack'` outgoing rider that used to
 * get ONE verdict per TURN on the DPS/healing path therefore now draws one per SUB-ATTACK (and
 * the same re-keying applies to the reactive-damage `firedKey` dedupe in triggers.ts). That is
 * the correct reading of the locked rules — a multi-hit skill is N consecutive full-walk attacks
 * and each draws its own roll — but `subAttackProcGates.integration.test.ts` drives this
 * entirely through the POSITIONAL engine path, so before this block nothing covered the inline
 * emit.
 *
 * WHY `procChance` IS PRESENT HERE, against the describe block above's TRAP note: there the gate
 * is an incidental dependency and is omitted so riders fire unconditionally while COUNTS are
 * measured. Here the gate IS the subject, so it has to be armed — and the draw stream is pinned
 * exactly (`setKeyedRng` keyed on the owner's `proc` sub-stream) rather than left to chance. The
 * engine is NOT deterministic (`rateAccumulator.ts` uses `Math.random`), so both RNG seams are
 * installed and reset in `afterEach`.
 */
describe('non-positional proc gates — one verdict per SUB-ATTACK, not per turn', () => {
    afterEach(() => resetRateGateRng());

    /** Insidiousness's shape: a `procScope:'per-attack'` reactive damage rider on on-crit. */
    const procScopedRider = (procChance: number): Ability =>
        ab({
            type: 'damage',
            target: 'enemy',
            trigger: 'on-crit',
            procScope: 'per-attack',
            procChance,
            config: { type: 'damage', multiplier: 40 },
        });

    /** Runs one cast under a scripted draw sequence on the owner's `proc` sub-stream.
     *  Returns how many draws that stream took and how many times the rider actually fired. */
    const runRider = (
        hits: number,
        draw: (n: number) => number
    ): { draws: number; fires: number } => {
        idc = 0;
        let draws = 0;
        setRateGateRng(() => 0);
        // Keyed per stream: only `attacker:proc` (the gate's own key, `makeRateGate(
        // `${ownerId}:proc`)`) is scripted; every other keyed gate in the run gets a plain 0 so
        // crit/landing gates stay wide open and cannot perturb the count.
        setKeyedRng((key) => (key.startsWith('attacker:proc') ? draw(draws++) : 0));
        const bus = createEventBus();
        let fires = 0;
        bus.on('reactive-damage-performed', () => {
            fires++;
        });
        simulateDPS({
            ...BASE,
            rounds: 1,
            shipSkills: multiHit(hits, [procScopedRider(0.5)]),
            bus,
        });
        return { draws, fires };
    };

    it('a hits:3 cast draws THREE verdicts and honours each one (FAIL, FIRE, FIRE)', () => {
        const { draws, fires } = runRider(3, (n) => (n === 0 ? 1 : 0));
        // Three independent draws — one per sub-attack. With the index omitted from the emit all
        // three collapse onto the `…:x` memo key and only ONE draw is ever taken.
        expect(draws).toBe(3);
        // ...and each sub-attack honours its OWN verdict. A replayed memo would give 0 here
        // (sub-attack #1's FAIL reused for #2 and #3); a count of 3 would mean the memo stopped
        // memoizing at all and the rider went per-victim.
        expect(fires).toBe(2);
    });

    it('the mirror sequence (FIRE, FAIL, FAIL) fires exactly once', () => {
        // Discriminates a gate that simply ignores the verdict and always fires: same fixture,
        // same three draws, inverted script, one fire instead of two.
        const { draws, fires } = runRider(3, (n) => (n === 0 ? 0 : 1));
        expect(draws).toBe(3);
        expect(fires).toBe(1);
    });

    it('N=1 control: a single-attack cast still draws exactly one verdict', () => {
        // The byte-identical guarantee at hits === 1. The memo key moves from `…:x` to `…:0`,
        // which is a pure rename (both maps are cleared at every actor turn-start and both keys
        // are already owner-scoped), so the observable behaviour is unchanged: one draw, honoured.
        expect(runRider(1, () => 0)).toEqual({ draws: 1, fires: 1 });
        expect(runRider(1, () => 1)).toEqual({ draws: 1, fires: 0 });
    });
});
