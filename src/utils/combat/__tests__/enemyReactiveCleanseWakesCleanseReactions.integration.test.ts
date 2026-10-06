/**
 * "When an enemy cleanses a debuff" (Pestilence, Larkspur, Grif, Arum, Yarrow) hears a cleanse
 * the enemy performs off its passive too: Nuqtu's "Every turn this Unit cleanses 1 debuff",
 * Purifier's "When directly damaged this Unit cleanses 2 debuffs" (and AEGIS, Hermes, Howler)
 * are cleanses like any cast one. A duration cut (Heliodor's "reduces the duration of all active
 * Debuffs") removes nothing and is not a cleanse.
 *
 * Chained cleanses trigger too (owner ruling 66): a cleanse that a cleanse reaction provoked wakes
 * the reactions again — but a passive never fires on an event its own earlier firing caused (the
 * lineage rule, owner ruling 2026-10-06; `reactionKey` in triggers.ts). So the cleanser's passive
 * cleanses once per chain: the reactions it wakes cannot wake it again. The loop board pairs
 * Pestilence (re-inflicts Corrosion on the cleanser) with an enemy that cleanses itself whenever it
 * is debuffed: a cast debuff → cleanse → Larkspur and Pestilence answer → Pestilence's Corrosion
 * lands, and the cleanser's passive, already in that chain, stays silent.
 *
 * Real parsed passives (buildTraceShip, refit 4) except the loop board's self-cleanser and the
 * hand-built applier/hitter. Mounted on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { reactionChainProbe } from '../triggers';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(7));

const passiveOnly = (ship: string): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [] }, ...realSlots(ship, ['passive'])],
});
const active = (ability: Omit<Ability, 'id'>): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [{ id: 'hand-built', ...ability }] }],
});
const HIT = active({
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});
const ATTACK_DOWN = active({
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Attack Down II',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        duration: 2,
    },
});

/** The reacting team: Larkspur, Pestilence and Grif (real passives), plus `extra` (a hitter). */
const reactors = (extra?: ShipSpec): ShipSpec[] => [
    { id: 'larkspur', position: 'T3', speed: 1, skills: passiveOnly('Larkspur') },
    { id: 'pestilence', position: 'M3', speed: 1, hacking: 1e6, skills: passiveOnly('Pestilence') },
    { id: 'grif', position: 'B3', speed: 1, attack: 1000, skills: passiveOnly('Grif') },
    ...(extra ? [extra] : []),
];

interface Measured {
    /** Remove-mode reactive cleanses the cleanser performed. */
    cleanses: number;
    larkspurBuffs: number;
    pestilenceCorrosions: number;
    grifHits: number;
}

const run = (teams: MirrorTeams, side: 'player' | 'enemy', seedCorrosionOn?: string): Measured => {
    const { input, idOf } = mirrorBoard(teams, side);
    const cleanser = idOf('cleanser');
    const bus = createEventBus();
    const m: Measured = { cleanses: 0, larkspurBuffs: 0, pestilenceCorrosions: 0, grifHits: 0 };
    bus.on('reactive-cleanse-performed', (e) => {
        if (e.casterId === cleanser && e.mode === undefined) m.cleanses++;
    });
    bus.on('buff-applied', (e) => {
        if (e.actorId === idOf('larkspur') && e.buffName === 'Gelecek Contagion II')
            m.larkspurBuffs++;
    });
    bus.on('dot-applied', (e) => {
        if (e.sourceId === idOf('pestilence') && e.targetId === cleanser)
            m.pestilenceCorrosions += e.stacks;
    });
    bus.on('reactive-damage-performed', (e) => {
        if (e.sourceId === idOf('grif') && e.targetId === cleanser) m.grifHits++;
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            if (!seedCorrosionOn) return;
            all.find((a) => a.id === idOf(seedCorrosionOn))!.corrosionEntries.push({
                stacks: 1,
                tier: 3,
                remainingRounds: 5,
                sourceId: idOf('pestilence'),
            });
        },
    });
    return m;
};

describe('Nuqtu’s start-of-turn self-cleanse wakes the enemy cleanse reactions', () => {
    const teams: MirrorTeams = {
        caster: reactors(),
        other: [{ id: 'cleanser', position: 'M4', speed: 150, skills: passiveOnly('Nuqtu') }],
    };
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: Nuqtu cleanses its Corrosion → Larkspur, Pestilence and Grif each react once`, () => {
            expect(run(teams, side, 'cleanser')).toEqual({
                cleanses: 1,
                larkspurBuffs: 1,
                pestilenceCorrosions: 1,
                grifHits: 1,
            });
        });
        it(`${side}-side: nothing to cleanse → no cleanse, no reaction`, () => {
            expect(run(teams, side)).toEqual({
                cleanses: 0,
                larkspurBuffs: 0,
                pestilenceCorrosions: 0,
                grifHits: 0,
            });
        });
    }
});

describe('Purifier’s on-damaged self-cleanse wakes them too; Heliodor’s duration cut does not', () => {
    const hitter: ShipSpec = { id: 'hitter', position: 'M2', speed: 150, attack: 1, skills: HIT };
    const teams = (ship: string): MirrorTeams => ({
        caster: reactors(hitter),
        other: [{ id: 'cleanser', position: 'M4', speed: 1, skills: passiveOnly(ship) }],
    });
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: Purifier is hit while holding Corrosion → one cleanse, each reacts once`, () => {
            // The hit wakes Purifier's on-damaged cleanse (1), which removes the Corrosion and
            // wakes Larkspur, Pestilence and Grif once each (1, 1, 1). Grif's reactive hit is
            // direct damage (ruling 36), but Purifier's passive is already in that chain, so it
            // does not cleanse Pestilence's fresh Corrosion: the chain ends there (Fight 6).
            reactionChainProbe.dropped = 0;
            reactionChainProbe.lineageDropped = 0;
            expect(run(teams('Purifier'), side, 'cleanser')).toEqual({
                cleanses: 1,
                larkspurBuffs: 1,
                pestilenceCorrosions: 1,
                grifHits: 1,
            });
            expect(reactionChainProbe.lineageDropped).toBeGreaterThan(0);
            expect(reactionChainProbe.dropped).toBe(0);
        });
        it(`${side}-side: Heliodor is hit while holding Corrosion → its duration cut wakes nothing`, () => {
            expect(run(teams('Heliodor'), side, 'cleanser')).toEqual({
                cleanses: 0,
                larkspurBuffs: 0,
                pestilenceCorrosions: 0,
                grifHits: 0,
            });
        });
    }
});

describe('a cleanse reaction cannot wake the cleanse that set it off', () => {
    /** Cleanses one debuff from itself every time it is debuffed (a DoT stack included). */
    const selfCleanser: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [] },
            {
                slot: 'passive',
                abilities: [
                    {
                        id: 'cleanser-on-debuffed',
                        type: 'cleanse',
                        target: 'self',
                        trigger: 'on-debuffed',
                        conditions: [],
                        config: { type: 'cleanse', count: 1 },
                    },
                ],
            },
        ],
    };
    const ROUNDS = 3;
    const teams: MirrorTeams = {
        caster: [
            {
                id: 'pestilence',
                position: 'M3',
                speed: 1,
                hacking: 1e6,
                skills: passiveOnly('Pestilence'),
            },
            { id: 'applier', position: 'M2', speed: 150, hacking: 1e6, skills: ATTACK_DOWN },
            { id: 'larkspur', position: 'T3', speed: 1, skills: passiveOnly('Larkspur') },
        ],
        other: [{ id: 'cleanser', position: 'M4', speed: 100, skills: selfCleanser }],
        numRounds: ROUNDS,
    };
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: each round, one cleanse and one answer from each reactor`, () => {
            // Each round: the applier's Attack Down II wakes the cleanser (1 cleanse), which wakes
            // Larkspur and Pestilence once each (1 buff, 1 Corrosion). Pestilence's Corrosion is a
            // debuff on the cleanser, but the cleanser's passive is already in that chain, so it
            // stays. Three rounds, three of each.
            reactionChainProbe.dropped = 0;
            reactionChainProbe.lineageDropped = 0;
            expect(run(teams, side)).toEqual({
                cleanses: ROUNDS,
                larkspurBuffs: ROUNDS,
                pestilenceCorrosions: ROUNDS,
                grifHits: 0,
            });
            expect(reactionChainProbe.lineageDropped).toBeGreaterThan(0);
            expect(reactionChainProbe.dropped).toBe(0);
        });
    }
});
