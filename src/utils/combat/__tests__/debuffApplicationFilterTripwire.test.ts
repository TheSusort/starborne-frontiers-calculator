/**
 * TRIPWIRE — the debuff-inflicted trigger family's verb decision.
 *
 * Owner ruling (2026-10-01): a skill text that reacts to a debuff being "inflicted" reacts ONLY to
 * a successful hacking-roll infliction, never to an unconditional "apply" (Provoke, Concentrate
 * Fire, Disable); the literal verb is read the other way too ("applying" → apply-only, Yuyan).
 * `Ability.triggerApplicationFilter` carries that decision, parsed from the clause's own verb
 * (skillTextParser's `debuffTriggerVerb`/`detectDebuffInflictionVerb`).
 *
 * This census reads every corpus ship (refits 0/2/4) and every parsed implant ability, and asserts
 * that any ability on the four-trigger family (on-debuff-inflicted, on-ally-debuff-inflicted,
 * on-other-ally-debuff-inflicted, on-ally-debuffed) whose OWN source row contains a literal
 * "inflict"/"apply" verb carries a `triggerApplicationFilter` — catching a future ship whose text
 * uses one of these verbs but whose parser path forgot to call the verb detector, which would
 * silently leave the ability firing on BOTH landing kinds (the pre-#593 default).
 *
 * A small, named ALLOWLIST covers the corpus's genuinely verb-less clauses (APEX's "gets
 * debuffed") — adding a ship here is a deliberate, reviewed decision, not a silent gap.
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

const FAMILY = new Set<AbilityTrigger>([
    'on-debuff-inflicted',
    'on-ally-debuff-inflicted',
    'on-other-ally-debuff-inflicted',
    'on-ally-debuffed',
]);

// A literal "inflict"/"apply" verb in the row text — the same alternation `debuffTriggerVerb`
// matches in skillTextParser.ts (kept as a SEPARATE literal here on purpose: this tripwire must
// catch a regression in that function too, not just reuse it as its own oracle).
const VERB_RE = /\binflict\w*\b|\bappl(?:y|ies|ying|ied)\b/i;

// Ships whose on-debuff-inflicted-family ability rides a clause with NO "inflict"/"apply" verb of
// its own (APEX's "when an enemy gets debuffed") — a reviewed, deliberate exception, not a gap.
// Adding a name here is a conscious call: read the ship's row text first and confirm it really
// carries no landing verb before assuming this tripwire is wrong.
const NO_VERB_ALLOWLIST = new Set(['APEX']);

const REFIT_LEVELS: RefitLevel[] = [0, 2, 4];

interface Violation {
    ship: string;
    refitLevel: RefitLevel;
    slot: string;
    trigger: AbilityTrigger;
    abilityType: string;
    text: string;
}

function censusMissingFilter(): { violations: Violation[]; checked: number } {
    const violations: Violation[] = [];
    let checked = 0;
    for (const record of loadShipSkillRecords()) {
        if (NO_VERB_ALLOWLIST.has(record.name.toUpperCase())) continue;
        for (const refitLevel of REFIT_LEVELS) {
            const ship = buildTraceShip(record.name, { refitLevel });
            if (!ship) continue;
            const skills = buildShipAbilities(ship);
            for (const slotEntry of skills.slots) {
                for (const ability of slotEntry.abilities) {
                    if (!FAMILY.has(ability.trigger)) continue;
                    const text = getSkillRowForSlot(ship, slotEntry.slot)?.text ?? '';
                    if (!VERB_RE.test(text)) continue; // this ship's own row carries no verb at all
                    checked++;
                    if (ability.triggerApplicationFilter === undefined) {
                        violations.push({
                            ship: ship.name,
                            refitLevel,
                            slot: slotEntry.slot,
                            trigger: ability.trigger,
                            abilityType: ability.type,
                            text,
                        });
                    }
                }
            }
        }
    }
    return { violations, checked };
}

describe('debuff-inflicted trigger family — triggerApplicationFilter tripwire', () => {
    it('every family ability whose own row carries an inflict/apply verb has triggerApplicationFilter set', () => {
        const { violations, checked } = censusMissingFilter();
        // Not vacuous: Hemlock/Oleander/Prospect/Provider/Warden/Butcher/Torcher/Pestilence/
        // Belladonna/Hayyan/Yuyan all carry a literal verb and a family trigger at some refit.
        expect(checked).toBeGreaterThan(0);
        expect(violations).toEqual([]);
    });

    it('the NO_VERB_ALLOWLIST members still resolve to the family (not silently falling off it)', () => {
        for (const name of NO_VERB_ALLOWLIST) {
            let sawFamilyTrigger = false;
            for (const refitLevel of REFIT_LEVELS) {
                const ship = buildTraceShip(name, { refitLevel });
                if (!ship) continue;
                const skills = buildShipAbilities(ship);
                for (const slotEntry of skills.slots) {
                    for (const ability of slotEntry.abilities) {
                        if (FAMILY.has(ability.trigger)) sawFamilyTrigger = true;
                    }
                }
            }
            expect(sawFamilyTrigger).toBe(true);
        }
    });
});
