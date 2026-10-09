/**
 * R169 (owner ruling 2026-10-09): Font of Power rolls ONCE for a repair plus its Chimei
 * over-repair redirect. Chimei's start-of-round passive over-repairs `topped`; the redirect then
 * repairs `low`. One proc roll covers the whole event: on success every recipient — `low`
 * included — gets Power Infused Nanobots; on failure nobody does. The same holds when her active
 * cast over-repairs, and on either team.
 *
 * INSTRUMENT. Font of Power draws from Chimei's keyed `${id}:proc` sub-stream. The keyed provider
 * below counts those draws and SCRIPTS their verdicts, so a test can tell one roll from two: a
 * script of [succeed, fail] only reaches `low` when a second roll exists, and [fail, succeed] only
 * withholds the buff from `low` when there is no second roll. Every other keyed stream returns 0,
 * and the fixture's crit rates are all 0, so nothing else in the fight is perturbed.
 *
 * The draws are scoped to a WINDOW of the event stream (the start-of-round window, or Chimei's own
 * turn), read off the live capture at draw time — her active also rolls Font of Power every round.
 * Draws outside the window fail, so no grant outside it can reach the window's assertions.
 *
 * Abundant Renewal is worn too (it is part of the shared implant kit) and has no proc chance, so
 * it draws nothing from this stream and the ruling does not touch it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { setRateGateRng, setKeyedRng } from '../../calculators/rateAccumulator';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import type { Ability } from '../../../types/abilities';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

function requireReferenceData(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                "this test resolves Chimei's real skill text from it."
        );
    }
}

const NANOBOTS = 'Power Infused Nanobots';
const CHIMEI_MAX_HP = 100_000;
const ALLY_MAX_HP = 40_000;
/** Lands before Chimei every round and exceeds her active's 9,000 repair, so in the passive
 *  fixtures the active over-repairs nobody (see `chimeiOverRepairRedirect.integration.test.ts`). */
const AOE_HIT = 16_000;

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

const damage = (multiplier: number): Ability => ({
    id: multiplier === 0 ? 'noop' : 'aoe-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

const gearPiece = (over: Partial<GearPiece>): GearPiece => ({
    id: 'piece',
    slot: 'weapon',
    level: 16,
    stars: 6,
    rarity: 'legendary',
    mainStat: null,
    subStats: [],
    setBonus: null,
    ...over,
});

const PIECES: Record<string, GearPiece> = {
    font: gearPiece({ id: 'font', slot: 'implant_major', setBonus: 'FONT_OF_POWER' }),
    renewal: gearPiece({
        id: 'renewal',
        slot: 'implant_minor_alpha',
        setBonus: 'ABUNDANT_RENEWAL',
    }),
};

/** A permanent self-Stealth on the holder's own store: what Chimei's start-of-round repair
 *  filters its recipients by. */
const stealthAura = (ownerId: string): Ability => ({
    id: `${ownerId}-stealth-aura`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Stealth',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 'recurring',
    },
});

/** Chimei's real kit off `docs/ship-skills.csv`, wearing Font of Power and Abundant Renewal.
 *  `withRedirect: false` strips the over-repair redirect — the plain-repair control. */
function chimeiKit(opts: { withRedirect?: boolean; stealthSelf?: string } = {}) {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === 'CHIMEI');
    if (!rec) throw new Error('docs/ship-skills.csv: no record for "Chimei"');
    const skills = buildShipAbilitiesWithEquipment(
        {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({} as any),
            refits: [{}, {}, {}, {}],
            equipment: {},
            implants: { implant_major: 'font', implant_minor: 'renewal' },
            activeSkillText: rec.active,
            chargeSkillText: rec.charge,
            chargeSkillCharge: rec.chargeCharge,
            firstPassiveSkillText: rec.passives[0],
            secondPassiveSkillText: rec.passives[1],
            thirdPassiveSkillText: rec.passives[2],
        } as Ship,
        (id) => PIECES[id]
    );
    const passives = skills.slots.find((s) => s.slot === 'passive')?.abilities ?? [];
    const passiveRepair = passives.find(
        (a) => a.config.type === 'heal' && a.trigger === 'start-of-round'
    );
    const redirect = passives.find(
        (a) => a.config.type === 'heal' && a.target === 'lowest-hp-ally'
    );
    if (!passiveRepair || !redirect) {
        throw new Error("Chimei's parsed kit is missing the start-of-round repair or the redirect");
    }
    const font = skills.slots
        .flatMap((s) => s.abilities)
        .find((a) => a.trigger === 'on-own-repair-to-ally' && a.config.type === 'buff');
    if (!font || font.procChance === undefined) {
        throw new Error('Font of Power did not build as a proc-chance on-own-repair-to-ally buff');
    }
    const withRedirect = opts.withRedirect ?? true;
    return {
        skills: {
            ...skills,
            slots: skills.slots.map((slot) =>
                slot.slot === 'passive'
                    ? {
                          ...slot,
                          abilities: withRedirect
                              ? slot.abilities
                              : slot.abilities.filter((a) => a.id !== redirect.id),
                      }
                    : slot
            ),
        },
        passiveRepairId: passiveRepair.id,
        redirectId: redirect.id,
    };
}

type ReactiveHeal = Extract<CombatEvent, { type: 'reactive-heal-performed' }>;
type HealPerformed = Extract<CombatEvent, { type: 'heal-performed' }>;
type BuffApplied = Extract<CombatEvent, { type: 'buff-applied' }>;

const CAPTURED: CombatEvent['type'][] = [
    'turn-started',
    'heal-performed',
    'reactive-heal-performed',
    'buff-applied',
];

/** Which slice of the event stream a test reads, decided from the live capture so the keyed
 *  provider can tell whether a draw happens inside it. */
interface Window {
    /** True while the run is inside the window (judged from the events captured so far). */
    isOpen(events: CombatEvent[]): boolean;
    /** The window's events, from the finished stream. */
    slice(events: CombatEvent[]): CombatEvent[];
}

/** The events of `round` that precede its first `turn-started`: nothing a cast did. */
const startOfRound = (round: number): Window => ({
    isOpen(events) {
        const last = events[events.length - 1];
        if (!last || !('round' in last) || last.round !== round) return false;
        return !events.some((e) => e.type === 'turn-started' && e.round === round);
    },
    slice(events) {
        const inRound = events.filter((e) => 'round' in e && e.round === round);
        const firstTurn = inRound.findIndex((e) => e.type === 'turn-started');
        return firstTurn === -1 ? inRound : inRound.slice(0, firstTurn);
    },
});

/** The events of `actorId`'s first turn in `round`, up to the next `turn-started`. */
const turnOf = (actorId: string, round: number): Window => {
    const bounds = (events: CombatEvent[]) => {
        const start = events.findIndex(
            (e) => e.type === 'turn-started' && e.actorId === actorId && e.round === round
        );
        if (start === -1) return undefined;
        const next = events.findIndex((e, i) => i > start && e.type === 'turn-started');
        return { start, end: next === -1 ? events.length : next };
    };
    return {
        isOpen(events) {
            const b = bounds(events);
            return b !== undefined && b.end === events.length;
        },
        slice(events) {
            const b = bounds(events);
            return b ? events.slice(b.start, b.end) : [];
        },
    };
};

interface Scripted {
    events: CombatEvent[];
    /** Font of Power draws Chimei made inside the window. */
    drawsInWindow: number;
}

/**
 * Install the counting, scripting proc provider for `chimeiId` and return the bus to run on.
 * Draw k inside the window returns `script[k]` (0 = success, 0.99 = failure; an exhausted script
 * fails). Draws outside the window fail.
 */
function scriptedRun(
    chimeiId: string,
    window: Window,
    script: number[],
    run: (bus: ReturnType<typeof createEventBus>) => void
): Scripted {
    const events: CombatEvent[] = [];
    const bus = createEventBus();
    for (const type of CAPTURED) bus.on(type, (e) => events.push(e));
    let drawsInWindow = 0;
    setRateGateRng(() => 0);
    setKeyedRng((key) => {
        if (key !== `${chimeiId}:proc`) return 0;
        if (!window.isOpen(events)) return 0.99;
        const verdict = script[drawsInWindow] ?? 0.99;
        drawsInWindow++;
        return verdict;
    });
    run(bus);
    return { events: window.slice(events), drawsInWindow };
}

const repairsBy = (events: CombatEvent[], casterId: string, abilityId: string) =>
    events.filter(
        (e): e is ReactiveHeal =>
            e.type === 'reactive-heal-performed' &&
            e.casterId === casterId &&
            e.sourceAbilityId === abilityId
    );

const nanobotRecipients = (events: CombatEvent[]): string[] =>
    events
        .filter((e): e is BuffApplied => e.type === 'buff-applied' && e.buffName === NANOBOTS)
        .map((e) => e.actorId)
        .sort();

const recipientsOf = (e: { perTarget?: { targetId: string }[] }): string[] =>
    (e.perTarget ?? []).map((pt) => pt.targetId);

// ---------------------------------------------------------------------------------------------
// Player side: Chimei is the focus actor ('attacker'), her allies are team actors.
// ---------------------------------------------------------------------------------------------

const P_CHIMEI = 'attacker';
const P_TOPPED = 'topped';
const P_LOW = 'low';

const playerAlly = (id: string, position: Position, stealthed: boolean): TeamActorEngineInput =>
    ({
        id,
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        role: 'ATTACKER' as ShipTypeName,
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [damage(0)] },
                    ...(stealthed
                        ? [{ slot: 'passive' as const, abilities: [stealthAura(id)] }]
                        : []),
                ],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: ALLY_MAX_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as unknown as TeamActorEngineInput;

function runPlayerSide(
    bus: ReturnType<typeof createEventBus>,
    opts: { withRedirect?: boolean; stealthTopped?: boolean; aoeHit?: number; rounds?: number }
) {
    const kit = chimeiKit({ withRedirect: opts.withRedirect });
    runCombat({
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: kit.skills,
        numRounds: opts.rounds ?? 2,
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
        hp: CHIMEI_MAX_HP,
        healTargetId: P_CHIMEI,
        mode: 'healing',
        perRecipientHealApply: true,
        position: 'M3',
        target: parsedTarget('front'),
        pattern: basePattern(),
        speed: 100,
        teamActors: [
            playerAlly(P_TOPPED, 'M4', opts.stealthTopped ?? true),
            playerAlly(P_LOW, 'M1', false),
        ],
        enemyAttackers: [
            {
                id: 'aoe',
                stats: {
                    attack: opts.aoeHit ?? AOE_HIT,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                    speed: 1000,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                target: parsedTarget('all'),
                pattern: allPattern(),
                shipSkills: { slots: [{ slot: 'active', abilities: [damage(100)] }] },
            },
        ],
        bus,
    } as unknown as CombatEngineInput);
    return kit;
}

// ---------------------------------------------------------------------------------------------
// Enemy side: the same three ships as enemy attackers; the player focus is the AoE.
// ---------------------------------------------------------------------------------------------

const E_CHIMEI = 'e-chimei';
const E_TOPPED = 'e-topped';
const E_LOW = 'e-low';

const enemyShip = (
    id: string,
    position: Position,
    hp: number,
    speed: number,
    shipSkills: CombatEngineInput['shipSkills']
): CombatEngineInput['enemyAttackers'][number] => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed },
    chargeCount: 0,
    startCharged: false,
    position,
    role: 'ATTACKER',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills,
});

function runEnemySide(bus: ReturnType<typeof createEventBus>) {
    const kit = chimeiKit();
    runCombat({
        attack: AOE_HIT,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [damage(100)] }] },
        numRounds: 2,
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
        perRecipientHealApply: true,
        position: 'M4',
        target: parsedTarget('all'),
        pattern: allPattern(),
        speed: 1000,
        enemyAttackers: [
            enemyShip(E_CHIMEI, 'M3', CHIMEI_MAX_HP, 100, kit.skills),
            enemyShip(E_TOPPED, 'M4', ALLY_MAX_HP, 1, {
                slots: [
                    { slot: 'active', abilities: [damage(0)] },
                    { slot: 'passive', abilities: [stealthAura(E_TOPPED)] },
                ],
            }),
            enemyShip(E_LOW, 'M1', ALLY_MAX_HP, 1, {
                slots: [{ slot: 'active', abilities: [damage(0)] }],
            }),
        ],
        bus,
    } as unknown as CombatEngineInput);
    return kit;
}

const SUCCEED = 0;
const FAIL = 0.99;

describe('R169 — Font of Power rolls once for a repair and its over-repair redirect (player side)', () => {
    beforeAll(requireReferenceData);

    const passiveFight = (script: number[]) => {
        let kit!: ReturnType<typeof chimeiKit>;
        const run = scriptedRun(P_CHIMEI, startOfRound(2), script, (bus) => {
            kit = runPlayerSide(bus, {});
        });
        // Premise: the passive repaired ONLY `topped`, and exactly one redirect repaired ONLY
        // `low`. Without it a grant on `low` could not be attributed to the redirect.
        const [repair, ...moreRepairs] = repairsBy(run.events, P_CHIMEI, kit.passiveRepairId);
        expect(moreRepairs).toHaveLength(0);
        expect(recipientsOf(repair)).toEqual([P_TOPPED]);
        const redirects = repairsBy(run.events, P_CHIMEI, kit.redirectId);
        expect(redirects).toHaveLength(1);
        expect(recipientsOf(redirects[0])).toEqual([P_LOW]);
        return run;
    };

    it('(a) draws ONE roll for the passive repair plus its redirect', () => {
        const { drawsInWindow } = passiveFight([SUCCEED, SUCCEED]);
        expect(drawsInWindow).toBe(1);
    });

    it('(b) on success the redirect recipient gets the buff too', () => {
        // A second roll, if one exists, fails — so `low` only gets the buff off the first.
        const { events } = passiveFight([SUCCEED, FAIL]);
        expect(nanobotRecipients(events)).toEqual([P_LOW, P_TOPPED].sort());
    });

    it('(c) on failure nobody gets the buff', () => {
        // A second roll, if one exists, succeeds — so any grant at all means a second roll.
        const { events } = passiveFight([FAIL, SUCCEED]);
        expect(nanobotRecipients(events)).toEqual([]);
    });

    it('(d) control: a plain repair with no redirect still rolls once and grants', () => {
        let kit!: ReturnType<typeof chimeiKit>;
        const { events, drawsInWindow } = scriptedRun(
            P_CHIMEI,
            startOfRound(2),
            [SUCCEED],
            (bus) => {
                kit = runPlayerSide(bus, { withRedirect: false });
            }
        );
        expect(repairsBy(events, P_CHIMEI, kit.passiveRepairId)).toHaveLength(1);
        expect(repairsBy(events, P_CHIMEI, kit.redirectId)).toHaveLength(0);
        expect(drawsInWindow).toBe(1);
        expect(nanobotRecipients(events)).toEqual([P_TOPPED]);
    });

    // Her active cast over-repairs: nobody is Stealthed (the passive repairs nobody) and the AoE
    // is light, so the 9,000 repair wastes on everyone it reaches and the redirect fires off the
    // cast.
    const castFight = (script: number[]) => {
        let kit!: ReturnType<typeof chimeiKit>;
        const run = scriptedRun(P_CHIMEI, turnOf(P_CHIMEI, 1), script, (bus) => {
            kit = runPlayerSide(bus, { stealthTopped: false, aoeHit: 200, rounds: 1 });
        });
        const casts = run.events.filter(
            (e): e is HealPerformed => e.type === 'heal-performed' && e.casterId === P_CHIMEI
        );
        expect(casts).toHaveLength(1);
        const redirects = repairsBy(run.events, P_CHIMEI, kit.redirectId);
        expect(redirects).toHaveLength(1);
        return { ...run, cast: casts[0], redirect: redirects[0] };
    };

    it('(a, cast) draws ONE roll for an over-repairing cast plus its redirect', () => {
        const { drawsInWindow } = castFight([SUCCEED, SUCCEED]);
        expect(drawsInWindow).toBe(1);
    });

    it('(b, cast) on success every recipient of the cast and the redirect gets the buff', () => {
        const { events, cast, redirect } = castFight([SUCCEED, FAIL]);
        // The cast reaches every ally, so the redirect's recipient is also a cast recipient here:
        // this arm pins the grant set, and (a, cast) / (c, cast) pin that there is one roll.
        expect(recipientsOf(cast)).toEqual(expect.arrayContaining(recipientsOf(redirect)));
        expect(new Set(nanobotRecipients(events))).toEqual(new Set(recipientsOf(cast)));
    });

    it('(c, cast) on failure nobody gets the buff', () => {
        const { events } = castFight([FAIL, SUCCEED]);
        expect(nanobotRecipients(events)).toEqual([]);
    });
});

describe('R169 — the same on the enemy side', () => {
    beforeAll(requireReferenceData);

    const enemyFight = (script: number[]) => {
        let kit!: ReturnType<typeof chimeiKit>;
        const run = scriptedRun(E_CHIMEI, startOfRound(2), script, (bus) => {
            kit = runEnemySide(bus);
        });
        const [repair, ...moreRepairs] = repairsBy(run.events, E_CHIMEI, kit.passiveRepairId);
        expect(moreRepairs).toHaveLength(0);
        expect(recipientsOf(repair)).toEqual([E_TOPPED]);
        const redirects = repairsBy(run.events, E_CHIMEI, kit.redirectId);
        expect(redirects).toHaveLength(1);
        expect(recipientsOf(redirects[0])).toEqual([E_LOW]);
        return run;
    };

    it('(e) draws ONE roll for the passive repair plus its redirect', () => {
        expect(enemyFight([SUCCEED, SUCCEED]).drawsInWindow).toBe(1);
    });

    it('(e) on success the redirect recipient gets the buff too', () => {
        expect(nanobotRecipients(enemyFight([SUCCEED, FAIL]).events)).toEqual(
            [E_LOW, E_TOPPED].sort()
        );
    });

    it('(e) on failure nobody gets the buff', () => {
        expect(nanobotRecipients(enemyFight([FAIL, SUCCEED]).events)).toEqual([]);
    });
});
