/**
 * Multi-hit full-walk attacks, PR6 — `on-deal-damage` gates on DELIVERED damage.
 *
 * `triggers.ts`'s on-deal-damage guard read `e.damage`, the pre-funnel DISPLAY basis that
 * buildCombatLog shows: `playerTurn`'s `directDamage`, computed against the anchor's defence
 * profile before the victim-side funnel runs — it never sees the funnel at all. So a sub-attack
 * that DELIVERED nothing still carried a positive `damage` and still fired its riders — Burner's
 * Inferno, Warpstrike's duration-reduction, Zeolite's purge.
 *
 * Only TWO funnel legs zero out `deliveredDamage`, and so only those two are what this fix
 * silences: a DoT transform (the whole hit deferred) and an incoming-block shave (the hit
 * cancelled). The other three deliberately still COUNT as delivered and still fire the riders —
 * shield absorption (a soaked hit is still on-screen damage), Barrier nullification, and a
 * Protection redirect (the hit landed, on someone else). See the per-leg table in the
 * `on-deal-damage` listener (triggers.ts). PR7 built `ability-performed.deliveredDamage`
 * (events.ts, populated at engine.ts's interleaved positional emit) for exactly this question and
 * one consumer (the `on-crit` listener) adopted it; this file pins the second consumer.
 *
 * WHERE EACH OF THE FIVE LEGS IS PINNED (this file used to disclaim covering them; it now covers
 * three of the five, so the map is spelled out instead):
 *   • DoT transform      → zero-delivery, both sides — the first two describe blocks below.
 *   • Shield absorption  → COUNTS as delivered — the "counting legs" block at the bottom of this
 *                          file. (`incomingFunnelPerSubAttack.integration.test.ts` pins that the
 *                          absorption itself resolves per sub-attack; it says nothing about the
 *                          rider.)
 *   • Barrier            → COUNTS as delivered — same block at the bottom of this file.
 *   • Incoming-block     → zero-delivery, pinned as a DELIVERED BASIS (not as a rider count) by
 *                          `incomingFunnelPerSubAttack.integration.test.ts`'s "a deterministic
 *                          full block (procChance 1) shaves EVERY sub-attack to 0 delivered".
 *   • Protection redirect→ COUNTS as delivered, pinned at unit level by
 *                          `positionalApplySubAttack.test.ts`'s "adds the Protection-redirected
 *                          chunk back on top of the booked remainder". No rider-level fixture.
 *
 * ANTI-VACUITY. The victim carries an unconditional `transform-incoming-to-dot` (Voron's shape),
 * which replaces the ENTIRE post-block damage with a deferred generic DoT — nothing is delivered
 * NOW. Measured against this exact fixture before a single assertion was written (throwaway probe,
 * both sides):
 *
 *     fixture                        | ability-performed.damage | .deliveredDamage | Infernos
 *     3-hit vs transform carrier     | [10000, 10000, 10000]    | [0, 0, 0]        | 3  <- the bug
 *     3-hit vs plain victim (control)| [10000, 10000, 10000]    | [10000,10000,10000] | 3
 *
 * The two bases DISAGREE in the transform fixture and AGREE in the control — which is what makes
 * this file discriminating rather than vacuous. A fixture where they agree would pass under BOTH
 * the old and the new guard and prove nothing. Each zero-delivery test re-measures both bases
 * inline, so a future engine change that silently made them agree again turns this file red
 * instead of quietly hollowing it out.
 *
 * THE PAIRED CONTROL is mandatory in the other direction: without it, "no Inferno" would also be
 * satisfied by the rider being broken outright (a landing draw that never lands, a rider never
 * wired to the passive slot). The control fires the SAME rider from the SAME attacker at a victim
 * that differs only by the transform, and demands 3 Infernos.
 *
 * TEAM SYMMETRY. Every ZERO-DELIVERY case is run twice — a PLAYER focus attacker against an enemy
 * transform carrier, and an ENEMY attacker against a player-team transform carrier. The guard
 * lives in the side-agnostic listener, but the enemy path has silently dropped mechanics twice in
 * this epic (#306's unwired enemy passive slot), so the mirror is pinned rather than assumed.
 * The COUNTING legs at the bottom are player-side only, deliberately: what they assert is that the
 * rider DOES fire, and the enemy-side CONTROL above already proves the enemy path fires riders at
 * all. Their own risk is a funnel leg wrongly zeroing the basis, and the funnel is one shared
 * `applyVictimDamage` with no side branch. If that ever stops being true, mirror them.
 *
 * TURN ORDER (inherited from `transformIncomingToDot.test.ts`'s own requirement): the transform
 * carrier is given a much higher speed than its attacker so its own turn-start DoT-tick step runs
 * BEFORE the incoming hit, and no tick from an entry the hit itself just created can confound the
 * measurement. Only the enemy-driven fixture needs the override — `enemyAt`'s hardcoded speed 1 is
 * already below the player focus attacker's.
 *
 * DAMAGE ARITHMETIC (established earlier in this PR, not re-derived): `crit: 100, critDamage: 100`
 * makes every hit crit and double, so each sub-attack's slice is 10,000, not 5,000.
 *
 * SCOPE. `deliveredDamage` is emitted ONLY on the interleaved positional path, so the `??` chain in
 * the fix leaves the DPS path byte-identical — it has no incoming funnel, so its two bases cannot
 * disagree. `dpsSubAttackEvents.integration.test.ts` holds that path's own per-sub-attack Inferno
 * count and is the regression guard for it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { emptyPreFightModifiers } from '../preFight/types';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;
type DotApplied = Extract<CombatEvent, { type: 'dot-applied' }>;
type Attacked = Extract<CombatEvent, { type: 'attacked' }>;

/** Round 1's per-victim incoming accounting. This is how the counting-leg fixtures prove the LEG
 *  ITSELF was exercised (a non-zero `shieldAbsorbed` / `barrierAbsorbed`), separately from proving
 *  the rider fired — without it, "3 Infernos" would also be satisfied by a fixture where the
 *  shield or Barrier silently never applied and the hits simply landed on HP. */
type Intake = { incoming: number; shieldAbsorbed: number; barrierAbsorbed: number };
const ZERO_INTAKE: Intake = { incoming: 0, shieldAbsorbed: 0, barrierAbsorbed: 0 };

const HP = 10_000_000;
/** Each sub-attack's measured slice: attack 5000 x 100% multiplier, doubled by the guaranteed crit. */
const SLICE = 10_000;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pr6t5-${++idc}`,
    target: 'enemy',
    trigger: 'on-deal-damage',
    conditions: [],
    ...p,
});

/** Burner's real rider shape (buildEquipmentAbilities.ts's BURNER): a passive-slot `dot` ability
 *  on `on-deal-damage` applying Inferno 1 (tier 15) for 2 turns to the enemy it just hit. */
const burnerRider = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'dot',
            target: 'enemy',
            trigger: 'on-deal-damage',
            config: { type: 'dot', dotType: 'inferno', tier: 15, stacks: 1, duration: 2 },
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
 *  `hacking: 100_000` puts the reactive DoT's landing draw out of reach of the RNG — the fixture
 *  measures the GATE, not the infliction roll. */
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
    positionalTeamBattle: true,
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
 *  the same Burner rider. `hacking` matches `focusCast`'s for the same landing-draw reason. */
const offensiveEnemyWithRider = (id: string, position: Position, hits: number): EnemyAttacker =>
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
        shipSkills: { slots: [attackSkill(hits), burnerRider()] },
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
    positionalTeamBattle: true,
    teamActors: team,
    enemyAttackers: enemies,
});

/** One run's observations: the Infernos the rider inflicted, plus BOTH damage bases per
 *  sub-attack, so every test can re-verify its own fixture is still discriminating. */
const observe = (
    input: CombatEngineInput,
    attackerId: string,
    victimId = 'victim'
): {
    infernos: number;
    display: (number | undefined)[];
    delivered: (number | undefined)[];
    shieldFlags: boolean[];
    intake: Intake;
} => {
    const bus = createEventBus();
    let infernos = 0;
    const display: (number | undefined)[] = [];
    const delivered: (number | undefined)[] = [];
    const shieldFlags: boolean[] = [];
    bus.on('dot-applied', (e: DotApplied) => {
        if (e.dotType === 'inferno' && e.sourceId === attackerId) infernos += 1;
    });
    bus.on('ability-performed', (e: AbilityPerformed) => {
        if (e.actorId === attackerId) {
            display.push(e.damage);
            delivered.push(e.deliveredDamage);
        }
    });
    bus.on('attacked', (e: Attacked) => {
        if (e.targetId === victimId) shieldFlags.push(e.shieldWasHit === true);
    });
    const result = runCombat({ ...input, bus });
    const raw = result.rounds[0]?.perActorIncoming?.[victimId];
    return {
        infernos,
        display,
        delivered,
        shieldFlags,
        intake: raw
            ? {
                  incoming: raw.incoming,
                  shieldAbsorbed: raw.shieldAbsorbed,
                  barrierAbsorbed: raw.barrierAbsorbed,
              }
            : ZERO_INTAKE,
    };
};

// ── PLAYER side: focus attacker wearing Burner, enemy victim wearing the transform ────────────

describe('PR6 — on-deal-damage riders gate on DELIVERED damage — PLAYER side', () => {
    afterEach(() => resetRateGateRng());

    it('a 3-hit cast fully deferred into a DoT transform lands ZERO Infernos, though its display damage stays 10,000 per sub-attack', () => {
        const { infernos, display, delivered } = observe(
            focusCast(
                [attackSkill(3), burnerRider()],
                [enemyAt('victim', 'M4', [voronTransform(3)])]
            ),
            'attacker'
        );
        // FIXTURE GUARD (see the header's ANTI-VACUITY table): the two bases must DISAGREE here,
        // or the Inferno assertion below is satisfied for the wrong reason.
        expect(display).toEqual([SLICE, SLICE, SLICE]);
        expect(delivered).toEqual([0, 0, 0]);
        // Pre-fix: 3 (the guard read `display`). Post-fix: 0 — nothing was delivered, so no rider.
        expect(infernos).toBe(0);
    });

    it('a 1-hit cast against the same transform carrier also lands zero — the collapse is not a multi-hit artefact', () => {
        const { infernos, display, delivered } = observe(
            focusCast(
                [attackSkill(1), burnerRider()],
                [enemyAt('victim', 'M4', [voronTransform(3)])]
            ),
            'attacker'
        );
        expect(display).toEqual([SLICE]);
        expect(delivered).toEqual([0]);
        expect(infernos).toBe(0);
    });

    it('CONTROL: the same rider against a victim WITHOUT the transform still lands one Inferno per sub-attack', () => {
        // Without this the suite could go green on a rider that is broken outright rather than
        // correctly gated. The victim differs from the case above by the transform passive ALONE.
        const { infernos, display, delivered } = observe(
            focusCast([attackSkill(3), burnerRider()], [enemyAt('victim', 'M4', [])]),
            'attacker'
        );
        expect(display).toEqual([SLICE, SLICE, SLICE]);
        expect(delivered).toEqual([SLICE, SLICE, SLICE]);
        expect(infernos).toBe(3);
    });
});

// ── ENEMY side (team symmetry): enemy attacker wearing Burner, player victim wearing the transform ──

describe('PR6 — on-deal-damage riders gate on DELIVERED damage — ENEMY side (team symmetry)', () => {
    afterEach(() => resetRateGateRng());

    it('an ENEMY 3-hit cast fully deferred into a player victim`s DoT transform also lands ZERO Infernos', () => {
        const { infernos, display, delivered } = observe(
            enemyDrivenBattle(
                [teamVictim('victim', 'M4', [voronTransform(3)], 2000)],
                [offensiveEnemyWithRider('foe', 'M1', 3)]
            ),
            'foe'
        );
        expect(display).toEqual([SLICE, SLICE, SLICE]);
        expect(delivered).toEqual([0, 0, 0]);
        expect(infernos).toBe(0);
    });

    it('CONTROL: the same ENEMY rider against a player victim WITHOUT the transform lands one Inferno per sub-attack', () => {
        const { infernos, display, delivered } = observe(
            enemyDrivenBattle(
                [teamVictim('victim', 'M4', [], 2000)],
                [offensiveEnemyWithRider('foe', 'M1', 3)]
            ),
            'foe'
        );
        expect(display).toEqual([SLICE, SLICE, SLICE]);
        expect(delivered).toEqual([SLICE, SLICE, SLICE]);
        expect(infernos).toBe(3);
    });
});

// ── The COUNTING legs: shield absorption and Barrier nullification ────────────────────────────

/**
 * Two of the three legs that DELIBERATELY still count as delivered — shield absorption and Barrier
 * nullification — had no test at any level, while the changelog states the behaviour publicly
 * ("An attack soaked by a Shield, nullified by a Barrier, or redirected to an ally by Protection
 * still counts as delivered, since that hit did land on-screen"). Both are pinned here.
 *
 * WHAT MAKES THESE NON-VACUOUS, in both directions:
 *  (a) The LEG really ran. `intake.shieldAbsorbed` / `intake.barrierAbsorbed` come out at the full
 *      30,000 the cast dealt, so every one of the three sub-attacks was soaked/nullified in full.
 *      Delete the shield pool or the Barrier grant and those drop to 0 — the fixture would then be
 *      a plain HP hit wearing a shield-leg label, and would still show 3 Infernos.
 *  (b) The BASIS really is what the rider read. Each test asserts `delivered` matches the display
 *      basis per sub-attack AND that 3 Infernos landed. Change either leg to zero out
 *      `deliveredDamage` and BOTH fail: `delivered` becomes [0, 0, 0] and the guard
 *      (`(e.deliveredDamage ?? e.damage ?? 0) <= 0`) silences the rider to 0 Infernos. That is the
 *      exact regression these fixtures exist to catch — it would silence Burner, Warpstrike and
 *      Zeolite against every shielded or barriered target in the game.
 *
 * Contrast with the zero-delivery blocks above, where the two bases must DISAGREE. Here they must
 * AGREE, and the discrimination comes from (a): the funnel leg is proven to have fired.
 */

/** The standard victim, re-cut with a finite HP pool and a starting shield.
 *  60% of 50,000 = 30,000 — exactly the three 10,000 slices, so all three are absorbed IN FULL and
 *  no sub-attack spills to HP (a partial spill would muddy which basis the rider read). */
const shieldedEnemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        ...enemyAt(id, position, []),
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 50_000, speed: 1 },
        preFight: { ...emptyPreFightModifiers(), startingShieldPctOfHp: 60 },
    }) as EnemyAttacker;

/** A victim that grants ITSELF a plain multi-turn Barrier before the focus ever acts.
 *  `speed: 5000` beats the focus attacker's default 100 so the grant is up for round 1's cast, and
 *  `startCharged` fires the charged slot on that first turn. The Barrier carries no hit limit, so
 *  it is not consumed and nullifies all three sub-attacks (barrierBuffs.ts). Its own attack is 0,
 *  so its turn contributes nothing but the grant. */
const barrierEnemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 5000 },
        chargeCount: 1,
        startCharged: true,
        position,
        affinity: 'antimatter',
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'charged',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            trigger: 'on-cast',
                            config: {
                                type: 'buff',
                                buffName: 'Barrier',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                duration: 5,
                            },
                        }),
                    ],
                },
            ],
        },
    }) as EnemyAttacker;

describe('PR6 — the funnel legs that COUNT as delivered still fire the rider', () => {
    afterEach(() => resetRateGateRng());

    it('a 3-hit cast fully soaked by a Shield still lands one Inferno per sub-attack', () => {
        const { infernos, display, delivered, shieldFlags, intake } = observe(
            focusCast([attackSkill(3), burnerRider()], [shieldedEnemyAt('victim', 'M4')]),
            'attacker'
        );
        // (a) THE LEG RAN: every sub-attack drained the pool, and the pool ate the whole cast.
        expect(shieldFlags).toEqual([true, true, true]);
        expect(intake.shieldAbsorbed).toBe(3 * SLICE);
        expect(intake.barrierAbsorbed).toBe(0);
        // (b) THE BASIS: a soaked hit is on-screen damage, so delivered tracks display exactly.
        expect(display).toEqual([SLICE, SLICE, SLICE]);
        expect(delivered).toEqual([SLICE, SLICE, SLICE]);
        expect(infernos).toBe(3);
    });

    it('a 3-hit cast fully nullified by a Barrier still lands one Inferno per sub-attack', () => {
        const { infernos, display, delivered, shieldFlags, intake } = observe(
            focusCast([attackSkill(3), burnerRider()], [barrierEnemyAt('victim', 'M4')]),
            'attacker'
        );
        // (a) THE LEG RAN: the whole cast was booked as barrier-absorbed, and no shield was
        // involved — a Barrier-blocked hit never reaches the pool (events.ts's own note).
        expect(intake.barrierAbsorbed).toBe(3 * SLICE);
        expect(intake.shieldAbsorbed).toBe(0);
        expect(shieldFlags).toEqual([false, false, false]);
        // (b) THE BASIS: nullified is still delivered.
        expect(display).toEqual([SLICE, SLICE, SLICE]);
        expect(delivered).toEqual([SLICE, SLICE, SLICE]);
        expect(infernos).toBe(3);
    });
});
