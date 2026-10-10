/**
 * Reactive riders on `on-ally-crit` fire ONCE PER ATTACK — never per hit and never per AoE
 * victim — where "attack" means SUB-ATTACK.
 *
 * The listener (triggers.ts, `case 'on-ally-crit'`) enqueues at most once per critting
 * `ability-performed`. A `hits: N` skill is N consecutive full-walk attacks emitting N
 * `ability-performed` events, so the rider fires N times. A single-hit AoE footprint that crits
 * several victims is ONE event and fires once. `on-ally-crit` is not in
 * `PER_HIT_REACTIVE_TRIGGERS`, so `oncePerAttackGuardKey` does not collapse the sub-attacks.
 *
 * Hermes's R2 passive carries both rider shapes: the charge is a self rider, and Everliving
 * Regeneration III is granted "to the ally" — the ally whose crit triggered it (the listener's
 * `damagedAllyId` stamp). Both are pinned on each axis below: per-sub-attack fan-out (3) and
 * per-AoE-victim collapse (1).
 *
 * Everything is extracted through the REAL production path (buildShipAbilities on verbatim CSV
 * skill text, driven through runCombat) — never a hand-built Hermes rider.
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
    return { ...({} as any), refits: [{}, {}], ...over } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// Hermes's R2 (refit-active) passive, verbatim from docs/ship-skills.csv (second passive).
const HERMES_R2 =
    'When an ally critically hits an enemy, this Unit <unit-skill>adds 1 charge</unit-skill> to ' +
    'its own charged skill and grants <unit-skill>Everliving Regeneration III</unit-skill> for 2 ' +
    "turns to the ally.<br /><br />This Unit's defense is increased by 20% and when it critically " +
    'repairs an ally, it <unit-skill>cleanses 1 debuff</unit-skill> from itself.';

/** Hermes's on-ally-crit riders through the REAL parser/builder (charge + Everliving buff). */
function hermesPassiveAbilities(): Ability[] {
    return (
        buildShipAbilities(ship({ secondPassiveSkillText: HERMES_R2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? []
    );
}

describe('Hermes R2 riders — extracted shape (mutation guard)', () => {
    it('the charge rides on-ally-crit on self; Everliving Regeneration III on the ally', () => {
        const abilities = hermesPassiveAbilities();
        const charge = abilities.find((a) => a.type === 'charge');
        const everliving = abilities.find(
            (a) =>
                a.type === 'buff' &&
                a.config.type === 'buff' &&
                /Everliving/.test(a.config.buffName)
        );
        if (!charge || !everliving) throw new Error('mutation guard: Hermes R2 riders not found');
        expect(charge.trigger).toBe('on-ally-crit');
        expect(charge.target).toBe('self');
        expect(everliving.trigger).toBe('on-ally-crit');
        expect(everliving.target).toBe('ally');
    });
});

const noopActive = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

/** A dummy enemy target: fat HP, does nothing meaningful. */
const dummyEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [noopActive()] }] },
});

/** A team actor with a no-op active and the given passive abilities. Acts last (speed 1) so the
 *  focus ally's crit precedes it; chargeCount headroom of 6. */
const teamActor = (id: string, position: Position, passive: Ability[]): TeamActorEngineInput => ({
    id,
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
                { slot: 'active', abilities: [noopActive()] },
                { slot: 'passive', abilities: passive },
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
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** Hermes observer (team actor) carrying its full R2 passive. */
const hermesObserver = (position: Position): TeamActorEngineInput =>
    teamActor('hermes', position, hermesPassiveAbilities());

/** The focus ally (`'attacker'`) crits with `active`. Hermes observes; a passive-less bystander
 *  ally sits on the same side, so a grant to "all allies" would show up on it. */
function runHermesWith(active: Ability, pattern: ParsedPattern, enemies: EnemyAttacker[]) {
    const input: CombatEngineInput = {
        attack: 1000,
        crit: 100, // every hit crits
        critDamage: 100,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [active] }] },
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
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
        pattern,
        teamActors: [hermesObserver('M3'), teamActor('bystander', 'M2', [])],
        enemyAttackers: enemies,
    };

    const bus = createEventBus();
    const everlivingOn: Record<string, number> = {};
    const everlivingGranters = new Set<string | undefined>();
    const chargeGains: Extract<CombatEvent, { type: 'charge-changed' }>[] = [];
    const perf: Extract<CombatEvent, { type: 'ability-performed' }>[] = [];
    bus.on('ability-performed', (e) => {
        if (e.actorId === 'attacker') perf.push(e);
    });
    bus.on('buff-applied', (e) => {
        if (!/Everliving/.test(e.buffName)) return;
        everlivingOn[e.actorId] = (everlivingOn[e.actorId] ?? 0) + 1;
        everlivingGranters.add(e.granterId);
    });
    bus.on('charge-changed', (e) => {
        if (e.actorId === 'hermes' && e.reason === 'manip') chargeGains.push(e);
    });
    runCombat({ ...input, bus });
    return {
        everlivingOn,
        everlivingGranters: [...everlivingGranters],
        chargeGained: chargeGains.reduce((s, e) => s + (e.newCharge - e.oldCharge), 0),
        perf,
    };
}

/** The focus ally fires `hits: 3` at a single enemy, critting on every sub-attack. That is THREE
 *  consecutive full-walk attacks, so Hermes grants Everliving Regeneration III to the focus ally
 *  three times and gains three charges — once per critting sub-attack. */
const runHermes = () =>
    runHermesWith(
        {
            id: 'multi-hit',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100, hits: 3 },
        },
        basePattern(),
        [dummyEnemy('enemy-a', 'M4')]
    );

describe('Hermes Everliving Regeneration — once per SUB-ATTACK, not per hit/victim', () => {
    it('a hits:3 ally crit grants Everliving to that ally three times and three charges', () => {
        const { everlivingOn, everlivingGranters, chargeGained, perf } = runHermes();
        // Fixture self-check: three critting sub-attacks.
        expect(perf).toHaveLength(3);
        expect(perf.every((e) => e.didCrit)).toBe(true);

        // `hits: 3` is THREE full-walk attacks, each with its own critting `ability-performed`.
        // The AoE case below discriminates this 3 from a per-(hit, victim) fan-out: there one
        // attack crits two victims and must still read 1.
        expect(everlivingOn).toEqual({ attacker: 3 });
        expect(everlivingGranters).toEqual(['hermes']);
        // The charge rides the same trigger on self and tracks the grant exactly.
        expect(chargeGained).toBe(3);
    });
});

/**
 * THE OTHER AXIS: ONE single-hit attack whose AoE footprint crits TWO victims. That is one
 * attack, so the critting ally gets ONE Everliving application and Hermes ONE charge, however many
 * footprint victims crit. The listener enqueues at most once per `ability-performed`, and
 * `oncePerAttackGuardKey` does not cover `on-ally-crit` — so this test is the only lock on the
 * per-victim collapse.
 */
const runHermesAoe = () =>
    runHermesWith(
        {
            id: 'single-hit-aoe',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            // hits: 1 — ONE attack. The spread comes from the pattern below.
            config: { type: 'damage', multiplier: 100 },
        },
        // Whole-roster footprint: one attack, two victims, both critting.
        { raw: 'all', shape: 'all', range: 'all', modifiers: {} },
        [dummyEnemy('enemy-a', 'M4'), dummyEnemy('enemy-b', 'M3')]
    );

describe('Hermes Everliving Regeneration — an AoE footprint is still ONE attack', () => {
    it('a single-hit crit across TWO victims grants Everliving once and one charge', () => {
        const { everlivingOn, everlivingGranters, chargeGained, perf } = runHermesAoe();
        // Fixture self-check: the fan-out axis under test must actually exist. ONE attack, TWO
        // critting victims — without this the assertions below would be vacuously satisfied.
        expect(perf).toHaveLength(1);
        expect(perf[0].critHits).toBe(2);

        expect(everlivingOn).toEqual({ attacker: 1 });
        expect(everlivingGranters).toEqual(['hermes']);
        expect(chargeGained).toBe(1);
    });
});

/**
 * An ALLY-target rider on on-ally-crit (the shape of Howler's Blast grant / Sentinel's ally
 * repair) fires exactly ONCE PER CRITTING SUB-ATTACK: a `hits: 3` skill is three full-walk
 * attacks, so it lands three times — never once per critting (hit, victim) pair. Per-ENEMY
 * fan-out for "…to that enemy" riders happens inside the damage executor via
 * eventCtx.critVictimIds, not by re-enqueuing.
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
    const observer = teamActor('howler', 'M3', [allyBuff]);

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
        expect(runAllyTargetRider()).toBe(3);
    });
});
