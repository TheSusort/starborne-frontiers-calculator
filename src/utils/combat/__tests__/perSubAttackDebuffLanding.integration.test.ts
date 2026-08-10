/**
 * Direct debuff clauses land per SUB-ATTACK (multi-hit full-walk epic, PR8).
 *
 * R1: a multi-hit skill is N consecutive FULL-WALK attacks, each running the entire pipeline
 * including the debuff landing roll. This file owns PR8's fidelity assertions; the
 * once-per-cast before-picture lives in `incomingDebuffArrivalCardinality.integration.test.ts`.
 *
 * CORPUS-INERT (measured 2026-08-09): 147 ships, only Enforcer has `hits > 1`, 49 ships carry a
 * direct active/charged debuff-inflict clause, intersection EMPTY. Every fixture here is
 * therefore synthetic, and synthetic fixtures are the only verification this behaviour gets —
 * which is why each assertion below carries an anti-vacuity control.
 *
 * ANTI-VACUITY DISCIPLINE. Every numeric constant below was MEASURED against this fixture before
 * it was written down (task-5-report.md holds the probe transcripts), and every test was
 * confirmed to go RED under a mutation of the production line it targets — the four mutations
 * used are `sub.index < sel.scalars.hits - 1` forced to `false` and to `true` (engine.ts ~6860),
 * `applyDebuffsForSubAttack` returning `[]` (playerTurn.ts ~1759), and the `onSubAttackStart` /
 * `onSubAttackEnd` hooks (engine.ts ~6843 / ~6853) no-oped. Each test names its own killer.
 *
 * DEVIATIONS FROM task-5-brief.md (measured against source before writing a single assertion):
 *
 * 1. THE VISIBILITY MECHANIC IS AN INCOMING-AMPLIFICATION CLAUSE, NOT A DEFENCE-REDUCING ONE.
 *    The brief reached for a defence debuff so that "a defence debuff changes the arithmetic".
 *    `Exposed` (+100 percentage points incoming direct damage per stack, exposedStatus.ts) and
 *    `Inc. Damage Up` (`parsedEffects.incomingDamage`, folded by `toEnemyModifiers`) ride the SAME
 *    per-victim `victimIncomingModifiers` fold a defence debuff would, but their arithmetic is an
 *    exact multiple of the plain slice rather than a defence-curve output — so every expected
 *    number below is derivable in one line and a wrong constant cannot hide inside a curve. The
 *    owner also supplied ground truth in these terms (1.5x / 2.0x cast totals, and the residual
 *    stack counts), so this is the shape the assertions are written against.
 *
 * 2. `Exposed` IS ONE-SHOT AND SPENDS ONE STACK PER AMPLIFIED HIT. It is not capped in effect or
 *    in duration: a victim holding k stacks amplifies the next direct hit by +100k%, and that hit
 *    SPENDS one stack. That spend-one mechanism is what makes the residual-stack readings below
 *    meaningful. (`consumeExposed` currently removes every stack rather than decrementing by one —
 *    tracked separately, deliberately not this PR's business, and invisible here: no fixture in
 *    this file ever leaves the victim holding two stacks at once.)
 *
 * 3. THE RESIDUAL STACK COUNT IS READ OFF A FOLLOW-UP ALLY HIT. `runCombat`'s result exposes no
 *    end-of-run status snapshot, and a status removed by `consumeExposed` emits nothing (the only
 *    expiry event, `buff-expired`, was confirmed by probe never to fire for these enemy-side timed
 *    statuses even over a 5-round run). A second round does NOT work either: a BEFORE-damage clause
 *    re-arms its own sub-attack 0, so round 2's first slice is amplified whether or not a stack
 *    survived round 1 — measured, and the reason that route was abandoned. What DOES work is a
 *    walked team ally (`residualProbeAlly`) that fires one PLAIN hit at the same victim AFTER the
 *    focus: at crit 0 its slice is 5,000 flat, so its delivered damage reads the victim's residual
 *    stack count directly as 5,000 x (1 + stacks) — 5,000 for 0 stacks, 10,000 for 1, 15,000 for 2.
 *    This is the strong discriminator: a total-damage assertion alone can be produced by the wrong
 *    mechanism, whereas the leftover stack pins the apply/ride/spend sequence itself.
 *
 * 4. THE `hits - 1` BOUNDARY COULD NOT BE FENCED, and this is recorded rather than papered over.
 *    Mutating `sub.index < sel.scalars.hits - 1` to `<=` leaves this file (and, per the previous
 *    task's reviewer, the whole suite) green. The guard sits inside the `sub.index === 0` branch,
 *    so `<` and `<=` differ ONLY when `hits - 1 === 0`, i.e. N=1 — and for N=1 the two candidate
 *    flush points have nothing between them that reads the enemy debuff store, so no observable
 *    differs. A full event-order dump for N=1 (post- and pre-damage clause) was byte-identical
 *    under both spellings. No fixture was contorted to manufacture coverage.
 *
 * FIXTURE ARITHMETIC, once, since every test below quotes it:
 *   focus:  attack 5,000 x multiplier 100% = 5,000 raw; crit 100 / critDamage 100 means EVERY hit
 *           crits and doubles -> PLAIN SLICE = 10,000 per sub-attack, against defence 0.
 *   ally:   attack 5,000 x multiplier 100%, crit 0 -> PLAIN SLICE = 5,000 (no doubling).
 *   Exposed stack:        slice x (1 + 100/100) = 2x  -> 20,000 focus / 10,000 ally.
 *   Inc. Damage Up (+50): slice x (1 + 50/100) = 1.5x -> 15,000 focus.
 * Victim HP is 10,000,000 everywhere except the deliberate overkill fixture, i.e. far above
 * `hits x 10_000`, so no mid-cast death confounds a count.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resetRateGateRng, setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { runPlayerTurn } from '../playerTurn';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;
type DebuffApplied = Extract<CombatEvent, { type: 'debuff-applied' }>;
type Attacked = Extract<CombatEvent, { type: 'attacked' }>;

const HP = 10_000_000;
/** The measured per-sub-attack delivered damage of the focus cast (see the header's arithmetic). */
const SLICE = 10_000;
/** The measured per-hit delivered damage of the residual-probe ally (crit 0 — no doubling). */
const ALLY_SLICE = 5_000;

// ── Fixture harness ────────────────────────────────────────────────────────────────────────
// COPIED VERBATIM from `incomingDebuffArrivalCardinality.integration.test.ts` (`ab`,
// `attackSkill`, `activeWithDebuffClause`, `parsedTarget`, `basePattern`, `enemyAt`, `focusCast`,
// `debuffApplications`), not imported — this epic's established convention is that fixtures are
// copied per file. `focusCast` gained two optional trailing parameters and an explicit `speed`;
// both are additive and documented on the helper itself.

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pr8t5-${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/** The N-hit damage clause every active below is built around. */
const damageClause = (hits: number): Ability =>
    ab({
        type: 'damage',
        target: 'enemy',
        config: { type: 'damage', multiplier: 100, ...(hits > 1 ? { hits } : {}) },
    });

/** A direct enemy-debuff clause. `parsedEffects` empty for name-keyed statuses (Exposed). */
const debuffClause = (buffName: string, parsedEffects: Record<string, number>): Ability =>
    ab({
        type: 'debuff',
        target: 'enemy',
        config: {
            type: 'debuff',
            buffName,
            parsedEffects,
            stacks: 1,
            isStackable: true,
            maxStacks: 20,
            duration: 3,
            application: 'inflict',
        },
    });

/** A plain N-hit damage active, no debuff clause — the "clause absent" control fixture. */
const attackSkill = (hits: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [damageClause(hits)],
});

/** A direct debuff clause on the ACTIVE slot alongside the N-hit damage — the shape PR8 makes
 *  per-sub-attack. Written AFTER the damage clause, so `registerActorAbilityStatuses` stamps
 *  `afterDamageClause` (engine.ts ~370) and it misses its own sub-attack's damage. */
const activeWithDebuffClause = (hits: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [damageClause(hits), debuffClause('Corrode', { defense: -2 })],
});

/** `[damage, debuff]` — the clause is written AFTER the damage clause. */
const afterDamage = (hits: number, clause: Ability): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [damageClause(hits), clause],
});

/** `[debuff, damage]` — the clause is written BEFORE the damage clause, so no
 *  `afterDamageClause` stamp and it folds into its own sub-attack's damage. */
const beforeDamage = (hits: number, clause: Ability): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [clause, damageClause(hits)],
});

/** A zero-multiplier active, so the focus can be present-but-inert while a walked ally or an
 *  enemy attacker does the multi-hit casting (the two team-symmetry paths). */
const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 0 } })],
};

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** A positioned enemy carrying `slots`, which never attacks unless given an active. `hp` is
 *  exposed so the overkill fixture can size the front victim below one slice. */
const enemyAt = (
    id: string,
    position: Position,
    slots: ShipSkills['slots'] = [],
    hp: number = HP
): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        shipSkills: { slots },
    }) as EnemyAttacker;

/** An ENEMY attacker that fires `slots` at the player front. Speed 1,000 outruns the focus's 500
 *  so it casts first. `hacking` is explicit and LOAD-BEARING: `liveDebuffLandingChance` is
 *  `clamp(effHacking - effSecurity, 0..100)/100` and a player victim's default security is 100, so
 *  a low-hacking attacker would resist every landing and make the whole test vacuous. */
const offensiveEnemy = (
    id: string,
    position: Position,
    slots: ShipSkills['slots']
): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 5000,
            crit: 100,
            critDamage: 100,
            defence: 0,
            hp: HP,
            speed: 1000,
            hacking: 100_000,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots },
    }) as EnemyAttacker;

/** A WALKED player team actor at `position` firing `slots` at the enemy front. Speed defaults to
 *  1 so it acts AFTER the focus (whose speed is 500) — load-bearing for the residual probe, which
 *  must observe the victim's state as the multi-hit cast left it. `hacking` defaults to 0 (fine
 *  for a probe with no debuff clause) and must be raised for any actor that DOES carry one, for
 *  the same landing-chance reason `offensiveEnemy` documents. */
const teamActor = (
    id: string,
    position: Position,
    slots: ShipSkills['slots'],
    attack: number = 0,
    hacking: number = 0
): TeamActor =>
    ({
        id,
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: { slots: slots },
            stats: {
                attack,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking,
                defence: 0,
                hp: HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActorEngineInput;

/** The residual-stack probe (see DEVIATION 3): one PLAIN hit at the enemy front, no debuff clause,
 *  crit 0 so its slice is a flat 5,000 and its delivered damage reads `5,000 x (1 + stacks)`. */
const residualProbeAlly = (): TeamActor => teamActor('probe', 'M2', [attackSkill(1)], 5000, 0);

/** The focus player at M1 fires `slots` at the front enemy (column 4). `hacking` is high by
 *  default so the debuff landing roll never resists and confounds a count; the gate test lowers
 *  it deliberately. `speed: 500` is explicit so the walked residual probe (speed 1) is
 *  guaranteed to act after this cast. */
const focusCast = (
    slots: ShipSkills['slots'],
    enemies: EnemyAttacker[],
    team: TeamActor[] = [],
    hacking: number = 100_000
): CombatEngineInput => ({
    attack: 5000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
    enemyDefense: 0,
    enemyHp: HP,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    affinity: 'antimatter',
    defence: 0,
    hp: HP,
    hacking,
    healTargetId: 'attacker',
    position: 'M1',
    speed: 500,
    target: parsedTarget('front'),
    pattern: basePattern(),
    positionalTeamBattle: true,
    enemyAttackers: enemies,
    ...(team.length > 0 ? { teamActors: team } : {}),
});

/** Counts `debuff-applied` events naming `buffName` on `targetId`. */
const debuffApplications = (
    input: CombatEngineInput,
    buffName: string,
    targetId: string
): number => {
    const bus = createEventBus();
    let n = 0;
    bus.on('debuff-applied', (e: DebuffApplied) => {
        if (e.buffName === buffName && e.targetId === targetId) n++;
    });
    runCombat({ ...input, bus });
    return n;
};

/** `debuff-applied` counts for `buffName`, keyed by victim — the overkill fixture's readout. */
const debuffApplicationsByTarget = (
    input: CombatEngineInput,
    buffName: string
): Record<string, number> => {
    const bus = createEventBus();
    const counts: Record<string, number> = {};
    bus.on('debuff-applied', (e: DebuffApplied) => {
        if (e.buffName === buffName) counts[e.targetId] = (counts[e.targetId] ?? 0) + 1;
    });
    runCombat({ ...input, bus });
    return counts;
};

/**
 * `ability-performed.deliveredDamage` for `actorId`'s own casts, in sub-attack order.
 *
 * `deliveredDamage`, never `damage`: `damage` is the cast's PRE-funnel `directDamage` (events.ts
 * ~95) and reads a flat 10,000 on every sub-attack regardless of amplification — measured, and
 * exactly the trap that would make this whole file vacuous. `deliveredDamage` is PR7's
 * post-crit / post-amplification / post-victim-defence number, which is the one that moves.
 */
const deliveredDamagesOf = (input: CombatEngineInput, actorId: string): (number | undefined)[] => {
    const bus = createEventBus();
    const out: (number | undefined)[] = [];
    bus.on('ability-performed', (e: AbilityPerformed) => {
        if (e.actorId === actorId) out.push(e.deliveredDamage);
    });
    runCombat({ ...input, bus });
    return out;
};

/** The residual Exposed stack count the victim was left holding, decoded from the probe ally's
 *  delivered damage (`ALLY_SLICE x (1 + stacks)` — see DEVIATION 3). Throws rather than silently
 *  returning a wrong count if the probe's amount is not a whole multiple, so a fixture drift
 *  cannot be read as "0 stacks". */
const residualExposedStacks = (input: CombatEngineInput): number => {
    const delivered = deliveredDamagesOf(input, 'probe');
    expect(delivered).toHaveLength(1);
    const amount = delivered[0];
    expect(amount).toBeDefined();
    const ratio = amount! / ALLY_SLICE;
    expect(Number.isInteger(ratio)).toBe(true);
    return ratio - 1;
};

const sum = (xs: (number | undefined)[]): number => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** The victim named by the FIRST event of each of three independently-resolved paths: the cast's
 *  own `ability-performed` primary target, the positional walk's iteration-0 `attacked`, and the
 *  first `debuff-applied`. */
const firstNamedVictims = (
    input: CombatEngineInput,
    buffName: string
): { cast?: string; struck?: string; debuffed?: string } => {
    const bus = createEventBus();
    const out: { cast?: string; struck?: string; debuffed?: string } = {};
    bus.on('ability-performed', (e: AbilityPerformed) => {
        if (e.actorId === 'attacker' && out.cast === undefined) out.cast = e.targetId;
    });
    bus.on('attacked', (e: Attacked) => {
        if (out.struck === undefined) out.struck = e.targetId;
    });
    bus.on('debuff-applied', (e: DebuffApplied) => {
        if (e.buffName === buffName && out.debuffed === undefined) out.debuffed = e.targetId;
    });
    runCombat({ ...input, bus });
    return out;
};

const EXPOSED = () => debuffClause('Exposed', {});
const INC_UP = () => debuffClause('Inc. Damage Up', { incomingDamage: 50 });

describe('PR8 Task 3 — runPlayerTurn exposes a per-sub-attack landing applier', () => {
    afterEach(() => resetRateGateRng());

    it('exports the split deferred-application shape', () => {
        // Compile-time contract: the pair must be {applyState, emitEvents}, not a bare thunk.
        // A bare thunk cannot be run in two places, which is exactly what PR8 needs — state at the
        // sub-attack boundary, events interleaved into the engine's emission steps.
        const probe: import('../playerTurn').DeferredEnemyApplication = {
            applyState: () => {},
            emitEvents: () => {},
        };
        expect(typeof probe.applyState).toBe('function');
        expect(typeof probe.emitEvents).toBe('function');
        expect(typeof runPlayerTurn).toBe('function');
    });
});

describe('PR8 — cross-sub-attack visibility (the user-locked rule: later hits see earlier hits’ effects)', () => {
    afterEach(() => resetRateGateRng());

    it('an amplification clause landed by sub-attack 1 increases sub-attack 2’s damage', () => {
        // The clause is written AFTER the damage clause, so it must miss its OWN sub-attack and
        // land for the next — which is exactly the behaviour PR8 buys. DERIVATION:
        //   sub-attack 0: plain slice                        = 10,000, then lands 1 Exposed stack
        //   sub-attack 1: rides that stack, 10,000 x (1+100%) = 20,000, and SPENDS it
        //   cast total 30,000 = 1.5x the no-clause control's 20,000 (the owner's locked figure)
        // ANTI-VACUITY: the increase is asserted WITHIN one cast (cross-side/cross-actor amounts
        // are meaningless — the RNG is keyed by ownerId), and the no-clause control below proves
        // the same shape is FLAT without the clause, so the rise cannot be per-sub-attack drift.
        // KILLED BY: `sub.index < sel.scalars.hits - 1` forced to false (sub-attack 0's stack is
        // then never in the store when sub-attack 1 computes its damage), by
        // `applyDebuffsForSubAttack` returning [], and by no-oping `onSubAttackEnd`.
        const delivered = deliveredDamagesOf(
            focusCast([afterDamage(2, EXPOSED())], [enemyAt('victim', 'M4')]),
            'attacker'
        );
        expect(delivered).toEqual([SLICE, 2 * SLICE]);
        expect(delivered[1]!).toBeGreaterThan(delivered[0]!);
        const control = deliveredDamagesOf(
            focusCast([attackSkill(2)], [enemyAt('victim', 'M4')]),
            'attacker'
        );
        expect(sum(delivered)).toBe(1.5 * sum(control));
    });

    it('control: with no debuff clause, consecutive sub-attacks deal equal damage', () => {
        // Proves the increase above is the debuff and not some other per-sub-attack drift. The
        // LENGTH assertions matter as much as the flatness: they show the apparatus really does
        // observe one event per sub-attack, so the sibling test's `[10_000, 20_000]` is a
        // measurement rather than an artefact of a collapsed emission.
        expect(
            deliveredDamagesOf(focusCast([attackSkill(2)], [enemyAt('victim', 'M4')]), 'attacker')
        ).toEqual([SLICE, SLICE]);
        expect(
            deliveredDamagesOf(focusCast([attackSkill(3)], [enemyAt('victim', 'M4')]), 'attacker')
        ).toEqual([SLICE, SLICE, SLICE]);
    });

    it('a PERSISTENT (non-consumed) amplification clause stays visible to EVERY later sub-attack', () => {
        // A second, independent mechanism on the same fold, chosen because `Exposed` is consumed
        // by the hit it amplifies — so the test above cannot distinguish "the store carries the
        // stack forward" from "the stack survived exactly one hit". `Inc. Damage Up` (+50
        // percentage points, `parsedEffects.incomingDamage`) is never consumed, so DERIVATION:
        //   sub-attack 0: plain 10,000, then lands the debuff
        //   sub-attack 1: 10,000 x (1 + 50%) = 15,000
        //   sub-attack 2: 15,000 as well — MEASURED, and deliberately not 20,000: re-applying the
        //     same buffName REFRESHES the timed payload rather than adding a second stack, so the
        //     amplification does not climb. The discriminator is that BOTH later sub-attacks are
        //     amplified while a per-cast landing leaves all three at the control's flat 10,000.
        // KILLED BY: the same three mutations as the test above.
        expect(
            deliveredDamagesOf(
                focusCast([afterDamage(3, INC_UP())], [enemyAt('victim', 'M4')]),
                'attacker'
            )
        ).toEqual([SLICE, 1.5 * SLICE, 1.5 * SLICE]);
    });
});

describe('PR8 — clause order within a sub-attack', () => {
    afterEach(() => resetRateGateRng());

    it('a clause written AFTER the damage clause misses its own sub-attack’s damage', () => {
        // The locked intra-cast rule, re-proved per sub-attack: sub-attack 0's damage must equal
        // the no-clause control's sub-attack 0 damage EXACTLY. DERIVATION as in the visibility
        // test: [10,000, 20,000], total 30,000 = 1.5x the control's 20,000.
        // THE RESIDUAL LEG is the strong discriminator (DEVIATION 3): sub-attack 1 spends the
        // stack sub-attack 0 left and lands a fresh one of its own, which nothing after it spends
        // — so the victim ends the cast holding EXACTLY 1. A total-damage assertion alone could be
        // produced by the wrong mechanism; the leftover stack pins the apply/ride/spend sequence.
        // KILLED BY: `sub.index < sel.scalars.hits - 1` forced to false (the residual then reads 2
        // — sub-attack 0's landing arrives at the historical flush, unspent, alongside sub-attack
        // 1's), by `applyDebuffsForSubAttack` returning [] (residual 1 but total 1.0x, not 1.5x),
        // and by no-oping `onSubAttackEnd`.
        const cast = focusCast([afterDamage(2, EXPOSED())], [enemyAt('victim', 'M4')]);
        const controlCast = focusCast([attackSkill(2)], [enemyAt('victim', 'M4')]);
        const delivered = deliveredDamagesOf(cast, 'attacker');
        const control = deliveredDamagesOf(controlCast, 'attacker');
        expect(delivered[0]).toBe(control[0]);
        expect(delivered[0]).toBe(SLICE);
        expect(sum(delivered)).toBe(1.5 * sum(control));
        expect(
            residualExposedStacks(
                focusCast(
                    [afterDamage(2, EXPOSED())],
                    [enemyAt('victim', 'M4')],
                    [residualProbeAlly()]
                )
            )
        ).toBe(1);
        // The probe ally reads 0 residual stacks on the no-clause control, so the 1 above is the
        // clause's leftover and not something the probe itself manufactures.
        expect(
            residualExposedStacks(
                focusCast([attackSkill(2)], [enemyAt('victim', 'M4')], [residualProbeAlly()])
            )
        ).toBe(0);
    });

    it('a clause written BEFORE the damage clause is folded into its own sub-attack’s damage', () => {
        // The debuff ability sits AHEAD of the damage ability in the slot's `abilities` array, so
        // `registerActorAbilityStatuses` never stamps `afterDamageClause` and each sub-attack
        // applies before computing its own damage. DERIVATION:
        //   sub-attack 0: applies, rides (10,000 x 2 = 20,000), spends
        //   sub-attack 1: applies, rides (20,000), spends
        //   cast total 40,000 = 2.0x the control's 20,000, and the victim ends holding 0 stacks.
        // The 0-residual is what separates this from the after-damage case's 1 — the two casts
        // deal 30,000 and 40,000 AND leave 1 and 0 stacks, so neither leg can be faked by the
        // other's mechanism.
        // KILLED BY: no-oping `onSubAttackStart` (sub-attack 1 then arms nothing and delivers a
        // plain 10,000, giving [20,000, 10,000] and a 1-stack residual), and by
        // `applyDebuffsForSubAttack` returning [].
        const cast = focusCast([beforeDamage(2, EXPOSED())], [enemyAt('victim', 'M4')]);
        const delivered = deliveredDamagesOf(cast, 'attacker');
        const control = deliveredDamagesOf(
            focusCast([attackSkill(2)], [enemyAt('victim', 'M4')]),
            'attacker'
        );
        expect(delivered).toEqual([2 * SLICE, 2 * SLICE]);
        expect(delivered[0]!).toBeGreaterThan(control[0]!);
        expect(sum(delivered)).toBe(2 * sum(control));
        expect(
            residualExposedStacks(
                focusCast(
                    [beforeDamage(2, EXPOSED())],
                    [enemyAt('victim', 'M4')],
                    [residualProbeAlly()]
                )
            )
        ).toBe(0);
    });
});

describe('PR8 — overkill retargeting', () => {
    afterEach(() => resetRateGateRng());

    /** Front victim sized BELOW one slice so sub-attack 0 kills it; the survivor behind it is at
     *  the full 10,000,000 and outlives all three slices. Column 4 is the FRONT, so `M4` dies and
     *  `front` re-resolves to `M3`. */
    const overkillCast = (hits: number) =>
        focusCast(
            [activeWithDebuffClause(hits)],
            [enemyAt('frontling', 'M4', [], 5_000), enemyAt('survivor', 'M3')]
        );

    it('when sub-attack 1 kills its victim, sub-attacks 2–3 land their stacks on the NEW victim and the dead one holds exactly one', () => {
        // DERIVATION: one plain slice delivers 10,000 against `frontling`'s 5,000 HP, so it dies
        // on sub-attack 0 having taken exactly one landing (the cast-time one). Sub-attacks 1 and
        // 2 re-resolve their own anchor, find `survivor` at the front, and land there — the
        // footprint `applyDebuffsForSubAttack` passes is the victims THAT sub-attack actually
        // struck, which is what makes retargeting correct for free.
        // ANTI-VACUITY: the survivor's count is asserted non-zero AND the total is asserted to be
        // 3, so a silently-dropped landing cannot pass by shifting a count from one victim to the
        // other. The N=1 control pins that the split only appears over a multi-hit cast.
        // KILLED BY: `applyDebuffsForSubAttack` returning [] (survivor drops to 0, total 1) and by
        // no-oping `onSubAttackEnd`. Forcing `sub.index < sel.scalars.hits - 1` to false leaves
        // the counts intact — this test is about WHO, not about when the state write lands.
        const counts = debuffApplicationsByTarget(overkillCast(3), 'Corrode');
        expect(counts.frontling).toBe(1);
        expect(counts.survivor).toBe(2);
        expect(counts.survivor).toBeGreaterThan(0);
        expect(sum(Object.values(counts))).toBe(3);

        const one = debuffApplicationsByTarget(overkillCast(1), 'Corrode');
        expect(one.frontling).toBe(1);
        expect(one.survivor).toBeUndefined();
    });
});

describe('PR8 — independent landing rolls', () => {
    afterEach(() => resetRateGateRng());

    it('with a landing chance below 1, the stack count varies across seeds', () => {
        // `liveDebuffLandingChance` is `clamp(effHacking - effSecurity, 0..100)/100`; the victim's
        // security defaults to 100, so `hacking: 150` makes the gate a genuine 50% draw
        // ((150-100)/100). A single draw shared by all three sub-attacks can only ever produce a
        // count of 0 or 3 — never 1 or 2 — so any count strictly between them disproves the
        // pre-PR8 single-draw model outright, however the RNG stream is seeded.
        //
        // MEASURED (throwaway probe, seeds 1-10 against this exact fixture): counts
        // [2,1,3,2,1,1,2,1,2,1]. Seed 1's `2` is pinned exactly below — an observation impossible
        // under a single per-cast draw — alongside the general sweep, so a future engine change
        // has to break BOTH the concrete seed and the search to pass.
        // KILLED BY: `applyDebuffsForSubAttack` returning [] (every seed collapses to 1 — only
        // the cast-time draw survives, so the distinct set has ONE member and no count exceeds 1)
        // and by no-oping `onSubAttackEnd`.
        const gated = (seed: number): number => {
            setupKeyedTestRng(seed);
            return debuffApplications(
                focusCast([activeWithDebuffClause(3)], [enemyAt('victim', 'M4')], [], 150),
                'Corrode',
                'victim'
            );
        };

        expect(gated(1)).toBe(2);

        const counts = new Set<number>();
        for (let seed = 1; seed <= 10; seed++) counts.add(gated(seed));
        expect(counts.size).toBeGreaterThan(1);
        const partial = [...counts].filter((c) => c > 0 && c < 3);
        expect(partial.length).toBeGreaterThan(0);
        expect(Math.max(...counts)).toBeLessThanOrEqual(3);
    });
});

describe('PR8 — team symmetry', () => {
    afterEach(() => resetRateGateRng());

    it('a WALKED TEAM ally’s multi-hit debuff clause lands per sub-attack', () => {
        // Same shape via the team path, not the focus path: the focus fires a zero-multiplier
        // no-op and the walked ally at M2 does the casting. Its `hacking` is raised to 100,000 for
        // the reason `teamActor` documents — at the default 0 the landing chance is 0 and this
        // test would read 0 for both legs and look like a passing regression.
        // KILLED BY: `applyDebuffsForSubAttack` returning [] and by no-oping `onSubAttackEnd`
        // (both collapse the 3 to 1). The N=1 leg is the fence that PR8 did not move N=1.
        const build = (hits: number) =>
            focusCast(
                [noopActive],
                [enemyAt('victim', 'M4')],
                [teamActor('ally', 'M2', [activeWithDebuffClause(hits)], 5000, 100_000)]
            );
        expect(debuffApplications(build(3), 'Corrode', 'victim')).toBe(3);
        expect(debuffApplications(build(1), 'Corrode', 'victim')).toBe(1);
    });

    it('an ENEMY attacker’s multi-hit debuff clause lands per sub-attack on a player victim', () => {
        // The enemy site is the one that has twice silently dropped a mechanic (#305, #306), so it
        // gets its own mirror rather than being assumed side-agnostic. Everything asserted here is
        // read WITHIN the enemy side (the foe's own `debuff-applied` count) — the RNG is keyed by
        // ownerId, so comparing this cast's amounts against the player-side fixture's would be
        // meaningless.
        // KILLED BY: `applyDebuffsForSubAttack` returning [] and by no-oping `onSubAttackEnd`.
        const build = (hits: number) =>
            focusCast(
                [noopActive],
                [offensiveEnemy('foe', 'M1', [activeWithDebuffClause(hits)])],
                [teamActor('pvictim', 'M4', [])]
            );
        expect(debuffApplications(build(3), 'Corrode', 'pvictim')).toBe(3);
        expect(debuffApplications(build(1), 'Corrode', 'pvictim')).toBe(1);
    });
});

describe('PR8 — sub-attack 0 recipient equivalence', () => {
    afterEach(() => resetRateGateRng());

    it('sub-attack 0’s recipients equal the cast-time recipients (the k=0 cast-time draw is not a compatibility hack)', () => {
        // Decision 3 keeps the CAST-TIME landing draw for sub-attack 0 rather than re-rolling it
        // through `applyDebuffsForSubAttack`, on the grounds that `selectTurnTarget` and iteration
        // 0's `resolvePositionalTarget` resolve the same anchor. That is asserted here, not
        // assumed: the first `debuff-applied` (resolved from the cast's own `targetId`) must name
        // the same victim the positional walk's iteration-0 `attacked` struck, and the same victim
        // the cast's `ability-performed` reports as its primary target — three independently
        // resolved paths agreeing on one id, which is exactly the claim.
        //
        // The OVERKILL fixture is what makes this discriminating rather than tautological. With
        // both enemies alive every sub-attack resolves the same anchor, so dropping sub-attack 0's
        // landing entirely would still leave `frontling` as the first name. Sizing `frontling`
        // below one slice means sub-attacks 1 and 2 resolve `survivor` instead, so if the k=0
        // draw were absent or resolved off a later anchor the first `debuff-applied` would read
        // `survivor` and this test goes red.
        // KILLED BY: passing `anchorId: undefined` at the cast-time
        // `resolveDebuffRecipientIds` call (playerTurn.ts ~1748) — sub-attack 0 then lands
        // nothing and the first `debuff-applied` names `survivor`. ALSO killed (measured, not
        // predicted) by forcing `sub.index < sel.scalars.hits - 1` to false: sub-attack 0's
        // landing is then left to the historical post-walk flush instead of being buffered into
        // sub-attack 0's emission step, so sub-attack 1's `survivor` landing is emitted FIRST.
        const overkill = firstNamedVictims(
            focusCast(
                [activeWithDebuffClause(3)],
                [enemyAt('frontling', 'M4', [], 5_000), enemyAt('survivor', 'M3')]
            ),
            'Corrode'
        );
        expect(overkill.debuffed).toBe('frontling');
        expect(overkill.struck).toBe('frontling');
        expect(overkill.cast).toBe('frontling');

        // The brief's own literal shape, with both enemies surviving: `front` is column 4, so the
        // three paths must agree on `frontling` here too.
        const bothAlive = firstNamedVictims(
            focusCast(
                [activeWithDebuffClause(3)],
                [enemyAt('frontling', 'M4'), enemyAt('survivor', 'M3')]
            ),
            'Corrode'
        );
        expect(bothAlive.debuffed).toBe('frontling');
        expect(bothAlive.struck).toBe('frontling');
        expect(bothAlive.cast).toBe('frontling');
    });
});
