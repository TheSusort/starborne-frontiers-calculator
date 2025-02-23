import React from 'react';
import { useShipsData } from '../hooks/useShipsData';
import { PageLayout } from '../components/ui';
import { ShipDisplay } from '../components/ship/ShipDisplay';
import { Image } from '../components/ui/Image';

export const ShipIndexPage: React.FC = () => {
    const { ships, loading, error } = useShipsData();

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-[50vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center text-red-500">
                <p>Error: {error}</p>
            </div>
        );
    }

    return (
        <PageLayout
            title="Ships Database"
            description="Browse all available ships and their base statistics at level 60, no refits."
        >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {ships.length > 0 &&
                    ships.map((ship) => (
                        <ShipDisplay key={ship.name} ship={ship}>
                            <div className="flex flex-col items-center justify-center border-b border-gray-700 pb-2 m-3">
                                {ship.imageKey && <Image src={ship.imageKey} alt={ship.name} />}
                            </div>
                        </ShipDisplay>
                    ))}
            </div>
        </PageLayout>
    );
};

export default ShipIndexPage;
