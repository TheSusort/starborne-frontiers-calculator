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
 * The real-kit case is Zosimos → Yuyan in seeded composition 1, round 4.
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
import { loadShipSkillRecords, csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';

/** Every event of the two kinds below, from every `runCombat` call (the battle simulator's too). */
const seen: CombatEvent[] = [];
vi.mock('../engine', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../engine')>();
    return {
        ...mod,
        runCombat: (input: Parameters<typeof mod.runCombat>[0]) => {
            input.bus?.on('ability-performed', (e) => seen.push(e));
            input.bus?.on('attacked', (e) => seen.push(e));
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

describe('#657 real kits: Zosimos → Yuyan, seeded composition 1', () => {
    it("Zosimos's round-4 hit on Yuyan reports what Yuyan took", () => {
        if (!csvAvailable() || !shipDataAvailable())
            throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
        const namesByUpper = new Map<string, string>();
        for (const r of loadShipSkillRecords()) namesByUpper.set(r.name.toUpperCase(), r.name);
        for (const [upper, data] of loadShipDataByName())
            if (!namesByUpper.has(upper)) namesByUpper.set(upper, data.name);
        const tagged: TaggedShip[] = [];
        for (const name of namesByUpper.values()) {
            const ship = buildTraceShip(name);
            if (ship) tagged.push({ ship, classes: tagShip(ship) });
        }

        seen.length = 0;
        runSeededBattle(composeBattle(1, tagged), 1);

        const isZosimos = (id: string) => id.includes('Zosimos');
        const isYuyan = (id: string) => id.includes('Yuyan');
        const cast = seen.find(
            (e): e is AbilityPerformed =>
                e.type === 'ability-performed' &&
                e.round === 4 &&
                isZosimos(e.actorId) &&
                isYuyan(e.targetId)
        );
        const took = seen.find(
            (e): e is Attacked =>
                e.type === 'attacked' &&
                e.round === 4 &&
                isZosimos(e.attackerId) &&
                isYuyan(e.targetId)
        );
        // The composition must still be the one this case was measured on.
        expect(cast).toBeDefined();
        expect(took).toBeDefined();
        expect(cast!.didCrit).toBe(false);
        expect(cast!.damage).toBeCloseTo(took!.damage!, 6);

        // Round 2, Zosimos → Heliodor: Heliodor's own incoming reduction is in what it took, and
        // so in the figure the cast reports (#658).
        const cast2 = seen.find(
            (e): e is AbilityPerformed =>
                e.type === 'ability-performed' &&
                e.round === 2 &&
                isZosimos(e.actorId) &&
                e.targetId.includes('Heliodor')
        );
        const took2 = seen.find(
            (e): e is Attacked =>
                e.type === 'attacked' &&
                e.round === 2 &&
                isZosimos(e.attackerId) &&
                e.targetId.includes('Heliodor')
        );
        expect(cast2).toBeDefined();
        expect(took2).toBeDefined();
        expect(cast2!.didCrit).toBe(false);
        expect(cast2!.damage).toBeCloseTo(took2!.damage!, 6);
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
