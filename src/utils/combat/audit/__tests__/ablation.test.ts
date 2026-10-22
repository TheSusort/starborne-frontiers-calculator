import { describe, it, expect, beforeAll } from 'vitest';
import { ablationBoards, computeAblationResult, runAblation } from '../ablation';
import { tagShip } from '../classes';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import { runSeededBattle } from '../../../simulator/seededRuns';
import type { BattleResult, BattleSimulationInput } from '../../../calculators/battleSimulator';
import type { Ship } from '../../../../types/ship';
import type { CombatLogEntry, CombatLogEntryKind } from '../../log/types';
import type { BattleRunner } from '../types';

// Real ships resolved from docs/ship-skills.csv via buildTraceShip, same loader convention
// as classes.test.ts / invariants.test.ts / reproducibility.test.ts.
//
// Hermes (healer whose first passive is "When an ally critically hits an enemy, this Unit gains 1
// charge to its Charged Skill") + Vanguard (attacker, plain damage kit plus a control rider) are a
// plausible combining-changes-behaviour pair. `diverges` is NOT hard-asserted for the real pair
// (RNG-gated on a crit landing within the round budget) — only the result shape and determinism.
function requireCsv(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                'tests need it to resolve real ship skill text.'
        );
    }
}

const real = (name: string): Ship => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} did not resolve`);
    return ship;
};

/** Plain attackers with no interaction primitives: the inert pool the fillers come from. */
const pool = (): Ship[] => ['Crusher', 'Custodian', 'Bedrock'].map(real);

describe('runAblation', () => {
    beforeAll(() => {
        requireCsv();
        for (const s of pool()) expect(tagShip(s).size).toBe(0);
    });

    it('returns an AblationResult shape (boolean diverges, non-empty detail) for a real pair', () => {
        const result = runAblation(real('Hermes'), real('Vanguard'), 1, pool());

        expect(typeof result.diverges).toBe('boolean');
        expect(result.detail.length).toBeGreaterThan(0);
        expect(result.compared).toBe(2);
    });

    it('is deterministic: the same ships + seed give the same result on repeated calls', () => {
        const a = real('Hermes');
        const b = real('Vanguard');
        expect(runAblation(a, b, 7, pool())).toEqual(runAblation(a, b, 7, pool()));
    });

    it('returns a well-formed result for a second, unrelated pair (two plain attackers)', () => {
        const result = runAblation(real('Crusher'), real('Custodian'), 3, pool());

        expect(typeof result.diverges).toBe('boolean');
        expect(result.detail.length).toBeGreaterThan(0);
    });
});

const playerIdOf = (r: BattleResult, name: string): string =>
    r.roster.find((x) => x.side === 'player' && x.name === name)!.actorId;

describe('ablationBoards', () => {
    beforeAll(requireCsv);

    // The RNG stream is keyed by actor id, and the id is minted from the ARRAY INDEX ('attacker'
    // for playerTeam[0], 'p:<id>:<idx>' after it). B sits at index 1 in the combined run, so a
    // baseline that fields B alone (index 0) would re-key every one of its crit and landing rolls.
    it('gives each ship the same actor id in its baseline as in the combined run', () => {
        const a = real('Hermes');
        const b = real('Vanguard');
        const boards = ablationBoards(a, b, real('Crusher'));
        const combined = runSeededBattle(boards.combined, 1);
        const baseA = runSeededBattle(boards.baselineA, 1);
        const baseB = runSeededBattle(boards.baselineB, 1);

        expect(playerIdOf(combined, b.name)).not.toBe('attacker');
        expect(playerIdOf(baseB, b.name)).toBe(playerIdOf(combined, b.name));
        expect(playerIdOf(baseA, a.name)).toBe(playerIdOf(combined, a.name));
        // The stand-ins roll the dice of the ship they replace, too.
        expect(playerIdOf(baseA, 'Crusher')).toBe(playerIdOf(combined, b.name));
        expect(playerIdOf(baseB, 'Crusher')).toBe(playerIdOf(combined, a.name));
    });

    it('seats the stand-in with the replaced ship’s stats, affinity, role and id', () => {
        const a = real('Hermes');
        const b = real('Vanguard');
        const filler = real('Crusher');
        const boards = ablationBoards(a, b, filler);
        const standInForA = boards.baselineB.playerTeam[0];
        expect(standInForA.ship.name).toBe(filler.name);
        expect(standInForA.ship.id).toBe(a.id);
        expect(standInForA.position).toBe(boards.combined.playerTeam[0].position);
        expect(standInForA.statOverrides).toEqual(boards.combined.playerTeam[0].statOverrides);
        expect(standInForA.ship.affinity).toBe(a.affinity);
        expect(standInForA.ship.type).toBe(a.type);
    });
});

type Rewrite = (r: BattleResult, aId: string) => BattleResult;

/** A runner that rewrites A's side of the combat log on the named boards, told apart by their
 *  two player ships: combined = [A, B], baselineA = [A, stand-in]. */
function rewriting(
    a: Ship,
    b: Ship,
    rewrites: Partial<Record<'combined' | 'baselineA', Rewrite>>
): BattleRunner {
    return (input: BattleSimulationInput, seed: number) => {
        const r = runSeededBattle(input, seed);
        const [first, second] = input.playerTeam.map((p) => p.ship.name);
        if (first !== a.name) return r;
        const rewrite = second === b.name ? rewrites.combined : rewrites.baselineA;
        return rewrite ? rewrite(r, playerIdOf(r, a.name)) : r;
    };
}

const withEntry = (r: BattleResult, roundIdx: number, e: CombatLogEntry): BattleResult => ({
    ...r,
    combatLog: r.combatLog.map((round, i) =>
        i === roundIdx ? { ...round, startOfRound: [...round.startOfRound, e] } : round
    ),
});

const withoutKind = (r: BattleResult, actorId: string, kind: CombatLogEntryKind): BattleResult => {
    const keep = (es: CombatLogEntry[]): CombatLogEntry[] =>
        es
            .filter((e) => !(e.actorId === actorId && e.kind === kind))
            .map((e) => ({ ...e, reactions: keep(e.reactions ?? []) }));
    return {
        ...r,
        combatLog: r.combatLog.map((round) => ({
            ...round,
            startOfRound: keep(round.startOfRound),
            turns: round.turns.map((t) => ({ ...t, entries: keep(t.entries) })),
            endOfRound: keep(round.endOfRound),
        })),
    };
};

describe('runAblation reads the shared oracle kind policy', () => {
    beforeAll(requireCsv);
    const a = (): Ship => real('Hermes');
    const b = (): Ship => real('Vanguard');

    it('control: Hermes heals in both its baseline and the combined run, so nothing diverges', () => {
        const r = runAblation(a(), b(), 1, pool());
        expect(r.compared).toBe(2);
        expect(r.diverges).toBe(false);
    });

    // A defect planted in A's baseline arm: its heals vanish there, so beside Vanguard it "gains"
    // heal. The oracle must report it — it can still see a positive after the FP suppression.
    it('reports a planted defect', () => {
        const run = rewriting(a(), b(), { baselineA: (r, id) => withoutKind(r, id, 'heal') });
        const r = runAblation(a(), b(), 1, pool(), run);
        expect(r.diverges).toBe(true);
        expect(r.detail).toContain('Hermes gained kinds only present in composition: heal');
    });

    it('ignores a kind gained AFTER the alive window', () => {
        const purge: Rewrite = (r, id) => ({
            ...r,
            combatLog: [
                ...r.combatLog,
                {
                    round: r.rounds.length + 1,
                    startOfRound: [{ kind: 'purge', actorId: id, targets: [], reactions: [] }],
                    turns: [],
                    endOfRound: [],
                },
            ],
        });
        // The fixture must be live: the same planted purge INSIDE the window does diverge.
        const inside: Rewrite = (r, id) =>
            withEntry(r, 0, { kind: 'purge', actorId: id, targets: [], reactions: [] });
        expect(
            runAblation(a(), b(), 1, pool(), rewriting(a(), b(), { combined: inside })).diverges
        ).toBe(true);
        const r = runAblation(a(), b(), 1, pool(), rewriting(a(), b(), { combined: purge }));
        expect(r.compared).toBe(2);
        expect(r.diverges).toBe(false);
    });

    it('counts a resisted debuff in the baseline as the debuff attempt it was', () => {
        const target = (r: BattleResult) => r.roster.find((x) => x.side === 'enemy')!.actorId;
        const attempt =
            (kind: CombatLogEntryKind): Rewrite =>
            (r, id) =>
                withEntry(r, 0, {
                    kind,
                    actorId: id,
                    targets: [{ targetId: target(r) }],
                    reactions: [],
                    note: 'Defense Down II',
                });
        // Hermes casts no debuff of its own, so the two planted rows are the only debuff
        // activity on either board: without the baseline's resist, the combined debuff diverges.
        expect(
            runAblation(a(), b(), 1, pool(), rewriting(a(), b(), { combined: attempt('debuff') }))
                .diverges
        ).toBe(true);
        const run = rewriting(a(), b(), {
            baselineA: attempt('debuff-resisted'),
            combined: attempt('debuff'),
        });
        const r = runAblation(a(), b(), 1, pool(), run);
        expect(r.compared).toBe(2);
        expect(r.diverges).toBe(false);
    });
});

// `computeAblationResult` is the pure divergence logic: no battles, no RNG, just Set-vs-Set
// comparison, so an inverted or always-false/always-true implementation is caught here.
const kinds = (...ks: CombatLogEntryKind[]): Set<CombatLogEntryKind> => new Set(ks);

describe('computeAblationResult (pure divergence logic)', () => {
    it('diverges when a ship gains a kind only present in composition', () => {
        const result = computeAblationResult(
            'ShipA',
            'ShipB',
            kinds('attack'), // solo A
            kinds('attack'), // solo B
            kinds('attack', 'heal'), // combined A — gained 'heal'
            kinds('attack') // combined B
        );

        expect(result.diverges).toBe(true);
        expect(result.detail).toContain('ShipA');
        expect(result.detail).toContain('heal');
    });

    it('diverges when the OTHER ship (B) gains a composition-only kind', () => {
        const result = computeAblationResult(
            'ShipA',
            'ShipB',
            kinds('attack'),
            kinds('attack'),
            kinds('attack'),
            kinds('attack', 'shield')
        );

        expect(result.diverges).toBe(true);
        expect(result.detail).toContain('ShipB');
        expect(result.detail).toContain('shield');
    });

    it('does not diverge when both ships produce identical kind-sets solo and combined', () => {
        const result = computeAblationResult(
            'ShipA',
            'ShipB',
            kinds('attack', 'heal'),
            kinds('attack'),
            kinds('attack', 'heal'),
            kinds('attack')
        );

        expect(result.diverges).toBe(false);
        expect(result.detail).toContain('No divergence');
    });

    it('does not diverge on a gained EXCLUDED kind: it books to the recipient', () => {
        const result = computeAblationResult(
            'ShipA',
            'ShipB',
            kinds('attack'),
            kinds('attack'),
            kinds('attack', 'hot-ticked', 'buff-expired'),
            kinds('attack', 'dot-ticked')
        );

        expect(result.diverges).toBe(false);
    });

    it(
        'does not diverge on a kind LOST in composition (that direction is the differential ' +
            "oracle's concern, not this one's)",
        () => {
            const result = computeAblationResult(
                'ShipA',
                'ShipB',
                kinds('attack', 'heal'),
                kinds('attack'),
                kinds('attack'), // combined A lost 'heal' — not an ablation-oracle divergence
                kinds('attack')
            );

            expect(result.diverges).toBe(false);
        }
    );
});
