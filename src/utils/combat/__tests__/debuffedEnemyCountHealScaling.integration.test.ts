/**
 * Per-count cast repairs (owner rulings 2026-10-03):
 *
 *   - Oleander active — "repairs 10% of its max HP, with an additional 8.5% repair for each
 *     debuffed enemy": counts ENEMY UNITS carrying at least one debuff, not debuffs. Enemy A with
 *     3 debuffs + enemy B clean → 10% + 8.5%; both debuffed → 10% + 17%; nobody debuffed → 10%.
 *   - Meatshield charged — "repairs 1.5% of its max HP for each debuff on itself": 0 debuffs → no
 *     repair, 2 debuffs → 3%.
 *
 * Real parsed abilities (buildTraceShip on docs/ship-skills.csv). Debuffs reach the board from a
 * faster debuffer on the healer's side (or, for Meatshield, the opposing side) before the healer's
 * round-1 turn. Repairs are read off the healer's own `heal-performed` events (crit 0, so no crit
 * multiplier), as the raw amount booked for one recipient.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

const hasReferenceData = (): boolean => csvAvailable() && shipDataAvailable();

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const frontEnemy = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
/** Oleander's real cast is ally-targeted: it binds no opposing victim. */
const allyTeam = (): ParsedTarget => ({ raw: 'team', side: 'ally', selection: 'team' });
const single = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const everyone = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

const realSlot = (ship: string, slot: 'active' | 'charged'): Ability[] => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return found.abilities;
};

/** An inflicted debuff with no stat effects. */
const debuff = (name: string, target: 'enemy' | 'all-enemies' = 'enemy'): Ability => ({
    id: `deb-${name}-${target}`,
    type: 'debuff',
    target,
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: name,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        duration: 5,
    },
});

const kit = (abilities: Ability[]): ShipSkills => ({ slots: [{ slot: 'active', abilities }] });

const HEALER_HP = 1_000_000;

const durableEnemy = (
    id: string,
    position: Position,
    shipSkills: ShipSkills = kit([]),
    speed = 50
): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed,
        security: 0,
        hacking: 999,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: frontEnemy(),
    pattern: single(),
    shipSkills,
});

/** A team ally faster than the healer that casts `abilities` with `pattern` on the front enemy. */
const teamDebuffer = (abilities: Ability[], pattern: ParsedPattern): TeamActor => ({
    id: 'debuffer',
    speed: 200,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M3',
    target: frontEnemy(),
    pattern,
    walk: {
        shipSkills: kit(abilities),
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 999,
            defence: 0,
            hp: 1_000_000_000,
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
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: kit([]),
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
    hp: HEALER_HP,
    hacking: 999,
    security: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: frontEnemy(),
    pattern: single(),
    speed: 100,
    ...over,
});

/** Round-1 repair `casterId` booked on `recipientId`, summed over its cast's heal events. */
const repairOn = (input: CombatEngineInput, casterId: string, recipientId: string): number => {
    const bus = createEventBus();
    let total = 0;
    bus.on('heal-performed', (e) => {
        if (e.casterId !== casterId || e.round !== 1) return;
        for (const t of e.perTarget ?? []) if (t.targetId === recipientId) total += t.amount;
    });
    runCombat({ ...input, bus });
    return total;
};

const pctOf = (hp: number, pct: number): number => (hp * pct) / 100;

beforeEach(() => {
    setupKeyedRng(5);
});

describe.skipIf(!hasReferenceData())(
    "Oleander's real active parses to a debuffed-enemy count",
    () => {
        it('base 10% repair + 8.5% per debuffed enemy', () => {
            const heal = realSlot('Oleander', 'active').find((a) => a.type === 'heal');
            expect(heal?.config).toMatchObject({ type: 'heal', pct: 10, basis: 'hp' });
            expect(heal?.scaling).toEqual({ conditionIndex: 0, perUnit: 8.5 });
            expect(heal?.conditions).toEqual([
                { subject: 'debuffed-enemy-count', derivable: true },
            ]);
        });
    }
);

describe.skipIf(!hasReferenceData())('Oleander active — +8.5% per debuffed enemy', () => {
    const oleander = (debuffer: TeamActor | undefined): number =>
        repairOn(
            base({
                shipSkills: kit(realSlot('Oleander', 'active')),
                target: allyTeam(),
                enemyAttackers: [durableEnemy('enemy-a', 'M4'), durableEnemy('enemy-b', 'M3')],
                teamActors: debuffer ? [debuffer] : [],
            }),
            'attacker',
            'attacker'
        );

    it('nobody debuffed → the base 10%', () => {
        expect(oleander(teamDebuffer([], single()))).toBeCloseTo(pctOf(HEALER_HP, 10), 6);
    });

    it('enemy A with three debuffs, enemy B clean → one debuffed enemy, +8.5%', () => {
        const threeOnFront = teamDebuffer(
            [debuff('Debuff A'), debuff('Debuff B'), debuff('Debuff C')],
            single()
        );
        expect(oleander(threeOnFront)).toBeCloseTo(pctOf(HEALER_HP, 18.5), 6);
    });

    it('both enemies debuffed → +17%', () => {
        const onBoth = teamDebuffer([debuff('Debuff A', 'all-enemies')], everyone());
        expect(oleander(onBoth)).toBeCloseTo(pctOf(HEALER_HP, 27), 6);
    });
});

describe.skipIf(!hasReferenceData())('enemy-side Oleander counts debuffed player ships', () => {
    /** The player focus at M4 and a team ship at M3; a fast enemy debuffs them before the enemy
     *  Oleander's turn. */
    const enemyOleander = (debuffs: Ability[], pattern: ParsedPattern): number => {
        const debuffer: EnemyAttacker = {
            ...durableEnemy('enemy-debuffer', 'M3', kit(debuffs), 300),
            pattern,
        };
        const oleander: EnemyAttacker = {
            ...durableEnemy('enemy-oleander', 'M4', kit(realSlot('Oleander', 'active')), 10),
            stats: { ...durableEnemy('x', 'M4').stats, hp: HEALER_HP, speed: 10 },
            target: allyTeam(),
        };
        const teammate: TeamActor = { ...teamDebuffer([], single()), id: 'teammate', speed: 1 };
        return repairOn(
            base({
                speed: 1,
                enemyAttackers: [debuffer, oleander],
                teamActors: [teammate],
            }),
            'enemy-oleander',
            'enemy-oleander'
        );
    };

    it('no player ship debuffed → the base 10%', () => {
        expect(enemyOleander([], single())).toBeCloseTo(pctOf(HEALER_HP, 10), 6);
    });

    it('only the front player ship debuffed (twice) → +8.5%', () => {
        expect(enemyOleander([debuff('Debuff A'), debuff('Debuff B')], single())).toBeCloseTo(
            pctOf(HEALER_HP, 18.5),
            6
        );
    });

    it('both player ships debuffed → +17%', () => {
        expect(enemyOleander([debuff('Debuff A', 'all-enemies')], everyone())).toBeCloseTo(
            pctOf(HEALER_HP, 27),
            6
        );
    });
});

describe.skipIf(!hasReferenceData())('Meatshield charged — 1.5% per debuff on herself', () => {
    const MEATSHIELD_HP = 100_000;
    const charged = {
        hasChargedSkill: true,
        startCharged: true,
        chargeCount: 3,
    };

    /** Player-side Meatshield, debuffed first by a fast enemy. */
    const playerMeatshield = (debuffs: Ability[]): number =>
        repairOn(
            base({
                ...charged,
                hp: MEATSHIELD_HP,
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: realSlot('Meatshield', 'active') },
                        { slot: 'charged', abilities: realSlot('Meatshield', 'charged') },
                    ],
                },
                enemyAttackers: [durableEnemy('enemy-debuffer', 'M4', kit(debuffs), 300)],
            }),
            'attacker',
            'attacker'
        );

    it('no debuff on herself → no repair', () => {
        expect(playerMeatshield([])).toBe(0);
    });

    it('two debuffs on herself → 3% of her max HP', () => {
        expect(playerMeatshield([debuff('Debuff A'), debuff('Debuff B')])).toBeCloseTo(
            pctOf(MEATSHIELD_HP, 3),
            6
        );
    });

    /** Enemy-side Meatshield, debuffed first by the faster player focus. */
    const enemyMeatshield = (debuffs: Ability[]): number =>
        repairOn(
            base({
                speed: 300,
                shipSkills: kit(debuffs),
                enemyAttackers: [
                    {
                        ...durableEnemy('enemy-meatshield', 'M4', undefined, 10),
                        stats: {
                            ...durableEnemy('x', 'M4').stats,
                            hp: MEATSHIELD_HP,
                            speed: 10,
                        },
                        chargeCount: 3,
                        startCharged: true,
                        shipSkills: {
                            slots: [
                                { slot: 'active', abilities: realSlot('Meatshield', 'active') },
                                { slot: 'charged', abilities: realSlot('Meatshield', 'charged') },
                            ],
                        },
                    },
                ],
            }),
            'enemy-meatshield',
            'enemy-meatshield'
        );

    it('enemy side: no debuff on herself → no repair', () => {
        expect(enemyMeatshield([])).toBe(0);
    });

    it('enemy side: two debuffs on herself → 3% of her max HP', () => {
        expect(enemyMeatshield([debuff('Debuff A'), debuff('Debuff B')])).toBeCloseTo(
            pctOf(MEATSHIELD_HP, 3),
            6
        );
    });
});
