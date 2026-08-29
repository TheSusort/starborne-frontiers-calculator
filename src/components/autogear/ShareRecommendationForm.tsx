import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { communityBuildSummary } from '../../utils/communityBuildSummary';
import type { SharedAutogearBuild } from '../../types/communityRecommendation';

interface ShareRecommendationFormProps {
    onSubmit: (title: string, description: string, isImplantSpecific: boolean) => Promise<boolean>;
    onCancel: () => void;
    ultimateImplantName: string | null;
    isSubmitting?: boolean;
    /** The config that will be published — shown read-only so the sharer can check it. */
    build: SharedAutogearBuild;
}

export const ShareRecommendationForm: React.FC<ShareRecommendationFormProps> = ({
    build,
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
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="p-3 bg-dark-lighter text-xs space-y-1">
                <p className="font-semibold text-theme-text">This build will be shared as:</p>
                <p className="text-theme-text-secondary">{communityBuildSummary(build)}</p>
                <p className="text-theme-text-secondary">
                    Your algorithm choice and your gear filters (ignore equipped, ignore unleveled,
                    use upgraded stats, complete sets, calibration, arena modifiers) stay private.
                </p>
            </div>

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
                <Checkbox
                    label={
                        ultimateImplantName
                            ? `Tag this build for ${ultimateImplantName}`
                            : 'Tag this build for your ultimate implant'
                    }
                    helpLabel="Tagged builds sort to the top for players with the same implant equipped. They stay visible to everyone else, just lower in the list."
                    checked={isImplantSpecific}
                    onChange={setIsImplantSpecific}
                    disabled={!ultimateImplantName || isSubmitting}
                />
                {!ultimateImplantName && (
                    <p className="text-xs text-theme-text-secondary ml-6">
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
