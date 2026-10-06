/**
 * A reaction to a debuff being inflicted fires once per DoT STACK inflicted (owner ruling R28,
 * 2026-10-04). Snakeroot's one "inflicts 2 stacks of Corrosion I" on B is two inflictions:
 * Oleander's "When an ally inflicts a debuff, adds 1 charge" gives two charges, Provider's "When
 * another ally inflicts a debuff, deals 50% damage" hits twice. Only the stacks that LANDED count
 * (each stack rolls its own landing, R30). A reaction's own once-per caps still hold: APEX's
 * "gains a shield equal to 3% … when an enemy gets inflicted with a debuff" fires once for the
 * whole cast (`Ability.oncePerRootCast`), and so does her Block Shield, which still reads B's
 * debuff count as of each stack.
 *
 * Snakeroot's application is ONE DoT entry holding 2 stacks, so a reaction counted per event and
 * one counted per stack give different answers. Real parsed kits (buildTraceShip on
 * docs/ship-skills.csv), single-target casts from M4 at the enemy in front, the reacting ship
 * beside the caster at M3. Each case runs on both sides: a player caster with a player reactor,
 * and an enemy caster with an enemy reactor.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills, SkillSlot } from '../../../types/abilities';
import type { ActiveDoTStack, CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

beforeEach(() => {
    setupKeyedRng(28);
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const kit = (ship: string, slots: SkillSlot[]): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.filter((s) => slots.includes(s.slot));
    if (found.length !== slots.length) throw new Error(`${ship} lacks one of ${slots.join(',')}`);
    return { slots: found };
};
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
/** `ship`'s real passive, with an empty active so it never casts. */
const passiveOnly = (ship: string): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [] }, kit(ship, ['passive']).slots[0]],
});

const HP = 1e6;
const REACTOR = 'reactor';

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: NO_SKILLS,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HP,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

const reactorStats = { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: HP, hacking: 1e6 };

interface Side {
    tag: string;
    casterId: string;
    victimId: string;
    input: (caster: ShipSkills, reactor: ShipSkills, hacking: number) => CombatEngineInput;
}

const PLAYER: Side = {
    tag: 'player',
    casterId: 'attacker',
    victimId: 'enemy-a',
    input: (caster, reactor, hacking) =>
        base({
            shipSkills: caster,
            hacking,
            hasChargedSkill: true,
            chargeCount: 9,
            teamActors: [
                {
                    id: REACTOR,
                    speed: 50,
                    chargeCount: 9,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    position: 'M3',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    walk: {
                        shipSkills: reactor,
                        stats: { ...reactorStats, defensePenetration: 0 },
                        selfDotModifier: 0,
                        defensePenetrationBuff: 0,
                        affinityDamageModifier: 0,
                        affinityCritCap: 100,
                        affinityCritPenalty: 0,
                        hasChargedSkill: true,
                    },
                } satisfies TeamActor,
            ],
            enemyAttackers: [
                {
                    id: 'enemy-a',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1e9,
                        speed: 10,
                        security: 0,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: NO_SKILLS,
                },
            ],
        }),
};

const ENEMY: Side = {
    tag: 'enemy-side',
    casterId: 'enemy-caster',
    victimId: 'attacker',
    input: (caster, reactor, hacking) =>
        base({
            attack: 0,
            speed: 10,
            hp: 1e9,
            enemyAttackers: [
                {
                    id: 'enemy-caster',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: HP,
                        speed: 100,
                        security: 0,
                        hacking,
                    },
                    chargeCount: 9,
                    startCharged: false,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: caster,
                } satisfies EnemyAttacker,
                {
                    id: REACTOR,
                    stats: { ...reactorStats, speed: 50, security: 0 },
                    chargeCount: 9,
                    startCharged: false,
                    position: 'M3',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: reactor,
                },
            ],
        }),
};

interface Measured {
    /** Stacks the caster's round-1 `dot-applied` events landed on the victim. */
    landedStacks: number;
    /** The reactor's round-1 `shield-applied` events. */
    reactorShields: number;
    /** Charges the reactor gained in round 1. */
    reactorCharges: number;
    /** The reactor's round-1 reactive hits. */
    reactorHits: number;
    /** `buffName → count` of the reactor's round-1 `debuff-applied`. */
    reactorDebuffs: Record<string, number>;
    /** `buffName → count` of the round-1 `buff-applied` the reactor granted (any recipient). */
    reactorBuffs: Record<string, number>;
    /** `buffName → count` of the caster's round-1 `buff-applied` on itself. */
    casterBuffs: Record<string, number>;
}

const measure = (
    side: Side,
    caster: ShipSkills,
    reactor: ShipSkills,
    opts: { hacking?: number; victimCorrosion?: number[] } = {}
): Measured => {
    const bus = createEventBus();
    const m: Measured = {
        landedStacks: 0,
        reactorShields: 0,
        reactorCharges: 0,
        reactorHits: 0,
        reactorDebuffs: {},
        reactorBuffs: {},
        casterBuffs: {},
    };
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        if (e.sourceId === side.casterId && e.targetId === side.victimId && e.round === 1)
            m.landedStacks += e.stacks;
    });
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        if (e.granterId === REACTOR && e.round === 1) m.reactorShields += 1;
    });
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        // Ability-granted charges only — not the reactor's own per-turn charge gain.
        if (e.actorId === REACTOR && e.round === 1 && e.reason === 'manip')
            m.reactorCharges += e.newCharge - e.oldCharge;
    });
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.sourceId === REACTOR && e.round === 1) m.reactorHits += 1;
        }
    );
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === REACTOR && e.round === 1)
            m.reactorDebuffs[e.buffName] = (m.reactorDebuffs[e.buffName] ?? 0) + 1;
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.round !== 1) return;
        if (e.actorId === side.casterId)
            m.casterBuffs[e.buffName] = (m.casterBuffs[e.buffName] ?? 0) + 1;
        if (e.granterId === REACTOR)
            m.reactorBuffs[e.buffName] = (m.reactorBuffs[e.buffName] ?? 0) + 1;
    });
    runCombat({
        ...side.input(caster, reactor, opts.hacking ?? 1e6),
        bus,
        __testTapActors: (all: CombatActor[]) => {
            const v = all.find((a) => a.id === side.victimId);
            if (!v) throw new Error('victim missing');
            const seeded: ActiveDoTStack[] = (opts.victimCorrosion ?? []).map((s) => ({
                stacks: s,
                tier: 1,
                remainingRounds: 9,
                sourceId: 'seed',
            }));
            v.corrosionEntries.push(...seeded);
        },
    });
    return m;
};

const snakeroot = (): ShipSkills => kit('Snakeroot', ['active']);
/** A single-stack Corrosion inflictor — the negative arm for "per stack". */
const wisteria = (): ShipSkills => kit('Wisteria', ['active']);

for (const side of [PLAYER, ENEMY]) {
    describe(`${side.tag}: APEX — "when an enemy gets inflicted with a debuff"`, () => {
        it('one 2-stack Corrosion → one 3% shield: both stacks are one cast', () => {
            const m = measure(side, snakeroot(), passiveOnly('APEX'));
            expect(m.landedStacks).toBe(2);
            expect(m.reactorShields).toBe(1);
        });
        it('negative: one 1-stack Corrosion → one shield', () => {
            const m = measure(side, wisteria(), passiveOnly('APEX'));
            expect(m.landedStacks).toBe(1);
            expect(m.reactorShields).toBe(1);
        });
        it('negative: both stacks resisted → no shield', () => {
            const m = measure(side, snakeroot(), passiveOnly('APEX'), { hacking: 0 });
            expect(m.landedStacks).toBe(0);
            expect(m.reactorShields).toBe(0);
        });
        // Block Shield's own landing is a debuff inflicted on an enemy too, but it belongs to the
        // same cast, so it adds no shield.
        it('Block Shield: B at 1 debuff — the stack that brings B to 3 inflicts it', () => {
            const m = measure(side, snakeroot(), passiveOnly('APEX'), { victimCorrosion: [1] });
            expect(m.reactorDebuffs['Block Shield']).toBe(1);
            expect(m.reactorShields).toBe(1);
        });
        it('Block Shield: B at 2 debuffs — both stacks qualify, once for the cast', () => {
            const m = measure(side, snakeroot(), passiveOnly('APEX'), { victimCorrosion: [2] });
            expect(m.reactorDebuffs['Block Shield']).toBe(1);
        });
        it('Block Shield: B at 0 debuffs — the 2 stacks reach 2, never 3', () => {
            const m = measure(side, snakeroot(), passiveOnly('APEX'));
            expect(m.reactorDebuffs['Block Shield']).toBeUndefined();
        });
    });

    describe(`${side.tag}: Oleander — "When an ally inflicts a debuff, adds 1 charge"`, () => {
        it('one 2-stack Corrosion → two charges; the once-per-ally Repair Over Time stays once', () => {
            const m = measure(side, snakeroot(), passiveOnly('Oleander'));
            expect(m.reactorCharges).toBe(2);
            expect(m.reactorBuffs['Repair Over Time II']).toBe(1);
        });
        it('negative: one 1-stack Corrosion → one charge', () => {
            const m = measure(side, wisteria(), passiveOnly('Oleander'));
            expect(m.reactorCharges).toBe(1);
        });
    });

    describe(`${side.tag}: Lingshe — "When this Unit inflicts a Bomb it gains Stealth"`, () => {
        it('one 3-stack Bomb → three Stealth gains', () => {
            const m = measure(side, kit('Lingshe', ['active', 'passive']), NO_SKILLS);
            expect(m.landedStacks).toBe(3);
            expect(m.casterBuffs['Stealth']).toBe(3);
        });
        it('negative: every stack resisted → no Stealth', () => {
            const m = measure(side, kit('Lingshe', ['active', 'passive']), NO_SKILLS, {
                hacking: 0,
            });
            expect(m.casterBuffs['Stealth']).toBeUndefined();
        });
    });

    describe(`${side.tag}: Provider — "When another ally inflicts a debuff, deals 50% damage"`, () => {
        it('one 2-stack Corrosion → two hits and two Crit Rate Down II', () => {
            const m = measure(side, snakeroot(), passiveOnly('Provider'));
            expect(m.reactorHits).toBe(2);
            expect(m.reactorDebuffs['Crit Rate Down II']).toBe(2);
        });
        it('negative: one 1-stack Corrosion → one hit', () => {
            const m = measure(side, wisteria(), passiveOnly('Provider'));
            expect(m.reactorHits).toBe(1);
        });
    });
}
