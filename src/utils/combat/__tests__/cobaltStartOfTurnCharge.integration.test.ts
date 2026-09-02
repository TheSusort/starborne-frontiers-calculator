/**
 * Integration: Cobalt start-of-turn full-HP self-charge (Charge Phase 2/3 Task 9).
 *
 * Cobalt's passive text "adds 1 charge to its charged skill at the start of the turn if it is at
 * full HP" is parsed (Tasks 6-8) into a charge ability:
 *   { type:'charge', target:'self', trigger:'start-of-turn',
 *     conditions:[{ subject:'hp-threshold', derivable:true, hpComparator:'above',
 *                   hpPercent:99, hpSubject:'self' }],
 *     config:{ type:'charge', amount:1 } }
 *
 * The ability under test is RESOLVED FROM THE REAL PARSER PATH: we hand `buildShipAbilities` a Ship
 * whose `firstPassiveSkillText` is Cobalt's real corpus string and pull the start-of-turn charge
 * ability out of the built passive slot — so the shape the engine runs is the parser's genuine
 * output, not a hand-rolled copy (mirrors the Chrono Reaver goldens' implant-resolution discipline).
 *
 * We then run that ability through `runCombat` (the battle-sim engine) with a two-side roster (the
 * Cobalt focus vs. an enemy attacker) and read the focus's per-round charge counts from
 * `result.rounds[].charges` (the focus's END-OF-ROUND live charge counter) and
 * `result.rounds[].action` ('active' | 'charged'). `simulateBattle`'s result surfaces damage/HP but
 * NOT charge counts, so `runCombat` is the only entry point that can pin the per-round charge ledger
 * (same reason the Chrono Reaver / Phase-1 charge goldens use it).
 *
 * ─── CRITICAL TIMING (baked into the Part 1 ledger) ───────────────────────────────────────────
 * There is NO pre-action drain between the focus's `turn-started` and its action body. The
 * `start-of-turn` charge intent is ENQUEUED on `turn-started` (triggers.ts) but DRAINS at the
 * post-action point (~engine.ts / round-end). So Cobalt's +1 proc lands AFTER its own turn's
 * cast decision (one-turn alignment) — within the SAME round, reflected in that round's reported
 * `charges`. Charges carry forward across rounds, so accrual is correct. Net effect at full HP: the
 * bar advances by +2 each active turn (baseline +1 from advanceChargeCadence, plus Cobalt's +1
 * proc), so the charged skill fills ~twice as fast as a no-passive baseline.
 *
 * ─── SELF-HP LIVENESS (drives Part 2's approach) ──────────────────────────────────────────────
 * The drain-time `hpSubject:'self'` gate reads `selfHpPctFor(ownerId)`. On the player side that
 * closure returns LIVE HP (currentHp / maxHp * 100) ONLY for the heal-target actor, and 100 for
 * every other owner (engine.ts ~1836). Because `buildInput` sets `healTargetId:'attacker'` (the
 * focus IS the heal target), the focus's live HP IS threaded into its own gate — so a damaged focus
 * genuinely flips the gate false. Part 2 therefore uses the PREFERRED live-HP approach (a): an
 * enemy attacker that acts BEFORE the focus dents it below 99% every turn, and the proc is
 * suppressed on every round (NOT the Arcane-Siege-style always-100 fallback (b)).
 */

import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parseChargeGain } from '../../skillTextParser';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Cobalt's two real corpus passive strings. Buff names are wrapped in <unit-skill> tags exactly as
// the game CSV stores them (the buff/effect parser reads buff names from those tags — an untagged
// "Out. Damage Up II" is invisible to parseAllSkillEffects, so the corpus-faithful tagged form is
// required for Part 3 to exercise the real swallow hazard).
const COBALT_P1 =
    'This Unit adds 1 charge to its <unit-skill>charged skill</unit-skill> at the start of the turn if it is at full HP.';
const COBALT_P2 =
    'This Unit adds 1 charge to its <unit-skill>charged skill</unit-skill> and gains ' +
    '<unit-skill>Out. Damage Up II</unit-skill> for 1 turn at the start of the turn if it is at full HP.';

// ─── Real parser resolution ───────────────────────────────────────────────────────
// Resolve Cobalt's abilities from the SAME path production uses: a Ship carrying the passive text,
// through buildShipAbilities. This is the genuine parser output (Tasks 6-8), not a hand-rolled copy.

function makeShip(passiveText: string): Ship {
    return {
        id: 'cobalt',
        name: 'Cobalt',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        stats: [],
        equipment: {},
        implants: {},
        refits: [],
        firstPassiveSkillText: passiveText,
    } as Ship;
}

/** Pull the passive-slot abilities buildShipAbilities produces from a Cobalt passive string. */
function resolvePassiveAbilities(passiveText: string): Ability[] {
    const skills = buildShipAbilities(makeShip(passiveText));
    return skills.slots.find((s) => s.slot === 'passive')?.abilities ?? [];
}

/** The start-of-turn self-charge ability, resolved from the real parser path. */
function resolveCobaltCharge(passiveText: string): Ability {
    const charge = resolvePassiveAbilities(passiveText).find(
        (a) => a.type === 'charge' && a.trigger === 'start-of-turn'
    );
    if (!charge) throw new Error('expected a start-of-turn charge ability from the Cobalt passive');
    return charge;
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

/** A passive, charge-less dummy/sink enemy: slow (speed 40, acts AFTER the focus), tiny attack
 *  (1) so it never meaningfully dents a 1e9-HP focus → the focus stays at full HP and Cobalt's
 *  gate stays true. Present only so the run is a real two-side battle. */
const dummySink = (): EnemyAttacker => ({
    id: 'e-sink',
    stats: { attack: 1, crit: 0, critDamage: 0, speed: 40 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [{ slot: 'active', abilities: [damage(1, 'es-a')] }],
    },
});

/** A heavy hitter that acts BEFORE the focus (speed 200 > 100) and dents it below 99% every turn,
 *  but never kills it: vs a 1,000,000-HP focus a 100% hit of attack 100000 removes ~100000/turn, so
 *  over 6 rounds the focus drops to ~40% and lives the whole run. Drives Part 2's live-HP gate flip. */
const heavyHitter = (): EnemyAttacker => ({
    id: 'heavy',
    stats: { attack: 100000, crit: 0, critDamage: 0, speed: 200, defence: 0, hp: 1_000_000_000 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [{ slot: 'active', abilities: [damage(100, 'hv-a')] }],
    },
});

// ─── Player / engine input ────────────────────────────────────────────────────────

/** A charged player focus (id 'attacker', speed 100). active 50% / charged 400% so a charged cast
 *  is plainly distinguishable from an active one. `healTargetId:'attacker'` makes the focus its own
 *  heal target so its live HP feeds the drain-time self hp-threshold gate. The under-test charge
 *  ability rides the passive slot; `hp` and `enemyAttackers` are caller-tunable so the same builder
 *  serves the full-HP (Part 1) and damaged (Part 2) scenarios. */
const buildInput = (opts: {
    chargeCount: number;
    numRounds: number;
    passiveAbilities?: Ability[];
    hp?: number;
    enemyAttackers?: EnemyAttacker[];
}): CombatEngineInput => {
    const slots: ShipSkills['slots'] = [
        { slot: 'active', abilities: [damage(50, 'p-a')] },
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
        numRounds: opts.numRounds,
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
        hp: opts.hp ?? 1_000_000_000,
        speed: 100,
        healTargetId: 'attacker',
        mode: 'healing',
        enemyAttackers: opts.enemyAttackers ?? [dummySink()],
    };
};

/** Convenience: the per-round (action, charges) ledger for the focus. */
const ledger = (r: ReturnType<typeof runCombat>): Array<[string, number]> =>
    r.rounds.map((x) => [x.action, x.charges]);

// ─── Part 1: full-HP proc ─────────────────────────────────────────────────────────

describe('Cobalt start-of-turn charge — full-HP proc', () => {
    it('banks an EXTRA +1/turn beyond baseline; charged fills ~twice as fast', () => {
        // chargeCount 8 so the cadence is visible across 8 rounds. At full HP the gate is always
        // true, so the bar advances by +2 each active turn: baseline +1 (advanceChargeCadence) PLUS
        // Cobalt's +1 proc (banked within the same round per the one-turn-alignment timing note).
        //
        // Per-round ledger (focus turnsTaken === round; proc banks within the SAME round):
        //   R1 (t1): active, baseline 0→1, proc +1            → charges 2
        //   R2 (t2): active 2<8, baseline 2→3, proc +1        → charges 4
        //   R3 (t3): active 4<8, baseline 4→5, proc +1        → charges 6
        //   R4 (t4): active 6<8, baseline 6→7, proc +1 (= cap, fills bar exactly)  → charges 8
        //   R5 (t5): charges 8≥8 → CHARGED, reset 0, proc +1  → charges 1
        //   R6 (t6): active 1<8, baseline 1→2, proc +1        → charges 3
        //   R7 (t7): active 3<8, baseline 3→4, proc +1        → charges 5
        //   R8 (t8): active 5<8, baseline 5→6, proc +1        → charges 7
        const charge = resolveCobaltCharge(COBALT_P1);
        const proc = runCombat(
            buildInput({ chargeCount: 8, numRounds: 8, passiveAbilities: [charge] })
        );

        expect(ledger(proc)).toEqual([
            ['active', 2],
            ['active', 4],
            ['active', 6],
            ['active', 8],
            ['charged', 1],
            ['active', 3],
            ['active', 5],
            ['active', 7],
        ]);

        // No-passive baseline: pure +1/turn cadence — it only just reaches the cap on R8 (→ charged
        // R9, outside the window), so it NEVER fires a charged cast in 8 rounds.
        const base = runCombat(buildInput({ chargeCount: 8, numRounds: 8 }));
        expect(ledger(base)).toEqual([
            ['active', 1],
            ['active', 2],
            ['active', 3],
            ['active', 4],
            ['active', 5],
            ['active', 6],
            ['active', 7],
            ['active', 8],
        ]);

        // Differential: Cobalt fires its charged skill by R5 (the +2/turn fill reaches 8 at R4 →
        // charged R5); the no-passive baseline fires none within 8 rounds. The proc roughly doubles
        // the fill rate, exactly as the parsed start-of-turn +1 should.
        const procCharged = proc.rounds.filter((x) => x.action === 'charged').map((x) => x.round);
        const baseCharged = base.rounds.filter((x) => x.action === 'charged').map((x) => x.round);
        expect(procCharged).toEqual([5]);
        expect(baseCharged).toEqual([]);
    });
});

// ─── Part 2: damaged → no proc (PREFERRED live-HP approach (a)) ──────────────────────

describe('Cobalt start-of-turn charge — damaged focus suppresses the proc (live-HP)', () => {
    it('a focus below 99% HP banks only the +1/turn baseline (the full-HP gate flips false)', () => {
        // APPROACH (a), the PREFERRED live-HP path. The focus is its own heal target
        // (healTargetId:'attacker'), so selfHpPctFor returns its LIVE HP% to the drain-time
        // hp-threshold gate. A heavy enemy attacker (speed 200) acts BEFORE the focus (speed 100)
        // each round, so by the focus's turn-start its HP is already < 99% — INCLUDING round 1 (the
        // attacker's round-1 hit lands before the focus's first turn). The gate (hp-threshold ABOVE
        // 99 self) is therefore false on EVERY turn, so Cobalt's +1 proc never fires and the bar
        // advances by only the +1/turn baseline (which is NOT HP-gated):
        //   R1..R6: active, baseline +1 each, proc SUPPRESSED → 1,2,3,4,5,6
        // (vs the full-HP control's 2,4,6,... — the +1 proc is exactly the missing increment.)
        const charge = resolveCobaltCharge(COBALT_P1);
        const damaged = runCombat(
            buildInput({
                chargeCount: 8,
                numRounds: 6,
                passiveAbilities: [charge],
                hp: 1_000_000, // large pool: dented below 99% but never killed across 6 rounds
                enemyAttackers: [heavyHitter()],
            })
        );

        expect(ledger(damaged)).toEqual([
            ['active', 1],
            ['active', 2],
            ['active', 3],
            ['active', 4],
            ['active', 5],
            ['active', 6],
        ]);

        // The proc is missing on EVERY round: a full-HP control (same charge, same chargeCount, but
        // the harmless dummy sink) banks +2/turn from R1. The damaged run is strictly behind from R1
        // onward — the gap is exactly the suppressed +1/turn proc.
        const control = runCombat(
            buildInput({ chargeCount: 8, numRounds: 6, passiveAbilities: [charge] })
        );
        expect(ledger(control)).toEqual([
            ['active', 2],
            ['active', 4],
            ['active', 6],
            ['active', 8],
            ['charged', 1],
            ['active', 3],
        ]);
        for (let i = 0; i < 4; i++) {
            // R1..R4 (pre-control-reset window): damaged strictly fewer charges than the full-HP run.
            expect(damaged.rounds[i].charges).toBeLessThan(control.rounds[i].charges);
        }

        // Structural sanity: the resolved ability really carries the full-HP self gate that drives
        // the suppression (so the differential above is the gate flipping, not some unrelated effect).
        expect(charge.conditions).toEqual([
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'above',
                hpPercent: 99,
                hpSubject: 'self',
            },
        ]);
    });
});

// ─── Direct parse assertion ────────────────────────────────────────────────────────
// Complements the integration-path assertions above: confirms the PARSER OUTPUT shape for
// the 2nd-passive string directly, independent of buildShipAbilities / the engine path.

describe('Cobalt second passive — parseChargeGain direct parse assertion', () => {
    it('parseChargeGain returns start-of-turn + full-HP gate for the 2nd-passive string', () => {
        const result = parseChargeGain(COBALT_P2);
        expect(result).toEqual({
            amount: 1,
            condition: 'always',
            derivable: true,
            trigger: 'start-of-turn',
            conditions: [
                {
                    subject: 'hp-threshold',
                    derivable: true,
                    hpComparator: 'above',
                    hpPercent: 99,
                    hpSubject: 'self',
                },
            ],
        });
    });
});

// ─── Part 3: second-passive co-buff coexistence ─────────────────────────────────────

describe('Cobalt second passive — charge AND Out. Damage Up II coexist (no clause swallow)', () => {
    it('buildShipAbilities yields BOTH the start-of-turn charge AND the Out. Damage Up II buff', () => {
        // The 2nd-passive text joins the charge clause and the buff clause with "and", and the buff
        // name carries the "Out." abbreviation period — a known clause-scoping hazard (abbreviation
        // periods must be masked before sentence-splitting in BOTH skillTextParser and auditSkills,
        // or the period reads as a sentence boundary and the buff clause is swallowed). This asserts
        // the buff SURVIVES: the parser emits a charge ability AND a buff ability for the SAME passive.
        const abilities = resolvePassiveAbilities(COBALT_P2);

        const charge = abilities.find((a) => a.type === 'charge' && a.trigger === 'start-of-turn');
        expect(charge, 'start-of-turn charge ability present').toBeDefined();

        const buff = abilities.find(
            (a) =>
                a.type === 'buff' &&
                a.config.type === 'buff' &&
                a.config.buffName === 'Out. Damage Up II'
        );
        expect(
            buff,
            'Out. Damage Up II buff ability present (not swallowed by the "Out." period)'
        ).toBeDefined();

        // The buff is self-targeted and inherits the same full-HP gate as the charge (both are
        // gained "at the start of the turn if it is at full HP").
        expect(buff!.target).toBe('self');
        expect(buff!.conditions).toEqual([
            {
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'above',
                hpPercent: 99,
                hpSubject: 'self',
            },
        ]);

        // Epic PR4 (round-boundary trigger consistency): the buff half now shares the SAME
        // start-of-turn trigger as the charge half — both are gained "at the start of the turn
        // if it is at full HP", so they ride the same governing phrase (detectReactiveTrigger's
        // START_OF_TURN_CHARGE_RE branch). Previously this was on-cast (see git history for the
        // prior "KNOWN LIMITATION" note); the fix makes the buff actually apply once per turn
        // in-game instead of re-granting on every skill use.
        expect(buff!.trigger).toBe('start-of-turn');
    });
});

// ─── SP-G G2: the start-of-turn grant now precedes the owner's cast ──────────────────────────
//
// FIXED: a pre-cast drain of the acting owner's start-of-turn GRANT intents runs
// between the turn-started emit and the cast, so the Out. Damage Up II buff boosts the SAME turn
// it is granted — every turn, not every other turn. (The CHARGE half is excluded from this drain
// and still banks post-cast, so the Part 1/Part 2 charge ledgers are unchanged.)
describe('Cobalt Out. Damage Up II — engine consumption (recurring, every turn)', () => {
    // SP-4c-2a (B1): `dummySink()` (buildInput's default enemy) carries no `stats.hp`, so the
    // targetable-HP floor (normalizeRoster.ts) now raises it to MIN_TARGETABLE_MAX_HP and the run
    // is positional — the scalar `directDamage` credit is suppressed in favour of the per-victim
    // map. Read the per-victim channel only — NO scalar fallback. Every call below goes through
    // `buildInput` without an `enemyAttackers` override, so every run in this file uses the same
    // always-positional `dummySink()`; a fallback to the scalar channel would never fire and would
    // only mask a future regression (the deleted non-positional shape returning) by silently
    // reading a stale 0 instead of failing loudly. Matches the stricter, fallback-free shape in
    // `enemyTeamRouting.test.ts`'s `playerDealt`.
    const runFocusDamage = (withBuff: boolean): number[] => {
        const abilities = resolvePassiveAbilities(COBALT_P2).filter(
            (a) =>
                a.type !== 'charge' &&
                (withBuff ||
                    !(a.config.type === 'buff' && a.config.buffName === 'Out. Damage Up II'))
        );
        const r = runCombat(
            buildInput({ chargeCount: 0, numRounds: 4, passiveAbilities: abilities })
        );
        return r.rounds.map((round) => {
            const perVictim = round.perTargetDealt?.['attacker'];
            return perVictim ? Object.values(perVictim).reduce((sum, v) => sum + v, 0) : 0;
        });
    };

    it('the buff boosts EVERY turn (pre-cast grant ordering)', () => {
        const boosted = runFocusDamage(true);
        const control = runFocusDamage(false);
        expect(boosted[0]).toBeGreaterThan(control[0]);
        expect(boosted[1]).toBeGreaterThan(control[1]);
        expect(boosted[2]).toBeGreaterThan(control[2]);
        expect(boosted[3]).toBeGreaterThan(control[3]);
    });
});
