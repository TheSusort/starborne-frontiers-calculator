/**
 * TRIPWIRE — the debuff-inflicted trigger family's verb decision.
 *
 * Owner ruling (2026-10-01): a skill text that reacts to a debuff being "inflicted" reacts ONLY to
 * a successful hacking-roll infliction, never to an unconditional "apply" (Provoke, Concentrate
 * Fire, Disable); the literal verb is read the other way too ("applying" → apply-only, Yuyan).
 * `Ability.triggerApplicationFilter` carries that decision, parsed from the clause's own verb
 * (skillTextParser's `debuffTriggerVerb`/`detectDebuffInflictionVerb`).
 *
 * This census reads every corpus ship (refits 0/2/4) in BOTH corpora — `docs/ship-skills.csv` and
 * the official-catalogue text `docs/ship-skills.catalogue.csv` — and asserts that any ability on
 * the four-trigger family (on-debuff-inflicted, on-ally-debuff-inflicted,
 * on-other-ally-debuff-inflicted, on-ally-debuffed) whose OWN source row contains a literal
 * "inflict"/"apply" verb carries a `triggerApplicationFilter` — catching a future ship whose text
 * uses one of these verbs but whose parser path forgot to call the verb detector, which would
 * silently leave the ability firing on BOTH landing kinds (the pre-#593 default). The equipment
 * half pins the same rule for implants and gear sets: an equipment debuff/DoT carries the verb its
 * description states, and Insidiousness reacts to inflicted debuffs only (user ruling, 2026-10-02).
 *
 * A small, named, per-corpus ALLOWLIST covers genuinely verb-less clauses (OLD APEX's "gets
 * debuffed") — adding a ship here is a deliberate, reviewed decision, not a silent gap.
 *
 * CORPUS ACCESS: both CSVs are gitignored reference data. The OLD census must read the real corpus
 * — a synthetic fallback would turn a missing-data worktree into a green vacuous run. The
 * catalogue CSV is generated on the catalogue-adaptation branch only, so its census is SKIPPED
 * (visibly) where the file is absent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { buildTraceShip, RefitLevel } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { getSkillRowForSlot } from '../../ship/skillRows';
import type { AbilityTrigger } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { IMPLANTS } from '../../../constants/implants';
import { GEAR_SETS } from '../../../constants/gearSets';

const CATALOGUE_CSV = 'docs/ship-skills.catalogue.csv';

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
// its own (OLD APEX's "when an enemy gets debuffed") — a reviewed, deliberate exception, not a
// gap. Per corpus: the catalogue rewords APEX to "gets inflicted with a debuff", so it is NOT
// exempt there. Adding a name here is a conscious call: read the ship's row text first and confirm
// it really carries no landing verb before assuming this tripwire is wrong.
const NO_VERB_ALLOWLIST = new Set(['APEX']);
const CATALOGUE_NO_VERB_ALLOWLIST = new Set<string>();

const REFIT_LEVELS: RefitLevel[] = [0, 2, 4];

interface Violation {
    ship: string;
    refitLevel: RefitLevel;
    slot: string;
    trigger: AbilityTrigger;
    abilityType: string;
    text: string;
}

function censusMissingFilter(
    csvPath?: string,
    allowlist: ReadonlySet<string> = NO_VERB_ALLOWLIST
): { violations: Violation[]; checked: number } {
    const violations: Violation[] = [];
    let checked = 0;
    for (const record of loadShipSkillRecords(csvPath)) {
        if (allowlist.has(record.name.toUpperCase())) continue;
        for (const refitLevel of REFIT_LEVELS) {
            const base = buildTraceShip(record.name, { refitLevel });
            if (!base) continue;
            // The record's own text wins, so the catalogue census reads the catalogue's rows.
            const ship: Ship = {
                ...base,
                activeSkillText: record.active || undefined,
                chargeSkillText: record.charge || undefined,
                chargeSkillCharge: record.chargeCharge,
                firstPassiveSkillText: record.passives[0] || undefined,
                secondPassiveSkillText: record.passives[1] || undefined,
                thirdPassiveSkillText: record.passives[2] || undefined,
            };
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

// The catalogue CSV is generated on the catalogue-adaptation branch only; where it is absent this
// block is SKIPPED, by name, rather than passing on no data.
const CATALOGUE_PRESENT = csvAvailable(CATALOGUE_CSV);
describe.skipIf(!CATALOGUE_PRESENT)(
    `catalogue corpus — triggerApplicationFilter tripwire${
        CATALOGUE_PRESENT ? '' : ` (SKIPPED: ${CATALOGUE_CSV} is absent from this checkout)`
    }`,
    () => {
        it('every verb-bearing family ability has triggerApplicationFilter set', () => {
            const { violations, checked } = censusMissingFilter(
                CATALOGUE_CSV,
                CATALOGUE_NO_VERB_ALLOWLIST
            );
            expect(checked).toBeGreaterThan(0);
            expect(violations).toEqual([]);
        });
    }
);

// ---------------------------------------------------------------------------------------------
// Equipment: implants and gear sets carry the verb their own description states.
// ---------------------------------------------------------------------------------------------
type EquipmentSource = {
    label: string;
    description: string;
    build: () => ReturnType<typeof buildEquipmentAbilities>;
};

function equipmentSources(): EquipmentSource[] {
    const out: EquipmentSource[] = [];
    for (const [key, implant] of Object.entries(IMPLANTS)) {
        for (const variant of implant.variants) {
            const piece = {
                id: 'p',
                rarity: variant.rarity,
                setBonus: key,
            } as unknown as GearPiece;
            out.push({
                label: `${key}/${variant.rarity}`,
                description: (variant as { description?: string }).description ?? '',
                build: () =>
                    buildEquipmentAbilities(
                        { implants: { implant_major: 'p' }, equipment: {} } as unknown as Ship,
                        (id) => (id === 'p' ? piece : undefined)
                    ),
            });
        }
    }
    for (const [key, set] of Object.entries(GEAR_SETS)) {
        const slots = ['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'];
        const equipment: Record<string, string> = {};
        const pieces: Record<string, GearPiece> = {};
        slots.forEach((slot, i) => {
            equipment[slot] = `g${i}`;
            pieces[`g${i}`] = {
                id: `g${i}`,
                slot,
                rarity: 'legendary',
                setBonus: key,
            } as unknown as GearPiece;
        });
        out.push({
            label: key,
            description: (set as { description?: string }).description ?? '',
            build: () =>
                buildEquipmentAbilities(
                    { implants: {}, equipment } as unknown as Ship,
                    (id) => pieces[id]
                ),
        });
    }
    return out;
}

describe('equipment — the landing verb its description states', () => {
    it('every equipment debuff/DoT whose description names a verb carries it as `application`', () => {
        const mismatches: string[] = [];
        let checked = 0;
        for (const src of equipmentSources()) {
            const m = VERB_RE.exec(src.description);
            if (!m) continue;
            const verb = /^inflict/i.test(m[0]) ? 'inflict' : 'apply';
            for (const ability of src.build()) {
                const config = ability.config as { type: string; application?: string };
                if (config.type !== 'debuff' && config.type !== 'dot') continue;
                checked++;
                // An absent DoT verb reads as an inflict (`passesApplicationFilter`'s doc).
                const carried = config.application ?? 'inflict';
                if (carried !== verb)
                    mismatches.push(`${src.label}: text ${verb}, carries ${carried}`);
            }
        }
        // Not vacuous: Burner, Martyrdom, Bulwark and Doomsayer all state "applies".
        expect(checked).toBeGreaterThan(0);
        expect(mismatches).toEqual([]);
    });

    it('Insidiousness ("When debuffing an enemy") reacts to inflicted debuffs only, every rarity', () => {
        const insid = equipmentSources().filter((s) => s.label.startsWith('INSIDIOUSNESS/'));
        expect(insid.length).toBeGreaterThan(0);
        for (const src of insid) {
            const ability = src.build().find((a) => a.trigger === 'on-debuff-inflicted');
            expect(ability?.triggerApplicationFilter).toBe('inflict');
        }
    });
});
