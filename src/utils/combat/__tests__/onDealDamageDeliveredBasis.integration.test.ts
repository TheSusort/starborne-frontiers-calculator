/**
 * Multi-hit full-walk attacks, PR6 — `on-deal-damage` gates on DELIVERED damage.
 *
 * `triggers.ts`'s on-deal-damage guard read `e.damage`, the pre-funnel DISPLAY basis that
 * buildCombatLog shows: `playerTurn`'s `directDamage`, computed against the anchor's defence
 * profile before the victim-side funnel runs. It never sees shield absorption, a Protection
 * redirect, an incoming-block shave, or a DoT transform. So a sub-attack that DELIVERED nothing
 * still carried a positive `damage` and still fired its riders — Burner's Inferno, Warpstrike's
 * duration-reduction, Zeolite's purge. PR7 built `ability-performed.deliveredDamage` (events.ts,
 * populated at engine.ts's interleaved positional emit) for exactly this question and one consumer
 * (the `on-crit` listener) adopted it; this file pins the second consumer.
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
 * TEAM SYMMETRY. Every case is run twice — a PLAYER focus attacker against an enemy transform
 * carrier, and an ENEMY attacker against a player-team transform carrier. The guard lives in the
 * side-agnostic listener, but the enemy path has silently dropped mechanics twice in this epic
 * (#306's unwired enemy passive slot), so the mirror is pinned rather than assumed.
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

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;
type DotApplied = Extract<CombatEvent, { type: 'dot-applied' }>;

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
    attackerId: string
): { infernos: number; display: (number | undefined)[]; delivered: (number | undefined)[] } => {
    const bus = createEventBus();
    let infernos = 0;
    const display: (number | undefined)[] = [];
    const delivered: (number | undefined)[] = [];
    bus.on('dot-applied', (e: DotApplied) => {
        if (e.dotType === 'inferno' && e.sourceId === attackerId) infernos += 1;
    });
    bus.on('ability-performed', (e: AbilityPerformed) => {
        if (e.actorId === attackerId) {
            display.push(e.damage);
            delivered.push(e.deliveredDamage);
        }
    });
    runCombat({ ...input, bus });
    return { infernos, display, delivered };
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
