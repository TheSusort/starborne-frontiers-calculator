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
const getGearPiece = (id: string): GearPiece | undefined =>
    id === 'mart' ? martyrdomPiece() : undefined;

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
});
