/**
 * Owner ruling R117 (GENERAL): "All and any reactions trigger before a ship dies." A ship killed by
 * a hit still fires its OWN reactions to that hit:
 *  - Warden: "When directly damaged, this Unit inflicts Corrosion I for 2 turns to the enemy and
 *    repairs 3% ... When this Unit inflicts a debuff, it also inflicts Out. Damage Down II".
 *  - Stalwart: "When this Unit is directly damaged as a primary target, it deals 70% damage to the
 *    enemy".
 *  - Heliodor: "When directly damaged, ... repairs all allies 8% of this Unit's max HP".
 *  - Opal: "When directly damaged, this Unit inflicts Attack Down II for 3 turns".
 *
 * Owner ruling R141 (in game): a sub-attack that takes its target to 0 HP still inflicts its
 * debuffs on that dying ship (Enforcer's crit Defense Shred lands), but OTHER ships' reactions to
 * those debuffs do not fire (Provider is silent). The next sub-attack moves on to the next enemy,
 * where Provider reacts as normal.
 *
 * Hayyan ("When a debuff is inflicted on an ally, this Unit repairs the ally for 6% of this Unit's
 * max HP") under the same two rulings: an ally killed by the debuffing hit keeps the debuffs and
 * gets no repair (R141; a reaction cannot revive a destroyed ship, R167), a living ally struck by
 * the same cast still gets its one repair, and Hayyan killed by the debuffing hit still repairs
 * the others for that cast (R117) and never again.
 *
 * Real parsed kits (buildTraceShip, refit 4). Every scenario runs with the subject on the player
 * side and mirrored onto the enemy side; each has a control in which the victim survives.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const passiveOnly = (ship: string): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        ...realKit(ship).slots.filter((s) => s.slot === 'passive'),
    ],
});

const run = (
    placement: Placement,
    subject: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    rounds = 1
): { events: CombatEvent[]; id: (u: BoardUnit) => string } => {
    const { input, id } = boardInput(placement, subject, allies, opponents, rounds);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    runCombat({ ...input, bus });
    return { events, id };
};

const destroyed = (events: CombatEvent[], actorId: string): boolean =>
    events.some((e) => e.type === 'ship-destroyed' && e.actorId === actorId);
/** Names of the debuffs and DoTs `sourceId` landed on `targetId`. */
const landed = (events: CombatEvent[], sourceId: string, targetId: string): string[] =>
    events.flatMap((e) => {
        if (e.type === 'debuff-applied' && e.sourceId === sourceId && e.targetId === targetId)
            return [e.buffName];
        if (e.type === 'dot-applied' && e.sourceId === sourceId && e.targetId === targetId)
            return [e.dotType];
        return [];
    });

describe.each<Placement>(['player', 'enemy'])(
    'R117 with the victim on the %s side',
    (placement) => {
        const hitter = (): BoardUnit => ({
            id: 'hitter',
            kit: hitKit(),
            position: 'M4',
            speed: 100,
            attack: 1000,
            hacking: 1e6,
        });
        const victim = (ship: string, hp: number): BoardUnit => ({
            id: 'victim',
            kit: passiveOnly(ship),
            position: 'M4',
            speed: 1,
            attack: 1000,
            hacking: 1e6,
            hp,
        });

        for (const hp of [500, 1e6]) {
            const lethal = hp === 500;
            it(`Warden ${lethal ? 'killed by' : 'surviving'} the hit inflicts Corrosion I and Out. Damage Down II`, () => {
                const v = victim('Warden', hp);
                const h = hitter();
                const { events, id } = run(placement, v, [], [h]);
                expect(destroyed(events, id(v))).toBe(lethal);
                expect(landed(events, id(v), id(h))).toEqual(['corrosion', 'Out. Damage Down II']);
                // Her 3% self-repair cannot bring a destroyed ship back: she ends the round at 0 HP.
                if (lethal) {
                    const snap = events.find(
                        (e) => e.type === 'hp-snapshot' && e.actorId === id(v) && e.round === 1
                    );
                    expect(snap && 'currentHp' in snap ? snap.currentHp : undefined).toBe(0);
                }
            });

            it(`Stalwart ${lethal ? 'killed by' : 'surviving'} the hit counters`, () => {
                const v = victim('Stalwart', hp);
                const h = hitter();
                const { events, id } = run(placement, v, [], [h]);
                expect(destroyed(events, id(v))).toBe(lethal);
                expect(
                    events.filter(
                        (e) =>
                            e.type === 'attacked' && e.attackerId === id(v) && e.targetId === id(h)
                    )
                ).toHaveLength(1);
            });

            it(`Heliodor ${lethal ? 'killed by' : 'surviving'} the hit repairs her ally`, () => {
                const v = victim('Heliodor', hp);
                const ally: BoardUnit = {
                    id: 'ally',
                    kit: NO_KIT,
                    position: 'M3',
                    speed: 2,
                    hp: 1e6,
                };
                const h = hitter();
                const { events, id } = run(placement, v, [ally], [h]);
                expect(destroyed(events, id(v))).toBe(lethal);
                const repairs = events.filter(
                    (e) => e.type === 'reactive-heal-performed' && e.casterId === id(v)
                );
                expect(repairs).toHaveLength(1);
            });

            it(`Opal ${lethal ? 'killed by' : 'surviving'} the hit inflicts Attack Down II`, () => {
                const v = victim('Opal', hp);
                const h = hitter();
                const { events, id } = run(placement, v, [], [h]);
                expect(destroyed(events, id(v))).toBe(lethal);
                expect(landed(events, id(v), id(h))).toContain('Attack Down II');
            });
        }

        it('a ship destroyed in an earlier round never reacts again', () => {
            // The hitter kills Warden in round 1; a second, slower hitter in round 2 has no Warden to
            // hit and no reaction answers it.
            const v = victim('Warden', 500);
            const h = hitter();
            const { events, id } = run(placement, v, [], [h], 2);
            expect(destroyed(events, id(v))).toBe(true);
            const round2 = events.filter(
                (e) => (e.type === 'dot-applied' || e.type === 'debuff-applied') && e.round === 2
            );
            expect(round2.filter((e) => 'sourceId' in e && e.sourceId === id(v))).toEqual([]);
        });
    }
);

describe.each<Placement>(['player', 'enemy'])('R141 with Enforcer on the %s side', (placement) => {
    const enforcerKit = (): ShipSkills => ({
        slots: realKit('Enforcer').slots.filter((s) => s.slot !== 'charged'),
    });
    const setup = (frontHp: number) => {
        const enforcer: BoardUnit = {
            id: 'enforcer',
            kit: enforcerKit(),
            position: 'M4',
            speed: 100,
            attack: 1000,
            crit: 100,
            hacking: 1e6,
        };
        const provider: BoardUnit = {
            id: 'provider',
            kit: passiveOnly('Provider'),
            position: 'M3',
            speed: 50,
            attack: 1000,
            hacking: 1e6,
        };
        const front: BoardUnit = {
            id: 'front',
            kit: NO_KIT,
            position: 'M4',
            speed: 1,
            hp: frontHp,
        };
        const back: BoardUnit = { id: 'back', kit: NO_KIT, position: 'M3', speed: 2 };
        const { events, id } = run(placement, enforcer, [provider], [front, back]);
        const providerHits = (target: BoardUnit) =>
            events.filter(
                (e) =>
                    e.type === 'reactive-damage-performed' &&
                    e.sourceId === id(provider) &&
                    e.targetId === id(target)
            ).length;
        return { events, id, enforcer, provider, front, back, providerHits };
    };

    it('hit 1 kills the front ship: its Shred lands, Provider is silent on it and reacts on the next enemy', () => {
        const s = setup(100);
        expect(destroyed(s.events, s.id(s.front))).toBe(true);
        expect(landed(s.events, s.id(s.enforcer), s.id(s.front))).toEqual(['Defense Shred']);
        expect(s.providerHits(s.front)).toBe(0);
        expect(landed(s.events, s.id(s.provider), s.id(s.front))).toEqual([]);
        expect(landed(s.events, s.id(s.enforcer), s.id(s.back))).toEqual([
            'Defense Shred',
            'Defense Shred',
        ]);
        // Hits 2 and 3 each crit the ship behind; each hit is its own action (R166).
        expect(s.providerHits(s.back)).toBe(2);
    });

    it('control: a front ship that survives draws Provider onto it', () => {
        const s = setup(1e9);
        expect(destroyed(s.events, s.id(s.front))).toBe(false);
        expect(s.providerHits(s.front)).toBeGreaterThan(0);
    });
});

describe.each<Placement>(['player', 'enemy'])('Hayyan on the %s side', (placement) => {
    const hayyan = (hp: number): BoardUnit => ({
        id: 'hayyan',
        kit: passiveOnly('Hayyan'),
        position: 'M2',
        speed: 1,
        hp,
    });
    /** Curator's active alone: "60% damage to all enemies, then inflicts Attack Down III and Crit
     *  Power Down III for 2 turns". */
    const curator = (): BoardUnit => ({
        id: 'curator',
        kit: { slots: realKit('Curator').slots.filter((s) => s.slot !== 'charged') },
        position: 'M4',
        speed: 100,
        attack: 1000,
        hacking: 1e6,
        pattern: parsePattern('Pattern-All'),
        target: parseTarget('all'),
    });
    const repairsBy = (
        events: CombatEvent[],
        healerId: string,
        targetId: string,
        round?: number
    ): number =>
        events.filter(
            (e) =>
                e.type === 'reactive-heal-performed' &&
                e.casterId === healerId &&
                (round === undefined || e.round === round) &&
                e.perTarget.some((p) => p.targetId === targetId)
        ).length;

    describe('an AoE kills ally A and debuffs ally B', () => {
        const setup = (aHp: number) => {
            const h = hayyan(1e6);
            const a: BoardUnit = { id: 'allyA', kit: NO_KIT, position: 'M4', speed: 2, hp: aHp };
            const b: BoardUnit = { id: 'allyB', kit: NO_KIT, position: 'M3', speed: 3, hp: 1e6 };
            const c = curator();
            const { events, id } = run(placement, h, [a, b], [c], 1);
            return { events, id, h, a, b, c };
        };

        it('the dead ally keeps its debuffs and gets no repair; the living ally gets one', () => {
            const s = setup(500);
            expect(destroyed(s.events, s.id(s.a))).toBe(true);
            expect(landed(s.events, s.id(s.c), s.id(s.a))).toEqual([
                'Attack Down III',
                'Crit Power Down III',
            ]);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.a))).toBe(0);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.b))).toBe(1);
        });

        it('control: an ally A that survives is repaired once', () => {
            const s = setup(1e6);
            expect(destroyed(s.events, s.id(s.a))).toBe(false);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.a))).toBe(1);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.b))).toBe(1);
        });
    });

    describe("Enforcer's crit Defense Shred, hit by hit (R125, R141, R166)", () => {
        const setup = (aHp: number) => {
            // Hayyan's 6% of 1000 is too small to keep A alive through hit 2.
            const h = hayyan(1000);
            const a: BoardUnit = { id: 'allyA', kit: NO_KIT, position: 'M4', speed: 2, hp: aHp };
            const b: BoardUnit = { id: 'allyB', kit: NO_KIT, position: 'M3', speed: 3, hp: 1e9 };
            const enforcer: BoardUnit = {
                id: 'enforcer',
                kit: { slots: realKit('Enforcer').slots.filter((s) => s.slot !== 'charged') },
                position: 'M4',
                speed: 100,
                attack: 1000,
                crit: 100,
                hacking: 1e6,
            };
            const { events, id } = run(placement, h, [a, b], [enforcer], 1);
            const hitsOn = (u: BoardUnit) =>
                events.filter(
                    (e) =>
                        e.type === 'attacked' &&
                        e.attackerId === id(enforcer) &&
                        e.targetId === id(u)
                );
            return { events, id, h, a, b, enforcer, hitsOn };
        };

        it('hit 2 kills A: one repair on A for hit 1, none for the lethal hit, one on B for hit 3', () => {
            // A survives exactly one hit: 1.5 hits of HP, measured off the survivor control.
            const control = setup(1e9);
            const perHit = control
                .hitsOn(control.a)
                .map((e) => (e.type === 'attacked' ? (e.takenDamage ?? e.damage ?? 0) : 0));
            expect(perHit).toHaveLength(3);
            const s = setup(Math.round(perHit[0] * 1.5));
            expect(destroyed(s.events, s.id(s.a))).toBe(true);
            expect(s.hitsOn(s.a)).toHaveLength(2);
            expect(s.hitsOn(s.b)).toHaveLength(1);
            // Both Shreds land on A, the lethal one included (R141) …
            expect(landed(s.events, s.id(s.enforcer), s.id(s.a))).toEqual([
                'Defense Shred',
                'Defense Shred',
            ]);
            // … but only hit 1's draws Hayyan's repair; hit 3's Shred on B draws its own.
            expect(repairsBy(s.events, s.id(s.h), s.id(s.a))).toBe(1);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.b))).toBe(1);
        });

        it('control: an A that survives all three hits is repaired once per hit', () => {
            const s = setup(1e9);
            expect(destroyed(s.events, s.id(s.a))).toBe(false);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.a))).toBe(3);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.b))).toBe(0);
        });
    });

    describe('the debuffing hit kills Hayyan herself', () => {
        const setup = (hayyanHp: number) => {
            const h = hayyan(hayyanHp);
            const b: BoardUnit = { id: 'allyB', kit: NO_KIT, position: 'M3', speed: 3, hp: 1e6 };
            const c = curator();
            const { events, id } = run(placement, h, [b], [c], 2);
            return { events, id, h, b, c };
        };

        it('she repairs B for that cast (R117), never herself, and not in round 2', () => {
            const s = setup(500);
            expect(destroyed(s.events, s.id(s.h))).toBe(true);
            expect(landed(s.events, s.id(s.c), s.id(s.h))).toEqual([
                'Attack Down III',
                'Crit Power Down III',
            ]);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.b), 1)).toBe(1);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.h))).toBe(0);
            // Curator debuffs B again in round 2; dead Hayyan does not answer it.
            expect(landed(s.events, s.id(s.c), s.id(s.b))).toHaveLength(4);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.b), 2)).toBe(0);
        });

        it('control: a Hayyan who survives repairs B in both rounds and herself', () => {
            const s = setup(1e6);
            expect(destroyed(s.events, s.id(s.h))).toBe(false);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.b), 1)).toBe(1);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.b), 2)).toBe(1);
            expect(repairsBy(s.events, s.id(s.h), s.id(s.h))).toBeGreaterThan(0);
        });
    });
});
