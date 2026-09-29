import type { CombatLogEntry, CombatLogRound, CombatLogTarget } from './types';

/** The roster fields the formatter reads. `BattleResult['roster']` satisfies it. */
export interface LogRosterEntry {
    actorId: string;
    side: 'player' | 'enemy';
    name: string;
    position: string;
}

/**
 * The combat log as plain text: one line per entry, reactions indented two spaces under the
 * latest action of the turn they fired in — nesting is positional, not a causal link, so a
 * reaction is not necessarily a reply to the entry it nests under. Ships print as
 * `P.<name>@<position>` / `E.<name>@<position>` so two ships of one name stay distinct; an id
 * missing from `roster` prints raw. Numbers are rounded. An empty log is an empty string;
 * otherwise the text ends with a newline.
 */
export function formatCombatLogText(
    combatLog: readonly CombatLogRound[],
    roster: readonly LogRosterEntry[]
): string {
    const labels = new Map(
        roster.map((r) => [r.actorId, `${r.side === 'player' ? 'P' : 'E'}.${r.name}@${r.position}`])
    );
    const label = (id: string) => labels.get(id) ?? id;

    const target = (t: CombatLogTarget): string => {
        let text = label(t.targetId);
        if (t.amount !== undefined) text += ` ${Math.round(t.amount)}`;
        if (t.didCrit) text += ' crit';
        if (t.didHit === false) text += ' miss';
        if (t.overheal) text += ` overheal ${Math.round(t.overheal)}`;
        if (t.overshield) text += ` overshield ${Math.round(t.overshield)}`;
        if (t.shieldWasHit) text += ' shield hit';
        if (t.resultingHpPct !== undefined) text += ` [${Math.round(t.resultingHpPct)}%]`;
        return text;
    };

    const lines: string[] = [];
    const entry = (e: CombatLogEntry, depth: number, prefix = ''): void => {
        const indent = `${'  '.repeat(depth)}${prefix}`;
        let text: string;
        // A death entry carries the VICTIM as actorId and the KILLER(S) as targets — the generic
        // ` -> target` reads backwards here, so it gets its own "killed by" phrasing instead.
        if (e.kind === 'death') {
            text = `${indent}death ${label(e.actorId)}`;
            if (e.targets.length > 0) {
                text += ` killed by ${e.targets.map((t) => label(t.targetId)).join(', ')}`;
            }
        } else {
            text = `${indent}${e.kind} ${label(e.actorId)}`;
            if (e.skillName) text += ` "${e.skillName}"`;
            if (e.slot) text += ` (${e.slot})`;
            if (e.note) text += ` {${e.note}}`;
            if (e.healerId) text += ` healer ${label(e.healerId)}`;
            if (e.targets.length > 0) text += ` -> ${e.targets.map(target).join(', ')}`;
        }
        lines.push(text);
        for (const reaction of e.reactions) entry(reaction, depth + 1);
    };

    for (const round of combatLog) {
        lines.push(`=== ROUND ${round.round}`);
        for (const e of round.startOfRound) entry(e, 1, '[start] ');
        for (const turn of round.turns) {
            let header = `-- TURN ${label(turn.actorId)}`;
            if (turn.chargeMax !== 0) header += ` charge ${turn.chargeBefore}/${turn.chargeMax}`;
            const s = turn.statsSnapshot;
            if (s) {
                header += ` hp ${Math.round(s.currentHp)}/${Math.round(s.maxHp)}`;
                if (s.shieldPool > 0) header += ` shield ${Math.round(s.shieldPool)}`;
            }
            lines.push(header);
            for (const e of turn.entries) entry(e, 1);
        }
        for (const e of round.endOfRound) entry(e, 1, '[end] ');
    }
    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}
