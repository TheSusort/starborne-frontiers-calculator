/**
 * Compares how two skill corpora PARSE, slot by slot. The `audit:skills` rules only find coverage
 * gaps; this compares parses and finds every ability lost, gained, retargeted or retriggered between two
 * texts for the same ship — the instrument for any catalogue text change.
 */
import type { Ability } from '../../src/types/abilities';
import type { ShipSkillRecord } from './shipSkillCsv';

export type DiffSlot = 'active' | 'charged' | 'passive';
export type SlotParser = (rec: ShipSkillRecord, refit: 0 | 2 | 4) => Record<DiffSlot, Ability[]>;
export type DiffKind = 'identical' | 'tag' | 'wording' | 'number' | 'missing';

export interface ParseDiffRow {
    name: string;
    refit: 0 | 2 | 4;
    slot: DiffSlot;
    kind: DiffKind;
    /** Abilities differ in signature (type|target|trigger|name), not just config numbers. */
    structural: boolean;
    /** Signatures equal but some config differs. */
    configChanged: boolean;
    lost: string[];
    gained: string[];
    currentText: string;
    candidateText: string;
}

export const plainText = (t: string): string =>
    t.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const numbers = (t: string): string => (plainText(t).match(/\d+(?:\.\d+)?/g) ?? []).join(',');

export const abilitySignature = (a: Ability): string => {
    const config = a.config as { type: string; buffName?: string };
    return `${a.type}|${a.target}|${a.trigger}|${config.buffName ?? config.type}`;
};

/** Abilities without their positional ids, order-independent. */
export const canonicalAbilities = (abilities: Ability[]): string =>
    JSON.stringify(abilities.map(({ id: _id, ...rest }) => rest).map((a) => JSON.stringify(a)).sort());

const passiveText = (r: ShipSkillRecord, refit: 0 | 2 | 4): string =>
    (refit >= 4 && r.passives[2]) || (refit >= 2 && r.passives[1]) || r.passives[0];
const textOf = (r: ShipSkillRecord, slot: DiffSlot, refit: 0 | 2 | 4): string =>
    slot === 'active' ? r.active : slot === 'charged' ? r.charge : passiveText(r, refit);

const multisetMinus = (a: string[], b: string[]): string[] => {
    const left = [...b];
    return a.filter((x) => {
        const i = left.indexOf(x);
        if (i === -1) return true;
        left.splice(i, 1);
        return false;
    });
};

const kindOf = (cur: string, cand: string): DiffKind =>
    cur === cand ? 'identical'
    : plainText(cur) === plainText(cand) ? 'tag'
    : numbers(cur) === numbers(cand) ? 'wording'
    : 'number';

export const diffCorpora = (
    current: ShipSkillRecord[],
    candidate: ShipSkillRecord[],
    parse: SlotParser
): ParseDiffRow[] => {
    const byName = new Map(candidate.map((r) => [r.name, r]));
    const rows: ParseDiffRow[] = [];
    for (const cur of current) {
        const cand = byName.get(cur.name);
        if (!cand) {
            rows.push({
                name: cur.name, refit: 0, slot: 'active', kind: 'missing', structural: false,
                configChanged: false, lost: [], gained: [], currentText: cur.active, candidateText: '',
            });
            continue;
        }
        // Charge cost is held at the CURRENT value so only text varies.
        const candHeld = { ...cand, chargeCharge: cur.chargeCharge };
        for (const refit of [0, 2, 4] as const) {
            const a = parse(cur, refit);
            const b = parse(candHeld, refit);
            for (const slot of ['active', 'charged', 'passive'] as const) {
                // Refit rows only add information for the passive, and only when its text moved.
                if (refit > 0 && slot !== 'passive') continue;
                const prev = refit === 4 ? 2 : 0;
                if (refit > 0 && passiveText(cur, refit) === passiveText(cur, prev)
                    && passiveText(cand, refit) === passiveText(cand, prev)) continue;
                const sa = a[slot].map(abilitySignature);
                const sb = b[slot].map(abilitySignature);
                const lost = multisetMinus(sa, sb);
                const gained = multisetMinus(sb, sa);
                const structural = lost.length > 0 || gained.length > 0;
                rows.push({
                    name: cur.name, refit, slot,
                    kind: kindOf(textOf(cur, slot, refit), textOf(cand, slot, refit)),
                    structural,
                    configChanged: !structural && canonicalAbilities(a[slot]) !== canonicalAbilities(b[slot]),
                    lost, gained,
                    currentText: textOf(cur, slot, refit),
                    candidateText: textOf(cand, slot, refit),
                });
            }
        }
    }
    return rows;
};

export interface DiffSummary {
    rows: number;
    byKind: Partial<Record<DiffKind, number>>;
    structural: Partial<Record<DiffKind, number>>;
    configChanged: Partial<Record<DiffKind, number>>;
}

export const summarizeDiff = (rows: ParseDiffRow[]): DiffSummary => {
    const s: DiffSummary = { rows: rows.length, byKind: {}, structural: {}, configChanged: {} };
    for (const r of rows) {
        s.byKind[r.kind] = (s.byKind[r.kind] ?? 0) + 1;
        if (r.structural) s.structural[r.kind] = (s.structural[r.kind] ?? 0) + 1;
        if (r.configChanged) s.configChanged[r.kind] = (s.configChanged[r.kind] ?? 0) + 1;
    }
    return s;
};
