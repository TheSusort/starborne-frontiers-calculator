import React, { useState, useMemo } from 'react';
import {
    CraftingInput as CraftingInputType,
    CraftingMaterials,
    AutocraftResult,
} from '../../types/crafting';
import { GearPiece } from '../../types/gear';
import { ShipTypeName, SHIP_TYPES } from '../../constants';
import { CraftingInput } from './CraftingInput';
import { CraftingResults } from './CraftingResults';
import { CraftingSuggestions } from './CraftingSuggestions';
import { AutocraftInput } from './AutocraftInput';
import { AutocraftResults } from './AutocraftResults';
import { calculateCraftingProbabilities } from '../../utils/crafting/probabilityCalculator';
import { analyzeGearBySlotAndRole } from '../../utils/crafting/inventoryAnalyzer';
import { generateCraftingSuggestions } from '../../utils/crafting/suggestionEngine';
import { autocraftMaterials } from '../../utils/crafting/autocraftEngine';
import { CraftingSuggestion } from '../../types/crafting';
import { Tabs } from '../ui/layout/Tabs';
import { Button, ProgressBar } from '../ui';
import { CollapsibleAccordion } from '../ui/CollapsibleAccordion';
import { useStorage } from '../../hooks/useStorage';
import { StorageKey } from '../../constants/storage';

interface Props {
    inventory: GearPiece[];
}

const defaultMaterials: CraftingMaterials = {
    slotItems: {
        weapon: 0,
        hull: 0,
        generator: 0,
        sensor: 0,
        software: 0,
        thrusters: 0,
    },
    setCores: {
        omnicore: { rare: 0, epic: 0, legendary: 0 },
        swiftness: { rare: 0, epic: 0, legendary: 0 },
        recovery: { rare: 0, epic: 0, legendary: 0 },
        exploit: { rare: 0, epic: 0, legendary: 0 },
    },
    setMaterials: {
        synth_alloy: { rare: 0, epic: 0, legendary: 0 },
        quantum_fiber: { rare: 0, epic: 0, legendary: 0 },
    },
    boosters: {
        rank: 0,
        rarity: 0,
        substat: {
            speed: 0,
            crit_power: 0,
            hacking: 0,
            crit_rate: 0,
            security: 0,
            attack: 0,
            hp: 0,
            defense: 0,
        },
    },
};

export const CraftingTab: React.FC<Props> = ({ inventory }) => {
    const [activeSubTab, setActiveSubTab] = useState<'calculator' | 'suggestions' | 'autocraft'>(
        'calculator'
    );
    const [craftingInput, setCraftingInput] = useState<CraftingInputType>({
        slot: 'weapon',
        set: 'omnicore',
        setCoreRarity: 'rare',
        setMaterialRarity: 'rare',
        boosters: {},
    });
    const [suggestions, setSuggestions] = useState<CraftingSuggestion[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [calculationProgress, setCalculationProgress] = useState<{
        current: number;
        total: number;
        percentage: number;
    } | null>(null);

    // Persist materials in localStorage
    const { data: rawMaterials, setData: setMaterials } = useStorage<CraftingMaterials>({
        key: StorageKey.CRAFTING_MATERIALS,
        defaultValue: defaultMaterials,
    });

    // Migrate old format to new format if needed
    const materials: CraftingMaterials = React.useMemo(() => {
        if (!rawMaterials) return defaultMaterials;

        // Check if boosters need migration
        if (!rawMaterials.boosters || typeof rawMaterials.boosters.rank !== 'number') {
            const migrated = {
                ...rawMaterials,
                boosters: {
                    rank: 0,
                    rarity: 0,
                    substat: {
                        speed: 0,
                        crit_power: 0,
                        hacking: 0,
                        crit_rate: 0,
                        security: 0,
                        attack: 0,
                        hp: 0,
                        defense: 0,
                    },
                },
            };
            // Save migrated data
            setMaterials(migrated);
            return migrated;
        }
        return rawMaterials;
    }, [rawMaterials, setMaterials]);

    const [selectedRoles, setSelectedRoles] = useState<ShipTypeName[]>(
        Object.keys(SHIP_TYPES) as ShipTypeName[]
    );
    const [autocraftResult, setAutocraftResult] = useState<AutocraftResult | null>(null);
    const [isFormExpanded, setIsFormExpanded] = useState(true);

    // Calculate probabilities for current input
    const craftingResult = useMemo(
        () => calculateCraftingProbabilities(craftingInput),
        [craftingInput]
    );

    const handleCalculateSuggestions = async () => {
        setIsLoading(true);
        setCalculationProgress({ current: 0, total: 100, percentage: 0 });

        try {
            // Run calculations in chunks to allow UI updates
            const roles = Object.keys(SHIP_TYPES) as ShipTypeName[];
            const totalSteps = roles.length + 1; // +1 for suggestion generation
            let completedSteps = 0;

            // Analyze gear by slot and role (this is the expensive operation)
            setCalculationProgress({
                current: completedSteps,
                total: totalSteps,
                percentage: (completedSteps / totalSteps) * 100,
            });

            // Use setTimeout to allow UI to update
            await new Promise((resolve) => setTimeout(resolve, 0));

            const slotRoleScores = analyzeGearBySlotAndRole(inventory, roles);
            completedSteps = roles.length;
            setCalculationProgress({
                current: completedSteps,
                total: totalSteps,
                percentage: (completedSteps / totalSteps) * 100,
            });

            await new Promise((resolve) => setTimeout(resolve, 0));

            // Generate suggestions
            const generatedSuggestions = generateCraftingSuggestions(slotRoleScores, roles);
            completedSteps = totalSteps;
            setCalculationProgress({
                current: completedSteps,
                total: totalSteps,
                percentage: 100,
            });

            setSuggestions(generatedSuggestions);
        } catch (error) {
            console.error('Error calculating suggestions:', error);
        } finally {
            setIsLoading(false);
            // Clear progress after a short delay
            setTimeout(() => setCalculationProgress(null), 500);
        }
    };

    const handleSelectSuggestion = (suggestion: CraftingSuggestion) => {
        setCraftingInput({
            slot: suggestion.slot,
            set: suggestion.suggestedSet,
            setCoreRarity: 'rare', // Default, user can change
            setMaterialRarity: 'rare', // Default, user can change
            boosters: {},
        });
        setActiveSubTab('calculator');
    };

    const handleAutocraft = () => {
        const result = autocraftMaterials(materials, suggestions, selectedRoles);
        setAutocraftResult(result);
        setIsFormExpanded(false); // Collapse form when calculation is done
    };

    const subTabs = [
        { id: 'calculator', label: 'Crafting Calculator' },
        { id: 'suggestions', label: 'Suggestions' },
        { id: 'autocraft', label: 'Autocraft' },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold mb-2">Gear Crafting Assistant</h2>
                <p className="text-gray-400">
                    Calculate crafting probabilities and get suggestions based on your inventory.
                </p>
            </div>

            <Tabs
                tabs={subTabs}
                activeTab={activeSubTab}
                onChange={(tabId) =>
                    setActiveSubTab(tabId as 'calculator' | 'suggestions' | 'autocraft')
                }
            />

            {activeSubTab === 'calculator' && (
                <div className="space-y-6">
                    <div className="bg-dark-lighter border border-dark-border p-6">
                        <h3 className="text-lg font-semibold mb-4">Crafting Configuration</h3>
                        <CraftingInput value={craftingInput} onChange={setCraftingInput} />
                    </div>

                    <div className="bg-dark-lighter border border-dark-border p-6">
                        <h3 className="text-lg font-semibold mb-4">Probability Results</h3>
                        <CraftingResults result={craftingResult} />
                    </div>
                </div>
            )}

            {activeSubTab === 'suggestions' && (
                <div className="bg-dark-lighter border border-dark-border p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold">Crafting Suggestions</h3>
                        <Button
                            variant="primary"
                            onClick={handleCalculateSuggestions}
                            disabled={isLoading}
                        >
                            {isLoading ? 'Calculating...' : 'Calculate Suggestions'}
                        </Button>
                    </div>

                    {calculationProgress && (
                        <ProgressBar
                            current={calculationProgress.current}
                            total={calculationProgress.total}
                            percentage={calculationProgress.percentage}
                            label={`Analyzing inventory...`}
                        />
                    )}

                    {suggestions.length > 0 && (
                        <CraftingSuggestions
                            suggestions={suggestions}
                            onSelectSuggestion={handleSelectSuggestion}
                        />
                    )}

                    {!isLoading && suggestions.length === 0 && (
                        <div className="text-center py-8 text-gray-400">
                            <p>No suggestions calculated yet.</p>
                            <p className="text-sm mt-2">
                                Click &quot;Calculate Suggestions&quot; to analyze your inventory
                                and get crafting recommendations.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {activeSubTab === 'autocraft' && (
                <div className="space-y-6">
                    <div className="bg-dark-lighter border border-dark-border p-6">
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center gap-2">
                                <h3 className="text-lg font-semibold">Material Input</h3>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => setIsFormExpanded(!isFormExpanded)}
                                >
                                    {isFormExpanded ? 'Collapse' : 'Expand'}
                                </Button>
                            </div>
                            <Button
                                variant="primary"
                                onClick={handleAutocraft}
                                disabled={suggestions.length === 0}
                            >
                                Calculate Autocraft
                            </Button>
                        </div>
                        {suggestions.length === 0 && (
                            <div className="bg-yellow-900/20 border border-yellow-700/50 p-3 mb-4">
                                <p className="text-sm text-yellow-300">
                                    Calculate suggestions first to enable smart material
                                    distribution. Without suggestions, materials will be distributed
                                    evenly.
                                </p>
                            </div>
                        )}
                        <CollapsibleAccordion isOpen={isFormExpanded}>
                            <AutocraftInput
                                materials={materials}
                                onMaterialsChange={setMaterials}
                                selectedRoles={selectedRoles}
                                onRolesChange={setSelectedRoles}
                            />
                        </CollapsibleAccordion>
                    </div>

                    {autocraftResult && (
                        <div className="bg-dark-lighter border border-dark-border p-6">
                            <h3 className="text-lg font-semibold mb-4">Autocraft Results</h3>
                            <AutocraftResults result={autocraftResult} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
