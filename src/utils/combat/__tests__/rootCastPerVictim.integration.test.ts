/**
 * `oncePerRootCast: 'per-victim'`: a reaction fires at most once per (skill cast that set it off,
 * enemy it is about), whoever cast it (owner ruling, measured in game 2026-10-06).
 *
 * Xcellence R4: "When an enemy resists a debuff infliction, this Unit deals damage equal to 115%
 * of this Unit's current shield." In game, Curator's active ("60% damage to all enemies, then
 * inflicts Attack Down III and Crit Power Down III") resisted twice by each of three enemies hit
 * each of them ONCE; Provider's single-target active, both debuffs resisted, hit ONCE.
 *
 * APEX R4: "If that enemy has 3 or more debuffs on a debuff infliction, this Unit inflicts Block
 * Shield for 1 turn." An area cast bringing three enemies to 3 or more debuffs gives one Block
 * Shield on each; her 3% shield stays once for the whole cast.
 *
 * Real parsed kits (buildTraceShip), cast slots narrowed to the active. The passive carriers
 * (Xcellence, APEX) take no cast of their own. Curator fires Pattern-Circle-Range-1 from M4,
 * striking M4, M3 and T4. Run with the carrier on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip, type RefitLevel } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern } from '../../targetingParser';
import { boardInput, NO_KIT, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { ShipSkills, SkillSlot } from '../../../types/abilities';
import type { ActiveDoTStack, CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(3));

/** `ship`'s real kit at `refitLevel`, narrowed to `slots` (an empty active is kept so the unit
 *  still takes its turns). */
const kit = (ship: string, refitLevel: RefitLevel, slots: SkillSlot[]): ShipSkills => {
    const built = buildTraceShip(ship, { refitLevel });
    if (!built) throw new Error(`${ship} missing from reference data`);
    const full = buildShipAbilities(built);
    const narrowed = full.slots.filter((s) => slots.includes(s.slot));
    return {
        ...full,
        slots: narrowed.some((s) => s.slot === 'active')
            ? narrowed
            : [{ slot: 'active', abilities: [] }, ...narrowed],
    };
};

const enemies = (security: number): BoardUnit[] =>
    (['M4', 'M3', 'T4'] as const).map((position, i) => ({
        id: `enemy-${'abc'[i]}`,
        kit: NO_KIT,
        position,
        speed: 1,
        security,
    }));

const curator = (hacking: number): BoardUnit => ({
    id: 'curator',
    kit: kit('Curator', 4, ['active']),
    position: 'M3',
    speed: 200,
    attack: 1000,
    hacking,
    pattern: parsePattern('Pattern-Circle-Range-1'),
});

interface TurnRecord {
    actorId: string;
    /** `targetId → count` of the carrier's reactive hits during this turn. */
    hits: Record<string, number>;
    /** `targetId → count` of resists during this turn, as `inflictor:targetId`. */
    resists: Record<string, number>;
    /** Target ids of the carrier's Block Shield landings during this turn. */
    blockShields: string[];
    /** The carrier's shield grants during this turn. */
    shields: number;
}

const run = (
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    seedDebuffs = 0
): { turns: TurnRecord[]; id: (u: BoardUnit) => string } => {
    const { input, id } = boardInput(placement, carrier, allies, opponents, 1);
    const carrierId = id(carrier);
    const opponentIds = new Set(opponents.map(id));
    const turns: TurnRecord[] = [];
    const current = (): TurnRecord => {
        if (turns.length === 0)
            turns.push({
                actorId: '(round start)',
                hits: {},
                resists: {},
                blockShields: [],
                shields: 0,
            });
        return turns[turns.length - 1];
    };
    const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
    const bus = createEventBus();
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        turns.push({ actorId: e.actorId, hits: {}, resists: {}, blockShields: [], shields: 0 });
    });
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.sourceId === carrierId) bump(current().hits, e.targetId);
        }
    );
    bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
        if (opponentIds.has(e.targetId) && e.viaLandingRoll)
            bump(current().resists, `${e.sourceId}:${e.targetId}`);
    });
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === carrierId && e.buffName === 'Block Shield')
            current().blockShields.push(e.targetId);
    });
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        if (e.granterId === carrierId && !e.uncast) current().shields += 1;
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            if (seedDebuffs === 0) return;
            for (const a of all) {
                if (!opponentIds.has(a.id)) continue;
                const seeded: ActiveDoTStack[] = Array.from({ length: seedDebuffs }, () => ({
                    stacks: 1,
                    tier: 1,
                    remainingRounds: 9,
                    sourceId: 'seed',
                }));
                a.corrosionEntries.push(...seeded);
            }
        },
    });
    return { turns, id };
};

const turnOf = (turns: TurnRecord[], actorId: string): TurnRecord => {
    const found = turns.filter((t) => t.actorId === actorId);
    expect(found).toHaveLength(1);
    return found[0];
};

/** Xcellence's real refit-4 passive alone (its every-turn shield arms the strike); she moves first
 *  so her shield is up before anyone casts. */
const xcellence = (): BoardUnit => ({
    id: 'xcellence',
    kit: kit('Xcellence', 4, ['passive']),
    position: 'M4',
    speed: 300,
    hp: 1_000_000,
});

describe.each<Placement>(['player', 'enemy'])('carrier on the %s side', (placement) => {
    it("Xcellence: Curator's area cast resisted twice by each of three enemies → one hit on each", () => {
        const opponents = enemies(1e9);
        const cur = curator(0);
        const { turns, id } = run(placement, xcellence(), [cur], opponents);
        const t = turnOf(turns, id(cur));
        // Instrument: every enemy really resisted both of Curator's debuffs.
        for (const o of opponents) expect(t.resists[`${id(cur)}:${id(o)}`]).toBe(2);
        expect(t.hits).toEqual(Object.fromEntries(opponents.map((o) => [id(o), 1])));
    });

    it("Xcellence: Provider's single-target cast, both debuffs resisted → one hit", () => {
        const [enemy] = enemies(1e9);
        const provider: BoardUnit = {
            id: 'provider',
            kit: kit('Provider', 4, ['active']),
            position: 'M3',
            speed: 200,
            attack: 1000,
            hacking: 0,
        };
        const { turns, id } = run(placement, xcellence(), [provider], [enemy]);
        const t = turnOf(turns, id(provider));
        expect(t.resists[`${id(provider)}:${id(enemy)}`]).toBe(2);
        expect(t.hits).toEqual({ [id(enemy)]: 1 });
    });

    it("Xcellence: a cast's own resist and a reaction's resist on the same enemy → one hit", () => {
        // The in-game Quixilver case. Curator lands some debuffs at 50%; Provider's passive
        // answers each landing with a Crit Rate Down II he cannot land (hacking 0), so an enemy
        // can resist both Curator and Provider inside Curator's one cast. Seeds are swept until
        // that happens. The on-resist per-attack guard in the executor also collapses these two
        // resists today, so this pins the outcome rather than the root-cast cap alone.
        let instances = 0;
        for (let seed = 1; seed <= 12; seed++) {
            setupKeyedRng(seed);
            // Hacking 50 against security 0 is a 50% landing chance per debuff; hacking 0 is none.
            const opponents = enemies(0);
            const cur = curator(50);
            const provider: BoardUnit = {
                id: 'provider',
                kit: kit('Provider', 4, ['passive']),
                position: 'T4',
                speed: 100,
                attack: 1000,
                hacking: 0,
            };
            const { turns, id } = run(placement, xcellence(), [cur, provider], opponents);
            const t = turnOf(turns, id(cur));
            for (const o of opponents) {
                const both =
                    (t.resists[`${id(cur)}:${id(o)}`] ?? 0) > 0 &&
                    (t.resists[`${id(provider)}:${id(o)}`] ?? 0) > 0;
                if (both) instances++;
                expect(t.hits[id(o)] ?? 0, `seed ${seed} ${id(o)}`).toBeLessThanOrEqual(1);
            }
        }
        // Instrument: the board really produced an enemy resisting both inside one cast.
        expect(instances).toBeGreaterThan(0);
    });

    it("Block Shield: Curator's area cast brings three enemies to 3+ → one Block Shield on each", () => {
        const opponents = enemies(0);
        const cur = curator(1e6);
        const apex: BoardUnit = {
            id: 'apex',
            kit: kit('APEX', 4, ['passive']),
            position: 'M4',
            speed: 300,
            hacking: 1e6,
            hp: 100_000,
        };
        // Each enemy enters at 2 debuffs, so both of Curator's landings qualify on each.
        const { turns, id } = run(placement, apex, [cur], opponents, 2);
        const t = turnOf(turns, id(cur));
        expect([...t.blockShields].sort()).toEqual(opponents.map(id).sort());
        expect(t.shields).toBe(1);
    });
});
