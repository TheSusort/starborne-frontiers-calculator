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
 * ── WHICH CHANNELS MOVE WHICH NUMBER ─────────────────────────────────────────────────────────
 * (measured, not assumed — see the per-channel direction test in
 * `__tests__/defenseSurvivabilitySim.test.ts` for the pinned figures.) A caller wiring UI onto this
 * result must not promise more than the engine delivers — and there are now TWO axes to promise
 * about, so this note says which list belongs to which. This header used to carry ONE list, headed
 * "which defensive channels move the measured number", and every item on it was a victim-side
 * REDUCTION: as of addendum 3 those are stripped from the headline by construction, so the list had
 * silently become a description of `breakdown.gross` while still sitting above `damageAbsorbed`.
 *
 *   • `damageAbsorbed` (THE HEADLINE — the raw axis, "everything thrown at the ship"). A
 *     victim-side reduction MOVES NOTHING HERE, by construction and by ruling: defence mitigation,
 *     the defender's own `Inc. Damage Down` family, `preFightIncoming`, `equipReductionPct`,
 *     `incomingDotReductionPct` (Vortex Veil), the incoming-block proc and the reflect channel's
 *     own incoming-reduction are all excluded. What DOES move it:
 *       – SURVIVING ONE MORE INCOMING HIT. The figure grows one whole HIT at a time — never by the
 *         amount a reduction shaves off each hit — so any defensive channel that buys a hit raises
 *         it, and that is the only route by which the ship's own toughness reaches this number.
 *         READ THE RESOLUTION AS A HIT, NOT A ROUND. With ONE attacker the two are the same event
 *         (its round IS one hit), which is why every `sweep` fixture in the sim test reads as "buys
 *         a round". With SEVERAL attackers a round is several hits and the resolution is finer: the
 *         fight ends with the turn that destroys the ship (#329), so a reduction that carries the
 *         ship through attacker 1's hit buys it attacker 2's hit as well, on the SAME round of
 *         death. MEASURED (hp 100,000, defence 5,000, two 40,000-attack attackers at speeds 60/50
 *         — the same 80,000 raw per round one 80,000-attack enemy throws):
 *             plain ................. destroyed round 4, absorbed 280,000  (7 hits)
 *             + `Defense Up II` ..... destroyed round 4, absorbed 320,000  (8 hits)
 *         and the single-attacker control ties both at 320,000. This header, the card comment, the
 *         in-app docs and the changelog all once claimed "two ships that die on the same round
 *         report the same figure"; that was generalised from the one-attacker fixture and is FALSE.
 *         Pinned as "SAME ROUND, DIFFERENT FIGURE" in `defenseSurvivabilitySim.test.ts`.
 *       – ATTACKER-SIDE terms, because the attack is counted AS THROWN: `effectiveAttack`, outgoing
 *         modifiers, crit, affinity, and enemy-APPLIED amplification (`Out. Damage Up`, `Exposed`).
 *         READ THAT NARROWLY: it means terms the ATTACKER carries. MEASURED (4-round survivor
 *         window, defence 0, one 10,000-attack enemy — pinned in the sim test as "a
 *         DEFENDER-APPLIED outgoing debuff does NOT move the headline"):
 *             plain ............................................. 40,000
 *             enemy SELF-applies `Out. Damage Down` −50% ......... 20,000  ← the fold is live
 *             DEFENDER applies `Out. Damage Down` −50% .......... 40,000  ← unmoved
 *             DEFENDER applies `Attack Down` −50% / −90% ........ 40,000  ← unmoved
 *         So a defender that suppresses its attacker does NOT lower its own headline. This header
 *         used to claim the opposite, citing Opal's `Attack Down II` and Warden's `Out. Damage Down
 *         II` — verified from `docs/ship-skills.csv` that those ships HAVE those passives, never
 *         measured whether the engine folds them into the attacker's outgoing damage. It does not.
 *         Whether it SHOULD is an open question and is not settled here.
 *       – NOT an ally's Protection redirect: the redirected slice is booked in FULL on the
 *         protector's own raw axis (addendum 4 — a REASSIGNMENT, not a reduction). It therefore
 *         lowers the protected ship's figure, and that ruling is LOCKED. Do not "fix" it.
 *         MEASURED: 40,000 alone, 40,000 with a 0-stack ally (control), 28,000 at 30%, 20,000 at
 *         50%, all over the same rounds.
 *       – THE DEFENDER'S OWN OFFENCE, downward, and this is the one route by which a stronger ship
 *         reports LESS. It has two shapes, both measured:
 *           · ending the fight — a wiped enemy roster terminates the run (#329), so a window that
 *             was going to throw more simply stops. 6-round window, 10,000/round: attack 0 →
 *             60,000 over 6 rounds; attack 20,000 → 40,000 over 5; attack 200,000 → 0 over 1.
 *           · attrition INSIDE a fully-survived window — killing SOME attackers thins the volley
 *             without ending anything. Two 5,000-attack enemies, 6 rounds, all runs survived 6/6:
 *             attack 0 → 60,000; attack 20,000 → 40,000; attack 60,000 → 30,000. This is why the
 *             `DEFENDER` fixture in the sim test sets `attack: 0`, and why "two full-window
 *             survivors tie" holds only when NEITHER of them kills an attacker.
 *
 *   • `breakdown.gross` (the POST-mitigation axis — what actually arrived). This is the list that
 *     used to head this module:
 *       – REACHES IT: shield grants, name-keyed statuses (Barrier, Shield Converter — the latter
 *         only with a NUMERIC duration, `holdsShieldConverter` reads the timed channel only),
 *         self-buffs carrying `parsedEffects.incomingDamage` ('Inc. Damage Down', the per-victim
 *         D-PR12 channel), and — since the addendum A2 fix — a defender's OWN
 *         `parsedEffects.defense` buff ('Defense Up'), which folds into the same per-victim
 *         `defenceModifierPct` channel as an enemy's Defense Shred. That channel is SIGN-AGNOSTIC
 *         (A5): a self-buff whose card text carries a defensive COST ('Overload', '-10% Defense'
 *         per stack) makes `gross` go UP, which is correct. NOTE ON DIRECTION — the header this
 *         replaces claimed Overload made "the measured number" go up; on the HEADLINE the sign is
 *         the OTHER way, because less defence means the ship dies SOONER, so FEWER rounds are
 *         thrown at it and `damageAbsorbed` goes DOWN.
 *       – DOES NOT: a `modifier` ability on the 'incomingDamage' channel (no bucket in
 *         `modifierTotalsFromAbilities` — attacker-side folds only). Pre-existing engine behaviour,
 *         identical through the older `selfBuffs` route — not something this boundary introduced,
 *         and not something it can paper over.
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
