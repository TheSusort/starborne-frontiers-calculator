/**
 * Owner ruling R166: a multi-hit skill counts EACH HIT as its own action for every once-per-cast
 * cap. Enforcer's active ("attacks three times with each attack dealing 50% damage") at crit 100
 * lands a Defense Shred with every hit ("When this Unit critically hits an enemy it inflicts
 * Defense Shred"), and each Shred wakes the once-per-cast reactions again:
 *  - Provider (R97, once per (cast, debuffed enemy)): 50% damage per hit;
 *  - APEX's Block Shield (R82, once per (cast, enemy)), on an enemy holding 3+ debuffs;
 *  - Hayyan (R98, once per (cast, debuffed ally)): a repair per hit;
 *  - Oleander (R99, once per cast): a charge per hit;
 *  - Insidiousness (R131, one success per skill → per hit).
 * A single-hit skill is unchanged: Nayra's active lands two debuffs in one hit and Provider
 * answers once.
 *
 * Real parsed kits (buildTraceShip, refit 4); Insidiousness is its implant ability at a 100% proc.
 * Every scenario runs with Enforcer on the player side and mirrored onto the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const passiveOnly = (ship: string): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        ...realKit(ship).slots.filter((s) => s.slot === 'passive'),
    ],
});

/** The Insidiousness implant's ability shape (buildEquipmentAbilities) at a 100% proc. */
const insidiousness: Ability = {
    id: 'insidiousness',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-debuff-inflicted',
    triggerApplicationFilter: 'inflict',
    conditions: [],
    procChance: 1,
    procScope: 'per-debuff',
    source: 'equipment',
    config: { type: 'damage', multiplier: 10, hits: 1 },
};

const enforcer = (extra: Ability[] = []): BoardUnit => {
    const kit = realKit('Enforcer');
    return {
        id: 'enforcer',
        kit: {
            ...kit,
            slots: kit.slots
                .filter((s) => s.slot !== 'charged')
                .map((s) =>
                    s.slot === 'passive' ? { ...s, abilities: [...s.abilities, ...extra] } : s
                ),
        },
        position: 'M4',
        speed: 100,
        attack: 1000,
        crit: 100,
        hacking: 1e6,
    };
};
const nayra = (): BoardUnit => ({
    id: 'nayra',
    kit: { slots: realKit('Nayra').slots.filter((s) => s.slot === 'active') },
    position: 'M4',
    speed: 100,
    attack: 1000,
    hacking: 1e6,
});
const target = (): BoardUnit => ({ id: 'target', kit: NO_KIT, position: 'M4', speed: 1 });

const run = (
    placement: Placement,
    caster: BoardUnit,
    casterAllies: BoardUnit[],
    targetSide: BoardUnit[],
    tap?: (all: CombatActor[], id: (u: BoardUnit) => string) => void
) => {
    const { input, id } = boardInput(placement, caster, casterAllies, targetSide, 1);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    runCombat({
        ...input,
        bus,
        ...(tap ? { __testTapActors: (all: CombatActor[]) => tap(all, id) } : {}),
    });
    return { events, id };
};

const reactiveHitsBy = (events: CombatEvent[], sourceId: string, targetId: string): number =>
    events.filter(
        (e) =>
            e.type === 'reactive-damage-performed' &&
            e.sourceId === sourceId &&
            e.targetId === targetId
    ).length;

describe.each<Placement>(['player', 'enemy'])('R166 with Enforcer on the %s side', (placement) => {
    const provider = (): BoardUnit => ({
        id: 'provider',
        kit: passiveOnly('Provider'),
        position: 'M3',
        speed: 50,
        attack: 1000,
        hacking: 1e6,
    });

    it('Provider answers each of the three hits', () => {
        const e = enforcer();
        const p = provider();
        const t = target();
        const { events, id } = run(placement, e, [p], [t]);
        expect(reactiveHitsBy(events, id(p), id(t))).toBe(3);
    });

    it('control: a single-hit skill landing two debuffs draws one Provider hit', () => {
        const n = nayra();
        const p = provider();
        const t = target();
        const { events, id } = run(placement, n, [p], [t]);
        expect(reactiveHitsBy(events, id(p), id(t))).toBe(1);
    });

    it("APEX's Block Shield lands once per hit on an enemy holding 3+ debuffs", () => {
        const e = enforcer();
        const apex: BoardUnit = {
            id: 'apex',
            kit: passiveOnly('APEX'),
            position: 'M3',
            speed: 50,
            hacking: 1e6,
        };
        const t = target();
        const { events, id } = run(placement, e, [apex], [t], (all, idOf) => {
            const holder = all.find((a) => a.id === idOf(t));
            if (!holder) throw new Error('target missing');
            for (let i = 0; i < 3; i++)
                holder.corrosionEntries.push({
                    stacks: 1,
                    tier: 3,
                    remainingRounds: 9,
                    sourceId: idOf(e),
                });
        });
        expect(
            events.filter(
                (x) =>
                    x.type === 'debuff-applied' &&
                    x.sourceId === id(apex) &&
                    x.targetId === id(t) &&
                    x.buffName === 'Block Shield'
            )
        ).toHaveLength(3);
    });

    it('Hayyan repairs the debuffed ally once per hit', () => {
        const e = enforcer();
        const t = target();
        const hayyan: BoardUnit = {
            id: 'hayyan',
            kit: passiveOnly('Hayyan'),
            position: 'M3',
            speed: 2,
        };
        const { events, id } = run(placement, e, [], [t, hayyan]);
        expect(
            events.filter((x) => x.type === 'reactive-heal-performed' && x.casterId === id(hayyan))
        ).toHaveLength(3);
    });

    it('Oleander gains a charge per hit', () => {
        const e = enforcer();
        const oleander: BoardUnit = {
            id: 'oleander',
            kit: passiveOnly('Oleander'),
            position: 'M3',
            speed: 1,
            chargeCount: 10,
        };
        const t = target();
        const { events, id } = run(placement, e, [oleander], [t]);
        const gains = events.filter(
            (x) =>
                x.type === 'charge-changed' &&
                x.actorId === id(oleander) &&
                x.reason === 'manip' &&
                x.newCharge > x.oldCharge
        );
        expect(gains).toHaveLength(3);
    });

    it('Insidiousness succeeds once per hit', () => {
        const e = enforcer([insidiousness]);
        const t = target();
        const { events, id } = run(placement, e, [], [t]);
        expect(reactiveHitsBy(events, id(e), id(t))).toBe(3);
    });
});
