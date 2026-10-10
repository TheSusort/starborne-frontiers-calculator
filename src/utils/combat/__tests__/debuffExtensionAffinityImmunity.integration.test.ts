/**
 * Debuff duration extension skips an enemy with affinity advantage over the caster.
 *
 * Glossary, `Debuff Duration Extension`: "Increase Duration of a Specified number of debuffs. Does
 * not require Hacking. Affinity Adv units are immune" — the same rule Charge Manipulation carries
 * ("Does not affect enemies with affinity advantage over the applying unit"), which the engine
 * already honours in `removeChargesFrom`. A DoT is a debuff, so DoT extensions follow it too.
 *
 * The four extension seams, each with the shape of its corpus users (gates dropped — the axis here
 * is the affinity immunity, not the crit):
 *   - extend-status, every debuff on every hit enemy (Lev's charged);
 *   - extend-status, only what this cast inflicted (Asphyxiator's passive);
 *   - extend-dot, every DoT on every hit enemy (Provider's charged);
 *   - extend-dot, only the DoT this cast inflicted (Valerian / Wisteria, crit-power chance at 100%).
 *
 * E is electric. A thermal caster is at affinity DISADVANTAGE against E (E is immune); an
 * antimatter caster is neutral. A CONTROL run carries no extension at all.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import type { StatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { AffinityName } from '../../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const HUGE_HP = 1_000_000_000;
const HACKING = 1_000_000;

const front = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const ab = (id: string, rest: Pick<Ability, 'type' | 'target' | 'config'>): Ability => ({
    id,
    trigger: 'on-cast',
    conditions: [],
    ...rest,
});

const defenseDown = (id: string): Ability =>
    ab(id, {
        type: 'debuff',
        target: 'enemy',
        config: {
            type: 'debuff',
            buffName: 'Defense Down II',
            parsedEffects: { defense: -30 },
            stacks: 1,
            isStackable: false,
            duration: 2,
            application: 'inflict',
        },
    });

const corrosion = (id: string): Ability =>
    ab(id, {
        type: 'dot',
        target: 'enemy',
        config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 2 },
    });

const EXTENSIONS = {
    'extend-status, every debuff (Lev)': ab('ext', {
        type: 'extend-status',
        target: 'all-enemies',
        config: { type: 'extend-status', statusKind: 'debuff', turns: 1 },
    }),
    'extend-status, inflicted only (Asphyxiator)': ab('ext', {
        type: 'extend-status',
        target: 'all-enemies',
        config: { type: 'extend-status', statusKind: 'debuff', turns: 1, scope: 'inflicted' },
    }),
    'extend-dot, every DoT (Provider)': ab('ext', {
        type: 'extend-dot',
        target: 'all-enemies',
        config: { type: 'extend-dot', turns: 1 },
    }),
    'extend-dot, inflicted only (Valerian)': ab('ext', {
        type: 'extend-dot',
        target: 'enemy',
        config: { type: 'extend-dot', turns: 1, chanceFromCritPower: true, scope: 'inflicted' },
    }),
} as const;

type ExtensionName = keyof typeof EXTENSIONS;
const inflictedScope = (name: ExtensionName): boolean => name.includes('inflicted only');

interface Ship {
    id: string;
    speed: number;
    affinity: AffinityName;
    skills: ShipSkills;
    position: 'M4' | 'M3' | 'M2';
}

/**
 * `casterSide` holds the caster (and, for an every-debuff extension, a faster inflicter that lands
 * the debuff and DoT first); the other side holds E alone. For an inflicted-scope extension the
 * caster lands them itself, in the same cast. `casterAffinity: undefined` → the CONTROL run: the
 * same board with no extension ability.
 */
const board = (
    casterSide: 'player' | 'enemy',
    extension: ExtensionName,
    casterAffinity: AffinityName | undefined
): CombatEngineInput => {
    const inflictions = (p: string) => [defenseDown(`${p}-dd`), corrosion(`${p}-cor`)];
    const own = inflictedScope(extension);
    const casterAbilities = [
        ...(own ? inflictions('caster') : []),
        ...(casterAffinity ? [EXTENSIONS[extension]] : []),
    ];
    const caster: Ship = {
        id: 'caster',
        speed: 200,
        affinity: casterAffinity ?? 'antimatter',
        skills: { slots: [{ slot: 'active', abilities: casterAbilities }] },
        position: 'M4',
    };
    const inflicter: Ship = {
        id: 'inflicter',
        speed: 300,
        affinity: 'antimatter',
        skills: { slots: [{ slot: 'active', abilities: inflictions('inflicter') }] },
        position: 'M3',
    };
    const victim: Ship = {
        id: 'victim',
        speed: 10,
        affinity: 'electric',
        skills: { slots: [] },
        position: 'M4',
    };
    const casterTeam = own ? [caster] : [caster, inflicter];

    const asEnemy = (s: Ship): EnemyAttacker => ({
        id: s.id,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 100,
            defence: 0,
            hp: HUGE_HP,
            speed: s.speed,
            hacking: HACKING,
        },
        chargeCount: 0,
        startCharged: false,
        position: s.position,
        affinity: s.affinity,
        target: front(),
        pattern: basePattern(),
        shipSkills: s.skills,
    });
    const asTeam = (s: Ship): TeamActorEngineInput => ({
        id: s.id,
        speed: s.speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        role: 'ATTACKER',
        position: s.position,
        affinity: s.affinity,
        target: front(),
        pattern: basePattern(),
        walk: {
            shipSkills: s.skills,
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 100,
                defensePenetration: 0,
                hacking: HACKING,
                defence: 0,
                hp: HUGE_HP,
            },
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    const playerShips = casterSide === 'player' ? casterTeam : [victim];
    const enemyShips = casterSide === 'player' ? [victim] : casterTeam;
    const [focus, ...team] = playerShips;
    return {
        attack: 0,
        crit: 0,
        critDamage: 100,
        defensePenetration: 0,
        hacking: HACKING,
        chargeCount: 0,
        shipSkills: focus.skills,
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinity: focus.affinity,
        defence: 0,
        hp: HUGE_HP,
        speed: focus.speed,
        healTargetId: 'attacker',
        mode: 'healing',
        position: focus.position,
        target: front(),
        pattern: basePattern(),
        teamActors: team.map(asTeam),
        enemyAttackers: enemyShips.map(asEnemy),
    };
};

/** E's remaining Defense Down turns and Corrosion rounds at the end of round 1. */
const victimDurations = (input: CombatEngineInput): { debuff: number; dot: number } => {
    const victimId = input.enemyAttackers.some((e) => e.id === 'victim') ? 'victim' : 'attacker';
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
    const debuff = engine!
        .timedAbilityStatuses('enemy', undefined, victimId)
        .find((s) => s.active.buffName === 'Defense Down II')?.active.turnsRemaining;
    const dot = actors.find((a) => a.id === victimId)?.corrosionEntries[0]?.remainingRounds;
    if (typeof debuff !== 'number' || dot === undefined) {
        throw new Error('the board did not land its Defense Down and Corrosion on E');
    }
    return { debuff, dot };
};

for (const side of ['player', 'enemy'] as const) {
    describe(`${side}-side debuff extension honours affinity immunity`, () => {
        for (const name of Object.keys(EXTENSIONS) as ExtensionName[]) {
            const extendsDots = name.startsWith('extend-dot');
            const extendsDebuffs = name.startsWith('extend-status');

            it(`${name}: a neutral enemy is extended, an affinity-advantaged one is not`, () => {
                const control = victimDurations(board(side, name, undefined));
                const neutral = victimDurations(board(side, name, 'antimatter'));
                const immune = victimDurations(board(side, name, 'thermal'));

                // Instrument: against a neutral enemy the extension really moved the durations.
                // extend-dot reaches the DoT only; extend-status reaches the timed debuff and the
                // DoT both (owner ruling R109: a DoT is a debuff), every-debuff and inflicted-scope
                // alike.
                const dotMoves = extendsDots || extendsDebuffs;
                expect(neutral.dot).toBe(control.dot + (dotMoves ? 1 : 0));
                expect(neutral.debuff).toBe(control.debuff + (extendsDebuffs ? 1 : 0));

                // The affinity-advantaged enemy keeps the control's durations.
                expect(immune).toEqual(control);
            });
        }
    });
}
