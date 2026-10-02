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
 * The ship-DoT half pins that no ship DoT clause in either corpus is worded "applies <DoT>": the
 * parser never stamps `application` on a ship DoT, so every one lands and reacts as an inflict —
 * an apply-worded one would need that stamp, and this test is where it would surface.
 *
 * A small, named, per-corpus ALLOWLIST covers genuinely verb-less clauses; both are empty.
 *
 * CORPUS ACCESS: both CSVs are gitignored reference data. The `docs/ship-skills.csv` census must
 * read the real corpus
 * — a synthetic fallback would turn a missing-data worktree into a green vacuous run. The
 * catalogue half needs `docs/ship-skills.catalogue.csv` (built by
 * `scripts/build-catalogue-skills-csv.ts`); where that file is absent it is SKIPPED, by name.
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
// its own. Empty: every family clause in both corpora names its verb (APEX reads "gets inflicted
// with a debuff").
const NO_VERB_ALLOWLIST = new Set<string>();
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
});

// ---------------------------------------------------------------------------------------------
// Ship DoTs: none is apply-worded. A DoT's landing verb is the active verb that governs its tag —
// "applies"/"apply" or "inflicts" — not the gerund or adjective forms, which are trigger clauses
// and references (Valerian's "After inflicting Corrosion", "the newly inflicted Corrosion").
// The verb's reach ends at the next verb, so "applies Concentrate Fire …, and inflicts Inferno II"
// governs only the Concentrate Fire.
// ---------------------------------------------------------------------------------------------
const DOT_TAG_RE = /<unit-skill>\s*(Corrosion|Inferno|Bomb)\b/i;
const GOVERNING_VERB_RE =
    /\b(appl(?:y|ies)|inflict(?:s)?)\b|\b(?:deals?|grants?|gains?|repairs?|removes?|cleanses?|purges?|detonates?|extends?|inflicting|applying)\b|[.;]|<br\s*\/?>/gi;

/** Every DoT tag governed by an "apply" verb, as `ship: clause` lines. */
function applyWordedDots(text: string): { apply: string[]; inflict: number } {
    const apply: string[] = [];
    let inflict = 0;
    const marks = [...text.matchAll(GOVERNING_VERB_RE)];
    marks.forEach((m, i) => {
        const verb = m[1];
        if (!verb) return;
        const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
        const clause = text.slice(m.index, end);
        if (!DOT_TAG_RE.test(clause)) return;
        if (/^appl/i.test(verb)) apply.push(clause.replace(/<[^>]+>/g, '').trim());
        else inflict++;
    });
    return { apply, inflict };
}

function shipDotVerbCensus(csvPath?: string): { applyWorded: string[]; inflictWorded: number } {
    const applyWorded: string[] = [];
    let inflictWorded = 0;
    for (const r of loadShipSkillRecords(csvPath)) {
        for (const text of [r.active, r.charge, ...r.passives]) {
            const { apply, inflict } = applyWordedDots(text);
            inflictWorded += inflict;
            for (const clause of apply) applyWorded.push(`${r.name}: ${clause}`);
        }
    }
    return { applyWorded, inflictWorded };
}

describe('ship DoTs — none is apply-worded', () => {
    it('the detector sees an "applies <DoT>" clause and ignores the inflict, gerund and adjective forms', () => {
        expect(
            applyWordedDots(
                'This Unit deals 100% damage and applies <unit-skill>Corrosion II</unit-skill> for 2 turns.'
            ).apply
        ).toHaveLength(1);
        expect(
            applyWordedDots(
                'This Unit applies <unit-skill>Concentrate Fire</unit-skill> for 1 turn, and inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.'
            )
        ).toEqual({ apply: [], inflict: 1 });
        // Valerian: "inflicting" is a trigger clause and "newly inflicted" an adjective — neither
        // governs a DoT tag.
        expect(
            applyWordedDots(
                "After inflicting <unit-skill>Corrosion</unit-skill> with a critical hit, <unit-skill>extends the duration the newly inflicted</unit-skill> <unit-skill>Corrosion</unit-skill> by 1 turn, with the extension chance equal to this Unit's critical power."
            )
        ).toEqual({ apply: [], inflict: 0 });
    });

    it('no ship DoT clause is worded "applies <DoT>"', () => {
        const { applyWorded, inflictWorded } = shipDotVerbCensus();
        expect(inflictWorded).toBeGreaterThan(0);
        expect(applyWorded).toEqual([]);
    });
});

// Needs `docs/ship-skills.catalogue.csv` (built by `scripts/build-catalogue-skills-csv.ts`); where
// that file is absent this block is SKIPPED, by name, rather than passing on no data.
const CATALOGUE_PRESENT = csvAvailable(CATALOGUE_CSV);
describe.skipIf(!CATALOGUE_PRESENT)(
    `catalogue corpus — verb tripwires${
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

        it('no ship DoT clause is worded "applies <DoT>"', () => {
            const { applyWorded, inflictWorded } = shipDotVerbCensus(CATALOGUE_CSV);
            expect(inflictWorded).toBeGreaterThan(0);
            expect(applyWorded).toEqual([]);
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
