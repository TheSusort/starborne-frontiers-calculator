/**
 * Zeolite's refit passive "This Unit deals 30% more damage when hitting a defender" applies to its
 * gear and implant damage procs as it does to its casts (owner ruling 2026-11-16): an equipment
 * proc (Insidiousness, "When debuffing an enemy, there is a 21% chance to deal 100% damage.")
 * against a Defender takes exactly 30% more than the same proc against any other role.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { boardInput, NO_KIT, realKit, type BoardUnit } from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

/** The real legendary Insidiousness ability with its chance raised to 1. */
const insidiousness = (): Ability => {
    const pieceId = 'insid-piece';
    const piece = {
        id: pieceId,
        slot: 'implant_major',
        rarity: 'legendary',
        setBonus: 'INSIDIOUSNESS',
        mainStat: null,
        subStats: [],
        level: 0,
        stars: 0,
    } as unknown as GearPiece;
    const ship = { implants: { implant_major: pieceId }, equipment: {} } as unknown as Ship;
    const built = buildEquipmentAbilities(ship, (g) => (g === pieceId ? piece : undefined));
    const a = built.find((x) => x.trigger === 'on-debuff-inflicted');
    if (!a) throw new Error('Insidiousness ability missing');
    return { ...a, procChance: 1 };
};

const zeoliteKit = (): ShipSkills => {
    const kit = realKit('Zeolite');
    return {
        ...kit,
        slots: kit.slots.map((s) =>
            s.slot === 'passive' ? { ...s, abilities: [...s.abilities, insidiousness()] } : s
        ),
    };
};

const procDamageOn = (role: BoardUnit['role']): number => {
    const zeolite: BoardUnit = {
        id: 'zeolite',
        kit: zeoliteKit(),
        position: 'M4',
        speed: 100,
        attack: 10000,
        hacking: 200,
        hp: 1e9,
    };
    const victim: BoardUnit = {
        id: 'victim',
        kit: NO_KIT,
        position: 'M4',
        speed: 1,
        hp: 1e9,
        ...(role ? { role } : {}),
    };
    const anchor: BoardUnit = { id: 'anchor', kit: NO_KIT, position: 'B1', speed: 1, hp: 1e9 };
    const { input, id } = boardInput('player', zeolite, [anchor], [victim], 1);
    const bus = createEventBus();
    const hits: Extract<CombatEvent, { type: 'reactive-damage-performed' }>[] = [];
    bus.on('reactive-damage-performed', (e) => hits.push(e));
    runCombat({ ...input, bus });
    const proc = hits.filter((e) => e.sourceId === id(zeolite) && e.targetId === victim.id);
    expect(proc).toHaveLength(1);
    return proc[0].amount;
};

describe('Zeolite refit passive on an equipment damage proc', () => {
    it('a Defender takes exactly 30% more than a non-Defender control', () => {
        const control = procDamageOn('SUPPORTER');
        const defender = procDamageOn('DEFENDER');
        expect(control).toBeGreaterThan(0);
        expect(defender / control).toBeCloseTo(1.3, 10);
    });
});
