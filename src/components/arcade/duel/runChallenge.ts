import type { Ship } from '../../../types/ship';
import type { ChallengeKind, DuelOutcome } from '../../../utils/arcade/types';
import type { CombatStatsDeps } from '../../../utils/ship/combatStats';
import { shipFinalStats } from '../../../utils/ship/combatStats';
import { nextRandom } from '../../../utils/arcade/rng';
import { asFactionName } from '../../../constants/factions';
import { buildShipAbilitiesWithEquipment } from '../../../utils/abilities/buildShipAbilitiesWithEquipment';
import { computeAffinityModifiers } from '../../../utils/calculators/affinityUtils';
import { resetRateGateRng, setupKeyedRng } from '../../../utils/calculators/rateAccumulator';
import { simulateDPS, SYNTHESIZED_DPS_ENEMY_ID } from '../../../utils/calculators/dpsSimulator';
import {
    DEFAULT_ATTACKER_SLOT,
    DEFAULT_ENEMY_SLOT,
} from '../../../utils/calculators/dpsEnemyPlacement';
import { simulateHealing } from '../../../utils/calculators/healingEngineAdapter';
import { DEFAULT_HEALER_SLOT } from '../../../utils/calculators/healingPlacement';
import { simulateDefenseSurvivability } from '../../../utils/calculators/defenseSurvivabilitySim';
import { detectShipCharged } from '../../../utils/calculators/rosterHelpers';
import { targetingOf } from '../../../utils/calculators/shipTargeting';
import {
    DEFAULT_DPS_ENEMY_AFFINITY,
    defaultDpsEnemyConfig,
    defaultEnemyAttacker,
    defenderFieldsFromShip,
    dpsConfigFromShip,
    enemyAttackerInput,
    healerStatsFromShip,
} from '../../../utils/calculators/calculatorShipInputs';
import type { RowPicks } from './pickOpponents';
import { CHALLENGE_ROUNDS, runDuel, runTeamDuel, type DuelResult } from './runDuel';

/** The challenges won by racing the gate ship at the same task rather than fighting it. */
export type RaceKind = Extract<ChallengeKind, 'dps' | 'heal' | 'tank'>;

/** One ship's run at a race. `byRound[i]` is the compared figure after round `i + 1` (damage
 *  dealt or healing done so far, or HP% left); `total` is the figure the race compares. Both are
 *  empty/0 for a skipped race. */
export interface RaceSide {
    byRound: number[];
    total: number;
}

export interface RaceResult {
    kind: RaceKind;
    outcome: DuelOutcome;
    flown: RaceSide;
    rival: RaceSide;
}

/** A `duel` or `team` fight, played back turn by turn. */
export interface FightResult extends DuelResult {
    kind: Extract<ChallengeKind, 'duel' | 'team'>;
}

export type ChallengeResult = FightResult | RaceResult;

export const isRace = (result: ChallengeResult): result is RaceResult =>
    result.kind === 'dps' || result.kind === 'heal' || result.kind === 'tank';

/** The seed every simulation of one checkpoint row uses: fixed by the run's seed and the row. */
export function challengeSeed(runSeed: number, checkpointId: number): number {
    const state = { rngState: (runSeed ^ Math.imul(checkpointId, 0x9e3779b1)) >>> 0 };
    return Math.floor(nextRandom(state) * 4294967296) >>> 0;
}

/** Runs `run` with the combat RNG pinned to `seed`, as `runSeededBattle` does for fights. */
function seeded<T>(seed: number, run: () => T): T {
    setupKeyedRng(seed);
    try {
        return run();
    } finally {
        resetRateGateRng();
    }
}

const running = (perRound: number[]) => {
    let sum = 0;
    return perRound.map((v) => (sum += v));
};

/** `ship` against the DPS page's default enemy for CHALLENGE_ROUNDS, built as the page builds a
 *  picked ship; compares total damage dealt. */
export function dpsRace(ship: Ship, deps: CombatStatsDeps): RaceSide {
    const config = dpsConfigFromShip(ship, deps);
    const enemy = defaultDpsEnemyConfig();
    const enemyAffinity = DEFAULT_DPS_ENEMY_AFFINITY;
    const { damageModifier, critCap, critPenalty } = computeAffinityModifiers(
        config.affinity,
        enemyAffinity
    );
    const result = simulateDPS({
        attack: config.attack,
        crit: config.crit,
        critDamage: config.critDamage,
        defensePenetration: config.defensePenetration,
        hacking: config.hacking ?? 200,
        defence: config.defence,
        hp: config.hp,
        speed: config.speed,
        chargeCount: config.chargeCount,
        shipSkills: config.shipSkills,
        enemyDefense: enemy.defense,
        enemyHp: enemy.hp,
        enemySecurity: enemy.security,
        enemySpeed: enemy.speed,
        rounds: CHALLENGE_ROUNDS,
        enemyAffinity,
        selfBuffs: [],
        enemyDebuffs: [],
        startCharged: config.startCharged,
        affinity: config.affinity,
        affinityDamageModifier: damageModifier,
        affinityCritCap: critCap,
        affinityCritPenalty: critPenalty,
        faction: config.faction,
        name: ship.name,
        allyChargePerRound: 0,
        position: DEFAULT_ATTACKER_SLOT,
        enemyAttackers: [
            {
                id: SYNTHESIZED_DPS_ENEMY_ID,
                stats: {
                    attack: enemy.attack,
                    crit: enemy.crit,
                    critDamage: enemy.critDamage,
                    speed: enemy.speed,
                    defence: enemy.defense,
                    hp: enemy.hp,
                    security: enemy.security,
                    hacking: enemy.hacking,
                    defensePenetration: enemy.defensePenetration,
                    shieldPenetration: enemy.shieldPenetration,
                    healModifier: enemy.healModifier,
                },
                chargeCount: 0,
                startCharged: false,
                shipSkills: enemy.shipSkills,
                position: DEFAULT_ENEMY_SLOT,
                affinity: enemyAffinity,
            },
        ],
    });
    return {
        byRound: running(result.rounds.map((r) => r.totalRoundDamage)),
        total: result.summary.totalDamage,
    };
}

/** `ship` healing itself under the healing page's default enemy for CHALLENGE_ROUNDS, built as
 *  the page builds a picked healer; compares total healing done. */
export function healRace(ship: Ship, deps: CombatStatsDeps): RaceSide {
    const stats = healerStatsFromShip(shipFinalStats(ship, deps));
    const result = simulateHealing({
        healer: {
            hp: stats.hp,
            attack: stats.attack,
            defence: stats.defence,
            crit: stats.crit,
            critDamage: stats.critDamage,
            defensePenetration: 0,
            healModifier: stats.healModifier,
            hacking: stats.hacking,
            speed: stats.speed,
        },
        chargeCount: ship.chargeSkillCharge ?? 0,
        startCharged: detectShipCharged(ship),
        shipSkills: buildShipAbilitiesWithEquipment(ship, deps.getGearPiece),
        selfBuffs: [],
        healTargetId: 'healer',
        healTargetAffinity: ship.affinity,
        healTargetSecurity: stats.security,
        healerRole: ship.type,
        healerFaction: asFactionName(ship.faction),
        healerName: ship.name,
        // The healing page's starting team slot: no ship picked, placed by the adapter. A support
        // footprint that reaches it heals it, as on the page.
        teamActors: [
            {
                id: 'team-1',
                speed: 100,
                chargeCount: 0,
                startCharged: false,
                selfBuffs: [],
                enemyDebuffs: [],
            },
        ],
        enemies: [enemyAttackerInput(defaultEnemyAttacker())],
        rounds: CHALLENGE_ROUNDS,
        healerPosition: DEFAULT_HEALER_SLOT,
        healerTargeting: targetingOf(ship),
    });
    return {
        byRound: running(result.rounds.map((r) => r.totalRoundHealing)),
        total: result.summary.totalHealing,
    };
}

/** `ship` under the defence page's first added attacker for CHALLENGE_ROUNDS, built as the page
 *  builds a picked defender; compares HP% left (0 once destroyed).
 *
 *  A round's `hpPct` is read at the top of that round, so the run lasts one extra round and the
 *  HP left after round `r` is the reading entering round `r + 1`. Nothing in that extra round
 *  reaches the readings before it. */
export function tankRace(ship: Ship, deps: CombatStatsDeps): RaceSide {
    const fields = defenderFieldsFromShip(ship, shipFinalStats(ship, deps), deps.getGearPiece);
    const result = simulateDefenseSurvivability({
        defender: {
            hp: fields.hp,
            defence: fields.defense,
            security: fields.security,
            attack: fields.attack,
            crit: fields.crit,
            critDamage: fields.critDamage,
            speed: fields.speed,
            hacking: fields.hacking,
            healModifier: fields.healModifier,
        },
        shipSkills: fields.shipSkills,
        // The kit reaches the engine through `shipSkills`; its auto-filled copy would count it
        // twice (#662), as on the defence page.
        selfBuffs: fields.buffs.filter((b) => !b.autoFilled),
        chargeCount: fields.chargeCount,
        startCharged: fields.startCharged,
        affinity: fields.affinity,
        role: fields.role,
        faction: fields.faction,
        targeting: targetingOf(ship),
        teamActors: [],
        enemies: [enemyAttackerInput(defaultEnemyAttacker())],
        rounds: CHALLENGE_ROUNDS + 1,
    });
    const byRound = Array.from({ length: CHALLENGE_ROUNDS }, (_, i) => {
        const round = i + 1;
        if (result.destroyedRound !== undefined && result.destroyedRound <= round) return 0;
        return result.rounds[round]?.hpPct ?? 0;
    });
    return { byRound, total: byRound[CHALLENGE_ROUNDS - 1] };
}

const RACES: Record<RaceKind, (ship: Ship, deps: CombatStatsDeps) => RaceSide> = {
    dps: dpsRace,
    heal: healRace,
    tank: tankRace,
};

/** The flown ship wins when its figure is at least the rival's: ties go to the flown ship, so
 *  two ships that both score 0 is a win. */
export const raceOutcome = (flown: RaceSide, rival: RaceSide): 'win' | 'lose' =>
    flown.total >= rival.total ? 'win' : 'lose';

/** Both ships run the same `kind` task under the same seed; any error, or a figure that is not a
 *  finite number, → skipped. */
export function runRace(
    kind: RaceKind,
    flown: Ship,
    rival: Ship,
    deps: CombatStatsDeps,
    seed: number
): RaceResult {
    try {
        const race = RACES[kind];
        const a = seeded(seed, () => race(flown, deps));
        const b = seeded(seed, () => race(rival, deps));
        if (!Number.isFinite(a.total) || !Number.isFinite(b.total)) {
            throw new Error(`arcade ${kind} race produced a non-finite figure`);
        }
        return { kind, outcome: raceOutcome(a, b), flown: a, rival: b };
    } catch (error) {
        if (import.meta.env.DEV) console.warn(`arcade ${kind} race skipped`, error);
        return skippedChallenge(kind);
    }
}

/** A challenge that applies no stakes, with nothing to play back. */
export function skippedChallenge(kind: RaceKind): RaceResult;
export function skippedChallenge(kind: ChallengeKind): ChallengeResult;
export function skippedChallenge(kind: ChallengeKind): ChallengeResult {
    if (kind === 'duel' || kind === 'team') return { kind, outcome: 'skipped', beats: [] };
    const empty = (): RaceSide => ({ byRound: [], total: 0 });
    return { kind, outcome: 'skipped', flown: empty(), rival: empty() };
}

/** Runs the challenge behind gate `slot` of a row: the flown ship against that gate's ship (or
 *  trio, with the row's allies), with the row's `seed`. A row whose picks do not fit its challenge
 *  is skipped. */
export function runChallenge(
    challenge: ChallengeKind,
    flown: Ship,
    picks: RowPicks,
    slot: 0 | 1,
    deps: CombatStatsDeps,
    seed: number
): ChallengeResult {
    if (challenge === 'team') {
        if (picks.kind !== 'team') return skippedChallenge(challenge);
        return {
            kind: 'team',
            ...runTeamDuel(flown, picks.allies, picks.gates[slot], deps, seed),
        };
    }
    if (picks.kind !== 'single') return skippedChallenge(challenge);
    const rival = picks.gates[slot];
    if (challenge === 'duel') return { kind: 'duel', ...runDuel(flown, rival, deps, seed) };
    return runRace(challenge, flown, rival, deps, seed);
}
