/**
 * Reactions to what an area skill does fire once per enemy it does it to (owner rulings
 * 2026-10-03): Defiant's shield per Stasis inflicted, Laika's shield per shield removed, Warden's
 * follow-up debuff per inflicted debuff, Xcellence's damage per resisting enemy. Hemlock's charge
 * is the exception: one per skill cast however many enemies it debuffs (owner ruling 2026-10-07).
 * "Applies" (Provoke) is not "inflicts" (#593), on every enemy.
 *
 * Real parsed kits (refit 4). The caster fires Pattern-Circle-Range-1 anchored on M4, striking
 * M4 (A), M3 (B) and T4 (C); M2 (OUT) stands outside it. Caster hacking dwarfs every security
 * unless a test raises one enemy's.
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
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
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

const realSlot = (ship: string, slot: Slot): Ability[] => {
    const built = buildTraceShip(ship, { refitLevel: 4 });
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return found.abilities;
};
/** `ship`'s real firing `slot` plus its real passive. */
const kit = (ship: string, slot: 'active' | 'charged', passiveOf = ship): ShipSkills => ({
    slots: [
        { slot, abilities: realSlot(ship, slot) },
        { slot: 'passive', abilities: realSlot(passiveOf, 'passive') },
    ],
});

const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
const HP = 100_000;
const SHIELD = 100_000;

const ENEMY_POSITIONS: [string, Position][] = [
    ['enemy-a', 'M4'],
    ['enemy-b', 'M3'],
    ['enemy-c', 'T4'],
    ['enemy-out', 'M2'],
];
const enemyAt = (id: string, position: Position, security = 0): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: NO_SKILLS,
});
const enemyRow = (security: Record<string, number> = {}): EnemyAttacker[] =>
    ENEMY_POSITIONS.map(([id, p]) => enemyAt(id, p, security[id] ?? 0));

const playerShip = (id: string, position: Position, security = 0): TeamActor => ({
    id,
    speed: 150,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
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
            security,
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
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 6,
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
    hp: HP,
    hacking: 1e4,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Circle-Range-1'),
    speed: 100,
    ...over,
});

/** The player caster firing `skills` (a charged slot fires on round 1). */
const playerCasting = (skills: ShipSkills, over: Partial<CombatEngineInput> = {}) =>
    base({
        shipSkills: skills,
        ...(skills.slots.some((s) => s.slot === 'charged')
            ? { hasChargedSkill: true, startCharged: true }
            : {}),
        enemyAttackers: enemyRow(),
        ...over,
    });

/** The enemy caster firing `skills` from M4 against player ships at M4 / M3 / T4 / M2. */
const enemyCasting = (skills: ShipSkills, playerSecurity: Record<string, number> = {}) => {
    const charged = skills.slots.some((s) => s.slot === 'charged');
    const caster: EnemyAttacker = {
        id: 'enemy-caster',
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: HP,
            speed: 10,
            security: 0,
            hacking: 1e4,
        },
        chargeCount: 6,
        startCharged: charged,
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Circle-Range-1'),
        shipSkills: skills,
    };
    return base({
        attack: 0,
        hacking: 0,
        hp: 1e9,
        speed: 150,
        security: playerSecurity['attacker'] ?? 0,
        pattern: parsePattern('Pattern-Base'),
        teamActors: [
            playerShip('ally-b', 'M3', playerSecurity['ally-b']),
            playerShip('ally-c', 'T4', playerSecurity['ally-c']),
            playerShip('ally-out', 'M2'),
        ],
        enemyAttackers: [caster],
    });
};

interface Measured {
    /** Passive charge the caster gained in round 1. */
    chargeGained: number;
    /** `buffName → sorted target ids` of the caster's round-1 `debuff-applied`. */
    debuffs: Record<string, string[]>;
    /** Target ids of the caster's round-1 reactive damage. */
    reactiveDamageTargets: string[];
    actors: Map<string, CombatActor>;
}

const measure = (
    input: CombatEngineInput,
    casterId: string,
    seed: (a: CombatActor) => void = () => {}
): Measured => {
    const bus = createEventBus();
    let chargeGained = 0;
    const debuffs: Record<string, string[]> = {};
    const reactiveDamageTargets: string[] = [];
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.actorId === casterId && e.round === 1 && e.reason === 'manip')
            chargeGained += e.newCharge - e.oldCharge;
    });
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === casterId && e.round === 1) (debuffs[e.buffName] ??= []).push(e.targetId);
    });
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.sourceId === casterId && e.round === 1) reactiveDamageTargets.push(e.targetId);
        }
    );
    const actors = new Map<string, CombatActor>();
    runCombat({
        ...input,
        bus,
        __testTapActors: (all) => {
            for (const a of all) {
                actors.set(a.id, a);
                seed(a);
            }
        },
    });
    for (const k of Object.keys(debuffs)) debuffs[k].sort();
    reactiveDamageTargets.sort();
    return { chargeGained, debuffs, reactiveDamageTargets, actors };
};

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Hemlock: one charge per cast, however many enemies his debuff lands on', () => {
    it('player Hemlock charged on Circle → Toxic Overflow on A, B and C → +1 charge', () => {
        const m = measure(playerCasting(kit('Hemlock', 'charged')), 'attacker');
        expect(m.debuffs['Toxic Overflow']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(m.chargeGained).toBe(1);
    });

    it('enemy-side Hemlock charged on Circle → +1 charge', () => {
        const m = measure(enemyCasting(kit('Hemlock', 'charged')), 'enemy-caster');
        expect(m.debuffs['Toxic Overflow']).toEqual(['ally-b', 'ally-c', 'attacker']);
        expect(m.chargeGained).toBe(1);
    });
});

describe('Defiant: one 30% shield per enemy his Stasis lands on', () => {
    const shieldPct = (m: Measured, id: string) =>
        Math.round((100 * m.actors.get(id)!.shieldPool) / HP);

    it('player Defiant charged on Circle → Stasis on A, B and C → three 30% shields', () => {
        const m = measure(playerCasting(kit('Defiant', 'charged')), 'attacker');
        expect(m.debuffs['Stasis']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(shieldPct(m, 'attacker')).toBe(90);
    });

    it('B resists → two shields', () => {
        const m = measure(
            playerCasting(kit('Defiant', 'charged'), {
                enemyAttackers: enemyRow({ 'enemy-b': 1e9 }),
            }),
            'attacker'
        );
        expect(m.debuffs['Stasis']).toEqual(['enemy-a', 'enemy-c']);
        expect(shieldPct(m, 'attacker')).toBe(60);
    });

    it('enemy-side Defiant charged on Circle → three 30% shields', () => {
        const m = measure(enemyCasting(kit('Defiant', 'charged')), 'enemy-caster');
        expect(m.debuffs['Stasis']).toEqual(['ally-b', 'ally-c', 'attacker']);
        expect(shieldPct(m, 'enemy-caster')).toBe(90);
    });
});

describe('Laika: one 30% shield per enemy she strips', () => {
    const shielded = (ids: string[]) => (a: CombatActor) => {
        if (ids.includes(a.id)) a.shieldPool = SHIELD;
    };
    const ownShieldPct = (m: Measured, id: string) =>
        Math.round((100 * m.actors.get(id)!.shieldPool) / HP);

    it('player Laika charged on Circle, A, B and C shielded → three shield gains', () => {
        const m = measure(
            playerCasting(kit('Laika', 'charged')),
            'attacker',
            shielded(['enemy-a', 'enemy-b', 'enemy-c', 'enemy-out'])
        );
        expect(ownShieldPct(m, 'attacker')).toBe(90);
    });

    it('only B shielded → one shield gain', () => {
        const m = measure(
            playerCasting(kit('Laika', 'charged')),
            'attacker',
            shielded(['enemy-b'])
        );
        expect(ownShieldPct(m, 'attacker')).toBe(30);
    });

    it('enemy-side Laika charged on Circle → three shield gains', () => {
        const m = measure(
            enemyCasting(kit('Laika', 'charged')),
            'enemy-caster',
            shielded(['attacker', 'ally-b', 'ally-c', 'ally-out'])
        );
        expect(ownShieldPct(m, 'enemy-caster')).toBe(90);
    });
});

describe("Warden: 'when this Unit inflicts a debuff' fires per enemy, and never for 'applies'", () => {
    it("player Warden's active applies Provoke to A, B and C → no Out. Damage Down II (#593)", () => {
        const m = measure(playerCasting(kit('Warden', 'active')), 'attacker');
        expect(m.debuffs['Provoke']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(m.debuffs['Out. Damage Down II']).toBeUndefined();
    });

    it("Guardian's active (applies Provoke, inflicts Crit Power Down) with Warden's passive → Out. Damage Down II once on each of A, B and C", () => {
        const m = measure(playerCasting(kit('Guardian', 'active', 'Warden')), 'attacker');
        expect(m.debuffs['Provoke']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(m.debuffs['Crit Power Down II']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(m.debuffs['Out. Damage Down II']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
    });

    it('enemy-side: the same cast → Out. Damage Down II once on each player ship', () => {
        const m = measure(enemyCasting(kit('Guardian', 'active', 'Warden')), 'enemy-caster');
        expect(m.debuffs['Out. Damage Down II']).toEqual(['ally-b', 'ally-c', 'attacker']);
    });
});

describe('Xcellence: damage per enemy that resists', () => {
    const shieldedCaster = (id: string) => (a: CombatActor) => {
        if (a.id === id) a.shieldPool = SHIELD;
    };

    it('player Xcellence active on Circle; B and C resist → one reactive hit on each of B and C', () => {
        const m = measure(
            playerCasting(kit('Xcellence', 'active'), {
                enemyAttackers: enemyRow({ 'enemy-b': 1e9, 'enemy-c': 1e9 }),
            }),
            'attacker',
            shieldedCaster('attacker')
        );
        expect(m.debuffs['Stasis']).toEqual(['enemy-a']);
        expect(m.reactiveDamageTargets).toEqual(['enemy-b', 'enemy-c']);
    });

    it('enemy-side Xcellence; B and C resist → one reactive hit on each', () => {
        const m = measure(
            enemyCasting(kit('Xcellence', 'active'), { 'ally-b': 1e9, 'ally-c': 1e9 }),
            'enemy-caster',
            shieldedCaster('enemy-caster')
        );
        expect(m.reactiveDamageTargets).toEqual(['ally-b', 'ally-c']);
    });
});

describe('Ripper: one Inferno II per enemy his cast debuffs, however many debuffs it lands there', () => {
    /** Target ids of `casterId`'s round-1 Inferno applications. */
    const infernoTargets = (input: CombatEngineInput, casterId: string): string[] => {
        const bus = createEventBus();
        const out: string[] = [];
        bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
            if (e.sourceId === casterId && e.round === 1 && e.dotType === 'inferno')
                out.push(e.targetId);
        });
        runCombat({ ...input, bus });
        return out.sort();
    };

    it('player Ripper charged on Circle → two debuffs on each of A, B and C → one Inferno on each', () => {
        expect(infernoTargets(playerCasting(kit('Ripper', 'charged')), 'attacker')).toEqual([
            'enemy-a',
            'enemy-b',
            'enemy-c',
        ]);
    });

    it('enemy-side Ripper charged on Circle → one Inferno on each player ship', () => {
        expect(infernoTargets(enemyCasting(kit('Ripper', 'charged')), 'enemy-caster')).toEqual([
            'ally-b',
            'ally-c',
            'attacker',
        ]);
    });
});
