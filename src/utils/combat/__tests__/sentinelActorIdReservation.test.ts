/**
 * SP-4c-2d §4.3/§4.6 — the sentinel id is RESERVED IN BOTH DIRECTIONS.
 *
 * The dummy `enemy` actor is gone, but the side-wide scheduled-enemy-debuff bucket still needs an
 * id to emit `buff-expired` under. `SENTINEL_ENEMY_ACTOR_ID` keeps the literal `'enemy'` so the
 * event stream stays byte-identical across the deletion — the name is honest that it identifies a
 * BUCKET, not a claim that an actor exists.
 *
 * Two things have to hold, and they need separate cases:
 *   • THE ROSTER never contains it — if an ACTOR carried the string, the bucket's `buff-expired`
 *     and that actor's own events would interleave under one id: invisible in the log, impossible
 *     to attribute afterwards. Fenced by the `it.each(SHAPES)` case over every roster a caller can
 *     still BUILD.
 *   • THE INPUT cannot ask for it, ON EITHER SIDE — `runCombat` rejects the sentinel offered as an
 *     `enemyAttackers[].id` and as a `teamActors[].id` (`it.each(SENTINEL_CLAIMS)`). Without both
 *     throws the collision above is constructible from outside the engine: the team-actor arm went
 *     unchecked until this branch's review wave 2 (the reservation set existed, but only the
 *     enemy-attacker loop read it), and such an input ran, producing a roster whose FIRST actor id
 *     was the sentinel. That is why the shape table above cannot cover the player-side sentinel: it
 *     is no longer a buildable roster, only a rejected input.
 *
 * NON-VACUITY, which matters more here than usual: the shape case reads the roster through
 * `__testTapActors`, and a tap that never fires hands back an EMPTY array — whose "no actor carries
 * the sentinel" filter passes for the wrong reason. So each shape asserts the tap FIRED and named
 * the actors it should (`attacker` + the roster ids), i.e. it observes the CALL and not only its
 * consequence. And each rejection has a twin that runs the SAME shape under an ordinary id, so a
 * throw is the reservation firing rather than a broken fixture.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, SENTINEL_ENEMY_ACTOR_ID, CombatEngineInput } from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import {
    bareInput,
    bareEnemy,
    bareAlly,
    attackingEnemy,
    BARE_ENEMY_ID,
    BARE_ALLY_ID,
    SECOND_BARE_ENEMY_ID,
} from '../__testutils__/bareRosterFixture';

/** Run `input` and hand back every actor id the engine built, in roster order. */
const actorIdsOf = (input: CombatEngineInput): string[] => {
    let captured: string[] | undefined;
    runCombat({ ...input, __testTapActors: (actors) => (captured = actors.map((a) => a.id)) });
    // The tap is the only route to the roster (`runCombat`'s return carries no actor list), so a
    // silent no-fire would make every assertion below vacuous. Fail loudly instead.
    expect(
        captured,
        '__testTapActors never fired — the reading below would be vacuous'
    ).toBeDefined();
    return captured!;
};

/** The four roster shapes a direct-engine caller can build, by which engine paths they light up. */
const SHAPES: { name: string; input: () => CombatEngineInput; expected: string[] }[] = [
    {
        name: 'focus vs one bare enemy',
        input: () => bareInput(),
        expected: ['attacker', BARE_ENEMY_ID],
    },
    {
        name: 'focus + a walked team ally',
        input: () => ({ ...bareInput(), teamActors: [bareAlly({ attack: 7_000 })] }),
        expected: ['attacker', BARE_ALLY_ID, BARE_ENEMY_ID],
    },
    {
        name: 'an enemy that ACTS (the enemy → player direction)',
        input: () => ({ ...bareInput(), enemyAttackers: attackingEnemy() }),
        expected: ['attacker', BARE_ENEMY_ID],
    },
    {
        name: 'a two-member enemy roster',
        input: () => ({
            ...bareInput(),
            enemyAttackers: [
                ...bareEnemy({ position: 'M4' }),
                ...bareEnemy({ id: SECOND_BARE_ENEMY_ID, position: 'M3' }),
            ],
        }),
        expected: ['attacker', BARE_ENEMY_ID, SECOND_BARE_ENEMY_ID],
    },
];

/** A sentinel-named actor offered to the engine, once per SIDE. Every one must be REJECTED, and the
 *  `ordinary` twin is the same shape under a normal id — it must run, or the throw above proves
 *  nothing about the sentinel. */
const SENTINEL_CLAIMS: {
    name: string;
    sentinel: () => CombatEngineInput;
    ordinary: () => CombatEngineInput;
    message: RegExp;
}[] = [
    {
        name: 'as an enemyAttackers[].id',
        sentinel: () => ({
            ...bareInput(),
            enemyAttackers: bareEnemy({ id: SENTINEL_ENEMY_ACTOR_ID }),
        }),
        ordinary: () => ({ ...bareInput(), enemyAttackers: bareEnemy({ id: 'not-the-sentinel' }) }),
        message: /enemyAttackers\[\]\.id 'enemy' collides with a reserved or player actor id/,
    },
    {
        name: 'as a teamActors[].id (the player side — unchecked until review wave 2)',
        sentinel: () => ({
            ...bareInput(),
            teamActors: [{ ...bareAlly({ attack: 7_000 }), id: SENTINEL_ENEMY_ACTOR_ID }],
        }),
        ordinary: () => ({
            ...bareInput(),
            teamActors: [{ ...bareAlly({ attack: 7_000 }), id: 'not-the-sentinel' }],
        }),
        message: /teamActors\[\]\.id 'enemy' collides with a reserved actor id/,
    },
];

describe('SP-4c-2d: the sentinel id is reserved in both directions', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it.each(SHAPES)('no ACTOR carries the sentinel id — $name', ({ input, expected }) => {
        const ids = actorIdsOf(input());

        // POSITIVE HALF: the tap really enumerated this shape's roster. Without it the filter
        // below would read 0 on an empty array just as happily.
        expect(ids).toEqual(expect.arrayContaining(expected));

        expect(ids.filter((id) => id === SENTINEL_ENEMY_ACTOR_ID)).toHaveLength(0);
    });

    it.each(SENTINEL_CLAIMS)(
        'runCombat still REJECTS an actor claiming the sentinel id — $name',
        ({ sentinel, message }) => {
            // The other direction: deleting the actor must not FREE the string. A caller that could
            // name a real actor `'enemy'` would interleave its events with the bucket's.
            expect(() => runCombat(sentinel())).toThrow(message);
        }
    );

    it.each(SENTINEL_CLAIMS)(
        '...and that rejection is about the SENTINEL, not about every id — $name',
        ({ ordinary }) => {
            // Non-vacuity for the throw above: the identical shape under any other id runs fine, so
            // the throw is the reservation firing and not a broken fixture.
            expect(() => runCombat(ordinary())).not.toThrow();
        }
    );
});
