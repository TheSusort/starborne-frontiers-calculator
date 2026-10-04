/**
 * Amartya's passive names the role twice: "When an enemy DEFENDER is directly repaired, this Unit
 * inflicts 2 stacks of Defense Shred on that defender. When an enemy DEFENDER gains Taunt, this
 * Unit inflicts 2 stacks of Exposed on that defender." Each recipient is judged on its own role: a
 * heal covering a defender and an attacker shreds the defender only, and Orel (a SUPPORTER whose
 * charged skill "gains Taunt") earns no Exposed.
 *
 * Real parsed passive (buildTraceShip, refit 4), mounted on both sides. The Taunt gainers are real
 * kits too: Orel's charged skill and Madax's (DEFENDER) active.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { ShipSkills } from '../../../types/abilities';
import type { ShipTypeName } from '../../../constants/shipTypes';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
beforeEach(() => setupKeyedRng(7));

const amartya = (): ShipSpec => ({
    id: 'amartya',
    position: 'M4',
    speed: 10,
    hacking: 1e6,
    skills: { slots: [{ slot: 'active', abilities: [] }, ...realSlots('Amartya', ['passive'])] },
});

const healAll = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'healer-repair',
                    type: 'heal',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                },
            ],
        },
    ],
});

const debuffsFromAmartya = (teams: MirrorTeams, side: 'player' | 'enemy', name: string) => {
    const { input, idOf } = mirrorBoard(teams, side);
    const label = new Map(teams.other.map((s) => [idOf(s.id), s.id]));
    const caster = idOf('amartya');
    const bus = createEventBus();
    const hits: string[] = [];
    bus.on('debuff-applied', (e) => {
        if (e.sourceId === caster && e.buffName === name)
            hits.push(label.get(e.targetId) ?? e.targetId);
    });
    runCombat({ ...input, bus });
    return [...new Set(hits)].sort();
};

describe("Amartya: 'When an enemy defender is directly repaired' shreds only defenders", () => {
    const teams = (healerRole: ShipTypeName, xRole: ShipTypeName): MirrorTeams => ({
        caster: [amartya()],
        other: [
            { id: 'healer', position: 'M4', speed: 150, role: healerRole, skills: healAll() },
            { id: 'x', position: 'M3', speed: 1, role: xRole },
        ],
    });
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: a supporter heals itself and a defender → the defender alone`, () => {
            expect(
                debuffsFromAmartya(teams('SUPPORTER', 'DEFENDER'), side, 'Defense Shred')
            ).toEqual(['x']);
        });
        it(`${side}-side reverse board: a defender heals itself and an attacker → the healer`, () => {
            expect(
                debuffsFromAmartya(teams('DEFENDER', 'ATTACKER'), side, 'Defense Shred')
            ).toEqual(['healer']);
        });
        it(`${side}-side: no defender repaired → no Defense Shred`, () => {
            expect(
                debuffsFromAmartya(teams('SUPPORTER', 'ATTACKER'), side, 'Defense Shred')
            ).toEqual([]);
        });
        it(`${side}-side: a defender variant (DEFENDER_SECURITY) counts as a defender`, () => {
            expect(
                debuffsFromAmartya(teams('SUPPORTER', 'DEFENDER_SECURITY'), side, 'Defense Shred')
            ).toEqual(['x']);
        });
    }
});

describe("Amartya: 'When an enemy defender gains Taunt' exposes only defenders", () => {
    const orel = (role: ShipTypeName): ShipSpec => ({
        id: 'orel',
        position: 'M4',
        speed: 150,
        role,
        chargeCount: 1,
        startCharged: true,
        hasChargedSkill: true,
        skills: { slots: realSlots('Orel', ['charged']) },
    });
    const madax = (role: ShipTypeName): ShipSpec => ({
        id: 'madax',
        position: 'M4',
        speed: 150,
        role,
        skills: { slots: realSlots('Madax', ['active']) },
    });
    const teams = (gainer: ShipSpec): MirrorTeams => ({
        caster: [amartya()],
        other: [gainer, { id: 'bystander', position: 'M3', speed: 1, role: 'DEFENDER' }],
    });
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: Orel (SUPPORTER) gains Taunt → no Exposed`, () => {
            expect(debuffsFromAmartya(teams(orel('SUPPORTER')), side, 'Exposed')).toEqual([]);
        });
        it(`${side}-side: Madax (DEFENDER) gains Taunt → Exposed on Madax`, () => {
            expect(debuffsFromAmartya(teams(madax('DEFENDER')), side, 'Exposed')).toEqual([
                'madax',
            ]);
        });
        it(`${side}-side reverse roles: Orel's kit on a DEFENDER → Exposed; Madax's on an ATTACKER → none`, () => {
            expect(debuffsFromAmartya(teams(orel('DEFENDER')), side, 'Exposed')).toEqual(['orel']);
            expect(debuffsFromAmartya(teams(madax('ATTACKER')), side, 'Exposed')).toEqual([]);
        });
    }
});

/** An enemy with no ship role (the DPS calculator's synthesized enemy, a manual-stat enemy) reads
 *  the configured Enemy Type instead. */
describe('Amartya: a role-less enemy reads the configured Enemy Type', () => {
    const teams: MirrorTeams = {
        caster: [amartya()],
        other: [
            { id: 'healer', position: 'M4', speed: 150, skills: healAll() },
            { id: 'x', position: 'M3', speed: 1 },
        ],
    };
    const shredded = (enemyType: 'Defender' | 'Attacker' | undefined) => {
        const { input } = mirrorBoard(teams, 'player');
        const bus = createEventBus();
        const hits = new Set<string>();
        bus.on('debuff-applied', (e) => {
            if (e.sourceId === 'attacker' && e.buffName === 'Defense Shred') hits.add(e.targetId);
        });
        runCombat({ ...input, enemyType, bus });
        return [...hits].sort();
    };
    it('Enemy Type Defender → every repaired role-less enemy is shredded', () => {
        expect(shredded('Defender')).toEqual(['healer', 'x']);
    });
    it('Enemy Type Attacker, or none → no Defense Shred', () => {
        expect(shredded('Attacker')).toEqual([]);
        expect(shredded(undefined)).toEqual([]);
    });
});
