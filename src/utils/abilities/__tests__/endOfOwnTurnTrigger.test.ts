import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import type { Ship } from '../../../types/ship';
import {
    partitionReactiveAbilities,
    registerReactiveListeners,
    Intent,
} from '../../combat/triggers';
import { createEventBus } from '../../combat/events';

const abilitiesFor = (text: string) =>
    buildShipAbilities({ refits: [], activeSkillText: text } as unknown as Ship).slots.find(
        (s) => s.slot === 'active'
    )?.abilities ?? [];

describe('"at the end of this Unit\'s turn" trigger', () => {
    it('routes the grant onto end-of-turn (Quixilver R2 wording)', () => {
        const abilities = abilitiesFor(
            "At the end of this Unit's turn, this Unit grants all allies <unit-skill>Barrier</unit-skill> for 1 hit."
        );
        const barrier = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Barrier'
        );
        expect(barrier?.trigger).toBe('end-of-turn');
    });

    it('does not confuse it with the end of the ROUND (Rhodium canary)', () => {
        const abilities = abilitiesFor(
            'At the end of the round, this Unit grants all allies <unit-skill>Barrier</unit-skill> for 1 hit.'
        );
        const barrier = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Barrier'
        );
        expect(barrier?.trigger).not.toBe('end-of-turn');
    });

    it('accepts the curly apostrophe the CSV also uses ("Unit’s turn")', () => {
        const abilities = abilitiesFor(
            'At the end of this Unit’s turn, this Unit grants all allies <unit-skill>Barrier</unit-skill> for 1 hit.'
        );
        const barrier = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Barrier'
        );
        expect(barrier?.trigger).toBe('end-of-turn');
    });

    // Load-bearing consequence (not just a trigger label): Quixilver grants this Barrier from a
    // PASSIVE slot. A passive-slot buff with the default `on-cast` trigger is only ever applied
    // once, at combat start, by engine.ts's seedPassiveTimedStatuses — which the engine calls
    // exclusively under `if (r === 1)` (round-1 window). Once the hit-counted Barrier charge is
    // spent, an on-cast passive would NEVER re-grant it for the rest of the fight. Routing onto
    // `end-of-turn` fixes this two ways, both asserted below:
    //   1. partitionReactiveAbilities excludes it from `castSkills` (the collection
    //      registerActorAbilityStatuses/seedPassiveTimedStatuses walk) — it is no longer eligible
    //      for the round-1-only seed at all.
    //   2. the reactive listener it registers instead (triggers.ts's `turn-ended` case) re-fires
    //      on EVERY one of the owner's turns, not just round 1 — proven here by emitting
    //      `turn-ended` for round 1 AND round 2 and getting two separate enqueues.
    describe('passive-slot routing consequence (round-1 seeding vs. reactive re-fire)', () => {
        // Refits >= 4 unlock the R4 passive row (thirdPassiveSkillText) — see
        // src/utils/ship/skillRows.ts's getShipSkillRows. This is a SYNTHETIC fixture exercising
        // the R4-row-resolution path itself, not Quixilver's real kit: Quixilver's actual Barrier
        // grant lives in second_passive_skill_text (the R2 passive, docs/ship-skills.csv) — its
        // third_passive_skill_text is the literal string "null". The passive-slot routing being
        // tested here (castSkills exclusion + reactive re-fire) is identical regardless of which
        // refit tier the text lands in, so putting it at R4 here just proves the fix isn't
        // R2-specific. barrierRechargingTarget.test.ts's `r2PassiveAbilities` exercises the real
        // R2 column against the actual CSV text.
        const quixilverShipSkills = () =>
            buildShipAbilities({
                refits: [1, 2, 3, 4],
                thirdPassiveSkillText:
                    "At the end of this Unit's turn if it has shield equal to 100% of its max HP, this Unit grants all allies <unit-skill>Barrier</unit-skill> for 1 hit and applies <unit-skill>Barrier Recharging</unit-skill> for 3 turns.",
            } as unknown as Ship);

        it('excludes the passive Barrier grant from castSkills (not eligible for round-1-only seeding)', () => {
            const { castSkills, reactiveAbilities } =
                partitionReactiveAbilities(quixilverShipSkills());
            const castBarrier = castSkills.slots
                .flatMap((s) => s.abilities)
                .find((a) => a.config.type === 'buff' && a.config.buffName === 'Barrier');
            expect(castBarrier).toBeUndefined();

            const reactiveBarrier = reactiveAbilities.find(
                (r) => r.ability.config.type === 'buff' && r.ability.config.buffName === 'Barrier'
            );
            expect(reactiveBarrier?.ability.trigger).toBe('end-of-turn');
            expect(reactiveBarrier?.sourceSlot).toBe('passive');
        });

        it('re-fires on a LATER turn, not just round 1 (genuine end-to-end proof of the fix)', () => {
            const { reactiveAbilities } = partitionReactiveAbilities(quixilverShipSkills());
            const bus = createEventBus();
            const barrierIntents: Intent[] = [];
            registerReactiveListeners({
                bus,
                perOwner: [{ ownerId: 'quixilver', reactiveAbilities }],
                // The clause also carries the co-located "applies Barrier Recharging for 3 turns"
                // debuff, which rides the same end-of-turn trigger — filter down to the Barrier
                // buff grant specifically so this assertion isn't diluted by that sibling ability.
                enqueue: (intent) => {
                    if (
                        intent.ability.config.type === 'buff' &&
                        intent.ability.config.buffName === 'Barrier'
                    ) {
                        barrierIntents.push(intent);
                    }
                },
                isOpposing: (id) => id === 'enemy',
            });

            // Round 1's own-turn end: seedPassiveTimedStatuses' round === 1 window is exactly
            // where an on-cast passive would ALSO have fired once, so a single enqueue here alone
            // would not distinguish the two mechanisms. The round-2 emit is what proves this
            // ability is on the reactive path — an on-cast passive would never see it.
            bus.emit({ type: 'turn-ended', actorId: 'quixilver', round: 1 });
            bus.emit({ type: 'turn-ended', actorId: 'quixilver', round: 2 });

            expect(barrierIntents).toHaveLength(2);
        });
    });
});
