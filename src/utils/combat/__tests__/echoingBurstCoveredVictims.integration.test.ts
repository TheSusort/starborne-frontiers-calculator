/**
 * Owner ruling (the AoE-pattern rule): an AoE-pattern skill's every effect reaches every enemy in
 * the pattern unless its text narrows it. Echoing Burst is one of those effects, so a cast on
 * Pattern-Cone-Range-1 inflicts it on each covered enemy as well as on the aimed one — each with
 * its own landing roll against its own security (R112: it is a debuff), its own Block Debuff /
 * Firewall check (R149), and its own `debuff-applied`, so infliction reactions fire per enemy.
 *
 * Each covered Echoing Burst gathers only the direct hits ITS holder takes after it landed — the
 * applying cast's own hit is written before the Echoing Burst clause, so it is not gathered.
 *
 * Synthetic skills on the two-sided board, both placements. Board: the cone anchored on o_M4
 * covers o_M4, o_T3, o_M3 and o_B3; o_T4 is adjacent to the anchor but outside the cone.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { boardInput, NO_KIT, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(112));

const hit: Ability = {
    id: 'eb-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
};
const corrosion: Ability = {
    id: 'eb-corrosion',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 2 },
};
const echoingBurst: Ability = {
    id: 'eb-burst',
    type: 'accumulate-detonate',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'accumulate-detonate', turns: 2, pct: 100 },
};

/** The real legendary Firewall implant's reactive grant, its proc chance pinned. */
const firewall = (procChance: number): Ability => {
    const ship = {
        id: 'wearer',
        name: 'Wearer',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {},
        equipment: {},
        implants: { implant_major: 'fw' },
        refits: [],
    } as unknown as Ship;
    const piece = {
        id: 'fw',
        slot: 'implant_major',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: 'FIREWALL',
    } as unknown as GearPiece;
    const passive = buildShipAbilitiesWithEquipment(ship, (id) =>
        id === 'fw' ? piece : undefined
    ).slots.find((s) => s.slot === 'passive');
    const fw = passive?.abilities.find((a) => a.id.startsWith('equip-implant-FIREWALL'));
    if (!fw) throw new Error('the Firewall implant built no reactive grant');
    return { ...fw, procChance };
};

const COVERED = ['o_T3', 'o_M3', 'o_B3'] as const;

const opp = (
    id: string,
    position: BoardUnit['position'],
    extra: Partial<BoardUnit> = {}
): BoardUnit => ({ id, kit: NO_KIT, position, speed: 1, hp: 1e9, ...extra });

const run = (
    placement: Placement,
    abilities: Ability[],
    patternName: string,
    opts: { hacking?: number; rounds?: number; overrides?: Record<string, Partial<BoardUnit>> } = {}
) => {
    const caster: BoardUnit = {
        id: 'caster',
        kit: { slots: [{ slot: 'active', abilities }] },
        position: 'M4',
        speed: 100,
        attack: 1000,
        hacking: opts.hacking ?? 1e6,
        pattern: parsePattern(patternName),
        target: parseTarget('front'),
    };
    const o = opts.overrides ?? {};
    const opps = [
        opp('o_M4', 'M4', o.o_M4),
        opp('o_T3', 'T3', o.o_T3),
        opp('o_M3', 'M3', o.o_M3),
        opp('o_B3', 'B3', o.o_B3),
        opp('o_T4', 'T4', o.o_T4),
    ];
    const { input, id } = boardInput(placement, caster, [], opps, opts.rounds ?? 1);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    runCombat({ ...input, bus });
    const vid = (name: string) => id(opps.find((u) => u.id === name)!);
    const on = (name: string, round = 1) => {
        const v = vid(name);
        return {
            hits: events.filter(
                (e) => e.type === 'attacked' && e.round === round && e.targetId === v
            ).length,
            taken: events
                .filter((e) => e.type === 'attacked' && e.round === round && e.targetId === v)
                .reduce((s, e) => s + (e.type === 'attacked' ? (e.takenDamage ?? 0) : 0), 0),
            corrosion: events.filter(
                (e) => e.type === 'dot-applied' && e.round === round && e.targetId === v
            ).length,
            burstApplied: events.filter(
                (e) =>
                    e.type === 'debuff-applied' &&
                    e.round === round &&
                    e.targetId === v &&
                    e.buffName === 'Echoing Burst'
            ),
            burstResisted: events.filter(
                (e) =>
                    e.type === 'debuff-resisted' &&
                    e.round === round &&
                    e.targetId === v &&
                    e.buffName === 'Echoing Burst'
            ),
            blockDebuffGrants: events.filter(
                (e) =>
                    e.type === 'buff-applied' &&
                    e.round === round &&
                    e.actorId === v &&
                    e.buffName === 'Block Debuff'
            ).length,
        };
    };
    const detonations = (name: string) =>
        events
            .filter((e) => e.type === 'accumulator-detonated' && e.victimId === vid(name))
            .map((e) =>
                e.type === 'accumulator-detonated' ? { round: e.round, damage: e.damage } : null
            );
    return { on, detonations, events };
};

describe.each<Placement>(['player', 'enemy'])('caster on the %s side', (placement) => {
    it('a cone cast inflicts Echoing Burst on every covered enemy, not only the aimed one', () => {
        const { on } = run(placement, [hit, corrosion, echoingBurst], 'Pattern-Cone-Range-1');
        // Instrument: the aimed enemy has always received it.
        expect(on('o_M4').burstApplied).toHaveLength(1);
        for (const name of COVERED) {
            // Each covered enemy is struck and takes the cast's Corrosion …
            expect(on(name).hits, name).toBe(1);
            expect(on(name).corrosion, name).toBe(1);
            // … and its Echoing Burst, as an inflicted debuff from the caster.
            expect(on(name).burstApplied, name).toHaveLength(1);
            expect(on(name).burstApplied[0]).toMatchObject({ application: 'inflict' });
        }
        // Outside the pattern: nothing.
        expect(on('o_T4').hits).toBe(0);
        expect(on('o_T4').burstApplied).toHaveLength(0);
    });

    it('a cone skill with Echoing Burst and no DoT (Valkyrie’s shape) still reaches the covered enemies', () => {
        const { on } = run(placement, [hit, echoingBurst], 'Pattern-Cone-Range-1');
        expect(on('o_M4').burstApplied).toHaveLength(1);
        for (const name of COVERED) expect(on(name).burstApplied, name).toHaveLength(1);
        expect(on('o_T4').burstApplied).toHaveLength(0);
    });

    it('each covered Echoing Burst bursts what its own holder took after it landed', () => {
        const { on, detonations } = run(placement, [hit, echoingBurst], 'Pattern-Cone-Range-1', {
            rounds: 2,
        });
        for (const name of ['o_M4', ...COVERED]) {
            // Round 1's Echoing Burst (2 turns) bursts at the end of round 2 with round 2's hit —
            // the round-1 hit that applied it is not gathered.
            const r2 = detonations(name).filter((d) => d!.round === 2);
            expect(r2, name).toHaveLength(1);
            expect(on(name, 2).taken, name).toBeGreaterThan(0);
            expect(r2[0]!.damage, name).toBeCloseTo(on(name, 2).taken, 6);
        }
        // A covered enemy takes the cone's reduced hit, so its burst differs from the anchor's —
        // each burst is its own holder's intake.
        expect(detonations('o_M3')[0]!.damage).toBeLessThan(detonations('o_M4')[0]!.damage);
    });

    it('a covered enemy rolls its own landing: high security resists, the others still take it', () => {
        const { on } = run(placement, [hit, echoingBurst], 'Pattern-Cone-Range-1', {
            hacking: 100,
            overrides: { o_M3: { security: 1e6 } },
        });
        expect(on('o_M3').burstApplied).toHaveLength(0);
        expect(on('o_M3').burstResisted).toHaveLength(1);
        expect(on('o_M3').burstResisted[0]).toMatchObject({ viaLandingRoll: true });
        // Control on the same board: a covered enemy with no security is inflicted.
        expect(on('o_T3').burstApplied).toHaveLength(1);
        expect(on('o_T3').burstResisted).toHaveLength(0);
    });

    it("a covered enemy's Firewall proc on the cast's Corrosion blocks its Echoing Burst (R149)", () => {
        const wearer = (procChance: number): Partial<BoardUnit> => ({
            kit: {
                slots: [
                    { slot: 'active', abilities: [] },
                    { slot: 'passive', abilities: [firewall(procChance)] },
                ],
            } satisfies ShipSkills,
        });
        const procs = run(placement, [hit, corrosion, echoingBurst], 'Pattern-Cone-Range-1', {
            overrides: { o_M3: wearer(1) },
        });
        expect(procs.on('o_M3').corrosion).toBe(1);
        expect(procs.on('o_M3').burstApplied).toHaveLength(0);
        expect(procs.on('o_M3').burstResisted).toHaveLength(1);
        // Blocked, not rolled: the event carries no `viaLandingRoll`.
        expect(procs.on('o_M3').burstResisted[0]).not.toHaveProperty('viaLandingRoll');
        expect(procs.on('o_M3').blockDebuffGrants).toBe(1);

        // Control: the same wearer whose Firewall never procs is inflicted.
        const never = run(placement, [hit, corrosion, echoingBurst], 'Pattern-Cone-Range-1', {
            overrides: { o_M3: wearer(1e-9) },
        });
        expect(never.on('o_M3').burstApplied).toHaveLength(1);
        expect(never.on('o_M3').blockDebuffGrants).toBe(0);
    });

    it("a covered enemy's Firewall reacts to the Echoing Burst landing on it", () => {
        const { on } = run(placement, [hit, echoingBurst], 'Pattern-Cone-Range-1', {
            overrides: {
                o_M3: {
                    kit: {
                        slots: [
                            { slot: 'active', abilities: [] },
                            { slot: 'passive', abilities: [firewall(1)] },
                        ],
                    },
                },
            },
        });
        expect(on('o_M3').burstApplied).toHaveLength(1);
        expect(on('o_M3').blockDebuffGrants).toBe(1);
    });

    it('an aimed enemy immune to debuffs resists a DoT skill’s Echoing Burst, uninflicted', () => {
        // The aimed enemy acts first and grants itself Block Debuff, so the cast meets an immune
        // aimed target and every debuff of the skill is blocked.
        const blockDebuff: Ability = {
            id: 'self-block-debuff',
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Block Debuff',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                duration: 2,
            },
        };
        const { on, events } = run(placement, [hit, corrosion, echoingBurst], 'Pattern-Base', {
            overrides: {
                o_M4: {
                    speed: 200,
                    kit: { slots: [{ slot: 'active', abilities: [blockDebuff] }] },
                },
            },
        });
        // Instrument: the Corrosion was blocked (a resist with no landing roll), not inflicted.
        const dotBlocked = events.filter(
            (e) =>
                e.type === 'debuff-resisted' &&
                e.buffName === 'Corrosion I' &&
                !('viaLandingRoll' in e && e.viaLandingRoll)
        );
        expect(dotBlocked).toHaveLength(1);
        expect(on('o_M4').corrosion).toBe(0);
        // The Echoing Burst is not inflicted and is reported as blocked, like the DoT.
        expect(on('o_M4').burstApplied).toHaveLength(0);
        expect(on('o_M4').burstResisted).toHaveLength(1);
        expect(on('o_M4').burstResisted[0]).not.toHaveProperty('viaLandingRoll');
    });

    it('control: a single-target (Pattern-Base) cast reaches the aimed enemy only', () => {
        const { on } = run(placement, [hit, corrosion, echoingBurst], 'Pattern-Base');
        expect(on('o_M4').burstApplied).toHaveLength(1);
        expect(on('o_M4').corrosion).toBe(1);
        for (const name of [...COVERED, 'o_T4']) {
            expect(on(name).hits, name).toBe(0);
            expect(on(name).burstApplied, name).toHaveLength(0);
        }
    });
});
