import React from 'react';
import { CraftingResult } from '../../types/crafting';
import { RARITIES } from '../../constants/rarities';

interface Props {
    result: CraftingResult;
}

export const CraftingResults: React.FC<Props> = ({ result }) => {
    const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                    <h3 className="text-sm font-medium text-gray-400 mb-2">Star Distribution</h3>
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <span>4★</span>
                            <span className="font-semibold">
                                {formatPercent(result.starDistribution['4_star'])}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>5★</span>
                            <span className="font-semibold">
                                {formatPercent(result.starDistribution['5_star'])}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>6★</span>
                            <span className="font-semibold">
                                {formatPercent(result.starDistribution['6_star'])}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                    <h3 className="text-sm font-medium text-gray-400 mb-2">Rarity Distribution</h3>
                    <div className="space-y-2">
                        {Object.entries(result.rarityDistribution).map(([rarity, prob]) => (
                            <div key={rarity} className="flex justify-between">
                                <span className={RARITIES[rarity]?.textColor}>
                                    {RARITIES[rarity]?.label}
                                </span>
                                <span className="font-semibold">{formatPercent(prob)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                    <h3 className="text-sm font-medium text-gray-400 mb-2">Expected Values</h3>
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <span>Expected Stars</span>
                            <span className="font-semibold">
                                {result.expectedStars.toFixed(2)}★
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>Expected Rarity</span>
                            <span
                                className={`font-semibold ${
                                    RARITIES[result.expectedRarity]?.textColor
                                }`}
                            >
                                {RARITIES[result.expectedRarity]?.label}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                <h3 className="text-sm font-medium text-gray-400 mb-4">Full Probability Matrix</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-dark-border">
                                <th className="text-left p-2">Stars / Rarity</th>
                                <th className="text-center p-2">
                                    <span className={RARITIES.rare?.textColor}>Rare</span>
                                </th>
                                <th className="text-center p-2">
                                    <span className={RARITIES.epic?.textColor}>Epic</span>
                                </th>
                                <th className="text-center p-2">
                                    <span className={RARITIES.legendary?.textColor}>Legendary</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {['4_star', '5_star', '6_star'].map((star) => (
                                <tr key={star} className="border-b border-dark-border">
                                    <td className="p-2 font-medium">
                                        {star.replace('_', ' ').replace('star', '★')}
                                    </td>
                                    <td className="text-center p-2">
                                        {formatPercent(
                                            result.fullDistribution[
                                                `${star}_rare` as keyof typeof result.fullDistribution
                                            ]
                                        )}
                                    </td>
                                    <td className="text-center p-2">
                                        {formatPercent(
                                            result.fullDistribution[
                                                `${star}_epic` as keyof typeof result.fullDistribution
                                            ]
                                        )}
                                    </td>
                                    <td className="text-center p-2">
                                        {formatPercent(
                                            result.fullDistribution[
                                                `${star}_legendary` as keyof typeof result.fullDistribution
                                            ]
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
