import React, { useState } from 'react';
import { BattleResult } from '../../utils/calculators/battleSimulator';
import { fmt } from '../../utils/simulator/boardOverlays';
import { CollapsibleAccordion } from '../ui/CollapsibleAccordion';
import type {
    CombatLogRound,
    CombatLogTurn,
    CombatLogEntry,
    CombatLogTarget,
    CombatLogEntryKind,
    StatsSnapshot,
} from '../../utils/combat/log/types';

interface RoundEventLogProps {
    /** The hierarchical combat-log round to render (from `BattleResult.combatLog`). */
    round: CombatLogRound | undefined;
    /** Roster (maps actorIds to display names + side). */
    roster: BattleResult['roster'];
}

/** Render context handed to every per-kind formatter. */
interface FormatterCtx {
    /** Resolve an actorId to its team-labeled display name (enemy → "Enemy X"). */
    nameOf: (actorId: string | undefined) => string;
}

/** Tailwind color class per kind (mirrors the old log palette; new kinds map to nearest hue). */
const colorForKind = (kind: CombatLogEntryKind): string => {
    switch (kind) {
        case 'attack':
        case 'detonation':
        case 'bomb':
        case 'dot-ticked':
            return 'text-red-400';
        case 'heal':
            return 'text-green-400';
        case 'buff':
        case 'shield':
            return 'text-cyan-400';
        case 'debuff':
        case 'control':
            return 'text-amber-400';
        case 'dot-applied':
            return 'text-purple-400';
        case 'death':
            return 'text-theme-text-secondary';
        case 'cleanse':
        case 'purge':
        case 'charge-changed':
        default:
            return 'text-theme-text-secondary';
    }
};

/** One target's outcome rendered inline: "{amount} (crit) → {hp}%" or "miss". */
const targetOutcome = (t: CombatLogTarget): string => {
    if (t.didHit === false) return 'miss';
    const parts: string[] = [];
    if (t.amount !== undefined) parts.push(fmt(t.amount));
    if (t.didCrit) parts.push('(crit)');
    let line = parts.join(' ');
    if (t.resultingHpPct !== undefined) {
        line = line
            ? `${line} → ${Math.round(t.resultingHpPct)}%`
            : `${Math.round(t.resultingHpPct)}%`;
    }
    return line;
};

/**
 * Renders an attack/heal entry's targets: a single target inline on the header line, or
 * multiple targets each on their own indented line (AoE per-victim breakdown — finding #3).
 */
const renderTargets = (
    entry: CombatLogEntry,
    ctx: FormatterCtx,
    header: React.ReactNode
): React.ReactNode => {
    if (entry.targets.length === 1) {
        const t = entry.targets[0];
        return (
            <span>
                {header} → {ctx.nameOf(t.targetId)}: {targetOutcome(t)}
            </span>
        );
    }
    if (entry.targets.length === 0) return <span>{header}</span>;
    return (
        <div>
            <div>{header}</div>
            <ul className="ml-4 space-y-0.5">
                {entry.targets.map((t, i) => (
                    <li key={i}>
                        {ctx.nameOf(t.targetId)}: {targetOutcome(t)}
                    </li>
                ))}
            </ul>
        </div>
    );
};

/** A single-line entry built from actor + the entry's pre-formatted note. */
const noteLine = (entry: CombatLogEntry, ctx: FormatterCtx): React.ReactNode => {
    const actor = ctx.nameOf(entry.actorId);
    return entry.note ? `${actor}: ${entry.note}` : actor;
};

/**
 * Per-kind formatter map. Every kind resolves to a renderable node; unmapped/future kinds
 * fall through to the neutral `noteLine` fallback (never throws — forward-compatible).
 */
const formatters: Record<
    CombatLogEntryKind,
    (entry: CombatLogEntry, ctx: FormatterCtx) => React.ReactNode
> = {
    attack: (entry, ctx) => {
        const bits = [ctx.nameOf(entry.actorId)];
        if (entry.skillName) bits.push(entry.skillName);
        if (entry.slot) bits.push(`[${entry.slot}]`);
        return renderTargets(entry, ctx, bits.join(' '));
    },
    heal: (entry, ctx) => renderTargets(entry, ctx, `${ctx.nameOf(entry.actorId)} heals`),
    shield: (entry, ctx) => renderTargets(entry, ctx, `${ctx.nameOf(entry.actorId)} shields`),
    buff: noteLine,
    debuff: noteLine,
    'dot-applied': noteLine,
    'dot-ticked': (entry, ctx) => {
        const t = entry.targets[0];
        const who = ctx.nameOf(entry.actorId);
        // DoT tick: "{victim}: {dotType} ×{stacks} → {amount}" — note carries "{dotType}
        // ×{stacks}" (mirrors dot-applied's format); amount lives on targets[0].amount.
        // Fall back gracefully if either is missing (forward-compatible with older events).
        if (entry.note && t?.amount !== undefined)
            return `${who}: ${entry.note} → ${fmt(t.amount)}`;
        if (entry.note) return `${who}: ${entry.note}`;
        if (t?.amount !== undefined) return `${who}: ${fmt(t.amount)}`;
        return who;
    },
    control: noteLine,
    cleanse: noteLine,
    purge: noteLine,
    'charge-changed': noteLine,
    death: noteLine,
    detonation: (entry, ctx) => {
        const amount = entry.targets[0]?.amount;
        const head = noteLine(entry, ctx) as string;
        return amount !== undefined ? `${head}: ${fmt(amount)}` : head;
    },
    bomb: (entry, ctx) => {
        const amount = entry.targets[0]?.amount;
        const head = noteLine(entry, ctx) as string;
        return amount !== undefined ? `${head}: ${fmt(amount)}` : head;
    },
};

/** Format any entry's body via its kind formatter, falling back to the neutral note line. */
const formatEntry = (entry: CombatLogEntry, ctx: FormatterCtx): React.ReactNode => {
    const fn = formatters[entry.kind] ?? noteLine;
    return fn(entry, ctx);
};

/** An entry plus its nested reactions (reactions indented one level deeper than the entry). */
const EntryView: React.FC<{ entry: CombatLogEntry; ctx: FormatterCtx }> = ({ entry, ctx }) => (
    <li className={colorForKind(entry.kind)}>
        {formatEntry(entry, ctx)}
        {entry.reactions.length > 0 && (
            // buildCombatLog guarantees reactions are at most ONE level deep (a reaction is marked
            // reactive and can never be picked as the trigger for nesting another reaction), so we
            // intentionally render entry.reactions as flat `↳` lines rather than recursing.
            <ul className="ml-6 space-y-0.5">
                {entry.reactions.map((reaction, i) => (
                    <li key={i} className={colorForKind(reaction.kind)}>
                        {/* `formatEntry` already prefixes the reacting actor's name, so the
                            `↳ reacts:` marker omits it to avoid duplicating the name. */}
                        <span className="text-theme-text-secondary">↳ reacts: </span>
                        {formatEntry(reaction, ctx)}
                    </li>
                ))}
            </ul>
        )}
    </li>
);

/**
 * Task 6d: a collapsible summary of the acting ship's live modelled stats for this turn.
 * Collapsed by default — the header line (a sanctioned raw `<button>`, per the full-width
 * accordion-header toggle exception) shows the compact HP line; expanding it reveals the
 * remaining stats inside `CollapsibleAccordion` (a controlled, stateless container — this
 * component owns the open/closed state itself).
 */
const TurnStatsSummary: React.FC<{ snapshot: StatsSnapshot }> = ({ snapshot }) => {
    const [open, setOpen] = useState(false);
    const shieldSuffix = snapshot.shieldPool > 0 ? ` (+${fmt(snapshot.shieldPool)} shield)` : '';
    return (
        <div className="ml-2 mt-1">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="text-xs text-theme-text-secondary hover:text-theme-text transition-colors"
            >
                Stats · HP {fmt(snapshot.currentHp)}/{fmt(snapshot.maxHp)}
                {shieldSuffix}
            </button>
            <CollapsibleAccordion isOpen={open}>
                <ul className="grid grid-cols-2 gap-x-4 text-xs text-theme-text-secondary">
                    <li>Attack: {fmt(snapshot.attack)}</li>
                    <li>Defence: {fmt(snapshot.defence)}</li>
                    <li>Crit: {Math.round(snapshot.crit)}%</li>
                    <li>Crit Power: {Math.round(snapshot.critDamage)}%</li>
                    <li>Def Pen: {fmt(snapshot.defensePenetration)}</li>
                    <li>Speed: {Math.round(snapshot.speed)}</li>
                    <li>Hacking: {fmt(snapshot.hacking)}</li>
                    <li>Security: {fmt(snapshot.security)}</li>
                </ul>
            </CollapsibleAccordion>
        </div>
    );
};

/** A single turn: a charge-aware header followed by its chronological entries. */
const TurnView: React.FC<{ turn: CombatLogTurn; ctx: FormatterCtx }> = ({ turn, ctx }) => {
    const header =
        turn.chargeMax > 0
            ? `${ctx.nameOf(turn.actorId)}'s turn · charge ${turn.chargeBefore}/${turn.chargeMax}`
            : `${ctx.nameOf(turn.actorId)}'s turn`;
    return (
        <li>
            <div className="text-theme-text-secondary font-semibold border-t border-dark-border mt-1 pt-1">
                {header}
            </div>
            {turn.statsSnapshot && <TurnStatsSummary snapshot={turn.statsSnapshot} />}
            {turn.entries.length > 0 && (
                <ul className="ml-2 space-y-1">
                    {turn.entries.map((entry, i) => (
                        <EntryView key={i} entry={entry} ctx={ctx} />
                    ))}
                </ul>
            )}
        </li>
    );
};

/**
 * Renders a hierarchical {@link CombatLogRound} as a turn-by-turn play-by-play: each turn header
 * (with charge annotation) is followed by its entries; AoE attacks break out each victim on its
 * own indented line; reactions nest one level deeper; an optional `— end of round —` group holds
 * round-end-drained entries (e.g. DoT ticks). Actor ids resolve to roster names (enemy → "Enemy X").
 */
const RoundEventLog: React.FC<RoundEventLogProps> = ({ round, roster }) => {
    const nameOf = (actorId: string | undefined): string => {
        if (!actorId) return 'Unknown';
        const entry = roster.find((r) => r.actorId === actorId);
        if (!entry) return actorId;
        return entry.side === 'enemy' ? `Enemy ${entry.name}` : entry.name;
    };
    const ctx: FormatterCtx = { nameOf };

    const turns = round?.turns ?? [];
    const startOfRound = round?.startOfRound ?? [];
    const endOfRound = round?.endOfRound ?? [];
    const hasContent = startOfRound.length > 0 || turns.length > 0 || endOfRound.length > 0;

    return (
        <div className="card">
            <h3 className="text-lg font-semibold mb-2">Round {round?.round ?? '-'} events</h3>
            {!hasContent ? (
                <p className="text-sm text-theme-text-secondary">No events this round.</p>
            ) : (
                <ul className="max-h-[500px] overflow-y-auto space-y-1 text-sm">
                    {startOfRound.length > 0 && (
                        <li>
                            <div className="text-theme-text-secondary font-semibold border-b border-dark-border mb-1 pb-1">
                                — start of round —
                            </div>
                            <ul className="ml-2 space-y-1">
                                {startOfRound.map((entry, i) => (
                                    <EntryView key={i} entry={entry} ctx={ctx} />
                                ))}
                            </ul>
                        </li>
                    )}
                    {turns.map((turn, i) => (
                        <TurnView key={i} turn={turn} ctx={ctx} />
                    ))}
                    {endOfRound.length > 0 && (
                        <li>
                            <div className="text-theme-text-secondary font-semibold border-t border-dark-border mt-1 pt-1">
                                — end of round —
                            </div>
                            <ul className="ml-2 space-y-1">
                                {endOfRound.map((entry, i) => (
                                    <EntryView key={i} entry={entry} ctx={ctx} />
                                ))}
                            </ul>
                        </li>
                    )}
                </ul>
            )}
        </div>
    );
};

export default RoundEventLog;
