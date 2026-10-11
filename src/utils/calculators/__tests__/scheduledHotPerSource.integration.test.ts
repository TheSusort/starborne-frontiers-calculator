/**
 * A scheduled (manual-pick) heal-over-time copy ticks only for the ship whose pick applied it
 * (#671). Every Repair Over Time grant is its own copy with its own timer (owner ruling
 * 2026-10-11: "All heal over time copies stack independently, just like corrosion debuffs"), so
 * copies that really applied all tick, and a pick that never fired never ticks — even when a
 * teammate's pick of the same buff did fire.
 *
 * The board: a 1,000,000-HP focus against a 150,000-attack enemy, so every focus turn starts
 * wounded by more than every live copy's tick (Repair Over Time II at `hotPct: 2` = 20,000 a
 * tick). `hot-ticked` fires only for HP actually restored, and every tick here is asserted to be
 * a full 20,000, so the count per focus turn is exactly the number of live copies.
 *
 * Each pick lasts 2 turns and is re-granted every turn its source acts. The focus's own copy is
 * gained on its own turn, so it ticks on three focus turns; the teammate acts first, so its copy
 * ticks on two. Live copies per focus turn, round 2 / round 3:
 *   focus only        2 / 3
 *   teammate only     2 / 2
 *   both              4 / 5   (the two sum)
 *   idle focus + mate 2 / 2   (the idle pick adds nothing)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { setupKeyedRng } from '../rateAccumulator';
import { realEnemyInput, damageKit, REAL_ENEMY_ID } from '../__testutils__/dpsRealEnemyFixture';
import type { CombatEvent } from '../../combat/events';
import type { SelectedGameBuff, TeamActorInput } from '../../../types/calculator';

beforeEach(() => {
    setupKeyedRng(12345);
});

const rot = (id: string, extra: Partial<SelectedGameBuff>): SelectedGameBuff => ({
    id,
    buffName: 'Repair Over Time II',
    parsedEffects: { hotPct: 2 },
    stacks: 1,
    isStackable: false,
    ...extra,
});

const team = (selfBuffs: SelectedGameBuff[]): TeamActorInput => ({
    id: 't1',
    speed: 140,
    chargeCount: 0,
    startCharged: false,
    selfBuffs,
    enemyDebuffs: [],
});

/** `hot-ticked` events on the focus, counted per round. */
const focusTicksByRound = (
    selfBuffs: SelectedGameBuff[],
    teamActors: TeamActorInput[] | undefined
): Map<number, number> => {
    const events: CombatEvent[] = [];
    simulateDPS({
        ...realEnemyInput({
            selfBuffs,
            ...(teamActors ? { teamActors } : {}),
            enemyAttackers: [
                {
                    id: REAL_ENEMY_ID,
                    stats: {
                        attack: 150_000,
                        crit: 0,
                        critDamage: 0,
                        speed: 50,
                        defence: 1000,
                        hp: 5_000_000,
                        security: 100,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    shipSkills: damageKit(),
                },
            ],
        }),
        bus: { on: () => {}, emit: (e: CombatEvent) => void events.push(e) },
    });
    const byRound = new Map<number, number>();
    for (const e of events) {
        if (e.type !== 'hot-ticked' || e.holderId !== 'attacker') continue;
        // A clipped tick would make the count stop meaning "live copies".
        expect(e.amount).toBe(20_000);
        byRound.set(e.round, (byRound.get(e.round) ?? 0) + 1);
    }
    return byRound;
};

describe('scheduled Repair Over Time ticks per applying source (#671)', () => {
    it("a focus pick that never fires does not tick alongside a teammate's that does", () => {
        const ticks = focusTicksByRound(
            [rot('a', { skillSource: 'charge', skillDuration: 2 })],
            [team([rot('t', { skillSource: 'active', skillDuration: 2 })])]
        );
        expect(ticks.get(2)).toBe(2);
        expect(ticks.get(3)).toBe(2);
    });

    it("both picks fire, so the focus's copies and the teammate's both tick", () => {
        const ticks = focusTicksByRound(
            [rot('a', { skillSource: 'active', skillDuration: 2 })],
            [team([rot('t', { skillSource: 'active', skillDuration: 2 })])]
        );
        expect(ticks.get(2)).toBe(4);
        expect(ticks.get(3)).toBe(5);
    });

    it('a focus pick alone ticks one copy per live grant', () => {
        const ticks = focusTicksByRound(
            [rot('a', { skillSource: 'active', skillDuration: 2 })],
            undefined
        );
        expect(ticks.get(2)).toBe(2);
        expect(ticks.get(3)).toBe(3);
    });

    it('a teammate pick alone ticks one copy per live grant', () => {
        const ticks = focusTicksByRound(
            [],
            [team([rot('t', { skillSource: 'active', skillDuration: 2 })])]
        );
        expect(ticks.get(2)).toBe(2);
        expect(ticks.get(3)).toBe(2);
    });
});
