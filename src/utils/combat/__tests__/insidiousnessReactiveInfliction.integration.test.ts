/**
 * The Insidiousness implant ("When debuffing an enemy, there is a 21% chance to deal 100%
 * damage." at legendary) has its chance on a debuff its carrier inflicts REACTIVELY — a debuff an
 * `on-debuff-inflicted` reaction lands (Warden's Out. Damage Down II, Ripper's catalogue Inferno
 * II) — exactly as on one a cast inflicts.
 *
 * The self-chain guard is scoped to each reaction's own output: an infliction carries the ids of
 * the `on-debuff-inflicted` reactions that produced it (`debuffInflictedReactionChain`), and only
 * an ability already in that chain skips it. So a reaction never re-triggers itself (directly, or
 * by way of another of the owner's reactions), and every other ability on the trigger still sees
 * the reactive infliction.
 *
 * Insidiousness declares `procScope:'per-attack'`: one verdict shared by every enemy debuffed in
 * the same memo bucket, at most one hit per enemy per bucket. KNOWN GAP: on this trigger the
 * listener stamps no `subAttackIndex`, so the bucket is the actor's whole turn, not one attack as
 * the locked proc rule requires — a 2-hit cast that debuffs on each hit gets one roll where the
 * rule gives two (see `Intent.eventCtx.subAttackIndex` in triggers.ts). A reactive infliction on
 * the SAME enemy, in the same turn, as the infliction that triggered it therefore shares that
 * verdict and adds no second hit; the boards
 * below make the reaction land on a DIFFERENT enemy (an `enemy-highest-attack` follow-up), or
 * narrow Insidiousness to the reaction's status, which is where the change is visible.
 *
 * Real engine (runCombat), real Insidiousness ability (buildEquipmentAbilities on a legendary
 * implant piece) with its proc chance raised to 1 so every board is deterministic. Hacking 200 vs
 * security 0 lands every roll.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

/** The real legendary Insidiousness ability, with its proc chance raised to 1. */
const insidiousness = (): Ability => {
    const pieceId = 'insid-piece';
    const piece = {
        id: pieceId,
        slot: 'implant_major',
        rarity: 'legendary',
        setBonus: 'INSIDIOUSNESS',
        mainStat: null,
        subStats: [],
        level: 0,
        stars: 0,
    } as unknown as GearPiece;
    const ship = { implants: { implant_major: pieceId }, equipment: {} } as unknown as Ship;
    const built = buildEquipmentAbilities(ship, (g) => (g === pieceId ? piece : undefined));
    const a = built.find((x) => x.trigger === 'on-debuff-inflicted');
    if (!a) throw new Error('Insidiousness ability missing');
    return { ...a, procChance: 1 };
};

const plainHit = (): Ability => ({
    id: 'plain-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

const debuffConfig = (buffName: string, duration: number) => ({
    type: 'debuff' as const,
    buffName,
    parsedEffects: {},
    stacks: 1,
    isStackable: false,
    application: 'inflict' as const,
    duration,
});

/** The cast-path infliction on the primary target. */
const castDebuff = (): Ability => ({
    id: 'cast-seed-down',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: debuffConfig('Seed Down', 2),
});

/** A Warden-shaped reaction ("when this Unit inflicts a debuff, it inflicts X") whose X lands on
 *  the highest-attack enemy instead of the one the triggering infliction landed on. */
const reaction = (id: string, buffName: string): Ability => ({
    id,
    type: 'debuff',
    target: 'enemy-highest-attack',
    trigger: 'on-debuff-inflicted',
    conditions: [],
    config: debuffConfig(buffName, 1),
});
const CHAIN = 'Chain Down';

const kit = (passive: Ability[]): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [plainHit(), castDebuff()] },
        { slot: 'passive', abilities: passive },
    ],
});

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** `front`: the cast's primary target (attack 0). `strong`: behind it, the highest attack. */
const enemy = (id: string, attack: number, position: Position): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1e12, speed: 1, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});
const TWO_ENEMIES = (): EnemyAttacker[] => [enemy('front', 0, 'M4'), enemy('strong', 1, 'B4')];

const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: TWO_ENEMIES(),
    attack: 100,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: kit([reaction('reaction-a', CHAIN), insidiousness()]),
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
    hp: 1e12,
    hacking: 200,
    speed: 100,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: frontTarget(),
    pattern: basePattern(),
    ...over,
});

const run = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['debuff-applied', 'reactive-damage-performed'] as const)
        bus.on(type, (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};

/** Rounds in which `sourceId` landed `buffName` on `targetId`, one entry per landing. */
const landings = (events: CombatEvent[], sourceId: string, targetId: string, buffName: string) =>
    events.flatMap((e) =>
        e.type === 'debuff-applied' &&
        e.sourceId === sourceId &&
        e.targetId === targetId &&
        e.buffName === buffName
            ? [e.round]
            : []
    );
/** Rounds in which `sourceId` hit `targetId` with a reactive damage proc (Insidiousness is the
 *  only reactive damage ability on these boards). */
const procHits = (events: CombatEvent[], sourceId: string, targetId: string) =>
    events.flatMap((e) =>
        e.type === 'reactive-damage-performed' && e.sourceId === sourceId && e.targetId === targetId
            ? [e.round]
            : []
    );

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Insidiousness — the implant ability', () => {
    it('is a reactive damage proc on the carrier’s own debuff landings (legendary: 21%, 100%)', () => {
        const pieceId = 'p';
        const piece = { id: pieceId, rarity: 'legendary', setBonus: 'INSIDIOUSNESS' };
        const [a] = buildEquipmentAbilities(
            { implants: { implant_major: pieceId }, equipment: {} } as unknown as Ship,
            (g) => (g === pieceId ? (piece as unknown as GearPiece) : undefined)
        );
        expect(a).toMatchObject({
            type: 'damage',
            trigger: 'on-debuff-inflicted',
            procChance: 0.21,
            procScope: 'per-attack',
            config: { type: 'damage', multiplier: 100, hits: 1 },
        });
    });
});

describe('Insidiousness — rolls on a reactively inflicted debuff (player side)', () => {
    it('the reaction’s Chain Down on the strong enemy wakes Insidiousness on that enemy', () => {
        const events = run(BASE());
        expect(landings(events, 'attacker', 'front', 'Seed Down')).toEqual([1, 2, 3]);
        expect(landings(events, 'attacker', 'strong', CHAIN)).toEqual([1, 2, 3]);
        expect(procHits(events, 'attacker', 'front')).toEqual([1, 2, 3]);
        expect(procHits(events, 'attacker', 'strong')).toEqual([1, 2, 3]);
    });

    it('control: without the reaction the strong enemy is never debuffed and never hit', () => {
        const events = run(BASE({ shipSkills: kit([insidiousness()]) }));
        expect(procHits(events, 'attacker', 'front')).toEqual([1, 2, 3]);
        expect(landings(events, 'attacker', 'strong', CHAIN)).toEqual([]);
        expect(procHits(events, 'attacker', 'strong')).toEqual([]);
    });

    it('the reaction never re-triggers itself: one Chain Down per cast infliction, no throw', () => {
        const events = run(BASE());
        const chains = events.filter((e) => e.type === 'debuff-applied' && e.buffName === CHAIN);
        expect(chains).toHaveLength(3);
        expect(
            chains.map((e) => (e.type === 'debuff-applied' ? e.debuffInflictedReactionChain : []))
        ).toEqual([['reaction-a'], ['reaction-a'], ['reaction-a']]);
    });

    it('two such reactions on one carrier each fire once per chain: bounded, no throw', () => {
        // reaction-a's Chain Down wakes reaction-b (and vice versa); each skips an infliction
        // already carrying its own id, so the chain stops after both have fired once.
        const events = run(
            BASE({
                shipSkills: kit([
                    reaction('reaction-a', CHAIN),
                    reaction('reaction-b', 'Echo Down'),
                    insidiousness(),
                ]),
            })
        );
        const perRound = (name: string) =>
            events.filter((e) => e.type === 'debuff-applied' && e.buffName === name).length;
        // Per cast: Seed Down wakes a and b once each; a's output wakes b, b's output wakes a.
        expect(perRound(CHAIN)).toBe(6);
        expect(perRound('Echo Down')).toBe(6);
        expect(procHits(events, 'attacker', 'strong')).toEqual([1, 2, 3]);
    });
});

// The real kits' reactions land on the SAME enemy as the infliction that triggered them, so the
// reactive landing joins that attack's verdict and adds no hit of its own. To see the reactive
// landing by itself, these boards narrow Insidiousness to the reaction's status family
// (`triggerStatusFilter`): the narrowed copy cannot see the cast-side infliction, so every hit it
// deals comes from the reactive one.
const narrowed = (family: string): Ability => ({ ...insidiousness(), triggerStatusFilter: family });

describe('Insidiousness — real Warden kit (OLD R2 text), debuff arm', () => {
    // Verbatim from docs/ship-skills.csv (Warden).
    const WARDEN_ACTIVE =
        'This Unit deals <unit-damage>165% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.';
    const WARDEN_PASSIVE_R2 =
        'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.<br /><br />Additionally, when this Unit inflicts a Debuff, it inflicts <unit-skill>Out. Damage Down II</unit-skill> for 1 turn.';
    const OUT_DD = 'Out. Damage Down II';
    /** Her parsed kit plus `extra`; `withReaction: false` strips her on-debuff-inflicted reaction. */
    const wardenSkills = (extra: Ability[], withReaction = true): ShipSkills => {
        const built = buildShipAbilities({
            refits: [{}, {}],
            activeSkillText: WARDEN_ACTIVE,
            secondPassiveSkillText: WARDEN_PASSIVE_R2,
        } as unknown as Ship);
        const active = built.slots.find((s) => s.slot === 'active');
        const passive = built.slots.find((s) => s.slot === 'passive');
        if (!active || !passive) throw new Error('Warden slots missing');
        const own = passive.abilities.filter(
            (a) => withReaction || a.trigger !== 'on-debuff-inflicted'
        );
        return { slots: [active, { ...passive, abilities: [...own, ...extra] }] };
    };
    /** Hits Warden every round, arming her "when directly damaged" Corrosion I. */
    const hitter = (): EnemyAttacker => ({
        id: 'hitter',
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e12,
            speed: 1,
            security: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        shipSkills: { slots: [{ slot: 'active', abilities: [plainHit()] }] },
    });
    const board = (skills: ShipSkills) => BASE({ shipSkills: skills, enemyAttackers: [hitter()] });

    it('her reactive Out. Damage Down II wakes Insidiousness: a hit on each landing', () => {
        const events = run(board(wardenSkills([narrowed('Out. Damage Down')])));
        const landed = landings(events, 'attacker', 'hitter', OUT_DD);
        expect(landed).toEqual([1, 2, 3]);
        expect(procHits(events, 'attacker', 'hitter')).toEqual(landed);
    });

    it('control: without her reaction there is no Out. Damage Down II and no hit', () => {
        const events = run(board(wardenSkills([narrowed('Out. Damage Down')], false)));
        expect(landings(events, 'attacker', 'hitter', OUT_DD)).toEqual([]);
        expect(procHits(events, 'attacker', 'hitter')).toEqual([]);
    });

    it('the real implant: one hit per attack that debuffed the hitter — the reactive landing adds none', () => {
        const events = run(board(wardenSkills([insidiousness()])));
        expect(landings(events, 'attacker', 'hitter', OUT_DD)).toEqual([1, 2, 3]);
        // Her own turn (Provoke) and the hitter's turn (Corrosion I, then the reactive Out. Damage
        // Down II) each debuff the hitter once per round.
        expect(procHits(events, 'attacker', 'hitter')).toEqual([1, 1, 2, 2, 3, 3]);
    });
});

describe('Insidiousness — real catalogue Ripper kit (R0), DoT arm', () => {
    // Verbatim from docs/ship-skills.catalogue.csv (Ripper).
    const RIPPER_ACTIVE =
        'This Unit deals <unit-damage>165% damage</unit-damage> and inflicts <unit-skill>Inc. Repair Down II</unit-skill> for 1 turn.';
    const RIPPER_PASSIVE_R0 =
        'When this Unit inflicts a <unit-aid>debuff</unit-aid> with its active or charged skills, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.';
    /** His parsed active + passive plus `extra`; `withInferno: false` strips his reaction. */
    const ripperSkills = (extra: Ability[], withInferno = true): ShipSkills => {
        const built = buildShipAbilities({
            refits: [],
            activeSkillText: RIPPER_ACTIVE,
            firstPassiveSkillText: RIPPER_PASSIVE_R0,
        } as unknown as Ship);
        const active = built.slots.find((s) => s.slot === 'active');
        const passive = built.slots.find((s) => s.slot === 'passive');
        if (!active || !passive) throw new Error('Ripper slots missing');
        const own = passive.abilities.filter((a) => withInferno || a.config.type !== 'dot');
        return { slots: [active, { slot: 'passive', abilities: [...own, ...extra] }] };
    };
    const infernoRounds = (events: CombatEvent[], sourceId: string, targetId: string) =>
        events.flatMap((e) =>
            e.type === 'dot-applied' &&
            e.sourceId === sourceId &&
            e.targetId === targetId &&
            e.dotType === 'inferno'
                ? [e.round]
                : []
        );
    const runWithDots = (input: CombatEngineInput) => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        for (const type of ['dot-applied', 'reactive-damage-performed'] as const)
            bus.on(type, (e) => events.push(e as CombatEvent));
        runCombat({ ...input, bus });
        return events;
    };
    const victim = (): EnemyAttacker => enemy('victim', 0, 'M4');

    it('his reactive Inferno II wakes Insidiousness: a hit on each landing', () => {
        const events = runWithDots(
            BASE({ shipSkills: ripperSkills([narrowed('Inferno')]), enemyAttackers: [victim()] })
        );
        const landed = infernoRounds(events, 'attacker', 'victim');
        expect(landed).toEqual([1, 2, 3]);
        expect(procHits(events, 'attacker', 'victim')).toEqual(landed);
    });

    it('each reactive Inferno II carries his reaction’s id in its chain', () => {
        const skills = ripperSkills([]);
        const reactionId = skills.slots
            .find((s) => s.slot === 'passive')
            ?.abilities.find((a) => a.config.type === 'dot')?.id;
        expect(reactionId).toBeDefined();
        const events = runWithDots(BASE({ shipSkills: skills, enemyAttackers: [victim()] }));
        const chains = events.flatMap((e) =>
            e.type === 'dot-applied' && e.dotType === 'inferno'
                ? [e.debuffInflictedReactionChain]
                : []
        );
        expect(chains).toEqual([[reactionId], [reactionId], [reactionId]]);
    });

    it('control: without his reaction there is no Inferno and no hit', () => {
        const events = runWithDots(
            BASE({
                shipSkills: ripperSkills([narrowed('Inferno')], false),
                enemyAttackers: [victim()],
            })
        );
        expect(infernoRounds(events, 'attacker', 'victim')).toEqual([]);
        expect(procHits(events, 'attacker', 'victim')).toEqual([]);
    });

    it('enemy side: an enemy Ripper’s reactive Inferno II on the player wakes his Insidiousness', () => {
        const enemyRipper = (extra: Ability[], withInferno = true): EnemyAttacker => ({
            id: 'ripper-enemy',
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1e12,
                speed: 200,
                hacking: 200,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            shipSkills: ripperSkills(extra, withInferno),
        });
        const enemyBoard = (withInferno: boolean) =>
            runWithDots(
                BASE({
                    attack: 0,
                    speed: 1,
                    security: 0,
                    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                    enemyAttackers: [enemyRipper([narrowed('Inferno')], withInferno)],
                })
            );
        const on = enemyBoard(true);
        const landed = infernoRounds(on, 'ripper-enemy', 'attacker');
        expect(landed).toEqual([1, 2, 3]);
        expect(procHits(on, 'ripper-enemy', 'attacker')).toEqual(landed);
        const off = enemyBoard(false);
        expect(infernoRounds(off, 'ripper-enemy', 'attacker')).toEqual([]);
        expect(procHits(off, 'ripper-enemy', 'attacker')).toEqual([]);
    });
});

describe('Insidiousness — team symmetry (enemy-side carrier)', () => {
    // The enemy carrier's cast hits the player focus (attack 0); its reaction lands on the player
    // side's highest-attack ship, a team ally behind the focus.
    const enemyCarrier = (passive: Ability[]): EnemyAttacker => ({
        id: 'carrier',
        stats: {
            attack: 100,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e12,
            speed: 200,
            hacking: 200,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: frontTarget(),
        pattern: basePattern(),
        shipSkills: kit(passive),
    });
    const strongAlly = (): TeamActor => ({
        id: 'strong-ally',
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'B4',
        target: frontTarget(),
        pattern: basePattern(),
        walk: {
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1e12,
                security: 0,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });
    const enemyBoard = (passive: Ability[]) =>
        BASE({
            attack: 0,
            speed: 1,
            security: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
            enemyAttackers: [enemyCarrier(passive)],
            teamActors: [strongAlly()],
        });

    it('an enemy carrier’s reactive Chain Down on the strong player ally wakes Insidiousness on it', () => {
        const events = run(enemyBoard([reaction('reaction-a', CHAIN), insidiousness()]));
        expect(landings(events, 'carrier', 'attacker', 'Seed Down')).toEqual([1, 2, 3]);
        expect(landings(events, 'carrier', 'strong-ally', CHAIN)).toEqual([1, 2, 3]);
        expect(procHits(events, 'carrier', 'attacker')).toEqual([1, 2, 3]);
        expect(procHits(events, 'carrier', 'strong-ally')).toEqual([1, 2, 3]);
    });

    it('control: without the reaction the strong player ally is never hit', () => {
        const events = run(enemyBoard([insidiousness()]));
        expect(procHits(events, 'carrier', 'attacker')).toEqual([1, 2, 3]);
        expect(procHits(events, 'carrier', 'strong-ally')).toEqual([]);
    });
});
