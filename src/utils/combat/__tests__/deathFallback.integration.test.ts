/**
 * Phase 4 PR 2 — Task 1: inter-turn positional RETARGETING + all-dead WHIFF (verification).
 *
 * PR 1 made positional damage land for real (`applyPositionalDamage` decrements victim HP and
 * fires `ship-destroyed`). It also RE-RESOLVES the anchor per hit against the LIVE opposing
 * roster (`opposingLiving`, filtered to `currentHp > 0`). The roster array reference is built
 * ONCE (engine: `enemyAttackerActors`) and re-read every turn/hit, so a victim that dies on an
 * earlier turn is automatically excluded from every later target resolution — without any
 * stale-snapshot bug. This file PROVES that focus-fire retargeting holds across turns and that a
 * positional attacker whose only opposing target is already dead whiffs cleanly (no throw, no
 * spurious `ship-destroyed`).
 *
 * HARNESS: copied from `positionalDamage.integration.test.ts` — healing-mode `runCombat`
 * (`healTargetId` set so the positioned enemy roster is built), hand-built positioned actors,
 * and the `ship-destroyed` death bracket as the only observable (live enemy HP is not surfaced;
 * we size each victim's HP at/above the expected landed damage and assert it dies / survives).
 *
 * RETARGET (player→enemy): two living enemies at known columns. A FAST team attacker focus-fires
 * `front` and kills the front-most enemy; the SLOWER focus — same `front` selection — must
 * re-resolve to the SURVIVING enemy (now front-most) and land its damage there, NOT on the dead
 * one. Proven by where death lands (the survivor dies at its bracket; the already-dead enemy
 * emits exactly one ship-destroyed, never a second).
 *
 * WHIFF (player→enemy): the only opposing enemy is sized to die to the team actor; the focus then
 * resolves `front` to nothing (`resolvePositionalTarget` → null) → its hit lands nothing. Asserted
 * by the suite not throwing and no extra ship-destroyed beyond the one kill.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `df${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// Single-hit 1x basic attack, no passive payload → firing-hit damage == turn.directDamage.
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// Positioned, finite-HP enemy with zero offense — a stationary, damageable target.
const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
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

// Origin-only footprint (single target).
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A positioned team actor that fires its OWN positional attack on its OWN turn.
const teamActorAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    pattern: ParsedPattern,
    speed: number,
    attack: number
): TeamActor => ({
    id,
    speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget(selection),
    pattern,
    walk: {
        shipSkills: { slots: [basicAttack()] },
        stats: {
            attack,
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

// Focus attacker. `attack: 5000` vs defence 0, 1x multiplier, 1 hit, no crit → 5000 firing-hit.
const BASE = (
    overrides: Partial<CombatEngineInput> = {},
    target?: ParsedTarget,
    pattern?: ParsedPattern
): CombatEngineInput => ({
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
    position: 'M4',
    ...(target ? { target } : {}),
    ...(pattern ? { pattern } : {}),
    ...overrides,
});

/** Multiset of actor ids that emitted ship-destroyed (array preserves duplicates if any). */
const destroyedList = (input: CombatEngineInput): string[] => {
    const bus = createEventBus();
    const ids: string[] = [];
    bus.on('ship-destroyed', (e) => {
        ids.push(e.actorId);
    });
    runCombat({ ...input, bus });
    return ids;
};

const destroyedSet = (input: CombatEngineInput): Set<string> => new Set(destroyedList(input));

describe('Task 1 — inter-turn positional retargeting (player→enemy focus fire)', () => {
    // Two living enemies: front (M4, col 4) and back (M3, col 3). A FAST team actor (speed 200)
    // focus-fires `front` for a LETHAL 9000 on M4 and acts BEFORE the focus (speed 100). On the
    // focus's later turn `front` must re-resolve to the SURVIVING enemy (M3, now front-most) and
    // land its 5000 there — not on dead M4. We bracket M3 to pin the focus's landed damage.
    const run = (backHp: number): CombatEngineInput =>
        BASE(
            {
                teamActors: [teamActorAt('team-fast', 'M1', 'front', basePattern(), 200, 9000)],
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 5000), // killed by the fast team actor (9000 > 5000)
                    enemyAt('enemy-back', 'M3', backHp), // must be hit by the RETARGETED focus
                ],
            },
            parsedTarget('front'),
            basePattern()
        );

    it('a slower focus retargets onto the SURVIVING enemy after the front-most one dies', () => {
        idc = 0;
        const lo = destroyedList(run(5000)); // M3 HP 5000 → dies if it took ≥ 5000
        idc = 0;
        const hi = destroyedList(run(5001)); // M3 HP 5001 → survives if it took < 5001

        // The fast team actor always kills the front enemy.
        expect(lo).toContain('enemy-front');
        expect(hi).toContain('enemy-front');

        // The retargeted focus landed EXACTLY 5000 on the survivor (dies at 5000, lives at 5001),
        // proving it re-resolved `front` to the LIVING M3 rather than the dead M4.
        expect(lo).toContain('enemy-back');
        expect(new Set(hi).has('enemy-back')).toBe(false);

        // The dead enemy is destroyed EXACTLY once — no posthumous re-hit / double credit.
        expect(lo.filter((id) => id === 'enemy-front')).toHaveLength(1);
        expect(hi.filter((id) => id === 'enemy-front')).toHaveLength(1);
    });

    it('the dead front enemy is NEVER in a later footprint (back enemy with trivial HP still only dies once)', () => {
        idc = 0;
        // Survivor at HP 1: the retargeted focus trivially kills it. Each enemy dies exactly once.
        const dead = destroyedList(run(1));
        expect(dead.filter((id) => id === 'enemy-front')).toHaveLength(1);
        expect(dead.filter((id) => id === 'enemy-back')).toHaveLength(1);
        expect(dead).toHaveLength(2);
    });
});

describe('Task 1 — all-dead positional whiff (player→enemy)', () => {
    it('a positional focus whose only enemy is already dead lands nothing (no throw, no spurious destroy)', () => {
        idc = 0;
        // Single enemy at M4 (HP 5000). The FAST team actor (9000) kills it BEFORE the focus acts.
        // The focus then resolves `front` against an empty living roster → null → whiff: no apply,
        // no emit. The suite must not throw and only the one kill is recorded.
        const input = BASE(
            {
                teamActors: [teamActorAt('team-fast', 'M1', 'front', basePattern(), 200, 9000)],
                enemyAttackers: [enemyAt('enemy-only', 'M4', 5000)],
            },
            parsedTarget('front'),
            basePattern()
        );
        const dead = destroyedList(input);
        // Exactly one destroy event (the team actor's kill); the focus whiffed cleanly.
        expect(dead).toEqual(['enemy-only']);
    });

    it('a positional focus with NO enemies at all whiffs cleanly (empty opposing roster)', () => {
        idc = 0;
        // Healing mode still needs a heal target; with no enemy attackers the positioned enemy
        // roster is empty, so the focus `front` resolution returns null every hit → clean whiff.
        const input = BASE(
            {
                enemyAttackers: [],
            },
            parsedTarget('front'),
            basePattern()
        );
        // Must not throw, and nothing is destroyed.
        const dead = destroyedSet(input);
        expect(dead.size).toBe(0);
    });
});
