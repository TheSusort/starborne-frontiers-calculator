/**
 * SP-4b-2 — a victim that DIES takes no further turn, so its DoTs do not tick that round.
 *
 * WHY THIS FILE EXISTS. Making the DPS simulator always fight a real positioned enemy moved five
 * `dpsGoldenParity` scenarios' KILL-ROUND numbers: `corrosionDamage` 15000/60000/92000 → 0,
 * `infernoDamage` 5175 → 0, `detonationDamage` 18000/22500 → 0. That looked like lost damage, and
 * was investigated as a suspected seventh engine defect. It is not one — it is the engine's
 * documented turn model finally reaching the DPS path, and this file is the assertion that says so
 * out loud, so a future reader does not re-open the question against the old snapshot numbers.
 *
 * THE RULE (docs/combat-system.md §1 + §9). Turn order is a turn-meter selection over LIVING
 * ships ("Filter out dead ships"), and DoTs are not a global end-of-round sweep — they are
 * "modelled as high-priority skills and execute at the start of Process Skill Abilities" of the
 * AFFLICTED ship's own turn. A ship that is already destroyed when its turn comes up never runs
 * Process Turn at all, so its DoTs never fire.
 *
 * WHY THE OLD NUMBERS DISAGREED. Pre-`071f2a33` a scalar-only DPS run resolved against the dummy
 * `enemy` sink, whose HP landed in the POST-ROUND accounting step rather than inside the turn loop
 * (engine.ts:3134-3141). `destroyedRound` was therefore never stamped while the round's turns were
 * still being walked, so the sink took its turn and ticked in the very round it died. The old
 * kill-round DoT numbers are that deferred-accounting artifact, not a game rule.
 *
 * THE TWO SITES, both in the round loop's turn walk:
 *   1. engine.ts:8451-8457 — the general dead-actor turn skip. The victim was killed by a DIRECT
 *      hit earlier in the same round → its whole turn body, including the DoT-tick prologue at
 *      engine.ts:8571+, is `continue`d past.
 *   2. engine.ts:8752-8757 — "lethal turn-start tick → skip the rest of the turn". The victim
 *      survived the direct hit but its OWN DoT tick was lethal → the tick is credited, and
 *      everything later in that turn (bomb countdown/detonation) is not.
 * Site 1's predicate is side-agnostic and the DoT-tick prologue picks its opposing roster from
 * `actor.side`, so the rule reads symmetric — but asserting both directions is NOT redundant, and
 * measuring found why: under `mode: 'battle'` the focus IS the heal target, so a dead focus is
 * short-circuited one site EARLIER, by `handleDeadTargetSkip` (engine.ts:7744-7746), and never
 * reaches site 1 at all. The two directions are enforced by two different guards that happen to
 * agree. Team-symmetry is a locked rule of this epic precisely because "it reads symmetric" is not
 * a measurement.
 *
 * NON-VACUITY, measured. Each direction is a PAIR: an identical fixture whose only difference is
 * whether the victim survives the incoming hit. The survivor tick proves the seeded entry is live
 * and the tick path reaches this victim, so the dead victim's silence can only be the death. Both
 * KILLED cases were then re-run against a neutered engine (`destroyedRound !== r` added to site 1,
 * and an early `return false` for the death round in `handleDeadTargetSkip`): the enemy-side
 * KILLED case fails on site 1's neutering alone, the player-side one needs the heal-target guard's
 * too, and both SURVIVING cases stay green throughout.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { ActiveDoTStack, CombatActor } from '../state';
import type { ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

const HUGE_HP = 1_000_000_000;

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
/** The anchor cell alone (range MUST be 0 — see DEFAULT_BASE_PATTERN). */
const singleCell = (): ParsedPattern => ({ raw: 'single', shape: 'base', range: 0, modifiers: {} });

/** A seeded corrosion stack attributed to a live actor so the tick can resolve an applier ctx. */
const corrosion = (sourceId: string): ActiveDoTStack => ({
    stacks: 1,
    tier: 10,
    remainingRounds: 5,
    sourceId,
});

const damageKit = (multiplier: number, id: string): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id,
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier },
                },
            ],
        },
    ],
});

const BASE: Omit<CombatEngineInput, 'shipSkills'> = {
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    numRounds: 1,
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
    hp: HUGE_HP,
    speed: 100,
    hacking: 200,
};

const run = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const t of ['dot-ticked', 'ship-destroyed'] as CombatEvent['type'][]) {
        bus.on(t, (e) => events.push(e));
    }
    const result = runCombat({ ...input, bus, pattern: singleCell() });
    const ticks = events.filter((e) => e.type === 'dot-ticked');
    const destroyed = events.filter((e) => e.type === 'ship-destroyed');
    return { result, ticks, destroyed };
};

// ── Direction 1: the ENEMY victim ────────────────────────────────────────────────────────────
//
// Column 4 is the FRONT, so `e1` at M4 is what a 'front' single-target cast hits and `e2` at M3
// is the untouched control. Both carry the SAME seeded corrosion; only `e1`'s HP decides whether
// the focus's cast kills it.

/** @param e1Hp low → the focus's cast kills e1 in round 1; huge → it survives. */
const runEnemySide = (e1Hp: number) =>
    run({
        ...BASE,
        attack: 10_000,
        shipSkills: damageKit(100, 'ek1'),
        position: 'M1',
        target: frontTarget(),
        enemyAttackers: [
            {
                id: 'e1',
                stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: e1Hp, speed: 50 },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
            },
            {
                id: 'e2',
                stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 50 },
                chargeCount: 0,
                startCharged: false,
                position: 'M3',
            },
        ],
        __testTapActors: (actors: CombatActor[]) => {
            for (const a of actors) {
                if (a.id === 'e1' || a.id === 'e2') a.corrosionEntries.push(corrosion('attacker'));
            }
        },
    });

describe('a victim killed before its turn does not tick its DoTs (enemy side)', () => {
    it('the SURVIVING enemy ticks — the seeded entry is live and the tick path reaches it', () => {
        const { ticks, destroyed } = runEnemySide(HUGE_HP);

        expect(destroyed.map((e) => e.actorId)).not.toContain('e1');
        // Both carriers are alive, so both tick in round 1.
        expect(ticks.filter((t) => t.targetId === 'e1' && t.round === 1)).toHaveLength(1);
        expect(ticks.filter((t) => t.targetId === 'e2' && t.round === 1)).toHaveLength(1);
    });

    it('the KILLED enemy does not tick in the round it dies, while its neighbour still does', () => {
        const { ticks, destroyed } = runEnemySide(1000);

        // The focus's direct hit killed e1 inside round 1's turn walk.
        expect(destroyed.filter((e) => e.actorId === 'e1' && e.round === 1)).toHaveLength(1);
        // ...so e1's own turn — and with it the DoT-tick prologue — is skipped entirely.
        expect(ticks.filter((t) => t.targetId === 'e1')).toHaveLength(0);
        // The untouched neighbour is the control: same seed, same round, still ticks.
        expect(ticks.filter((t) => t.targetId === 'e2' && t.round === 1)).toHaveLength(1);
    });
});

// ── Direction 2: the PLAYER victim (team-symmetry mirror) ────────────────────────────────────
//
// The focus attacker is the seeded carrier. A fast positioned enemy acts FIRST and its cast
// decides whether the focus is still alive when the focus's own turn (and DoT tick) comes up.
// `mode: 'battle'` so both sides genuinely act.

/** @param focusHp low → the enemy's cast kills the focus in round 1; huge → it survives. */
const runPlayerSide = (focusHp: number) =>
    run({
        ...BASE,
        mode: 'battle',
        hp: focusHp,
        speed: 50, // slower than the enemy → the enemy always acts first
        shipSkills: { slots: [] },
        position: 'M1',
        target: frontTarget(),
        enemyAttackers: [
            {
                id: 'ea1',
                stats: {
                    attack: 10_000,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: HUGE_HP,
                    speed: 120,
                    security: 0,
                    hacking: 200,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                shipSkills: damageKit(100, 'pk1'),
            },
        ],
        __testTapActors: (actors: CombatActor[]) => {
            for (const a of actors) {
                if (a.id === 'attacker') a.corrosionEntries.push(corrosion('ea1'));
            }
        },
    });

describe('a victim killed before its turn does not tick its DoTs (player side)', () => {
    it('the SURVIVING focus ticks — the seeded entry is live and the tick path reaches it', () => {
        const { ticks, destroyed } = runPlayerSide(HUGE_HP);

        expect(destroyed.map((e) => e.actorId)).not.toContain('attacker');
        expect(ticks.filter((t) => t.targetId === 'attacker' && t.round === 1)).toHaveLength(1);
    });

    it('the KILLED focus does not tick in the round it dies', () => {
        const { ticks, destroyed } = runPlayerSide(1000);

        expect(destroyed.filter((e) => e.actorId === 'attacker' && e.round === 1)).toHaveLength(1);
        expect(ticks.filter((t) => t.targetId === 'attacker')).toHaveLength(0);
    });
});
