import React, { useMemo } from 'react';
import { calculateCritMultiplier } from '../../utils/autogear/scoring';
import { BaseStats } from '../../types/stats';

interface DPSCalculatorTableProps {
    attack: number;
    critDamageValues?: number[];
}

export const DPSCalculatorTable: React.FC<DPSCalculatorTableProps> = ({
    attack,
    critDamageValues = [100, 125, 150, 175, 200, 225, 250],
}) => {
    // Use fixed attack values
    const fixedAttackValues = useMemo(() => {
        // Create fixed attack values at 50%, 75%, 100%, 125%, 150%, 175%, 200% of base attack
        return [8000, 10000, 12000, 14000, 16000, 18000, 20000, 22000, 24000, 26000];
    }, []); // These are fixed values, no dependencies needed

    // Generate the table data with memoization
    const tableData = useMemo(() => {
        return fixedAttackValues.map((attackValue) => {
            const row = critDamageValues.map((critDamage) => {
                const stats: BaseStats = {
                    attack: attackValue,
                    crit: 100, // Fixed at 100%
                    critDamage,
                    hp: 0,
                    defence: 0,
                    hacking: 0,
                    security: 0,
                    speed: 0,
                    healModifier: 0,
                };
                return attackValue * calculateCritMultiplier(stats);
            });
            return { attack: attackValue, values: row };
        });
    }, [fixedAttackValues, critDamageValues]);

    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse">
                <thead>
                    <tr className="bg-dark-lighter">
                        <th className="p-2 text-left border border-dark-border">Attack</th>
                        {critDamageValues.map((cd) => (
                            <th key={cd} className="p-2 text-center border border-dark-border">
                                {cd}% Crit Damage
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {tableData.map(({ attack: rowAttack, values }, rowIndex) => (
                        <tr key={`row-${rowIndex}`} className="hover:bg-dark-lighter">
                            <td className="p-2 border border-dark-border font-medium">
                                {rowAttack.toLocaleString()}
                            </td>
                            {values.map((dps, cellIndex) => (
                                <td
                                    key={`cell-${rowIndex}-${cellIndex}`}
                                    className="p-2 text-right border border-dark-border"
                                >
                                    {Math.round(dps).toLocaleString()}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
