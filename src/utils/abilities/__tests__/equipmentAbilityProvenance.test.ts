/**
 * `Ability.source` is the ONLY thing that separates a gear-set bonus or implant effect from a
 * ship's own passive skill.
 *
 * WHY IT MATTERS. `buildShipAbilitiesWithEquipment` appends equipment abilities into the SAME
 * passive slot the ship's refit passives occupy, so `slot.slot === 'passive'` cannot tell them
 * apart. A ship's passive skill is inactive while its owner is stasised or disabled (owner ruling
 * 2026-09-15) and its gear and implants are NOT, so every suppression site in the engine asks
 * `source !== 'equipment'`. If a new equipment builder forgets the stamp, its effect silently
 * switches off whenever its holder is stasised; if a ship ability ever gained the stamp, that
 * passive would stop being suppressed. This file fails in both directions.
 *
 * `source` is OPTIONAL and absent means "ship skill" — the safe default, so the several hundred
 * hand-built ability fixtures across the suite keep reading as ship passives without restating it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildEquipmentAbilities } from '../buildEquipmentAbilities';
import { buildShipAbilities } from '../buildShipAbilities';
import { GEAR_SETS } from '../../../constants/gearSets';
import { IMPLANTS } from '../../../constants/implants';
import type { GearPiece } from '../../../types/gear';
import type { GearSlotName } from '../../../constants/gearTypes';
import type { Ship } from '../../../types/ship';

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data). This tripwire must read real parsed ship kits — a ' +
                'synthetic fallback would make the "no ship ability is stamped" half vacuous.'
        );
    }
}

describe('Ability.source provenance', () => {
    beforeAll(requireReferenceData);

    it('every ability buildEquipmentAbilities returns is stamped equipment', () => {
        // Six pieces of one set is enough to activate any corpus set (2/4/6-piece bonuses), and
        // each piece carries an implant, so both builder families run for every registry entry.
        const built: string[] = [];
        const unstamped: string[] = [];

        const slots: GearSlotName[] = [
            'weapon',
            'hull',
            'generator',
            'sensor',
            'software',
            'thrusters',
        ];
        for (const setName of Object.keys(GEAR_SETS)) {
            for (const implantName of [undefined, ...Object.keys(IMPLANTS)]) {
                const pieces = new Map<string, GearPiece>();
                slots.forEach((slot, i) => {
                    pieces.set(`g${i}`, {
                        id: `g${i}`,
                        slot,
                        level: 16,
                        stars: 6,
                        rarity: 'legendary',
                        mainStat: { name: 'attack', value: 100, type: 'flat' },
                        subStats: [],
                        setBonus: setName,
                        ...(implantName ? { implantName } : {}),
                    } as unknown as GearPiece);
                });
                const ship = {
                    id: 'prov',
                    equipment: Object.fromEntries(slots.map((s, i) => [s, `g${i}`])),
                } as unknown as Ship;

                for (const a of buildEquipmentAbilities(ship, (id) => pieces.get(id))) {
                    built.push(a.id);
                    if (a.source !== 'equipment')
                        unstamped.push(`${setName}/${implantName}:${a.id}`);
                }
            }
        }

        // NON-VACUITY: if no builder produced anything the "none unstamped" assertion below would
        // pass over an empty list.
        expect(built.length).toBeGreaterThan(0);
        expect(
            unstamped,
            'An equipment ability reached the engine without `source: "equipment"`. It will be ' +
                'treated as a ship passive and silently switch off whenever its holder is ' +
                "stasised or disabled. Stamp it at buildEquipmentAbilities' single exit."
        ).toEqual([]);
    });

    it('no ability a real ship kit parses to is stamped equipment', () => {
        const stamped: string[] = [];
        let scanned = 0;
        for (const record of loadShipSkillRecords()) {
            const ship = buildTraceShip(record.name);
            if (!ship) continue;
            for (const slot of buildShipAbilities(ship).slots ?? []) {
                for (const a of slot.abilities ?? []) {
                    scanned++;
                    if (a.source === 'equipment') stamped.push(`${ship.name}:${a.id}`);
                }
            }
        }

        expect(scanned).toBeGreaterThan(0);
        expect(
            stamped,
            'A ship-kit ability carries `source: "equipment"`, so it would keep firing while its ' +
                'owner is stasised — the opposite of the ruling.'
        ).toEqual([]);
    });
});
