/**
 * viralGearSet.integration.test.ts
 *
 * End-to-end integration tests for the VIRAL gear set (4-piece): every DoT the wearer applies from
 * its ACTIVE or CHARGED skill lasts +1 turn. Passive-skill DoTs, gear-set and implant DoTs, and
 * Bombs keep their written duration.
 *
 * The ships are built with real VIRAL gear pieces (`setBonus:'VIRAL'`) and routed through
 * `buildShipAbilitiesWithEquipment`, which merges GEAR_SET_ABILITIES.VIRAL into the passive slot;
 * the engine collects it into the per-owner DoT extension map. Every with-vs-without comparison
 * builds the SAME scenario twice, differing only by the equipped VIRAL pieces.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { Ship, AffinityName } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import type { Position } from '../../../types/encounters';
import type { Ability } from '../../../types/abilities';
import { extendsDotFrom } from '../dotDurationExtension';
import { calculateTotalStats } from '../../ship/statsCalculator';

function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    };
}

const SLOTS = ['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'] as const;
function viralPieces(count = 4, prefix = 'VIRAL'): GearPiece[] {
    return Array.from({ length: count }, (_, i) =>
        makePiece({ id: `${prefix}-${i}`, slot: SLOTS[i], setBonus: 'VIRAL' })
    );
}

function getGearPieceFor(pieces: GearPiece[]): (id: string) => GearPiece | undefined {
    const map: Record<string, GearPiece> = {};
    for (const p of pieces) map[p.id] = p;
    return (id) => map[id];
}

interface SkillTexts {
    activeText: string;
    chargedText: string;
    chargeCount: number;
    passiveText?: string;
}

function makeShip(id: string, affinity: AffinityName, pieces: GearPiece[], opts: SkillTexts): Ship {
    const equipment: Record<string, string> = {};
    for (const p of pieces) equipment[p.slot] = p.id;
    return {
        id,
        name: id,
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEBUFFER',
        baseStats: {} as Ship['baseStats'],
        equipment,
        implants: {},
        refits: [],
        affinity,
        activeSkillText: opts.activeText,
        chargeSkillText: opts.chargedText,
        chargeSkillCharge: opts.chargeCount,
        ...(opts.passiveText ? { firstPassiveSkillText: opts.passiveText } : {}),
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    } as Partial<Ship> as Ship;
}

function registrySkills(pieces: GearPiece[], opts: SkillTexts) {
    return buildShipAbilitiesWithEquipment(
        makeShip('attacker', 'thermal', pieces, opts),
        getGearPieceFor(pieces)
    );
}

const PLAIN_HIT = 'This Unit deals <unit-damage>100% damage</unit-damage>.';
const CORROSION_2T =
    'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns.';
const BOMB_2T =
    'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Bomb III</unit-skill> for 2 turns.';

const DPS_BASE = {
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    hacking: 100_000,
    enemySecurity: 0,
    enemyDefense: 0,
    enemyHp: 1_000_000_000_000,
    rounds: 6,
    selfBuffs: [],
    enemyDebuffs: [],
};

type DpsResult = ReturnType<typeof simulateDPS>;
const round = (res: DpsResult, n: number) => res.rounds.find((x) => x.round === n)!;
/** The highest `ticksRemaining` among the enemy's standing DoTs of `type` at the end of round n. */
const maxTicks = (res: DpsResult, n: number, type: string): number =>
    Math.max(
        0,
        ...round(res, n)
            .activeDoTStates.filter((d) => d.type === type)
            .map((d) => d.ticksRemaining)
    );
/** The last round in which the enemy still carries a DoT of `type`. */
const lastRoundWith = (res: DpsResult, type: string): number =>
    Math.max(
        0,
        ...res.rounds
            .filter((r) => r.activeDoTStates.some((d) => d.type === type))
            .map((r) => r.round)
    );

describe('VIRAL gear set — registry shape', () => {
    it('a 4-VIRAL ship carries a passive dot-duration-extension marker; 3 pieces carry none', () => {
        const opts = { activeText: PLAIN_HIT, chargedText: PLAIN_HIT, chargeCount: 2 };
        const markerOf = (pieces: GearPiece[]) =>
            registrySkills(pieces, opts)
                .slots.find((s) => s.slot === 'passive')
                ?.abilities.find((a) => a.id === 'equip-set-VIRAL');
        expect(markerOf(viralPieces(4))?.config).toEqual({
            type: 'dot-duration-extension',
            turns: 1,
        });
        expect(markerOf(viralPieces(3))).toBeUndefined();
        expect(markerOf([])).toBeUndefined();
    });
});

describe('VIRAL gear set — hacking bonus', () => {
    it('adds 25 flat hacking with 4 pieces and nothing with 3', () => {
        const hackingWith = (pieces: GearPiece[]) => {
            const equipment: Record<string, string> = {};
            for (const p of pieces) equipment[p.slot] = p.id;
            const baseStats = { hp: 1000, attack: 100, defence: 100, hacking: 100, security: 0 };
            return calculateTotalStats(
                baseStats as Ship['baseStats'],
                equipment,
                getGearPieceFor(pieces),
                [],
                {},
                undefined
            ).final.hacking;
        };
        expect(hackingWith(viralPieces(4))).toBe(125);
        expect(hackingWith(viralPieces(3))).toBe(100);
    });
});

describe('VIRAL gear set — cast-path DoTs', () => {
    it('an active-skill Corrosion for 2 turns lasts 3 turns', () => {
        // The charged skill never fires, so every cast is the active skill; it re-inflicts every
        // round, so the round-1 entry's remaining duration is the clean read.
        const opts = { activeText: CORROSION_2T, chargedText: PLAIN_HIT, chargeCount: 99 };
        const base = { ...DPS_BASE, chargeCount: 99 };
        const withViral = simulateDPS({ ...base, shipSkills: registrySkills(viralPieces(), opts) });
        const noViral = simulateDPS({ ...base, shipSkills: registrySkills([], opts) });

        expect(round(noViral, 1).dotsLanded).toBe(true);
        expect(round(withViral, 1).dotsLanded).toBe(true);
        expect(round(withViral, 1).appliedDoTs[0].duration).toBe(3);
        expect(round(noViral, 1).appliedDoTs[0].duration).toBe(2);
        expect(maxTicks(withViral, 1, 'corrosion')).toBe(maxTicks(noViral, 1, 'corrosion') + 1);
        // One more entry standing at steady state: each lasts a round longer.
        expect(round(withViral, 4).activeCorrosionStacks).toBeGreaterThan(
            round(noViral, 4).activeCorrosionStacks
        );
    });

    it('a charged-skill Corrosion stays on the enemy one round longer', () => {
        const opts = { activeText: PLAIN_HIT, chargedText: CORROSION_2T, chargeCount: 99 };
        const base = { ...DPS_BASE, chargeCount: 99, startCharged: true };
        const withViral = simulateDPS({ ...base, shipSkills: registrySkills(viralPieces(), opts) });
        const noViral = simulateDPS({ ...base, shipSkills: registrySkills([], opts) });

        expect(lastRoundWith(noViral, 'corrosion')).toBeGreaterThan(0);
        expect(round(withViral, 1).appliedDoTs[0].duration).toBe(3);
        expect(lastRoundWith(withViral, 'corrosion')).toBe(lastRoundWith(noViral, 'corrosion') + 1);
    });

    it('a Bomb keeps its countdown', () => {
        const opts = { activeText: PLAIN_HIT, chargedText: BOMB_2T, chargeCount: 99 };
        const base = { ...DPS_BASE, chargeCount: 99, startCharged: true };
        const withViral = simulateDPS({ ...base, shipSkills: registrySkills(viralPieces(), opts) });
        const noViral = simulateDPS({ ...base, shipSkills: registrySkills([], opts) });

        const detonationRound = (res: DpsResult) =>
            res.rounds.find((r) => r.detonationDamage > 0)?.round;
        expect(detonationRound(noViral)).toBeDefined();
        expect(detonationRound(withViral)).toBe(detonationRound(noViral));
        expect(round(withViral, 1).appliedDoTs[0].duration).toBe(2);
    });

    it('3 VIRAL pieces extend nothing', () => {
        const opts = { activeText: PLAIN_HIT, chargedText: CORROSION_2T, chargeCount: 99 };
        const base = { ...DPS_BASE, chargeCount: 99, startCharged: true };
        const three = simulateDPS({ ...base, shipSkills: registrySkills(viralPieces(3), opts) });
        const none = simulateDPS({ ...base, shipSkills: registrySkills([], opts) });
        expect(lastRoundWith(three, 'corrosion')).toBe(lastRoundWith(none, 'corrosion'));
        expect(round(three, 1).appliedDoTs[0].duration).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Battle simulator: passive DoTs, enemy-side wearer
// ---------------------------------------------------------------------------

const place = (ship: Ship, position: Position): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 100_000,
        security: 0,
        defence: 0,
        hp: 100_000_000,
    },
});

type BattleResult = ReturnType<typeof simulateBattle>;
const carries = (res: BattleResult, n: number, actorId: string, chip: string): boolean =>
    !!res.rounds
        .find((x) => x.round === n)
        ?.ships.find((s) => s.actorId === actorId)
        ?.activeDebuffs.includes(chip);

describe('VIRAL gear set — battle simulator', () => {
    it('an enemy-side wearer extends its charged-skill Corrosion on the player', () => {
        const foeOpts = { activeText: PLAIN_HIT, chargedText: CORROSION_2T, chargeCount: 2 };
        const playerOpts = { activeText: PLAIN_HIT, chargedText: PLAIN_HIT, chargeCount: 99 };
        const run = (pieces: GearPiece[]) =>
            simulateBattle(
                {
                    playerTeam: [place(makeShip('me', 'thermal', [], playerOpts), 'M4')],
                    enemyTeam: [place(makeShip('foe', 'thermal', pieces, foeOpts), 'M4')],
                    rounds: 8,
                },
                getGearPieceFor(pieces)
            );
        const withViral = run(viralPieces());
        const noViral = run([]);

        // The foe's charged skill fires in round 3 (and again in round 6): its Corrosion stands
        // through rounds 3-4, and through round 5 as well with Viral.
        for (const n of [3, 4]) {
            expect(carries(noViral, n, 'attacker', 'Corrosion')).toBe(true);
            expect(carries(withViral, n, 'attacker', 'Corrosion')).toBe(true);
        }
        expect(carries(noViral, 5, 'attacker', 'Corrosion')).toBe(false);
        expect(carries(withViral, 5, 'attacker', 'Corrosion')).toBe(true);
    });

    it('a passive-skill Corrosion keeps its duration', () => {
        // "When directly damaged" passive (Warden's text): the wearer's Corrosion comes from its
        // passive, so Viral leaves it alone. The foe hits once (charged, round 3) and then idles.
        const wearerOpts = {
            activeText: PLAIN_HIT,
            chargedText: PLAIN_HIT,
            chargeCount: 99,
            passiveText:
                'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns to the enemy.',
        };
        const foeOpts = {
            activeText: 'This Unit grants <unit-skill>Attack Up I</unit-skill> for 1 turn.',
            chargedText: PLAIN_HIT,
            chargeCount: 2,
        };
        const run = (pieces: GearPiece[]) =>
            simulateBattle(
                {
                    playerTeam: [place(makeShip('me', 'thermal', pieces, wearerOpts), 'M4')],
                    enemyTeam: [place(makeShip('foe', 'thermal', [], foeOpts), 'M4')],
                    rounds: 8,
                },
                getGearPieceFor(pieces)
            );
        const withViral = run(viralPieces());
        const noViral = run([]);

        const foeId = noViral.rounds[0].ships.find((s) => s.actorId !== 'attacker')!.actorId;
        const window = (res: BattleResult) =>
            res.rounds.map((r) => carries(res, r.round, foeId, 'Corrosion'));
        expect(window(noViral).some(Boolean)).toBe(true);
        expect(window(withViral)).toEqual(window(noViral));
    });
});

describe('VIRAL gear set — which reactive DoTs count as the skill', () => {
    const dot = (over: Partial<Ability>): Ability => ({
        id: 'x',
        type: 'dot',
        target: 'enemy',
        trigger: 'on-deal-damage',
        conditions: [],
        config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 2 },
        ...over,
    });

    it('a triggered clause of the active or charged skill is extended', () => {
        expect(extendsDotFrom('active', dot({}))).toBe(true);
        expect(extendsDotFrom('charged', dot({}))).toBe(true);
    });

    it('a passive-skill, gear-set or implant DoT is not', () => {
        expect(extendsDotFrom('passive', dot({}))).toBe(false);
        expect(extendsDotFrom('passive', dot({ source: 'equipment' }))).toBe(false);
        expect(extendsDotFrom('active', dot({ source: 'equipment' }))).toBe(false);
    });
});
