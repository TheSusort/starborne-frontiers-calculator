import React from 'react';
import { Condition, ConditionSubject } from '../../types/abilities';
import { CONDITIONAL_CONDITION_LABELS, EnemyBaseClass } from '../../types/calculator';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { Button } from '../ui/Button';

interface Props {
    condition: Condition;
    onChange: (condition: Condition) => void;
    onRemove: () => void;
}

const SUBJECT_VALUES: ConditionSubject[] = [
    'always',
    'self-buff',
    'self-debuff',
    'enemy-buff',
    'enemy-debuff',
    'enemy-type',
    'self-crit',
    'adjacent-ally',
    'enemy-adjacent',
    'enemy-destroyed',
    'hp-threshold',
];

// Labels not covered by CONDITIONAL_CONDITION_LABELS.
const EXTRA_SUBJECT_LABELS: Partial<Record<ConditionSubject, string>> = {
    always: 'Always',
    'self-debuff': 'per debuff on this unit',
    'hp-threshold': 'when HP crosses a threshold',
};

const subjectLabel = (subject: ConditionSubject): string =>
    EXTRA_SUBJECT_LABELS[subject] ??
    (CONDITIONAL_CONDITION_LABELS as Partial<Record<ConditionSubject, string>>)[subject] ??
    subject;

const SUBJECT_OPTIONS = SUBJECT_VALUES.map((value) => ({
    value,
    label: subjectLabel(value),
}));

const ENEMY_TYPE_OPTIONS: { value: EnemyBaseClass; label: string }[] = [
    { value: 'Attacker', label: 'Attacker' },
    { value: 'Defender', label: 'Defender' },
    { value: 'Debuffer', label: 'Debuffer' },
    { value: 'Supporter', label: 'Supporter' },
];

const HP_COMPARATOR_OPTIONS = [
    { value: 'below', label: 'below' },
    { value: 'above', label: 'above' },
];

const BUFF_NAME_SUBJECTS: ConditionSubject[] = [
    'enemy-buff',
    'self-buff',
    'self-debuff',
    'enemy-debuff',
];

export const ConditionRow: React.FC<Props> = ({ condition, onChange, onRemove }) => {
    return (
        <div className="card space-y-2">
            <div className="flex items-start gap-2">
                <Select
                    label="Condition"
                    value={condition.subject}
                    options={SUBJECT_OPTIONS}
                    onChange={(subject) =>
                        onChange({ ...condition, subject: subject as ConditionSubject })
                    }
                />
                <Button variant="danger" size="xs" onClick={onRemove} aria-label="Remove condition">
                    ×
                </Button>
            </div>

            <Checkbox
                label="Set manually (assume active)"
                checked={!condition.derivable}
                onChange={(checked) =>
                    onChange({
                        ...condition,
                        derivable: !checked,
                        manualCount: checked ? (condition.manualCount ?? 1) : condition.manualCount,
                    })
                }
            />

            {!condition.derivable && (
                <Input
                    label="Assume active / trigger count"
                    type="number"
                    min={0}
                    value={condition.manualCount ?? 1}
                    onChange={(e) =>
                        onChange({ ...condition, manualCount: parseInt(e.target.value, 10) })
                    }
                />
            )}

            {condition.subject === 'enemy-type' && (
                <Select
                    label="Enemy type"
                    value={condition.requiredEnemyType ?? ''}
                    options={ENEMY_TYPE_OPTIONS}
                    noDefaultSelection
                    onChange={(value) =>
                        onChange({ ...condition, requiredEnemyType: value as EnemyBaseClass })
                    }
                />
            )}

            {BUFF_NAME_SUBJECTS.includes(condition.subject) && (
                <Input
                    label="Buff name (optional)"
                    type="text"
                    value={condition.buffName ?? ''}
                    onChange={(e) => onChange({ ...condition, buffName: e.target.value })}
                />
            )}

            {condition.subject === 'hp-threshold' && (
                <div className="flex items-end gap-2">
                    <Select
                        label="HP is"
                        value={condition.hpComparator ?? 'below'}
                        options={HP_COMPARATOR_OPTIONS}
                        onChange={(value) =>
                            onChange({
                                ...condition,
                                hpComparator: value as 'below' | 'above',
                            })
                        }
                    />
                    <Input
                        label="HP %"
                        type="number"
                        min={0}
                        max={100}
                        value={condition.hpPercent ?? ''}
                        onChange={(e) =>
                            onChange({ ...condition, hpPercent: parseInt(e.target.value, 10) })
                        }
                    />
                </div>
            )}

            <Checkbox
                label="OR with previous"
                checked={!!condition.anyOf}
                onChange={(checked) => onChange({ ...condition, anyOf: checked })}
            />
        </div>
    );
};
