/**
 * Census: which firing slots in the parsed corpus carry an Echoing Burst (`accumulate-detonate`),
 * and on which pattern.
 *
 * An Echoing Burst on an AoE-pattern skill reaches every covered enemy (the AoE-pattern rule),
 * which `echoingBurstCoveredVictims.integration.test.ts` pins on synthetic skills. Every real
 * carrier today is single-target, so no shipped kit exercises that path. A ship-data refresh that
 * adds a carrier or moves one onto an AoE pattern makes the covered path live for real ships —
 * this file fails then, so the change is measured in game terms rather than discovered.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { selectFiringSkill } from '../../abilities/applyAbilities';
import { parseShipTargeting } from '../../targetingParser';

const FIRING_ACTIONS = ['active', 'charged'] as const;

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and docs/ship-data.json are required (gitignored reference ' +
                'data) — this census must read the real corpus, never a synthetic fallback'
        );
    }
});

/** `ship:slot:pattern` for every firing slot carrying an `accumulate-detonate` ability. */
function echoingBurstCarriers(): string[] {
    const out: string[] = [];
    for (const record of loadShipSkillRecords()) {
        const ship = buildTraceShip(record.name);
        if (!ship) continue;
        const skills = buildShipAbilities(ship);
        const targeting = parseShipTargeting(ship);
        for (const action of FIRING_ACTIONS) {
            const abilities = selectFiringSkill(skills, action)?.abilities ?? [];
            if (!abilities.some((a) => a.config.type === 'accumulate-detonate')) continue;
            const slotTargeting = targeting[action];
            if (!slotTargeting) {
                throw new Error(
                    `${ship.name}:${action} carries Echoing Burst but has no targeting`
                );
            }
            const raw =
                action === 'charged'
                    ? ship.chargedPattern || ship.activePattern
                    : ship.activePattern;
            out.push(`${ship.name}:${action}:${raw}`);
        }
    }
    return out.sort();
}

describe('Echoing Burst carriers in the corpus', () => {
    it('only Valkyrie’s charged carries one, on a single-target pattern', () => {
        expect(
            echoingBurstCarriers(),
            'The set of Echoing Burst carriers or their patterns CHANGED. A carrier on an AoE ' +
                'pattern now inflicts it on every covered enemy (each its own landing roll, Block ' +
                'Debuff / Firewall check and infliction reactions). Check the new kit against ' +
                'that path before updating this list.'
        ).toEqual(['Valkyrie:charged:Pattern-Base']);
    });
});
