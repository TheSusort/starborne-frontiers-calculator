/**
 * A reactive debuff lands on the enemy the TRIGGER names — never the vestigial DPS sink.
 *
 * `on-debuff-inflicted` stamps the debuffed enemy as `eventCtx.debuffVictimId` (triggers.ts's
 * listener), but the reactive `debuff` executor resolved its victim from `counterTargetId` alone
 * and fell through to `ctx.enemy.id` — the huge-HP `enemy` actor that "never dies" in sim mode
 * (engine.ts's `createActor({ id: 'enemy' })`). So Warden's "when this Unit inflicts a Debuff, it
 * inflicts Out. Damage Down II for 1 turn" landed on a ghost and did nothing to the real enemy.
 *
 * Same failure shape as the reaction-applied Bombs fixed in #286 (an effect routed into the
 * dummy's containers), one field over: there the `dot` executor read only `victimId` while
 * on-attacked stamps `counterTargetId`; here the `debuff` executor read only `counterTargetId`
 * while on-debuff-inflicted stamps `debuffVictimId`. The reactive `damage` branch already
 * consumes `debuffVictimId` (Insidiousness) — this brings the sibling `debuff` branch in line.
 */
import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';

// docs/ship-skills.csv, Warden's passive row (verbatim).
const WARDEN_PASSIVE =
    'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and <unit-damage>repairs itself 3%</unit-damage> of its Max HP.<br /><br />Additionally, when this Unit inflicts a Debuff, it inflicts <unit-skill>Out. Damage Down II</unit-skill> for 1 turn.';

function passiveAbilities(text: string): Ability[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ship = { refits: [], firstPassiveSkillText: text } as any as Ship;
    return buildShipAbilities(ship).slots.flatMap((s) => s.abilities);
}

const damageAbility = (id: string, multiplier: number): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier, hits: 1 },
});

/** The cast-path debuff whose infliction fires the on-debuff-inflicted reaction. */
const castDebuff = (): Ability => ({
    id: 'cast-debuff',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Defense Down II',
        parsedEffects: { defense: -30 },
        stacks: 1,
        isStackable: false,
        duration: 2,
        application: 'inflict',
    },
});

function runWardenFight(): Extract<CombatEvent, { type: 'debuff-applied' }>[] {
    const bus = createEventBus();
    const applied: Extract<CombatEvent, { type: 'debuff-applied' }>[] = [];
    bus.on('debuff-applied', (e) => applied.push(e));

    const wardenSkills: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [damageAbility('atk', 100), castDebuff()] },
            { slot: 'passive', abilities: passiveAbilities(WARDEN_PASSIVE) },
        ],
    };

    const input: CombatEngineInput = {
        attack: 10_000,
        crit: 0,
        critDamage: 150,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: wardenSkills,
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
        hp: 1_000_000,
        speed: 500, // Warden acts first
        hacking: 100_000, // land every debuff deterministically
        healTargetId: 'attacker',
        mode: 'battle',
        position: 'M1',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        enemyAttackers: [
            {
                id: 'foe',
                stats: {
                    attack: 1000,
                    crit: 0,
                    critDamage: 0,
                    speed: 100,
                    defence: 0,
                    hp: 500_000,
                    security: 0,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M1',
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                shipSkills: { slots: [{ slot: 'active', abilities: [damageAbility('foe', 50)] }] },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        ],
        bus,
    };

    runCombat(input);
    return applied;
}

describe('reactive debuff routing — on-debuff-inflicted', () => {
    it("Warden's Out. Damage Down II lands on the enemy it just debuffed, not the DPS sink", () => {
        const applied = runWardenFight();

        // The triggering cast debuff went to the real positioned enemy.
        expect(applied.some((e) => e.buffName === 'Defense Down II' && e.targetId === 'foe')).toBe(
            true
        );

        const reactive = applied.filter((e) => e.buffName === 'Out. Damage Down II');
        expect(reactive.length).toBeGreaterThan(0);
        // Every reactive application is routed onto a REAL actor — never the vestigial 'enemy'.
        expect(reactive.map((e) => e.targetId)).not.toContain('enemy');
        expect(reactive.some((e) => e.targetId === 'foe')).toBe(true);
        expect(reactive.every((e) => e.sourceId === 'attacker')).toBe(true);
    });
});
