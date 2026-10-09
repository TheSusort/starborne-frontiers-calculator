/**
 * Owner rulings R36 / R168: every hit is direct damage, a passive's included. A passive-slot
 * `on-cast` damage ability (a custom kit from the skill editor — `stagePassiveSlotHit`) is
 * therefore a direct hit on each victim: it emits `attacked`, so "when directly damaged"
 * reactions fire on it, and it lowers the victim's Stasis by one turn like any hit (R40/R67).
 *
 * The combat log shows it once, folded into the cast's row for that victim.
 *
 * Attacker: 1000 attack, a 100% active hit plus a 50% passive on-cast hit. Both placements.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { LOG_EVENT_TYPES } from '../../calculators/battleSimulator';
import { buildCombatLog } from '../log/buildCombatLog';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(36));

const passiveHit: Ability = {
    id: 'passive-on-cast-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 50 },
};

const attackerKit = (withPassive: boolean): ShipSkills => ({
    slots: [
        ...hitKit(100).slots,
        ...(withPassive ? [{ slot: 'passive' as const, abilities: [passiveHit] }] : []),
    ],
});

/** Heliodor's real passives alone: "when directly damaged" repairs. */
const heliodorPassives = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        ...realKit('Heliodor').slots.filter((s) => s.slot === 'passive'),
    ],
});

const stasis: Ability = {
    id: 'stasis-2',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Stasis',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 2,
        application: 'inflict',
    },
};

const run = (placement: Placement, carrier: BoardUnit, allies: BoardUnit[], opps: BoardUnit[]) => {
    const { input, id } = boardInput(placement, carrier, allies, opps, 1);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of LOG_EVENT_TYPES) bus.on(type, (e: CombatEvent) => events.push(e));
    const all: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        all.push(e);
        emit(e);
    };
    runCombat({ ...input, bus });
    return { events, all, id };
};

describe.each<Placement>(['player', 'enemy'])('attacker on the %s side', (placement) => {
    const attacker = (withPassive: boolean): BoardUnit => ({
        id: 'atk',
        kit: attackerKit(withPassive),
        position: 'M4',
        speed: 100,
        attack: 1000,
    });

    const heliodorBoard = (withPassive: boolean) => {
        const victim: BoardUnit = {
            id: 'helio',
            kit: heliodorPassives(),
            position: 'M4',
            speed: 1,
            hp: 1e9,
        };
        const ally: BoardUnit = { id: 'ally', kit: NO_KIT, position: 'M3', speed: 2, hp: 1e9 };
        const atk = attacker(withPassive);
        const { all, events, id } = run(placement, atk, [], [victim, ally]);
        const vid = id(victim);
        return {
            all,
            events,
            aid: id(atk),
            vid,
            attacked: all
                .filter((e) => e.type === 'attacked' && e.targetId === vid)
                .map((e) => (e.type === 'attacked' ? Math.round(e.damage ?? 0) : 0)),
            repairs: all.filter((e) => e.type === 'reactive-heal-performed' && e.casterId === vid)
                .length,
        };
    };

    it('the passive on-cast hit is an `attacked` hit, so Heliodor repairs on it too', () => {
        const withPassive = heliodorBoard(true);
        expect(withPassive.attacked).toEqual([1000, 500]);
        expect(withPassive.repairs).toBe(2);
        // Control: the firing hit alone is one `attacked` and one repair.
        const without = heliodorBoard(false);
        expect(without.attacked).toEqual([1000]);
        expect(without.repairs).toBe(1);
    });

    it('the combat log shows the passive hit once, inside the cast row', () => {
        const { events, aid, vid } = heliodorBoard(true);
        const log = buildCombatLog(
            events,
            [
                { actorId: aid, side: placement, name: 'Attacker' },
                {
                    actorId: vid,
                    side: placement === 'player' ? 'enemy' : 'player',
                    name: 'Heliodor',
                },
            ],
            new Map()
        );
        const rows = log
            .flatMap((r) => r.turns)
            .flatMap((t) => t.entries)
            .filter((e) => e.actorId === aid && e.kind === 'attack');
        expect(rows).toHaveLength(1);
        const onVictim = rows[0].targets.filter((t) => t.targetId === vid);
        expect(onVictim).toHaveLength(1);
        expect(onVictim[0].amount).toBeCloseTo(1500, 6);
    });

    it('the passive on-cast hit lowers Stasis like any hit (R40/R67)', () => {
        // A faster ally lands a 2-turn Stasis on the victim. The firing hit takes it to 1; the
        // passive hit takes it to 0, so the victim acts this round.
        const actsThisRound = (withPassive: boolean): boolean => {
            const applier: BoardUnit = {
                id: 'applier',
                kit: { slots: [{ slot: 'active', abilities: [stasis] }] },
                position: 'M3',
                speed: 300,
                hacking: 1e6,
            };
            const victim: BoardUnit = {
                id: 'victim',
                kit: hitKit(1),
                position: 'M4',
                speed: 1,
                hp: 1e9,
                security: 0,
            };
            const { all, id } = run(placement, attacker(withPassive), [applier], [victim]);
            const vid = id(victim);
            // Instrument: the Stasis did land.
            expect(
                all.some(
                    (e) =>
                        e.type === 'debuff-applied' && e.targetId === vid && e.buffName === 'Stasis'
                )
            ).toBe(true);
            return all.some((e) => e.type === 'ability-performed' && e.actorId === vid);
        };
        expect(actsThisRound(true)).toBe(true);
        // Control: the firing hit alone leaves 1 turn of Stasis, so the victim skips its turn.
        expect(actsThisRound(false)).toBe(false);
    });
});
