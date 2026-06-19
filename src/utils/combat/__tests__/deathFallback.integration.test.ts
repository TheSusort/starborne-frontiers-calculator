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

/**
 * Task 2 — Harvester `on-ally-destroyed` extra action under a POSITIONAL ally death.
 *
 * PR 1 made an enemy positional AoE able to KILL a non-heal-target player ally: the enemy
 * positional apply hits each player victim via `applyIncomingToTarget` → `recordDestroyed` →
 * emits `ship-destroyed{victimId}`. The Phase-4b `on-ally-destroyed` reactive listener (registered
 * per player owner) fires on that emit and routes the GRANTER's `extra-action` ability through the
 * reactive bridge into `grantExtraAction`. Because the ally dies DURING the enemy's turn while the
 * round-local queue is still being walked, the grant splices into the CURRENT round (Path A):
 * the surviving Harvester focus takes a SAME-round extra turn.
 *
 * Before PR 1 this was DORMANT — no positioned ally could be killed by an AoE. This proves the
 * bridge activates under the new positional-death capability. It mirrors the non-positional
 * `reactiveExtraAction.test.ts` Path A case, swapping the direct enemy hit for a positional AoE.
 *
 * Observable: `RoundData.extraTurns` (focus-actor extra turn count) === 1 in round 1.
 *
 * Layout: the Harvester focus = heal target 'attacker' at M1 (far back, OUTSIDE the footprint so
 * it SURVIVES). The dying ally 'team-victim' is the front-most player at M4. The enemy 'atk1' at
 * M1 fires Line-Range-1 `front` → anchors the front-most player (M4 ally) for FULL damage (5000 >
 * its 3000 HP → lethal) and covers M3 (empty). The focus at M1 is not in the M4+M3 footprint, so
 * it lives to take the extra turn. Speeds: enemy 100 (acts first, kills the ally), focus 50, ally
 * 10 (slowest). The ally dies on the enemy's earlier turn → the focus's on-ally-destroyed listener
 * enqueues → the per-turn drain splices the focus's extra turn into the remaining round-1 queue.
 */
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

// Harvester focus skills: a basic 1x enemy attack + an on-ally-destroyed extra-action passive.
const harvesterSkills = (): ShipSkills => {
    idc = 0;
    return {
        slots: [
            basicAttack(),
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'extra-action',
                        target: 'self',
                        trigger: 'on-ally-destroyed',
                        config: { type: 'extra-action', oncePerRound: true },
                    }),
                ],
            },
        ],
    };
};

// A passive, positioned player victim (walked team actor, zero offense). HP sized to bracket the
// enemy AoE damage; it deals nothing on its own turn.
const passivePlayerAt = (id: string, position: Position, hp: number, speed: number): TeamActor => ({
    id,
    speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: { slots: [] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

// A positioned ENEMY attacker that deals real damage via a parsed target + pattern (drives the
// Task-9 enemy-site positional apply against the PLAYER roster).
const offensiveEnemyAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    pattern: ParsedPattern,
    speed: number,
    attack: number
): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern,
        // A real basic-attack damage ability — REQUIRED for the firing hit to produce
        // `positionalScalars` so the enemy-site positional apply (Task 9) lands on the player roster.
        shipSkills: { slots: [basicAttack()] } as ShipSkills,
    }) as EnemyAttacker;

describe('Task 2 — Harvester on-ally-destroyed extra action under positional ally death', () => {
    it('the surviving Harvester focus takes a same-round extra turn when an enemy AoE kills a positioned ally', () => {
        idc = 0;
        const input = BASE(
            {
                shipSkills: harvesterSkills(),
                hp: 1_000_000_000, // focus survives (and is outside the footprint anyway)
                position: 'M1', // far back, NOT in the M4+M3 AoE footprint
                speed: 50, // acts after the enemy (100), before the ally (10)
                // No positional target on the focus → its own turn uses the legacy sink (the
                // dummy enemy never dies → no Path-B noise). The on-ally-destroyed passive is
                // what we are exercising.
                teamActors: [passivePlayerAt('team-victim', 'M4', 3000, 10)],
                enemyAttackers: [
                    // attack 5000 vs the M4 ally's 3000 HP → lethal full-damage origin hit.
                    offensiveEnemyAt('atk1', 'M1', 'front', lineRange1Pattern(), 100, 5000),
                ],
            },
            // Focus is NON-positional (no target) → it does not fire a positional hit of its own.
            undefined,
            undefined
        );

        const bus = createEventBus();
        const destroyed: string[] = [];
        bus.on('ship-destroyed', (e) => destroyed.push(e.actorId));
        const result = runCombat({ ...input, bus });

        // The ally actually died this round (otherwise on-ally-destroyed never fired).
        expect(destroyed).toContain('team-victim');
        // The on-ally-destroyed → extra-action bridge spliced the focus's extra turn into the live
        // round-1 queue (Path A): the focus took exactly ONE extra turn.
        expect(result.rounds[0].extraTurns).toBe(1);
    });
});
