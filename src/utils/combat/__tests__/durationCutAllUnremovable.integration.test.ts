/**
 * A duration cut on "all active debuffs" (Heliodor, Pestilence) reaches unremovable debuffs
 * (R173): "unremovable" bars cleanse and purge, not a duration cut. Barrier Recharging, whose own
 * text says it cannot be reduced, is the one exception. The wearer carries an Acidic Decay (named
 * status and DoT stack) and a Barrier Recharging, hits once, and every reading is compared
 * against a control run without the reduce-all ability so the round's own decrements cancel out.
 * Each case runs on both sides.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import type { RegisteredAbilityStatus, StatusEngine } from '../statusEngine';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const HP = 1e6;
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
const HIT: Ability = {
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
};
const REDUCE_ALL: Ability = {
    id: 'reduce-all',
    type: 'cleanse',
    target: 'self',
    trigger: 'on-deal-damage',
    conditions: [],
    config: { type: 'cleanse', count: 'all', mode: 'reduce-duration', durationTurns: 1 },
} as unknown as Ability;

const wearerKit = (withReduceAll: boolean): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [HIT] },
        ...(withReduceAll ? [{ slot: 'passive' as const, abilities: [REDUCE_ALL] }] : []),
    ],
});

const harmlessEnemy = (id: string): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 10, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: NO_SKILLS,
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 9,
    shipSkills: NO_SKILLS,
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
    hp: HP,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

interface Side {
    wearerId: string;
    input: (kit: ShipSkills) => CombatEngineInput;
}

const PLAYER: Side = {
    wearerId: 'attacker',
    input: (kit) => base({ shipSkills: kit, enemyAttackers: [harmlessEnemy('enemy-a')] }),
};

const ENEMY: Side = {
    wearerId: 'enemy-wearer',
    input: (kit) =>
        base({
            attack: 0,
            speed: 150,
            enemyAttackers: [
                {
                    id: 'enemy-wearer',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: HP,
                        speed: 100,
                        security: 0,
                    },
                    chargeCount: 9,
                    startCharged: false,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: kit,
                },
            ],
        }),
};

const timed = (
    name: string,
    turns: number
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    kind: 'timed',
    side: 'enemy',
    sourceSlot: 'active',
    conditions: [],
    duration: turns,
    payload: { buffName: name, stacks: 1, parsedEffects: {} },
});

interface After {
    named: Map<string, number>;
    corrosion: { stacks: number; remainingRounds: number; unremovable?: boolean }[];
}

const run = (side: Side, withReduceAll: boolean): After => {
    const bus = createEventBus();
    const w = side.wearerId;
    let engine: StatusEngine | undefined;
    let wearer: CombatActor | undefined;
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        if (e.actorId !== w || e.round !== 1 || !engine) return;
        for (const n of ['Acidic Decay', 'Barrier Recharging', 'Defense Down II'])
            engine.applyTimedAbilityStatus(1, timed(n, 9), w, w);
    });
    runCombat({
        ...side.input(wearerKit(withReduceAll)),
        bus,
        __testTapStatusEngine: (se: StatusEngine) => {
            engine = se;
        },
        __testTapActors: (all: CombatActor[]) => {
            wearer = all.find((a) => a.id === w);
            if (!wearer) throw new Error('wearer missing');
            wearer.corrosionEntries.push({
                stacks: 2,
                tier: 1,
                remainingRounds: 9,
                sourceId: 'seed',
                family: 'Acidic Decay',
                unremovable: true,
                appliedSeq: 0,
            });
        },
    });
    if (!engine || !wearer) throw new Error('taps did not fire');
    const named = new Map<string, number>();
    for (const s of engine.timedAbilityStatuses('enemy', undefined, w)) {
        named.set(s.active.buffName, s.active.turnsRemaining as number);
    }
    return {
        named,
        corrosion: wearer.corrosionEntries.map((e) => ({
            stacks: e.stacks,
            remainingRounds: e.remainingRounds,
            ...(e.unremovable ? { unremovable: true } : {}),
        })),
    };
};

beforeEach(() => {
    setupKeyedRng(3);
});

const SIDES: [string, Side][] = [
    ['player', PLAYER],
    ['enemy-side', ENEMY],
];

for (const [tag, side] of SIDES) {
    describe(`${tag}: reduce-all duration cut reaches unremovable debuffs (R173)`, () => {
        it('an Acidic Decay status and its DoT stacks each lose a turn; Barrier Recharging does not', () => {
            const control = run(side, false);
            const cut = run(side, true);
            expect(control.named.get('Acidic Decay')).toBeDefined();
            expect(cut.named.get('Acidic Decay')).toBe(control.named.get('Acidic Decay')! - 1);
            expect(cut.named.get('Defense Down II')).toBe(
                control.named.get('Defense Down II')! - 1
            );
            expect(cut.named.get('Barrier Recharging')).toBe(
                control.named.get('Barrier Recharging')
            );
            expect(control.corrosion).toHaveLength(1);
            expect(cut.corrosion).toEqual([
                {
                    stacks: 2,
                    remainingRounds: control.corrosion[0].remainingRounds - 1,
                    unremovable: true,
                },
            ]);
        });
    });
}
