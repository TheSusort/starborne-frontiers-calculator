import React from 'react';
import { GearPiece } from '../types/gear';
import { GearPieceDisplay } from './GearPieceDisplay';

interface Props {
    gear: GearPiece;
    isVisible: boolean;
}

export const Tooltip: React.FC<Props> = ({ gear, isVisible }) => {
    if (!isVisible) return null;

    return (
        <div className="absolute z-50 w-64 -translate-x-1/2 left-1/2 mt-2">
            <GearPieceDisplay gear={gear} />
        </div>
    );
}; 