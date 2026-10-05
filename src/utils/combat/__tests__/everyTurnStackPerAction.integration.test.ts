/**
 * "This Unit gains 1 stack of Blast every turn" counts every ACTION the unit takes, extra actions
 * included (owner ruling R58, 2026-10-05). Round 1: Sokol holds 1 Blast stack, kills an enemy and
 * takes his extra action straight away — that extra action is a turn, so he holds 2 stacks on it,
 * and 3 on his round-2 turn.
 *
 * Blast is +15% outgoing damage per stack, so Sokol's 80% active on an enemy with no defence deals
 * 800 × (1 + 0.15 × stacks) at attack 1000: 920 at 1 stack, 1040 at 2, 1160 at 3.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv). Sokol at refit 4 carries the extra
 * action ("When an enemy is destroyed, once per round, this Unit gains 1 extra action"); at refit 0
 * his passive is the Blast clause alone.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip, type RefitLevel } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

/** Sokol's real active + passive at `refit`. */
const sokol = (refit: RefitLevel): ShipSkills => {
    const built = buildTraceShip('Sokol', { refitLevel: refit });
    if (!built) throw new Error('Sokol missing from reference data');
    const slots = buildShipAbilities(built).slots.filter(
        (s) => s.slot === 'active' || s.slot === 'passive'
    );
    const passive = slots.find((s) => s.slot === 'passive')?.abilities ?? [];
    if (!passive.some((a) => a.config.type === 'buff' && a.config.buffName === 'Blast'))
        throw new Error('Sokol passive lost its Blast clause');
    const hasExtra = passive.some((a) => a.type === 'extra-action');
    if (hasExtra !== (refit === 4))
        throw new Error(`Sokol refit ${refit} extra-action shape moved`);
    return { slots };
};
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

const BIG = 1e9;
/** Dies to Sokol's first hit. */
const FRAGILE = 10;

const stats = (hp: number) => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defence: 0,
    hp,
    speed: 50,
    security: 0,
});

const enemyAt = (
    id: string,
    position: Position,
    hp: number,
    shipSkills: ShipSkills = NO_SKILLS,
    speed = 50
): EnemyAttacker => ({
    id,
    stats: { ...stats(hp), speed, attack: shipSkills === NO_SKILLS ? 0 : 1000 },
    chargeCount: 9,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills,
});

const teamAt = (
    id: string,
    position: Position,
    hp: number,
    shipSkills: ShipSkills = NO_SKILLS,
    speed = 50
): TeamActor => ({
    id,
    speed,
    chargeCount: 9,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills,
        stats: {
            attack: shipSkills === NO_SKILLS ? 0 : 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp,
            hacking: 0,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 9,
    shipSkills: NO_SKILLS,
    numRounds: 2,
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
    hp: BIG,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M3',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

/** Every hit `actorId` lands on a ship that survives it, as `round:damage`, in order. */
const hitsBy = (input: CombatEngineInput, actorId: string, skipTarget: string): string[] => {
    const bus = createEventBus();
    const out: string[] = [];
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId === actorId && e.targetId !== skipTarget)
            out.push(`${e.round}:${Math.round(e.damage ?? 0)}`);
    });
    runCombat({ ...input, bus });
    return out;
};

beforeEach(() => {
    setupKeyedRng(11);
});

describe("Sokol's 'gains 1 stack of Blast every turn' counts his extra action (R58)", () => {
    for (const sokolFirst of [true, false]) {
        const order = sokolFirst ? 'Sokol acts first' : 'Sokol acts last';
        const sokolSpeed = sokolFirst ? 200 : 10;
        it(`player Sokol, ${order}: kill → extra action at 2 stacks, round 2 at 3`, () => {
            const input = base({
                shipSkills: sokol(4),
                attack: 1000,
                speed: sokolSpeed,
                position: 'M4',
                enemyAttackers: [enemyAt('enemy-a', 'M4', FRAGILE), enemyAt('enemy-b', 'M3', BIG)],
            });
            expect(hitsBy(input, 'attacker', 'enemy-a')).toEqual(['1:1040', '2:1160']);
        });
        it(`enemy Sokol, ${order}: kill → extra action at 2 stacks, round 2 at 3`, () => {
            const input = base({
                speed: 100,
                position: 'M3',
                teamActors: [teamAt('ally-front', 'M4', FRAGILE)],
                enemyAttackers: [enemyAt('enemy-sokol', 'M4', BIG, sokol(4), sokolSpeed)],
            });
            expect(hitsBy(input, 'enemy-sokol', 'ally-front')).toEqual(['1:1040', '2:1160']);
        });
        it(`player Sokol, ${order}: no kill → no extra action, one stack per round`, () => {
            const input = base({
                shipSkills: sokol(4),
                attack: 1000,
                speed: sokolSpeed,
                position: 'M4',
                enemyAttackers: [enemyAt('enemy-a', 'M4', BIG)],
            });
            expect(hitsBy(input, 'attacker', 'none')).toEqual(['1:920', '2:1040']);
        });
        it(`enemy Sokol, ${order}: no kill → no extra action, one stack per round`, () => {
            const input = base({
                speed: 100,
                position: 'M4',
                enemyAttackers: [enemyAt('enemy-sokol', 'M4', BIG, sokol(4), sokolSpeed)],
            });
            expect(hitsBy(input, 'enemy-sokol', 'none')).toEqual(['1:920', '2:1040']);
        });
    }

    it("an ally's extra action does not add a stack to Sokol", () => {
        // The refit-4 ally kills the front enemy and takes his extra action; the refit-0 focus
        // (Blast clause only, no extra action of his own) acts once per round.
        const input = base({
            shipSkills: sokol(0),
            attack: 1000,
            speed: 10,
            position: 'M3',
            teamActors: [teamAt('ally-sokol', 'M4', BIG, sokol(4), 200)],
            enemyAttackers: [enemyAt('enemy-a', 'M4', FRAGILE), enemyAt('enemy-b', 'M3', BIG)],
        });
        expect(hitsBy(input, 'attacker', 'none')).toEqual(['1:920', '2:1040']);
        // The instrument: the ally really did take an extra action at 2 stacks.
        expect(hitsBy(input, 'ally-sokol', 'enemy-a')).toEqual(['1:1040', '2:1160']);
    });

    it("an enemy ally's extra action does not add a stack to the enemy Sokol", () => {
        const input = base({
            speed: 100,
            position: 'M3',
            teamActors: [teamAt('ally-front', 'M4', FRAGILE)],
            enemyAttackers: [
                enemyAt('enemy-sokol-r4', 'M4', BIG, sokol(4), 200),
                enemyAt('enemy-sokol-r0', 'M3', BIG, sokol(0), 10),
            ],
        });
        expect(hitsBy(input, 'enemy-sokol-r0', 'none')).toEqual(['1:920', '2:1040']);
        expect(hitsBy(input, 'enemy-sokol-r4', 'ally-front')).toEqual(['1:1040', '2:1160']);
    });
});
