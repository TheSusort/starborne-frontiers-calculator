import { buildShipAbilities } from '../../buildShipAbilities';
import type { Ship } from '../../../../types/ship';
import type { Ability } from '../../../../types/abilities';
import { abilitySignature, canonicalAbilities } from '../../../../../scripts/lib/skillParseDiff';

export type SlotName = 'active' | 'charged' | 'passive';

/** Parses ONE skill text in its real slot on an otherwise empty ship (unrefit, so the passive
 *  text is the R0 passive). `ship` supplies role/faction when a rule reads them. */
export const parseSlot = (slot: SlotName, text: string, ship: Partial<Ship> = {}): Ability[] => {
    const s = {
        refits: [],
        chargeSkillCharge: 4,
        ...ship,
        ...(slot === 'active' ? { activeSkillText: text } : {}),
        ...(slot === 'charged' ? { chargeSkillText: text } : {}),
        ...(slot === 'passive' ? { firstPassiveSkillText: text } : {}),
    } as unknown as Ship;
    return buildShipAbilities(s).slots.find((x) => x.slot === slot)?.abilities ?? [];
};

export const sigs = (abilities: Ability[]): string[] => abilities.map(abilitySignature).sort();
export const canonical = canonicalAbilities;

/** One rewording: the OLD text is the reference parse (already pinned by existing tests); the
 *  NEW text is the catalogue's. When the catalogue also changed a number, `old` carries the NEW
 *  numbers hand-substituted into the OLD wording, so the pair still tests wording only. */
export interface RewordPair {
    ship: string;
    slot: SlotName;
    old: string;
    new: string;
    /** A signature the parse MUST contain — guards against both texts parsing to nothing. */
    expects: string;
    /** When set, the OLD parse MUST carry exactly one scaled damage ability with this `perUnit`
     *  (the per-buff / per-debuff add-on the pair exists to prove survives the rewording). */
    scalingPerUnit?: number;
}
