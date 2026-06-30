/**
 * Implant firing through the REAL placement path (planPlacement -> simulateBattle).
 *
 * Closes the coverage gap behind combat-sim finding #6 ("implants never fire"): a manual-skills
 * integration test proved Martyrdom fires when fed hand-built ship skills, but nothing drove a
 * REAL placed ship resolving its implant via getGearPiece through simulateBattle — the path the
 * user exercises in the sim UI. These pin that implants DO resolve and fire on BOTH sides under
 * a direct-damage kill, so #6 is not a wiring failure but a narrower scenario (the byDirectDamage
 * gate on indirect kills, and/or log visibility before the combat-log overhaul).
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import type { CombatLogEntry } from '../log/types';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

const makeShip = (id: string, name: string, over: Partial<Ship> = {}): Ship => ({
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
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    ...over,
});

const placement = (
    ship: Ship,
    position: BattlePlacement['position'],
    attack: number,
    hp: number,
    speed: number
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
        speed,
    },
});

// A minimal implant gear piece: buildEquipmentAbilities reads only piece.setBonus + piece.rarity.
const martyrdomPiece = (): GearPiece =>
    ({ id: 'mart', setBonus: 'MARTYRDOM', rarity: 'legendary' }) as unknown as GearPiece;
// Rare Martyrdom: same set bonus, rare rarity → Disable(1).
const rareMartyrdomPiece = (): GearPiece =>
    ({ id: 'mart-rare', setBonus: 'MARTYRDOM', rarity: 'rare' }) as unknown as GearPiece;
const getGearPiece = (id: string): GearPiece | undefined =>
    id === 'mart' ? martyrdomPiece() : id === 'mart-rare' ? rareMartyrdomPiece() : undefined;

// Count the killer's TOP-LEVEL attack entries (not nested reactions) in a given 1-based round.
// A turn-blocked (Disabled) actor produces no attack entry that round.
const killerAttacksInRound = (
    result: {
        combatLog: { round: number; turns: { actorId: string; entries: { kind: string }[] }[] }[];
    },
    killerId: string,
    round: number
): number => {
    const r = result.combatLog.find((cr) => cr.round === round);
    if (!r) return 0;
    return r.turns
        .filter((t) => t.actorId === killerId)
        .reduce((n, t) => n + t.entries.filter((e) => e.kind === 'attack').length, 0);
};

describe('implant real-path repro — Martyrdom through planPlacement -> simulateBattle', () => {
    it('a ship with a Martyrdom implant, killed by a DIRECT hit, applies Disable to its killer', () => {
        // Player carrier: Martyrdom equipped, fragile + slow → the fast enemy kills it with a
        // direct attack before it acts.
        const carrier = makeShip('carrier', 'Carrier', {
            implants: { implant_major: 'mart' },
        });
        // Enemy: huge attack, fast → guaranteed lethal DIRECT hit on the carrier round 1.
        const killer = makeShip('killer', 'Killer');

        const result = simulateBattle(
            {
                playerTeam: [placement(carrier, 'M4', 100, 1, /* slow */ 10)],
                enemyTeam: [placement(killer, 'M4', 1_000_000, 1_000_000_000, /* fast */ 1000)],
                rounds: 3,
            },
            getGearPiece
        );

        const enemyId = result.roster.find((r) => r.side === 'enemy')?.actorId;
        expect(enemyId).toBeDefined();

        const disableOnKiller = flattenCombatLog(result).filter(
            (e) =>
                e.kind === 'debuff' &&
                e.note === 'Disable' &&
                e.targets.some((t) => t.targetId === enemyId)
        );
        expect(disableOnKiller.length).toBeGreaterThan(0);
    });

    it('user repro: enemy Martyrdom carrier killed by a NON-FOCUS player ship Disables that killer', () => {
        // Mirrors the reported scenario: enemy Graphite (Martyrdom) destroyed by 'Liberator',
        // a non-focus player ship (id p:…:1, NOT the focus 'attacker'). The focus is a weak,
        // slow ship that does not land the kill; the fast heavy-hitting teammate does.
        const focus = makeShip('focus', 'Focus');
        const liberator = makeShip('liberator', 'Liberator');
        const graphite = makeShip('graphite', 'Enemy Graphite', {
            implants: { implant_ultimate: 'mart' },
        });

        const result = simulateBattle(
            {
                playerTeam: [
                    placement(focus, 'M3', 1, 1_000_000_000, /* slow */ 5),
                    placement(liberator, 'M4', 1_000_000, 1_000_000_000, /* fast */ 1000),
                ],
                enemyTeam: [placement(graphite, 'M4', 1, 1, /* slow */ 10)],
                rounds: 3,
            },
            getGearPiece
        );

        // The non-focus killer's id is p:<shipId>:<index> (index 1 here).
        const killerId = 'p:liberator:1';
        const disableOnKiller = flattenCombatLog(result).filter(
            (e) =>
                e.kind === 'debuff' &&
                e.note === 'Disable' &&
                e.targets.some((t) => t.targetId === killerId)
        );
        expect(disableOnKiller.length).toBeGreaterThan(0);
    });

    it("killer with Liberator's on-enemy-death extra-action passive still triggers the victim's Martyrdom", () => {
        // Liberator (fails in the user's logs) differs from Selenite (works) by its passive:
        // "When an enemy dies, ... once per round, this unit gains 1 extra action." That on-death
        // reaction fires simultaneously with the dying carrier's own Martyrdom. This isolates
        // whether that simultaneous on-enemy-death reaction suppresses the victim's on-destroyed.
        const carrier = makeShip('carrier', 'Carrier', {
            implants: { implant_ultimate: 'mart' },
        });
        const killer = makeShip('killer', 'Liberator-kit', {
            // Plain lethal active (Selenite-style kill), PLUS Liberator's extra-action passive.
            activeSkillText: 'This Unit deals <unit-damage>100000% damage</unit-damage>.',
            secondPassiveSkillText:
                'This Unit has 40% Shield Penetration. When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills, and once per round, this unit gains 1 extra action.',
            refits: Array.from({ length: 2 }, () => ({})) as unknown as Ship['refits'],
        });

        const result = simulateBattle(
            {
                playerTeam: [placement(carrier, 'M4', 100, 100, /* slow */ 10)],
                enemyTeam: [placement(killer, 'M4', 1000, 1_000_000_000, /* fast */ 1000)],
                rounds: 3,
            },
            getGearPiece
        );

        const enemyId = result.roster.find((r) => r.side === 'enemy')?.actorId;
        const disableOnKiller = flattenCombatLog(result).filter(
            (e) =>
                e.kind === 'debuff' &&
                e.note === 'Disable' &&
                e.targets.some((t) => t.targetId === enemyId)
        );
        expect(disableOnKiller.length).toBeGreaterThan(0);
    });

    it('combat-log #6: a reactive on-enemy-death charge-grant is NESTED under the kill, not surfaced as a turn action that the Martyrdom Disable wrongly nests under', () => {
        // Bug repro (combat-sim finding #6 secondary). A killer kills a Martyrdom victim. A killer-
        // side ALLY carries an on-enemy-death "grants 1 charge to all allies" passive — that reaction
        // fires on the death, DURING the killer's turn, and routes through the engine's
        // grantAllyCharges delegate. Pre-fix the delegate emitted `charge-changed` on the UNSTAMPED
        // outer bus, so the log builder surfaced it as a NON-reactive TOP-LEVEL entry in the killer's
        // turn — both a wrong attribution (a reaction shown as a turn action) AND a stray trigger
        // candidate the victim's Disable could wrongly nest under. Post-fix the executor passes the
        // stamping bus (ctx.bus), so the charge-changed is branded reactive/`duringTurnOf=killer` and
        // the builder NESTS it under the death/attack (and never treats it as a Disable trigger).
        const carrier = makeShip('carrier', 'Carrier', {
            implants: { implant_ultimate: 'mart' },
        });
        const killer = makeShip('killer', 'Liberator-kit', {
            activeSkillText: 'This Unit deals <unit-damage>100000% damage</unit-damage>.',
        });
        // A SEPARATE killer-side ally owns the on-enemy-death charge-grant (so the grant is NOT
        // suppressed by the Disable that lands on the killer) and has a REAL charged skill so the
        // grant moves a charge counter and emits `charge-changed` during the killer's turn.
        const chargedAlly = makeShip('ally', 'Charged Ally', {
            chargeSkillCharge: 3,
            chargeSkillText: 'This Unit deals <unit-damage>200% damage</unit-damage>.',
            firstPassiveSkillText: 'When an enemy dies, this unit grants 1 charge to all allies.',
        });

        const result = simulateBattle(
            {
                playerTeam: [placement(carrier, 'M4', 100, 100, /* slow */ 10)],
                enemyTeam: [
                    placement(killer, 'M4', 1000, 1_000_000_000, /* fast */ 1000),
                    placement(chargedAlly, 'M3', 1, 1_000_000_000, /* slow */ 5),
                ],
                rounds: 3,
            },
            getGearPiece
        );

        const killerId = 'e:killer:0';
        const allyId = 'e:ally:1';
        expect(result.roster.some((r) => r.actorId === killerId && r.side === 'enemy')).toBe(true);

        const allEntries = flattenCombatLog(result);

        // Sanity: the Disable lands at all (Fix A) — without it the nesting question is moot.
        const disableOnKiller = allEntries.filter(
            (e) =>
                e.kind === 'debuff' &&
                e.note === 'Disable' &&
                e.targets.some((t) => t.targetId === killerId)
        );
        expect(disableOnKiller.length).toBeGreaterThan(0);

        // The reactive on-death charge grant on the ally (`reason: manip` → note contains "manip").
        // It must exist (otherwise the bug can't reproduce) — it is the entry the fix re-attributes.
        const reactiveChargeGrants = allEntries.filter(
            (e) =>
                e.kind === 'charge-changed' &&
                e.actorId === allyId &&
                (e.note?.includes('manip') ?? false)
        );
        expect(reactiveChargeGrants.length).toBeGreaterThan(0);

        // (1) The reactive charge-grant must NOT appear as a TOP-LEVEL entry in any turn. Pre-fix it
        // surfaced as a top-level entry in the killer's turn (unstamped); post-fix it is a nested
        // reaction under the kill. The ally's OWN per-turn cadence charge changes ('gen') stay
        // top-level and are correctly excluded by the `manip` filter above.
        const topLevelReactiveCharge = result.combatLog
            .flatMap((round) => round.turns.flatMap((t) => t.entries))
            .some(
                (e) =>
                    e.kind === 'charge-changed' &&
                    e.actorId === allyId &&
                    (e.note?.includes('manip') ?? false)
            );
        expect(topLevelReactiveCharge).toBe(false);

        // Helper: find the parent entry (the one whose `.reactions[]` contains `child`).
        const parentOf = (child: CombatLogEntry): CombatLogEntry | undefined =>
            result.combatLog
                .flatMap((round) => [...round.turns.flatMap((t) => t.entries), ...round.endOfRound])
                .flatMap(function collect(e): CombatLogEntry[] {
                    return [e, ...e.reactions.flatMap(collect)];
                })
                .find((e) => e.reactions.includes(child));

        // (2) The reactive charge-grant is nested under the kill — its parent is the killer's
        // attack or the death entry, never a free-floating turn action.
        const grantParent = parentOf(reactiveChargeGrants[0]);
        expect(grantParent).toBeDefined();
        expect(['attack', 'death']).toContain(grantParent!.kind);

        // (3) The victim's Disable must NOT nest under the charge-changed (the original mis-nesting):
        // its parent is the kill (attack or death entry), reflecting the real `↳ reacts` chain.
        const disableParent = parentOf(disableOnKiller[0]);
        expect(disableParent).toBeDefined();
        expect(disableParent!.kind).not.toBe('charge-changed');
        expect(['attack', 'death']).toContain(disableParent!.kind);
    });

    it('mixed-affinity: Martyrdom lands on the ACTUAL killer (neutral), not gated by the representative opponent (disadvantage)', () => {
        // Task A repro. The victim's affinity matchup is precomputed ONCE vs the FIRST opposing
        // placement (the representative). Here the representative DISADVANTAGES the victim, but the
        // ACTUAL killer is a NEUTRAL matchup → the `apply` Disable MUST land on the killer.
        //
        // Affinity directions (electric beats thermal; thermal-vs-thermal neutral):
        //   - victim carrier: thermal
        //   - representative player[0] (focus, does NOT land the kill): electric → victim DISADVANTAGED
        //   - killer (fast teammate, lands the kill): thermal → NEUTRAL → Disable should land
        //
        // Pre-fix: landing is gated by the victim's disadvantage vs the electric representative →
        // RESISTED. Post-fix: re-resolved vs the actual thermal killer → NEUTRAL → lands.
        const focus = makeShip('focus', 'Focus', { affinity: 'electric' });
        const liberator = makeShip('liberator', 'Liberator', { affinity: 'thermal' });
        const graphite = makeShip('graphite', 'Enemy Graphite', {
            affinity: 'thermal',
            implants: { implant_ultimate: 'mart' },
        });

        const result = simulateBattle(
            {
                playerTeam: [
                    placement(focus, 'M3', 1, 1_000_000_000, /* slow */ 5),
                    placement(liberator, 'M4', 1_000_000, 1_000_000_000, /* fast */ 1000),
                ],
                enemyTeam: [placement(graphite, 'M4', 1, 1, /* slow */ 10)],
                rounds: 3,
            },
            getGearPiece
        );

        const killerId = 'p:liberator:1';
        const disableOnKiller = flattenCombatLog(result).filter(
            (e) =>
                e.kind === 'debuff' &&
                e.note === 'Disable' &&
                e.targets.some((t) => t.targetId === killerId)
        );
        expect(disableOnKiller.length).toBeGreaterThan(0);
    });

    it('ENEMY-side symmetry: an enemy ship with Martyrdom, killed by the player, Disables the player killer', () => {
        // Mirror of case 1 with sides swapped: the Martyrdom carrier is on the ENEMY team.
        const carrier = makeShip('carrier', 'Enemy Carrier', {
            implants: { implant_major: 'mart' },
        });
        const killer = makeShip('killer', 'Player Killer');

        const result = simulateBattle(
            {
                playerTeam: [placement(killer, 'M4', 1_000_000, 1_000_000_000, /* fast */ 1000)],
                enemyTeam: [placement(carrier, 'M4', 100, 1, /* slow */ 10)],
                rounds: 3,
            },
            getGearPiece
        );

        const playerKillerId = result.roster.find((r) => r.side === 'player')?.actorId;
        expect(playerKillerId).toBeDefined();

        const disableOnPlayer = flattenCombatLog(result).filter(
            (e) =>
                e.kind === 'debuff' &&
                e.note === 'Disable' &&
                e.targets.some((t) => t.targetId === playerKillerId)
        );
        expect(disableOnPlayer.length).toBeGreaterThan(0);
    });

    it('#6b: LEGENDARY Martyrdom Disables its killer for TWO full turns (not one)', () => {
        // Repro for the duration bug. A fast killer one-shots a front-positioned LEGENDARY-Martyrdom
        // carrier in R1; the Disable(2) lands on the killer DURING the killer's own turn. A SECOND
        // immortal enemy keeps the killer with a live target every round — so if the killer is NOT
        // blocked it WILL attack. Legendary Disable lasts 2 turns → the killer is turn-blocked in R2
        // AND R3 (no attack). Pre-fix the killer's own-turn Post-Turn eats the first tick, so it is
        // blocked only in R2 and attacks again in R3.
        const carrier = makeShip('carrier', 'Enemy Carrier', {
            implants: { implant_ultimate: 'mart' },
        });
        const wall = makeShip('wall', 'Immortal Wall');
        const killer = makeShip('killer', 'Player Killer');

        const result = simulateBattle(
            {
                playerTeam: [placement(killer, 'M4', 1_000_000, 1_000_000_000, /* fast */ 1000)],
                enemyTeam: [
                    placement(carrier, 'M4', 100, 1, /* slow */ 10),
                    placement(wall, 'M3', 1, 1_000_000_000, /* slow */ 5),
                ],
                rounds: 4,
            },
            getGearPiece
        );

        const killerId = result.roster.find((r) => r.side === 'player')?.actorId;
        expect(killerId).toBeDefined();

        // The Disable actually lands (sanity).
        const disableOnKiller = flattenCombatLog(result).filter(
            (e) =>
                e.kind === 'debuff' &&
                e.note === 'Disable' &&
                e.targets.some((t) => t.targetId === killerId)
        );
        expect(disableOnKiller.length).toBeGreaterThan(0);

        // R1: killer attacks (lands the kill). R2 & R3: turn-blocked → no attack. R4: free again.
        expect(killerAttacksInRound(result, killerId!, 1)).toBeGreaterThan(0);
        expect(killerAttacksInRound(result, killerId!, 2)).toBe(0);
        expect(killerAttacksInRound(result, killerId!, 3)).toBe(0); // pre-fix: > 0 (one turn too short)
        expect(killerAttacksInRound(result, killerId!, 4)).toBeGreaterThan(0);
    });

    it('#6b: RARE Martyrdom Disables its killer for exactly ONE full turn', () => {
        // Same shape but RARE Martyrdom → Disable(1). Same own-turn-reprieve fix applies: the
        // Disable lands during the killer's own turn, so without the reprieve its first (and only)
        // tick was eaten by the killer's same-turn Post-Turn → ZERO blocked turns pre-fix. Post-fix
        // the reprieve gives it its single turn: blocked in R2 only, free in R3.
        const carrier = makeShip('carrier', 'Enemy Carrier', {
            implants: { implant_ultimate: 'mart-rare' },
        });
        const wall = makeShip('wall', 'Immortal Wall');
        const killer = makeShip('killer', 'Player Killer');

        const result = simulateBattle(
            {
                playerTeam: [placement(killer, 'M4', 1_000_000, 1_000_000_000, /* fast */ 1000)],
                enemyTeam: [
                    placement(carrier, 'M4', 100, 1, /* slow */ 10),
                    placement(wall, 'M3', 1, 1_000_000_000, /* slow */ 5),
                ],
                rounds: 4,
            },
            getGearPiece
        );

        const killerId = result.roster.find((r) => r.side === 'player')?.actorId;
        expect(killerId).toBeDefined();

        const disableOnKiller = flattenCombatLog(result).filter(
            (e) =>
                e.kind === 'debuff' &&
                e.note === 'Disable' &&
                e.targets.some((t) => t.targetId === killerId)
        );
        expect(disableOnKiller.length).toBeGreaterThan(0);

        // R1: kill. R2: blocked. R3: free again (one-turn block, unchanged).
        expect(killerAttacksInRound(result, killerId!, 1)).toBeGreaterThan(0);
        expect(killerAttacksInRound(result, killerId!, 2)).toBe(0);
        expect(killerAttacksInRound(result, killerId!, 3)).toBeGreaterThan(0);
    });
});
