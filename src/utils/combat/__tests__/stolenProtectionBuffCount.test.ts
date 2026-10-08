/**
 * A stolen Protection stack is a buff on the thief and one buff fewer on the victim, in EVERY buff
 * COUNT. The ledger a steal writes is the only place a thief's acquired stack lives, so a count
 * that reads the stores alone cannot see it.
 */
import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import { actorBuffCount, buildActorConditionContext, selfBuffStacksForOwner } from '../triggers';

const newEngine = () => createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });

const selfBuffCountOf = (eng: ReturnType<typeof newEngine>, id: string): number | undefined =>
    buildActorConditionContext(eng, id, {
        corrosionStacks: 0,
        infernoStacks: 0,
        bombStacks: 0,
        includeAbilitySelfNames: true,
    }).selfBuffCount;

describe('stolen Protection counts as a buff (R37)', () => {
    it('a thief holding only a stolen stack has 1 buff on both counting paths', () => {
        const eng = newEngine();
        eng.adjustSelfBuffStacks('thief', 'Protection', 1);

        expect(selfBuffStacksForOwner(eng, 'thief', 'Protection')).toBe(1);
        expect(actorBuffCount(eng, 'thief')).toBe(1);
        expect(selfBuffCountOf(eng, 'thief')).toBe(1);
    });

    it('both count paths agree for the thief however many stacks it holds', () => {
        const eng = newEngine();
        eng.adjustSelfBuffStacks('thief', 'Protection', 3);

        expect(actorBuffCount(eng, 'thief')).toBe(3);
        expect(selfBuffCountOf(eng, 'thief')).toBe(actorBuffCount(eng, 'thief'));
    });

    it('NEGATIVE: an owner with no stolen stack and no buff has 0 buffs', () => {
        const eng = newEngine();
        eng.adjustSelfBuffStacks('thief', 'Protection', 1);

        expect(actorBuffCount(eng, 'bystander')).toBe(0);
        expect(selfBuffCountOf(eng, 'bystander')).toBe(0);
    });

    it('NEGATIVE: a victim delta below what it holds clamps at 0, never negative', () => {
        const eng = newEngine();
        eng.adjustSelfBuffStacks('victim', 'Protection', -1);

        expect(actorBuffCount(eng, 'victim')).toBe(0);
        expect(selfBuffCountOf(eng, 'victim')).toBe(0);
    });
});
