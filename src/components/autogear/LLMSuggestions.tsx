import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { AutogearSuggestion } from '../../types/autogearSuggestion';
import { Button } from '../ui/Button';
import { RecommendationHeader } from './RecommendationHeader';
import { RecommendationContent } from './RecommendationContent';
import { AlternativeRecommendations } from './AlternativeRecommendations';
import { CommunityActions } from './CommunityActions';
import { CollapsibleAccordion } from '../ui/CollapsibleAccordion';
import { useLLMRecommendations } from '../../hooks/useLLMRecommendations';
import { CommunityRecommendation } from '../../types/communityRecommendation';

interface LLMSuggestionsProps {
    selectedShip: Ship | null;
    onApplyConfig?: (config: AutogearSuggestion) => void;
}

export const LLMSuggestions: React.FC<LLMSuggestionsProps> = ({ selectedShip, onApplyConfig }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const {
        suggestion,
        communityRecommendation,
        alternativeRecommendations,
        showAlternatives,
        selectedAlternative,
        loading,
        error,
        source,
        userVote,
        fetchAISuggestion,
        handleVote,
        handleSaveToCommmunity,
        handleSelectAlternative,
        handleBackToMain,
        setShowAlternatives,
        setError,
    } = useLLMRecommendations({ selectedShip });

    const handleRetry = () => {
        setError(null);
        fetchAISuggestion();
    };

    const handleForceAI = async () => {
        setError(null);
        fetchAISuggestion();
    };

    if (!selectedShip) {
        return null;
    }

    return (
        <div className="mt-4 border border-dark-border overflow-hidden">
            <RecommendationHeader
                recommendation={communityRecommendation as CommunityRecommendation | null}
                loading={loading}
                isExpanded={isExpanded}
                onToggleExpand={() => setIsExpanded(!isExpanded)}
            />

            <CollapsibleAccordion isOpen={isExpanded}>
                {error && (
                    <div className="text-red-400 bg-red-900/20 p-3 border border-red-700">
                        <p className="font-medium">Error: {error}</p>
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={handleRetry}
                            className="mt-2"
                        >
                            Retry
                        </Button>
                    </div>
                )}

                {suggestion && (
                    <div className="space-y-4">
                        <RecommendationContent suggestion={suggestion} />

                        {source === 'community' && (
                            <AlternativeRecommendations
                                alternatives={alternativeRecommendations}
                                showAlternatives={showAlternatives}
                                selectedAlternative={selectedAlternative}
                                onToggleShow={() => setShowAlternatives(!showAlternatives)}
                                onSelectAlternative={handleSelectAlternative}
                                onBackToMain={handleBackToMain}
                            />
                        )}

                        <CommunityActions
                            source={source}
                            suggestion={suggestion}
                            communityRecommendation={communityRecommendation}
                            userVote={userVote}
                            onVote={handleVote}
                            onSaveToCommmunity={handleSaveToCommmunity}
                            onApplyConfig={onApplyConfig}
                        />
                    </div>
                )}
            </CollapsibleAccordion>
        </div>
    );
};
