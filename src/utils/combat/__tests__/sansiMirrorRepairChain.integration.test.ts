/**
 * Sansi vs Sansi: the one cross-side repair -> repair cycle on the board, and what ends it.
 *
 * Sansi's second passive: "When an enemy is directly repaired, limited to 3 times per round, this
 * Unit repairs 5% of its max HP for every enemy repaired." Her repair is itself a repair the other
 * side sees, so with a Sansi on each side one repair sets off a chain:
 *
 *   1. An enemy healer repairs itself (a cast `heal-performed`).
 *   2. Player Sansi A answers it and repairs (`reactive-heal-performed`, lineage [ ]).
 *   3. Enemy Sansi B answers A's repair and repairs (lineage [A]).
 *   4. A would answer B's repair, but A is already in the chain's lineage [A, B]: the lineage
 *      rule (`reactionKey`, R86) drops it, and the chain ends.
 *
 * So each Sansi repairs exactly once, and the probe counts one lineage drop. Their per-round cap
 * (3) is not what stops it: neither has come close. Were lineage not enforced, the chain would
 * run until both hit that cap, 3 repairs each, which the exact counts below reject. The
 * single-Sansi control runs the same board without B and shows the probe reads zero drops when
 * there is no cycle, so the drop counted here comes from the mirror and not from anything else on
 * the board.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { reactionChainProbe } from '../triggers';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type ReactiveHeal = Extract<CombatEvent, { type: 'reactive-heal-performed' }>;

function requireReferenceData(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                "this test resolves Sansi's real skill text from it."
        );
    }
}

const PLAYER_SANSI = 'attacker';
const ENEMY_SANSI = 'enemy-sansi';
const ENEMY_HEALER = 'enemy-healer';
const SANSI_HP = 1_000_000;

/** Sansi's on-enemy-repaired self-repair, built from her real second-passive text. Only this
 *  clause is kept: her "when directly damaged" Inc. Repair Down III is another trigger and would
 *  only scale amounts, which this file does not read. */
function sansiRepair(): Ability {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === 'SANSI');
    if (!rec) throw new Error('docs/ship-skills.csv: no record for "Sansi"');
    const passives =
        buildShipAbilities({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({} as any),
            refits: [{}, {}, {}, {}],
            secondPassiveSkillText: rec.passives[1],
        } as Ship).slots.find((s) => s.slot === 'passive')?.abilities ?? [];
    const repair = passives.find(
        (a) => a.trigger === 'on-enemy-repaired' && a.config.type === 'heal'
    );
    if (!repair) throw new Error("Sansi's on-enemy-repaired repair did not build");
    if (repair.maxPerRound !== 3) {
        throw new Error(`Sansi's repair cap built as ${repair.maxPerRound}, expected 3`);
    }
    return repair;
}

const noopActive = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'noop-atk',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
});

const enemy = (id: string, speed: number, slots: ShipSkills['slots']): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: SANSI_HP, speed },
    chargeCount: 0,
    startCharged: false,
    shipSkills: { slots },
});

/** One round. The enemy healer acts first and repairs itself once; both Sansis act after it and
 *  never repair on their own turn. */
function runBoard(opts: { enemySansi: boolean }): ReactiveHeal[] {
    const healer = enemy(ENEMY_HEALER, 1000, [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'healer-self-repair',
                    type: 'heal',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'target-hp' },
                },
            ],
        },
    ]);
    const enemies = opts.enemySansi
        ? [
              healer,
              enemy(ENEMY_SANSI, 1, [
                  noopActive(),
                  { slot: 'passive', abilities: [sansiRepair()] },
              ]),
          ]
        : [healer];
    const bus = createEventBus();
    const repairs: ReactiveHeal[] = [];
    bus.on('reactive-heal-performed', (e) => repairs.push(e));
    runCombat({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [noopActive(), { slot: 'passive', abilities: [sansiRepair()] }] },
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
        hp: SANSI_HP,
        speed: 1,
        healTargetId: PLAYER_SANSI,
        mode: 'healing',
        enemyAttackers: enemies,
        bus,
    });
    return repairs;
}

const by = (repairs: ReactiveHeal[], casterId: string) =>
    repairs.filter((e) => e.casterId === casterId);

describe('Sansi vs Sansi — the repair chain ends by lineage', () => {
    beforeAll(requireReferenceData);
    beforeEach(() => {
        reactionChainProbe.maxDepth = 0;
        reactionChainProbe.dropped = 0;
        reactionChainProbe.lineageDropped = 0;
    });

    it('control: one Sansi answers the healer once, and nothing is dropped', () => {
        const repairs = runBoard({ enemySansi: false });
        expect(by(repairs, PLAYER_SANSI)).toHaveLength(1);
        expect(repairs).toHaveLength(1);
        expect(reactionChainProbe.lineageDropped).toBe(0);
    });

    it('each Sansi repairs exactly once, and the third link is dropped by lineage', () => {
        const repairs = runBoard({ enemySansi: true });
        // The chain ran: A answered the healer, and B answered A.
        expect(by(repairs, PLAYER_SANSI)).toHaveLength(1);
        expect(by(repairs, ENEMY_SANSI)).toHaveLength(1);
        expect(repairs).toHaveLength(2);
        // A's answer to B is the one drop; the depth backstop never fired.
        expect(reactionChainProbe.lineageDropped).toBe(1);
        expect(reactionChainProbe.dropped).toBe(0);
    });
});
