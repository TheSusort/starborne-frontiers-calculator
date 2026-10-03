/**
 * A DoT a pattern skill inflicts reaches EVERY enemy the skill strikes (owner ruling 2026-10-03:
 * "All skills with an aoe pattern have all their effects on any enemy within the pattern"). Each
 * struck enemy rolls its own landing, holds its own stacks, and a Bomb snapshots the caster's
 * affinity against THAT enemy. Reactions to an inflicted DoT fire once per enemy it lands on.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv, refit 4). The caster fires
 * Pattern-Cone-Range-1 anchored on M4, which strikes M4 (A), M3 (B) and T3 (C); M2 (OUT) stands
 * outside it. `Pattern-Base` on the same board strikes A alone. Caster hacking dwarfs every
 * security unless a test raises one enemy's.
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
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedPattern, ParsedTarget } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { AffinityName } from '../../../types/ship';
import type { CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type Slot = 'active' | 'charged' | 'passive';

const cone = (): ParsedPattern => parsePattern('Pattern-Cone-Range-1');
const single = (): ParsedPattern => parsePattern('Pattern-Base');

const realSlot = (ship: string, slot: Slot): Ability[] => {
    const built = buildTraceShip(ship, { refitLevel: 4 });
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return found.abilities;
};

/** `ship`'s real active, charged and passive slots. Which one fires on round 1 is the caster's
 *  charge state: a charged cast starts charged, an active cast starts empty and short of its
 *  charge cost, so a passive charge gain (Hemlock) has somewhere to go. */
const kit = (ship: string): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: realSlot(ship, 'active') },
        { slot: 'charged', abilities: realSlot(ship, 'charged') },
        { slot: 'passive', abilities: realSlot(ship, 'passive') },
    ],
});
/** Charge cost of the caster's charged skill: 1 when the cast under test is the charged one
 *  (startCharged fires it), otherwise more than an active cast can gain on round 1. */
const chargeCost = (slot: 'active' | 'charged'): number => (slot === 'charged' ? 1 : 10);

const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

const ENEMY_POSITIONS: [string, Position][] = [
    ['enemy-a', 'M4'],
    ['enemy-b', 'M3'],
    ['enemy-c', 'T3'],
    ['enemy-out', 'M2'],
];

interface Side {
    security?: Record<string, number>;
    affinity?: Record<string, AffinityName>;
}

/** A durable, harmless enemy, faster than the caster. */
const enemyAt = (id: string, position: Position, side: Side): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1e9,
        speed: 150,
        security: side.security?.[id] ?? 0,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: single(),
    shipSkills: NO_SKILLS,
    ...(side.affinity?.[id] ? { affinity: side.affinity[id] } : {}),
});
const enemyRow = (side: Side = {}, positions = ENEMY_POSITIONS): EnemyAttacker[] =>
    positions.map(([id, p]) => enemyAt(id, p, side));

/** A durable, harmless player-side ship, faster than the enemy caster. */
const playerShip = (id: string, position: Position, side: Side): TeamActor => ({
    id,
    speed: 150,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: single(),
    walk: {
        shipSkills: NO_SKILLS,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1e9,
            security: side.security?.[id] ?? 0,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
        ...(side.affinity?.[id] ? { affinity: side.affinity[id] } : {}),
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
    hacking: 1e6,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: cone(),
    speed: 100,
    ...over,
});

interface CasterStats {
    crit?: number;
    critDamage?: number;
    affinity?: AffinityName;
    target?: ParsedTarget;
}

/** The player caster firing `ship`'s real `slot` on round 1. */
const playerCasting = (
    ship: string,
    slot: 'active' | 'charged',
    pattern: ParsedPattern,
    side: Side = {},
    stats: CasterStats = {},
    positions = ENEMY_POSITIONS
): CombatEngineInput =>
    base({
        shipSkills: kit(ship),
        pattern,
        hasChargedSkill: true,
        startCharged: slot === 'charged',
        chargeCount: chargeCost(slot),
        crit: stats.crit ?? 0,
        critDamage: stats.critDamage ?? 0,
        ...(stats.affinity ? { affinity: stats.affinity } : {}),
        ...(stats.target ? { target: stats.target } : {}),
        enemyAttackers: enemyRow(side, positions),
    });

/** The enemy caster firing `ship`'s real `slot` from M4 against player ships at M4 / M3 / T3 /
 *  M2 — the player focus (`attacker`) at M4 is struck, as are `ally-b` and `ally-c`. */
const enemyCasting = (
    ship: string,
    slot: 'active' | 'charged',
    pattern: ParsedPattern,
    side: Side = {},
    stats: CasterStats = {}
): CombatEngineInput => {
    const caster: EnemyAttacker = {
        id: 'enemy-caster',
        stats: {
            attack: 1000,
            crit: stats.crit ?? 0,
            critDamage: stats.critDamage ?? 0,
            defence: 0,
            hp: 1e9,
            speed: 10,
            security: 0,
            hacking: 1e6,
        },
        chargeCount: chargeCost(slot),
        startCharged: slot === 'charged',
        position: 'M4',
        target: parseTarget('front'),
        pattern,
        shipSkills: kit(ship),
        ...(stats.affinity ? { affinity: stats.affinity } : {}),
    };
    return base({
        attack: 0,
        hacking: 0,
        speed: 150,
        security: side.security?.['attacker'] ?? 0,
        ...(side.affinity?.['attacker'] ? { affinity: side.affinity['attacker'] } : {}),
        pattern: single(),
        teamActors: [
            playerShip('ally-b', 'M3', side),
            playerShip('ally-c', 'T3', side),
            playerShip('ally-out', 'M2', side),
        ],
        enemyAttackers: [caster],
    });
};

interface Measured {
    /** `dotType → sorted target ids` of the caster's round-1 `dot-applied`. */
    dots: Record<string, string[]>;
    /** `dotType → targetId → stacks` summed over the caster's round-1 `dot-applied`. */
    stacks: Record<string, Record<string, number>>;
    /** `buffName → sorted target ids` of the caster's round-1 `debuff-resisted`. */
    resisted: Record<string, string[]>;
    /** Passive charge the caster gained in round 1. */
    chargeGained: number;
    actors: Map<string, CombatActor>;
}

const measure = (input: CombatEngineInput, casterId: string): Measured => {
    const bus = createEventBus();
    const dots: Record<string, string[]> = {};
    const stacks: Record<string, Record<string, number>> = {};
    const resisted: Record<string, string[]> = {};
    let chargeGained = 0;
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        if (e.sourceId !== casterId || e.round !== 1) return;
        (dots[e.dotType] ??= []).push(e.targetId);
        const byTarget = (stacks[e.dotType] ??= {});
        byTarget[e.targetId] = (byTarget[e.targetId] ?? 0) + e.stacks;
    });
    bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
        if (e.sourceId === casterId && e.round === 1)
            (resisted[e.buffName] ??= []).push(e.targetId);
    });
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.actorId === casterId && e.round === 1 && e.reason === 'manip')
            chargeGained += e.newCharge - e.oldCharge;
    });
    const actors = new Map<string, CombatActor>();
    runCombat({
        ...input,
        bus,
        __testTapActors: (all) => {
            for (const a of all) actors.set(a.id, a);
        },
    });
    for (const k of Object.keys(dots)) dots[k].sort();
    for (const k of Object.keys(resisted)) resisted[k].sort();
    return { dots, stacks, resisted, chargeGained, actors };
};

beforeEach(() => {
    setupKeyedRng(5);
});

describe("Ravager's Inferno reaches every enemy his pattern strikes", () => {
    it('player Ravager on Cone → Inferno II on A, B and C; not on the enemy outside', () => {
        const m = measure(playerCasting('Ravager', 'active', cone()), 'attacker');
        expect(m.dots['inferno']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        const held = (id: string) => m.actors.get(id)!.infernoEntries.length;
        expect([held('enemy-a'), held('enemy-b'), held('enemy-c'), held('enemy-out')]).toEqual([
            1, 1, 1, 0,
        ]);
    });

    it('player Ravager on a single-target pattern → A alone', () => {
        const m = measure(playerCasting('Ravager', 'active', single()), 'attacker');
        expect(m.dots['inferno']).toEqual(['enemy-a']);
    });

    it('enemy-side Ravager on Cone → Inferno II on the three player ships he strikes', () => {
        const m = measure(enemyCasting('Ravager', 'active', cone()), 'enemy-caster');
        expect(m.dots['inferno']).toEqual(['ally-b', 'ally-c', 'attacker']);
    });

    it('B out-secures the caster → B resists on its own roll; A and C still burn', () => {
        const m = measure(
            playerCasting('Ravager', 'active', cone(), { security: { 'enemy-b': 1e9 } }),
            'attacker'
        );
        expect(m.dots['inferno']).toEqual(['enemy-a', 'enemy-c']);
        expect(m.resisted['Inferno II']).toEqual(['enemy-b']);
    });

    it('enemy-side: ally-b out-secures the caster → ally-b resists; the other two burn', () => {
        const m = measure(
            enemyCasting('Ravager', 'active', cone(), { security: { 'ally-b': 1e9 } }),
            'enemy-caster'
        );
        expect(m.dots['inferno']).toEqual(['ally-c', 'attacker']);
        expect(m.resisted['Inferno II']).toEqual(['ally-b']);
    });
});

describe("a Bomb on each struck enemy snapshots the caster's affinity against THAT enemy", () => {
    // Thermal holds the advantage over chemical: a chemical caster is at a disadvantage against
    // a thermal enemy (-25%) and neutral against an antimatter one.
    it('player chemical Demolisher on Cone; B thermal → B’s bomb carries 0.75, A’s and C’s 1', () => {
        const m = measure(
            playerCasting(
                'Demolisher',
                'active',
                cone(),
                { affinity: { 'enemy-b': 'thermal' } },
                { affinity: 'chemical' }
            ),
            'attacker'
        );
        expect(m.dots['bomb']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        const snap = (id: string) => m.actors.get(id)!.pendingBombs.map((b) => b.affinityMult);
        expect(snap('enemy-a')).toEqual([1]);
        expect(snap('enemy-b')).toEqual([0.75]);
        expect(snap('enemy-c')).toEqual([1]);
        expect(snap('enemy-out')).toEqual([]);
    });

    it('enemy-side chemical Demolisher; ally-b thermal → ally-b’s bomb carries 0.75', () => {
        const m = measure(
            enemyCasting(
                'Demolisher',
                'active',
                cone(),
                { affinity: { 'ally-b': 'thermal' } },
                { affinity: 'chemical' }
            ),
            'enemy-caster'
        );
        expect(m.dots['bomb']).toEqual(['ally-b', 'ally-c', 'attacker']);
        const snap = (id: string) => m.actors.get(id)!.pendingBombs.map((b) => b.affinityMult);
        expect(snap('attacker')).toEqual([1]);
        expect(snap('ally-b')).toEqual([0.75]);
        expect(snap('ally-c')).toEqual([1]);
    });
});

describe("Valerian's crit-power extension is rolled for each struck enemy's Corrosion", () => {
    const extended = (m: Measured, ids: string[]) =>
        ids.map((id) => m.actors.get(id)!.corrosionEntries.map((e) => e.remainingRounds));

    it('crit power 100% → every struck enemy’s fresh Corrosion II runs one turn longer', () => {
        const m = measure(
            playerCasting('Valerian', 'active', cone(), {}, { crit: 100, critDamage: 100 }),
            'attacker'
        );
        expect(extended(m, ['enemy-a', 'enemy-b', 'enemy-c', 'enemy-out'])).toEqual([
            [4],
            [4],
            [4],
            [],
        ]);
    });

    it('crit power 50% → across seeds the struck enemies’ extensions come out differently', () => {
        let mixed = false;
        for (let seed = 1; seed <= 20 && !mixed; seed++) {
            setupKeyedRng(seed);
            const m = measure(
                playerCasting('Valerian', 'active', cone(), {}, { crit: 100, critDamage: 50 }),
                'attacker'
            );
            const rounds = extended(m, ['enemy-a', 'enemy-b', 'enemy-c']).map((r) => r[0]);
            expect(rounds.every((r) => r === 3 || r === 4)).toBe(true);
            mixed = new Set(rounds).size > 1;
        }
        expect(mixed).toBe(true);
    });

    it('enemy-side Valerian, crit power 100% → every struck player ship’s Corrosion runs longer', () => {
        const m = measure(
            enemyCasting('Valerian', 'active', cone(), {}, { crit: 100, critDamage: 100 }),
            'enemy-caster'
        );
        expect(extended(m, ['attacker', 'ally-b', 'ally-c', 'ally-out'])).toEqual([
            [4],
            [4],
            [4],
            [],
        ]);
    });
});

describe('reactions to an inflicted DoT fire once per enemy it lands on', () => {
    it('player Hemlock active on Cone → Corrosion II on A, B and C → +3 charges', () => {
        const m = measure(playerCasting('Hemlock', 'active', cone()), 'attacker');
        expect(m.chargeGained).toBe(3);
        expect(m.dots['corrosion']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
    });

    it('enemy-side Hemlock active on Cone → +3 charges', () => {
        const m = measure(enemyCasting('Hemlock', 'active', cone()), 'enemy-caster');
        expect(m.chargeGained).toBe(3);
        expect(m.dots['corrosion']).toEqual(['ally-b', 'ally-c', 'attacker']);
    });

    it('player Wisteria critting on Cone → Corrosion and the crit’s Inferno II on A, B and C', () => {
        const m = measure(
            playerCasting('Wisteria', 'active', cone(), {}, { crit: 100, critDamage: 100 }),
            'attacker'
        );
        expect(m.dots['corrosion']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(m.dots['inferno']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
    });

    it('enemy-side Wisteria critting on Cone → Inferno II on the three player ships', () => {
        const m = measure(
            enemyCasting('Wisteria', 'active', cone(), {}, { crit: 100, critDamage: 100 }),
            'enemy-caster'
        );
        expect(m.dots['inferno']).toEqual(['ally-b', 'ally-c', 'attacker']);
    });
});

describe("Snakeroot's '2 stacks of Corrosion II' lands two stacks on each struck enemy", () => {
    it('player Snakeroot charged on Cone → 2 stacks on each of A, B and C', () => {
        const m = measure(playerCasting('Snakeroot', 'charged', cone()), 'attacker');
        expect(m.stacks['corrosion']).toEqual({ 'enemy-a': 2, 'enemy-b': 2, 'enemy-c': 2 });
    });

    it('enemy-side Snakeroot charged on Cone → 2 stacks on each player ship struck', () => {
        const m = measure(enemyCasting('Snakeroot', 'charged', cone()), 'enemy-caster');
        expect(m.stacks['corrosion']).toEqual({ attacker: 2, 'ally-b': 2, 'ally-c': 2 });
    });
});

describe("Lingshe's damage-less charged Bomb reaches both enemies her Backline strikes", () => {
    // Backline-Range-1 anchored on the back-most enemy (M1) covers M1 and M2.
    const BACK: [string, Position][] = [
        ['enemy-a', 'M1'],
        ['enemy-b', 'M2'],
        ['enemy-out', 'M4'],
    ];
    it('player Lingshe charged → Bomb III on A and B; not on the front enemy', () => {
        const m = measure(
            playerCasting(
                'Lingshe',
                'charged',
                parsePattern('Pattern-Backline-Range-1'),
                {},
                { target: parseTarget('back') },
                BACK
            ),
            'attacker'
        );
        expect(m.dots['bomb']).toEqual(['enemy-a', 'enemy-b']);
    });

    it('enemy-side Lingshe charged → Bomb III on the two back player ships; not the front one', () => {
        const caster: EnemyAttacker = {
            id: 'enemy-caster',
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1e9,
                speed: 10,
                security: 0,
                hacking: 1e6,
            },
            chargeCount: chargeCost('charged'),
            startCharged: true,
            position: 'M4',
            target: parseTarget('back'),
            pattern: parsePattern('Pattern-Backline-Range-1'),
            shipSkills: kit('Lingshe'),
        };
        const m = measure(
            base({
                attack: 0,
                hacking: 0,
                speed: 150,
                pattern: single(),
                position: 'M4',
                teamActors: [playerShip('ally-a', 'M1', {}), playerShip('ally-b', 'M2', {})],
                enemyAttackers: [caster],
            }),
            'enemy-caster'
        );
        expect(m.dots['bomb']).toEqual(['ally-a', 'ally-b']);
    });
});

describe("Asphyxiator's active Inferno still reaches the target and its neighbours", () => {
    it('player Asphyxiator on a single-target pattern → Inferno III on A and its adjacent enemies', () => {
        const m = measure(playerCasting('Asphyxiator', 'active', single()), 'attacker');
        // M3 (B) is M4's board neighbour; M2 (OUT) is not.
        expect(m.dots['inferno']).toContain('enemy-a');
        expect(m.dots['inferno']).toContain('enemy-b');
        expect(m.dots['inferno']).not.toContain('enemy-out');
    });
});

describe('the single-ship DPS calculator is unchanged by the DoT fan-out', () => {
    const DPS_INPUT = {
        attack: 15000,
        crit: 50,
        critDamage: 150,
        defensePenetration: 10,
        chargeCount: 3,
        enemyDefense: 8000,
        enemyHp: 400000,
        rounds: 12,
        selfBuffs: [],
        enemyDebuffs: [],
        hacking: 250,
        enemySecurity: 100,
        defence: 6000,
        hp: 30000,
    };
    const dpsTotal = (ship: string): number => {
        const built = buildTraceShip(ship);
        if (!built) throw new Error(`${ship} missing`);
        return simulateDPS({ ...DPS_INPUT, shipSkills: buildShipAbilities(built) }).summary
            .totalDamage;
    };

    it("Ravager's and Valerian's DPS runs deal the totals they dealt before the fan-out", () => {
        expect({ ravager: dpsTotal('Ravager'), valerian: dpsTotal('Valerian') }).toEqual(
            DPS_TOTALS
        );
    });
});

/** `simulateDPS` totals measured on the pre-fan-out engine (same input, same seed). */
const DPS_TOTALS = { ravager: 430_341, valerian: 429_535 };
