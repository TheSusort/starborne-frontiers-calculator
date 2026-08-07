/**
 * Integration: a ship's PASSIVE-slot heal/shield fires on either side of the board.
 *
 * User-confirmed game rule (2026-08-07): "all ships fire their passives if the skill conditions
 * are met, no matter what side they are on." The engine agreed for the cast slots but not the
 * passive slot, via three independent drops — all of them invisible to the 147-ship real-kit
 * fingerprint suite, which places every subject at the player focus and so never exercises the
 * enemy actor path (the coverage hole `npm run audit:placement-symmetry` exists to expose).
 *
 * The three drops, each covered by a mirror-image pair below (player control / enemy case):
 *
 *   1. ON-CAST PASSIVE (`healEventOnly`, playerTurn.ts). The enemy turn binding sets
 *      `healEventOnly: true`; that mode built its heal-ability list from the CAST skill alone,
 *      where normal mode concatenates the passive slot. Every enemy passive repair/shield was
 *      dropped. Corpus: Volk.
 *
 *   2. DAMAGE-TAKEN LEECH ("when damaged, gain a shield"). Two halves: `takenLeechesByOwner` was
 *      built from the PLAYER runtimes only, and the per-victim proc hook was wired only at the
 *      enemy→player attack site, so an enemy victim's own leech had neither an entry nor a
 *      caller. Corpus: Malvex, Quixilver.
 *
 *   3. DAMAGE-DEALT LEECH ("when dealing damage, gain a shield"). Same two halves mirrored:
 *      `standingLeeches` was player-only and the proc was wired at the player→enemy sites only.
 *      Corpus: FrontLine, Magnolia, Valerian, Valkyrie.
 *
 * Drops 2 and 3 are the [hand-enumerated-layer] class: of the EIGHT sibling per-owner ability
 * maps built in one block of engine.ts, six already swept both runtime collections and these two
 * did not.
 *
 * Harness notes:
 *   - SHIELD is the observable throughout, never heal: `shieldPool` is readable on the live actor
 *     with no incoming damage required, whereas a self-heal is a silent no-op on an undamaged
 *     actor. State is read off the roster via `__testTapActors` — the same objects the engine
 *     mutates — not inferred from the log and not via the per-round `perActorShield` accounting
 *     (which is a second layer that could itself be side-asymmetric; the actor's own pool cannot).
 *   - The subject sits at M4 (the FRONT cell) on whichever side it occupies, and its opposite
 *     number sits at M4 on the other side targeting `front`, so the two engage identically in
 *     both placements.
 *   - `opponentAttack` is per case, because a surviving pool is what makes `shieldPool` readable:
 *     a shield granted on the subject's OWN turn (drops 1 and 3) is absorbed again by the next
 *     incoming hit and reads 0 at the end, so those cases face a passive opponent. The
 *     damage-taken case (drop 2) necessarily faces an attacking one — its shield is granted
 *     immediately AFTER the hit that pays for it, and so survives.
 *   - `harness sanity` pins the damage flow each case depends on. Without it a leech assertion
 *     could be red simply because nobody engaged (#298 fixture-vacuity class).
 */

import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

/** The subject's id in both placements — only its side changes. */
const SUBJECT = 'subject';
const ROUNDS = 3;
const SUBJECT_HP = 10_000;
const SUBJECT_ATTACK = 100;
/** Opposing damage, chosen well below SUBJECT_HP so the subject survives all ROUNDS. */
const OPPONENT_ATTACK = 100;

type Side = 'player' | 'enemy';

// ─── Passive-slot fixtures (the only thing that varies between cases) ───────────

/** Drop 1: an ordinary on-cast passive self-shield, 20% of the caster's own max HP. */
const passiveOnCastShield = (): Ability => ({
    id: 'p-oncast-shield',
    type: 'shield',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'shield', pct: 20, basis: 'target-hp' },
});

/** Drop 2: Malvex's "when directly damaged, gain a Shield equal to X% of the damage dealt". */
const passiveTakenLeech = (): Ability => ({
    id: 'p-taken-leech',
    type: 'shield',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'shield', pct: 50, basis: 'damage-taken' },
});

/** Drop 3: a standing "X% of damage dealt" leech. */
const passiveDealtLeech = (): Ability => ({
    id: 'p-dealt-leech',
    type: 'shield',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'shield', pct: 50, basis: 'damage-dealt' },
});

const strike = (id: string, multiplier: number): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** The subject's kit: a plain damage active plus the passive under test. */
const subjectSkills = (passive: Ability): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [strike('subject-hit', 100)] },
        { slot: 'passive', abilities: [passive] },
    ],
});

/** A bare damage dealer, used as the subject's opposite number. */
const plainSkills = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [strike('plain-hit', 100)] }],
});

// ─── Board ──────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const teamActor = (id: string, position: string, skills: ShipSkills, attack: number) =>
    ({
        id,
        speed: 100,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        walk: {
            shipSkills: skills,
            stats: {
                attack,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: SUBJECT_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as any;

const enemyActor = (id: string, position: string, skills: ShipSkills, attack: number) =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, speed: 100, defence: 0, hp: SUBJECT_HP },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        shipSkills: skills,
    }) as any;

/**
 * One board, two placements. The subject always occupies M4 on `side` and always faces a damage
 * dealer at M4 on the other side; every other cell is empty. The player focus is unavoidable
 * (the engine always mints `playerTeam[0]` as the 'attacker'), so it doubles as the opposing
 * damage dealer when the subject is on the enemy side, and is a harmless 0-multiplier bystander
 * at M1 when the subject is on the player side.
 */
const buildInput = (
    side: Side,
    passive: Ability,
    opponentAttack: number,
    tap: (a: CombatActor[]) => void
) => {
    const subjectOnPlayer = side === 'player';
    const input: CombatEngineInput = {
        // The focus. Damage dealer at M4 when the subject is the enemy; inert at M1 otherwise.
        attack: subjectOnPlayer ? 0 : opponentAttack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [strike('focus-hit', 100)] }] },
        enemyDefense: 0,
        enemyHp: 1_000_000,
        numRounds: ROUNDS,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: SUBJECT_HP,
        healTargetId: 'attacker',
        positionalTeamBattle: true,
        position: subjectOnPlayer ? 'M1' : 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        teamActors: subjectOnPlayer
            ? [teamActor(SUBJECT, 'M4', subjectSkills(passive), SUBJECT_ATTACK)]
            : [],
        enemyAttackers: subjectOnPlayer
            ? [enemyActor('opponent', 'M4', plainSkills(), opponentAttack)]
            : [enemyActor(SUBJECT, 'M4', subjectSkills(passive), SUBJECT_ATTACK)],
        __testTapActors: tap,
    } as any;
    return input;
};

/* eslint-enable @typescript-eslint/no-explicit-any */

interface Run {
    /** The subject's own live actor — the pool read comes off this. */
    subject: CombatActor;
    /** The subject's opposite number, for the "did it actually deal damage" sanity read. */
    opponent: CombatActor;
}

/** Run one placement. `opponentAttack` 0 leaves the subject unharassed (see the header note). */
const run = (side: Side, passive: Ability, opponentAttack: number): Run => {
    let captured: CombatActor[] = [];
    runCombat(buildInput(side, passive, opponentAttack, (a) => (captured = a)));
    const subject = captured.find((a) => a.id === SUBJECT);
    // The opposite number is the M4 actor on the other side: the named enemy 'opponent' when the
    // subject is a player, the focus otherwise. (The legacy non-positional dummy has no position
    // and is never it.)
    const opponent = captured.find(
        (a) => a.id !== SUBJECT && a.position === 'M4' && a.side !== subject?.side
    );
    if (!subject) throw new Error(`no actor '${SUBJECT}' in the ${side} roster`);
    if (!opponent) throw new Error(`no M4 opposite number in the ${side} roster`);
    return { subject, opponent };
};

// ─── Harness sanity ─────────────────────────────────────────────────────────────

describe('harness sanity', () => {
    it.each(['player', 'enemy'] as const)(
        'the %s-side subject DEALS damage to its opposite number',
        (side) => {
            // Drops 1 and 3 depend on the subject acting at all. Without this a green fix and a
            // board where nobody ever engaged look identical. (#298 fixture-vacuity class.)
            const { opponent } = run(side, passiveDealtLeech(), 0);

            expect(opponent.currentHp).toBeLessThan(opponent.stats.hp);
        }
    );

    it.each(['player', 'enemy'] as const)(
        'the %s-side subject TAKES damage from its opposite number',
        (side) => {
            // Drop 2 additionally depends on the subject being hit. Asserted with a passive that
            // grants no pool, so nothing can absorb the damage and mask it.
            const { subject } = run(side, passiveDealtLeech(), OPPONENT_ATTACK);

            expect(subject.currentHp).toBeLessThan(SUBJECT_HP);
        }
    );
});

// ─── Drop 1: on-cast passive heal/shield ────────────────────────────────────────

describe('passive-slot on-cast shield', () => {
    it('a PLAYER-side passive self-shield grants a pool (control)', () => {
        const { subject } = run('player', passiveOnCastShield(), 0);

        expect(subject.shieldPool).toBeGreaterThan(0);
    });

    it('an ENEMY-side passive self-shield grants a pool too', () => {
        // The regression: `healEventOnly` built its ability list from the cast slot alone, so the
        // enemy's passive never ran. Identical kit, identical cells — only the side differs.
        const { subject } = run('enemy', passiveOnCastShield(), 0);

        expect(subject.shieldPool).toBeGreaterThan(0);
    });
});

// ─── Drop 2: damage-taken leech ─────────────────────────────────────────────────

describe('passive-slot damage-taken leech', () => {
    it('a PLAYER-side victim gains a shield from the damage it took (control)', () => {
        const { subject } = run('player', passiveTakenLeech(), OPPONENT_ATTACK);

        expect(subject.shieldPool).toBeGreaterThan(0);
    });

    it('an ENEMY-side victim gains a shield from the damage it took too', () => {
        // `takenLeechesByOwner` held no entry for an enemy owner, and the per-victim proc was
        // wired only where the victims are players.
        const { subject } = run('enemy', passiveTakenLeech(), OPPONENT_ATTACK);

        expect(subject.shieldPool).toBeGreaterThan(0);
    });
});

// ─── Drop 3: damage-dealt leech ─────────────────────────────────────────────────

describe('passive-slot damage-dealt leech', () => {
    it('a PLAYER-side attacker gains a shield from the damage it dealt (control)', () => {
        const { subject } = run('player', passiveDealtLeech(), 0);

        expect(subject.shieldPool).toBeGreaterThan(0);
    });

    it('an ENEMY-side attacker gains a shield from the damage it dealt too', () => {
        // `standingLeeches` held no entry for an enemy owner, and the proc was wired only at the
        // player→enemy attack sites.
        const { subject } = run('enemy', passiveDealtLeech(), 0);

        expect(subject.shieldPool).toBeGreaterThan(0);
    });
});
