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
    /** Σ incomingDamage. GROSS — already contains the three mitigation terms above; adding the
     *  others to it double-counts every point of mitigation.
     *  NOT THE HEADLINE. This is the POST-mitigation axis: what actually got through. The
     *  "Damage absorbed" headline is `damageAbsorbed`, which reads the RAW axis instead (#358
     *  addendum 3). This doc used to call `gross` "the measured-EHP figure", which was true for
     *  exactly one revision and is the reading addendum 3 retired the name over. `gross` earns its
     *  keep as the partition base for the four breakdown terms and as the LIVENESS probe in tests
     *  ("the reduction really applied") — never as the headline. */
    gross: number;
}

export interface DefenseSurvivabilityRound {
    round: number;
    incomingDamage: number;
    /** #358 ADDENDUM 2/3: raw damage THROWN at the defender this round — before defence mitigation
     *  AND before every other victim-side reduction (see `ActorIntake.incomingRaw` for the list). */
    incomingDamageRaw: number;
    shieldAbsorbed: number;
    barrierAbsorbed: number;
    convertedToShield: number;
    /** HP% ENTERING the round. */
    hpPct: number;
    /** Shield pool ENTERING the round. */
    shieldPool: number;
}

export interface DefenseSurvivabilityResult {
    /**
     * #358 ADDENDUM 2: Σ `incomingDamageRaw` over the ELAPSED rounds — the RAW damage THROWN at
     * the defender before its own defence mitigated any of it. The conventional meaning of
     * effective HP, and the same quantity the static formula estimates, so the two finally measure
     * the same thing and their disagreement is informative.
     *
     * IT WAS Σ `incomingDamage` (post-mitigation), and that INVERTED the ranking: a ship that dies
     * absorbs ≈ its HP no matter how tanky it is, and a ship that SURVIVES shows only the damage
     * that leaked through, so a tankier ship reported a SMALLER number while `isBest` ranks
     * highest-first. Measured on Isha: 1,408 against a static-formula 543,950 — not two estimates
     * disagreeing, two different quantities.
     *
     * ── TWO PROPERTIES A READER MUST NOT MISTAKE FOR BUGS ──────────────────────────────────────
     *
     * 1. ON A SURVIVOR THIS NUMBER IS DEFENCE-INDEPENDENT, and that is correct. Raw damage thrown
     *    is a property of the ATTACKERS, not of the defender; defence changes only how much of it
     *    lands. Over a fixed `rounds` window a survivor is hit the same number of times whatever
     *    its defence, so the figure is FLAT (measured: 60,000 at defence 0, 5k, 5k+30%, and 20k).
     *    It is a LOWER BOUND on durability, not a death threshold — the UI renders survivors
     *    distinctly for exactly this reason. Defence raises the number only by buying more ROUNDS,
     *    which is the casualty regime below.
     *
     * 2. IT IS QUANTISED BY THE ROUND. The metric only moves when the round of DEATH moves, so its
     *    quantum is one round of enemy throughput. Measured: defence 5,000 and defence 5,000 +30%
     *    both report exactly 300,000 because both die on round 5, even though the second really is
     *    tankier. That is inherent to a round-based simulation, not a defect, and it is why the
     *    owner's ruling pairs this figure with ROUNDS SURVIVED in the results block — the rounds
     *    display is REQUIRED, not decorative. The continuous counterpart is the static formula
     *    already shown beside it.
     */
    damageAbsorbed: number;
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
 * kills attackers reduces its own incoming pressure (real game behaviour). Damage absorbed is
 * consequently not a pure-defence number.
 *
 * WHICH DEFENSIVE CHANNELS MOVE THE MEASURED NUMBER (measured, not assumed — see the channel test
 * in `__tests__/defenseSurvivabilitySim.test.ts` for the pinned figures). A caller wiring UI onto
 * this result must not promise more than the engine delivers:
 *   • REACHES IT: shield grants, name-keyed statuses (Barrier, Shield Converter — the latter only
 *     with a NUMERIC duration, `holdsShieldConverter` reads the timed channel only), self-buffs
 *     carrying `parsedEffects.incomingDamage` ('Inc. Damage Down', the per-victim D-PR12 channel),
 *     and — since the addendum A2 fix — a defender's OWN `parsedEffects.defense` buff
 *     ('Defense Up'), which folds into the same per-victim `defenceModifierPct` channel as an
 *     enemy's Defense Shred. That channel is SIGN-AGNOSTIC (A5): a self-buff whose card text
 *     carries a defensive COST ('Overload', '-10% Defense' per stack) makes the measured number go
 *     UP, which is correct.
 *   • DOES NOT: a `modifier` ability on the 'incomingDamage' channel (no bucket in
 *     `modifierTotalsFromAbilities` — attacker-side folds only). Pre-existing engine behaviour,
 *     identical through the older `selfBuffs` route — not something this boundary introduced, and
 *     not something it can paper over.
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
        incomingDamageRaw: r.incomingDamageRaw,
        shieldAbsorbed: r.shieldAbsorbed,
        barrierAbsorbed: r.barrierAbsorbed,
        convertedToShield: r.convertedToShield,
        hpPct: r.targetHpPct,
        shieldPool: r.targetShieldPool,
    }));

    // GROSS. Not gross + absorbed — `incomingDamage` already contains the mitigation terms.
    const gross = rounds.reduce((sum, r) => sum + r.incomingDamage, 0);
    // #358 ADDENDUM 2/3: the RAW axis — pre defence mitigation and pre every other victim-side
    // reduction. Deliberately NOT `gross` — the breakdown's four terms partition `gross`, and
    // re-basing them on raw would break that.
    const grossRaw = rounds.reduce((sum, r) => sum + r.incomingDamageRaw, 0);
    const toShield = rounds.reduce((sum, r) => sum + r.shieldAbsorbed, 0);
    const toBarrier = rounds.reduce((sum, r) => sum + r.barrierAbsorbed, 0);
    const toConversion = rounds.reduce((sum, r) => sum + r.convertedToShield, 0);

    const destroyedRound = healingResult.summary.destroyedRound;

    return {
        damageAbsorbed: grossRaw,
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
