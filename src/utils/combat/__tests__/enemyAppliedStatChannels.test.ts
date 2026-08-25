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
import { createEventBus, type CombatEvent } from '../events';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedBuffEffects } from '../../../types/calculator';
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
