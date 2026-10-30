/**
 * LOG-ONLY rows for status changes that otherwise leave no trace: a duration extension
 * (`status-duration-changed-log`), a Bomb countdown cut (`countdown-changed-log`) and a debuff
 * skipped because a stronger one of its family is already held (`status-outclassed-log`). Each
 * runs with the carrier on the player side and mirrored onto the enemy side, and each is
 * withheld from every listener once to prove nothing in the fight depends on it.
 *
 * Kits come from skill text (`textKit`) in the wording real ships use: Sokol's "extends active
 * debuffs by 1 turn", Provider's "all damage over time debuffs are extended by 1 turn", Fuying's
 * "extends Stealth by 1 turn", Ripper's "all allies active buffs are extended by 1 turn" and
 * Lingshe's "reduces all Bomb on the enemy targets by 1 turn".
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildCombatLog } from '../log/buildCombatLog';
import { boardInput, NO_KIT, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import { textKit } from '../__testutils__/textKit';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(5));

const PLACEMENTS: Placement[] = ['player', 'enemy'];
const LOG_ONLY = new Set<CombatEvent['type']>([
    'status-duration-changed-log',
    'countdown-changed-log',
    'status-outclassed-log',
]);

const DEBUFF_EXTEND =
    'This Unit deals <unit-damage>100% damage</unit-damage> and <unit-skill>extends active debuffs by 1 turn</unit-skill>.';
const DOT_EXTEND =
    'This Unit deals <unit-damage>100% damage</unit-damage> and all <unit-skill>damage over time debuffs</unit-skill> are <unit-skill>extended by 1 turn</unit-skill>.';
const STEALTH_EXTEND = 'This Unit extends <unit-skill>Stealth</unit-skill> by 1 turn.';
const RIPPER_PASSIVE =
    'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns after it inflicts a <unit-aid>debuff</unit-aid> and all allies active <unit-skill>buffs are extended by 1 turn</unit-skill>.';
const BOMB_CUT =
    'This Unit reduces all <unit-skill>Bomb</unit-skill> on the enemy targets by 1 turn.<br />This reduction effect requires hacking.';
const inflicts = (status: string, turns: number) =>
    `This Unit inflicts <unit-skill>${status}</unit-skill> for ${turns} turn${turns === 1 ? '' : 's'}.`;
const grants = (status: string, turns: number) =>
    `This Unit grants <unit-skill>${status}</unit-skill> for ${turns} turns.`;

const unit = (id: string, kit: ShipSkills, speed: number, extra: Partial<BoardUnit> = {}) =>
    ({
        id,
        kit,
        position: 'M4',
        speed,
        attack: 1000,
        hp: 1e9,
        hacking: 1e6,
        ...extra,
    }) as BoardUnit;
const active = (name: string, text: string) => textKit(name, { active: text });

const run = (
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    swallow = false
) => {
    const { input, id } = boardInput(placement, carrier, allies, opponents, 1);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        if (swallow && LOG_ONLY.has(e.type)) return;
        emit(e);
    };
    const result = runCombat({ ...input, bus });
    const byCarrier = <T extends CombatEvent['type']>(type: T) =>
        events.filter(
            (e): e is Extract<CombatEvent, { type: T }> =>
                e.type === type &&
                (('casterId' in e && e.casterId === id(carrier)) ||
                    ('sourceId' in e && e.sourceId === id(carrier)))
        );
    return { result, events, id, byCarrier };
};

/** The board runs identically with every LOG-ONLY event withheld from its listeners. */
const expectLogOnly = (go: (swallow: boolean) => ReturnType<typeof run>) => {
    const shown = go(false);
    const withheld = go(true);
    expect(shown.events.some((e) => LOG_ONLY.has(e.type))).toBe(true);
    expect(JSON.stringify(withheld.result.rounds)).toBe(JSON.stringify(shown.result.rounds));
};

describe.each(PLACEMENTS)('debuff duration extensions, extender on the %s side', (placement) => {
    const extender = () => unit('extender', active('E', DEBUFF_EXTEND), 1);
    const seeder = () => unit('seeder', active('S', inflicts('Attack Down II', 3)), 500);

    it('nothing to extend: one row of 0 naming the hit enemy', () => {
        const t = unit('target', NO_KIT, 2);
        const s = run(placement, extender(), [], [t]);
        expect(s.byCarrier('status-duration-changed-log')).toEqual([
            expect.objectContaining({ scope: 'debuffs', count: 0, turns: 1, targetIds: [s.id(t)] }),
        ]);
    });

    it('a held debuff: one row counting it, on its holder', () => {
        const t = unit('target', NO_KIT, 2);
        const s = run(placement, extender(), [seeder()], [t]);
        expect(s.byCarrier('status-duration-changed-log')).toEqual([
            expect.objectContaining({ scope: 'debuffs', count: 1, targetIds: [s.id(t)] }),
        ]);
    });

    it('is log-only', () => {
        expectLogOnly((swallow) =>
            run(placement, extender(), [seeder()], [unit('target', NO_KIT, 2)], swallow)
        );
    });
});

describe.each(PLACEMENTS)('DoT duration extensions, extender on the %s side', (placement) => {
    const extender = () => unit('extender', active('E', DOT_EXTEND), 1);

    it('nothing to extend: one dots row of 0', () => {
        const t = unit('target', NO_KIT, 2);
        const s = run(placement, extender(), [], [t]);
        expect(s.byCarrier('status-duration-changed-log')).toEqual([
            expect.objectContaining({ scope: 'dots', count: 0, targetIds: [s.id(t)] }),
        ]);
    });

    it('a held Corrosion: one dots row counting it', () => {
        const t = unit('target', NO_KIT, 2);
        const seeder = unit('seeder', active('S', inflicts('Corrosion II', 2)), 500);
        const s = run(placement, extender(), [seeder], [t]);
        expect(s.byCarrier('status-duration-changed-log')).toEqual([
            expect.objectContaining({ scope: 'dots', count: 1, targetIds: [s.id(t)] }),
        ]);
    });
});

describe.each(PLACEMENTS)('buff duration extensions, extender on the %s side', (placement) => {
    it('cast path, no Stealth held: one buffs row of 0', () => {
        const e = unit('extender', active('E', STEALTH_EXTEND), 1);
        const s = run(placement, e, [], [unit('idle', NO_KIT, 2)]);
        const rows = s.byCarrier('status-duration-changed-log');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ scope: 'buffs', count: 0 });
    });

    it('cast path, Stealth held: one buffs row counting it, on its holder', () => {
        const e = unit('extender', active('E', STEALTH_EXTEND), 1);
        const s = run(placement, e, [], [unit('idle', NO_KIT, 2)]);
        const granter = unit(
            'granter',
            active('G', 'This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns.'),
            500
        );
        const g = run(placement, e, [granter], [unit('idle', NO_KIT, 2)]);
        expect(s.byCarrier('status-duration-changed-log')[0].count).toBe(0);
        const rows = g.byCarrier('status-duration-changed-log');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ scope: 'buffs', count: 1 });
        expect(rows[0].targetIds).toEqual([g.id(granter)]);
    });

    it('reactive path: Ripper extends his side’s buffs, stamped reactive', () => {
        const ripper = unit(
            'ripper',
            {
                slots: [
                    ...active('R', inflicts('Attack Down II', 1)).slots,
                    ...textKit('RP', { passives: [RIPPER_PASSIVE] }, 4).slots,
                ],
            },
            1
        );
        const granter = unit('granter', active('G', grants('Defense Up II', 2)), 500);
        const s = run(placement, ripper, [granter], [unit('target', NO_KIT, 2)]);
        const rows = s.byCarrier('status-duration-changed-log');
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.reactive === true && r.scope === 'buffs')).toBe(true);
        expect(rows.some((r) => r.count > 0)).toBe(true);
    });

    it('is log-only', () => {
        const e = unit('extender', active('E', STEALTH_EXTEND), 1);
        const granter = unit(
            'granter',
            active('G', 'This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns.'),
            500
        );
        expectLogOnly((swallow) =>
            run(placement, e, [granter], [unit('idle', NO_KIT, 2)], swallow)
        );
    });
});

describe.each(PLACEMENTS)('Bomb countdown cuts, cutter on the %s side', (placement) => {
    const cutter = () => unit('cutter', active('C', BOMB_CUT), 1);

    it('no Bomb held: one countdown row of 0 naming the target', () => {
        const t = unit('target', NO_KIT, 2, { security: 0 });
        const s = run(placement, cutter(), [], [t]);
        expect(s.byCarrier('countdown-changed-log')).toEqual([
            expect.objectContaining({ target: 'bomb', count: 0, turns: 1, targetIds: [s.id(t)] }),
        ]);
    });

    it('a Bomb cut to 0: the cut row is logged before the detonation it forces', () => {
        const t = unit('target', NO_KIT, 2, { security: 0 });
        const bomber = unit('bomber', active('B', inflicts('Bomb I', 2)), 500);
        const c = cutter();
        const s = run(placement, c, [bomber], [t]);
        const cut = s.byCarrier('countdown-changed-log');
        expect(cut).toEqual([expect.objectContaining({ count: 1, targetIds: [s.id(t)] })]);
        const cutAt = s.events.indexOf(cut[0]);
        const burstAt = s.events.findIndex((e) => e.type === 'bomb-detonated');
        expect(burstAt).toBeGreaterThan(cutAt);
        const roster = [c, bomber, t].map((u) => ({
            actorId: s.id(u),
            side: 'player' as const,
            name: u.id,
        }));
        const log = buildCombatLog(s.events, roster, new Map());
        const rows = log.flatMap((r) => r.turns.flatMap((tn) => tn.entries));
        const cutRow = rows.findIndex((e) => e.kind === 'duration-changed');
        const bombRow = rows.findIndex((e) => e.kind === 'bomb');
        expect(cutRow).toBeGreaterThanOrEqual(0);
        expect(bombRow).toBeGreaterThan(cutRow);
    });

    it('is log-only', () => {
        const bomber = unit('bomber', active('B', inflicts('Bomb I', 2)), 500);
        expectLogOnly((swallow) =>
            run(
                placement,
                cutter(),
                [bomber],
                [unit('target', NO_KIT, 2, { security: 0 })],
                swallow
            )
        );
    });
});

describe.each(PLACEMENTS)('outclassed debuffs, inflicter on the %s side', (placement) => {
    const weak = () => unit('weak', active('W', inflicts('Attack Down I', 2)), 1);

    it('a stronger tier held: one outclassed row naming both statuses', () => {
        const t = unit('target', NO_KIT, 2);
        const strong = unit('strong', active('S', inflicts('Attack Down III', 3)), 500);
        const s = run(placement, weak(), [strong], [t]);
        expect(s.byCarrier('debuff-applied')).toEqual([]);
        expect(s.byCarrier('status-outclassed-log')).toEqual([
            expect.objectContaining({
                targetId: s.id(t),
                effect: 'Attack Down I',
                heldEffect: 'Attack Down III',
                side: 'debuff',
            }),
        ]);
    });

    it('control: the same tier held for longer logs no outclassed row', () => {
        const same = unit('weak', active('W', inflicts('Attack Down II', 1)), 1);
        const strong = unit('strong', active('S', inflicts('Attack Down II', 3)), 500);
        const s = run(placement, same, [strong], [unit('target', NO_KIT, 2)]);
        expect(s.byCarrier('status-outclassed-log')).toEqual([]);
    });

    it('reactive path: an on-attacked debuff onto a stronger one logs the row, stamped', () => {
        const reactor = unit(
            'reactor',
            {
                slots: [
                    { slot: 'active', abilities: [] },
                    ...textKit(
                        'R',
                        {
                            passives: [
                                'When directly damaged, this Unit inflicts <unit-skill>Attack Down I</unit-skill> for 1 turn on the attacker.',
                            ],
                        },
                        4
                    ).slots,
                ],
            },
            1
        );
        const strong = unit('strong', active('S', inflicts('Attack Down III', 3)), 500);
        const hitter = unit(
            'hitter',
            active('H', 'This Unit deals <unit-damage>100% damage</unit-damage>.'),
            200
        );
        const s = run(placement, reactor, [strong], [hitter]);
        const rows = s.byCarrier('status-outclassed-log');
        expect(rows).toEqual([
            expect.objectContaining({
                targetId: s.id(hitter),
                heldEffect: 'Attack Down III',
                reactive: true,
            }),
        ]);
    });

    it('is log-only', () => {
        const strong = unit('strong', active('S', inflicts('Attack Down III', 3)), 500);
        expectLogOnly((swallow) =>
            run(placement, weak(), [strong], [unit('target', NO_KIT, 2)], swallow)
        );
    });
});
