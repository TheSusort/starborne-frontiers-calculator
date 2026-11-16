/**
 * The Torpedo's end-of-round self-destruct (Abyssal Fenri, bounty Lv33):
 * "At the end of a round, if this Unit is the first in the row, it destroys itself to deal 150%
 * damage that cannot critically hit, bypasses enemy Defense, and ignores all targeting changing
 * effects." plus "This Unit deals 100% more direct damage to Defenders."
 *
 * Owner rulings (spec 2026-11-16): the blast is a row attack on the torpedo's own row, aimed at the
 * front-most enemy there (full damage), every other enemy in that row takes 50%; "first in the
 * row" is the front-most living unit of its own side in its row, read live; the torpedo then hits
 * itself for 10x its max HP and dies, a death no one is credited with.
 *
 * Every engine case runs with the torpedoes on the enemy side and on the player side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent, type CombatEventType } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip, npcShip } from '../../../constants/bountyBosses';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { CombatActor } from '../state';
import {
    boardInput,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const SIDES: Placement[] = ['enemy', 'player'];

const TORPEDO_ATTACK = 29082;
const TORPEDO_HP = 38160;
/** 150% of the torpedo's attack, defence bypassed, neutral affinity. */
const PRIMARY = Math.round(TORPEDO_ATTACK * 1.5);

const torpedoKit = (): ShipSkills => buildShipAbilities(npcShip('torpedo', 135)!);

const torpedo = (id: string, position: BoardUnit['position'], over: Partial<BoardUnit> = {}) =>
    ({
        id,
        kit: torpedoKit(),
        position,
        speed: 93,
        hp: TORPEDO_HP,
        attack: TORPEDO_ATTACK,
        ...over,
    }) satisfies BoardUnit;

const dummy = (id: string, position: BoardUnit['position'], over: Partial<BoardUnit> = {}) =>
    ({ id, kit: NO_KIT, position, speed: 50, hp: 1e9, ...over }) satisfies BoardUnit;

const selfBuff = (
    id: string,
    buffName: string,
    trigger: Ability['trigger'] = 'pre-combat'
): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger,
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 9,
    },
});

const kitWith = (...passives: Ability[]): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'passive', abilities: passives },
    ],
});

const RECORDED: CombatEventType[] = [
    'reactive-damage-performed',
    'ship-destroyed',
    'charge-changed',
    'buff-applied',
    'turn-started',
    'attacked',
];

interface Run {
    events: CombatEvent[];
    /** HP after the whole fight. */
    hp: Record<string, number>;
    id: (u: BoardUnit) => string;
}

/** `torpedoes[0]` is the carrier; the rest of `ownSide` are its allies. */
const run = (
    placement: Placement,
    ownSide: BoardUnit[],
    opponents: BoardUnit[],
    rounds = 1
): Run => {
    const [carrier, ...allies] = ownSide;
    const { input, id } = boardInput(placement, carrier, allies, opponents, rounds);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of RECORDED) bus.on(type, (e) => events.push(e));
    let actors: CombatActor[] = [];
    runCombat({ ...input, bus, __testTapActors: (all) => (actors = all) });
    const hp: Record<string, number> = {};
    for (const a of actors) hp[a.id] = a.currentHp;
    return { events, hp, id };
};

const blastsBy = (r: Run, unitId: string) =>
    r.events.filter(
        (e) => e.type === 'reactive-damage-performed' && e.sourceId === unitId
    ) as Extract<CombatEvent, { type: 'reactive-damage-performed' }>[];

const destroyed = (r: Run, unitId: string) =>
    r.events.filter((e) => e.type === 'ship-destroyed' && e.actorId === unitId) as Extract<
        CombatEvent,
        { type: 'ship-destroyed' }
    >[];

const taken = (r: Run, u: BoardUnit) => (u.hp ?? 1e9) - r.hp[r.id(u)];

// ── parse ───────────────────────────────────────────────────────────────────────────────────

describe('torpedo blast parse', () => {
    const blast = () =>
        torpedoKit()
            .slots.flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'damage');

    it('is one end-of-round damage ability gated on being first in the row', () => {
        const a = blast();
        expect(a?.trigger).toBe('end-of-round');
        expect(a?.target).toBe('own-row-front-enemy');
        expect(a?.conditions).toEqual([{ subject: 'self-front-of-row', derivable: true }]);
        expect(a?.config).toMatchObject({
            type: 'damage',
            multiplier: 150,
            noCrit: true,
            ignoresDefense: true,
            ignoresStealth: true,
            ignoresForcedTargeting: true,
            ignoresConcentrateFire: true,
            selfDestruct: true,
        });
    });

    it('keeps the Defender bonus as a passive outgoing modifier', () => {
        const mod = torpedoKit()
            .slots.flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'modifier');
        expect(mod?.conditions).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
        ]);
    });
});

// ── engine ──────────────────────────────────────────────────────────────────────────────────

describe.each(SIDES)('torpedoes on the %s side', (placement) => {
    /** Two torpedoes on the top row plus a durable ally on the bottom row, so their side is never
     *  wiped. Opponents: a decoy on the bottom row (roster-first, so a fall-through to "first
     *  living opposing actor" would hit it), two in the top row, one in the middle row. */
    const board = (opts: { opponents?: BoardUnit[]; t4?: Partial<BoardUnit> } = {}) => {
        const t4 = torpedo('torpedoT4', 'T4', opts.t4);
        const t2 = torpedo('torpedoT2', 'T2');
        const anchor = dummy('anchor', 'B1', { speed: 1 });
        const decoy = dummy('decoy', 'B4');
        const front = dummy('front', 'T4');
        const back = dummy('back', 'T1');
        const middle = dummy('middle', 'M4');
        return {
            t4,
            t2,
            anchor,
            decoy,
            front,
            back,
            middle,
            own: [t4, t2, anchor],
            opponents: opts.opponents ?? [decoy, front, back, middle],
        };
    };

    it('ONE BLAST PER ROUND: T4 blasts at the end of round 1, T2 at the end of round 2', () => {
        const b = board();
        const r = run(placement, b.own, b.opponents, 3);
        const roundsOf = (u: BoardUnit) => blastsBy(r, r.id(u)).map((e) => e.round);
        // Each blast reaches the two top-row opponents.
        expect(roundsOf(b.t4)).toEqual([1, 1]);
        expect(roundsOf(b.t2)).toEqual([2, 2]);
        expect(destroyed(r, r.id(b.t4)).map((e) => e.round)).toEqual([1]);
        expect(destroyed(r, r.id(b.t2)).map((e) => e.round)).toEqual([2]);
    });

    it('hits the front-most enemy of its row in full and the rest of that row at 50%', () => {
        const b = board();
        const r = run(placement, b.own, b.opponents, 1);
        expect(taken(r, b.front)).toBe(PRIMARY);
        expect(taken(r, b.back)).toBe(PRIMARY / 2);
        expect(taken(r, b.middle)).toBe(0);
        expect(taken(r, b.decoy)).toBe(0);
    });

    it('cannot crit, even at 100% crit', () => {
        const b = board({ t4: { crit: 100, critDamage: 150 } });
        const r = run(placement, b.own, b.opponents, 1);
        expect(taken(r, b.front)).toBe(PRIMARY);
        expect(blastsBy(r, r.id(b.t4)).some((e) => e.didCrit)).toBe(false);
    });

    it('bypasses Defense: a huge-defence front ship takes the same as a 0-defence one', () => {
        const hard = dummy('front', 'T4', { defence: 1e6 });
        const b = board();
        const r = run(placement, b.own, [b.decoy, hard, b.back, b.middle], 1);
        expect(taken(r, hard)).toBe(PRIMARY);
    });

    it('is not pulled by a Taunting ship in another row', () => {
        const taunter = dummy('decoy', 'B4', { kit: kitWith(selfBuff('taunt', 'Taunt')) });
        const b = board();
        const r = run(placement, b.own, [taunter, b.front, b.back, b.middle], 1);
        expect(taken(r, taunter)).toBe(0);
        expect(taken(r, b.front)).toBe(PRIMARY);
    });

    it('hits a Stealthed enemy in its row', () => {
        const stealthed = dummy('front', 'T4', { kit: kitWith(selfBuff('stealth', 'Stealth')) });
        const b = board();
        const r = run(placement, b.own, [b.decoy, stealthed, b.back, b.middle], 1);
        expect(taken(r, stealthed)).toBe(PRIMARY);
    });

    it('deals a Defender (any Defender sub-role) double, primary and splash alike', () => {
        const front = dummy('front', 'T4', { role: 'DEFENDER_SECURITY' });
        const back = dummy('back', 'T1', { role: 'DEFENDER' });
        const b = board();
        const r = run(placement, b.own, [b.decoy, front, back, b.middle], 1);
        expect(taken(r, front)).toBe(PRIMARY * 2);
        expect(taken(r, back)).toBe(PRIMARY);
    });

    it('control: a non-Defender role takes the plain damage', () => {
        const front = dummy('front', 'T4', { role: 'SUPPORTER' });
        const b = board();
        const r = run(placement, b.own, [b.decoy, front, b.back, b.middle], 1);
        expect(taken(r, front)).toBe(PRIMARY);
    });

    it('destroys itself despite its damage immunity, credited to no one and not by direct damage', () => {
        const b = board();
        const r = run(placement, b.own, b.opponents, 1);
        const [death] = destroyed(r, r.id(b.t4));
        expect(death).toBeDefined();
        expect(death.killerId).toBeUndefined();
        expect(death.byDirectDamage).toBe(false);
        expect(r.hp[r.id(b.t4)]).toBe(0);
    });

    it('ASSUMPTION (empty enemy row): blasts nothing and still destroys itself', () => {
        const b = board();
        const r = run(placement, b.own, [b.decoy, b.middle], 1);
        expect(blastsBy(r, r.id(b.t4))).toEqual([]);
        expect(taken(r, b.decoy)).toBe(0);
        expect(taken(r, b.middle)).toBe(0);
        expect(destroyed(r, r.id(b.t4)).map((e) => e.round)).toEqual([1]);
    });

    it('does nothing while a living ally stands in front of it in its row', () => {
        const shield = dummy('shield', 'T4');
        const t2 = torpedo('torpedoT2', 'T2');
        const b = board();
        const r = run(placement, [t2, shield, b.anchor], b.opponents, 2);
        expect(blastsBy(r, r.id(t2))).toEqual([]);
        expect(destroyed(r, r.id(t2))).toEqual([]);
        expect(r.hp[r.id(t2)]).toBe(TORPEDO_HP);
    });

    it('its death fires a "When an enemy is destroyed" passive: Liberator grants every ally a charge', () => {
        const b = board();
        const liberator = dummy('liberator', 'B1', { kit: realKit('Liberator'), chargeCount: 9 });
        // An ally with a charged skill to receive the charge.
        const mate = dummy('mate', 'B2', {
            kit: {
                slots: [
                    { slot: 'active', abilities: [] },
                    { slot: 'charged', abilities: [] },
                ],
            },
            chargeCount: 9,
        });
        // The decoy stays roster-first (the enemy-placement focus actor).
        const r = run(placement, b.own, [b.decoy, liberator, mate, b.front, b.back], 1);
        const grants = (u: BoardUnit) =>
            r.events.filter(
                (e) =>
                    e.type === 'charge-changed' &&
                    e.actorId === r.id(u) &&
                    e.reason === 'manip' &&
                    e.newCharge === e.oldCharge + 1
            ).length;
        // One torpedo dies in round 1: one charge each.
        expect(destroyed(r, r.id(b.t4))).toHaveLength(1);
        expect(grants(liberator)).toBe(1);
        expect(grants(mate)).toBe(1);
    });

    const onEnemyDestroyed = (scope: 'any' | 'owner', directOnly = false): Ability => ({
        ...selfBuff(`kill-${scope}-${directOnly}`, `Kill ${scope}${directOnly ? ' direct' : ''}`),
        trigger: 'on-enemy-destroyed',
        ...(scope === 'owner' ? { triggerKillerScope: 'owner' as const } : {}),
        ...(directOnly ? { triggerRequiresDirectDeath: true } : {}),
    });

    it('fires an any-death reaction but no kill-owned or direct-death reaction', () => {
        const b = board();
        const watcher = dummy('watcher', 'B3', {
            kit: kitWith(
                onEnemyDestroyed('any'),
                onEnemyDestroyed('owner'),
                onEnemyDestroyed('any', true)
            ),
        });
        const r = run(placement, b.own, [b.decoy, watcher, b.front, b.back], 1);
        const fired = (name: string) =>
            r.events.filter(
                (e) =>
                    e.type === 'buff-applied' && e.actorId === r.id(watcher) && e.buffName === name
            ).length;
        expect(fired('Kill any')).toBe(1);
        expect(fired('Kill owner')).toBe(0);
        expect(fired('Kill any direct')).toBe(0);
    });

    it("is not an enemy death to its own side: its ally's on-enemy-destroyed stays silent", () => {
        const b = board();
        const fenriLike = dummy('anchor', 'B1', {
            speed: 1,
            kit: kitWith(onEnemyDestroyed('any')),
        });
        const r = run(placement, [b.t4, b.t2, fenriLike], b.opponents, 1);
        expect(
            r.events.filter((e) => e.type === 'buff-applied' && e.actorId === r.id(fenriLike))
        ).toEqual([]);
    });

    it('control: the same ally reaction fires when an opposing ship dies', () => {
        const b = board();
        const fenriLike = dummy('anchor', 'B1', {
            speed: 1,
            kit: kitWith(onEnemyDestroyed('any')),
        });
        const frail = dummy('front', 'T4', { hp: 10 });
        const r = run(placement, [b.t4, b.t2, fenriLike], [b.decoy, frail, b.back], 1);
        expect(destroyed(r, r.id(frail))).toHaveLength(1);
        expect(
            r.events.filter((e) => e.type === 'buff-applied' && e.actorId === r.id(fenriLike))
        ).toHaveLength(1);
    });

    it("Abyssal Fenri's real kit: a torpedo death is no enemy death to him, a player death is", () => {
        const fenri = dummy('anchor', 'B1', {
            speed: 130,
            kit: buildShipAbilities(bossShip('fenri', 33)!),
        });
        const attackUps = (r: Run) =>
            r.events.filter(
                (e) =>
                    e.type === 'buff-applied' &&
                    e.actorId === r.id(fenri) &&
                    e.buffName === 'Attack Up II'
            ).length;
        const b = board();
        const quiet = run(placement, [b.t4, b.t2, fenri], b.opponents, 1);
        expect(destroyed(quiet, quiet.id(b.t4))).toHaveLength(1);
        expect(attackUps(quiet)).toBe(0);
        // Control: the blast kills a frail front ship, which is an enemy death to him.
        const frail = dummy('front', 'T4', { hp: 10 });
        const loud = run(placement, [b.t4, b.t2, fenri], [b.decoy, frail, b.back], 1);
        expect(destroyed(loud, loud.id(frail))).toHaveLength(1);
        expect(attackUps(loud)).toBe(1);
    });
});
