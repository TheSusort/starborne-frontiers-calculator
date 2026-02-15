import { useEffect, useRef } from 'react';
import { useTutorial } from '../contexts/TutorialContext';

/**
 * Hook for deferred tutorial groups.
 * When a component mounts that hosts a deferred tutorial group,
 * this hook queues the group to start after any active tutorial finishes.
 * Only triggers once per group (tracked via completedGroups).
 */
export function useTutorialTrigger(groupId: string) {
    const { queueGroup, hasCompletedGroup } = useTutorial();
    const hasTriggered = useRef(false);
    // Store latest refs to avoid stale closures without re-running the effect
    const queueGroupRef = useRef(queueGroup);
    const hasCompletedGroupRef = useRef(hasCompletedGroup);
    queueGroupRef.current = queueGroup;
    hasCompletedGroupRef.current = hasCompletedGroup;

    useEffect(() => {
        if (hasCompletedGroupRef.current(groupId)) return;

        // Small delay to let the component render and data-tutorial attributes mount
        const timer = setTimeout(() => {
            if (!hasTriggered.current) {
                hasTriggered.current = true;
                queueGroupRef.current(groupId);
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [groupId]);
}
