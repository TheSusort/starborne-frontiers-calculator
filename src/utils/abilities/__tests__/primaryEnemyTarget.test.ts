/**
 * `buildShipAbilities` narrows an on-cast enemy clause to `'primary-enemy'` when its own recipient
 * is one named enemy, and leaves every other enemy clause `'enemy'`. Synthetic rows cover the
 * phrasings the corpus does not carry today; `primaryEnemyNarrowingTripwire.test.ts` holds the
 * real corpus.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import type { Ability } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';

const shipWith = (rows: { active?: string; charge?: string; passive?: string }): Ship =>
    ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [],
        activeSkillText: rows.active ?? '',
        chargeSkillText: rows.charge ?? '',
        chargeSkillCharge: 3,
        firstPassiveSkillText: rows.passive ?? '',
    }) as Ship;

const slotAbilities = (ship: Ship, slot: 'active' | 'charged' | 'passive'): Ability[] =>
    buildShipAbilities(ship).slots.find((s) => s.slot === slot)?.abilities ?? [];

const targetOf = (abilities: Ability[], type: Ability['type'], name?: string) => {
    const hit = abilities.find(
        (a) =>
            a.type === type &&
            (name === undefined || ('buffName' in a.config && a.config.buffName === name))
    );
    if (!hit) throw new Error(`no ${type}${name ? ` ${name}` : ''} ability parsed`);
    return hit.target;
};

describe("'primary-enemy' narrowing in buildShipAbilities", () => {
    it('narrows a passive-voice "the primary target is inflicted with" clause only', () => {
        const charged = slotAbilities(
            shipWith({
                charge: 'This Unit deals <unit-damage>220% damage</unit-damage> and inflicts <unit-skill>Attack Down II</unit-skill> and <unit-skill>Out. Damage Down II</unit-skill> for 2 turns. If this Unit has an active shield, the primary target is inflicted with <unit-skill>Disable</unit-skill> for 2 turns.',
            }),
            'charged'
        );
        expect(targetOf(charged, 'debuff', 'Disable')).toBe('primary-enemy');
        expect(targetOf(charged, 'control')).toBe('primary-enemy');
        expect(targetOf(charged, 'debuff', 'Attack Down II')).toBe('enemy');
        expect(targetOf(charged, 'debuff', 'Out. Damage Down II')).toBe('enemy');
    });

    it('reads each verb’s own object in a multi-verb sentence', () => {
        const charged = slotAbilities(
            shipWith({
                charge: 'This Unit <unit-skill>steals 1 buff</unit-skill> from the primary target, granting it to self and all adjacent allies, then <unit-skill>purges 2 buffs</unit-skill> from the enemy and deals <unit-damage>190% damage</unit-damage>.',
            }),
            'charged'
        );
        expect(targetOf(charged, 'buff-steal')).toBe('primary-enemy');
        expect(targetOf(charged, 'purge')).toBe('enemy');
    });

    it('narrows a "from that enemy" object', () => {
        const active = slotAbilities(
            shipWith({
                active: 'This Unit deals <unit-damage>100% damage</unit-damage> and <unit-skill>purges 1 buff</unit-skill> from that enemy.',
            }),
            'active'
        );
        expect(targetOf(active, 'purge')).toBe('primary-enemy');
    });

    it('keeps an anaphoric "that enemy" (the gate picks each enemy) as plain enemy', () => {
        const active = slotAbilities(
            shipWith({
                active: 'This Unit deals <unit-damage>150% damage</unit-damage> and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns. If an enemy has 3 or more <unit-aid>debuffs</unit-aid>, this Unit inflicts <unit-skill>Stasis</unit-skill> for 2 turns on that enemy.',
            }),
            'active'
        );
        expect(targetOf(active, 'debuff', 'Stasis')).toBe('enemy');
    });

    it('keeps "the target" in a condition as plain enemy', () => {
        const active = slotAbilities(
            shipWith({
                active: 'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns and deals <unit-damage>170% damage</unit-damage>. If the target was repaired this round, inflict <unit-skill>Stasis</unit-skill> for 1 turn.',
            }),
            'active'
        );
        expect(targetOf(active, 'debuff', 'Stasis')).toBe('enemy');
        expect(targetOf(active, 'debuff', 'Defense Down II')).toBe('enemy');
    });

    it('never narrows a reactive clause — its "that enemy" is the triggering enemy', () => {
        const passive = slotAbilities(
            shipWith({
                passive:
                    'When an ally is critically hit, this Unit applies <unit-skill>Provoke</unit-skill> for 1 turn to that enemy.',
            }),
            'passive'
        );
        const provoke = passive.find(
            (a) => a.type === 'debuff' && 'buffName' in a.config && a.config.buffName === 'Provoke'
        );
        expect(provoke).toBeDefined();
        expect(provoke!.trigger).not.toBe('on-cast');
        expect(provoke!.target).toBe('enemy');
    });
});
