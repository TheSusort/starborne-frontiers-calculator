/**
 * #345 — corpus inventory gate for the two detonation triggers the fix separated.
 *
 * `on-bomb-detonated` (VICTIM-scoped, the Bomb DoT) and `on-own-echoing-burst-detonated`
 * (APPLIER-scoped, the accumulate-then-detonate container) used to be ONE trigger, because
 * `BOMB_DETONATE_RE` carried an effect-agnostic "explodes on (an|the) enemy" alternate added
 * specifically to sweep Valkyrie's Echoing Burst in. That cost her both properties her text asks
 * for: her repair fired on any teammate's Bomb, and never on her own burst.
 *
 * This sweeps EVERY CSV row's every slot through `buildShipAbilities` and pins the complete
 * inventory of both triggers. A future parser change that re-widens the Bomb regex, or drops the
 * Echoing Burst one, fails HERE instead of silently re-crossing the two mechanics.
 *
 * The CSV is gitignored dev reference data. This THROWS when it is absent rather than skipping
 * (`realKitFingerprints.test.ts`'s convention): a fresh worktree routinely lacks it and there is no
 * CI test workflow, so a skipped gate would vanish in silence.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { buildShipAbilities } from '../buildShipAbilities';
import type { Ship } from '../../../types/ship';

function requireCsv(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — it is ' +
                "the parser's source of truth and this gate cannot run without it."
        );
    }
}

type CsvSlot = 'active' | 'charged' | 'passive1' | 'passive2' | 'passive3';

/** One CSV column's text in its REAL slot, so `getShipSkillRows` resolves the intended passive and
 *  slot-sensitive builder logic sees the truth. Mirrors `lowestHpAllySelector.test.ts`. */
const shipForSlot = (slot: CsvSlot, text: string): Ship => {
    const refits = (n: number) => Array.from({ length: n }, () => ({}));
    if (slot === 'active') return { refits: [], activeSkillText: text } as unknown as Ship;
    if (slot === 'charged') return { refits: [], chargeSkillText: text } as unknown as Ship;
    if (slot === 'passive1') return { refits: [], firstPassiveSkillText: text } as unknown as Ship;
    if (slot === 'passive2')
        return { refits: refits(2), secondPassiveSkillText: text } as unknown as Ship;
    return { refits: refits(4), thirdPassiveSkillText: text } as unknown as Ship;
};

interface Row {
    ship: string;
    slot: CsvSlot;
    type: string;
    trigger: string;
}

const sweep = (): Row[] => {
    const rows: Row[] = [];
    for (const rec of loadShipSkillRecords()) {
        const slots: [CsvSlot, string][] = [
            ['active', rec.active],
            ['charged', rec.charge],
            ['passive1', rec.passives[0]],
            ['passive2', rec.passives[1]],
            ['passive3', rec.passives[2]],
        ];
        for (const [slot, text] of slots) {
            if (text.trim().length === 0) continue;
            for (const built of buildShipAbilities(shipForSlot(slot, text)).slots) {
                for (const a of built.abilities) {
                    rows.push({ ship: rec.name, slot, type: a.type, trigger: a.trigger });
                }
            }
        }
    }
    return rows;
};

describe('#345: the Bomb and Echoing Burst detonation triggers stay separate across the corpus', () => {
    beforeAll(requireCsv);

    it('carries the two triggers on exactly Valkyrie and Demolisher, and never both on one ship', () => {
        const all = sweep();
        // Guard the sweep itself: a silently-empty — or merely SHRUNKEN — roster read would make
        // every assertion below vacuous. The floor sits just under the real row count (1124 at the
        // time of writing) rather than at a token value.
        expect(all.length).toBeGreaterThan(1000);

        const id = (r: Row) => `${r.ship}/${r.slot}/${r.type}`;

        // APPLIER-scoped, Valkyrie only. Both of her passive refit states carry the dual repair
        // (the ally half plus the mirrored self half), and nothing else in the corpus names an
        // Echoing Burst explosion.
        expect(
            all
                .filter((r) => r.trigger === 'on-own-echoing-burst-detonated')
                .map(id)
                .sort()
        ).toEqual([
            'Valkyrie/passive1/heal',
            'Valkyrie/passive1/heal',
            'Valkyrie/passive2/heal',
            'Valkyrie/passive2/heal',
        ]);

        // VICTIM-scoped, Demolisher only: the charge removal on both passive refit states, plus the
        // R2 splash. Valkyrie must NOT appear here — that overlap was the bug.
        expect(
            all
                .filter((r) => r.trigger === 'on-bomb-detonated')
                .map(id)
                .sort()
        ).toEqual([
            'Demolisher/passive1/charge',
            'Demolisher/passive2/charge',
            'Demolisher/passive2/damage',
        ]);
    });
});
