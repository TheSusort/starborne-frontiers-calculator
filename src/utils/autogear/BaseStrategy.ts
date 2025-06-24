import { AutogearStrategy } from './AutogearStrategy';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { StatPriority, GearSuggestion, SetPriority, StatBonus } from '../../types/autogear';
import { ShipTypeName } from '../../constants';
import { EngineeringStat } from '../../types/stats';

export abstract class BaseStrategy implements AutogearStrategy {
    abstract name: string;
    abstract description: string;

    protected progressCallback?: (progress: {
        current: number;
        total: number;
        percentage: number;
    }) => void;
    protected totalOperations: number = 0;
    protected currentOperation: number = 0;
    protected readonly PROGRESS_UPDATE_INTERVAL = 50000;

    abstract findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[],
        tryToCompleteSets?: boolean
    ): Promise<GearSuggestion[]> | GearSuggestion[];

    public setProgressCallback(
        callback: (progress: { current: number; total: number; percentage: number }) => void
    ) {
        this.progressCallback = callback;
    }

    protected updateProgress() {
        if (this.progressCallback && this.totalOperations > 0) {
            const current = Math.min(this.currentOperation, this.totalOperations);
            const percentage = Math.round((current / this.totalOperations) * 100);
            this.progressCallback({
                current,
                total: this.totalOperations,
                percentage,
            });
        }
    }

    protected initializeProgress(total: number) {
        this.totalOperations = total;
        this.currentOperation = 0;
        this.updateProgress();
    }

    protected incrementProgress() {
        this.currentOperation++;
        this.updateProgress();
    }

    protected completeProgress() {
        if (this.progressCallback) {
            this.currentOperation = this.totalOperations;
            this.progressCallback({
                current: this.totalOperations,
                total: this.totalOperations,
                percentage: 100,
            });
        }
    }
}
