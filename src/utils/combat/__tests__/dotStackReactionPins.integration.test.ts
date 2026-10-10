/**
 * Pins for how per-stack DoT landings (owner ruling R30) and per-stack infliction reactions (R28)
 * meet the reactions that count them (owner rulings 2026-10-04):
 *
 *  - Xcellence ("When an enemy resists a debuff infliction") reacts ONCE per resisting enemy per
 *    sub-attack. Her teammate Snakeroot's "2 stacks of Corrosion" both resisted by B is one
 *    sub-attack → one react. Vindicator's "When this Unit resists" HP-basis hit collapses the same
 *    way. (Only a multi-attack cast — Enforcer — reacts several times in one turn.)
 *  - Lingshe's three per-stack "inflicts a Bomb → Stealth" gains are three fresh buff gains, so
 *    Nuqtu's "when an enemy gains a buff" reacts three times.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv). Each case runs on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills, SkillSlot } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

beforeEach(() => {
    setupKeyedRng(31);
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const kit = (ship: string, slots: SkillSlot[]): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.filter((s) => slots.includes(s.slot));
    if (found.length !== slots.length) throw new Error(`${ship} lacks one of ${slots.join(',')}`);
    return { slots: found };
};
/** `ship`'s real passive, with an empty active so it never casts. */
const passiveOnly = (ship: string): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [] }, kit(ship, ['passive']).slots[0]],
});

const HP = 1e6;

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 9,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: true,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HP,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

interface ShipSpec {
    id: string;
    kit: ShipSkills;
    speed: number;
    hacking: number;
    security: number;
    position: Position;
}

const asEnemy = (s: ShipSpec): EnemyAttacker => ({
    id: s.id,
    stats: {
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: HP,
        speed: s.speed,
        security: s.security,
        hacking: s.hacking,
    },
    chargeCount: 9,
    startCharged: false,
    position: s.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: s.kit,
});
const asTeammate = (s: ShipSpec): TeamActor => ({
    id: s.id,
    speed: s.speed,
    chargeCount: 9,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: s.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: s.kit,
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: s.hacking,
            defence: 0,
            hp: HP,
            security: s.security,
        },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: true,
    },
});

/** One board: `mine` are on one side (the first is the M4 front ship), `theirs` on the other.
 *  `playerMine` puts `mine` on the player side; otherwise they are the enemy side. Returns the
 *  round-1 event stream. */
const run = (mine: ShipSpec[], theirs: ShipSpec[], playerMine: boolean): CombatEvent[] => {
    const [front, ...rest] = playerMine ? mine : theirs;
    const others = playerMine ? theirs : mine;
    const events: CombatEvent[] = [];
    const bus = createEventBus();
    const types = [
        'debuff-resisted',
        'reactive-damage-performed',
        'buff-applied',
        'dot-applied',
    ] as const;
    for (const t of types)
        bus.on(t, (e: CombatEvent) => {
            if (e.round === 1) events.push(e);
        });
    runCombat({
        ...base({
            shipSkills: front.kit,
            speed: front.speed,
            hacking: front.hacking,
            security: front.security,
            teamActors: rest.map(asTeammate),
            enemyAttackers: others.map(asEnemy),
        }),
        bus,
    });
    return events;
};
/** The player front ship always runs as the focus, id 'attacker'. */
const idOf = (s: ShipSpec, playerSide: boolean, isFront: boolean): string =>
    playerSide && isFront ? 'attacker' : s.id;

describe('Xcellence: two resisted stacks in one sub-attack → one react', () => {
    for (const playerMine of [true, false]) {
        const tag = playerMine ? 'player' : 'enemy-side';
        it(`${tag}: teammate Snakeroot's 2 stacks both resisted by B → Xcellence hits B once`, () => {
            const snake: ShipSpec = {
                id: 'snake',
                kit: kit('Snakeroot', ['active']),
                speed: 50,
                hacking: 0,
                security: 0,
                position: 'M4',
            };
            const xcel: ShipSpec = {
                id: 'xcel',
                kit: passiveOnly('Xcellence'),
                speed: 100,
                hacking: 0,
                security: 0,
                position: 'M3',
            };
            const b: ShipSpec = {
                id: 'b',
                kit: { slots: [{ slot: 'active', abilities: [] }] },
                speed: 10,
                hacking: 0,
                security: 1000,
                position: 'M4',
            };
            const ev = run([snake, xcel], [b], playerMine);
            const snakeId = idOf(snake, playerMine, true);
            const bId = idOf(b, !playerMine, true);
            const resists = ev.filter(
                (e) =>
                    e.type === 'debuff-resisted' &&
                    e.sourceId === snakeId &&
                    e.targetId === bId &&
                    e.viaLandingRoll === true
            );
            expect(resists).toHaveLength(2);
            const reacts = ev.filter(
                (e) => e.type === 'reactive-damage-performed' && e.sourceId === 'xcel'
            );
            expect(reacts.map((e) => (e as { targetId: string }).targetId)).toEqual([bId]);
        });
    }
});

describe('Vindicator: resisting two stacks in one sub-attack → one HP-basis hit', () => {
    for (const playerMine of [true, false]) {
        const tag = playerMine ? 'player' : 'enemy-side';
        it(`${tag}: Vindicator resists both of Snakeroot's stacks → retaliates once`, () => {
            const vind: ShipSpec = {
                id: 'vind',
                kit: passiveOnly('Vindicator'),
                speed: 10,
                hacking: 0,
                security: 1000,
                position: 'M4',
            };
            const snake: ShipSpec = {
                id: 'snake',
                kit: kit('Snakeroot', ['active']),
                speed: 100,
                hacking: 0,
                security: 0,
                position: 'M4',
            };
            const ev = run([vind], [snake], playerMine);
            const vindId = idOf(vind, playerMine, true);
            const snakeId = idOf(snake, !playerMine, true);
            expect(
                ev.filter(
                    (e) =>
                        e.type === 'debuff-resisted' &&
                        e.targetId === vindId &&
                        e.viaLandingRoll === true
                )
            ).toHaveLength(2);
            const reacts = ev.filter(
                (e) => e.type === 'reactive-damage-performed' && e.sourceId === vindId
            );
            expect(reacts.map((e) => (e as { targetId: string }).targetId)).toEqual([snakeId]);
        });
    }
});

describe("Nuqtu: Lingshe's three per-stack Stealth gains are three 'enemy gains a buff'", () => {
    for (const playerMine of [true, false]) {
        const tag = playerMine ? 'player' : 'enemy-side';
        it(`${tag}: Lingshe lands 3 Bomb stacks → 3 Stealth gains → Nuqtu reacts 3 times`, () => {
            const lingshe: ShipSpec = {
                id: 'lingshe',
                kit: kit('Lingshe', ['active', 'passive']),
                speed: 100,
                hacking: 1e6,
                security: 0,
                position: 'M4',
            };
            const nuqtu: ShipSpec = {
                id: 'nuqtu',
                kit: passiveOnly('Nuqtu'),
                speed: 10,
                hacking: 0,
                security: 0,
                position: 'M4',
            };
            const ev = run([lingshe], [nuqtu], playerMine);
            const lingsheId = idOf(lingshe, playerMine, true);
            const nuqtuId = idOf(nuqtu, !playerMine, true);
            const stealth = ev.filter(
                (e) =>
                    e.type === 'buff-applied' && e.actorId === lingsheId && e.buffName === 'Stealth'
            );
            expect(stealth).toHaveLength(3);
            const bolster = ev.filter(
                (e) =>
                    e.type === 'buff-applied' &&
                    e.actorId === nuqtuId &&
                    e.buffName === 'Terran Bolster III'
            );
            expect(bolster).toHaveLength(3);
        });
    }
});
