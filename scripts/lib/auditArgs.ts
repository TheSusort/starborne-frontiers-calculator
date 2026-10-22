export interface AuditArgs {
    seed: number;
    count: number;
    /** Proceed past a calibration residual instead of exiting. The residual is still printed and
     *  written to the ledger header; the exclusion set is unchanged. */
    allowCalibrationResidual: boolean;
}

const DEFAULT_SEED = 1;
/** At count 10 the differential oracle compared too few placements, and its calibration gate too
 *  few inert ones, for either verdict to mean much. This is a manual audit tool, not a pre-commit
 *  gate; the seconds are worth the sample. */
const DEFAULT_COUNT = 150;

/** Pure: parses `--seed <N>` / `--count <M>` / `--allow-calibration-residual`, defaulting to
 *  seed=1, count=150, residual not allowed. Unrecognized tokens are ignored (this CLI has no
 *  positional args). */
export function parseAuditArgs(argv: string[]): AuditArgs {
    const out: AuditArgs = {
        seed: DEFAULT_SEED,
        count: DEFAULT_COUNT,
        allowCalibrationResidual: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--seed') out.seed = Number(argv[++i]);
        else if (a === '--count') out.count = Number(argv[++i]);
        else if (a === '--allow-calibration-residual') out.allowCalibrationResidual = true;
    }
    return out;
}
