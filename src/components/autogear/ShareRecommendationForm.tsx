import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';

interface ShareRecommendationFormProps {
    onSubmit: (title: string, description: string, isImplantSpecific: boolean) => Promise<boolean>;
    onCancel: () => void;
    ultimateImplantName: string | null;
    isSubmitting?: boolean;
}

export const ShareRecommendationForm: React.FC<ShareRecommendationFormProps> = ({
    onSubmit,
    onCancel,
    ultimateImplantName,
    isSubmitting = false,
}) => {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [isImplantSpecific, setIsImplantSpecific] = useState(false);
    const [titleError, setTitleError] = useState<string | undefined>(undefined);

    const validateTitle = (value: string): string | undefined => {
        if (!value.trim()) {
            return 'Title is required';
        }
        if (value.trim().length < 3) {
            return 'Title must be at least 3 characters';
        }
        if (value.length > 50) {
            return 'Title must be 50 characters or less';
        }
        return undefined;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const error = validateTitle(title);
        if (error) {
            setTitleError(error);
            return;
        }

        setTitleError(undefined);
        const success = await onSubmit(title.trim(), description.trim(), isImplantSpecific);

        if (success) {
            setTitle('');
            setDescription('');
            setIsImplantSpecific(false);
        }
    };

    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setTitle(value);
        if (titleError) {
            setTitleError(validateTitle(value));
        }
    };

    const handleTitleBlur = () => {
        setTitleError(validateTitle(title));
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <Input
                label="Title"
                value={title}
                onChange={handleTitleChange}
                onBlur={handleTitleBlur}
                placeholder="Build title (e.g., High Crit DPS)"
                maxLength={50}
                error={titleError}
                disabled={isSubmitting}
            />

            <div className="space-y-1">
                <Textarea
                    label="Description (optional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description - explain your build strategy..."
                    maxLength={500}
                    rows={3}
                    disabled={isSubmitting}
                />
            </div>

            <div className="space-y-1">
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={isImplantSpecific}
                        onChange={(e) => setIsImplantSpecific(e.target.checked)}
                        disabled={!ultimateImplantName || isSubmitting}
                        className="w-4 h-4 rounded border-dark-600 bg-dark-700 text-primary focus:ring-primary focus:ring-offset-0"
                    />
                    <span
                        className={`text-sm ${!ultimateImplantName ? 'text-gray-500' : 'text-gray-300'}`}
                    >
                        Only show to users with {ultimateImplantName || 'the same ultimate implant'}
                    </span>
                </label>
                {!ultimateImplantName && (
                    <p className="text-xs text-gray-500 ml-6">
                        Equip an ultimate implant to enable this option
                    </p>
                )}
            </div>

            <div className="flex gap-3 justify-end">
                <Button
                    type="button"
                    variant="secondary"
                    onClick={onCancel}
                    disabled={isSubmitting}
                >
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Sharing...' : 'Share'}
                </Button>
            </div>
        </form>
    );
};
