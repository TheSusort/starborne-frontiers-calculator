/**
 * Owner ruling R110: an attack can have SEVERAL primary targets. A skill whose firing pattern is
 * the whole battlefield (`Pattern-All` — Curator's active, "deals 60% damage to all enemies") makes
 * EVERY enemy it strikes a primary target, so every "when directly damaged as a primary target"
 * reaction fires for each: Stalwart counters, Malvex gains his shield, Nosorog and a Reflect-set
 * wearer reflect. It is a property of the pattern, never of the ship's name. Each victim still
 * reacts at most once per incoming sub-attack (R92).
 *
 * An area pattern that is not the whole battlefield (a Cone) keeps exactly one primary target —
 * the anchor; its covered victims are not primary.
 *
 * Curator's real parsed kit (active + passives) and its real targeting row from
 * docs/ship-targeting.csv. A harmless front-liner sits in front of every carrier so no carrier is
 * the cast's anchor. Every board runs with the attacker on the player side and on the enemy side.
 */
import { existsSync, readFileSync } from 'fs';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    realKit,
    NO_KIT,
    hitKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import {
    parsePattern,
    parseTarget,
    parseTargetingCsv,
    type ParsedPattern,
    type ParsedTarget,
} from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { getGearSet } from '../../../constants/gearSets';

const TARGETING_CSV = 'docs/ship-targeting.csv';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable() || !existsSync(TARGETING_CSV))
        throw new Error(
            'docs/ship-skills.csv, docs/ship-data.json and docs/ship-targeting.csv are required'
        );
});
beforeEach(() => setupKeyedRng(110));

const SIDES: Placement[] = ['player', 'enemy'];

/** Curator's real active targeting, read from the corpus. */
const curatorTargeting = (): { target: ParsedTarget; pattern: ParsedPattern } => {
    const row = parseTargetingCsv(readFileSync(TARGETING_CSV, 'utf8')).find(
        (r) => r.name === 'Curator'
    );
    if (!row) throw new Error('Curator missing from docs/ship-targeting.csv');
    return { target: parseTarget(row.activeTarget), pattern: parsePattern(row.activePattern) };
};

/** `ship`'s real kit with only the passive slots, and an empty active so it never casts. */
const passiveOnly = (ship: string): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        ...realKit(ship).slots.filter((s) => s.slot === 'passive'),
    ],
});

/** Curator's real active plus passives (no charged, so round 1 is always the active). */
const curator = (opts: { crit?: number; cone?: boolean } = {}): BoardUnit => ({
    id: 'curator',
    kit: { slots: realKit('Curator').slots.filter((s) => s.slot !== 'charged') },
    position: 'M4',
    speed: 300,
    attack: 10_000,
    crit: opts.crit ?? 0,
    critDamage: 50,
    ...(opts.cone
        ? { target: parseTarget('front'), pattern: parsePattern('Pattern-Cone-Range-1') }
        : curatorTargeting()),
});

/** A harmless front-liner that is the cast's anchor. */
const frontFiller: BoardUnit = { id: 'filler', kit: NO_KIT, position: 'M4', speed: 2 };

const carrier = (ship: string, position: BoardUnit['position']): BoardUnit => ({
    id: ship.toLowerCase(),
    kit: passiveOnly(ship),
    position,
    speed: 1,
    attack: 10_000,
});

const sentinel: BoardUnit = {
    id: 'sentinel',
    kit: passiveOnly('Sentinel'),
    position: 'M2',
    speed: 200,
    attack: 10_000,
};

/** A wearer of the real Reflect set, its passive built through the equipment registry. */
const reflectWearer = (position: BoardUnit['position']): { unit: BoardUnit; pct: number } => {
    const slots = ['weapon', 'hull', 'generator', 'sensor'] as const;
    const pieces: GearPiece[] = slots
        .slice(0, getGearSet('REFLECT')?.minPieces ?? 2)
        .map((slot, i) => ({
            id: `reflect-${i}`,
            slot,
            level: 16,
            stars: 6,
            rarity: 'legendary',
            mainStat: null,
            subStats: [],
            setBonus: 'REFLECT',
        }));
    const ship = {
        id: 'wearer-ship',
        name: 'Wearer',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {},
        equipment: Object.fromEntries(pieces.map((p) => [p.slot, p.id])),
        implants: {},
        refits: [],
    } as unknown as Ship;
    const built = buildShipAbilitiesWithEquipment(ship, (id) => pieces.find((p) => p.id === id));
    const passive = built.slots.find((s) => s.slot === 'passive');
    const reflect = passive?.abilities.find((a) => a.config.type === 'damage-reflection');
    if (!passive || !reflect || reflect.config.type !== 'damage-reflection')
        throw new Error('Reflect set did not build a damage-reflection passive');
    return {
        unit: {
            id: 'wearer',
            kit: { slots: [{ slot: 'active', abilities: [] }, passive] },
            position,
            speed: 1,
            attack: 10_000,
        },
        pct: reflect.config.pct,
    };
};

interface Observed {
    /** Every counter-attack, as `from>to`, in order. */
    counters: string[];
    /** Every other direct hit, as `from>to`, in order. */
    hits: string[];
    /** Round-1 `attacked` events from the attacker's cast: victim name → isPrimaryTarget flags. */
    castPrimary: Record<string, (boolean | undefined)[]>;
    /** Round-1 taken damage per victim from the attacker's cast. */
    castTaken: Record<string, number>;
    /** Shield grants whose granter is Malvex, as amounts. */
    malvexShields: number[];
    /** Reflected damage per receiving unit, summed over the fight. */
    reflected: Record<string, number>;
}

const run = (
    placement: Placement,
    attacker: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[]
): Observed => {
    const { input, id } = boardInput(placement, attacker, allies, opponents, 1);
    const all = [attacker, ...allies, ...opponents];
    const nameOf = (actorId: string): string => all.find((u) => id(u) === actorId)?.id ?? actorId;
    const attackerId = id(attacker);
    const bus = createEventBus();
    const obs: Observed = {
        counters: [],
        hits: [],
        castPrimary: {},
        castTaken: {},
        malvexShields: [],
        reflected: {},
    };
    bus.on('attacked', (e) => {
        const hit = `${nameOf(e.attackerId)}>${nameOf(e.targetId)}`;
        (e.fromCounter ? obs.counters : obs.hits).push(hit);
        if (e.attackerId === attackerId && e.reactiveHitId === undefined && e.round === 1) {
            const v = nameOf(e.targetId);
            (obs.castPrimary[v] ??= []).push(e.isPrimaryTarget);
            obs.castTaken[v] = (obs.castTaken[v] ?? 0) + (e.takenDamage ?? e.damage ?? 0);
        }
    });
    bus.on('shield-applied', (e) => {
        if (nameOf(e.granterId) === 'malvex') obs.malvexShields.push(e.amount);
    });
    const { rounds } = runCombat({ ...input, bus });
    for (const r of rounds) {
        for (const [actorId, amount] of Object.entries(r.perActorReflected ?? {})) {
            obs.reflected[nameOf(actorId)] = (obs.reflected[nameOf(actorId)] ?? 0) + amount;
        }
    }
    return obs;
};

describe('Curator’s targeting row is the whole battlefield', () => {
    it('docs/ship-targeting.csv gives Curator’s active Pattern-All', () => {
        expect(curatorTargeting().pattern.shape).toBe('all');
        expect(curatorTargeting().pattern.modifiers.support).toBeUndefined();
    });
});

describe.each(SIDES)('Curator’s active (attacker on the %s side)', (placement) => {
    const trio = (): BoardUnit[] => [
        frontFiller,
        carrier('Stalwart', 'M3'),
        carrier('Malvex', 'T4'),
        carrier('Nosorog', 'B4'),
    ];

    it('every enemy struck is a primary target', () => {
        const obs = run(placement, curator(), [], trio());
        expect(obs.castPrimary).toEqual({
            filler: [true],
            stalwart: [true],
            malvex: [true],
            nosorog: [true],
        });
    });

    it('Stalwart counters once, Malvex gains one shield, Nosorog reflects once', () => {
        const obs = run(placement, curator(), [], trio());
        expect(obs.counters).toEqual(['stalwart>curator']);
        expect(obs.malvexShields).toHaveLength(1);
        expect(obs.malvexShields[0]).toBeCloseTo(obs.castTaken.malvex * 0.15, 3);
        // One 40% reflect of what Nosorog took (Curator has 0 defence).
        expect(obs.reflected.curator).toBeCloseTo(obs.castTaken.nosorog * 0.4, 3);
    });

    it('Curator crits Stalwart and Sentinel taps him → he still counters ONCE, onto Curator', () => {
        const obs = run(
            placement,
            curator({ crit: 100 }),
            [sentinel],
            [frontFiller, carrier('Stalwart', 'M3')]
        );
        expect(obs.hits).toContain('sentinel>stalwart');
        expect(obs.counters).toEqual(['stalwart>curator']);
    });

    it('a Reflect-set wearer that is not the anchor reflects once', () => {
        const { unit, pct } = reflectWearer('M3');
        const obs = run(placement, curator(), [], [frontFiller, unit]);
        expect(obs.castPrimary.wearer).toEqual([true]);
        expect(obs.reflected.curator).toBeCloseTo(obs.castTaken.wearer * (pct / 100), 3);
    });

    it('it is the pattern, not the ship: a plain 60% hit on Pattern-All makes Stalwart primary', () => {
        const generic: BoardUnit = { ...curator(), id: 'generic', kit: hitKit(60) };
        const obs = run(placement, generic, [], [frontFiller, carrier('Stalwart', 'M3')]);
        expect(obs.counters).toEqual(['stalwart>generic']);
    });
});

describe.each(SIDES)(
    'regression: a Cone keeps one primary (attacker on the %s side)',
    (placement) => {
        it('Curator’s skill on a Cone: only the anchor is primary; covered Stalwart does not counter', () => {
            const obs = run(
                placement,
                curator({ cone: true }),
                [],
                [frontFiller, carrier('Stalwart', 'M3')]
            );
            expect(obs.castPrimary).toEqual({ filler: [true], stalwart: [undefined] });
            expect(obs.counters).toEqual([]);
        });
    }
);

describe.each(SIDES)(
    'a multi-attack skill re-aims after a kill (attacker on the %s side)',
    (placement) => {
        it('Enforcer kills the front-liner on attack one → Stalwart, now the anchor, counters each later attack', () => {
            const enforcer: BoardUnit = {
                id: 'enforcer',
                kit: { slots: realKit('Enforcer').slots.filter((s) => s.slot !== 'charged') },
                position: 'M4',
                speed: 300,
                attack: 10_000,
            };
            const fragile: BoardUnit = { ...frontFiller, hp: 1 };
            const obs = run(placement, enforcer, [], [fragile, carrier('Stalwart', 'M3')]);
            expect(obs.castPrimary).toEqual({ filler: [true], stalwart: [true, true] });
            expect(obs.counters).toEqual(['stalwart>enforcer', 'stalwart>enforcer']);
        });
    }
);
