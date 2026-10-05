/**
 * A damage bonus "to enemies with <buff>" reads the struck enemy's OWN buffs (AoE ruling 1), never
 * whether some other enemy on the board holds it.
 *
 * Lodolite: "all allies deal 15% more direct damage to enemies with Concentrate Fire or Stealth."
 * An ally's hit on enemy A (no Stealth) takes no bonus while enemy B holds Stealth; A holding
 * Stealth itself does.
 * Rikra: "deals 140% damage with an additional 60% damage to enemies affected by Taunt or
 * Provoke." Her hit on A (no Taunt) takes no bonus while B Taunts; A Taunting itself does. Sokol's
 * "if the target is affected by a control effect, deals an additional 130% damage" reads Taunt the
 * same way.
 *
 * Real parsed Lodolite passive and Rikra / Sokol actives (buildTraceShip, refit 4). The statuses are self
 * buffs the enemies cast on their own (earlier) turns.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
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

const realSlot = (ship: string, slot: 'active' | 'passive'): Ability[] => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return found.abilities;
};

let idc = 0;
const hitter = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `nb-${++idc}`,
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
});
const lodolitePassive = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'passive', abilities: realSlot('Lodolite', 'passive') },
    ],
});
const rikraActive = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: realSlot('Rikra', 'active') }],
});
const sokolActive = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: realSlot('Sokol', 'active') }],
});
/** A cast that only grants the caster `buffName` for 3 turns. */
const selfGrant = (buffName: string): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `nb-${++idc}`,
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName,
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 3,
                    },
                },
            ],
        },
    ],
});
const NONE: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
const HP = 1e9;

const enemyAt = (
    id: string,
    position: Position,
    skills: ShipSkills = NONE,
    over: Partial<EnemyAttacker['stats']> = {}
): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: HP,
        speed: 300,
        security: 0,
        ...over,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: skills,
});
const playerShip = (
    id: string,
    position: Position,
    skills: ShipSkills,
    speed: number,
    attack = 0
): TeamActor => ({
    id,
    speed,
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
            attack,
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
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: NONE,
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
    hp: HP,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

/** Every round-1 hit `attackerId` landed, as `targetId:damage`. */
const hitsBy = (input: CombatEngineInput, attackerId: string): string[] => {
    const bus = createEventBus();
    const out: string[] = [];
    bus.on('attacked', (e) => {
        if (e.attackerId === attackerId && e.round === 1)
            out.push(`${e.targetId}:${Math.round(e.damage ?? NaN)}`);
    });
    runCombat({ ...input, bus });
    return out;
};

beforeEach(() => {
    idc = 0;
    setupKeyedRng(3);
});

describe('Lodolite: "+15% to enemies with Stealth" reads the struck enemy', () => {
    /** Player hitter (focus) beside an inert Lodolite; enemy A at M4, enemy B at M3. */
    const board = (aSkills: ShipSkills, bSkills?: ShipSkills): CombatEngineInput =>
        base({
            shipSkills: hitter(),
            teamActors: [playerShip('p-lodolite', 'M3', lodolitePassive(), 1)],
            enemyAttackers: [
                enemyAt('e-a', 'M4', aSkills),
                ...(bSkills ? [enemyAt('e-b', 'M3', bSkills)] : []),
            ],
        });

    it('player: A clean while B holds Stealth → no bonus on A', () => {
        expect(hitsBy(board(NONE, selfGrant('Stealth')), 'attacker')).toEqual(['e-a:1000']);
    });

    it('player control: A itself holds Stealth → +15% on A', () => {
        expect(hitsBy(board(selfGrant('Stealth')), 'attacker')).toEqual(['e-a:1150']);
    });

    it('player control: nobody holds Stealth → no bonus', () => {
        expect(hitsBy(board(NONE, NONE), 'attacker')).toEqual(['e-a:1000']);
    });

    /** Enemy hitter beside an inert enemy Lodolite; player focus A at M4, player ship B at M3. */
    const enemyBoard = (aSkills: ShipSkills, bSkills?: ShipSkills): CombatEngineInput =>
        base({
            attack: 0,
            speed: 300,
            shipSkills: aSkills,
            teamActors: bSkills ? [playerShip('p-b', 'M3', bSkills, 300)] : [],
            enemyAttackers: [
                enemyAt('e-hitter', 'M4', hitter(), { attack: 1000, speed: 100 }),
                enemyAt('e-lodolite', 'M3', lodolitePassive(), { speed: 1 }),
            ],
        });

    it('enemy: A clean while B holds Stealth → no bonus on A', () => {
        expect(hitsBy(enemyBoard(NONE, selfGrant('Stealth')), 'e-hitter')).toEqual([
            'attacker:1000',
        ]);
    });

    it('enemy control: A itself holds Stealth → +15% on A', () => {
        expect(hitsBy(enemyBoard(selfGrant('Stealth')), 'e-hitter')).toEqual(['attacker:1150']);
    });
});

describe('Rikra: "additional damage to enemies affected by Taunt" reads the struck enemy', () => {
    /** Player Rikra (focus, ignores forced targeting) aiming enemy A at M4; enemy B at M3. */
    const board = (aSkills: ShipSkills, bSkills?: ShipSkills): CombatEngineInput =>
        base({
            shipSkills: rikraActive(),
            ignoresForcedTargeting: true,
            enemyAttackers: [
                enemyAt('e-a', 'M4', aSkills),
                ...(bSkills ? [enemyAt('e-b', 'M3', bSkills)] : []),
            ],
        });

    it('player: A clean while B Taunts → no bonus on A (same as nobody Taunting)', () => {
        const plain = hitsBy(board(NONE, NONE), 'attacker');
        expect(plain).toHaveLength(1);
        expect(plain[0].startsWith('e-a:')).toBe(true);
        expect(hitsBy(board(NONE, selfGrant('Taunt')), 'attacker')).toEqual(plain);
    });

    it('player control: A itself Taunts → the bonus lands on A', () => {
        const plain = hitsBy(board(NONE, NONE), 'attacker');
        const taunting = hitsBy(board(selfGrant('Taunt')), 'attacker');
        expect(taunting).toHaveLength(1);
        expect(taunting[0].startsWith('e-a:')).toBe(true);
        expect(Number(taunting[0].split(':')[1])).toBeGreaterThan(Number(plain[0].split(':')[1]));
    });

    /** Enemy Rikra (ignores forced targeting) aiming the player focus A at M4; player ship B at
     *  M3. */
    const enemyBoard = (aSkills: ShipSkills, bSkills?: ShipSkills): CombatEngineInput => {
        const rikra = enemyAt('e-rikra', 'M4', rikraActive(), { attack: 1000, speed: 100 });
        rikra.ignoresForcedTargeting = true;
        return base({
            attack: 0,
            speed: 300,
            shipSkills: aSkills,
            teamActors: bSkills ? [playerShip('p-b', 'M3', bSkills, 300)] : [],
            enemyAttackers: [rikra],
        });
    };

    it('enemy: A clean while B Taunts → no bonus on A (same as nobody Taunting)', () => {
        const plain = hitsBy(enemyBoard(NONE, NONE), 'e-rikra');
        expect(plain).toHaveLength(1);
        expect(plain[0].startsWith('attacker:')).toBe(true);
        expect(hitsBy(enemyBoard(NONE, selfGrant('Taunt')), 'e-rikra')).toEqual(plain);
    });

    it('enemy control: A itself Taunts → the bonus lands on A', () => {
        const plain = hitsBy(enemyBoard(NONE, NONE), 'e-rikra');
        const taunting = hitsBy(enemyBoard(selfGrant('Taunt')), 'e-rikra');
        expect(taunting).toHaveLength(1);
        expect(taunting[0].startsWith('attacker:')).toBe(true);
        expect(Number(taunting[0].split(':')[1])).toBeGreaterThan(Number(plain[0].split(':')[1]));
    });
});

describe('Sokol: "if the target is affected by a control effect" reads the struck enemy', () => {
    const board = (aSkills: ShipSkills, bSkills?: ShipSkills): CombatEngineInput =>
        base({
            shipSkills: sokolActive(),
            ignoresForcedTargeting: true,
            enemyAttackers: [
                enemyAt('e-a', 'M4', aSkills),
                ...(bSkills ? [enemyAt('e-b', 'M3', bSkills)] : []),
            ],
        });

    it('player: A clean while B Taunts → no bonus on A; A Taunting itself → bonus', () => {
        const plain = hitsBy(board(NONE, NONE), 'attacker');
        expect(plain).toHaveLength(1);
        expect(plain[0].startsWith('e-a:')).toBe(true);
        expect(hitsBy(board(NONE, selfGrant('Taunt')), 'attacker')).toEqual(plain);
        const taunting = hitsBy(board(selfGrant('Taunt')), 'attacker');
        expect(Number(taunting[0].split(':')[1])).toBeGreaterThan(Number(plain[0].split(':')[1]));
    });
});
