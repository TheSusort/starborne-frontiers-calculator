import type { Ship } from '../../../types/ship';
import type { Ability, AbilityConfig, AbilityType, Skill } from '../../../types/abilities';
import { LIVE_TRIGGERS } from '../../../types/abilities';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { PERSISTENT_STACKING_BUFFS } from '../../../constants/persistentStackingBuffs';
import type { InteractionClass } from './types';

const DETONATION_TYPES = new Set<AbilityType>(['detonate-dot', 'accumulate-detonate']);
const CLEANSE_PURGE_TYPES = new Set<AbilityType>(['cleanse', 'purge']);
const SHIELD_TYPES = new Set<AbilityType>(['shield', 'incoming-shield-grant']);

/** Reuses the engine's own reactive-listener boundary (src/types/abilities.ts) rather than
 *  hand-rolling a second list of "which triggers are reactive": LIVE_TRIGGERS is exactly the
 *  set the combat engine binds listeners for, i.e. every trigger other than the on-cast fold
 *  and the pre-combat one-shot annotation (which is deliberately excluded from LIVE_TRIGGERS
 *  because there is no combat event for it — see the doc comment on LIVE_TRIGGERS). */
function isReactive(ability: Ability): boolean {
    return LIVE_TRIGGERS.has(ability.trigger);
}

/** Buff/debuff names an ability grants, including 'buff' config's optional additionalBuffs
 *  (D-PR16 multi-grant). Empty for every other AbilityConfig variant. */
function grantedBuffNames(config: AbilityConfig): string[] {
    if (config.type === 'buff') {
        return [config.buffName, ...(config.additionalBuffs?.map((b) => b.buffName) ?? [])];
    }
    if (config.type === 'debuff') {
        return [config.buffName];
    }
    return [];
}

function isPersistentStacking(ability: Ability): boolean {
    return grantedBuffNames(ability.config).some((name) => PERSISTENT_STACKING_BUFFS.has(name));
}

/** The Protection damage-transfer mechanic (protectionTransfer.ts's protectionStacks) is keyed
 *  entirely on the literal buff name "Protection" — the same signal used at runtime, so this
 *  predicate stays in sync with the engine's own recognition of the mechanic. */
function isProtectionRedirect(ability: Ability): boolean {
    return ability.config.type === 'buff' && ability.config.buffName === 'Protection';
}

function grantsStealthBuff(ability: Ability): boolean {
    return grantedBuffNames(ability.config).includes('Stealth');
}

/** Per-cast stealth-targeting bypass (Rhodium/Selenite): a 'damage' config's own ignoresStealth
 *  flag, distinct from the ship-level ShipSkills.ignoresStealth (Lodolite, checked separately). */
function ignoresStealthPerCast(ability: Ability): boolean {
    return ability.config.type === 'damage' && ability.config.ignoresStealth === true;
}

/** Best-effort leader-aura signal: an always-on team-wide stat/damage modifier sourced from a
 *  PASSIVE skill (parseModifiers emits `target: 'all-allies'` only for "friendly/allies/all
 *  allies"-scoped phrasing, e.g. Lodolite's "all allies deal 15% more direct damage to enemies
 *  with Concentrate Fire or Stealth"). Restricted to the passive slot so a one-off all-allies
 *  buff a ship casts on its OWN active/charged turn doesn't count as an "aura" — an aura is
 *  meant to read as always-active team-wide pressure, which only the passive slot expresses
 *  here. NOTE: this does NOT see faction squad-leader auras — those are applied by a separate
 *  pre-fight pass (squadLeaderPass) that never touches ShipSkills, so a ship whose ONLY
 *  leader-aura-like effect is its squad-leader role will not be tagged. See the report for this
 *  limitation. */
function isLeaderAuraSkill(skill: Skill): boolean {
    if (skill.slot !== 'passive') return false;
    return skill.abilities.some((a) => a.type === 'modifier' && a.target === 'all-allies');
}

export function tagShip(ship: Ship): Set<InteractionClass> {
    const tags = new Set<InteractionClass>();
    const shipSkills = buildShipAbilities(ship);

    if (shipSkills.ignoresStealth) tags.add('stealth');

    for (const skill of shipSkills.slots) {
        if (isLeaderAuraSkill(skill)) tags.add('leader-aura');

        for (const ability of skill.abilities) {
            if (DETONATION_TYPES.has(ability.type)) tags.add('detonation-bomb');
            if (ability.type === 'control') tags.add('control');
            if (CLEANSE_PURGE_TYPES.has(ability.type)) tags.add('cleanse-purge');
            if (SHIELD_TYPES.has(ability.type)) tags.add('shield');
            if (isReactive(ability)) tags.add('reactive-trigger');
            if (isPersistentStacking(ability)) tags.add('persistent-stacking');
            if (isProtectionRedirect(ability)) tags.add('protection-redirect');
            if (ignoresStealthPerCast(ability) || grantsStealthBuff(ability)) tags.add('stealth');
        }
    }

    return tags;
}
