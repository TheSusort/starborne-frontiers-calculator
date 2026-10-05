import { describe, it, expect, beforeAll } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

// Reference data is gitignored, so a fresh worktree can be missing it. Throw rather than skip:
// a silently-skipped gate is indistinguishable from a passing one and there is no CI test job.
function requireReferenceData(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                'this test resolves real ship skill text from it.'
        );
    }
}

function shipFromCsv(name: string): Ship {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record for "${name}"`);
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
    } as Ship;
}

// Owner ruling 2026-08-30, posed as an in-fight example: Tormenter casts its active with one ally
// directly above, one directly below, and a fourth ally on the far flank. Only Tormenter and the
// two adjacent allies come away with the Out. Damage Up I icon — the far ally gets nothing.
//
// The receiver phrase is "grants Out. Damage Up I to itself and all adjacent allies", i.e. TWO
// disjoint recipient sets. `adjacentAllyIds` excludes the owner, so neither existing scope alone
// covers it: 'adjacent-allies' would drop Tormenter itself, 'all-allies' (the pre-fix routing)
// reaches the far ally. It resolves as a PAIR of abilities, the same shape Centurion's charge
// already produces for its dual-scoped Core Charge I grant.
describe('"itself and all adjacent allies" receiver — Tormenter', () => {
    beforeAll(requireReferenceData);

    it('grants Out. Damage Up I to BOTH self and adjacent-allies, and to nobody else', () => {
        const abilities = buildShipAbilities(shipFromCsv('Tormenter'));
        const activeSlot = abilities.slots.find((s) => s.slot === 'active');
        const grants = (activeSlot?.abilities ?? []).filter(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Out. Damage Up I'
        );
        // The pair lives on the ACTIVE slot and nowhere else.
        expect(
            abilities.slots
                .filter((s) => s.slot !== 'active')
                .flatMap((s) => s.abilities)
                .filter((a) => a.config.type === 'buff' && a.config.buffName === 'Out. Damage Up I')
        ).toEqual([]);

        expect(grants.map((a) => a.target).sort()).toEqual(['adjacent-allies', 'self']);
        // Both halves carry the SAME payload — one grant split by recipient set, not two effects.
        for (const g of grants) {
            expect(g.trigger).toBe('on-cast');
            if (g.config.type !== 'buff') throw new Error('expected buff config');
            expect(g.config.duration).toBe(1);
            expect(g.config.parsedEffects).toEqual({ outgoingDamage: 15 });
        }
    });

    // Guard the two neighbouring routings the fix must not disturb: an adjacency-ONLY receiver
    // stays a single 'adjacent-allies' ability (Lionheart), and a receiver naming "itself" ALONE
    // stays a single 'self' ability — the pair is specific to the combined phrasing.
    it('Lionheart’s adjacency-only receiver still emits a single adjacent-allies grant', () => {
        const abilities = buildShipAbilities(shipFromCsv('Lionheart'));
        const grants = abilities.slots
            .flatMap((s) => s.abilities)
            .filter((a) => a.config.type === 'buff' && a.config.buffName === 'Attack Up II');
        expect(grants.map((a) => a.target)).toEqual(['adjacent-allies']);
    });
});

// Owner rulings R60/R62 (2026-10-05): Lionheart's active "deals 170% damage and grants Defense Up
// II for 2 turns" names no recipient, and the game sends it to Lionheart and his adjacent allies.
// A receiver-less grant in a clause that deals damage resolves to the same self + adjacent pair as
// Tormenter's explicit receiver.
describe('receiver-less grant in a damage clause — Lionheart', () => {
    beforeAll(requireReferenceData);

    it('Defense Up II goes to self and adjacent-allies, never all-allies', () => {
        const abilities = buildShipAbilities(shipFromCsv('Lionheart'));
        const grants = abilities.slots
            .flatMap((s) => s.abilities)
            .filter((a) => a.config.type === 'buff' && a.config.buffName === 'Defense Up II');
        expect(grants.map((a) => a.target).sort()).toEqual(['adjacent-allies', 'self']);
    });

    it('negative: a receiver-less grant on a pure-support cast stays all-allies (Cultivator)', () => {
        const abilities = buildShipAbilities(shipFromCsv('Cultivator'));
        const grants = abilities.slots
            .flatMap((s) => s.abilities)
            .filter((a) => a.config.type === 'buff' && a.config.buffName === 'Defense Up III');
        expect(grants.map((a) => a.target)).toEqual(['all-allies']);
    });

    it('tripwire: every self + adjacent-allies grant pair in the corpus', () => {
        // A ship arriving here is a new receiver the engine now sends to self and neighbours —
        // read its text before extending the list.
        const pairs: string[] = [];
        for (const rec of loadShipSkillRecords()) {
            for (const slot of buildShipAbilities(shipFromCsv(rec.name)).slots) {
                const byName = new Map<string, Set<string>>();
                for (const a of slot.abilities) {
                    if (a.config.type !== 'buff') continue;
                    const set = byName.get(a.config.buffName) ?? new Set<string>();
                    set.add(a.target);
                    byName.set(a.config.buffName, set);
                }
                for (const [name, targets] of byName)
                    if (targets.has('self') && targets.has('adjacent-allies'))
                        pairs.push(`${rec.name}:${slot.slot}:${name}`);
            }
        }
        expect(pairs.sort()).toEqual([
            'Centurion:charged:Core Charge I',
            'Lionheart:active:Defense Up II',
            'Tormenter:active:Out. Damage Up I',
        ]);
    });
});
