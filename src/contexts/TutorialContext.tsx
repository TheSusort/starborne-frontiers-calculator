import React, {
    createContext,
    useContext,
    useState,
    useCallback,
    useRef,
    useEffect,
    useMemo,
} from 'react';
import { ALL_TUTORIAL_GROUPS, TutorialGroup, TutorialStep } from '../constants/tutorialSteps';
import { supabase } from '../config/supabase';
import { useAuth } from './AuthProvider';

const STORAGE_KEY = 'tutorial_completed_groups';

interface TutorialContextValue {
    activeGroup: TutorialGroup | null;
    activeStepIndex: number;
    activeStep: TutorialStep | null;
    isTutorialActive: boolean;
    startGroup: (groupId: string, force?: boolean) => void;
    startTour: (groupIds: string[]) => void;
    nextStep: () => void;
    skipTutorial: () => void;
    hasCompletedGroup: (groupId: string) => boolean;
    resetAll: () => void;
    queueGroup: (groupId: string) => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

function loadCompletedGroups(): Set<string> {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return new Set(JSON.parse(stored) as string[]);
        }
    } catch {
        // ignore
    }
    return new Set();
}

function saveCompletedGroups(groups: Set<string>) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...groups]));
}

async function loadCompletedGroupsFromSupabase(userId: string): Promise<string[]> {
    const { data, error } = await supabase
        .from('users')
        .select('tutorial_completed_groups')
        .eq('id', userId)
        .single();

    if (error || !data?.tutorial_completed_groups) return [];
    return data.tutorial_completed_groups;
}

async function saveCompletedGroupsToSupabase(userId: string, groups: Set<string>) {
    const { error } = await supabase
        .from('users')
        .update({ tutorial_completed_groups: [...groups] })
        .eq('id', userId);

    if (error) {
        console.error('Error saving tutorial completed groups to Supabase:', error);
    }
}

function findGroup(groupId: string): TutorialGroup | undefined {
    return ALL_TUTORIAL_GROUPS.find((g) => g.id === groupId);
}

export const TutorialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [completedGroups, setCompletedGroups] = useState<Set<string>>(loadCompletedGroups);
    const [activeGroup, setActiveGroup] = useState<TutorialGroup | null>(null);
    const [activeStepIndex, setActiveStepIndex] = useState(0);
    const pendingGroupsRef = useRef<string[]>([]);
    const [isMigrating, setIsMigrating] = useState(false);
    const supabaseLoadedRef = useRef(false);

    // Listen for migration start/end events
    useEffect(() => {
        const handleMigrationStart = () => setIsMigrating(true);
        const handleMigrationEnd = () => setIsMigrating(false);

        window.addEventListener('app:migration:start', handleMigrationStart);
        window.addEventListener('app:migration:end', handleMigrationEnd);

        return () => {
            window.removeEventListener('app:migration:start', handleMigrationStart);
            window.removeEventListener('app:migration:end', handleMigrationEnd);
        };
    }, []);

    // Load from Supabase on sign-in and merge with localStorage
    useEffect(() => {
        if (!user?.id || isMigrating) {
            supabaseLoadedRef.current = false;
            return;
        }

        let cancelled = false;

        const loadAndMerge = async () => {
            const remoteGroups = await loadCompletedGroupsFromSupabase(user.id);
            if (cancelled) return;

            setCompletedGroups((prev) => {
                const merged = new Set([...prev, ...remoteGroups]);
                // If Supabase had fewer, push the merged set back
                if (merged.size > remoteGroups.length) {
                    void saveCompletedGroupsToSupabase(user.id, merged);
                }
                saveCompletedGroups(merged);
                return merged;
            });
            supabaseLoadedRef.current = true;
        };

        void loadAndMerge();

        return () => {
            cancelled = true;
        };
    }, [user?.id, isMigrating]);

    // Persist completed groups to localStorage + Supabase
    useEffect(() => {
        saveCompletedGroups(completedGroups);

        if (user?.id && supabaseLoadedRef.current && completedGroups.size > 0) {
            void saveCompletedGroupsToSupabase(user.id, completedGroups);
        }
    }, [completedGroups, user?.id]);

    const completeCurrentGroup = useCallback(() => {
        if (activeGroup) {
            setCompletedGroups((prev) => {
                const next = new Set(prev);
                next.add(activeGroup.id);
                return next;
            });
        }
        setActiveGroup(null);
        setActiveStepIndex(0);

        // Start next queued group if any
        const nextGroupId = pendingGroupsRef.current.shift();
        if (nextGroupId) {
            const group = findGroup(nextGroupId);
            if (group) {
                // Use setTimeout to avoid state update during render
                setTimeout(() => {
                    setActiveGroup(group);
                    setActiveStepIndex(0);
                }, 300);
            }
        }
    }, [activeGroup]);

    const startGroup = useCallback(
        (groupId: string, force = false) => {
            if (!force && completedGroups.has(groupId)) return;
            if (activeGroup && activeGroup.id === groupId) return;

            const group = findGroup(groupId);
            if (!group) return;

            if (activeGroup && !force) {
                // Queue it if another group is active
                if (!pendingGroupsRef.current.includes(groupId)) {
                    pendingGroupsRef.current.push(groupId);
                }
                return;
            }

            // Clear stale pending groups when force-starting
            if (force) {
                pendingGroupsRef.current = [];
            }

            setActiveGroup(group);
            setActiveStepIndex(0);
        },
        [completedGroups, activeGroup]
    );

    const queueGroup = useCallback(
        (groupId: string) => {
            if (completedGroups.has(groupId)) return;
            if (activeGroup?.id === groupId) return;

            if (activeGroup) {
                if (!pendingGroupsRef.current.includes(groupId)) {
                    pendingGroupsRef.current.push(groupId);
                }
            } else {
                startGroup(groupId);
            }
        },
        [completedGroups, activeGroup, startGroup]
    );

    const startTour = useCallback((groupIds: string[]) => {
        if (groupIds.length === 0) return;

        // Clear any pending groups
        pendingGroupsRef.current = [];

        // Force-start the first group
        const firstGroup = findGroup(groupIds[0]);
        if (!firstGroup) return;

        setActiveGroup(firstGroup);
        setActiveStepIndex(0);

        // Queue remaining groups
        for (let i = 1; i < groupIds.length; i++) {
            const group = findGroup(groupIds[i]);
            if (group) {
                pendingGroupsRef.current.push(groupIds[i]);
            }
        }
    }, []);

    const activeGroupRef = useRef(activeGroup);
    activeGroupRef.current = activeGroup;

    const nextStep = useCallback(() => {
        const group = activeGroupRef.current;
        if (!group) return;

        setActiveStepIndex((prev) => {
            if (prev < group.steps.length - 1) {
                return prev + 1;
            }
            // Schedule group completion outside the state updater
            setTimeout(() => completeCurrentGroup(), 0);
            return prev;
        });
    }, [completeCurrentGroup]);

    const skipTutorial = useCallback(() => {
        completeCurrentGroup();
    }, [completeCurrentGroup]);

    const hasCompletedGroup = useCallback(
        (groupId: string) => completedGroups.has(groupId),
        [completedGroups]
    );

    const resetAll = useCallback(() => {
        setCompletedGroups(new Set());
        setActiveGroup(null);
        setActiveStepIndex(0);
        pendingGroupsRef.current = [];
        localStorage.removeItem(STORAGE_KEY);
        if (user?.id) {
            void saveCompletedGroupsToSupabase(user.id, new Set());
        }
    }, [user?.id]);

    const activeStep = activeGroup ? (activeGroup.steps[activeStepIndex] ?? null) : null;

    const contextValue = useMemo(
        () => ({
            activeGroup,
            activeStepIndex,
            activeStep,
            isTutorialActive: activeGroup !== null,
            startGroup,
            startTour,
            nextStep,
            skipTutorial,
            hasCompletedGroup,
            resetAll,
            queueGroup,
        }),
        [
            activeGroup,
            activeStepIndex,
            activeStep,
            startGroup,
            startTour,
            nextStep,
            skipTutorial,
            hasCompletedGroup,
            resetAll,
            queueGroup,
        ]
    );

    return <TutorialContext.Provider value={contextValue}>{children}</TutorialContext.Provider>;
};

export const useTutorial = (): TutorialContextValue => {
    const context = useContext(TutorialContext);
    if (!context) {
        throw new Error('useTutorial must be used within a TutorialProvider');
    }
    return context;
};
