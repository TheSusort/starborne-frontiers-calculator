/**
 * A two-sided battle board built from plain ship specs, mountable with either team as the PLAYER
 * side. `mirrorBoard(specs, 'player')` puts the `caster` team on the player side (its first ship
 * is the focus, id `'attacker'`) and the `other` team on the enemy side; `'enemy'` swaps them. Every
 * other ship keeps the id its spec names, so one assertion reads the same on both mounts once it
 * maps the focus through `idOf`.
 *
 * `realSlots` reads a ship's real parsed kit (buildTraceShip on docs/ship-skills.csv, refit 4) and
 * throws when the reference data is missing, so a missing-data worktree fails instead of passing
 * vacuously.
 */
import { CombatEngineInput } from '../../engine';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../../targetingParser';
import type { ShipSkills } from '../../../../types/abilities';
import type { Position } from '../../../../types/encounters';
import type { ShipTypeName } from '../../../../constants/shipTypes';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
export type SlotName = 'active' | 'charged' | 'passive';
type SkillSlot = ShipSkills['slots'][number];

/** `ship`'s real parsed slots, in the order asked for. */
export const realSlots = (ship: string, slots: SlotName[]): SkillSlot[] => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data (docs/ship-data.json)`);
    const all = buildShipAbilities(built).slots;
    return slots.map((name) => {
        const found = all.find((s) => s.slot === name);
        if (!found) throw new Error(`${ship} has no ${name} slot`);
        return found;
    });
};

export const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

export interface ShipSpec {
    /** Ignored for the player focus, which is always `'attacker'`. */
    id: string;
    position: Position;
    skills?: ShipSkills;
    role?: ShipTypeName;
    pattern?: string;
    chargedPattern?: string;
    attack?: number;
    hp?: number;
    speed?: number;
    crit?: number;
    critDamage?: number;
    hacking?: number;
    security?: number;
    defence?: number;
    chargeCount?: number;
    startCharged?: boolean;
    hasChargedSkill?: boolean;
}

export interface MirrorTeams {
    caster: ShipSpec[];
    other: ShipSpec[];
    numRounds?: number;
}

export interface Mounted {
    input: CombatEngineInput;
    /** The engine id of the ship whose spec named `specId`. */
    idOf: (specId: string) => string;
}

const enemyFrom = (s: ShipSpec): EnemyAttacker => ({
    id: s.id,
    stats: {
        attack: s.attack ?? 0,
        crit: s.crit ?? 0,
        critDamage: s.critDamage ?? 0,
        defence: s.defence ?? 0,
        hp: s.hp ?? 1e9,
        speed: s.speed ?? 100,
        hacking: s.hacking ?? 0,
        security: s.security ?? 0,
    },
    chargeCount: s.chargeCount ?? 0,
    startCharged: s.startCharged ?? false,
    position: s.position,
    target: parseTarget('front'),
    pattern: parsePattern(s.pattern ?? 'Pattern-Base'),
    ...(s.chargedPattern ? { chargedPattern: parsePattern(s.chargedPattern) } : {}),
    shipSkills: s.skills ?? NO_SKILLS,
    ...(s.role ? { role: s.role } : {}),
});

const teamFrom = (s: ShipSpec): TeamActor => ({
    id: s.id,
    speed: s.speed ?? 100,
    chargeCount: s.chargeCount ?? 0,
    startCharged: s.startCharged ?? false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: s.position,
    target: parseTarget('front'),
    pattern: parsePattern(s.pattern ?? 'Pattern-Base'),
    ...(s.chargedPattern ? { chargedPattern: parsePattern(s.chargedPattern) } : {}),
    ...(s.role ? { role: s.role } : {}),
    walk: {
        shipSkills: s.skills ?? NO_SKILLS,
        stats: {
            attack: s.attack ?? 0,
            crit: s.crit ?? 0,
            critDamage: s.critDamage ?? 0,
            defensePenetration: 0,
            hacking: s.hacking ?? 0,
            security: s.security ?? 0,
            defence: s.defence ?? 0,
            hp: s.hp ?? 1e9,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: s.hasChargedSkill ?? (s.chargeCount ?? 0) > 0,
    },
});

/** Mounts `teams` with the caster team on `side`. */
export const mirrorBoard = (teams: MirrorTeams, side: 'player' | 'enemy'): Mounted => {
    const [focus, ...allies] = side === 'player' ? teams.caster : teams.other;
    const enemies = side === 'player' ? teams.other : teams.caster;
    if (!focus) throw new Error('the player side needs at least one ship');
    const input: CombatEngineInput = {
        attack: focus.attack ?? 0,
        crit: focus.crit ?? 0,
        critDamage: focus.critDamage ?? 0,
        defensePenetration: 0,
        chargeCount: focus.chargeCount ?? 0,
        shipSkills: focus.skills ?? NO_SKILLS,
        numRounds: teams.numRounds ?? 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: focus.hasChargedSkill ?? (focus.chargeCount ?? 0) > 0,
        startCharged: focus.startCharged ?? false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: focus.defence ?? 0,
        hp: focus.hp ?? 1e9,
        hacking: focus.hacking ?? 0,
        security: focus.security ?? 0,
        mode: 'battle',
        position: focus.position,
        target: parseTarget('front'),
        pattern: parsePattern(focus.pattern ?? 'Pattern-Base'),
        ...(focus.chargedPattern ? { chargedPattern: parsePattern(focus.chargedPattern) } : {}),
        speed: focus.speed ?? 100,
        ...(focus.role ? { role: focus.role } : {}),
        teamActors: allies.map(teamFrom),
        enemyAttackers: enemies.map(enemyFrom),
    };
    return { input, idOf: (specId) => (specId === focus.id ? 'attacker' : specId) };
};
