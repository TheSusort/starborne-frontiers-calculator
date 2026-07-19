/**
 * wave8MeiyingKillGate.integration.test.ts — Ship-kit Wave 8 Task 13 (Meiying).
 *
 * Meiying's first passive (docs/ship-skills.csv, verbatim): "Upon killing an enemy with a
 * Debuff, this Unit inflicts Stasis on all adjacent enemies for 1 turn." The target scope
 * (adjacent-enemies) and trigger (on-enemy-destroyed) shipped in Wave 5/parsed generically; this
 * task closes the KILL-GATE — the kill must land on a DEBUFFED enemy — and (as a necessary
 * engine seam this gate rides on) wires the REACTIVE `debuff`-type executor's adjacent-enemies
 * fan-out, which no prior ship exercised (Wave 5's adjacency work covered the ON-CAST fan-out in
 * playerTurn.ts and the reactive `damage` executor's bomb-splash branch; Meiying's Stasis-on-kill
 * is the first reactive DEBUFF consumer of `adjacent-enemies`).
 *
 * Harness: mirrors demolisherBombSplash.integration.test.ts's raw `runCombat` + positional
 * `enemyAttackers` board layout (bomb lands on 'tgt' at M4; nbrA/M3 and nbrB/T3 are real
 * neighbours, far/T1 is not) and wave8ZeolitePurge.integration.test.ts's "real production-parsed
 * passive + hand-built active" composition idiom. The kill-gate debuff is seeded via a
 * guaranteed-landing (`application:'apply'`) on-cast debuff ability placed BEFORE the lethal hit
 * in the SAME active slot (playerTurn.ts processes a slot's abilities array in order), isolating
 * the gate from hacking-vs-security landing RNG.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { Ship } from '../../../types/ship';
import { createEventBus, CombatEvent } from '../events';

// Verbatim docs/ship-skills.csv Meiying first_passive_skill_text.
const MEIYING_STASIS_ON_KILL =
    'Upon killing an enemy with a Debuff, this Unit inflicts <unit-skill>Stasis</unit-skill> on all adjacent enemies for 1 turn.';

// The REAL parsed Stasis-on-kill passive slot (adjacent-enemies target, on-enemy-destroyed
// trigger, killed-enemy-had-debuff condition — see wave8Meiying.test.ts for parser coverage).
const meiyingPassiveSlot = (): ShipSkills['slots'][number] => {
    const ship = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        firstPassiveSkillText: MEIYING_STASIS_ON_KILL,
    } as Ship;
    const built = buildShipAbilities(ship);
    const passive = built.slots.find((s) => s.slot === 'passive');
    if (!passive) throw new Error('Meiying passive slot missing from buildShipAbilities output');
    return passive;
};

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `w8mk${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// Guaranteed-landing debuff (bypasses hacking-vs-security RNG) seeded onto the front target.
const debuffFrontTarget = (): Ability =>
    ab({
        type: 'debuff',
        config: {
            type: 'debuff',
            buffName: 'Defense Down',
            parsedEffects: { defense: -10 },
            stacks: 1,
            isStackable: false,
            application: 'apply',
            duration: 5,
        },
    });

// A lethal hit against the front target (huge multiplier vs a low-HP victim, zero defence).
const lethalHit = (): Ability =>
    ab({ type: 'damage', config: { type: 'damage', multiplier: 100_000 } });

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

// Caster kit: the real Meiying passive + a hand-built active that kills the front target, WITH
// or WITHOUT first seeding it a debuff.
const casterSkills = (killsDebuffedVictim: boolean): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: killsDebuffedVictim ? [debuffFrontTarget(), lethalHit()] : [lethalHit()],
        },
        meiyingPassiveSlot(),
    ],
});

// Every 'debuff-applied' Stasis recipient across the whole run.
const stasisRecipients = (input: CombatEngineInput): string[] => {
    const bus = createEventBus();
    const applied: string[] = [];
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.buffName === 'Stasis') applied.push(e.targetId);
    });
    runCombat({ ...input, bus });
    return applied;
};

describe('Ship-kit W8 Task 13: Meiying Stasis-on-kill — player-side caster', () => {
    // The focus 'attacker' (Meiying) at M4, targeting 'front'. Enemy roster: 'tgt' at M4 (the
    // victim, low HP — dies to the lethal hit), 'nbrA'/M3 and 'nbrB'/T3 (real board neighbours of
    // M4), 'far'/T1 (not a neighbour).
    const BASE = (
        shipSkills: ShipSkills,
        overrides: Partial<CombatEngineInput> = {}
    ): CombatEngineInput => ({
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills,
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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
        hp: 1_000_000_000,
        healTargetId: 'attacker',
        position: 'M4',
        target: frontTarget(),
        pattern: basePattern(),
        enemyAttackers: [
            enemyAt('tgt', 'M4', 100),
            enemyAt('nbrA', 'M3', 1_000_000_000),
            enemyAt('nbrB', 'T3', 1_000_000_000),
            enemyAt('far', 'T1', 1_000_000_000),
        ],
        ...overrides,
    });

    it('killing a DEBUFFED enemy inflicts Stasis on its board-neighbours (not the corpse, not a non-neighbour)', () => {
        const recipients = stasisRecipients(BASE(casterSkills(true)));
        expect(recipients).toContain('nbrA');
        expect(recipients).toContain('nbrB');
        expect(recipients).not.toContain('tgt');
        expect(recipients).not.toContain('far');
    });

    it('CONTROL: killing a NON-debuffed enemy inflicts NO Stasis at all (the gate blocks it)', () => {
        const recipients = stasisRecipients(BASE(casterSkills(false)));
        expect(recipients).toHaveLength(0);
    });
});

describe('Ship-kit W8 Task 13: team symmetry — an enemy-side Meiying gates identically', () => {
    // Mirror roster: the killed victim is the focus 'attacker' (player side, M4); its neighbours
    // are PLAYER-side walked team actors. The Meiying caster moves to enemyAttackers, carrying
    // the same active(debuff?+lethal) + real passive kit, targeting 'front' (the focus at M4).
    const teamNeighbour = (id: string, position: Position, hp: number): TeamActorEngineInput =>
        ({
            id,
            speed: 1,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position,
            walk: {
                shipSkills: { slots: [] } as ShipSkills,
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    defence: 0,
                    hp,
                    hacking: 0,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        }) as TeamActorEngineInput;

    const enemyMeiying = (killsDebuffedVictim: boolean): EnemyAttacker =>
        ({
            id: 'meiying-enemy',
            stats: {
                attack: 100_000,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 100,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4' as Position,
            target: frontTarget(),
            pattern: basePattern(),
            shipSkills: casterSkills(killsDebuffedVictim),
        }) as EnemyAttacker;

    const BASE = (killsDebuffedVictim: boolean): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] } as ShipSkills,
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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
        hp: 100, // low HP — the focus is the victim, dies to the enemy Meiying's lethal hit
        healTargetId: 'attacker',
        position: 'M4',
        teamActors: [
            teamNeighbour('nbrA', 'M3', 1_000_000_000),
            teamNeighbour('nbrB', 'T3', 1_000_000_000),
            teamNeighbour('far', 'T1', 1_000_000_000),
        ],
        enemyAttackers: [enemyMeiying(killsDebuffedVictim)],
    });

    it('an enemy-side Meiying killing a DEBUFFED player focus inflicts Stasis on its neighbours', () => {
        const recipients = stasisRecipients(BASE(true));
        expect(recipients).toContain('nbrA');
        expect(recipients).toContain('nbrB');
        expect(recipients).not.toContain('attacker');
        expect(recipients).not.toContain('far');
    });

    it('CONTROL: an enemy-side Meiying killing a NON-debuffed player focus inflicts NO Stasis', () => {
        const recipients = stasisRecipients(BASE(false));
        expect(recipients).toHaveLength(0);
    });
});
