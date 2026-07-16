import type { ScenarioOverrides } from './traceScenario';

export interface TraceArgs {
    all: boolean;
    names: string[];
    overrides: ScenarioOverrides & { refitLevel?: 0 | 2 | 4 };
    outSuffix?: string;
}

// Flags: --all | --hp-scale <n> | --crit <n> | --enemy-attack-scale <n>
//        | --enemy-affinity <chemical|electric|thermal|antimatter> | --fragile-ally
//        | --refit <0|2|4> | --rounds <n> | --out-suffix <str>
// Bare tokens (not starting with --) are ship names.
export function parseTraceArgs(argv: string[]): TraceArgs {
    const out: TraceArgs = { all: false, names: [], overrides: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = (): string => argv[++i];
        switch (a) {
            case '--all':
                out.all = true;
                break;
            case '--hp-scale':
                out.overrides.reviewedHpScale = Number(next());
                break;
            case '--crit':
                out.overrides.reviewedCrit = Number(next());
                break;
            case '--enemy-attack-scale':
                out.overrides.enemyAttackScale = Number(next());
                break;
            case '--enemy-affinity':
                out.overrides.enemyAffinity = next() as ScenarioOverrides['enemyAffinity'];
                break;
            case '--fragile-ally':
                out.overrides.includeFragileAlly = true;
                break;
            case '--refit':
                out.overrides.refitLevel = Number(next()) as 0 | 2 | 4;
                break;
            case '--rounds':
                out.overrides.rounds = Number(next());
                break;
            case '--out-suffix':
                out.outSuffix = next();
                break;
            default:
                if (!a.startsWith('--')) out.names.push(a);
                break;
        }
    }
    return out;
}
