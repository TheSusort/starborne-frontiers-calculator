import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import type { CombatEvent } from '../events';

// ---------------------------------------------------------------------------
// E4: an on-cast 'all-enemies' purge whose config carries
//   countScaling: { stat: 'critDamage', per: 50 }
// removes, PER victim, count × floor(effectiveCritDamage / per) buffs.
//
// Amartya's charge: "purges 1 buff from all enemies for every 50% crit power"
//   → count: 1, countScaling: { stat: 'critDamage', per: 50 }
//   → per victim: floor(critDamage / 50)  (150→3, 100→2, 50→1, 40→0).
//
// Harness mirrors aoePurge.test.ts (positional two-team battle-sim): the focus
// fires an 'all'-pattern active so the footprint covers EVERY living enemy; the
// purge ability is injected directly with the scaling config.
// ---------------------------------------------------------------------------
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `e4p${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

const hit = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

// A removable self-buff with a distinct name so the victim carries several.
const namedBuff = (name: string): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        config: {
            type: 'buff',
            buffName: name,
            parsedEffects: { attack: 10 },
            stacks: 1,
            isStackable: false,
            duration: 99,
        },
    });

// An enemy that applies FOUR distinct removable self-buffs each round, then hits.
const fourBuffEnemy = (id: string, position: Position) => ({
    id,
    stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: allPattern(),
    shipSkills: {
        slots: [
            {
                slot: 'active' as const,
                abilities: [
                    namedBuff('Buff A'),
                    namedBuff('Buff B'),
                    namedBuff('Buff C'),
                    namedBuff('Buff D'),
                    hit(),
                ],
            },
        ],
    },
});

// Focus fires a scaling all-enemies purge (count 1, per 50) + a hit so the
// positional harness resolves a real anchor.
const scalingPurgeSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'purge',
                    target: 'all-enemies',
                    config: {
                        type: 'purge',
                        count: 1,
                        countScaling: { stat: 'critDamage', per: 50 },
                    },
                }),
                hit(),
            ],
        },
    ],
});

const BASE = (
    critDamage: number,
    enemies: ReturnType<typeof fourBuffEnemy>[]
): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: scalingPurgeSkills(),
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
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: allPattern(),
    enemyAttackers: enemies,
});

// Run a single round (enemies act first — speed 200 > focus 100 — applying their
// four buffs; the focus then purges) and report the surviving buff count per
// victim plus the purge-performed events.
const run = (
    critDamage: number,
    enemyIds: string[]
): { remaining: Record<string, number>; purgeEvents: CombatEvent[] } => {
    idc = 0;
    let engine: StatusEngine | undefined;
    const purgeEvents: CombatEvent[] = [];
    const bus = createEventBus();
    bus.on('purge-performed', (e) => purgeEvents.push(e));
    const enemies = enemyIds.map((id, i) => fourBuffEnemy(id, i === 0 ? 'M4' : 'M3'));
    runCombat({
        ...BASE(critDamage, enemies),
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    const remaining: Record<string, number> = {};
    for (const id of enemyIds) {
        remaining[id] = engine!.timedAbilityStatuses('self', id).length;
    }
    return { remaining, purgeEvents };
};

describe('E4: all-enemies purge count scales with live crit power, per footprint victim', () => {
    it('critDamage 150 → each victim loses exactly 3 buffs (4 - 3 = 1 remaining)', () => {
        const { remaining } = run(150, ['enemy-front']);
        expect(remaining['enemy-front']).toBe(1);
    });

    it('critDamage 100 → each victim loses exactly 2 buffs (4 - 2 = 2 remaining)', () => {
        const { remaining } = run(100, ['enemy-front']);
        expect(remaining['enemy-front']).toBe(2);
    });

    it('critDamage 40 → 0 removed, all 4 buffs survive, and NO purge-performed event fires', () => {
        const { remaining, purgeEvents } = run(40, ['enemy-front']);
        expect(remaining['enemy-front']).toBe(4);
        expect(
            purgeEvents.filter((e) => e.type === 'purge-performed' && e.targetId === 'enemy-front')
        ).toHaveLength(0);
    });

    it('AoE over two footprint victims at critDamage 150 → EACH loses 3 (per-victim count independence)', () => {
        const { remaining } = run(150, ['enemy-front', 'enemy-back']);
        expect(remaining['enemy-front']).toBe(1);
        expect(remaining['enemy-back']).toBe(1);
    });
});
