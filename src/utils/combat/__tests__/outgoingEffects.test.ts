import { describe, it, expect, vi } from 'vitest';
import { outgoingAmplificationForHit } from '../outgoingEffects';
import { Ability } from '../../../types/abilities';

const amp = (
    id: string,
    condition: 'amplify-on-crit' | 'amplify-vs-higher-attack',
    ampPct: number,
    procChance: number
): Ability => ({
    id,
    type: 'outgoing-amplification',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'outgoing-amplification', condition, ampPct, procChance },
});

const alwaysRoll = () => true;
const neverRoll = () => false;

describe('outgoingAmplificationForHit', () => {
    it('returns 0 when no outgoing-amplification abilities are present', () => {
        expect(
            outgoingAmplificationForHit([], { didCrit: true, targetHigherAttack: true }, alwaysRoll)
        ).toBe(0);
    });

    it('Menace (amplify-on-crit) fires only on crit hits', () => {
        const abilities = [amp('m', 'amplify-on-crit', 30, 0.5)];
        expect(
            outgoingAmplificationForHit(
                abilities,
                { didCrit: true, targetHigherAttack: false },
                alwaysRoll
            )
        ).toBe(30);
        expect(
            outgoingAmplificationForHit(
                abilities,
                { didCrit: false, targetHigherAttack: false },
                alwaysRoll
            )
        ).toBe(0);
    });

    it('Giant Slayer (amplify-vs-higher-attack) fires only when target attack is higher', () => {
        const abilities = [amp('g', 'amplify-vs-higher-attack', 50, 0.5)];
        expect(
            outgoingAmplificationForHit(
                abilities,
                { didCrit: false, targetHigherAttack: true },
                alwaysRoll
            )
        ).toBe(50);
        expect(
            outgoingAmplificationForHit(
                abilities,
                { didCrit: true, targetHigherAttack: false },
                alwaysRoll
            )
        ).toBe(0);
    });

    it('stacks additively when both fire on one hit', () => {
        const abilities = [
            amp('m', 'amplify-on-crit', 30, 0.5),
            amp('g', 'amplify-vs-higher-attack', 50, 0.5),
        ];
        expect(
            outgoingAmplificationForHit(
                abilities,
                { didCrit: true, targetHigherAttack: true },
                alwaysRoll
            )
        ).toBe(80);
    });

    it('returns 0 when the proc gate does not fire', () => {
        const abilities = [amp('m', 'amplify-on-crit', 30, 0.5)];
        expect(
            outgoingAmplificationForHit(
                abilities,
                { didCrit: true, targetHigherAttack: true },
                neverRoll
            )
        ).toBe(0);
    });

    it('advances the proc gate ONLY for eligible abilities (ineligible hit must not consume the gate)', () => {
        const roll = vi.fn(() => true);
        const abilities = [amp('m', 'amplify-on-crit', 30, 0.5)];
        outgoingAmplificationForHit(abilities, { didCrit: false, targetHigherAttack: true }, roll);
        expect(roll).not.toHaveBeenCalled();
        outgoingAmplificationForHit(abilities, { didCrit: true, targetHigherAttack: true }, roll);
        expect(roll).toHaveBeenCalledTimes(1);
        expect(roll).toHaveBeenCalledWith('m', 0.5);
    });
});
