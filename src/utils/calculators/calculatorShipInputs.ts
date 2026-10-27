import type { Ship, AffinityName } from '../../types/ship';
import type { DPSShipConfig, EnemyShipConfig } from '../../types/calculator';
import type { EnemyAttackerConfig } from '../../components/calculator/EnemyAttackersPanel';
import { asFactionName } from '../../constants/factions';
import { buildShipAbilitiesWithEquipment } from '../abilities/buildShipAbilitiesWithEquipment';
import { buildDefaultShipSkills } from '../abilities/configToSimInputs';
import { detectFullyCharged } from '../skillTextParser';
import { combatStatsFromShip, shipFinalStats, type CombatStatsDeps } from '../ship/combatStats';
import { buildSkillBuffAutoFill } from './skillBuffAutoFill';
import { targetingOf } from './shipTargeting';
import { defaultEnemyStats, detectShipCharged } from './rosterHelpers';
import type { EnemyAttackerInput } from './healingEngineAdapter';

/**
 * What each calculator page derives from a picked ship, and the opponent each page starts with.
 * The pages build their configs through these, and the arcade's races build each ship's inputs
 * through them too, so a race scores a ship the way its calculator page would.
 */

type FinalStats = ReturnType<typeof shipFinalStats>;

/** The DPS page's attacker config for `ship`, without its `id` and ally charge. */
export const dpsConfigFromShip = (
    ship: Ship,
    deps: CombatStatsDeps
): Omit<DPSShipConfig, 'id' | 'allyChargePerRound'> => {
    // healModifier is not part of DPSShipConfig (an attacker config).
    const { healModifier: _healModifier, ...stats } = combatStatsFromShip(
        shipFinalStats(ship, deps)
    );
    return {
        shipId: ship.id,
        name: ship.name,
        ...stats,
        // Reset (not carried over) when the ship has no charge metadata.
        chargeCount: ship.chargeSkillCharge ?? 0,
        startCharged: detectFullyCharged([
            ship.activeSkillText,
            ship.chargeSkillText,
            ship.firstPassiveSkillText,
            ship.secondPassiveSkillText,
            ship.thirdPassiveSkillText,
        ]),
        affinity: ship.affinity,
        // #363: the ship's faction, for faction-scoped ally grants.
        faction: asFactionName(ship.faction),
        shipSkills: buildShipAbilitiesWithEquipment(ship, deps.getGearPiece),
    };
};

/** The DPS page's enemy affinity before the user picks one. */
export const DEFAULT_DPS_ENEMY_AFFINITY: AffinityName = 'antimatter';

/** The DPS page's opponent before the user changes it: a real ship that takes turns. Attack is 0
 *  so a DPS comparison measures output only — the attacker cannot be worn down or killed, and
 *  every config faces identical conditions. A 0-attack enemy emits no `attacked` events, so
 *  on-attacked, counter and reflect reactions do not fire against it. */
export const defaultDpsEnemyConfig = (): EnemyShipConfig => ({
    name: 'Enemy',
    hp: 500000,
    defense: 10000,
    security: 100,
    speed: 50,
    attack: 0,
    crit: 0,
    critDamage: 150,
    hacking: 200,
    defensePenetration: 0,
    shieldPenetration: 0,
    healModifier: 0,
    shipSkills: buildDefaultShipSkills(),
});

/** The healing page's healer stats from a ship's resolved final stats. */
export const healerStatsFromShip = (final: FinalStats) => ({
    hp: Math.round(final.hp ?? 0),
    attack: Math.round(final.attack ?? 0),
    defence: Math.round(final.defence ?? 0),
    crit: Math.round(final.crit ?? 0),
    critDamage: Math.round(final.critDamage ?? 0),
    healModifier: Math.round(final.healModifier ?? 0),
    speed: Math.round(final.speed ?? 100),
    hacking: Math.round(final.hacking ?? 200),
    security: Math.round(final.security ?? 0),
});

/** Engine stats + kit for a defence-page defender built from a real ship.
 *
 *  The auto-filled kit `buffs` are part of this shape on purpose (#414): the URL-arrived defender
 *  and the picked one must give the same Theoretical EHP. The picker overrides `buffs` after the
 *  spread to merge them with whatever the user added by hand. */
export const defenderFieldsFromShip = (
    ship: Ship,
    final: FinalStats,
    getGearPiece: Parameters<typeof buildShipAbilitiesWithEquipment>[1]
) => ({
    shipId: ship.id,
    name: ship.name,
    hp: Math.round(final.hp),
    defense: Math.round(final.defence),
    security: Math.round(final.security ?? 0),
    attack: Math.round(final.attack ?? 0),
    crit: Math.round(final.crit ?? 0),
    critDamage: Math.round(final.critDamage ?? 0),
    // Not `?? 0` for these two: a speed-0 defender never takes a turn, so its self-shields and
    // self-buffs never fire; hacking 0 would misreport its own outbound landing. Same fallbacks
    // as `healerStatsFromShip`.
    speed: Math.round(final.speed ?? 100),
    hacking: Math.round(final.hacking ?? 200),
    healModifier: Math.round(final.healModifier ?? 0),
    chargeCount: ship.chargeSkillCharge ?? 0,
    startCharged: detectShipCharged(ship),
    shipSkills: buildShipAbilitiesWithEquipment(ship, getGearPiece),
    affinity: ship.affinity,
    role: ship.type,
    faction: asFactionName(ship.faction),
    // Player-side kit grants only — `enemyDebuffs` belong to the enemy roster, not the defender.
    buffs: buildSkillBuffAutoFill(ship).selfBuffs,
});

/** The enemy attacker the healing page starts with, and the one the defence page adds first. */
export const defaultEnemyAttacker = (): EnemyAttackerConfig => ({
    id: '1',
    name: 'Enemy 1',
    ...defaultEnemyStats(0),
});

/** An enemy attacker card as the healing and defence simulations take it. `enemyShip` is the
 *  ship the card was filled from, if any. */
export function enemyAttackerInput(e: EnemyAttackerConfig, enemyShip?: Ship): EnemyAttackerInput {
    // The enemy's own parsed targeting, so an AoE attacker hits its real footprint. Undefined for
    // a manual enemy (or an unparseable kit); the adapter's front/base fallback then applies.
    const targeting = targetingOf(enemyShip);
    return {
        id: e.id,
        // #363: this enemy's own faction, for faction-scoped grants on the enemy side.
        faction: asFactionName(enemyShip?.faction),
        stats: {
            attack: e.attack,
            crit: e.crit,
            critDamage: e.critDamage,
            speed: e.speed,
            // The enemy's own numbers: its defence is the basis for damage-dealt riders, its HP
            // decides whether it can be destroyed, and its security resists the player's debuffs.
            hp: e.hp,
            defence: e.defence,
            security: e.security,
            defensePenetration: e.defensePenetration,
            shieldPenetration: e.shieldPenetration,
            healModifier: e.healModifier,
            hacking: e.hacking,
            // `Required`: a stat the input gains fails `tsc` until it is forwarded.
        } satisfies Required<EnemyAttackerInput['stats']>,
        role: enemyShip?.type,
        name: enemyShip?.name,
        chargeCount: e.chargeCount,
        startCharged: e.startCharged,
        shipSkills: e.shipSkills,
        affinity: e.affinity,
        position: e.position,
        target: targeting?.active?.target,
        pattern: targeting?.active?.pattern,
        chargedTarget: targeting?.charged?.target,
        chargedPattern: targeting?.charged?.pattern,
    };
}
