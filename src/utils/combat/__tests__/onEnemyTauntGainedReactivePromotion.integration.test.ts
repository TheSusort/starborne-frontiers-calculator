/**
 * Ship-kit correctness audit, Wave 3, Task 4 — Amartya's `on-enemy-taunt-gained` reactive
 * trigger (ENGINE integration).
 *
 * Amartya's second passive (verbatim from docs/ship-skills.csv, the Taunt clause): "When an
 * enemy defender gains <unit-skill>Taunt</unit-skill>, this Unit inflicts 2 stacks of
 * <unit-skill>Exposed</unit-skill> on that defender." Before this task this fell through to the
 * default `trigger:'on-cast'` (an unconditioned, always-fires grant) — no phrasing detector
 * recognized "gains Taunt" (its sibling clause, "is directly repaired", already resolved
 * correctly via the pre-existing `on-enemy-repaired` trigger — proving the reactive-trigger
 * machinery itself works fine; only this specific phrasing was unrecognized).
 *
 * Exercised through the REAL production pipeline (`buildShipAbilities` fed verbatim skill text,
 * never a hand-built ability). Follows the `onEnemyRepairedReactivePromotion.integration.test.ts`
 * harness style (Ruiner/Amartya precedent): a mutation-guard shape check, then a `runCombat`
 * engine test proving POSITIONAL routing — Exposed must land on the SPECIFIC opposing actor that
 * gained Taunt, never on a different opposing actor and never on the DPS dummy sink (`ctx.enemy`,
 * literal id `'enemy'` — engine.ts:1526). This is exactly the dummy-sink failure class documented
 * in `project_reactive_dot_routing_and_dummy_gate` (PR #244): a reactive listener that forgets to
 * route via eventCtx is invisible in single-dummy DPS/trace mode but breaks real multi-actor team
 * battles. A control run (no Taunt granted) proves the trigger doesn't fire unconditionally
 * (would have been the pre-fix behavior).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

// A no-op active (0-multiplier hit) so an actor with no offensive purpose still takes a valid
// turn each round without ending combat early or erroring.
const noopActiveSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'noop-atk',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
});

// Self-grants Taunt every time this actor casts its active — the minimal "an actor gains Taunt"
// trigger source for on-enemy-taunt-gained (rides the same buff-applied event as on-enemy-buffed;
// see applyOutgoingToEnemy.test.ts for this hand-built self-buff shape precedent).
const tauntSelfBuffSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'gain-taunt',
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Taunt',
                stacks: 1,
                isStackable: false,
                duration: 2,
                parsedEffects: {},
            },
        },
    ],
});

/** Collect every `debuff-applied` + `buff-applied` event from a run. */
function runAndCollect(input: CombatEngineInput) {
    const bus = createEventBus();
    const debuffsApplied: Extract<CombatEvent, { type: 'debuff-applied' }>[] = [];
    const buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('debuff-applied', (e) => debuffsApplied.push(e));
    bus.on('buff-applied', (e) => buffsApplied.push(e));
    runCombat({ ...input, bus });
    return { debuffsApplied, buffsApplied };
}

// =============================================================================
// Amartya — "When an enemy defender gains Taunt, this Unit inflicts 2 stacks of Exposed on that
// defender" (docs/ship-skills.csv, verbatim Taunt clause of the second passive).
// =============================================================================

const AMARTYA_TAUNT_P2 =
    'When an enemy defender gains <unit-skill>Taunt</unit-skill>, this Unit inflicts 2 stacks of <unit-skill>Exposed</unit-skill> on that defender.';

/** Extracts Amartya's Exposed-on-Taunt-gain debuff through the REAL parser/builder. */
function amartyaExposedAbility(): Ability {
    const abilities =
        buildShipAbilities(ship({ secondPassiveSkillText: AMARTYA_TAUNT_P2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? [];
    const exposed = abilities.find(
        (a) => a.type === 'debuff' && a.config.type === 'debuff' && a.config.buffName === 'Exposed'
    );
    if (!exposed) throw new Error('mutation guard: Amartya Exposed-on-Taunt-gain debuff not found');
    return exposed;
}

// Sanity-check the extracted ability BEFORE using it as engine input — a mutation guard so a
// regression in the parser/builder wiring fails loudly here rather than silently no-op'ing the
// engine tests below.
describe('Amartya Exposed (on Taunt gain) — extracted ability shape (mutation guard)', () => {
    it('rides on-enemy-taunt-gained, enemy-targeted, 2 stacks', () => {
        const exposed = amartyaExposedAbility();
        expect(exposed.trigger).toBe('on-enemy-taunt-gained');
        expect(exposed.target).toBe('enemy');
        expect(exposed.config).toMatchObject({ type: 'debuff', buffName: 'Exposed', stacks: 2 });
    });
});

describe('Amartya (player-side) — Exposed lands on the SPECIFIC opposing actor that gained Taunt, not the dummy', () => {
    const amartyaFocusSkills = (): ShipSkills => ({
        slots: [noopActiveSlot(), { slot: 'passive', abilities: [amartyaExposedAbility()] }],
    });

    // enemy-tauntgainer grants itself Taunt on its own turn.
    const enemyTauntGainer = (): EnemyAttacker =>
        ({
            id: 'enemy-tauntgainer',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 1000 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [tauntSelfBuffSlot()] },
        }) as EnemyAttacker;

    // enemy-bystander never gains any buff — proves Exposed does NOT land on an unrelated enemy.
    const enemyBystander = (): EnemyAttacker =>
        ({
            id: 'enemy-bystander',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 500 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [] } as ShipSkills,
        }) as EnemyAttacker;

    const BASE = (): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: amartyaFocusSkills(),
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
        speed: 1,
        healTargetId: 'attacker',
        enemyAttackers: [enemyTauntGainer(), enemyBystander()],
    });

    it('lands on enemy-tauntgainer (the REAL positional Taunt recipient), never on enemy-bystander or the DPS dummy ("enemy")', () => {
        const { debuffsApplied, buffsApplied } = runAndCollect(BASE());
        // Sanity: Taunt was actually granted this round (the reaction's trigger condition).
        expect(
            buffsApplied.some((b) => b.buffName === 'Taunt' && b.actorId === 'enemy-tauntgainer')
        ).toBe(true);
        const exposed = debuffsApplied.filter((d) => d.buffName === 'Exposed');
        expect(exposed.length).toBeGreaterThan(0);
        expect(exposed.every((d) => d.targetId === 'enemy-tauntgainer')).toBe(true);
        expect(exposed.some((d) => d.targetId === 'enemy-bystander')).toBe(false);
        // The dummy-sink regression this stamp guards against: without eventCtx.counterTargetId,
        // the debuff executor falls back to ctx.enemy.id (the literal 'enemy' dummy) — which is
        // NOT a real actor in this positional roster at all.
        expect(exposed.some((d) => d.targetId === 'enemy')).toBe(false);
    });

    it('control: WITHOUT any enemy gaining Taunt, Exposed never fires', () => {
        const noTauntInput: CombatEngineInput = {
            ...BASE(),
            enemyAttackers: [enemyBystander()],
        };
        const { debuffsApplied } = runAndCollect(noTauntInput);
        expect(debuffsApplied.some((d) => d.buffName === 'Exposed')).toBe(false);
    });
});

describe('Amartya (enemy-side) — team symmetry: an enemy Amartya reacts to a PLAYER actor gaining Taunt', () => {
    it('Exposed lands on the REAL player teamActor that gained Taunt (not the attacker, not any other actor)', () => {
        const enemyAmartya: EnemyAttacker = {
            id: 'enemy-amartya',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'passive', abilities: [amartyaExposedAbility()] }] },
        } as EnemyAttacker;

        const tauntGainingAlly: TeamActor = {
            id: 'ally-tauntgainer',
            speed: 1000,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [tauntSelfBuffSlot()] },
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 20_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        } as TeamActor;

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [noopActiveSlot()] },
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
            speed: 500,
            healTargetId: 'attacker',
            teamActors: [tauntGainingAlly],
            enemyAttackers: [enemyAmartya],
        };

        const { debuffsApplied, buffsApplied } = runAndCollect(input);
        expect(
            buffsApplied.some((b) => b.buffName === 'Taunt' && b.actorId === 'ally-tauntgainer')
        ).toBe(true);
        const exposed = debuffsApplied.filter((d) => d.buffName === 'Exposed');
        expect(exposed.length).toBeGreaterThan(0);
        expect(exposed.every((d) => d.targetId === 'ally-tauntgainer')).toBe(true);
        expect(exposed.some((d) => d.targetId === 'attacker')).toBe(false);
    });
});
