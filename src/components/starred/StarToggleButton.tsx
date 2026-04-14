import React from 'react';
import { Button } from '../ui';
import { StarIcon, StarOutlineIcon } from '../ui/icons';
import { Ship } from '../../types/ship';

interface StarToggleButtonProps {
    ship: Ship;
    onToggleStarred: (shipId: string) => Promise<void>;
    size?: 'xs' | 'sm' | 'md' | 'lg';
}

export const StarToggleButton: React.FC<StarToggleButtonProps> = ({
    ship,
    onToggleStarred,
    size = 'sm',
}) => (
    <Button
        variant="secondary"
        size={size}
        title={ship.starred ? 'Unstar ship' : 'Star ship'}
        onClick={(e) => {
            e.stopPropagation();
            void (async () => {
                try {
                    await onToggleStarred(ship.id);
                } catch (error) {
                    console.error('Failed to update starred state:', error);
                }
            })();
        }}
    >
        {ship.starred ? <StarIcon className="text-yellow-400" /> : <StarOutlineIcon />}
    </Button>
);
