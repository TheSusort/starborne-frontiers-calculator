import { useState, useEffect, useCallback, useRef } from 'react';
import { Ship } from '../types/ship';
import { AutogearSuggestion } from '../types/autogearSuggestion';
import { AIRecommendation, AIRecommendationService } from '../services/aiRecommendations';
import { getMimoService } from '../services/mimo';
import { COMBAT_SYSTEM_CONTEXT } from '../constants/combatSystemContext';
import { IMPLANTS } from '../constants/implants';
import { useShipsData } from './useShipsData';
import { useInventory } from '../contexts/InventoryProvider';

interface UseLLMRecommendationsProps {
    selectedShip: Ship | null;
}

interface UseLLMRecommendationsReturn {
    suggestion: AutogearSuggestion | null;
    communityRecommendation: AIRecommendation | null;
    alternativeRecommendations: AIRecommendation[];
    showAlternatives: boolean;
    selectedAlternative: AIRecommendation | null;
    loading: boolean;
    error: string | null;
    source: 'community' | 'ai' | null;
    userVote: 'upvote' | 'downvote' | null;
    fetchRecommendation: () => Promise<void>;
    fetchAISuggestion: () => Promise<void>;
    handleVote: (voteType: 'upvote' | 'downvote') => Promise<void>;
    handleSaveToCommmunity: () => Promise<void>;
    handleSelectAlternative: (alternative: AIRecommendation) => Promise<void>;
    handleBackToMain: () => Promise<void>;
    setShowAlternatives: (show: boolean) => void;
    setError: (error: string | null) => void;
}

export const useLLMRecommendations = ({
    selectedShip,
}: UseLLMRecommendationsProps): UseLLMRecommendationsReturn => {
    const { fetchSingleShip } = useShipsData();
    const { getGearPiece } = useInventory();

    const [suggestion, setSuggestion] = useState<AutogearSuggestion | null>(null);
    const [communityRecommendation, setCommunityRecommendation] = useState<AIRecommendation | null>(
        null
    );
    const [alternativeRecommendations, setAlternativeRecommendations] = useState<
        AIRecommendation[]
    >([]);
    const [showAlternatives, setShowAlternatives] = useState(false);
    const [selectedAlternative, setSelectedAlternative] = useState<AIRecommendation | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastShipName, setLastShipName] = useState<string | null>(null);
    const [source, setSource] = useState<'community' | 'ai' | null>(null);
    const [userVote, setUserVote] = useState<'upvote' | 'downvote' | null>(null);

    // Use ref to prevent duplicate calls
    const isFetchingRef = useRef(false);

    const fetchRecommendation = useCallback(async () => {
        if (!selectedShip || isFetchingRef.current) return;

        isFetchingRef.current = true;
        setLoading(true);
        setError(null);
        setSuggestion(null);
        setCommunityRecommendation(null);
        setAlternativeRecommendations([]);
        setShowAlternatives(false);
        setSelectedAlternative(null);
        setSource(null);
        setUserVote(null);

        try {
            // Get refit level (only 0 or 2 matters)
            const actualRefitLevel = selectedShip.refits?.length || 0;
            const refitLevel = actualRefitLevel >= 2 ? 2 : 0;

            // Get implant names for major and ultimate implants only (inline to avoid dependency issues)
            const implantNames: Record<string, string> = {};
            if (selectedShip.implants) {
                Object.entries(selectedShip.implants).forEach(([slot, implantId]) => {
                    if (implantId) {
                        const implantPiece = getGearPiece(implantId);
                        if (implantPiece?.setBonus) {
                            const implantData = IMPLANTS[implantPiece.setBonus];
                            if (
                                implantData &&
                                (implantData.type === 'major' || implantData.type === 'ultimate')
                            ) {
                                implantNames[slot] = implantData.name;
                            }
                        }
                    }
                });
            }

            const communityRec = await AIRecommendationService.getBestRecommendation(
                selectedShip.name,
                refitLevel,
                implantNames
            );

            if (communityRec) {
                // Found community recommendation
                setCommunityRecommendation(communityRec);
                setSuggestion({
                    shipRole: communityRec.ship_role,
                    statPriorities: communityRec.stat_priorities,
                    statBonuses: communityRec.stat_bonuses,
                    setPriorities: communityRec.set_priorities,
                    reasoning: communityRec.reasoning,
                });
                setSource('community');

                // Get user's vote on this recommendation
                if (communityRec.id) {
                    const vote = await AIRecommendationService.getUserVote(communityRec.id);
                    setUserVote(vote);
                }

                // Get alternative recommendations (excluding the best one)
                const alternatives = await AIRecommendationService.getAlternativeRecommendations(
                    selectedShip.name,
                    refitLevel,
                    implantNames,
                    communityRec.id
                );
                setAlternativeRecommendations(alternatives);
            } else {
                // No community recommendation, fallback to AI
                await internalFetchAI();
            }
        } catch (err) {
            console.error('Error fetching recommendation:', err);
            // Fallback to AI on error
            await internalFetchAI();
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
        }

        async function internalFetchAI() {
            if (!selectedShip) return;

            const mimoService = getMimoService();
            if (!mimoService) {
                setError('Mimo API key not configured');
                return;
            }

            try {
                // Fetch ship template data for skills and base stats
                const shipTemplate = await fetchSingleShip(selectedShip.name);
                if (!shipTemplate) {
                    throw new Error('Failed to fetch ship template data');
                }

                // Combine template data with actual ship instance data (including refits)
                const combinedShipData = {
                    ...shipTemplate,
                    refits: selectedShip.refits, // Use actual ship's refits
                    equipment: selectedShip.equipment, // Use actual ship's equipment
                    implants: selectedShip.implants, // Use actual ship's implants
                    getGearPiece, // Pass gear lookup function for implant resolution
                };

                // Get LLM suggestion
                const suggestionResult = await mimoService.getAutogearSuggestion(
                    selectedShip.name,
                    combinedShipData,
                    COMBAT_SYSTEM_CONTEXT
                );

                if (suggestionResult) {
                    setSuggestion(suggestionResult);
                    setSource('ai');
                } else {
                    setError('Failed to get AI suggestion');
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error occurred');
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedShip]); // Only depend on selectedShip, context functions excluded intentionally

    const fetchAISuggestion = useCallback(async () => {
        if (!selectedShip) return;

        setLoading(true);
        setError(null);
        setSuggestion(null);
        setCommunityRecommendation(null);
        setSource(null);
        setUserVote(null);

        const mimoService = getMimoService();
        if (!mimoService) {
            setError('Mimo API key not configured');
            setLoading(false);
            return;
        }

        try {
            // Fetch ship template data for skills and base stats
            const shipTemplate = await fetchSingleShip(selectedShip.name);
            if (!shipTemplate) {
                throw new Error('Failed to fetch ship template data');
            }

            // Combine template data with actual ship instance data (including refits)
            const combinedShipData = {
                ...shipTemplate,
                refits: selectedShip.refits, // Use actual ship's refits
                equipment: selectedShip.equipment, // Use actual ship's equipment
                implants: selectedShip.implants, // Use actual ship's implants
                getGearPiece, // Pass gear lookup function for implant resolution
            };

            // Get LLM suggestion
            const suggestionResult = await mimoService.getAutogearSuggestion(
                selectedShip.name,
                combinedShipData,
                COMBAT_SYSTEM_CONTEXT
            );

            if (suggestionResult) {
                setSuggestion(suggestionResult);
                setSource('ai');
            } else {
                setError('Failed to get AI suggestion');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error occurred');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedShip]); // Only depend on selectedShip, context functions excluded intentionally

    const handleVote = useCallback(
        async (voteType: 'upvote' | 'downvote') => {
            if (!communityRecommendation?.id || !selectedShip) return;

            try {
                if (userVote === voteType) {
                    // Remove vote if clicking same vote
                    await AIRecommendationService.removeVote(communityRecommendation.id);
                    setUserVote(null);
                } else {
                    // Add or change vote
                    await AIRecommendationService.voteOnRecommendation(
                        communityRecommendation.id,
                        voteType
                    );
                    setUserVote(voteType);
                }

                // Refresh the recommendation to get updated vote counts
                const actualRefitLevel = selectedShip.refits?.length || 0;
                const refitLevel = actualRefitLevel >= 2 ? 2 : 0;

                // Get implant names inline
                const implantNames: Record<string, string> = {};
                if (selectedShip.implants) {
                    Object.entries(selectedShip.implants).forEach(([slot, implantId]) => {
                        if (implantId) {
                            const implantPiece = getGearPiece(implantId);
                            if (implantPiece?.setBonus) {
                                const implantData = IMPLANTS[implantPiece.setBonus];
                                if (
                                    implantData &&
                                    (implantData.type === 'major' ||
                                        implantData.type === 'ultimate')
                                ) {
                                    implantNames[slot] = implantData.name;
                                }
                            }
                        }
                    });
                }

                const updatedRec = await AIRecommendationService.getBestRecommendation(
                    selectedShip.name,
                    refitLevel,
                    implantNames
                );
                if (updatedRec) {
                    setCommunityRecommendation(updatedRec);
                }
            } catch (error) {
                console.error('Error voting:', error);
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [communityRecommendation?.id, userVote, selectedShip] // Context functions excluded intentionally
    );

    const handleSaveToCommmunity = useCallback(async () => {
        if (!selectedShip || !suggestion || source !== 'ai') return;

        try {
            const actualRefitLevel = selectedShip.refits?.length || 0;
            const refitLevel = actualRefitLevel >= 2 ? 2 : 0;

            // Get implant names inline
            const implantNames: Record<string, string> = {};
            if (selectedShip.implants) {
                Object.entries(selectedShip.implants).forEach(([slot, implantId]) => {
                    if (implantId) {
                        const implantPiece = getGearPiece(implantId);
                        if (implantPiece?.setBonus) {
                            const implantData = IMPLANTS[implantPiece.setBonus];
                            if (
                                implantData &&
                                (implantData.type === 'major' || implantData.type === 'ultimate')
                            ) {
                                implantNames[slot] = implantData.name;
                            }
                        }
                    }
                });
            }

            // Check if similar recommendation already exists
            const existing = await AIRecommendationService.findSimilarRecommendation(
                selectedShip.name,
                refitLevel,
                implantNames,
                suggestion.shipRole
            );

            if (existing) {
                setError('A similar recommendation already exists in the community database');
                return;
            }

            const saved = await AIRecommendationService.saveRecommendation({
                ship_name: selectedShip.name,
                ship_refit_level: refitLevel,
                ship_implants: implantNames,
                ship_role: suggestion.shipRole,
                stat_priorities: suggestion.statPriorities,
                stat_bonuses: suggestion.statBonuses,
                set_priorities: suggestion.setPriorities,
                reasoning: suggestion.reasoning,
            });

            if (saved) {
                setCommunityRecommendation(saved);
                setSource('community');
                setError(null);
            } else {
                setError('Failed to save recommendation to community');
            }
        } catch (error) {
            console.error('Error saving recommendation:', error);
            setError('Failed to save recommendation to community');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedShip, suggestion, source]); // Context functions excluded intentionally

    const handleSelectAlternative = useCallback(async (alternative: AIRecommendation) => {
        setSelectedAlternative(alternative);
        setCommunityRecommendation(alternative);
        setSuggestion({
            shipRole: alternative.ship_role,
            statPriorities: alternative.stat_priorities,
            statBonuses: alternative.stat_bonuses,
            setPriorities: alternative.set_priorities,
            reasoning: alternative.reasoning,
        });

        // Get user's vote on this alternative
        if (alternative.id) {
            const vote = await AIRecommendationService.getUserVote(alternative.id);
            setUserVote(vote);
        }
    }, []);

    const handleBackToMain = useCallback(async () => {
        if (!selectedShip || alternativeRecommendations.length === 0) return;

        setSelectedAlternative(null);

        // Re-fetch the main recommendation
        const actualRefitLevel = selectedShip.refits?.length || 0;
        const refitLevel = actualRefitLevel >= 2 ? 2 : 0;

        // Get implant names inline
        const implantNames: Record<string, string> = {};
        if (selectedShip.implants) {
            Object.entries(selectedShip.implants).forEach(([slot, implantId]) => {
                if (implantId) {
                    const implantPiece = getGearPiece(implantId);
                    if (implantPiece?.setBonus) {
                        const implantData = IMPLANTS[implantPiece.setBonus];
                        if (
                            implantData &&
                            (implantData.type === 'major' || implantData.type === 'ultimate')
                        ) {
                            implantNames[slot] = implantData.name;
                        }
                    }
                }
            });
        }

        const mainRec = await AIRecommendationService.getBestRecommendation(
            selectedShip.name,
            refitLevel,
            implantNames
        );

        if (mainRec) {
            setCommunityRecommendation(mainRec);
            setSuggestion({
                shipRole: mainRec.ship_role,
                statPriorities: mainRec.stat_priorities,
                statBonuses: mainRec.stat_bonuses,
                setPriorities: mainRec.set_priorities,
                reasoning: mainRec.reasoning,
            });

            if (mainRec.id) {
                const vote = await AIRecommendationService.getUserVote(mainRec.id);
                setUserVote(vote);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedShip, alternativeRecommendations.length]); // Context functions excluded intentionally

    // Auto-fetch when ship changes (only depend on ship name to prevent object reference issues)
    useEffect(() => {
        if (selectedShip?.name && selectedShip.name !== lastShipName && !isFetchingRef.current) {
            setLastShipName(selectedShip.name);
            fetchRecommendation();
        }
    }, [selectedShip?.name, lastShipName, fetchRecommendation]);

    return {
        suggestion,
        communityRecommendation,
        alternativeRecommendations,
        showAlternatives,
        selectedAlternative,
        loading,
        error,
        source,
        userVote,
        fetchRecommendation,
        fetchAISuggestion,
        handleVote,
        handleSaveToCommmunity,
        handleSelectAlternative,
        handleBackToMain,
        setShowAlternatives,
        setError,
    };
};
