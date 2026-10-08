/**
 * An Echoing Burst is a debuff (R109, R112): landing one is "a debuff inflicted" for every
 * "when debuffed" / "when a debuff is inflicted" listener, and its detonation has a combat-log row.
 *
 *  - Valkyrie's charged ("inflicts Inc. Damage Up II and Echoing Burst") on a Firewall wearer rolls
 *    Firewall once per landed debuff (R122). A proc on Inc. Damage Up II blocks the same skill's
 *    Echoing Burst (R149): it is resisted with no landing roll and Firewall grants once. A Firewall
 *    that never procs lets both land.
 *  - The burst's detonation appears in the combat log naming the holder, the source and the damage,
 *    and `accumulator-detonated` is on the simulator's subscription list (a handler for an
 *    unsubscribed type is dead code).
 *
 * Real parsed kits (buildTraceShip, refit 4). Every case runs with Valkyrie on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { LOG_EVENT_TYPES } from '../../calculators/battleSimulator';
import { buildCombatLog } from '../log/buildCombatLog';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import type { ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { CombatActor } from '../state';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(7));

const SIDES = ['player', 'enemy'] as const;

/** The carrier's passive slot from the real registry: a Firewall implant, its proc chance pinned. */
const firewallPassive = (procChance: number): ShipSkills['slots'][number] => {
    const ship = {
        id: 'carrier-ship',
        name: 'Carrier',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {},
        equipment: {},
        implants: { implant_major: 'firewall-legendary' },
        refits: [],
    } as unknown as Ship;
    const piece = {
        id: 'firewall-legendary',
        slot: 'implant_major',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: 'FIREWALL',
    } as unknown as GearPiece;
    const passive = buildShipAbilitiesWithEquipment(ship, (id) =>
        id === piece.id ? piece : undefined
    ).slots.find((s) => s.slot === 'passive');
    const fw = passive?.abilities.find((a) => a.trigger === 'on-debuffed');
    if (!fw) throw new Error('Firewall on-debuffed ability missing from the registry build');
    return { slot: 'passive', abilities: [{ ...fw, procChance }] };
};

const valkyrie = (charged: boolean): ShipSpec => ({
    id: 'valk',
    position: 'M4',
    speed: 150,
    attack: 1000,
    hacking: 1e6,
    chargeCount: 2,
    startCharged: charged,
    skills: { slots: realSlots('Valkyrie', ['active', 'charged']) },
});

describe('Valkyrie’s Echoing Burst landing is a debuff inflicted', () => {
    const board = (charged: boolean, procChance: number): MirrorTeams => ({
        caster: [
            {
                id: 'carrier',
                position: 'M4',
                speed: 1,
                skills: {
                    slots: [{ slot: 'active', abilities: [] }, firewallPassive(procChance)],
                },
            },
        ],
        other: [valkyrie(charged)],
    });
    const read = (charged: boolean, side: 'player' | 'enemy', procChance = 1) => {
        const { input, idOf } = mirrorBoard(board(charged, procChance), side);
        const carrier = idOf('carrier');
        const bus = createEventBus();
        const applied: string[] = [];
        const resisted: { name: string; viaLandingRoll: boolean }[] = [];
        let firewallGrants = 0;
        bus.on('debuff-applied', (e) => {
            if (e.targetId === carrier) applied.push(e.buffName);
        });
        bus.on('debuff-resisted', (e) => {
            if (e.targetId === carrier)
                resisted.push({ name: e.buffName, viaLandingRoll: e.viaLandingRoll === true });
        });
        bus.on('buff-applied', (e) => {
            if (e.actorId === carrier && e.buffName === 'Block Debuff') firewallGrants++;
        });
        runCombat({ ...input, bus });
        return { applied, resisted, firewallGrants };
    };

    for (const side of SIDES) {
        it(`${side}-side: a Firewall proc on Inc. Damage Up II blocks the same skill's Echoing Burst`, () => {
            const { applied, resisted, firewallGrants } = read(true, side);
            expect(applied).toEqual(['Inc. Damage Up II']);
            expect(resisted).toEqual([{ name: 'Echoing Burst', viaLandingRoll: false }]);
            expect(firewallGrants).toBe(1);
        });

        it(`${side}-side control: a Firewall that never procs lets the burst land as a debuff`, () => {
            const { applied, resisted, firewallGrants } = read(true, side, 1e-9);
            expect(applied.filter((n) => n === 'Echoing Burst')).toHaveLength(1);
            // Inc. Damage Up II + Echoing Burst.
            expect(applied).toHaveLength(2);
            expect(resisted).toEqual([]);
            expect(firewallGrants).toBe(0);
        });

        it(`${side}-side control: the active has no burst, so no Echoing Burst debuff`, () => {
            const { applied } = read(false, side);
            expect(applied).not.toContain('Echoing Burst');
        });
    }
});

describe('an Echoing Burst detonation has a combat-log row', () => {
    const roster = [
        { actorId: 'valk', side: 'player' as const, name: 'Valkyrie' },
        { actorId: 'holder', side: 'enemy' as const, name: 'Holder' },
    ];

    it('accumulator-detonated is on the simulator subscription list', () => {
        expect(LOG_EVENT_TYPES).toContain('accumulator-detonated');
    });

    it('buildCombatLog turns the event into a detonation row: source, holder, damage', () => {
        const events: CombatEvent[] = [
            { type: 'round-started', round: 1 },
            { type: 'turn-started', actorId: 'holder', round: 1 },
            {
                type: 'accumulator-detonated',
                actorId: 'valk',
                victimId: 'holder',
                round: 1,
                damage: 7000,
            },
            { type: 'turn-ended', actorId: 'holder', round: 1 },
            { type: 'round-ended', round: 1 },
        ];
        const log = buildCombatLog(events, roster, new Map());
        const rows = log[0].turns[0].entries.filter((e) => e.note?.includes('Echoing Burst'));
        expect(rows).toHaveLength(1);
        expect(rows[0].actorId).toBe('valk');
        expect(rows[0].targets).toEqual([
            expect.objectContaining({ targetId: 'holder', amount: 7000 }),
        ]);
    });

    for (const side of SIDES) {
        it(`${side}-side: a real burst reaches the log built from the production subscription`, () => {
            const teams: MirrorTeams = {
                caster: [{ id: 'holder', position: 'M4', speed: 1, hp: 1e9 }],
                other: [valkyrie(false)],
                numRounds: 1,
            };
            const { input, idOf } = mirrorBoard(teams, side);
            const bus = createEventBus();
            const events: CombatEvent[] = [];
            for (const type of LOG_EVENT_TYPES) bus.on(type, (e: CombatEvent) => events.push(e));
            runCombat({
                ...input,
                bus,
                __testTapActors: (all: CombatActor[]) => {
                    const holder = all.find((a) => a.id === idOf('holder'))!;
                    holder.pendingAccumulators.push({
                        roundsRemaining: 1,
                        pct: 100,
                        accumulated: 50_000,
                        sourceId: idOf('valk'),
                    });
                },
            });
            const log = buildCombatLog(
                events,
                [
                    {
                        actorId: idOf('valk'),
                        side: side === 'player' ? 'enemy' : 'player',
                        name: 'Valkyrie',
                    },
                    { actorId: idOf('holder'), side, name: 'Holder' },
                ],
                new Map()
            );
            const rows = log
                .flatMap((r) => r.turns)
                .flatMap((t) => t.entries)
                .filter((e) => e.note?.includes('Echoing Burst'));
            expect(rows).toHaveLength(1);
            expect(rows[0].actorId).toBe(idOf('valk'));
            const burst = events.find((e) => e.type === 'accumulator-detonated');
            expect(burst?.type === 'accumulator-detonated' && burst.damage).toBeGreaterThanOrEqual(
                50_000
            );
            expect(rows[0].targets[0]).toMatchObject({
                targetId: idOf('holder'),
                amount: burst?.type === 'accumulator-detonated' ? burst.damage : -1,
            });
        });
    }
});
