/**
 * AEGIS reacts to its OWN shield being destroyed.
 *
 * AEGIS's R2 passive: "grants Defense Up II for 1 turn and cleanses all debuffs when an ally
 * within the Active pattern has their Shield destroyed." AEGIS's support pattern is centered on
 * itself and its active shields itself, so AEGIS itself counts as "an ally within the Active
 * pattern". Previously the on-ally-shield-destroyed listener excluded the owner, so when AEGIS's
 * own shield was destroyed nothing fired. This asserts AEGIS now self-reacts (Defense Up + cleanse
 * on itself), while the existing onAllyShieldDestroyed.test.ts keeps proving the ally case.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability } from '../../../types/abilities';
import { parsePattern } from '../../targetingParser';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}], ...over } as Ship;
}
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const noopActive = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});
const hit = (): Ability => ({
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});
const applyDebuff = (): Ability => ({
    id: 'debuff',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Defense Down II',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'apply',
        duration: 5,
    },
});
const preCombatShield = (): Ability => ({
    id: 'pre-shield',
    type: 'shield',
    target: 'self',
    trigger: 'pre-combat',
    conditions: [],
    config: { type: 'shield', pct: 100, basis: 'hp' },
});
const AEGIS_P2 =
    'This Unit grants <unit-skill>Defense Up II</unit-skill> for 1 turn and <unit-aid>cleanses all</unit-aid> debuffs when an ally within the Active pattern has their Shield destroyed.';
function aegisReactiveAbilities(): Ability[] {
    return (
        buildShipAbilities(ship({ secondPassiveSkillText: AEGIS_P2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? []
    );
}
const SHIELD_HP = 100_000;

/** AEGIS holds its own pre-combat shield + its reactive passive, and is the enemy's target. */
const aegisActor = (position: Position, pattern: ParsedPattern): TeamActorEngineInput =>
    ({
        id: 'aegis',
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern,
        walk: {
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopActive()] },
                    {
                        slot: 'passive',
                        abilities: [...aegisReactiveAbilities(), preCombatShield()],
                    },
                ],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: SHIELD_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as unknown as TeamActorEngineInput;

const enemyDebuffer = (position: Position): EnemyAttacker =>
    ({
        id: 'enemy-debuffer',
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [applyDebuff()] }] },
    }) as EnemyAttacker;

const enemyBreaker = (position: Position, attack: number): EnemyAttacker =>
    ({
        id: 'enemy-breaker',
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 500 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
    }) as EnemyAttacker;

const focus = (): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [noopActive()] }] },
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
    speed: 2,
    positionalTeamBattle: true,
    // Focus sits BEHIND AEGIS (lower column) so the enemy 'front' target is AEGIS, not the focus.
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
});

function runAndCollect(input: CombatEngineInput) {
    const bus = createEventBus();
    const buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    const shieldDestroyed: Extract<CombatEvent, { type: 'shield-destroyed' }>[] = [];
    bus.on('buff-applied', (e) => buffsApplied.push(e));
    bus.on('shield-destroyed', (e) => shieldDestroyed.push(e));
    let engine: StatusEngine | undefined;
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    return { buffsApplied, shieldDestroyed, engine: engine! };
}

describe('AEGIS reacts to its OWN shield being destroyed', () => {
    // AEGIS at M4 (front) so the enemy targets AEGIS; a Line-Support-Range-1 pattern anchored at
    // M4 includes M4 (AEGIS's own cell) in its footprint.
    const build = () => ({
        ...focus(),
        teamActors: [aegisActor('M4', parsePattern('Pattern-Line-Support-Range-1'))],
        enemyAttackers: [enemyDebuffer('M4'), enemyBreaker('M1', SHIELD_HP)],
    });

    it("AEGIS's own shield is destroyed → shield-destroyed fires for AEGIS", () => {
        const { shieldDestroyed } = runAndCollect(build());
        expect(shieldDestroyed.some((e) => e.victimId === 'aegis')).toBe(true);
    });

    it('AEGIS grants ITSELF Defense Up II', () => {
        const { buffsApplied } = runAndCollect(build());
        expect(
            buffsApplied.some((b) => b.buffName === 'Defense Up II' && b.actorId === 'aegis')
        ).toBe(true);
    });

    it('AEGIS cleanses its OWN Defense Down II debuff', () => {
        const { engine } = runAndCollect(build());
        expect(
            engine.timedAbilityStatuses('enemy', undefined, 'aegis').map((s) => s.active.buffName)
        ).toEqual([]);
    });
});
