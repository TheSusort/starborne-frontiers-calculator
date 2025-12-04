import React, { useMemo } from 'react';
import { calculateDamageReduction } from '../../utils/autogear/scoring';

interface DamageReductionTableProps {
    defenseValues?: number[];
}

const ErrorFallback = () => (
    <div className="bg-dark p-4 border border-red-500">
        <h3 className="text-lg font-bold text-red-500 mb-2">Table Error</h3>
        <p>There was an error rendering the damage reduction table.</p>
    </div>
);

export const DamageReductionTable: React.FC<DamageReductionTableProps> = ({
    defenseValues = [
        0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000,
        15000, 16000, 17000, 18000, 19000, 20000, 21000, 22000, 23000, 24000, 25000, 26000,
    ],
}) => {
    const tableData = useMemo(() => {
        try {
            return defenseValues.map((defense) => ({
                defense,
                reduction: calculateDamageReduction(defense),
            }));
        } catch (error) {
            console.error('Error calculating damage reduction values:', error);
            return [];
        }
    }, [defenseValues]);

    if (tableData.length === 0) {
        return <ErrorFallback />;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse">
                <thead>
                    <tr className="bg-dark-lighter">
                        <th className="p-2 text-left border border-dark-border">Defense</th>
                        <th className="p-2 text-left border border-dark-border">
                            Damage Reduction
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {tableData.map(({ defense, reduction }) => (
                        <tr key={defense} className="hover:bg-dark-lighter">
                            <td className="p-2 border border-dark-border">
                                {defense.toLocaleString()}
                            </td>
                            <td className="p-2 border border-dark-border">
                                {reduction.toFixed(2)}%
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
