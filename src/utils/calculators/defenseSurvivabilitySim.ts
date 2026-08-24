import { ShipSkills } from '../../types/abilities';
import { SelectedGameBuff, TeamActorInput } from '../../types/calculator';
import { AffinityName } from '../../types/ship';
import type { ShipTypeName } from '../../constants/shipTypes';
import type { FactionKey } from '../../constants/factions';
import type { Position } from '../../types/encounters';
import type { ShipTargeting } from '../targetingParser';
import type { CombatEventBus } from '../combat/events';
import { simulateHealing, EnemyAttackerInput } from './healingEngineAdapter';

/** The ship under test. Mirrors the stat fields `HealerStats` needs, named for the defender. */
export interface DefenderStats {
    hp: number;
    defence: number;
    security: number;
    /** The defender's own offence. It DOES take its own turns (see the module note below). */
    attack: number;
    crit: number;
    critDamage: number;
    speed: number;
    hacking: number;
    /** The defender's REAL heal modifier — a defender with self-repair must actually repair.
     *  Zeroing this would silently understate every sustain tank. */
    healModifier: number;
}

export interface DefenseSimulationInput {
    defender: DefenderStats;
    shipSkills: ShipSkills;
    selfBuffs: SelectedGameBuff[];
    chargeCount: number;
    startCharged: boolean;
    affinity?: AffinityName;
    role?: ShipTypeName;
    faction?: FactionKey;
    position?: Position;
    targeting?: ShipTargeting;
    /** Optional supporting allies (healers, protectors). */
    teamActors?: TeamActorInput[];
    enemies: EnemyAttackerInput[];
    rounds: number;
    bus?: CombatEventBus;
}

/** Where the gross incoming damage went. `toHp` is DERIVED by subtraction — see the note on
 *  `gross` before writing any test against these four terms. */
export interface DefenseIntakeBreakdown {
    /** Landed on the HP bar. Derived: gross − toShield − toBarrier − toConversion. */
    toHp: number;
    toShield: number;
    toBarrier: number;
    toConversion: number;
    /** Σ incomingDamage. GROSS — already contains the three mitigation terms above. This is the
     *  measured-EHP figure; adding the others to it double-counts every point of mitigation. */
    gross: number;
}

export interface DefenseSurvivabilityRound {
    round: number;
    incomingDamage: number;
    shieldAbsorbed: number;
    barrierAbsorbed: number;
    convertedToShield: number;
    /** HP% ENTERING the round. */
    hpPct: number;
    /** Shield pool ENTERING the round. */
    shieldPool: number;
}

export interface DefenseSurvivabilityResult {
    /** Σ incomingDamage over the ELAPSED rounds. When `survived` is true this is a LOWER BOUND on
     *  the ship's durability, not a death threshold — the UI must render survivors distinctly. */
    measuredEHP: number;
    survived: boolean;
    destroyedRound?: number;
    elapsedRounds: number;
    breakdown: DefenseIntakeBreakdown;
    rounds: DefenseSurvivabilityRound[];
}

/**
 * Runs a survivability window for one defender and reduces it to a measured effective-HP figure.
 *
 * Implemented over `simulateHealing` with `healTargetId: 'healer'`, which makes the engine's focus
 * actor the bombarded ship. That reuses the whole healing harness — roster normalisation, board
 * placement, affinity matchups, enemy-actor construction — rather than standing up a second
 * 950-line adapter that would drift from it.
 *
 * ACCEPTED CONSEQUENCE: the focus actor takes its own turns, so the defender casts at the attackers.
 * Its self-shields and self-buffs therefore fire on its own turn (correct), and a defender that
 * kills attackers reduces its own incoming pressure (real game behaviour). Measured EHP is
 * consequently not a pure-defence number.
 *
 * WHICH DEFENSIVE CHANNELS MOVE THE MEASURED NUMBER (measured, not assumed — see the channel test
 * in `__tests__/defenseSurvivabilitySim.test.ts` for the pinned figures). A caller wiring UI onto
 * this result must not promise more than the engine delivers:
 *   • REACHES IT: shield grants, name-keyed statuses (Barrier, Shield Converter — the latter only
 *     with a NUMERIC duration, `holdsShieldConverter` reads the timed channel only), and self-buffs
 *     carrying `parsedEffects.incomingDamage` ('Inc. Damage Down', the per-victim D-PR12 channel).
 *   • DOES NOT: a `modifier` ability on the 'incomingDamage' channel (no bucket in
 *     `modifierTotalsFromAbilities` — attacker-side folds only), and a defender's OWN
 *     `parsedEffects.defense` buff ('Defense Up'), because the applied per-victim read
 *     (`victimDefenseProfileOf`, engine.ts) takes the victim's BASE `stats.defence`. Both are
 *     pre-existing engine behaviour, identical through the older `selfBuffs` route — not something
 *     this boundary introduced, and not something it can paper over.
 */
export function simulateDefenseSurvivability(
    input: DefenseSimulationInput
): DefenseSurvivabilityResult {
    const healingResult = simulateHealing({
        healer: {
            hp: input.defender.hp,
            attack: input.defender.attack,
            defence: input.defender.defence,
            crit: input.defender.crit,
            critDamage: input.defender.critDamage,
            // Not on DefenderStats: a defender's own defence penetration only ever scales the
            // damage IT deals, which is incidental to the survivability question. `attack` above is
            // threaded through regardless, because a defender that kills an attacker really does
            // reduce its own incoming pressure (see ACCEPTED CONSEQUENCE above).
            defensePenetration: 0,
            healModifier: input.defender.healModifier,
            hacking: input.defender.hacking,
            speed: input.defender.speed,
        },
        chargeCount: input.chargeCount,
        startCharged: input.startCharged,
        shipSkills: input.shipSkills,
        selfBuffs: input.selfBuffs,
        // The defender IS the bombarded actor.
        healTargetId: 'healer',
        healTargetAffinity: input.affinity,
        healTargetSecurity: input.defender.security,
        healerRole: input.role,
        healerFaction: input.faction,
        teamActors: input.teamActors,
        enemies: input.enemies,
        rounds: input.rounds,
        healerPosition: input.position,
        healerTargeting: input.targeting,
        bus: input.bus,
    });

    const rounds: DefenseSurvivabilityRound[] = healingResult.rounds.map((r) => ({
        round: r.round,
        incomingDamage: r.incomingDamage,
        shieldAbsorbed: r.shieldAbsorbed,
        barrierAbsorbed: r.barrierAbsorbed,
        convertedToShield: r.convertedToShield,
        hpPct: r.targetHpPct,
        shieldPool: r.targetShieldPool,
    }));

    // GROSS. Not gross + absorbed — `incomingDamage` already contains the mitigation terms.
    const gross = rounds.reduce((sum, r) => sum + r.incomingDamage, 0);
    const toShield = rounds.reduce((sum, r) => sum + r.shieldAbsorbed, 0);
    const toBarrier = rounds.reduce((sum, r) => sum + r.barrierAbsorbed, 0);
    const toConversion = rounds.reduce((sum, r) => sum + r.convertedToShield, 0);

    const destroyedRound = healingResult.summary.destroyedRound;

    return {
        measuredEHP: gross,
        survived: destroyedRound === undefined,
        ...(destroyedRound !== undefined ? { destroyedRound } : {}),
        elapsedRounds: rounds.length,
        breakdown: {
            // Clamped at 0: the three mitigation terms are rounded independently upstream, so a
            // fully-absorbed round can round to a hair over gross.
            toHp: Math.max(0, gross - toShield - toBarrier - toConversion),
            toShield,
            toBarrier,
            toConversion,
            gross,
        },
        rounds,
    };
}
