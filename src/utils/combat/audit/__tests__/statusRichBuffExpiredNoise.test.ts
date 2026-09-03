import { describe, it, expect, beforeAll } from 'vitest';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import { buildScenarioBattle, SEED } from '../kitFingerprintScenarios';
import { runSeededBattle } from '../seededBattle';
import { resolveSubjectActorId } from '../placementSymmetry';
import { fingerprintActor } from '../fingerprint';
import type { Placement } from '../types';

/**
 * TRIAGE VERDICT — the placement-symmetry sweep's four `statusRich` findings ("Amartya / Sefuba
 * emit `buff-expired` as focus and team but never as enemy") are SEED NOISE. Do not re-triage them.
 *
 * They appeared the moment the `statusRich` arm landed, taking the sweep from 2 findings to 6, and
 * they are the same class as the standing Apex `shield-destroyed` pair (see
 * `apexShieldDestroyedNoise.test.ts`, which this file mirrors).
 *
 * THE MECHANISM. The expiring buff is always `Defense Down II` — the statusRich FILLER's debuff on
 * the subject, not anything the subject grants itself. A 2-turn debuff re-applied by three
 * attackers every round only ever EXPIRES if a gap opens: the fillers have to fail to re-apply it
 * before the window lapses, which is a landing roll. The engine's RNG is ownerId-keyed and re-drawn
 * per placement, so the seeds on which that gap opens differ per placement — which is exactly the
 * shape that makes a narrow sweep window report a one-sided result.
 *
 * MEASURED over 400 consecutive seeds from the harness's own base seed (occurrences / 400):
 *
 *      Sefuba    focus 9   team 9   enemy 9
 *
 * — identical RATES, at completely different seeds (focus/team fire at +3, +70, +150 …; enemy at
 * +126, +161, +198 …). Amartya is rarer and needed a wider window to settle; over 2000 seeds:
 *
 *      Amartya   focus 12  team 12  enemy 3
 *
 * — enemy fires at +933, +970 and +1896. So every placement emits the kind on BOTH ships and
 * neither is a path gap. `focus` and `team` fire on byte-identical seed sets, which is the
 * expected signature of two placements that differ only by player-array index.
 *
 * ⚠️ WHY THE SWEEP REPORTED IT AT ALL, and the general lesson: `npm run audit:placement-symmetry`
 * defaults to a TEN-seed window. At Amartya's enemy rate (3/2000 ≈ 0.15%) ten seeds cannot
 * distinguish "never happens" from "happens rarely" — and a 0 is not a measurement until the rate
 * is known. A one-sided sweep result on a LOW-RATE kind is a candidate, never a finding; widen the
 * window before believing the zero. The sweep's own output says as much ("Findings are CANDIDATES").
 *
 * The assertions below deliberately do NOT re-run the sweep — that would be thousands of battles.
 * They pin the exact seeds measured above, so the proof is "the enemy placement DOES emit, at a
 * seed the default window never reaches", checked in four battles.
 */

const hasReferenceData = (): boolean => csvAvailable() && shipDataAvailable();

function emitsBuffExpired(name: string, placement: Placement, seedOffset: number): boolean {
    const ship = buildTraceShip(name);
    expect(ship, `${name} did not resolve from the corpus`).not.toBeNull();
    const result = runSeededBattle(
        buildScenarioBattle(ship!, 'statusRich', placement),
        SEED + seedOffset
    );
    const actorId = resolveSubjectActorId(result, 'statusRich', placement);
    expect(actorId, `${name}/${placement} subject did not resolve`).toBeDefined();
    return fingerprintActor(result, actorId).has('buff-expired');
}

describe('statusRich `buff-expired` placement asymmetry is seed noise', () => {
    beforeAll(() => {
        if (!hasReferenceData()) {
            throw new Error(
                'statusRichBuffExpiredNoise: docs/ship-skills.csv + docs/ship-data.json are ' +
                    'gitignored reference data expected on dev machines (see CLAUDE.md).'
            );
        }
    });

    // The seed at which the sweep SAW the kind (focus fires) and the seed at which the `enemy`
    // placement fires it too. The second is the whole point: it is far outside the default
    // ten-seed window, which is why the sweep reported a one-sided result.
    it.each([
        ['Sefuba', 3, 126],
        ['Amartya', 14, 933],
    ])(
        '%s: focus fires at +%i, and the ENEMY placement fires at +%i — not a path gap',
        (name, focusOffset, enemyOffset) => {
            expect(emitsBuffExpired(name, 'focus', focusOffset)).toBe(true);
            // The finding's own claim, reproduced: at the seed the sweep looked at, `enemy` is
            // silent. Without this the test below could pass for a ship that simply always emits.
            expect(emitsBuffExpired(name, 'enemy', focusOffset)).toBe(false);
            // ...and the refutation: it is not silent everywhere.
            expect(emitsBuffExpired(name, 'enemy', enemyOffset)).toBe(true);
        }
    );

    it('the expiring buff is the FILLER debuff, not something the subject grants itself', () => {
        // Load-bearing for the mechanism above: if the subject were expiring its OWN buff, the
        // landing-roll explanation would not apply and the asymmetry would need re-triage.
        const ship = buildTraceShip('Sefuba')!;
        const result = runSeededBattle(buildScenarioBattle(ship, 'statusRich', 'focus'), SEED + 3);
        const actorId = resolveSubjectActorId(result, 'statusRich', 'focus');
        const notes: string[] = [];
        const walk = (
            entries: { kind: string; actorId: string; note?: string; reactions?: unknown[] }[]
        ): void => {
            for (const e of entries) {
                if (e.actorId === actorId && e.kind === 'buff-expired') notes.push(e.note ?? '-');
                if (e.reactions?.length) walk(e.reactions as never);
            }
        };
        for (const round of result.combatLog) {
            walk(round.startOfRound);
            for (const turn of round.turns) walk(turn.entries);
            walk(round.endOfRound);
        }

        expect(notes.length).toBeGreaterThan(0);
        for (const note of notes) expect(note).toBe('Defense Down II expired');
    });
});
