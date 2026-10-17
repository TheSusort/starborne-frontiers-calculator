/**
 * Amartya's damage is single-target (Pattern-Base) but her debuffs and purge reach the whole
 * enemy board (owner ruling R207): "deals 150% damage, then inflicts Defense Down II and Inc.
 * Repair Down II on all enemies for 2 turns" and "deals 210% damage and purges 1 buff from all
 * enemies for every 50% crit power".
 *
 * In-fight: three enemies at T1, M2 and B2. Amartya's active hits M2 alone, and all three take
 * Defense Down II and Inc. Repair Down II. Her charged hits M2 alone and strips a buff from each of
 * the three. Both sides, real parsed kit. The flag is `Ability.boardWide`; the corpus tripwire at
 * the bottom keeps it on the clause types the engine reads it for.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

const ENEMY_IDS = ['t1', 'm2', 'b2'];

const selfBuff = (): Ability => ({
    id: 'enemy-self-buff',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Attack Up II',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 2,
    },
});

/** The three enemies: no damage, and (for the purge case) each casts a self-buff before Amartya
 *  acts, so every one of them holds something to purge. */
const enemies = (withBuff: boolean): ShipSpec[] =>
    (['T1', 'M2', 'B2'] as const).map((position, i) => ({
        id: ENEMY_IDS[i],
        position,
        speed: 50,
        hp: 1e9,
        ...(withBuff
            ? { skills: { slots: [{ slot: 'active' as const, abilities: [selfBuff()] }] } }
            : {}),
    }));

/** Hacking 1000 vs security 0: every debuff lands, so the recipient set is the whole answer. */
const amartyaActive = (): ShipSpec => ({
    id: 'amartya',
    position: 'M4',
    speed: 10,
    hacking: 1000,
    hp: 1e9,
    skills: { slots: realSlots('Amartya', ['active']) },
});

/** Charged once in round 1, acting after the enemies' self-buffs. Crit power 100 → "1 buff for
 *  every 50% crit power" purges 2 per enemy (her base 30 would floor it to 0). */
const amartyaCharged = (): ShipSpec => ({
    id: 'amartya',
    position: 'M4',
    speed: 10,
    hacking: 1000,
    critDamage: 100,
    hp: 1e9,
    startCharged: true,
    chargeCount: 99,
    hasChargedSkill: true,
    skills: {
        slots: [{ slot: 'active', abilities: [] }, ...realSlots('Amartya', ['charged'])],
    },
});

describe.each(['player', 'enemy'] as const)('Amartya on the %s side', (side) => {
    it('her active debuffs land on every enemy, not only the one she hits', () => {
        const teams: MirrorTeams = {
            caster: [amartyaActive()],
            other: enemies(false),
            numRounds: 1,
        };
        const { input, idOf } = mirrorBoard(teams, side);
        const caster = idOf('amartya');
        const landed = new Map<string, Set<string>>();
        const bus = createEventBus();
        bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
            if (e.sourceId !== caster) return;
            const set = landed.get(e.buffName) ?? new Set<string>();
            set.add(e.targetId);
            landed.set(e.buffName, set);
        });
        runCombat({ ...input, bus });
        const expected = ENEMY_IDS.map(idOf).sort();
        expect([...(landed.get('Defense Down II') ?? [])].sort()).toEqual(expected);
        expect([...(landed.get('Inc. Repair Down II') ?? [])].sort()).toEqual(expected);
    });

    it('her charged purge strips buffs from every enemy, not only the one she hits', () => {
        const teams: MirrorTeams = {
            caster: [amartyaCharged()],
            other: enemies(true),
            numRounds: 1,
        };
        const { input, idOf } = mirrorBoard(teams, side);
        const caster = idOf('amartya');
        const purged = new Set<string>();
        const bus = createEventBus();
        bus.on('purge-performed', (e: Extract<CombatEvent, { type: 'purge-performed' }>) => {
            if (e.casterId === caster && e.count > 0) purged.add(e.targetId);
        });
        runCombat({ ...input, bus });
        expect([...purged].sort()).toEqual(ENEMY_IDS.map(idOf).sort());
    });
});

describe('the parser flags a clause by ITS OWN recipient', () => {
    const debuffsFor = (text: string) =>
        (
            buildShipAbilities({ refits: [], activeSkillText: text } as unknown as Ship).slots.find(
                (s) => s.slot === 'active'
            )?.abilities ?? []
        ).filter((a) => a.config.type === 'debuff');

    it('flags only the clause aimed at all enemies when the sentence names two recipients', () => {
        const flags = debuffsFor(
            'This Unit deals <unit-damage>100% damage</unit-damage>, inflicts <unit-skill>Speed Down II</unit-skill> on the target for 2 turns and <unit-skill>Defense Down II</unit-skill> on all enemies for 2 turns.'
        ).map((a) => [a.config.type === 'debuff' && a.config.buffName, a.boardWide === true]);
        expect(flags).toEqual([
            ['Speed Down II', false],
            ['Defense Down II', true],
        ]);
    });
});

describe('corpus tripwire: board-wide clauses are a type the engine reads the flag for', () => {
    it('flags only debuffs and purges, and meets Amartya', () => {
        const carriers: string[] = [];
        for (const rec of loadShipSkillRecords()) {
            const ship = buildTraceShip(rec.name);
            if (!ship) continue;
            for (const slot of buildShipAbilities(ship).slots) {
                for (const ab of slot.abilities) {
                    if (!ab.boardWide) continue;
                    carriers.push(`${rec.name}:${slot.slot}:${ab.type}`);
                    expect(['debuff', 'purge'], `${rec.name} ${slot.slot}`).toContain(ab.type);
                    expect(['active', 'charged'], `${rec.name} ${ab.type}`).toContain(slot.slot);
                }
            }
        }
        expect(carriers).toContain('Amartya:active:debuff');
        expect(carriers).toContain('Amartya:charged:purge');
    });
});
