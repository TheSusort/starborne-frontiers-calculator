/**
 * The two defence channels a turn-blocked ship loses, and the assumption that lets them be gated
 * WITHOUT a provenance split.
 *
 * Every other passive-derived channel filters per entry (`livePassiveEntries` keeps the
 * equipment-sourced ones), because gear and implants share the passive slot with ship refits.
 * These two cannot: `defenseSubstitutionCarrierIds` collapses its walk into a Set membership and
 * `conditionalDefenceBonusByActorId` into a single summed number, so neither can say which part of
 * its answer came from an implant. Gating the WHOLE value is correct only while no equipment
 * builder emits the two config types they read — which is what this file pins. The day one does,
 * this fails and the fix is to split the build, not to relax the gate.
 *
 * The behaviour itself (a stasised FrontLine loses its shield-defence bonus; a stasised Meatshield
 * stops substituting its defence for an ally) rides the same `isTurnBlocked` reader the rest of
 * the rule uses — see `turnBlockedPassiveSuppression.integration.test.ts` for the channels that
 * carry their own fixtures.
 */
import { describe, it, expect } from 'vitest';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { GEAR_SETS } from '../../../constants/gearSets';
import { IMPLANTS } from '../../../constants/implants';
import type { GearPiece } from '../../../types/gear';
import type { GearSlotName } from '../../../constants/gearTypes';
import type { Ship } from '../../../types/ship';

/** The config types `substitutedDefenceFor` reads, both gated whole-value on the owner's
 *  turn-block. */
const SHIP_ONLY_CONFIG_TYPES = ['defense-substitution', 'conditional-stat'] as const;

describe('the whole-value defence gates assume no equipment emits their config types', () => {
    it('no gear set or implant produces a defence-substitution or conditional-stat ability', () => {
        const slots: GearSlotName[] = [
            'weapon',
            'hull',
            'generator',
            'sensor',
            'software',
            'thrusters',
        ];
        const offenders: string[] = [];
        let scanned = 0;

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
                    id: 'defence-probe',
                    equipment: Object.fromEntries(slots.map((s, i) => [s, `g${i}`])),
                } as unknown as Ship;

                for (const a of buildEquipmentAbilities(ship, (id) => pieces.get(id))) {
                    scanned++;
                    if ((SHIP_ONLY_CONFIG_TYPES as readonly string[]).includes(a.config.type)) {
                        offenders.push(`${setName}/${implantName}:${a.config.type}`);
                    }
                }
            }
        }

        // NON-VACUITY: a run that built nothing would satisfy the emptiness below for free.
        expect(scanned).toBeGreaterThan(0);
        expect(
            offenders,
            'A gear set or implant now emits one of the config types the two whole-value defence ' +
                'gates read, so a turn-blocked ship would lose an EQUIPMENT effect along with its ' +
                'ship passive. Split those two builds by provenance the way the leech entries are ' +
                'split, rather than relaxing the gate.'
        ).toEqual([]);
    });
});
