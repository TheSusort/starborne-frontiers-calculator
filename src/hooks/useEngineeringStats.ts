import { useContext } from 'react';
import {
    EngineeringStatsContext,
    EngineeringStatsContextType,
} from '../contexts/EngineeringStatsProvider';

export const useEngineeringStats = (): EngineeringStatsContextType => {
    const context = useContext(EngineeringStatsContext);
    if (context === undefined) {
        throw new Error('useEngineeringStats must be used within an EngineeringStatsProvider');
    }
    return context;
};
