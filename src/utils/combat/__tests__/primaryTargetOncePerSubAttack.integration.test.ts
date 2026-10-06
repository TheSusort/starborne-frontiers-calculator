/**
 * Owner ruling R92 (verified in game 2026-10-06): a "when directly damaged AS A PRIMARY TARGET"
 * trigger fires AT MOST ONCE per victim per incoming sub-attack, counting the whole chain of
 * reactions that sub-attack sets off. Any AIMED hit uses the allowance up — a cast's primary hit,
 * a counter, Sentinel's on-crit hit, Provider's hit. An area skill's hit on a NON-primary target
 * neither counts nor uses it. Each sub-attack of a multi-hit skill brings its own allowance.
 * Plain "when directly damaged" triggers (Isha's repair) fire on every hit.
 *
 * Carriers: Stalwart (counter + Legion Discipline II), Nosorog (reflect), Malvex (shield).
 *
 * Real parsed kits (refit 4), every board run with the carrier on the player side and on the
 * enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    realKit,
    NO_KIT,
    hitKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { parsePattern } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(92));

const SIDES: Placement[] = ['player', 'enemy'];

/** `ship`'s real kit with only the passive slots, and an empty active so it never casts. */
const passiveOnly = (ship: string): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        ...realKit(ship).slots.filter((s) => s.slot === 'passive'),
    ],
});

/** `ship`'s real active plus its passives (no charged, so round 1 is always the active). */
const activeAndPassive = (ship: string): ShipSkills => ({
    slots: realKit(ship).slots.filter((s) => s.slot === 'active' || s.slot === 'passive'),
});

const ripper = (opts: { aoe?: boolean; crit?: number } = {}): BoardUnit => ({
    id: 'ripper',
    kit: activeAndPassive('Ripper'),
    position: 'M4',
    speed: 300,
    attack: 10_000,
    crit: opts.crit ?? 100,
    critDamage: 50,
    hacking: 10_000,
    ...(opts.aoe ? { pattern: parsePattern('Pattern-Cone-Range-1') } : {}),
});
/** Hits each enemy another ally debuffs, once per debuff landed. */
const provider: BoardUnit = {
    id: 'provider',
    kit: passiveOnly('Provider'),
    position: 'M2',
    speed: 200,
    attack: 10_000,
};
const sentinel: BoardUnit = {
    id: 'sentinel',
    kit: passiveOnly('Sentinel'),
    position: 'M2',
    speed: 200,
    attack: 10_000,
};
/** A harmless front-liner that takes the area cast's primary hit. */
const frontFiller: BoardUnit = { id: 'filler', kit: NO_KIT, position: 'M4', speed: 2 };

interface Observed {
    /** Every counter-attack, as `from>to`, in order. */
    counters: string[];
    /** Every other direct hit, as `from>to`, in order — the non-vacuity instrument. */
    hits: string[];
    /** Every Legion Discipline II grant to `holder`. */
    legionGrants: number;
    /** Isha-style passive self repairs by `holder`. */
    selfRepairs: number;
    /** Reflected damage per receiving actor id, summed over the fight. */
    reflected: Record<string, number>;
}

const run = (
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    holderId: string
): { obs: Observed; id: (u: BoardUnit) => string } => {
    const { input, id } = boardInput(placement, carrier, allies, opponents, 1);
    const all = [carrier, ...allies, ...opponents];
    const nameOf = (actorId: string): string => all.find((u) => id(u) === actorId)?.id ?? actorId;
    const holder = id(all.find((u) => u.id === holderId)!);
    const bus = createEventBus();
    const obs: Observed = {
        counters: [],
        hits: [],
        legionGrants: 0,
        selfRepairs: 0,
        reflected: {},
    };
    bus.on('attacked', (e) => {
        const hit = `${nameOf(e.attackerId)}>${nameOf(e.targetId)}`;
        (e.fromCounter ? obs.counters : obs.hits).push(hit);
    });
    bus.on('buff-applied', (e) => {
        if (e.actorId === holder && e.buffName === 'Legion Discipline II') obs.legionGrants++;
    });
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === holder && e.perTarget.some((t) => t.targetId === holder))
            obs.selfRepairs++;
    });
    const { rounds } = runCombat({ ...input, bus });
    for (const r of rounds) {
        for (const [actorId, amount] of Object.entries(r.perActorReflected ?? {})) {
            obs.reflected[nameOf(actorId)] = (obs.reflected[nameOf(actorId)] ?? 0) + amount;
        }
    }
    return { obs, id };
};

const stalwartAt = (position: BoardUnit['position']): BoardUnit => ({
    id: 'stalwart',
    kit: passiveOnly('Stalwart'),
    position,
    speed: 1,
    attack: 10_000,
});

describe.each(SIDES)('Stalwart (attackers on the %s side)', (placement) => {
    it('Ripper crits him as primary → he counters Ripper; Sentinel’s tap then draws no counter', () => {
        const { obs } = run(placement, ripper(), [sentinel], [stalwartAt('M4')], 'stalwart');
        expect(obs.hits).toContain('sentinel>stalwart');
        expect(obs.counters).toEqual(['stalwart>ripper']);
        // The buff hangs off the same "as a primary target" sentence: once, not once per hit.
        expect(obs.legionGrants).toBe(1);
    });

    it('Ripper’s area hit crits him as NON-primary → no counter on Ripper; Sentinel’s tap draws one', () => {
        const { obs } = run(
            placement,
            ripper({ aoe: true }),
            [sentinel],
            [frontFiller, stalwartAt('M3')],
            'stalwart'
        );
        expect(obs.counters).toEqual(['stalwart>sentinel']);
        expect(obs.legionGrants).toBe(1);
    });

    it('Ripper hits him as primary and debuffs him → Provider’s hits draw no counter', () => {
        const { obs } = run(
            placement,
            ripper({ crit: 0 }),
            [provider],
            [stalwartAt('M4')],
            'stalwart'
        );
        expect(obs.hits.filter((h) => h === 'provider>stalwart').length).toBeGreaterThan(0);
        expect(obs.counters).toEqual(['stalwart>ripper']);
    });

    it('Ripper’s area hit debuffs him as NON-primary → Provider’s first hit draws the one counter', () => {
        const { obs } = run(
            placement,
            ripper({ aoe: true, crit: 0 }),
            [provider],
            [frontFiller, stalwartAt('M3')],
            'stalwart'
        );
        // Several Provider hits (one per debuff landed), only the first is a primary-target hit.
        expect(obs.hits.filter((h) => h === 'provider>stalwart').length).toBeGreaterThan(1);
        expect(obs.counters).toEqual(['stalwart>provider']);
    });

    it('control: no Sentinel → the area hit alone draws no counter', () => {
        const { obs } = run(
            placement,
            ripper({ aoe: true }),
            [],
            [frontFiller, stalwartAt('M3')],
            'stalwart'
        );
        expect(obs.counters).toEqual([]);
        expect(obs.legionGrants).toBe(0);
    });

    it('Enforcer’s three-attack active → three counters', () => {
        const enforcer: BoardUnit = {
            id: 'enforcer',
            kit: activeAndPassive('Enforcer'),
            position: 'M4',
            speed: 300,
            attack: 10_000,
        };
        const { obs } = run(placement, enforcer, [], [stalwartAt('M4')], 'stalwart');
        expect(obs.counters).toEqual([
            'stalwart>enforcer',
            'stalwart>enforcer',
            'stalwart>enforcer',
        ]);
    });

    it('Stalwart A hits Stalwart B → B counters → A counters back → B does not counter again', () => {
        const a: BoardUnit = {
            id: 'stalwartA',
            kit: activeAndPassive('Stalwart'),
            position: 'M4',
            speed: 300,
            attack: 10_000,
        };
        const b: BoardUnit = { ...stalwartAt('M4'), id: 'stalwartB' };
        const { obs } = run(placement, a, [], [b], 'stalwartB');
        expect(obs.counters).toEqual(['stalwartB>stalwartA', 'stalwartA>stalwartB']);
    });
});

describe.each(SIDES)('Nosorog (attackers on the %s side)', (placement) => {
    const nosorogAt = (position: BoardUnit['position']): BoardUnit => ({
        id: 'nosorog',
        kit: passiveOnly('Nosorog'),
        position,
        speed: 1,
        attack: 10_000,
    });

    it('Ripper crits him as primary → he reflects onto Ripper only, not onto Sentinel’s tap', () => {
        const { obs } = run(placement, ripper(), [sentinel], [nosorogAt('M4')], 'nosorog');
        expect(obs.reflected.ripper ?? 0).toBeGreaterThan(0);
        expect(obs.reflected.sentinel ?? 0).toBe(0);
    });

    it('Ripper’s area hit covers him → nothing onto Ripper; Sentinel’s tap is reflected', () => {
        const { obs } = run(
            placement,
            ripper({ aoe: true }),
            [sentinel],
            [frontFiller, nosorogAt('M3')],
            'nosorog'
        );
        expect(obs.reflected.ripper ?? 0).toBe(0);
        expect(obs.reflected.sentinel ?? 0).toBeGreaterThan(0);
    });
});

describe.each(SIDES)(
    'Isha’s plain "when directly damaged" repair (attackers on the %s side)',
    (placement) => {
        it('an ally’s crit and then Sentinel’s tap → she repairs twice', () => {
            const isha: BoardUnit = {
                id: 'isha',
                kit: passiveOnly('Isha'),
                position: 'M4',
                speed: 1,
                hp: 1e6,
            };
            const { obs } = run(placement, ripper(), [sentinel], [isha], 'isha');
            expect(obs.selfRepairs).toBe(2);
        });
    }
);

describe('tripwire: which ships carry a primary-target damage trigger', () => {
    // A ship whose skill text gains "directly damaged as a primary target" after a data refresh must
    // parse onto one of the flags the once-per-sub-attack allowance gates; a ship whose text says
    // plain "when directly damaged" (Isha, Opal, Shepherd) must not.
    const PRIMARY_DAMAGED = /directly damaged as a primary target/i;
    const carriesFlag = (kit: ShipSkills): boolean =>
        kit.slots.some((slot) =>
            slot.abilities.some(
                (a) =>
                    a.triggerPrimaryTargetOnly === true ||
                    ('requirePrimaryTarget' in a.config && a.config.requirePrimaryTarget === true)
            )
        );

    it('the text carriers and the parsed carriers are the same ships', () => {
        const records = loadShipSkillRecords();
        const byText = records
            .filter((r) => [r.active, r.charge, ...r.passives].some((t) => PRIMARY_DAMAGED.test(t)))
            .map((r) => r.name)
            .sort();
        const byParse = records
            .filter((r) => carriesFlag(realKit(r.name)))
            .map((r) => r.name)
            .sort();
        expect(byText).toEqual(['Malvex', 'Nosorog', 'Stalwart']);
        expect(byParse).toEqual(byText);
        // Positive control: Isha's plain "When directly damaged" repair parses, unflagged.
        expect(records.some((r) => r.name === 'Isha')).toBe(true);
        expect(carriesFlag(realKit('Isha'))).toBe(false);
    });
});

describe.each(SIDES)('each sub-attack is its own chain (attackers on the %s side)', (placement) => {
    it('a two-attack area skill covering Stalwart → Sentinel’s tap after EACH attack draws a counter', () => {
        const twoHitCone: BoardUnit = {
            id: 'cone',
            kit: hitKit(100, 2),
            position: 'M4',
            speed: 300,
            attack: 10_000,
            crit: 100,
            critDamage: 50,
            pattern: parsePattern('Pattern-Cone-Range-1'),
        };
        const { obs } = run(
            placement,
            twoHitCone,
            [sentinel],
            [frontFiller, stalwartAt('M3')],
            'stalwart'
        );
        expect(obs.hits.filter((h) => h === 'sentinel>stalwart').length).toBe(2);
        expect(obs.counters).toEqual(['stalwart>sentinel', 'stalwart>sentinel']);
    });
});
