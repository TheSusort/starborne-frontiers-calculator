/**
 * Bug: a reactive `damage` ability with a plain `target: 'enemy'` fired from a trigger that does
 * NOT stamp `counterTargetId` (start-of-round, end-of-round, on-deal-damage, on-debuff-inflicted)
 * fell back to `ctx.enemy.id` — the vestigial DPS-dummy sink (id 'enemy') — even in a positional
 * team battle. The dummy stays alive whenever the player team fields an ally-targeting ship
 * (healer), so the reactive hit the phantom and leaked a "→ enemy" line into the combat log,
 * repeated once per fire (identical damage each time, since the dummy's defence is constant).
 *
 * A reactive damage in a positional battle must hit a REAL opposing actor. In pure DPS-calc mode
 * (no positioned roster) the dummy IS the intended sink and must be preserved.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const HP = 10_000_000;

/** A player teamActor whose passive deals reactive damage to "an enemy" at the start of each
 *  round — start-of-round does NOT stamp counterTargetId, so it hits the else-branch fallback. */
const startOfRoundNuke: Ability = {
    id: 'sor-nuke',
    type: 'damage',
    target: 'enemy',
    trigger: 'start-of-round',
    conditions: [],
    config: { type: 'damage', multiplier: 60 },
};

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

let counter = 0;
const basicAttack = (): Ability => ({
    id: `basic-${++counter}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

const nukeActor = (id: string): TeamActor =>
    ({
        id,
        speed: 500,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M2',
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [basicAttack()] },
                    { slot: 'passive', abilities: [startOfRoundNuke] },
                ],
            } as ShipSkills,
            stats: {
                attack: 10_000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActorEngineInput;

/** An ally-targeting healer — the exact condition under which the phantom "enemy" leaked in the
 *  user's battle. It USED to keep the dummy in the turn order by falsifying the second conjunct of
 *  the `dummyEnemyIsVestigial` gate; that gate was deleted in SP-4c-2c and the dummy now takes no
 *  turn on any run, so the healer is retained here purely as the fixture shape that reproduced the
 *  original bug, not as a live condition. */
const healerActor = (id: string): TeamActor =>
    ({
        id,
        speed: 400,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M3',
        target: { raw: 'team', side: 'ally', selection: 'team' } as ParsedTarget,
        pattern: basePattern(),
        walk: {
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'heal',
                                type: 'heal',
                                target: 'ally',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'heal', pct: 10, basis: 'hp' },
                            },
                        ],
                    },
                ],
            } as ShipSkills,
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActorEngineInput;

const enemyShip = (
    id: string,
    position: ParsedTarget['selection'] extends never ? never : string
) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
    }) as unknown as EnemyAttacker;

const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'focus-noop',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 0 },
                    },
                ],
            },
        ],
    },
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
    speed: 1,
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    mode: 'battle',
    ...overrides,
});

function reactiveDamageEvents(input: CombatEngineInput) {
    const bus = createEventBus();
    const events: Extract<CombatEvent, { type: 'reactive-damage-performed' }>[] = [];
    bus.on('reactive-damage-performed', (e) => events.push(e));
    runCombat({ ...input, bus });
    return events;
}

describe('reactive damage never targets the DPS dummy in a positional battle', () => {
    it('a start-of-round reactive nuke hits a REAL enemy, not the phantom "enemy" dummy', () => {
        const events = reactiveDamageEvents(
            BASE({
                numRounds: 2,
                teamActors: [nukeActor('nuke'), healerActor('healer')],
                enemyAttackers: [enemyShip('enemy-a', 'M4'), enemyShip('enemy-b', 'M1')],
            })
        );
        expect(events.length).toBeGreaterThan(0);
        // NONE of the reactive-damage lines may point at the dummy sink id 'enemy'.
        expect(events.every((e) => e.targetId !== 'enemy')).toBe(true);
        // Every target is one of the real positioned enemies.
        expect(events.every((e) => e.targetId === 'enemy-a' || e.targetId === 'enemy-b')).toBe(
            true
        );
    });
});
