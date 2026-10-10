/**
 * Panon's active: "This Unit grants all allies Terran Guard II for 2 turns and deals 80% damage …
 * If this Unit is affected by Provoke or Taunt, it instead grants all allies Terran Guard III for 2
 * turns and deals 120% damage …". "instead" replaces the grant: a Taunted or Provoked Panon grants
 * Terran Guard III and NOT Terran Guard II, so each ally logs one buff gain, not two.
 *
 * Real parsed Panon active (buildTraceShip, refit 4). A faster ally grants Panon Taunt for the
 * Taunted arm.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
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

const panonActive = (): Ability[] => {
    const built = buildTraceShip('Panon');
    if (!built) throw new Error('Panon missing from reference data');
    const found = buildShipAbilities(built).slots.find((s) => s.slot === 'active');
    if (!found) throw new Error('Panon has no active slot');
    return found.abilities;
};
const panon = (): ShipSkills => ({ slots: [{ slot: 'active', abilities: panonActive() }] });
/** A cast that grants every ally Taunt for 2 turns. */
const tauntGranter = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'grant-taunt',
                    type: 'buff',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Taunt',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 2,
                    },
                },
            ],
        },
    ],
});
const NONE: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
const HP = 1e9;

const enemyAt = (
    id: string,
    position: Position,
    skills: ShipSkills = NONE,
    over: Partial<EnemyAttacker['stats']> = {}
): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: HP,
        speed: 50,
        security: 0,
        ...over,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: skills,
});
const playerShip = (
    id: string,
    position: Position,
    skills: ShipSkills,
    speed: number
): TeamActor => ({
    id,
    speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: skills,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: HP,
        },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: NONE,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
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

/** The Terran Guard grants `panonId` made in round 1, as `recipient:buff`, sorted. */
const guardGrants = (input: CombatEngineInput, panonId: string): string[] => {
    const bus = createEventBus();
    const out: string[] = [];
    bus.on('buff-applied', (e) => {
        if (e.granterId === panonId && e.round === 1 && e.buffName.startsWith('Terran Guard'))
            out.push(`${e.actorId}:${e.buffName}`);
    });
    runCombat({ ...input, bus });
    return out.sort();
};

beforeEach(() => setupKeyedRng(5));

describe('parse: Terran Guard II is the base branch of the "instead" pair', () => {
    it('it carries the not-Taunted, not-Provoked gate of the 80% damage', () => {
        const abilities = panonActive();
        const guard2 = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Terran Guard II'
        );
        const base80 = abilities.find(
            (a) => a.config.type === 'damage' && a.config.multiplier === 80
        );
        expect(guard2?.conditions).toEqual(base80?.conditions);
        expect(guard2?.conditions).toHaveLength(2);
    });
});

describe('player Panon', () => {
    const board = (taunted: boolean) =>
        base({
            shipSkills: panon(),
            teamActors: [playerShip('p-ally', 'M3', taunted ? tauntGranter() : NONE, 300)],
            enemyAttackers: [enemyAt('e-dummy', 'M4')],
        });

    it('Taunted: grants every ally Terran Guard III only', () => {
        expect(guardGrants(board(true), 'attacker')).toEqual([
            'attacker:Terran Guard III',
            'p-ally:Terran Guard III',
        ]);
    });

    it('not Taunted: grants every ally Terran Guard II only', () => {
        expect(guardGrants(board(false), 'attacker')).toEqual([
            'attacker:Terran Guard II',
            'p-ally:Terran Guard II',
        ]);
    });
});

describe('enemy Panon', () => {
    const board = (taunted: boolean) =>
        base({
            attack: 0,
            enemyAttackers: [
                enemyAt('e-panon', 'M4', panon(), { attack: 1000, speed: 100 }),
                enemyAt('e-ally', 'M3', taunted ? tauntGranter() : NONE, { speed: 300 }),
            ],
        });

    it('Taunted: grants every ally Terran Guard III only', () => {
        expect(guardGrants(board(true), 'e-panon')).toEqual([
            'e-ally:Terran Guard III',
            'e-panon:Terran Guard III',
        ]);
    });

    it('not Taunted: grants every ally Terran Guard II only', () => {
        expect(guardGrants(board(false), 'e-panon')).toEqual([
            'e-ally:Terran Guard II',
            'e-panon:Terran Guard II',
        ]);
    });
});
