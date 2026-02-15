import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { ALL_TUTORIAL_GROUPS, TutorialGroup, TutorialStep } from '../constants/tutorialSteps';

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
            return new Set(JSON.parse(stored));
        }
    } catch {
        // ignore
    }
    return new Set();
}

function saveCompletedGroups(groups: Set<string>) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...groups]));
}

function findGroup(groupId: string): TutorialGroup | undefined {
    return ALL_TUTORIAL_GROUPS.find((g) => g.id === groupId);
}

export const TutorialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [completedGroups, setCompletedGroups] = useState<Set<string>>(loadCompletedGroups);
    const [activeGroup, setActiveGroup] = useState<TutorialGroup | null>(null);
    const [activeStepIndex, setActiveStepIndex] = useState(0);
    const pendingGroupsRef = useRef<string[]>([]);

    // Persist completed groups to localStorage
    useEffect(() => {
        saveCompletedGroups(completedGroups);
    }, [completedGroups]);

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

    const nextStep = useCallback(() => {
        if (!activeGroup) return;

        if (activeStepIndex < activeGroup.steps.length - 1) {
            setActiveStepIndex((prev) => prev + 1);
        } else {
            completeCurrentGroup();
        }
    }, [activeGroup, activeStepIndex, completeCurrentGroup]);

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
    }, []);

    const activeStep = activeGroup ? (activeGroup.steps[activeStepIndex] ?? null) : null;

    return (
        <TutorialContext.Provider
            value={{
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
            }}
        >
            {children}
        </TutorialContext.Provider>
    );
};

export const useTutorial = (): TutorialContextValue => {
    const context = useContext(TutorialContext);
    if (!context) {
        throw new Error('useTutorial must be used within a TutorialProvider');
    }
    return context;
};
