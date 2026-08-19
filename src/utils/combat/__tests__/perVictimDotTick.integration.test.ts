/**
 * PR-C Task C2 — per-victim DoT TICKS resolve at each positioned ship's turn-start (both sides).
 *
 * Today DoTs (corrosion / inferno) tick only on (a) the focus DUMMY enemy (`engine.ts` ~:4966,
 * legacy aggregate via `creditDamage`) and (b) the heal-target (`~:4380` prologue, healing-mode
 * accounting). Every OTHER positioned victim's DoTs never tick. C2 widens the shared `~:4380`
 * turn-start prologue so that EVERY positioned non-dummy actor (attacker, walked-team, enemy
 * attacker) ticks its OWN containers against its OWN HP at its turn-start:
 *   - enemy victims drain own HP via `enemySink`, surface in the focus DoT DPS via `perActorDot`
 *     (keyed by the DoT APPLIER — only player-applied DoTs reach the focus DPS fold);
 *   - player victims drain own HP via `playerSink` (NOT counted in focus DPS);
 *   - the heal-target branch (snapshot + tankDotDamage accounting + dead-skip) is preserved
 *     VERBATIM — a victim that is BOTH positioned AND the heal target ticks via that branch ONLY.
 * The tick sits OUTSIDE every stasis gate (like the heal-target/dummy precedent) → a stasised
 * victim STILL ticks (E5-symmetric). The per-victim path NEVER calls `creditDamage` (no
 * cumulativeDamage double-feed against the dummy HP overwrite).
 *
 * Crit 0 keeps every credited value an exact integer.
 *
 * --- DoT-tick arithmetic (read before the cases) ---
 * Inside tickDoTs (engine.ts ~:752):
 *   corrosion tick = Σ entries:  stacks × (tier/100) × min(victimOwnMaxHp, 500_000) × dotMult × affinityMult
 *   inferno   tick = Σ entries:  stacks × (tier/100) × applierEffectiveAttack × dotMult × affinityMult
 * `remainingRounds` does NOT scale the per-tick value (it only governs expiry via expireStacks).
 * With neutral mults (dotMult 1, affinityMult 1, no Vortex Veil) the factors collapse cleanly.
 *   - Focus 'attacker' applier: effectiveAttack = its `attack` (no buffs), dotMult 1, affinityMult 1.
 *   - A victim's OWN max HP = recipientMaxHp(victim) → its seeded `hp` before it has acted.
 * So a corrosion entry (tier 5, stacks 1) on a victim with maxHp 10000 ticks 0.05 × 10000 = 500.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, ActiveDoTStack } from '../state';
import type { CombatStatBlock } from '../../../types/calculator';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';
import { bareEnemy } from '../__testutils__/bareRosterFixture';
import { normalizeCombatRoster, MIN_TARGETABLE_MAX_HP } from '../normalizeRoster';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvdt${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A small single-hit basic attack (multiplier 100%, 1 hit). attack is kept tiny so the FIRING hit
// touches every footprint victim WITHOUT killing the high-HP ones (and without obscuring the tick).
const basicAttack = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

// An active slot carrying only a basic attack — no skill-triggered detonate (C2 is about DoT TICKS
// on the victim's own turn, NOT skill-triggered detonation on the focus cast).
const basicSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [basicAttack()],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1). Anchored at
// the FRONT enemy (M4) it covers M3 — both are HIT by the firing damage (origin 100, covered 50).
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// A positioned, zero-offense, finite-HP enemy victim. speed 1 → it takes a turn each round (so its
// OWN-turn DoT tick can fire). attack 0 → it contributes 0 direct.
const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

// A pre-seeded corrosion stack. tick = stacks × (tier/100) × min(victimOwnMaxHp, 500_000) (neutral mults).
const corrosion = (
    tier: number,
    stacks: number,
    remainingRounds: number,
    sourceId: string
): ActiveDoTStack => ({ tier, stacks, remainingRounds, sourceId });

// A pre-seeded inferno stack. tick = stacks × (tier/100) × applierEffectiveAttack (neutral mults).
const inferno = (
    tier: number,
    stacks: number,
    remainingRounds: number,
    sourceId: string
): ActiveDoTStack => ({ tier, stacks, remainingRounds, sourceId });

const FOCUS_ATTACK = 100; // tiny firing hit — marks victims hit without killing high-HP ones.

// Positional BASE: focus at M4 fires a Line-Range-1 basic attack at `front` (M4) covering M3.
const POSITIONAL_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: FOCUS_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicSlot()] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 2,
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
    hp: 1_000_000_000,
    healModifier: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: lineRange1Pattern(),
    enemyAttackers: [
        enemyAt('enemy-front', 'M4', 1_000_000_000),
        enemyAt('enemy-mid', 'M3', 1_000_000_000),
    ],
    ...overrides,
});

// Formerly-non-positional BASE: a single enemy, NO position/target/pattern given explicitly — the
// boundary auto-fills both. SP-4c-2a's targetable-HP floor now raises this 0-max-HP
// "pressure-source" enemy to MIN_TARGETABLE_MAX_HP too, so it is real and positional (it used to
// reach the legacy DPS dummy-tick path instead). DoT containers are seeded on this real enemy
// ('pressure-source') rather than the dummy.
const NONPOS_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy({ id: 'pressure-source', stats: { hp: 0 } }),
    attack: FOCUS_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicSlot()] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 2,
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
    hp: 1_000_000_000,
    healModifier: 0,
    ...overrides,
});

// A walked-team ally: a positioned, offensive player team actor with its own board position/target/
// pattern + a basic-attack active slot. It takes a turn each round (speed 100).
const teamStats = (hp: number): CombatStatBlock => ({
    attack: FOCUS_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    defence: 0,
    hp,
    hacking: 0,
});

const teamAlly = (id: string, position: Position, hp: number): TeamActorEngineInput =>
    ({
        id,
        speed: 100,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern: lineRange1Pattern(),
        walk: {
            shipSkills: { slots: [basicSlot()] },
            stats: teamStats(hp),
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

// Tap an ordered event log.
const collect = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = ['dot-ticked', 'ship-destroyed', 'turn-started'];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

describe('per-victim DoT ticks at each positioned ship’s turn-start (PR-C C2)', () => {
    it('C.1 enemy own-HP tick: a positioned enemy ticks focus-applied corrosion+inferno against its OWN HP, surfaced in focus DoT DPS', () => {
        idc = 0;
        // enemy-back at M2 — OUTSIDE the Line-Range-1 footprint (M4+M3), so it takes NO firing hit:
        // its perTargetDamage this round is the pure DoT tick. maxHp 10000.
        //   corrosion (tier 5, stacks 1, applier 'attacker') → 0.05 × 10000 = 500.
        //   inferno   (tier 10, stacks 1, applier 'attacker') → 0.10 × 100 (focus attack) = 10.
        // total tick = 510, lands on enemy-back's own HP via enemySink at ITS turn-start.
        const { events, result } = collect(
            POSITIONAL_BASE({
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 1_000_000_000),
                    enemyAt('enemy-back', 'M2', 10000), // outside footprint
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    const back = actors.find((a) => a.id === 'enemy-back');
                    back?.corrosionEntries.push(corrosion(5, 1, 5, 'attacker'));
                    back?.infernoEntries.push(inferno(10, 1, 5, 'attacker'));
                },
            })
        );

        // Round 1: tick 500 + 10 = 510 on enemy-back's own HP (no firing hit — outside footprint).
        const round1 = result.rounds[0];
        expect(round1.perTargetDamage?.['enemy-back']).toBe(510);
        // NOT double-fed into the dummy aggregate: the dummy 'enemy' takes no perTargetDamage,
        // and the dummy HP overwrite (cumulativeDamage) is not fed (focus.corrosion stays 0).
        expect(round1.perTargetDamage?.['enemy']).toBeUndefined();

        // dot-ticked events target enemy-back, one per dot type.
        const ticks = events.filter(
            (e) =>
                e.type === 'dot-ticked' &&
                (e as CombatEvent & { targetId: string }).targetId === 'enemy-back'
        );
        expect(ticks.length).toBeGreaterThanOrEqual(2); // corrosion + inferno per round (≥ round 1)

        // The focus DoT DPS breakdown reflects the tick via the C1 perActorDot fold (applier
        // 'attacker' === focus): corrosionDamage 500 + infernoDamage 10 surface on the round row.
        expect(round1.corrosionDamage).toBe(500);
        expect(round1.infernoDamage).toBe(10);
    });

    it('C.1 lethal: a turn-start DoT tick ≥ the enemy’s HP destroys it and skips the rest of its turn', () => {
        idc = 0;
        // enemy-back at M2 (outside footprint), HP 400. corrosion tier 5 stacks 1 → 0.05 × 400 = 20.
        // 20 < 400 is NOT lethal — bump to a lethal tick: corrosion against its own maxHp 400 with
        // stacks 30 tier 100 would be huge; simpler: maxHp 400, tier 100, stacks 1 → 0.05? no.
        // Use a high tier: tier 100 stacks 1 → 1.00 × min(400,500000) = 400 == HP → lethal.
        const { events, result } = collect(
            POSITIONAL_BASE({
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 1_000_000_000),
                    enemyAt('enemy-back', 'M2', 400),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-back')
                        ?.corrosionEntries.push(corrosion(100, 1, 5, 'attacker')); // 400 → lethal
                },
            })
        );

        // enemy-back died (turn-start tick was lethal).
        const destroyed = events.filter((e) => e.type === 'ship-destroyed');
        expect(
            destroyed.some((e) => (e as CombatEvent & { actorId: string }).actorId === 'enemy-back')
        ).toBe(true);

        // It took exactly ONE turn (round 1, the lethal tick) — the rest of its turn was skipped and
        // it must NOT take a round-2 turn.
        const backTurns = events.filter(
            (e) =>
                e.type === 'turn-started' &&
                (e as CombatEvent & { actorId: string }).actorId === 'enemy-back'
        );
        expect(backTurns.length).toBe(1);

        const round1 = result.rounds[0];
        expect(round1.perTargetDamage?.['enemy-back']).toBe(400);
    });

    it('C.2 non-heal-target player: a positioned ally ticks enemy-applied DoTs against own HP via playerSink, NOT in focus DPS', () => {
        idc = 0;
        // team-ally at M2 (player side), maxHp 10000. healTargetId is 'attacker' (the focus), so the
        // ally is NOT the heal target → it ticks via the per-victim playerSink branch. corrosion
        // (tier 5, stacks 1, applier 'enemy-front') → 0.05 × 10000 = 500 on the ally's own HP. The
        // enemy applier acts AFTER the players in round 1 (no ctx → skip), so the tick first lands
        // in round 2.
        const { events, result } = collect(
            POSITIONAL_BASE({
                teamActors: [teamAlly('team-ally', 'M2', 10000)],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'team-ally')
                        ?.corrosionEntries.push(corrosion(5, 1, 5, 'enemy-front'));
                },
            })
        );

        const round2 = result.rounds[1];
        // The ally's own HP drained 500 via playerSink (round 2 — applier had ctx by then).
        expect(round2.perTargetDamage?.['team-ally']).toBe(500);
        // dot-ticked targets the ally.
        const ticks = events.filter(
            (e) =>
                e.type === 'dot-ticked' &&
                (e as CombatEvent & { targetId: string }).targetId === 'team-ally'
        );
        expect(ticks.length).toBeGreaterThanOrEqual(1);

        // NOT counted in the focus DoT DPS — perActorDot stays empty for player-side ticks
        // (enemy-applied DoT is not the focus player's outgoing DPS).
        expect(round2.corrosionDamage).toBe(0);
        expect(round2.infernoDamage).toBe(0);
    });

    it('C.2 heal-target regression: the heal target still ticks once via the tankDotSnapshot + healing accounting branch', () => {
        idc = 0;
        // Healing mode: the focus 'attacker' is the heal target and carries an enemy-applied
        // corrosion (tier 5, stacks 1, applier 'enemy-mid'). maxHp 10000 → tick 500. The applier
        // 'enemy-mid' acts AFTER the focus in round 1 (no ctx → faster-victim skip), so the tick
        // first lands in round 2 — byte-identical to pre-C2 behaviour, ticked via the heal-target
        // branch and routed into the tank's INCOMING accounting (NOT a player damage row).
        const { events, result } = collect(
            NONPOS_BASE({
                healTargetId: 'attacker',
                mode: 'healing',
                hp: 10000,
                numRounds: 3,
                enemyAttackers: [enemyAt('enemy-mid', 'M3', 1_000_000_000)],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'attacker')
                        ?.corrosionEntries.push(corrosion(5, 1, 5, 'enemy-mid'));
                },
            })
        );

        // The heal target ticked: a dot-ticked event targets the tank (the heal-target branch),
        // first in round 2.
        const ticks = events.filter(
            (e) =>
                e.type === 'dot-ticked' &&
                (e as CombatEvent & { targetId: string }).targetId === 'attacker'
        );
        expect(ticks.length).toBeGreaterThanOrEqual(1);
        expect((ticks[0] as CombatEvent & { round: number }).round).toBe(2);

        // Healing-mode accounting: the tank's INCOMING intake recorded the 500 DoT tick in round 2
        // (routed via applyIncomingToTarget → playerSink, NOT a player damage row).
        const healing = (result as { healing?: { rounds: { incomingDamage: number }[] } }).healing;
        expect(healing).toBeDefined();
        expect(healing?.rounds[0].incomingDamage).toBe(0); // round 1: applier had no ctx yet
        expect(healing?.rounds[1].incomingDamage).toBe(500); // round 2: ticks

        // The heal-target tick is NOT surfaced as the focus player's outgoing DoT DPS.
        expect(result.rounds[1].corrosionDamage).toBe(0);
    });

    it('E5 symmetry: the same DoT carrier ticks identical integers + events on the player side and the enemy side', () => {
        idc = 0;
        // The SAME corrosion carrier (tier 5, stacks 1) on a positioned victim of maxHp 10000 ticks
        // 0.05 × 10000 = 500 regardless of side. Player run: on a walked-team ally at M2. Enemy run:
        // on an enemy-back at M2. Both outside the firing footprint → pure-tick perTargetDamage. The
        // tick value is round-independent (the player victim's enemy applier acts a round later than
        // the enemy victim's focus applier, so each ticks in a different round — we pick each side's
        // own tick round). The E5 invariant is the DAMAGE: identical integer + identical event.
        const firstTick = (
            rounds: { perTargetDamage?: Record<string, number> }[],
            id: string
        ): number | undefined =>
            rounds.map((rd) => rd.perTargetDamage?.[id]).find((v) => v != null);

        // --- PLAYER side ---
        const playerRun = collect(
            POSITIONAL_BASE({
                teamActors: [teamAlly('team-ally', 'M2', 10000)],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'team-ally')
                        ?.corrosionEntries.push(corrosion(5, 1, 5, 'enemy-front'));
                },
            })
        );
        const playerTick = firstTick(playerRun.result.rounds, 'team-ally');
        const playerDotTicks = playerRun.events.filter(
            (e) =>
                e.type === 'dot-ticked' &&
                (e as CombatEvent & { targetId: string }).targetId === 'team-ally'
        );

        // --- ENEMY side ---
        idc = 0;
        const enemyRun = collect(
            POSITIONAL_BASE({
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 1_000_000_000),
                    enemyAt('enemy-back', 'M2', 10000),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-back')
                        ?.corrosionEntries.push(corrosion(5, 1, 5, 'attacker'));
                },
            })
        );
        const enemyTick = firstTick(enemyRun.result.rounds, 'enemy-back');
        const enemyDotTicks = enemyRun.events.filter(
            (e) =>
                e.type === 'dot-ticked' &&
                (e as CombatEvent & { targetId: string }).targetId === 'enemy-back'
        );

        // Identical tick INTEGER on both sides (the E5 invariant). The dot-ticked COUNT differs only
        // because the player victim's enemy applier acts a round later than the enemy victim's focus
        // applier (a turn-ordering artifact, not an asymmetry), so we compare the per-tick DAMAGE.
        expect(playerTick).toBe(500);
        expect(enemyTick).toBe(500);
        expect(playerTick).toBe(enemyTick);
        // Both sides emit at least one dot-ticked, and the first tick's damage is identical.
        expect(playerDotTicks.length).toBeGreaterThanOrEqual(1);
        expect(enemyDotTicks.length).toBeGreaterThanOrEqual(1);
        const pTickDmg = (playerDotTicks[0] as CombatEvent & { damage: number }).damage;
        const eTickDmg = (enemyDotTicks[0] as CombatEvent & { damage: number }).damage;
        expect(pTickDmg).toBe(eTickDmg);
        expect(pTickDmg).toBe(500);
    });

    it('Stasis pin: a STASISED positioned victim STILL ticks its DoTs (both sides) — the tick sits OUTSIDE the stasis gate', () => {
        // KEY DECISION non-vacuity: the tick lives at the shared turn-start prologue, OUTSIDE every
        // `if (!isTurnBlocked)` stasis gate. Moving it INSIDE the stasis gate would make a stasised
        // victim NOT tick → these assertions would fail. We inflict REAL Stasis on the victim via a
        // dedicated long-duration Stasis-inflict cast (verified live via __testTapIsStasised) and
        // confirm the victim's DoT STILL ticks while it is turn-blocked.
        idc = 0;
        // A pure (non-damaging) Stasis-inflict active skill targeting `front`. No damage ability →
        // the victim is not directly hit by the inflicter, so the Stasis is not broken by a hit.
        const stasisOnlyInflict = (turns: number): ShipSkills['slots'][number] => ({
            slot: 'active',
            abilities: [
                {
                    id: `st${++idc}`,
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    type: 'debuff',
                    config: {
                        type: 'debuff',
                        buffName: 'Stasis',
                        application: 'inflict',
                        duration: turns,
                        stacks: 1,
                        isStackable: false,
                        parsedEffects: {},
                    },
                } as Ability,
            ],
        });

        // --- ENEMY side: the focus stasises enemy-front, which carries a focus-applied DoT.
        // The focus fires a pure Stasis-inflict at `front` (enemy-front, M4) — no firing damage to
        // break the Stasis. enemy-front is the DoT carrier (applier 'attacker', present round 1).
        let enemyStasised: ((id: string) => boolean) | undefined;
        const enemyRun = (() => {
            const bus = createEventBus();
            const events: CombatEvent[] = [];
            bus.on('dot-ticked', (e) => events.push(e as CombatEvent));
            const result = runCombat({
                ...POSITIONAL_BASE({
                    shipSkills: { slots: [stasisOnlyInflict(9)] },
                    hacking: 200, // inflict landing 1.0 vs security 0
                    numRounds: 3,
                    enemyAttackers: [enemyAt('enemy-front', 'M4', 10000)],
                    __testTapActors: (actors: CombatActor[]) => {
                        actors
                            .find((a) => a.id === 'enemy-front')
                            ?.corrosionEntries.push(corrosion(5, 1, 9, 'attacker'));
                    },
                }),
                __testTapIsStasised: (fn) => {
                    enemyStasised = fn;
                },
                bus,
            } as CombatEngineInput);
            return { result, events };
        })();
        // The victim is genuinely stasised at end-of-run (Stasis duration 9 spans all 3 rounds).
        expect(enemyStasised?.('enemy-front')).toBe(true);
        // …and it STILL ticked its DoT every round (500 each), proving the tick is outside the gate.
        const enemyFirstTick = enemyRun.result.rounds
            .map((rd) => rd.perTargetDamage?.['enemy-front'])
            .find((v) => v != null);
        expect(enemyFirstTick).toBe(500);

        // --- PLAYER side: an enemy stasises a WALKED-TEAM ally (NOT the heal target), which carries
        // an enemy-applied DoT. The ally is the front-most player (M4) so the enemy's `front` targets
        // it; the focus is moved to M3 and remains the heal target (so the ally ticks via the
        // per-victim playerSink branch, surfacing on perTargetDamage). The Stasis-inflicter deals no
        // damage → the ally is never directly hit → its Stasis is not broken.
        idc = 0;
        let playerStasised: ((id: string) => boolean) | undefined;
        const playerRun = (() => {
            const bus = createEventBus();
            const result = runCombat({
                ...POSITIONAL_BASE({
                    position: 'M3', // focus moved back so the front-most player is the ally
                    hacking: 0,
                    numRounds: 3,
                    teamActors: [teamAlly('team-ally', 'M4', 10000)], // front-most player
                    enemyAttackers: [
                        {
                            id: 'enemy-stasiser',
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defence: 0,
                                hp: 1_000_000_000,
                                speed: 1,
                                hacking: 200,
                            },
                            chargeCount: 0,
                            startCharged: false,
                            position: 'M4',
                            target: parsedTarget('front'),
                            pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
                            shipSkills: { slots: [stasisOnlyInflict(9)] },
                        } as EnemyAttacker,
                    ],
                    __testTapActors: (actors: CombatActor[]) => {
                        actors
                            .find((a) => a.id === 'team-ally')
                            ?.corrosionEntries.push(corrosion(5, 1, 9, 'enemy-stasiser'));
                    },
                }),
                __testTapIsStasised: (fn) => {
                    playerStasised = fn;
                },
                bus,
            } as CombatEngineInput);
            return { result };
        })();
        expect(playerStasised?.('team-ally')).toBe(true);
        // The stasised ally STILL ticks its enemy-applied DoT (the applier acts after the players in
        // round 1 → first tick in a later round). It surfaces via playerSink on the ally's own HP.
        const playerFirstTick = playerRun.result.rounds
            .map((rd) => rd.perTargetDamage?.['team-ally'])
            .find((v) => v != null);
        expect(playerFirstTick).toBe(500);
    });

    it('REGRESSION: the (now-floored, positional) sole enemy’s DoT tick still surfaces via the focus corrosion channel', () => {
        idc = 0;
        // SP-4c-2a: `NONPOS_BASE`'s 0-max-HP 'pressure-source' enemy is now floored to
        // MIN_TARGETABLE_MAX_HP, so it is real and positional — the tap targets its real id
        // rather than the no-longer-existing 'enemy' dummy. The round-row scalar `corrosionDamage`
        // is `focus.corrosion + perActorDot.get(focusActorId)?.corrosion` (engine.ts), which folds
        // in the per-victim DoT-tick credit attributed to the focus rather than suppressing it
        // (the same fold `detonationDamage` uses for bombs) — so it still reads the tick amount
        // once the tap lands on the real actor.
        //
        // The MAGNITUDE moved too: the legacy dummy's HP was overridden by the top-level `enemyHp`
        // (10000 here), but `enemyHp` is NOT read for a real `enemyAttackers` roster member — this
        // enemy's HP is the FLOORED 1,000,000. tick = stacks(1) × tier(5)/100 ×
        // min(victimHp, 500_000) = 0.05 × min(1_000_000, 500_000) = 0.05 × 500_000 = 25000
        // (confirmed by standalone repro against the real engine).
        const { result } = collect(
            NONPOS_BASE({
                enemyHp: 10000,
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'pressure-source')
                        ?.corrosionEntries.push(corrosion(5, 1, 5, 'attacker'));
                },
            })
        );
        // Round 1: the tick surfaces via the focus corrosion channel (RoundData field).
        expect(result.rounds[0].corrosionDamage).toBe(25000);
        // ⚠️ DISCOVERED ASYMMETRY (not fixed here — engine.ts is out of scope for this task, and
        // this is pre-existing behaviour the floor merely makes reachable for the first time).
        // `cumulativeDamage` is fed by `totalRoundDamage`, which deliberately uses RAW
        // `focus.corrosion` only (engine.ts: "folding perActorDot here would double-drain the
        // dummy HP overwrite") — it does NOT fold the perActorDot-credited positional tick the
        // way the round-row `corrosionDamage` display field does. Confirmed by standalone repro:
        // `cumulativeDamage` reads 0 here even though `corrosionDamage` correctly reads 25000. The
        // real cumulative credit for a positional run lives in the per-victim channel instead:
        // firing hit 100 (FOCUS_ATTACK) + corrosion tick 25000 = 25100 on the real victim.
        expect(result.rounds[0].cumulativeDamage).toBe(0);
        expect(result.rounds[0].perTargetDamage?.['pressure-source']).toBe(25100);
    });

    it('Positioned AND heal-target (branch-collision): a victim that is both ticks EXACTLY ONCE via the heal-target branch', () => {
        idc = 0;
        // The walked-team ally 'team-ally' is BOTH positioned (M2) AND the heal target. It must tick
        // EXACTLY ONCE per ticking round — via the heal-target branch (isHealTarget short-circuits
        // the per-victim path) — NOT twice. corrosion (tier 5, stacks 1, applier 'enemy-front'),
        // ally maxHp 10000 → 500. The applier acts after the team in round 1 → first tick round 2.
        const { events, result } = collect(
            POSITIONAL_BASE({
                healTargetId: 'team-ally',
                mode: 'healing',
                numRounds: 3,
                teamActors: [teamAlly('team-ally', 'M2', 10000)],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'team-ally')
                        ?.corrosionEntries.push(corrosion(5, 1, 9, 'enemy-front'));
                },
            })
        );

        // In EVERY round there is AT MOST ONE corrosion dot-ticked targeting the ally (a double-tick
        // — heal-target branch AND per-victim branch firing — would produce two per round).
        for (let round = 1; round <= 3; round++) {
            const perRound = events.filter(
                (e) =>
                    e.type === 'dot-ticked' &&
                    (e as CombatEvent & { targetId: string }).targetId === 'team-ally' &&
                    (e as CombatEvent & { round: number }).round === round &&
                    (e as CombatEvent & { dotType: string }).dotType === 'corrosion'
            );
            expect(perRound.length).toBeLessThanOrEqual(1);
        }
        // It DID tick (at least once across the run) — the heal-target branch fired.
        const totalCorrosionTicks = events.filter(
            (e) =>
                e.type === 'dot-ticked' &&
                (e as CombatEvent & { targetId: string }).targetId === 'team-ally' &&
                (e as CombatEvent & { dotType: string }).dotType === 'corrosion'
        );
        expect(totalCorrosionTicks.length).toBeGreaterThanOrEqual(1);

        // The heal-target branch routes the tick into the tank's INCOMING accounting (NOT a player
        // damage row) — so perTargetDamage['team-ally'] is NEVER populated by a per-victim DoT tick.
        // (The ally takes no firing hit at M2, so the key stays absent every round — proving no
        // per-victim DoT row was written for the heal-target carrier.)
        for (const round of result.rounds) {
            expect(round.perTargetDamage?.['team-ally']).toBeUndefined();
        }
    });

    it('Round-1 faster-victim, no applier ctx: tickDoTs skips the entry (no HP/row) but still ages the stack', () => {
        idc = 0;
        // A DoT whose applier has not acted yet: a SLOW focus (speed implied by turn order) vs a FAST
        // enemy-back. We seed corrosion applied by 'enemy-mid' (an enemy that acts AFTER enemy-back in
        // round 1 ordering is not guaranteed); to make this deterministic we use an applier id that
        // NEVER acts — a non-existent 'ghost-applier' has no ctx in lastTurnCtxByActor in ANY round.
        // tickDoTs `if (!ctx) continue` skips it → no HP drain, no perTargetDamage — but expireStacks
        // still ages it (remainingRounds 1 → 0 → removed after round 1). We can only assert the
        // observable: no HP drain and no perTargetDamage for the victim across both rounds.
        const { events, result } = collect(
            POSITIONAL_BASE({
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 1_000_000_000),
                    enemyAt('enemy-back', 'M2', 10000),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-back')
                        ?.corrosionEntries.push(corrosion(5, 1, 1, 'ghost-applier'));
                },
            })
        );

        // No applier ctx → entry skipped: no HP drain, no perTargetDamage for enemy-back (no firing
        // hit either — outside footprint).
        for (const round of result.rounds) {
            expect(round.perTargetDamage?.['enemy-back']).toBeUndefined();
        }
        // No dot-ticked event fired for the skipped entry.
        const ticks = events.filter(
            (e) =>
                e.type === 'dot-ticked' &&
                (e as CombatEvent & { targetId: string }).targetId === 'enemy-back'
        );
        expect(ticks.length).toBe(0);
    });

    it('Team-applier DoT on a positioned enemy: HP drains via enemySink + perActorDot keyed to the TEAM source → focus DoT DPS IGNORES it', () => {
        idc = 0;
        // A NON-focus team ship 'team-ally' applies a corrosion on the enemy victim 'enemy-back'.
        // The tick drains enemy-back's HP (enemySink) and is keyed under the team source in
        // perActorDot, so the focus-DPS fold (perActorDot.get(focusActorId='attacker')) IGNORES it —
        // the focus DoT total stays 0. tick = 0.05 × 10000 = 500.
        const { result } = collect(
            POSITIONAL_BASE({
                teamActors: [teamAlly('team-ally', 'M3', 1_000_000_000)],
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 1_000_000_000),
                    enemyAt('enemy-back', 'M2', 10000), // outside footprint
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-back')
                        ?.corrosionEntries.push(corrosion(5, 1, 5, 'team-ally'));
                },
            })
        );

        const round1 = result.rounds[0];
        // enemy-back's HP drained 500 via enemySink.
        expect(round1.perTargetDamage?.['enemy-back']).toBe(500);
        // The focus DoT DPS (perActorDot.get('attacker')) is UNCHANGED — the team source key is
        // ignored by the focus fold.
        expect(round1.corrosionDamage).toBe(0);
        expect(round1.infernoDamage).toBe(0);
    });
    // ── The own-HP tick's gate must stay `isPositional`, NOT `resolvesPositionalVictim` ──────
    //
    // SP-4b-1 §4B split one overloaded predicate into three and moved SEVEN cast/selection gates
    // from `isPositional` to `resolvesPositionalVictim`. Two sites deliberately did NOT move,
    // because they route the actor's OWN state and the opposing roster is only a MODE signal:
    // `applyPositionedTimedBurst` (engine.ts ~:6530) and THIS tick (engine.ts ~:8300). Narrowing
    // the burst site was caught by `barrier.test.ts › blocks a bomb detonation`; narrowing this one
    // was caught by NOTHING — it survived as a mutant. This test closes that hole.
    //
    // The two predicates diverge on exactly one input class: the opposing roster is PLACED but has
    // no member with `stats.hp > 0` (a roster of 0-max-HP pressure sources — the shape 54 fixture
    // files and the pre-SP-3b healing calculator pass). So the enemies here are placed with max HP
    // 0. `isPositional` is TRUE (they carry positions), `resolvesPositionalVictim` is FALSE (none is
    // hittable) — and the ally's own corrosion MUST still tick against its own HP, because whether
    // the ally can find a VICTIM has nothing to do with whether its own DoT containers burn it.
    // Narrowing the gate strands the containers unticked: the same "state routed to nowhere" defect
    // §4B fixed, one layer down.
    // RULING (SP-4c-2a, already decided — see task brief). This test used to pin "an ally ticks
    // its OWN corrosion even when NO opposing actor is hittable": the divergence zone it needed
    // was an enemy roster that is POSITIONED (`isPositional` true, via `enemyAt(..., 0)`'s
    // explicit board slot) but NOT a valid victim (`resolvesPositionalVictim` false, via `hp: 0`).
    //
    // The targetable-HP floor (normalizeRoster.ts, MIN_TARGETABLE_MAX_HP) closes that shape
    // CATEGORICALLY for the enemy side: `withTargetableHp` floors every enemy attacker's `stats.hp`
    // unconditionally, with no escape hatch, so `resolvesPositionalVictim` is now TRUE for every
    // positioned enemy — there is no longer any way to construct an enemy that is positioned but
    // unhittable. This is NOT restorable by killing the enemy mid-combat either:
    // `isTargetableRosterMember` keys on STATIC `stats.hp` (max HP), not live `currentHp`, so a
    // corpse still reads as targetable, and SP-4c-1 ends the match outright once the only enemy
    // dies anyway. Adding an opt-out flag to the floor is a standing owner ruling this epic already
    // closed: "no opt-out flag for legacy fixtures — an escape hatch preserves the exact fork 4c
    // needs gone."
    //
    // So: the premise is structurally unconstructible, not numerically stale, and the retention
    // GATE this test covered (the `isPositional`-not-`resolvesPositionalVictim` divergence inside
    // the DoT-tick site) is deleted outright in rung 4c-2d along with the dummy — so the coverage
    // loss is EXPECTED, the same closure `dummyEnemyTurnGate.test.ts`'s tripwire documents for the
    // sibling turn-order gate.
    //
    // TRIPWIRE: assert the premise is unconstructible — the roster this fixture asks for (two
    // positioned, 0-max-HP enemies) arrives at the engine already floored and hittable. If the
    // premise ever becomes constructible again (the floor removed, or gains an escape hatch), this
    // fails and flags that the GATE RETENTION claim needs re-deriving before it can be trusted.
    it('TRIPWIRE: the GATE RETENTION premise (positioned-but-unhittable enemy) is gone — every positioned enemy arrives already hittable', () => {
        const input = POSITIONAL_BASE({
            teamActors: [teamAlly('team-ally', 'M2', 10000)],
            enemyAttackers: [enemyAt('enemy-front', 'M4', 0), enemyAt('enemy-mid', 'M3', 0)],
        });
        const floored = normalizeCombatRoster(input);
        expect(floored.enemyAttackers.every((e) => e.stats.hp === MIN_TARGETABLE_MAX_HP)).toBe(
            true
        );
    });
});
