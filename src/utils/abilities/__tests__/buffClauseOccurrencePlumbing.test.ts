/**
 * #438, layer 2: the occurrence index reaches `buildShipAbilities`' clause detectors.
 *
 * Fixing the resolver alone is not enough. `detectGrantConditions`, `detectGrantFactionScope`,
 * `detectGrantRecipientFilter` and the three trigger detectors are all called from the ability
 * builder with `buff.buffName` and no ordinal, so a second-sentence grant would have kept reading
 * sentence ONE's condition, faction, filter and trigger even after the scope axis was fixed —
 * mixed reads, which is worse than a uniform first-match. The index therefore rides the
 * `SelectedGameBuff` (`skillOccurrenceIndex`) from the parse through the autofill dedupe.
 *
 * WHY THESE FIXTURES ARE NOT VACUOUS. Reverting the resolver's occurrence-awareness collapses each
 * case below to a SINGLE `self` ability: the second grant's target is misread as `self`, which
 * makes it collide with the first on the autofill dedupe key (name|target|source) and vanish
 * entirely. So the assertions do not merely check a field — they fail loudly, on ability COUNT,
 * the moment the plumbing stops working. Verified by mutation, 2026-09-01.
 *
 * No corpus ship is written this way (see `buffClauseSentenceSplit.test.ts` — the corpus census is
 * empty and guarded), so these are synthetic by necessity: the plumbing has no corpus reachability
 * and would otherwise ship unexercised.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import type { Ship } from '../../../types/ship';
import type { Ability } from '../../../types/abilities';

/** A bare ship carrying `passive` in its first passive slot and nothing else. */
function buffAbilities(passive: string): Ability[] {
    const bundle = buildShipAbilities({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        activeSkillText: '',
        chargeSkillText: '',
        chargeSkillCharge: 0,
        firstPassiveSkillText: passive,
        secondPassiveSkillText: '',
        thirdPassiveSkillText: '',
    } as Ship);
    return bundle.slots.flatMap((s) => s.abilities).filter((a) => a.config.type === 'buff');
}

describe('a second-sentence grant reads its own clause, not the first sentence (#438)', () => {
    it('takes its condition and trigger from the sentence that grants it', () => {
        // Sentence one gates on an enemy type and rides the cast; sentence two rides a crit and
        // carries no condition. Pre-fix, the all-allies grant inherited BOTH of sentence one's
        // answers — and, colliding on the dedupe key, was never emitted at all.
        const abilities = buffAbilities(
            'When targeting a Defender, this Unit grants itself ' +
                '<unit-skill>Attack Up III</unit-skill> for 2 turns. ' +
                'When this Unit critically hits, this Unit grants all allies ' +
                '<unit-skill>Attack Up III</unit-skill> for 2 turns.'
        );

        expect(abilities).toHaveLength(2);

        const self = abilities.find((a) => a.target === 'self');
        const team = abilities.find((a) => a.target === 'all-allies');
        expect(self).toBeDefined();
        expect(team).toBeDefined();

        expect(self!.trigger).toBe('on-cast');
        expect(self!.conditions).toEqual([
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
        ]);

        expect(team!.trigger).toBe('on-crit');
        expect(team!.conditions ?? []).toEqual([]);
    });

    it('takes its recipient faction from the sentence that grants it', () => {
        // Fuying's real shape, split across two sentences: the caster's own grant has no faction
        // scope, the team grant is Tianchen-only. Pre-fix neither carried one, because sentence
        // one names no faction and both grants read sentence one.
        const abilities = buffAbilities(
            'This Unit grants itself <unit-skill>Stealth</unit-skill> for 2 turns. ' +
                'This Unit grants Tianchen allies <unit-skill>Stealth</unit-skill> for 1 turn.'
        );

        expect(abilities).toHaveLength(2);

        const self = abilities.find((a) => a.target === 'self');
        const team = abilities.find((a) => a.target === 'all-allies');
        expect(self?.factionFilter).toBeUndefined();
        expect(team?.factionFilter).toEqual(['TIANCHAO']);
    });
});
