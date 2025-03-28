import React from 'react';
import { getBuffDescription } from '../../utils/buffUtils';

interface BuffTooltipProps {
    buffName: string;
}

export const BuffTooltip: React.FC<BuffTooltipProps> = ({ buffName }) => {
    const description = getBuffDescription(buffName);

    if (!description) {
        return null;
    }

    return (
        <div className="bg-dark-lighter p-2 shadow-lg max-w-xs mt-1 border border-gray-600">
            <div className="font-semibold text-sm text-primary capitalize">{buffName}</div>
            <div className="text-sm text-gray-300">{description}</div>
        </div>
    );
};
