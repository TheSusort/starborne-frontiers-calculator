import { ShipSkills } from '../../types/abilities';
import { SelectedGameBuff, TeamActorInput } from '../../types/calculator';
import type { ActiveBuff } from '../combat/statusEngine';
import type { CombatEventBus } from '../combat/events';
import { runCombat } from '../combat/engine';
import { selectFiringSkill } from '../abilities/applyAbilities';
import { toDotAndPenModifiers } from './dpsBuffHelpers';
import { deriveTeamEngineActors } from './dpsSimulator';

export interface HealerStats {
    hp: number;
    attack: number;
    defence: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    healModifier: number;
    hacking: number;
    speed: number;
}

export interface EnemyAttackerInput {
    id: string;
    stats: { attack: number; crit: number; critDamage: number; speed: number };
    chargeCount: number;
    startCharged: boolean;
    /** Basics walk (damage abilities only). Absent → one basic attack per turn. */
    shipSkills?: ShipSkills;
}

export interface HealingSimulationInput {
    healer: HealerStats;
    chargeCount: number;
    startCharged?: boolean;
    shipSkills: ShipSkills;
    selfBuffs: SelectedGameBuff[];
    /** Which player actor the enemies bombard: 'healer' or a team actor id. */
    healTargetId: string;
    teamActors?: TeamActorInput[];
    enemies: EnemyAttackerInput[];
    rounds: number;
    /** Optional emit-only event tap (write-only listeners). */
    bus?: CombatEventBus;
}

export interface HealingRoundData {
    round: number;
    action: 'active' | 'charged';
    charges: number;
    chargeCount: number;
    didCrit: boolean;
    directHeal: number;
    hotHeal: number;
    shield: number;
    cleanseCount: number;
    effectiveHealing: number;
    overheal: number;
    incomingDamage: number;
    shieldAbsorbed: number;
    targetHpPct: number; // ENTERING the round
    targetShieldPool: number; // ENTERING the round
    totalRoundHealing: number; // directHeal + hotHeal (raw; shield separate)
    cumulativeHealing: number;
    teamHealing?: number; // non-focus actors' raw (direct+HoT) healing; only when team actors exist
    activeSelfBuffs: ActiveBuff[];
    extraTurns?: number;
}

export interface HealingSimulationResult {
    rounds: HealingRoundData[];
    summary: {
        totalHealing: number; // RAW (direct + HoT), focus actor
        totalDirectHeal: number;
        totalHotHeal: number;
        totalShield: number;
        totalCleanses: number;
        totalEffectiveHealing: number;
        totalOverheal: number;
        totalShieldAbsorbed: number;
        totalIncomingDamage: number;
        /** RAW healing / rounds — NOT effective. */
        avgHealingPerRound: number;
        destroyedRound?: number; // present only if the target died
        teamTotalHealing?: number;
    };
}

/** The engine's internal focus actor id. */
const FOCUS_ID = 'attacker';

/**
 * Thin adapter over the combat engine (`src/utils/combat/engine.ts`) running in HEALING
 * mode. Mirrors `simulateDPS`: it derives the engine's input from the public healing input —
 * the heal-target id mapping, the debuff landing chance (hacking vs a fixed dummy security),
 * the static defPen/dot self-buff fold, the charged-skill widening, and the per-team-actor
 * walk (shared `deriveTeamEngineActors`) — then calls `runCombat` and assembles the public
 * result from the additive `healing` block.
 *
 * Affinity is IGNORED this increment (healing ignores affinity): affinityDamageModifier 0,
 * affinityCritCap 100, affinityCritPenalty 0, and the team walk is derived with no enemy
 * affinity. The dummy enemy is a pure DoT carrier / player-offense target (enemySpeed 0 →
 * it acts last) — player offense vs it is irrelevant to healing output, but the cadence and
 * DoT machinery still run as in DPS mode.
 *
 * Rounding: every healing number is rounded with Math.round (mirroring RoundData's damage
 * rounding). Raws are accumulated UNROUNDED and rounded LAST — per-row summed buckets and the
 * cumulative/summary totals round once at the point of presentation, avoiding drift.
 */
export function simulateHealing(input: HealingSimulationInput): HealingSimulationResult {
    const {
        healer,
        chargeCount,
        shipSkills,
        selfBuffs,
        enemies,
        rounds: numRounds,
        teamActors,
    } = input;

    // Dummy-enemy defaults: a high-defence, huge-HP punching bag that never dies and acts last.
    const ENEMY_DEFENSE = 10000;
    const ENEMY_HP = 1_000_000;
    const ENEMY_SECURITY = 100;

    // Landing chance from the healer's hacking vs the dummy's security (no affinity this
    // increment): clamp(hacking − 100, 0, 100) / 100.
    const debuffLandingChance = Math.min(100, Math.max(0, healer.hacking - ENEMY_SECURITY)) / 100;

    // Self-side static folds (defPen / dot from self-buffs) — same discipline as simulateDPS.
    const { defensePenetrationBuff, dotDamageModifier: selfDotModifier } = toDotAndPenModifiers(
        selfBuffs,
        []
    );

    // hasChargedSkill widening: chargeCount >= 1 AND the charged slot carries ANY ability.
    const chargedSkill = selectFiringSkill(shipSkills, 'charged');
    const hasChargedSkill = chargeCount >= 1 && (chargedSkill?.abilities.length ?? 0) > 0;

    // Heal-target id mapping: 'healer' → the engine's focus id; otherwise pass through (must be
    // a team actor id — the engine throws on an unknown id, which we let propagate).
    const healTargetId = input.healTargetId === 'healer' ? FOCUS_ID : input.healTargetId;

    // Walked team actors via the shared helper (security 100, no enemy affinity — healing
    // ignores affinity this increment). healModifier IS threaded from CombatStatBlock.healModifier
    // (default 0 when absent), so walked team actors fold their own heal-modifier into heal casts.
    const engineTeamActors = deriveTeamEngineActors(teamActors, ENEMY_SECURITY, undefined);
    const hasTeamActors = !!teamActors && teamActors.length > 0;

    const { rounds: engineRounds, healing } = runCombat({
        attack: healer.attack,
        crit: healer.crit,
        critDamage: healer.critDamage,
        defensePenetration: healer.defensePenetration,
        chargeCount,
        shipSkills,
        enemyDefense: ENEMY_DEFENSE,
        enemyHp: ENEMY_HP,
        numRounds,
        selfBuffs,
        enemyDebuffs: [],
        debuffLandingChance,
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged: input.startCharged ?? false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: healer.defence,
        hp: healer.hp,
        speed: healer.speed,
        enemySpeed: 0,
        healModifier: healer.healModifier,
        healTargetId,
        enemyAttackers: enemies,
        teamActors: engineTeamActors,
        bus: input.bus,
    });

    // healing is always present (healTargetId is always set in this adapter), but guard anyway.
    const healingRounds = healing?.rounds ?? [];

    // Raw (unrounded) accumulators — rounded once at presentation (per row / summary).
    let cumulativeRaw = 0;
    let totalDirectRaw = 0;
    let totalHotRaw = 0;
    let totalShieldRaw = 0;
    let totalCleansesRaw = 0;
    let totalEffectiveRaw = 0;
    let totalOverhealRaw = 0;
    let totalShieldAbsorbedRaw = 0;
    let totalIncomingRaw = 0;
    let totalTeamRaw = 0;

    const rows: HealingRoundData[] = engineRounds.map((rd, i) => {
        const hr = healingRounds[i];
        const focus = hr?.perActor.get(FOCUS_ID);
        const directHealRaw = focus?.directHeal ?? 0;
        const hotHealRaw = focus?.hotHeal ?? 0;
        const shieldRaw = focus?.shield ?? 0;
        const cleanseRaw = focus?.cleanseCount ?? 0;
        const effectiveRaw = focus?.effectiveHeal ?? 0;
        const overhealRaw = focus?.overheal ?? 0;
        const incomingRaw = hr?.incomingDamage ?? 0;
        const shieldAbsorbedRaw = hr?.shieldAbsorbed ?? 0;

        // teamHealing = Σ non-focus entries' raw (direct + HoT). Team shield contributes to the
        // pool mechanically (the engine consumes it) but is NOT separately reported here.
        let teamRoundRaw = 0;
        if (hr) {
            for (const [id, h] of hr.perActor) {
                if (id === FOCUS_ID) continue;
                teamRoundRaw += h.directHeal + h.hotHeal;
            }
        }

        // Round the per-round raws AFTER summing (totalRoundHealing = directHeal + hotHeal raw,
        // rounded last). cumulativeRaw accumulates the unrounded direct+HoT raw, rounded per row.
        const totalRoundRaw = directHealRaw + hotHealRaw;
        cumulativeRaw += totalRoundRaw;

        totalDirectRaw += directHealRaw;
        totalHotRaw += hotHealRaw;
        totalShieldRaw += shieldRaw;
        totalCleansesRaw += cleanseRaw;
        totalEffectiveRaw += effectiveRaw;
        totalOverhealRaw += overhealRaw;
        totalShieldAbsorbedRaw += shieldAbsorbedRaw;
        totalIncomingRaw += incomingRaw;
        totalTeamRaw += teamRoundRaw;

        return {
            round: rd.round,
            action: rd.action,
            charges: rd.charges,
            chargeCount: rd.chargeCount,
            didCrit: rd.didCrit,
            directHeal: Math.round(directHealRaw),
            hotHeal: Math.round(hotHealRaw),
            shield: Math.round(shieldRaw),
            cleanseCount: Math.round(cleanseRaw),
            effectiveHealing: Math.round(effectiveRaw),
            overheal: Math.round(overhealRaw),
            incomingDamage: Math.round(incomingRaw),
            shieldAbsorbed: Math.round(shieldAbsorbedRaw),
            targetHpPct: Math.round(hr?.targetHpPctStart ?? 100),
            targetShieldPool: Math.round(hr?.targetShieldStart ?? 0),
            totalRoundHealing: Math.round(totalRoundRaw),
            cumulativeHealing: Math.round(cumulativeRaw),
            ...(hasTeamActors ? { teamHealing: Math.round(teamRoundRaw) } : {}),
            activeSelfBuffs: rd.activeSelfBuffs,
            ...(rd.extraTurns !== undefined ? { extraTurns: rd.extraTurns } : {}),
        };
    });

    return {
        rounds: rows,
        summary: {
            totalHealing: Math.round(totalDirectRaw + totalHotRaw),
            totalDirectHeal: Math.round(totalDirectRaw),
            totalHotHeal: Math.round(totalHotRaw),
            totalShield: Math.round(totalShieldRaw),
            totalCleanses: Math.round(totalCleansesRaw),
            totalEffectiveHealing: Math.round(totalEffectiveRaw),
            totalOverheal: Math.round(totalOverhealRaw),
            totalShieldAbsorbed: Math.round(totalShieldAbsorbedRaw),
            totalIncomingDamage: Math.round(totalIncomingRaw),
            avgHealingPerRound:
                numRounds > 0 ? Math.round((totalDirectRaw + totalHotRaw) / numRounds) : 0,
            ...(healing?.destroyedRound !== undefined
                ? { destroyedRound: healing.destroyedRound }
                : {}),
            ...(hasTeamActors ? { teamTotalHealing: Math.round(totalTeamRaw) } : {}),
        },
    };
}
