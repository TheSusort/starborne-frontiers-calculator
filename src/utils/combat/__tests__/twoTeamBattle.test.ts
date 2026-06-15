/**
 * Combat Simulator Phase 5 — PR 1, Task 1: CHARACTERIZATION SPIKE (tests only).
 *
 * Goal: before building the battle-result assembler (Task 2), PROVE the data source.
 * A tiny 2v2 POSITIONED battle through `runCombat` must emit usable damage data for BOTH
 * directions (player→enemy AND enemy→player), so the assembler can attribute per-attacker
 * dealt damage and per-victim taken damage symmetrically. This test pins exactly which
 * events/fields carry that data, observed from the live engine (not assumed).
 *
 * Harness style is copied wholesale from positionalDamage.integration.test.ts (the ab()/
 * basicAttack()/parsedTarget()/pattern helpers, the positioned-actor builders, healTargetId
 * to unlock the enemy roster). No new harness is invented.
 *
 * ========================== PINNED DATA-SOURCE CONTRACT ==========================
 * (Observed from runCombat on the 2v2 below. Field names verified against
 *  src/utils/combat/events.ts + the playerTurn.ts:~1301 emit + engine.ts emitHit/3477.)
 *
 * DAMAGE DEALT, per attacker  →  `ability-performed` event, keyed by `actorId`.
 *   - { type:'ability-performed', actorId, targetId, round, abilityType:'damage',
 *       damage, didCrit?, critHits?, didHit? }
 *   - Emitted ONCE per firing turn for the firing damage hit; `damage` is the full
 *     directDamage of that hit (playerTurn.ts). `actorId` = the firing actor, `targetId`
 *     = the anchor enemy it fired at (from the firing actor's perspective).
 *   - SYMMETRIC: the enemy attacker turn runs the SAME runPlayerTurn code path with
 *     `enemy: tgt` bound to a live PLAYER actor, so an enemy firing emits ability-performed
 *     with actorId = ENEMY id and targetId = PLAYER id. Both directions appear in one stream.
 *     => player→enemy : actorId∈players, targetId∈enemies
 *     => enemy→player : actorId∈enemies, targetId∈players
 *
 * DAMAGE TAKEN, per victim  →  `RoundData.perTargetDamage` (Record<victimId, number>).
 *   - Accumulated by a SINGLE shared `emitHit` inside drivePositionalApply (engine.ts:~2260),
 *     used identically at ALL THREE positional sites (focus→enemy, team→enemy, enemy→player).
 *     Each victim's per-round landed damage (origin full / covered half across the AoE
 *     footprint) is summed into the map by victim id.
 *   - SYMMETRIC: enemy victim ids AND player victim ids both appear here (whichever side
 *     was struck by a positional firing hit that round). This is the per-victim "damage taken"
 *     surface the Task-2 assembler will read.
 *   - The field is set on RoundData ONLY when the map is non-empty (else absent) — so a
 *     non-positional run leaves it undefined (keeps legacy goldens byte-identical).
 *
 * `attacked` event  →  NO damage amount; ANCHOR victim only.
 *   - { type:'attacked', targetId, attackerId, round, didCrit? } — carries the attacker id
 *     and the single struck `tgt` (the anchor victim of the enemy's positional/legacy attack),
 *     NOT every AoE-covered victim, and NO numeric damage. So `attacked` is useful for "who
 *     hit whom / crit?" but is NOT a damage source — use ability-performed/perTargetDamage.
 *
 * HEALS / HP / DEATH:
 *   - heals: `heal-performed` { casterId, targets[], amount, critHits? } (healing mode only).
 *   - HP fraction crossings: `hp-changed` { targetId, oldPct, newPct }. This fires for BOTH
 *     sides, but with caveats that make it UNSUITABLE as a sole HP source:
 *       * Positioned enemy ATTACKERS DO emit hp-changed from round 2 onward — they walk
 *         `runPlayerTurn` and set `lastTurnCtxByActor`, so `recipientMaxHp` knows their
 *         `effectiveMaxHp` and the `maxHp > 0` gate passes. Suppression holds ONLY for
 *         (a) the legacy dummy `enemy` actor and (b) round 1, before any enemy turn has run.
 *       * So enemy hp-changed events DO appear — but at integer / low granularity and with
 *         round-1-suppression timing that differs from the player side. Treat hp-changed as
 *         informational, NOT as a reliable per-actor HP curve.
 *   - PER-VICTIM DAMAGE TAKEN (reliable, symmetric): `RoundData.perTargetDamage`
 *     (Record<victimId, number>) is the RELIABLE per-victim damage-taken source for BOTH
 *     directions — use it, not hp-changed. The Task-2 assembler should derive each actor's
 *     HP% as `maxHp - cumulative(perTargetDamage for that victim)` over rounds, using the
 *     roster's maxHp. This is uniform for both sides and independent of hp-changed timing /
 *     granularity quirks. (It ignores healing/shields applied to HP — acceptable for PR1's
 *     surface; refine if needed.)
 *   - death: `ship-destroyed` { actorId } — emitted once per actor (player OR enemy) whose
 *     HP first reaches 0. Fires for BOTH sides as HP allows.
 * ================================================================================
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `tt${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A single-hit basic attack: multiplier 100% (1x), 1 hit, no passive payload — so the firing
// hit's directDamage equals attack × 1 vs defence 0 (clean known per-victim damage).
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// Origin-only (single-target) footprint.
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A walked team actor that FIRES: own position + target + pattern + a damage skill.
const teamAttackerAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    attack: number,
    hp: number
): TeamActor => ({
    id,
    speed: 150,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget(selection),
    pattern: basePattern(),
    walk: {
        shipSkills: { slots: [basicAttack()] },
        stats: {
            attack,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp,
        },
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

// A positioned ENEMY attacker that FIRES on the player roster: position + target + pattern +
// a damage skill so its firing hit produces positionalScalars (Task 9 enemy site).
const offensiveEnemyAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    attack: number,
    hp: number
): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

// 2v2 base: focus 'attacker' at M4 fires `front` (an enemy), plus one walked team attacker;
// two offensive enemies fire `front` (a player). healTargetId unlocks the enemy roster.
// HP/attack args parameterized so we can run a "huge HP, nobody dies" variant (to read
// perTargetDamage as actual landed damage) and a "low HP, both sides die" variant.
const battle = (opts: {
    playerHp: number;
    enemyHp: number;
    playerAttack: number;
    enemyAttack: number;
}): CombatEngineInput => ({
    // Focus actor (player side, the heal target / front-most player at M4).
    attack: opts.playerAttack,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    debuffLandingChance: 1,
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: opts.playerHp,
    // Healing mode — required for the positioned enemy roster to be built.
    healTargetId: 'attacker',
    position: 'M4',
    // Focus fires on the front enemy (origin M4 from the enemy roster's front).
    target: parsedTarget('front'),
    pattern: basePattern(),
    // Player side second actor: walked team attacker at M3 firing the back enemy.
    teamActors: [teamAttackerAt('player-team', 'M3', 'back', opts.playerAttack, opts.playerHp)],
    // Enemy side: two offensive attackers. enemy-front fires `front` (anchors the front-most
    // player = the focus at M4); enemy-back fires `back` (anchors the back-most player = M3).
    enemyAttackers: [
        offensiveEnemyAt('enemy-front', 'M4', 'front', opts.enemyAttack, opts.enemyHp),
        offensiveEnemyAt('enemy-back', 'M1', 'back', opts.enemyAttack, opts.enemyHp),
    ],
});

const PLAYER_IDS = new Set(['attacker', 'player-team']);
const ENEMY_IDS = new Set(['enemy-front', 'enemy-back']);

/** Run a battle, capturing the full event stream + the round data. */
const run = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const ALL_TYPES: CombatEvent['type'][] = [
        'ability-performed',
        'attacked',
        'hp-changed',
        'ship-destroyed',
        'heal-performed',
    ];
    for (const t of ALL_TYPES) {
        bus.on(t, (e) => events.push(e as CombatEvent));
    }
    const result = runCombat({ ...input, bus });
    return { events, result };
};

describe('Two-team positional battle — characterization spike (Phase 5 PR 1, Task 1)', () => {
    it('emits ability-performed for BOTH directions (player→enemy AND enemy→player)', () => {
        idc = 0;
        // Huge HP both sides so nobody dies and every actor keeps firing all 3 rounds.
        const { events } = run(
            battle({
                playerHp: 1_000_000_000,
                enemyHp: 1_000_000_000,
                playerAttack: 5000,
                enemyAttack: 5000,
            })
        );
        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );

        // player→enemy: a player actor dealt damage to an enemy.
        const playerToEnemy = abilityPerformed.filter(
            (e) => PLAYER_IDS.has(e.actorId) && ENEMY_IDS.has(e.targetId)
        );
        // enemy→player: an enemy actor dealt damage to a player.
        const enemyToPlayer = abilityPerformed.filter(
            (e) => ENEMY_IDS.has(e.actorId) && PLAYER_IDS.has(e.targetId)
        );

        expect(playerToEnemy.length).toBeGreaterThan(0);
        expect(enemyToPlayer.length).toBeGreaterThan(0);

        // The DEALT-damage field is `damage` on ability-performed, and it is the real landed
        // amount (attack 5000 × 100% vs defence 0, no crit = 5000).
        expect(playerToEnemy.every((e) => e.damage === 5000)).toBe(true);
        expect(enemyToPlayer.every((e) => e.damage === 5000)).toBe(true);
    });

    it('RoundData.perTargetDamage records per-victim TAKEN damage for BOTH enemy and player victims', () => {
        idc = 0;
        // Huge HP so perTargetDamage records the actual landed damage (no death clamping).
        const { result } = run(
            battle({
                playerHp: 1_000_000_000,
                enemyHp: 1_000_000_000,
                playerAttack: 5000,
                enemyAttack: 5000,
            })
        );

        // Union every round's perTargetDamage victim ids.
        const victimIds = new Set<string>();
        for (const round of result.rounds) {
            if (round.perTargetDamage) {
                for (const id of Object.keys(round.perTargetDamage)) victimIds.add(id);
            }
        }

        // BOTH directions land per-victim damage: player attackers hit the enemy roster, and
        // enemy attackers hit the player roster — all flow through the shared emitHit.
        const enemyVictims = [...victimIds].filter((id) => ENEMY_IDS.has(id));
        const playerVictims = [...victimIds].filter((id) => PLAYER_IDS.has(id));
        expect(enemyVictims.length).toBeGreaterThan(0); // enemy victims (player→enemy)
        expect(playerVictims.length).toBeGreaterThan(0); // player victims (enemy→player)

        // Per-victim amounts are the real landed firing-hit damage (origin full = 5000).
        const round0 = result.rounds[0].perTargetDamage!;
        // Focus fires `front` → front enemy; team fires `back` → back enemy.
        expect(round0['enemy-front']).toBe(5000);
        expect(round0['enemy-back']).toBe(5000);
        // enemy-front fires `front` → front-most player (focus); enemy-back fires `back` → M3 player.
        expect(round0['attacker']).toBe(5000);
        expect(round0['player-team']).toBe(5000);
    });

    it('`attacked` events carry an attacker + anchor victim but NO damage amount', () => {
        idc = 0;
        const { events } = run(
            battle({
                playerHp: 1_000_000_000,
                enemyHp: 1_000_000_000,
                playerAttack: 5000,
                enemyAttack: 5000,
            })
        );
        const attacked = events.filter(
            (e): e is Extract<CombatEvent, { type: 'attacked' }> => e.type === 'attacked'
        );
        expect(attacked.length).toBeGreaterThan(0);
        // Anchor victims only: enemy attackers struck players (the anchor `tgt`).
        expect(attacked.every((e) => ENEMY_IDS.has(e.attackerId))).toBe(true);
        expect(attacked.every((e) => PLAYER_IDS.has(e.targetId))).toBe(true);
        // CONTRACT PIN: `attacked` carries NO numeric damage field — it is not a damage source.
        expect(attacked.every((e) => !('damage' in e))).toBe(true);
    });

    it('ship-destroyed fires for BOTH sides when HP is low enough', () => {
        idc = 0;
        // Low HP both sides: 5000 attack lands exactly 5000/turn, HP 5000 → first hit kills.
        const { events } = run(
            battle({
                playerHp: 5000,
                enemyHp: 5000,
                playerAttack: 5000,
                enemyAttack: 5000,
            })
        );
        const destroyed = new Set(
            events
                .filter(
                    (e): e is Extract<CombatEvent, { type: 'ship-destroyed' }> =>
                        e.type === 'ship-destroyed'
                )
                .map((e) => e.actorId)
        );
        const destroyedEnemies = [...destroyed].filter((id) => ENEMY_IDS.has(id));
        const destroyedPlayers = [...destroyed].filter((id) => PLAYER_IDS.has(id));
        // BOTH sides take lethal damage → ship-destroyed fires for each.
        expect(destroyedEnemies.length).toBeGreaterThan(0);
        expect(destroyedPlayers.length).toBeGreaterThan(0);
    });

    it('hp-changed fires for player victims (tank-side, known max HP)', () => {
        idc = 0;
        const { events } = run(
            battle({
                playerHp: 1_000_000_000,
                enemyHp: 1_000_000_000,
                playerAttack: 5000,
                enemyAttack: 5000,
            })
        );
        const hpChanged = events.filter(
            (e): e is Extract<CombatEvent, { type: 'hp-changed' }> => e.type === 'hp-changed'
        );
        // Player victims take HP damage → hp-changed crossings fire for them (the engine knows
        // their max HP). Pins the HP-crossing source for the player direction.
        expect(hpChanged.length).toBeGreaterThan(0);
        expect(hpChanged.some((e) => PLAYER_IDS.has(e.targetId))).toBe(true);
    });
});

// ===========================================================================
// Phase 5 PR 1, Task 3: end-to-end `simulateBattle` adapter (positioned squads →
// runCombat → symmetric BattleResult). Driven through `simulateBattle`, not raw runCombat.
// ===========================================================================

// Minimal Ship factory: only the fields simulateBattle reads — baseStats (stat
// derivation), affinity, charge threshold, the raw active targeting strings
// (parseShipTargeting → target+pattern), and a single-hit damage active skill so
// the ship fires real damage. statOverrides on the placement supply the combat
// stats actually used; baseStats only need to be present/valid.
const makeShip = (
    id: string,
    name: string,
    opts: { activeTarget: string; activePattern: string } = {
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }
): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'Attacker',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    // A single-hit 100% active damage skill (corpus phrasing with the <unit-damage> tag so
    // skillTextParser produces a real damage ability) — so the engine fires actual damage.
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: opts.activeTarget,
    activePattern: opts.activePattern,
});

const placement = (
    ship: Ship,
    position: Position,
    attack: number,
    hp: number
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp,
    },
});

describe('simulateBattle adapter (Phase 5 PR 1, Task 3)', () => {
    it('produces non-zero per-ship damage dealt/taken on BOTH sides', () => {
        const result = simulateBattle({
            playerTeam: [
                placement(
                    makeShip('p1', 'Player Front', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                    }),
                    'M4',
                    5000,
                    1_000_000_000
                ),
                placement(
                    makeShip('p2', 'Player Back', {
                        activeTarget: 'back',
                        activePattern: 'Pattern-Base',
                    }),
                    'M3',
                    5000,
                    1_000_000_000
                ),
            ],
            enemyTeam: [
                placement(
                    makeShip('e1', 'Enemy Front', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                    }),
                    'M4',
                    5000,
                    1_000_000_000
                ),
                placement(
                    makeShip('e2', 'Enemy Back', {
                        activeTarget: 'back',
                        activePattern: 'Pattern-Base',
                    }),
                    'M1',
                    5000,
                    1_000_000_000
                ),
            ],
            rounds: 3,
        });

        // Roster covers all four placed ships, both sides represented.
        expect(result.roster.filter((r) => r.side === 'player')).toHaveLength(2);
        expect(result.roster.filter((r) => r.side === 'enemy')).toHaveLength(2);

        // Aggregate dealt/taken per side across all rounds.
        const sumBySide = (sel: (s: { damageDealt: number; damageTaken: number }) => number) => {
            const out: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
            for (const round of result.rounds) {
                for (const s of round.ships) out[s.side] += sel(s);
            }
            return out;
        };
        const dealt = sumBySide((s) => s.damageDealt);
        const taken = sumBySide((s) => s.damageTaken);

        // BOTH sides deal AND take damage (symmetric mutual combat).
        expect(dealt.player).toBeGreaterThan(0);
        expect(dealt.enemy).toBeGreaterThan(0);
        expect(taken.player).toBeGreaterThan(0);
        expect(taken.enemy).toBeGreaterThan(0);
    });

    it('marks a low-HP ship dead and a one-sided matchup wipes the weaker team before round 30', () => {
        // Strong players (high attack, huge HP) vs fragile enemies (tiny HP, no offense
        // worth surviving). Enemies die fast; players never die → enemy team wiped early.
        const result = simulateBattle({
            playerTeam: [
                placement(
                    makeShip('p1', 'Player Front', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                    }),
                    'M4',
                    100_000,
                    1_000_000_000
                ),
                placement(
                    makeShip('p2', 'Player Back', {
                        activeTarget: 'back',
                        activePattern: 'Pattern-Base',
                    }),
                    'M3',
                    100_000,
                    1_000_000_000
                ),
            ],
            enemyTeam: [
                placement(
                    makeShip('e1', 'Enemy Front', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                    }),
                    'M4',
                    1,
                    5000
                ),
                placement(
                    makeShip('e2', 'Enemy Back', {
                        activeTarget: 'back',
                        activePattern: 'Pattern-Base',
                    }),
                    'M1',
                    1,
                    5000
                ),
            ],
        });

        // The default 30-round cap was NOT reached — the battle terminated early on a wipe.
        expect(result.outcome.lastRound).toBeLessThan(30);
        expect(result.outcome.winner).toBe('player');

        // At least one enemy ship ends not-alive in the final round.
        const finalRound = result.rounds[result.rounds.length - 1];
        const deadEnemies = finalRound.ships.filter((s) => s.side === 'enemy' && !s.alive);
        expect(deadEnemies.length).toBeGreaterThan(0);
    });
});
