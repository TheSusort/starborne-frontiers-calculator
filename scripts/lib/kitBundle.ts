import { getShipSkillRows } from '../../src/utils/ship/skillRows';
import { buildShipAbilities } from '../../src/utils/abilities/buildShipAbilities';
import { simulateBattle } from '../../src/utils/calculators/battleSimulator';
import type { Ability } from '../../src/types/abilities';
import type { CombatLogRound, CombatLogEntry, CombatLogEntryKind, CombatLogTarget } from '../../src/utils/combat/log/types';
import { buildStandardScenario, ScenarioOverrides } from './traceScenario';
import { buildTraceShip } from './traceShipFactory';

// The reviewed ship is always player[0], whose engine actor id is the reserved 'attacker'.
const FOCUS_ACTOR_ID = 'attacker';

// Maps a parsed ability's `type` to the combat-log entry `kind`s it would produce when it fires.
export const ABILITY_TYPE_TO_LOG_KINDS: Record<string, CombatLogEntryKind[]> = {
    damage: ['attack'],
    counter: ['attack'],
    'additional-damage': ['attack'],
    heal: ['heal'],
    shield: ['shield'],
    buff: ['buff'],
    debuff: ['debuff', 'debuff-resisted'],
    dot: ['dot-applied', 'dot-ticked'],
    control: ['control'],
    cleanse: ['cleanse'],
    purge: ['purge'],
    charge: ['charge-changed'],
    modifier: ['buff'],
};

export interface ClauseTrace {
    slot: string;
    type: string;
    target?: string;
    trigger?: string;
    summary: string;
    observed: boolean;
}
export interface KitBundle {
    name: string;
    refitLevel: number;
    skillRows: { label: string; text: string }[];
    abilities: ClauseTrace[];
    combatLog: CombatLogRound[];
    outcome: unknown;
}
export type KitBundleResult = KitBundle | { name: string; error: string };

const TARGETING_FALLBACK = { activeTarget: 'front', activePattern: 'Pattern-Base' };

// Collect the entry kinds of every log entry whose actor is `actorId`, recursing into nested
// reactions (counters / start-and-end-of-round procs land there). Entries key on actorId, never
// a ship name — so the reviewed ship is found by its reserved focus id, not by its display name.
export function collectActorEntryKinds(log: CombatLogRound[], actorId: string): Set<CombatLogEntryKind> {
    const kinds = new Set<CombatLogEntryKind>();
    const visit = (entries: CombatLogEntry[]): void => {
        for (const e of entries) {
            if (e.actorId === actorId) kinds.add(e.kind);
            if (e.reactions?.length) visit(e.reactions);
        }
    };
    for (const round of log) {
        visit(round.startOfRound ?? []);
        for (const turn of round.turns ?? []) visit(turn.entries ?? []);
        visit(round.endOfRound ?? []);
    }
    return kinds;
}

export function buildKitBundle(
    name: string,
    overrides: ScenarioOverrides & { refitLevel?: 0 | 2 | 4 } = {}
): KitBundleResult {
    const ship = buildTraceShip(name, { refitLevel: overrides.refitLevel });
    if (!ship)
        return { name, error: 'no ship-data snapshot entry and no CSV skill record for this name' };
    // Supply targeting fallbacks so the reviewed ship's active resolves a victim in the sim.
    if (!ship.activeTarget) ship.activeTarget = TARGETING_FALLBACK.activeTarget;
    if (!ship.activePattern) ship.activePattern = TARGETING_FALLBACK.activePattern;

    const skillRows = getShipSkillRows(ship).map((r) => ({ label: r.label, text: r.text }));
    const built = buildShipAbilities(ship);
    const allAbilities: { slot: string; ability: Ability }[] = built.slots.flatMap((s) =>
        s.abilities.map((ability) => ({ slot: s.slot, ability }))
    );

    let combatLog: CombatLogRound[] = [];
    let outcome: unknown = null;
    try {
        const result = simulateBattle(buildStandardScenario(ship, overrides));
        combatLog = result.combatLog;
        outcome = result.outcome;
    } catch (e) {
        return { name, error: `simulateBattle threw: ${(e as Error).message}` };
    }

    // Kinds the reviewed ship (focus actor) actually produced in this scenario.
    const focusKinds = collectActorEntryKinds(combatLog, FOCUS_ACTOR_ID);
    const abilities: ClauseTrace[] = allAbilities.map(({ slot, ability }) => {
        const expectedKinds = ABILITY_TYPE_TO_LOG_KINDS[ability.type] ?? [];
        return {
            slot,
            type: ability.type,
            target: (ability as { target?: string }).target,
            trigger: ability.trigger,
            summary: JSON.stringify(ability.config),
            observed: expectedKinds.some((k) => focusKinds.has(k)),
        };
    });

    return { name: ship.name, refitLevel: overrides.refitLevel ?? 4, skillRows, abilities, combatLog, outcome };
}

export function renderKitBundleMarkdown(bundle: KitBundleResult): string {
    if ('error' in bundle) return `# ${bundle.name}\n\n**HARNESS-ERROR:** ${bundle.error}\n`;
    const rows = bundle.skillRows.map((r) => `- **${r.label}:** ${r.text}`).join('\n');
    const abils = bundle.abilities
        .map((a) => `- [${a.observed ? 'x' : ' '}] \`${a.slot}\` **${a.type}** (target=${a.target ?? '-'}, trigger=${a.trigger ?? '-'}) — ${a.summary}`)
        .join('\n');
    return [
        `# ${bundle.name} (refit R${bundle.refitLevel})`,
        `\n## Skill text\n\n${rows}`,
        `\n## Parsed abilities\n\n_(checkbox = observed executing in the standardized scenario)_\n\n${abils}`,
        `\n## Execution trace\n\nOutcome: \`${JSON.stringify(bundle.outcome)}\`\n\n\`\`\`json\n${JSON.stringify(bundle.combatLog, null, 2)}\n\`\`\``,
    ].join('\n');
}

export function renderKitReviewMarkdown(bundle: KitBundleResult): string {
    if ('error' in bundle) return `# ${bundle.name}\n\n**HARNESS-ERROR:** ${bundle.error}\n`;

    const skill = bundle.skillRows.map((r) => `- **${r.label}:** ${r.text}`).join('\n');
    const abils = bundle.abilities
        .map((a) => `- [${a.observed ? 'x' : ' '}] \`${a.slot}\` **${a.type}** (target=${a.target ?? '-'}, trigger=${a.trigger ?? '-'}) — ${a.summary}`)
        .join('\n');

    const FOCUS = 'attacker';
    const transcript: string[] = [];
    const deaths: string[] = [];
    let focusHpLow = 100;

    const fmtTargets = (ts: CombatLogTarget[]): string =>
        ts
            .map(
                (t) =>
                    `${t.targetId}` +
                    (t.amount != null ? ` amt=${Math.round(t.amount)}` : '') +
                    (t.didCrit ? ' crit' : '') +
                    (t.didHit === false ? ' MISS' : '') +
                    (t.resultingHpPct != null ? ` hp%=${Math.round(t.resultingHpPct)}` : '')
            )
            .join(', ');

    const walk = (round: number, phase: string, e: CombatLogEntry, depth: number): void => {
        if (e.actorId === FOCUS) {
            transcript.push(
                `R${round} ${phase} ${'· '.repeat(depth)}${e.kind}` +
                    (e.slot ? `(${e.slot})` : '') +
                    (e.skillName ? ` "${e.skillName}"` : '') +
                    (e.targets.length ? ` -> ${fmtTargets(e.targets)}` : '') +
                    (e.note ? ` [${e.note}]` : '')
            );
        }
        for (const t of e.targets) {
            if (t.targetId === FOCUS && t.resultingHpPct != null) {
                focusHpLow = Math.min(focusHpLow, t.resultingHpPct);
            }
        }
        if (e.kind === 'death') {
            deaths.push(`${e.targets.map((t) => t.targetId).join(',') || e.actorId} @R${round}`);
        }
        for (const r of e.reactions ?? []) walk(round, phase, r, depth + 1);
    };

    for (const round of bundle.combatLog) {
        for (const e of round.startOfRound ?? []) walk(round.round, 'SoR', e, 0);
        for (const turn of round.turns ?? []) for (const e of turn.entries ?? []) walk(round.round, 'turn', e, 0);
        for (const e of round.endOfRound ?? []) walk(round.round, 'EoR', e, 0);
    }

    const focusKinds = [...collectActorEntryKinds(bundle.combatLog, FOCUS)].sort().join(', ') || '(none)';
    const summary = [
        `Focus-actor kinds observed: ${focusKinds}`,
        `Focus HP low-water mark: ${Math.round(focusHpLow)}%`,
        deaths.length ? `Deaths: ${deaths.join('; ')}` : 'Deaths: none',
    ].join('\n');

    return [
        `# ${bundle.name} (refit R${bundle.refitLevel}) — outcome: \`${JSON.stringify(bundle.outcome)}\``,
        `\n## Skill text\n\n${skill}`,
        `\n## Parsed abilities\n\n_(checkbox = the reviewed ship, as focus actor, produced a matching log entry in the standard scenario)_\n\n${abils}`,
        `\n## Execution summary\n\n${summary}`,
        `\n## Focus-actor transcript (actorId 'attacker' + its reactions)\n\n\`\`\`\n${transcript.join('\n') || '(no focus-actor entries)'}\n\`\`\``,
    ].join('\n');
}
