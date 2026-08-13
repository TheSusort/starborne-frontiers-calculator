/**
 * Multi-hit full-walk attacks, PR6 — a reactive repair that repaired NOTHING opens no combat-log row.
 *
 * `triggers.ts`'s heal/shield executor emitted `reactive-heal-performed` whenever the recipient loop
 * produced any entry at all, regardless of the amount. A `basis:'damage-dealt'` reactive (Bloodthirst
 * is the shipped shape) resolves its basis from `eventCtx.triggerDamage`, which since PR7 is the
 * sub-attack's DELIVERED damage — and that is legitimately 0 when the whole hit was deferred into a
 * DoT, soaked, or otherwise funnelled away. The executor then credited 0, pushed a 0 into
 * `healPerTarget`, and emitted an `amount: 0` event, which `buildCombatLog` turns into a visible
 * "repaired 0" row for a repair that never happened.
 *
 * The SHIELD sibling immediately above it in the same executor branch already guards correctly — it
 * emits only when a recipient actually gained pool (`shieldRecipientIds.length > 0`). This file pins
 * the heal branch's symmetry with it: `healSum > 0`, the gross across recipients.
 *
 * ANTI-VACUITY. The victim carries an unconditional `transform-incoming-to-dot` (Voron's shape) —
 * the same fixture PR6's `on-deal-damage` task used — so the entire post-block hit is deferred and
 * the sub-attack delivers exactly 0 NOW. Every zero test re-measures BOTH damage bases inline:
 *
 *     fixture                        | ability-performed.damage | .deliveredDamage | reactive heals
 *     3-hit vs transform carrier     | [10000, 10000, 10000]    | [0, 0, 0]        | 3 x amount 0  <- the bug
 *     3-hit vs plain victim (control)| [10000, 10000, 10000]    | [10000,10000,10000] | 3 x amount 2000
 *
 * If a future engine change made the two bases agree again, the basis would stop being zero and this
 * file would go red rather than quietly hollowing out into "asserts nothing".
 *
 * THE PAIRED CONTROL is mandatory in the other direction: "no reactive-heal-performed" is also
 * satisfied by the heal being broken outright (an unregistered passive slot, a proc gate that never
 * opens, a crit that never happens). The control fires the SAME Bloodthirst from the SAME attacker at
 * a victim differing ONLY by the transform passive, and demands three events with a POSITIVE amount.
 *
 * ROUTING TRAP: the event is `reactive-heal-performed`, keyed `casterId` — NOT `heal-performed`, NOT
 * `actorId`. A reactive repair is deliberately LOG-ONLY (emitting `heal-performed` would re-trigger
 * the repairer's own on-repair listeners and loop). Subscribing to the wrong event asserts against an
 * empty array and passes both before and after the fix; that has already produced one vacuous test in
 * this epic.
 *
 * TEAM SYMMETRY. Every case runs twice — a PLAYER focus attacker wearing Bloodthirst against an enemy
 * transform carrier, and an ENEMY attacker wearing it against a player-team transform carrier. The
 * guard lives in the side-agnostic executor, but the enemy path has silently dropped whole passive
 * slots before (#306), so the mirror is pinned rather than assumed.
 *
 * SURFACE. This reaches the healing/sim surfaces ONLY: the executor's first line bails on
 * `!ctx.healing`, and `runCombat` builds `healingCtx` only under an explicit `healTargetId` or
 * `positionalTeamBattle`. `simulateDPS` sets neither, so the DPS calculator never reaches this branch.
 *
 * TURN ORDER (inherited from `transformIncomingToDot.test.ts`): the transform carrier outruns its
 * attacker so its own turn-start DoT tick runs BEFORE the incoming hit, and no tick from an entry the
 * hit itself just created can confound the measurement. Only the enemy-driven fixture needs the
 * override — `enemyAt`'s hardcoded speed 1 already sits below the player focus attacker's.
 *
 * DAMAGE ARITHMETIC (established earlier in this PR, not re-derived): `crit: 100, critDamage: 100`
 * makes every hit crit and double, so each sub-attack's slice is 10,000, not 5,000. At 20% of damage
 * dealt that is a 2,000 repair per sub-attack in the control.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;
type ReactiveHeal = Extract<CombatEvent, { type: 'reactive-heal-performed' }>;

const HP = 10_000_000;
/** Each sub-attack's measured slice: attack 5000 x 100% multiplier, doubled by the guaranteed crit. */
const SLICE = 10_000;
const HEAL_PCT = 20;
/** The control's per-sub-attack repair: 20% of the 10,000 delivered. */
const CONTROL_HEAL = (SLICE * HEAL_PCT) / 100;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pr6t6-${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/** Bloodthirst's shipped shape (buildEquipmentAbilities.ts's BLOODTHIRST): a passive-slot on-crit
 *  SELF repair scaling off damage dealt. The real implant also carries a top-level `procChance`;
 *  it is DELIBERATELY omitted so the repair fires unconditionally — `passesProcChanceGate` early-
 *  returns when `procChance` is undefined, and including it would put an RNG draw between the
 *  fixture and the thing under test. */
const bloodthirstPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'heal',
            target: 'self',
            trigger: 'on-crit',
            config: { type: 'heal', pct: HEAL_PCT, basis: 'damage-dealt' },
        }),
    ],
});

const attackSkill = (hits: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'damage', multiplier: 100, ...(hits > 1 ? { hits } : {}) },
        }),
    ],
});

/** Voron's transform: unconditional, self-targeted, on-attacked. The whole post-block hit is
 *  deferred into a generic DoT, so the sub-attack delivers exactly 0 now. */
const voronTransform = (turns: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'transform-incoming-to-dot',
            target: 'self',
            trigger: 'on-attacked',
            config: { type: 'transform-incoming-to-dot', turns, condition: 'always' },
        }),
    ],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** A positioned enemy carrying `slots`, which never attacks (no active slot). */
const enemyAt = (id: string, position: Position, slots: ShipSkills['slots'] = []) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        shipSkills: { slots },
    }) as EnemyAttacker;

/** The player focus attacker at M1 fires `slots` at the front enemy (column 4 is the FRONT).
 *  `hacking: 100_000` puts any landing draw out of reach of the RNG. */
const focusCast = (slots: ShipSkills['slots'], enemies: EnemyAttacker[]): CombatEngineInput => ({
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
    hacking: 100_000,
    healTargetId: 'attacker',
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    mode: 'battle',
    enemyAttackers: enemies,
});

const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'damage', multiplier: 0 },
        }),
    ],
};

/** A player team actor at `position` carrying `slots`, which never attacks. `speed` is overridden
 *  by the transform block to outrun its attacker (see the file header's TURN ORDER note). */
const teamVictim = (
    id: string,
    position: Position,
    slots: ShipSkills['slots'],
    speed: number
): TeamActor =>
    ({
        id,
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots },
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
            hasChargedSkill: false,
        },
    }) as TeamActorEngineInput;

/** The ENEMY-side mirror of the focus attacker: fires an N-hit cast at the player front AND wears
 *  the same Bloodthirst passive. */
const offensiveEnemyWithBloodthirst = (
    id: string,
    position: Position,
    hits: number
): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5000, crit: 100, critDamage: 100, defence: 0, hp: HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        hacking: 100_000,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [attackSkill(hits), bloodthirstPassive()] },
    }) as EnemyAttacker;

/** The player side is inert; the enemy does all the attacking. */
const enemyDrivenBattle = (team: TeamActor[], enemies: EnemyAttacker[]): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive] },
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
    healTargetId: 'attacker',
    position: 'M1',
    mode: 'battle',
    teamActors: team,
    enemyAttackers: enemies,
});

/** One run's observations: the attacker's own reactive-repair amounts in resolution order, plus
 *  BOTH damage bases per sub-attack so every test can re-verify its fixture is discriminating. */
const observe = (
    input: CombatEngineInput,
    attackerId: string
): { heals: number[]; display: (number | undefined)[]; delivered: (number | undefined)[] } => {
    const bus = createEventBus();
    const heals: number[] = [];
    const display: (number | undefined)[] = [];
    const delivered: (number | undefined)[] = [];
    // `casterId`, not `actorId` — see the header's ROUTING TRAP.
    bus.on('reactive-heal-performed', (e: ReactiveHeal) => {
        if (e.casterId === attackerId) heals.push(e.amount);
    });
    bus.on('ability-performed', (e: AbilityPerformed) => {
        if (e.actorId === attackerId && e.abilityType === 'damage') {
            display.push(e.damage);
            delivered.push(e.deliveredDamage);
        }
    });
    runCombat({ ...input, bus });
    return { heals, display, delivered };
};

// ── PLAYER side: focus attacker wearing Bloodthirst, enemy victim wearing the transform ────────

describe('PR6 — a reactive repair that repaired nothing opens no log row — PLAYER side', () => {
    afterEach(() => resetRateGateRng());

    it('a 3-hit cast fully deferred into a DoT transform emits NO reactive-heal-performed, though its display damage stays 10,000 per sub-attack', () => {
        const { heals, display, delivered } = observe(
            focusCast(
                [attackSkill(3), bloodthirstPassive()],
                [enemyAt('victim', 'M4', [voronTransform(3)])]
            ),
            'attacker'
        );
        // FIXTURE GUARD (see the header's ANTI-VACUITY table): the two bases must DISAGREE here,
        // or the emptiness assertion below is satisfied for the wrong reason.
        expect(display).toEqual([SLICE, SLICE, SLICE]);
        expect(delivered).toEqual([0, 0, 0]);
        // Pre-fix: [0, 0, 0] — three combat-log rows for three repairs of nothing.
        expect(heals).toEqual([]);
    });

    it('a 1-hit cast against the same transform carrier also emits nothing — the row is not a multi-hit artefact', () => {
        const { heals, display, delivered } = observe(
            focusCast(
                [attackSkill(1), bloodthirstPassive()],
                [enemyAt('victim', 'M4', [voronTransform(3)])]
            ),
            'attacker'
        );
        expect(display).toEqual([SLICE]);
        expect(delivered).toEqual([0]);
        expect(heals).toEqual([]);
    });

    it('CONTROL: the same Bloodthirst against a victim WITHOUT the transform still repairs once per sub-attack, with a POSITIVE amount', () => {
        // Without this the suite could go green on a repair that is broken outright rather than
        // correctly suppressed. The victim differs from the cases above by the transform ALONE.
        const { heals, display, delivered } = observe(
            focusCast([attackSkill(3), bloodthirstPassive()], [enemyAt('victim', 'M4', [])]),
            'attacker'
        );
        expect(display).toEqual([SLICE, SLICE, SLICE]);
        expect(delivered).toEqual([SLICE, SLICE, SLICE]);
        expect(heals).toEqual([CONTROL_HEAL, CONTROL_HEAL, CONTROL_HEAL]);
        for (const amount of heals) expect(amount).toBeGreaterThan(0);
    });
});

// ── ENEMY side (team symmetry): enemy attacker wearing Bloodthirst, player victim wearing the transform ──

describe('PR6 — a reactive repair that repaired nothing opens no log row — ENEMY side (team symmetry)', () => {
    afterEach(() => resetRateGateRng());

    it('an ENEMY 3-hit cast fully deferred into a player victim`s DoT transform also emits NO reactive-heal-performed', () => {
        const { heals, display, delivered } = observe(
            enemyDrivenBattle(
                [teamVictim('victim', 'M4', [voronTransform(3)], 2000)],
                [offensiveEnemyWithBloodthirst('foe', 'M1', 3)]
            ),
            'foe'
        );
        expect(display).toEqual([SLICE, SLICE, SLICE]);
        expect(delivered).toEqual([0, 0, 0]);
        expect(heals).toEqual([]);
    });

    it('CONTROL: the same ENEMY Bloodthirst against a player victim WITHOUT the transform repairs once per sub-attack, with a POSITIVE amount', () => {
        const { heals, display, delivered } = observe(
            enemyDrivenBattle(
                [teamVictim('victim', 'M4', [], 2000)],
                [offensiveEnemyWithBloodthirst('foe', 'M1', 3)]
            ),
            'foe'
        );
        expect(display).toEqual([SLICE, SLICE, SLICE]);
        expect(delivered).toEqual([SLICE, SLICE, SLICE]);
        expect(heals).toEqual([CONTROL_HEAL, CONTROL_HEAL, CONTROL_HEAL]);
        for (const amount of heals) expect(amount).toBeGreaterThan(0);
    });
});

// ── Multi-hit epic residual R5(ii) — the CAST path's zero gate, closing the known asymmetry ────
//
// PR6 gated the REACTIVE path on `healSum > 0` and deliberately left the CAST path gated on
// "resolved to at least one recipient" — so a cast repair that restored nothing still emitted
// `heal-performed`, still opened a "repaired 0" combat-log row, and still counted as a repair for
// the `on-enemy-repaired` riders (Ruiner's Bomb, Overload, Zosimos's charge removal, Amartya's
// Defense Shred). The playerTurn comment named that asymmetry and priced it ("a behaviour change
// with golden movement, not a cleanup"). This block is the paid invoice.
//
// The zero is reachable on the cast path for the same reason it is on the reactive one: a
// `basis:'damage-dealt'` heal is a CAST RIDER on the active/charged slots (types/abilities.ts), so
// a cast whose damage was fully deferred into a DoT transform resolves its repair to exactly 0.
// Same Voron fixture, same anti-vacuity discipline, same paired control as the reactive blocks
// above — only the slot and the event name change.
//
// ROUTING: `heal-performed` (the CAST event), not `reactive-heal-performed`. Both key `casterId`.

/** A cast rider repairing the caster for a share of the damage the cast deals — the `damage-dealt`
 *  basis on an ACTIVE slot, which types/abilities.ts documents as the cast-rider form. */
const attackWithCastHealRider = (hits: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'damage', multiplier: 100, ...(hits > 1 ? { hits } : {}) },
        }),
        ab({
            type: 'heal',
            target: 'self',
            trigger: 'on-cast',
            config: { type: 'heal', pct: HEAL_PCT, basis: 'damage-dealt' },
        }),
    ],
});

/** The same cast rider with NO damage component — the cast deals nothing, so the repair is 0. */
const castHealRiderOnly = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'heal',
            target: 'self',
            trigger: 'on-cast',
            config: { type: 'heal', pct: HEAL_PCT, basis: 'damage-dealt' },
        }),
    ],
});

/** The cast-path twin of `observe`: `heal-performed` amounts plus both damage bases. */
const observeCast = (
    input: CombatEngineInput,
    attackerId: string
): { heals: number[]; display: (number | undefined)[]; delivered: (number | undefined)[] } => {
    const bus = createEventBus();
    const heals: number[] = [];
    const display: (number | undefined)[] = [];
    const delivered: (number | undefined)[] = [];
    bus.on('heal-performed', (e) => {
        if (e.type === 'heal-performed' && e.casterId === attackerId) heals.push(e.amount);
    });
    bus.on('ability-performed', (e: AbilityPerformed) => {
        if (e.actorId === attackerId && e.abilityType === 'damage') {
            display.push(e.damage);
            delivered.push(e.deliveredDamage);
        }
    });
    runCombat({ ...input, bus });
    return { heals, display, delivered };
};

describe('R5(ii) — a CAST repair that repaired nothing opens no log row either', () => {
    afterEach(() => resetRateGateRng());

    it('a cast repair that resolved to zero emits NO heal-performed', () => {
        // A support cast carrying a `damage-dealt` repair rider and NO damage component: the cast
        // deals nothing, so the repair scales to exactly 0 while still resolving to a recipient —
        // which is precisely the state the cast gate ("at least one recipient") let through.
        const { heals, display } = observeCast(
            focusCast([castHealRiderOnly()], [enemyAt('victim', 'M4')]),
            'attacker'
        );
        // FIXTURE GUARD: the cast dealt nothing, so the repair has nothing to scale off. (No
        // `deliveredDamage` to assert here — with no damage component there is no positional apply
        // to produce one, which is itself the reason the basis is zero.)
        expect(display).toEqual([0]);
        // Pre-fix: [0] — a row reporting a repair that never happened.
        expect(heals).toEqual([]);
    });

    it('CONTROL: the same rider on a cast that DOES deal damage repairs a POSITIVE amount', () => {
        // Without this, "no heal-performed" is also satisfied by the rider never firing at all.
        const { heals, display, delivered } = observeCast(
            focusCast([attackWithCastHealRider(3)], [enemyAt('victim', 'M4')]),
            'attacker'
        );
        expect(display).toEqual([SLICE, SLICE, SLICE]);
        expect(delivered).toEqual([SLICE, SLICE, SLICE]);
        expect(heals).toHaveLength(1);
        expect(heals[0]).toBeGreaterThan(0);
    });
});
