import React, { useMemo, useState } from 'react';
import { ShipTemplate } from '../../services/shipTemplateProposalService';
import { Button } from '../ui/Button';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { DataTable, Column } from '../ui/tables/DataTable';
import { Input } from '../ui/Input';
import { SkillTooltip } from '../ship/SkillTooltip';
import {
    findBuffDescription,
    parseSkillEffects,
    SkillSource,
    SkillEffect,
} from '../../utils/skillTextParser';

// ─── Types ───────────────────────────────────────────────────────────────────

type Severity = 'error' | 'warning' | 'info';
type FilterChip = 'all' | Severity;

interface AuditIssue {
    templateId: string;
    shipName: string;
    slot: string;
    severity: Severity;
    message: string;
}

interface SlotConfig {
    field: keyof Pick<
        ShipTemplate,
        | 'active_skill_text'
        | 'charge_skill_text'
        | 'first_passive_skill_text'
        | 'second_passive_skill_text'
        | 'third_passive_skill_text'
    >;
    label: string;
    source: SkillSource;
}

interface SkillAuditSectionProps {
    allTemplates: ShipTemplate[];
    onSelectTemplate: (template: ShipTemplate) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const KNOWN_GOOD_TAGS = new Set([
    'unit-skill',
    '/unit-skill',
    'unit-damage',
    '/unit-damage',
    'unit-aid',
    '/unit-aid',
    'br /',
    'br',
    'br/',
]);

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

const SLOT_CONFIGS: SlotConfig[] = [
    { field: 'active_skill_text', label: 'Active', source: 'active' },
    { field: 'charge_skill_text', label: 'Charge', source: 'charge' },
    { field: 'first_passive_skill_text', label: 'Passive R0', source: 'passive1' },
    { field: 'second_passive_skill_text', label: 'Passive R2', source: 'passive2' },
    { field: 'third_passive_skill_text', label: 'Passive R4', source: 'passive3' },
];

// ─── Validation Logic ─────────────────────────────────────────────────────────

function auditSlotText(
    templateId: string,
    shipName: string,
    slot: string,
    text: string
): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const push = (severity: Severity, message: string) =>
        issues.push({ templateId, shipName, slot, severity, message });

    // Step 1: Unknown tag check
    const tagRe = /<([^>]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(text)) !== null) {
        if (!KNOWN_GOOD_TAGS.has(m[1]) && !m[1].startsWith('/')) {
            push('error', `Unknown tag: <${m[1]}>`);
        }
    }

    // Step 2: Bad <br> format — matches <br> and <br/> but NOT <br />
    const badBrRe = /<br\/?>/g;
    while ((m = badBrRe.exec(text)) !== null) {
        push('warning', 'Bad <br> format: use <br /> instead');
    }

    // Step 3: Unclosed/mismatched tag check — strip ALL <br> variants first
    const stripped = text.replace(/<br\s*\/?>/g, '');
    const stack: string[] = [];
    const stackRe = /<\/?(unit-skill|unit-damage|unit-aid)>/g;
    while ((m = stackRe.exec(stripped)) !== null) {
        const tag = m[1];
        if (m[0].startsWith('</')) {
            if (stack.length > 0 && stack[stack.length - 1] === tag) {
                stack.pop();
            } else {
                push('error', `Mismatched closing tag: </${tag}>`);
            }
        } else {
            stack.push(tag);
        }
    }
    for (const unclosed of stack) {
        push('error', `Unclosed tag: <${unclosed}>`);
    }

    // Step 4: Empty tag content
    const emptyRe = /<(unit-skill|unit-damage|unit-aid)><\/\1>/g;
    while ((m = emptyRe.exec(text)) !== null) {
        push('warning', `Empty tag content: <${m[1]}></${m[1]}>`);
    }

    // Step 5: Buff not in BUFFS (non-empty <unit-skill> only)
    const buffRe = /<unit-skill>(.+?)<\/unit-skill>/g;
    while ((m = buffRe.exec(text)) !== null) {
        if (findBuffDescription(m[1]) === undefined) {
            push('warning', `Buff not in BUFFS: "${m[1]}"`);
        }
    }

    return issues;
}

function buildAuditIssues(templates: ShipTemplate[]): AuditIssue[] {
    const issues: AuditIssue[] = [];

    for (const template of templates) {
        const hasAnySkillText = SLOT_CONFIGS.some((s) => template[s.field]);

        if (!hasAnySkillText) {
            issues.push({
                templateId: template.id,
                shipName: template.name,
                slot: '—',
                severity: 'info',
                message: 'No skill texts defined',
            });
            continue;
        }

        for (const { field, label } of SLOT_CONFIGS) {
            const text = template[field];
            if (!text) continue;
            issues.push(...auditSlotText(template.id, template.name, label, text));
        }
    }

    issues.sort((a, b) => {
        const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        return sevDiff !== 0 ? sevDiff : a.shipName.localeCompare(b.shipName);
    });

    return issues;
}

// ─── Severity Badge ───────────────────────────────────────────────────────────

const SEVERITY_BADGE: Record<Severity, string> = {
    error: 'bg-red-900/40 text-red-300 border border-red-700',
    warning: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700',
    info: 'bg-gray-700/40 text-gray-300 border border-gray-600',
};

function SeverityBadge({ severity }: { severity: Severity }) {
    return (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_BADGE[severity]}`}>
            {severity}
        </span>
    );
}

// ─── Audit Table Columns ──────────────────────────────────────────────────────

function buildAuditColumns(
    onSelectTemplate: (template: ShipTemplate) => void,
    allTemplates: ShipTemplate[]
): Column<AuditIssue>[] {
    return [
        {
            key: 'shipName',
            label: 'Ship',
            render: (issue) => {
                const template = allTemplates.find((t) => t.id === issue.templateId);
                return template ? (
                    <button
                        type="button"
                        className="text-primary hover:underline text-left"
                        onClick={() => onSelectTemplate(template)}
                    >
                        {issue.shipName}
                    </button>
                ) : (
                    issue.shipName
                );
            },
        },
        { key: 'slot', label: 'Slot' },
        {
            key: 'severity',
            label: 'Severity',
            render: (issue) => <SeverityBadge severity={issue.severity} />,
        },
        { key: 'message', label: 'Issue' },
    ];
}

// ─── Effect Duration Display ──────────────────────────────────────────────────

function formatDuration(duration: SkillEffect['duration']): string {
    if (duration === null) return '—';
    if (duration === 'recurring') return 'recurring';
    return String(duration);
}

// ─── Sub-panel 1: Audit Report ────────────────────────────────────────────────

function AuditReportPanel({ allTemplates, onSelectTemplate }: SkillAuditSectionProps) {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState<FilterChip>('all');

    const allIssues = useMemo(() => buildAuditIssues(allTemplates), [allTemplates]);

    const errorCount = useMemo(
        () => allIssues.filter((i) => i.severity === 'error').length,
        [allIssues]
    );
    const warningCount = useMemo(
        () => allIssues.filter((i) => i.severity === 'warning').length,
        [allIssues]
    );
    const infoCount = useMemo(
        () => allIssues.filter((i) => i.severity === 'info').length,
        [allIssues]
    );

    const hasIssues = allIssues.length > 0;

    const filteredIssues = useMemo(() => {
        if (filter === 'all') return allIssues;
        return allIssues.filter((i) => i.severity === filter);
    }, [allIssues, filter]);

    const columns = useMemo(
        () => buildAuditColumns(onSelectTemplate, allTemplates),
        [onSelectTemplate, allTemplates]
    );

    const buttonLabel = open
        ? 'Hide Skill Audit'
        : hasIssues
          ? `Show Skill Audit (${errorCount} errors, ${warningCount} warnings, ${infoCount} info)`
          : 'Show Skill Audit';

    const chips: FilterChip[] = ['all', 'error', 'warning', 'info'];

    const emptyMessage = filter === 'all' ? 'No issues found' : `No ${filter} issues found`;

    return (
        <div>
            <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
                {buttonLabel}
            </Button>
            <CollapsibleForm isVisible={open}>
                <div className="mt-4 space-y-3">
                    {/* Summary */}
                    {hasIssues ? (
                        <p className="text-sm text-theme-text-secondary">
                            <span className="text-red-400 font-medium">{errorCount} errors</span>
                            {', '}
                            <span className="text-yellow-400 font-medium">
                                {warningCount} warnings
                            </span>
                            {', '}
                            <span className="text-gray-400 font-medium">{infoCount} info</span>
                        </p>
                    ) : (
                        <p className="text-sm text-green-400 font-medium">No issues found</p>
                    )}

                    {/* Filter chips */}
                    {hasIssues && (
                        <div className="flex gap-2">
                            {chips.map((chip) => (
                                <button
                                    key={chip}
                                    type="button"
                                    onClick={() => setFilter(chip)}
                                    className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                                        filter === chip
                                            ? 'bg-primary text-white border-primary'
                                            : 'bg-transparent text-theme-text-secondary border-dark-border hover:border-primary'
                                    }`}
                                >
                                    {chip === 'all'
                                        ? 'All'
                                        : chip.charAt(0).toUpperCase() + chip.slice(1) + 's'}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Table */}
                    {hasIssues && (
                        <DataTable
                            data={filteredIssues}
                            columns={columns}
                            getRowKey={(_, index) => String(index)}
                            emptyMessage={emptyMessage}
                        />
                    )}
                </div>
            </CollapsibleForm>
        </div>
    );
}

// ─── Sub-panel 2: Skill Parser Inspector ──────────────────────────────────────

function SkillParserInspectorPanel({ allTemplates }: Pick<SkillAuditSectionProps, 'allTemplates'>) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<ShipTemplate | null>(null);

    const searchResults = useMemo(() => {
        if (query.length < 2 || selected) return [];
        const q = query.toLowerCase();
        return allTemplates.filter((t) => t.name.toLowerCase().includes(q));
    }, [query, selected, allTemplates]);

    const handleSelect = (template: ShipTemplate) => {
        setSelected(template);
        setQuery(template.name);
    };

    const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
        if (selected && e.target.value !== selected.name) {
            setSelected(null);
        }
    };

    return (
        <div>
            <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
                {open ? 'Hide Skill Parser Inspector' : 'Show Skill Parser Inspector'}
            </Button>
            <CollapsibleForm isVisible={open}>
                <div className="mt-4 space-y-4">
                    {/* Search */}
                    <div className="relative">
                        <Input
                            value={query}
                            onChange={handleQueryChange}
                            placeholder="Search ships by name (min 2 characters)..."
                        />
                        {searchResults.length > 0 && (
                            <div className="absolute z-10 w-full mt-1 bg-dark border border-dark-border shadow-lg max-h-60 overflow-y-auto">
                                {searchResults.map((template) => (
                                    <button
                                        key={template.id}
                                        type="button"
                                        className="w-full text-left px-4 py-2 hover:bg-dark-lighter text-sm transition-colors"
                                        onClick={() => handleSelect(template)}
                                    >
                                        <span className="font-medium">{template.name}</span>
                                        <span className="text-theme-text-secondary ml-2">
                                            {template.faction} · {template.rarity}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Inspector output */}
                    {!selected ? (
                        <p className="text-theme-text-secondary text-sm">
                            Select a ship above to inspect its skill texts.
                        </p>
                    ) : (
                        <div className="space-y-4">
                            {SLOT_CONFIGS.map(({ field, label, source }) => {
                                const text = selected[field];
                                if (!text) return null;
                                const effects = parseSkillEffects(text, source);
                                return (
                                    <div key={field} className="card space-y-3">
                                        <h4 className="font-semibold text-theme-text">
                                            {label}{' '}
                                            <span className="text-theme-text-secondary font-normal text-sm">
                                                ({source})
                                            </span>
                                        </h4>
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                            {/* Left: rendered skill text */}
                                            <div>
                                                <p className="text-xs text-theme-text-secondary uppercase tracking-wide mb-2">
                                                    Rendered
                                                </p>
                                                <div className="bg-dark-lighter p-3 rounded text-sm">
                                                    <SkillTooltip
                                                        skillText={text}
                                                        skillType={label}
                                                        inline
                                                    />
                                                </div>
                                            </div>
                                            {/* Right: parsed effects */}
                                            <div>
                                                <p className="text-xs text-theme-text-secondary uppercase tracking-wide mb-2">
                                                    Parsed Effects
                                                </p>
                                                {effects.length === 0 ? (
                                                    <p className="text-sm text-theme-text-secondary italic">
                                                        No effects parsed
                                                    </p>
                                                ) : (
                                                    <div className="overflow-x-auto">
                                                        <table className="w-full text-sm">
                                                            <thead>
                                                                <tr className="border-b border-dark-border text-theme-text-secondary text-xs">
                                                                    <th className="pb-2 text-left">
                                                                        Buff Name
                                                                    </th>
                                                                    <th className="pb-2 text-left">
                                                                        Target
                                                                    </th>
                                                                    <th className="pb-2 text-left">
                                                                        Duration
                                                                    </th>
                                                                    <th className="pb-2 text-left">
                                                                        Stacks
                                                                    </th>
                                                                    <th className="pb-2 text-left">
                                                                        Trigger
                                                                    </th>
                                                                    <th className="pb-2 text-left">
                                                                        Source
                                                                    </th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {effects.map((effect, i) => (
                                                                    <tr
                                                                        key={i}
                                                                        className="border-b border-dark-border/50"
                                                                    >
                                                                        <td className="py-1.5 pr-3 font-medium text-primary">
                                                                            {effect.buffName}
                                                                        </td>
                                                                        <td className="py-1.5 pr-3">
                                                                            {effect.target}
                                                                        </td>
                                                                        <td className="py-1.5 pr-3">
                                                                            {formatDuration(
                                                                                effect.duration
                                                                            )}
                                                                        </td>
                                                                        <td className="py-1.5 pr-3">
                                                                            {effect.stacks ?? '—'}
                                                                        </td>
                                                                        <td className="py-1.5 pr-3">
                                                                            {effect.stackTrigger ??
                                                                                '—'}
                                                                        </td>
                                                                        <td className="py-1.5">
                                                                            {effect.source}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </CollapsibleForm>
        </div>
    );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export const SkillAuditSection: React.FC<SkillAuditSectionProps> = ({
    allTemplates,
    onSelectTemplate,
}) => {
    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-theme-text">Skill Audit</h3>
            <AuditReportPanel allTemplates={allTemplates} onSelectTemplate={onSelectTemplate} />
            <SkillParserInspectorPanel allTemplates={allTemplates} />
        </div>
    );
};
