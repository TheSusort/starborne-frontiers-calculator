/**
 * A weaker same-family buff granted to a ship already holding that family at a STRICTLY higher
 * tier fizzles (#590 R1, buff side): it is not applied and is not a buff gain, so no `buff-applied`
 * is emitted for that recipient and no buff-gain reaction fires. Only the log-only
 * `status-outclassed-log` (side 'buff') records it. An equal tier is a re-application and still
 * emits `buff-applied`.
 *
 * The reactor is Nuqtu's real kit ("when an enemy gains a buff this Unit gains Terran Bolster III
 * for 1 turn"), on the side opposing the granters. Every case runs with the granters on the
 * player side and mirrored onto the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildCombatLog } from '../log/buildCombatLog';
import {
    boardInput,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { textKit } from '../__testutils__/textKit';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(5));

const PLACEMENTS: Placement[] = ['player', 'enemy'];

const grantsAll = (status: string, turns: number) =>
    `This Unit grants all allies <unit-skill>${status}</unit-skill> for ${turns} turns.`;
const gains = (status: string, turns: number) =>
    `This Unit gains <unit-skill>${status}</unit-skill> for ${turns} turns.`;
const WHEN_DAMAGED_GAINS = (status: string) =>
    `When directly damaged, this Unit gains <unit-skill>${status}</unit-skill> for 1 turn.`;

const unit = (id: string, kit: ShipSkills, speed: number, extra: Partial<BoardUnit> = {}) =>
    ({
        id,
        kit,
        position: 'M4',
        speed,
        attack: 1000,
        hp: 1e9,
        ...extra,
    }) as BoardUnit;
const active = (name: string, text: string) => textKit(name, { active: text });
/** Nuqtu's real kit; slowest unit on the board, so every grant precedes its own cast. */
const nuqtu = () => unit('nuqtu', realKit('Nuqtu'), 1);

const run = (
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[]
) => {
    const { input, id } = boardInput(placement, carrier, allies, opponents, 1);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    runCombat({ ...input, bus });
    const of = <T extends CombatEvent['type']>(type: T) =>
        events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);
    const buffsBy = (granter: BoardUnit, buffName: string) =>
        of('buff-applied').filter(
            (e) => (e.granterId ?? e.actorId) === id(granter) && e.buffName === buffName
        );
    const bolsters = (n: BoardUnit) =>
        of('buff-applied').filter(
            (e) => e.actorId === id(n) && e.buffName === 'Terran Bolster III'
        );
    const outclassed = () => of('status-outclassed-log');
    return { events, id, of, buffsBy, bolsters, outclassed };
};

describe.each(PLACEMENTS)('outclassed buffs fizzle, granters on the %s side', (placement) => {
    describe('cast path', () => {
        const weak = () => unit('weak', active('W', grantsAll('Attack Up II', 1)), 100);
        const strong = (status = 'Attack Up III') =>
            unit('strong', active('S', grantsAll(status, 3)), 500);

        it('a stronger tier held: no buff-applied, one outclassed row per recipient, no reaction', () => {
            const n = nuqtu();
            const w = weak();
            const s = strong();
            const r = run(placement, w, [s], [n]);
            expect(r.buffsBy(w, 'Attack Up II')).toEqual([]);
            const rows = r.outclassed();
            expect(rows).toHaveLength(2);
            for (const row of rows)
                expect(row).toMatchObject({
                    side: 'buff',
                    sourceId: r.id(w),
                    effect: 'Attack Up II',
                    heldEffect: 'Attack Up III',
                });
            expect(rows.map((x) => x.targetId).sort()).toEqual([r.id(w), r.id(s)].sort());
            // Nuqtu reacts to the Attack Up III cast only.
            expect(r.bolsters(n)).toHaveLength(1);
        });

        it('control: no stronger tier held → buff-applied and the reaction fires', () => {
            const n = nuqtu();
            const w = weak();
            const r = run(placement, w, [unit('idle', NO_KIT, 500)], [n]);
            expect(r.buffsBy(w, 'Attack Up II')).toHaveLength(2);
            expect(r.outclassed()).toEqual([]);
            expect(r.bolsters(n)).toHaveLength(1);
        });

        it('control: a lower tier held → the stronger grant is a buff gain', () => {
            const n = nuqtu();
            const w = unit('weak', active('W', grantsAll('Attack Up III', 1)), 100);
            const s = strong('Attack Up II');
            const r = run(placement, w, [s], [n]);
            expect(r.buffsBy(w, 'Attack Up III')).toHaveLength(2);
            expect(r.outclassed()).toEqual([]);
            expect(r.bolsters(n)).toHaveLength(2);
        });

        it('equal tier is not outclassed: buff-applied still emitted, reaction fires', () => {
            const n = nuqtu();
            const w = unit('weak', active('W', grantsAll('Attack Up III', 1)), 100);
            const r = run(placement, w, [strong()], [n]);
            expect(r.buffsBy(w, 'Attack Up III')).toHaveLength(2);
            expect(r.outclassed()).toEqual([]);
            expect(r.bolsters(n)).toHaveLength(2);
        });

        it('mixed cast: only the outclassed recipient fizzles; the other still gains it', () => {
            const n = nuqtu();
            const w = weak();
            const s = unit('strong', active('S', gains('Attack Up III', 3)), 500);
            const r = run(placement, w, [s], [n]);
            expect(r.buffsBy(w, 'Attack Up II').map((e) => e.actorId)).toEqual([r.id(w)]);
            expect(r.outclassed()).toEqual([
                expect.objectContaining({ side: 'buff', targetId: r.id(s) }),
            ]);
            // One reaction to the self-grant, one to the weak cast (per-action dedupe).
            expect(r.bolsters(n)).toHaveLength(2);
        });

        it('the log shows the fizzled grant as an attempt-only buff row', () => {
            const n = nuqtu();
            const w = weak();
            const s = strong();
            const r = run(placement, w, [s], [n]);
            const roster = [w, s, n].map((u) => ({
                actorId: r.id(u),
                side: 'player' as const,
                name: u.id,
            }));
            const log = buildCombatLog(r.events, roster, new Map());
            const rows = log.flatMap((rd) => rd.turns.flatMap((tn) => tn.entries));
            const fizzled = rows.filter(
                (e) => e.note === 'Attack Up II (outclassed by Attack Up III)'
            );
            expect(fizzled).toHaveLength(2);
            for (const e of fizzled) expect(e).toMatchObject({ kind: 'buff', attemptOnly: true });
        });
    });

    describe('reactive path', () => {
        const reactor = (castText: string) =>
            unit(
                'reactor',
                {
                    slots: [
                        ...active('R', castText).slots,
                        ...textKit('RP', { passives: [WHEN_DAMAGED_GAINS('Attack Up II')] }, 4)
                            .slots,
                    ],
                },
                500
            );

        it('a stronger tier held: no buff-applied, one stamped outclassed row, no reaction', () => {
            const n = nuqtu();
            const rc = reactor(gains('Attack Up III', 3));
            const r = run(placement, rc, [], [n]);
            expect(r.buffsBy(rc, 'Attack Up II')).toEqual([]);
            expect(r.outclassed()).toEqual([
                expect.objectContaining({
                    side: 'buff',
                    sourceId: r.id(rc),
                    targetId: r.id(rc),
                    effect: 'Attack Up II',
                    heldEffect: 'Attack Up III',
                    reactive: true,
                }),
            ]);
            // Nuqtu reacts to the Attack Up III cast only.
            expect(r.bolsters(n)).toHaveLength(1);
        });

        it('control: no stronger tier held → buff-applied and the reaction fires', () => {
            const n = nuqtu();
            const rc = reactor(gains('Defense Up III', 3));
            const r = run(placement, rc, [], [n]);
            expect(r.buffsBy(rc, 'Attack Up II')).toHaveLength(1);
            expect(r.outclassed()).toEqual([]);
            expect(r.bolsters(n)).toHaveLength(2);
        });

        it('a co-granted buff onto a stronger one fizzles on its own', () => {
            const n = nuqtu();
            const kit = textKit('RP', { passives: [WHEN_DAMAGED_GAINS('Defense Up III')] }, 4);
            const withCoGrant: ShipSkills = {
                slots: [
                    ...active('R', gains('Attack Up III', 3)).slots,
                    ...kit.slots.map((slot) => ({
                        ...slot,
                        abilities: slot.abilities.map((a) =>
                            a.config.type === 'buff'
                                ? {
                                      ...a,
                                      config: {
                                          ...a.config,
                                          additionalBuffs: [
                                              {
                                                  buffName: 'Attack Up II',
                                                  parsedEffects: {},
                                                  stacks: 1,
                                                  isStackable: false,
                                                  duration: 1,
                                              },
                                          ],
                                      },
                                  }
                                : a
                        ),
                    })),
                ],
            };
            const rc = unit('reactor', withCoGrant, 500);
            const r = run(placement, rc, [], [n]);
            expect(r.buffsBy(rc, 'Defense Up III')).toHaveLength(1);
            expect(r.buffsBy(rc, 'Attack Up II')).toEqual([]);
            expect(r.outclassed()).toEqual([
                expect.objectContaining({
                    side: 'buff',
                    targetId: r.id(rc),
                    effect: 'Attack Up II',
                    heldEffect: 'Attack Up III',
                    reactive: true,
                }),
            ]);
        });

        it('equal tier is not outclassed', () => {
            const n = nuqtu();
            const rc = reactor(gains('Attack Up II', 3));
            const r = run(placement, rc, [], [n]);
            expect(r.buffsBy(rc, 'Attack Up II')).toHaveLength(2);
            expect(r.outclassed()).toEqual([]);
        });
    });
});

describe.each(PLACEMENTS)('outclassed combat-start passive seeds, on the %s side', (placement) => {
    const passiveBuff = (buffName: string, duration: number): Ability => ({
        id: `seed-${buffName}`,
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
            duration,
        },
    });
    const seeder = (...abilities: Ability[]) =>
        unit(
            'seeder',
            {
                slots: [
                    { slot: 'active', abilities: [] },
                    { slot: 'passive', abilities },
                ],
            },
            500
        );

    it('a weaker seed after a stronger one: no buff-applied, one outclassed row', () => {
        const s = seeder(passiveBuff('Attack Up III', 3), passiveBuff('Attack Up II', 2));
        const r = run(placement, s, [], [nuqtu()]);
        expect(r.buffsBy(s, 'Attack Up III')).toHaveLength(1);
        expect(r.buffsBy(s, 'Attack Up II')).toEqual([]);
        expect(r.outclassed()).toEqual([
            expect.objectContaining({
                side: 'buff',
                targetId: r.id(s),
                effect: 'Attack Up II',
                heldEffect: 'Attack Up III',
            }),
        ]);
    });

    it('control: a stronger seed after a weaker one is a buff gain', () => {
        const s = seeder(passiveBuff('Attack Up II', 2), passiveBuff('Attack Up III', 3));
        const r = run(placement, s, [], [nuqtu()]);
        expect(r.buffsBy(s, 'Attack Up II')).toHaveLength(1);
        expect(r.buffsBy(s, 'Attack Up III')).toHaveLength(1);
        expect(r.outclassed()).toEqual([]);
    });
});
