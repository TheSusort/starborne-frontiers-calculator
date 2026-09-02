/**
 * Overload lifecycle — END-TO-END engine fixtures.
 *
 * Proves the full Marauder Overload lifecycle resolves in the combat sim, on BOTH sides:
 *   - Overload "gains every turn" accrues in the accumulating self store (per-round +1 stack).
 *   - Overload is LOST when the carrier kills an enemy (lose-on-kill), then RESUMES accruing.
 *   - Marauder Rage is granted on kill (Mangler II→I per tier, Ravager III).
 *   - Butcher gains Marauder Rage on inflicting a debuff (on-debuff-inflicted, no kill).
 *   - Ruiner gains Overload when an enemy performs a repair (on-enemy-repaired).
 *   - Asphyxiator gains Overload + Marauder Rage II at round start when an enemy carries
 *     >= 3 debuffs (start-of-round conditional).
 *   - TEAM SYMMETRY: an ENEMY-side Marauder that kills a PLAYER ship behaves identically.
 *
 * OBSERVATION CHANNELS (two, by necessity):
 *
 *  (A) runCombat (DPS/healing mode) — `result.rounds[].activeSelfBuffs` is the COMPREHENSIVE
 *      per-round self-buff snapshot for the focus actor (recurring/accumulating buffs included,
 *      with live `stacks`). This is the only channel that surfaces the silently-accumulating
 *      Overload store and a finite Marauder Rage grant together. Used for the accrual,
 *      debuff-inflict, repair, and start-of-round tests. LIMITATION: DPS mode has no destructible
 *      enemy actor — the dummy HP wall never emits `ship-destroyed`, so `on-enemy-destroyed`
 *      (kill) reactives never fire here. Kill behaviour is therefore proven via channel (B).
 *
 *  (B) simulateBattle (positional two-team battle) — a REAL destructible enemy emits
 *      `ship-destroyed`, firing the kill reactives. Marauder Rage grants surface as `buff`
 *      events (buff-applied) in the per-round battle log / `activeBuffs` snapshot. The
 *      accumulating Overload itself does NOT emit a buff event (accumulating statuses fold
 *      silently), so Overload's lose-on-kill is observed via its DAMAGE FOOTPRINT: Overload
 *      grants +10% outgoing damage per stack, so a Butcher's per-round outgoing damage CLIMBS
 *      while accruing and DROPS the round its kill strips Overload — vs a no-kill control whose
 *      damage climbs monotonically. (Butcher R1 grants NO Marauder Rage on kill, so the damage
 *      drop is a clean Overload-only signal with no attack-buff confound.)
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ship } from '../../../types/ship';
import type { ShipSkills } from '../../../types/abilities';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { Position } from '../../../types/encounters';
import { flattenRound } from '../log/__testutils__/flattenCombatLog';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

// ── Real-skill-text ship builder ────────────────────────────────────────────
// Skill text is the source of truth (docs/ship-skills.csv). buildShipAbilities resolves the
// refit-active passive via getShipSkillRows; `refits` length picks which passive is active
// (>= 2 → second passive). A bare baseStats is fine — combat stats come from statOverrides
// (simulateBattle) or the CombatEngineInput scalars (runCombat).
const ship = (id: string, over: Partial<Ship>): Ship => ({
    id,
    name: id,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'Attacker',
    baseStats: {} as Ship['baseStats'],
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activePattern: 'Pattern-Base',
    activeTarget: 'front',
    chargeSkillCharge: 0,
    ...over,
});

const skillsFor = (s: Ship): ShipSkills => buildShipAbilities(s);

// ── Channel (A): runCombat DPS-mode base ────────────────────────────────────
const dpsBase = (
    shipSkills: ShipSkills,
    over: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills,
    numRounds: 4,
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
    ...over,
});

// A scheduled enemy debuff (seeds the enemy's debuff count for the start-of-round >= 3 gate).
const enemyDebuff = (name: string): SelectedGameBuff =>
    ({
        id: `dbg-${name}`,
        buffName: name,
        stacks: 1,
        isStackable: false,
        parsedEffects: {},
        skillDuration: 99,
        effectTarget: 'enemy',
    }) as unknown as SelectedGameBuff;

// Self-buff names present this round for the focus actor (with stacks where accumulating).
const selfBuffNames = (r: ReturnType<typeof runCombat>): string[][] =>
    r.rounds.map((rd) => rd.activeSelfBuffs.map((b) => b.buffName));
const overloadStacks = (r: ReturnType<typeof runCombat>): (number | undefined)[] =>
    r.rounds.map((rd) => rd.activeSelfBuffs.find((b) => b.buffName === 'Overload')?.stacks);

// ── Channel (B): simulateBattle helpers ─────────────────────────────────────
const place = (s: Ship, position: Position, attack: number, hp: number): BattlePlacement => ({
    ship: s,
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

// Flatten a combatLog round's entries (turns + nested reactions + endOfRound) in order.

// Actor ids that received a buff-applied for `label` (the hierarchical combatLog).
const buffActorRounds = (
    r: ReturnType<typeof simulateBattle>,
    label: string
): { rounds: number[]; actors: Set<string> } => {
    const rounds: number[] = [];
    const actors = new Set<string>();
    for (const rd of r.combatLog) {
        let hit = false;
        for (const ev of flattenRound(rd)) {
            if (ev.kind === 'buff' && ev.note === label) {
                actors.add(ev.actorId);
                hit = true;
            }
        }
        if (hit) rounds.push(rd.round);
    }
    return { rounds, actors };
};
const focusDamageByRound = (r: ReturnType<typeof simulateBattle>): number[] =>
    r.rounds.map((rd) =>
        Math.round(rd.ships.find((s) => s.actorId === 'attacker')?.damageDealt ?? 0)
    );
// Per-round outgoing damage for an arbitrary actor (used for the enemy-side footprint proxy).
const damageByRoundFor = (r: ReturnType<typeof simulateBattle>, actorId: string): number[] =>
    r.rounds.map((rd) => Math.round(rd.ships.find((s) => s.actorId === actorId)?.damageDealt ?? 0));
const deathRounds = (r: ReturnType<typeof simulateBattle>): number[] =>
    r.combatLog
        .filter((rd) => flattenRound(rd).some((e) => e.kind === 'death'))
        .map((rd) => rd.round);

// A trivial chip enemy / defender wall (real, destructible ships).
const dummy = (id: string, type: Ship['type'] = 'Attacker'): Ship =>
    ship(id, { activeSkillText: 'This Unit deals <unit-damage>1% damage</unit-damage>.', type });

// ── Skill-text definitions (docs/ship-skills.csv, tagged) ───────────────────
// NOTE: the constants below (MANGLER_*, RAVAGER_*, BUTCHER_*, RUINER_*, ASPHYXIATOR_*) are frozen
// VERBATIM snapshots of the corresponding rows in docs/ship-skills.csv (the skill-text source of
// truth). If that CSV changes for any of these ships, re-sync these strings to match.
const MANGLER_P1 =
    'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and loses <unit-skill>Overload</unit-skill> on kill. Additionally, it gains <unit-skill>Marauder Rage I</unit-skill> for 2 turns upon killing an opponent.';
const RAVAGER_P1 =
    'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon killing an enemy, loses <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage III</unit-skill> for 3 turns.';
const BUTCHER_P1 =
    'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and loses <unit-skill>Overload</unit-skill> upon killing an enemy.';
const BUTCHER_P2 =
    'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn. On kill, <unit-skill>Overload</unit-skill> is lost. On inflicting a debuff, this Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns.';
const RUINER_P1 =
    'This Unit inflicts <unit-skill>Bomb II</unit-skill> for 2 turns on any enemy performing a <unit-aid>repair</unit-aid>, once per round per enemy. This Unit gains 1 stack of <unit-skill>Overload</unit-skill> when an enemy performs a <unit-aid>repair</unit-aid>, upon killing an enemy, this Unit removes <unit-skill>Overload</unit-skill>.';
const ASPHYXIATOR_P1 =
    'At the start of the round, if there are any enemies with 3 or more debuffs, this Unit gains 1 stack of <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns. Upon killing an enemy, this Unit loses <unit-skill>Overload</unit-skill>.';

describe('Overload lifecycle — engine fixtures', () => {
    // ── 1. Overload accrual + reset on kill (lose-on-kill) ───────────────────
    describe('1. Overload accrues every turn and is LOST on kill', () => {
        it('accrues +1 stack per round into the accumulating self store (no kill)', () => {
            // Channel (A): the comprehensive activeSelfBuffs snapshot surfaces the accumulating
            // Overload store. Against an indestructible dummy (no kill), Overload climbs 1→2→3→4.
            const mangler = ship('Mangler', {
                activeSkillText: 'This Unit deals <unit-damage>120% damage</unit-damage>.',
                firstPassiveSkillText: MANGLER_P1,
            });
            const r = runCombat(dpsBase(skillsFor(mangler)));
            expect(overloadStacks(r)).toEqual([1, 2, 3, 4]);
        });

        it('the round its kill resolves, Overload is GONE — then resumes accruing (damage footprint)', () => {
            // Channel (B): a real destructible enemy. Butcher R1 (NO Marauder Rage on kill) is the
            // clean probe — only Overload moves its outgoing damage. With base damage 100, Overload
            // adds +10% per stack, so per-round outgoing CLIMBS 110→120→130 while accruing.
            //
            // KILL run: a small enemy dies mid-battle. The round Overload is stripped (lose-on-kill),
            // outgoing drops back toward base, then climbs again as Overload re-accrues.
            // NOKILL control: nothing dies → outgoing climbs monotonically the whole battle.
            const butcher = ship('Butcher', {
                activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
                firstPassiveSkillText: BUTCHER_P1,
            });
            const killRun = simulateBattle({
                playerTeam: [place(butcher, 'M4', 100, 1e12)],
                enemyTeam: [
                    place(dummy('wall', 'Defender'), 'M3', 1, 1e12),
                    place(dummy('chip'), 'M4', 1, 250),
                ],
                rounds: 8,
            });
            const noKillRun = simulateBattle({
                playerTeam: [place(butcher, 'M4', 100, 1e12)],
                enemyTeam: [
                    place(dummy('wall2', 'Defender'), 'M3', 1, 1e12),
                    place(dummy('chip2'), 'M4', 1, 1e12),
                ],
                rounds: 8,
            });

            const kill = focusDamageByRound(killRun);
            const noKill = focusDamageByRound(noKillRun);
            const killAt = deathRounds(killRun);

            // Sanity: a kill happened in the kill run, none in the control.
            expect(killAt.length).toBeGreaterThan(0);
            expect(deathRounds(noKillRun)).toEqual([]);
            const kr = killAt[0]; // first death round (1-indexed)

            // Robustness guard: we read kill[kr] as "the round AFTER the death" (kr is 1-indexed,
            // so array idx kr is the next round). That read is only valid if the kill is not the
            // final round — fail LOUDLY here if it ever drifts, instead of a confusing
            // `undefined < number` comparison below.
            expect(kr).toBeLessThan(kill.length - 1);

            // Control: Overload never stripped → strictly increasing outgoing every round.
            for (let i = 1; i < noKill.length; i++) {
                expect(noKill[i]).toBeGreaterThan(noKill[i - 1]);
            }

            // Kill run: the round AFTER the kill strips Overload, outgoing DROPS vs the round
            // before the kill (it would have kept rising without the reset) and is strictly less
            // than the monotone control at that same round. (rounds are 1-indexed → array idx kr.)
            expect(kill[kr]).toBeLessThan(kill[kr - 1]);
            expect(kill[kr]).toBeLessThan(noKill[kr]);

            // …and Overload RESUMES accruing afterwards (re-accrual fix): the last round's outgoing
            // is strictly greater than the post-reset trough → the store was reset, not destroyed.
            expect(kill[kill.length - 1]).toBeGreaterThan(kill[kr]);
        });
    });

    // ── 2. Marauder Rage on kill ─────────────────────────────────────────────
    describe('2. Marauder Rage granted on kill', () => {
        it('Mangler gains Marauder Rage I on the kill round (p1 tier)', () => {
            const mangler = ship('Mangler', {
                activeSkillText: 'This Unit deals <unit-damage>120% damage</unit-damage>.',
                firstPassiveSkillText: MANGLER_P1,
            });
            const r = simulateBattle({
                playerTeam: [place(mangler, 'M4', 100, 1e12)],
                enemyTeam: [
                    place(dummy('wall', 'Defender'), 'M3', 1, 1e12),
                    place(dummy('chip'), 'M4', 1, 250),
                ],
                rounds: 6,
            });
            const mr = buffActorRounds(r, 'Marauder Rage I');
            // Granted on the kill round, on the focus (player) actor.
            expect(mr.rounds).toEqual(deathRounds(r));
            expect(mr.actors.has('attacker')).toBe(true);
            // The higher tier (II/III) must NOT appear — tier comes from the resolved skill text.
            expect(buffActorRounds(r, 'Marauder Rage III').rounds).toEqual([]);
        });

        it('Ravager gains Marauder Rage III on the kill round', () => {
            const ravager = ship('Ravager', {
                activeSkillText: 'This Unit deals <unit-damage>190% damage</unit-damage>.',
                firstPassiveSkillText: RAVAGER_P1,
            });
            const r = simulateBattle({
                playerTeam: [place(ravager, 'M4', 100, 1e12)],
                enemyTeam: [
                    place(dummy('wall', 'Defender'), 'M3', 1, 1e12),
                    place(dummy('chip'), 'M4', 1, 250),
                ],
                rounds: 6,
            });
            const mr = buffActorRounds(r, 'Marauder Rage III');
            expect(mr.rounds).toEqual(deathRounds(r));
            expect(mr.actors.has('attacker')).toBe(true);
            expect(buffActorRounds(r, 'Marauder Rage I').rounds).toEqual([]);
        });
    });

    // ── 3. Butcher Marauder Rage on debuff-inflict (no kill) ─────────────────
    it('3. Butcher gains Marauder Rage II when it inflicts a debuff (on-debuff-inflicted)', () => {
        // Channel (A): Butcher's active inflicts Inferno (a DoT) every round → on-debuff-inflicted
        // fires and grants Marauder Rage II. No kill required (indestructible dummy). The grant
        // surfaces in activeSelfBuffs the round after it lands (decrement/snapshot cadence).
        const butcher = ship('Butcher', {
            activeSkillText:
                'This Unit deals <unit-damage>160% damage</unit-damage> and inflicts <unit-skill>Inferno II</unit-skill> for 3 turns.',
            firstPassiveSkillText: 'placeholder (R0 — superseded by the refit-active R2 passive)',
            secondPassiveSkillText: BUTCHER_P2,
            refits: [{}, {}] as Ship['refits'], // >= 2 → second passive is the refit-active one
        });
        const r = runCombat(dpsBase(skillsFor(butcher)));
        const names = selfBuffNames(r);
        // Marauder Rage II is present in at least one round (granted on the DoT infliction).
        expect(names.some((round) => round.includes('Marauder Rage II'))).toBe(true);
        // Overload still accrues alongside (the every-turn grant is unaffected).
        expect(names.some((round) => round.includes('Overload'))).toBe(true);

        // NEGATIVE CONTROL — isolates on-debuff-inflicted from on-cast. Same Butcher passive (R2),
        // same active turns every round, but the active deals PURE DAMAGE (inflicts NO debuff). The
        // grant trigger is on-debuff-inflicted, so Marauder Rage II must be ABSENT here. If the
        // trigger ever regressed to on-cast, the cast would still fire and Rage would appear —
        // failing this assertion. Overload's every-turn accrual still happens (cast-independent).
        const butcherNoDebuff = ship('Butcher', {
            activeSkillText: 'This Unit deals <unit-damage>160% damage</unit-damage>.',
            firstPassiveSkillText: 'placeholder (R0 — superseded by the refit-active R2 passive)',
            secondPassiveSkillText: BUTCHER_P2,
            refits: [{}, {}] as Ship['refits'],
        });
        const rNoDebuff = runCombat(dpsBase(skillsFor(butcherNoDebuff)));
        const namesNoDebuff = selfBuffNames(rNoDebuff);
        expect(namesNoDebuff.some((round) => round.includes('Marauder Rage II'))).toBe(false);
        // Sanity: the ship still acted (Overload accrues), so the absence above is non-vacuous.
        expect(namesNoDebuff.some((round) => round.includes('Overload'))).toBe(true);
    });

    it('3b. Butcher gains Marauder Rage II on debuff-inflict on the POSITIONAL path (simulateBattle, team-symmetric)', () => {
        // Channel (B): the SP-G G4 gap. Channel-A test 3 proves this fires under runCombat; here we
        // pin it under the positional two-team simulateBattle path, where SP0 found it silently
        // never fired. Butcher inflicts Inferno II every round on an indestructible wall (no kill),
        // so the ONLY source of Marauder Rage II is the on-debuff-inflicted reaction.
        const butcher = ship('Butcher', {
            activeSkillText:
                'This Unit deals <unit-damage>160% damage</unit-damage> and inflicts <unit-skill>Inferno II</unit-skill> for 3 turns.',
            firstPassiveSkillText: 'placeholder (R0 — superseded by the refit-active R2 passive)',
            secondPassiveSkillText: BUTCHER_P2,
            refits: [{}, {}] as Ship['refits'],
        });
        const r = simulateBattle({
            playerTeam: [place(butcher, 'M4', 100, 1e12)],
            enemyTeam: [place(dummy('wall', 'Defender'), 'M3', 1, 1e12)],
            rounds: 4,
        });
        const mr = buffActorRounds(r, 'Marauder Rage II');
        expect(mr.actors.has('attacker')).toBe(true);
    });

    it('3c. team symmetry — an ENEMY-side Butcher inflicting a debuff ALSO gains Marauder Rage II positionally', () => {
        // Mirror of 3b with the Butcher on the ENEMY team. The G4 fix is parse-time (side-agnostic),
        // so the reaction must fire identically on either side (feedback_engine_team_symmetry). A
        // player-side indestructible wall is the debuff victim (no kill confound); the enemy Butcher
        // inflicts Inferno II every round → its ONLY source of Marauder Rage II is on-debuff-inflicted.
        const enemyButcher = ship('EnemyButcher', {
            activeSkillText:
                'This Unit deals <unit-damage>160% damage</unit-damage> and inflicts <unit-skill>Inferno II</unit-skill> for 3 turns.',
            firstPassiveSkillText: 'placeholder (R0 — superseded by the refit-active R2 passive)',
            secondPassiveSkillText: BUTCHER_P2,
            refits: [{}, {}] as Ship['refits'],
        });
        const r = simulateBattle({
            playerTeam: [place(dummy('wall', 'Defender'), 'M3', 1, 1e12)],
            enemyTeam: [place(enemyButcher, 'M4', 100, 1e12)],
            rounds: 4,
        });
        const mr = buffActorRounds(r, 'Marauder Rage II');
        const enemyId = r.roster.find((x) => x.side === 'enemy')!.actorId;
        // The grant landed — and ONLY on the enemy Butcher's own actor id (team-agnostic self-grant;
        // it never leaks to the player side).
        expect(mr.actors.has(enemyId)).toBe(true);
        for (const a of mr.actors) {
            expect(r.roster.find((x) => x.actorId === a)?.side).toBe('enemy');
        }
    });

    // ── 4. Ruiner on-enemy-repaired (gain Overload) ──────────────────────────
    it('4. Ruiner gains Overload when an enemy performs a repair (on-enemy-repaired)', () => {
        // Channel (A) healing mode: an enemy attacker that casts an all-allies repair each round.
        // Ruiner's on-enemy-repaired grant accrues Overload once per enemy repair (1→2→3 across
        // the rounds following the first repair). lose-on-kill is the shared mechanic proven in
        // test 1 (Ruiner's removal clause resolves to on-enemy-destroyed, same path).
        const ruiner = ship('Ruiner', {
            activeSkillText: 'This Unit deals <unit-damage>160% damage</unit-damage>.',
            firstPassiveSkillText: RUINER_P1,
        });
        const healer = ship('Healer', {
            activeSkillText: 'This Unit repairs all allies for 30% of their Max HP.',
            activeTarget: 'allies',
            type: 'Support',
        });
        const r = runCombat(
            dpsBase(skillsFor(ruiner), {
                numRounds: 4,
                healTargetId: 'attacker',
                mode: 'healing',
                enemyAttackers: [
                    {
                        id: 'repairer',
                        // `hp` is LOAD-BEARING. The skill repairs "30% of their Max HP", so without
                        // it the repair resolved to exactly 0 — and this fixture used to pass only
                        // because a zero repair still counted as a repair (the cast path emitted
                        // `heal-performed` on recipient count alone). R5(ii) closed that, matching
                        // the gate the reactive path has had since PR6, so the healer now needs a
                        // real Max HP to perform a real repair. The mechanic under test — one
                        // Overload stack per enemy repair — is unchanged.
                        stats: {
                            attack: 100,
                            crit: 0,
                            critDamage: 0,
                            defence: 0,
                            hp: 1_000_000,
                            speed: 50,
                        },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: skillsFor(healer),
                    },
                ],
            })
        );
        const stacks = overloadStacks(r);
        // Overload is absent before the first repair, then accrues monotonically as the enemy repairs.
        const present = stacks.filter((s): s is number => s !== undefined);
        expect(present.length).toBeGreaterThan(0);
        expect(Math.max(...present)).toBeGreaterThanOrEqual(2);
        // Strictly increasing across the rounds it is present (one stack per enemy repair).
        for (let i = 1; i < present.length; i++) {
            expect(present[i]).toBeGreaterThan(present[i - 1]);
        }

        // NEGATIVE CONTROL — isolates on-enemy-repaired from on-cast. Same Ruiner, same active turns
        // every round, but the enemy attacker deals PURE DAMAGE and never repairs. Ruiner gains
        // Overload only on an enemy repair (it has no every-turn accrual), so with no enemy repair the
        // Overload store must stay EMPTY all rounds. A regression to on-cast (its own or the enemy's
        // cast) would light it up — failing this assertion.
        const noRepairEnemy = ship('Striker', {
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            type: 'Attacker',
        });
        const rNoRepair = runCombat(
            dpsBase(skillsFor(ruiner), {
                numRounds: 4,
                healTargetId: 'attacker',
                mode: 'healing',
                enemyAttackers: [
                    {
                        id: 'striker',
                        stats: { attack: 100, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: skillsFor(noRepairEnemy),
                    },
                ],
            })
        );
        expect(overloadStacks(rNoRepair).every((s) => s === undefined)).toBe(true);
    });

    // ── 5. Asphyxiator start-of-round conditional ────────────────────────────
    describe('5. Asphyxiator start-of-round conditional (>= 3 enemy debuffs)', () => {
        const asphy = (): Ship =>
            ship('Asphyxiator', {
                activeSkillText: 'This Unit deals <unit-damage>175% damage</unit-damage>.',
                firstPassiveSkillText: ASPHYXIATOR_P1,
            });

        it('with an enemy carrying >= 3 debuffs at round start, gains Overload + Marauder Rage II', () => {
            const r = runCombat(
                dpsBase(skillsFor(asphy()), {
                    enemyDebuffs: [
                        enemyDebuff('Defense Down III'),
                        enemyDebuff('Speed Down I'),
                        enemyDebuff('Attack Down I'),
                    ],
                })
            );
            // Every round the gate passes → Overload accrues and Marauder Rage II is granted.
            expect(overloadStacks(r)).toEqual([1, 2, 3, 4]);
            expect(selfBuffNames(r).every((round) => round.includes('Marauder Rage II'))).toBe(
                true
            );
        });

        it('with only 2 enemy debuffs the gate fails — no Overload, no Marauder Rage (non-vacuous)', () => {
            const r = runCombat(
                dpsBase(skillsFor(asphy()), {
                    enemyDebuffs: [enemyDebuff('Defense Down III'), enemyDebuff('Speed Down I')],
                })
            );
            expect(selfBuffNames(r)).toEqual([[], [], [], []]);
        });
    });

    // ── 6. Team symmetry (LOCKED invariant) ──────────────────────────────────
    it('6. an ENEMY-side Marauder that kills a PLAYER ship loses Overload and gains Marauder Rage identically', () => {
        // Mirror of the kill scenario with the Marauder on the ENEMY team. A plain anchor + a
        // fragile victim anchor the PLAYER team. The enemy Mangler kills the victim and, on its
        // own side, gains Marauder Rage I — exactly as the player-side Mangler does (test 2).
        const enemyMangler = ship('EnemyMangler', {
            activeSkillText: 'This Unit deals <unit-damage>120% damage</unit-damage>.',
            firstPassiveSkillText: MANGLER_P1,
        });
        const r = simulateBattle({
            playerTeam: [
                place(
                    ship('Anchor', {
                        activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage>.',
                        type: 'Defender',
                    }),
                    'M3',
                    1,
                    1e12
                ),
                place(
                    ship('Victim', {
                        activeSkillText: 'This Unit deals <unit-damage>1% damage</unit-damage>.',
                    }),
                    'M4',
                    1,
                    250
                ),
            ],
            enemyTeam: [place(enemyMangler, 'M4', 100, 1e12)],
            rounds: 6,
        });

        // A PLAYER ship was killed by the enemy.
        const deaths = r.combatLog.flatMap((rd) =>
            flattenRound(rd)
                .filter((e) => e.kind === 'death')
                .map((e) => e.actorId)
        );
        expect(deaths.some((id) => id.startsWith('p:'))).toBe(true);

        // Marauder Rage I landed — and ONLY on the enemy Marauder's own actor id (team-agnostic
        // self-grant; it never leaks to the player side).
        const mr = buffActorRounds(r, 'Marauder Rage I');
        const enemyId = r.roster.find((x) => x.side === 'enemy')!.actorId;
        expect(mr.actors.has(enemyId)).toBe(true);
        for (const a of mr.actors) {
            expect(r.roster.find((x) => x.actorId === a)?.side).toBe('enemy');
        }
        // The grant coincides with the kill round.
        expect(mr.rounds).toEqual(deathRounds(r));
    });

    it('6b. an ENEMY-side Marauder that kills a PLAYER ship LOSES Overload (damage-footprint mirror)', () => {
        // The Rage assertion in 6 proves the GRANT branch crosses sides; this proves the RESET branch
        // does too — a regression where enemy kills grant Rage but never clear Overload would pass 6.
        // Mirror of the player-side lose-on-kill test (channel B): an enemy BUTCHER (grants NO Marauder
        // Rage on kill) is the clean probe — only Overload moves its outgoing damage (+10%/stack), so
        // a drop the round after its kill is an unconfounded Overload-reset signal. KILL run: a fragile
        // player victim dies mid-battle; the enemy Butcher's damage CLIMBS while accruing then DROPS
        // the round its kill strips Overload. NOKILL control: nothing player-side dies → monotone climb.
        const enemyButcher = (id: string): Ship =>
            ship(id, {
                activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
                firstPassiveSkillText: BUTCHER_P1,
            });
        const anchor = (): BattlePlacement =>
            place(
                ship('Anchor', {
                    activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage>.',
                    type: 'Defender',
                }),
                'M3',
                1,
                1e12
            );
        const killRun = simulateBattle({
            playerTeam: [
                anchor(),
                place(
                    ship('Victim', {
                        activeSkillText: 'This Unit deals <unit-damage>1% damage</unit-damage>.',
                    }),
                    'M4',
                    1,
                    250
                ),
            ],
            enemyTeam: [place(enemyButcher('EBK'), 'M4', 100, 1e12)],
            rounds: 8,
        });
        const noKillRun = simulateBattle({
            playerTeam: [
                anchor(),
                place(
                    ship('Victim2', {
                        activeSkillText: 'This Unit deals <unit-damage>1% damage</unit-damage>.',
                    }),
                    'M4',
                    1,
                    1e12
                ),
            ],
            enemyTeam: [place(enemyButcher('EBN'), 'M4', 100, 1e12)],
            rounds: 8,
        });

        const enemyId = killRun.roster.find((x) => x.side === 'enemy')!.actorId;
        const noKillEnemyId = noKillRun.roster.find((x) => x.side === 'enemy')!.actorId;
        const kill = damageByRoundFor(killRun, enemyId);
        const noKill = damageByRoundFor(noKillRun, noKillEnemyId);

        // A PLAYER ship died in the kill run, none in the control.
        const killAt = deathRounds(killRun);
        expect(killAt.length).toBeGreaterThan(0);
        expect(deathRounds(noKillRun)).toEqual([]);
        const kr = killAt[0]; // first death round (1-indexed → array idx kr is the round after)
        expect(kr).toBeLessThan(kill.length - 1);

        // Control: enemy Overload never stripped → strictly increasing outgoing every round.
        for (let i = 1; i < noKill.length; i++) {
            expect(noKill[i]).toBeGreaterThan(noKill[i - 1]);
        }
        // Kill run: the round after the kill strips the enemy's Overload → outgoing DROPS vs the round
        // before and is strictly below the monotone control at that same round.
        expect(kill[kr]).toBeLessThan(kill[kr - 1]);
        expect(kill[kr]).toBeLessThan(noKill[kr]);
        // …and the enemy's Overload RESUMES accruing afterwards (reset, not destroyed, on the enemy side).
        expect(kill[kill.length - 1]).toBeGreaterThan(kill[kr]);
    });
});
