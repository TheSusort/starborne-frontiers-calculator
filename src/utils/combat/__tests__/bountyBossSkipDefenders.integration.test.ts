/**
 * `front-skip-defenders` targeting (Sitri and Corson, Eelun Naphula's escorts, #519). Owner ruling
 * 2026-11-14: front targeting that passes over every defender-family enemy, picking the front-most
 * non-defender by the normal front rule; a defender is struck only when no non-defender is left.
 * Taunt and Provoke still steer it exactly as they steer `front`. The cast's pattern expands around
 * the chosen target as usual, so a defender inside it takes splash.
 * Every board runs with the caster on the player side and on the enemy side.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { parsePattern, parseTarget, type ParsedTarget } from '../../targetingParser';
import {
    boardInput,
    hitKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ShipTypeName } from '../../../constants/shipTypes';

beforeEach(() => setupKeyedRng(519));

const SIDES: Placement[] = ['player', 'enemy'];
const SKIP = parseTarget('front-skip-defenders');
const FRONT = parseTarget('front');

const caster = (
    position: Position,
    target: ParsedTarget = SKIP,
    pattern = 'Pattern-Base'
): BoardUnit => ({
    id: 'caster',
    kit: hitKit(100),
    position,
    speed: 300,
    attack: 10_000,
    target,
    pattern: parsePattern(pattern),
});

const unit = (id: string, position: Position, role: ShipTypeName): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
    role,
});

const tauntAbility: Ability = {
    id: 'self-taunt',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Taunt',
        duration: 3,
        stacks: 1,
        isStackable: false,
        parsedEffects: {},
    },
};

/** Who the caster hit in round 1, and whether each hit was primary. */
const round1Hits = (
    placement: Placement,
    attacker: BoardUnit,
    opponents: BoardUnit[]
): { hits: Map<string, boolean[]>; id: (u: BoardUnit) => string } => {
    const { input, id } = boardInput(placement, attacker, [], opponents, 1);
    const bus = createEventBus();
    const hits = new Map<string, boolean[]>();
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId !== id(attacker) || e.round !== 1) return;
        hits.set(e.targetId, [...(hits.get(e.targetId) ?? []), e.isPrimaryTarget === true]);
    });
    runCombat({ ...input, bus });
    return { hits, id };
};

const stealthAbility: Ability = {
    ...tauntAbility,
    id: 'self-stealth',
    config: { ...tauntAbility.config, buffName: 'Stealth' } as Ability['config'],
};

/** `round1Hits`, plus the units that had gained Stealth by the caster's first hit. */
const round1HitsWithStealth = (
    placement: Placement,
    attacker: BoardUnit,
    opponents: BoardUnit[]
): {
    hits: Map<string, boolean[]>;
    id: (u: BoardUnit) => string;
    stealthBeforeHit: Set<string>;
} => {
    const { input, id } = boardInput(placement, attacker, [], opponents, 1);
    const bus = createEventBus();
    const hits = new Map<string, boolean[]>();
    const stealthed = new Set<string>();
    let stealthBeforeHit: Set<string> | undefined;
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.buffName === 'Stealth') stealthed.add(e.actorId);
    });
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId !== id(attacker) || e.round !== 1) return;
        stealthBeforeHit ??= new Set(stealthed);
        hits.set(e.targetId, [...(hits.get(e.targetId) ?? []), e.isPrimaryTarget === true]);
    });
    runCombat({ ...input, bus });
    return { hits, id, stealthBeforeHit: stealthBeforeHit ?? new Set() };
};

describe.each(SIDES)('front-skip-defenders, caster on the %s side', (placement) => {
    it('passes over a defender at the front of its row to the attacker behind it', () => {
        const opp = [unit('def', 'M4', 'DEFENDER_SECURITY'), unit('atk', 'M3', 'ATTACKER')];
        const { hits, id } = round1Hits(placement, caster('M1'), opp);
        expect([...hits.keys()]).toEqual([id(opp[1])]);
    });

    it('validity: plain front hits that defender', () => {
        const opp = [unit('def', 'M4', 'DEFENDER_SECURITY'), unit('atk', 'M3', 'ATTACKER')];
        const { hits, id } = round1Hits(placement, caster('M1', FRONT), opp);
        expect([...hits.keys()]).toEqual([id(opp[0])]);
    });

    it('leaves the scan row when only a defender stands in it', () => {
        const opp = [unit('def', 'M4', 'DEFENDER'), unit('sup', 'T4', 'SUPPORTER')];
        const { hits, id } = round1Hits(placement, caster('M1'), opp);
        expect([...hits.keys()]).toEqual([id(opp[1])]);
    });

    it('strikes the front defender by the normal front rule when only defenders are left', () => {
        const opp = [unit('def-m', 'M4', 'DEFENDER'), unit('def-t', 'T4', 'DEFENDER_SECURITY')];
        const { hits, id } = round1Hits(placement, caster('M1'), opp);
        expect([...hits.keys()]).toEqual([id(opp[0])]);
    });

    it('is still pulled onto a Taunting defender', () => {
        const opp = [
            unit('atk', 'M4', 'ATTACKER'),
            {
                ...unit('taunter', 'T4', 'DEFENDER'),
                kit: { slots: [{ slot: 'active' as const, abilities: [tauntAbility] }] },
                speed: 350,
            },
        ];
        const { hits, id } = round1Hits(placement, caster('M1'), opp);
        expect([...hits.keys()]).toEqual([id(opp[1])]);
    });

    // Owner ruling 2026-11-15: with every non-defender Stealthed, the visible defender is struck.
    it('strikes the visible defender when every non-defender is Stealthed', () => {
        const stealthed = (id: string, position: Position): BoardUnit => ({
            ...unit(id, position, 'ATTACKER'),
            kit: { slots: [{ slot: 'active' as const, abilities: [stealthAbility] }] },
            speed: 350,
        });
        const board = (stealth: boolean) => [
            unit('def', 'M4', 'DEFENDER'),
            stealth ? stealthed('atk-m', 'M3') : unit('atk-m', 'M3', 'ATTACKER'),
            stealth ? stealthed('atk-t', 'T4') : unit('atk-t', 'T4', 'ATTACKER'),
        ];
        const withStealth = board(true);
        const { hits, id, stealthBeforeHit } = round1HitsWithStealth(
            placement,
            caster('M1'),
            withStealth
        );
        // Validity: both non-defenders were Stealthed before the caster struck.
        expect(stealthBeforeHit).toEqual(new Set([id(withStealth[1]), id(withStealth[2])]));
        expect([...hits.keys()]).toEqual([id(withStealth[0])]);
        // Control: without the Stealth, the defender is passed over.
        const control = board(false);
        const ctl = round1Hits(placement, caster('M1'), control);
        expect(ctl.hits.has(ctl.id(control[0]))).toBe(false);
    });

    it('expands its cone around the chosen target, splashing a defender behind it', () => {
        // The cone from M3 covers the hexes behind it; the defender at M2 takes splash, the
        // skipped defender at M4 in front is untouched.
        const opp = [
            unit('def-front', 'M4', 'DEFENDER'),
            unit('atk', 'M3', 'ATTACKER'),
            unit('def-behind', 'M2', 'DEFENDER_SECURITY'),
        ];
        const { hits, id } = round1Hits(placement, caster('M1', SKIP, 'Pattern-Cone-Range-1'), opp);
        expect(hits.get(id(opp[1]))).toEqual([true]);
        expect(hits.get(id(opp[2]))).toEqual([false]);
        expect(hits.has(id(opp[0]))).toBe(false);
    });
});
