/**
 * ship-kit W3 (Task 9) — ENGINE integration for the Toxic Overflow end-of-round Corrosion-spread
 * mechanic (ledger #49) + Hemlock's `on-corrosion-spread` count-scaled self-heal.
 *
 * Game rule (src/constants/buffs.ts): "At the end of the round if a unit has Toxic Overflow and at
 * least 1 stack of Corrosion, inflict Corrosion I for 3 turns to all adjacent allies and remove
 * Toxic Overflow." Hemlock's 2nd passive rides the resulting spread: "When Corrosion spreads this
 * Unit repairs 5% of its max HP per enemy affected" — a SELF-target heal count-scaled by the number
 * of adjacent allies the spread landed Corrosion I on (eventCtx.spreadAffectedIds.length).
 *
 * Both the Toxic Overflow debuff (Hemlock's charged) and the corrosion-spread heal (Hemlock's
 * passive) are extracted through the REAL parser/builder (`buildShipAbilities` fed verbatim
 * docs/ship-skills.csv text), never hand-built. The Toxic Overflow debuff — parsed as an on-cast
 * enemy debuff — is placed on the focus's ACTIVE slot so it lands on a real positioned enemy on the
 * focus's normal turn (no charge plumbing needed); the mechanic reads it off the per-victim TIMED
 * enemy-debuff store exactly as it would for the real charged application.
 *
 * The spread + heal is invisible in DPS/trace mode (the single dummy enemy holds no per-victim
 * debuffs and has no adjacent allies), so every test is a POSITIONAL multi-actor team battle
 * (investigation appendix §E). The holder's adjacent allies are resolved by board adjacency:
 * M4's neighbours are {M3,T3,T4,B3,B4}, so a holder at M4 with allies at M3 + T3 spreads to both.
 *
 * Non-vacuity: reverting the engine end-of-round mechanic makes the spread/heal/removal assertions
 * red; reverting the parser/builder heal wiring makes the mutation-guard + count-scaling red.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { ownerDebuffNamesFor } from '../triggers';
import type { StatusEngine } from '../statusEngine';
import { TOXIC_OVERFLOW, SPREAD_CORROSION_TIER } from '../../../constants/toxicOverflow';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const HEMLOCK_HP = 1_000_000;

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// Single-target ("base") pattern — hits exactly the resolved primary, no splash.
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// Verbatim Hemlock skill text (docs/ship-skills.csv).
const HEMLOCK_ACTIVE =
    'This Unit deals <unit-damage>130% damage</unit-damage> and inflicts <unit-skill>Corrosion II</unit-skill> for 3 turns.';
const HEMLOCK_CHARGE =
    'This Unit deals <unit-damage>175% damage</unit-damage> and inflicts <unit-skill>Toxic Overflow</unit-skill>.';
const HEMLOCK_P2 =
    'This Unit <unit-aid>gains 1 charge</unit-aid> to its charged skill after it inflicts a <unit-aid>debuff</unit-aid>.<br /><br />When <unit-skill>Corrosion</unit-skill> spreads this Unit <unit-damage>repairs 5%</unit-damage> of its max HP per enemy affected.';

function hemlockBuilt(): ShipSkills {
    return buildShipAbilities(
        ship({
            activeSkillText: HEMLOCK_ACTIVE,
            chargeSkillText: HEMLOCK_CHARGE,
            secondPassiveSkillText: HEMLOCK_P2,
        })
    );
}

/** Hemlock's real on-corrosion-spread self-heal (passive slot). */
function hemlockHealAbility(): Ability {
    const heal = hemlockBuilt()
        .slots.find((s) => s.slot === 'passive')
        ?.abilities.find((a) => a.type === 'heal' && a.target === 'self');
    if (!heal) throw new Error('mutation guard: Hemlock on-corrosion-spread self-heal not found');
    return heal;
}

/** Hemlock's real Toxic Overflow debuff (charged slot), retargeted to fire on-cast from ACTIVE. */
function toxicOverflowDebuff(): Ability {
    const debuff = hemlockBuilt()
        .slots.find((s) => s.slot === 'charged')
        ?.abilities.find((a) => a.config.type === 'debuff' && a.config.buffName === TOXIC_OVERFLOW);
    if (!debuff) throw new Error('mutation guard: Hemlock Toxic Overflow debuff not found');
    return debuff;
}

// A 0-multiplier single-target hit — lands Toxic Overflow on the primary enemy without doing any
// real damage (huge-HP holders never die).
const noopAttack = (): Ability => ({
    id: 'hemlock-atk',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

// Focus Hemlock: an ACTIVE slot that lands Toxic Overflow on the hit enemy + the real
// corrosion-spread self-heal on the PASSIVE slot.
const hemlockFocusSkills = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [noopAttack(), toxicOverflowDebuff()] },
        { slot: 'passive', abilities: [hemlockHealAbility()] },
    ],
});

const enemyAt = (id: string, position: Position, hp: number, speed: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

function run(input: CombatEngineInput) {
    const bus = createEventBus();
    const spreads: Extract<CombatEvent, { type: 'corrosion-spread' }>[] = [];
    const reactiveHeals: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
    bus.on('corrosion-spread', (e) => spreads.push(e));
    bus.on('reactive-heal-performed', (e) => reactiveHeals.push(e));
    let engine: StatusEngine | undefined;
    let actors: CombatActor[] = [];
    const result = runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
        __testTapActors: (a) => {
            actors = a;
            input.__testTapActors?.(a);
        },
    });
    return { spreads, reactiveHeals, result, getEngine: () => engine!, getActors: () => actors };
}

// A player-side focus Hemlock at M4, single-target 'front' attack (lands Toxic Overflow on the
// frontmost enemy). Healing mode ON so the reactive self-heal is credited + emits.
const playerHemlock = (
    enemyAttackers: EnemyAttacker[],
    tap?: (a: CombatActor[]) => void
): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: hemlockFocusSkills(),
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    // ONE round: Hemlock lands Toxic Overflow on her turn, then the end-of-round mechanic spreads +
    // heals ONCE. (A second round would re-apply Toxic Overflow → a second spread — not what these
    // single-fire assertions test.)
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
    defence: 0,
    hp: HEMLOCK_HP,
    speed: 1000, // Hemlock acts first, so Toxic Overflow + Corrosion are on the holder by round end
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers,
    __testTapActors: tap,
});

describe('Hemlock heal — extracted ability shape (mutation guard)', () => {
    it('rides on-corrosion-spread, self-targeted, count-scaled (spread-affected-count), 5%/enemy', () => {
        const heal = hemlockHealAbility();
        expect(heal.trigger).toBe('on-corrosion-spread');
        expect(heal.target).toBe('self');
        expect(heal.config.type).toBe('heal');
        if (heal.config.type === 'heal') expect(heal.config.pct).toBe(5);
        expect(heal.scaling?.countSource).toBe('spread-affected-count');
        expect(heal.scaling?.perUnit).toBe(5);
    });
});

describe('Toxic Overflow end-of-round mechanic (player-side holder → enemy-side spread)', () => {
    it('a holder with Toxic Overflow + Corrosion spreads Corrosion I to adjacent allies, loses Toxic Overflow, and heals Hemlock 5% × affected', () => {
        // Enemy A (M4, front) is hit by Hemlock → gains Toxic Overflow; pre-seed 1 Corrosion stack
        // on A so it qualifies. A's board-neighbours M3 (B) + T3 (C) are its adjacent allies.
        const input = playerHemlock(
            [
                enemyAt('enemy-A', 'M4', 1_000_000_000, 1),
                enemyAt('enemy-B', 'M3', 1_000_000_000, 1),
                enemyAt('enemy-C', 'T3', 1_000_000_000, 1),
            ],
            (actors) => {
                actors
                    .find((a) => a.id === 'enemy-A')
                    ?.corrosionEntries.push({
                        stacks: 1,
                        tier: 6,
                        remainingRounds: 9,
                        sourceId: 'attacker',
                    });
            }
        );
        const { spreads, reactiveHeals, getEngine, getActors } = run(input);

        // ONE spread, from A, affecting exactly its two adjacent allies B + C.
        const aSpreads = spreads.filter((e) => e.sourceId === 'enemy-A');
        expect(aSpreads).toHaveLength(1);
        expect([...aSpreads[0].affectedIds].sort()).toEqual(['enemy-B', 'enemy-C']);

        // The affected allies each received a Corrosion I (tier 3) DoT stack.
        const actors = getActors();
        for (const id of ['enemy-B', 'enemy-C']) {
            const ally = actors.find((a) => a.id === id)!;
            expect(ally.corrosionEntries.some((c) => c.tier === SPREAD_CORROSION_TIER)).toBe(true);
        }

        // Toxic Overflow was REMOVED from the holder on spread.
        expect(ownerDebuffNamesFor(getEngine(), 'enemy-A')).not.toContain(TOXIC_OVERFLOW);

        // Hemlock's self-heal fired ONCE, count-scaled by the two affected enemies (5% × 2).
        const heals = reactiveHeals.filter((e) => e.casterId === 'attacker');
        expect(heals).toHaveLength(1);
        expect(heals[0].amount).toBeCloseTo(HEMLOCK_HP * 0.05 * 2, 4);
        // Discriminator: a flat (unscaled) heal would be 5% = 50_000, not 100_000.
        expect(heals[0].amount).not.toBeCloseTo(HEMLOCK_HP * 0.05, 4);
    });

    it('a holder with Toxic Overflow but NO Corrosion does NOT spread, keeps Toxic Overflow, and heals nothing', () => {
        // No pre-seeded Corrosion on A → the end-of-round gate (>=1 Corrosion stack) fails.
        const input = playerHemlock([
            enemyAt('enemy-A', 'M4', 1_000_000_000, 1),
            enemyAt('enemy-B', 'M3', 1_000_000_000, 1),
        ]);
        const { spreads, reactiveHeals, getEngine } = run(input);

        expect(spreads).toHaveLength(0);
        // Toxic Overflow is retained (it only spreads + is removed when Corrosion is present).
        expect(ownerDebuffNamesFor(getEngine(), 'enemy-A')).toContain(TOXIC_OVERFLOW);
        expect(reactiveHeals.filter((e) => e.casterId === 'attacker')).toHaveLength(0);
    });
});

describe('Team symmetry — an ENEMY-side Hemlock reacts to a PLAYER-side spread', () => {
    it('a player holder with Toxic Overflow + Corrosion spreads to its player allies and heals the enemy Hemlock 5% × affected', () => {
        // Enemy Hemlock (M4) casts a single-target 'front' attack landing Toxic Overflow on the
        // frontmost PLAYER (the focus 'attacker' at M4). Pre-seed Corrosion on 'attacker'. Its
        // player allies at M3 + T3 are its adjacent allies → spread affects 2 → enemy Hemlock heals
        // 5% × 2. Roles reversed vs the player-side case.
        const enemyHemlock: EnemyAttacker = {
            id: 'enemy-hemlock',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HEMLOCK_HP, speed: 1000 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopAttack(), toxicOverflowDebuff()] },
                    { slot: 'passive', abilities: [hemlockHealAbility()] },
                ],
            },
        } as EnemyAttacker;

        const teamStats = (hp: number) => ({
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp,
            hacking: 0,
        });
        const ally = (id: string, position: Position): TeamActor =>
            ({
                id,
                speed: 1,
                chargeCount: 0,
                startCharged: false,
                selfBuffs: [],
                enemyDebuffs: [],
                position,
                walk: {
                    shipSkills: { slots: [] },
                    stats: teamStats(1_000_000_000),
                    selfDotModifier: 0,
                    defensePenetrationBuff: 0,
                    affinityDamageModifier: 0,
                    affinityCritCap: 100,
                    affinityCritPenalty: 0,
                    hasChargedSkill: false,
                },
            }) as TeamActor;

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            // Player focus does nothing meaningful; it is the frontmost target the enemy Hemlock
            // hits (a 0-mult attack keeps its turn valid).
            shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
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
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            // Healing mode ON keyed to a PLAYER actor (the pipeline requirement); BOTH sides' reactive
            // heals still emit reactive-heal-performed, so the enemy Hemlock's fire is observable
            // (filtered by casterId below) — mirrors sansiEnemyRepairedHeal's enemy-side harness.
            healTargetId: 'attacker',
            position: 'M4',
            teamActors: [ally('player-B', 'M3'), ally('player-C', 'T3')],
            enemyAttackers: [enemyHemlock],
            __testTapActors: (actors) => {
                actors
                    .find((a) => a.id === 'attacker')
                    ?.corrosionEntries.push({
                        stacks: 1,
                        tier: 6,
                        remainingRounds: 9,
                        sourceId: 'enemy-hemlock',
                    });
            },
        };

        const { spreads, reactiveHeals } = run(input);

        const focusSpreads = spreads.filter((e) => e.sourceId === 'attacker');
        expect(focusSpreads).toHaveLength(1);
        expect([...focusSpreads[0].affectedIds].sort()).toEqual(['player-B', 'player-C']);

        const heals = reactiveHeals.filter((e) => e.casterId === 'enemy-hemlock');
        expect(heals).toHaveLength(1);
        expect(heals[0].amount).toBeCloseTo(HEMLOCK_HP * 0.05 * 2, 4);
    });
});
