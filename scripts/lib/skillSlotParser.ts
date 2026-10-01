/**
 * Parses one ship's skill text, at a refit level, into each slot's abilities through the
 * `buildShipAbilities` the engine uses. The shared parser behind `diff-skill-parse` and the
 * catalogue sync's structural gate.
 *
 * The record's text and the refit level always win over the base ship's; the base supplies
 * everything else the parse reads — the role (`type`), which decides some recipients (a bare
 * cleanse-triggered repair goes to the cleansed ally only for a SUPPORTER).
 */
import type { Ability } from '../../src/types/abilities';
import type { Refit, Ship } from '../../src/types/ship';
import { buildShipAbilities } from '../../src/utils/abilities/buildShipAbilities';
import type { ShipSkillRecord } from './shipSkillCsv';
import type { DiffSlot, SlotParser } from './skillParseDiff';

export type RefitLevel = 0 | 2 | 4;
export type BaseShipFor = (name: string, refit: RefitLevel) => Partial<Ship>;

const shipFrom = (rec: ShipSkillRecord, refit: RefitLevel, base: Partial<Ship>): Ship =>
    ({
        id: `parse:${rec.name}`,
        name: rec.name,
        ...base,
        refits: Array.from({ length: refit }, () => ({}) as Refit),
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0] || undefined,
        secondPassiveSkillText: rec.passives[1] || undefined,
        thirdPassiveSkillText: rec.passives[2] || undefined,
    }) as Ship;

export const slotParser =
    (baseFor: BaseShipFor): SlotParser =>
    (rec, refit) => {
        const out: Record<DiffSlot, Ability[]> = { active: [], charged: [], passive: [] };
        for (const s of buildShipAbilities(shipFrom(rec, refit, baseFor(rec.name, refit))).slots) {
            out[s.slot as DiffSlot] = s.abilities;
        }
        return out;
    };
