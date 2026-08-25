/**
 * #398 — an ENEMY-APPLIED stat debuff must actually change its victim's stat.
 *
 * ── THE BUG THIS FILE PINS ────────────────────────────────────────────────────────────────────
 * Five debuff families — `Crit Rate Down`, `Crit Power Down`, `Speed Down`, `Hacking Down`,
 * `Security Down`, carried by 17 corpus ships — landed in the per-victim ENEMY store, displayed,
 * ticked down and changed NOTHING. `foldActorBuffTotals` read only two sources (the scheduled
 * self-buffs and `timedAbilityStatuses('self', …)`), and the damage path
 * (`effectiveDamageStatsOf`) folded only self-sourced layers. Neither read the enemy store, so
 * these five `parsedEffects` keys were DEAD there — rung 3 of the same ladder as #389
 * (attack/outgoingDamage) and #396 (defense/incomingDamage/heal).
 *
 * ── WHY NO SYMMETRY WORK CAUGHT IT ────────────────────────────────────────────────────────────
 * The defect is PERFECTLY SYMMETRIC. `foldActorBuffTotals` is keyed by `actorId` and reads the
 * same sources regardless of side, so the channel was dead identically for a player ship and an
 * enemy ship. A team-symmetry oracle asks "does the player side behave like the enemy side?" and
 * the honest answer was *yes*. Symmetry oracles find asymmetries; this is a symmetric ABSENCE.
 * The side axis (who HOLDS a status) and the store axis (who APPLIED it) are independent — see
 * `enemyStoreChannelCoverage.test.ts` for the locked rule and the standing tripwire.
 *
 * ── THE THREE-ARM DESIGN, AND WHY THE SELF ARM IS NOT DECORATION ──────────────────────────────
 * Every channel runs three arms of the SAME fixture:
 *
 *   CONTROL — the applier casts an inert marker carrying no `parsedEffects` at all.
 *   ENEMY   — the payload cast at `target: 'enemy'`, landing in the per-victim ENEMY store.
 *   SELF    — the byte-identical payload on the victim's OWN passive slot (the SELF store).
 *
 * The SELF arm is the INSTRUMENT VALIDATION. #398's first probe reported five clean zeros and was
 * blind: the enemy store was empty, so the zeros measured the probe's own registration rather than
 * the engine. An observable that does not move under the self-applied payload cannot testify about
 * the enemy-applied one. Every test here therefore also asserts store membership off the LIVE
 * status engine (`__testTapStatusEngine`), so a null result can never be "it never landed".
 *
 * ── MAGNITUDE, NOT DIRECTION ──────────────────────────────────────────────────────────────────
 * `crit`, `critDamage` and `security` are folded at TWO sites (the status-mode fold and the turn
 * loop's late `shadowedDelta`). A consumer that summed both would double the debuff. So the damage
 * assertions are exact numbers, never "less than baseline": with `critDamage: 200` a crit deals 3x
 * the base hit, so 3 crits = 90,000 and 3 non-crits = 30,000, and a doubled `Crit Power Down III`
 * would land on 30,000 where the correct answer is 60,000. A doubling has to FAIL, not merely look
 * plausible.
 *
 * ── BOTH SIDES, ALWAYS ────────────────────────────────────────────────────────────────────────
 * Every behavioural claim runs with the victim on the player side AND on the enemy side. The enemy
 * store is keyed by victim id regardless of side, so a one-sided fixture is half a test.
 *
 * NO RNG SEEDING is needed: `crit: 0` on every non-crit role removes the crit stream, the crit
 * fixtures sit at the deterministic extremes (100 → always, 0 → never), and
 * `application: 'apply'` skips the landing roll everywhere except the two fixtures that are
 * MEASURING the landing roll, which are pinned to chance 1.0 / 0.0 rather than to a seed.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { effectiveStatsOf } from '../effectiveStats';
import { createEventBus, type CombatEvent } from '../events';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedBuffEffects, SelectedGameBuff } from '../../../types/calculator';
import type { CombatActor } from '../state';
import type { StatusEngine } from '../statusEngine';
import type { Position } from '../../../types/encounters';

/** The focus attacker's engine id is always `'attacker'`; whichever role is the focus answers to
 *  it. Kept as a named constant so the turn-order assertions read by ROLE, not by that accident. */
const FOCUS_ID = 'attacker';
const VICTIM_ID = 'victim';
const RIVAL_ID = 'rival';
const APPLIER_ID = 'applier';
const PRE_APPLIER_ID = 'pre-applier';

/** The marker a CONTROL run plants through the identical cast path, carrying no effects — so a
 *  comparison isolates the payload and nothing else about the run (not the cast, not the landing
 *  roll, not the turn order). */
const CONTROL_NAME = 'Inert Marker';
/** The debuff whose LANDING is the observable in the hacking/security fixtures. */
const PROBE_DEBUFF = 'Probe Landing Marker';

const BIG_HP = 10_000_000;

// ── Ability factories ─────────────────────────────────────────────────────────────────────────

/** A plain on-cast enemy debuff, landing through the per-victim `applyTimedAbilityStatus` seam.
 *  `application: 'apply'` always lands, so nothing here depends on the hacking-vs-security roll —
 *  except where `application` is overridden to `'inflict'` precisely to measure that roll. */
const enemyCast = (
    buffName: string,
    parsedEffects: ParsedBuffEffects = {},
    application: 'apply' | 'inflict' = 'apply'
): Ability => ({
    id: `cast-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects,
        stacks: 1,
        isStackable: false,
        duration: 10,
        application,
    },
});

/** The SELF-arm twin: the same payload granted from the victim's own PASSIVE slot, so it is
 *  standing from combat start (`seedPassiveTimedStatuses`) rather than from the victim's own first
 *  cast — a buff applied during a turn is not in that turn's own fold. */
const selfGrant = (buffName: string, parsedEffects: ParsedBuffEffects): Ability => ({
    id: `self-${buffName}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'buff', buffName, parsedEffects, stacks: 1, isStackable: false, duration: 10 },
});

const damageAbility = (multiplier: number): Ability => ({
    id: 'dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

const activeSlot = (abilities: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities,
});
const passiveSlot = (abilities: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities,
});

// ── Roster builders ───────────────────────────────────────────────────────────────────────────

/** One role, independent of which side it ends up on — so the two side arms build the SAME three
 *  roles with the same speeds, positions and stats, and their results are directly comparable. */
interface Role {
    id: string;
    position: Position;
    speed: number;
    hp: number;
    attack?: number;
    crit?: number;
    critDamage?: number;
    hacking?: number;
    security?: number;
    slots?: ShipSkills['slots'];
}

// ⚠️ A DIRECT-ENGINE test MUST supply the `walk` bundle itself: normalizeTeamActorsToWalked
// synthesizes NEUTRAL_WALK_STATS with hp: 1 for a team actor arriving without one, silently
// discarding a bare `stats.hp`.
const asTeamActor = (r: Role): TeamActorEngineInput => ({
    id: r.id,
    speed: r.speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: r.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: { slots: r.slots ?? [] },
        stats: {
            attack: r.attack ?? 0,
            crit: r.crit ?? 0,
            critDamage: r.critDamage ?? 0,
            defensePenetration: 0,
            hacking: r.hacking ?? 100_000,
            security: r.security ?? 0,
            defence: 0,
            hp: r.hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const asEnemy = (r: Role): NonNullable<CombatEngineInput['enemyAttackers']>[number] => ({
    id: r.id,
    stats: {
        attack: r.attack ?? 0,
        crit: r.crit ?? 0,
        critDamage: r.critDamage ?? 0,
        defence: 0,
        hp: r.hp,
        speed: r.speed,
        hacking: r.hacking ?? 100_000,
        security: r.security ?? 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: r.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: r.slots ?? [] },
});

// ── The fixture ───────────────────────────────────────────────────────────────────────────────

type Arm = 'control' | 'enemy' | 'self';
type Side = 'player' | 'enemy';

interface ChannelSpec {
    name: string;
    /** The family whose payload is under test. Tier suffix matters: `deriveFamilyKey` reads it. */
    buffName: string;
    payload: ParsedBuffEffects;
    /** Stats the VICTIM needs for this channel's observable. */
    victim: Pick<Role, 'attack' | 'crit' | 'critDamage' | 'hacking' | 'security'>;
    /** The victim's own ACTIVE slot — a damage ability for the crit channels, an `inflict` cast
     *  for the hacking channel, nothing for the rest. */
    victimActive?: Ability[];
    /** Casts the primary applier makes AFTER the payload (the security channel's landing probe). */
    applierExtra?: Ability[];
    applierHacking?: number;
    applierSecurity?: number;
    /** When set, the payload is cast by a SEPARATE, FASTER applier so it is standing a whole turn
     *  before `applierExtra` fires — the security fixture needs that ordering, because a payload
     *  and a landing probe in ONE cast would race the intra-cast clause order. */
    payloadFromPreApplier?: boolean;
}

interface Run {
    /** Per-round turn order of the victim's OWN side, appliers dropped — the speed observable. */
    order: string[][];
    /** Buff names standing in the victim's per-victim ENEMY store, read off the LIVE engine. */
    victimEnemyStore: string[];
    /** Buff names standing in the victim's own SELF store. */
    victimSelfStore: string[];
    /** Buff names in the APPLIER's enemy store — where the victim's own `inflict` cast lands, so
     *  this is the hacking-channel observable. */
    applierEnemyStore: string[];
    /** Direct damage the VICTIM dealt, and how many of its hits crit. */
    victimDamage: number;
    victimCrits: number;
}

function run(spec: ChannelSpec, arm: Arm, side: Side): Run {
    const payloadCast =
        arm === 'enemy' ? enemyCast(spec.buffName, spec.payload) : enemyCast(CONTROL_NAME);

    const victim: Role = {
        id: VICTIM_ID,
        // `front` binds to the FRONT-MOST cell (M4), so the victim stands there and the applier's
        // targeting cannot drift onto the rival.
        position: 'M4',
        speed: 500,
        hp: BIG_HP,
        ...spec.victim,
        slots: [
            ...(spec.victimActive ? [activeSlot(spec.victimActive)] : []),
            ...(arm === 'self' ? [passiveSlot([selfGrant(spec.buffName, spec.payload)])] : []),
        ],
    };
    // Slower than the victim's 500, faster than a halved 250 — so the order between the two IS the
    // speed reading, in both directions.
    const rival: Role = { id: RIVAL_ID, position: 'M1', speed: 400, hp: BIG_HP };

    const applier: Role = {
        id: APPLIER_ID,
        position: 'M1',
        speed: 950,
        hp: BIG_HP,
        hacking: spec.applierHacking ?? 100,
        security: spec.applierSecurity ?? 0,
        slots: [
            activeSlot([
                ...(spec.payloadFromPreApplier ? [] : [payloadCast]),
                ...(spec.applierExtra ?? []),
            ]),
        ],
    };
    const preApplier: Role = {
        id: PRE_APPLIER_ID,
        position: 'M2',
        speed: 990,
        hp: BIG_HP,
        hacking: spec.applierHacking ?? 100,
        security: spec.applierSecurity ?? 0,
        slots: [activeSlot([payloadCast])],
    };
    const appliers = spec.payloadFromPreApplier ? [applier, preApplier] : [applier];

    let statusEngine: StatusEngine | undefined;
    const bus = createEventBus();
    const turns: Extract<CombatEvent, { type: 'turn-started' }>[] = [];
    const attacks: Extract<CombatEvent, { type: 'attacked' }>[] = [];
    bus.on('turn-started', (e) => turns.push(e));
    bus.on('attacked', (e) => attacks.push(e));

    const common = {
        numRounds: 3,
        bus,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        defensePenetration: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        chargeCount: 0,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        __testTapStatusEngine: (e: StatusEngine) => {
            statusEngine = e;
        },
    };

    // The FOCUS is always a role that is NOT the victim, so nothing below can be an artefact of
    // the victim happening to be the focus actor.
    //   victim player-side → the RIVAL is the focus, the victim is a team actor, and every applier
    //                        is an enemy.
    //   victim enemy-side  → the primary APPLIER is the focus, the victim + rival are enemies, and
    //                        any extra applier becomes a player TEAM ACTOR.
    //
    // ⚠️ That last clause is load-bearing and was a real fixture bug: leaving the pre-applier among
    // the enemies puts it on the VICTIM'S OWN SIDE, where its `target: 'enemy'` cast aims at the
    // player instead and the payload never reaches the victim at all. An applier must always be
    // opposite its victim.
    const focus: Role = side === 'player' ? rival : applier;
    const extraAppliers = appliers.filter((a) => a.id !== focus.id);
    const input: CombatEngineInput = {
        ...common,
        attack: focus.attack ?? 0,
        crit: focus.crit ?? 0,
        critDamage: focus.critDamage ?? 0,
        defence: 0,
        hp: focus.hp,
        speed: focus.speed,
        position: focus.position,
        hacking: focus.hacking ?? 100_000,
        security: focus.security ?? 0,
        shipSkills: { slots: focus.slots ?? [] },
        teamActors: side === 'player' ? [asTeamActor(victim)] : extraAppliers.map(asTeamActor),
        enemyAttackers:
            side === 'player' ? appliers.map(asEnemy) : [asEnemy(victim), asEnemy(rival)],
    };

    runCombat(input);

    // The focus answers to FOCUS_ID inside the engine; map it back to its role name so the
    // turn-order expectations read by role on both arrangements.
    const roleOf = (actorId: string): string => (actorId === FOCUS_ID ? focus.id : actorId);
    const applierIds = new Set(appliers.map((a) => a.id));
    const byRound = new Map<number, string[]>();
    for (const e of turns) {
        const role = roleOf(e.actorId);
        if (applierIds.has(role)) continue;
        const list = byRound.get(e.round) ?? [];
        list.push(role);
        byRound.set(e.round, list);
    }

    const victimHits = attacks.filter((a) => roleOf(a.attackerId) === VICTIM_ID);
    const namesIn = (read: () => { payload: { buffName: string } }[]): string[] =>
        read().map((s) => s.payload.buffName);

    return {
        order: [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l),
        victimEnemyStore: namesIn(() =>
            statusEngine!.timedAbilityStatuses('enemy', undefined, VICTIM_ID)
        ),
        victimSelfStore: namesIn(() => statusEngine!.timedAbilityStatuses('self', VICTIM_ID)),
        applierEnemyStore: namesIn(() =>
            statusEngine!.timedAbilityStatuses(
                'enemy',
                undefined,
                side === 'player' ? APPLIER_ID : FOCUS_ID
            )
        ),
        victimDamage: victimHits.reduce((n, a) => n + (a.damage ?? 0), 0),
        victimCrits: victimHits.filter((a) => a.didCrit).length,
    };
}

const SIDES = ['player', 'enemy'] as const;

// ── The channel specs ─────────────────────────────────────────────────────────────────────────

/** A pure speed role: nothing but a speed to be reduced. */
const SPEED_SPEC: ChannelSpec = {
    name: 'speed',
    buffName: 'Speed Down II',
    payload: { speed: -50 },
    victim: {},
};

// ── 1. speed — the turn-order channel ─────────────────────────────────────────────────────────

describe.each(SIDES)('#398 speed channel — victim on the %s side', (side) => {
    it('an enemy-applied Speed Down II slips the victim behind a slower rival', () => {
        const control = run(SPEED_SPEC, 'control', side);
        const enemy = run(SPEED_SPEC, 'enemy', side);
        const self = run(SPEED_SPEC, 'self', side);

        // The status really landed in the store the fold must read. Without this, a null result
        // below would be indistinguishable from "the debuff never applied" — which is exactly the
        // blind probe #398 was originally filed with.
        expect(enemy.victimEnemyStore).toContain('Speed Down II');
        expect(self.victimSelfStore).toContain('Speed Down II');

        // Baseline: the victim (500) outranks the rival (400) every round.
        expect(control.order).toHaveLength(3);
        for (const round of control.order) expect(round).toEqual([VICTIM_ID, RIVAL_ID]);

        // Enemy-applied -50% → effective 250 → the rival now goes first. Asserted from round 2 so
        // the claim does not depend on where in round 1 the applier's own turn fell.
        expect(enemy.order[1]).toEqual([RIVAL_ID, VICTIM_ID]);
        expect(enemy.order[2]).toEqual([RIVAL_ID, VICTIM_ID]);

        // INSTRUMENT VALIDATION: the identical payload self-applied moves the same observable. If
        // this arm is green while the enemy arm is red, the fold is broken; if BOTH are green only
        // because the observable cannot move, this arm would have caught it.
        expect(self.order[1]).toEqual([RIVAL_ID, VICTIM_ID]);

        // And the enemy arm is a genuine divergence from its own control, not a coincidence.
        expect(enemy.order[1]).not.toEqual(control.order[1]);
    });
});

// ── 2. hacking — the victim's OWN debuffs stop landing ────────────────────────────────────────

/** The victim casts an `inflict` debuff at the applier. Landing chance is
 *  `clamp(effHacking - effSec, 0, 100) / 100`, so victim hacking 200 vs applier security 100 gives
 *  a certain 100% — and `Hacking Down II` at -150 gives 50 - 100 → clamped 0, a certain miss. Both
 *  ends are deterministic, so no RNG seed is involved in either arm. */
const HACKING_SPEC: ChannelSpec = {
    name: 'hacking',
    buffName: 'Hacking Down II',
    payload: { hacking: -150 },
    victim: { hacking: 200 },
    victimActive: [enemyCast(PROBE_DEBUFF, {}, 'inflict')],
    applierHacking: 100,
    applierSecurity: 100,
};

describe.each(SIDES)('#398 hacking channel — victim on the %s side', (side) => {
    it("an enemy-applied Hacking Down II stops the victim's own debuff landing", () => {
        const control = run(HACKING_SPEC, 'control', side);
        const enemy = run(HACKING_SPEC, 'enemy', side);
        const self = run(HACKING_SPEC, 'self', side);

        expect(enemy.victimEnemyStore).toContain('Hacking Down II');
        expect(self.victimSelfStore).toContain('Hacking Down II');

        // Baseline: hacking 200 vs security 100 → chance 1.0 → the victim's inflict lands.
        expect(control.applierEnemyStore).toContain(PROBE_DEBUFF);
        // -150 → 50 - 100 → clamped 0 → it can never land.
        expect(enemy.applierEnemyStore).not.toContain(PROBE_DEBUFF);
        // INSTRUMENT VALIDATION: the self-applied twin suppresses it too.
        expect(self.applierEnemyStore).not.toContain(PROBE_DEBUFF);
    });
});

// ── 3. security — debuffs stop landing ON the victim ──────────────────────────────────────────

/** The mirror of the hacking fixture, on the defender's half of the same comparison: applier
 *  hacking 100 vs victim security 0 → a certain 100%, and +200 security → 100 - 200 → clamped 0,
 *  a certain miss.
 *
 *  ⚠️ The payload comes from a SEPARATE, FASTER applier (`payloadFromPreApplier`). A payload and a
 *  landing probe in ONE cast would race the intra-cast clause order — clauses resolve in written
 *  order, so whether the probe's roll sees the just-applied security change would be the thing
 *  under test rather than the fold. Splitting them across two turns removes that variable. */
const SECURITY_LANDING_SPEC: ChannelSpec = {
    name: 'security-landing',
    buffName: 'Security Up (probe)',
    payload: { security: 200 },
    victim: { security: 0 },
    applierExtra: [enemyCast(PROBE_DEBUFF, {}, 'inflict')],
    applierHacking: 100,
    applierSecurity: 0,
    payloadFromPreApplier: true,
};

describe.each(SIDES)('#398 security channel — landing, victim on the %s side', (side) => {
    it('an enemy-applied security change stops a debuff landing on the victim', () => {
        const control = run(SECURITY_LANDING_SPEC, 'control', side);
        const enemy = run(SECURITY_LANDING_SPEC, 'enemy', side);
        const self = run(SECURITY_LANDING_SPEC, 'self', side);

        expect(enemy.victimEnemyStore).toContain('Security Up (probe)');
        expect(self.victimSelfStore).toContain('Security Up (probe)');

        // Baseline: hacking 100 vs security 0 → chance 1.0 → the probe lands on the victim.
        expect(control.victimEnemyStore).toContain(PROBE_DEBUFF);
        // +200 security → 100 - 200 → clamped 0 → it cannot.
        expect(enemy.victimEnemyStore).not.toContain(PROBE_DEBUFF);
        // INSTRUMENT VALIDATION.
        expect(self.victimEnemyStore).not.toContain(PROBE_DEBUFF);
    });
});

// ── 4. crit + critDamage — the damage-path channels ───────────────────────────────────────────

/** A damage-dealing victim pinned to the DETERMINISTIC ENDS of the crit gate: `crit: 100` crits
 *  every hit and `crit: 0` never does, so neither arm needs an RNG seed. `critDamage: 200` makes a
 *  crit deal 3x the base hit (1 + 200/100), which is what turns the assertions below into exact
 *  numbers rather than inequalities. */
const DEALER = { attack: 10_000, crit: 100, critDamage: 200 } as const;
/** One base (non-crit) hit, three rounds: 10,000 × 100% × 3. */
const THREE_PLAIN_HITS = 30_000;
/** Three crits at critDamage 200 → 3x each. */
const THREE_CRITS = 90_000;
/** Three crits at critDamage 100 (i.e. 200 − 100) → 2x each. */
const THREE_HALVED_CRITS = 60_000;

const CRIT_SPEC: ChannelSpec = {
    name: 'crit',
    buffName: 'Crit Rate Down III',
    payload: { crit: -100 },
    victim: DEALER,
    victimActive: [damageAbility(100)],
};

const CRIT_DAMAGE_SPEC: ChannelSpec = {
    name: 'critDamage',
    buffName: 'Crit Power Down III',
    payload: { critDamage: -100 },
    victim: DEALER,
    victimActive: [damageAbility(100)],
};

describe.each(SIDES)('#398 crit channel — victim on the %s side', (side) => {
    it('an enemy-applied Crit Rate Down III takes the victim off 100% crit', () => {
        const control = run(CRIT_SPEC, 'control', side);
        const enemy = run(CRIT_SPEC, 'enemy', side);
        const self = run(CRIT_SPEC, 'self', side);

        expect(enemy.victimEnemyStore).toContain('Crit Rate Down III');
        expect(self.victimSelfStore).toContain('Crit Rate Down III');

        expect(control.victimCrits).toBe(3);
        expect(enemy.victimCrits).toBe(0);
        expect(self.victimCrits).toBe(0);

        // MAGNITUDE, not direction — the debuff is applied ONCE. A doubled fold still clamps crit
        // to 0 here, which is why the crit-DAMAGE test below is the one that catches a doubling;
        // this one pins that the crit channel reaches the roll at all.
        expect(control.victimDamage).toBe(THREE_CRITS);
        expect(enemy.victimDamage).toBe(THREE_PLAIN_HITS);
        expect(enemy.victimDamage).toBe(self.victimDamage);
    });
});

describe.each(SIDES)('#398 critDamage channel — victim on the %s side', (side) => {
    it('an enemy-applied Crit Power Down III cuts crit damage by exactly its value', () => {
        const control = run(CRIT_DAMAGE_SPEC, 'control', side);
        const enemy = run(CRIT_DAMAGE_SPEC, 'enemy', side);
        const self = run(CRIT_DAMAGE_SPEC, 'self', side);

        expect(enemy.victimEnemyStore).toContain('Crit Power Down III');
        expect(self.victimSelfStore).toContain('Crit Power Down III');

        // The crit RATE is untouched — only the multiplier moves.
        expect(control.victimCrits).toBe(3);
        expect(enemy.victimCrits).toBe(3);

        // THE DOUBLE-COUNT GUARD. critDamage 200 → 90,000; a correctly-applied −100 → 100 → 60,000.
        // A fold applied TWICE would give 200 − 200 = 0 → 30,000, which this rejects outright.
        expect(control.victimDamage).toBe(THREE_CRITS);
        expect(enemy.victimDamage).toBe(THREE_HALVED_CRITS);
        expect(enemy.victimDamage).toBe(self.victimDamage);
    });
});

// ── 5. security — the DAMAGE BASIS (owner ruling R3) ──────────────────────────────────────────

/**
 * `Security Down` is ONE stat with TWO effects (owner ruling): it raises how easily debuffs land on
 * the victim (section 3) AND cuts the victim's security-scaled damage. The in-corpus matchup is
 * real: Tygr's active inflicts `Security Down II`, and Prophet's active deals "damage equal to 50x
 * its security" (carried as `additional-damage` with `pct: 5000`, divided by 100 like every other
 * basis → security × 50).
 *
 * This needs its own fixture rather than the shared harness above: the secondary-damage total is
 * exposed as `rawTotals.totalSecondary`, which is FOCUS-ONLY, so the Prophet role has to BE the
 * focus in the player-side direction. The enemy-side direction therefore reads the mirror instead —
 * the HP the enemy Prophet strips off the player focus — which is the same quantity seen from the
 * receiving end.
 */
const SECURITY_BASE = 1_000;
const SECURITY_DEBUFF = -400;
const SECURITY_MULTIPLE = 50; // Prophet's "50x", i.e. pct 5000 / 100
const ROUNDS = 3;
const FULL_SECONDARY = SECURITY_BASE * SECURITY_MULTIPLE * ROUNDS; // 150,000
const DEBUFFED_SECONDARY = (SECURITY_BASE + SECURITY_DEBUFF) * SECURITY_MULTIPLE * ROUNDS; // 90,000

/** Prophet's clause: pure stat-scaled damage, no percentage-of-attack component at all. */
const securityBasisDamage = (): Ability => ({
    id: 'ab-security-basis',
    type: 'additional-damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'additional-damage', stat: 'security', pct: SECURITY_MULTIPLE * 100 },
});

const securityDownCast = (arm: Arm): Ability =>
    arm === 'enemy'
        ? enemyCast('Security Down II', { security: SECURITY_DEBUFF })
        : enemyCast(CONTROL_NAME);

describe('#398 security channel — the damage basis (ruling R3)', () => {
    /** Player-side Prophet: it is the focus, so its secondary total is `rawTotals.totalSecondary`. */
    const playerSideSecondary = (arm: Arm): number => {
        const prophetSlots: ShipSkills['slots'] = [
            activeSlot([securityBasisDamage()]),
            ...(arm === 'self'
                ? [passiveSlot([selfGrant('Security Down II', { security: SECURITY_DEBUFF })])]
                : []),
        ];
        const result = runCombat({
            numRounds: ROUNDS,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            defensePenetration: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            chargeCount: 0,
            target: parseTarget('front'),
            pattern: parsePattern('Pattern-Base'),
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: BIG_HP,
            speed: 500,
            position: 'M4',
            hacking: 100_000,
            security: SECURITY_BASE,
            shipSkills: { slots: prophetSlots },
            teamActors: [],
            enemyAttackers: [
                asEnemy({
                    id: APPLIER_ID,
                    position: 'M1',
                    speed: 950, // acts first, so the debuff is standing before Prophet fires
                    hp: BIG_HP,
                    hacking: 100_000,
                    slots: [activeSlot([securityDownCast(arm)])],
                }),
            ],
        });
        return result.rawTotals.totalSecondary;
    };

    it('an enemy-applied Security Down cuts security-scaled damage proportionally', () => {
        // 1000 security × 50 × 3 rounds = 150,000; −400 → 600 × 50 × 3 = 90,000.
        // A DOUBLED fold would give 200 × 50 × 3 = 30,000, which this rejects.
        expect(playerSideSecondary('control')).toBeCloseTo(FULL_SECONDARY, 6);
        expect(playerSideSecondary('enemy')).toBeCloseTo(DEBUFFED_SECONDARY, 6);
        // INSTRUMENT VALIDATION: the self-applied twin moves the same number.
        expect(playerSideSecondary('self')).toBeCloseTo(DEBUFFED_SECONDARY, 6);
    });

    it('holds with the Prophet role on the ENEMY side (team symmetry)', () => {
        // Mirror: the enemy Prophet strips the same secondary damage off the PLAYER focus, so the
        // HP the focus loses IS the quantity under test, seen from the receiving end. The focus is
        // the applier here, so the Security Down still crosses the store boundary onto Prophet.
        const focusHpLoss = (arm: Arm): number => {
            let focus: { currentHp: number } | undefined;
            runCombat({
                numRounds: ROUNDS,
                selfBuffs: [],
                enemyDebuffs: [],
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                hasChargedSkill: false,
                startCharged: false,
                defensePenetration: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                chargeCount: 0,
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                attack: 0,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: BIG_HP,
                speed: 950, // the applier acts first
                position: 'M1',
                hacking: 100_000,
                security: 0,
                shipSkills: { slots: [activeSlot([securityDownCast(arm)])] },
                teamActors: [],
                enemyAttackers: [
                    asEnemy({
                        id: VICTIM_ID,
                        position: 'M4', // front-most, so the applier's `front` targeting binds here
                        speed: 500,
                        hp: BIG_HP,
                        security: SECURITY_BASE,
                        hacking: 100_000,
                        slots: [activeSlot([securityBasisDamage()])],
                    }),
                ],
                __testTapActors: (actors) => {
                    focus = actors.find((a) => a.id === FOCUS_ID);
                },
            });
            return BIG_HP - focus!.currentHp;
        };

        expect(focusHpLoss('control')).toBeCloseTo(FULL_SECONDARY, 6);
        expect(focusHpLoss('enemy')).toBeCloseTo(DEBUFFED_SECONDARY, 6);
    });
});

// ── 6. cross-store shadowing on the newly-live channels ──────────────────────────────────────

/**
 * Switching on a dead channel without shadowing would make a self-inflicted and an enemy-applied
 * instance of ONE family ADD, which the locked ruling forbids: the strongest single instance of a
 * named family applies and weaker instances are shadowed, REGARDLESS of which side applied it.
 * Only DoTs and bombs stack, and `deriveFamilyKey` already excludes those by giving each tier its
 * own family key.
 *
 * ⚠️ THE FIXTURE MUST BE BUILT FROM BUFF LISTS, NOT SHIP KITS. A probe over all 149 corpus ships
 * found ZERO families granted from both a self-targeted and an enemy-targeted ability, on every
 * channel — so a straddle assembled out of real kits does not exist and the test would be
 * vacuously green. The straddle is user-reachable through the pickers instead.
 *
 * Read numerically off `effectiveStatsOf`, the production accessor the engine's own turn ordering
 * uses, because turn order alone cannot separate all three outcomes (-50 shadowed, -70 summed and
 * -20 own-only would need three different rival speeds to distinguish).
 */
describe('#398 — cross-store shadowing on the newly-live channels', () => {
    const VICTIM_BASE_SPEED = 500;

    /** Grants `own` on the victim's own passive slot and has the applier cast `applied` at it, then
     *  reads the victim's live effective speed. `selfBuffLookup` is empty because the fixture has
     *  no SCHEDULED buffs (`selfBuffs: []`) — the same input the engine's own fold would expand. */
    const shadowedSpeed = (
        own: { name: string; speed: number } | undefined,
        applied: { name: string; speed: number }
    ): number => {
        let statusEngine: StatusEngine | undefined;
        let victimActor: CombatActor | undefined;
        runCombat({
            numRounds: 2,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            defensePenetration: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            chargeCount: 0,
            target: parseTarget('front'),
            pattern: parsePattern('Pattern-Base'),
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: BIG_HP,
            speed: 400,
            position: 'M1',
            hacking: 100_000,
            shipSkills: { slots: [] },
            teamActors: [
                asTeamActor({
                    id: VICTIM_ID,
                    position: 'M4',
                    speed: VICTIM_BASE_SPEED,
                    hp: BIG_HP,
                    slots: own ? [passiveSlot([selfGrant(own.name, { speed: own.speed })])] : [],
                }),
            ],
            enemyAttackers: [
                asEnemy({
                    id: APPLIER_ID,
                    position: 'M1',
                    speed: 950,
                    hp: BIG_HP,
                    hacking: 100_000,
                    slots: [activeSlot([enemyCast(applied.name, { speed: applied.speed })])],
                }),
            ],
            __testTapStatusEngine: (e) => {
                statusEngine = e;
            },
            __testTapActors: (actors) => {
                victimActor = actors.find((a) => a.id === VICTIM_ID);
            },
        });
        return effectiveStatsOf(statusEngine!, new Map<string, SelectedGameBuff[]>(), victimActor!)
            .speed;
    };

    it('a stronger APPLIED tier wins over the victim own weaker instance', () => {
        // own `Speed Down I` (-20) vs applied `Speed Down II` (-50) → -50, NOT the -70 sum.
        expect(
            shadowedSpeed(
                { name: 'Speed Down I', speed: -20 },
                { name: 'Speed Down II', speed: -50 }
            )
        ).toBe(250);
    });

    it('the victim own STRONGER instance wins over a weaker applied one', () => {
        // own -50 stands and the applied -20 is shadowed away → still -50, not -70 and not -20.
        expect(
            shadowedSpeed(
                { name: 'Speed Down II', speed: -50 },
                { name: 'Speed Down I', speed: -20 }
            )
        ).toBe(250);
    });

    it('an applied family the victim does not carry at all applies in full', () => {
        expect(shadowedSpeed(undefined, { name: 'Speed Down II', speed: -50 })).toBe(250);
    });

    it('DIFFERENT families on one channel still combine additively', () => {
        // Shadowing is per NAMED family, never per channel: -20 and -30 from two different families
        // sum to -50. Collapsing them would leave 350 (only the stronger), which this rejects.
        expect(
            shadowedSpeed(
                { name: 'Speed Down I', speed: -20 },
                { name: 'Xcellence Drag I', speed: -30 }
            )
        ).toBe(250);
    });
});
