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
import { describe, it, expect, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import { parsePattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import type { BattleResult } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { CombatLogEntry } from '../log/types';
import { flattenRound } from '../log/__testutils__/flattenCombatLog';

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
    hp: opts.playerHp,
    // Healing mode — required for the positioned enemy roster to be built.
    healTargetId: 'attacker',
    mode: 'healing',
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
        'turn-started',
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

    it('`attacked` events carry an attacker, anchor victim, AND the per-attack aggregate damage', () => {
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
        // SYMMETRIC EMIT (player→enemy attacked emit): `attacked` now fires for BOTH directions —
        // enemy attackers struck players (anchor `tgt`) AND player attackers struck enemies — so
        // enemy on-attacked reactives wake when the player hits them. Every event still pairs an
        // attacker with the single anchor victim it fired at on the OPPOSING side.
        const enemyToPlayer = attacked.filter(
            (e) => ENEMY_IDS.has(e.attackerId) && PLAYER_IDS.has(e.targetId)
        );
        const playerToEnemy = attacked.filter(
            (e) => PLAYER_IDS.has(e.attackerId) && ENEMY_IDS.has(e.targetId)
        );
        expect(enemyToPlayer.length).toBeGreaterThan(0); // enemy→player (pre-existing)
        expect(playerToEnemy.length).toBeGreaterThan(0); // player→enemy (the new symmetric emit)
        // Every attacked event is one of those two cross-team directions (no same-side / stray ids).
        expect(attacked.length).toBe(enemyToPlayer.length + playerToEnemy.length);
        // CONTRACT (D-PR16): `attacked` carries the per-ATTACK aggregate damage (5000 here — both
        // sides have attack 5000 vs the victim's defence 0) so Tenacity's >25%-max-HP filter can
        // read it. Added via conditional spread → present only when damage > 0 (healing-mode
        // 0-damage events stay byte-identical).
        expect(attacked.every((e) => e.damage === 5000)).toBe(true);
    });

    it('ship-destroyed fires for BOTH sides when HP is low enough', () => {
        idc = 0;
        // Both sides die — but the kills must happen on LIVE turns (the dead-actor guard means a
        // ship destroyed before its own turn never acts). Ordering: the focus/team players (speed
        // 100/150) act first and one-shot their 5000-HP enemy anchors in round 1 → both enemies
        // destroyed. To kill the players too, ONE enemy must act BEFORE it dies, so we give the
        // front enemy a high speed (200 > the players) so it takes its turn at the TOP of round 1
        // — before the players fire — landing a lethal 5000 on the 5000-HP front player. That
        // player is dead; the surviving team player still wipes the enemies. So both sides record
        // a ship-destroyed without any dead actor acting.
        const fastEnemyBattle: CombatEngineInput = {
            ...battle({ playerHp: 5000, enemyHp: 5000, playerAttack: 5000, enemyAttack: 5000 }),
            enemyAttackers: [
                {
                    ...offensiveEnemyAt('enemy-front', 'M4', 'front', 5000, 5000),
                    stats: {
                        attack: 5000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 5000,
                        speed: 200,
                    },
                } as EnemyAttacker,
                offensiveEnemyAt('enemy-back', 'M1', 'back', 5000, 5000),
            ],
        };
        const { events } = run(fastEnemyBattle);
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

    it('a destroyed enemy does NOT act after death (no turn-started/ability-performed/attacked, no damage dealt)', () => {
        idc = 0;
        // Killer-first ordering: player actors (speed 100 focus / 150 team) act BEFORE the
        // enemy attackers (speed 1 in offensiveEnemyAt), so the player AoE lands in round 1
        // before either enemy reaches its own (later) turn in that same round. enemyHp 5000 vs
        // playerAttack 5000 → each enemy is one-shot in round 1, BEFORE its scheduled turn.
        // The dead enemy must then be skipped entirely (the general dead-actor guard) for every
        // round at/after its death: no turn-started, no ability-performed, no attacked, and it
        // lands no per-victim damage on any player.
        const { events, result } = run(
            battle({
                playerHp: 1_000_000_000, // players are immortal so the battle runs all rounds
                enemyHp: 5000,
                playerAttack: 5000,
                enemyAttack: 5000,
            })
        );

        // The enemies die in round 1 (killed before their own turn).
        const destroyedByRound = new Map<string, number>();
        for (const e of events) {
            if (e.type === 'ship-destroyed' && ENEMY_IDS.has(e.actorId)) {
                if (!destroyedByRound.has(e.actorId)) destroyedByRound.set(e.actorId, e.round);
            }
        }
        // Both enemies were destroyed (the focus + team AoE wiped the roster in round 1).
        expect(destroyedByRound.get('enemy-front')).toBe(1);
        expect(destroyedByRound.get('enemy-back')).toBe(1);

        // From the death round onward, the dead enemy emits NO turn-started and NO
        // ability-performed (it never acts), and never appears as an `attacked` attacker.
        for (const [enemyId, deathRound] of destroyedByRound) {
            const actedAfterDeath = events.filter(
                (e) =>
                    e.round >= deathRound &&
                    (e.type === 'turn-started' || e.type === 'ability-performed') &&
                    e.actorId === enemyId
            );
            expect(actedAfterDeath).toEqual([]);

            const attackedAfterDeath = events.filter(
                (e) => e.type === 'attacked' && e.round >= deathRound && e.attackerId === enemyId
            );
            expect(attackedAfterDeath).toEqual([]);
        }

        // And the dead enemies deal NO per-victim damage to any player in any round (they were
        // dead before their first turn; players are immortal so any player damageTaken would
        // have to come from a dead enemy acting).
        for (const round of result.rounds) {
            if (!round.perTargetDamage) continue;
            for (const playerId of PLAYER_IDS) {
                expect(round.perTargetDamage[playerId] ?? 0).toBe(0);
            }
        }
    });

    it('a living actor scheduled AFTER a death still acts normally', () => {
        idc = 0;
        // enemy-front (anchored by the focus `front`) dies in round 1; enemy-back has huge HP and
        // survives. enemy-back is scheduled (speed 1, like enemy-front) AFTER the player killers,
        // so the dead-actor skip must NOT swallow it — it keeps acting every round.
        const input: CombatEngineInput = {
            ...battle({
                playerHp: 1_000_000_000,
                enemyHp: 5000,
                playerAttack: 5000,
                enemyAttack: 5000,
            }),
            enemyAttackers: [
                offensiveEnemyAt('enemy-front', 'M4', 'front', 5000, 5000), // dies round 1
                offensiveEnemyAt('enemy-back', 'M1', 'back', 5000, 1_000_000_000), // immortal
            ],
        };
        const { events } = run(input);

        // enemy-front dies round 1 → no acts after.
        const frontActsR1Plus = events.filter(
            (e) =>
                e.round >= 1 &&
                (e.type === 'turn-started' || e.type === 'ability-performed') &&
                e.actorId === 'enemy-front'
        );
        expect(frontActsR1Plus).toEqual([]);

        // enemy-back survives → it DOES act (turn-started + ability-performed) in every round.
        for (const round of [1, 2, 3]) {
            const backActed = events.some(
                (e) =>
                    e.round === round &&
                    e.type === 'ability-performed' &&
                    e.actorId === 'enemy-back'
            );
            expect(backActed).toBe(true);
        }
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
    opts: {
        activeTarget: string;
        activePattern: string;
        // Override the active skill text — defaults to a single-hit 100% damage skill. The
        // healer cases pass a bare-repair phrasing the parser flips to an ally heal.
        activeSkillText?: string;
        // Ship class — defaults to 'Attacker'. Only matters for skill-text parsing branches.
        type?: Ship['type'];
    } = {
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }
): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: opts.type ?? 'Attacker',
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
    activeSkillText:
        opts.activeSkillText ?? 'This Unit deals <unit-damage>100% damage</unit-damage>.',
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

describe('simulateBattle adapter — input validation (review fix)', () => {
    // Shared valid placements reused across the throwing cases.
    const validPlayer = placement(
        makeShip('p1', 'Player', { activeTarget: 'front', activePattern: 'Pattern-Base' }),
        'M4',
        5000,
        1_000_000_000
    );
    const validEnemy = placement(
        makeShip('e1', 'Enemy', { activeTarget: 'front', activePattern: 'Pattern-Base' }),
        'M4',
        5000,
        1_000_000_000
    );

    it('throws when enemyTeam is empty', () => {
        expect(() => simulateBattle({ playerTeam: [validPlayer], enemyTeam: [] })).toThrow(
            'simulateBattle: enemyTeam is empty'
        );
    });

    it('throws when playerTeam is empty', () => {
        expect(() => simulateBattle({ playerTeam: [], enemyTeam: [validEnemy] })).toThrow(
            'simulateBattle: playerTeam is empty'
        );
    });

    it('throws when rounds is 0 (not a positive integer)', () => {
        expect(() =>
            simulateBattle({ playerTeam: [validPlayer], enemyTeam: [validEnemy], rounds: 0 })
        ).toThrow('simulateBattle: rounds must be a positive integer');
    });

    it('throws when rounds is non-integer (2.5)', () => {
        expect(() =>
            simulateBattle({ playerTeam: [validPlayer], enemyTeam: [validEnemy], rounds: 2.5 })
        ).toThrow('simulateBattle: rounds must be a positive integer');
    });

    it('still runs a valid battle with default rounds (rounds undefined)', () => {
        const result = simulateBattle({ playerTeam: [validPlayer], enemyTeam: [validEnemy] });
        expect(result.outcome).toBeDefined();
        expect(result.rounds.length).toBeGreaterThan(0);
    });
});

// ===========================================================================
// Phase 5 PR 1, Task 4: HARDEN the two-team harness with edge cases the PR2 page +
// the deferred unify will rely on — win/loss/draw outcomes, death-round correctness,
// healing attribution, AoE per-victim accounting, and the per-round event log.
// Driven through `simulateBattle` (the Task 3 adapter), reusing the makeShip /
// placement helpers above. These EXERCISE the Task 2/3 code; they do not change it.
// ===========================================================================

// Targeting-string shorthands for the placements below (the engine's raw active
// columns parseShipTargeting reads). FRONT/BACK anchor enemy selections; ALLIES is an
// ally-side selection used by the support healer (its heal recipient is decided by the
// parsed heal ability's target, not by this column).
const FRONT = { activeTarget: 'front', activePattern: 'Pattern-Base' } as const;
const BACK = { activeTarget: 'back', activePattern: 'Pattern-Base' } as const;

describe('simulateBattle adapter — edge cases (Phase 5 PR 1, Task 4)', () => {
    it('outcome: a one-sided wipe in the ENEMY→PLAYER direction makes the enemy the winner', () => {
        // Mirror of the player-wins case above: fragile players (tiny HP) vs strong enemies
        // (huge attack + huge HP). Players die fast; enemies never die → enemy team wins.
        const result = simulateBattle({
            playerTeam: [
                placement(makeShip('p1', 'Player Front', FRONT), 'M4', 1, 5000),
                placement(makeShip('p2', 'Player Back', BACK), 'M3', 1, 5000),
            ],
            enemyTeam: [
                placement(makeShip('e1', 'Enemy Front', FRONT), 'M4', 100_000, 1_000_000_000),
                placement(makeShip('e2', 'Enemy Back', BACK), 'M1', 100_000, 1_000_000_000),
            ],
        });

        expect(result.outcome.winner).toBe('enemy');
        expect(result.outcome.lastRound).toBeLessThan(30);

        // At least one player ship ends not-alive in the final round.
        const finalRound = result.rounds[result.rounds.length - 1];
        const deadPlayers = finalRound.ships.filter((s) => s.side === 'player' && !s.alive);
        expect(deadPlayers.length).toBeGreaterThan(0);
    });

    it('outcome: two tanky low-damage squads that cannot kill each other within the cap → DRAW', () => {
        // Huge HP + 1 attack on every ship → no ship can be wiped in 3 rounds. The battle runs
        // to the cap with no side wiped → draw at the final round, all 3 rounds present.
        const result = simulateBattle({
            playerTeam: [
                placement(makeShip('p1', 'Player Front', FRONT), 'M4', 1, 1_000_000_000),
                placement(makeShip('p2', 'Player Back', BACK), 'M3', 1, 1_000_000_000),
            ],
            enemyTeam: [
                placement(makeShip('e1', 'Enemy Front', FRONT), 'M4', 1, 1_000_000_000),
                placement(makeShip('e2', 'Enemy Back', BACK), 'M1', 1, 1_000_000_000),
            ],
            rounds: 3,
        });

        expect(result.outcome.winner).toBe('draw');
        expect(result.outcome.lastRound).toBe(3);
        // The full (untrimmed) round window is present for a draw — no early termination.
        expect(result.rounds).toHaveLength(3);
        expect(result.rounds.map((r) => r.round)).toEqual([1, 2, 3]);
    });

    it('death-round: a victim is alive for rounds < N and not alive for rounds >= N', () => {
        // Strong players (1800 attack vs 5000-HP enemies) → an enemy dies once cumulative
        // damage crosses its HP. 1800/round: r1=1800, r2=3600 (alive), r3=5400 (>=5000 → dead).
        // So the front enemy is alive rounds 1-2 and not alive from round 3. Players are
        // immortal (huge HP) so the battle keeps running through the death round.
        const result = simulateBattle({
            playerTeam: [
                placement(makeShip('p1', 'Player Front', FRONT), 'M4', 1800, 1_000_000_000),
                placement(makeShip('p2', 'Player Back', BACK), 'M3', 1800, 1_000_000_000),
            ],
            enemyTeam: [
                placement(makeShip('e1', 'Enemy Front', FRONT), 'M4', 1, 5000),
                placement(makeShip('e2', 'Enemy Back', BACK), 'M1', 1, 1_000_000_000),
            ],
            rounds: 5,
        });

        // Track the front enemy (the focus fires `front` → anchors it) across rounds.
        const VICTIM = 'e:e1:0';
        const stateAt = (round: number) =>
            result.rounds.find((r) => r.round === round)?.ships.find((s) => s.actorId === VICTIM);

        // Sanity: it took the expected per-round damage before dying.
        expect(stateAt(1)?.damageTaken).toBe(1800);

        // Alive strictly before the death round, not-alive from it onward (trimmed result).
        expect(stateAt(1)?.alive).toBe(true);
        expect(stateAt(2)?.alive).toBe(true);
        expect(stateAt(3)?.alive).toBe(false);
        // The transition is monotonic: once dead, it never flips back to alive.
        for (const round of result.rounds) {
            const s = round.ships.find((x) => x.actorId === VICTIM);
            if (round.round >= 3) expect(s?.alive).toBe(false);
        }
    });

    it('healing: a healer credits healingDone and the damaged ally it heals gets healingReceived', () => {
        // player[0] = focus 'attacker' (the heal target / damaged ally), taking enemy fire.
        // player[1] = a support healer with a bare active repair the parser flips to an ally
        // heal — its recipient routes to the focus (the engine's heal target). The enemy keeps
        // the focus damaged so the heal lands on a hurt ally.
        const result = simulateBattle({
            playerTeam: [
                placement(makeShip('p1', 'Focus', FRONT), 'M4', 5000, 1_000_000),
                placement(
                    makeShip('p2', 'Healer', {
                        activeTarget: 'allies',
                        activePattern: 'Pattern-Base',
                        activeSkillText: 'This Unit repairs 30% of its Max HP.',
                        type: 'Support',
                    }),
                    'M3',
                    0,
                    1_000_000
                ),
            ],
            enemyTeam: [placement(makeShip('e1', 'Enemy', FRONT), 'M4', 5000, 1_000_000_000)],
            rounds: 3,
        });

        const HEALER = 'p:p2:1';
        const FOCUS = 'attacker';
        const healerStates = result.rounds.flatMap((r) =>
            r.ships.filter((s) => s.actorId === HEALER)
        );
        const focusStates = result.rounds.flatMap((r) =>
            r.ships.filter((s) => s.actorId === FOCUS)
        );

        // The healer repairs an ally → its healingDone is positive in at least one round.
        expect(healerStates.some((s) => s.healingDone > 0)).toBe(true);
        // The damaged focus is the recipient → its healingReceived is positive.
        expect(focusStates.some((s) => s.healingReceived > 0)).toBe(true);
        // And the focus actually took damage that round (the heal lands on a hurt ally).
        expect(focusStates.some((s) => s.damageTaken > 0)).toBe(true);
    });

    it('support-pattern healer AoE-heals EVERY ally in its footprint, on the player side too', () => {
        // Regression for the reported bug (bravo-vs-bravo: only the ENEMY Hermes healed) AND the
        // correct model: a bare-repair support healer (Hermes: allies + Pattern-Circle-Support-
        // Range-1) heals EVERYONE in its pattern footprint, like an all-allies buff — not a single
        // ally, and not only the vestigial focus. Here the healer at M4 (Circle-Support-Range-1
        // footprint = M4 + neighbours M3, T3, B3, B4…) covers two wounded neighbours; both are
        // repaired. Pre-fix the player heal routed to the out-of-footprint focus → healed nobody.
        const result = simulateBattle({
            playerTeam: [
                // Focus player[0] far back at B1 — NOT the intended recipient. Huge HP.
                placement(makeShip('p1', 'Focus', BACK), 'B1', 5000, 1_000_000_000),
                // Support healer at M4 (bare repair → AoE over its Circle-Support footprint).
                placement(
                    makeShip('p2', 'Healer', {
                        activeTarget: 'allies',
                        activePattern: 'Pattern-Circle-Support-Range-1',
                        activeSkillText: 'This Unit repairs 30% of its Max HP.',
                        type: 'Support',
                    }),
                    'M4',
                    0,
                    1_000_000
                ),
                // Two neighbours in the M4 circle footprint, both soaking enemy fire.
                placement(makeShip('p3', 'AllyA', FRONT), 'M3', 0, 300_000),
                placement(makeShip('p4', 'AllyB', FRONT), 'T3', 0, 300_000),
            ],
            enemyTeam: [
                placement(makeShip('e1', 'EnemyA', FRONT), 'M4', 20000, 1_000_000_000),
                placement(makeShip('e2', 'EnemyB', BACK), 'M1', 20000, 1_000_000_000),
            ],
            rounds: 5,
        });

        const HEALER = 'p:p2:1';
        const healerStates = result.rounds.flatMap((r) =>
            r.ships.filter((s) => s.actorId === HEALER)
        );
        // The player-side healer heals (pre-fix it routed to the out-of-footprint focus → 0).
        expect(healerStates.some((s) => s.healingDone > 0)).toBe(true);

        // AoE: MORE THAN ONE distinct ally receives healing across the fight (not single-target).
        const healedAllies = new Set<string>();
        for (const r of result.rounds) {
            for (const s of r.ships) {
                if (s.side === 'player' && s.healingReceived > 0) healedAllies.add(s.actorId);
            }
        }
        expect(healedAllies.size).toBeGreaterThan(1);
    });

    it('support-pattern healer AoE-heals when it is the FOCUS actor (player[0]), not just team actors', () => {
        // Browser-found follow-up: the AoE heal worked for team/enemy actors but the FOCUS actor
        // (player[0], the reserved `attacker` id) still healed only itself. A support healer placed
        // first on the team must AoE its footprint exactly like any other actor. Healer at M4;
        // allies at M3 and T3 sit in its Circle-Support-Range-1 footprint.
        const result = simulateBattle({
            playerTeam: [
                placement(
                    makeShip('p1', 'FocusHealer', {
                        activeTarget: 'allies',
                        activePattern: 'Pattern-Circle-Support-Range-1',
                        activeSkillText: 'This Unit repairs 30% of its Max HP.',
                        type: 'Support',
                    }),
                    'M4',
                    0,
                    1_000_000
                ),
                placement(makeShip('p2', 'AllyA', FRONT), 'M3', 0, 300_000),
                placement(makeShip('p3', 'AllyB', FRONT), 'T3', 0, 300_000),
            ],
            enemyTeam: [
                placement(makeShip('e1', 'EnemyA', FRONT), 'M4', 20000, 1_000_000_000),
                placement(makeShip('e2', 'EnemyB', BACK), 'M1', 20000, 1_000_000_000),
            ],
            rounds: 5,
        });

        // AoE from the FOCUS healer: more than one distinct player ally receives healing.
        const healedAllies = new Set<string>();
        for (const r of result.rounds) {
            for (const s of r.ships) {
                if (s.side === 'player' && s.healingReceived > 0) healedAllies.add(s.actorId);
            }
        }
        expect(healedAllies.size).toBeGreaterThan(1);
    });

    it('Abundant Renewal: an over-repaired ally gets a shield from the healer overhealing it', () => {
        // Hermes-style AoE support healer with the Abundant Renewal implant (legendary: shield =
        // 30% of the over-repaired amount on an ally). A full-HP ally in the footprint is
        // over-repaired every cast, so the implant must grant IT a shield. Pre-fix: player heals
        // only applied/over-healed the vestigial focus, and the overheal shield routed to the
        // focus — the ally got nothing.
        const healerShip: Ship = {
            ...makeShip('p1', 'Healer', {
                activeTarget: 'allies',
                activePattern: 'Pattern-Circle-Support-Range-1',
                activeSkillText: 'This Unit repairs 30% of its Max HP.',
                type: 'Support',
            }),
            implants: { ultimate: 'ar-leg' },
        };
        const getGearPiece = (id: string): GearPiece | undefined =>
            id === 'ar-leg'
                ? ({
                      id: 'ar-leg',
                      slot: 'ultimate',
                      setBonus: 'ABUNDANT_RENEWAL',
                      rarity: 'legendary',
                      stars: 6,
                      level: 16,
                      stats: [],
                  } as unknown as GearPiece)
                : undefined;

        const result = simulateBattle(
            {
                playerTeam: [
                    placement(healerShip, 'M4', 0, 1_000_000),
                    // Full-HP ally in the M4 healer's footprint (M3) — never attacked, so every
                    // AoE repair on it is pure overheal.
                    placement(makeShip('p2', 'Ally', BACK), 'M3', 0, 300_000),
                ],
                enemyTeam: [placement(makeShip('e1', 'Enemy', FRONT), 'M4', 5000, 1_000_000_000)],
                rounds: 3,
            },
            getGearPiece
        );

        const ALLY = 'p:p2:1';
        const allyStates = result.rounds.flatMap((r) => r.ships.filter((s) => s.actorId === ALLY));
        expect(allyStates.some((s) => s.shieldGranted > 0)).toBe(true);
    });

    it('AoE accounting: a 2-cell pattern hits the origin for FULL and the covered cell for HALF', () => {
        // One enemy at M1 fires Pattern-Line-Range-1 anchored on the front-most player (M4) →
        // covers M3 as the second cell. Origin (front player) takes full damage; the covered
        // player takes half. Players carry no offense so only the enemy AoE lands this round.
        const result = simulateBattle({
            playerTeam: [
                placement(makeShip('p1', 'Front', FRONT), 'M4', 0, 1_000_000_000),
                placement(makeShip('p2', 'Mid', BACK), 'M3', 0, 1_000_000_000),
            ],
            enemyTeam: [
                placement(
                    makeShip('e1', 'AoE Enemy', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Line-Range-1',
                    }),
                    'M1',
                    5000,
                    1_000_000_000
                ),
            ],
            rounds: 1,
        });

        const r1 = result.rounds[0];
        const origin = r1.ships.find((s) => s.actorId === 'attacker')!; // front-most player
        const covered = r1.ships.find((s) => s.actorId === 'p:p2:1')!; // M3, the 2nd AoE cell

        // Both AoE cells were struck (the footprint genuinely covers 2 occupied cells).
        expect(origin.damageTaken).toBeGreaterThan(0);
        expect(covered.damageTaken).toBeGreaterThan(0);
        // Origin full (5000) / covered half (2500) → origin === 2 × covered.
        expect(origin.damageTaken).toBe(5000);
        expect(covered.damageTaken).toBe(2500);
        expect(origin.damageTaken).toBe(covered.damageTaken * 2);
    });

    it('event log: a round carries the expected damage/death lines and no spurious entries', () => {
        // Strong players one-shot a fragile front enemy. Round 1: damage lines for the firing
        // attackers and a death line for the wiped enemy; no `attacked`-derived or other noise.
        const result = simulateBattle({
            playerTeam: [
                placement(makeShip('p1', 'Player Front', FRONT), 'M4', 5000, 1_000_000_000),
                placement(makeShip('p2', 'Player Back', BACK), 'M3', 5000, 1_000_000_000),
            ],
            enemyTeam: [
                placement(makeShip('e1', 'Enemy Front', FRONT), 'M4', 1, 5000),
                placement(makeShip('e2', 'Enemy Back', BACK), 'M1', 1, 1_000_000_000),
            ],
            rounds: 3,
        });

        const r1 = result.combatLog.find((r) => r.round === 1)!;
        expect(r1).toBeDefined();

        // Flatten round-1 entries (turns + nested reactions + endOfRound) preserving order.
        const r1Entries: CombatLogEntry[] = flattenRound(r1);

        // Only modelled entry kinds appear (the hierarchical CombatLogEntryKind set).
        const validKinds: CombatLogEntry['kind'][] = [
            'attack',
            'heal',
            'shield',
            'buff',
            'debuff',
            'dot-applied',
            'dot-ticked',
            'control',
            'cleanse',
            'purge',
            'charge-changed',
            'death',
            'detonation',
            'bomb',
        ];
        for (const e of r1Entries) {
            expect(validKinds).toContain(e.kind);
        }

        // Damage is ATTACKER-centric: the focus player fires `front` and anchors the front
        // enemy, so its turn carries an `attack` entry whose primary target took the firing
        // amount (5000) with a resolved targetId.
        const attackerTurn = r1.turns.find((t) => t.actorId === 'attacker');
        expect(attackerTurn).toBeDefined();
        const attackEntry = attackerTurn!.entries.find(
            (e) => e.kind === 'attack' && e.actorId === 'attacker'
        );
        expect(attackEntry).toBeDefined();
        expect(attackEntry!.targets.length).toBeGreaterThan(0);
        const primaryTarget = attackEntry!.targets[0];
        expect(primaryTarget.amount).toBe(5000);
        expect(primaryTarget.targetId).toBeDefined();

        // Hierarchy is the chronology guarantee: the attack entry lives INSIDE the attacker's
        // turn (the turn opens before any of its entries by construction).
        expect(attackerTurn!.entries).toContain(attackEntry);

        // The wiped front enemy produces exactly one death entry that round.
        const deaths = r1Entries.filter((e) => e.kind === 'death');
        expect(deaths.map((e) => e.actorId)).toContain('e:e1:0');
        expect(deaths.filter((e) => e.actorId === 'e:e1:0')).toHaveLength(1);

        // No spurious death entry for a ship that did NOT die this round (back enemy / players).
        const deathIds = new Set(deaths.map((e) => e.actorId));
        expect(deathIds.has('e:e2:1')).toBe(false);
        expect(deathIds.has('attacker')).toBe(false);
        expect(deathIds.has('p:p2:1')).toBe(false);
    });
});

// ===========================================================================
// SP-F PR1, Task 3 (F1): per-attacker×victim dealt attribution reconciles
// `damageDealt` with `damageTaken`. See docs/superpowers/notes/2026-07-13-
// f1-attribution-audit.md for the full design. Fixture is deliberately
// Protection-free (the audit flags a pre-existing double-count under
// Protection redirect that would confuse this invariant).
// ===========================================================================
describe('F1: per-attacker×victim dealt attribution reconciles damageDealt with damageTaken', () => {
    const AOE_ENEMY_ID = 'e:e1:0';
    const P1_ID = 'attacker'; // playerTeam[0] is always the reserved focus id
    const P2_ID = 'p:p2:1';
    const P3_ID = 'p:p3:2';

    // A pure self/ally heal skill — NO damage ability at all, so these ships never
    // contribute a dealt entry (keeps the fixture's only attacker unambiguous).
    const healOnly = (position: Position) => ({
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
        activeSkillText: 'This Unit repairs 30% of its Max HP.',
        position,
    });

    // One enemy AoE attacker (targeting `front`, Pattern-Line-Range-2 → hits 3 occupied
    // M-lane cells: origin M4 FULL + 2 covered cells HALF each) vs 3 pure-healer players
    // occupying the exact 3-cell footprint (M4/M3/M2). Players deal zero damage, so the
    // AoE enemy is the ONLY ship in this fixture that ever dealt damage.
    const runAoEFixture = (): BattleResult =>
        simulateBattle({
            playerTeam: [
                placement(makeShip('p1', 'P1', healOnly('M4')), 'M4', 0, 1_000_000_000),
                placement(makeShip('p2', 'P2', healOnly('M3')), 'M3', 0, 1_000_000_000),
                placement(makeShip('p3', 'P3', healOnly('M2')), 'M2', 0, 1_000_000_000),
            ],
            enemyTeam: [
                placement(
                    makeShip('e1', 'AoE Enemy', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Line-Range-2',
                    }),
                    'M1',
                    5000,
                    1_000_000_000
                ),
            ],
            rounds: 2,
        });

    // Ground truth computed WITHOUT touching `damageDealt`: in this fixture the AoE enemy
    // is the sole attacker and its footprint hits EXACTLY {P1_ID, P2_ID, P3_ID} with no
    // cross-fire, so summing those three victims' (unchanged) `damageTaken` for a round
    // equals the total the enemy actually dealt that round.
    const sumDealtTo = (result: BattleResult, round: number, attackerId: string): number => {
        if (attackerId !== AOE_ENEMY_ID) return 0;
        const r = result.rounds.find((rr) => rr.round === round);
        if (!r) return 0;
        return [P1_ID, P2_ID, P3_ID].reduce(
            (sum, vid) => sum + (r.ships.find((s) => s.actorId === vid)?.damageTaken ?? 0),
            0
        );
    };

    it("F1: a targeted attacker's damageDealt equals the sum of per-victim damage it caused (AoE)", () => {
        const result = runAoEFixture();
        for (const round of result.rounds) {
            for (const attacker of round.ships) {
                if (attacker.damageDealt === 0) continue; // skips non-attacking + case-c-only actors
                const causedByThisAttacker = sumDealtTo(result, round.round, attacker.actorId);
                expect(attacker.damageDealt).toBe(causedByThisAttacker);
            }
        }
        // Non-vacuous: the AoE enemy genuinely dealt damage in round 1 (else the loop above
        // would trivially pass by never entering the assertion).
        const r1Enemy = result.rounds[0].ships.find((s) => s.actorId === AOE_ENEMY_ID);
        expect(r1Enemy?.damageDealt).toBeGreaterThan(0);
    });
});

// ===========================================================================
// Holistic review #2: PER-TARGET debuff landing in a team-vs-team battle.
// The live recompute resolves landing against effectiveStatsOf(THE TURN'S ACTUAL
// TARGET).security — NOT a representative (first-opposing) security as the old
// battle-sim threading did. With HETEROGENEOUS opposing security this is observable:
// the focus's inflict-debuff lands against the security of the enemy it actually
// FIRES AT, not against some other enemy's security. Non-vacuous: a NON-ZERO baseline
// (low-security target → lands every round) THEN the per-target difference (a high-
// security target on the SAME roster → resists), with the OTHER enemy's security held
// constant so only the actual target's security can be driving the outcome.
// ===========================================================================

// A focus skill that BOTH deals damage AND inflicts a finite-duration 'inflict' debuff on
// its enemy target — the debuff's landing draws the live hacking-vs-security gate.
const inflictDebuffSkill = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Defense Down',
                parsedEffects: { defense: -10 },
                stacks: 1,
                isStackable: false,
                application: 'inflict',
                duration: 2,
            },
        }),
    ],
});

// A positioned enemy with an explicit SECURITY stat (and no offense kit — bare basic attack).
const enemyWithSecurityAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    security: number
): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            security,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

describe('Two-team battle — per-target debuff landing resolves against the ACTUAL target (holistic review #2)', () => {
    afterEach(() => resetRateGateRng());
    // Focus 'attacker' at M4 hacking 200, neutral affinity, fires `front` and inflicts a debuff.
    // Two enemies on the roster with DIFFERING security: the FRONT-most one is the focus's actual
    // target; the other (held at security 100 throughout) is a decoy that the OLD representative-
    // security threading would have measured against had it been enemyTeam[0].
    const focusInflictBattle = (frontTargetSecurity: number): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [inflictDebuffSkill()] },
        numRounds: 6,
        selfBuffs: [],
        enemyDebuffs: [],
        // Static fallback scalar 1.0 — DEMOTED by the live recompute when both bases are present.
        // If the live path ever failed to engage, every round would land (1.0); the assertions
        // below (resist at high target security) would then fail — so this also guards engagement.
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        hacking: 200, // focus base hacking → live recompute has a real attacker input
        // The dummy/non-positional sink security (irrelevant here: the focus always anchors a
        // POSITIONED enemy, so effectiveStatsOf(defender).security comes from that enemy actor).
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        // Two enemies: the FRONT-most (focus's actual target) carries the parameterized security;
        // the decoy stays at security 100. enemy-front anchors `front`; enemy-back sits at M1.
        enemyAttackers: [
            enemyWithSecurityAt('enemy-front', 'M4', 'front', frontTargetSecurity),
            enemyWithSecurityAt('enemy-back', 'M1', 'back', 100),
        ],
    });

    const countAppliedOnTarget = (input: CombatEngineInput, targetId: string): number => {
        // Own bus subscription — the shared `run()` helper does NOT tap `debuff-applied`.
        const bus = createEventBus();
        const applied: Extract<CombatEvent, { type: 'debuff-applied' }>[] = [];
        bus.on('debuff-applied', (e) => applied.push(e));
        runCombat({ ...input, bus });
        return applied.filter((e) => e.targetId === targetId).length;
    };

    it('baseline: a LOW-security actual target lands the inflict debuff every round (non-vacuous)', () => {
        idc = 0;
        // Front target security 100 vs focus hacking 200 → live chance clamp(200-100)/100 = 1.0 →
        // lands all 6 rounds. The decoy enemy-back is also security 100 but is never targeted.
        const landed = countAppliedOnTarget(focusInflictBattle(100), 'enemy-front');
        expect(landed).toBe(6);
    });

    it('the SAME roster with a HIGH-security actual target resists — landing follows the TARGET, not a representative', () => {
        idc = 0;
        // Front target security 300 vs focus hacking 200 → live chance clamp(200-300)/100 = 0 →
        // NEVER lands, EVEN THOUGH the decoy enemy-back is still security 100 (which under the OLD
        // representative-security threading could have governed). Proves landing resolves against
        // the ACTUAL target's security.
        const landed = countAppliedOnTarget(focusInflictBattle(300), 'enemy-front');
        expect(landed).toBe(0);
    });

    it('a PARTIAL-security actual target lands at the per-target rate (0.5 → 2 of 6)', () => {
        idc = 0;
        // Front target security 150 vs focus hacking 200 → live chance clamp(200-150)/100 = 0.5.
        // The landing gate now draws from the module RNG (lands iff draw < rate). NOTE: this
        // `setRateGateRng(...)` override is dead for the focus's landing gate under SP-0 — it
        // now carries an `${actorId}:landing` stream key, and the keyed test provider
        // (installed globally in setupTests.ts) takes precedence over a bare `setRateGateRng`
        // override whenever a key is supplied. Left in place as historical intent documentation
        // (originally scripted a back-loaded rate-0.5 accumulator landing on rounds 2,4,6 → 3 of
        // 6); the actual landing count now comes from the keyed per-actor landing sub-stream
        // under the fixed test seed, which instead lands 2 of 6 (a real Bernoulli(0.5) outcome).
        let drawIdx = 0;
        let acc = 0;
        const EPS = 1e-9;
        setRateGateRng(() => {
            drawIdx += 1;
            const isLandingGate = (drawIdx - 1) % 4 === 0; // draws 1,5,9,…
            if (!isLandingGate) return 0.99; // crit:0 gates never fire regardless
            acc += 0.5;
            if (acc >= 1 - EPS) {
                acc -= 1;
                return 0; // land
            }
            return 0.99; // no land
        });
        const landed = countAppliedOnTarget(focusInflictBattle(150), 'enemy-front');
        expect(landed).toBe(2);
    });
});

describe('E1 — symmetric incoming surface: player→enemy hits record per-victim intake', () => {
    it('an enemy struck by a player attack gets a perActorIncoming bucket with incoming > 0 (non-vacuous)', () => {
        idc = 0;
        // Players immortal so the battle runs; enemies tanky enough to survive and keep being hit.
        const { result } = run(
            battle({
                playerHp: 1_000_000_000,
                enemyHp: 1_000_000_000,
                playerAttack: 5000,
                enemyAttack: 5000,
            })
        );

        const rounds = result.healing!.rounds;

        // At least one enemy victim has an intake bucket with positive incoming.
        const enemyBucketRounds = rounds.filter((rd) =>
            [...ENEMY_IDS].some((id) => (rd.perActorIncoming.get(id)?.incoming ?? 0) > 0)
        );
        expect(enemyBucketRounds.length).toBeGreaterThan(0);

        // The player side is still tracked too (symmetry — enemy→player intake unaffected).
        const playerBucketRounds = rounds.filter((rd) =>
            [...PLAYER_IDS].some((id) => rd.perActorIncoming.has(id))
        );
        expect(playerBucketRounds.length).toBeGreaterThan(0);
    });
});

// ===========================================================================
// H1 Task 8 follow-up: end-to-end `simulateBattle` shield-field extraction loop.
//
// The existing Task 8 tests (battleAssemble.test.ts) cover `assembleBattleResult`
// with INJECTED `perRoundPerShield` data — they do NOT exercise the extraction loop
// in battleSimulator.ts (lines 760-768) that reads `rd.perActorShield ?? {}` from
// live engine rounds and passes it to the assembler. This suite drives the REAL
// `simulateBattle` (placement-based entry point) with a ship that grants itself a
// shield and then takes a hit, proving the engine → sim extraction → assembler path
// end-to-end.
//
// Setup:
//   player[0] (focus 'attacker') — self-shield active skill, speed 200, large HP pool.
//     Speed 200 > enemy speed 1 so the focus acts FIRST each round: it casts a shield,
//     and then the enemy fires into the already-shielded target. The shield covers 25%
//     of the focus's 40 000 HP = 10 000 HP of absorption. The enemy hits for a deterministic
//     5 000 (attack 5 000 vs defence 0, crit 0, neutral affinity) which is less than the
//     shield pool → the hit is FULLY absorbed and shieldsAbsorbed is exactly 5 000.
//   enemy[0] (e1) — basic-damage active, speed 1, immortal HP.
//
// Assertions on result.rounds[r].ships for the shielded ship:
//   shieldGranted  > 0  (the grant fires and the extraction loop picked it up)
//   currentShieldPool > 0  (the pool persists after absorbing partial damage)
//   shieldsAbsorbed == ENEMY_ATTACK  (SP-F F3: exact drain, not just > 0 — the channel is the
//     verbatim shieldAbsorb.ts `absorbed`, wired since H1 #156) with incomingDamage == 0.
// ===========================================================================

describe('H1 Task 8 follow-up — simulateBattle end-to-end shield extraction loop', () => {
    it('shieldGranted / currentShieldPool / shieldsAbsorbed are all > 0 on the focus ship when it self-shields before taking a hit', () => {
        // The focus ship grants itself a shield equal to 25% of its Max HP each round.
        // Speed 200 ensures it acts BEFORE the enemy (speed 1) so the shield is in place
        // when the incoming hit arrives in the same round.
        const SHIELD_HP = 40_000;
        const ENEMY_ATTACK = 5_000; // < 25% of 40k (= 10k) so pool survives after the hit

        const shieldedFocus = makeShip('shielded', 'ShieldFocus', {
            activeTarget: 'front',
            activePattern: 'Pattern-Base',
            // Skill-text-parser converts this to: type:'shield', pct:25, basis:'hp', target:'self'.
            activeSkillText: 'This Unit gains a Shield equal to 25% of its Max HP.',
            type: 'Attacker',
        });

        const result = simulateBattle({
            playerTeam: [
                {
                    ship: shieldedFocus,
                    position: 'M4',
                    statOverrides: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: SHIELD_HP,
                        speed: 200, // acts before the enemy every round
                    },
                },
            ],
            enemyTeam: [
                placement(
                    makeShip('e1', 'Attacker', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                    }),
                    'M4',
                    ENEMY_ATTACK,
                    1_000_000_000 // immortal — keeps firing all rounds
                ),
            ],
            rounds: 3,
        });

        // The focus player's actorId is the reserved 'attacker' (player[0] maps to FOCUS_ID).
        const FOCUS_ACTOR_ID = 'attacker';

        // --- shieldGranted > 0 in at least one round (grant fires + extraction loop read it) ---
        const grantedRounds = result.rounds.filter(
            (r) => (r.ships.find((s) => s.actorId === FOCUS_ACTOR_ID)?.shieldGranted ?? 0) > 0
        );
        expect(grantedRounds.length).toBeGreaterThan(0);

        // --- currentShieldPool > 0 in at least one round (pool persists after partial absorption) ---
        const poolRounds = result.rounds.filter(
            (r) => (r.ships.find((s) => s.actorId === FOCUS_ACTOR_ID)?.currentShieldPool ?? 0) > 0
        );
        expect(poolRounds.length).toBeGreaterThan(0);

        // --- shieldsAbsorbed matches the EXACT drain (SP-F F3 hardening) ---
        // The channel has been wired end-to-end since Shield System H1 (#156): the value
        // surfaced on ShipRoundState.shieldsAbsorbed is shieldAbsorb.ts's `absorbed` threaded
        // verbatim through the sink — so F3 has no residual gap to close, only a stronger
        // assertion to add. Both ships are neutral-affinity antimatter (affinityDamageModifier
        // 0) and the enemy's crit is pinned to 0 (the `placement` helper), so the enemy's hit
        // is a deterministic 5 000 (attack 5 000 vs the focus's 0 defence, no crit/affinity
        // multiplier). The shield pool (>= 10 000 every round) fully covers it, so every round
        // the enemy connects the drain is EXACTLY the enemy's attack, with 0 HP damage leaking
        // through.
        const absorbedRounds = result.rounds.filter(
            (r) => (r.ships.find((s) => s.actorId === FOCUS_ACTOR_ID)?.shieldsAbsorbed ?? 0) > 0
        );
        expect(absorbedRounds.length).toBeGreaterThan(0);
        for (const r of absorbedRounds) {
            const focus = r.ships.find((s) => s.actorId === FOCUS_ACTOR_ID)!;
            // Exact drain: the whole 5 000 hit was absorbed by the shield...
            expect(focus.shieldsAbsorbed).toBe(ENEMY_ATTACK);
            // ...and nothing leaked to HP (fully absorbed).
            expect(focus.incomingDamage).toBe(0);
        }
    });
});

// ===========================================================================
// Bug repro: a dead fallback-victim binding permanently skipped an ally-targeted enemy
// caster's turn once the FOCUS player (playerTeam[0], engine id 'attacker') died.
//
// Diagnosed chain (HISTORY — SP-4e removed its first link): an ally-targeted caster's
// parsed target has side:'ally' → resolvePositionalTarget returns null by design →
// selectTurnTarget fell back to the enemy side's fallback victim, which simulateBattle
// set to the FOCUS player id (a vestigial binding). Once the focus died, the enemy
// walk's `targetDead = tgt.currentHp <= 0` short-circuited the WHOLE turn to
// cadence-only (no skill fired) — even though this caster (a pure supporter,
// Graphite-style) never needed an opposing victim in the first place. Positional
// attackers were unaffected because they re-resolve a LIVING player every turn.
//
// SP-4e deleted the fallback outright, so an ally-targeted enemy caster resolves NO
// victim whether the focus is alive or dead, and the dead-target skip can only fire on
// a genuinely resolved corpse. The three cases below still pin the OUTCOME (the
// supporter keeps acting; a damage caster that needs a victim does not), which is what
// this describe block is for; the fourth case, added by SP-4e, pins the live-anchor
// half the original diagnosis never reached.
// ===========================================================================

describe('bug repro: enemy supporter turn skipped after the focus player dies', () => {
    it('a Graphite-style ally-targeted supporter keeps granting its buff + shield in rounds AFTER the focus dies', () => {
        const GRAPHITE_ACTIVE_TEXT =
            'This unit grants <unit-skill>Overclock III</unit-skill> for 2 turns and a ' +
            '<unit-damage>shield equal to 120%</unit-damage> of its attack.';

        const result = simulateBattle({
            playerTeam: [
                // Focus (playerTeam[0] → engine id 'attacker'): fragile, dies to the Killer
                // in round 2 (60 000 HP, 30 000 dmg/hit → dead after 2 hits).
                {
                    ship: makeShip('focus', 'Focus', FRONT),
                    position: 'M4',
                    statOverrides: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 60_000,
                        speed: 120,
                    },
                },
                // Survivor: immortal, never dies, keeps the battle running the full 4 rounds
                // and gives the Killer a living positional target after the focus dies.
                {
                    ship: makeShip('survivor', 'Survivor', BACK),
                    position: 'M3',
                    statOverrides: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 110,
                    },
                },
            ],
            enemyTeam: [
                // Killer: positional attacker (front-target) — kills the focus round 2, then
                // re-resolves onto the living Survivor. Unaffected by the bug (control case).
                {
                    ship: makeShip('killer', 'Killer', FRONT),
                    position: 'M4',
                    statOverrides: {
                        attack: 30_000,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 130,
                    },
                },
                // Supporter (Graphite-style): ally-targeted (side:'ally' parsed target) → its
                // positional selection ALWAYS returns null → falls back to the legacy victim
                // (the focus). Once the focus is dead this is the actor that stops acting.
                {
                    ship: makeShip('supporter', 'Supporter', {
                        activeTarget: 'allies',
                        activePattern: 'Pattern-Support-Double-Pickaxe-Range-0',
                        activeSkillText: GRAPHITE_ACTIVE_TEXT,
                        type: 'Supporter',
                    }),
                    position: 'M2',
                    statOverrides: {
                        attack: 5_000,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 90,
                    },
                },
            ],
            rounds: 4,
        });

        const FOCUS = 'attacker';
        const SUPPORTER = 'e:supporter:1';

        const aliveAt = (round: number) =>
            result.rounds.find((r) => r.round === round)?.ships.find((s) => s.actorId === FOCUS)
                ?.alive;

        // Sanity check on the repro's premise: the focus is alive round 1, dead from round 2.
        expect(aliveAt(1)).toBe(true);
        expect(aliveAt(2)).toBe(false);

        const supporterEntriesAt = (round: number) => {
            const combatRound = result.combatLog.find((r) => r.round === round);
            const turn = combatRound?.turns.find((t) => t.actorId === SUPPORTER);
            return turn?.entries ?? [];
        };

        // Round 1 (focus alive): the supporter's turn grants Overclock III + a shield —
        // establishes the skill actually parses/fires as expected while the legacy binding
        // is still alive.
        const round1Entries = supporterEntriesAt(1);
        expect(round1Entries.some((e) => e.kind === 'buff' && e.note === 'Overclock III')).toBe(
            true
        );
        expect(round1Entries.some((e) => e.kind === 'shield')).toBe(true);

        // Round 4 (focus long dead): the supporter must STILL grant the identical effects —
        // an ally-targeted support cast never needed the dead focus as a victim. This is the
        // assertion that fails on the buggy engine (the dead-legacy-victim short-circuit empties
        // the supporter's turn for every round after the focus dies).
        const round4Entries = supporterEntriesAt(4);
        expect(round4Entries.some((e) => e.kind === 'buff' && e.note === 'Overclock III')).toBe(
            true
        );
        expect(round4Entries.some((e) => e.kind === 'shield')).toBe(true);
    });

    it('negative/pin: an enemy ATTACKER (damage skill) that resolves nobody delivers NOTHING', () => {
        // Mirror of the repro above, but the second enemy fires a plain `damage` ability
        // (target 'enemy' — set by the skill-text parser regardless of the raw targeting
        // column) while its RAW activeTarget/activePattern columns are ally-shaped, so
        // resolvePositionalTarget returns null (side:'ally' → null by design) exactly like
        // the supporter. UNLIKE the supporter, this skill's firing ability DOES need an
        // opposing victim (type 'damage', target 'enemy') — so the deferred
        // death-fallback-retargeting work item is explicitly OUT of scope and this actor must
        // deliver nothing.
        //
        // ⚠️ SP-4e CHANGED THE MECHANISM UNDER THIS CASE, and the title changed with it. It used
        // to read "…bound to the dead legacy victim still skips its turn", and the mechanism was
        // the enemy site's DEAD-TARGET SKIP: the fabricated focus-player anchor was dead, and
        // `skillNeedsOpposingVictim` sent the whole turn to cadence-only. With the fallback
        // deleted this actor resolves NO victim in EVERY round (alive focus or dead), so it now
        // takes the no-victim turn instead — which delivers 0 because `runPlayerTurn` fences its
        // damage assembly on `hasVictim`. The OUTCOME asserted below is unchanged, which is the
        // point; the route to it is not. See the engine's own note at `skipDeadTargetTurn` for
        // the measurement that the old route is now unreachable suite-wide.
        const result = simulateBattle({
            playerTeam: [
                {
                    ship: makeShip('focus', 'Focus', FRONT),
                    position: 'M4',
                    statOverrides: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 60_000,
                        speed: 120,
                    },
                },
                {
                    ship: makeShip('survivor', 'Survivor', BACK),
                    position: 'M3',
                    statOverrides: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 110,
                    },
                },
            ],
            enemyTeam: [
                {
                    ship: makeShip('killer', 'Killer', FRONT),
                    position: 'M4',
                    statOverrides: {
                        attack: 30_000,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 130,
                    },
                },
                // A second attacker: ally-shaped raw targeting (activeTarget:'allies') so its
                // ParsedTarget carries side:'ally' → resolvePositionalTarget always returns
                // null (same mechanism as the supporter's fallback) — but its firing ability
                // is a plain `damage` ability (parsed target 'enemy', independent of the raw
                // targeting column) → the dead-target skip MUST still apply.
                {
                    ship: makeShip('deadbound', 'DeadBound', {
                        activeTarget: 'allies',
                        activePattern: 'Pattern-Support-Double-Pickaxe-Range-0',
                        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
                    }),
                    position: 'M2',
                    statOverrides: {
                        attack: 9_000,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 80,
                    },
                },
            ],
            rounds: 4,
        });

        const FOCUS = 'attacker';
        const DEADBOUND = 'e:deadbound:1';

        const aliveAt = (round: number) =>
            result.rounds.find((r) => r.round === round)?.ships.find((s) => s.actorId === FOCUS)
                ?.alive;
        expect(aliveAt(1)).toBe(true);
        expect(aliveAt(2)).toBe(false);

        // Round 1 (focus alive): the non-positional attacker's ability DOES fire — its
        // computed damage is credited via `ability-performed` regardless of the victim it
        // resolves to. It resolves NO victim at all: the ally-shaped raw targeting sends
        // `resolvePositionalTarget` to null regardless of whether focus is alive, so this is a
        // no-victim turn (SP-4c-2b/4d) even though nobody died here — no `attacked` event
        // follows, and the combat log's now-empty attack entry is correctly pruned as a phantom
        // row (Task 4) — the SAME no-victim shape round 4 lands in below, for a different reason
        // (there, focus really is dead).
        // SP-F F1 note: pre-F1, `damageDealt` (then `ability-performed.damage` summed by
        // actorId) was the one signal that still told the two cases apart, because it didn't
        // require a real per-victim landing. Post-F1, `damageDealt` is re-derived from
        // `perTargetDealt` (an attacker×victim channel), so a hit that never lands on a real
        // roster victim — exactly this no-victim case — no longer surfaces via `damageDealt`
        // either. This is the SAME class of adjacent, out-of-scope gap the F1 audit calls
        // "case-c" (real damage computed but unattributable to any victim); F1 does not fix it,
        // so BOTH rounds now read 0 here. `turnOrder` doesn't distinguish them either (the
        // actor's turn opens in both rounds) — there is currently no BattleResult-level signal
        // for "fired but hit nobody"; the round-4 assertions below (the test's actual subject)
        // still verify the no-victim outcome itself.
        const round1 = result.rounds.find((r) => r.round === 1);
        const round1Ship = round1?.ships.find((s) => s.actorId === DEADBOUND);
        expect(round1Ship?.damageDealt).toBe(0);

        // Round 4 (focus long dead, no positional re-target available): the attacker's turn
        // resolves no victim — the SAME no-victim-turn mechanism as round 1 above, NOT the old
        // dead-target-skip short-circuit (deleted this branch; see the sibling test's header a
        // few dozen lines up). `hasVictim` is false whether focus is alive or dead here, so
        // `runPlayerTurn` fences every skill-fired-derived entry the same way regardless: no
        // skill-fired-derived entries at all.
        const round4 = result.combatLog.find((r) => r.round === 4);
        const round4Turn = round4?.turns.find((t) => t.actorId === DEADBOUND);
        expect(round4Turn).toBeDefined();
        expect(round4Turn!.entries.length).toBe(0);

        const round4Ship = result.rounds
            .find((r) => r.round === 4)
            ?.ships.find((s) => s.actorId === DEADBOUND);
        expect(round4Ship?.damageDealt).toBe(0);
    });

    it('threshold flip: an ally-only ACTIVE runs but the enemy-facing CHARGED skill resolves no victim, per-round, at the charge threshold', () => {
        // Exercises the action-selection mirror inside the dead-target check: the predicate
        // must inspect the skill that WOULD fire this turn, not a fixed slot. The supporter's
        // active is ally-only (must keep running) while its charged skill is a plain damage nuke
        // (must deliver nothing when it would fire). chargeCount=2 → R1 active(bank→1),
        // R2 active(bank→2, focus now dead), R3 charged-would-fire → NO BUFF AND NO DAMAGE,
        // R4 active again (the cadence consumed the bank at cap and reset it).
        //
        // SP-4e: as with the sibling case above, the ROUTE changed and the outcome did not.
        // Pre-rung, R3 took the dead-target skip (the charged nuke needs a victim and the
        // fabricated anchor was a corpse) and the cadence advanced manually. Now the actor
        // resolves NO victim, `runPlayerTurn` runs and advances the same cadence internally,
        // and the nuke's damage is fenced to 0 — so R3 still grants nothing and lands nothing,
        // and R4 is still back on the active. What this case pins is therefore the CHARGE
        // THRESHOLD's effect on action selection, which is unchanged; it no longer covers the
        // dead-target skip, and nothing does.
        const GRAPHITE_ACTIVE_TEXT =
            'This unit grants <unit-skill>Overclock III</unit-skill> for 2 turns and a ' +
            '<unit-damage>shield equal to 120%</unit-damage> of its attack.';
        const result = simulateBattle({
            playerTeam: [
                {
                    ship: makeShip('focus', 'Focus', FRONT),
                    position: 'M4',
                    statOverrides: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 60_000,
                        speed: 120,
                    },
                },
                {
                    ship: makeShip('survivor', 'Survivor', BACK),
                    position: 'M3',
                    statOverrides: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 110,
                    },
                },
            ],
            enemyTeam: [
                {
                    ship: makeShip('killer', 'Killer', FRONT),
                    position: 'M4',
                    statOverrides: {
                        attack: 30_000,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 130,
                    },
                },
                {
                    ship: {
                        ...makeShip('flipper', 'Flipper', {
                            activeTarget: 'allies',
                            activePattern: 'Pattern-Support-Double-Pickaxe-Range-0',
                            activeSkillText: GRAPHITE_ACTIVE_TEXT,
                            type: 'Supporter',
                        }),
                        chargeSkillText: 'This Unit deals <unit-damage>150% damage</unit-damage>.',
                        chargeSkillCharge: 2,
                    },
                    position: 'M2',
                    statOverrides: {
                        attack: 5_000,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 90,
                    },
                },
            ],
            rounds: 4,
        });

        const FLIPPER = 'e:flipper:1';
        const aliveAt = (round: number) =>
            result.rounds
                .find((r) => r.round === round)
                ?.ships.find((s) => s.actorId === 'attacker')?.alive;
        expect(aliveAt(2)).toBe(false); // premise: focus dead from round 2

        const entriesAt = (round: number) =>
            result.combatLog
                .find((r) => r.round === round)
                ?.turns.find((t) => t.actorId === FLIPPER)?.entries ?? [];
        const grantsBuff = (round: number) =>
            entriesAt(round).some((e) => e.kind === 'buff' && e.note === 'Overclock III');
        const dealsDamage = (round: number) =>
            entriesAt(round).some(
                (e) => e.kind === 'attack' && e.targets.some((t) => (t.amount ?? 0) > 0)
            );

        // R2: focus is dead but the would-fire skill is the ally-only ACTIVE → runs.
        expect(grantsBuff(2)).toBe(true);
        // R3: bank hit the threshold → would-fire is the enemy-facing CHARGED skill → it
        // resolves NO victim (the no-victim-turn rule — see this test's header: the dead-target
        // skip this used to be is deleted, and nothing here covers it any more): no buff, and
        // no damage lands on anyone.
        expect(grantsBuff(3)).toBe(false);
        expect(dealsDamage(3)).toBe(false);
        // R4: the dead-path cadence reset the bank to 0 → back to the ally-only ACTIVE → runs.
        expect(grantsBuff(4)).toBe(true);
    });

    // =======================================================================
    // SP-4e Task 5 (#335, spec §5 class C2) — the LIVE-ANCHOR half.
    //
    // The three cases above all pin the DEAD-anchor behaviour. This one pins the class with
    // real consequences, and the one #335's own narrative missed: 324 measured rows where the
    // player roster is ALIVE and PLACED, the heal anchor is alive, and the enemy caster's
    // parsed target is ally-side — so `resolvePositionalTarget` returns null by design and
    // `selectTurnTarget` used to hand back `legacyVictim: healTarget`, i.e. the FOCUS PLAYER.
    // Those turns DID run; they ran against a FABRICATED victim, and any enemy-facing clause
    // on the cast landed on a player the cast never targeted.
    //
    // After 4e the enemy side answers exactly as the player side has since 4c-2b: no living
    // positional victim ⇒ a NO-VICTIM turn. The support still lands (the turn runs), nothing
    // names a victim, and the focus is untouched.
    // =======================================================================
    it('an ally-targeted enemy supporter, with a LIVING placed player roster, resolves NO victim and still lands its support', () => {
        // Mixed cast: an enemy-facing DoT clause AND an ally-facing buff clause. The DoT is
        // what makes the fabricated victim OBSERVABLE, on both axes at once — it names its
        // victim in the log (`dot-applied`) and it drains that victim's HP on later rounds
        // (`dot-ticked`). A pure supporter leaves no such trace: its cast computes no damage
        // and inflicts nothing, so the fabricated binding is invisible from outside the engine.
        // The RAW targeting column ('allies') is what drives the ParsedTarget's `side: 'ally'`
        // and therefore the always-null positional selection; the DoT's own ability target is
        // enemy-facing regardless of that column (same mechanism as the 'negative/pin' case).
        const DOT_PLUS_SUPPORT_TEXT =
            'This unit applies <unit-skill>Corrosion III</unit-skill> for 3 turns and grants ' +
            '<unit-skill>Overclock III</unit-skill> for 2 turns to allies.';

        const result = simulateBattle({
            playerTeam: [
                // Focus (playerTeam[0] → engine id 'attacker'): the vestigial heal anchor, and
                // therefore the fabricated victim. Immortal-HP so a hit LANDS rather than
                // killing it (a death would confound the assertion with the dead-anchor path).
                {
                    ship: makeShip('focus', 'Focus', FRONT),
                    position: 'M4',
                    statOverrides: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 120,
                    },
                },
                // A second LIVING, PLACED player — the roster is alive and targetable, which is
                // what separates this class from the dead-anchor cases above.
                {
                    ship: makeShip('survivor', 'Survivor', BACK),
                    position: 'M3',
                    statOverrides: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 110,
                    },
                },
            ],
            enemyTeam: [
                // The supporter under test: ally-shaped raw targeting → ParsedTarget side
                // 'ally' → positional selection always null.
                {
                    ship: makeShip('supporter', 'Supporter', {
                        activeTarget: 'allies',
                        activePattern: 'Pattern-Support-Double-Pickaxe-Range-0',
                        activeSkillText: DOT_PLUS_SUPPORT_TEXT,
                        type: 'Supporter',
                    }),
                    position: 'M2',
                    statOverrides: {
                        attack: 5_000,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 90,
                    },
                },
                // A harmless enemy-side ally so the support clauses have a second recipient.
                // attack 0 → it can never be the source of player-side damage, which keeps the
                // focus-untouched assertion attributable to the supporter alone.
                {
                    ship: makeShip('buddy', 'Buddy', FRONT),
                    position: 'M1',
                    statOverrides: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 80,
                    },
                },
            ],
            rounds: 3,
        });

        const FOCUS = 'attacker';
        const SUPPORTER = 'e:supporter:0';
        const PLAYER_SIDE_IDS = new Set([FOCUS, 'p:survivor:1']);

        const supporterEntries = result.combatLog.flatMap(
            (r) => r.turns.find((t) => t.actorId === SUPPORTER)?.entries ?? []
        );

        // Premise: the focus is alive for the whole fixture, so this is the live-anchor class
        // and not a relabelled dead-anchor case.
        for (const round of result.rounds) {
            expect(round.ships.find((s) => s.actorId === FOCUS)?.alive).toBe(true);
        }

        // (1) THE TURN RAN: the support still lands on the supporter's own side — both the
        // caster and its M1 buddy sit in the support footprint.
        const buffed = supporterEntries
            .filter((e) => e.kind === 'buff' && e.note === 'Overclock III')
            .flatMap((e) => e.targets.map((t) => t.targetId));
        expect(new Set(buffed)).toEqual(new Set([SUPPORTER, 'e:buddy:1']));

        // (2) NO VICTIM IS NAMED. There is nobody to key a per-victim store by, so contract §B
        // requires the absence of a targetId — consumers must read "there is no enemy", never
        // "an enemy with neutral stats". Nothing this turn emits may name a PLAYER as a target;
        // today the DoT clause lands `dot-applied` on the focus every round.
        const playerTargets = supporterEntries.flatMap((e) =>
            e.targets
                .filter((t) => PLAYER_SIDE_IDS.has(t.targetId))
                .map((t) => `${e.kind}→${t.targetId}`)
        );
        expect(playerTargets).toEqual([]);

        // (3) THE FOCUS IS UNTOUCHED. Today the fabricated binding lands a real Corrosion
        // stack on it every round, and those stacks tick its HP down from round 2 onward.
        for (const round of result.rounds) {
            const focus = round.ships.find((s) => s.actorId === FOCUS)!;
            expect(focus.incomingDamage).toBe(0);
            expect(focus.hpPct).toBe(100);
        }
    });
});

// ===========================================================================
// SP-F PR2 (F5): charged-skill TARGETING fidelity. Two independent axes:
//   (A) footprint — the positional damage apply must resolve its footprint from
//       the CHARGED pattern on a charge-firing turn, not the ACTIVE one.
//   (B) selection — there is no `chargedTarget` axis at all today; a charged
//       skill that targets a DIFFERENT selection than its active must still
//       resolve against the charged selection on a charge-firing turn.
// Snakeroot-style divergence (real ship, for flavor only — this fixture is
// synthetic): active "deals 170% damage and inflicts 2 stacks of Corrosion I"
// on Pattern-Base (single-target); charged "deals 210% damage ... Corrosion
// II" on Pattern-Line-Range-1 (wider, hits an extra covered cell).
// chargeCount=1 → round 1 fires ACTIVE (banks 0→1), round 2 fires CHARGED
// (1>=1, consumes/resets to 0) — see playerTurn.ts:~1044's action predicate.
// ===========================================================================
describe('SP-F F5: charged-skill footprint + target-selection fidelity', () => {
    const chargedAttack = (): ShipSkills['slots'][number] => ({
        slot: 'charged',
        abilities: [
            ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ],
    });

    const baseChargeInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 1,
        shipSkills: { slots: [basicAttack(), chargedAttack()] },
        numRounds: 2,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: true,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        // Healing mode — required for the positioned enemy roster to be built (mirrors `battle()`).
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M1',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [
            offensiveEnemyAt('enemy-front', 'M4', 'front', 0, 1_000_000_000),
            offensiveEnemyAt('enemy-back', 'M3', 'back', 0, 1_000_000_000),
        ],
        ...overrides,
    });

    it('(A) a charge-firing turn resolves its DAMAGE FOOTPRINT from the charged pattern, not the active one', () => {
        idc = 0;
        const input = baseChargeInput({
            // CHARGED footprint diverges from active (single-target → wider line); same target.
            chargedPattern: parsePattern('Pattern-Line-Range-1'),
        });

        const { result } = run(input);
        const round1 = result.rounds[0].perTargetDamage ?? {};
        const round2 = result.rounds[1].perTargetDamage ?? {};

        // Round 1 (ACTIVE, Pattern-Base): origin only — the covered cell (enemy-back) untouched.
        expect(round1['enemy-front']).toBe(5000);
        expect(round1['enemy-back']).toBeUndefined();

        // Round 2 (CHARGED, Pattern-Line-Range-1): origin FULL + covered HALF. Pre-fix, the
        // engine keeps resolving the footprint from the ACTIVE pattern even on this charge
        // turn, so enemy-back would stay untouched (same as round 1) — this is the RED case.
        expect(round2['enemy-front']).toBe(5000);
        expect(round2['enemy-back']).toBe(2500);
    });

    it('(B) a charge-firing turn resolves its TARGET SELECTION from the charged axis, not the active one', () => {
        idc = 0;
        const input = baseChargeInput({
            // CHARGED selection diverges from active (front → back); same single-target footprint.
            chargedTarget: parsedTarget('back'),
            chargedPattern: basePattern(),
        });

        const { result } = run(input);
        const round1 = result.rounds[0].perTargetDamage ?? {};
        const round2 = result.rounds[1].perTargetDamage ?? {};

        // Round 1 (ACTIVE): targets FRONT.
        expect(round1['enemy-front']).toBe(5000);
        expect(round1['enemy-back']).toBeUndefined();

        // Round 2 (CHARGED): targets BACK — the charged selection axis. Pre-fix, there is no
        // `chargedTarget` axis at all, so the engine keeps resolving via the ACTIVE target
        // (front) even on this charge turn — this is the RED case.
        expect(round2['enemy-back']).toBe(5000);
        expect(round2['enemy-front']).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Team-symmetry coverage: the charge-aware footprint fix is mirrored at ALL
    // THREE damage cast sites. Fixtures (A)/(B) above exercise the FOCUS cast
    // site (engine.ts ~6588). (C) and (D) below cover the ENEMY-attacker cast
    // site (~7183) and the walked-TEAM-actor cast site (~6854) respectively —
    // both hit the SAME class of bug if their mirror is broken. Each is
    // non-vacuous: the round-2 (charged) footprint reaches a SECOND victim that
    // the ACTIVE single-target pattern never would, so a site that kept using
    // the active pattern would leave the covered victim undamaged and fail.
    // -----------------------------------------------------------------------

    it('(C) an ENEMY charge-firing turn resolves its damage FOOTPRINT from the charged pattern (enemy cast site ~7183)', () => {
        idc = 0;
        // A positioned enemy attacker with a charge skill whose CHARGED footprint diverges from
        // its ACTIVE one (single-target → wider line). chargeCount=1 → round 1 fires ACTIVE
        // (banks 0→1), round 2 fires CHARGED (1>=1). buildEnemyPlayerActorRuntime derives
        // hasChargedSkill=true (chargeCount>=1 AND the charged slot carries a >0-multiplier
        // damage ability). Anchored on the front-most player (M4=focus); the charged line covers
        // the walked team player at M3.
        const chargedEnemy = {
            id: 'enemy-charged',
            stats: {
                attack: 5000,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 1,
            },
            chargeCount: 1,
            startCharged: false,
            position: 'M1',
            target: parsedTarget('front'),
            pattern: basePattern(),
            chargedPattern: parsePattern('Pattern-Line-Range-1'),
            shipSkills: { slots: [basicAttack(), chargedAttack()] },
        } as EnemyAttacker;

        // Two player-side actors in a line so the charged footprint can reach the second one:
        // focus at M4 + one walked team actor at M3. Both deal 0 damage so the ONLY per-victim
        // damage in this fixture flows enemy→player (clean assertions on the player victims).
        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [basicAttack()] },
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
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('player-team', 'M3', 'front', 0, 1_000_000_000)],
            enemyAttackers: [chargedEnemy],
        };

        const { result } = run(input);
        const round1 = result.rounds[0].perTargetDamage ?? {};
        const round2 = result.rounds[1].perTargetDamage ?? {};

        // Round 1 (ACTIVE, Pattern-Base): the enemy hits only the front-most player (focus, M4).
        expect(round1['attacker']).toBe(5000);
        expect(round1['player-team']).toBeUndefined();

        // Round 2 (CHARGED, Pattern-Line-Range-1): origin M4 FULL (5000) + covered M3 HALF (2500).
        // A broken enemy-site mirror (still resolving the ACTIVE footprint on the charge turn)
        // would leave player-team untouched here — this is the non-vacuous guard.
        expect(round2['attacker']).toBe(5000);
        expect(round2['player-team']).toBe(2500);
    });

    it('(D) a walked TEAM actor charge-firing turn resolves its damage FOOTPRINT from the charged pattern (team cast site ~6854)', () => {
        idc = 0;
        // A walked team actor (NOT the focus) with a charge skill whose CHARGED footprint diverges
        // from its ACTIVE one. chargeCount=1 → round 1 ACTIVE (banks 0→1), round 2 CHARGED. It
        // fires `front` at the enemy roster; the charged line anchored on the front-most enemy
        // (M4) covers the enemy at M3.
        const chargedTeam = {
            id: 'team-charged',
            speed: 150,
            chargeCount: 1,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position: 'M3',
            target: parsedTarget('front'),
            pattern: basePattern(),
            chargedPattern: parsePattern('Pattern-Line-Range-1'),
            walk: {
                shipSkills: { slots: [basicAttack(), chargedAttack()] },
                stats: {
                    attack: 5000,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: true,
            },
        } as TeamActor;

        // Focus deals 0 damage (it also fires `front` → adds 0 to the front enemy, inert). Two
        // enemies in a line so the team actor's charged footprint reaches the second one; both
        // enemies deal 0 so the only real per-victim damage flows team→enemy.
        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [basicAttack()] },
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
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [chargedTeam],
            enemyAttackers: [
                offensiveEnemyAt('enemy-front', 'M4', 'front', 0, 1_000_000_000),
                offensiveEnemyAt('enemy-back', 'M3', 'back', 0, 1_000_000_000),
            ],
        };

        const { result } = run(input);
        const round1 = result.rounds[0].perTargetDamage ?? {};
        const round2 = result.rounds[1].perTargetDamage ?? {};

        // Round 1 (ACTIVE, Pattern-Base): the team actor hits only the front-most enemy (M4).
        expect(round1['enemy-front']).toBe(5000);
        expect(round1['enemy-back']).toBeUndefined();

        // Round 2 (CHARGED, Pattern-Line-Range-1): origin M4 FULL (5000) + covered M3 HALF (2500).
        // A broken team-site mirror (still resolving the ACTIVE footprint on the charge turn)
        // would leave enemy-back untouched here — this is the non-vacuous guard.
        expect(round2['enemy-front']).toBe(5000);
        expect(round2['enemy-back']).toBe(2500);
    });
});
