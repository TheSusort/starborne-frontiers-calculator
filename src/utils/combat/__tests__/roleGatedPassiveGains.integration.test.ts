/**
 * A passive self gain gated on the struck enemy's ROLE ("When damaging a debuffer or supporter,
 * this Unit gains Stealth and Tianchen Precision II" — Anjian; "gains XAOC Swiftness II … when
 * damaging a debuffer or supporter" — Rys; Sha Xing's Stealth; Shashou's "gains Stealth … after
 * damaging a debuffer or supporter") fires ONCE per damaging cast if ANY enemy the cast strikes
 * has that role, judged by that enemy's own role (owner ruling R21, 2026-10-04): Rys hits A (an
 * attacker) and B (a supporter) → Swiftness. It lands AFTER the hit, is never a combat-start
 * seed off the fight-wide enemy class, and works on both sides.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv, refit 4), active + passive. The
 * caster fires Pattern-Circle-Range-1 anchored on M4, which strikes M4 (A), M3 (B) and T4 (C);
 * M2 (OUT) stands outside it.
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
import type { EnemyBaseClass } from '../../../types/calculator';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { ParsedPattern } from '../../targetingParser';
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

const circle = (): ParsedPattern => parsePattern('Pattern-Circle-Range-1');
const single = (): ParsedPattern => parsePattern('Pattern-Base');

/** The ship's real active and passive slots, as parsed. */
const realKit = (ship: string): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const slots = buildShipAbilities(built).slots.filter(
        (s) => s.slot === 'active' || s.slot === 'passive'
    );
    if (slots.length !== 2) throw new Error(`${ship} lacks an active or a passive slot`);
    return { slots };
};
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

type Label = 'A' | 'B' | 'C' | 'OUT';
type Roles = Partial<Record<Label, ShipTypeName>>;
const POS: Record<Label, Position> = { A: 'M4', B: 'M3', C: 'T4', OUT: 'M2' };
const LABELS: Label[] = ['A', 'B', 'C', 'OUT'];

/** A durable, harmless enemy, faster than the caster. */
const enemyAt = (id: string, position: Position, role: ShipTypeName): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: single(),
    shipSkills: NO_SKILLS,
    role,
});

/** A durable, harmless player-side ship, faster than the enemy caster. */
const playerShip = (id: string, position: Position, role: ShipTypeName): TeamActor => ({
    id,
    speed: 150,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: single(),
    role,
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
    pattern: circle(),
    speed: 100,
    ...over,
});

const roleOf = (roles: Roles, l: Label): ShipTypeName => roles[l] ?? 'ATTACKER';

interface Side {
    casterId: string;
    ids: Record<Label, string>;
    input: (
        ship: string,
        pattern: ParsedPattern,
        roles: Roles,
        enemyType?: EnemyBaseClass
    ) => CombatEngineInput;
}

const PLAYER: Side = {
    casterId: 'attacker',
    ids: { A: 'enemy-a', B: 'enemy-b', C: 'enemy-c', OUT: 'enemy-out' },
    input: (ship, pattern, roles, enemyType) =>
        base({
            shipSkills: realKit(ship),
            pattern,
            ...(enemyType ? { enemyType } : {}),
            enemyAttackers: LABELS.map((l) => enemyAt(PLAYER.ids[l], POS[l], roleOf(roles, l))),
        }),
};

/** The enemy caster, slower than every player ship, strikes the focus at M4 (A), ally-b at M3
 *  (B) and ally-c at T4 (C); ally-out at M2 stands outside. */
const ENEMY: Side = {
    casterId: 'enemy-caster',
    ids: { A: 'attacker', B: 'ally-b', C: 'ally-c', OUT: 'ally-out' },
    input: (ship, pattern, roles, enemyType) =>
        base({
            attack: 0,
            speed: 150,
            pattern: single(),
            role: roleOf(roles, 'A'),
            ...(enemyType ? { enemyType } : {}),
            teamActors: (['B', 'C', 'OUT'] as Label[]).map((l) =>
                playerShip(ENEMY.ids[l], POS[l], roleOf(roles, l))
            ),
            enemyAttackers: [
                {
                    id: 'enemy-caster',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1e9,
                        speed: 10,
                        security: 0,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern,
                    shipSkills: realKit(ship),
                },
            ],
        }),
};

interface Measured {
    /** Sorted ids the caster's round-1 cast struck. */
    struck: string[];
    /** The caster's `buff-applied` names in round 1, in emission order. */
    gains: string[];
    /** Whether the named gain was emitted after the caster's round-1 cast began — never as a
     *  combat-start seed. */
    afterCast: (buffName: string) => boolean;
    /** Direct damage the caster's round-N hits dealt to the aimed enemy. */
    aimedDamage: (round: number) => number;
}

const measure = (
    side: Side,
    ship: string,
    roles: Roles,
    opts: { pattern?: ParsedPattern; enemyType?: EnemyBaseClass; numRounds?: number } = {}
): Measured => {
    const bus = createEventBus();
    const caster = side.casterId;
    const struck = new Set<string>();
    const gains: string[] = [];
    const log: string[] = [];
    const aimed = new Map<number, number>();
    bus.on('skill-fired', (e: Extract<CombatEvent, { type: 'skill-fired' }>) => {
        if (e.actorId === caster && e.round === 1) log.push('cast');
    });
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId !== caster) return;
        if (e.targetId === side.ids.A)
            aimed.set(e.round, (aimed.get(e.round) ?? 0) + (e.damage ?? 0));
        if (e.round === 1) struck.add(e.targetId);
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.actorId !== caster || e.round !== 1) return;
        gains.push(e.buffName);
        log.push(`buff:${e.buffName}`);
    });
    runCombat({
        ...side.input(ship, opts.pattern ?? circle(), roles, opts.enemyType),
        ...(opts.numRounds ? { numRounds: opts.numRounds } : {}),
        bus,
    });
    return {
        struck: [...struck].sort(),
        gains,
        afterCast: (name) => {
            const at = log.indexOf(`buff:${name}`);
            const cast = log.indexOf('cast');
            return at >= 0 && cast >= 0 && cast < at;
        },
        aimedDamage: (round) => aimed.get(round) ?? 0,
    };
};

const only = (m: Measured, name: string): string[] => m.gains.filter((g) => g === name);

beforeEach(() => {
    setupKeyedRng(7);
});

/** Each carrier and the gains its role-gated clause grants. */
const CARRIERS: { ship: string; gains: string[] }[] = [
    { ship: 'Anjian', gains: ['Stealth', 'Tianchao Precision II'] },
    { ship: 'Rys', gains: ['XAOC Swiftness II'] },
    { ship: 'Sha Xing', gains: ['Stealth'] },
    { ship: 'Shashou', gains: ['Stealth'] },
];

for (const { ship, gains } of CARRIERS) {
    describe(`${ship}: a role-gated passive gain fires once if any struck enemy has the role`, () => {
        for (const side of [PLAYER, ENEMY]) {
            const tag = side === PLAYER ? 'player' : 'enemy-side';
            it(`${tag}: A attacker, B supporter, C attacker → gains once, during the cast`, () => {
                const m = measure(side, ship, { B: 'SUPPORTER' });
                expect(m.struck).toEqual([side.ids.A, side.ids.B, side.ids.C].sort());
                for (const g of gains) {
                    expect(only(m, g)).toEqual([g]);
                    expect(m.afterCast(g)).toBe(true);
                }
            });
            it(`${tag}, reversed: the aimed A is a debuffer, B and C attackers → gains once`, () => {
                const m = measure(side, ship, { A: 'DEBUFFER_BOMBER' });
                for (const g of gains) expect(only(m, g)).toEqual([g]);
            });
            it(`${tag}: B and C both supporters → still once`, () => {
                const m = measure(side, ship, { B: 'SUPPORTER', C: 'SUPPORTER_BUFFER' });
                for (const g of gains) expect(only(m, g)).toEqual([g]);
            });
            it(`${tag}: every struck enemy an attacker, OUT a supporter → nothing`, () => {
                const m = measure(side, ship, { OUT: 'SUPPORTER' });
                for (const g of gains) expect(only(m, g)).toEqual([]);
            });
            it(`${tag}: a fight-wide Supporter class with no struck supporter seeds nothing`, () => {
                const m = measure(side, ship, {}, { enemyType: 'Supporter' });
                for (const g of gains) expect(only(m, g)).toEqual([]);
            });
        }
        it('player, Pattern-Base: B a supporter is not struck → nothing; A a supporter → gains', () => {
            const none = measure(PLAYER, ship, { B: 'SUPPORTER' }, { pattern: single() });
            expect(none.struck).toEqual(['enemy-a']);
            for (const g of gains) expect(only(none, g)).toEqual([]);
            const aimed = measure(PLAYER, ship, { A: 'SUPPORTER' }, { pattern: single() });
            for (const g of gains) expect(only(aimed, g)).toEqual([g]);
        });
    });
}

describe('Rys: XAOC Swiftness II lands after the hit that earned it', () => {
    for (const side of [PLAYER, ENEMY]) {
        const tag = side === PLAYER ? 'player' : 'enemy-side';
        it(`${tag}: round 1's hit is unboosted; round 2's carries the +10% attack`, () => {
            const gained = measure(side, 'Rys', { B: 'SUPPORTER' }, { numRounds: 2 });
            const plain = measure(side, 'Rys', {}, { numRounds: 2 });
            expect(gained.aimedDamage(1)).toBeGreaterThan(0);
            expect(gained.aimedDamage(1)).toBe(plain.aimedDamage(1));
            expect(gained.aimedDamage(2)).toBeGreaterThan(plain.aimedDamage(2));
        });
    }
});

describe('DPS calculator: the configured enemy class decides, on every damaging cast', () => {
    const run = (ship: string, buffName: string, enemyType: EnemyBaseClass): number[] => {
        const built = buildTraceShip(ship);
        if (!built) throw new Error(`${ship} missing`);
        const bus = createEventBus();
        const rounds: number[] = [];
        bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
            if (e.buffName === buffName) rounds.push(e.round);
        });
        simulateDPS({
            attack: 15000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            chargeCount: 99,
            enemyDefense: 8000,
            enemyHp: 1e12,
            rounds: 3,
            selfBuffs: [],
            enemyDebuffs: [],
            enemyType,
            hacking: 1e6,
            enemySecurity: 0,
            defence: 6000,
            hp: 30000,
            shipSkills: buildShipAbilities(built),
            bus,
        });
        return rounds;
    };
    for (const [ship, buffName] of [
        ['Anjian', 'Stealth'],
        ['Rys', 'XAOC Swiftness II'],
        ['Sha Xing', 'Stealth'],
        ['Shashou', 'Stealth'],
    ] as const) {
        it(`${ship}: against a Debuffer, ${buffName} every round; against an Attacker, never`, () => {
            expect(run(ship, buffName, 'Debuffer')).toEqual([1, 2, 3]);
            expect(run(ship, buffName, 'Attacker')).toEqual([]);
        });
    }
});
