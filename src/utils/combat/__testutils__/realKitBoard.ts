/**
 * A two-sided board for real-kit status tests: a CARRIER (whose kit is under test) with its
 * allies against a set of opponents, built so the same scenario runs with the carrier on the
 * PLAYER side or on the ENEMY side. A status fix is team-symmetric only if both placements read
 * the same numbers.
 *
 * Every unit names its own id; `boardInput` maps them onto the engine's roster shape:
 *  - player placement: carrier = the focus actor, allies = walked team actors, opponents = enemy
 *    attackers;
 *  - enemy placement: carrier + allies = enemy attackers, opponents[0] = the focus actor, the rest
 *    = walked team actors.
 * The focus actor always runs under `FOCUS_ID`, so read ids through the returned `id(unit)`.
 */
import type { CombatEngineInput } from '../engine';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import {
    parsePattern,
    parseTarget,
    type ParsedPattern,
    type ParsedTarget,
} from '../../targetingParser';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';

export type Placement = 'player' | 'enemy';
export const FOCUS_ID = 'attacker';

export interface BoardUnit {
    id: string;
    kit: ShipSkills;
    position: Position;
    speed: number;
    attack?: number;
    defence?: number;
    hp?: number;
    hacking?: number;
    security?: number;
    crit?: number;
    critDamage?: number;
    chargeCount?: number;
    startCharged?: boolean;
    pattern?: ParsedPattern;
    target?: ParsedTarget;
}

export const NO_KIT: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

/** A plain single-target damage active (`multiplier`%, `hits` hits), so a unit can be made to
 *  hit someone. */
export const hitKit = (multiplier = 100, hits = 1): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'test-hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier, ...(hits > 1 ? { hits } : {}) },
                },
            ],
        },
    ],
});

/** The real parsed kit of `ship` (refit 4, every slot). Throws when the reference data is absent
 *  so a missing-data worktree fails loudly instead of running an empty kit. */
export const realKit = (ship: string): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data (docs/ is gitignored)`);
    return buildShipAbilities(built);
};

export function boardInput(
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    numRounds: number
): { input: CombatEngineInput; id: (unit: BoardUnit) => string } {
    const [focus, ...focusTeam] = placement === 'player' ? [carrier, ...allies] : opponents;
    const enemies = placement === 'player' ? opponents : [carrier, ...allies];
    const pattern = (u: BoardUnit) => u.pattern ?? parsePattern('Pattern-Base');
    const target = (u: BoardUnit) => u.target ?? parseTarget('front');
    const id = (u: BoardUnit) => (u === focus ? FOCUS_ID : u.id);
    // A kit's Stasis exemptions ride the actor, not the slots — thread them as battleSimulator does.
    const stasisFlags = (u: BoardUnit) => ({
        doesntBreakStasis: u.kit.doesntBreakStasis,
        stasisBreakExemptWhen: u.kit.stasisBreakExemptWhen,
    });
    const input: CombatEngineInput = {
        attack: focus.attack ?? 0,
        crit: focus.crit ?? 0,
        critDamage: focus.critDamage ?? 0,
        defensePenetration: 0,
        chargeCount: focus.chargeCount ?? 0,
        startCharged: focus.startCharged ?? false,
        hasChargedSkill: focus.kit.slots.some((s) => s.slot === 'charged'),
        shipSkills: focus.kit,
        numRounds,
        ...stasisFlags(focus),
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: focus.defence ?? 0,
        hp: focus.hp ?? 1e9,
        hacking: focus.hacking ?? 0,
        security: focus.security ?? 0,
        speed: focus.speed,
        mode: 'battle',
        position: focus.position,
        target: target(focus),
        pattern: pattern(focus),
        teamActors: focusTeam.map((u) => ({
            id: u.id,
            ...stasisFlags(u),
            speed: u.speed,
            chargeCount: u.chargeCount ?? 0,
            startCharged: u.startCharged ?? false,
            selfBuffs: [],
            enemyDebuffs: [],
            position: u.position,
            target: target(u),
            pattern: pattern(u),
            walk: {
                shipSkills: u.kit,
                stats: {
                    attack: u.attack ?? 0,
                    crit: u.crit ?? 0,
                    critDamage: u.critDamage ?? 0,
                    defensePenetration: 0,
                    hacking: u.hacking ?? 0,
                    security: u.security ?? 0,
                    defence: u.defence ?? 0,
                    hp: u.hp ?? 1e9,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: u.kit.slots.some((s) => s.slot === 'charged'),
            },
        })),
        enemyAttackers: enemies.map((u) => ({
            id: u.id,
            ...stasisFlags(u),
            stats: {
                attack: u.attack ?? 0,
                crit: u.crit ?? 0,
                critDamage: u.critDamage ?? 0,
                speed: u.speed,
                defence: u.defence ?? 0,
                hp: u.hp ?? 1e9,
                hacking: u.hacking ?? 0,
                security: u.security ?? 0,
            },
            chargeCount: u.chargeCount ?? 0,
            startCharged: u.startCharged ?? false,
            position: u.position,
            target: target(u),
            pattern: pattern(u),
            shipSkills: u.kit,
        })),
    };
    return { input, id };
}
