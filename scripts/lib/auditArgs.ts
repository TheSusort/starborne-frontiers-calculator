export interface AuditArgs {
    seed: number;
    count: number;
}

const DEFAULT_SEED = 1;
const DEFAULT_COUNT = 10;

/** Pure: parses `--seed <N>` / `--count <M>`, defaulting to seed=1, count=10. Unrecognized
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
