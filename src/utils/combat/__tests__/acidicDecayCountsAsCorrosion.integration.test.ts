/**
 * Owner ruling 2026-11-15: "Acidic decay is a corrosion type debuff, so it counts as corrosion in
 * all those situations" — Toxic Overflow, a "has Corrosion" name check, a debuff clause naming
 * Corrosion, and a reaction to inflicting Corrosion. Crocus's Corrosion detonation is pinned in
 * `crocusDetonatesAcidicDecay.integration.test.ts`.
 *
 * Each board produces its Acidic Decay through a real path: Eelun Naphula's own kit inflicts it,
 * or Belladonna (hacking 2000, a certain conversion) converts the Corrosion an ally inflicts. The
 * victim V (M4) is the opponents' front unit; W (M3) is its neighbour. Every control board swaps
 * the Acidic Decay source for a unit that inflicts nothing. Both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent, type CombatEventBus } from '../events';
import type { CombatActor } from '../state';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip } from '../../../constants/bountyBosses';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    FOCUS_ID,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { textKit } from '../__testutils__/textKit';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(1115));

const SIDES: Placement[] = ['player', 'enemy'];
type Source = 'eelun' | 'belladonna' | 'none';
const SOURCES: Exclude<Source, 'none'>[] = ['eelun', 'belladonna'];

const slotsOf = (kit: ShipSkills, slot: 'active' | 'charged' | 'passive') =>
    kit.slots.filter((s) => s.slot === slot);

/** The Acidic Decay source's side (before the actor under test): who acts first, and what it
 *  leaves on V. */
const sourceUnits = (source: Source): BoardUnit[] => {
    if (source === 'eelun')
        return [
            {
                id: 'source',
                kit: buildShipAbilities(bossShip('eelun', 32)!),
                position: 'M4',
                speed: 300,
                hp: 1e9,
                hacking: 1e6,
                chargeCount: 99,
            },
        ];
    if (source === 'belladonna')
        return [
            {
                id: 'source',
                kit: textKit('corroder', {
                    active: 'This Unit inflicts <unit-skill>Corrosion I</unit-skill> for 3 turns.',
                }),
                position: 'M4',
                speed: 300,
                hacking: 1e6,
            },
            {
                id: 'belladonna',
                kit: {
                    slots: [
                        { slot: 'active', abilities: [] },
                        ...slotsOf(realKit('Belladonna'), 'passive'),
                    ],
                },
                position: 'T4',
                speed: 1,
                hacking: 2000,
            },
        ];
    return [{ id: 'source', kit: NO_KIT, position: 'M4', speed: 300 }];
};

const victims = (): BoardUnit[] => [
    { id: 'v', kit: NO_KIT, position: 'M4', speed: 2, hp: 1e9, security: 0 },
    { id: 'w', kit: NO_KIT, position: 'M3', speed: 2, hp: 1e9, security: 0 },
];

/** V's engine id: the focus (`FOCUS_ID`) when the victims are the player side. */
const victimId = (placement: Placement) => (placement === 'enemy' ? FOCUS_ID : 'v');

const run = (
    placement: Placement,
    source: Source,
    actor: BoardUnit,
    tap: (bus: CombatEventBus, actors: () => CombatActor[], id: (u: BoardUnit) => string) => void
) => {
    const [carrier, ...allies] = sourceUnits(source);
    const opp = victims();
    const { input, id } = boardInput(placement, carrier, [...allies, actor], opp, 1);
    const bus = createEventBus();
    let actors: CombatActor[] = [];
    tap(bus, () => actors, id);
    runCombat({
        ...input,
        bus,
        __testTapActors: (a) => {
            actors = a;
        },
    });
    return { vId: id(opp[0]), wId: id(opp[1]) };
};

/** V's Acidic Decay entries when `actor`'s round-1 turn ends. */
const acidicDecayAfterTurn = (placement: Placement, source: Source, actor: BoardUnit) => {
    let seen: { remainingRounds: number }[] = [];
    let plainCorrosion = 0;
    run(placement, source, actor, (bus, actors, id) => {
        bus.on('turn-ended', (e: Extract<CombatEvent, { type: 'turn-ended' }>) => {
            if (e.actorId !== id(actor) || e.round !== 1) return;
            const v = actors().find((a) => a.id === victimId(placement));
            const entries = v?.corrosionEntries ?? [];
            seen = entries
                .filter((x) => x.family === 'Acidic Decay')
                .map((x) => ({ remainingRounds: x.remainingRounds }));
            plainCorrosion = entries.filter((x) => x.family === undefined).length;
        });
    });
    return { seen, plainCorrosion };
};

const namedExtender = (buffName: string): BoardUnit => {
    const abilities: Ability[] = [
        {
            id: 'hit',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 10 },
        },
        {
            id: 'named-extend',
            type: 'extend-status',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'extend-status', statusKind: 'debuff', turns: 1, buffName },
        },
    ];
    return {
        id: 'extender',
        kit: { slots: [{ slot: 'active', abilities }] },
        position: 'B4',
        speed: 100,
        attack: 100,
    };
};

describe.each(SIDES)('Acidic Decay counts as Corrosion, appliers on the %s side', (placement) => {
    describe.each(SOURCES)('Acidic Decay from %s', (source) => {
        it('a debuff extension naming Corrosion grows the Acidic Decay', () => {
            const named = acidicDecayAfterTurn(placement, source, namedExtender('Corrosion'));
            const control = acidicDecayAfterTurn(placement, source, namedExtender('Inferno'));
            // Validity: V holds Acidic Decay and nothing else of the Corrosion container.
            expect(control.seen.length).toBeGreaterThan(0);
            expect(control.plainCorrosion).toBe(0);
            expect(named.seen.map((x) => x.remainingRounds)).toEqual(
                control.seen.map((x) => x.remainingRounds + 1)
            );
        });

        it('Toxic Overflow spreads off a holder whose only Corrosion is Acidic Decay', () => {
            const hemlock: BoardUnit = {
                id: 'hemlock',
                kit: {
                    slots: [
                        { slot: 'active', abilities: [] },
                        ...slotsOf(realKit('Hemlock'), 'charged'),
                    ],
                },
                position: 'B4',
                speed: 100,
                attack: 10,
                hacking: 1e6,
                chargeCount: 6,
                startCharged: true,
            };
            const spreadOf = (src: Source) => {
                const out: { affected: string[]; holderFamilies: (string | undefined)[] }[] = [];
                const ids = run(placement, src, hemlock, (bus, actors) => {
                    bus.on(
                        'corrosion-spread',
                        (e: Extract<CombatEvent, { type: 'corrosion-spread' }>) => {
                            const holder = actors().find((a) => a.id === e.sourceId);
                            out.push({
                                affected: e.affectedIds,
                                holderFamilies: (holder?.corrosionEntries ?? []).map(
                                    (x) => x.family
                                ),
                            });
                        }
                    );
                });
                return { out, ids };
            };
            const withAcid = spreadOf(source);
            expect(withAcid.out).toHaveLength(1);
            expect(withAcid.out[0].affected).toContain(withAcid.ids.wId);
            // Validity: the holder's every Corrosion entry is Acidic Decay.
            expect(withAcid.out[0].holderFamilies.length).toBeGreaterThan(0);
            expect(new Set(withAcid.out[0].holderFamilies)).toEqual(new Set(['Acidic Decay']));
            expect(spreadOf('none').out).toHaveLength(0);
        });

        it('"more damage to enemies afflicted with Corrosion" reads an Acidic Decay holder', () => {
            const gate: BoardUnit = {
                id: 'gate',
                kit: textKit('gate', {
                    active: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
                    passives: [
                        'This Unit deals <unit-damage>50% more direct damage</unit-damage> to enemies afflicted with <unit-skill>Corrosion</unit-skill>.',
                    ],
                }),
                position: 'B4',
                speed: 100,
                attack: 1000,
            };
            const damageOf = (src: Source) => {
                let total = 0;
                run(placement, src, gate, (bus, _actors, id) => {
                    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
                        if (e.attackerId === id(gate) && e.round === 1) total += e.damage ?? 0;
                    });
                });
                return total;
            };
            const control = damageOf('none');
            expect(control).toBeGreaterThan(0);
            expect(damageOf(source) / control).toBeCloseTo(1.5, 6);
        });
    });

    it('inflicting Acidic Decay wakes a "when this Unit inflicts a Corrosion" reaction', () => {
        const inflicter = (dot: string): BoardUnit => ({
            id: 'inflicter',
            kit: textKit('inflicter', {
                active: `This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>${dot}</unit-skill> for 3 turns.`,
                passives: [
                    'When this Unit inflicts a <unit-skill>Corrosion</unit-skill> it gains <unit-skill>Stealth</unit-skill> for 1 turn.',
                ],
            }),
            position: 'B4',
            speed: 100,
            attack: 10,
            hacking: 1e6,
        });
        const stealthed = (dot: string) => {
            const unit = inflicter(dot);
            let landed: (string | undefined)[] = [];
            let gained = false;
            run(placement, 'none', unit, (bus, actors, id) => {
                bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
                    if (e.actorId === id(unit) && e.buffName.startsWith('Stealth')) gained = true;
                });
                bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
                    if (e.sourceId !== id(unit)) return;
                    const v = actors().find((a) => a.id === e.targetId);
                    landed = [...(v?.corrosionEntries ?? [])].map((x) => x.family);
                });
            });
            return { gained, landed };
        };
        const acid = stealthed('Acidic Decay III');
        // Validity: what landed is an Acidic Decay, and an Inferno does not wake the reaction.
        expect(acid.landed).toEqual(['Acidic Decay']);
        expect(acid.gained).toBe(true);
        expect(stealthed('Inferno III').gained).toBe(false);
    });
});
