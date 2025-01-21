import React from 'react';
import { GearPiece } from '../../types/gear';
import { ShipTypeName } from '../../constants';
import { analyzePotentialUpgrades } from '../../utils/gear/potentialCalculator';
import { GearPieceDisplay } from './GearPieceDisplay';

interface Props {
    inventory: GearPiece[];
    shipRoles: ShipTypeName[];
}

const winnerColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];

export const GearUpgradeAnalysis: React.FC<Props> = ({ inventory, shipRoles }) => {
    return (
        <div className="space-y-8">
            <h2 className="text-xl font-semibold mb-4">Gear Upgrade Analysis (EXPERIMENTAL)</h2>
            <span className="text-sm text-gray-400">
                This analysis tries to find the 3 best gear upgrades for each ship role, by
                simulating upgrading each piece to 16, 10 different times, and averaging the
                results. The results are percentages of improvement to the role score over the
                current level of the piece.
            </span>

            {shipRoles.map((role) => {
                const results = analyzePotentialUpgrades(inventory, role);

                if (results.length === 0) return null;
                return (
                    <div key={role} className="space-y-4 bg-dark p-4">
                        <h3 className="text-lg font-medium">{role}</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {results.map((result, index) => (
                                <div key={result.piece.id} className="space-y-2">
                                    <GearPieceDisplay gear={result.piece} />
                                    <div className="text-sm px-4 pb-4">
                                        <div
                                            className={`flex justify-between ${winnerColors[index]}`}
                                        >
                                            <span>Average improvement:</span>
                                            <span>
                                                {Math.round(
                                                    (result.improvement / result.currentScore) * 100
                                                )}
                                                %
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
