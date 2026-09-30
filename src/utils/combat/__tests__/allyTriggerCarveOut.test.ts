/**
 * TRIPWIRE — the "another/other ally" carve-out.
 *
 * The owner ruling (2026-09-30, triggers.ts's trigger doc block) is that "an ally" in skill text
 * includes the caster; only an explicit "another ally"/"other ally" excludes it. Five triggers
 * were promoted to owner-inclusive on that ruling: `on-ally-debuffed`, `on-ally-debuff-inflicted`,
 * `on-ally-crit`, `on-ally-attacked`, `on-ally-purged`. A ship whose skill text actually reads
 * "another ally" for one of these must NOT be owner-inclusive — that shape belongs on the
 * owner-excluded siblings (`on-ally-crit-dot`, `on-ally-destroyed`) instead, mirroring how Crocus's
 * "another ally" DoT-crit text already resolves to the excluded `on-ally-crit-dot`.
 *
 * This census reads every corpus ship at refits 0/2/4 and asserts that no ability whose trigger is
 * one of the five owner-inclusive triggers came from a skill row that says "another/other ally" —
 * catching a future parser promotion (e.g. Provider's "When another ally inflicts a debuff")
 * silently landing on an owner-inclusive trigger.
 *
 * CORPUS ACCESS: `docs/ship-skills.csv` is gitignored reference data. This census must read the
 * real corpus — a synthetic fallback would turn a missing-data worktree into a green vacuous run.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { buildTraceShip, RefitLevel } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { getSkillRowForSlot } from '../../ship/skillRows';
import type { AbilityTrigger } from '../../../types/abilities';

function requireReferenceData(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data). ' +
                'This census must read the real corpus — a synthetic fallback would turn a ' +
                'missing-data worktree into a green vacuous run.'
        );
    }
}

beforeAll(requireReferenceData);

// The five triggers the 2026-09-30 ruling made owner-inclusive. Deliberately NOT
// `on-ally-crit-dot` (Crocus's "another ally") or `on-ally-destroyed` (a destroyed ship cannot
// take its own reaction) — both are owner-EXCLUDED carve-outs by design, not a gap this tripwire
// should flag.
const OWNER_INCLUSIVE_TRIGGERS = new Set<AbilityTrigger>([
    'on-ally-debuffed',
    'on-ally-debuff-inflicted',
    'on-ally-crit',
    'on-ally-attacked',
    'on-ally-purged',
]);

const ANOTHER_ALLY_RE = /\b(another|other)\s+ally\b/i;

const REFIT_LEVELS: RefitLevel[] = [0, 2, 4];

interface Violation {
    ship: string;
    refitLevel: RefitLevel;
    slot: string;
    trigger: AbilityTrigger;
    text: string;
}

/** Every owner-inclusive-trigger ability in the corpus (refits 0/2/4), paired with the source
 *  slot's whole refit-active text — the row the trigger's ability came from. Also returns the
 *  total count checked, so the test can assert the census is not vacuous. */
function censusOwnerInclusiveAbilities(): { violations: Violation[]; checked: number } {
    const violations: Violation[] = [];
    let checked = 0;
    for (const record of loadShipSkillRecords()) {
        for (const refitLevel of REFIT_LEVELS) {
            const ship = buildTraceShip(record.name, { refitLevel });
            if (!ship) continue;
            const skills = buildShipAbilities(ship);
            for (const slotEntry of skills.slots) {
                for (const ability of slotEntry.abilities) {
                    if (!OWNER_INCLUSIVE_TRIGGERS.has(ability.trigger)) continue;
                    checked++;
                    const text = getSkillRowForSlot(ship, slotEntry.slot)?.text ?? '';
                    if (ANOTHER_ALLY_RE.test(text)) {
                        violations.push({
                            ship: ship.name,
                            refitLevel,
                            slot: slotEntry.slot,
                            trigger: ability.trigger,
                            text,
                        });
                    }
                }
            }
        }
    }
    return { violations, checked };
}

describe('ally-trigger "another ally" carve-out tripwire', () => {
    it('no owner-inclusive-trigger ability comes from a skill row that says "another/other ally"', () => {
        const { violations, checked } = censusOwnerInclusiveAbilities();
        // Not vacuous: the corpus must actually exercise at least one of the five triggers
        // (Oleander/on-ally-debuff-inflicted, Hayyan/on-ally-debuffed, Sentinel-Hermes/on-ally-crit,
        // reactive-plating ships/on-ally-attacked, Salvation/on-ally-purged all do today).
        expect(checked).toBeGreaterThan(0);
        expect(violations).toEqual([]);
    });
});
