/**
 * Provider's charged extends DoTs on the enemies it targets, resolved by the extend-dot ability's
 * `target`:
 *   - catalogue text "…and all damage over time debuffs are extended by 1 turn" parses
 *     `extend-dot|all-enemies` → every enemy the cast's pattern hits;
 *   - our docs/ship-skills.csv text "…and extends active Damage Over Time effects by 1 turn"
 *     parses `extend-dot|enemy` → the cast's primary target only.
 *
 * Fight cases:
 *   (1) the charged hits 3 enemies in its cone, each carrying Corrosion → all three +1 turn;
 *   (2) an enemy outside the cone carrying Corrosion → not extended (same board as (1));
 *   (3) the old `enemy`-targeted text → the primary only;
 *   (4) a DoT the SAME cast inflicts is not extended, whichever side of the extension clause it
 *       is written on — the extension resolves before the cast lands its own DoTs;
 *   (5) an enemy in the cone that died earlier in the round is skipped; the living ones still
 *       extend;
 *   (6) an enemy-side Provider mirrors (1)/(2) onto the player board.
 *
 * Instrument: `dot-ticked` events per victim. A Corrosion ticks once per round it is live, so an
 * extended one ticks once more than the no-extension control on the same board. The outsider's
 * count is the positive control that the instrument sees ticks at all; the no-extension board is
 * the baseline every count is read against.
 *
 * Board (enemy side, Provider's real targeting from docs/ship-targeting.csv: front +
 * Pattern-Cone-Range-1): the cone anchored on M4 covers M4, M3, T3, B3. A faster ally seeds
 * Corrosion with a target-and-adjacent-enemies splash anchored on M4, which reaches M3, T3, T4
 * (and B3) — T4 is adjacent to M4 but outside the cone.
 *
 * Real parsed charged (buildShipAbilities on the verbatim texts), real engine (runCombat).
 * Hacking 200 vs security 0 lands every roll.
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

// Verbatim from docs/ship-skills.catalogue.csv (Provider charge_skill_text).
const PROVIDER_CHARGED_CATALOGUE =
    "This Unit deals <unit-damage>200% damage</unit-damage>, <unit-skill>removes 1 charge</unit-skill> from the enemy's charged skill and all <unit-skill>damage over time debuffs</unit-skill> are <unit-skill>extended by 1 turn</unit-skill>.";
// Verbatim from docs/ship-skills.csv (Provider charge_skill_text).
const PROVIDER_CHARGED_OLD =
    'This Unit deals <unit-damage>200% damage</unit-damage>, <unit-aid>removes 1 charge</unit-aid> from the enemy, and extends active <unit-aid>Damage Over Time</unit-aid> effects by 1 turn.';

const parsedCharged = (text: string): Skill => {
    const ship = {
        refits: [],
        activeSkillText: '',
        chargeSkillText: text,
        chargeSkillCharge: 3,
    } as unknown as Ship;
    const s = buildShipAbilities(ship).slots.find((x) => x.slot === 'charged');
    if (!s) throw new Error('Provider charged slot missing');
    return s;
};

const withoutExtension = (s: Skill): Skill => ({
    ...s,
    abilities: s.abilities.filter((a) => a.config.type !== 'extend-dot'),
});

/** Provider's kit: an empty active and the given charged. */
const providerKit = (charged: Skill): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [] }, charged],
});

const PROVIDER_TARGET = parseTarget('front');
const PROVIDER_PATTERN = parsePattern('Pattern-Cone-Range-1');
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// The seeding ally's Corrosion is tier 3; Provider's own (case 4) is tier 6 so its ticks are
// told apart from the seeded ones on the same victim (`dot-ticked` carries the tier).
const SEED_TIER = 3;
const OWN_TIER = 6;
const corrosion = (target: Ability['target'], tier: number, id: string): Ability => ({
    id,
    type: 'dot',
    target,
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'corrosion', tier, stacks: 1, duration: 2 },
});
const seedCorrosion = (): Ability =>
    corrosion('target-and-adjacent-enemies', SEED_TIER, 'seed-corrosion');

const plainHit = (): Ability => ({
    id: 'plain-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const victimAt = (id: string, position: Position, hp = 1_000_000): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

/** A walked player-side ally: fires `charged` once (round 1, startCharged) and `active` after. */
const teamActor = (
    id: string,
    position: Position,
    opts: {
        speed: number;
        active?: Ability[];
        charged?: Ability[];
        attack?: number;
        pattern?: ParsedPattern;
    }
): TeamActor => ({
    id,
    speed: opts.speed,
    chargeCount: 99,
    startCharged: true,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: PROVIDER_TARGET,
    pattern: opts.pattern ?? basePattern(),
    walk: {
        shipSkills: {
            slots: [
                { slot: 'active', abilities: opts.active ?? [] },
                { slot: 'charged', abilities: opts.charged ?? [] },
            ],
        },
        stats: {
            attack: opts.attack ?? 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
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

const seeder = (): TeamActor =>
    teamActor('seeder', 'M3', { speed: 150, charged: [seedCorrosion()] });

// Enemy board: M4 (anchor), M3 + T3 (covered by the cone), T4 (adjacent to M4, outside the cone).
const IN_CONE = ['e-m4', 'e-m3', 'e-t3'] as const;
const OUTSIDER = 'e-t4';
const enemyBoard = (): EnemyAttacker[] => [
    victimAt('e-m4', 'M4'),
    victimAt('e-m3', 'M3'),
    victimAt('e-t3', 'T3'),
    victimAt(OUTSIDER, 'T4'),
];

const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: enemyBoard(),
    teamActors: [seeder()],
    attack: 100,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 99,
    shipSkills: providerKit(parsedCharged(PROVIDER_CHARGED_CATALOGUE)),
    numRounds: 6,
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
    hp: 1_000_000_000,
    hacking: 200,
    speed: 100,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: PROVIDER_TARGET,
    pattern: PROVIDER_PATTERN,
    ...over,
});

const run = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['dot-applied', 'dot-ticked', 'attacked', 'ship-destroyed'] as const)
        bus.on(type, (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};

/** How many rounds a Corrosion of `tier` ticked on `targetId`. */
const corrosionTicks = (events: CombatEvent[], targetId: string, tier = SEED_TIER): number =>
    events.filter(
        (e) =>
            e.type === 'dot-ticked' &&
            e.targetId === targetId &&
            e.dotType === 'corrosion' &&
            e.tier === tier
    ).length;
const ticksBy = (events: CombatEvent[], ids: readonly string[], tier = SEED_TIER) =>
    Object.fromEntries(ids.map((id) => [id, corrosionTicks(events, id, tier)]));
/** Victims `attackerId`'s casts struck in `round`. */
const struckIn = (events: CombatEvent[], attackerId: string, round: number): string[] => [
    ...new Set(
        events.flatMap((e) =>
            e.type === 'attacked' && e.attackerId === attackerId && e.round === round
                ? [e.targetId]
                : []
        )
    ),
];
const seededOn = (events: CombatEvent[], sourceId: string): string[] =>
    events.flatMap((e) =>
        e.type === 'dot-applied' && e.sourceId === sourceId && e.dotType === 'corrosion'
            ? [e.targetId]
            : []
    );

const ALL_ENEMIES = [...IN_CONE, OUTSIDER] as const;

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Provider charged — parse', () => {
    it('catalogue text targets all enemies; our current text targets the primary', () => {
        const ext = (text: string) =>
            parsedCharged(text).abilities.find((a) => a.config.type === 'extend-dot');
        expect(ext(PROVIDER_CHARGED_CATALOGUE)).toMatchObject({
            target: 'all-enemies',
            trigger: 'on-cast',
            config: { type: 'extend-dot', turns: 1 },
        });
        expect(ext(PROVIDER_CHARGED_OLD)).toMatchObject({
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'extend-dot', turns: 1 },
        });
    });
});

describe('Provider charged — DoT extension across the pattern (player side)', () => {
    const baseline = () =>
        ticksBy(
            run(
                BASE({
                    shipSkills: providerKit(
                        withoutExtension(parsedCharged(PROVIDER_CHARGED_CATALOGUE))
                    ),
                })
            ),
            ALL_ENEMIES
        );

    it('the board: the seed lands on all four enemies; the cone strikes M4, M3, T3 only', () => {
        const events = run(BASE());
        expect(seededOn(events, 'seeder').sort()).toEqual([...ALL_ENEMIES].sort());
        expect(struckIn(events, 'attacker', 1).sort()).toEqual([...IN_CONE].sort());
        // The no-extension control ticks every seeded Corrosion the same number of times.
        const b = baseline();
        expect(b['e-m4']).toBeGreaterThan(0);
        for (const id of ALL_ENEMIES) expect(b[id]).toBe(b['e-m4']);
    });

    it('(1)+(2) catalogue text: every enemy in the cone +1 turn, the outsider unchanged', () => {
        const b = baseline();
        const ext = ticksBy(run(BASE()), ALL_ENEMIES);
        for (const id of IN_CONE) expect(ext[id]).toBe(b[id] + 1);
        expect(ext[OUTSIDER]).toBe(b[OUTSIDER]);
    });

    it('(3) our current text (target enemy): only the primary +1 turn', () => {
        const b = baseline();
        const ext = ticksBy(
            run(BASE({ shipSkills: providerKit(parsedCharged(PROVIDER_CHARGED_OLD)) })),
            ALL_ENEMIES
        );
        expect(ext['e-m4']).toBe(b['e-m4'] + 1);
        for (const id of ['e-m3', 'e-t3', OUTSIDER]) expect(ext[id]).toBe(b[id]);
    });
});

describe('Provider charged — a DoT the same cast inflicts is not extended (4)', () => {
    // Hand-authored charged skills: the parsed catalogue charged with Provider's own Corrosion
    // (tier 6, primary only) written BEFORE or AFTER the extension clause. Either way his fresh
    // Corrosion ticks its plain duration while the seeded one on the same victim gains a turn.
    const charged = (order: 'dot-first' | 'extend-first'): Skill => {
        const s = parsedCharged(PROVIDER_CHARGED_CATALOGUE);
        const own = corrosion('enemy', OWN_TIER, 'own-corrosion');
        return {
            ...s,
            abilities: order === 'dot-first' ? [own, ...s.abilities] : [...s.abilities, own],
        };
    };
    const ownBaseline = () => {
        const s = charged('dot-first');
        return corrosionTicks(
            run(BASE({ shipSkills: providerKit(withoutExtension(s)) })),
            'e-m4',
            OWN_TIER
        );
    };

    it.each(['dot-first', 'extend-first'] as const)('%s', (order) => {
        const plain = ownBaseline();
        expect(plain).toBeGreaterThan(0);
        const noExt = run(BASE({ shipSkills: providerKit(withoutExtension(charged(order))) }));
        const events = run(BASE({ shipSkills: providerKit(charged(order)) }));
        expect(seededOn(events, 'attacker')).toContain('e-m4');
        expect(corrosionTicks(events, 'e-m4', OWN_TIER)).toBe(plain);
        // Positive control on the same board: the seeded Corrosion on that victim is extended.
        expect(corrosionTicks(events, 'e-m4')).toBe(corrosionTicks(noExt, 'e-m4') + 1);
    });
});

describe('Provider charged — a dead enemy in the cone (5)', () => {
    // B3 is in the cone (covered cell) with 1 HP. A killer ally in the B lane (speed 140, after
    // the seeder) shoots it first, so B3 dies in round 1 before Provider casts. The cone's anchor
    // M4 survives, so the footprint geometry is unchanged.
    const killer = (): TeamActor =>
        teamActor('killer', 'B4', { speed: 140, active: [plainHit()], attack: 1000 });
    const board = () => [...enemyBoard(), victimAt('e-b3', 'B3', 1)];
    const input = (charged: Skill) =>
        BASE({
            enemyAttackers: board(),
            teamActors: [seeder(), { ...killer(), startCharged: false }],
            shipSkills: providerKit(charged),
        });

    it('the corpse is skipped; the living in-cone enemies still gain a turn', () => {
        const noExt = run(input(withoutExtension(parsedCharged(PROVIDER_CHARGED_CATALOGUE))));
        const events = run(input(parsedCharged(PROVIDER_CHARGED_CATALOGUE)));
        expect(seededOn(events, 'seeder')).toContain('e-b3');
        expect(events.find((e) => e.type === 'ship-destroyed' && e.actorId === 'e-b3')?.round).toBe(
            1
        );
        expect(struckIn(events, 'attacker', 1).sort()).toEqual([...IN_CONE].sort());
        const b = ticksBy(noExt, ALL_ENEMIES);
        const ext = ticksBy(events, ALL_ENEMIES);
        for (const id of IN_CONE) expect(ext[id]).toBe(b[id] + 1);
        expect(ext[OUTSIDER]).toBe(b[OUTSIDER]);
    });
});

describe('Provider charged — team symmetry (enemy-side Provider) (6)', () => {
    // Mirror board: the enemy Provider at M4 casts its cone on the PLAYER board — focus at M4
    // (anchor), allies at M3 + T3 (covered), T4 (adjacent, outside). An enemy seeder lands the
    // splash Corrosion first.
    const enemyActor = (
        id: string,
        position: Position,
        speed: number,
        skills: ShipSkills,
        pattern: ParsedPattern
    ): EnemyAttacker => ({
        id,
        stats: {
            attack: id === 'provider-enemy' ? 100 : 0,
            crit: 0,
            critDamage: 0,
            speed,
            hp: 1_000_000,
            defence: 0,
            hacking: 200,
        },
        chargeCount: 99,
        startCharged: true,
        position,
        target: PROVIDER_TARGET,
        pattern,
        shipSkills: skills,
    });
    const playerVictim = (id: string, position: Position): TeamActor => ({
        ...teamActor(id, position, { speed: 1 }),
        chargeCount: 0,
        startCharged: false,
    });
    const PLAYER_IN_CONE = ['attacker', 'p-m3', 'p-t3'] as const;
    const PLAYER_OUTSIDER = 'p-t4';
    const PLAYERS = [...PLAYER_IN_CONE, PLAYER_OUTSIDER] as const;
    const runEnemySide = (charged: Skill) =>
        run(
            BASE({
                attack: 0,
                shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                hasChargedSkill: false,
                startCharged: false,
                chargeCount: 0,
                security: 0,
                speed: 1,
                teamActors: [
                    playerVictim('p-m3', 'M3'),
                    playerVictim('p-t3', 'T3'),
                    playerVictim(PLAYER_OUTSIDER, 'T4'),
                ],
                enemyAttackers: [
                    enemyActor('provider-enemy', 'M4', 100, providerKit(charged), PROVIDER_PATTERN),
                    enemyActor(
                        'seeder-enemy',
                        'M3',
                        150,
                        {
                            slots: [
                                { slot: 'active', abilities: [] },
                                { slot: 'charged', abilities: [seedCorrosion()] },
                            ],
                        },
                        basePattern()
                    ),
                ],
            })
        );

    it('the mirror board: the seed lands on all four players; the cone strikes the three', () => {
        const events = runEnemySide(parsedCharged(PROVIDER_CHARGED_CATALOGUE));
        expect(seededOn(events, 'seeder-enemy').sort()).toEqual([...PLAYERS].sort());
        expect(struckIn(events, 'provider-enemy', 1).sort()).toEqual([...PLAYER_IN_CONE].sort());
    });

    it('(6) every player ship in the cone +1 turn, the outsider unchanged', () => {
        const b = ticksBy(
            runEnemySide(withoutExtension(parsedCharged(PROVIDER_CHARGED_CATALOGUE))),
            PLAYERS
        );
        expect(b.attacker).toBeGreaterThan(0);
        for (const id of PLAYERS) expect(b[id]).toBe(b.attacker);
        const ext = ticksBy(runEnemySide(parsedCharged(PROVIDER_CHARGED_CATALOGUE)), PLAYERS);
        for (const id of PLAYER_IN_CONE) expect(ext[id]).toBe(b[id] + 1);
        expect(ext[PLAYER_OUTSIDER]).toBe(b[PLAYER_OUTSIDER]);
    });

    it('(6) our current text on the enemy side: only the primary +1 turn', () => {
        const b = ticksBy(
            runEnemySide(withoutExtension(parsedCharged(PROVIDER_CHARGED_CATALOGUE))),
            PLAYERS
        );
        const ext = ticksBy(runEnemySide(parsedCharged(PROVIDER_CHARGED_OLD)), PLAYERS);
        expect(ext.attacker).toBe(b.attacker + 1);
        for (const id of ['p-m3', 'p-t3', PLAYER_OUTSIDER]) expect(ext[id]).toBe(b[id]);
    });
});
