import React from 'react';
import { Button, CloseIcon, Input, Select } from '../ui';
import type { LimitableStat } from '../../types/stats';
import { BASIS_STAT_OPTIONS, type DraftBasisTerm } from './basisTermDraft';

interface Props {
    terms: DraftBasisTerm[];
    onUpdate: (index: number, patch: Partial<DraftBasisTerm>) => void;
    onRemove: (index: number) => void;
    onAdd: () => void;
}

/**
 * The add/edit/remove controls for a weighted-stat basis — shared by the custom-formula row
 * editor and the off-formula applied-equation editor, so both save through the same inputs
 * rather than two parallel forms that can drift apart. Every button is `type="button"` so this
 * stays safe to mount inside another component's own `<form>`.
 */
export const BasisTermsEditor: React.FC<Props> = ({ terms, onUpdate, onRemove, onAdd }) => (
    <div className="space-y-2">
        {terms.map((term, index) => (
            <div key={index} className="flex gap-3 items-end flex-wrap">
                <Select
                    label="Basis stat"
                    className="flex-1 min-w-[8rem]"
                    value={term.stat}
                    onChange={(value) => onUpdate(index, { stat: value as LimitableStat })}
                    options={BASIS_STAT_OPTIONS}
                />
                <div className="w-32">
                    <Input
                        label="Basis weight"
                        type="number"
                        min="0"
                        step="0.001"
                        value={term.weight}
                        onChange={(e) => onUpdate(index, { weight: e.target.value })}
                        placeholder="0"
                    />
                </div>
                <Button
                    aria-label="Remove basis term"
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => onRemove(index)}
                >
                    <CloseIcon />
                </Button>
            </div>
        ))}
        <Button aria-label="Add stat" type="button" variant="secondary" size="sm" onClick={onAdd}>
            Add stat
        </Button>
    </div>
);
