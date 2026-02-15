import React from 'react';
import { Button } from '../ui';
import { useTutorial } from '../../contexts/TutorialContext';

interface TutorialReplayButtonProps {
    groupId: string | string[];
}

export const TutorialReplayButton: React.FC<TutorialReplayButtonProps> = ({ groupId }) => {
    const { startGroup, startTour, isTutorialActive } = useTutorial();

    const handleClick = () => {
        if (Array.isArray(groupId)) {
            startTour(groupId);
        } else {
            startGroup(groupId, true);
        }
    };

    return (
        <Button
            variant="secondary"
            size="sm"
            onClick={handleClick}
            disabled={isTutorialActive}
            title="Take a guided tour of this page"
        >
            <span className="flex items-center gap-2">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-4 h-4"
                >
                    <path d="M8 5v14l11-7z" />
                </svg>
                Tour
            </span>
        </Button>
    );
};
