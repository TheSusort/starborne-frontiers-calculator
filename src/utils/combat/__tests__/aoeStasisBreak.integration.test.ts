/**
 * A Stasis this cast lands on an enemy is not shortened by this same cast's hit, on EVERY enemy
 * the cast strikes — the aimed one and each covered one alike. A Stasis an enemy already held is
 * shortened by the hit unless this cast re-inflicted Stasis on THAT enemy (a resist elsewhere in
 * the footprint, or a landing elsewhere, decides nothing for it).
 *
 * The caster fires Pattern-Circle-Range-1 anchored on M4, striking M4 (A), M3 (B) and T4 (C). One
 * round is run. A hit on a stasised enemy takes one turn off its Stasis; with Stasis(2) applied in
 * round 1, an enemy still stasised after round 1 kept its full duration and one whose Stasis is
 * gone was shortened by the hit. The enemies act after the caster.
 *
 * Also pins written clause order per struck enemy: a Defense Down written before the damage
 * amplifies this cast's hit on a covered enemy; one written after it does not.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, AbilityTarget, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const realSlot = (ship: string, slot: 'active' | 'charged'): Ability[] => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return found.abilities;
};

let idc = 0;
const stasis = (target: AbilityTarget, application: 'inflict' | 'apply'): Ability => ({
    id: `sb-${++idc}`,
    type: 'debuff',
    target,
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Stasis',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 2,
        application,
    },
});
const damage = (): Ability => ({
    id: `sb-${++idc}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 1 },
});
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

/** Stasis written BEFORE the damage: in the store when the cast's hit lands. */
const stasisThenDamage = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [stasis('enemy', 'inflict'), damage()] }],
});
/** Stasis written AFTER the damage (Bizon's charged shape). */
const damageThenStasis = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [damage(), stasis('enemy', 'inflict')] }],
});
/** A charged-slot Stasis on every enemy, fired once on round 1 ahead of the caster. */
const preStasisKit = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'charged', abilities: [stasis('all-enemies', 'apply')] },
    ],
});

const RESIST = 1e9;

const enemyAt = (id: string, position: Position, security = 0): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 1, security },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: NO_SKILLS,
});
const enemyRow = (security: Record<string, number> = {}): EnemyAttacker[] =>
    (
        [
            ['enemy-a', 'M4'],
            ['enemy-b', 'M3'],
            ['enemy-c', 'T4'],
        ] as [string, Position][]
    ).map(([id, p]) => enemyAt(id, p, security[id] ?? 0));

const playerShip = (
    id: string,
    position: Position,
    over: Partial<TeamActor> = {},
    skills: ShipSkills = NO_SKILLS,
    hacking = 0
): TeamActor => ({
    id,
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: skills,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking,
            defence: 0,
            hp: 1e9,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: skills.slots.some((s) => s.slot === 'charged'),
    },
    ...over,
});

/** A fast player teammate landing Stasis(2) on every enemy before the caster acts. */
const preStasisMate = (): TeamActor =>
    playerShip(
        'mate',
        'M3',
        {
            speed: 300,
            chargeCount: 99,
            startCharged: true,
            pattern: parsePattern('Pattern-Circle-Range-1'),
        },
        preStasisKit(),
        1e4
    );

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: NO_SKILLS,
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
    hp: 1e9,
    hacking: 1e4,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Circle-Range-1'),
    speed: 100,
    ...over,
});

/** Ids still stasised after the run, out of `ids`. */
const stasisedAfter = (input: CombatEngineInput, ids: string[]): string[] => {
    let isStasised: ((id: string) => boolean) | undefined;
    runCombat({
        ...input,
        __testTapIsStasised: (fn) => {
            isStasised = fn;
        },
    });
    return ids.filter((id) => isStasised!(id)).sort();
};

const ENEMIES = ['enemy-a', 'enemy-b', 'enemy-c'];

beforeEach(() => {
    idc = 0;
    setupKeyedRng(5);
});

describe('player caster: a Stasis this cast lands survives its own hit on every struck enemy', () => {
    it('Stasis written before the damage → A, B and C all keep their full Stasis', () => {
        expect(
            stasisedAfter(
                base({ shipSkills: stasisThenDamage(), enemyAttackers: enemyRow() }),
                ENEMIES
            )
        ).toEqual(ENEMIES);
    });

    it("Bizon's charged (Stasis written after the damage) → A, B and C all keep their full Stasis", () => {
        expect(
            stasisedAfter(
                base({
                    shipSkills: {
                        slots: [{ slot: 'charged', abilities: realSlot('Bizon', 'charged') }],
                    },
                    hasChargedSkill: true,
                    startCharged: true,
                    enemyAttackers: enemyRow(),
                }),
                ENEMIES
            )
        ).toEqual(ENEMIES);
    });
});

describe('player caster: a Stasis held before the cast is shortened unless this cast re-inflicts it on THAT enemy', () => {
    it('A and C re-inflicted, B resists → B alone loses its Stasis', () => {
        expect(
            stasisedAfter(
                base({
                    shipSkills: damageThenStasis(),
                    teamActors: [preStasisMate()],
                    enemyAttackers: enemyRow({ 'enemy-b': RESIST }),
                }),
                ENEMIES
            )
        ).toEqual(['enemy-a', 'enemy-c']);
    });

    it('the aimed enemy A resists, B and C re-inflicted → A alone loses its Stasis', () => {
        expect(
            stasisedAfter(
                base({
                    shipSkills: damageThenStasis(),
                    teamActors: [preStasisMate()],
                    enemyAttackers: enemyRow({ 'enemy-a': RESIST }),
                }),
                ENEMIES
            )
        ).toEqual(['enemy-b', 'enemy-c']);
    });

    it('control — a cast with no Stasis clause shortens every held Stasis it hits', () => {
        expect(
            stasisedAfter(
                base({
                    shipSkills: { slots: [{ slot: 'active', abilities: [damage()] }] },
                    teamActors: [preStasisMate()],
                    enemyAttackers: enemyRow(),
                }),
                ENEMIES
            )
        ).toEqual([]);
    });
});

describe('enemy caster: the same rules on the player ships it strikes', () => {
    const PLAYERS = ['attacker', 'ally-b', 'ally-c'];
    const enemyCaster = (skills: ShipSkills): EnemyAttacker => ({
        id: 'enemy-caster',
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e9,
            speed: 100,
            security: 0,
            hacking: 1e4,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Circle-Range-1'),
        shipSkills: skills,
    });
    const enemyPreStasis: EnemyAttacker = {
        ...enemyAt('enemy-mate', 'M3'),
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e9,
            speed: 300,
            security: 0,
            hacking: 1e4,
        },
        chargeCount: 99,
        startCharged: true,
        pattern: parsePattern('Pattern-Circle-Range-1'),
        shipSkills: preStasisKit(),
    };
    /** The focus at M4, B at M3, C at T4 — all slower than the enemy caster. `focusSecurity`
     *  makes the aimed ship resist. */
    const board = (
        caster: EnemyAttacker,
        focusSecurity = 0,
        extraEnemies: EnemyAttacker[] = []
    ): CombatEngineInput =>
        base({
            attack: 0,
            hacking: 0,
            speed: 1,
            security: focusSecurity,
            pattern: parsePattern('Pattern-Base'),
            teamActors: [playerShip('ally-b', 'M3'), playerShip('ally-c', 'T4')],
            enemyAttackers: [caster, ...extraEnemies],
        });

    it('Stasis written before the damage → all three player ships keep their full Stasis', () => {
        expect(stasisedAfter(board(enemyCaster(stasisThenDamage())), PLAYERS)).toEqual([
            'ally-b',
            'ally-c',
            'attacker',
        ]);
    });

    it('the aimed ship resists, B and C re-inflicted → the aimed ship alone loses its Stasis', () => {
        expect(
            stasisedAfter(board(enemyCaster(damageThenStasis()), RESIST, [enemyPreStasis]), PLAYERS)
        ).toEqual(['ally-b', 'ally-c']);
    });
});

describe('written clause order holds on every struck enemy', () => {
    /** Round-1 damage the caster dealt to each enemy, and the debuffs it landed on B. */
    const damageTo = (skills: ShipSkills): Record<string, number> & { landedOnB: string[] } => {
        const bus = createEventBus();
        const landedOnB: string[] = [];
        bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
            if (e.sourceId === 'attacker' && e.targetId === 'enemy-b') landedOnB.push(e.buffName);
        });
        const result = runCombat(
            base({
                bus,
                attack: 10_000,
                hacking: 1e6,
                shipSkills: skills,
                enemyAttackers: enemyRow().map((e) => ({
                    ...e,
                    stats: { ...e.stats, defence: 5_000 },
                })),
            })
        );
        return Object.assign({ ...(result.rounds[0].perTargetDamage ?? {}) }, { landedOnB });
    };
    const withoutDebuffs = (abilities: Ability[]): Ability[] =>
        abilities.filter((a) => a.type !== 'debuff');

    it("Nayra's active (Defense Down written before the damage) hits covered B harder", () => {
        const kit = realSlot('Nayra', 'active');
        const amplified = damageTo({ slots: [{ slot: 'active', abilities: kit }] });
        const plain = damageTo({ slots: [{ slot: 'active', abilities: withoutDebuffs(kit) }] });
        expect(amplified['enemy-b']).toBeGreaterThan(plain['enemy-b']);
        expect(amplified['enemy-a']).toBeGreaterThan(plain['enemy-a']);
    });

    it("Bizon's active (Defense Down written after the damage) leaves covered B's hit unchanged", () => {
        const kit = realSlot('Bizon', 'active');
        const withDebuff = damageTo({ slots: [{ slot: 'active', abilities: kit }] });
        const plain = damageTo({ slots: [{ slot: 'active', abilities: withoutDebuffs(kit) }] });
        // Non-vacuity: the Defense Down really reaches B, after the hit.
        expect(withDebuff.landedOnB).toContain('Defense Down II');
        expect(withDebuff['enemy-b']).toBe(plain['enemy-b']);
        expect(withDebuff['enemy-a']).toBe(plain['enemy-a']);
    });
});
