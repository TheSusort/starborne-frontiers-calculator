import React, { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useShips } from '../../hooks/useShips';
import { useInventory } from '../../hooks/useInventory';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { testData } from '../../constants';

const IMPORT_SECRET = import.meta.env.VITE_IMPORT_SECRET || 'development-secret';

export const ImportTestDataHandler: React.FC = () => {
    const navigate = useNavigate();
    const { saveShips } = useShips();
    const { saveInventory } = useInventory();

    const importTestData = useCallback(async () => {
        console.log('Importing test data');

        saveShips(testData.ships as Ship[]);
        saveInventory(testData.gear as GearPiece[]);
    }, [saveShips, saveInventory]);

    useEffect(() => {
        const handleTestDataImport = async () => {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const secret = urlParams.get('secret');

                if (secret !== IMPORT_SECRET) {
                    console.error('Invalid secret key');
                    navigate('/');
                    return;
                }

                await importTestData();

                console.log('Test data import completed');
                navigate('/');
            } catch (error) {
                console.error('Error importing test data:', error);
                navigate('/');
            }
        };

        handleTestDataImport();
    }, [navigate, importTestData]);

    return null;
};
