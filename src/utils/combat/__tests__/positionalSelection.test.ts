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

    it('skip selection binds the focus turn to the 2nd-from-front enemy (M2), distinct from front (M4) and back (M1)', () => {
        // Three enemies in row M: M4 (front), M2 (middle), M1 (back).
        // colsFrontToBack sorts cols [4,2,1]; skip = cols.slice(1) + cols[0] → anchor = cols[1] = M2 enemy.
        // Confirms skip resolves a target that is neither front nor back.
        idc = 0;
        const input: CombatEngineInput = {
            ...BASE('skip'),
            enemyAttackers: [
                enemyAt('enemy-front', 'M4'),
                enemyAt('enemy-mid', 'M2'),
                enemyAt('enemy-back', 'M1'),
            ],
        };
        expect(focusAbilityTargetId(input)).toBe('enemy-mid');
    });
});

// ============================================================================
// Task C2 — walked TEAM actor positional target selection (team turn).
//
// A walked team actor carries its OWN board `position` and parsed `target`; the
// engine resolves them against the SAME positioned enemy roster, independently of
// the focus attacker. To pin team-actor-specific selection, the team actor uses the
// OPPOSITE selection from the focus attacker so its `ability-performed.targetId`
// resolves to a DIFFERENT enemy than the focus's.
//
// Layout: focus attacker at M4 selects `front` → enemy-front (M4). Walked team actor
// at M1 selects `back` → enemy-back (M1). The team actor deals a real basic-attack hit,
// so its own `ability-performed` event fires with targetId === selected enemy id.
//
// RED baseline: the team turn binds the dummy `enemy`, so the team actor's
// `ability-performed.targetId === 'enemy'` → assertion FAILS. After the gated branch it
// carries the selected enemy's id.
// ============================================================================

type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

// A walked team actor with a real basic attack, its own position + parsed target.
const teamActorAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection']
): TeamActor => ({
    id,
    speed: 200, // faster than the focus so it acts first (order is irrelevant to selection)
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget(selection),
    walk: {
        shipSkills: { slots: [basicAttack()] },
        stats: {
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1_000_000_000,
        },
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const teamAbilityTargetId = (input: CombatEngineInput, teamId: string): string | undefined => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('ability-performed', (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    const teamPerformed = events.find(
        (e) => e.type === 'ability-performed' && e.actorId === teamId
    );
    return teamPerformed && teamPerformed.type === 'ability-performed'
        ? teamPerformed.targetId
        : undefined;
};

describe('Task C2 — walked team actor positional target selection (team turn)', () => {
    it("binds the team turn to the team actor's OWN positional target (back → M1), distinct from the focus (front → M4)", () => {
        idc = 0;
        // Focus attacker at M4 selects `front`; team actor at M1 selects `back`.
        const input: CombatEngineInput = {
            ...BASE('front'),
            teamActors: [teamActorAt('team-1', 'M1', 'back')],
        };
        // Focus resolves to the front-most enemy; team resolves to the back-most enemy.
        expect(focusAbilityTargetId(input)).toBe('enemy-front');
        expect(teamAbilityTargetId(input, 'team-1')).toBe('enemy-back');
    });
});

// ============================================================================
// Task C3 — enemy attacker positional target selection (side-symmetric).
//
// The mirror of C1/C2: a positioned ENEMY attacker resolves its OWN parsed `target`
// against the positioned PLAYER team (`allPlayerActors` = focus + walked team), and its
// incoming damage lands on the SELECTED player actor — not unconditionally on the heal
// target.
//
// Layout: the player team has the focus attacker at M4 (col 4 = front-most) and a walked
// team actor at M1 (col 1 = back-most). The enemy attacker at M4 selects `front`, so from
// its frame the front-most player is the focus (M4). The heal target is the TEAM actor
// (M1) — so the legacy (unrouted) path would always drain the team actor's HP, while the
// positional path drains the SELECTED focus actor's HP instead.
//
// Observable: `hp-changed` events carry the `targetId` of whichever actor took the hit
// (emitted from applyIncomingToTarget). The focus actor (selected) must show an hp-changed
// crossing; the heal target (team, NOT selected) must not be the one that was hit.
//
// RED baseline: the enemy always bombards the heal target, so the hit lands on the team
// actor (M1) and no hp-changed targets the focus → assertion FAILS. After the gated branch
// + applyIncomingToTarget re-route, the focus actor (front-most) takes the hit.
// ============================================================================

// A real damaging enemy attacker positioned with its own parsed target.
const damagingEnemyAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection']
): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

// Run a combat and return the set of distinct player actor ids that took an hp-changed hit.
const hpChangedTargets = (input: CombatEngineInput): Set<string> => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('hp-changed', (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return new Set(
        events
            .filter(
                (e): e is Extract<CombatEvent, { type: 'hp-changed' }> => e.type === 'hp-changed'
            )
            .map((e) => e.targetId)
    );
};

describe('Task C3 — enemy attacker positional target selection (side-symmetric)', () => {
    it("routes the enemy's incoming damage to its OWN positional selection (front → focus M4), not the heal target (team M1)", () => {
        idc = 0;
        // Player team: focus at M4 (front-most), walked team actor at M1 (back-most).
        // Heal target = the TEAM actor (M1) so the legacy path drains it; the positioned
        // enemy at M4 selects `front` → the focus (M4) actor.
        const input: CombatEngineInput = {
            ...BASE('front'),
            // Focus attacker should NOT itself attack the player team — it has its own enemy
            // target; we only care about the enemy's incoming routing. Keep its basic attack.
            healTargetId: 'team-1',
            teamActors: [teamActorAt('team-1', 'M1', 'front')],
            enemyAttackers: [damagingEnemyAt('enemy-atk', 'M4', 'front')],
        };
        const hit = hpChangedTargets(input);
        // The selected (front-most) player — the focus — received the enemy's incoming.
        expect(hit.has('attacker')).toBe(true);
        // The heal target (team actor, M1) was NOT the actor the enemy hit.
        expect(hit.has('team-1')).toBe(false);
    });
});

// ============================================================================
// Phase 3 — Taunt forces the focus attacker to redirect.
//
// A back-most enemy (M1) carries a Taunt self-buff. The focus attacker at M4 selects
// `front` — which without Taunt resolves to the front-most enemy (M4). With Taunt LIVE
// when the focus resolves its target, resolvePositionalTarget (now wired with a statusOf
// lookup) must redirect the focus to the taunter (M1) instead.
//
// To make Taunt LIVE before the focus resolves its target, the taunter casts a Taunt
// self-buff from an ACTIVE slot and runs with speed ≫ the focus, so it takes its turn
// (self-buffing) first and the buff is in the status engine when the focus acts.
// ============================================================================

// A pure-target enemy with a high-speed ACTIVE-slot Taunt self-buff. With speed ≫ focus,
// it acts first and self-buffs Taunt before the focus resolves its target. Its own basic
// attack would target the player heal target (irrelevant to the focus's selection).
const tauntingEnemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Taunt',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                duration: 99,
                            } as Ability['config'],
                        }),
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

describe('Phase 3 — Taunt forces the focus attacker to redirect', () => {
    it('front selection redirects to the back-most enemy when it carries Taunt', () => {
        idc = 0;
        const input: CombatEngineInput = {
            ...BASE('front'),
            numRounds: 2,
            enemyAttackers: [enemyAt('enemy-front', 'M4'), tauntingEnemyAt('enemy-back', 'M1')],
        };
        expect(focusAbilityTargetId(input)).toBe('enemy-back');
    });
});
