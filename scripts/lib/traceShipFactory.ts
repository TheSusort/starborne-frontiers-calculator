import type { Ship, Refit, ShipData } from '../../src/types/ship';
import { SHIPS } from '../../src/constants/ships';
import { loadShipSkillRecords, csvAvailable, ShipSkillRecord } from './shipSkillCsv';

export type RefitLevel = 0 | 2 | 4;
export interface BuildTraceShipOpts {
    refitLevel?: RefitLevel;
}

// Keyed on the UPPERCASED name because the CSV name column is inconsistently cased
// (AEGIS/APEX all-caps vs Akula/Amartya mixed) while ShipData.name is canonical mixed-case.
export const SHIP_DATA_BY_NAME: Map<string, ShipData> = new Map(
    Object.values(SHIPS).map((d) => [d.name.toUpperCase(), d])
);

let recordCache: Map<string, ShipSkillRecord> | null = null;
function recordFor(name: string): ShipSkillRecord | undefined {
    if (!recordCache) {
        // Clean checkout: the CSV is gitignored/absent. Return no record rather than letting
        // readFileSync throw — SHIPS-only lookups (and the neither-source null path) stay safe.
        if (!csvAvailable()) return undefined;
        recordCache = new Map(loadShipSkillRecords().map((r) => [r.name.toUpperCase(), r]));
    }
    return recordCache.get(name.toUpperCase());
}

export function buildTraceShip(name: string, opts: BuildTraceShipOpts = {}): Ship | null {
    const data = SHIP_DATA_BY_NAME.get(name.toUpperCase());
    const rec = recordFor(name);
    // Need at least ONE source. Eight CSV ships (Amartya, Centurion, Enforcer, Graphite, Hemlock,
    // Lingshe, Meatshield, Wildfire) have skill text but NO SHIPS entry — trace them on a default
    // stat baseline (affinity 'antimatter' = always-neutral, so no affinity distortion) so the
    // parser+execution audit still covers all 147. Return null only when NEITHER source exists.
    if (!data && !rec) return null;
    const canonicalName = data?.name ?? rec!.name;
    const refitLevel = opts.refitLevel ?? 4;
    const refits: Refit[] = Array.from({ length: refitLevel }, () => ({}) as Refit);

    return {
        id: `trace:${canonicalName}`,
        name: canonicalName, // canonical SHIPS casing when available, else the CSV name
        rarity: data?.rarity ?? 'legendary',
        faction: data?.faction ?? 'MPL',
        type: data?.role ?? 'ATTACKER',
        affinity: data?.affinity ?? 'antimatter',
        baseStats: {
            hp: data?.hp ?? 200_000,
            attack: data?.attack ?? 2000,
            defence: data?.defense ?? 300,
            hacking: data?.hacking ?? 200,
            security: data?.security ?? 150,
            crit: data?.critRate ?? 50,
            critDamage: data?.critDamage ?? 150,
            speed: data?.speed ?? 100,
        },
        equipment: {},
        implants: {},
        refits,
        // CSV skill text is authoritative; fall back to SHIPS text only if the CSV lacks a record.
        activeSkillText: rec?.active || data?.activeSkillText,
        chargeSkillText: rec?.charge || data?.chargeSkillText,
        chargeSkillCharge: rec?.chargeCharge ?? data?.chargeSkillCharge ?? 0,
        firstPassiveSkillText: rec?.passives[0] || data?.firstPassiveSkillText,
        secondPassiveSkillText: rec?.passives[1] || data?.secondPassiveSkillText,
        thirdPassiveSkillText: rec?.passives[2] || data?.thirdPassiveSkillText,
        activeTarget: data?.activeTarget,
        activePattern: data?.activePattern,
        chargedTarget: data?.chargedTarget,
        chargedPattern: data?.chargedPattern,
    };
}
