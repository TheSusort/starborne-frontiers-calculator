import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { SharedAutogearBuild } from '../../types/communityRecommendation';
import { CollapsibleAccordion } from '../ui/CollapsibleAccordion';
import { ConfirmModal } from '../ui/layout/ConfirmModal';
import { Button } from '../ui/Button';
import { useCommunityRecommendations } from '../../hooks/useCommunityRecommendations';
import { useTutorialTrigger } from '../../hooks/useTutorialTrigger';
import { useAuth } from '../../contexts/AuthProvider';
import { useActiveProfile } from '../../contexts/ActiveProfileProvider';
import type { CommunityBuild } from '../../utils/communityBuild';
import { RecommendationHeader } from './RecommendationHeader';
import { CommunityBuildList } from './CommunityBuildList';
import { ShareRecommendationForm } from './ShareRecommendationForm';

interface CommunityRecommendationsProps {
    selectedShip: Ship | null;
    currentBuild: SharedAutogearBuild | null;
    /** Null when the page cannot apply (no ship). */
    onApplyBuild: ((build: SharedAutogearBuild) => void) | null;
    /** Whether the ship already has build config that Apply would overwrite. */
    hasExistingConfig: boolean;
}

export const CommunityRecommendations: React.FC<CommunityRecommendationsProps> = ({
    selectedShip,
    currentBuild,
    onApplyBuild,
    hasExistingConfig,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [pendingApply, setPendingApply] = useState<CommunityBuild | null>(null);

    // Votes are one-per-human: gated on the auth user, not the active profile,
    // so alt profiles cannot cast duplicate votes.
    const { user } = useAuth();
    // Authorship is per active profile.
    const { activeProfileId } = useActiveProfile();

    const {
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
    } = useCommunityRecommendations({ selectedShip, currentBuild });

    useTutorialTrigger('autogear-community');

    if (!selectedShip) {
        return null;
    }

    const applyBuild = (build: CommunityBuild) => {
        onApplyBuild?.(build.build);
    };

    // Confirm only when Apply would actually overwrite something.
    const requestApply = (build: CommunityBuild) => {
        if (hasExistingConfig) {
            setPendingApply(build);
            return;
        }
        applyBuild(build);
    };

    const handleShareSubmit = async (
        title: string,
        description: string,
        isImplantSpecific: boolean
    ): Promise<boolean> => {
        setIsSubmitting(true);
        try {
            return await handleShare(title, description, isImplantSpecific);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="mt-4 border border-dark-border overflow-hidden"
            data-tutorial="autogear-community-recommendations"
        >
            <RecommendationHeader
                buildCount={builds.length}
                loading={loading}
                isExpanded={isExpanded}
                onToggleExpand={() => setIsExpanded(!isExpanded)}
            />

            <CollapsibleAccordion isOpen={isExpanded}>
                <div className="p-3 space-y-3">
                    {error && (
                        <div className="text-red-400 bg-red-900/20 border border-red-700 p-2 text-sm">
                            Error: {error}
                        </div>
                    )}

                    {!loading && (
                        <CommunityBuildList
                            builds={builds}
                            equippedUltimateImplant={ultimateImplantName}
                            sort={sort}
                            onSortChange={setSort}
                            expandedId={expandedId}
                            onToggleExpand={toggleExpanded}
                            userVote={userVote}
                            canVote={!!user}
                            canApply={!!onApplyBuild}
                            onVote={(voteType) => void handleVote(voteType)}
                            onApply={requestApply}
                        />
                    )}

                    {!showShareForm && (
                        <div className="pt-2 border-t border-dark-border flex justify-center">
                            {!activeProfileId ? (
                                <span className="text-sm text-theme-text-secondary">
                                    Sign in to share your build
                                </span>
                            ) : canShare ? (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => setShowShareForm(true)}
                                    className="w-full"
                                >
                                    Share your build
                                </Button>
                            ) : (
                                <span className="text-sm text-theme-text-secondary">
                                    Configure autogear settings to share your build
                                </span>
                            )}
                        </div>
                    )}

                    {showShareForm && currentBuild && (
                        <div className="pt-2 border-t border-dark-border">
                            <h4 className="text-sm font-semibold text-theme-text mb-3">
                                Share Your Build
                            </h4>
                            <ShareRecommendationForm
                                build={currentBuild}
                                onSubmit={handleShareSubmit}
                                onCancel={() => setShowShareForm(false)}
                                ultimateImplantName={ultimateImplantName}
                                isSubmitting={isSubmitting}
                            />
                        </div>
                    )}
                </div>
            </CollapsibleAccordion>

            <ConfirmModal
                isOpen={pendingApply !== null}
                onClose={() => setPendingApply(null)}
                onConfirm={() => {
                    if (pendingApply) applyBuild(pendingApply);
                    setPendingApply(null);
                }}
                title="Apply this build?"
                confirmLabel="Apply"
                message={
                    <div className="space-y-2 text-sm">
                        <p>
                            This replaces your role, stat priorities, gear sets, stat bonuses, fleet
                            buffs and implant settings for {selectedShip.name}.
                        </p>
                        <p className="text-theme-text-secondary">
                            Your algorithm choice and gear filters (ignore equipped, ignore
                            unleveled, use upgraded stats, complete sets, calibration, arena
                            modifiers) are not changed.
                        </p>
                    </div>
                }
            />
        </div>
    );
};
