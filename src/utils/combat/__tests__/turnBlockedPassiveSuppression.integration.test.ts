/**
 * A ship's PASSIVE SKILL is inactive while its owner is stasised or disabled.
 *
 * LOCKED RULING (owner, 2026-09-15): *"Every passive is disabled when under stasis/disable. The
 * reason why barrier works, is that barrier is a buff that is consumed on hit. If it was a passive
 * that grants barrier, barrier would not be granted under stasis."*
 *
 * So the line is GRANT vs STANDING STATUS: a status already on the ship keeps working and is still
 * consumed and ticked normally; what stops is the passive ABILITY firing. Two carve-outs, both
 * ruled rather than convenient:
 *  - EQUIPMENT (`Ability.source === 'equipment'`) — gear-set bonuses and implant effects are not
 *    the ship's passive skill and keep working. They share the passive slot, which is why
 *    provenance rides the ability; see `Ability.source` and `equipmentAbilityProvenance.test.ts`.
 *  - THE OWNER'S OWN DEATH REACTION — death releases it, so a ship that dies stasised still
 *    resolves its `on-destroyed` passive.
 *
 * This file covers the REACTIVE family, which all drains through one gate in `executeIntent`
 * (triggers.ts). The aura and incoming/outgoing channels have their own files.
 *
 * OBSERVABLE: the `buff-applied` event for the reaction's own buff name. Reading the buff off a
 * round snapshot instead would conflate "the reaction fired" with "a buff from somewhere else is
 * standing", which is the exact distinction this ruling turns on.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type Selection = ParsedTarget['selection'];

const REACTION_BUFF = 'Reactive Up';
const DEATH_BUFF = 'Last Stand';
const HP = 10_000_000;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `tbps${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: Selection): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** The SUT passive: when this unit is directly damaged it buffs itself. `source` decides whether
 *  it is the ship's own skill (absent) or a gear/implant effect ('equipment'). */
const onAttackedSelfBuff = (source?: 'equipment'): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        trigger: 'on-attacked',
        ...(source ? { source } : {}),
        config: {
            type: 'buff',
            buffName: REACTION_BUFF,
            parsedEffects: { attack: 25 },
            stacks: 1,
            isStackable: false,
            duration: 2,
        },
    });

const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

/** A cast that lands the named control debuff and no damage, so the victim is blocked without
 *  its Stasis being reduced by the applier's own hit. */
const blockingAttack = (buffName: 'Stasis' | 'Disable'): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 0 } }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName,
                application: 'inflict',
                duration: 6,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        }),
    ],
});

/** The reacting ship. Slow, so the blocker and the hitter both act before it each round. */
const reactor = (source?: 'equipment'): TeamActorEngineInput => ({
    id: 'reactor',
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    walk: {
        shipSkills: {
            slots: [basicAttack(), { slot: 'passive', abilities: [onAttackedSelfBuff(source)] }],
        },
        stats: {
            attack: 1,
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
        healModifier: 0,
    },
});

const enemy = (
    id: string,
    speed: number,
    slot: ShipSkills['slots'][number],
    attack: number
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: HP, speed, hacking: 500, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position: id === 'blocker' ? 'M4' : 'M3',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [slot] },
});

const build = (opts: {
    block?: 'Stasis' | 'Disable';
    source?: 'equipment';
}): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
    numRounds: 3,
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
    hacking: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'B1',
    speed: 2,
    target: parsedTarget('front'),
    pattern: basePattern(),
    teamActors: [reactor(opts.source)],
    enemyAttackers: [
        ...(opts.block ? [enemy('blocker', 900, blockingAttack(opts.block), 1)] : []),
        enemy('hitter', 500, basicAttack(), 5000),
    ],
});

const reactionsFired = (input: CombatEngineInput): number => {
    const bus = createEventBus();
    let fired = 0;
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.actorId === 'reactor' && e.buffName === REACTION_BUFF) fired++;
    });
    runCombat({ ...input, bus });
    return fired;
};

describe("a turn-blocked owner's ship passive does not fire", () => {
    it('control: an unblocked reactor buffs itself every time it is hit', () => {
        // The instrument. Without this arm a zero below would be indistinguishable from "the
        // hitter never connected".
        expect(reactionsFired(build({}))).toBeGreaterThan(0);
    });

    it('STASIS suppresses it', () => {
        expect(reactionsFired(build({ block: 'Stasis' }))).toBe(0);
    });

    it('DISABLE suppresses it too — the rule is stasis OR disable', () => {
        expect(reactionsFired(build({ block: 'Disable' }))).toBe(0);
    });

    it("a STASISED ship's own death reaction still fires — death releases it", () => {
        // Salvation's shape: an `on-destroyed` passive that buffs the surviving allies. The ship
        // is stasised when it dies, so every other passive of its is off; this one is exempt.
        const martyr = reactor();
        martyr.id = 'martyr';
        martyr.walk!.stats.hp = 1; // the hitter one-shots it in round 1
        martyr.walk!.shipSkills = {
            slots: [
                basicAttack(),
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'all-allies',
                            trigger: 'on-destroyed',
                            config: {
                                type: 'buff',
                                buffName: DEATH_BUFF,
                                parsedEffects: { attack: 10 },
                                stacks: 1,
                                isStackable: false,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        };
        const survivor = reactor();
        survivor.id = 'survivor';
        survivor.position = 'M2';
        survivor.walk!.shipSkills = { slots: [basicAttack()] };

        const deathBuffs = (block?: 'Stasis'): number => {
            const bus = createEventBus();
            let n = 0;
            bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
                if (e.buffName === DEATH_BUFF) n++;
            });
            runCombat({ ...build({ block }), teamActors: [martyr, survivor], bus });
            return n;
        };

        // NON-VACUITY: the same death on an unblocked martyr must produce the buff, or the zero
        // this arm is guarding against would be unreachable in both directions.
        expect(deathBuffs()).toBeGreaterThan(0);
        expect(deathBuffs('Stasis')).toBeGreaterThan(0);
    });

    it('but an EQUIPMENT-sourced reaction keeps firing while stasised', () => {
        // Gear sets and implants are not the ship's passive skill. Same board, same Stasis, the
        // only difference is `Ability.source`.
        expect(reactionsFired(build({ block: 'Stasis', source: 'equipment' }))).toBeGreaterThan(0);
    });
});
