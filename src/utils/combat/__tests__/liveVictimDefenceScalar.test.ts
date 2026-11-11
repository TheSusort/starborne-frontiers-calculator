/**
 * #657 / #658 — a cast's own damage figures read the bound target's LIVE defence, the same read
 * the positional apply lands each hit with (`victimDefenseProfileOf`), on both sides.
 *
 * The figures in question are the turn-level ones: the DPS calculator's "Secondary damage"
 * summary (`rawTotals.totalSecondary`) and the `ability-performed` event's `damage`. They must
 * agree with what the bound target actually took (`attacked.damage`, as thrown).
 *
 *   - player hits enemy: the enemy holds its OWN Defense Up (a base-stat read misses it);
 *   - enemy hits player: the player's Defense Up EXPIRED at the end of its own turn, before the
 *     enemy fired (a read of the player's last-turn context still sees it).
 *
 * The real-kit cases are Zosimos's casts on Yuyan and on Heliodor, found by a seed search.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { parsePattern, parseTarget } from '../../targetingParser';
import { calculateDamageReduction } from '../../autogear/statResolution';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { composeBattle, type TaggedShip } from '../audit/compose';
import { tagShip } from '../audit/classes';
import { runSeededBattle } from '../../simulator/seededRuns';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { loadShipSkillRecords, csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';

/** Every event of the three kinds below, from every `runCombat` call (the battle simulator's too). */
const seen: CombatEvent[] = [];
vi.mock('../engine', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../engine')>();
    return {
        ...mod,
        runCombat: (input: Parameters<typeof mod.runCombat>[0]) => {
            input.bus?.on('ability-performed', (e) => seen.push(e));
            input.bus?.on('attacked', (e) => seen.push(e));
            input.bus?.on('buff-applied', (e) => seen.push(e));
            return mod.runCombat(input);
        },
    };
});
const { runCombat } = await import('../engine');

type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;
type Attacked = Extract<CombatEvent, { type: 'attacked' }>;

const ATTACK = 10_000;
const MULT = 200;
const SECURITY = 1_000;
const SEC_MULTIPLE = 20; // pct 2000 / 100
const BASE_DEFENCE = 3_000;
const DEFENSE_UP_PCT = 50;
const LIVE_DEFENCE = BASE_DEFENCE * (1 + DEFENSE_UP_PCT / 100);

const hit: Ability = {
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: MULT },
};
const securityRider: Ability = {
    id: 'sec',
    type: 'additional-damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'additional-damage', stat: 'security', pct: SEC_MULTIPLE * 100 },
};
/** A Defense Up the holder carries from combat start, lasting `duration` of its own turns. */
const defenseUp = (duration: number): Ability => ({
    id: 'defense-up',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Defense Up II',
        parsedEffects: { defense: DEFENSE_UP_PCT },
        stacks: 1,
        isStackable: false,
        duration,
    },
});

const casterSlots: ShipSkills['slots'] = [{ slot: 'active', abilities: [hit, securityRider] }];

const common = {
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    defensePenetration: 0,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    chargeCount: 0,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    crit: 0,
    critDamage: 0,
    hacking: 100_000,
    teamActors: [],
} satisfies Partial<CombatEngineInput>;

const enemyActor = (
    id: string,
    o: {
        attack: number;
        defence: number;
        security: number;
        speed: number;
        slots: ShipSkills['slots'];
    }
): NonNullable<CombatEngineInput['enemyAttackers']>[number] => ({
    id,
    stats: {
        attack: o.attack,
        crit: 0,
        critDamage: 0,
        defence: o.defence,
        hp: 100_000_000,
        speed: o.speed,
        hacking: 100_000,
        security: o.security,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: o.slots },
});

const unmitigated = ATTACK * (MULT / 100) + SECURITY * SEC_MULTIPLE;
const landedAt = (defence: number, amount = unmitigated): number =>
    amount * (1 - calculateDamageReduction(defence) / 100);

/** The caster's `ability-performed` damage and the bound target's `attacked` damage, per cast. */
const castPairs = (bus: ReturnType<typeof createEventBus>, casterMatch: string) => {
    const ap: AbilityPerformed[] = [];
    const at: Attacked[] = [];
    bus.on('ability-performed', (e) => {
        if (e.actorId.includes(casterMatch)) ap.push(e);
    });
    bus.on('attacked', (e) => {
        if (e.attackerId.includes(casterMatch)) at.push(e);
    });
    return { ap, at };
};

describe('#657 the turn-level damage figures read the bound target LIVE defence', () => {
    it('player hits an enemy holding its own Defense Up (DPS secondary summary + event)', () => {
        const bus = createEventBus();
        const { ap, at } = castPairs(bus, 'attacker');
        const result = runCombat({
            ...common,
            numRounds: 1,
            bus,
            attack: ATTACK,
            defence: 0,
            hp: 1_000_000,
            speed: 900,
            position: 'M4',
            security: SECURITY,
            shipSkills: { slots: casterSlots },
            enemyAttackers: [
                enemyActor('holder', {
                    attack: 0,
                    defence: BASE_DEFENCE,
                    security: 0,
                    speed: 100,
                    slots: [{ slot: 'passive', abilities: [defenseUp(10)] }],
                }),
            ],
        });

        // The landed hit is the reference — it already reads the live defence.
        expect(at).toHaveLength(1);
        expect(at[0].damage).toBeCloseTo(landedAt(LIVE_DEFENCE), 6);
        // The event's damage and the DPS page's secondary bucket agree with it.
        expect(ap).toHaveLength(1);
        expect(ap[0].damage).toBeCloseTo(at[0].damage!, 6);
        expect(result.rawTotals.totalSecondary).toBeCloseTo(
            landedAt(LIVE_DEFENCE, SECURITY * SEC_MULTIPLE),
            6
        );
    });

    it("enemy hits a player whose Defense Up expired at the end of the player's own turn", () => {
        const bus = createEventBus();
        const { ap, at } = castPairs(bus, 'caster');
        runCombat({
            ...common,
            numRounds: 1,
            bus,
            // The player acts FIRST, holding Defense Up for exactly that one turn of its own.
            attack: 0,
            defence: BASE_DEFENCE,
            hp: 100_000_000,
            speed: 900,
            position: 'M4',
            security: 0,
            shipSkills: { slots: [{ slot: 'passive', abilities: [defenseUp(1)] }] },
            enemyAttackers: [
                enemyActor('caster', {
                    attack: ATTACK,
                    defence: 0,
                    security: SECURITY,
                    speed: 100,
                    slots: casterSlots,
                }),
            ],
        });

        expect(at).toHaveLength(1);
        // Landed against the BASE defence: the Defense Up is gone when the enemy fires.
        expect(at[0].damage).toBeCloseTo(landedAt(BASE_DEFENCE), 6);
        expect(ap).toHaveLength(1);
        expect(ap[0].damage).toBeCloseTo(at[0].damage!, 6);
    });
});

/** Seeded compositions searched for a real-kit Zosimos cast. The anchor is DERIVED by search, not
 *  pinned to one seed: which ships a seed composes shifts with every ship-data refresh, and the
 *  agreement under test does not depend on which seed shows it. */
const REAL_KIT_SEARCH_SEEDS = 60;

let taggedCorpusCache: TaggedShip[] | null = null;
function taggedCorpus(): TaggedShip[] {
    if (taggedCorpusCache) return taggedCorpusCache;
    const namesByUpper = new Map<string, string>();
    for (const r of loadShipSkillRecords()) namesByUpper.set(r.name.toUpperCase(), r.name);
    for (const [upper, data] of loadShipDataByName())
        if (!namesByUpper.has(upper)) namesByUpper.set(upper, data.name);
    const tagged: TaggedShip[] = [];
    for (const name of namesByUpper.values()) {
        const ship = buildTraceShip(name);
        if (ship) tagged.push({ ship, classes: tagShip(ship) });
    }
    taggedCorpusCache = tagged;
    return tagged;
}

/**
 * The first seeded battle in which a ship `attacker` accepts casts, without a crit, at a bound
 * target `victim` accepts (both by ship name) and lands exactly one hit on it that round; returns
 * the cast with that hit. `heldStatus`, when given, also requires the target to have gained a
 * status it accepts earlier in that round or the round before.
 */
function realKitCastOn(opts: {
    attacker: (shipName: string) => boolean;
    victim: (shipName: string) => boolean;
    heldStatus?: (buffName: string) => boolean;
}): { cast: AbilityPerformed; took: Attacked } | undefined {
    for (let seed = 1; seed <= REAL_KIT_SEARCH_SEEDS; seed++) {
        const input = composeBattle(seed, taggedCorpus());
        const names = [...input.playerTeam, ...input.enemyTeam].map((p) => p.ship.name);
        const attackers = names.filter(opts.attacker);
        const victims = names.filter(opts.victim);
        if (attackers.length === 0 || victims.length === 0) continue;
        seen.length = 0;
        runSeededBattle(input, seed);
        for (const [at, e] of seen.entries()) {
            if (e.type !== 'ability-performed' || e.didCrit) continue;
            if (!attackers.some((n) => e.actorId.includes(n))) continue;
            if (!victims.some((n) => e.targetId.includes(n))) continue;
            const held = (b: CombatEvent) =>
                b.type === 'buff-applied' &&
                b.actorId === e.targetId &&
                b.round >= e.round - 1 &&
                opts.heldStatus!(b.buffName);
            if (opts.heldStatus && !seen.slice(0, at).some(held)) continue;
            const hits = seen.filter(
                (t): t is Attacked =>
                    t.type === 'attacked' &&
                    t.round === e.round &&
                    t.attackerId === e.actorId &&
                    t.targetId === e.targetId
            );
            if (hits.length === 1) return { cast: e, took: hits[0] };
        }
    }
    return undefined;
}

describe('#657 / #658 real kits: a cast reports what its bound target took', () => {
    it('Zosimos → Yuyan: the live victim defence (#657)', () => {
        if (!csvAvailable() || !shipDataAvailable())
            throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
        const found = realKitCastOn({
            attacker: (name) => name === 'Zosimos',
            victim: (name) => name === 'Yuyan',
        });
        expect(found).toBeDefined();
        expect(found!.cast.damage).toBeCloseTo(found!.took.damage!, 6);
    });

    it("a hit on a ship holding its own Inc. Damage Down, e.g. Heliodor's (#658)", () => {
        if (!csvAvailable() || !shipDataAvailable())
            throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
        // Ships whose own kit grants an incoming-damage reduction status. Derived from the parse,
        // so a refresh that adds or drops a carrier moves the set with it.
        const carriers = new Set(
            taggedCorpus()
                .filter(({ ship }) =>
                    buildShipAbilities(ship).slots.some((slot) =>
                        slot.abilities.some(
                            (a) =>
                                a.config.type === 'buff' &&
                                (a.config.parsedEffects.incomingDamage ?? 0) < 0
                        )
                    )
                )
                .map(({ ship }) => ship.name)
        );
        expect(carriers.has('Heliodor')).toBe(true);
        const found = realKitCastOn({
            attacker: () => true,
            victim: (name) => carriers.has(name),
            heldStatus: (buffName) => buffName.startsWith('Inc. Damage Down'),
        });
        expect(found).toBeDefined();
        expect(found!.cast.damage).toBeCloseTo(found!.took.damage!, 6);
    });
});

/**
 * The same agreement for the victim's own INCOMING term: its `Inc. Damage Down` family and its
 * gear/kit `incoming-reduction`, composed (and capped at −70) exactly as the positional apply
 * composes them. Both directions.
 */
const incDamageDown: Ability = {
    id: 'inc-down',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Inc. Damage Down II',
        parsedEffects: { incomingDamage: -40 },
        stacks: 1,
        isStackable: false,
        duration: 10,
    },
};
const directReduction = (pct: number): Ability => ({
    id: `reduction-${pct}`,
    type: 'incoming-reduction',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-reduction',
        scope: 'direct',
        condition: 'always',
        pct,
        critFamily: false,
    },
});
const VICTIM_KITS = {
    'Inc. Damage Down': [incDamageDown],
    'incoming-reduction': [directReduction(30)],
    'both, past the 70% cap': [incDamageDown, directReduction(45)],
} as const;

describe.each(Object.entries(VICTIM_KITS))(
    '#658 the turn-level figure includes the victim incoming term (%s)',
    (_name, kit) => {
        const victimSlots: ShipSkills['slots'] = [{ slot: 'passive', abilities: [...kit] }];

        it('player hits enemy', () => {
            const bus = createEventBus();
            const { ap, at } = castPairs(bus, 'attacker');
            const result = runCombat({
                ...common,
                numRounds: 1,
                bus,
                attack: ATTACK,
                defence: 0,
                hp: 1_000_000,
                speed: 900,
                position: 'M4',
                security: SECURITY,
                shipSkills: { slots: casterSlots },
                enemyAttackers: [
                    enemyActor('holder', {
                        attack: 0,
                        defence: BASE_DEFENCE,
                        security: 0,
                        speed: 100,
                        slots: victimSlots,
                    }),
                ],
            });
            expect(at).toHaveLength(1);
            // The victim's reduction really applied to what landed.
            expect(at[0].damage!).toBeLessThan(landedAt(BASE_DEFENCE) - 1);
            expect(ap).toHaveLength(1);
            expect(ap[0].damage).toBeCloseTo(at[0].damage!, 6);
            expect(result.rawTotals.totalSecondary).toBeCloseTo(
                (at[0].damage! * SECURITY * SEC_MULTIPLE) / unmitigated,
                6
            );
        });

        it('enemy hits player', () => {
            const bus = createEventBus();
            const { ap, at } = castPairs(bus, 'caster');
            runCombat({
                ...common,
                numRounds: 1,
                bus,
                attack: 0,
                defence: BASE_DEFENCE,
                hp: 100_000_000,
                speed: 100,
                position: 'M4',
                security: 0,
                shipSkills: { slots: victimSlots },
                enemyAttackers: [
                    enemyActor('caster', {
                        attack: ATTACK,
                        defence: 0,
                        security: SECURITY,
                        speed: 900,
                        slots: casterSlots,
                    }),
                ],
            });
            expect(at).toHaveLength(1);
            expect(at[0].damage!).toBeLessThan(landedAt(BASE_DEFENCE) - 1);
            expect(ap).toHaveLength(1);
            expect(ap[0].damage).toBeCloseTo(at[0].damage!, 6);
        });
    }
);
