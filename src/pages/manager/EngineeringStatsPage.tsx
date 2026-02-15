import React, { useState, useEffect } from 'react';
import { EngineeringStats, EngineeringStat } from '../../types/stats';
import { EngineeringStatsForm } from '../../components/engineering/EngineeringStatsForm';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { PageLayout, CollapsibleForm, Tabs } from '../../components/ui';
import { useNotification } from '../../hooks/useNotification';
import { EngineeringStatsList } from '../../components/engineering/EngineeringStatsList';
import { EngineeringPreviewTab } from '../../components/engineering/EngineeringPreviewTab';
import { Loader } from '../../components/ui/Loader';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { useTutorial } from '../../contexts/TutorialContext';
import { ENGINEERING_TABS_TUTORIAL } from '../../constants/tutorialSteps';

const TABS = [
    { id: 'stats', label: 'Engineering Stats', dataTutorial: 'engineering-tab-stats' },
    { id: 'preview', label: 'Preview Upgrade', dataTutorial: 'engineering-tab-preview' },
];

export const EngineeringStatsPage: React.FC = () => {
    const { engineeringStats, saveEngineeringStats, deleteEngineeringStats, loading } =
        useEngineeringStats();
    const [editingStats, setEditingStats] = useState<EngineeringStat | undefined>();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [activeTab, setActiveTab] = useState('stats');
    const { addNotification } = useNotification();
    const { startGroup, hasCompletedGroup } = useTutorial();

    // Auto-start tutorial on first visit
    useEffect(() => {
        if (!loading && !hasCompletedGroup(ENGINEERING_TABS_TUTORIAL.id)) {
            const timer = setTimeout(() => startGroup(ENGINEERING_TABS_TUTORIAL.id), 500);
            return () => clearTimeout(timer);
        }
    }, [loading, startGroup, hasCompletedGroup]);

    const handleSubmit = (stats: EngineeringStat) => {
        const newEngStats: EngineeringStats = {
            stats: engineeringStats.stats
                .filter((s) => s.shipType !== stats.shipType)
                .concat(stats),
        };
        saveEngineeringStats(newEngStats);
        if (editingStats) {
            addNotification('success', 'Engineering stats updated successfully');
        } else {
            addNotification('success', 'Engineering stats added successfully');
        }
        setEditingStats(undefined);
    };

    const handleDelete = async (shipType: string) => {
        try {
            await deleteEngineeringStats(shipType);
            if (editingStats?.shipType === shipType) {
                setEditingStats(undefined);
            }
        } catch (error) {
            // Error is already handled in the hook
        }
    };

    if (loading) {
        return <Loader />;
    }

    return (
        <>
            <Seo {...SEO_CONFIG.engineering} />
            <PageLayout
                title="Engineering Stats Management"
                description="Manage your engineering stats."
                action={
                    activeTab === 'stats'
                        ? {
                              label: isFormVisible ? 'Hide Form' : 'Create',
                              onClick: () => {
                                  if (editingStats) {
                                      setEditingStats(undefined);
                                  }
                                  setIsFormVisible(!isFormVisible);
                              },
                              variant: isFormVisible ? 'secondary' : 'primary',
                          }
                        : undefined
                }
                tutorialGroupId={ENGINEERING_TABS_TUTORIAL.id}
            >
                <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

                {activeTab === 'stats' && (
                    <>
                        <CollapsibleForm isVisible={isFormVisible || !!editingStats}>
                            <EngineeringStatsForm
                                initialStats={editingStats}
                                onSubmit={(stats) => {
                                    handleSubmit(stats);
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                            />
                        </CollapsibleForm>

                        <div className="space-y-4 ">
                            <EngineeringStatsList
                                stats={engineeringStats.stats}
                                onEdit={(stat: EngineeringStat) => {
                                    setEditingStats(stat);
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                onDelete={handleDelete}
                            />
                        </div>
                    </>
                )}

                {activeTab === 'preview' && <EngineeringPreviewTab />}
            </PageLayout>
        </>
    );
};

export default EngineeringStatsPage;
