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

describe("a turn-blocked owner's passive AURA stops contributing", () => {
    // The aura channel is not a reaction: it is registered once at combat start and re-read on
    // every other actor's turn. So the suppression has to be a READ-time question, and it is —
    // `statusEngine.setTurnBlockedReader`. Consequence, which this block is what pins: the aura
    // vanishes the instant the Stasis lands and returns the instant it is removed, rather than at
    // some round boundary.
    //
    // OBSERVABLE: the damage an ALLY deals. The aura buffs the ally's attack, the ally is never
    // stasised, and only the CARRIER's state changes between arms — so a drop in the ally's damage
    // is the aura going away and nothing else.
    const AURA_BUFF = 'Squad Attack Up';

    const auraCarrier = (source?: 'equipment'): TeamActorEngineInput => {
        const a = reactor(source);
        a.id = 'carrier';
        a.position = 'M4';
        a.walk!.shipSkills = {
            slots: [
                basicAttack(),
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'all-allies',
                            ...(source ? { source } : {}),
                            config: {
                                type: 'buff',
                                buffName: AURA_BUFF,
                                parsedEffects: { attack: 100 },
                                stacks: 1,
                                isStackable: false,
                            },
                        }),
                    ],
                },
            ],
        };
        return a;
    };

    /** A fast ally that attacks a dummy every round. Its damage is the aura's readout. */
    const allyAttacker = (): TeamActorEngineInput => {
        const a = reactor();
        a.id = 'ally';
        a.position = 'M2';
        a.speed = 50;
        a.walk!.stats.attack = 1000;
        a.walk!.shipSkills = { slots: [basicAttack()] };
        return a;
    };

    const allyDamage = (opts: { block?: 'Stasis'; source?: 'equipment' }): number => {
        const bus = createEventBus();
        let dealt = 0;
        bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
            if (e.attackerId === 'ally') dealt += e.damage ?? 0;
        });
        runCombat({
            ...build({ block: opts.block }),
            teamActors: [auraCarrier(opts.source), allyAttacker()],
            bus,
        });
        return dealt;
    };

    it('control: an unblocked carrier buffs its ally', () => {
        // Both halves of the instrument: the aura must be worth measurable damage, and the ally
        // must actually be swinging.
        const withAura = allyDamage({});
        expect(withAura).toBeGreaterThan(0);
        expect(withAura).toBeGreaterThan(allyDamage({ block: 'Stasis' }));
    });

    it('a stasised carrier contributes nothing to its ally', () => {
        // Same board, same ally, same everything but the carrier's Stasis.
        expect(allyDamage({ block: 'Stasis' })).toBeLessThan(allyDamage({}));
    });

    it('but an EQUIPMENT-sourced aura keeps contributing while the carrier is stasised', () => {
        expect(allyDamage({ block: 'Stasis', source: 'equipment' })).toBe(
            allyDamage({ source: 'equipment' })
        );
    });
});

describe("a turn-blocked owner's accumulating passive banks no further stacks", () => {
    // The grant-vs-standing-status line once more: stacks ALREADY banked are standing state and
    // keep contributing, exactly as a stasised ship's Barrier does. What stops is the per-round
    // ACCRUAL, because that is the passive still firing. `per-active` / `per-charge` accrual needs
    // no gate at all — it rides the granter's own cast, which a turn-blocked ship never takes.
    //
    // OBSERVABLE: the ally's damage, the same instrument the aura block uses. The stacks buff the
    // ally's attack, so a run where the carrier keeps banking out-damages one where it cannot.
    // This measures the ACCRUAL stopping; it does not by itself measure banked stacks persisting,
    // which would need the Stasis to land mid-run.
    const ACCUM_BUFF = 'Squad Blast';

    const accumCarrier = (source?: 'equipment'): TeamActorEngineInput => {
        const a = reactor(source);
        a.id = 'carrier';
        a.position = 'M4';
        a.walk!.shipSkills = {
            slots: [
                basicAttack(),
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'all-allies',
                            ...(source ? { source } : {}),
                            config: {
                                type: 'buff',
                                buffName: ACCUM_BUFF,
                                parsedEffects: { attack: 50 },
                                stacks: 1,
                                isStackable: true,
                                stackTrigger: 'per-round',
                            },
                        }),
                    ],
                },
            ],
        };
        return a;
    };

    const allyAttacker = (): TeamActorEngineInput => {
        const a = reactor();
        a.id = 'ally';
        a.position = 'M2';
        a.speed = 50;
        a.walk!.stats.attack = 1000;
        a.walk!.shipSkills = { slots: [basicAttack()] };
        return a;
    };

    const allyDamage = (opts: { block?: 'Stasis'; source?: 'equipment' }): number => {
        const bus = createEventBus();
        let dealt = 0;
        bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
            if (e.attackerId === 'ally') dealt += e.damage ?? 0;
        });
        runCombat({
            ...build({ block: opts.block }),
            teamActors: [accumCarrier(opts.source), allyAttacker()],
            bus,
        });
        return dealt;
    };

    it('control: an unblocked carrier banks stacks its ally feels', () => {
        expect(allyDamage({})).toBeGreaterThan(0);
    });

    it('a stasised carrier banks none, so its ally hits for less', () => {
        expect(allyDamage({ block: 'Stasis' })).toBeLessThan(allyDamage({}));
    });

    it('but an EQUIPMENT-sourced accumulator keeps banking while the carrier is stasised', () => {
        expect(allyDamage({ block: 'Stasis', source: 'equipment' })).toBe(
            allyDamage({ source: 'equipment' })
        );
    });
});

// ── Owner-vs-recipient, and the two channels the first pass missed ───────────────────────────
// These three share a board the earlier blocks do not: the ship under test sits at the FRONT
// column so a `front`-targeting blocker always reaches IT and nobody else, and the readout ship
// sits behind it with a `back`-targeting hitter of its own. That separation is what lets an arm
// stasis one specific ship.
const SUT_FRONT = 'M4';
const READOUT_BACK = 'M2';

const selectingEnemy = (
    id: string,
    speed: number,
    slot: ShipSkills['slots'][number],
    attack: number,
    selection: Selection,
    /** One actor per cell: `SelectTargetsContext.enemyOccupied` assumes it, and two enemies on one
     *  cell make `colsFrontToBack` return that column twice — whichever actor the position map
     *  shadows then silently decides the readout. */
    position: 'M4' | 'M3'
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: HP, speed, hacking: 500, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget(selection),
    pattern: basePattern(),
    shipSkills: { slots: [slot] },
});

/** Positions never move between arms. The blocker picks its victim by SELECTION, so an arm can
 *  stasis exactly one ship without changing who the hitter reaches; the hitter always reaches the
 *  `back` ship, which is therefore the readout everywhere. */
const splitBoard = (opts: {
    front: TeamActorEngineInput;
    back: TeamActorEngineInput;
    block?: 'front' | 'back';
}): CombatEngineInput => ({
    ...build({}),
    teamActors: [opts.front, opts.back],
    enemyAttackers: [
        ...(opts.block
            ? [selectingEnemy('blocker', 900, blockingAttack('Stasis'), 1, opts.block, 'M4')]
            : []),
        selectingEnemy('hitter', 500, basicAttack(), 5000, 'back', 'M3'),
    ],
});

describe('the suppression asks the OWNER of the passive, not whoever it lands on', () => {
    // `incomingAbilitiesById` holds the #363 ally-scoped fan-out: a carrier's `all-allies`
    // incoming-reduction is stored in every RECIPIENT's list, with the real owner recorded
    // alongside. Gating that list on the recipient asks the wrong ship in BOTH directions, and
    // both directions are arms here.
    const protectionCarrier = (position: string): TeamActorEngineInput => {
        const a = reactor();
        a.id = 'carrier';
        a.position = position as TeamActorEngineInput['position'];
        a.walk!.shipSkills = {
            slots: [
                basicAttack(),
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'modifier',
                            target: 'all-allies',
                            config: {
                                type: 'incoming-reduction',
                                scope: 'direct',
                                condition: 'always',
                                pct: 50,
                                critFamily: false,
                            },
                        }),
                    ],
                },
            ],
        };
        return a;
    };

    const protectedAlly = (position: string): TeamActorEngineInput => {
        const a = reactor();
        a.id = 'protected';
        a.position = position as TeamActorEngineInput['position'];
        a.walk!.shipSkills = { slots: [basicAttack()] };
        return a;
    };

    /** Lowest HP% the PROTECTED ally reaches — more reduction leaves a higher floor. */
    const allyHpFloor = (blocked?: 'carrier' | 'protected'): number => {
        const bus = createEventBus();
        const seen: number[] = [];
        bus.on('hp-changed', (e: Extract<CombatEvent, { type: 'hp-changed' }>) => {
            if (e.targetId === 'protected') seen.push(e.newPct);
        });
        // Positions never move: the carrier is always at the front and the protected ally always
        // behind it, so the `back`-targeting hitter reaches the ally in every arm. Only which
        // SELECTION the blocker uses changes, which is how one arm stasises one specific ship.
        runCombat({
            ...splitBoard({
                front: protectionCarrier(SUT_FRONT),
                back: protectedAlly(READOUT_BACK),
                ...(blocked === 'carrier'
                    ? { block: 'front' as const }
                    : blocked === 'protected'
                      ? { block: 'back' as const }
                      : {}),
            }),
            bus,
        });
        return seen.length === 0 ? 100 : Math.min(...seen);
    };

    it('control: the ally is hit, and the carrier is worth a measurable share of it', () => {
        expect(allyHpFloor()).toBeLessThan(100);
        expect(allyHpFloor()).toBeGreaterThan(allyHpFloor('carrier'));
    });

    it('a stasised CARRIER stops protecting its allies', () => {
        expect(allyHpFloor('carrier')).toBeLessThan(allyHpFloor());
    });

    it('but a stasised RECIPIENT keeps the protection its teammate grants it', () => {
        // The passive belongs to the carrier, which can act; the victim's own Stasis has nothing
        // to do with it. Asking the recipient dropped the reduction here.
        expect(allyHpFloor('protected')).toBe(allyHpFloor());
    });
});

describe("a turn-blocked owner's all-allies MODIFIER aura stops too", () => {
    // `allAlliesModifierAbilitiesById` is its own channel, read straight off each living ally
    // rather than through the status store, so it needs its own gate and its own arm.
    const modifierCarrier = (): TeamActorEngineInput => {
        const a = reactor();
        a.id = 'carrier';
        a.position = SUT_FRONT;
        a.walk!.shipSkills = {
            slots: [
                basicAttack(),
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'modifier',
                            target: 'all-allies',
                            config: {
                                type: 'modifier',
                                channel: 'outgoingDamage',
                                value: 100,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        };
        return a;
    };

    const allyAttacker = (): TeamActorEngineInput => {
        const a = reactor();
        a.id = 'ally';
        a.position = READOUT_BACK;
        a.speed = 50;
        a.walk!.stats.attack = 1000;
        a.walk!.shipSkills = { slots: [basicAttack()] };
        return a;
    };

    /** Damage the ALLY deals. Only the carrier's Stasis differs between arms. */
    const allyDamage = (blockCarrier: boolean): number => {
        const bus = createEventBus();
        let dealt = 0;
        bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
            if (e.attackerId === 'ally') dealt += e.damage ?? 0;
        });
        runCombat({
            ...splitBoard({
                front: modifierCarrier(),
                back: allyAttacker(),
                ...(blockCarrier ? { block: 'front' as const } : {}),
            }),
            bus,
        });
        return dealt;
    };

    it('the ally swings in both arms, and swings harder with a free carrier', () => {
        expect(allyDamage(true)).toBeGreaterThan(0);
        expect(allyDamage(false)).toBeGreaterThan(allyDamage(true));
    });
});

describe('a board-wide enemy aura on a passive slot does not blow the stack', () => {
    // The suppression reader routes back into the status store (engine isStasised ->
    // ownerDebuffNamesFor -> activeAbilityStatuses -> the aura branch), and a board-wide enemy
    // aura re-enters through the `__enemy__` fold. Without the re-entrancy guard in
    // `shipPassiveSuppressed` this throws `RangeError: Maximum call stack size exceeded` out of
    // runCombat — every fight, not one number. No corpus kit carries such a passive today.
    it('runs a fight whose attacker holds an all-enemies passive aura', () => {
        const carrier = reactor();
        carrier.id = 'aura-carrier';
        carrier.walk!.shipSkills = {
            slots: [
                basicAttack(),
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'debuff',
                            target: 'all-enemies',
                            config: {
                                type: 'debuff',
                                buffName: 'Board Wide Weaken',
                                application: 'inflict',
                                stacks: 1,
                                isStackable: false,
                                parsedEffects: { attack: -10 },
                            },
                        }),
                    ],
                },
            ],
        };
        expect(() =>
            runCombat({ ...build({ block: 'Stasis' }), teamActors: [carrier] })
        ).not.toThrow();
    });
});
