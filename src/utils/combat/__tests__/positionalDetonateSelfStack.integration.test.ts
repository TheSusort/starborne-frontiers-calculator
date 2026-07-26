/**
 * A positional cast that BOTH detonates a DoT type AND inflicts that same type must NOT eat the
 * stack it just applied.
 *
 * The NON-positional path already guarantees this by ordering: `runPlayerTurn` runs Step 2.95
 * (`detonate()`) BEFORE Step 3 (`applyNewDoTs`) precisely so "a skill that detonates and re-applies
 * the same type (e.g. Incinerator) doesn't eat its own new stack" (playerTurn.ts).
 *
 * The POSITIONAL path defers the detonation: `runPlayerTurn` skips the anchor detonation and returns
 * a `positionalDetonation` recipe that the engine's per-victim loop (`applyPerVictimDetonation`)
 * consumes AFTER the whole turn body has run — i.e. after Step 3 already appended this cast's own
 * new entries. Without an eligibility filter the cast therefore detonates its OWN fresh stack: the
 * container is emptied every cast, the DoT/bomb never survives to tick or count down, and a bomb
 * planted by a positional detonate-and-inflict skill can NEVER burst naturally.
 *
 * Harness + seeding style mirrors perVictimDetonation.integration.test.ts (runCombat + `__testTapActors`).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingBomb } from '../state';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pdss${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const basicAttack = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

const detonate = (dotType: 'bomb' | 'inferno' | 'corrosion', powerPct = 100): Ability =>
    ab({
        type: 'detonate-dot',
        target: 'enemy',
        config: { type: 'detonate-dot', dotType, powerPct },
    });

const inflictDot = (dotType: 'bomb' | 'inferno' | 'corrosion', tier: number): Ability =>
    ab({
        type: 'dot',
        target: 'enemy',
        config: { type: 'dot', dotType, tier, stacks: 1, duration: 2 },
    });

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

/** Line-Range-1 anchored at the front enemy (M4) — covers M3, which is EMPTY in these
 *  fixtures, so the only victim is the anchor itself. Same pattern the sibling per-victim
 *  detonation suite uses (a valid registered offset table). */
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

const bomb = (damagePerStack: number, stacks: number, sourceId = 'attacker'): PendingBomb => ({
    countdown: 5,
    damagePerStack,
    stacks,
    tier: 100,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

const FOCUS_ATTACK = 100;

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: FOCUS_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    healModifier: 0,
    healTargetId: 'attacker',
    position: 'M4',
    // Security 0 on the victim + hacking high on the caster so every DoT application lands.
    hacking: 10_000,
    target: parsedTarget('front'),
    pattern: lineRange1Pattern(),
    enemyAttackers: [enemyAt('enemy-front', 'M4', 1_000_000_000)],
    ...overrides,
});

const collect = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = ['bomb-detonated', 'dot-detonated', 'dot-applied'];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    const actorsSeen: CombatActor[] = [];
    const result = runCombat({
        ...input,
        bus,
        __testTapActors: (actors: CombatActor[]) => {
            actorsSeen.push(...actors);
            input.__testTapActors?.(actors);
        },
    });
    return { events, result, actorsSeen };
};

describe('positional detonate + inflict same type (own-stack protection)', () => {
    it('does NOT detonate the Bomb the same cast just applied', () => {
        idc = 0;
        const { events, result, actorsSeen } = collect(
            BASE({
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                basicAttack(),
                                detonate('bomb', 150),
                                inflictDot('bomb', 30),
                            ],
                        },
                    ],
                },
            })
        );

        // The cast applied a bomb…
        expect(events.filter((e) => e.type === 'dot-applied')).toHaveLength(1);
        // …and detonated NOTHING (no bomb existed before this cast).
        expect(events.filter((e) => e.type === 'bomb-detonated')).toHaveLength(0);
        expect(result.rounds[0].perActorDetonation?.['attacker']).toBeUndefined();
        // The fresh bomb SURVIVES the cast that planted it.
        const victim = actorsSeen.find((a) => a.id === 'enemy-front');
        expect(victim?.pendingBombs).toHaveLength(1);
    });

    it('still detonates a PRE-EXISTING bomb while sparing the one it applies this cast', () => {
        idc = 0;
        const { events, result, actorsSeen } = collect(
            BASE({
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                basicAttack(),
                                detonate('bomb', 100),
                                inflictDot('bomb', 30),
                            ],
                        },
                    ],
                },
                __testTapActors: (actors: CombatActor[]) => {
                    actors.find((a) => a.id === 'enemy-front')?.pendingBombs.push(bomb(1000, 2));
                },
            })
        );

        // The pre-seeded bomb (2 × 1000 × powerPct 100%) detonated for exactly 2000 …
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet).toHaveLength(1);
        expect(bombDet[0]).toMatchObject({ damage: 2000, stacks: 2 });
        expect(result.rounds[0].perActorDetonation?.['attacker']).toBe(2000);
        // … and the bomb this cast applied is still standing (only the old one was consumed).
        const victim = actorsSeen.find((a) => a.id === 'enemy-front');
        expect(victim?.pendingBombs).toHaveLength(1);
        expect(victim?.pendingBombs[0].tier).toBe(30);
    });

    it('does NOT detonate the Inferno the same cast just applied', () => {
        idc = 0;
        const { events, result, actorsSeen } = collect(
            BASE({
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                basicAttack(),
                                detonate('inferno', 150),
                                inflictDot('inferno', 30),
                            ],
                        },
                    ],
                },
            })
        );

        expect(events.filter((e) => e.type === 'dot-applied')).toHaveLength(1);
        expect(events.filter((e) => e.type === 'dot-detonated')).toHaveLength(0);
        expect(result.rounds[0].perActorDetonation?.['attacker']).toBeUndefined();
        const victim = actorsSeen.find((a) => a.id === 'enemy-front');
        expect(victim?.infernoEntries).toHaveLength(1);
    });
});
