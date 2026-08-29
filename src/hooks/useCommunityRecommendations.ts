import { useState, useEffect, useCallback, useRef } from 'react';
import { Ship } from '../types/ship';
import { SharedAutogearBuild } from '../types/communityRecommendation';
import {
    CommunityRecommendationService,
    InvalidSharedConfigError,
} from '../services/communityRecommendations';
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

    // Always holds the ship name as of the most recent render. An in-flight
    // fetch or vote request tags itself with the id/name it was started for,
    // and checks this ref when it resolves so a response for a since-replaced
    // ship or a since-collapsed/replaced row is discarded rather than rendered
    // under the wrong name.
    const currentShipNameRef = useRef<string | null>(null);
    currentShipNameRef.current = selectedShip?.name ?? null;

    const expandedIdRef = useRef<string | null>(null);
    expandedIdRef.current = expandedId;

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
        if (!selectedShip) return;
        const shipName = selectedShip.name;

        setLoading(true);
        setError(null);
        setBuilds([]);
        setExpandedId(null);
        setUserVote(null);

        try {
            const rows = await CommunityRecommendationService.listForShip(shipName);
            // Discard a response for a ship that is no longer selected — the
            // slot may have been switched to a different ship while this
            // fetch was in flight.
            if (currentShipNameRef.current !== shipName) return;
            // A row whose payload cannot be validated is dropped, not rendered.
            setBuilds(rows.map(toCommunityBuild).filter((b): b is CommunityBuild => b !== null));
        } catch (err) {
            if (currentShipNameRef.current !== shipName) return;
            console.error('Error fetching community recommendations:', err);
            setError('Failed to load community recommendations');
        } finally {
            if (currentShipNameRef.current === shipName) {
                setLoading(false);
            }
        }
    }, [selectedShip]);

    // Votes are per expanded build, so the vote is fetched on expand rather than
    // for every row in the list.
    const toggleExpanded = useCallback(
        (id: string) => {
            const nextExpandedId = expandedId === id ? null : id;
            setExpandedId(nextExpandedId);
            setUserVote(null);
            if (nextExpandedId === id) {
                void CommunityRecommendationService.getUserVote(id).then((vote) => {
                    // Discard a vote fetch for a row that has since been
                    // collapsed or replaced by a different expanded row.
                    if (expandedIdRef.current === id) {
                        setUserVote(vote);
                    }
                });
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

            let result;
            try {
                result = await CommunityRecommendationService.createRecommendation(
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
            } catch (err) {
                console.error('Error sharing recommendation:', err);
                if (err instanceof InvalidSharedConfigError) {
                    setError('This build could not be validated and was not shared.');
                } else {
                    setError('Failed to share recommendation');
                }
                return false;
            }

            if (!result) {
                setError('Failed to share recommendation. Please make sure you are signed in.');
                return false;
            }

            // The share itself already succeeded at this point, so a failure
            // refreshing the list afterward must not be reported as a share
            // failure — it isn't one.
            setShowShareForm(false);
            try {
                await refresh();
            } catch (err) {
                console.error('Error refreshing community recommendations after share:', err);
            }
            return true;
        },
        [selectedShip, currentBuild, ultimateImplantName, activeProfileId, refresh]
    );

    useEffect(() => {
        if (selectedShip?.name && selectedShip.name !== lastShipName) {
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
