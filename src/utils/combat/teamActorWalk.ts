import type { CombatStatBlock } from '../../types/calculator';
import { buildEmptyShipSkills } from '../abilities/configToSimInputs';
import type { TeamActorEngineInput } from './engine';

// Neutral stats for a synthesized buff-only walk. hp 1 / defence 0 match the engine's prior
// buff-only defaults (the `t.walk ? … : 1` / `: 0` ternaries); hacking 200 reproduces the old
// static landing default (vs security-default 100 → landing 1.0). The empty kit deals no damage,
// so attack/crit/critDamage/defensePenetration are inert at 0.
const NEUTRAL_WALK_STATS: CombatStatBlock = {
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    hacking: 200,
    defence: 0,
    hp: 1,
};

/**
 * Synthesize an empty-kit `walk` bundle for a team actor that arrived without one (the buff-only
 * format). The walked path then handles it uniformly: zero damage, manual selfBuffs/enemyDebuffs
 * applied via teamSources + sourceFired, charge cadence reproduced via hasChargedSkill = chargeCount > 0.
 */
export function synthesizeBuffOnlyWalk(actor: TeamActorEngineInput): TeamActorEngineInput {
    return {
        ...actor,
        walk: {
            shipSkills: buildEmptyShipSkills(),
            stats: { ...NEUTRAL_WALK_STATS },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: actor.chargeCount > 0,
            healModifier: 0,
            affinity: undefined,
        },
    };
}

/** Normalize a team roster so EVERY actor has a `walk` bundle (the legacy non-walked-team path is gone). */
export function normalizeTeamActorsToWalked(
    actors: TeamActorEngineInput[]
): TeamActorEngineInput[] {
    return actors.map((a) => (a.walk ? a : synthesizeBuffOnlyWalk(a)));
}
