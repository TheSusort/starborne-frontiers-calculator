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

function readShips(): ShipRow[] {
    const lines = readFileSync(CSV_PATH, 'utf8').split('\n').filter(Boolean);
    const rows: ShipRow[] = [];
    for (let i = 1; i < lines.length; i++) {
        const f = parseCsvLine(lines[i]);
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
            // A reactive trigger (on-crit / start-of-round / bomb-detonated / …) IS the gate —
            // the parser routes these through the engine's trigger machinery instead of a
            // condition, so they aren't "ungated" (Enforcer, Wusheng, Valkyrie, Lingshe).
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
        keyword: (t) => /detonat/i.test(t),
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
        id: 'accumulate-detonate',
        severity: 'high',
        keyword: (t) => /echoing burst/i.test(t),
        handled: (a) => hasType(a, 'accumulate-detonate'),
    },
];

// Trigger phrasing that should produce a gating condition on a granted buff/debuff.
const TRIGGER_RE =
    /\b(when|whenever|if|while|after|upon)\b|\bafflicted\b|\bdebuffed\b|\bnon-?\s*(defender|attacker|debuffer|supporter)|to enemies with|targeting|against\b/i;

// Reactive / roster / recurring triggers we deliberately don't model (the user sets these
// manually). When a clause is gated ONLY by one of these, an ungated buff is expected — skip it
// so the report highlights gaps we could actually close.
const INTENTIONAL_REACTIVE_RE =
    /\b(directly )?(damaged|attacked|hit)\b|upon killing|on kill|killing an (enemy|opponent)|dies\b|destroyed|below \d+% ?hp|hp (drops|falls|is) below|lowest (speed|hp|health)|repaired this round|is (directly )?repaired|shield|receiv\w+|on the same team|every turn|at the start of the round|once per round|gets debuffed|cleansing|critically hit by/i;

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
 * trigger words that gate a different effect don't count.
 */
function ungatedFinding(abilities: Ability[], plain: string): string | null {
    for (const a of ungatedEffects(abilities)) {
        const name =
            a.config.type === 'buff' || a.config.type === 'debuff' ? a.config.buffName : '';
        if (!name) continue;
        const clause = clauseFor(plain, name);
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

function isAllowed(ship: string, ruleId: string): boolean {
    return ALLOWLIST.some((a) => a.ship === ship && a.rules.includes(ruleId));
}

/** True when the (gitignored) reference CSV is present — false in CI/clean checkouts. */
export function csvAvailable(): boolean {
    return existsSync(CSV_PATH);
}

/** Pure pass: every coverage finding across all ships (no I/O side effects beyond reading the CSV). */
export function collectFindings(): { findings: Finding[]; shipCount: number } {
    const ships = readShips();
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
    console.log(`\nFull report: docs/skill-audit.md`);
}

// Run the CLI only when invoked directly (npm run audit:skills), not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    run();
}
