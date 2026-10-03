/**
 * Tygr's passive: "After damaging an enemy affected by Stasis, once per round, this Unit gains one
 * extra action." The grant is gated on the STRUCK enemy carrying Stasis specifically; another
 * debuff (Corrosion, a stat-down) never satisfies it.
 *
 * Real parsed passive (buildTraceShip on docs/ship-skills.csv). A faster ally lands the named
 * debuff on the front enemy each round before Tygr acts; Tygr's turns per round are read off the
 * bus. Every negative arm differs from the Stasis arm only in WHICH status the ally lands.
 *
 * Clauses resolve in written order, so Tygr's own charged skill ("inflicts Stasis for 3 turns and
 * deals 210% damage") damages an enemy that already carries the Stasis it just landed: the charged
 * cast earns the extra action on its own. A resisted Stasis does not.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

const hasReferenceData = (): boolean => csvAvailable() && shipDataAvailable();

beforeAll(() => {
    if (!hasReferenceData()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

const parsedFrontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const singleTargetPattern = (): ParsedPattern => ({
    raw: 'base',
    shape: 'base',
    range: 0,
    modifiers: {},
});

const tygrExtraAction = (): Ability => {
    const ship = buildTraceShip('Tygr');
    if (!ship) throw new Error('Tygr missing from reference data');
    const ability = buildShipAbilities(ship)
        .slots.flatMap((s) => s.abilities)
        .find((a) => a.type === 'extra-action');
    if (!ability) throw new Error('Tygr extra-action ability missing');
    return ability;
};

const hit = (): Ability => ({
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

const statusAbility = (name: string): Ability =>
    name === 'Corrosion'
        ? {
              id: `ally-${name}`,
              type: 'dot',
              target: 'enemy',
              trigger: 'on-cast',
              conditions: [],
              config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 3 },
          }
        : {
              id: `ally-${name}`,
              type: 'debuff',
              target: 'enemy',
              trigger: 'on-cast',
              conditions: [],
              config: {
                  type: 'debuff',
                  buffName: name,
                  parsedEffects: {},
                  stacks: 1,
                  isStackable: false,
                  application: 'inflict',
                  duration: 3,
              },
          };

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const victim = (): EnemyAttacker => ({
    id: 'victim',
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 1,
        security: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

/** A fast ally whose active lands each named status on the front enemy. */
const statusAlly = (names: string[]): TeamActor => ({
    id: 'ally',
    speed: 150,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M3',
    target: parsedFrontTarget(),
    pattern: singleTargetPattern(),
    walk: {
        shipSkills: { slots: [{ slot: 'active', abilities: names.map(statusAbility) }] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
            defence: 0,
            hp: 1_000_000_000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const ROUNDS = 3;

/** Tygr's turns in each round. */
const tygrTurnsPerRound = (side: 'player' | 'enemy', statuses: string[]): number[] => {
    const kit: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [hit()] },
            { slot: 'passive', abilities: [tygrExtraAction()] },
        ],
    };
    const bus = createEventBus();
    const turns = new Array<number>(ROUNDS).fill(0);
    const focusId = side === 'player' ? 'attacker' : 'tygr-enemy';
    bus.on('turn-started', (e) => {
        if (e.actorId === focusId) turns[e.round - 1] += 1;
    });
    const base: CombatEngineInput = {
        enemyAttackers: [],
        attack: 100,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
        numRounds: ROUNDS,
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
        hp: 1_000_000_000,
        hacking: 200,
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: parsedFrontTarget(),
        pattern: singleTargetPattern(),
    };
    if (side === 'player') {
        runCombat({
            ...base,
            shipSkills: kit,
            speed: 100,
            enemyAttackers: [victim()],
            teamActors: [statusAlly(statuses)],
            bus,
        });
    } else {
        // Mirror: Tygr is the ENEMY; a faster enemy lands the statuses on the player-side focus
        // (the sink Tygr strikes).
        runCombat({
            ...base,
            speed: 1,
            security: 0,
            enemyAttackers: [
                {
                    id: 'enemy-source',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 150,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M3',
                    target: parsedFrontTarget(),
                    pattern: singleTargetPattern(),
                    shipSkills: {
                        slots: [{ slot: 'active', abilities: statuses.map(statusAbility) }],
                    },
                },
                {
                    id: 'tygr-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 100,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    target: parsedFrontTarget(),
                    pattern: singleTargetPattern(),
                    shipSkills: kit,
                },
            ],
            bus,
        });
    }
    return turns;
};

const realSlot = (slot: 'active' | 'charged' | 'passive'): Ability[] => {
    const ship = buildTraceShip('Tygr');
    if (!ship) throw new Error('Tygr missing from reference data');
    const found = buildShipAbilities(ship).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`Tygr has no ${slot} slot`);
    return found.abilities;
};

interface ChargedRoundOne {
    /** Tygr's turns in round 1. */
    turns: number;
    /** Stasis outcomes from Tygr's own casts in round 1. */
    stasisLanded: number;
    stasisResisted: number;
}

/**
 * Tygr's real kit, starting charged, alone against one enemy that never lands anything. Round 1
 * opens with his charged skill, so any Stasis on the enemy is the one that cast landed.
 * `hacking` 200 vs security 0 always lands the Stasis; 0 vs 0 always resists it.
 */
const tygrChargedRoundOne = (side: 'player' | 'enemy', hacking: number): ChargedRoundOne => {
    const kit: ShipSkills = {
        slots: [
            { slot: 'active', abilities: realSlot('active') },
            { slot: 'charged', abilities: realSlot('charged') },
            { slot: 'passive', abilities: realSlot('passive') },
        ],
    };
    const bus = createEventBus();
    const focusId = side === 'player' ? 'attacker' : 'tygr-enemy';
    const out: ChargedRoundOne = { turns: 0, stasisLanded: 0, stasisResisted: 0 };
    bus.on('turn-started', (e) => {
        if (e.actorId === focusId && e.round === 1) out.turns += 1;
    });
    bus.on('debuff-applied', (e) => {
        if (e.sourceId === focusId && e.round === 1 && e.buffName === 'Stasis')
            out.stasisLanded += 1;
    });
    bus.on('debuff-resisted', (e) => {
        if (e.sourceId === focusId && e.round === 1 && e.buffName === 'Stasis')
            out.stasisResisted += 1;
    });
    const base: CombatEngineInput = {
        enemyAttackers: [],
        attack: 100,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 3,
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
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
        hp: 1_000_000_000,
        hacking: 0,
        security: 0,
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: parsedFrontTarget(),
        pattern: singleTargetPattern(),
    };
    if (side === 'player') {
        runCombat({
            ...base,
            shipSkills: kit,
            hasChargedSkill: true,
            startCharged: true,
            hacking,
            speed: 100,
            enemyAttackers: [victim()],
            bus,
        });
    } else {
        // Mirror: Tygr is the ENEMY and strikes the player-side focus.
        runCombat({
            ...base,
            speed: 1,
            enemyAttackers: [
                {
                    id: 'tygr-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 100,
                        hacking,
                    },
                    chargeCount: 3,
                    startCharged: true,
                    position: 'M4',
                    target: parsedFrontTarget(),
                    pattern: singleTargetPattern(),
                    shipSkills: kit,
                },
            ],
            bus,
        });
    }
    return out;
};

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Tygr passive — the extra action names Stasis', () => {
    it('parses to an enemy Stasis count gate, once per round', () => {
        const a = tygrExtraAction();
        expect(a.config).toMatchObject({ type: 'extra-action', oncePerRound: true });
        expect(a.conditions).toEqual([
            {
                subject: 'enemy-debuff',
                derivable: true,
                buffName: 'Stasis',
                countComparator: 'gte',
                countThreshold: 1,
            },
        ]);
    });

    describe.each(['player', 'enemy'] as const)('%s side', (side) => {
        it('enemy carries Stasis → one extra action every round, once per round', () => {
            expect(tygrTurnsPerRound(side, ['Stasis'])).toEqual([2, 2, 2]);
        });

        it('enemy carries only Corrosion → no extra action', () => {
            expect(tygrTurnsPerRound(side, ['Corrosion'])).toEqual([1, 1, 1]);
        });

        it('enemy carries Corrosion and a stat-down but no Stasis → no extra action', () => {
            expect(tygrTurnsPerRound(side, ['Corrosion', 'Attack Down II'])).toEqual([1, 1, 1]);
        });

        it("Tygr's charged skill lands Stasis before its damage → extra action that round", () => {
            expect(tygrChargedRoundOne(side, 200)).toEqual({
                turns: 2,
                stasisLanded: 1,
                stasisResisted: 0,
            });
        });

        it("Tygr's charged Stasis is resisted → no extra action", () => {
            expect(tygrChargedRoundOne(side, 0)).toEqual({
                turns: 1,
                stasisLanded: 0,
                stasisResisted: 1,
            });
        });

        it('enemy carries Stasis among other debuffs → extra action', () => {
            expect(tygrTurnsPerRound(side, ['Corrosion', 'Attack Down II', 'Stasis'])).toEqual([
                2, 2, 2,
            ]);
        });
    });
});
