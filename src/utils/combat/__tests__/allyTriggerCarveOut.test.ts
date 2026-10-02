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

// The owner-EXCLUDED counterpart: every ability on one of these came from a skill row that must
// say "another/other ally" — the inverse of the census above, catching an ability parsed onto
// the excluded trigger from ordinary "an ally" text (which belongs on an inclusive sibling
// instead). `on-ally-crit-dot` (Crocus) predates this file; `on-other-ally-debuff-inflicted`
// (Provider, #590) is the newest member.
const OWNER_EXCLUDED_TRIGGERS = new Set<AbilityTrigger>(['on-other-ally-debuff-inflicted']);

// Sentinel's passive reads "When another ally critically hits an enemy ..." but resolves to the
// owner-inclusive `on-ally-crit`. Sentinel cannot crit an enemy at all (her passive damage cannot
// critically hit, and her active and charged are pure buffs), so the owner-inclusive trigger never
// fires for her own crit and there is no own-crit case to model. The exemption is this one ship,
// this one trigger, and her passive row; any other ship or trigger still fails the census.
const OWNER_INCLUSIVE_EXEMPT_ROWS: { ship: string; trigger: AbilityTrigger; slot: string }[] = [
    { ship: 'Sentinel', trigger: 'on-ally-crit', slot: 'passive' },
];

const isExemptRow = (v: Pick<Violation, 'ship' | 'trigger' | 'slot'>): boolean =>
    OWNER_INCLUSIVE_EXEMPT_ROWS.some(
        (e) => e.ship === v.ship && e.trigger === v.trigger && e.slot === v.slot
    );

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

/** Inverse census: every owner-EXCLUDED-trigger ability in the corpus (refits 0/2/4), flagged as
 *  a violation when its source row does NOT say "another/other ally" — that shape belongs on an
 *  owner-inclusive sibling instead. */
function censusOwnerExcludedAbilities(): { violations: Violation[]; checked: number } {
    const violations: Violation[] = [];
    let checked = 0;
    for (const record of loadShipSkillRecords()) {
        for (const refitLevel of REFIT_LEVELS) {
            const ship = buildTraceShip(record.name, { refitLevel });
            if (!ship) continue;
            const skills = buildShipAbilities(ship);
            for (const slotEntry of skills.slots) {
                for (const ability of slotEntry.abilities) {
                    if (!OWNER_EXCLUDED_TRIGGERS.has(ability.trigger)) continue;
                    checked++;
                    const text = getSkillRowForSlot(ship, slotEntry.slot)?.text ?? '';
                    if (!ANOTHER_ALLY_RE.test(text)) {
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
        expect(violations.filter((v) => !isExemptRow(v))).toEqual([]);
    });

    it('the Sentinel exemption still matches a real row, so it is policed rather than stale', () => {
        const { violations } = censusOwnerInclusiveAbilities();
        expect(violations.filter(isExemptRow).length).toBeGreaterThan(0);
        expect(new Set(violations.filter(isExemptRow).map((v) => v.ship))).toEqual(
            new Set(['Sentinel'])
        );
    });

    it('every owner-excluded-trigger ability comes from a skill row that says "another/other ally"', () => {
        const { violations, checked } = censusOwnerExcludedAbilities();
        // Not vacuous: Provider's damage + Crit Rate Down II both resolve to
        // on-other-ally-debuff-inflicted at refits 0/2/4 (#590).
        expect(checked).toBeGreaterThan(0);
        expect(violations).toEqual([]);
    });
});
