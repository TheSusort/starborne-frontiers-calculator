/**
 * A REACTIVE ability gated on its owner's own HP reads THAT owner's live HP — whichever slot and
 * side the owner is on.
 *
 * Cobalt R2+ passive: "Every turn this Unit adds 1 charge to its charged skill and gains Out.
 * Damage Up II for 1 turn if it is at full HP." (`start-of-turn`, gated `hp-threshold above 99`,
 * `hpSubject: 'self'`.)
 * Makoli R2+ passive: "When directly damaged while below 40% HP this Unit repairs 20% of its max HP
 * and inflicts Disable for 1 turn." (`on-attacked`, gated `hp-threshold below 40`.)
 *
 * Each case puts the real passive on the player FOCUS, on a second player ship, and on an enemy,
 * and asks the same question of all three.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import type { CombatActor } from '../state';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const HP = 100_000;
const HUGE_HP = 1_000_000_000;

const requireReferenceData = (): void => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the gitignored reference data into this ' +
                'worktree. These cases read REAL kits and cannot run without it.'
        );
    }
};

const realPassive = (name: string): ShipSkills['slots'][number] => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} is missing from the reference data in this worktree`);
    const passive = buildShipAbilities(ship).slots.find((s) => s.slot === 'passive');
    if (!passive) throw new Error(`${name} has no parsed passive`);
    return passive;
};

const front = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const plainHit = (id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

type Placement = 'focus' | 'team' | 'enemy';

/** The subject sits front-most on its side (M4) and is struck by `hits` (attack values, fastest
 *  first) from the opposing side before it acts. Everyone else is an inert, huge-HP bystander. */
const board = (
    placement: Placement,
    passive: ShipSkills['slots'][number],
    hits: number[]
): CombatEngineInput => {
    const subjectSkills: ShipSkills = {
        slots: [{ slot: 'active', abilities: [] }, { slot: 'charged', abilities: [] }, passive],
    };
    const hitters = hits.map((attack, i) => ({ id: `hitter-${i}`, attack, speed: 300 - i }));
    const enemyHitter = (h: (typeof hitters)[number], position: Position): EnemyAttacker => ({
        id: h.id,
        stats: {
            attack: h.attack,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: HUGE_HP,
            speed: h.speed,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        target: front(),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [plainHit(`${h.id}-hit`)] }] },
    });
    const teamShip = (
        id: string,
        position: Position,
        o: { hp: number; attack: number; speed: number; skills: ShipSkills; chargeCount: number }
    ): TeamActorEngineInput => ({
        id,
        speed: o.speed,
        chargeCount: o.chargeCount,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        role: 'ATTACKER',
        position,
        target: front(),
        pattern: basePattern(),
        walk: {
            shipSkills: o.skills,
            stats: {
                attack: o.attack,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: o.hp,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: true,
        },
    });
    const base = {
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinity: 'antimatter' as const,
        defence: 0,
        healTargetId: 'attacker',
        mode: 'healing' as const,
        target: front(),
        pattern: basePattern(),
    };
    if (placement === 'enemy') {
        // The player focus throws the first hit; any further hits come from player team ships.
        const [first, ...rest] = hitters;
        return {
            ...base,
            attack: first.attack,
            speed: first.speed,
            hp: HUGE_HP,
            chargeCount: 0,
            hasChargedSkill: false,
            position: 'M4',
            shipSkills: { slots: [{ slot: 'active', abilities: [plainHit('focus-hit')] }] },
            teamActors: rest.map((h, i) =>
                teamShip(h.id, (['M3', 'M2'] as const)[i], {
                    hp: HUGE_HP,
                    attack: h.attack,
                    speed: h.speed,
                    chargeCount: 0,
                    skills: { slots: [{ slot: 'active', abilities: [plainHit(`${h.id}-hit`)] }] },
                })
            ),
            enemyAttackers: [
                {
                    id: 'subject',
                    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 10 },
                    chargeCount: 3,
                    startCharged: false,
                    position: 'M4',
                    affinity: 'antimatter',
                    target: front(),
                    pattern: basePattern(),
                    shipSkills: subjectSkills,
                },
            ],
        };
    }
    const enemies = hitters.map((h, i) => enemyHitter(h, (['M4', 'M3', 'M2'] as const)[i]));
    if (placement === 'focus') {
        return {
            ...base,
            attack: 0,
            speed: 10,
            hp: HP,
            chargeCount: 3,
            hasChargedSkill: true,
            position: 'M4',
            shipSkills: subjectSkills,
            enemyAttackers: enemies,
        };
    }
    return {
        ...base,
        attack: 0,
        speed: 5,
        hp: HUGE_HP,
        chargeCount: 0,
        hasChargedSkill: false,
        position: 'B1',
        shipSkills: { slots: [] },
        teamActors: [
            teamShip('subject', 'M4', {
                hp: HP,
                attack: 0,
                speed: 10,
                chargeCount: 3,
                skills: subjectSkills,
            }),
        ],
        enemyAttackers: enemies,
    };
};

const SUBJECT_ID: Record<Placement, string> = {
    focus: 'attacker',
    team: 'subject',
    enemy: 'subject',
};

const run = (input: CombatEngineInput): { events: CombatEvent[]; actors: CombatActor[] } => {
    const events: CombatEvent[] = [];
    const bus = createEventBus();
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    let actors: CombatActor[] = [];
    runCombat({
        ...input,
        bus,
        __testTapActors: (a) => {
            actors = a;
        },
    });
    return { events, actors };
};

const PLACEMENTS: Placement[] = ['focus', 'team', 'enemy'];

describe("Cobalt's full-HP passive reads Cobalt's own HP in every slot and on both sides", () => {
    beforeAll(requireReferenceData);

    const cobaltGains = (placement: Placement, hits: number[]) => {
        const id = SUBJECT_ID[placement];
        const { events } = run(board(placement, realPassive('Cobalt'), hits));
        return {
            buffs: events.filter(
                (e) =>
                    e.type === 'buff-applied' &&
                    e.actorId === id &&
                    e.buffName === 'Out. Damage Up II'
            ).length,
            charges: events.filter(
                (e) => e.type === 'charge-changed' && e.actorId === id && e.reason === 'manip'
            ).length,
            struck: events.some(
                (e) => e.type === 'attacked' && e.targetId === id && (e.damage ?? 0) > 0
            ),
        };
    };

    for (const placement of PLACEMENTS) {
        it(`${placement}: untouched (100% HP) → gains Out. Damage Up II and a charge`, () => {
            expect(cobaltGains(placement, [0])).toMatchObject({ buffs: 1, charges: 1 });
        });

        it(`${placement}: hit to 98% HP before its turn → gains neither`, () => {
            const r = cobaltGains(placement, [2_000]);
            expect(r.struck).toBe(true);
            expect(r).toMatchObject({ buffs: 0, charges: 0 });
        });
    }
});

describe("Makoli's below-40% repair reads Makoli's own HP in every slot and on both sides", () => {
    beforeAll(requireReferenceData);

    /** Two hits before Makoli acts: 65% of her HP, then 1%. The second lands while she is at 35%. */
    const makoliHpAfter = (placement: Placement): number => {
        const id = SUBJECT_ID[placement];
        const { actors } = run(board(placement, realPassive('Makoli'), [65_000, 1_000]));
        const makoli = actors.find((a) => a.id === id);
        if (!makoli) throw new Error(`no actor ${id}`);
        return makoli.currentHp;
    };

    for (const placement of PLACEMENTS) {
        it(`${placement}: struck while below 40% → repairs 20% of max HP`, () => {
            // Without the repair she ends on 100000 − 65000 − 1000 = 34000.
            expect(makoliHpAfter(placement)).toBeGreaterThanOrEqual(34_000 + 0.2 * HP);
        });
    }
});
