import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { SavedAutogearConfig } from '../../types/autogear';
import { AutogearSuggestion } from '../../types/autogearSuggestion';
import { CommunityRecommendation, AIRecommendation } from '../../types/communityRecommendation';
import { RecommendationHeader } from './RecommendationHeader';
import { RecommendationContent } from './RecommendationContent';
import { AlternativeRecommendations } from './AlternativeRecommendations';
import { CommunityActions } from './CommunityActions';
import { ShareRecommendationForm } from './ShareRecommendationForm';
import { CollapsibleAccordion } from '../ui/CollapsibleAccordion';
import { useCommunityRecommendations } from '../../hooks/useCommunityRecommendations';

/**
 * Convert CommunityRecommendation to AIRecommendation format for AlternativeRecommendations
 * The main difference is stat_bonuses uses 'percentage' in CommunityRecommendation but 'weight' in AIRecommendation
 */
const toAIRecommendation = (rec: CommunityRecommendation): AIRecommendation => ({
    id: rec.id,
    ship_name: rec.ship_name,
    ship_refit_level: rec.ship_refit_level,
    ship_implants: {},
    ship_role: rec.ship_role,
    stat_priorities: rec.stat_priorities.map((p) => ({
        stat: p.stat,
        minLimit: p.minLimit,
        maxLimit: p.maxLimit,
    })),
    stat_bonuses: rec.stat_bonuses.map((b) => ({
        stat: b.stat,
        weight: b.percentage,
    })),
    set_priorities: rec.set_priorities.map((s) => ({
        setName: s.setName,
    })),
    reasoning: rec.reasoning || rec.description || '',
    upvotes: rec.upvotes,
    downvotes: rec.downvotes,
    total_votes: rec.total_votes,
    score: rec.score,
    created_by: rec.created_by,
    created_at: rec.created_at,
    updated_at: rec.updated_at,
});

interface CommunityRecommendationsProps {
    selectedShip: Ship | null;
    hasRunAutogear: boolean;
    currentConfig: SavedAutogearConfig | null;
}

export const CommunityRecommendations: React.FC<CommunityRecommendationsProps> = ({
    selectedShip,
    hasRunAutogear,
    currentConfig,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const {
        recommendation,
        alternatives,
        selectedAlternative,
        loading,
        error,
        userVote,
        showShareForm,
        showAlternatives,
        ultimateImplantName,
        handleVote,
        handleShare,
        handleSelectAlternative,
        handleBackToMain,
        setShowShareForm,
        setShowAlternatives,
    } = useCommunityRecommendations({
        selectedShip,
        hasRunAutogear,
        currentConfig,
    });

    if (!selectedShip) {
        return null;
    }

    const currentRecommendation = selectedAlternative || recommendation;

    const suggestionFromRecommendation: AutogearSuggestion | null = currentRecommendation
        ? {
              shipRole: currentRecommendation.ship_role,
              statPriorities: currentRecommendation.stat_priorities.map((p) => ({
                  stat: p.stat,
                  minLimit: p.minLimit,
                  maxLimit: p.maxLimit,
              })),
              statBonuses: currentRecommendation.stat_bonuses.map((b) => ({
                  stat: b.stat,
                  weight: b.percentage,
              })),
              setPriorities: currentRecommendation.set_priorities.map((s) => ({
                  setName: s.setName,
              })),
              reasoning: currentRecommendation.reasoning || currentRecommendation.description || '',
          }
        : null;

    const handleShareSubmit = async (
        title: string,
        description: string,
        isImplantSpecific: boolean
    ): Promise<boolean> => {
        setIsSubmitting(true);
        try {
            const success = await handleShare(title, description, isImplantSpecific);
            return success;
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="mt-4 border border-dark-border overflow-hidden">
            <RecommendationHeader
                recommendation={currentRecommendation}
                loading={loading}
                isExpanded={isExpanded}
                onToggleExpand={() => setIsExpanded(!isExpanded)}
            />

            <CollapsibleAccordion isOpen={isExpanded}>
                {error && (
                    <div className="text-red-400 bg-red-900/20 p-3 border border-red-700">
                        <p className="font-medium">Error: {error}</p>
                    </div>
                )}

                {!loading && !currentRecommendation && !error && (
                    <div className="text-gray-400 text-sm p-4">
                        No community recommendations available for this ship yet.
                    </div>
                )}

                {currentRecommendation && (
                    <div className="space-y-4 p-4">
                        {currentRecommendation.description && (
                            <p className="text-gray-300 text-sm italic">
                                &ldquo;{currentRecommendation.description}&rdquo;
                            </p>
                        )}

                        {suggestionFromRecommendation && (
                            <RecommendationContent suggestion={suggestionFromRecommendation} />
                        )}

                        <AlternativeRecommendations
                            alternatives={alternatives.map(toAIRecommendation)}
                            showAlternatives={showAlternatives}
                            selectedAlternative={
                                selectedAlternative ? toAIRecommendation(selectedAlternative) : null
                            }
                            onToggleShow={() => setShowAlternatives(!showAlternatives)}
                            onSelectAlternative={(alt) => {
                                const originalAlt = alternatives.find((a) => a.id === alt.id);
                                if (originalAlt) {
                                    handleSelectAlternative(originalAlt);
                                }
                            }}
                            onBackToMain={handleBackToMain}
                        />

                        <CommunityActions
                            recommendation={currentRecommendation}
                            userVote={userVote}
                            hasRunAutogear={hasRunAutogear}
                            showShareForm={showShareForm}
                            onVote={handleVote}
                            onToggleShareForm={() => setShowShareForm(!showShareForm)}
                        />
                    </div>
                )}

                {!loading && !currentRecommendation && hasRunAutogear && !showShareForm && (
                    <div className="p-4 text-center">
                        <p className="text-gray-400 text-sm mb-2">
                            Be the first to share a recommendation for this ship!
                        </p>
                        <CommunityActions
                            recommendation={null}
                            userVote={null}
                            hasRunAutogear={hasRunAutogear}
                            showShareForm={showShareForm}
                            onVote={() => {}}
                            onToggleShareForm={() => setShowShareForm(true)}
                        />
                    </div>
                )}

                {showShareForm && (
                    <div className="p-4 border-t border-dark-border">
                        <h4 className="text-sm font-semibold text-gray-300 mb-3">
                            Share Your Build
                        </h4>
                        <ShareRecommendationForm
                            onSubmit={handleShareSubmit}
                            onCancel={() => setShowShareForm(false)}
                            ultimateImplantName={ultimateImplantName}
                            isSubmitting={isSubmitting}
                        />
                    </div>
                )}
            </CollapsibleAccordion>
        </div>
    );
};
