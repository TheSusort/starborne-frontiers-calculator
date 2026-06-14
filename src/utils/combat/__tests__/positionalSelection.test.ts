/**
 * Task C1 — player attacker positional target selection (focus turn).
 *
 * When the focus attacker carries a board `position` AND the opposing (enemy) roster
 * carries positions, the engine resolves the attacker's parsed target (e.g.
 * `side:'enemy', selection:'front'`) against the positioned enemy roster and binds the
 * focus turn to the SELECTED enemy actor — not the legacy dummy `'enemy'` binding.
 *
 * Positioned enemy roster (`enemyAttackerActors`) is only populated when `enemyAttackers`
 * is non-empty AND `healTargetId` is set (the engine throws `enemyAttackers require
 * healTargetId` otherwise). So this test runs in healing mode.
 *
 * Board geometry (selectTargets): caster at M4 scans its own row M first. Two enemies in
 * row M — one at M4 (col 4 = front-most), one at M1 (col 1 = back-most). `front` selection
 * anchors the front-most (M4 enemy); `back` selection anchors the back-most (M1 enemy).
 *
 * RED baseline (before the gated branch): the focus turn binds the dummy `enemy` actor, so
 * the emitted `ability-performed` event carries `targetId === 'enemy'` regardless of
 * position/target → both assertions FAIL. After the gated branch the event carries the
 * selected enemy's id.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ps${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A basic-attack active slot (100% / 1 hit) — gives the focus attacker a real damaging hit
// so an `ability-performed` (damage) event is emitted with a targetId.
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// A pure-target enemy: low/zero attack, big HP, positioned. Effectively a stationary target.
const enemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// Focus attacker positioned at M4, with a real basic attack and a positional target.
const BASE = (selection: ParsedTarget['selection']): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    debuffLandingChance: 1,
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    // Healing mode — required for the positioned enemy roster to be built.
    healTargetId: 'attacker',
    // Focus attacker board position + parsed positional target.
    position: 'M4',
    target: parsedTarget(selection),
    // Two positioned enemies in row M: M4 = front-most, M1 = back-most.
    enemyAttackers: [enemyAt('enemy-front', 'M4'), enemyAt('enemy-back', 'M1')],
});

const focusAbilityTargetId = (input: CombatEngineInput): string | undefined => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('ability-performed', (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    const focusPerformed = events.find(
        (e) => e.type === 'ability-performed' && e.actorId === 'attacker'
    );
    return focusPerformed && focusPerformed.type === 'ability-performed'
        ? focusPerformed.targetId
        : undefined;
};

describe('Task C1 — player attacker positional target selection (focus turn)', () => {
    it('front selection binds the focus turn to the front-most enemy (M4)', () => {
        idc = 0;
        expect(focusAbilityTargetId(BASE('front'))).toBe('enemy-front');
    });

    it('back selection binds the focus turn to the back-most enemy (M1)', () => {
        idc = 0;
        expect(focusAbilityTargetId(BASE('back'))).toBe('enemy-back');
    });
});
