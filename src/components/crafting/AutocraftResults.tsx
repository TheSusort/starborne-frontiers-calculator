import React from 'react';
import { AutocraftResult } from '../../types/crafting';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { RARITIES } from '../../constants/rarities';
import { SET_MATERIAL_REQUIREMENTS } from '../../constants/craftingProbabilities';

const SUBSTAT_BOOSTERS = [
    { value: 'speed', label: 'Speed' },
    { value: 'crit_power', label: 'Crit Power' },
    { value: 'hacking', label: 'Hacking' },
    { value: 'crit_rate', label: 'Crit Rate' },
    { value: 'security', label: 'Security' },
    { value: 'attack', label: 'Attack' },
    { value: 'hp', label: 'HP' },
    { value: 'defense', label: 'Defense' },
];

interface Props {
    result: AutocraftResult;
}

export const AutocraftResults: React.FC<Props> = ({ result }) => {
    const formatNumber = (num: number) => {
        if (num >= 1) return num.toFixed(1);
        return num.toFixed(2);
    };

    const formatCredits = (credits: number) => {
        if (credits >= 1_000_000_000) {
            return `${(credits / 1_000_000_000).toFixed(2)}B`;
        }
        if (credits >= 1_000_000) {
            return `${(credits / 1_000_000).toFixed(2)}M`;
        }
        if (credits >= 1_000) {
            return `${(credits / 1_000).toFixed(2)}K`;
        }
        return credits.toLocaleString();
    };

    const totalPlans = result.plans.reduce((sum, plan) => sum + plan.count, 0);
    const CRAFT_COST_PER_ITEM = 100_000; // 100k credits per craft
    const totalCost = totalPlans * CRAFT_COST_PER_ITEM;

    return (
        <div className="space-y-6">
            <div className="bg-blue-900/20 border border-blue-700/50 rounded p-4">
                <h3 className="font-semibold text-blue-300 mb-2">Summary</h3>
                <p className="text-sm text-gray-300">
                    Based on your materials, you could craft <strong>{totalPlans}</strong> items
                    total.
                    {result.plans.some((p) => p.role) && (
                        <span className="block mt-2">
                            Materials are distributed based on your crafting suggestions,
                            prioritizing higher rarity materials for higher priority suggestions.
                        </span>
                    )}
                </p>
            </div>

            <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Crafting Cost</h3>
                <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-300">Total Crafts:</span>
                        <span className="font-semibold">{totalPlans.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-300">Cost per Craft:</span>
                        <span className="font-semibold">{formatCredits(CRAFT_COST_PER_ITEM)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-dark-border">
                        <span className="text-gray-300 font-medium">Total Cost:</span>
                        <span className="font-semibold text-lg">{formatCredits(totalCost)}</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                    <h3 className="text-sm font-medium text-gray-400 mb-2">By Set</h3>
                    <div className="space-y-1">
                        {Object.entries(result.expectedResults.bySet).map(([set, count]) => (
                            <div key={set} className="flex justify-between text-sm">
                                <span className="capitalize">{set}</span>
                                <span className="font-semibold">{count}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                    <h3 className="text-sm font-medium text-gray-400 mb-2">By Slot</h3>
                    <div className="space-y-1">
                        {Object.entries(result.expectedResults.bySlot).map(([slot, count]) => (
                            <div key={slot} className="flex justify-between text-sm">
                                <span>
                                    {GEAR_SLOTS[slot as keyof typeof GEAR_SLOTS]?.label || slot}
                                </span>
                                <span className="font-semibold">{formatNumber(count)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                    <h3 className="text-sm font-medium text-gray-400 mb-2">By Rarity</h3>
                    <div className="space-y-1">
                        {Object.entries(result.expectedResults.byRarity).map(([rarity, count]) => (
                            <div key={rarity} className="flex justify-between text-sm">
                                <span className={RARITIES[rarity]?.textColor}>
                                    {RARITIES[rarity]?.label}
                                </span>
                                <span className="font-semibold">{formatNumber(count)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                    <h3 className="text-sm font-medium text-gray-400 mb-2">By Stars</h3>
                    <div className="space-y-1">
                        {Object.entries(result.expectedResults.byStars).map(([star, count]) => (
                            <div key={star} className="flex justify-between text-sm">
                                <span>{star.replace('_', ' ').replace('star', '★')}</span>
                                <span className="font-semibold">{formatNumber(count)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                <h3 className="text-sm font-medium text-gray-400 mb-4">
                    Full Probability Matrix (All Sets)
                </h3>
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
                                        {formatNumber(
                                            result.expectedResults.fullDistribution[
                                                `${star}_rare` as keyof typeof result.expectedResults.fullDistribution
                                            ]
                                        )}
                                    </td>
                                    <td className="text-center p-2">
                                        {formatNumber(
                                            result.expectedResults.fullDistribution[
                                                `${star}_epic` as keyof typeof result.expectedResults.fullDistribution
                                            ]
                                        )}
                                    </td>
                                    <td className="text-center p-2">
                                        {formatNumber(
                                            result.expectedResults.fullDistribution[
                                                `${star}_legendary` as keyof typeof result.expectedResults.fullDistribution
                                            ]
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                <h3 className="text-sm font-medium text-gray-400 mb-4">
                    Probability Matrix by Set
                </h3>
                <div className="space-y-6">
                    {(['omnicore', 'swiftness', 'recovery', 'exploit'] as const).map((set) => {
                        const setDistribution = result.expectedResults.bySetFullDistribution[set];
                        const totalForSet = Object.values(setDistribution).reduce(
                            (sum, val) => sum + val,
                            0
                        );

                        if (totalForSet === 0) return null;

                        return (
                            <div key={set}>
                                <h4 className="text-sm font-semibold mb-2 capitalize">{set}</h4>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-dark-border">
                                                <th className="text-left p-2">Stars / Rarity</th>
                                                <th className="text-center p-2">
                                                    <span className={RARITIES.rare?.textColor}>
                                                        Rare
                                                    </span>
                                                </th>
                                                <th className="text-center p-2">
                                                    <span className={RARITIES.epic?.textColor}>
                                                        Epic
                                                    </span>
                                                </th>
                                                <th className="text-center p-2">
                                                    <span className={RARITIES.legendary?.textColor}>
                                                        Legendary
                                                    </span>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {['4_star', '5_star', '6_star'].map((star) => (
                                                <tr
                                                    key={star}
                                                    className="border-b border-dark-border"
                                                >
                                                    <td className="p-2 font-medium">
                                                        {star
                                                            .replace('_', ' ')
                                                            .replace('star', '★')}
                                                    </td>
                                                    <td className="text-center p-2">
                                                        {formatNumber(
                                                            setDistribution[
                                                                `${star}_rare` as keyof typeof setDistribution
                                                            ]
                                                        )}
                                                    </td>
                                                    <td className="text-center p-2">
                                                        {formatNumber(
                                                            setDistribution[
                                                                `${star}_epic` as keyof typeof setDistribution
                                                            ]
                                                        )}
                                                    </td>
                                                    <td className="text-center p-2">
                                                        {formatNumber(
                                                            setDistribution[
                                                                `${star}_legendary` as keyof typeof setDistribution
                                                            ]
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                <h3 className="text-sm font-medium text-gray-400 mb-4">Crafting Plan Details</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                    {result.plans.map((plan, index) => {
                        const materialType = SET_MATERIAL_REQUIREMENTS[plan.set];
                        const materialLabel =
                            materialType === 'synth_alloy' ? 'Synth Alloy' : 'Quantum Fiber';
                        return (
                            <div
                                key={index}
                                className="text-sm p-2 bg-dark rounded border border-dark-border"
                            >
                                <div className="flex justify-between items-center">
                                    <div>
                                        <span className="font-medium">
                                            {GEAR_SLOTS[plan.slot]?.label || plan.slot} -{' '}
                                            {plan.set.charAt(0).toUpperCase() + plan.set.slice(1)}
                                        </span>
                                        <span className="text-gray-400 ml-2">
                                            ({RARITIES[plan.setCoreRarity]?.label} Core,{' '}
                                            {RARITIES[plan.setMaterialRarity]?.label}{' '}
                                            {materialLabel})
                                        </span>
                                        {plan.role && (
                                            <span className="text-gray-500 ml-2">
                                                - {plan.role}
                                            </span>
                                        )}
                                    </div>
                                    <span className="font-semibold">×{plan.count}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="bg-dark-lighter p-4 rounded border border-dark-border">
                <h3 className="text-sm font-medium text-gray-400 mb-4">
                    Remaining Crafting Materials
                </h3>
                <div className="space-y-4">
                    <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-2">Slot Items</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                            {Object.entries(result.remainingMaterials.slotItems).map(
                                ([slot, count]) => (
                                    <div key={slot} className="flex justify-between">
                                        <span>
                                            {GEAR_SLOTS[slot as keyof typeof GEAR_SLOTS]?.label ||
                                                slot}
                                        </span>
                                        <span className="font-semibold">{count}</span>
                                    </div>
                                )
                            )}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-2">Set Cores</h4>
                        <div className="space-y-2">
                            {(['omnicore', 'swiftness', 'recovery', 'exploit'] as const).map(
                                (set) => (
                                    <div key={set} className="text-sm">
                                        <span className="font-medium capitalize">{set}</span>
                                        <div className="grid grid-cols-3 gap-2 mt-1">
                                            {(['rare', 'epic', 'legendary'] as const).map(
                                                (rarity) => (
                                                    <div
                                                        key={rarity}
                                                        className="flex justify-between text-xs"
                                                    >
                                                        <span
                                                            className={RARITIES[rarity]?.textColor}
                                                        >
                                                            {RARITIES[rarity]?.label}
                                                        </span>
                                                        <span className="font-semibold">
                                                            {
                                                                result.remainingMaterials.setCores[
                                                                    set
                                                                ][rarity]
                                                            }
                                                        </span>
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    </div>
                                )
                            )}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-2">Set Materials</h4>
                        <div className="space-y-2">
                            {(['synth_alloy', 'quantum_fiber'] as const).map((materialType) => (
                                <div key={materialType} className="text-sm">
                                    <span className="font-medium">
                                        {materialType === 'synth_alloy'
                                            ? 'Synth Alloy'
                                            : 'Quantum Fiber'}
                                    </span>
                                    <div className="grid grid-cols-3 gap-2 mt-1">
                                        {(['rare', 'epic', 'legendary'] as const).map((rarity) => (
                                            <div
                                                key={rarity}
                                                className="flex justify-between text-xs"
                                            >
                                                <span className={RARITIES[rarity]?.textColor}>
                                                    {RARITIES[rarity]?.label}
                                                </span>
                                                <span className="font-semibold">
                                                    {
                                                        result.remainingMaterials.setMaterials[
                                                            materialType
                                                        ][rarity]
                                                    }
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-2">Boosters</h4>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span>Rank Booster</span>
                                <span className="font-semibold">
                                    {result.remainingMaterials.boosters.rank}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>Rarity Booster</span>
                                <span className="font-semibold">
                                    {result.remainingMaterials.boosters.rarity}
                                </span>
                            </div>
                            <div className="mt-2">
                                <span className="text-xs text-gray-500">Substat Boosters:</span>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
                                    {SUBSTAT_BOOSTERS.map((booster) => (
                                        <div
                                            key={booster.value}
                                            className="flex justify-between text-xs"
                                        >
                                            <span>{booster.label}</span>
                                            <span className="font-semibold">
                                                {
                                                    result.remainingMaterials.boosters.substat[
                                                        booster.value as keyof typeof result.remainingMaterials.boosters.substat
                                                    ]
                                                }
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
