/**
 * Sefuba's catalogue passive repairs 8% of her max HP FOR EACH BUFF her purge removes.
 *
 *   catalogue R2: "When this Unit purges a buff from an enemy, it repairs 8% of its max HP for
 *                  each buff removed and also purges 1 extra buff from the enemy."
 *   catalogue R0: the same sentence without the extra purge.
 *
 * The count is the TRIGGERING purge's removed count (`purge-performed.count`). The chained
 * "1 extra buff" purge adds nothing to the repair.
 *
 * Fight cases (every negative sits next to a positive on the same board):
 *   (1) her purge removes 2 buffs → she repairs 16% of max HP;
 *   (2) her purge removes 1 buff → 8%;
 *   (3) the enemy has no buffs → her purge removes nothing → no repair at all;
 *   (4) the chained extra purge removes a third buff → the repair stays 16%, not 24%;
 *   (5) an enemy-side Sefuba mirrors (1) to (4);
 *   (6) the repair is capped at her max HP.
 *
 * Board: Sefuba (10,000 max HP) enters at 50% HP. The opposing ship acts first, has 0 attack
 * and stacks up to four removable self-buffs, so the only HP movement is Sefuba's repair.
 * Sefuba's active is parsed from the catalogue text ("purges 1 buff") or from the same sentence
 * with "purges 2 buffs" — the purge count is the variable under test, and no catalogue active
 * purges two. Real parsed passive (buildShipAbilities on the verbatim text), real engine
 * (runCombat), `mode: 'battle'` so the repair lands on her own HP.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { ParsedPattern } from '../../targetingParser';
import type { CombatActor } from '../state';
import type { StatusEngine } from '../statusEngine';

// Verbatim from docs/catalogue-adaptation/ship-skills.candidate.csv (Sefuba).
const SEFUBA_ACTIVE_CATALOGUE =
    'This Unit deals <unit-damage>160% damage</unit-damage> and <unit-skill>purges 1 buff</unit-skill> from the enemy.';
// Synthetic: the catalogue active with "purges 2 buffs"; no real Sefuba skill purges two.
const SEFUBA_ACTIVE_PURGE_2 =
    'This Unit deals <unit-damage>160% damage</unit-damage> and <unit-skill>purges 2 buffs</unit-skill> from the enemy.';
// Verbatim from docs/catalogue-adaptation/ship-skills.candidate.csv (Sefuba passives R0 and R2).
const SEFUBA_R0_CATALOGUE =
    'When this Unit <unit-skill>purges a buff</unit-skill> from an enemy, it <unit-damage>repairs 8%</unit-damage> of its max HP for each <unit-aid>buff</unit-aid> removed.';
const SEFUBA_R2_CATALOGUE =
    'When this Unit <unit-skill>purges a buff</unit-skill> from an enemy, it <unit-damage>repairs 8%</unit-damage> of its max HP for each <unit-aid>buff</unit-aid> removed and also <unit-skill>purges 1 extra buff</unit-skill> from the enemy.';

const sefubaKit = (active: string, passive: string): ShipSkills => {
    const ship = {
        refits: [],
        chargeSkillCharge: 2,
        activeSkillText: active,
        firstPassiveSkillText: passive,
    } as unknown as Ship;
    const built = buildShipAbilities(ship);
    const slot = (name: 'active' | 'passive') => {
        const s = built.slots.find((x) => x.slot === name);
        if (!s) throw new Error(`Sefuba ${name} slot missing`);
        return s;
    };
    return { slots: [slot('active'), slot('passive')] };
};

const SEFUBA_MAX_HP = 10_000;
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

let idc = 0;
const selfBuff = (name: string): Ability => ({
    id: `sb${++idc}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: name,
        parsedEffects: { attack: 10 },
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});
const BUFF_NAMES = ['Attack Up', 'Defense Up', 'Speed Up', 'Crit Up'];
/** An active skill that only grants itself `n` removable buffs. */
const buffer = (n: number): ShipSkills => ({
    slots: [{ slot: 'active', abilities: BUFF_NAMES.slice(0, n).map(selfBuff) }],
});
const inert = (): ShipSkills => ({ slots: [{ slot: 'active', abilities: [] }] });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const run = (input: CombatEngineInput, start: Record<string, number>, buffHolder: string) => {
    const bus = createEventBus();
    const purges: Extract<CombatEvent, { type: 'purge-performed' }>[] = [];
    bus.on('purge-performed', (e) => purges.push(e));
    const actors = new Map<string, CombatActor>();
    let engine: StatusEngine | undefined;
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
        __testTapActors: (all) => {
            for (const a of all) {
                actors.set(a.id, a);
                const f = start[a.id];
                if (f !== undefined) a.currentHp = a.stats.hp * f;
            }
        },
    });
    const buffsLeft = engine!.timedAbilityStatuses('self', buffHolder).length;
    return { purges, actors, buffsLeft };
};

const hpPct = (actors: Map<string, CombatActor>, id: string): number => {
    const a = actors.get(id)!;
    return (100 * a.currentHp) / a.stats.hp;
};

beforeEach(() => {
    idc = 0;
    setupKeyedRng(11);
});

describe('Sefuba passive — parse', () => {
    it.each([
        ['R0', SEFUBA_R0_CATALOGUE],
        ['R2', SEFUBA_R2_CATALOGUE],
    ])('catalogue %s: the repair is 8% per buff the triggering purge removed', (_, text) => {
        const heal = sefubaKit(SEFUBA_ACTIVE_CATALOGUE, text).slots[1].abilities.filter(
            (a) => a.type === 'heal'
        );
        expect(heal).toHaveLength(1);
        expect(heal[0]).toMatchObject({
            target: 'self',
            trigger: 'on-enemy-purged',
            conditions: [],
            scaling: { perUnit: 8, countSource: 'purged-buff-count' },
            config: { type: 'heal', basis: 'hp', pct: 8 },
        });
    });

    it('the variant active purges 2 buffs; the catalogue active purges 1', () => {
        const purgeCount = (active: string) =>
            sefubaKit(active, SEFUBA_R0_CATALOGUE).slots[0].abilities.find(
                (a) => a.type === 'purge'
            )?.config;
        expect(purgeCount(SEFUBA_ACTIVE_CATALOGUE)).toMatchObject({ type: 'purge', count: 1 });
        expect(purgeCount(SEFUBA_ACTIVE_PURGE_2)).toMatchObject({ type: 'purge', count: 2 });
    });
});

// ── Player side ──────────────────────────────────────────────────────────────

const enemy = (skills: ShipSkills): EnemyAttacker => ({
    id: 'e1',
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 200 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parseTarget('front'),
    pattern: basePattern(),
    shipSkills: skills,
});

const playerBoard = (kit: ShipSkills, enemyBuffs: number): CombatEngineInput => ({
    enemyAttackers: [enemy(enemyBuffs > 0 ? buffer(enemyBuffs) : inert())],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 99,
    shipSkills: kit,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: SEFUBA_MAX_HP,
    hacking: 0,
    speed: 100,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: basePattern(),
});

const runPlayer = (kit: ShipSkills, enemyBuffs: number, startHp = 0.5) =>
    run(playerBoard(kit, enemyBuffs), { attacker: startHp }, 'e1');

describe('Sefuba passive — repair per buff removed (player side)', () => {
    const r0Purge2 = sefubaKit(SEFUBA_ACTIVE_PURGE_2, SEFUBA_R0_CATALOGUE);
    const r0Purge1 = sefubaKit(SEFUBA_ACTIVE_CATALOGUE, SEFUBA_R0_CATALOGUE);

    it('(1) her purge removes 2 buffs → she repairs 16% of max HP', () => {
        const { purges, actors, buffsLeft } = runPlayer(r0Purge2, 3);
        expect(purges.map((p) => p.count)).toEqual([2]);
        expect(buffsLeft).toBe(1);
        expect(hpPct(actors, 'attacker')).toBeCloseTo(66, 5);
    });

    it('(2) her purge removes 1 buff → 8%', () => {
        const { purges, actors } = runPlayer(r0Purge1, 3);
        expect(purges.map((p) => p.count)).toEqual([1]);
        expect(hpPct(actors, 'attacker')).toBeCloseTo(58, 5);
    });

    it('(2) a 2-buff purge against an enemy holding only 1 removes 1 → 8%', () => {
        const { purges, actors, buffsLeft } = runPlayer(r0Purge2, 1);
        expect(purges.map((p) => p.count)).toEqual([1]);
        expect(buffsLeft).toBe(0);
        expect(hpPct(actors, 'attacker')).toBeCloseTo(58, 5);
    });

    it('(3) an enemy with no buffs: the purge removes nothing and she does not repair', () => {
        // Positive control on this board: the same kit against a buffed enemy repairs.
        expect(hpPct(runPlayer(r0Purge2, 3).actors, 'attacker')).toBeCloseTo(66, 5);
        const { purges, actors } = runPlayer(r0Purge2, 0);
        expect(purges).toEqual([]);
        expect(hpPct(actors, 'attacker')).toBeCloseTo(50, 5);
    });

    // Pins the current model for the KNOWN GAP at the on-enemy-purged listener (triggers.ts).
    it('(4) R2: the chained extra purge removes a third buff but the repair stays 16%', () => {
        const r2Purge2 = sefubaKit(SEFUBA_ACTIVE_PURGE_2, SEFUBA_R2_CATALOGUE);
        // The chain fires: 4 buffs − 2 (her purge) − 1 (the extra) = 1 left; R0 leaves 2.
        expect(runPlayer(r0Purge2, 4).buffsLeft).toBe(2);
        const { purges, actors, buffsLeft } = runPlayer(r2Purge2, 4);
        expect(buffsLeft).toBe(1);
        expect(purges.map((p) => p.count)).toEqual([2]);
        expect(hpPct(actors, 'attacker')).toBeCloseTo(66, 5);
    });

    it('(6) the repair is capped at her max HP', () => {
        // Positive control on this board: from 50% the same purge lifts her 16 points.
        expect(hpPct(runPlayer(r0Purge2, 3, 0.5).actors, 'attacker')).toBeCloseTo(66, 5);
        const { actors } = runPlayer(r0Purge2, 3, 0.9);
        expect(actors.get('attacker')!.currentHp).toBe(SEFUBA_MAX_HP);
    });
});

// ── Enemy side ───────────────────────────────────────────────────────────────

describe('Sefuba passive — team symmetry (enemy-side Sefuba) (5)', () => {
    // Mirror board: the player focus acts first, has 0 attack and buffs itself; the enemy
    // Sefuba (10,000 max HP, 50% HP) purges it.
    const enemySefuba = (kit: ShipSkills): EnemyAttacker => ({
        id: 'sefuba-enemy',
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: SEFUBA_MAX_HP,
            speed: 100,
            hacking: 0,
        },
        chargeCount: 99,
        startCharged: false,
        position: 'M4',
        target: parseTarget('front'),
        pattern: basePattern(),
        shipSkills: kit,
    });
    const enemyBoard = (kit: ShipSkills, focusBuffs: number): CombatEngineInput => ({
        ...playerBoard(inert(), 0),
        attack: 0,
        hp: 1_000_000,
        speed: 200,
        shipSkills: focusBuffs > 0 ? buffer(focusBuffs) : inert(),
        enemyAttackers: [enemySefuba(kit)],
    });
    const runEnemy = (kit: ShipSkills, focusBuffs: number) =>
        run(enemyBoard(kit, focusBuffs), { 'sefuba-enemy': 0.5 }, 'attacker');

    it('(5)/(1) her purge removes 2 buffs → she repairs 16% of max HP', () => {
        const { purges, actors, buffsLeft } = runEnemy(
            sefubaKit(SEFUBA_ACTIVE_PURGE_2, SEFUBA_R0_CATALOGUE),
            3
        );
        expect(purges.map((p) => [p.casterId, p.count])).toEqual([['sefuba-enemy', 2]]);
        expect(buffsLeft).toBe(1);
        expect(hpPct(actors, 'sefuba-enemy')).toBeCloseTo(66, 5);
    });

    it('(5)/(2) her purge removes 1 buff → 8%', () => {
        const { purges, actors } = runEnemy(
            sefubaKit(SEFUBA_ACTIVE_CATALOGUE, SEFUBA_R0_CATALOGUE),
            3
        );
        expect(purges.map((p) => p.count)).toEqual([1]);
        expect(hpPct(actors, 'sefuba-enemy')).toBeCloseTo(58, 5);
    });

    it('(5)/(3) a focus with no buffs: no purge, no repair', () => {
        const kit = sefubaKit(SEFUBA_ACTIVE_PURGE_2, SEFUBA_R0_CATALOGUE);
        // Positive control on this board: the same kit against a buffed focus repairs.
        expect(hpPct(runEnemy(kit, 3).actors, 'sefuba-enemy')).toBeCloseTo(66, 5);
        const { purges, actors } = runEnemy(kit, 0);
        expect(purges).toEqual([]);
        expect(hpPct(actors, 'sefuba-enemy')).toBeCloseTo(50, 5);
    });

    it('(5)/(4) R2: the chained extra purge does not add to the repair', () => {
        const { actors, buffsLeft } = runEnemy(
            sefubaKit(SEFUBA_ACTIVE_PURGE_2, SEFUBA_R2_CATALOGUE),
            4
        );
        expect(buffsLeft).toBe(1);
        expect(hpPct(actors, 'sefuba-enemy')).toBeCloseTo(66, 5);
    });
});
