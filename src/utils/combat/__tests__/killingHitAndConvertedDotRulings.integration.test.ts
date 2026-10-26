/**
 * Owner rulings 2026-10-23, on the edges of "nothing lands on the wreck" (#738) and of converted
 * DoTs:
 *  - Prophet ("When an ally resists a debuff infliction from an enemy, this Unit gains 2% more
 *    shield penetration") reacts to a resist on an ally that the same hit kills: Curator's area
 *    hit kills A, and A's resisted Attack Down III and Crit Power Down III still count. Landing
 *    rolls are drawn at cast time, before the damage.
 *  - A Bomb that a multi-hit attack lands after its first hit splashes when a later hit kills the
 *    carrier: it landed while the ship was alive. No shipped kit pairs a multi-hit with a Bomb, so
 *    the attacker is Mangler's real active ("deals 120% damage and inflicts Bomb I for 2 turns")
 *    widened to three hits.
 *  - Cheat Death wipes a converted DoT, although no cleanse can remove one: Voron ("When directly
 *    damaged, this Unit transforms the damage into a damage over time effect lasting for 3 turns")
 *    saved by Cheat Death ends with no DoT left.
 *  - Owner ruling 2026-10-26 (read in game): Heliodor ("When directly damaged, this Unit reduces
 *    the duration of all active debuffs on all allies by 1 turn") does not shorten Voron's
 *    converted DoT, while she still shortens a DoT applied to him.
 *
 * Real parsed kits (buildTraceShip, refit 4). Every scenario runs with the subject on the player
 * side and mirrored onto the enemy side, each with a control arm.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    FOCUS_ID,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const PLACEMENTS: Placement[] = ['player', 'enemy'];

const run = (
    placement: Placement,
    subject: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    rounds: number,
    onEvent?: (e: CombatEvent, actors: Map<string, CombatActor>) => void,
    /** Runs on the engine's actors before the first round. */
    prepare?: (actors: Map<string, CombatActor>, id: (u: BoardUnit) => string) => void
) => {
    const { input, id } = boardInput(placement, subject, allies, opponents, rounds);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const actors = new Map<string, CombatActor>();
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        onEvent?.(e, actors);
        emit(e);
    };
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            for (const a of all) actors.set(a.id, a);
            prepare?.(actors, id);
        },
    });
    return { events, actors, id };
};

const destroyed = (events: CombatEvent[], actorId: string): boolean =>
    events.some((e) => e.type === 'ship-destroyed' && e.actorId === actorId);

describe.each(PLACEMENTS)(
    'Prophet and a resist on a dying ally, Prophet on the %s side',
    (placement) => {
        const setup = (aHp: number, aSecurity: number) => {
            // Prophet acts after Curator with a plain 100% hit on Curator's shield, so her pen bonus
            // shows as shield absorption: each 1% of pen absorbs 1% of her hit less.
            const prophet: BoardUnit = {
                id: 'prophet',
                kit: {
                    slots: [
                        ...hitKit(100).slots,
                        ...realKit('Prophet').slots.filter((s) => s.slot === 'passive'),
                    ],
                },
                position: 'M2',
                speed: 1,
                attack: 10_000,
                hp: 1e9,
            };
            // Security far above Curator's hacking: both of Curator's debuffs draw a failed roll on A.
            const a: BoardUnit = {
                id: 'allyA',
                kit: NO_KIT,
                position: 'M4',
                speed: 2,
                hp: aHp,
                security: aSecurity,
            };
            // Curator's active alone: "deals 60% damage to all enemies, then inflicts Attack Down III
            // and Crit Power Down III for 2 turns". Hacking lands both on Prophet, who resists nothing.
            const curator: BoardUnit = {
                id: 'curator',
                kit: { slots: realKit('Curator').slots.filter((s) => s.slot === 'active') },
                position: 'M4',
                speed: 100,
                attack: 1000,
                hacking: 1e6,
                pattern: parsePattern('Pattern-All'),
                target: parseTarget('all'),
            };
            const SHIELD = 1e9;
            const r = run(placement, prophet, [a], [curator], 1, undefined, (actors, id) => {
                actors.get(id(curator))!.shieldPool = SHIELD;
            });
            const resistsOnA = r.events.filter(
                (e) => e.type === 'debuff-resisted' && e.targetId === r.id(a) && e.viaLandingRoll
            ).length;
            const absorbed = SHIELD - r.actors.get(r.id(curator))!.shieldPool;
            const prophetHit = r.events.find(
                (e) => e.type === 'attacked' && e.attackerId === r.id(prophet)
            );
            const hit = prophetHit?.type === 'attacked' ? (prophetHit.damage ?? 0) : 0;
            return { ...r, a, resistsOnA, absorbed, hit };
        };

        it('A killed by the hit still resists both debuffs, and Prophet gains 2% pen per resist', () => {
            const lands = setup(500, 0);
            const killed = setup(500, 1e9);
            expect(destroyed(killed.events, killed.id(killed.a))).toBe(true);
            expect(lands.resistsOnA).toBe(0);
            expect(killed.resistsOnA).toBe(2);
            expect(lands.absorbed).toBeGreaterThan(0);
            expect(killed.hit).toBe(lands.hit);
            expect(lands.absorbed - killed.absorbed).toBeCloseTo(0.04 * lands.hit, 6);
        });

        it('control: an A that survives the hit gives Prophet the same 4%', () => {
            const lands = setup(1e9, 0);
            const survives = setup(1e9, 1e9);
            expect(destroyed(survives.events, survives.id(survives.a))).toBe(false);
            expect(survives.resistsOnA).toBe(2);
            expect(lands.absorbed - survives.absorbed).toBeCloseTo(0.04 * lands.hit, 6);
        });
    }
);

describe.each(PLACEMENTS)('a three-hit Bomb attack on the %s side', (placement) => {
    const manglerThreeHits = (): ShipSkills => ({
        slots: realKit('Mangler')
            .slots.filter((s) => s.slot === 'active')
            .map((s) => ({
                ...s,
                abilities: s.abilities.map((ab) =>
                    ab.config.type === 'damage' ? { ...ab, config: { ...ab.config, hits: 3 } } : ab
                ),
            })),
    });
    /** Each hit deals 1,200 (120% of 1,000 attack, no defence). */
    const setup = (oHp: number) => {
        const m: BoardUnit = {
            id: 'mangler',
            kit: manglerThreeHits(),
            position: 'M4',
            speed: 100,
            attack: 1000,
            hacking: 1e6,
            pattern: parsePattern('Pattern-Base'),
        };
        const o: BoardUnit = { id: 'O', kit: NO_KIT, position: 'M4', speed: 1, hp: oHp };
        const p: BoardUnit = { id: 'P', kit: NO_KIT, position: 'M3', speed: 1, hp: 1e9 };
        const r = run(placement, m, [], [o, p], 1);
        const bombsOnO = r.events.filter(
            (e) => e.type === 'dot-applied' && e.dotType === 'bomb' && e.targetId === r.id(o)
        ).length;
        const splashOnP = r.events.filter(
            (e) => e.type === 'bomb-splash-log' && e.victimId === r.id(p)
        ).length;
        return { ...r, o, bombsOnO, splashOnP };
    };

    it('PRECONDITION: the widened kit is three hits followed by a Bomb', () => {
        const configs = manglerThreeHits().slots[0].abilities.map((ab) => ab.config);
        expect(configs[0]).toMatchObject({ type: 'damage', hits: 3 });
        expect(configs[1]).toMatchObject({ type: 'dot', dotType: 'bomb' });
    });

    it('hit 3 kills: the Bomb landed after hit 1 splashes the neighbour', () => {
        const s = setup(3000);
        expect(destroyed(s.events, s.id(s.o))).toBe(true);
        expect(s.bombsOnO).toBe(1);
        expect(s.splashOnP).toBe(1);
    });

    it('hit 1 kills: no Bomb lands, so nothing splashes', () => {
        const s = setup(1000);
        expect(destroyed(s.events, s.id(s.o))).toBe(true);
        expect(s.bombsOnO).toBe(0);
        expect(s.splashOnP).toBe(0);
    });

    it('control: a target that survives all three hits carries the Bomb and splashes nothing', () => {
        const s = setup(1e9);
        expect(destroyed(s.events, s.id(s.o))).toBe(false);
        expect(s.bombsOnO).toBe(1);
        expect(s.splashOnP).toBe(0);
    });
});

describe.each(PLACEMENTS)('Voron saved by Cheat Death on the %s side', (placement) => {
    const cheatDeath = {
        id: 'test-cheat-death',
        type: 'buff' as const,
        target: 'self' as const,
        trigger: 'on-cast' as const,
        conditions: [],
        config: {
            type: 'buff' as const,
            buffName: 'Cheat Death',
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            duration: 'recurring' as const,
        },
    };
    const voronKit = (withCheatDeath: boolean): ShipSkills => ({
        slots: [
            { slot: 'active', abilities: [] },
            ...realKit('Voron')
                .slots.filter((s) => s.slot === 'passive')
                .map((s) => ({
                    ...s,
                    abilities: withCheatDeath ? [...s.abilities, cheatDeath] : s.abilities,
                })),
        ],
    });
    /** A 1,000 hit each round becomes a 3-turn DoT; Voron's 400 HP gives out to its ticks. */
    const setup = (withCheatDeath: boolean) => {
        const voron: BoardUnit = {
            id: 'voron',
            kit: voronKit(withCheatDeath),
            position: 'M4',
            speed: 1,
            hp: 400,
        };
        const hitter: BoardUnit = {
            id: 'hitter',
            kit: hitKit(100),
            position: 'M4',
            speed: 100,
            attack: 1000,
        };
        let converted = 0;
        let convertedBeforeSave = 0;
        let convertedAtSave: number | undefined;
        // `boardInput` runs the player-side subject as the focus actor.
        const voronId = placement === 'player' ? FOCUS_ID : voron.id;
        const r = run(placement, voron, [], [hitter], 3, (e, actors) => {
            const v = actors.get(voronId);
            if (!v) return;
            if (e.type === 'cheat-death-activated' && e.actorId === voronId) {
                convertedBeforeSave = converted;
                convertedAtSave = v.genericDoTEntries.filter((d) => d.convertedFromHit).length;
            }
            converted = v.genericDoTEntries.filter((d) => d.convertedFromHit).length;
        });
        return { ...r, voron, convertedBeforeSave, convertedAtSave };
    };

    it('the save wipes every converted DoT he carries', () => {
        const s = setup(true);
        expect(
            s.events.some((e) => e.type === 'cheat-death-activated' && e.actorId === s.id(s.voron))
        ).toBe(true);
        expect(s.convertedBeforeSave).toBeGreaterThan(0);
        expect(s.convertedAtSave).toBe(0);
    });

    it('control: without Cheat Death the same DoTs kill him and nothing wipes them', () => {
        const s = setup(false);
        expect(destroyed(s.events, s.id(s.voron))).toBe(true);
        expect(s.convertedAtSave).toBeUndefined();
    });
});

describe.each(PLACEMENTS)('Heliodor cuts debuffs next to Voron on the %s side', (placement) => {
    /** One Curator-style area hit strikes Voron and Heliodor; Voron converts his share into a DoT
     *  and Heliodor's passive then cuts every ally's debuffs by 1 turn. A 5-turn DoT applied to
     *  Voron before the fight is the instrument: it shows the cut reached him. */
    const setup = (withHeliodor: boolean) => {
        const voron: BoardUnit = {
            id: 'voron',
            kit: {
                slots: [
                    { slot: 'active', abilities: [] },
                    ...realKit('Voron').slots.filter((s) => s.slot === 'passive'),
                ],
            },
            position: 'M4',
            speed: 1,
            hp: 1e9,
        };
        const heliodor: BoardUnit = {
            id: 'heliodor',
            kit: withHeliodor
                ? {
                      slots: [
                          { slot: 'active', abilities: [] },
                          ...realKit('Heliodor').slots.filter((s) => s.slot === 'passive'),
                      ],
                  }
                : NO_KIT,
            position: 'M3',
            speed: 2,
            hp: 1e9,
        };
        const hitter: BoardUnit = {
            id: 'hitter',
            kit: hitKit(100),
            position: 'M4',
            speed: 100,
            attack: 3000,
            pattern: parsePattern('Pattern-All'),
            target: parseTarget('all'),
        };
        const voronId = placement === 'player' ? FOCUS_ID : voron.id;
        let convertedAtHit: number | undefined;
        const r = run(
            placement,
            voron,
            [heliodor],
            [hitter],
            1,
            (e, actors) => {
                if (e.type !== 'attacked' || convertedAtHit !== undefined) return;
                const v = actors.get(voronId);
                const converted = v?.genericDoTEntries.find((d) => d.convertedFromHit);
                if (converted) convertedAtHit = converted.remainingRounds;
            },
            (actors) => {
                actors.get(voronId)!.genericDoTEntries.push({
                    stacks: 1,
                    tier: 0,
                    remainingRounds: 5,
                    sourceId: 'seeded',
                    perTickAmount: 1,
                });
            }
        );
        const v = r.actors.get(voronId)!;
        const applied = v.genericDoTEntries.find((d) => d.sourceId === 'seeded');
        const converted = v.genericDoTEntries.find((d) => d.convertedFromHit);
        return { applied, converted, convertedAtHit };
    };

    it('the cut shortens the applied DoT but not the converted one', () => {
        const cut = setup(true);
        const uncut = setup(false);
        expect(cut.convertedAtHit).toBe(3);
        expect(uncut.applied!.remainingRounds - cut.applied!.remainingRounds).toBe(1);
        expect(cut.converted).toBeDefined();
        expect(cut.converted!.remainingRounds).toBe(uncut.converted!.remainingRounds);
    });
});
