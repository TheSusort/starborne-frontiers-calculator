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

        const r1 = result.rounds[0];

        // Only the modelled log kinds appear — `attacked` (no amount) is NOT logged.
        for (const e of r1.events) {
            expect(['turn', 'damage', 'heal', 'buff', 'debuff', 'dot', 'death']).toContain(e.kind);
        }

        // Damage is ATTACKER-centric (from ability-performed): the focus player fires `front`
        // and anchors the front enemy, so a damage line is keyed by the ATTACKER's actorId
        // with the firing amount and a targetId.
        const attackerDamage = r1.events.find(
            (e) => e.kind === 'damage' && e.actorId === 'attacker'
        );
        expect(attackerDamage).toBeDefined();
        expect(attackerDamage?.amount).toBe(5000);
        expect(attackerDamage?.targetId).toBeDefined();

        // The log is chronological: a turn delimiter for the attacker precedes its damage line.
        const attackerTurnIdx = r1.events.findIndex(
            (e) => e.kind === 'turn' && e.actorId === 'attacker'
        );
        const attackerDamageIdx = r1.events.findIndex(
            (e) => e.kind === 'damage' && e.actorId === 'attacker'
        );
        expect(attackerTurnIdx).toBeGreaterThanOrEqual(0);
        expect(attackerTurnIdx).toBeLessThan(attackerDamageIdx);

        // The wiped front enemy produces exactly one death line that round.
        const deaths = r1.events.filter((e) => e.kind === 'death');
        expect(deaths.map((e) => e.actorId)).toContain('e:e1:0');
        expect(deaths.filter((e) => e.actorId === 'e:e1:0')).toHaveLength(1);

        // No spurious death line for a ship that did NOT die this round (the back enemy / players).
        const deathIds = new Set(deaths.map((e) => e.actorId));
        expect(deathIds.has('e:e2:1')).toBe(false);
        expect(deathIds.has('attacker')).toBe(false);
        expect(deathIds.has('p:p2:1')).toBe(false);
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
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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
        enemySecurity: 100,
        healTargetId: 'attacker',
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

    it('a PARTIAL-security actual target lands at the per-target rate (0.5 → 3 of 6)', () => {
        idc = 0;
        // Front target security 150 vs focus hacking 200 → live chance clamp(200-150)/100 = 0.5 →
        // the deterministic RateGate lands on calls 2,4,6 → exactly 3 of 6 rounds. The decoy stays
        // at security 100, so only the actual target's 150 can produce this 0.5 rate.
        const landed = countAppliedOnTarget(focusInflictBattle(150), 'enemy-front');
        expect(landed).toBe(3);
    });
});
