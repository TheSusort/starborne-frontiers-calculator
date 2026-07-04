/* eslint-disable no-console */
/**
 * Skill-parser coverage audit.
 *
 * Runs every ship's skill text (docs/ship-skills.csv) through buildShipAbilities and flags
 * slots where the TEXT clearly contains a mechanic but the PARSE produced no matching ability
 * or condition. There is no ground truth for correctness — this only catches coverage GAPS
 * (the class of bug we keep hitting ship-by-ship), prioritised so shared misses surface together.
 *
 * Usage: npm run audit:skills
 * Writes a grouped report to docs/skill-audit.md and prints a summary.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { buildShipAbilities } from '../src/utils/abilities/buildShipAbilities';
import {
    detectDamageReactionTrigger,
    detectHpCrossingTrigger,
    detectTargetHpGate,
} from '../src/utils/skillTextParser';
import { Ship } from '../src/types/ship';
import { Ability } from '../src/types/abilities';
import { ALLOWLIST } from './auditSkills.allowlist';

// Paths are relative to the repo root (npm run sets cwd there).
const CSV_PATH = 'docs/ship-skills.csv';
const OUT_PATH = 'docs/skill-audit.md';

// ─── CSV ───────────────────────────────────────────────────────────────────
function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else inQuotes = false;
            } else cur += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') {
            fields.push(cur);
            cur = '';
        } else cur += c;
    }
    fields.push(cur);
    return fields;
}

interface ShipRow {
    name: string;
    slots: { slot: string; text: string }[];
}

// RESOLVED (2026-07-02, was a KNOWN GAP): six CSV records (Centurion, Chimei, Curator,
// Enforcer, Graphite, Lingshe) carry literal newlines inside quoted passive texts — a naive
// line-per-record reader silently dropped them (141 of 147 records audited). Fixed below by
// accumulating physical lines into a record buffer until quotes are balanced (see
// `readCsvRecords`) before splitting into fields. Recovering these six surfaced two
// pre-existing findings, fixed ahead of the reader change: the `detonation` rule's keyword
// false-positived on Chimei's "Out. Detonation Damage Up III" buff NAME (fixed via a negative
// lookahead — see the rule above); Lingshe's "gains Stealth on detonating a Bomb" passive
// clause is already gated by the parser's on-bomb-detonated trigger (verified via
// `detectReactiveTrigger`'s `BOMB_DETONATE_RE`), so it never reaches `ungatedEffects` — no
// code change needed there. The pre-combat-stat rule below was verified out-of-band against
// all 147 records: it hits exactly Lionheart/Centurion/Enforcer/Defiant/Stalwart, all handled.
function readCsvRecords(raw: string): string[] {
    const physicalLines = raw.split('\n');
    const records: string[] = [];
    let buffer: string[] = [];
    let quoteCount = 0;
    for (const line of physicalLines) {
        buffer.push(line);
        quoteCount += (line.match(/"/g) ?? []).length;
        // Even quote count = no unterminated quoted field spanning this line boundary — the
        // buffered lines form one complete record. Re-join with '\n' so multi-line skill text
        // is preserved (parseCsvLine treats embedded newlines as ordinary characters).
        if (quoteCount % 2 === 0) {
            const record = buffer.join('\n');
            buffer = [];
            quoteCount = 0;
            if (record.trim().length > 0) records.push(record);
        }
    }
    // Any leftover buffered lines (unbalanced quotes through EOF) are dropped — malformed CSV,
    // not a multi-line record.
    return records;
}

function readShips(): ShipRow[] {
    const records = readCsvRecords(readFileSync(CSV_PATH, 'utf8'));
    const rows: ShipRow[] = [];
    for (let i = 1; i < records.length; i++) {
        const f = parseCsvLine(records[i]);
        if (f.length < 7) continue;
        const [name, active, , charged, p1, p2, p3] = f;
        const slots = [
            { slot: 'active', text: active },
            { slot: 'charged', text: charged },
            { slot: 'passive1', text: p1 },
            { slot: 'passive2', text: p2 },
            { slot: 'passive3', text: p3 },
        ].filter((s) => s.text && s.text !== 'null' && s.text.trim().length > 0);
        rows.push({ name, slots });
    }
    return rows;
}

// Parse one skill text in isolation by treating it as the active slot.
function abilitiesFor(text: string): Ability[] {
    const ship = { refits: [], activeSkillText: text } as unknown as Ship;
    const skills = buildShipAbilities(ship);
    return skills.slots.find((s) => s.slot === 'active')?.abilities ?? [];
}

// ─── Coverage rules ──────────────────────────────────────────────────────────
const hasType = (abilities: Ability[], type: string) => abilities.some((a) => a.type === type);
const hasModifier = (abilities: Ability[], channel: string) =>
    abilities.some((a) => a.config.type === 'modifier' && a.config.channel === channel);
const ungatedEffects = (abilities: Ability[]) =>
    abilities.filter(
        (a) =>
            (a.config.type === 'buff' || a.config.type === 'debuff') &&
            a.conditions.length === 0 &&
            // A reactive trigger (on-crit / start-of-round / bomb-detonated / on-attacked / …)
            // IS the gate — the parser routes these through the engine's trigger machinery
            // instead of a condition, so they aren't "ungated" (Enforcer, Wusheng, Valkyrie,
            // Lingshe, and the Phase 4c damage-reaction ships: Warden, Guardian, Makoli, …).
            a.trigger === 'on-cast' &&
            // Recurring per-turn grants are unconditional by design (not a missing gate).
            a.config.duration !== 'recurring'
    );

interface Rule {
    id: string;
    severity: 'high' | 'medium';
    /** True when the text shows this mechanic (loose, so a parser miss surfaces). */
    keyword: (plain: string) => boolean;
    /** True when the parse handled it. Flagged when keyword && !handled. */
    handled: (abilities: Ability[], plain: string) => boolean;
}

const RULES: Rule[] = [
    {
        id: 'base-damage',
        severity: 'high',
        keyword: (t) => /\d+(?:\.\d+)?%\s+damage\b/i.test(t) && !/\bmore\b/i.test(t),
        handled: (a) => hasType(a, 'damage'),
    },
    {
        id: 'detonation',
        severity: 'high',
        // Matches the detonate MECHANIC ("detonates <Bomb/Corrosion/Inferno> effects", "will
        // detonate", "detonates a Bomb", "detonation damage per … crit power"). Excludes the
        // buff NAME "Out. Detonation Damage Up III" (Chimei) via the negative lookahead — that
        // grant is a plain Attack-Up-style stat buff, not an actual detonate mechanic, and would
        // otherwise false-positive since `detonat` is a substring of the buff name.
        keyword: (t) => /detonat(?!ion\s+damage\s+up\b)/i.test(t),
        handled: (a) => hasType(a, 'detonate-dot'),
    },
    {
        id: 'extend-dot',
        severity: 'high',
        keyword: (t) => /extend/i.test(t) && /(damage over time|\bdot\b)/i.test(t),
        handled: (a) => hasType(a, 'extend-dot'),
    },
    {
        id: 'no-crit',
        severity: 'high',
        // Matches "cannot"/"cannont" (source-data misspelling), but only when the subject is
        // an attack — NOT a repair/heal (mirrors parseNoCrit, which intentionally leaves
        // "this repair cannot critically hit", e.g. Pallas, as a normal crit-capable attack).
        keyword: (t) =>
            [...t.matchAll(/(\w+)\s+cann(?:ot|ont)\s+critically\s+hit/gi)].some(
                (m) => !/^(?:repairs?|heals?)$/i.test(m[1])
            ),
        handled: (a) => a.some((x) => x.config.type === 'damage' && x.config.noCrit === true),
    },
    {
        id: 'crit-damage-modifier',
        severity: 'high',
        keyword: (t) => /more\s+critical\s+damage/i.test(t),
        handled: (a) => hasModifier(a, 'critDamage'),
    },
    {
        id: 'outgoing-damage-modifier',
        severity: 'medium',
        // Require a % before "more …damage" so "3 or more Damage over Time effects" doesn't match.
        keyword: (t) => /\d+%\s+more\s+(?:direct\s+)?damage\b/i.test(t),
        handled: (a) => hasModifier(a, 'outgoingDamage'),
    },
    {
        id: 'defense-penetration',
        severity: 'medium',
        keyword: (t) => /defense\s+penetration/i.test(t),
        handled: (a) => hasModifier(a, 'defensePenetration'),
    },
    {
        id: 'dot-application',
        severity: 'high',
        keyword: (t) => /inflict\w*[^.]*\b(corrosion|inferno|bomb)\b/i.test(t),
        handled: (a) => hasType(a, 'dot'),
    },
    {
        id: 'always-crit',
        severity: 'medium',
        // "This Unit's attacks are always critical" (Asphodel) / "always lands critical
        // hits" (Tormenter). Deliberately NEVER parser-handled: the game-data import sets
        // these ships' crit rate to 100%, so an ability-model flag would double-count.
        // The allowlist records the known ships; a NEW ship matching this keyword should
        // be verified to carry crit 100 in its import/template data, then allowlisted.
        keyword: (t) => /always\s+(?:lands?\s+)?critical/i.test(t),
        handled: () => false,
    },
    {
        id: 'shield-penetration-innate',
        severity: 'medium',
        // "This Unit has X% Shield Penetration". Deliberately NEVER parser-handled: shield
        // penetration is already a filled ship stat (import/template data) for every ship
        // carrying this clause, so parsing it would double-count. The allowlist records the
        // known ships; a NEW ship matching this keyword should have its stat verified, then
        // be allowlisted.
        keyword: (t) => /has\s+\d+(?:\.\d+)?%\s+shield\s+penetration/i.test(t),
        handled: () => false,
    },
    {
        id: 'instead-replacement',
        severity: 'medium',
        // "If <self condition>, this Unit INSTEAD gains <buff> and deals <higher>% damage" — a
        // mutually-exclusive full-branch replacement where BOTH the buff granted AND the damage
        // change (Panon active/charged, the sole corpus case). Deferred (PR6b, user decision):
        // modelling it faithfully needs complementary/negated self-conditions AND sim damage-branch
        // selection (damageInputsFromSkill reads only the first damage ability) — bespoke infra for
        // one ship. Scoped to "instead gains/deals" so Isha's handled "instead repairs" crit-filter
        // swap does NOT match. A NEW ship matching this should get the branch model built, then be
        // removed from the allowlist.
        keyword: (t) => /\binstead\s+(?:gains?|deals?)\b/i.test(t),
        handled: () => false,
    },
    {
        id: 'accumulate-detonate',
        severity: 'high',
        keyword: (t) => /echoing burst/i.test(t),
        handled: (a) => hasType(a, 'accumulate-detonate'),
    },
    {
        id: 'buff-steal',
        severity: 'high',
        // "steals N buff(s)" (Pallas/Thresh/Tithonus charged skills) — active-verb only, mirrors
        // parseBuffSteal's STEAL_RE. Deliberately requires the "buff(s)" token so Meatshield's
        // named-buff-count steal ("it steals Protection until this Unit has 3 stacks of
        // Protection" — no digit+buff(s) shape, no explicit source) does NOT match: that's a
        // distinct mechanic (steals a specific NAMED buff up to a stack threshold) left
        // deliberately unmodeled — see parseBuffSteal's doc comment. Confirmed via
        // `grep -io "steal[a-z]*[^.]*" docs/ship-skills.csv`: exactly 4 "steal" occurrences in
        // the whole corpus (Pallas/Thresh/Tithonus/Meatshield), so no allowlist entry is needed.
        keyword: (t) => /\bsteals?\s+(?:\d+|an?)\s+buffs?\b/i.test(t),
        handled: (a) => hasType(a, 'buff-steal'),
    },
    {
        id: 'pre-combat-stat',
        severity: 'high',
        // PR F4: permanent pre-fight base-stat passives. Hits exactly the corpus shapes —
        // start-of-combat attack-per-adjacent-ally (Centurion), start-of-combat %-of-HP
        // grant to adjacent allies (Lionheart), and role-gated "adjacent to a <role> …
        // gains" self grants in either ordering (Enforcer trailing gate, Defiant/Stalwart
        // leading gate). Madax's "receives 30% more Repairs" carries no "gains" list and
        // is deliberately out of scope.
        keyword: (t) =>
            /at the start of combat,?\s*this unit gains \d[\d,]*\s*attack per adjacent ally/i.test(
                t
            ) ||
            /at the start of combat,?\s*this unit grants all adjacent allies \d+(?:\.\d+)?%\s*of its (?:max\s*)?hp/i.test(
                t
            ) ||
            /this unit gains [^.;]+?\s(?:if|when|while)\s+adjacent to an?\s+(?:supporter|defender|attacker|debuffer)\b/i.test(
                t
            ) ||
            /when (?:this unit is )?adjacent to an?\s+(?:supporter|defender|attacker|debuffer),\s*this unit gains \d/i.test(
                t
            ),
        handled: (a) => hasType(a, 'pre-combat-stat'),
    },
    {
        id: 'shield-basis-secondary-damage',
        severity: 'high',
        // PR9(a): "additional damage equal to X% of its/their/this Unit's current Shield"
        // (Malvex, Quixilver, FrontLine). Excludes Xcellence's differently-shaped reactive proc
        // ("when an enemy resists a debuff infliction, this Unit deals damage equal to X% of
        // this Unit's current shield") — the same "resists...debuff" exclusion parseSecondaryDamage
        // itself applies, since that clause is an intentionally deferred Phase-4 reactive proc,
        // not this on-cast mechanic (see parseSecondaryDamage's doc comment).
        keyword: (t) =>
            /additional\s+damage\s+equal\s+to\s+\d+(?:\.\d+)?%\s+of\s+(?:its|their|this\s+unit'?s)\s+current\s+shield/i.test(
                t
            ) && !/\bresists?\b[^.]*\bdebuff/i.test(t),
        handled: (a) =>
            a.some(
                (x) =>
                    x.config.type === 'additional-damage' &&
                    (x.config as { stat?: string }).stat === 'shield'
            ),
    },
    {
        id: 'shield-strip-standalone',
        severity: 'high',
        // PR9(b): "removes X% of the enemy['s] Shield" as a STANDALONE on-cast strip (APEX,
        // Laika, Malvex) — NOT coupled to a purge landing. Excludes Lodolite's I6 legendary-refit
        // clause ("when this Unit Purges a buff from an enemy, it removes 100% of the enemy's
        // shield"), modeled separately via the `stripsShield` flag on the purge ability
        // (detectPurgeStripsShield) — every corpus row carrying BOTH "purge" and "removes N% …
        // shield" is that one clause (see detectPurgeStripsShield's doc comment), so excluding
        // any row that mentions "purge" anywhere is safe for the current corpus.
        keyword: (t) =>
            /removes\s+\d+(?:\.\d+)?%\s+of\s+the\s+enemy(?:['’]s)?\s+shield/i.test(t) &&
            !/purge/i.test(t),
        handled: (a) => hasType(a, 'shield-strip'),
    },
];

// Trigger phrasing that should produce a gating condition on a granted buff/debuff.
const TRIGGER_RE =
    /\b(when|whenever|if|while|after|upon)\b|\bafflicted\b|\bdebuffed\b|\bnon-?\s*(defender|attacker|debuffer|supporter)|to enemies with|targeting|against\b/i;

// Reactive / roster / recurring triggers we deliberately don't model (the user sets these
// manually). When a clause is gated ONLY by one of these, an ungated buff is expected — skip it
// so the report highlights gaps we could actually close.
//
// Damage-reaction nuance (Phase 4c): SELF-subject "when directly damaged" / "when critically
// hit" clauses (PR 1 — Warden, Isha, Makoli, Guardian, Heliodor, Shepherd, Opal, Flamel,
// Iridium, Panguan, Stalwart; plus Heliodor passive2 — self-subject "When directly damaged"
// with all-allies RECIPIENTS, Task 8) AND ALLY-subject "when an(other) ally … is directly
// damaged / is critically hit" clauses (PR 2 — Cultivator, Refine, Graphite, Guardian's
// counter-Provoke) are parser-modeled (on-attacked / on-ally-attacked triggers), so their
// effects never reach `ungatedEffects` (the trigger IS the gate), and any such clause that
// DOES parse ungated is flagged by the detectDamageReactionTrigger parity guard in
// `ungatedFinding` before this regex is consulted. The damage-reaction shapes below are ONLY
// the ones the parser still leaves unmodeled, kept narrow so a future CSV variant the
// detector misses surfaces as a finding instead of being swallowed:
//   - "If … directly damaged" non-"when" variants (Panon's Barrier, Wusheng's stealth-loss
//     rider)
//   - Sansi's bare "When hit"
//   - Lev's "If a critical hit occurs"
//   - ally-OUTGOING "when an(other) ally inflicts …" where the ally DEALS the hit (Provider's
//     inflicts-a-debuff counter, Oleander, Belladonna — Oleander's RoT grant would flag if
//     this alternation were removed; Crocus's crit-DoT reaction is modeled as on-ally-crit-dot)
//
// HP-threshold nuance (Phase 4c PR 3): the reactive "when HP drops/falls below N%" CROSSING
// grants (Tycho/Shelter/Los/Kafa/Redeemer) AND Hermes's "If the target has less than N% HP"
// Cheat-Death gate are parser-modeled (on-hp-threshold-crossed trigger / derivable target-HP
// condition), so their effects never reach `ungatedEffects` and any that DOES parse ungated is
// flagged by the detectHpCrossingTrigger / detectTargetHpGate parity guards in `ungatedFinding`
// before this regex is consulted. The STATIC "while its HP is below N%" gates below stay
// unmodeled — they carry no (drops|falls) verb, so HP_CROSSING_RE skips them (Los's standing
// direct-damage modifier, Tormenter's extra-action gate) — and remain in the skip set, kept
// narrow (no drops/falls alternation) so a crossing variant the detector misses surfaces as a
// finding instead of being swallowed.
const INTENTIONAL_REACTIVE_RE =
    /\bif\b[^.;]*\bdirectly damaged\b|when hit\b|critical hit occurs|when an(?:other)? ally inflicts|upon killing|on kill|killing an (enemy|opponent)|dies\b|destroyed|below \d+% ?hp|hp is below|lowest (speed|hp|health)|repaired this round|is (directly )?repaired|shield|receiv\w+|on the same team|every turn|at the start of the round|once per round|gets debuffed|cleansing/i;

/** The sentence/clause of `plain` mentioning `name` (split on . ; and br-derived spaces). */
function clauseFor(plain: string, name: string): string {
    // Mask the period in the "Inc."/"Out." buff-name abbreviations so it isn't read as a
    // sentence boundary (which would split e.g. "Inc. DoT Damage Up III" and fall back to
    // the whole text — leaking an unrelated sentence's trigger). Mirrors detectGrantConditions.
    const ABBR_MARK = '\u0001';
    const maskAbbrev = (s: string) => s.replace(/\b(Inc|Out)\.\s/g, `$1.${ABBR_MARK}`);
    const masked = maskAbbrev(plain);
    const maskedName = maskAbbrev(name).toLowerCase();
    const sentences = masked.split(/(?<=[.;])\s+/);
    const clause = sentences.find((s) => s.toLowerCase().includes(maskedName)) ?? masked;
    return clause.split(ABBR_MARK).join(' ');
}

/**
 * Clause-scoped: a produced buff/debuff with NO conditions whose own sentence carries trigger
 * phrasing — a likely missing condition (caught Sha Xing/Yuyan/Pallas/Lodolite). Slot-wide
 * trigger words that gate a different effect don't count. Exported for unit tests.
 */
export function ungatedFinding(abilities: Ability[], plain: string): string | null {
    for (const a of ungatedEffects(abilities)) {
        const name =
            a.config.type === 'buff' || a.config.type === 'debuff' ? a.config.buffName : '';
        if (!name) continue;
        const clause = clauseFor(plain, name);
        // Parity guard (Phase 4c): self-subject (PR 1, on-attacked) AND ally-subject
        // (PR 2, on-ally-attacked) damage reactions are parser-modeled, so an effect that
        // parsed UNGATED on-cast from a clause the parser's own detector classifies is a
        // regression — flag it BEFORE the reactive skip below can hide it.
        // detectDamageReactionTrigger does its own sentence-scoping with Inc./Out.
        // abbreviation masking (same discipline as clauseFor), anchored at the buff name's
        // position in the full text.
        // Note: indexOf anchors at the FIRST occurrence of the buff name; if the same
        // name appears in multiple clauses the anchor may scope the wrong sentence.
        // Acceptable — duplicate buff names within one skill text are rare in the corpus.
        const namePos = plain.toLowerCase().indexOf(name.toLowerCase());
        if (detectDamageReactionTrigger(plain, namePos)) return clause.trim().slice(0, 160);
        // Parity guard (Phase 4c PR 3): "when HP drops/falls below N%" crossing reactives
        // (Tycho/Shelter/Los/Kafa/Redeemer) ride the LIVE on-hp-threshold-crossed trigger, and
        // Hermes's "If the target has less than N% HP" Cheat-Death grant carries a derivable
        // target-HP gate — both are parser-modeled (the trigger/gate IS the gate), so an effect
        // that parsed UNGATED on-cast from a clause either detector classifies is a regression —
        // flag it BEFORE the reactive skip below can hide it. Both detectors do their own
        // sentence-scoping with Inc./Out. abbreviation masking (same discipline as clauseFor),
        // anchored at the buff name's position in the full text (same first-occurrence indexOf
        // caveat noted above).
        if (detectHpCrossingTrigger(plain, namePos)) return clause.trim().slice(0, 160);
        if (detectTargetHpGate(plain, namePos)) return clause.trim().slice(0, 160);
        if (INTENTIONAL_REACTIVE_RE.test(clause)) continue;
        if (TRIGGER_RE.test(clause)) return clause.trim().slice(0, 160);
    }
    return null;
}

// ─── Run ─────────────────────────────────────────────────────────────────────
function stripTags(text: string): string {
    return text.replace(/<\/?unit-(?:aid|skill|damage)>/gi, '').replace(/<br\s*\/?>/gi, ' ');
}

export interface Finding {
    ship: string;
    slot: string;
    rule: string;
    severity: 'high' | 'medium';
    clause: string;
}

// Records every (ship, ruleId) pair for which a finding WOULD have been reported absent the
// allowlist (i.e. the keyword matched, the parser did NOT handle it, so isAllowed was consulted).
// Lets `unusedAllowlistEntries` flag allowlist rows that no longer suppress anything (stale) —
// e.g. after the reference CSV is refreshed and a source typo the entry existed for is fixed.
// Cleared at the start of every `collectFindings` pass so repeated calls don't accumulate.
const consultedAllowKeys = new Set<string>();
// Ship names actually audited in the last pass. Guards `unusedAllowlistPairs` against
// false-flagging entries for ships the CSV reader DROPPED (multi-line records — see readShips):
// a dropped ship produces no finding only because it wasn't audited, not because the entry is
// stale, so removing its allowlist row would break the audit once the reader is fixed.
const auditedShipNames = new Set<string>();
const allowKey = (ship: string, ruleId: string): string => `${ship}::${ruleId}`;

function isAllowed(ship: string, ruleId: string): boolean {
    consultedAllowKeys.add(allowKey(ship, ruleId));
    return ALLOWLIST.some((a) => a.ship === ship && a.rules.includes(ruleId));
}

/** Allowlist (ship, ruleId) pairs that are stale: the ship WAS audited but the rule no longer
 *  produces a raw finding, so the entry suppresses nothing and can be removed. Entries for ships
 *  the reader dropped are excluded (unknowable, not stale). Call AFTER `collectFindings`. */
export function unusedAllowlistPairs(): { ship: string; rule: string; reason: string }[] {
    const out: { ship: string; rule: string; reason: string }[] = [];
    for (const entry of ALLOWLIST) {
        if (!auditedShipNames.has(entry.ship)) continue; // dropped ship → can't judge
        for (const rule of entry.rules) {
            if (!consultedAllowKeys.has(allowKey(entry.ship, rule))) {
                out.push({ ship: entry.ship, rule, reason: entry.reason });
            }
        }
    }
    return out;
}

/** True when the (gitignored) reference CSV is present — false in CI/clean checkouts. */
export function csvAvailable(): boolean {
    return existsSync(CSV_PATH);
}

/** Pure pass: every coverage finding across all ships (no I/O side effects beyond reading the CSV). */
export function collectFindings(): { findings: Finding[]; shipCount: number } {
    consultedAllowKeys.clear();
    auditedShipNames.clear();
    const ships = readShips();
    for (const s of ships) auditedShipNames.add(s.name);
    const findings: Finding[] = [];

    for (const ship of ships) {
        for (const { slot, text } of ship.slots) {
            const plain = stripTags(text);
            const abilities = abilitiesFor(text);
            for (const rule of RULES) {
                if (!rule.keyword(plain)) continue;
                if (rule.handled(abilities, plain)) continue;
                if (isAllowed(ship.name, rule.id)) continue;
                findings.push({
                    ship: ship.name,
                    slot,
                    rule: rule.id,
                    severity: rule.severity,
                    clause: plain.trim().slice(0, 160),
                });
            }

            const ungated = ungatedFinding(abilities, plain);
            if (ungated && !isAllowed(ship.name, 'ungated-effect-with-trigger')) {
                findings.push({
                    ship: ship.name,
                    slot,
                    rule: 'ungated-effect-with-trigger',
                    severity: 'medium',
                    clause: ungated,
                });
            }
        }
    }
    return { findings, shipCount: ships.length };
}

export interface AllyScopeEntry {
    ship: string;
    slot: string;
    buffName: string;
    target: 'ally' | 'all-allies';
}

/**
 * Mirrors the parser ally-scope classification (team walk): every buff ability whose target
 * the builder stamped as 'ally' or 'all-allies'. Routes through the SAME buildShipAbilities
 * the engine uses, so this list is the authoritative view of which ships grant team-wide buffs.
 */
export function collectAllyScopes(): AllyScopeEntry[] {
    const ships = readShips();
    const entries: AllyScopeEntry[] = [];
    for (const ship of ships) {
        // Parse each slot's text in ISOLATION (the `abilitiesFor` pattern — treats the text as the
        // active slot) rather than building one Ship with refits:[] and a single buildShipAbilities
        // call. Passive extraction is refit-state-driven, so the combined build skips passive
        // columns whose refit isn't the active one — missing the ally grants those passives carry.
        // The combat team-walk resolves the in-game active passive via getShipSkillRows(); for the
        // audit we want the full picture of every slot's text, so each is parsed standalone and
        // labeled with its CSV slot name.
        for (const { slot, text } of ship.slots) {
            for (const a of abilitiesFor(text)) {
                if (a.config.type !== 'buff') continue;
                if (a.target === 'ally' || a.target === 'all-allies') {
                    entries.push({
                        ship: ship.name,
                        slot,
                        buffName: a.config.buffName,
                        target: a.target,
                    });
                }
            }
        }
    }
    return entries;
}

function run() {
    const { findings, shipCount } = collectFindings();
    const allyScopes = collectAllyScopes();

    // ─── Report ───────────────────────────────────────────────────────────────
    const byRule = new Map<string, Finding[]>();
    for (const f of findings) {
        const list = byRule.get(f.rule) ?? [];
        list.push(f);
        byRule.set(f.rule, list);
    }
    const ruleOrder = [...RULES.map((r) => r.id), 'ungated-effect-with-trigger'];
    const sortedRules = [...byRule.keys()].sort(
        (a, b) => ruleOrder.indexOf(a) - ruleOrder.indexOf(b)
    );

    let md = `# Skill parser coverage audit\n\n`;
    md += `${shipCount} ships audited · ${findings.length} findings across ${byRule.size} rules.\n\n`;
    md += `> Coverage gaps only (text shows a mechanic the parse didn't act on). Not a correctness check.\n`;
    md += `> Add intentionally-unmodelled cases to \`scripts/auditSkills.allowlist.ts\`.\n\n`;

    for (const ruleId of sortedRules) {
        const list = byRule.get(ruleId)!;
        md += `## ${ruleId} — ${list.length} (${list[0].severity})\n\n`;
        for (const f of list) {
            md += `- **${f.ship}** · ${f.slot}: ${f.clause}\n`;
        }
        md += `\n`;
    }

    // Ally-scope (team walk): buff abilities the builder routed to a single ally or all allies.
    const allAllies = allyScopes.filter((e) => e.target === 'all-allies');
    const singleAlly = allyScopes.filter((e) => e.target === 'ally');
    md += `## ally-scoped grants (team walk) — ${allyScopes.length}\n\n`;
    md += `> Parser-classified player-side targets. all-allies = every player actor; ally = one chosen ally.\n\n`;
    md += `### all-allies — ${allAllies.length}\n\n`;
    for (const e of allAllies) {
        md += `- **${e.ship}** · ${e.slot}: ${e.buffName}\n`;
    }
    md += `\n### ally (single) — ${singleAlly.length}\n\n`;
    for (const e of singleAlly) {
        md += `- **${e.ship}** · ${e.slot}: ${e.buffName}\n`;
    }
    md += `\n`;

    writeFileSync(OUT_PATH, md);

    console.log(`Audited ${shipCount} ships → ${findings.length} findings.`);
    console.log(
        `  ally-scoped grants: ${allAllies.length} all-allies, ${singleAlly.length} single-ally`
    );
    for (const ruleId of sortedRules) {
        console.log(`  ${ruleId.padEnd(28)} ${byRule.get(ruleId)!.length}`);
    }

    // Hygiene: allowlist rows that no longer suppress anything (stale — safe to delete). Keeps
    // the allowlist honest after the reference CSV is refreshed and a source issue is fixed.
    const unused = unusedAllowlistPairs();
    if (unused.length) {
        console.log(`\n⚠ ${unused.length} STALE allowlist entr${unused.length === 1 ? 'y' : 'ies'} (no longer produce a finding — remove from auditSkills.allowlist.ts):`);
        for (const u of unused) console.log(`  - ${u.ship} · ${u.rule}`);
    }

    console.log(`\nFull report: docs/skill-audit.md`);
}

// Run the CLI only when invoked directly (npm run audit:skills), not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    run();
}
