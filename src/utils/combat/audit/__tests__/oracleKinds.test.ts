import { describe, it, expect } from 'vitest';
import {
    EXCLUDED_KINDS,
    diffPersists,
    lastFullAliveRound,
    oracleFingerprint,
    oracleKind,
    restrictDiff,
    windowedDiff,
} from '../oracleKinds';
import { OVERCLOCK_HANGOVER_DEBUFFS } from '../../overclockHangover';
import type { BattleResult } from '../../../calculators/battleSimulator';
import type { CombatLogEntry, CombatLogEntryKind } from '../../log/types';
import type { FingerprintDiff } from '../types';

// Hand-built results: every assertion here is about which rounds and which entries the oracle
// READS, so the fixtures control both exactly. Real-battle coverage of the same policy lives in
// scripts/lib/__tests__/interactionOracle.test.ts.

const SUBJECT = 'p:subject:1';
const ALLY = 'attacker';
const ENEMY = 'e:enemy:0';

type Entry = Pick<CombatLogEntry, 'kind'> & Partial<CombatLogEntry>;

interface RoundSpec {
    /** Entries booked in this round (actorId defaults to the subject). */
    entries?: Entry[];
    /** Who is still alive at the end of this round. Defaults to everyone. */
    alive?: string[];
}

const entry = (e: Entry): CombatLogEntry => ({
    actorId: SUBJECT,
    targets: [{ targetId: ENEMY }],
    reactions: [],
    ...e,
});

function result(rounds: RoundSpec[]): BattleResult {
    const everyone = [SUBJECT, ALLY, ENEMY];
    return {
        rounds: rounds.map((r, i) => ({
            round: i + 1,
            turnOrder: [],
            ships: everyone.map((actorId) => ({
                actorId,
                alive: (r.alive ?? everyone).includes(actorId),
            })),
        })),
        outcome: { winner: 'player', lastRound: rounds.length },
        roster: [
            { actorId: ALLY, side: 'player', name: 'Ally', position: 'T1' },
            { actorId: SUBJECT, side: 'player', name: 'Subject', position: 'T2' },
            { actorId: ENEMY, side: 'enemy', name: 'Enemy', position: 'M2' },
        ],
        combatLog: rounds.map((r, i) => ({
            round: i + 1,
            startOfRound: [],
            turns: [{ actorId: SUBJECT, entries: (r.entries ?? []).map(entry) }],
            endOfRound: [],
        })),
    } as unknown as BattleResult;
}

const attack: Entry = { kind: 'attack' };
const rounds = (n: number, spec: RoundSpec = { entries: [attack] }): RoundSpec[] =>
    Array.from({ length: n }, () => spec);

const diff = (shipBaseline: BattleResult, comp: BattleResult) =>
    windowedDiff(shipBaseline, comp, 'Subject', SUBJECT, SUBJECT);

describe('lastFullAliveRound', () => {
    it('counts every round of a fight that ran to the cap with both sides standing', () => {
        expect(lastFullAliveRound(result(rounds(5)), SUBJECT)).toBe(5);
    });

    it('drops the final round when it ended in a wipe: the ships after the wiping turn never acted', () => {
        const wiped = result([...rounds(2), { entries: [attack], alive: [SUBJECT, ALLY] }]);
        expect(lastFullAliveRound(wiped, SUBJECT)).toBe(2);
    });

    it('stops at the last round the subject saw out alive', () => {
        const r = result([
            ...rounds(2),
            { alive: [ALLY, ENEMY] },
            ...rounds(3, { alive: [ALLY, ENEMY] }),
        ]);
        expect(lastFullAliveRound(r, SUBJECT)).toBe(2);
    });
});

describe('windowedDiff: alive window', () => {
    // The two arms have DIFFERENT lengths: the composition wipes the enemy in round 3, the
    // baseline runs to the cap. The subject heals only in round 4, which the composition never
    // reached — reading all rounds would report the heal "missing in composition".
    const baseline = result([...rounds(3), { entries: [attack, { kind: 'heal' }] }, ...rounds(1)]);
    const comp = result([...rounds(2), { entries: [attack], alive: [SUBJECT, ALLY] }]);

    it('fixture check: the arms differ in length, and over ALL rounds the heal differs', () => {
        expect(baseline.rounds.length).not.toBe(comp.rounds.length);
        expect(oracleFingerprint(baseline, SUBJECT).has('heal')).toBe(true);
        expect(oracleFingerprint(comp, SUBJECT).has('heal')).toBe(false);
    });

    it('compares only the rounds both arms played in full with the subject alive', () => {
        const d = diff(baseline, comp);
        expect(d.window).toBe(2);
        expect(d.comparable).toBe(true);
        expect(d.raw).toBeNull();
        expect(d.restricted).toBeNull();
    });

    it('still reports a kind that differs INSIDE the window', () => {
        const healsEarly = result([{ entries: [attack, { kind: 'heal' }] }, ...rounds(4)]);
        expect(diff(healsEarly, comp).restricted?.missingInComposition).toEqual(['heal']);
    });

    it('is not comparable when the window is shorter than two rounds', () => {
        const diesInRoundTwo = result([...rounds(1), { alive: [ALLY, ENEMY] }]);
        const d = diff(baseline, diesInRoundTwo);
        expect(d.window).toBe(1);
        expect(d.comparable).toBe(false);
    });
});

describe('oracleKind: resist as attempt', () => {
    const baseOf = (kind: CombatLogEntryKind, note: string) =>
        result(rounds(3, { entries: [attack, { kind, note }] }));
    const resisted = (note: string) =>
        result(rounds(3, { entries: [attack, { kind: 'debuff-resisted', note }] }));

    it('a resisted timed debuff counts as the debuff attempt it was', () => {
        expect(
            diff(baseOf('debuff', 'Defense Down II'), resisted('Defense Down II')).raw
        ).toBeNull();
    });

    it('a resisted DoT counts as a DoT attempt, read from the engine resist label', () => {
        expect(
            diff(baseOf('dot-applied', 'inferno III ×1'), resisted('Inferno III')).raw
        ).toBeNull();
        expect(
            diff(baseOf('dot-applied', 'corrosion II ×1'), resisted('Corrosion II')).raw
        ).toBeNull();
        expect(diff(baseOf('dot-applied', 'bomb ×1'), resisted('Bomb')).raw).toBeNull();
        expect(
            diff(baseOf('dot-applied', 'generic ×1'), resisted('Damage over Time')).raw
        ).toBeNull();
    });

    it('a resisted control effect counts as a control attempt, not a debuff', () => {
        expect(diff(baseOf('control', 'stasis'), resisted('Stasis')).raw).toBeNull();
        expect(oracleKind(entry({ kind: 'debuff-resisted', note: 'Provoke' }))).toBe('control');
    });

    // A landed Provoke logs `control` (note `provoke`) plus `debuff` (note `Provoke`); a resisted
    // one logs a single resist. Without folding the debuff row into `control`, landing in one arm
    // and resisting in the other reads as a spurious `debuff`.
    it('a landed control effect and a resisted one fingerprint alike', () => {
        const landed = result(
            rounds(3, {
                entries: [
                    attack,
                    { kind: 'control', note: 'provoke' },
                    { kind: 'debuff', note: 'Provoke' },
                ],
            })
        );
        expect(diff(resisted('Provoke'), landed).raw).toBeNull();
        expect(oracleFingerprint(landed, SUBJECT)).toEqual(new Set(['attack', 'control']));
    });

    it('a named stat debuff stays a debuff', () => {
        expect(oracleKind(entry({ kind: 'debuff', note: 'Defense Down II' }))).toBe('debuff');
    });

    it('a source-less resist books to the RESISTER and stays an excluded debuff-resisted', () => {
        const selfBooked = entry({
            kind: 'debuff-resisted',
            note: 'Defense Down II',
            targets: [{ targetId: SUBJECT }],
        });
        expect(oracleKind(selfBooked)).toBe('debuff-resisted');
        expect(EXCLUDED_KINDS.has('debuff-resisted')).toBe(true);
    });
});

describe('oracleKind: protection share rows', () => {
    it('drops an attack row noted Protection: damage absorbed for an ally, not an attack made', () => {
        const comp = result(rounds(3, { entries: [{ kind: 'attack', note: 'Protection' }] }));
        const baseline = result(rounds(3, { entries: [] }));
        expect(oracleFingerprint(comp, SUBJECT).has('attack')).toBe(false);
        expect(diff(baseline, comp).raw).toBeNull();
    });

    it('keeps an ordinary attack', () => {
        expect(oracleKind(entry({ kind: 'attack' }))).toBe('attack');
    });
});

describe('oracleKind: Overclock hangover rows', () => {
    const selfTarget = [{ targetId: SUBJECT }];

    it.each(OVERCLOCK_HANGOVER_DEBUFFS)(
        'drops %s booked to a holder that is its own sole target',
        (note) => {
            const comp = result(
                rounds(3, { entries: [attack, { kind: 'debuff', note, targets: selfTarget }] })
            );
            const baseline = result(rounds(3, { entries: [attack] }));
            expect(oracleKind(entry({ kind: 'debuff', note, targets: selfTarget }))).toBeNull();
            expect(diff(baseline, comp).raw).toBeNull();
        }
    );

    it('keeps the same debuff inflicted on an enemy: that is the subject acting', () => {
        const note = OVERCLOCK_HANGOVER_DEBUFFS[0];
        expect(oracleKind(entry({ kind: 'debuff', note }))).toBe('debuff');
    });

    it('keeps a self-targeted debuff that is not a hangover debuff', () => {
        expect(
            oracleKind(entry({ kind: 'debuff', note: 'Defense Down II', targets: selfTarget }))
        ).toBe('debuff');
    });
});

describe('EXCLUDED_KINDS', () => {
    it('drops a Repair Over Time tick: it books to the holder, whoever granted it', () => {
        const comp = result(rounds(3, { entries: [attack, { kind: 'hot-ticked' }] }));
        const d = diff(result(rounds(3)), comp);
        expect(d.raw?.extraInComposition).toEqual(['hot-ticked']);
        expect(d.restricted).toBeNull();
    });

    it('keeps granter- and caster-booked kinds: those are the subject acting', () => {
        for (const k of ['buff', 'debuff', 'dot-applied', 'steal', 'heal', 'cleanse'] as const) {
            expect(EXCLUDED_KINDS.has(k)).toBe(false);
        }
    });

    it('restrictDiff keeps the non-excluded half of a mixed diff', () => {
        const raw: FingerprintDiff = {
            actorId: SUBJECT,
            shipName: 'Subject',
            missingInComposition: ['buff-expired', 'heal'],
            extraInComposition: ['dot-ticked'],
        };
        expect(restrictDiff(raw)).toEqual({
            ...raw,
            missingInComposition: ['heal'],
            extraInComposition: [],
        });
    });
});

describe('diffPersists', () => {
    const original: FingerprintDiff = {
        actorId: SUBJECT,
        shipName: 'Subject',
        missingInComposition: ['heal'],
        extraInComposition: ['buff'],
    };
    const withKinds = (
        missing: CombatLogEntryKind[],
        extra: CombatLogEntryKind[]
    ): FingerprintDiff => ({
        ...original,
        missingInComposition: missing,
        extraInComposition: extra,
    });

    it('holds when every original kind is still reported in the same direction', () => {
        expect(diffPersists(original, withKinds(['heal', 'cleanse'], ['buff']))).toBe(true);
    });

    it('fails for a DIFFERENT non-empty diff', () => {
        expect(diffPersists(original, withKinds(['cleanse'], []))).toBe(false);
    });

    it('fails when a kind flipped direction', () => {
        expect(diffPersists(original, withKinds(['buff'], ['heal']))).toBe(false);
    });

    it('fails for no diff', () => {
        expect(diffPersists(original, null)).toBe(false);
    });
});
