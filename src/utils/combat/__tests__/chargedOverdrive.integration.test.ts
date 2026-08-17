/**
 * `Charged Overdrive II` — "Grants the next Charged Skill activation 20% Defense Penetration."
 * Granted by Sentinel's charged skill to ALL ALLIES (including itself). Built as a name-only
 * buff (empty parsedEffects) so nothing read it until this wiring (playerTurn.ts, immediately
 * before the `effectiveDamageStatsOf` call that builds `dmgStats`).
 *
 * Name-keyed rather than folded into a `parsedEffects` channel: a one-shot per-cast bonus has no
 * honest standing value, so routing it through `defensePenetrationBuff` permanently would leak
 * +20% pen into every later hit AND into the DPS-mode aggregate scalars and the buff-display UI —
 * exactly what name-keying exists to prevent. See chargedOverdrive.ts's own doc comment for the
 * full argument, and for why it must never be confused with the STANDING `Charge Overdrive II`
 * (one letter apart, identical magnitude, different lifetime).
 *
 * HARNESS SHAPE: unlike the sibling Hit Mitigation / Shield Converter suites (which test a
 * DEFENDER reading an INCOMING hit, and so use a positional teamActor "holder" + enemyAttackers),
 * this status is read by the ATTACKER on its own OUTGOING charged cast. The cleanest harness for
 * that is the non-positional "team walk" shape proven by teamWalk.test.ts: a top-level focus
 * attacker (whose `directDamage`/`action`/`charges` per round are read straight off `RoundData`,
 * exactly as chronoReaverCharge.integration.test.ts does) plus ONE faster ally team actor that
 * grants the status via an `all-allies` charged-skill cast, armed via the `startCharged` +
 * `chargeCount: 99` trick (fires in round 1 and never again — the same one-shot-grant trick the
 * Hit Mitigation / Shield Converter suites use, just without a board position since nothing here
 * needs one). The granter's own charged skill deals NO damage (`multiplier: 0`) in every fixture,
 * matching Sentinel's real kit — she has no charged damage ability at all.
 *
 * `ENEMY_DEFENSE` is deliberately non-zero throughout: with `defence: 0` the penetration term
 * `enemyDefense * (1 - pen/100)` cancels to 0 regardless of `pen`, and every assertion below would
 * pass whether or not the wiring exists. Expected damage is derived from the SAME
 * `calculateDamageReduction` curve the production code calls (playerTurn.ts ~1966), not a
 * hand-rolled ratio, so the assertions pin the concrete post-mitigation number, not just a
 * direction.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import { CHARGED_OVERDRIVE_II, holdsChargedOverdriveII } from '../chargedOverdrive';
import type { StatusEngine } from '../statusEngine';
import type { Ability } from '../../../types/abilities';

type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const ATTACK = 1000;
const ENEMY_DEFENSE = 3000; // non-zero — see file header. Never 0 in any fixture below.
const HP = 10_000_000; // large enough nothing ever dies; small enough pct math stays precise.

/** The production post-mitigation formula (playerTurn.ts ~1964-1966, ~2278), applied to a single
 *  100%-multiplier, 1-hit, non-crit cast — isolates the Defense Penetration term from every other
 *  channel (crit, outgoing/incoming buffs, affinity), all neutral in these fixtures. */
const expectedDirectDamage = (pen: number): number => {
    const effectiveDefense = ENEMY_DEFENSE * (1 - pen / 100);
    const reduction = calculateDamageReduction(effectiveDefense);
    return Math.round(ATTACK * (1 - reduction / 100));
};

let idCounter = 0;
const dmg = (multiplier: number): Ability => ({
    id: `dmg-${++idCounter}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** Sentinel's real grant clause: an `all-allies` buff carrying nothing but the name. `duration`
 *  is set (mirroring the parser's leaked "for 3 turns") but irrelevant — Task 1 routes the name to
 *  the persistent store regardless, so it survives until CONSUMED rather than expiring. */
const grantCO2ToAllAllies = (): Ability => ({
    id: 'grant-co2',
    type: 'buff',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: CHARGED_OVERDRIVE_II,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 3,
    },
});

/** The granter ally: faster than the focus (so its grant lands before the focus's own turn each
 *  round), fires its charged skill EXACTLY ONCE — round 1, via `startCharged` + `chargeCount: 99`
 *  (99 more turns of cadence never accrue within these short fixtures) — and never deals damage
 *  (Sentinel's own charged skill has no damage ability at all). No board position: this is the
 *  non-positional "team walk" shape (teamWalk.test.ts), which routes `all-allies` targeting to
 *  every player actor id, including the top-level focus ('attacker'), without one. */
const granterAlly = (): TeamActor =>
    ({
        id: 'granter',
        speed: 200,
        chargeCount: 99,
        startCharged: true,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [dmg(0)] },
                    { slot: 'charged', abilities: [grantCO2ToAllAllies(), dmg(0)] },
                ],
            },
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
            hasChargedSkill: true,
        },
    }) as TeamActor;

/** The focus attacker under test. `speed` (100) is slower than the granter (200), so a present
 *  granter's grant is always live before the focus's own turn each round. `chargedMultiplier`
 *  defaults to 100 (a normal damaging charged skill); the "no damage ability" fixture (case 4)
 *  overrides it to 0, mirroring Sentinel's own kit on the CONSUMING side instead. */
const BASE = (
    overrides: Partial<CombatEngineInput> & {
        chargedMultiplier?: number;
        activeMultiplier?: number;
    }
): CombatEngineInput => {
    const { chargedMultiplier = 100, activeMultiplier = 100, ...rest } = overrides;
    return {
        enemyAttackers: [],
        attack: ATTACK,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 1,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [dmg(activeMultiplier)] },
                { slot: 'charged', abilities: [dmg(chargedMultiplier)] },
            ],
        },
        enemyDefense: ENEMY_DEFENSE,
        enemyHp: HP,
        numRounds: 1,
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
        hp: HP,
        speed: 100,
        ...rest,
    };
};

describe('Charged Overdrive II adds Defense Penetration to the next charged cast', () => {
    it('adds 20 points of Defense Penetration to a charged cast', () => {
        // Two runs, identical except the granter ally is present in one. `startCharged: true` on
        // the focus makes round 1 itself a charged activation, so — with the granter present — the
        // grant (round-1, faster) is live the instant the focus's own round-1 turn reads it.
        const boosted = runCombat(BASE({ startCharged: true, teamActors: [granterAlly()] }));
        const baseline = runCombat(BASE({ startCharged: true }));

        expect(boosted.rounds[0].action).toBe('charged');
        expect(baseline.rounds[0].action).toBe('charged');
        // The concrete post-mitigation numbers, not just "higher" — pen 20 vs pen 0 against a
        // non-zero enemy defence, per the production formula.
        expect(boosted.rounds[0].directDamage).toBe(expectedDirectDamage(20));
        expect(baseline.rounds[0].directDamage).toBe(expectedDirectDamage(0));
        // Sanity: the two expected values are actually distinguishable (a vacuity guard — if
        // ENEMY_DEFENSE were 0 these would collapse to the same number regardless of the wiring).
        expect(expectedDirectDamage(20)).not.toBe(expectedDirectDamage(0));
    });

    it('does not persist into the following cast', () => {
        // chargeCount 1, startCharged FALSE: round 1 active (advances 0→1), round 2 charged
        // (reads the round-1 grant, consumes, resets to 0), round 3 active (0→1), round 4 charged
        // again — with no re-grant (the granter's own chargeCount:99 never re-fires), so cast 2
        // must be back to baseline.
        const result = runCombat(BASE({ numRounds: 4, teamActors: [granterAlly()] }));

        expect(result.rounds.map((r) => r.action)).toEqual([
            'active',
            'charged',
            'active',
            'charged',
        ]);
        expect(result.rounds[1].directDamage).toBe(expectedDirectDamage(20)); // cast 1: boosted
        expect(result.rounds[3].directDamage).toBe(expectedDirectDamage(0)); // cast 2: baseline
    });

    it('an ACTIVE cast does not spend it', () => {
        // The focus holds the granted status (armed by the faster granter before round 1) but
        // fires its ACTIVE skill first (natural cadence: chargeCount 1, startCharged false).
        // EXPECT: round 1 (active) is baseline — the injection only reads/consumes when
        // action === 'charged' — AND round 2 (charged) is STILL boosted, proving the active cast
        // did not spend it.
        const result = runCombat(BASE({ numRounds: 2, teamActors: [granterAlly()] }));

        expect(result.rounds[0].action).toBe('active');
        expect(result.rounds[0].directDamage).toBe(expectedDirectDamage(0));
        expect(result.rounds[1].action).toBe('charged');
        expect(result.rounds[1].directDamage).toBe(expectedDirectDamage(20));
    });

    it('is spent by a charged cast that deals no damage', () => {
        // Sentinel's own shape, but on the CONSUMING side this time: the focus's charged skill has
        // NO damage ability (multiplier 0) — consumption is unconditional on a charged activation,
        // damaging or not (chargedOverdrive.ts's documented, accepted consequence). Since the
        // focus's charged skill is fixed for the whole fight, a LATER charged cast by this SAME
        // actor can never "become damaging" to prove the point via directDamage — a zero-multiplier
        // ability deals zero every time it fires, whether or not the bonus was live underneath it.
        // The only rigorous instrument here is the status engine's own live state: `runCombat`
        // exposes it via `__testTapStatusEngine` (test-only, inert in production), read AFTER the
        // run completes (JS is single-threaded/synchronous, so by then every mutation has landed).
        // If `consumeChargedOverdriveII` were never called (e.g. the playerTurn.ts wiring reverted),
        // the grant — persistent, no natural expiry — would still read `true` here.
        let engine: StatusEngine | undefined;
        const result = runCombat({
            ...BASE({ numRounds: 2, chargedMultiplier: 0, teamActors: [granterAlly()] }),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });

        expect(result.rounds[0].action).toBe('active');
        expect(result.rounds[1].action).toBe('charged');
        // Sanity: the consuming cast really did deal no damage (rules out a fixture mistake where
        // this "no damage ability" cast accidentally dealt damage, which would make the case below
        // indistinguishable from the ordinary "is spent" case already covered above).
        expect(result.rounds[1].directDamage).toBe(0);
        // The direct proof: gone after the no-damage charged cast consumed it.
        expect(holdsChargedOverdriveII(engine!, 'attacker')).toBe(false);
    });

    it('does not boost the cast that grants it; boosts the next charged cast instead', () => {
        // The focus is its OWN granter this time — its charged skill BOTH grants CO2 to
        // all-allies (which includes itself; there is no other player actor) AND deals damage.
        // Sentinel's real kit doesn't have this shape (her charged skill deals no damage), but
        // proving the self-grant-this-turn bug requires a granting cast that also damages, so
        // the wiring's timing is observable via directDamage. chargeCount 1 + startCharged
        // false gives the active/charged/active/charged ladder (see the "does not persist"
        // test above): round 2 is the first (granting) charged cast, round 4 is the next one.
        const result = runCombat(
            BASE({
                numRounds: 4,
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [dmg(100)] },
                        { slot: 'charged', abilities: [grantCO2ToAllAllies(), dmg(100)] },
                    ],
                },
            })
        );

        expect(result.rounds.map((r) => r.action)).toEqual([
            'active',
            'charged',
            'active',
            'charged',
        ]);
        // The GRANTING cast must NOT be boosted by the grant it itself just issued.
        expect(result.rounds[1].directDamage).toBe(expectedDirectDamage(0));
        // The actor's NEXT charged cast must read/consume the round-2 grant and be boosted.
        expect(result.rounds[3].directDamage).toBe(expectedDirectDamage(20));
    });
});
