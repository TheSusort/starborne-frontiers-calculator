/**
 * "If the target is a defender" asks the struck enemy's OWN role (owner ruling 4, 2026-10-03):
 * Gallant's charged Stasis lands on a defender and not on an attacker, whatever the fight-wide
 * enemy class says; with a cast that reaches A and B (defenders) and C (an attacker), A and B are
 * stasised. The fight-wide class still answers where no actor carries a role — the DPS
 * calculator — so its numbers do not move.
 *
 * Battle arms use runCombat with role-carrying actors on Pattern-Base (real kits) or
 * Pattern-Circle-Range-1 (hand-built `'all-enemies'` clause), anchored on M4. The caster's
 * hacking dwarfs every security.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent, CombatEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { EnemyBaseClass } from '../../../types/calculator';
import type { Position } from '../../../types/encounters';
import type { ShipTypeName } from '../../../constants/shipTypes';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const realSlot = (ship: string, slot: 'active' | 'charged'): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return { slots: [{ slot, abilities: found.abilities }] };
};

let idc = 0;
const defenderGatedStasis = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `rg-${++idc}`,
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
                {
                    id: `rg-${++idc}`,
                    type: 'debuff',
                    target: 'all-enemies',
                    trigger: 'on-cast',
                    conditions: [
                        { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
                    ],
                    config: {
                        type: 'debuff',
                        buffName: 'Stasis',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 1,
                        application: 'inflict',
                    },
                } satisfies Ability,
            ],
        },
    ],
});

const enemy = (id: string, position: Position, role?: ShipTypeName): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    ...(role ? { role } : {}),
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 1,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: true,
    startCharged: true,
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
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

/** Targets of `casterId`'s round-1 `buffName` landings, sorted. */
const landed = (input: CombatEngineInput, casterId: string, buffName: string): string[] => {
    const bus = createEventBus();
    const out: string[] = [];
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === casterId && e.buffName === buffName && e.round === 1)
            out.push(e.targetId);
    });
    runCombat({ ...input, bus });
    return out.sort();
};

beforeEach(() => {
    idc = 0;
    setupKeyedRng(13);
});

describe("Gallant's charged Stasis reads the targeted enemy's role", () => {
    const gallant = (role: ShipTypeName, enemyType?: EnemyBaseClass): string[] =>
        landed(
            base({
                shipSkills: realSlot('Gallant', 'charged'),
                ...(enemyType ? { enemyType } : {}),
                enemyAttackers: [enemy('enemy-a', 'M4', role)],
            }),
            'attacker',
            'Stasis'
        );

    it('a defender, with no fight-wide class set → stasised', () => {
        expect(gallant('DEFENDER')).toEqual(['enemy-a']);
    });

    it('a security defender counts as a defender → stasised', () => {
        expect(gallant('DEFENDER_SECURITY')).toEqual(['enemy-a']);
    });

    it('an attacker, though the fight-wide class says Defender → not stasised', () => {
        expect(gallant('ATTACKER', 'Defender')).toEqual([]);
    });
});

describe("Lodolite's active Concentrate Fire reads the targeted enemy's role", () => {
    const lodolite = (role: ShipTypeName): string[] =>
        landed(
            base({
                chargeCount: 0,
                hasChargedSkill: false,
                startCharged: false,
                shipSkills: realSlot('Lodolite', 'active'),
                enemyAttackers: [enemy('enemy-a', 'M4', role)],
            }),
            'attacker',
            'Concentrate Fire'
        );

    it('a non-defender → Concentrate Fire applied', () => {
        expect(lodolite('SUPPORTER')).toEqual(['enemy-a']);
    });

    it('a defender → none', () => {
        expect(lodolite('DEFENDER')).toEqual([]);
    });
});

describe('a role gate on a cast that reaches several enemies reads each one', () => {
    it('A and B defenders, C an attacker → A and B', () => {
        expect(
            landed(
                base({
                    chargeCount: 0,
                    hasChargedSkill: false,
                    startCharged: false,
                    pattern: parsePattern('Pattern-Circle-Range-1'),
                    shipSkills: defenderGatedStasis(),
                    enemyAttackers: [
                        enemy('enemy-a', 'M4', 'DEFENDER'),
                        enemy('enemy-b', 'M3', 'DEFENDER_SECURITY'),
                        enemy('enemy-c', 'T4', 'ATTACKER'),
                    ],
                }),
                'attacker',
                'Stasis'
            )
        ).toEqual(['enemy-a', 'enemy-b']);
    });
});

describe('an enemy role gate on a cast that reaches several player ships reads each one', () => {
    const ally = (id: string, position: Position, role: ShipTypeName) => ({
        id,
        role,
        speed: 150,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        walk: {
            shipSkills: { slots: [{ slot: 'active' as const, abilities: [] }] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1e9,
            },
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    it('focus and B defenders, C an attacker → focus and B', () => {
        expect(
            landed(
                base({
                    attack: 0,
                    hacking: 0,
                    chargeCount: 0,
                    hasChargedSkill: false,
                    startCharged: false,
                    speed: 150,
                    role: 'DEFENDER',
                    teamActors: [
                        ally('ally-b', 'M3', 'DEFENDER_SECURITY'),
                        ally('ally-c', 'T4', 'ATTACKER'),
                    ],
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
                                hacking: 1e6,
                            },
                            chargeCount: 0,
                            startCharged: false,
                            position: 'M4',
                            target: parseTarget('front'),
                            pattern: parsePattern('Pattern-Circle-Range-1'),
                            shipSkills: defenderGatedStasis(),
                        },
                    ],
                }),
                'enemy-caster',
                'Stasis'
            )
        ).toEqual(['ally-b', 'attacker']);
    });
});

describe("enemy-side Gallant reads the targeted player ship's role", () => {
    const enemyGallant = (): EnemyAttacker => ({
        id: 'enemy-gallant',
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
        chargeCount: 1,
        startCharged: true,
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        shipSkills: realSlot('Gallant', 'charged'),
    });
    const run = (role: ShipTypeName): string[] =>
        landed(
            base({
                attack: 0,
                hacking: 0,
                chargeCount: 0,
                hasChargedSkill: false,
                startCharged: false,
                speed: 150,
                role,
                enemyAttackers: [enemyGallant()],
            }),
            'enemy-gallant',
            'Stasis'
        );

    it('a defender focus → stasised', () => {
        expect(run('DEFENDER')).toEqual(['attacker']);
    });

    it('an attacker focus → not stasised', () => {
        expect(run('ATTACKER')).toEqual([]);
    });
});

describe('DPS calculator: no actor role, the configured enemy class decides', () => {
    const dps = (enemyType: EnemyBaseClass): number => {
        const bus: CombatEventBus = createEventBus();
        let stasis = 0;
        bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
            if (e.sourceId === 'attacker' && e.buffName === 'Stasis') stasis++;
        });
        simulateDPS({
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 1,
            startCharged: true,
            enemyDefense: 0,
            enemyHp: 1e9,
            rounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            hacking: 1e6,
            enemySecurity: 0,
            enemyType,
            shipSkills: realSlot('Gallant', 'charged'),
            bus,
        });
        return stasis;
    };

    it('Defender → Gallant stasises its target', () => {
        expect(dps('Defender')).toBe(1);
    });

    it('Attacker → it does not', () => {
        expect(dps('Attacker')).toBe(0);
    });
});
