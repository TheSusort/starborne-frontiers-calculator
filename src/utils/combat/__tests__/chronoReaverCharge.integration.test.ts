/**
 * Integration: Chrono Reaver periodic self-charge (Charge Phase 2/3 Task 2).
 *
 * Chrono Reaver is an IMPLANT that emits a reactive `{ type:'charge', target:'self',
 * trigger:'end-of-turn' }` ability gated by an `every-n-turns` condition (LEGENDARY → period 2,
 * EPIC → period 3, offset 0). The ability under test is RESOLVED FROM THE REAL IMPLANT PATH
 * (`buildEquipmentAbilities(ship, getGearPiece)` against a Ship carrying a `setBonus:'CHRONO_REAVER'`
 * gear piece) — exactly what `simulateBattle(placements, getGearPiece)` feeds the engine via
 * `buildShipAbilitiesWithEquipment`. We then run the resolved ability through `runCombat` (the
 * battle-sim engine) with a two-side roster (a charged player focus vs. a dummy/sink enemy) and
 * read the focus's per-round charge counts from `result.rounds[].charges` (RoundData — the focus's
 * END-OF-ROUND live charge counter) and `result.rounds[].action` ('active' | 'charged').
 *
 * Why runCombat (not simulateBattle directly): `simulateBattle`'s `BattleResult`/`ShipRoundState`
 * surfaces damage/healing/HP/buffs but NOT charge counts, so it cannot pin the exact per-round
 * charge ledger this task requires. `runCombat` exposes the focus's `rounds[].charges` directly
 * (the Phase-1 charge goldens use the same entry point). We still exercise the genuine implant→
 * ability resolution by building the ability via `buildEquipmentAbilities` from a real GearPiece +
 * Ship, so the ability shape under test is the implant's actual output, not a hand-written copy.
 *
 * ─── CRITICAL TIMING (baked into every ledger below) ──────────────────────────────────────────
 * There is NO pre-action drain between the focus's `turn-started` and its action body. The focus's
 * own per-action drain (engine.ts ~4639) runs BEFORE its `turn-ended` emit (~4667), which is where
 * the `end-of-turn` Chrono Reaver intent is ENQUEUED. So the CR intent does NOT drain within the
 * focus's own post-action drain — it banks at the NEXT drain pass (the dummy enemy's post-action
 * drain ~4639, or the round-end drain ~4795). BOTH of those passes still fall WITHIN THE SAME ROUND,
 * and `rounds[].charges` is captured at row assembly AFTER the round-end drain — so the CR proc that
 * fires on the focus's turn IS reflected in that SAME round's reported `charges`. Charges carry
 * forward across rounds (like start-of-round self-buffs), so accrual is correct.
 *
 * The CR gate evaluates `actor.turnsTaken % period === 0` at DRAIN time. `turnsTaken` is bumped at
 * the focus's turn-start (engine.ts ~3742) and the focus takes exactly ONE turn per round, so on
 * round r the focus's `turnsTaken === r`. Hence the proc banks +1 whenever `r % period === 0`.
 *
 * Per-turn cast-path cadence (runPlayerTurn): on a turn where `charges >= chargeCount` the focus
 * fires its CHARGED skill and `advanceChargeCadence` RESETS charges to 0; otherwise it fires ACTIVE
 * and `advanceChargeCadence` adds the +1/turn BASELINE. The CR proc (when it fires that round) adds
 * a further +1, all capped at `chargeCount`.
 */

import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { simulateChronoReaver } from '../../calculators/chronoReaver';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

// ─── Real implant resolution ──────────────────────────────────────────────────────
// Resolve the Chrono Reaver ability from the SAME path simulateBattle uses: a Ship with a
// CHRONO_REAVER implant gear piece, through buildEquipmentAbilities. This is the genuine
// implant→ability output (Task 1), not a hand-rolled duplicate.

function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'cr-ship',
        name: 'Chrono Reaver Carrier',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    } as Ship;
}

function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    } as GearPiece;
}

/** Build the Chrono Reaver ability for a rarity via the real implant resolution path. */
function resolveChronoReaver(rarity: 'epic' | 'legendary'): Ability {
    const piece = makePiece({ id: 'cr-implant', rarity, setBonus: 'CHRONO_REAVER' });
    const ship = makeShip({ implants: { implant_major: 'cr-implant' } });
    const abilities = buildEquipmentAbilities(ship, (id) =>
        id === 'cr-implant' ? piece : undefined
    );
    if (abilities.length !== 1) {
        throw new Error(
            `expected exactly 1 resolved Chrono Reaver ability, got ${abilities.length}`
        );
    }
    return abilities[0];
}

// ─── Ability + enemy fixtures ───────────────────────────────────────────────────────

const damage = (multiplier: number, id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** A cast-path self-charge gain: fires on-cast (active turn) so it MUST ride the active slot via
 *  `activeExtra`. Models a native +amount/active-turn source layered ON TOP of the +1/turn baseline. */
const castPathSelfChargeGain = (amount: number, id: string): Ability => ({
    id,
    type: 'charge',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'charge', amount },
});

/** A passive, charge-less dummy/sink enemy: slow (speed 40, acts AFTER the focus), tiny attack,
 *  no charged slot → it just basic-attacks each turn. It carries no every-n-turns ability, so its
 *  own turnsTaken bump is inert. Present only so the run is a real two-side battle (the focus's CR
 *  end-of-turn intent banks at a later drain within the round, per the timing note above). */
const dummySink = (): EnemyAttacker => ({
    id: 'e-sink',
    stats: { attack: 1, crit: 0, critDamage: 0, speed: 40 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [{ slot: 'active', abilities: [damage(1, 'es-a')] }],
    } as ShipSkills,
});

// ─── Player / engine input ────────────────────────────────────────────────────────

/** A charged player focus (id 'attacker', speed 100 → acts BEFORE the sink). active 50% / charged
 *  400% so a charged cast is plainly distinguishable from an active one. Huge HP pools so nothing
 *  dies and every round is observable. The under-test charge ability(ies) ride the passive slot. */
const buildInput = (opts: {
    chargeCount: number;
    numRounds: number;
    startCharged?: boolean;
    passiveAbilities?: Ability[];
    activeExtra?: Ability[];
}): CombatEngineInput => {
    const slots: ShipSkills['slots'] = [
        { slot: 'active', abilities: [damage(50, 'p-a'), ...(opts.activeExtra ?? [])] },
        { slot: 'charged', abilities: [damage(400, 'p-c')] },
    ];
    if (opts.passiveAbilities && opts.passiveAbilities.length) {
        slots.push({ slot: 'passive', abilities: opts.passiveAbilities });
    }
    return {
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: opts.chargeCount,
        shipSkills: { slots },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: opts.numRounds,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: true,
        startCharged: opts.startCharged ?? false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 100,
        healTargetId: 'attacker',
        mode: 'healing',
        enemyAttackers: [dummySink()],
    };
};

/** Convenience: the per-round (action-initial, charges) ledger for the focus. */
const ledger = (r: ReturnType<typeof runCombat>): Array<[string, number]> =>
    r.rounds.map((x) => [x.action, x.charges]);

// ─── 1. Legendary cadence (period 2) ────────────────────────────────────────────────

describe('Chrono Reaver — legendary cadence (every 2nd own turn)', () => {
    it('procs on turnsTaken % 2 === 0 (rounds 2,4,6); pins the exact per-round charge ledger', () => {
        // chargeCount 8 so the bar fills slowly and the cadence is visible across 8 rounds.
        // Baseline = +1 each ACTIVE turn (advanceChargeCadence); CR adds a further +1 when r%2===0.
        //
        // Per-round ledger (focus turnsTaken === round; CR banks within the SAME round per the
        // timing note — the end-of-turn intent drains at the sink's post-action drain / round-end):
        //   R1 (t1): active, adv 0→1, CR? 1%2≠0 no            → charges 1
        //   R2 (t2): active, adv 1→2, CR? 2%2=0 +1            → charges 3
        //   R3 (t3): active, adv 3→4, CR? no                  → charges 4
        //   R4 (t4): active, adv 4→5, CR? +1                  → charges 6
        //   R5 (t5): active, adv 6→7, CR? no                  → charges 7
        //   R6 (t6): active, adv 7→8 (=cap), CR? +1 capped    → charges 8  (proc wasted by cap)
        //   R7 (t7): charges 8≥8 → CHARGED, reset 0, CR? no   → charges 0
        //   R8 (t8): active, adv 0→1, CR? +1                  → charges 2
        const cr = resolveChronoReaver('legendary');
        const result = runCombat(
            buildInput({ chargeCount: 8, numRounds: 8, passiveAbilities: [cr] })
        );

        expect(ledger(result)).toEqual([
            ['active', 1],
            ['active', 3],
            ['active', 4],
            ['active', 6],
            ['active', 7],
            ['active', 8],
            ['charged', 0],
            ['active', 2],
        ]);

        // No-implant baseline: pure +1/turn cadence — charged fires one round LATER (R8 vs R7).
        // The CR proc count by R6 (3 procs: R2,R4,R6) advances the bar 3 ahead of baseline, pulling
        // the first charged cast from round 9 (baseline would reach 8 at R8 → charged R9) to round 7.
        const baseline = runCombat(buildInput({ chargeCount: 8, numRounds: 8 }));
        expect(ledger(baseline)).toEqual([
            ['active', 1],
            ['active', 2],
            ['active', 3],
            ['active', 4],
            ['active', 5],
            ['active', 6],
            ['active', 7],
            ['active', 8],
        ]);

        // Direct cadence-advantage signal: the CR focus has fired its charged skill by R8; the
        // no-implant baseline has NOT yet (it only reaches a full bar at R8 → charged on R9).
        const crChargedRounds = result.rounds
            .filter((x) => x.action === 'charged')
            .map((x) => x.round);
        const baseChargedRounds = baseline.rounds
            .filter((x) => x.action === 'charged')
            .map((x) => x.round);
        expect(crChargedRounds).toEqual([7]);
        expect(baseChargedRounds).toEqual([]); // baseline never reaches the cap within 8 rounds
    });
});

// ─── 2. Epic cadence (period 3) ──────────────────────────────────────────────────────

describe('Chrono Reaver — epic cadence (every 3rd own turn)', () => {
    it('procs on turnsTaken % 3 === 0 (rounds 3,6); pins the exact per-round charge ledger', () => {
        // chargeCount 8, baseline +1/active turn, CR +1 when r%3===0.
        //   R1 (t1): active, adv 0→1, CR? 1%3≠0 no   → 1
        //   R2 (t2): active, adv 1→2, CR? no         → 2
        //   R3 (t3): active, adv 2→3, CR? 3%3=0 +1   → 4
        //   R4 (t4): active, adv 4→5, CR? no         → 5
        //   R5 (t5): active, adv 5→6, CR? no         → 6
        //   R6 (t6): active, adv 6→7, CR? 6%3=0 +1   → 8
        //   R7 (t7): charges 8≥8 → CHARGED, reset 0  → 0
        //   R8 (t8): active, adv 0→1, CR? no         → 1
        const cr = resolveChronoReaver('epic');
        const result = runCombat(
            buildInput({ chargeCount: 8, numRounds: 8, passiveAbilities: [cr] })
        );

        expect(ledger(result)).toEqual([
            ['active', 1],
            ['active', 2],
            ['active', 4],
            ['active', 5],
            ['active', 6],
            ['active', 8],
            ['charged', 0],
            ['active', 1],
        ]);

        // Epic procs less often than legendary (2 procs by R6 vs 3) → its first charged cast is
        // still pulled forward of the no-implant baseline (R7 vs R9), but one round LATER than the
        // legendary fixture would be at the same chargeCount — the only difference is the period.
        const chargedRounds = result.rounds
            .filter((x) => x.action === 'charged')
            .map((x) => x.round);
        expect(chargedRounds).toEqual([7]);
    });
});

// ─── 3. Wasted proc at full charge ───────────────────────────────────────────────────

describe('Chrono Reaver — wasted proc at full charge', () => {
    it('a proc on an already-full bar is dropped by the cap (no extra cast, no negative effect)', () => {
        // chargeCount 2, period 2 (legendary). The cap exposes a wasted proc cleanly:
        //   R1 (t1): active, adv 0→1, CR? 1%2≠0 no              → 1
        //   R2 (t2): active 1<2, adv 1→2 (=cap), CR? 2%2=0 +1   → 2  ← capped: PROC WASTED
        //   R3 (t3): charges 2≥2 → CHARGED, reset 0, CR? no     → 0
        //   R4 (t4): active, adv 0→1, CR? 4%2=0 +1              → 2  ← proc on a NON-full bar lands
        const cr = resolveChronoReaver('legendary');
        const result = runCombat(
            buildInput({ chargeCount: 2, numRounds: 4, passiveAbilities: [cr] })
        );

        expect(ledger(result)).toEqual([
            ['active', 1],
            ['active', 2], // R2 proc fires on a full (2/2) bar → dropped by the min(.., chargeCount) cap
            ['charged', 0],
            ['active', 2],
        ]);

        // Proof the R2 proc was a NO-OP: the no-implant baseline reaches the SAME R2 value (2) and
        // fires its charged skill on the SAME round (R3). The wasted proc neither advanced the bar
        // past the cap (no negative / no overflow) nor pulled the charged cast earlier than baseline.
        const baseline = runCombat(buildInput({ chargeCount: 2, numRounds: 4 }));
        expect(ledger(baseline)).toEqual([
            ['active', 1],
            ['active', 2], // identical to CR at R2 → R2 proc had zero net effect
            ['charged', 0], // both fire charged on R3 → CR caused no extra/earlier cast
            ['active', 1], // baseline R4 = 1 (no proc); CR R4 = 2 → the R4 proc (non-full bar) DID land
        ]);

        // The two runs DIVERGE only at R4 (CR 2 vs baseline 1): the R4 proc lands because the bar is
        // not full there, confirming the implant otherwise works — it is ONLY the full-bar R2 proc
        // that is wasted. Charges never go negative or exceed the cap in either run.
        expect(result.rounds[1].charges).toBe(baseline.rounds[1].charges); // R2: wasted proc → equal
        expect(result.rounds[3].charges).toBeGreaterThan(baseline.rounds[3].charges); // R4: effective
        for (const row of result.rounds) {
            expect(row.charges).toBeGreaterThanOrEqual(0); // never negative
            expect(row.charges).toBeLessThanOrEqual(2); // never exceeds the cap
        }
    });
});

// ─── 4. Stacking with the ship's own parsed self-charge source ────────────────────────

describe('Chrono Reaver — stacking with a parsed self-charge source', () => {
    it('layers additively atop baseline + own-source (Phase-0 guard prevents baseline double-count)', () => {
        // The focus ALSO carries a native +1/active-turn self-charge gain (cast path) PLUS Chrono
        // Reaver (legendary, period 2). Per ACTIVE turn the bar advances by:
        //   baseline +1 (advanceChargeCadence) + own-source +1 = +2, and a further +1 on CR procs.
        // The Phase-0 baseline-double-count guard ensures the +1/turn baseline is applied ONCE
        // (advanceChargeCadence), so own-source adds +1 (not +2) on top of it.
        //
        // chargeCount 8, period 2:
        //   R1 (t1): active, adv 0→1, own +1 →2, CR? 1%2≠0 no    → 2
        //   R2 (t2): active 2<8, adv 2→3, own +1 →4, CR? +1      → 5
        //   R3 (t3): active 5<8, adv 5→6, own +1 →7, CR? no      → 7
        //   R4 (t4): active 7<8, adv 7→8, own +1 →8(cap), CR? +1 capped → 8
        //   R5 (t5): charges 8≥8 → CHARGED, reset 0, CR? no      → 0
        //   R6 (t6): active, adv 0→1, own +1 →2, CR? +1          → 3
        //   R7 (t7): active 3<8, adv 3→4, own +1 →5, CR? no      → 5
        //   R8 (t8): active 5<8, adv 5→6, own +1 →7, CR? +1      → 8
        const cr = resolveChronoReaver('legendary');
        const own = castPathSelfChargeGain(1, 'p-own-charge');
        const stacked = runCombat(
            // activeExtra: cast-path charge must ride the active slot so it fires on each active turn.
            buildInput({ chargeCount: 8, numRounds: 8, passiveAbilities: [cr], activeExtra: [own] })
        );

        expect(ledger(stacked)).toEqual([
            ['active', 2],
            ['active', 5],
            ['active', 7],
            ['active', 8],
            ['charged', 0],
            ['active', 3],
            ['active', 5],
            ['active', 8],
        ]);

        // ADDITIVITY PROOF: a control with the SAME own-source but NO Chrono Reaver advances by
        // baseline+own = +2/active turn (NO double-counted baseline → 2,4,6,8 not 3,6,...). On each
        // CR proc round (R2,R4,R6,R8) the stacked run is exactly +1 ahead of this control, until the
        // cap clamps both — i.e. CR layers additively on top of baseline+own.
        // activeExtra: same cast-path placement, no CR — isolates the baseline+own contribution.
        const ownOnly = runCombat(buildInput({ chargeCount: 8, numRounds: 8, activeExtra: [own] }));
        expect(ledger(ownOnly)).toEqual([
            ['active', 2], // +2/turn: baseline+own (NOT +3 — baseline counted once)
            ['active', 4],
            ['active', 6],
            ['active', 8],
            ['charged', 0], // bar full at R4 → charged on R5 (same as stacked)
            ['active', 2],
            ['active', 4],
            ['active', 6],
        ]);

        // Per-proc-round additive layering (stacked = ownOnly + 1 on proc rounds, until cap):
        //   R2: ownOnly 4 + CR 1 = 5 ✓   R6: ownOnly 2 + CR 1 = 3 ✓   R8: ownOnly 6 + CR 1 = ... 8 (capped)
        expect(stacked.rounds[1].charges).toBe(ownOnly.rounds[1].charges + 1); // R2 proc: +1
        expect(stacked.rounds[5].charges).toBe(ownOnly.rounds[5].charges + 1); // R6 proc: +1
        // R8 proc: ownOnly 6 + 1 = 7 would be the uncapped value, but the stacked run's earlier
        // procs put it at 8 (the cap) — additive then clamped. Assert it is the cap and ≥ ownOnly+1.
        expect(stacked.rounds[7].charges).toBe(8);
        expect(stacked.rounds[7].charges).toBeGreaterThanOrEqual(ownOnly.rounds[7].charges + 1);

        // Non-proc rounds: stacked equals ownOnly + (accumulated CR lead carried forward). The
        // baseline-double-count guard is what keeps ownOnly at +2/turn (not +3) — if the baseline
        // were double-applied, ownOnly R1 would be 3, not 2.
        expect(ownOnly.rounds[0].charges).toBe(2); // guard: baseline applied exactly once
    });
});

// ─── 5. Parity vs the standalone single-ship chronoReaver calculator ───────────────────

describe('Chrono Reaver — parity vs standalone chronoReaver calc', () => {
    /**
     * The standalone `simulateChronoReaver` (src/utils/calculators/chronoReaver.ts) is a single-ship
     * loop with NO enemy/targeting/crit — it models exactly the +1/turn baseline + the CR proc
     * schedule. The engine models a full battle, so absolute damage is NOT comparable. What IS
     * comparable is the CHARGED-CAST CADENCE: both bank +1/active-turn and add +1 on the same proc
     * schedule (legendary → every 2nd, epic → every 3rd), so the set of rounds on which the bar is
     * full and a charged skill fires must be IDENTICAL.
     *
     * Alignment of the two clocks:
     *  - standalone: 1-based `round`, proc on `round % period === 0`.
     *  - engine: focus takes one turn per round; `turnsTaken` is bumped at turn-start so on round r
     *    `turnsTaken === r`, and the CR gate `turnsTaken % period === 0` fires on the same rounds.
     *  - standalone per-round order (cast-then-proc) matches the engine's per-turn order
     *    (advanceChargeCadence baseline / charged-reset, THEN the end-of-turn CR proc banked within
     *    the same round) — see the CRITICAL TIMING note at the top of this file.
     */

    /** Engine: 1-based rounds where the focus fired its CHARGED skill. */
    const engineChargedRounds = (r: ReturnType<typeof runCombat>): number[] =>
        r.rounds.filter((x) => x.action === 'charged').map((x) => x.round);

    /** Standalone: 1-based rounds where the loop chose the charged action. */
    const standaloneChargedRounds = (res: ReturnType<typeof simulateChronoReaver>): number[] =>
        res.rounds.filter((x) => x.action === 'charged').map((x) => x.round);

    const RARITIES: Array<'epic' | 'legendary'> = ['epic', 'legendary'];
    const CHARGES_REQUIRED = [2, 3, 4];
    const NUM_ROUNDS = 12; // long enough that every matrix cell reaches at least one charged cast.

    const matrix = RARITIES.flatMap((crRarity) =>
        CHARGES_REQUIRED.map((chargesRequired) => ({ crRarity, chargesRequired }))
    );

    it.each(matrix)(
        'charged-cast cadence matches standalone (rarity=$crRarity, chargesRequired=$chargesRequired)',
        ({ crRarity, chargesRequired }) => {
            const standalone = simulateChronoReaver({
                chargesRequired,
                crRarity,
                activeSkillPercent: 50,
                chargedSkillPercent: 400,
                rounds: NUM_ROUNDS,
            });
            const cr = resolveChronoReaver(crRarity);
            const engine = runCombat(
                buildInput({
                    chargeCount: chargesRequired,
                    numRounds: NUM_ROUNDS,
                    passiveAbilities: [cr],
                })
            );

            const expected = standaloneChargedRounds(standalone);
            const actual = engineChargedRounds(engine);

            // Sanity: the matrix is chosen so at least one charged cast occurs in each cell — if this
            // ever trips, the comparison would be vacuously true and must be revisited.
            expect(expected.length).toBeGreaterThan(0);
            expect(actual).toEqual(expected);
        }
    );
});

// ─── 6. Stasis suppression (Charge Phase 2/3 Task 4) ─────────────────────────────────
//
// Full-fidelity decision (LOCKED): a unit that is turn-blocked (Stasis OR Disable) on a
// periodic-proc turn banks NO periodic charge for that turn — matching the +1/turn baseline,
// which is itself gated behind `!isTurnBlocked` (advanceChargeCadence). This is ALREADY
// structural — NO new gating code is needed. The Chrono Reaver `end-of-turn` charge is a
// REACTIVE intent carrying `intent.ownerId`; on a blocked owner's turn the §4.4 reactive-intent
// drain filter (engine.ts ~3403: `if (isTurnBlocked(intent.ownerId)) continue;`) DROPS that
// intent before `executeIntent` ever applies the charge. Listeners only enqueue (pure), so a
// dropped intent leaves no partial state. Meanwhile `turnsTaken` stays MONOTONIC (bumped even on
// skipped turns, engine.ts ~3742), so the cadence does not spuriously re-fire on the frozen value
// — the periodic proc loses the skipped tick and resumes on the original residue (the next
// even own-turn for a legendary, period-2 unit).
describe('Chrono Reaver — stasis suppression (periodic proc dropped on turn-blocked turns)', () => {
    // A board-positioned, killable stasis bot: speed 300 → acts BEFORE the killer (200) and the
    // focus (100), so it lands Stasis(3) on the front player (the focus at M4) at the very head of
    // round 1. hp 1 → the killer destroys it the SAME round, so Stasis is applied EXACTLY ONCE and
    // is NOT re-applied (the focus recovers naturally once the duration expires). hacking 200 vs the
    // focus's default security → landing chance 1.0 (mirrors stasis.test.ts).
    const POS_FRONT: Position = 'M4';
    const parsedFront: ParsedTarget = { raw: 'front', side: 'enemy', selection: 'front' };
    const basePattern: ParsedPattern = { raw: 'base', shape: 'base', range: 0, modifiers: {} };

    /**
     * SP-4c-1: an inert SURVIVOR. `stasisBot` is killed in round 1 by design so Stasis is never
     * re-applied; since SP-4c-1 that kill WIPES the enemy side and ends the match at round 1,
     * which would cut this 8-round charge ledger to a single row. 0 attack + no skills make this
     * RNG-stream-inert, and speed 1 puts it last in every turn order.
     */
    const bystander = (): EnemyAttacker =>
        ({
            id: 'bystander',
            position: 'M1' as Position,
            target: parsedFront,
            pattern: basePattern,
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 1,
                security: 0,
                hacking: 0,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [] },
        }) as EnemyAttacker;

    const stasisBot = (turns: number): EnemyAttacker =>
        ({
            id: 'stasis-bot',
            position: POS_FRONT,
            target: parsedFront,
            pattern: basePattern,
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1, // killed by the killer in round 1 → Stasis applied once, never re-applied
                speed: 300, // acts before killer (200) and focus (100)
                security: 0,
                hacking: 200, // vs focus default security → Stasis lands (chance 1.0)
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            damage(1, 'sb-dmg'),
                            {
                                id: 'sb-stasis',
                                type: 'debuff',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: {
                                    type: 'debuff',
                                    buffName: 'Stasis',
                                    application: 'inflict',
                                    duration: turns,
                                    stacks: 1,
                                    isStackable: false,
                                    parsedEffects: {},
                                },
                            } as Ability,
                        ],
                    },
                ],
            } as ShipSkills,
        }) as EnemyAttacker;

    // A walked team ally that one-shots the stasis bot in round 1 (speed 200 → after the bot,
    // before the focus; attack 10000 >> bot hp 1). Mirrors the `killer` pattern in stasis.test.ts.
    const killer = (): TeamActor => ({
        id: 'killer',
        speed: 200,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M3',
        target: parsedFront,
        pattern: basePattern,
        walk: {
            shipSkills: { slots: [{ slot: 'active', abilities: [damage(100, 'k-dmg')] }] },
            stats: {
                attack: 10000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1_000_000_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    // The focus (legendary CR, period 2, chargeCount 8) positioned at M4 so the stasis bot's
    // `front` target resolves to it. Mirrors buildInput but adds board position + the
    // killer ally + the stasis bot (buildInput hardcodes a non-positional dummy sink, so this
    // block builds its own input around the same shared damage/CR/runCombat/ledger helpers).
    const buildStasisInput = (opts: {
        passiveAbilities: Ability[];
        enemyAttackers: EnemyAttacker[];
        teamActors?: TeamActor[];
    }): CombatEngineInput => ({
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 8,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [damage(50, 'p-a')] },
                { slot: 'charged', abilities: [damage(400, 'p-c')] },
                { slot: 'passive', abilities: opts.passiveAbilities },
            ],
        },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 8,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: true,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 100,
        healTargetId: 'attacker',
        mode: 'healing',
        position: POS_FRONT,
        target: parsedFront,
        pattern: basePattern,
        ...(opts.teamActors ? { teamActors: opts.teamActors } : {}),
        enemyAttackers: opts.enemyAttackers,
    });

    it('banks NO periodic charge on the turn-blocked proc turn; the next proc lands on the original residue', () => {
        // Legendary CR (period 2, chargeCount 8). A Stasis(3) lands on the focus at the head of
        // round 1 (the speed-300 bot acts first), so the focus is turn-blocked across rounds 1–3 —
        // spanning the round-2 proc turn (t2, 2 % 2 === 0). The bot is killed in round 1, so Stasis
        // is never re-applied and the focus recovers from round 4.
        //
        // Per-turn ledger (turnsTaken bumps UNCONDITIONALLY at turn-start, even on skipped turns →
        // turnsTaken === round; advanceChargeCadence's +1 baseline AND the CR proc are BOTH gated on
        // !isTurnBlocked / the §4.4 drain filter, so a blocked turn banks neither):
        //   R1 (t1): turnsTaken 0→1. Stasis(3) → turn-blocked → SKIP. No baseline. Not a proc turn.
        //            Post-Turn: Stasis 3→2.                                          → charges 0
        //   R2 (t2): turnsTaken 1→2. Stasis(2) → turn-blocked → SKIP. No baseline.
        //            PROC TURN (2%2=0): the end-of-turn CR intent is enqueued by the turn-ended bus
        //            event. Within the actor's OWN turn, drainIntents/drainEnemyIntents fire BEFORE
        //            turn-ended is emitted, so the queue was empty at that mid-turn drain and nothing
        //            was dropped then. The intent is instead dropped by a SUBSEQUENT drain pass (the
        //            next actor's post-action drain, or the round-end drain) — at that point Stasis has
        //            already decremented (3→2→1 here) but is still ≥1, so the owner remains
        //            turn-blocked and the §4.4 filter drops it.
        //            // ~engine.ts:3403
        //            Post-Turn: 2→1.
        //                                                                              → charges 0  ← proc SUPPRESSED
        //   R3 (t3): turnsTaken 2→3. Stasis(1) → turn-blocked → SKIP. Not a proc turn.
        //            Post-Turn: Stasis 1→0 → EXPIRED.                                  → charges 0
        //   R4 (t4): turnsTaken 3→4. NOT blocked → acts. baseline 0→1. PROC (4%2=0) +1 → charges 2
        //   R5 (t5): active, adv 2→3, no proc                                          → charges 3
        //   R6 (t6): active, adv 3→4, PROC +1                                          → charges 5
        //   R7 (t7): active, adv 5→6, no proc                                          → charges 6
        //   R8 (t8): active, adv 6→7, PROC +1                                          → charges 8
        const cr = resolveChronoReaver('legendary');
        let isStasisedTap: ((id: string) => boolean) | undefined;
        const stasised = runCombat({
            ...buildStasisInput({
                passiveAbilities: [cr],
                teamActors: [killer()],
                enemyAttackers: [stasisBot(3), bystander()],
            }),
            __testTapIsStasised: (fn) => {
                isStasisedTap = fn;
            },
        });

        expect(ledger(stasised)).toEqual([
            ['active', 0], // R1: turn-blocked skip
            ['active', 0], // R2: turn-blocked skip — PROC SUPPRESSED (intent dropped at drain)
            ['active', 0], // R3: turn-blocked skip
            ['active', 2], // R4: recovered — proc lands on the ORIGINAL even-turn residue (t4)
            ['active', 3],
            ['active', 5], // R6: proc (t6)
            ['active', 6],
            ['active', 8], // R8: proc (t8)
        ]);

        // Stasis expired by the end of the run (applied once, never re-applied).
        expect(isStasisedTap?.('attacker')).toBe(false);

        // CONTROL: the SAME legendary CR with NO stasis (the un-stasised legendary run). Its proc
        // fires on every even turn from t2, so by R2 it is already AHEAD of the stasised run.
        const control = runCombat(
            buildInput({ chargeCount: 8, numRounds: 8, passiveAbilities: [cr] })
        );
        expect(ledger(control)).toEqual([
            ['active', 1],
            ['active', 3], // R2 proc LANDED (control) vs 0 (stasised) — the suppressed proc
            ['active', 4],
            ['active', 6],
            ['active', 7],
            ['active', 8],
            ['charged', 0],
            ['active', 2],
        ]);

        // SUPPRESSION SIGNAL: from the skipped proc turn (R2) up to — but not including — the round
        // the control fires its charged skill (R7, where it RESETS to 0), the stasised run has
        // STRICTLY FEWER charges than the control. The dropped R2 proc plus the two surrounding
        // skipped baselines (R1,R3) put it behind and it never recovers the lost ticks. (After the
        // control's R7 reset the raw counts cross — the control banks from 0 again — so the window
        // is the pre-reset rounds R2–R6, which is where the suppression is observable.)
        for (let i = 1; i <= 5; i++) {
            expect(stasised.rounds[i].charges).toBeLessThan(control.rounds[i].charges);
        }
        // Specifically the skipped proc turn R2: control banked the proc (3), stasised banked nothing (0).
        expect(stasised.rounds[1].charges).toBe(0);
        expect(control.rounds[1].charges).toBe(3);

        // MONOTONIC CADENCE: the next proc after the suppressed R2 lands on R4 (t4 — the next even
        // own-turn = the ORIGINAL residue), NOT shifted earlier to R3. turnsTaken stayed monotonic
        // through the skips (1,2,3,4), so the every-2nd-turn gate did not re-fire on a frozen value.
        // R3 (odd t3) banks 0 (skip + non-proc); R4 (even t4) is the first post-recovery proc (0→1
        // baseline +1 proc = 2).
        expect(stasised.rounds[2].charges).toBe(0); // R3: no early proc
        expect(stasised.rounds[3].charges).toBe(2); // R4: proc on the original even-turn residue
    });
});
