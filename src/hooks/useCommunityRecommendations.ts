import { useState, useEffect, useCallback, useRef } from 'react';
import { Ship } from '../types/ship';
import { SharedAutogearBuild } from '../types/communityRecommendation';
import { CommunityRecommendationService } from '../services/communityRecommendations';
import {
    toCommunityBuild,
    type CommunityBuild,
    type CommunityBuildSort,
} from '../utils/communityBuild';
import { IMPLANTS } from '../constants/implants';
import { useInventory } from '../contexts/InventoryProvider';
import { useActiveProfile } from '../contexts/ActiveProfileProvider';

interface UseCommunityRecommendationsProps {
    selectedShip: Ship | null;
    /** The user's current build for this ship, or null when no role is set. */
    currentBuild: SharedAutogearBuild | null;
}

interface UseCommunityRecommendationsReturn {
    builds: CommunityBuild[];
    loading: boolean;
    error: string | null;
    expandedId: string | null;
    toggleExpanded: (id: string) => void;
    sort: CommunityBuildSort;
    setSort: (sort: CommunityBuildSort) => void;
    userVote: 'upvote' | 'downvote' | null;
    handleVote: (voteType: 'upvote' | 'downvote') => Promise<void>;
    showShareForm: boolean;
    setShowShareForm: (show: boolean) => void;
    ultimateImplantName: string | null;
    canShare: boolean;
    handleShare: (
        title: string,
        description: string,
        isImplantSpecific: boolean
    ) => Promise<boolean>;
}

export const useCommunityRecommendations = ({
    selectedShip,
    currentBuild,
}: UseCommunityRecommendationsProps): UseCommunityRecommendationsReturn => {
    const { getGearPiece } = useInventory();
    const { activeProfileId } = useActiveProfile();

    const canShare = !!selectedShip && !!currentBuild;

    const [builds, setBuilds] = useState<CommunityBuild[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [sort, setSort] = useState<CommunityBuildSort>('top');
    const [userVote, setUserVote] = useState<'upvote' | 'downvote' | null>(null);
    const [showShareForm, setShowShareForm] = useState(false);
    const [lastShipName, setLastShipName] = useState<string | null>(null);

    const isFetchingRef = useRef(false);

    const getUltimateImplantName = useCallback((): string | null => {
        if (!selectedShip?.implants?.['implant_ultimate']) {
            return null;
        }

        const implantPiece = getGearPiece(selectedShip.implants['implant_ultimate']);
        if (!implantPiece?.setBonus) {
            return null;
        }

        const implantData = IMPLANTS[implantPiece.setBonus];
        return implantData && implantData.type === 'ultimate' ? implantData.name : null;
    }, [selectedShip, getGearPiece]);

    const ultimateImplantName = getUltimateImplantName();

    const fetchBuilds = useCallback(async () => {
        if (!selectedShip || isFetchingRef.current) return;

        isFetchingRef.current = true;
        setLoading(true);
        setError(null);
        setBuilds([]);
        setExpandedId(null);
        setUserVote(null);

        try {
            const rows = await CommunityRecommendationService.listForShip(selectedShip.name);
            // A row whose payload cannot be validated is dropped, not rendered.
            setBuilds(rows.map(toCommunityBuild).filter((b): b is CommunityBuild => b !== null));
        } catch (err) {
            console.error('Error fetching community recommendations:', err);
            setError('Failed to load community recommendations');
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
        }
    }, [selectedShip]);

    // Votes are per expanded build, so the vote is fetched on expand rather than
    // for every row in the list.
    const toggleExpanded = useCallback(
        (id: string) => {
            setExpandedId((current) => (current === id ? null : id));
            setUserVote(null);
            if (expandedId !== id) {
                void CommunityRecommendationService.getUserVote(id).then(setUserVote);
            }
        },
        [expandedId]
    );

    const refresh = useCallback(async () => {
        if (!selectedShip) return;
        const rows = await CommunityRecommendationService.listForShip(selectedShip.name);
        setBuilds(rows.map(toCommunityBuild).filter((b): b is CommunityBuild => b !== null));
    }, [selectedShip]);

    const handleVote = useCallback(
        async (voteType: 'upvote' | 'downvote') => {
            if (!expandedId) return;

            try {
                if (userVote === voteType) {
                    await CommunityRecommendationService.removeVote(expandedId);
                    setUserVote(null);
                } else {
                    await CommunityRecommendationService.voteOnRecommendation(expandedId, voteType);
                    setUserVote(voteType);
                }
                await refresh();
            } catch (err) {
                console.error('Error voting:', err);
            }
        },
        [expandedId, userVote, refresh]
    );

    const handleShare = useCallback(
        async (
            title: string,
            description: string,
            isImplantSpecific: boolean
        ): Promise<boolean> => {
            if (!selectedShip || !currentBuild) {
                setError('No configuration to share');
                return false;
            }

            if (isImplantSpecific && !ultimateImplantName) {
                setError('Cannot mark as implant-specific without an ultimate implant equipped');
                return false;
            }

            if (!activeProfileId) {
                setError('No active profile. Please sign in to share a recommendation.');
                return false;
            }

            try {
                const result = await CommunityRecommendationService.createRecommendation(
                    {
                        shipName: selectedShip.name,
                        shipRefitLevel: selectedShip.refits?.length ?? 0,
                        title,
                        description,
                        isImplantSpecific,
                        ultimateImplant: isImplantSpecific
                            ? (ultimateImplantName ?? undefined)
                            : undefined,
                        sharedConfig: currentBuild,
                    },
                    // Authorship is per active profile, so alt profiles can share
                    // independently. Voting stays per auth user.
                    activeProfileId
                );

                if (result) {
                    setShowShareForm(false);
                    await refresh();
                    return true;
                }

                setError('Failed to share recommendation. Please make sure you are signed in.');
                return false;
            } catch (err) {
                console.error('Error sharing recommendation:', err);
                setError('Failed to share recommendation');
                return false;
            }
        },
        [selectedShip, currentBuild, ultimateImplantName, activeProfileId, refresh]
    );

    useEffect(() => {
        if (selectedShip?.name && selectedShip.name !== lastShipName && !isFetchingRef.current) {
            setLastShipName(selectedShip.name);
            void fetchBuilds();
        }
    }, [selectedShip?.name, lastShipName, fetchBuilds]);

    return {
        builds,
        loading,
        error,
        expandedId,
        toggleExpanded,
        sort,
        setSort,
        userVote,
        handleVote,
        showShareForm,
        setShowShareForm,
        ultimateImplantName,
        canShare,
        handleShare,
    };
};
