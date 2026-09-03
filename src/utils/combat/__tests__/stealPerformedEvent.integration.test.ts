/**
 * `steal-performed` — the event buff steal shipped without.
 *
 * Buff steal landed in PR10 with NO event at all. That cost two things, and neither was visible
 * until Protection became stealable (#465):
 *
 *  1. THE COMBAT LOG COULD NOT SHOW A STEAL. A player watched a buff vanish off their ship with no
 *     row explaining where it went — and once Protection could be taken, that silent buff was a
 *     defensive stat changing hands mid-fight.
 *  2. THE KIT FINGERPRINTS WERE STRUCTURALLY BLIND TO IT. `fingerprintActor` records the SET of
 *     `CombatLogEntryKind` an actor produced; with no entry ever created, no golden could observe
 *     a steal. Pallas, Thresh and Tithonus have had steal abilities for many releases and not one
 *     fingerprint covered them.
 *
 * So the goldens MOVE with this change, and that movement is the deliverable rather than a cost:
 * every ship that actually steals in its fixture gains a `steal` token it should always have had.
 *
 * ⚠️ THE TRAP THIS FILE EXISTS TO CATCH. `battleSimulator.ts` carries an explicit event
 * SUBSCRIPTION LIST, and its own comment warns that `buildCombatLog` has a handler keyed on the
 * type but the bus only subscribes from that list — so a handler added without a matching entry is
 * DEAD CODE and the row silently never appears. A test that only asserts the bus event would pass
 * with the log still empty. Every assertion here therefore goes through the real
 * `simulateBattle` combat log, not through a hand-attached bus.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import type { Ship } from '../../../types/ship';
import type { CombatLogEntry } from '../log/types';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type StealPerformed = Extract<CombatEvent, { type: 'steal-performed' }>;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `spe${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const HUGE_HP = 1_000_000_000;

const attackUp = (): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        config: {
            type: 'buff',
            buffName: 'Attack Up',
            parsedEffects: { attack: 30 },
            stacks: 1,
            isStackable: false,
            duration: 99,
        },
    });

const protectionAura = (stacks: number): Ability => ({
    id: 'meatshield-protection',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'buff', buffName: 'Protection', parsedEffects: {}, stacks, isStackable: true },
});

const genericSteal = (count = 1): Ability =>
    ab({ type: 'buff-steal', target: 'enemy', config: { type: 'buff-steal', count } });

const topUpSteal = (buffName: string, upToStacks: number): Ability =>
    ab({
        type: 'buff-steal',
        target: 'enemy',
        config: { type: 'buff-steal', count: 0, buffName, upToStacks },
    });

/** An enemy holding `slots` and firing nothing. */
const holder = (slots: ShipSkills['slots'], position: Position = 'M4'): EnemyAttacker => ({
    id: 'holder',
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 300 },
    chargeCount: 0,
    startCharged: false,
    position,
    affinity: 'antimatter',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots },
});

const BASE = (slots: ShipSkills['slots'], enemies: EnemyAttacker[]): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
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
    affinity: 'antimatter',
    defence: 0,
    hp: HUGE_HP,
    hacking: 100_000,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: enemies,
});

/** The `steal-performed` events one run emitted, in order. */
const stealEvents = (input: CombatEngineInput): StealPerformed[] => {
    idc = 0;
    const out: StealPerformed[] = [];
    const bus = createEventBus();
    bus.on('steal-performed', (e) => out.push(e));
    runCombat({ ...input, bus });
    return out;
};

describe('a buff steal emits steal-performed', () => {
    it('CONTROL: a cast with no steal ability emits nothing', () => {
        expect(stealEvents(BASE([{ slot: 'active', abilities: [] }], [holder([])]))).toHaveLength(
            0
        );
    });

    it('names the buff that moved, the source and the recipient', () => {
        const events = stealEvents(
            BASE(
                [{ slot: 'active', abilities: [genericSteal(1)] }],
                [holder([{ slot: 'active', abilities: [attackUp()] }])]
            )
        );

        expect(events).toHaveLength(1);
        expect(events[0].casterId).toBe('attacker');
        expect(events[0].targetId).toBe('holder');
        expect(events[0].recipientIds).toEqual(['attacker']);
        expect(events[0].buffNames).toEqual(['Attack Up']);
    });

    it('is SUPPRESSED when the source has nothing to take — mirrors purge-performed', () => {
        // A holder with no buffs at all. Without the suppression this would open an empty log row
        // announcing a steal that never happened.
        expect(
            stealEvents(BASE([{ slot: 'active', abilities: [genericSteal(1)] }], [holder([])]))
        ).toHaveLength(0);
    });

    it('reports a Protection top-up as one NAME PER STACK', () => {
        // The deficit is 2, so `buffNames` carries 'Protection' twice — that repetition is how the
        // log renders "Protection x2", and it is the only way the event can express a stack count.
        const events = stealEvents(
            BASE(
                [
                    { slot: 'passive', abilities: [protectionAura(1)] },
                    { slot: 'active', abilities: [topUpSteal('Protection', 3)] },
                ],
                [holder([{ slot: 'passive', abilities: [protectionAura(10)] }])]
            )
        );

        expect(events).toHaveLength(1);
        expect(events[0].buffNames).toEqual(['Protection', 'Protection']);
        expect(events[0].targetId).toBe('holder');
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE COMBAT LOG, through the REAL sim path.
//
// `runCombat` does NOT build a combat log — `combatLog` exists only on `simulateBattle`'s
// BattleResult, which is also the only place the event SUBSCRIPTION LIST is applied. A first cut
// of this file asserted against `runCombat(...).combatLog`, which is always undefined, so the
// assertions read an empty array and would have passed with the row genuinely missing. That is the
// same shape of mistake the file's header warns about, arrived at from the other direction.
//
// Ships here are built from SKILL TEXT, so these cases exercise parser → engine → event → log
// handler → subscription end to end.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const place = (ship: Ship, position: Position): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp: 1_000_000,
    },
});

/** A thief whose ACTIVE text is Pallas's clause, verbatim in shape. */
const thiefShip = (): Ship =>
    ({
        id: 'thief',
        name: 'Thief',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        affinity: 'antimatter',
        activeSkillText: 'This Unit steals 1 buff from the primary target.',
        chargeSkillCharge: 0,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as Partial<Ship> as Ship;

/** A holder whose PASSIVE text is Meatshield's Protection grant, verbatim. */
const holderShip = (): Ship =>
    ({
        id: 'holder-ship',
        name: 'Holder',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        affinity: 'antimatter',
        activeSkillText: 'This Unit repairs 5% of its Max HP.',
        firstPassiveSkillText:
            'At the start of combat, this Unit gains 3 stacks of <unit-skill>Protection</unit-skill>.',
        chargeSkillCharge: 0,
        activeTarget: 'allies',
        activePattern: 'Pattern-Base',
    }) as Partial<Ship> as Ship;

describe('the steal reaches the COMBAT LOG (the battleSimulator subscription trap)', () => {
    const stealRows = (): CombatLogEntry[] => {
        const result = simulateBattle({
            playerTeam: [place(thiefShip(), 'M1')],
            enemyTeam: [place(holderShip(), 'M4')],
            rounds: 2,
        });
        return flattenCombatLog(result).filter((e) => e.kind === 'steal');
    };

    it('opens a steal row naming what moved', () => {
        // ⚠️ THE ASSERTION THAT CATCHES THE TRAP. `battleSimulator.ts` subscribes only to the event
        // types in its own list; a `buildCombatLog` handler without a matching entry there is dead
        // code and this row never appears, with no other symptom.
        const rows = stealRows();

        expect(rows.length).toBeGreaterThan(0);
        // Protection is the only thing the holder carries, so that is what moved — one stack.
        expect(rows[0].note).toBe('stole Protection');
    });
});
