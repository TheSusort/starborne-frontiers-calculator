/**
 * SP-4c-1 — the match ends when a side is wiped, at the end of the turn that wiped it.
 *
 * GAME RULE (owner, 2026-08-18): "when there's no more enemies, the match will end mid round,
 * after the turn that kills the last opposing ship ends."
 *
 * Each case asserts THREE things, and the third is the one that matters. `rounds.length` alone
 * cannot tell turn-granular termination from round-granular termination — both stop at the same
 * round. Only the ABSENCE of a later-scheduled actor's `turn-started` shows the round was cut
 * mid-walk. `bareAlly()` is speed 1 and therefore always last in the order, which is what makes
 * it a witness rather than turn-order filler.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { collectTurns } from '../__testutils__/turnOrderTap';
import {
    bareInput,
    bareEnemy,
    bareAlly,
    attackingEnemy,
    BARE_ENEMY_ID,
    BARE_ALLY_ID,
    SECOND_BARE_ENEMY_ID,
} from '../__testutils__/bareRosterFixture';

describe('roster-wipe termination', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('PLAYER WIPES ENEMY: the run ends on the killing turn, before the slower ally acts', () => {
        // The focus deals 10 000 per cast; the lone enemy has 5 000 max HP, so it dies to the
        // round-1 cast. numRounds is 4 so a surviving run would be plainly visible as 4 rows.
        const { result, actorsThatTookTurns, destroyed } = collectTurns({
            ...bareInput(),
            numRounds: 4,
            enemyAttackers: bareEnemy({ stats: { hp: 5_000 } }),
            teamActors: [bareAlly()],
        });

        // 1. The kill actually happened — without this the case could pass vacuously on a run
        //    that never dealt damage at all.
        expect(destroyed()).toContain(BARE_ENEMY_ID);

        // 2. The run ended at the killing round, and the killing round REPORTED.
        expect(result.rounds).toHaveLength(1);
        expect(result.rounds[0].perTargetDealt?.attacker?.[BARE_ENEMY_ID]).toBeGreaterThan(0);

        // 3. TURN-granular, not round-granular: the speed-1 ally is scheduled after the focus in
        //    round 1 and must never have acted.
        expect(actorsThatTookTurns(1)).toContain('attacker');
        expect(actorsThatTookTurns(1)).not.toContain(BARE_ALLY_ID);
    });
    it('ENEMY WIPES PLAYER: the run ends on the killing turn, before the slower enemy acts', () => {
        // Player side is the focus alone (no team), at 5 000 HP. The fast enemy deals 10 000 and
        // kills it on its round-1 turn. The second enemy is speed 1, so it is scheduled after —
        // and must never act. `mode: 'battle'` keeps the DPS focus-death exit out of it, so the
        // new rule is the only thing that can end this run.
        const { result, actorsThatTookTurns, destroyed } = collectTurns({
            ...bareInput(),
            mode: 'battle',
            numRounds: 4,
            hp: 5_000,
            attack: 0,
            enemyAttackers: [
                ...attackingEnemy({ stats: { speed: 100 } }),
                ...bareEnemy({ id: SECOND_BARE_ENEMY_ID, stats: { speed: 1 } }),
            ],
        });

        expect(destroyed()).toContain('attacker');
        expect(result.rounds).toHaveLength(1);
        expect(actorsThatTookTurns(1)).toContain(BARE_ENEMY_ID);
        expect(actorsThatTookTurns(1)).not.toContain(SECOND_BARE_ENEMY_ID);
    });
    it('CONTROL: a run whose roster survives the window is untouched', () => {
        // Same shape as the player-wipe case, with an enemy that cannot die inside the window.
        // If termination fired here it would be firing on something other than a wipe.
        const { result, actorsThatTookTurns } = collectTurns({
            ...bareInput(),
            numRounds: 4,
            enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
            teamActors: [bareAlly()],
        });

        expect(result.rounds).toHaveLength(4);
        expect(actorsThatTookTurns(1)).toContain(BARE_ALLY_ID);
    });

    it("CONTROL: a battle continues past the FOCUS's death while an ally lives", () => {
        // The locked exception. A focus dying is not a wipe: the player side still has a living
        // member, so the run must NOT end. This is the pin that stops a future simplification
        // from collapsing the wipe rule into "the focus died".
        const { result, destroyed } = collectTurns({
            ...bareInput(),
            mode: 'battle',
            numRounds: 4,
            hp: 5_000,
            attack: 0,
            // The ally is moved OFF `bareAlly()`'s hardcoded M4 — M4 is the FRONT of the player
            // board and also the focus's own default slot, so an ally left there stands in front
            // of the focus and soaks the enemy's cast on its 500 000 HP. At M3 the enemy's
            // front-target resolves to the focus, which is what this control needs to die.
            teamActors: [{ ...bareAlly(), position: 'M3' as const }],
            enemyAttackers: attackingEnemy({ stats: { speed: 100, hp: 10_000_000 } }),
        });

        expect(destroyed()).toContain('attacker');
        expect(result.rounds.length).toBeGreaterThan(1);
    });
    it('START-OF-ROUND KILL: a wipe outside any turn ends the round before an actor acts', () => {
        // CodeRabbit #329: the wipe check sits at the end of a TURN, but damage can also land
        // outside one — start-of-round and end-of-round reactive drains both credit damage
        // (Rhodium, Grif, FrontLine, Chakara and Incinerator all carry such passives). If a drain
        // empties a side, the turn loop must not go on to select an actor.
        //
        // Enemy at 25 000. Start-of-round hit 10 000, cast 10 000:
        //   R1: drain → 15 000, focus cast → 5 000.
        //   R2: drain → DEAD, before any actor is selected.
        // So round 2 must contain NO turns at all.
        const { result, actorsThatTookTurns, destroyed } = collectTurns({
            ...bareInput(),
            numRounds: 4,
            enemyAttackers: bareEnemy({ stats: { hp: 25_000 } }),
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'a1',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100 },
                            },
                        ],
                    },
                    {
                        slot: 'passive',
                        abilities: [
                            {
                                id: 'p1',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'start-of-round',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100 },
                            },
                        ],
                    },
                ],
            },
        });

        expect(destroyed()).toContain(BARE_ENEMY_ID);
        // The focus acted in round 1 (proves the fixture ran), but NOT in round 2 — the
        // start-of-round drain wiped the side before selection.
        expect(actorsThatTookTurns(1)).toContain('attacker');
        expect(actorsThatTookTurns(2)).toEqual([]);
        expect(result.rounds).toHaveLength(2);
    });
});
