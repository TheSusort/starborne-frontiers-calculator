/**
 * Ripper's catalogue passive: "When this Unit inflicts a debuff with its active or charged skills,
 * it also inflicts Inferno II for 2 turns" (R0), "… and all allies active buffs are extended by 1
 * turn" (R2). User-confirmed fight cases:
 *   (1) his active lands Inc. Repair Down II → he also inflicts Inferno II on THAT enemy;
 *   (2) his charged lands two debuffs on one enemy → ONE Inferno II on it, and allies' buffs are
 *       extended by 1 turn ONCE for the cast;
 *   (3) everything resisted → no Inferno, no extension;
 *   (4) a debuff his passive or an implant lands does not count;
 *   (5) the Inferno II he inflicts does not re-trigger the reaction (no chain, no throw);
 *   (6) an enemy-side Ripper behaves the same.
 *
 * Both abilities ride `on-debuff-inflicted` narrowed by `triggerSourceSlotFilter:
 * ['active','charged']` and capped by `oncePerCast` ('per-victim' for the Inferno, 'cast' for the
 * extension). Every negative sits beside a positive control on the same board: the resist arms
 * differ from the landing arms only in hacking/security, and each guard is stripped on its own
 * board to show the guarded event really is there.
 *
 * Real parsed kit (buildShipAbilities on the verbatim catalogue texts —
 * docs/ship-skills.catalogue.csv), real engine (runCombat). Hacking 200 vs security 0 lands every
 * roll; hacking 0 vs security 100 resists every roll.
 *
 * The Inferno II's own landing follows the reactive DoT executor's normal rule: Ripper's hacking
 * vs that enemy's security, drawn per application.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { executeIntent, IntentExecContext } from '../triggers';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { Ability, ShipSkills, SkillSlot } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

// Verbatim from docs/ship-skills.catalogue.csv (Ripper).
const RIPPER_ACTIVE =
    'This Unit deals <unit-damage>165% damage</unit-damage> and inflicts <unit-skill>Inc. Repair Down II</unit-skill> for 1 turn.';
const RIPPER_CHARGED =
    'This Unit deals <unit-damage>195% damage</unit-damage>, inflicts <unit-skill>Inc. Repair Down III</unit-skill> for 3 turns, and <unit-skill>Inc. DoT Damage Up II</unit-skill> for 2 turns.';
const RIPPER_PASSIVE_R0 =
    'When this Unit inflicts a <unit-aid>debuff</unit-aid> with its active or charged skills, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.';
const RIPPER_PASSIVE_R2 =
    'When this Unit inflicts a <unit-aid>debuff</unit-aid> with its active or charged skills, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns and all allies active <unit-skill>buffs are extended by 1 turn</unit-skill>.';

const parsedSlot = (slot: SkillSlot, passiveText: string) => {
    const ship = {
        refits: [],
        activeSkillText: RIPPER_ACTIVE,
        chargeSkillText: RIPPER_CHARGED,
        chargeSkillCharge: 3,
        firstPassiveSkillText: passiveText,
    } as unknown as Ship;
    const s = buildShipAbilities(ship).slots.find((x) => x.slot === slot);
    if (!s) throw new Error(`Ripper ${slot} slot missing`);
    return s;
};

const passiveAbility = (passiveText: string, type: Ability['config']['type']): Ability => {
    const a = parsedSlot('passive', passiveText).abilities.find((x) => x.config.type === type);
    if (!a) throw new Error(`Ripper passive ${type} ability missing`);
    return a;
};
const inferno = (): Ability => passiveAbility(RIPPER_PASSIVE_R0, 'dot');
// The R2 pair comes from ONE parse, as on a real ship: the per-cast cap is keyed by ability id,
// which is unique within a parse but not across two.
const infernoR2 = (): Ability => passiveAbility(RIPPER_PASSIVE_R2, 'dot');
const extension = (): Ability => passiveAbility(RIPPER_PASSIVE_R2, 'extend-status');

/** His REAL kit: parsed active + charged + the given passive abilities. */
const kit = (passive: Ability[], opts: { active?: Ability[] } = {}): ShipSkills => ({
    slots: [
        opts.active
            ? { slot: 'active', abilities: opts.active }
            : parsedSlot('active', RIPPER_PASSIVE_R0),
        parsedSlot('charged', RIPPER_PASSIVE_R0),
        { slot: 'passive', abilities: passive },
    ],
});
const realKitR0 = (): ShipSkills => kit([inferno()]);

const plainHit = (): Ability => ({
    id: 'plain-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

// A passive-slot proc: a Defense Down I he inflicts on the enemy he crits (the on-crit listener
// routes a debuff onto the crit victims). `source: 'equipment'` makes it an implant; absent, a
// ship passive. Both ride the passive slot.
const defenseDownProc = (source?: 'equipment'): Ability => ({
    id: 'passive-defense-down',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-crit',
    conditions: [],
    ...(source ? { source } : {}),
    config: {
        type: 'debuff',
        buffName: 'Defense Down I',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        duration: 2,
    },
});

const ALLY_BUFF = 'Attack Up I';
const allyBuff = (): Ability => ({
    id: 'ally-attack-up',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: ALLY_BUFF,
        parsedEffects: { attack: 10 },
        stacks: 1,
        isStackable: false,
        duration: 3,
    },
});
/** An ally that grants itself Attack Up I (3 turns) with its round-1 charged and never again. */
const allyBufferSkills = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'charged', abilities: [allyBuff()] },
    ],
});

const parsedFrontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const singleTargetPattern = (): ParsedPattern => ({
    raw: 'base',
    shape: 'base',
    range: 0,
    modifiers: {},
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const victimAt = (id: string, security: number): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 1, security },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

/** The buffing ally. `killer` gives its active a plain hit at overwhelming attack, so from round 2
 *  on it kills the front enemy before Ripper acts. */
const allyBuffer = (opts: { killer?: boolean } = {}): TeamActor => ({
    id: 'ally-buffer',
    speed: 150,
    chargeCount: 99,
    startCharged: true,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M3',
    target: parsedFrontTarget(),
    pattern: singleTargetPattern(),
    walk: {
        shipSkills: opts.killer
            ? {
                  slots: [
                      { slot: 'active', abilities: [plainHit()] },
                      { slot: 'charged', abilities: [allyBuff()] },
                  ],
              }
            : allyBufferSkills(),
        stats: {
            attack: opts.killer ? 1_000_000_000 : 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1_000_000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: true,
    },
});

const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 100,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 3,
    shipSkills: realKitR0(),
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
    hp: 1_000_000_000,
    hacking: 200,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedFrontTarget(),
    pattern: singleTargetPattern(),
    ...over,
});

const run = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of [
        'dot-applied',
        'debuff-applied',
        'debuff-resisted',
        'buff-expired',
    ] as const)
        bus.on(type, (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};

/** Rounds (one entry per landing) in which `sourceId` landed an Inferno on `targetId`. */
const infernoLandings = (events: CombatEvent[], sourceId: string, targetId: string) =>
    events.flatMap((e) =>
        e.type === 'dot-applied' &&
        e.sourceId === sourceId &&
        e.targetId === targetId &&
        e.dotType === 'inferno'
            ? [{ round: e.round, tier: e.tier }]
            : []
    );
/** Rounds (one entry per landing) in which `sourceId` landed the named debuff on `targetId`. */
const debuffLandingRounds = (
    events: CombatEvent[],
    sourceId: string,
    targetId: string,
    buffName?: string
): number[] =>
    events.flatMap((e) =>
        e.type === 'debuff-applied' &&
        e.sourceId === sourceId &&
        e.targetId === targetId &&
        (buffName === undefined || e.buffName === buffName)
            ? [e.round]
            : []
    );
const resistedRounds = (events: CombatEvent[], sourceId: string): number[] =>
    events.flatMap((e) =>
        e.type === 'debuff-resisted' && e.sourceId === sourceId ? [e.round] : []
    );
const expiryRound = (events: CombatEvent[], actorId: string): number | undefined =>
    events.find(
        (e) => e.type === 'buff-expired' && e.actorId === actorId && e.buffName === ALLY_BUFF
    )?.round;

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Ripper catalogue passive — parse', () => {
    it('R0: Inferno II (tier 30, 2 turns) on the landed-inflict trigger, active/charged only, once per (cast, victim)', () => {
        expect(inferno()).toMatchObject({
            type: 'dot',
            target: 'enemy',
            trigger: 'on-debuff-inflicted',
            triggerApplicationFilter: 'inflict',
            triggerSourceSlotFilter: ['active', 'charged'],
            oncePerCast: 'per-victim',
            config: { type: 'dot', dotType: 'inferno', tier: 30, stacks: 1, duration: 2 },
        });
    });

    it('R2: the all-allies buff extension rides the same reaction, once per cast', () => {
        expect(extension()).toMatchObject({
            target: 'all-allies',
            trigger: 'on-debuff-inflicted',
            triggerApplicationFilter: 'inflict',
            triggerSourceSlotFilter: ['active', 'charged'],
            oncePerCast: 'cast',
            config: { type: 'extend-status', statusKind: 'buff', turns: 1 },
        });
    });
});

describe('Ripper — Inferno II on a debuff his active or charged lands', () => {
    it('(1) his active lands Inc. Repair Down II → Inferno II (tier 30) on that enemy, every landing', () => {
        const events = run(BASE({ enemyAttackers: [victimAt('victim', 0)] }));
        const landed = debuffLandingRounds(events, 'attacker', 'victim', 'Inc. Repair Down II');
        expect(landed).toEqual([1, 2, 3]);
        expect(infernoLandings(events, 'attacker', 'victim')).toEqual(
            landed.map((round) => ({ round, tier: 30 }))
        );
    });

    it('(1) the cast-path landing carries the firing slot the filter reads', () => {
        const events = run(BASE({ enemyAttackers: [victimAt('victim', 0)] }));
        const slots = events.flatMap((e) =>
            e.type === 'debuff-applied' && e.buffName === 'Inc. Repair Down II'
                ? [e.sourceSlot]
                : []
        );
        expect(slots).toEqual(['active', 'active', 'active']);
    });

    it('(3) his active resisted → no Inferno', () => {
        const events = run(BASE({ hacking: 0, enemyAttackers: [victimAt('victim', 100)] }));
        expect(resistedRounds(events, 'attacker')).toEqual([1, 2, 3]);
        expect(debuffLandingRounds(events, 'attacker', 'victim')).toEqual([]);
        expect(infernoLandings(events, 'attacker', 'victim')).toEqual([]);
    });

    it('(2) his charged lands two debuffs on one enemy → ONE Inferno II for that cast', () => {
        const events = run(
            BASE({
                numRounds: 1,
                hasChargedSkill: true,
                startCharged: true,
                enemyAttackers: [victimAt('victim', 0)],
            })
        );
        expect(debuffLandingRounds(events, 'attacker', 'victim')).toEqual([1, 1]);
        expect(infernoLandings(events, 'attacker', 'victim')).toEqual([{ round: 1, tier: 30 }]);
    });

    it('control: the same charged cast with the per-cast cap stripped lands one Inferno per debuff', () => {
        const uncapped: Ability = { ...inferno(), oncePerCast: undefined };
        const events = run(
            BASE({
                numRounds: 1,
                hasChargedSkill: true,
                startCharged: true,
                shipSkills: kit([uncapped]),
                enemyAttackers: [victimAt('victim', 0)],
            })
        );
        expect(debuffLandingRounds(events, 'attacker', 'victim')).toEqual([1, 1]);
        expect(infernoLandings(events, 'attacker', 'victim')).toHaveLength(2);
    });

    it('(2) a cast that debuffs two enemies inflicts one Inferno II on EACH of them', () => {
        const aoeDebuff: Ability = {
            id: 'aoe-inc-repair-down',
            type: 'debuff',
            target: 'all-enemies',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Inc. Repair Down II',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                application: 'inflict',
                duration: 1,
            },
        };
        const events = run(
            BASE({
                numRounds: 1,
                pattern: { raw: 'all', shape: 'all', range: 'all', modifiers: {} },
                shipSkills: kit([inferno()], { active: [plainHit(), aoeDebuff] }),
                enemyAttackers: [
                    victimAt('victim', 0),
                    { ...victimAt('victim-2', 0), position: 'M3' },
                ],
            })
        );
        for (const id of ['victim', 'victim-2']) {
            expect(debuffLandingRounds(events, 'attacker', id)).toEqual([1]);
            expect(infernoLandings(events, 'attacker', id)).toEqual([{ round: 1, tier: 30 }]);
        }
    });

    it.each([
        ['an implant', 'equipment' as const],
        ['his own passive', undefined],
    ])('(4) a Defense Down %s lands → no Inferno', (_label, source) => {
        const events = run(
            BASE({
                crit: 100,
                shipSkills: kit([inferno(), defenseDownProc(source)], { active: [plainHit()] }),
                enemyAttackers: [victimAt('victim', 0)],
            })
        );
        expect(debuffLandingRounds(events, 'attacker', 'victim', 'Defense Down I')).toEqual([
            1, 2, 3,
        ]);
        expect(infernoLandings(events, 'attacker', 'victim')).toEqual([]);
    });

    it('control: the same board with the slot filter stripped DOES inflict Inferno off that Defense Down', () => {
        const unfiltered: Ability = { ...inferno(), triggerSourceSlotFilter: undefined };
        const events = run(
            BASE({
                crit: 100,
                shipSkills: kit([unfiltered, defenseDownProc('equipment')], {
                    active: [plainHit()],
                }),
                enemyAttackers: [victimAt('victim', 0)],
            })
        );
        const landed = debuffLandingRounds(events, 'attacker', 'victim', 'Defense Down I');
        expect(landed).toEqual([1, 2, 3]);
        expect(infernoLandings(events, 'attacker', 'victim').map((x) => x.round)).toEqual(landed);
    });

    it('(5) his own Inferno II never re-triggers the reaction: one Inferno per landing, no throw', () => {
        const events = run(BASE({ numRounds: 4, enemyAttackers: [victimAt('victim', 0)] }));
        const landed = debuffLandingRounds(events, 'attacker', 'victim');
        expect(landed.length).toBeGreaterThan(0);
        expect(infernoLandings(events, 'attacker', 'victim')).toHaveLength(landed.length);
    });

    it('(5) with the slot filter AND the per-cast cap stripped, the self-chain brand alone stops the chain', () => {
        const bare: Ability = {
            ...inferno(),
            triggerSourceSlotFilter: undefined,
            oncePerCast: undefined,
        };
        const events = run(
            BASE({ shipSkills: kit([bare]), enemyAttackers: [victimAt('victim', 0)] })
        );
        const landed = debuffLandingRounds(events, 'attacker', 'victim');
        expect(landed).toEqual([1, 2, 3]);
        expect(infernoLandings(events, 'attacker', 'victim').map((x) => x.round)).toEqual(landed);
    });
});

describe('Ripper R2 — allies’ buffs extended once per cast that lands a debuff', () => {
    // His active is a plain hit and his charge cost outlasts the fight, so the round-1 charged
    // is the only cast that can land a debuff; the ally's Attack Up I (granted before Ripper acts
    // in round 1) then expires one round later per extension.
    const boardFor = (passive: Ability[], hacking: number, security: number) =>
        BASE({
            numRounds: 6,
            chargeCount: 10,
            hacking,
            hasChargedSkill: true,
            startCharged: true,
            shipSkills: kit(passive, { active: [plainHit()] }),
            enemyAttackers: [victimAt('victim', security)],
            teamActors: [allyBuffer()],
        });
    const baselineExpiry = () => expiryRound(run(boardFor([infernoR2()], 200, 0)), 'ally-buffer');

    it('baseline: without the extension the ally buff expires inside the fight', () => {
        expect(baselineExpiry()).toBeDefined();
    });

    it('(2) the charged landing two debuffs extends the ally buff by exactly 1 turn', () => {
        const base = baselineExpiry() as number;
        const events = run(boardFor([infernoR2(), extension()], 200, 0));
        expect(debuffLandingRounds(events, 'attacker', 'victim')).toEqual([1, 1]);
        expect(expiryRound(events, 'ally-buffer')).toBe(base + 1);
    });

    it('control: the same cast with the per-cast cap stripped extends by 2 (one per debuff)', () => {
        const base = baselineExpiry() as number;
        const uncapped: Ability = { ...extension(), oncePerCast: undefined };
        const events = run(boardFor([infernoR2(), uncapped], 200, 0));
        expect(expiryRound(events, 'ally-buffer')).toBe(base + 2);
    });

    it('(3) the charged fully resisted → no extension', () => {
        const base = baselineExpiry() as number;
        const events = run(boardFor([infernoR2(), extension()], 0, 100));
        expect(resistedRounds(events, 'attacker')).toEqual([1, 1]);
        expect(expiryRound(events, 'ally-buffer')).toBe(base);
    });
});

describe('Ripper — team symmetry (enemy-side Ripper)', () => {
    const enemyRipper = (hacking: number, passive: Ability[] = [inferno()]): EnemyAttacker => ({
        id: 'ripper-enemy',
        stats: {
            attack: 100,
            crit: 0,
            critDamage: 0,
            speed: 200,
            hp: 1_000_000,
            defence: 0,
            hacking,
        },
        chargeCount: 3,
        startCharged: false,
        position: 'M4',
        shipSkills: kit(passive),
    });
    const runEnemySide = (hacking: number, playerSecurity: number) =>
        run(
            BASE({
                attack: 0,
                shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                security: playerSecurity,
                speed: 1,
                enemyAttackers: [enemyRipper(hacking)],
            })
        );

    it('(6) an enemy-side Ripper landing Inc. Repair Down II inflicts Inferno II on that player ship', () => {
        const events = runEnemySide(200, 0);
        const landed = debuffLandingRounds(
            events,
            'ripper-enemy',
            'attacker',
            'Inc. Repair Down II'
        );
        expect(landed.length).toBeGreaterThan(0);
        expect(infernoLandings(events, 'ripper-enemy', 'attacker')).toEqual(
            landed.map((round) => ({ round, tier: 30 }))
        );
    });

    it('(6) an enemy-side Ripper whose debuff is resisted inflicts no Inferno', () => {
        const events = runEnemySide(0, 100);
        expect(resistedRounds(events, 'ripper-enemy').length).toBeGreaterThan(0);
        expect(debuffLandingRounds(events, 'ripper-enemy', 'attacker')).toEqual([]);
        expect(infernoLandings(events, 'ripper-enemy', 'attacker')).toEqual([]);
    });

    // The R2 extension on the enemy side: an enemy-side ally grants itself Attack Up I before the
    // enemy Ripper's round-1 charged, which is his only debuff-landing cast (same isolation as the
    // player-side board).
    const enemySideExtensionBoard = (
        passive: Ability[],
        hacking: number,
        playerSecurity: number
    ) => {
        const ripper: EnemyAttacker = {
            ...enemyRipper(hacking),
            chargeCount: 10,
            startCharged: true,
            shipSkills: kit(passive, { active: [plainHit()] }),
        };
        const enemyAlly: EnemyAttacker = {
            id: 'enemy-buffer',
            stats: { attack: 0, crit: 0, critDamage: 0, speed: 300, hp: 1_000_000, defence: 0 },
            chargeCount: 99,
            startCharged: true,
            position: 'M3',
            shipSkills: allyBufferSkills(),
        };
        return BASE({
            numRounds: 6,
            attack: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
            security: playerSecurity,
            speed: 1,
            enemyAttackers: [ripper, enemyAlly],
        });
    };

    it("(6) an enemy-side Ripper's charged extends his ally's buff by 1 turn; resisted, by none", () => {
        const base = expiryRound(
            run(enemySideExtensionBoard([infernoR2()], 200, 0)),
            'enemy-buffer'
        ) as number;
        expect(base).toBeDefined();
        const landed = run(enemySideExtensionBoard([infernoR2(), extension()], 200, 0));
        expect(debuffLandingRounds(landed, 'ripper-enemy', 'attacker')).toEqual([1, 1]);
        expect(expiryRound(landed, 'enemy-buffer')).toBe(base + 1);
        const resisted = run(enemySideExtensionBoard([infernoR2(), extension()], 0, 100));
        expect(resistedRounds(resisted, 'ripper-enemy')).toEqual([1, 1]);
        expect(expiryRound(resisted, 'enemy-buffer')).toBe(base);
    });
});

// Hand-built active pieces for the cast-cardinality boards below.
const incRepairDown = (): Ability => ({
    id: 'hand-inc-repair-down',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Inc. Repair Down II',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        duration: 1,
    },
});
const twoHitStrike = (): Ability => ({
    id: 'two-hit-strike',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 2 },
});
const extraActionOncePerRound = (): Ability => ({
    id: 'extra-action',
    type: 'extra-action',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'extra-action', oncePerRound: true },
});
const corrosionDot = (target: Ability['target']): Ability => ({
    id: 'own-corrosion',
    type: 'dot',
    target,
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 3 },
});

describe('Ripper — the cap is per CAST (each hit of a multi-hit skill is one), not per round', () => {
    it('an extra action in the same round is a second cast: 2 landings → 2 Infernos in round 1', () => {
        const events = run(
            BASE({
                numRounds: 1,
                shipSkills: kit([inferno()], {
                    active: [plainHit(), incRepairDown(), extraActionOncePerRound()],
                }),
                enemyAttackers: [victimAt('victim', 0)],
            })
        );
        expect(debuffLandingRounds(events, 'attacker', 'victim')).toEqual([1, 1]);
        expect(infernoLandings(events, 'attacker', 'victim')).toEqual([
            { round: 1, tier: 30 },
            { round: 1, tier: 30 },
        ]);
    });

    it('each hit of a 2-hit active is its own action (R166): 2 landings → 2 Infernos', () => {
        // The cap within one hit is pinned by "(2) his charged lands two debuffs on one enemy".
        const events = run(
            BASE({
                numRounds: 1,
                shipSkills: kit([inferno()], { active: [twoHitStrike(), incRepairDown()] }),
                enemyAttackers: [victimAt('victim', 0)],
            })
        );
        expect(debuffLandingRounds(events, 'attacker', 'victim')).toEqual([1, 1]);
        expect(infernoLandings(events, 'attacker', 'victim')).toEqual([
            { round: 1, tier: 30 },
            { round: 1, tier: 30 },
        ]);
    });

    // R2: Ripper casts twice in round 1 (extra action) on victim A. In round 2 the ally kills A
    // before Ripper acts, so his later casts hit victim B, who resists everything — round 1's two
    // casts are the only ones that extend the ally's Attack Up I.
    const extraActionBoard = (passive: Ability[]) =>
        BASE({
            numRounds: 6,
            speed: 100,
            shipSkills: kit(passive, {
                active: [plainHit(), incRepairDown(), extraActionOncePerRound()],
            }),
            enemyAttackers: [
                victimAt('victim', 0),
                // Beyond the ally's power to kill and Ripper's to debuff.
                {
                    ...victimAt('victim-b', 1_000_000),
                    stats: { ...victimAt('victim-b', 1_000_000).stats, hp: 1e15 },
                    position: 'M3',
                },
            ],
            teamActors: [allyBuffer({ killer: true })],
        });

    it('R2: two casts in one round extend the ally buff by 2 (one per cast)', () => {
        const base = expiryRound(run(extraActionBoard([infernoR2()])), 'ally-buffer') as number;
        expect(base).toBeDefined();
        const events = run(extraActionBoard([infernoR2(), extension()]));
        expect(debuffLandingRounds(events, 'attacker', 'victim')).toEqual([1, 1]);
        expect(debuffLandingRounds(events, 'attacker', 'victim-b')).toEqual([]);
        expect(resistedRounds(events, 'attacker').length).toBeGreaterThan(0);
        expect(expiryRound(events, 'ally-buffer')).toBe(base + 2);
    });
});

describe('Ripper — a DoT his active inflicts carries the firing slot', () => {
    // A Corrosion his active lands is a debuff "with its active skill": the slot-filtered Inferno
    // reaction fires off it. The primary victim's Corrosion comes from the cast's primary DoT
    // emit, the neighbour's from its splash emit.
    it('his active Corrosion on the target and its neighbour → Inferno II on each', () => {
        const events = run(
            BASE({
                numRounds: 1,
                shipSkills: kit([inferno()], {
                    active: [plainHit(), corrosionDot('target-and-adjacent-enemies')],
                }),
                enemyAttackers: [
                    victimAt('victim', 0),
                    { ...victimAt('victim-2', 0), position: 'M3' },
                ],
            })
        );
        for (const id of ['victim', 'victim-2']) {
            expect(
                events.flatMap((e) =>
                    e.type === 'dot-applied' && e.targetId === id && e.dotType === 'corrosion'
                        ? [e.sourceSlot]
                        : []
                )
            ).toEqual(['active']);
            expect(infernoLandings(events, 'attacker', id)).toEqual([{ round: 1, tier: 30 }]);
        }
    });
});

describe('Ripper R2 — the extension skips a dead ally', () => {
    const timedBuff = (): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
        kind: 'timed',
        side: 'self',
        sourceSlot: 'active',
        conditions: [],
        duration: 2,
        payload: { buffName: ALLY_BUFF, stacks: 1, parsedEffects: { attack: 10 } },
    });
    const turnsOf = (se: ReturnType<typeof createStatusEngine>, id: string) =>
        se.timedAbilityStatuses('self', id).find((s) => s.payload.buffName === ALLY_BUFF)?.active
            .turnsRemaining;

    it("extends a live ally's buff and leaves a dead ally's alone", () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        for (const id of ['attacker', 'live-ally', 'dead-ally'])
            se.applyTimedAbilityStatus(1, timedBuff(), id);
        const runtime = {
            actor: { id: 'attacker', chargeCount: 0, charges: 0 },
            selfBuffLookup: new Map(),
            enemyDebuffLookup: new Map(),
        } as never;
        const ctx = {
            round: 1,
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['attacker', runtime]]),
            grantAllyCharges: () => {},
            grantExtraAction: () => {},
            playerIds: ['attacker', 'live-ally', 'dead-ally'],
            isActorAlive: (id: string) => id !== 'dead-ally',
            turnsTakenFor: () => 1,
            oncePerRoundConsumed: new Set<string>(),
            lastTurnCtxByActor: new Map(),
            recordResisted: () => {},
            lowestHpAllyIdFor: () => undefined,
        } as unknown as IntentExecContext;
        const before = turnsOf(se, 'live-ally') as number;
        expect(turnsOf(se, 'dead-ally')).toBe(before);
        executeIntent(
            {
                ability: extension(),
                sourceSlot: 'passive',
                ownerId: 'attacker',
                eventCtx: { debuffVictimId: 'victim' },
            },
            ctx
        );
        expect(turnsOf(se, 'attacker')).toBe(before + 1);
        expect(turnsOf(se, 'live-ally')).toBe(before + 1);
        expect(turnsOf(se, 'dead-ally')).toBe(before);
    });
});
