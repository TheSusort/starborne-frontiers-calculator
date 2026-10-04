/**
 * Two self-gain gates whose quantifier ranges over the enemies the cast STRIKES — the footprint on
 * a pattern cast, the aimed enemy alone on a single-target (Pattern-Base) or DPS cast:
 *  - Selenite: "If any target has Stealth, this Unit adds 1 charge" counts only struck enemies
 *    (owner ruling R23). A Stealthed enemy outside her pattern does not count.
 *  - Chakara: "If all damaged enemies have more speed than this Unit, it adds 1 charge" needs
 *    EVERY struck enemy faster than her (R24); an enemy outside her pattern does not matter.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv, refit 4), each firing its real active
 * pattern, Pattern-Line-Range-1, from M4: it strikes M4 (A) and M3 (B); M2 (D) stands outside.
 * The enemies are harmless; the player-side ones act before the caster.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
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

/** `ship`'s real active and charged slots with its ship-level flags (Selenite ignores Stealth),
 *  without its passive, so only the gated clause can move the charge. */
const kit = (ship: string): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const all = buildShipAbilities(built);
    return { ...all, slots: all.slots.filter((s) => s.slot !== 'passive') };
};
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
const STEALTH_SELF: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'seed-stealth',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Stealth',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 3,
                    },
                },
            ],
        },
    ],
};

type Label = 'A' | 'B' | 'D';
const LABELS: Label[] = ['A', 'B', 'D'];
const POS: Record<Label, Position> = { A: 'M4', B: 'M3', D: 'M2' };
interface Seed {
    stealth?: boolean;
    speed?: number;
}
type Board = Partial<Record<Label, Seed>>;

const CASTER_SPEED = 100;
/** Faster than the caster unless the board says otherwise, so they act first. */
const speedOf = (s: Seed | undefined): number => s?.speed ?? 150;

const enemyAt = (id: string, position: Position, s: Seed | undefined): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1e9,
        speed: speedOf(s),
        security: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: s?.stealth ? STEALTH_SELF : NO_SKILLS,
});
const playerShip = (id: string, position: Position, s: Seed | undefined): TeamActor => ({
    id,
    speed: speedOf(s),
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: s?.stealth ? STEALTH_SELF : NO_SKILLS,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1e9,
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
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: CASTER_SPEED,
    ...over,
});

interface Side {
    casterId: string;
    ids: Record<Label, string>;
    input: (ship: string, pattern: string, b: Board) => CombatEngineInput;
}

const PLAYER: Side = {
    casterId: 'attacker',
    ids: { A: 'enemy-a', B: 'enemy-b', D: 'enemy-d' },
    input: (ship, pattern, b) =>
        base({
            shipSkills: kit(ship),
            ignoresStealth: kit(ship).ignoresStealth === true,
            pattern: parsePattern(pattern),
            chargeCount: 9,
            hasChargedSkill: true,
            enemyAttackers: LABELS.map((l) => enemyAt(PLAYER.ids[l], POS[l], b[l])),
        }),
};

/** The enemy caster strikes the focus at M4 (A) and ally-b at M3 (B); ally-d at M2 (D) stands
 *  outside. The focus's speed and Stealth come from the board like everyone else's. */
const ENEMY: Side = {
    casterId: 'enemy-caster',
    ids: { A: 'attacker', B: 'ally-b', D: 'ally-d' },
    input: (ship, pattern, b) =>
        base({
            attack: 0,
            speed: speedOf(b.A),
            shipSkills: b.A?.stealth ? STEALTH_SELF : NO_SKILLS,
            teamActors: (['B', 'D'] as Label[]).map((l) => playerShip(ENEMY.ids[l], POS[l], b[l])),
            enemyAttackers: [
                {
                    id: 'enemy-caster',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1e9,
                        speed: CASTER_SPEED,
                        security: 0,
                    },
                    chargeCount: 9,
                    startCharged: false,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern(pattern),
                    shipSkills: kit(ship),
                    ignoresStealth: kit(ship).ignoresStealth === true,
                },
            ],
        }),
};

interface Measured {
    /** Sorted ids the caster's round-1 cast struck. */
    struck: string[];
    /** Skill-granted charge moves on the caster in round 1, as the amount gained. */
    chargeGains: number[];
    /** Ids holding Stealth (a `buff-applied` named Stealth) before the caster's cast. */
    stealthed: string[];
}

const measure = (side: Side, ship: string, pattern: string, b: Board): Measured => {
    const bus = createEventBus();
    const caster = side.casterId;
    const struck = new Set<string>();
    const out: Measured = { struck: [], chargeGains: [], stealthed: [] };
    let cast = false;
    bus.on('skill-fired', (e: Extract<CombatEvent, { type: 'skill-fired' }>) => {
        if (e.actorId === caster) cast = true;
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (!cast && e.buffName === 'Stealth') out.stealthed.push(e.actorId);
    });
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId === caster && e.round === 1) struck.add(e.targetId);
    });
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.actorId === caster && e.round === 1 && e.reason === 'manip')
            out.chargeGains.push(e.newCharge - e.oldCharge);
    });
    runCombat({ ...side.input(ship, pattern, b), bus });
    out.struck = [...struck].sort();
    out.stealthed.sort();
    return out;
};

beforeEach(() => {
    setupKeyedRng(11);
});

const LINE1 = 'Pattern-Line-Range-1';
const BASE = 'Pattern-Base';

describe("Selenite: 'If any target has Stealth' counts only the enemies she strikes", () => {
    for (const side of [PLAYER, ENEMY]) {
        const tag = side === PLAYER ? 'player' : 'enemy-side';
        it(`${tag}: D outside the pattern has Stealth → no charge`, () => {
            const m = measure(side, 'Selenite', LINE1, { D: { stealth: true } });
            expect(m.struck).toEqual([side.ids.A, side.ids.B].sort());
            expect(m.stealthed).toEqual([side.ids.D]);
            expect(m.chargeGains).toEqual([]);
        });
        it(`${tag}: the covered B has Stealth → +1 charge`, () => {
            const m = measure(side, 'Selenite', LINE1, { B: { stealth: true } });
            expect(m.stealthed).toEqual([side.ids.B]);
            expect(m.chargeGains).toEqual([1]);
        });
        it(`${tag}: the aimed A has Stealth → +1 charge`, () => {
            const m = measure(side, 'Selenite', LINE1, { A: { stealth: true } });
            expect(m.struck).toEqual([side.ids.A, side.ids.B].sort());
            expect(m.stealthed).toEqual([side.ids.A]);
            expect(m.chargeGains).toEqual([1]);
        });
        it(`${tag}: A and B both Stealthed → still +1`, () => {
            const m = measure(side, 'Selenite', LINE1, {
                A: { stealth: true },
                B: { stealth: true },
            });
            expect(m.chargeGains).toEqual([1]);
        });
        it(`${tag}: nobody Stealthed → nothing`, () => {
            expect(measure(side, 'Selenite', LINE1, {}).chargeGains).toEqual([]);
        });
    }
    it('player, Pattern-Base: B Stealthed is not struck → nothing; A Stealthed → +1', () => {
        const none = measure(PLAYER, 'Selenite', BASE, { B: { stealth: true } });
        expect(none.struck).toEqual(['enemy-a']);
        expect(none.chargeGains).toEqual([]);
        expect(measure(PLAYER, 'Selenite', BASE, { A: { stealth: true } }).chargeGains).toEqual([
            1,
        ]);
    });
});

describe("Chakara: 'If all damaged enemies have more speed' needs every struck enemy faster", () => {
    for (const side of [PLAYER, ENEMY]) {
        const tag = side === PLAYER ? 'player' : 'enemy-side';
        it(`${tag}: A faster, B slower → no charge`, () => {
            const m = measure(side, 'Chakara', LINE1, { B: { speed: 50 } });
            expect(m.struck).toEqual([side.ids.A, side.ids.B].sort());
            expect(m.chargeGains).toEqual([]);
        });
        it(`${tag}, reversed: A slower, B faster → no charge`, () => {
            expect(measure(side, 'Chakara', LINE1, { A: { speed: 50 } }).chargeGains).toEqual([]);
        });
        it(`${tag}: A and B both faster → +1 charge`, () => {
            expect(measure(side, 'Chakara', LINE1, {}).chargeGains).toEqual([1]);
        });
        it(`${tag}: A and B faster, D outside the pattern slower → +1 charge`, () => {
            expect(measure(side, 'Chakara', LINE1, { D: { speed: 50 } }).chargeGains).toEqual([1]);
        });
    }
    it('player, Pattern-Base: the one struck enemy decides — B slower is not struck', () => {
        const m = measure(PLAYER, 'Chakara', BASE, { B: { speed: 50 } });
        expect(m.struck).toEqual(['enemy-a']);
        expect(m.chargeGains).toEqual([1]);
        expect(measure(PLAYER, 'Chakara', BASE, { A: { speed: 50 } }).chargeGains).toEqual([]);
    });
});

describe('DPS calculator: the one configured enemy decides Chakara’s charge', () => {
    const run = (enemySpeed: number): number => {
        const built = buildTraceShip('Chakara');
        if (!built) throw new Error('Chakara missing');
        const bus = createEventBus();
        let gained = 0;
        bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
            if (e.reason === 'manip' && e.round === 1) gained += e.newCharge - e.oldCharge;
        });
        simulateDPS({
            attack: 15000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            chargeCount: 99,
            enemyDefense: 8000,
            enemyHp: 1e12,
            enemySpeed,
            speed: CASTER_SPEED,
            rounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            hacking: 0,
            enemySecurity: 0,
            defence: 6000,
            hp: 30000,
            shipSkills: buildShipAbilities(built),
            bus,
        });
        return gained;
    };
    it('a faster enemy → +1; a slower one → nothing', () => {
        expect(run(150)).toBe(1);
        expect(run(50)).toBe(0);
    });
});
