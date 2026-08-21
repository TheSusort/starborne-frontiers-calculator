export interface AuditArgs {
    seed: number;
    count: number;
}

const DEFAULT_SEED = 1;
/** Raised 10 -> 150 (2026-08-21). At count 10 the differential oracle compared 8 placements out
 *  of 40 and its calibration gate 11 — a sample too small for either to mean much. At 150 it
 *  compares 155 of 600 and the gate 210, for 1.4s -> 13.5s of wall clock. This is a manual audit
 *  tool, not a pre-commit gate; the seconds are worth the sample. */
const DEFAULT_COUNT = 150;

/** Pure: parses `--seed <N>` / `--count <M>`, defaulting to seed=1, count=150. Unrecognized
 *  tokens are ignored (this CLI has no positional args). */
export function parseAuditArgs(argv: string[]): AuditArgs {
    const out: AuditArgs = { seed: DEFAULT_SEED, count: DEFAULT_COUNT };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--seed') out.seed = Number(argv[++i]);
        else if (a === '--count') out.count = Number(argv[++i]);
    }
    return out;
}
