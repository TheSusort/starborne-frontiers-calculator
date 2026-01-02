/* eslint-disable no-console */
export interface PerformanceTimer {
    name: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    children: PerformanceTimer[];
    callCount: number;
    totalTime: number;
}

export class PerformanceTracker {
    private timers: Map<string, PerformanceTimer> = new Map();
    private currentTimer?: PerformanceTimer;
    private stack: (PerformanceTimer | undefined)[] = [];
    private enabled: boolean = true;
    private overallStartTime?: number;
    // Cache performance.now() result to reduce calls in tight loops
    private cachedNow?: number;
    private cacheValid: boolean = false;

    startTimer(name: string): void {
        if (!this.enabled) return;

        // Cache performance.now() for this tick to reduce calls
        if (!this.cacheValid) {
            this.cachedNow = performance.now();
            this.cacheValid = true;
        }

        // Track the very first timer as the overall start time
        if (!this.overallStartTime) {
            this.overallStartTime = this.cachedNow;
        }

        let timer = this.timers.get(name);
        if (!timer) {
            timer = {
                name,
                startTime: this.cachedNow!,
                children: [],
                callCount: 0,
                totalTime: 0,
            };
            this.timers.set(name, timer);
        }

        timer.callCount++;
        timer.startTime = this.cachedNow!;

        // Only add to parent if this is a new timer instance (not reused)
        // Optimize: use Set for O(1) lookup instead of includes() which is O(n)
        if (this.currentTimer) {
            // Use a WeakSet would be ideal but we need to track children, so keep array
            // but only check if timer is already in children to avoid duplicates
            if (!this.currentTimer.children.includes(timer)) {
                this.currentTimer.children.push(timer);
            }
        }

        this.stack.push(this.currentTimer);
        this.currentTimer = timer;
    }

    endTimer(name: string): void {
        if (!this.enabled) return;

        const timer = this.timers.get(name);
        if (!timer) {
            return; // Silently ignore missing timers
        }

        // Invalidate cache and get fresh time for end measurement
        this.cacheValid = false;
        const endTime = performance.now();

        timer.endTime = endTime;
        timer.duration = endTime - timer.startTime;
        timer.totalTime += timer.duration;

        // Restore the previous timer from the stack
        this.currentTimer = this.stack.pop();
    }

    getTimer(name: string): PerformanceTimer | undefined {
        return this.timers.get(name);
    }

    getAllTimers(): PerformanceTimer[] {
        return Array.from(this.timers.values());
    }

    printSummary(): void {
        if (!this.enabled) return;

        console.group('🚀 Autogear Performance Summary');

        // Only show timers that were actually called and took significant time
        const significantTimers = this.getAllTimers()
            .filter((timer) => timer.callCount > 0 && timer.totalTime > 1) // Only show timers that took more than 1ms
            .sort((a, b) => b.totalTime - a.totalTime);

        if (significantTimers.length === 0) {
            console.log('No significant timing data collected');
            console.groupEnd();
            return;
        }

        // Show top-level timers only
        const topLevelTimers = significantTimers.filter(
            (timer) =>
                !timer.name.includes('Fitness_') &&
                !timer.name.includes('Generation_') &&
                !timer.name.includes('CalculateTotalStats_Inner') &&
                !timer.name.includes('CalculatePriorityScore_Inner')
        );

        topLevelTimers.forEach((timer) => {
            const avgTime = timer.totalTime / timer.callCount;
            console.log(
                `${timer.name}: ${timer.totalTime.toFixed(1)}ms (${timer.callCount} calls, ${avgTime.toFixed(2)}ms avg)`
            );
        });

        // Show fitness evaluation summary if it exists
        const fitnessTimers = significantTimers.filter((timer) =>
            timer.name.includes('CalculateFitness')
        );
        if (fitnessTimers.length > 0) {
            const totalFitnessTime = fitnessTimers.reduce((sum, timer) => sum + timer.totalTime, 0);
            const totalFitnessCalls = fitnessTimers.reduce(
                (sum, timer) => sum + timer.callCount,
                0
            );
            const avgFitnessTime = totalFitnessTime / totalFitnessCalls;
            console.log(
                `Fitness Evaluations: ${totalFitnessTime.toFixed(1)}ms (${totalFitnessCalls} calls, ${avgFitnessTime.toFixed(2)}ms avg)`
            );
        }

        // Show stats calculation summary if it exists
        const statsTimers = significantTimers.filter((timer) =>
            timer.name.includes('CalculateTotalStats')
        );
        if (statsTimers.length > 0) {
            const totalStatsTime = statsTimers.reduce((sum, timer) => sum + timer.totalTime, 0);
            const totalStatsCalls = statsTimers.reduce((sum, timer) => sum + timer.callCount, 0);
            const avgStatsTime = totalStatsTime / totalStatsCalls;
            console.log(
                `Stats Calculations: ${totalStatsTime.toFixed(1)}ms (${totalStatsCalls} calls, ${avgStatsTime.toFixed(2)}ms avg)`
            );
        }

        // Calculate actual wall-clock time from the overall start time
        const actualTotalTime = this.overallStartTime
            ? performance.now() - this.overallStartTime
            : 0;
        console.log(`\n⏱️  Total Time: ${actualTotalTime.toFixed(1)}ms`);
        console.groupEnd();
    }

    reset(): void {
        this.timers.clear();
        this.currentTimer = undefined;
        this.stack = [];
        this.overallStartTime = undefined;
        this.cachedNow = undefined;
        this.cacheValid = false;
    }

    disable(): void {
        this.enabled = false;
    }

    enable(): void {
        this.enabled = true;
    }

    isEnabled(): boolean {
        return this.enabled;
    }
}

// Global instance for easy access
export const performanceTracker = new PerformanceTracker();

// Optionally disable performance tracking in production or when not needed
// Set this to false to disable all performance tracking overhead
// You can also call performanceTracker.disable() at runtime
if (typeof window !== 'undefined') {
    // Check for URL parameter to disable performance tracking
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('disablePerfTracking') === 'true') {
        performanceTracker.disable();
    }

    // Or check localStorage for a persistent setting
    try {
        const disablePerf = localStorage.getItem('disableAutogearPerfTracking');
        if (disablePerf === 'true') {
            performanceTracker.disable();
        }
    } catch (e) {
        // Ignore localStorage errors (e.g., in private browsing)
    }
}
