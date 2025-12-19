import React from 'react';

interface ArcaneSiegeNoticeProps {
    rarity: string | null;
    multiplier: number;
    isShieldSetActive: boolean;
}

export const ArcaneSiegeNotice: React.FC<ArcaneSiegeNoticeProps> = ({
    rarity,
    multiplier,
    isShieldSetActive,
}) => {
    return (
        <div className="mb-2 p-2 bg-blue-900/20 border border-blue-700/50 rounded text-sm">
            {isShieldSetActive ? (
                <div className="text-blue-300">
                    <strong>Arcane Siege ({rarity}):</strong> Shield set bonus is active. If you
                    have another source of shield, you can exclude the SHIELD set in config for
                    better optimization results.
                </div>
            ) : (
                <div className="text-blue-300">
                    <strong>Arcane Siege ({rarity}):</strong> If shielded, this ship will deal{' '}
                    <strong>+{multiplier}% more damage</strong>.
                </div>
            )}
        </div>
    );
};
