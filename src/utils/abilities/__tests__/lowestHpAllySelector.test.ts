import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { parseHealAbilities } from '../../skillTextParser';
import { buildShipAbilities } from '../buildShipAbilities';
import type { Ship } from '../../../types/ship';
import type { AbilityTarget } from '../../../types/abilities';

/**
 * SP-4e Task 3 — the parser flip that makes a NAMED worst-HP ally recipient carry the
 * `'lowest-hp-ally'` selector instead of the generic `'ally'` that the engine used to resolve
 * off a run-mode flag (`teamBattle`).
 *
 * Three ships name their recipient by live HP, and one selector covers all three: "most missing
 * health" is loose phrasing for lowest HP PERCENTAGE, not absolute missing HP (user-confirmed
 * 2026-08-20).
 *
 *   Pallas   · active   "The other ally with the lowest current health percentage heals for 20%
 *                        of the damage dealt"
 *   Volk     · passive  "repairs 30% of its Max HP to the ally with the most missing health"
 *   Valkyrie · passive  "this Unit and the ally with the lowest current health percentage repair
 *                        5% of damage dealt"  (on-own-echoing-burst-detonated since #345; ALSO
 *                        emits a mirrored 'self')
 *
 * Both blocks read `docs/ship-skills.csv` — the parser's source of truth (CLAUDE.md), NOT any
 * ships constant — via `scripts/lib/shipSkillCsv`, whose `loadShipSkillRecords` is built on the
 * same `readCsvRecords`/`parseCsvLine` pair `scripts/auditSkills.ts` uses (so multi-line quoted
 * passives survive).
 *
 * The CSV is gitignored dev reference data. Both blocks THROW when it is absent rather than
 * skipping (`realKitFingerprints.test.ts`'s convention): a fresh worktree of this repo routinely
 * lacks it and there is no CI test workflow, so a skip would make the inventory gate — whose entire
 * purpose is to stop a future parser change quietly widening the selector — vanish in silence.
 */

function requireCsv(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — it is ' +
                "the parser's source of truth and these tests cannot run without it."
        );
    }
}

type CsvSlot = 'active' | 'charged' | 'passive1' | 'passive2' | 'passive3';

/**
 * Builds a Ship carrying ONE CSV column's text in its real slot. Unlike `auditSkills`'
 * `abilitiesFor` (which parses every text as the active slot), this feeds the refit count needed
 * for `getShipSkillRows` to resolve the intended passive — so each row is built under its true
 * `SkillSlot`, and slot-sensitive builder logic (the bare-repair→ally flip) sees the truth.
 * Slots stay ISOLATED rather than combined because passive extraction is refit-state-driven: one
 * combined build would only ever surface a single passive column.
 */
const shipForSlot = (slot: CsvSlot, text: string): Ship => {
    const refits = (n: number) => Array.from({ length: n }, () => ({}));
    if (slot === 'active') return { refits: [], activeSkillText: text } as unknown as Ship;
    if (slot === 'charged') return { refits: [], chargeSkillText: text } as unknown as Ship;
    if (slot === 'passive1') return { refits: [], firstPassiveSkillText: text } as unknown as Ship;
    if (slot === 'passive2')
        return { refits: refits(2), secondPassiveSkillText: text } as unknown as Ship;
    return { refits: refits(4), thirdPassiveSkillText: text } as unknown as Ship;
};

const csvSlots = (rec: {
    active: string;
    charge: string;
    passives: [string, string, string];
}): [CsvSlot, string][] =>
    (
        [
            ['active', rec.active],
            ['charged', rec.charge],
            ['passive1', rec.passives[0]],
            ['passive2', rec.passives[1]],
            ['passive3', rec.passives[2]],
        ] as [CsvSlot, string][]
    ).filter(([, text]) => text.trim().length > 0);

const csvText = (shipName: string, slot: CsvSlot): string => {
    const rec = loadShipSkillRecords().find((r) => r.name.toLowerCase() === shipName.toLowerCase());
    if (!rec) throw new Error(`ship not found in ${'docs/ship-skills.csv'}: ${shipName}`);
    const found = csvSlots(rec).find(([s]) => s === slot);
    if (!found) throw new Error(`${shipName} has no ${slot} text`);
    return found[1];
};

/** Every heal ability the builder emits for one CSV row, as `target` values. */
const builtHealTargets = (slot: CsvSlot, text: string): AbilityTarget[] =>
    buildShipAbilities(shipForSlot(slot, text))
        .slots.flatMap((s) => s.abilities)
        .filter((a) => a.type === 'heal')
        .map((a) => a.target);

describe('SP-4e: a text-named worst-HP ally recipient parses as lowest-hp-ally', () => {
    beforeAll(requireCsv);

    it('Pallas active — "The other ally with the lowest current health percentage"', () => {
        const text = csvText('Pallas', 'active');
        expect(parseHealAbilities(text)).toEqual([
            {
                kind: 'heal',
                pct: 20,
                basis: 'damage-dealt',
                target: 'lowest-hp-ally',
                explicitTarget: true,
            },
        ]);
        expect(builtHealTargets('active', text)).toEqual(['lowest-hp-ally']);
    });

    it('Volk passive — "repairs 30% of its Max HP to the ally with the most missing health"', () => {
        const p1 = csvText('Volk', 'passive1');
        expect(parseHealAbilities(p1)).toEqual([
            {
                kind: 'heal',
                pct: 30,
                basis: 'hp',
                target: 'lowest-hp-ally',
                explicitTarget: true,
            },
        ]);
        expect(builtHealTargets('passive1', p1)).toEqual(['lowest-hp-ally']);

        // The R2 passive repeats the ally repair and adds an end-of-turn SELF repair — the
        // selector must claim only the first, leaving the bare self-repair alone.
        const p2 = csvText('Volk', 'passive2');
        expect(parseHealAbilities(p2).map((h) => h.target)).toEqual(['lowest-hp-ally', 'self']);
        expect(builtHealTargets('passive2', p2)).toEqual(['lowest-hp-ally', 'self']);
    });

    it('Valkyrie passive — "this Unit and the ally with the lowest current health percentage"', () => {
        const p1 = csvText('Valkyrie', 'passive1');
        // "this Unit AND the ally …" → two entries: the selected ally plus a mirrored self.
        expect(parseHealAbilities(p1)).toEqual([
            {
                kind: 'heal',
                pct: 5,
                basis: 'damage-dealt',
                target: 'lowest-hp-ally',
                explicitTarget: true,
                leechScope: 'detonation',
            },
            {
                kind: 'heal',
                pct: 5,
                basis: 'damage-dealt',
                target: 'self',
                explicitTarget: true,
                leechScope: 'detonation',
            },
        ]);
        expect(builtHealTargets('passive1', p1)).toEqual(['lowest-hp-ally', 'self']);
    });

    it('Chimei carries the selector via her #435 over-repair redirect, not her Stealth repair sentence', () => {
        // Chimei's passive contains a FULL match for the selector regex ("the ally with the
        // lowest current health percentage") in a THIRD sentence describing an over-repair
        // redirect (#435). That clause has no percentage tag, so `parseHealAbilities` — the
        // heal chain that resolves Pallas/Volk/Valkyrie above — never captures it; it is parsed
        // as its own standalone reactive ability (`parseOverRepairRedirect`) instead. The parser's
        // per-match sentence scoping still keeps the phrase off the SECOND sentence's real
        // all-allies Stealth repair.
        const rec = loadShipSkillRecords().find((r) => r.name.toLowerCase() === 'chimei')!;
        expect(rec.passives[0]).toContain('lowest current health percentage');
        for (const [slot, text] of csvSlots(rec)) {
            expect(parseHealAbilities(text).map((h) => h.target)).not.toContain('lowest-hp-ally');
        }
        // The over-repair clause sits in both passive1 and passive2's CSV text (both rows carry
        // the same three sentences) — the built kit surfaces the selector on both alongside her
        // real all-allies Stealth repair. Only the refit-active row applies at runtime
        // (`getShipSkillRows`); both are exercised here because each is a distinct SkillSlot.
        expect(builtHealTargets('passive1', rec.passives[0])).toEqual([
            'all-allies',
            'lowest-hp-ally',
        ]);
        expect(builtHealTargets('passive2', rec.passives[1])).toEqual([
            'all-allies',
            'lowest-hp-ally',
        ]);
        // Her active/charge skills carry neither the clause nor the selector.
        expect(builtHealTargets('active', rec.active)).not.toContain('lowest-hp-ally');
        expect(builtHealTargets('charged', rec.charge)).not.toContain('lowest-hp-ally');
    });
});

/**
 * Inventory gate (spec §3.5). Sweeps EVERY CSV row's every slot through `buildShipAbilities` and
 * pins the complete set of abilities carrying `'lowest-hp-ally'`. Checked in deliberately: a
 * future parser change that widens the selector — most plausibly by losing the sentence scoping
 * that keeps Chimei's over-repair sentence out — fails here instead of silently re-routing heals.
 */
describe('SP-4e: lowest-hp-ally roster inventory gate', () => {
    beforeAll(requireCsv);

    interface InventoryRow {
        ship: string;
        slot: CsvSlot;
        type: string;
        target: AbilityTarget;
    }

    const sweep = (): InventoryRow[] => {
        const rows: InventoryRow[] = [];
        for (const rec of loadShipSkillRecords()) {
            for (const [slot, text] of csvSlots(rec)) {
                for (const built of buildShipAbilities(shipForSlot(slot, text)).slots) {
                    for (const a of built.abilities) {
                        rows.push({ ship: rec.name, slot, type: a.type, target: a.target });
                    }
                }
            }
        }
        return rows;
    };

    it('carries the selector on exactly Pallas, Volk, Valkyrie and Chimei', () => {
        const all = sweep();
        // Guard the sweep itself: a silently-empty — or merely SHRUNKEN — roster read would make
        // every assertion below vacuous. The floor sits just under the real row count (1124 at the
        // time of writing) rather than at a token value, so losing even a modest slice of the
        // roster trips it instead of passing with half the corpus unread.
        expect(all.length).toBeGreaterThan(1000);

        const selected = all.filter((r) => r.target === 'lowest-hp-ally');
        expect(selected.map((r) => `${r.ship}/${r.slot}/${r.type}`).sort()).toEqual([
            'Chimei/passive1/heal',
            'Chimei/passive2/heal',
            'Pallas/active/heal',
            'Valkyrie/passive1/heal',
            'Valkyrie/passive2/heal',
            'Volk/passive1/heal',
            'Volk/passive2/heal',
        ]);
        expect([...new Set(selected.map((r) => r.ship))].sort()).toEqual([
            'Chimei',
            'Pallas',
            'Valkyrie',
            'Volk',
        ]);
    });

    it('carries the selector on exactly Chimei/passive1 and Chimei/passive2 (#435 over-repair redirect)', () => {
        // Chimei's over-repair redirect (#435) is a standalone reactive heal ability, not an arm
        // of the heal chain (see the paired test above) — but it legitimately carries the
        // 'lowest-hp-ally' selector now. It appears on BOTH passive1 and passive2 because both
        // CSV rows carry the same three sentences (normal for this data; only the refit-active
        // row applies at runtime) — this is not a double-registration bug.
        const chimei = sweep().filter((r) => r.ship.toLowerCase() === 'chimei');
        // Chimei is swept at all (not a dropped multi-line CSV record).
        expect(chimei.length).toBeGreaterThan(0);
        expect(chimei.filter((r) => r.target === 'lowest-hp-ally')).toEqual([
            { ship: 'Chimei', slot: 'passive1', type: 'heal', target: 'lowest-hp-ally' },
            { ship: 'Chimei', slot: 'passive2', type: 'heal', target: 'lowest-hp-ally' },
        ]);
    });
});
