/**
 * Reactive SELF-scoped riders on `on-ally-crit` fire ONCE PER ATTACK — never per hit and never
 * per AoE victim — where "attack" means SUB-ATTACK.
 *
 * User-reported bug: Hermes's reactive passive over-triggers against AoE / multi-hit attacks —
 * the combat log shows "Everliving Regeneration III" 2–4× for a single attack, while the charge
 * gain nets exactly +1.
 *
 * ROOT CAUSE (verified in triggers.ts, `case 'on-ally-crit'`):
 *   Hermes's charge AND Everliving Regeneration III are BOTH self-target riders on the
 *   `on-ally-crit` trigger (parsed from the R4 passive — see the mutation guard below). The
 *   listener used to enqueue the rider `n` times per `ability-performed`, where
 *       n = config.type === 'charge' ? (didCrit ? 1 : 0) : (critHits ?? (didCrit ? 1 : 0))
 *   so the CHARGE was collapsed to 1 by an explicit special-case but the BUFF fanned out on
 *   `critHits` — hits × victims — and re-applied that many times. THAT is why the two diverged.
 *
 * THE FIX, and where it lives now. The collapse is in the LISTENER: it enqueues AT MOST ONCE per
 * `ability-performed`, for self- and ally-routed riders alike. So the two over-fire axes are shut
 * off structurally — a 3-victim AoE crit is one event and grants once, and there is no
 * `critHits` loop left to multiply anything.
 *
 * WHAT IS NOT COLLAPSED, by decision. A `hits: N` skill is N consecutive FULL-WALK attacks
 * (locked game rule) and since PR2 of the multi-hit epic it emits N `ability-performed` events.
 * Hermes therefore gains 3 charges and 3 Everliving applications from a 3-sub-attack ally crit —
 * one per critting sub-attack. This is a USER-APPROVED behaviour change; previously the executor's
 * `oncePerAttackGuardKey` (cleared per actor TURN) held it at 1, and `on-ally-crit` has been
 * removed from `PER_HIT_REACTIVE_TRIGGERS` so it no longer does. The guard is untouched and still
 * load-bearing for `on-attacked` / `on-ally-attacked`, which genuinely fan ONE attack into many
 * events.
 *
 * The two axes are independent and both are pinned below: per-sub-attack fan-out (3) and
 * per-AoE-victim collapse (1).
 *
 * Everything is extracted through the REAL production path (buildShipAbilities on verbatim CSV
 * skill text, driven through runCombat) — never a hand-built self-rider.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// Hermes' R4 (refit-active) passive, verbatim from docs/ship-skills.csv (third passive).
const HERMES_R4 =
    "This Unit's Defense is increased by 20%.<br /><br />When an ally critically hits an enemy, " +
    'this Unit <unit-aid>gains 1 charge</unit-aid> to its Charged Skill and ' +
    '<unit-skill>Everliving Regeneration III</unit-skill> for 2 turns. Additionally, when this ' +
    'Unit critically repairs an ally, it <unit-aid>Cleanses 1</unit-aid> debuff from itself.';

/** Hermes' on-ally-crit riders through the REAL parser/builder (charge + Everliving buff). */
function hermesPassiveAbilities(): Ability[] {
    return (
        buildShipAbilities(ship({ thirdPassiveSkillText: HERMES_R4 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? []
    );
}

describe('Hermes R4 riders — extracted shape (mutation guard)', () => {
    it('charge + Everliving Regeneration III both ride on-ally-crit, self-targeted', () => {
        const abilities = hermesPassiveAbilities();
        const charge = abilities.find((a) => a.type === 'charge');
        const everliving = abilities.find(
            (a) =>
                a.type === 'buff' &&
                a.config.type === 'buff' &&
                /Everliving/.test(a.config.buffName)
        );
        if (!charge || !everliving) throw new Error('mutation guard: Hermes R4 riders not found');
        expect(charge.trigger).toBe('on-ally-crit');
        expect(charge.target).toBe('self');
        expect(everliving.trigger).toBe('on-ally-crit');
        expect(everliving.target).toBe('self');
    });
});

/** A dummy enemy target: fat HP, does nothing meaningful. */
const dummyEnemy = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'noop',
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
    }) as EnemyAttacker;

/** Hermes observer (team actor): carries its full R4 passive (charge + Everliving). Acts last
 *  (speed 1) so the ally crit precedes it; chargeCount headroom of 6. */
const hermesObserver = (position: Position): TeamActorEngineInput =>
    ({
        id: 'hermes',
        speed: 1,
        chargeCount: 6,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'noop',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 0 },
                            },
                        ],
                    },
                    { slot: 'passive', abilities: hermesPassiveAbilities() },
                ],
            },
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
    }) as TeamActorEngineInput;

/** The focus ally fires `hits: 3` at a single enemy, critting on every sub-attack. That is THREE
 *  consecutive full-walk attacks, so Hermes applies Everliving Regeneration III three times and
 *  gains three charges — once per critting sub-attack. */
function runHermes() {
    const input: CombatEngineInput = {
        attack: 1000,
        crit: 100, // every hit crits
        critDamage: 100,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'multi-hit',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100, hits: 3 },
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
        hp: 1_000_000_000,
        speed: 500, // acts before Hermes
        healTargetId: 'hermes',
        mode: 'healing',
        position: 'M1',
        target: parsedTarget('front'),
        pattern: basePattern(),
        teamActors: [hermesObserver('M3')],
        enemyAttackers: [dummyEnemy('enemy-a', 'M4')],
    };

    const bus = createEventBus();
    const everliving: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    const chargeGains: Extract<CombatEvent, { type: 'charge-changed' }>[] = [];
    bus.on('buff-applied', (e) => {
        if (e.actorId === 'hermes' && /Everliving/.test(e.buffName)) everliving.push(e);
    });
    bus.on('charge-changed', (e) => {
        if (e.actorId === 'hermes' && e.reason === 'manip') chargeGains.push(e);
    });
    runCombat({ ...input, bus });
    const chargeGained = chargeGains.reduce((s, e) => s + (e.newCharge - e.oldCharge), 0);
    return { everlivingApplications: everliving.length, chargeGained };
}

describe('Hermes Everliving Regeneration — once per SUB-ATTACK, not per hit/victim', () => {
    it('a hits:3 ally crit applies Everliving three times and grants three charges', () => {
        const { everlivingApplications, chargeGained } = runHermes();
        // `hits: 3` is THREE full-walk attacks, each with its own critting `ability-performed`.
        // History of this number: 3 (the original per-critHits over-fire bug) → 1 (the listener
        // collapse PLUS the executor's per-TURN guard) → 3 again, but for a DIFFERENT and correct
        // reason — three attacks, one grant each. The AoE case below is what discriminates the two
        // 3s: under the old bug it read 2, and it must now read 1.
        expect(everlivingApplications).toBe(3);
        // The charge rides the same trigger and now tracks the buff exactly. Previously the
        // listener's hand-rolled special-case held it at +1 while the buff over-fired; that
        // divergence is gone.
        expect(chargeGained).toBe(3);
    });
});

/**
 * THE OTHER AXIS — the user-reported bug itself, which must STAY fixed.
 *
 * ONE single-hit attack whose AoE footprint crits TWO victims. That is one attack, so Hermes gets
 * ONE Everliving application and ONE charge, however many footprint victims crit. Pre-fix this
 * read 2 (the `critHits`-driven enqueue loop); it is structurally impossible now because the
 * listener enqueues at most once per `ability-performed`, and it is deliberately NOT protected by
 * `oncePerAttackGuardKey` any more — so this test is the only thing standing between the codebase
 * and a regression of the original report.
 */
function runHermesAoe() {
    const observer = hermesObserver('M3');
    const input: CombatEngineInput = {
        attack: 1000,
        crit: 100, // every footprint victim crits
        critDamage: 100,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'single-hit-aoe',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            // hits: 1 — ONE attack. The spread comes from the pattern below.
                            config: { type: 'damage', multiplier: 100 },
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
        hp: 1_000_000_000,
        speed: 500,
        healTargetId: 'hermes',
        mode: 'healing',
        position: 'M1',
        target: parsedTarget('front'),
        // Whole-roster footprint: one attack, two victims, both critting.
        pattern: { raw: 'all', shape: 'all', range: 'all', modifiers: {} } as ParsedPattern,
        teamActors: [observer],
        enemyAttackers: [dummyEnemy('enemy-a', 'M4'), dummyEnemy('enemy-b', 'M3')],
    };

    const bus = createEventBus();
    const everliving: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    const chargeGains: Extract<CombatEvent, { type: 'charge-changed' }>[] = [];
    const perf: Extract<CombatEvent, { type: 'ability-performed' }>[] = [];
    bus.on('ability-performed', (e) => {
        if (e.actorId === 'attacker') perf.push(e);
    });
    bus.on('buff-applied', (e) => {
        if (e.actorId === 'hermes' && /Everliving/.test(e.buffName)) everliving.push(e);
    });
    bus.on('charge-changed', (e) => {
        if (e.actorId === 'hermes' && e.reason === 'manip') chargeGains.push(e);
    });
    runCombat({ ...input, bus });
    return {
        everlivingApplications: everliving.length,
        chargeGained: chargeGains.reduce((s, e) => s + (e.newCharge - e.oldCharge), 0),
        perf,
    };
}

describe('Hermes Everliving Regeneration — an AoE footprint is still ONE attack', () => {
    it('a single-hit crit across TWO victims applies Everliving once and grants one charge', () => {
        const { everlivingApplications, chargeGained, perf } = runHermesAoe();
        // Fixture self-check: the fan-out axis under test must actually exist. ONE attack, TWO
        // critting victims — without this the assertions below would be vacuously satisfied.
        expect(perf).toHaveLength(1);
        expect(perf[0].critHits).toBe(2);

        // THE user-reported bug. Pre-fix: 2 (one per critting victim). Must stay 1.
        expect(everlivingApplications).toBe(1);
        expect(chargeGained).toBe(1);
    });
});

/**
 * Regression lock — an ALLY-target rider on on-ally-crit (the shape of Howler's Blast grant /
 * Sentinel's ally repair) fires exactly ONCE PER CRITTING ATTACK.
 *
 * The unit of "attack" changed in the multi-hit full-walk epic (PR2): a `hits: N` skill is N
 * consecutive full-walk attacks, so it emits N `ability-performed` events and this rider fires
 * N times — once per critting sub-attack. That is the epic's approved decision ("an ally crits on
 * 2 of 3 sub-attacks → fires twice"), and it is NOT the bug this file locks.
 *
 * The bug this file locks is per-HIT and per-VICTIM over-firing WITHIN one attack: the
 * once-per-attack collapse used to live in the executor and was narrowed to `target: 'self'`, so
 * ally-routed riders re-applied per critting (hit, victim) pair. That produced the user-reported
 * "Sentinel heals → Ruiner: 1,152" twice for ONE Ruiner AoE. The collapse now lives in the
 * LISTENER, which enqueues at most once per `ability-performed`: an AoE footprint is ONE attack
 * and still grants ONCE however many victims crit (the `critHits`-driven fan-out is gone).
 * Per-ENEMY fan-out for "…to that enemy" riders happens inside the damage executor via
 * eventCtx.critVictimIds, not by re-enqueuing.
 *
 * The executor's self-target guard is untouched and still load-bearing for the other per-hit
 * triggers (on-attacked / on-ally-attacked), which genuinely fan one attack into many events.
 *
 * A hand-built ally-target buff is used here purely to exercise the `target !== 'self'` branch in
 * isolation (real Cultivator/Graphite/Sentinel/Howler ally goldens across the suite are the
 * broader lock).
 */
function runAllyTargetRider() {
    const allyBuff: Ability = {
        id: 'ally-blast',
        type: 'buff',
        target: 'ally',
        trigger: 'on-ally-crit',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Blast',
            duration: 2,
            stacks: 1,
            isStackable: false,
            parsedEffects: {},
        },
    };
    const observer = hermesObserver('M3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (observer as any).id = 'howler';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (observer as any).walk.shipSkills.slots[1].abilities = [allyBuff];

    const input: CombatEngineInput = {
        attack: 1000,
        crit: 100,
        critDamage: 100,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'multi-hit',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100, hits: 3 },
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
        hp: 1_000_000_000,
        speed: 500,
        healTargetId: 'howler',
        mode: 'healing',
        position: 'M1',
        target: parsedTarget('front'),
        pattern: basePattern(),
        teamActors: [observer],
        enemyAttackers: [dummyEnemy('enemy-a', 'M4')],
    };

    const bus = createEventBus();
    const blasts: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('buff-applied', (e) => {
        if (/Blast/.test(e.buffName)) blasts.push(e);
    });
    runCombat({ ...input, bus });
    return blasts.length;
}

describe('ally-target on-ally-crit rider — once per attack', () => {
    it('an ally-target buff fires once per critting SUB-ATTACK of a 3-hit attack', () => {
        // PR2 (multi-hit full-walk): `hits: 3` is THREE consecutive full-walk attacks, each with
        // its own `ability-performed`, so the ally-routed grant lands three times — once per
        // critting sub-attack, never per (hit, victim) pair. Pre-PR2 this read 1, because the
        // engine collapsed the whole cast into a single event.
        expect(runAllyTargetRider()).toBe(3);
    });
});
