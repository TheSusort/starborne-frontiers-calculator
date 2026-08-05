import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';
import type { BattlePlacement, BattleSimulationInput } from '../../calculators/battleSimulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { canonicalPlacement } from './fixtures';

export type ScenarioName = 'plain' | 'richEnemy' | 'hurtAllies';

/** Fixed scenario order — also the snapshot key order. */
export const SCENARIOS: readonly ScenarioName[] = ['plain', 'richEnemy', 'hurtAllies'] as const;

/** Pinned RNG seed for every scenario battle. One seed for all of them: the scenarios are meant
 *  to differ by initial STATE, not by RNG stream. */
export const SEED = 20260805;

/** 20 rounds, matching the ablation harness — long enough for charge skills to fire, DoTs to
 *  tick more than once, and cooldown-gated grants to re-arm. */
export const ROUNDS = 20;

/** Column 4 is the FRONT of the board (columns run 1 = back → 4 = front). The focus ship takes a
 *  front-row slot so it is reachable by enemy targeting and resolves enemies itself. */
export const FOCUS_POSITION: Position = 'M4';

const ALLY_POSITIONS: Position[] = ['T4', 'T3', 'M3'];
const ENEMY_POSITIONS: Position[] = ['B4', 'B3', 'B2', 'B1'];

/** Seven corpus ships verified inert: no passives, no charge skill, and a bare
 *  "This Unit deals 90% damage" active (see the inertness guard test, which fails loudly if a data
 *  refresh changes that). Because they carry no kit, a focus ship's fingerprint is a function of
 *  its OWN kit plus the engine — nothing here can perturb it.
 *
 *  First 4 are the enemy side, last 3 the ally side. Distinct WITHIN each side because a repeated
 *  ship on one side is an illegal in-game state (compose.ts's pickDistinctShip); repeats across
 *  sides would be legal but are unnecessary given 10 candidates exist. */
export const FILLER_NAMES: readonly string[] = [
    'Bedrock',
    'Crusher',
    'Custodian',
    'Forsythia',
    'Jempol',
    'Krysa',
    'Rookie',
] as const;

/** Filler survive the whole window: without this, a damage-formula change shifts kill timing,
 *  which shifts which clauses get to fire — numeric sensitivity leaking into a structural suite. */
const FILLER_HP = 500_000_000;
/** ...and hit softly enough that the focus ship also survives all 20 rounds. */
const FILLER_ATTACK = 500;

/** The fragile ally: dies early and deterministically so on-ally-destroyed / revive / cheat-death
 *  clauses fire. The ONE intentional exception to filler survival. Verified (traceShipFactory +
 *  battleSimulator.resolveStats pass overrides straight through with no scaling) that hp: 1
 *  resolves to stats.hp = 1 and currentHp = 1 at actor construction — the ally starts ALIVE, then
 *  dies to the very first hit it takes (filler attack is 500). No need to raise it. */
const FRAGILE_ALLY_HP = 1;

let cache: Map<string, Ship> | null = null;

function fillerShip(name: string): Ship {
    if (!cache) cache = new Map();
    const hit = cache.get(name);
    if (hit) return hit;
    const ship = buildTraceShip(name);
    if (!ship) {
        throw new Error(
            `kitFingerprintScenarios: filler ship "${name}" did not resolve — ` +
                'docs/ship-skills.csv / docs/ship-data.json are gitignored reference data ' +
                'expected on dev machines (see CLAUDE.md).'
        );
    }
    cache.set(name, ship);
    return ship;
}

/** A filler placement: canonical base stats, then HP and attack overridden for survivability. */
function fillerPlacement(name: string, position: Position, hp = FILLER_HP): BattlePlacement {
    const base = canonicalPlacement(fillerShip(name), position);
    return { ...base, statOverrides: { ...base.statOverrides, hp, attack: FILLER_ATTACK } };
}

/** 20% of max HP as a starting shield pool — any positive pool satisfies `enemy-shield`, which is
 *  a boolean gate, and 20% is small enough that it drains during the battle so shield-destroyed
 *  and punch-through clauses also get to fire. */
const SHIELD_FRACTION = 0.2;
/** Allies start at 50% HP: below every corpus hp-threshold gate worth exercising, and low enough
 *  that heals have real headroom to land rather than clipping entirely to overheal. */
const HURT_FRACTION = 0.5;

const maxHpOf = (a: CombatActor): number => a.stats.hp;

function seedFor(scenario: ScenarioName): ((actors: CombatActor[]) => void) | undefined {
    switch (scenario) {
        case 'plain':
            return undefined;
        case 'richEnemy':
            return (actors) => {
                for (const a of actors) {
                    if (a.side === 'enemy') a.shieldPool = maxHpOf(a) * SHIELD_FRACTION;
                }
            };
        case 'hurtAllies':
            return (actors) => {
                for (const a of actors) {
                    if (a.side === 'player') a.currentHp = maxHpOf(a) * HURT_FRACTION;
                }
            };
    }
}

/**
 * The scenario battle for one focus ship: the focus at FOCUS_POSITION on the player side with 3
 * inert filler allies, against 4 inert filler enemies. Only the seeded initial state varies by
 * scenario. The focus ship keeps `canonicalPlacement`'s un-modified level-60 base stats — no gear,
 * no refits, no engineering — so its fingerprint reflects its kit, not a gearing choice.
 */
export function buildScenarioBattle(focus: Ship, scenario: ScenarioName): BattleSimulationInput {
    const enemyNames = FILLER_NAMES.slice(0, 4);
    const allyNames = FILLER_NAMES.slice(4, 7);
    const tap = seedFor(scenario);
    return {
        playerTeam: [
            canonicalPlacement(focus, FOCUS_POSITION),
            ...allyNames.map((name, i) =>
                fillerPlacement(
                    name,
                    ALLY_POSITIONS[i],
                    scenario === 'hurtAllies' && i === 0 ? FRAGILE_ALLY_HP : FILLER_HP
                )
            ),
        ],
        enemyTeam: enemyNames.map((name, i) => fillerPlacement(name, ENEMY_POSITIONS[i])),
        rounds: ROUNDS,
        ...(tap ? { __testTapActors: tap } : {}),
    };
}
