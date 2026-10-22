/**
 * Text-number tripwire for equipment effects: every number an implant variant's or gear set's
 * game text names — each "N%", each "N turn(s)", each flat amount — appears in the abilities
 * `buildEquipmentAbilities` builds for that exact variant. The registries in
 * `buildEquipmentAbilities.ts` bake their values by hand from the same source data; this is
 * what notices when one drifts from the text (a proc chance, a magnitude, a duration).
 *
 * Fractions in the model (procChance 0.2, blockPct 0.5, perUnit 0.25) are compared ×100, and
 * digits inside string fields (`'target-below-25'`) count, since some thresholds live there. A
 * buff's own `parsedEffects` are skipped: they carry the buff's magnitude, not the text's, and
 * would let an unrelated number satisfy the check.
 *
 * Whether each effect FIRES is `nonKitInputsCensus.integration.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { GEAR_SET_LIST, GEAR_SETS } from '../../../constants/gearSets';
import { IMPLANTS, type ImplantVariant } from '../../../constants/implants';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { Ability } from '../../../types/abilities';

interface ModelNumbers {
    values: number[];
    durations: number[];
}

function collect(node: unknown, key: string, out: ModelNumbers): void {
    if (key === 'parsedEffects') return;
    if (typeof node === 'number') {
        out.values.push(node, node * 100);
        if (/duration|turns/i.test(key)) out.durations.push(node);
        return;
    }
    if (typeof node === 'string') {
        for (const m of node.matchAll(/\d+(?:\.\d+)?/g)) out.values.push(Number(m[0]));
        return;
    }
    if (Array.isArray(node)) {
        node.forEach((n) => collect(n, key, out));
        return;
    }
    if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) collect(v, k, out);
    }
}

function modelNumbers(abilities: Ability[]): ModelNumbers {
    const out: ModelNumbers = { values: [], durations: [] };
    collect(abilities, '', out);
    return out;
}

/** Every number the text names: percentages, flat amounts of 4+ digits, and turn counts. */
function textNumbers(text: string): { values: number[]; durations: number[] } {
    return {
        values: [
            ...[...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1])),
            ...[...text.matchAll(/\b(\d{4,})\b/g)].map((m) => Number(m[1])),
        ],
        durations: [...text.matchAll(/(\d+)\s+turns?\b/g)].map((m) => Number(m[1])),
    };
}

const has = (pool: number[], n: number) => pool.some((p) => Math.abs(p - n) < 1e-6);

function buildFor(setBonus: string, rarity: GearPiece['rarity'], asImplant: boolean, pieces = 2) {
    const lookup: Record<string, GearPiece> = {};
    const equipment: Ship['equipment'] = {};
    const implants: Ship['implants'] = {};
    if (asImplant) {
        lookup.i = { id: 'i', setBonus, rarity } as GearPiece;
        implants.implant_major = 'i';
    } else {
        (['weapon', 'hull', 'generator', 'sensor'] as const).slice(0, pieces).forEach((slot, n) => {
            lookup[`g${n}`] = { id: `g${n}`, setBonus, rarity: 'legendary', slot } as GearPiece;
            equipment[slot] = `g${n}`;
        });
    }
    return buildEquipmentAbilities({ id: 's', equipment, implants } as Ship, (id) => lookup[id]);
}

const IMPLANT_CASES = Object.entries(IMPLANTS).flatMap(([key, data]) =>
    (data.variants as readonly ImplantVariant[])
        .filter((v) => v.description)
        .map((v) => [key, v.rarity, v.description as string] as const)
);

describe('equipment text numbers match the built abilities', () => {
    it.each(IMPLANT_CASES)('implant %s (%s): "%s"', (key, rarity, text) => {
        const abilities = buildFor(key, rarity, true);
        if (abilities.length === 0) {
            // Stat-folding ultimates: checked against the stat sheet by the census.
            expect(['CODE_GUARD', 'CIPHER_LINK']).toContain(key);
            return;
        }
        const model = modelNumbers(abilities);
        const named = textNumbers(text);
        for (const n of named.values) expect(has(model.values, n), `${n} in the model`).toBe(true);
        for (const d of named.durations)
            expect(has(model.durations, d), `${d} turn(s) in the model`).toBe(true);
    });

    const SET_CASES = Object.entries(GEAR_SETS)
        .filter(([, s]) => 'description' in s)
        .map(([key, s]) => [key, (s as { description: string }).description] as const);

    it.each(SET_CASES)('gear set %s: "%s"', (key, text) => {
        const minPieces =
            GEAR_SET_LIST.find((s) => s.name === GEAR_SETS[key as keyof typeof GEAR_SETS].name)
                ?.minPieces ?? 2;
        const abilities = buildFor(key, 'legendary', false, minPieces);
        expect(abilities.length).toBeGreaterThan(0);
        const model = modelNumbers(abilities);
        const named = textNumbers(text);
        for (const n of named.values) expect(has(model.values, n), `${n} in the model`).toBe(true);
        for (const d of named.durations)
            expect(has(model.durations, d), `${d} turn(s) in the model`).toBe(true);
    });

    it('the set texts without a number carry their effect (Boost: one extra turn)', () => {
        const [boost] = buildFor('BOOST', 'legendary', false, 4);
        expect(boost.config).toMatchObject({ type: 'buff-duration-extension', turns: 1 });
    });
});
