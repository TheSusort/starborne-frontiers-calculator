import React from 'react';
import { DataTable, Column } from '../ui/tables/DataTable';

export interface RecipientRow {
    id: string;
    effectiveHealing: number;
    overheal: number;
}

interface Props {
    recipients: RecipientRow[];
    healTargetId: string;
    nameFor: (id: string) => string;
    /** Shown as a subtitle when several healer configs are being compared, so the reader knows
     *  WHICH config's board these numbers came from. Configs are simulated separately. */
    configName?: string;
}

interface DisplayRow extends RecipientRow {
    isPrimary: boolean;
    isTotal: boolean;
}

const fmt = (n: number): string => n.toLocaleString('en-US');

const TOTAL_ROW_ID = '__total__';

/**
 * Per-ally healing breakdown. Since SP-3 a heal follows the caster's support PATTERN, so several
 * allies can be repaired by one cast; the configured heal target stays the PRIMARY row because
 * every existing chart and summary reads that actor's numbers.
 *
 * ⚠️ RECIPIENT AXIS ONLY, and that is the whole point of the table. `effectiveHealing`/`overheal`
 * are keyed by the ally a repair LANDED ON, whereas the healer's own summary (direct heal, HoT,
 * shield, cleanses) is keyed by the ship that CAST it. The two axes are not parts of one sum and
 * are deliberately never added together here:
 *
 *  - these rows do NOT sum back up to the healer's throughput — only LANDED repairs reach this
 *    axis, so `Σ rows ≤ the healer's own output` (an `all-allies` leech credits the caster's raw
 *    for every ally but mirrors only the ally it actually repaired);
 *  - a row can carry healing the focus healer never produced. An ally's own cast lands on the heal
 *    target and shows up here while the healer's throughput for that round is genuinely 0;
 *  - shields and cleanses have NO recipient-axis value (a shield pool is granted per target but
 *    credited to the source), so there is no per-ally column for them and none may be invented;
 *  - all-zero recipients are dropped upstream, so the row set is "allies a repair actually landed
 *    on", NOT "every ally the healer's pattern reaches" — the blurb below says so, because the
 *    difference is exactly what the page's placement warning is about.
 *
 * The `Team total` row is a same-axis sum (Σ over recipients of a recipient-axis number), which is
 * the one addition that IS meaningful.
 */
export const HealingRecipientBreakdown: React.FC<Props> = ({
    recipients,
    healTargetId,
    nameFor,
    configName,
}) => {
    if (recipients.length === 0) return null;

    // Heal target first, then the rest in descending effective healing.
    const ordered = [...recipients].sort((a, b) => {
        if (a.id === healTargetId) return -1;
        if (b.id === healTargetId) return 1;
        return b.effectiveHealing - a.effectiveHealing;
    });

    const rows: DisplayRow[] = [
        ...ordered.map((r) => ({ ...r, isPrimary: r.id === healTargetId, isTotal: false })),
        {
            id: TOTAL_ROW_ID,
            effectiveHealing: ordered.reduce((n, r) => n + r.effectiveHealing, 0),
            overheal: ordered.reduce((n, r) => n + r.overheal, 0),
            isPrimary: false,
            isTotal: true,
        },
    ];

    const columns: Column<DisplayRow>[] = [
        {
            key: 'ship',
            label: 'Ship',
            render: (row) => (row.isTotal ? 'Team total' : nameFor(row.id)),
        },
        {
            key: 'role',
            label: '',
            render: (row) =>
                row.isPrimary ? <span className="text-xs text-primary">Primary</span> : null,
        },
        {
            key: 'effective',
            label: 'Effective healing',
            align: 'right',
            render: (row) => fmt(row.effectiveHealing),
        },
        {
            key: 'overheal',
            label: 'Overheal',
            align: 'right',
            render: (row) => fmt(row.overheal),
        },
    ];

    return (
        <section className="card" aria-label="Healing by ally">
            <h3 className="text-lg font-bold mb-2">Healing by ally</h3>
            {configName && (
                <p className="text-sm text-theme-text-secondary mb-2">Config: {configName}</p>
            )}
            <p className="text-sm text-theme-text-secondary mb-4">
                A heal only reaches allies inside the caster&apos;s support pattern, so one cast can
                repair several ships. These figures are counted per receiving ship, and only ships a
                repair actually landed on are listed — an ally missing from this table received
                nothing. They are a different measure from the healer&apos;s own output above, which
                counts what the healer produced regardless of where it went, so the rows here do not
                add up to it. Shields and cleanses have no per-ally figure and stay on the
                healer&apos;s summary.
            </p>
            <DataTable
                data={rows}
                columns={columns}
                getRowKey={(row) => row.id}
                rowClassName={(row) => (row.isTotal ? 'font-semibold' : '')}
                className="!p-0 !border-0 !bg-transparent"
            />
        </section>
    );
};
