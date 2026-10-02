/**
 * Hermes's charged skill: a charge to every ally in his support pattern, and Cheat Death to EACH
 * ally in that pattern who is below 40% HP — checked per recipient, never against one target.
 *
 *   catalogue: "This Unit repairs 37% of its max HP and adds 1 charge to the charged skill of
 *               allies. If an ally has less than 40% HP, it grants that ally Cheat Death."
 *   ours:      "This Unit repairs 37% of its Max HP and adds 1 charge to the Charged Skill.
 *               If the target has less than 40% HP, it grants Cheat Death."
 *
 * Owner ruling (2026-10-02): the pattern (allies + Pattern-Circle-Support-Range-1, anchored on
 * Hermes) targets Hermes and every adjacent ally EQUALLY — so "the target" in our text is each of
 * them, the same skill the catalogue text describes. Both parse to one `all-allies` grant carrying
 * `recipientFilter: { hpBelowPct: 40 }`.
 *
 * WHICH HP: clauses resolve in written order (locked rule), and the repair is written before the
 * Cheat Death clause. So each recipient's HP is read AFTER this cast's repair has landed on it. A
 * hand-authored kit with the Cheat Death clause written first reads the pre-repair HP.
 *
 * Fight cases (every count read against a positive control on the same board):
 *   (1) Hermes casts with ally A (80%) and ally B (30%) in the pattern → B gets Cheat Death, A
 *       does not; Hermes, A and B each gain a charge;
 *   (2) Hermes himself below 40% after his own repair → he gets Cheat Death too;
 *   (3) ally C OUTSIDE the pattern at 20% → no Cheat Death, no charge, no repair;
 *   (4) nobody below 40% → no Cheat Death; the charges still land;
 *   (5) an enemy-side Hermes mirrors (1) and (4);
 *   (6) the repair lifting B from 38% to above 40% → no Cheat Death; with the Cheat Death clause
 *       written before the repair, the same B gets it.
 *
 * Arithmetic: Hermes's max HP is 10,000, so his repair is 3,700 to each recipient. Allies have
 * 100,000 max HP, so the repair lifts them 3.7 points: B 30% → 33.7% (below 40), B 38% → 41.7%
 * (not below 40). Hermes himself gains 37 points of his own HP: 1% → 38% (below 40).
 *
 * Board (player side): Hermes at M3. His pattern from M3 covers M3, M2, M4, T2, T3, B2, B3. A at
 * M4 and B at T3 are inside; C at T4 is outside. The enemy is inert (attack 0, slowest), so the
 * only HP movement in round 1 is Hermes's repair. Real parsed charged (buildShipAbilities on the
 * verbatim texts), real engine (runCombat), `mode: 'battle'` so the repair lands on every
 * recipient's own HP.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills, Skill } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

// Verbatim from docs/ship-skills.catalogue.csv (Hermes charge_skill_text).
const HERMES_CHARGED_CATALOGUE =
    'This Unit <unit-damage>repairs 37%</unit-damage> of its max HP and <unit-skill>adds 1 charge</unit-skill> to the charged skill of allies.<br /><br />If an ally has less than 40% HP, it grants that ally <unit-skill>Cheat Death</unit-skill>.';
// Verbatim from docs/ship-skills.csv (Hermes charge_skill_text).
const HERMES_CHARGED_OLD =
    'This Unit <unit-damage>repairs 37%</unit-damage> of its Max HP and <unit-aid>adds 1 charge</unit-aid> to the Charged Skill.<br /><br />If the target has less than 40% HP, it grants <unit-skill>Cheat Death</unit-skill>.';

const parsedCharged = (text: string): Skill => {
    const ship = {
        refits: [],
        activeSkillText: '',
        chargeSkillText: text,
        chargeSkillCharge: 6,
    } as unknown as Ship;
    const s = buildShipAbilities(ship).slots.find((x) => x.slot === 'charged');
    if (!s) throw new Error('Hermes charged slot missing');
    return s;
};

const isCheatDeath = (a: Ability) =>
    a.config.type === 'buff' && a.config.buffName === 'Cheat Death';

/** The parsed charged with its Cheat Death clause moved IN FRONT of the repair. */
const cheatDeathFirst = (s: Skill): Skill => ({
    ...s,
    abilities: [
        ...s.abilities.filter(isCheatDeath),
        ...s.abilities.filter((a) => !isCheatDeath(a)),
    ],
});

const hermesKit = (charged: Skill): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [] }, charged],
});

const HERMES_TARGET = parseTarget('allies');
const HERMES_PATTERN = parsePattern('Pattern-Circle-Support-Range-1');
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const HERMES_MAX_HP = 10_000;
const ALLY_MAX_HP = 100_000;

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

/** HP fractions (0..1) each actor enters the fight at; unlisted actors start full. */
type StartHp = Record<string, number>;

const tapStartHp =
    (start: StartHp, sink: Map<string, CombatActor>) =>
    (actors: CombatActor[]): void => {
        for (const a of actors) {
            sink.set(a.id, a);
            const f = start[a.id];
            if (f !== undefined) a.currentHp = a.stats.hp * f;
        }
    };

const run = (input: CombatEngineInput, start: StartHp) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['buff-applied', 'charge-changed', 'heal-performed', 'skill-fired'] as const)
        bus.on(type, (e) => events.push(e as CombatEvent));
    const actors = new Map<string, CombatActor>();
    runCombat({ ...input, bus, __testTapActors: tapStartHp(start, actors) });
    return { events, actors };
};

/** Every actor that received Cheat Death in round 1, sorted. */
const cheatDeathTo = (events: CombatEvent[]): string[] =>
    events
        .flatMap((e) =>
            e.type === 'buff-applied' && e.buffName === 'Cheat Death' && e.round === 1
                ? [e.actorId]
                : []
        )
        .sort();
/** Every actor whose charge an ability raised in round 1, sorted. */
const chargedUp = (events: CombatEvent[]): string[] =>
    [
        ...new Set(
            events.flatMap((e) =>
                e.type === 'charge-changed' &&
                e.reason === 'manip' &&
                e.round === 1 &&
                e.newCharge > e.oldCharge
                    ? [e.actorId]
                    : []
            )
        ),
    ].sort();
/** Recipients of `casterId`'s round-1 cast repair, sorted. */
const repairedBy = (events: CombatEvent[], casterId: string): string[] =>
    [
        ...new Set(
            events.flatMap((e) =>
                e.type === 'heal-performed' && e.casterId === casterId && e.round === 1
                    ? e.targets
                    : []
            )
        ),
    ].sort();
const chargedFired = (events: CombatEvent[], actorId: string): boolean =>
    events.some(
        (e) =>
            e.type === 'skill-fired' &&
            e.actorId === actorId &&
            e.slot === 'charged' &&
            e.round === 1
    );
const hpPct = (actors: Map<string, CombatActor>, id: string): number => {
    const a = actors.get(id)!;
    return (100 * a.currentHp) / a.stats.hp;
};

beforeEach(() => {
    setupKeyedRng(7);
});

describe('Hermes charged — parse', () => {
    it.each([
        ['catalogue', HERMES_CHARGED_CATALOGUE],
        ['ours', HERMES_CHARGED_OLD],
    ])('%s text: one all-allies Cheat Death with a per-recipient below-40% filter', (_, text) => {
        const cd = parsedCharged(text).abilities.find(isCheatDeath)!;
        expect(cd).toMatchObject({
            type: 'buff',
            target: 'all-allies',
            trigger: 'on-cast',
            conditions: [],
            recipientFilter: { hpBelowPct: 40 },
            config: { type: 'buff', buffName: 'Cheat Death', duration: 'recurring' },
        });
        // The repair is written first, so it sorts first (clause order).
        expect(parsedCharged(text).abilities.map((a) => a.type)).toEqual([
            'heal',
            'charge',
            'buff',
        ]);
    });
});

// ── Player side ──────────────────────────────────────────────────────────────

/** A walked ally with no skills, acting after Hermes. */
const ally = (id: string, position: Position): TeamActor => ({
    id,
    speed: 1,
    chargeCount: 6,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: basePattern(),
    walk: {
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
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
        hasChargedSkill: true,
    },
});

const inertEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 0, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const playerBoard = (charged: Skill): CombatEngineInput => ({
    enemyAttackers: [inertEnemy('e1', 'M4')],
    teamActors: [ally('a', 'M4'), ally('b', 'T3'), ally('c', 'T4')],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 6,
    shipSkills: hermesKit(charged),
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: true,
    startCharged: true,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HERMES_MAX_HP,
    hacking: 0,
    speed: 100,
    mode: 'battle',
    position: 'M3',
    target: HERMES_TARGET,
    pattern: HERMES_PATTERN,
});

const IN_PATTERN = ['a', 'attacker', 'b'];

describe('Hermes charged — per-recipient Cheat Death (player side)', () => {
    const charged = parsedCharged(HERMES_CHARGED_CATALOGUE);

    it('the board: the charged fires round 1; the repair and the charge reach Hermes, A, B — not C', () => {
        const { events } = run(playerBoard(charged), { a: 0.8, b: 0.3, c: 0.2 });
        expect(chargedFired(events, 'attacker')).toBe(true);
        expect(repairedBy(events, 'attacker')).toEqual(IN_PATTERN);
        expect(chargedUp(events)).toEqual(IN_PATTERN);
    });

    it('(1)+(3) B at 30% gets Cheat Death; A at 80%, Hermes at full and C outside at 20% do not', () => {
        const { events, actors } = run(playerBoard(charged), { a: 0.8, b: 0.3, c: 0.2 });
        // The repair lands before the gate reads: B is 33.7%, still below 40.
        expect(hpPct(actors, 'b')).toBeCloseTo(33.7, 5);
        expect(hpPct(actors, 'c')).toBeCloseTo(20, 5);
        expect(cheatDeathTo(events)).toEqual(['b']);
        expect(chargedUp(events)).toEqual(IN_PATTERN);
    });

    it('our text grants the same Cheat Death', () => {
        const { events } = run(playerBoard(parsedCharged(HERMES_CHARGED_OLD)), {
            a: 0.8,
            b: 0.3,
            c: 0.2,
        });
        expect(cheatDeathTo(events)).toEqual(['b']);
    });

    it('(2) Hermes himself at 1% (38% after his own repair) gets Cheat Death too', () => {
        const { events, actors } = run(playerBoard(charged), {
            attacker: 0.01,
            a: 0.8,
            b: 0.3,
            c: 0.2,
        });
        expect(hpPct(actors, 'attacker')).toBeCloseTo(38, 5);
        expect(cheatDeathTo(events)).toEqual(['attacker', 'b']);
    });

    it('(4) nobody below 40%: no Cheat Death, the charges still land', () => {
        const { events } = run(playerBoard(charged), { a: 0.8, b: 0.8, c: 0.2 });
        expect(cheatDeathTo(events)).toEqual([]);
        expect(chargedUp(events)).toEqual(IN_PATTERN);
    });

    it('(6) the repair lifts B from 38% to 41.7% → no Cheat Death; with Cheat Death written first, B gets it', () => {
        const repairFirst = run(playerBoard(charged), { a: 0.8, b: 0.38, c: 0.2 });
        expect(hpPct(repairFirst.actors, 'b')).toBeCloseTo(41.7, 5);
        expect(cheatDeathTo(repairFirst.events)).toEqual([]);

        const gateFirst = run(playerBoard(cheatDeathFirst(charged)), {
            a: 0.8,
            b: 0.38,
            c: 0.2,
        });
        expect(hpPct(gateFirst.actors, 'b')).toBeCloseTo(41.7, 5);
        expect(cheatDeathTo(gateFirst.events)).toEqual(['b']);
    });
});

// ── Enemy side ───────────────────────────────────────────────────────────────

describe('Hermes charged — team symmetry (enemy-side Hermes) (5)', () => {
    // Mirror board on the enemy side: enemy Hermes at M3, enemy allies at M4 (80%), T3 and T4
    // (outside). The player focus is inert and slowest.
    const enemyShip = (
        id: string,
        position: Position,
        opts: { speed: number; hp: number; skills: ShipSkills; pattern: ParsedPattern }
    ): EnemyAttacker => ({
        id,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            speed: opts.speed,
            hp: opts.hp,
            defence: 0,
            hacking: 0,
        },
        chargeCount: 6,
        startCharged: id === 'hermes-enemy',
        position,
        target: id === 'hermes-enemy' ? HERMES_TARGET : parseTarget('front'),
        pattern: opts.pattern,
        shipSkills: opts.skills,
    });
    const enemyBoard = (charged: Skill): CombatEngineInput => ({
        ...playerBoard(charged),
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
        hasChargedSkill: false,
        startCharged: false,
        speed: 0,
        hp: 1_000_000,
        teamActors: [],
        position: 'M4',
        target: parseTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [
            enemyShip('hermes-enemy', 'M3', {
                speed: 100,
                hp: HERMES_MAX_HP,
                skills: hermesKit(charged),
                pattern: HERMES_PATTERN,
            }),
            ...(['e-a:M4', 'e-b:T3', 'e-c:T4'] as const).map((s) => {
                const [id, pos] = s.split(':') as [string, Position];
                return enemyShip(id, pos, {
                    speed: 1,
                    hp: ALLY_MAX_HP,
                    skills: { slots: [{ slot: 'active', abilities: [] }] },
                    pattern: basePattern(),
                });
            }),
        ],
    });
    const ENEMY_IN_PATTERN = ['e-a', 'e-b', 'hermes-enemy'];
    const charged = parsedCharged(HERMES_CHARGED_CATALOGUE);

    it('the mirror board: the repair and the charge reach Hermes, A, B — not C', () => {
        const { events } = run(enemyBoard(charged), { 'e-a': 0.8, 'e-b': 0.3, 'e-c': 0.2 });
        expect(chargedFired(events, 'hermes-enemy')).toBe(true);
        expect(repairedBy(events, 'hermes-enemy')).toEqual(ENEMY_IN_PATTERN);
        expect(chargedUp(events)).toEqual(ENEMY_IN_PATTERN);
    });

    it('(5) B at 30% gets Cheat Death; A at 80%, Hermes at full and C outside at 20% do not', () => {
        const { events, actors } = run(enemyBoard(charged), {
            'e-a': 0.8,
            'e-b': 0.3,
            'e-c': 0.2,
        });
        expect(hpPct(actors, 'e-b')).toBeCloseTo(33.7, 5);
        expect(cheatDeathTo(events)).toEqual(['e-b']);
    });

    it('(5) nobody below 40%: no Cheat Death, the charges still land', () => {
        const { events } = run(enemyBoard(charged), { 'e-a': 0.8, 'e-b': 0.8, 'e-c': 0.2 });
        expect(cheatDeathTo(events)).toEqual([]);
        expect(chargedUp(events)).toEqual(ENEMY_IN_PATTERN);
    });
});
