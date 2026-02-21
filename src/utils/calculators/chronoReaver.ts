export type CRRarity = 'none' | 'epic' | 'legendary';

export interface CRSimulationInput {
    chargesRequired: number;
    crRarity: CRRarity;
    activeSkillPercent: number;
    chargedSkillPercent: number;
    rounds: number;
}

export interface CRRoundData {
    round: number;
    startCharges: number;
    action: 'active' | 'charged';
    crProc: boolean;
    wastedProc: boolean;
    endCharges: number;
    damage: number;
    totalDamage: number;
}

export interface CRSummary {
    avgDamagePerRound: number;
    chargedFrequency: number;
    totalProcs: number;
    wastedProcs: number;
    dpsIncreasePercent: number;
}

export interface CRSimulationResult {
    rounds: CRRoundData[];
    summary: CRSummary;
}

function isCRProcTurn(round: number, rarity: CRRarity): boolean {
    if (rarity === 'none') return false;
    if (rarity === 'legendary') return round % 2 === 0;
    if (rarity === 'epic') return round % 3 === 0;
    return false;
}

export function simulateChronoReaver(input: CRSimulationInput): CRSimulationResult {
    const {
        chargesRequired,
        crRarity,
        activeSkillPercent,
        chargedSkillPercent,
        rounds: numRounds,
    } = input;

    const roundData: CRRoundData[] = [];
    let charges = 0;
    let totalDamage = 0;

    for (let r = 1; r <= numRounds; r++) {
        const startCharges = charges;
        let action: 'active' | 'charged';
        let damage: number;

        if (charges >= chargesRequired) {
            action = 'charged';
            damage = chargedSkillPercent;
            charges = 0;
        } else {
            action = 'active';
            damage = activeSkillPercent;
            charges += 1;
        }

        const crProc = isCRProcTurn(r, crRarity);
        let wastedProc = false;

        if (crProc) {
            if (charges < chargesRequired) {
                charges += 1;
            } else {
                wastedProc = true;
            }
        }

        totalDamage += damage;

        roundData.push({
            round: r,
            startCharges,
            action,
            crProc,
            wastedProc,
            endCharges: charges,
            damage,
            totalDamage,
        });
    }

    const chargedCount = roundData.filter((r) => r.action === 'charged').length;
    const totalProcs = roundData.filter((r) => r.crProc).length;
    const wastedProcs = roundData.filter((r) => r.wastedProc).length;

    const baselineResult =
        crRarity !== 'none' ? simulateChronoReaver({ ...input, crRarity: 'none' }) : null;
    const baselineAvg = baselineResult
        ? baselineResult.summary.avgDamagePerRound
        : totalDamage / numRounds;

    const avgDamagePerRound = totalDamage / numRounds;
    const dpsIncreasePercent = baselineResult
        ? ((avgDamagePerRound - baselineAvg) / baselineAvg) * 100
        : 0;

    return {
        rounds: roundData,
        summary: {
            avgDamagePerRound,
            chargedFrequency: chargedCount > 0 ? numRounds / chargedCount : 0,
            totalProcs,
            wastedProcs,
            dpsIncreasePercent,
        },
    };
}
