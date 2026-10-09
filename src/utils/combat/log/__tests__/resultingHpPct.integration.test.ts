/**
 * Every damaging combat-log row carries the victim's HP right after it ([N%]).
 *
 * The engine emits `hp-changed` BEFORE the `attacked` that opens a hit's row (and AFTER the
 * `dot-ticked` / `bomb-detonated` rows), so the builder has to pair them from both directions.
 * Asserted through `simulateBattle` + `flattenCombatLog` — hand-built event streams that emit
 * `attacked` first cannot catch an ordering bug.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../../calculators/battleSimulator';
import { setupKeyedRng } from '../../../calculators/rateAccumulator';
import { flattenCombatLog } from '../__testutils__/flattenCombatLog';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable()) throw new Error('docs/ship-skills.csv is required for the real kits');
});

const HP = 100_000;

const place = (ship: Ship, position: Position, speed: number, hp = HP): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 30_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 5_000,
        security: 100,
        defence: 0,
        hp,
        speed,
    },
});

const plainShip = (name: string): Ship =>
    ({
        id: name,
        name,
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        affinity: 'antimatter',
        activeSkillText: 'This Unit deals <unit-damage>40% damage</unit-damage>.',
        chargeSkillCharge: 0,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as Partial<Ship> as Ship;

const real = (name: string): Ship => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} is missing from the reference data in this worktree`);
    return { ...ship, affinity: 'antimatter' };
};

describe('combat log [N%]', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side} side: each hit shows the victim's HP after that hit`, () => {
            setupKeyedRng(11);
            const striker = place(plainShip('Striker'), 'M4', 200, 1e9);
            const target = place(plainShip('Target'), 'M4', 50);
            const result = simulateBattle({
                playerTeam: side === 'player' ? [striker] : [target],
                enemyTeam: side === 'player' ? [target] : [striker],
                rounds: 3,
            });
            const targetId = result.roster.find((r) => r.name === 'Target')!.actorId;
            const strikerId = result.roster.find((r) => r.name === 'Striker')!.actorId;
            const hits = flattenCombatLog(result)
                .filter((e) => e.kind === 'attack' && e.actorId === strikerId)
                .flatMap((e) => e.targets.filter((t) => t.targetId === targetId));
            expect(hits.length).toBeGreaterThanOrEqual(2);
            let hpLeft = HP;
            for (const hit of hits) {
                expect(hit.amount).toBeGreaterThan(0);
                hpLeft = Math.max(0, hpLeft - (hit.amount ?? 0));
                expect(hit.resultingHpPct).toBeCloseTo((100 * hpLeft) / HP, 6);
            }
        });
    }

    const fleet = (names: string[], hp: number): BattlePlacement[] =>
        names.map((n, i) =>
            place(real(n), (['M4', 'T4', 'B4', 'M3'] as Position[])[i], 140 - i * 10, hp)
        );

    for (const flip of [false, true]) {
        it(`kit-rich 4v4 (${flip ? 'mirrored' : 'as listed'}): every damaging attack row carries a %`, () => {
            setupKeyedRng(23);
            const a = fleet(['Demolisher', 'Hemlock', 'Valkyrie', 'Provider'], 150_000);
            const b = fleet(['Nosorog', 'Iridium', 'Tygr', 'Larkspur'], 150_000);
            const result = simulateBattle({
                playerTeam: flip ? b : a,
                enemyTeam: flip ? a : b,
                rounds: 6,
            });
            const rows = flattenCombatLog(result).filter((e) => e.kind === 'attack');
            const damaging = rows.flatMap((e) => e.targets.filter((t) => (t.amount ?? 0) > 0));
            expect(damaging.length).toBeGreaterThan(20);
            const bare = damaging.filter((t) => t.resultingHpPct === undefined);
            expect(bare).toEqual([]);
            for (const t of damaging) {
                expect(t.resultingHpPct).toBeGreaterThanOrEqual(0);
                expect(t.resultingHpPct).toBeLessThanOrEqual(100);
            }
        });
    }
});
