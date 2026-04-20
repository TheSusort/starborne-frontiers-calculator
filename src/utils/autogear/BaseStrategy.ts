import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { ShipTypeName } from '../../constants';
import { EngineeringStat } from '../../types/stats';
import { AutogearStrategy, AutogearResult, AutogearProgress } from './AutogearStrategy';

export abstract class BaseStrategy implements AutogearStrategy {
    abstract name: string;
    abstract description: string;

    protected progressCallback?: (progress: AutogearProgress) => void;
    protected totalOperations: number = 0;
    protected currentOperation: number = 0;
    protected lastProgressEmitTime: number = 0;
    protected readonly PROGRESS_THROTTLE_MS = 16; // ~60fps cap
    protected currentAttempt?: number;
    protected maxAttempts?: number;

    abstract findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[],
        tryToCompleteSets?: boolean,
        arenaModifiers?: Record<string, number> | null
    ): Promise<AutogearResult> | AutogearResult;

    public setProgressCallback(callback: (progress: AutogearProgress) => void) {
        this.progressCallback = callback;
    }

    protected updateProgress(force: boolean = false) {
        if (!this.progressCallback || this.totalOperations <= 0) return;
        const now = performance.now();
        if (!force && now - this.lastProgressEmitTime < this.PROGRESS_THROTTLE_MS) return;
        this.lastProgressEmitTime = now;

        const current = Math.min(this.currentOperation, this.totalOperations);
        const percentage = Math.round((current / this.totalOperations) * 100);
        this.progressCallback({
            current,
            total: this.totalOperations,
            percentage,
            attempt: this.currentAttempt,
            maxAttempts: this.maxAttempts,
        });
    }

    protected initializeProgress(total: number) {
        this.totalOperations = total;
        this.currentOperation = 0;
        this.lastProgressEmitTime = 0;
        this.updateProgress(true); // force
    }

    protected incrementProgress() {
        this.currentOperation++;
        this.updateProgress();
    }

    protected completeProgress() {
        if (this.progressCallback) {
            this.currentOperation = this.totalOperations;
            this.lastProgressEmitTime = 0;
            this.progressCallback({
                current: this.totalOperations,
                total: this.totalOperations,
                percentage: 100,
            });
        }
    }
}
