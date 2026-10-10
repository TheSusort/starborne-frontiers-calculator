/**
 * Lingshe's "When this Unit inflicts a Bomb it gains Stealth for 1 turn." (our R0 passive, the
 * catalogue's R0/R2/R4) reacts only to one of HER Bombs LANDING:
 *   - her active lands Bomb I → she gains Stealth that turn;
 *   - a non-Bomb debuff she lands (an implant-style Defense Down proc) → no Stealth;
 *   - her Bomb is resisted → no Stealth;
 *   - a Corrosion she lands (another DoT, the dot-applied arm) → no Stealth;
 *   - a teammate's Bomb lands → no Stealth for her.
 *
 * The passive rides `on-debuff-inflicted` narrowed by `Ability.triggerStatusFilter: 'Bomb'`
 * (triggers.ts `passesStatusFilter`). Each negative arm sits next to a positive control on the
 * same board so a zero cannot be "the reaction never could fire": the Defense Down and Corrosion
 * arms rerun with the filter stripped (the bare trigger DOES wake on that landing), the resist
 * arm is the landing arm with only the victim's security raised, and the teammate's-Bomb board
 * also carries her own Bomb.
 *
 * Real parsed kit (buildShipAbilities on verbatim docs/ship-skills.csv text), real engine
 * (runCombat). Hacking 200 vs security 0 lands every roll; hacking 0 vs security 100 resists
 * every roll — both deterministic, no seed dependence on the landing gate.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

// Verbatim from docs/ship-skills.csv (Lingshe active_skill_text / first_passive_skill_text).
const LINGSHE_ACTIVE =
    'This Unit inflicts 3 stacks of <unit-skill>Bomb I</unit-skill> for 4 turns.';
const LINGSHE_PASSIVE_R0 =
    'When this Unit inflicts a <unit-skill>Bomb</unit-skill> it gains <unit-skill>Stealth</unit-skill> for 1 turn.';

const lingsheShip = (): Ship =>
    ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [],
        activeSkillText: LINGSHE_ACTIVE,
        firstPassiveSkillText: LINGSHE_PASSIVE_R0,
    }) as Ship;

const parsedSlot = (slot: 'active' | 'passive') => {
    const s = buildShipAbilities(lingsheShip()).slots.find((x) => x.slot === slot);
    if (!s) throw new Error(`Lingshe ${slot} slot missing`);
    return s;
};

const stealthAbility = (): Ability => {
    const a = parsedSlot('passive').abilities.find(
        (x) => x.config.type === 'buff' && x.config.buffName === 'Stealth'
    );
    if (!a) throw new Error('Lingshe Stealth ability missing');
    return a;
};

// An implant-style proc: an equipment-sourced Defense Down I she inflicts on the enemy she
// critically hits (the on-crit listener routes a debuff onto the crit victims).
const defenseDownProc = (): Ability => ({
    id: 'implant-defense-down',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-crit',
    conditions: [],
    source: 'equipment',
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

const plainHit = (): Ability => ({
    id: 'plain-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

const corrosionCast = (): Ability => ({
    id: 'own-corrosion',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 3 },
});

const bombCast = (): Ability => ({
    id: 'ally-bomb',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 4 },
});

/** Her REAL kit: parsed Bomb I active + parsed Stealth passive. */
const realKit = (): ShipSkills => ({ slots: [parsedSlot('active'), parsedSlot('passive')] });

/** No Bomb anywhere: a plain hit that procs an implant Defense Down, plus her Stealth passive. */
const defenseDownKit = (stealth: Ability): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [plainHit()] },
        { slot: 'passive', abilities: [stealth, defenseDownProc()] },
    ],
});

/** No Bomb anywhere: an active that lands her own Corrosion, plus her Stealth passive. */
const corrosionKit = (stealth: Ability): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [corrosionCast()] },
        { slot: 'passive', abilities: [stealth] },
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

const victimAt = (id: string, security: number): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 1, security },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 100,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: realKit(),
    numRounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
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
        'buff-applied',
        'dot-applied',
        'debuff-applied',
        'debuff-resisted',
    ] as const)
        bus.on(type, (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};

const stealthRounds = (events: CombatEvent[], ownerId: string): number[] =>
    events.flatMap((e) =>
        e.type === 'buff-applied' && e.actorId === ownerId && e.buffName === 'Stealth'
            ? [e.round]
            : []
    );
/** The round of each Bomb STACK `sourceId` landed — one entry per stack, since the passive reacts
 *  once per stack inflicted (owner ruling R28). */
const bombLandingRounds = (events: CombatEvent[], sourceId: string): number[] =>
    events.flatMap((e) =>
        e.type === 'dot-applied' && e.sourceId === sourceId && e.dotType === 'bomb'
            ? Array.from({ length: e.stacks }, () => e.round)
            : []
    );
const corrosionLandingRounds = (events: CombatEvent[], sourceId: string): number[] =>
    events.flatMap((e) =>
        e.type === 'dot-applied' && e.sourceId === sourceId && e.dotType === 'corrosion'
            ? [e.round]
            : []
    );
const defenseDownLandingRounds = (events: CombatEvent[], sourceId: string): number[] =>
    events.flatMap((e) =>
        e.type === 'debuff-applied' && e.sourceId === sourceId && e.buffName === 'Defense Down I'
            ? [e.round]
            : []
    );

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Lingshe — "When this Unit inflicts a Bomb it gains Stealth"', () => {
    it('parses onto the landed-inflict trigger, narrowed to Bomb', () => {
        const stealth = stealthAbility();
        expect(stealth.trigger).toBe('on-debuff-inflicted');
        expect(stealth.triggerStatusFilter).toBe('Bomb');
        expect(stealth.config).toMatchObject({ buffName: 'Stealth', duration: 1 });
    });

    it('her Bomb I landing grants Stealth in exactly the rounds a Bomb of hers landed', () => {
        const events = run(BASE({ enemyAttackers: [victimAt('victim', 0)] }));
        const bombs = bombLandingRounds(events, 'attacker');
        expect(bombs.length).toBeGreaterThan(0);
        expect(stealthRounds(events, 'attacker')).toEqual(bombs);
    });

    it('her Bomb resisted grants no Stealth', () => {
        const events = run(BASE({ hacking: 0, enemyAttackers: [victimAt('victim', 100)] }));
        // The Bomb was cast and resisted, never landed.
        expect(
            events.some(
                (e) =>
                    e.type === 'debuff-resisted' && e.targetId === 'victim' && e.buffName === 'Bomb'
            )
        ).toBe(true);
        expect(bombLandingRounds(events, 'attacker')).toEqual([]);
        expect(stealthRounds(events, 'attacker')).toEqual([]);
    });

    it('a Defense Down she lands (implant proc) grants no Stealth', () => {
        const events = run(
            BASE({
                crit: 100,
                shipSkills: defenseDownKit(stealthAbility()),
                enemyAttackers: [victimAt('victim', 0)],
            })
        );
        expect(defenseDownLandingRounds(events, 'attacker').length).toBeGreaterThan(0);
        expect(stealthRounds(events, 'attacker')).toEqual([]);
    });

    it('control: the same board with the Bomb filter stripped DOES grant Stealth off that Defense Down', () => {
        const unfiltered: Ability = { ...stealthAbility(), triggerStatusFilter: undefined };
        const events = run(
            BASE({
                crit: 100,
                shipSkills: defenseDownKit(unfiltered),
                enemyAttackers: [victimAt('victim', 0)],
            })
        );
        const landed = defenseDownLandingRounds(events, 'attacker');
        expect(landed.length).toBeGreaterThan(0);
        expect(stealthRounds(events, 'attacker')).toEqual(landed);
    });

    it('a Corrosion she lands grants no Stealth', () => {
        const events = run(
            BASE({
                shipSkills: corrosionKit(stealthAbility()),
                enemyAttackers: [victimAt('victim', 0)],
            })
        );
        expect(corrosionLandingRounds(events, 'attacker').length).toBeGreaterThan(0);
        expect(bombLandingRounds(events, 'attacker')).toEqual([]);
        expect(stealthRounds(events, 'attacker')).toEqual([]);
    });

    it('control: the same board with the Bomb filter stripped DOES grant Stealth off that Corrosion', () => {
        const unfiltered: Ability = { ...stealthAbility(), triggerStatusFilter: undefined };
        const events = run(
            BASE({
                shipSkills: corrosionKit(unfiltered),
                enemyAttackers: [victimAt('victim', 0)],
            })
        );
        const landed = corrosionLandingRounds(events, 'attacker');
        expect(landed.length).toBeGreaterThan(0);
        expect(stealthRounds(events, 'attacker')).toEqual(landed);
    });

    it("a teammate's Bomb grants her nothing; her own Bomb on the same board still does", () => {
        const events = run(
            BASE({
                enemyAttackers: [victimAt('victim', 0)],
                teamActors: [
                    {
                        id: 'ally-bomber',
                        speed: 150,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'M3',
                        target: parsedFrontTarget(),
                        pattern: singleTargetPattern(),
                        walk: {
                            shipSkills: { slots: [{ slot: 'active', abilities: [bombCast()] }] },
                            stats: {
                                attack: 100,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 999,
                                defence: 0,
                                hp: 1_000_000,
                            },
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    },
                ],
            })
        );
        expect(bombLandingRounds(events, 'ally-bomber').length).toBeGreaterThan(0);
        const own = bombLandingRounds(events, 'attacker');
        expect(own.length).toBeGreaterThan(0);
        expect(stealthRounds(events, 'attacker')).toEqual(own);
        expect(stealthRounds(events, 'ally-bomber')).toEqual([]);
    });
});

describe('Lingshe — team symmetry (enemy-side Lingshe)', () => {
    const enemyLingshe = (hacking: number): EnemyAttacker => ({
        id: 'lingshe-enemy',
        stats: {
            attack: 100,
            crit: 0,
            critDamage: 0,
            speed: 200,
            hp: 1_000_000,
            defence: 0,
            hacking,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        shipSkills: realKit(),
    });

    const runEnemySide = (hacking: number, playerSecurity: number) =>
        run(
            BASE({
                attack: 0,
                shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                security: playerSecurity,
                speed: 1,
                enemyAttackers: [enemyLingshe(hacking)],
            })
        );

    it('an enemy-side Lingshe gains Stealth in exactly the rounds her Bomb lands on the player', () => {
        const events = runEnemySide(200, 0);
        const bombs = bombLandingRounds(events, 'lingshe-enemy');
        expect(bombs.length).toBeGreaterThan(0);
        expect(stealthRounds(events, 'lingshe-enemy')).toEqual(bombs);
    });

    it('an enemy-side Lingshe whose Bomb is resisted gains no Stealth', () => {
        const events = runEnemySide(0, 100);
        expect(
            events.some(
                (e) =>
                    e.type === 'debuff-resisted' &&
                    e.targetId === 'attacker' &&
                    e.buffName === 'Bomb'
            )
        ).toBe(true);
        expect(bombLandingRounds(events, 'lingshe-enemy')).toEqual([]);
        expect(stealthRounds(events, 'lingshe-enemy')).toEqual([]);
    });

    it("an enemy-side teammate's Bomb grants her nothing; her own Bomb on the same board still does", () => {
        const enemyBomber: EnemyAttacker = {
            id: 'enemy-bomber',
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                speed: 250,
                hp: 1_000_000,
                defence: 0,
                hacking: 999,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M3',
            shipSkills: { slots: [{ slot: 'active', abilities: [bombCast()] }] },
        };
        const events = run(
            BASE({
                attack: 0,
                shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                security: 0,
                speed: 1,
                enemyAttackers: [enemyLingshe(200), enemyBomber],
            })
        );
        expect(bombLandingRounds(events, 'enemy-bomber').length).toBeGreaterThan(0);
        const own = bombLandingRounds(events, 'lingshe-enemy');
        expect(own.length).toBeGreaterThan(0);
        expect(stealthRounds(events, 'lingshe-enemy')).toEqual(own);
        expect(stealthRounds(events, 'enemy-bomber')).toEqual([]);
    });
});
