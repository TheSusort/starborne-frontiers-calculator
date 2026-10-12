/**
 * The direct-hit incoming composition (#672) reaches the engine on both sides:
 *   (1 + buffs) × (1 − Σ ship passives) × Π(1 − each gear/implant/squad-leader reduction),
 * floored at 0.30, with the attacker's outgoing modifiers multiplying outside the floor.
 *
 * Each case compares two runs that differ in ONE input and asserts the ratio of the landed hit.
 * Observation: the `attacked` event's taken damage for the victim (the positional per-hit apply),
 * and the attacker's `ability-performed` damage (the bound-target aggregate figure) for parity.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { emptyPreFightModifiers } from '../preFight';
import type { PreFightCombatModifiers } from '../preFight';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

beforeEach(() => {
    setupKeyedRng(672);
});

/** Crit Damage (percent) of an always-crit attacker. */
const CRIT_DAMAGE = 50;

const target = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const pattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const hit = (id: string, multiplier: number): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** An `always` direct-hit reduction: ship kit (passive bucket) or equipment (separate factor). */
const reduction = (
    id: string,
    pct: number,
    equipment: boolean,
    condition: 'always' | 'incoming-crit' = 'always'
): Ability => ({
    id,
    type: 'incoming-reduction',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...(equipment ? { source: 'equipment' as const } : {}),
    config: {
        type: 'incoming-reduction',
        scope: 'direct',
        condition,
        pct,
        critFamily: condition === 'incoming-crit',
    },
});

/** The victim's own `Inc. Damage Down` self-buff (buff channel), cast on its turn. */
const incDamageDown = (id: string, pct: number): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: pct <= -45 ? 'Inc. Damage Down III' : 'Inc. Damage Down II',
        parsedEffects: { incomingDamage: pct },
        stacks: 1,
        isStackable: false,
        duration: 2,
    },
});

interface VictimKit {
    /** Own Inc. Damage Down, signed (−30 = IDD II). */
    buff?: number;
    passive?: number;
    equipment?: number;
    /** Equipment reduction that applies to crits only (`incoming-crit`). */
    critEquipment?: number;
    /** Squad-leader `preFight.incomingDamage`, signed (−5 = takes 5% less). */
    leaderIncoming?: number;
}

const victimSlots = (id: string, kit: VictimKit): ShipSkills['slots'] => {
    const passive: Ability[] = [
        ...(kit.passive !== undefined ? [reduction(`${id}-passive`, kit.passive, false)] : []),
        ...(kit.equipment !== undefined ? [reduction(`${id}-gear`, kit.equipment, true)] : []),
        ...(kit.critEquipment !== undefined
            ? [reduction(`${id}-gear-crit`, kit.critEquipment, true, 'incoming-crit')]
            : []),
    ];
    return [
        {
            slot: 'active',
            abilities: [
                ...(kit.buff !== undefined ? [incDamageDown(`${id}-idd`, kit.buff)] : []),
                hit(`${id}-noop`, 0),
            ],
        },
        ...(passive.length > 0 ? [{ slot: 'passive' as const, abilities: passive }] : []),
    ];
};

const leaderPreFight = (kit: VictimKit): PreFightCombatModifiers | undefined =>
    kit.leaderIncoming !== undefined
        ? { ...emptyPreFightModifiers(), incomingDamage: kit.leaderIncoming }
        : undefined;

const BASE = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    ...over,
});

const outgoingDown = (pct: number): SelectedGameBuff => ({
    id: 'out-damage-down',
    buffName: 'Out. Damage Down I',
    stacks: 1,
    isStackable: false,
    application: 'apply',
    skillSource: 'active',
    parsedEffects: { outgoingDamage: pct },
});

/** The player focus (attack 5000, 100%) fires at an enemy victim that acts first. */
const enemyVictimRun = (
    kit: VictimKit,
    attacker: { outgoing?: number; crit?: number } = {}
): CombatEngineInput =>
    BASE({
        attack: 5000,
        crit: attacker.crit ?? 0,
        critDamage: attacker.crit ? CRIT_DAMAGE : 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [hit('focus-hit', 100)] }] },
        speed: 1000,
        position: 'M4',
        target: target(),
        pattern: pattern(),
        selfBuffs: attacker.outgoing !== undefined ? [outgoingDown(attacker.outgoing)] : [],
        enemyAttackers: [
            {
                id: 'enemy-victim',
                stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 2000 },
                chargeCount: 0,
                startCharged: false,
                position: 'M1',
                target: target(),
                pattern: pattern(),
                shipSkills: { slots: victimSlots('enemy-victim', kit) },
                ...(leaderPreFight(kit) ? { preFight: leaderPreFight(kit) } : {}),
            } satisfies EnemyAttacker,
        ],
    });

/** An enemy attacker (attack 5000, 100%) fires at a player team victim that acts first. */
const playerVictimRun = (kit: VictimKit, attackerCrit = 0): CombatEngineInput =>
    BASE({
        teamActors: [
            {
                id: 'victim',
                speed: 1000,
                chargeCount: 0,
                startCharged: false,
                selfBuffs: [],
                enemyDebuffs: [],
                position: 'M4',
                walk: {
                    shipSkills: { slots: victimSlots('victim', kit) },
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 0,
                        defence: 0,
                        hp: 1e9,
                    },
                    affinityDamageModifier: 0,
                    affinityCritCap: 100,
                    affinityCritPenalty: 0,
                    hasChargedSkill: false,
                },
                ...(leaderPreFight(kit) ? { preFight: leaderPreFight(kit) } : {}),
            } satisfies TeamActor,
        ],
        enemyAttackers: [
            {
                id: 'enemy-1',
                stats: {
                    attack: 5000,
                    crit: attackerCrit,
                    critDamage: attackerCrit ? CRIT_DAMAGE : 0,
                    defence: 0,
                    hp: 1e9,
                    speed: 1,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M1',
                target: target(),
                pattern: pattern(),
                shipSkills: { slots: [{ slot: 'active', abilities: [hit('enemy-1-hit', 100)] }] },
            } satisfies EnemyAttacker,
        ],
    });

/** The first hit `attackerId` landed on `victimId`: taken (positional) and the cast's aggregate
 *  figure (`ability-performed.damage`, the bound-target path). */
const observe = (
    input: CombatEngineInput,
    attackerId: string,
    victimId: string
): { taken: number; aggregate: number } => {
    const bus = createEventBus();
    let taken: number | undefined;
    let aggregate: number | undefined;
    bus.on('attacked', (e) => {
        if (taken !== undefined || e.attackerId !== attackerId || e.targetId !== victimId) return;
        taken = e.takenDamage ?? e.damage;
    });
    bus.on('ability-performed', (e) => {
        if (aggregate !== undefined || e.actorId !== attackerId || e.targetId !== victimId) return;
        if (e.abilityType !== 'damage') return;
        aggregate = e.damage;
    });
    runCombat({ ...input, bus });
    if (taken === undefined) throw new Error(`no hit from ${attackerId} on ${victimId}`);
    if (aggregate === undefined) throw new Error(`no aggregate figure from ${attackerId}`);
    return { taken, aggregate };
};

const onEnemy = (kit: VictimKit, attacker?: { outgoing?: number }) =>
    observe(enemyVictimRun(kit, attacker), 'attacker', 'enemy-victim').taken;
const onPlayer = (kit: VictimKit) => observe(playerVictimRun(kit), 'enemy-1', 'victim').taken;

describe('direct-hit composition in the engine (#672)', () => {
    it('control: an unreduced victim takes the full 5000 on both sides', () => {
        expect(onEnemy({})).toBeCloseTo(5000, 6);
        expect(onPlayer({})).toBeCloseTo(5000, 6);
    });

    it('passive 25 ± own Inc. Damage Down II: buff channel × passive bucket → ratio 0.70', () => {
        const ratio = onEnemy({ passive: 25, buff: -30 }) / onEnemy({ passive: 25 });
        expect(ratio).toBeCloseTo(0.7, 6);
        // The retired additive channel: (1 − 0.30 − 0.25) / (1 − 0.25).
        expect(ratio).not.toBeCloseTo(0.45 / 0.75, 3);
    });

    it('equipment 20 ± passive 25: the separate factor is untouched → ratio 0.75', () => {
        const ratio = onEnemy({ equipment: 20, passive: 25 }) / onEnemy({ equipment: 20 });
        expect(ratio).toBeCloseTo(0.75, 6);
        // The retired additive channel: (1 − 0.45) / (1 − 0.20).
        expect(ratio).not.toBeCloseTo(0.55 / 0.8, 3);
    });

    it('squad-leader incoming −5 ± own Inc. Damage Down II: leader is a separate factor → ratio 0.70', () => {
        const ratio = onEnemy({ leaderIncoming: -5, buff: -30 }) / onEnemy({ leaderIncoming: -5 });
        expect(ratio).toBeCloseTo(0.7, 6);
        // The retired additive channel: (0.95 − 0.30) / 0.95.
        expect(ratio).not.toBeCloseTo(0.65 / 0.95, 3);
        // Liveness: the leader term itself still reduces the hit (separate bucket, 0.95).
        expect(onEnemy({ leaderIncoming: -5 })).toBeCloseTo(4750, 6);
    });

    it('MIRROR: an enemy hitting a player victim with passive 25 ± Inc. Damage Down II → ratio 0.70', () => {
        const ratio = onPlayer({ passive: 25, buff: -30 }) / onPlayer({ passive: 25 });
        expect(ratio).toBeCloseTo(0.7, 6);
        expect(onPlayer({ passive: 25, buff: -30 })).toBeCloseTo(
            onEnemy({ passive: 25, buff: -30 }),
            6
        );
    });

    it('a floored victim (buff −60 × passive 40 = 0.24 → 0.30) ± attacker Out. Damage Down −15 → ratio 0.85', () => {
        const capped = { buff: -60, passive: 40 };
        expect(onEnemy(capped)).toBeCloseTo(1500, 6);
        // Outgoing multiplies outside the floor; inside it would read 0.204 → 0.30, ratio 1.
        const ratio = onEnemy(capped, { outgoing: -15 }) / onEnemy(capped);
        expect(ratio).toBeCloseTo(0.85, 6);
    });

    it('the bound-target aggregate figure and the positional hit agree for the full composition', () => {
        // buff −30, passive 25, equipment 20, leader −5: 0.70 × 0.75 × 0.80 × 0.95 × 5000 = 1995.
        const kit: VictimKit = { buff: -30, passive: 25, equipment: 20, leaderIncoming: -5 };
        const enemySide = observe(enemyVictimRun(kit), 'attacker', 'enemy-victim');
        expect(enemySide.taken).toBeCloseTo(1995, 6);
        expect(enemySide.aggregate).toBeCloseTo(enemySide.taken, 6);
        const playerSide = observe(playerVictimRun(kit), 'enemy-1', 'victim');
        expect(playerSide.taken).toBeCloseTo(1995, 6);
        expect(playerSide.aggregate).toBeCloseTo(playerSide.taken, 6);
    });

    it('a crit-conditional equipment term reaches both paths: crit hit × 0.85 of the unreduced crit', () => {
        // Always-crit attacker; the victim's `incoming-crit` equipment term (15) applies only on a crit.
        const kit: VictimKit = { critEquipment: 15 };
        const uncut = observe(enemyVictimRun({}, { crit: 100 }), 'attacker', 'enemy-victim');
        // Liveness: the hit really crit, so the term has something to act on.
        expect(uncut.taken).toBeGreaterThan(5000);
        // 5000 × (1 + 50% crit damage) × (1 − 15%).
        expect(uncut.taken).toBeCloseTo(7500, 6);
        const expected = 5000 * 1.5 * 0.85;
        const enemySide = observe(enemyVictimRun(kit, { crit: 100 }), 'attacker', 'enemy-victim');
        expect(enemySide.taken).toBeCloseTo(expected, 6);
        expect(enemySide.aggregate).toBeCloseTo(enemySide.taken, 6);
        const playerSide = observe(playerVictimRun(kit, 100), 'enemy-1', 'victim');
        expect(playerSide.taken).toBeCloseTo(expected, 6);
        expect(playerSide.aggregate).toBeCloseTo(playerSide.taken, 6);
    });
});
