import { useState, useEffect, useCallback, useRef } from 'react';
import { Ship } from '../types/ship';
import { CommunityRecommendation } from '../types/communityRecommendation';
import { CommunityRecommendationService } from '../services/communityRecommendations';
import { SavedAutogearConfig } from '../types/autogear';
import { IMPLANTS } from '../constants/implants';
import { useInventory } from '../contexts/InventoryProvider';

interface UseCommunityRecommendationsProps {
    selectedShip: Ship | null;
    currentConfig: SavedAutogearConfig | null;
}

interface UseCommunityRecommendationsReturn {
    recommendation: CommunityRecommendation | null;
    alternatives: CommunityRecommendation[];
    selectedAlternative: CommunityRecommendation | null;
    loading: boolean;
    error: string | null;
    userVote: 'upvote' | 'downvote' | null;
    showShareForm: boolean;
    showAlternatives: boolean;
    ultimateImplantName: string | null;
    canShare: boolean;
    handleVote: (voteType: 'upvote' | 'downvote') => Promise<void>;
    handleShare: (
        title: string,
        description: string,
        isImplantSpecific: boolean
    ) => Promise<boolean>;
    handleSelectAlternative: (alt: CommunityRecommendation) => void;
    handleBackToMain: () => Promise<void>;
    setShowShareForm: (show: boolean) => void;
    setShowAlternatives: (show: boolean) => void;
    refreshRecommendation: () => Promise<void>;
}

export const useCommunityRecommendations = ({
    selectedShip,
    currentConfig,
}: UseCommunityRecommendationsProps): UseCommunityRecommendationsReturn => {
    const { getGearPiece } = useInventory();

    // Check if there's a shareable config (has a ship and role configured)
    const canShare = !!selectedShip && !!currentConfig && !!currentConfig.shipRole;

    const [recommendation, setRecommendation] = useState<CommunityRecommendation | null>(null);
    const [alternatives, setAlternatives] = useState<CommunityRecommendation[]>([]);
    const [selectedAlternative, setSelectedAlternative] = useState<CommunityRecommendation | null>(
        null
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userVote, setUserVote] = useState<'upvote' | 'downvote' | null>(null);
    const [showShareForm, setShowShareForm] = useState(false);
    const [showAlternatives, setShowAlternatives] = useState(false);
    const [lastShipName, setLastShipName] = useState<string | null>(null);

    // Use ref to prevent duplicate calls
    const isFetchingRef = useRef(false);

    // Get the ultimate implant name from the ship
    const getUltimateImplantName = useCallback((): string | null => {
        if (!selectedShip?.implants?.['implant_ultimate']) {
            return null;
        }

        const implantId = selectedShip.implants['implant_ultimate'];
        const implantPiece = getGearPiece(implantId);

        if (!implantPiece?.setBonus) {
            return null;
        }

        const implantData = IMPLANTS[implantPiece.setBonus];
        if (implantData && implantData.type === 'ultimate') {
            return implantData.name;
        }

        return null;
    }, [selectedShip, getGearPiece]);

    const ultimateImplantName = getUltimateImplantName();

    const fetchRecommendation = useCallback(async () => {
        if (!selectedShip || isFetchingRef.current) return;

        isFetchingRef.current = true;
        setLoading(true);
        setError(null);
        setRecommendation(null);
        setAlternatives([]);
        setShowAlternatives(false);
        setSelectedAlternative(null);
        setUserVote(null);

        try {
            const implantName = getUltimateImplantName();

            // Get best recommendation for this ship
            const bestRec = await CommunityRecommendationService.getBestRecommendation(
                selectedShip.name,
                implantName ?? undefined
            );

            if (bestRec) {
                setRecommendation(bestRec);

                // Get user's vote on this recommendation
                if (bestRec.id) {
                    const vote = await CommunityRecommendationService.getUserVote(bestRec.id);
                    setUserVote(vote);
                }

                // Get alternative recommendations (excluding the best one)
                const alts = await CommunityRecommendationService.getAlternatives(
                    selectedShip.name,
                    implantName ?? undefined,
                    bestRec.id
                );
                setAlternatives(alts);
            }
        } catch (err) {
            console.error('Error fetching community recommendation:', err);
            setError('Failed to load community recommendations');
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedShip]); // Only depend on selectedShip, context functions excluded intentionally

    const handleVote = useCallback(
        async (voteType: 'upvote' | 'downvote') => {
            if (!recommendation?.id) return;

            try {
                if (userVote === voteType) {
                    // Remove vote if clicking same vote (toggle off)
                    await CommunityRecommendationService.removeVote(recommendation.id);
                    setUserVote(null);
                } else {
                    // Add or change vote
                    await CommunityRecommendationService.voteOnRecommendation(
                        recommendation.id,
                        voteType
                    );
                    setUserVote(voteType);
                }

                // Refresh the recommendation to get updated vote counts
                await refreshRecommendation();
            } catch (err) {
                console.error('Error voting:', err);
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [recommendation?.id, userVote] // refreshRecommendation excluded intentionally
    );

    const handleShare = useCallback(
        async (
            title: string,
            description: string,
            isImplantSpecific: boolean
        ): Promise<boolean> => {
            if (!selectedShip || !currentConfig) {
                setError('No configuration to share');
                return false;
            }

            // Validate implant-specific flag
            if (isImplantSpecific && !ultimateImplantName) {
                setError('Cannot mark as implant-specific without an ultimate implant equipped');
                return false;
            }

            try {
                const result = await CommunityRecommendationService.createRecommendation({
                    shipName: selectedShip.name,
                    title,
                    description,
                    isImplantSpecific,
                    ultimateImplant: isImplantSpecific
                        ? (ultimateImplantName ?? undefined)
                        : undefined,
                    shipRole: currentConfig.shipRole || selectedShip.type,
                    statPriorities: currentConfig.statPriorities,
                    statBonuses: currentConfig.statBonuses,
                    setPriorities: currentConfig.setPriorities,
                });

                if (result) {
                    setShowShareForm(false);
                    // Refresh to show the new recommendation
                    await refreshRecommendation();
                    return true;
                } else {
                    setError('Failed to share recommendation. Please make sure you are signed in.');
                    return false;
                }
            } catch (err) {
                console.error('Error sharing recommendation:', err);
                setError('Failed to share recommendation');
                return false;
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selectedShip, currentConfig, ultimateImplantName] // refreshRecommendation excluded intentionally
    );

    const handleSelectAlternative = useCallback((alt: CommunityRecommendation) => {
        setSelectedAlternative(alt);
        setRecommendation(alt);
        setShowAlternatives(false);

        // Get user's vote on this alternative
        if (alt.id) {
            CommunityRecommendationService.getUserVote(alt.id).then((vote) => {
                setUserVote(vote);
            });
        }
    }, []);

    const handleBackToMain = useCallback(async () => {
        if (!selectedShip) return;

        setSelectedAlternative(null);

        // Re-fetch the main (best) recommendation
        const implantName = getUltimateImplantName();
        const mainRec = await CommunityRecommendationService.getBestRecommendation(
            selectedShip.name,
            implantName ?? undefined
        );

        if (mainRec) {
            setRecommendation(mainRec);

            if (mainRec.id) {
                const vote = await CommunityRecommendationService.getUserVote(mainRec.id);
                setUserVote(vote);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedShip]); // Context functions excluded intentionally

    const refreshRecommendation = useCallback(async () => {
        if (!selectedShip) return;

        const implantName = getUltimateImplantName();

        // If we have a selected alternative, refresh that specific one
        if (selectedAlternative?.id) {
            // Re-fetch alternatives to get updated vote counts
            const alts = await CommunityRecommendationService.getAlternatives(
                selectedShip.name,
                implantName ?? undefined
            );
            setAlternatives(alts);

            // Find the updated version of the selected alternative
            const updatedAlt = alts.find((a) => a.id === selectedAlternative.id);
            if (updatedAlt) {
                setSelectedAlternative(updatedAlt);
                setRecommendation(updatedAlt);
            }
        } else {
            // Refresh the main recommendation
            const bestRec = await CommunityRecommendationService.getBestRecommendation(
                selectedShip.name,
                implantName ?? undefined
            );

            if (bestRec) {
                setRecommendation(bestRec);

                // Also refresh alternatives
                const alts = await CommunityRecommendationService.getAlternatives(
                    selectedShip.name,
                    implantName ?? undefined,
                    bestRec.id
                );
                setAlternatives(alts);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedShip, selectedAlternative?.id]); // Context functions excluded intentionally

    // Auto-fetch when ship changes (only depend on ship name to prevent object reference issues)
    useEffect(() => {
        if (selectedShip?.name && selectedShip.name !== lastShipName && !isFetchingRef.current) {
            setLastShipName(selectedShip.name);
            fetchRecommendation();
        }
    }, [selectedShip?.name, lastShipName, fetchRecommendation]);

    return {
        recommendation,
        alternatives,
        selectedAlternative,
        loading,
        error,
        userVote,
        showShareForm,
        showAlternatives,
        ultimateImplantName,
        canShare,
        handleVote,
        handleShare,
        handleSelectAlternative,
        handleBackToMain,
        setShowShareForm,
        setShowAlternatives,
        refreshRecommendation,
    };
};
