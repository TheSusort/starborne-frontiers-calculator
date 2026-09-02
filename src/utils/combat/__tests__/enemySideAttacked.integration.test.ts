/**
 * enemySideAttacked.integration.test.ts — enemy-side reactive emission (positional two-team sim).
 *
 * POSITIONAL `shieldWasHit` on the enemy→player path so a PLAYER Nyxen counters
 * a POSITIONAL enemy attacker (below). Task 3: the symmetric player→enemy `attacked` emit so
 * ENEMY ships react when the player hits them — enemy Stalwart/Nyxen/Centurion counters + a
 * representative non-counter on-attacked reactive (see the "Task 3" section further down).
 *
 * The existing Nyxen end-to-end test (counterAttack.integration.test.ts) drives the
 * NON-positional path (`counterBase`, no enemy position/target/pattern), where the enemy's
 * incoming `applyIncomingToTarget` binds shieldBefore/hpDamage/barriered directly so
 * `shieldWasHit` is computed. The two-team battle sim runs enemy attacks POSITIONALLY
 * (`drivePositionalApply`), where those locals stayed at 0 → `shieldWasHit` was always false →
 * a player Nyxen never countered in the positioned sim.
 *
 * This test builds a positional two-team battle (mirroring twoTeamBattle.test.ts /
 * positionalDamage.integration.test.ts): a player FOCUS Nyxen — built via the REAL registry
 * (`buildShipAbilities`) so its self-shield active + shield-hit counter parse — that acts FIRST
 * (higher speed) and casts its 15%-Max-HP shield, then a POSITIONAL enemy attacker drains that
 * shield. The enemy must take counter damage (Nyxen's shield-hit counter fired). This is
 * impossible today because positional `shieldWasHit` is false → the counter never gates true.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Verbatim CSV-derived skill text (docs/ship-skills.csv, Nyxen row). The active grants a
// self-shield equal to 15% of Max HP; the first passive parses to an on-attacked counter with
// requireShieldHit:true.
const NYXEN_ACTIVE =
    'This Unit <unit-aid>Cleanses 2 bombs</unit-aid>, Grants a <unit-damage>Shield equal to 15%</unit-damage> of its Max HP, and Grants <unit-skill>Atlas Readiness II</unit-skill> for 1 turn.';
const NYXEN_P1 =
    'This Unit deals <unit-damage>100% damage</unit-damage> when its Shield is directly damaged.';

/** A Ship carrying Nyxen's active (self-shield) + first passive (shield-hit counter), parsed
 *  through the real registry → a self-shield ability + an on-attacked counter (requireShieldHit). */
function nyxenShip(withActiveShield = true): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        ...(withActiveShield ? { activeSkillText: NYXEN_ACTIVE } : {}),
        firstPassiveSkillText: NYXEN_P1,
    } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// Origin-only (single-target) footprint.
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A no-passive single-hit basic-attack active slot (multiplier 100% = 1x, 1 hit).
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'esa-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
});

// A POSITIONED enemy attacker that fires on the player roster: position + target + pattern + a
// damage skill so its firing hit produces positionalScalars (the enemy positional branch).
const offensiveEnemyAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    attack: number,
    hp: number,
    speed: number
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, defence: 0, hp, speed },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget(selection),
    pattern: basePattern(),
    shipSkills: { slots: [basicAttack()] },
});

/** Cumulative damage credited to `actorId` across the run via the round perTargetDamage maps. */
const totalPerTargetDamage = (result: ReturnType<typeof runCombat>, actorId: string): number => {
    let sum = 0;
    for (const rd of result.rounds) sum += rd.perTargetDamage?.[actorId] ?? 0;
    return sum;
};

/**
 * A positional two-team battle: the player FOCUS ('attacker', the heal target) is a Nyxen built
 * from the real registry, placed at M4 with a base pattern, acting FIRST (speed 200) so it casts
 * its self-shield active before the enemy hits. One positioned enemy ('foe', speed 50) fires
 * `front` → anchors the front-most player (the focus) → drains its live shield.
 *
 * SHIELD HP: focus HP 40_000 → 15% shield = 6_000. Enemy attack 3_000 < 6_000 so the hit dents
 * (does not fully drain) the shield → shieldWasHit true on a working positional path.
 */
const nyxenFocusBattle = (
    skills: ShipSkills,
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000, // Nyxen (counter source) attack → counter = 10000 × 100% = 10000
    crit: 0, // no crit → deterministic counter
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: skills,
    numRounds: 3,
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
    hp: 40_000,
    speed: 200, // acts BEFORE the enemy (speed 50) so the shield is live when the hit arrives
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: [offensiveEnemyAt('foe', 'M4', 'front', 3_000, 1_000_000_000, 50)],
    ...overrides,
});

describe('Task 2 — POSITIONAL shieldWasHit: player Nyxen counters a positional enemy attacker', () => {
    it('player Nyxen (live shield) counters the POSITIONAL enemy attacker that dents its shield', () => {
        // Focus speed 200 casts its 15%-Max-HP self-shield FIRST; the speed-50 positional enemy
        // then drains a LIVE shield → positional shieldWasHit must be true → the shield-hit counter
        // fires against the enemy. The enemy's incoming counter damage surfaces via perTargetDamage.
        const shielded = buildShipAbilities(nyxenShip(/* withActiveShield */ true));
        const result = runCombat(nyxenFocusBattle(shielded));

        const fired = totalPerTargetDamage(result, 'foe');
        // Owner attack 10000 × 100% vs defence 0 / neutral affinity / no crit = 10000 per counter.
        expect(fired).toBeGreaterThan(0);
        for (const rd of result.rounds) {
            const dealt = rd.perTargetDamage?.['foe'] ?? 0;
            if (dealt > 0) expect(dealt).toBeCloseTo(10_000, 6);
        }
    });

    it('NEGATIVE control: no self-shield → no shield ever exists → NO counter on the positional path', () => {
        // Same positional setup but Nyxen has ONLY the passive (no active shield) → the shield never
        // exists → shieldWasHit never true → the foe takes zero counter damage.
        const noShield = buildShipAbilities(nyxenShip(/* withActiveShield */ false));
        const result = runCombat(nyxenFocusBattle(noShield));
        expect(totalPerTargetDamage(result, 'foe')).toBe(0);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Task 3 — PLAYER→ENEMY `attacked` emit: ENEMY ships react when the PLAYER hits them.
//
// The reverse direction of Task 2: the player FOCUS ('attacker') is a positional attacker
// (position + target + pattern + a damage active); the ENEMY is the real reactive ship built
// via the registry (Stalwart/Nyxen/Centurion) OR carrying an injected non-counter on-attacked
// reaction (Second Wind). The player→enemy positional firing hit must now emit `attacked` for
// the focus enemy victim so the enemy's `on-attacked`/`on-ally-attacked` reactives wake.
//
// READ MECHANISMS:
//   - ENEMY COUNTER landed on the player attacker → the player attacker ('attacker') takes
//     incoming damage, surfaced via the round perTargetDamage map keyed by 'attacker'.
//   - SECOND WIND self-repair → a `heal-performed` event keyed by the enemy casterId.
// ───────────────────────────────────────────────────────────────────────────

// Verbatim CSV-derived skill text (docs/ship-skills.csv).
const STALWART_P1 =
    'When this Unit is directly damaged as a primary target, it deals <unit-damage>30% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.';
const CENTURION_P2 =
    'At the start of combat, this Unit gains 750 attack per adjacent ally.<br /><br />When this Unit or an adjacent ally is directly damaged, this Unit retaliates dealing <unit-damage>50%</unit-damage>.';

/** A reactive enemy ship built from verbatim skill text via the real registry. The parsed
 *  ShipSkills (the on-attacked counter passive) is fed straight into the enemy actor — no active
 *  needed, the reactive partition picks up the passive. */
function reactiveEnemyShip(opts: {
    firstPassiveSkillText?: string;
    secondPassiveSkillText?: string;
}): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        ...opts,
    } as Ship;
}

/** A POSITIONED enemy carrying parsed reactive `shipSkills` (+ an optional extra active so it's a
 *  fully-real positioned actor). attack/hp/speed control the geometry; counters source from the
 *  enemy's OWN attack. */
const reactiveEnemyAt = (
    id: string,
    position: Position,
    shipSkills: ShipSkills,
    attack: number,
    hp: number,
    speed: number
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, defence: 0, hp, speed },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills,
});

/**
 * A positional two-team battle where the PLAYER FOCUS ('attacker') fires at the enemy roster.
 * Focus at M4, fires `front` with a base pattern + a 100% damage active. The player attacker's HP
 * is huge so an enemy counter never kills it (we read its incoming counter via perTargetDamage).
 */
const playerAttacksEnemy = (
    enemies: EnemyAttacker[],
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000, // player focus attack → the hit that wakes the enemy reactive
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
    numRounds: 3,
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
    hp: 1_000_000_000, // immortal player attacker so enemy counters never kill it
    speed: 200, // player acts first → its hit wakes the enemy reactive each round
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: enemies,
    ...overrides,
});

describe('Task 3 — player→enemy attacked emit: enemy COUNTERS fire when the player hits them', () => {
    it('enemy STALWART (primary-target counter) strikes the player attacker back', () => {
        // The player focus fires `front` → anchors the enemy Stalwart (its primary target) → the
        // new player→enemy attacked emit (isPrimaryTarget:true) wakes Stalwart's on-attacked
        // counter → it deals 30% of ITS attack (5000 × 30% = 1500) back to the player attacker.
        const stalwart = buildShipAbilities(
            reactiveEnemyShip({ firstPassiveSkillText: STALWART_P1 })
        );
        const result = runCombat(
            playerAttacksEnemy([reactiveEnemyAt('foe', 'M4', stalwart, 5_000, 1_000_000_000, 50)])
        );
        // Counter landed on the player attacker ('attacker'): 5000 × 30% = 1500 (round 1 base; later
        // rounds carry the +15% Legion Discipline II self-buff → 1725). Any non-zero round is one.
        const counterRounds = result.rounds
            .map((rd) => rd.perTargetDamage?.['attacker'] ?? 0)
            .filter((d) => d > 0);
        expect(counterRounds.length).toBeGreaterThan(0);
        const BASE = 5_000 * 0.3; // 1500
        const BUFFED = BASE * 1.15; // 1725
        for (const dealt of counterRounds) {
            const isBase = Math.abs(dealt - BASE) < 1e-6;
            const isBuffed = Math.abs(dealt - BUFFED) < 1e-6;
            expect(isBase || isBuffed).toBe(true);
        }
        expect(counterRounds[0]).toBeCloseTo(BASE, 6);
    });

    it('enemy NYXEN (shield-hit counter) counters ONLY when the player dents its live shield', () => {
        // ENGINE NOTE: the engine NOW models enemy self-shields from on-CAST shield abilities — the
        // event-only sub-branch in playerTurn.ts grants real enemy pools (see
        // enemyOnCastShield.integration.test.ts). THIS test deliberately keeps the *injected
        // reactive* on-attacked self-shield variant to isolate the reactive-shield path in
        // particular: a REACTIVE on-attacked shield grant creates a live enemy pool by routing
        // through grantShieldToTarget directly. So we pair Nyxen's REAL parsed shield-hit counter
        // (requireShieldHit) with an injected reactive on-attacked self-shield: round 1 the player
        // hits an UNSHIELDED enemy (no counter — shieldWasHit false), the reactive grants a shield,
        // and from round 2 the player dents the LIVE shield → the player→enemy emit carries
        // shieldWasHit:true → Nyxen's counter fires. This exercises the emit's shieldWasHit gating.
        const nyxenCounter = buildShipAbilities(nyxenShip(/* withActiveShield */ false));
        const counterAbility = nyxenCounter.slots
            .find((s) => s.slot === 'passive')
            ?.abilities.find((a) => a.type === 'counter');
        expect(counterAbility).toBeDefined(); // mutation guard: the real shield-hit counter exists
        const reactiveSelfShield: Ability = {
            id: 'enemy-reactive-shield',
            type: 'shield',
            target: 'self',
            trigger: 'on-attacked',
            conditions: [],
            config: { type: 'shield', pct: 50, basis: 'hp' },
        };
        const nyxenShieldHitSkills: ShipSkills = {
            slots: [{ slot: 'passive', abilities: [reactiveSelfShield, counterAbility!] }],
        };
        // Enemy attack 9000 < shield pool (50% of 40_000 = 20_000) so the player's 10_000 dents but
        // does not drain it from round 2 on. Counter = enemy attack 9000 × 100% = 9000.
        const result = runCombat(
            playerAttacksEnemy([
                reactiveEnemyAt('foe', 'M4', nyxenShieldHitSkills, 9_000, 40_000, 50),
            ])
        );
        const counterRounds = result.rounds
            .map((rd) => rd.perTargetDamage?.['attacker'] ?? 0)
            .filter((d) => d > 0);
        expect(counterRounds.length).toBeGreaterThan(0); // counters DO fire (shielded rounds)
        for (const dealt of counterRounds) expect(dealt).toBeCloseTo(9_000, 6);
        // Round 1 (unshielded): the player hit does NOT dent a shield → NO counter that round.
        expect(result.rounds[0].perTargetDamage?.['attacker'] ?? 0).toBe(0);

        // NEGATIVE control: Nyxen's counter WITHOUT any shield source → the shield never exists →
        // shieldWasHit never true → no counter ever lands on the player attacker.
        const noShieldSkills: ShipSkills = {
            slots: [{ slot: 'passive', abilities: [counterAbility!] }],
        };
        const noShieldResult = runCombat(
            playerAttacksEnemy([reactiveEnemyAt('foe', 'M4', noShieldSkills, 9_000, 40_000, 50)])
        );
        expect(totalPerTargetDamage(noShieldResult, 'attacker')).toBe(0);
    });

    it('enemy CENTURION retaliates when IT is the player focus victim (self counter)', () => {
        // The player fires `front` → anchors the Centurion enemy directly → its self on-attacked
        // counter (50% of its attack) strikes the player attacker. Centurion at M2 with no adjacent
        // ally → start-of-combat attack bonus is 0, so the counter is exactly 5000 × 50% = 2500.
        const centurion = buildShipAbilities(
            reactiveEnemyShip({ secondPassiveSkillText: CENTURION_P2 })
        );
        const result = runCombat(
            playerAttacksEnemy([reactiveEnemyAt('foe', 'M4', centurion, 5_000, 1_000_000_000, 50)])
        );
        const counterRounds = result.rounds
            .map((rd) => rd.perTargetDamage?.['attacker'] ?? 0)
            .filter((d) => d > 0);
        expect(counterRounds.length).toBeGreaterThan(0);
        for (const dealt of counterRounds) expect(dealt).toBeCloseTo(2_500, 6);
    });

    it('enemy CENTURION retaliates when an ADJACENT enemy ally is the focus victim; a NON-adjacent ally does NOT', () => {
        // Centurion at M2 has the adjacent-ally on-ally-attacked counter. Geometry (board.ts): M2
        // adjacent = T1,T2,M1,M3,B1,B2; NON-adjacent = M4. The player fires `front`, anchoring the
        // FRONT-most enemy. We place a victim enemy at M4 (front) so the player hits IT; Centurion
        // sits behind. ADJACENT case: a Centurion at M3 (adjacent to the M4 victim) retaliates.
        // NON-adjacent case: Centurion at M1 is NOT adjacent to M4 → no retaliation.
        const adjCenturion = buildShipAbilities(
            reactiveEnemyShip({ secondPassiveSkillText: CENTURION_P2 })
        );
        // An inert front victim enemy the player anchors (no reactive, big HP).
        const victimEnemy = (): EnemyAttacker => ({
            id: 'victim',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 1,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: { slots: [] },
        });

        // ADJACENT: Centurion at M3 (adjacent to M4 victim) → its on-ally-attacked counter fires.
        const adjResult = runCombat(
            playerAttacksEnemy([
                victimEnemy(),
                reactiveEnemyAt('centurion', 'M3', adjCenturion, 5_000, 1_000_000_000, 50),
            ])
        );
        const adjCounter = totalPerTargetDamage(adjResult, 'attacker');
        expect(adjCounter).toBeGreaterThan(0);

        // NON-ADJACENT: Centurion at M1 (NOT adjacent to M4 victim) → adjacency gate rejects → no
        // counter ever lands on the player attacker.
        const farCenturion = buildShipAbilities(
            reactiveEnemyShip({ secondPassiveSkillText: CENTURION_P2 })
        );
        const farResult = runCombat(
            playerAttacksEnemy([
                victimEnemy(),
                reactiveEnemyAt('centurion', 'M1', farCenturion, 5_000, 1_000_000_000, 50),
            ])
        );
        expect(totalPerTargetDamage(farResult, 'attacker')).toBe(0);
    });
});

describe('Task 3 — player→enemy attacked emit: a NON-counter enemy reactive (on-attacked self-buff) fires too', () => {
    // The representative NON-counter on-attacked reactive: a crit-filtered self-BUFF grant injected
    // directly into the enemy's passive slot (the reactive executor emits `buff-applied` for it —
    // unlike reactive heals, which are deliberately silent; triggers.ts). Modeled like Second
    // Wind (on-attacked + crit filter) but as a defensive buff so the fire is event-observable.
    // Proves the player→enemy emit lights up the GENERAL on-attacked path, not only counters.
    const SELF_BUFF = 'Reactive Resolve';
    const selfBuffAbility: Ability = {
        id: 'enemy-reactive-selfbuff',
        type: 'buff',
        target: 'self',
        trigger: 'on-attacked',
        triggerCritFilter: 'crit',
        conditions: [],
        config: {
            type: 'buff',
            buffName: SELF_BUFF,
            parsedEffects: { defense: 20 },
            stacks: 1,
            isStackable: false,
            duration: 2,
        },
    };

    /** An enemy carrying the reactive self-buff in its passive slot. */
    const reactiveBuffEnemy = (id: string, hp: number): EnemyAttacker => ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'passive', abilities: [selfBuffAbility] }] },
    });

    /** Run a battle capturing buff-applied events. */
    const runWithBuffs = (input: CombatEngineInput) => {
        const bus = createEventBus();
        const buffs: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        bus.on('buff-applied', (e) => buffs.push(e));
        const result = runCombat({ ...input, bus });
        return { result, buffs };
    };

    it('an enemy with an on-attacked self-buff applies it when the player CRITS it', () => {
        // Player crits every hit (crit 100) → the player→enemy attacked emit carries didCrit:true →
        // the crit-filtered on-attacked self-buff fires on the enemy each round.
        const { buffs } = runWithBuffs(
            playerAttacksEnemy([reactiveBuffEnemy('foe', 100_000)], { crit: 100, critDamage: 0 })
        );
        const enemyBuffs = buffs.filter((e) => e.actorId === 'foe' && e.buffName === SELF_BUFF);
        expect(enemyBuffs.length).toBeGreaterThan(0);
    });

    it('NEGATIVE control: a NON-crit player hit never fires the crit-filtered enemy reactive', () => {
        // Player crit 0 → no didCrit on the emitted attacked events → the crit-filtered reactive
        // never fires → the enemy applies no self-buff.
        const { buffs } = runWithBuffs(
            playerAttacksEnemy([reactiveBuffEnemy('foe', 100_000)], { crit: 0 })
        );
        expect(buffs.filter((e) => e.actorId === 'foe' && e.buffName === SELF_BUFF)).toHaveLength(
            0
        );
    });
});
