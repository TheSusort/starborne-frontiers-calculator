/**
 * #407 — THE AUTHORING-AXIS GATE for `ABILITY_TYPE_TARGET_SIDES`.
 *
 * ── WHAT IT ENFORCES ──────────────────────────────────────────────────────────────────────────
 * `AbilityCard.tsx`'s target dropdown was not filtered by ability TYPE, so a user could author
 * `type: 'buff'` aimed at `all-enemies` and save it. That status lands in the per-victim ENEMY
 * store — the store side comes from the TARGET, not the config type — but `playerTurn.ts`'s
 * `matchingAbility` lookup searches `config.type === 'debuff'` only, so it matched nothing and the
 * "all enemies" buff hit exactly ONE enemy: the cast anchor. Owner ruling R4 closes that at the
 * authoring boundary, via `ABILITY_TYPE_TARGET_SIDES`.
 *
 * A per-type PERMITTED-SIDES map is the only shape that works. A filter derived from each type's
 * default target's side would be WRONG for three types that genuinely live on both sides in real
 * data — which is a measurement, not a guess, and it is what the sweep below re-checks.
 *
 * ── THE MEASUREMENT THE MAP CAME FROM ─────────────────────────────────────────────────────────
 * All 1140 abilities `buildShipAbilities` derives from `docs/ship-skills.csv` (every ship, every
 * slot, refit-resolved), swept for the type→target pairs that actually occur:
 *
 *   • ZERO buff-typed configs with an enemy target. `buff` is ally-side 262 times over (self 160,
 *     all-allies 87, ally 12, adjacent-allies 3) and enemy-side never — so marking it `'self'`
 *     forbids nothing the parser produces, and closes the authoring hole outright.
 *   • Exactly THREE types span both sides: `charge` (self-gain 24 / enemy-removal 8 / ally-bulk 5),
 *     `control` (inflicted 35 + 2 adjacency, and Taunt at 6 — `parseControlInflicts` emits Taunt
 *     with `side: 'self'`), and `extend-status` (Ripper's all-allies buff-extend 2, Sokol/Lev's
 *     enemy debuff-extend 2).
 *
 * ── WHAT MAKES IT RED ─────────────────────────────────────────────────────────────────────────
 * A parser change that emits an existing type on a side the map forbids. If that happens, the MAP
 * is what is wrong, not the corpus: widen that one entry to `'both'` and write the measured reason
 * beside it. Do NOT relax the assertion — the whole point is that the editor's contract and the
 * parser's output cannot drift apart silently.
 *
 * The CSV is gitignored dev reference data. This THROWS when it is absent rather than skipping
 * (`realKitFingerprints.test.ts`'s convention): a fresh worktree routinely lacks it and there is no
 * CI test workflow, so a skipped gate would vanish in silence.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { buildShipAbilities } from '../buildShipAbilities';
import {
    ABILITY_TYPE_TARGET_SIDES,
    ABILITY_TARGET_SIDE,
    targetSideAllowedForType,
} from '../abilityTargetSide';
import type { Ship } from '../../../types/ship';
import type { AbilityTarget, AbilityType } from '../../../types/abilities';

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
 *  slot-sensitive builder logic sees the truth. Mirrors `echoingBurstTriggerInventory.test.ts`. */
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
    type: AbilityType;
    target: AbilityTarget;
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
                    rows.push({ ship: rec.name, slot, type: a.type, target: a.target });
                }
            }
        }
    }
    return rows;
};

describe('#407: ABILITY_TYPE_TARGET_SIDES agrees with what the parser actually emits', () => {
    beforeAll(requireCsv);

    it('every corpus ability aims at a side its type permits', () => {
        const all = sweep();
        // Guard the sweep itself: a silently-empty — or merely SHRUNKEN — CSV read would make the
        // assertion below vacuous. The floor sits just under the real count (1140 at the time of
        // writing) rather than at a token value.
        expect(all.length).toBeGreaterThan(1000);

        const offending = all
            .filter((r) => !targetSideAllowedForType(r.type, r.target))
            .map((r) => `${r.ship}/${r.slot}: type '${r.type}' aimed at '${r.target}'`);
        expect([...new Set(offending)].sort()).toEqual([]);
    });

    it('exactly charge, control and extend-status are classified as spanning both sides', () => {
        // Pinned by NAME, not derived from the sweep, so that a parser change which stops emitting
        // (say) Taunt cannot quietly make `control` look single-sided and invite someone to narrow
        // it. Each is a measured fact — see the header.
        const both = Object.entries(ABILITY_TYPE_TARGET_SIDES)
            .filter(([, side]) => side === 'both')
            .map(([type]) => type)
            .sort();
        expect(both).toEqual(['charge', 'control', 'extend-status']);
    });

    it("buff is ally-side only — the entry that closes #407's authoring hole", () => {
        expect(ABILITY_TYPE_TARGET_SIDES.buff).toBe('self');
        // And therefore the exact combination the issue is about is refused.
        expect(targetSideAllowedForType('buff', 'all-enemies')).toBe(false);
        expect(targetSideAllowedForType('buff', 'adjacent-enemies')).toBe(false);
        expect(targetSideAllowedForType('buff', 'target-and-adjacent-enemies')).toBe(false);
        expect(targetSideAllowedForType('buff', 'enemy-highest-attack')).toBe(false);
        // While every ally-side target it legitimately uses is still allowed.
        expect(targetSideAllowedForType('buff', 'self')).toBe(true);
        expect(targetSideAllowedForType('buff', 'all-allies')).toBe(true);
        expect(targetSideAllowedForType('buff', 'adjacent-allies')).toBe(true);
    });

    it('the corpus really does contain zero buff-typed abilities aimed at an enemy', () => {
        // The measurement the `buff: 'self'` entry rests on, kept live. If a future parser change
        // starts emitting one, this fails HERE with the ship named, rather than the previous test
        // failing with a filter nobody can explain.
        const buffAtEnemy = sweep()
            .filter((r) => r.type === 'buff' && ABILITY_TARGET_SIDE[r.target] === 'enemy')
            .map((r) => `${r.ship}/${r.slot}/${r.target}`);
        expect(buffAtEnemy).toEqual([]);
    });

    it('a target is permitted for a both-sided type regardless of side', () => {
        // Instrument validation: without this, every `false` above could be explained by
        // `targetSideAllowedForType` simply always returning false.
        expect(targetSideAllowedForType('control', 'self')).toBe(true);
        expect(targetSideAllowedForType('control', 'all-enemies')).toBe(true);
        expect(targetSideAllowedForType('extend-status', 'all-allies')).toBe(true);
        expect(targetSideAllowedForType('extend-status', 'all-enemies')).toBe(true);
        // …and an enemy-only type still refuses the ally side.
        expect(targetSideAllowedForType('debuff', 'all-allies')).toBe(false);
        expect(targetSideAllowedForType('debuff', 'all-enemies')).toBe(true);
    });
});
