/**
 * Sokol's charged skill (game 3.23 text): "This Unit deals 150% damage and extends active debuffs
 * by 1 turn." Owner ruling: only the enemies the skill hits get their debuffs extended — every
 * debuff they currently carry, +1 turn; an enemy the skill does not hit is untouched.
 *
 * Board: a faster ally lands Defense Down II and Corrosion on BOTH enemies (pattern 'all'), then
 * Sokol fires his charged at one enemy (pattern 'base'). The CONTROL run strips the parsed
 * extension, so every difference is the extension's. Real parsed kit, real engine (runCombat).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import type { StatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';
import type { Ability } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const SOKOL_CHARGED =
    'This Unit deals <unit-damage>150% damage</unit-damage> and <unit-skill>extends active debuffs by 1 turn</unit-skill>.';

const HUGE_HP = 1_000_000_000;
const HACKING = 1_000_000;

const front = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

const sokolCharged = (withExtension: boolean): Ability[] => {
    const ship = {
        refits: [],
        chargeSkillText: SOKOL_CHARGED,
        chargeSkillCharge: 3,
    } as unknown as Ship;
    const charged = buildShipAbilities(ship).slots.find((s) => s.slot === 'charged');
    if (!charged?.abilities.some((a) => a.type === 'extend-status')) {
        throw new Error('Sokol charged did not parse an extend-status');
    }
    return charged.abilities.filter((a) => withExtension || a.type !== 'extend-status');
};

const defenseDown: Ability = {
    id: 'inflicter-dd',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Defense Down II',
        parsedEffects: { defense: -30 },
        stacks: 1,
        isStackable: false,
        duration: 2,
        application: 'inflict',
    },
};
const corrosion: Ability = {
    id: 'inflicter-cor',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 2 },
};

const ENEMY_IDS = ['e1', 'e2'] as const;

const board = (casterSide: 'player' | 'enemy', withExtension: boolean): CombatEngineInput => {
    const sokolSlots = {
        slots: [
            { slot: 'active' as const, abilities: [] },
            { slot: 'charged' as const, abilities: sokolCharged(withExtension) },
        ],
    };
    const inflicterSlots = {
        slots: [{ slot: 'active' as const, abilities: [defenseDown, corrosion] }],
    };

    const victimEnemy = (id: string, position: 'M4' | 'M3'): EnemyAttacker => ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    });
    const victimTeam = (id: string, position: 'M4' | 'M3'): TeamActorEngineInput => ({
        id,
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        role: 'ATTACKER',
        position,
        target: front(),
        pattern: basePattern(),
        walk: {
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: HUGE_HP,
            },
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    const common = {
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
    };

    if (casterSide === 'player') {
        const inflicter: TeamActorEngineInput = {
            id: 'inflicter',
            speed: 300,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            role: 'DEBUFFER',
            position: 'M3',
            target: front(),
            pattern: allPattern(),
            walk: {
                shipSkills: inflicterSlots,
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: HACKING,
                    defence: 0,
                    hp: HUGE_HP,
                },
                ...common,
                hasChargedSkill: false,
            },
        };
        return {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            chargeCount: 3,
            shipSkills: sokolSlots,
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            hasChargedSkill: true,
            startCharged: true,
            ...common,
            defence: 0,
            hp: HUGE_HP,
            speed: 100,
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M4',
            target: front(),
            pattern: basePattern(),
            teamActors: [inflicter],
            enemyAttackers: [victimEnemy('e1', 'M4'), victimEnemy('e2', 'M3')],
        };
    }

    // Enemy-side Sokol and inflicter; the player side holds the two victims.
    const sokolEnemy: EnemyAttacker = {
        id: 'sokol',
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 100 },
        chargeCount: 3,
        startCharged: true,
        position: 'M4',
        target: front(),
        pattern: basePattern(),
        shipSkills: sokolSlots,
    };
    const inflicterEnemy: EnemyAttacker = {
        id: 'inflicter',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: HUGE_HP,
            speed: 300,
            hacking: HACKING,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M3',
        target: front(),
        pattern: allPattern(),
        shipSkills: inflicterSlots,
    };
    return {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        hasChargedSkill: false,
        startCharged: false,
        ...common,
        defence: 0,
        hp: HUGE_HP,
        speed: 1,
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: front(),
        pattern: basePattern(),
        teamActors: [victimTeam('e2', 'M3')],
        enemyAttackers: [sokolEnemy, inflicterEnemy],
    };
};

interface VictimState {
    hp: number;
    debuff: number;
    dot: number;
}

/** Per victim at the end of round 1: whether Sokol's charged hit it, and its remaining Defense
 *  Down / Corrosion durations. */
const victimStates = (casterSide: 'player' | 'enemy', withExtension: boolean) => {
    const input = board(casterSide, withExtension);
    const victimIds = casterSide === 'player' ? [...ENEMY_IDS] : ['attacker', 'e2'];
    let engine: StatusEngine | undefined;
    let actors: CombatActor[] = [];
    runCombat({
        ...input,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
        __testTapActors: (a) => {
            actors = a;
        },
    });
    const out: Record<string, VictimState> = {};
    for (const id of victimIds) {
        const actor = actors.find((a) => a.id === id);
        const debuff = engine!
            .timedAbilityStatuses('enemy', undefined, id)
            .find((s) => s.active.buffName === 'Defense Down II')?.active.turnsRemaining;
        const dot = actor?.corrosionEntries[0]?.remainingRounds;
        if (!actor || typeof debuff !== 'number' || dot === undefined) {
            throw new Error(`the board did not land Defense Down and Corrosion on ${id}`);
        }
        out[id] = { hp: actor.currentHp, debuff, dot };
    }
    // Both victims take the same Corrosion ticks, so the one Sokol hit is the one with less HP.
    const [a, b] = victimIds;
    return {
        states: out,
        hitId: out[a].hp < out[b].hp ? a : out[b].hp < out[a].hp ? b : undefined,
        missedId: out[a].hp < out[b].hp ? b : out[b].hp < out[a].hp ? a : undefined,
    };
};

for (const side of ['player', 'enemy'] as const) {
    describe(`${side}-side Sokol charged extends the debuffs of the enemies it hits`, () => {
        it('the hit enemy gains +1 turn on every debuff; the enemy not hit is untouched', () => {
            const { states: control } = victimStates(side, false);
            const { states: run, hitId, missedId } = victimStates(side, true);
            // Instrument: the single-target charged hit exactly one of the two debuffed enemies.
            expect(hitId).toBeDefined();
            expect(missedId).toBeDefined();
            const hit = hitId as string;
            const missed = missedId as string;

            expect(run[hit].debuff).toBe(control[hit].debuff + 1);
            expect(run[hit].dot).toBe(control[hit].dot + 1);
            expect(run[missed].debuff).toBe(control[missed].debuff);
            expect(run[missed].dot).toBe(control[missed].dot);
        });
    });
}
