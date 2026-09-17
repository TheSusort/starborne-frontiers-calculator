import { describe, it, expect } from 'vitest';
import { metricSeries, suggestedPrimary, buildMetricTable, SIM_METRICS } from '../metricTable';
import { pairedDelta } from '../../../simulator/deltaStats';
import type { CandidateRun } from '../runCandidates';

const run = (
    id: string,
    winners: Array<'player' | 'enemy'>,
    focusDamage: number[]
): CandidateRun => ({
    id,
    focusActorId: 'p:focus:1',
    aggregate: {
        baseSeed: 1,
        count: winners.length,
        roster: [],
        wins: { player: 0, enemy: 0, draw: 0 },
        meanRounds: 0,
        medianRounds: 0,
        perActorMean: {},
        runs: winners.map((winner, i) => ({
            seed: i,
            winner,
            lastRound: 10 + i,
            perActor: {
                'p:focus:1': { damageDealt: focusDamage[i], damageTaken: 100, healingDone: 0 },
                'p:ally:0': { damageDealt: 50, damageTaken: 100, healingDone: 0 },
                'e:foe:0': { damageDealt: 999, damageTaken: 0, healingDone: 0 },
            },
        })),
    },
});

describe('metricSeries', () => {
    it('reads win rate as a per-seed 0/1 indicator', () => {
        expect(metricSeries(run('a', ['player', 'enemy', 'player'], [1, 2, 3]), 'winRate')).toEqual(
            [1, 0, 1]
        );
    });

    it('reads focus damage from the focus actor only', () => {
        expect(metricSeries(run('a', ['player', 'player'], [10, 20]), 'focusDamageDealt')).toEqual([
            10, 20,
        ]);
    });

    it('reads team damage as every player actor, focus included', () => {
        expect(metricSeries(run('a', ['player'], [10]), 'teamDamageDealt')).toEqual([60]);
    });

    // Player index 0 is the bare id 'attacker', not 'p:<shipId>:<i>' (see FOCUS_ID's doc on
    // SeedRunSummary.perActor in seededRuns.ts). A filter written as actorId.startsWith('p:')
    // would drop this actor's 10 damage, reading 50 (just the ally) instead of 60.
    it('counts the bare "attacker" id as a player actor for team damage', () => {
        const withBareAttackerId: CandidateRun = {
            id: 'a',
            focusActorId: 'attacker',
            aggregate: {
                baseSeed: 1,
                count: 1,
                roster: [],
                wins: { player: 0, enemy: 0, draw: 0 },
                meanRounds: 0,
                medianRounds: 0,
                perActorMean: {},
                runs: [
                    {
                        seed: 0,
                        winner: 'player',
                        lastRound: 10,
                        perActor: {
                            attacker: { damageDealt: 10, damageTaken: 100, healingDone: 0 },
                            'p:ally:0': { damageDealt: 50, damageTaken: 100, healingDone: 0 },
                            'e:foe:0': { damageDealt: 999, damageTaken: 0, healingDone: 0 },
                        },
                    },
                ],
            },
        } as unknown as CandidateRun;

        expect(metricSeries(withBareAttackerId, 'teamDamageDealt')).toEqual([60]);
    });
});

describe('suggestedPrimary', () => {
    it('maps each role family to its own metric', () => {
        expect(suggestedPrimary('ATTACKER')).toBe('focusDamageDealt');
        expect(suggestedPrimary('DEFENDER')).toBe('focusDamageTaken');
        expect(suggestedPrimary('DEFENDER_SECURITY')).toBe('focusDamageTaken');
        expect(suggestedPrimary('SUPPORTER')).toBe('focusHealingDone');
        expect(suggestedPrimary('SUPPORTER_SHIELD')).toBe('focusHealingDone');
        expect(suggestedPrimary('DEBUFFER')).toBe('teamDamageDealt');
        expect(suggestedPrimary('DEBUFFER_BOMBER')).toBe('teamDamageDealt');
    });

    it('falls back to team damage for an unknown role', () => {
        expect(suggestedPrimary(undefined)).toBe('teamDamageDealt');
    });
});

describe('buildMetricTable', () => {
    it('scores win rate with the sign test and the rest with the t rule', () => {
        const baseline = run('base', ['enemy', 'enemy', 'enemy', 'enemy'], [10, 10, 10, 10]);
        const candidate = run('cand', ['player', 'player', 'player', 'player'], [20, 21, 19, 20]);
        const [row] = buildMetricTable(baseline, [candidate]);

        expect(row.cells.winRate).toMatchObject(
            pairedDelta(
                metricSeries(baseline, 'winRate'),
                metricSeries(candidate, 'winRate'),
                'binary'
            )
        );
        expect(row.cells.focusDamageDealt).toMatchObject(
            pairedDelta(
                metricSeries(baseline, 'focusDamageDealt'),
                metricSeries(candidate, 'focusDamageDealt'),
                'continuous'
            )
        );
    });

    it('produces a cell for every metric', () => {
        const baseline = run('base', ['player', 'player'], [10, 10]);
        const [row] = buildMetricTable(baseline, [run('cand', ['player', 'player'], [11, 12])]);
        for (const metric of SIM_METRICS) expect(row.cells[metric]).toBeDefined();
    });

    // The two tests above only pin winRate and focusDamageDealt's kind. rounds, focusDamageTaken,
    // focusHealingDone and teamDamageDealt are also 'continuous' (deltaStats.ts's PairedDelta
    // doc), but nothing above would notice one of them being routed through the sign test
    // instead. Every seed here shifts EVERY metric by the identical constant (a win flip plus a
    // +1 round, +5 focus damage dealt, -5 focus damage taken, +5 healing, +5 team damage on all
    // 4 seeds): that constant shift drives se to 0, so the continuous rule reads mean != 0 as
    // distinguishable, while the same all-same-direction 4/4 split reads as a coin flip under the
    // sign test (p = 0.125). The two rules disagree on every metric here, so routing any one of
    // them to the other kind flips that metric's `distinguishable` and fails the loop.
    it('routes every metric through the kind its own definition names', () => {
        const constantShiftRun = (winner: 'player' | 'enemy', lastRound: number): CandidateRun => ({
            id: winner,
            focusActorId: 'p:focus:1',
            aggregate: {
                baseSeed: 1,
                count: 4,
                roster: [],
                wins: { player: 0, enemy: 0, draw: 0 },
                meanRounds: 0,
                medianRounds: 0,
                perActorMean: {},
                runs: Array.from({ length: 4 }, (_, seed) => ({
                    seed,
                    winner,
                    lastRound,
                    perActor: {
                        'p:focus:1': {
                            damageDealt: winner === 'player' ? 105 : 100,
                            damageTaken: winner === 'player' ? 45 : 50,
                            healingDone: winner === 'player' ? 25 : 20,
                        },
                        'p:ally:0': { damageDealt: 30, damageTaken: 0, healingDone: 0 },
                        'e:foe:0': { damageDealt: 999, damageTaken: 0, healingDone: 0 },
                    },
                })),
            },
        });

        const baseline = constantShiftRun('enemy', 10);
        const candidate = constantShiftRun('player', 11);
        const [row] = buildMetricTable(baseline, [candidate]);

        for (const metric of SIM_METRICS) {
            const kind = metric === 'winRate' ? 'binary' : 'continuous';
            expect(row.cells[metric]).toMatchObject(
                pairedDelta(metricSeries(baseline, metric), metricSeries(candidate, metric), kind)
            );
        }
    });
});
