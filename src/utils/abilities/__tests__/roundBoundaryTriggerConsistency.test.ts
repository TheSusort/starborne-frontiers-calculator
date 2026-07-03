/**
 * Epic PR4 (round-boundary / start-of-combat trigger consistency).
 *
 * Same phrasing must map to the same trigger corpus-wide:
 *   - "At the start of the round …" → 'start-of-round' (buffs already did this via the
 *     pre-existing detectReactiveTrigger branch; this PR extends it to damage/heal abilities
 *     and to abilities that inherit the trigger from an immediately preceding sentence).
 *   - "At the end of the round …" → 'end-of-round' (damage, mirroring the existing purge path).
 *   - "At the start of combat, this Unit gains …" one-time grants → 'pre-combat' (buffs AND
 *     shields), not 'on-cast' (which would re-grant on every skill use).
 *
 * Every clause below is copied VERBATIM from docs/ship-skills.csv (the parser's source of
 * truth) and routed through the REAL production path (buildShipAbilities), per the epic's
 * verification protocol: findings are unverified until a red test fails through production
 * routing, not an isolated regex/dump.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ability, Skill } from '../../../types/abilities';
import { Ship } from '../../../types/ship';

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

function passiveAbilities(over: Partial<Ship>): Ability[] {
    return slot(buildShipAbilities(ship(over)).slots, 'passive')?.abilities ?? [];
}

function findBuff(abilities: Ability[], buffName: string): Ability | undefined {
    return abilities.find((a) => a.config.type === 'buff' && a.config.buffName === buffName);
}

// ─── "At the start of the round …" → start-of-round ────────────────────────────────────────

describe('Judge: start-of-round AoE execute damage (docs/ship-skills.csv passive1/2)', () => {
    const JUDGE_TEXT =
        'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> ' +
        'effects and has <unit-damage>20% defense penetration</unit-damage><br /><br />At the ' +
        'start of the round, this Unit deals <unit-damage>60% damage</unit-damage> to all ' +
        'enemies with less than 50% HP.';

    it('passive1: the 60% AoE damage ability rides start-of-round, not on-cast', () => {
        const abilities = passiveAbilities({ firstPassiveSkillText: JUDGE_TEXT });
        const dmg = abilities.find((a) => a.type === 'damage')!;
        expect(dmg).toBeDefined();
        expect(dmg.trigger).toBe('start-of-round');
        expect(dmg.target).toBe('enemy');
        if (dmg.config.type === 'damage') expect(dmg.config.multiplier).toBe(60);
        // The hp-threshold condition (below 50%) survives the trigger fix untouched.
        expect(dmg.conditions).toContainEqual(
            expect.objectContaining({
                subject: 'hp-threshold',
                hpComparator: 'below',
                hpPercent: 50,
            })
        );
        // The co-located defense-penetration modifier (different sentence) is unaffected.
        const modifier = abilities.find((a) => a.type === 'modifier')!;
        expect(modifier.trigger).toBe('on-cast');
    });

    it('passive2 (stage-2 duplicate + extra sentence): same fix applies', () => {
        const abilities = passiveAbilities({
            refits: [{}, {}],
            firstPassiveSkillText: 'placeholder',
            secondPassiveSkillText:
                JUDGE_TEXT +
                '<br /><br />This Unit deals <unit-damage>20% more direct damage</unit-damage> ' +
                'for each destroyed enemy, up to max of 100%.',
        } as Partial<Ship>);
        const dmg = abilities.find((a) => a.type === 'damage')!;
        expect(dmg.trigger).toBe('start-of-round');
    });
});

describe('Chimei: start-of-round Stealth-gated heal (docs/ship-skills.csv passive1/2)', () => {
    const CHIMEI_TEXT =
        'At the end of the round, non-defender allies below 40% HP are granted ' +
        '<unit-skill>Stealth</unit-skill> for 1 turn. <br /><br />At the start of the round, ' +
        'all allies with <unit-skill>Stealth</unit-skill> <unit-damage>repairs 10%</unit-damage> ' +
        "of this unit's max HP.<br /><br />When over-repairing a damaged ally, the ally with " +
        'the lowest current health percentage repairs an amount equivalent to the over-repair.';

    it('the 10%-max-HP heal rides start-of-round, not on-cast', () => {
        const abilities = passiveAbilities({ firstPassiveSkillText: CHIMEI_TEXT });
        const heal = abilities.find((a) => a.type === 'heal')!;
        expect(heal).toBeDefined();
        expect(heal.trigger).toBe('start-of-round');
        if (heal.config.type === 'heal') expect(heal.config.pct).toBe(10);
    });
});

describe('Incinerator: end-of-round Inferno-execute damage (docs/ship-skills.csv passive1/2)', () => {
    const INCINERATOR_TEXT =
        'At the end of the round, this unit deals <unit-damage>100% damage</unit-damage> to ' +
        'all enemies with <unit-skill>Inferno</unit-skill>.';

    it('the 100% damage ability rides end-of-round, not on-cast', () => {
        const abilities = passiveAbilities({ firstPassiveSkillText: INCINERATOR_TEXT });
        const dmg = abilities.find((a) => a.type === 'damage')!;
        expect(dmg).toBeDefined();
        expect(dmg.trigger).toBe('end-of-round');
        if (dmg.config.type === 'damage') expect(dmg.config.multiplier).toBe(100);
    });
});

describe('Chakara: round-start-continuation damage inherits its preceding sentence trigger', () => {
    it('passive1 (own-sentence round-start buff): already correct at baseline — start-of-round', () => {
        const abilities = passiveAbilities({
            firstPassiveSkillText:
                'At the start of the round, if this Unit has the lowest Speed among all allies, ' +
                'it gains <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> ' +
                'for 1 turn.',
        });
        const atk = findBuff(abilities, 'Attack Up II')!;
        expect(atk.trigger).toBe('start-of-round');
    });

    it('passive2: "Then, deals 60% damage …" (no round-start phrase of its own) inherits start-of-round from the preceding "starts each round with" sentence', () => {
        const abilities = passiveAbilities({
            refits: [{}, {}],
            firstPassiveSkillText: 'placeholder',
            secondPassiveSkillText:
                'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and ' +
                '<unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed ' +
                'among all Allies. Then, deals <unit-damage>60% damage</unit-damage> to the ' +
                'highest Speed Enemy.',
        } as Partial<Ship>);
        const atk = findBuff(abilities, 'Attack Up II')!;
        expect(atk.trigger).toBe('start-of-round'); // pre-existing (STARTS_ROUND_WITH_RE), unaffected
        const dmg = abilities.find((a) => a.type === 'damage')!;
        expect(dmg).toBeDefined();
        expect(dmg.trigger).toBe('start-of-round');
        if (dmg.config.type === 'damage') expect(dmg.config.multiplier).toBe(60);
    });
});

describe('Rhodium: end-of-round co-located purge + damage (docs/ship-skills.csv passive2)', () => {
    it('the 80%-no-crit damage rides end-of-round, alongside the already-correct purge', () => {
        const abilities = passiveAbilities({
            refits: [{}, {}],
            firstPassiveSkillText: 'placeholder',
            secondPassiveSkillText:
                'At the end of the round, this Unit <unit-aid>purges 2</unit-aid> buffs from ' +
                'the enemy with the most buffs and deals <unit-damage>80% damage</unit-damage> ' +
                'that cannot critically hit.',
        } as Partial<Ship>);
        const purge = abilities.find((a) => a.type === 'purge')!;
        expect(purge.trigger).toBe('end-of-round'); // pre-existing, unaffected
        const dmg = abilities.find((a) => a.type === 'damage')!;
        expect(dmg).toBeDefined();
        expect(dmg.trigger).toBe('end-of-round');
        if (dmg.config.type === 'damage') {
            expect(dmg.config.multiplier).toBe(80);
            expect(dmg.config.noCrit).toBe(true);
        }
    });
});

describe('Nayra / Isha: split-sentence "also gains" continuation inherits the round-start trigger', () => {
    it('Nayra passive1 (same-sentence "and if … it also gains"): BOTH grants are start-of-round', () => {
        const abilities = passiveAbilities({
            firstPassiveSkillText:
                'This Unit gains <unit-skill>Defensive Affinity Override</unit-skill> at the ' +
                'start of the round, and if Isha is on the same team, it also gains ' +
                '<unit-skill>Offensive Affinity Override</unit-skill>.',
        });
        expect(findBuff(abilities, 'Defensive Affinity Override')!.trigger).toBe('start-of-round');
        expect(findBuff(abilities, 'Offensive Affinity Override')!.trigger).toBe('start-of-round');
    });

    it('Nayra passive2 (split sentences via <br/>): the own-sentence grant AND the "also gains" continuation are both start-of-round', () => {
        const abilities = passiveAbilities({
            refits: [{}, {}],
            firstPassiveSkillText: 'placeholder',
            secondPassiveSkillText:
                'At the start of the round, this Unit gains ' +
                '<unit-skill>Defensive Affinity Override</unit-skill>.<br />If Isha is on the ' +
                'same team, this Unit also gains <unit-skill>Offensive Affinity Override</unit-skill>.' +
                '<br />When directly damaged, this Unit gains <unit-skill>Terran Bolster III</unit-skill> ' +
                'for 1 turn. Additionall, when an enemy performs a repair, this Unit inflicts ' +
                '<unit-skill>Out. Repair Down II</unit-skill> on them for 1 turn.',
        } as Partial<Ship>);
        expect(findBuff(abilities, 'Defensive Affinity Override')!.trigger).toBe('start-of-round');
        expect(findBuff(abilities, 'Offensive Affinity Override')!.trigger).toBe('start-of-round');
        // Unrelated reactive grants in the same passive are untouched.
        expect(findBuff(abilities, 'Terran Bolster III')!.trigger).toBe('on-attacked');
    });

    it('Isha passive1 (split sentences, "it also gains" continuation): BOTH grants are start-of-round', () => {
        const abilities = passiveAbilities({
            firstPassiveSkillText:
                'At the start of the round this Unit gains ' +
                '<unit-skill>Offensive Affinity Override</unit-skill>.<br />If Nayra is on the ' +
                'same team, it also gains <unit-skill>Defensive Affinity Override</unit-skill>.',
        });
        expect(findBuff(abilities, 'Offensive Affinity Override')!.trigger).toBe('start-of-round');
        expect(findBuff(abilities, 'Defensive Affinity Override')!.trigger).toBe('start-of-round');
    });
});

describe("Cobalt: start-of-turn buff shares its sibling charge ability's trigger", () => {
    it('passive2: the Out. Damage Up II buff rides start-of-turn, not on-cast', () => {
        const abilities = passiveAbilities({
            refits: [{}, {}],
            firstPassiveSkillText: 'placeholder',
            secondPassiveSkillText:
                'This Unit <unit-aid>adds 1 charge</unit-aid> to its charged skill and gains ' +
                '<unit-skill>Out. Damage Up II</unit-skill> for 1 turn at the start of the turn ' +
                'if it is at full HP.',
        } as Partial<Ship>);
        const buff = findBuff(abilities, 'Out. Damage Up II')!;
        expect(buff).toBeDefined();
        expect(buff.trigger).toBe('start-of-turn');
        const charge = abilities.find((a) => a.type === 'charge')!;
        expect(charge.trigger).toBe('start-of-turn'); // pre-existing, unaffected
    });
});

// ─── "At the start of combat, this Unit gains …" one-time grants → pre-combat ──────────────

describe('Crucialis: start-of-combat shield AND buff (docs/ship-skills.csv passive1)', () => {
    const CRUCIALIS_TEXT =
        'At the start of combat, this Unit gains a <unit-damage>Shield equal to 20%</unit-damage> ' +
        'of its Max HP and gains <unit-skill>Atlas Coordination I</unit-skill> for 6 turns.' +
        '<br />This Unit has 20% Shield Penetration.';

    it('the shield rides pre-combat, not on-cast', () => {
        const abilities = passiveAbilities({ firstPassiveSkillText: CRUCIALIS_TEXT });
        const shield = abilities.find((a) => a.type === 'shield')!;
        expect(shield).toBeDefined();
        expect(shield.trigger).toBe('pre-combat');
        if (shield.config.type === 'shield') {
            expect(shield.config.pct).toBe(20);
            expect(shield.config.basis).toBe('hp');
        }
    });

    it('the Atlas Coordination I buff rides pre-combat, not on-cast', () => {
        const abilities = passiveAbilities({ firstPassiveSkillText: CRUCIALIS_TEXT });
        const buff = findBuff(abilities, 'Atlas Coordination I')!;
        expect(buff).toBeDefined();
        expect(buff.trigger).toBe('pre-combat');
    });
});

describe('FrontLine: start-of-combat shield, phrase trailing the sentence (docs/ship-skills.csv passive1)', () => {
    it('the 25%-max-HP shield rides pre-combat, not on-cast', () => {
        const abilities = passiveAbilities({
            firstPassiveSkillText:
                'This ship has 20% Shield Penetration.<br />While Shielded, it gains 2500 ' +
                'additional Defense.<br />This Unit gains <unit-damage>Shield equal to 25%</unit-damage> ' +
                'of its Max HP at the start of combat.',
        });
        const shield = abilities.find((a) => a.type === 'shield')!;
        expect(shield).toBeDefined();
        expect(shield.trigger).toBe('pre-combat');
        if (shield.config.type === 'shield') {
            expect(shield.config.pct).toBe(25);
            expect(shield.config.basis).toBe('hp');
        }
    });
});

describe('IonScorp: start-of-combat shield AND buff, undisclosed corpus twin of Crucialis (#210 review)', () => {
    // Exact docs/ship-skills.csv passive1 — the SAME clause shape as Crucialis, caught by the
    // reviewer's corpus sweep rather than the epic's named-ship list. Locks the generic
    // detectors so a future parser tweak that silently un-fires on IonScorp is caught here.
    const IONSCORP_TEXT =
        'At the start of combat, this Unit gains a <unit-damage>Shield equal to 20%</unit-damage> ' +
        'of its Max HP and gains <unit-skill>Atlas Coordination I</unit-skill> for 6 turns.';

    it('the 20%-max-HP shield rides pre-combat, not on-cast', () => {
        const abilities = passiveAbilities({ firstPassiveSkillText: IONSCORP_TEXT });
        const shield = abilities.find((a) => a.type === 'shield')!;
        expect(shield).toBeDefined();
        expect(shield.trigger).toBe('pre-combat');
        if (shield.config.type === 'shield') {
            expect(shield.config.basis).toBe('hp');
        }
    });

    it('the Atlas Coordination I buff rides pre-combat, not on-cast', () => {
        const abilities = passiveAbilities({ firstPassiveSkillText: IONSCORP_TEXT });
        const buff = findBuff(abilities, 'Atlas Coordination I')!;
        expect(buff).toBeDefined();
        expect(buff.trigger).toBe('pre-combat');
    });
});

describe('Vindicator: start-of-combat durationless buff (#210 review corpus sweep)', () => {
    it('Magnetized Shielding rides pre-combat, not on-cast', () => {
        // Exact docs/ship-skills.csv passive1 — no "for N turns" duration on the grant.
        const abilities = passiveAbilities({
            firstPassiveSkillText:
                'This Unit has 20% Shield Penetration. At the start of combat, this Unit gains ' +
                '<unit-skill>Magnetized Shielding</unit-skill>.',
        });
        const buff = findBuff(abilities, 'Magnetized Shielding')!;
        expect(buff).toBeDefined();
        expect(buff.trigger).toBe('pre-combat');
    });
});

describe('Tycho: start-of-combat Cheat Death + Everliving Regeneration I (docs/ship-skills.csv passive1)', () => {
    it('both buffs ride pre-combat, not on-cast', () => {
        const abilities = passiveAbilities({
            firstPassiveSkillText:
                'At the start of combat, this Unit gains <unit-skill>Cheat Death</unit-skill> ' +
                'and <unit-skill>Everliving Regeneration I</unit-skill> for 6 turns.',
        });
        expect(findBuff(abilities, 'Cheat Death')!.trigger).toBe('pre-combat');
        expect(findBuff(abilities, 'Everliving Regeneration I')!.trigger).toBe('pre-combat');
    });
});

describe('Meatshield: start-of-combat Protection stacks — DELIBERATELY UNCHANGED (deferred)', () => {
    it('stays on-cast: the parser still climbs stacks per cast, so relabeling only the trigger would misrepresent the mechanic', () => {
        const abilities = passiveAbilities({
            firstPassiveSkillText:
                'At the start of combat, this Unit gains 3 stacks of <unit-skill>Protection</unit-skill>.',
        });
        const buff = findBuff(abilities, 'Protection')!;
        expect(buff).toBeDefined();
        expect(buff.trigger).toBe('on-cast');
        // Confirms the isAccumulatingBuff guard is actually keyed off this shape.
        if (buff.config.type === 'buff') {
            expect(buff.config.isStackable).toBe(true);
            expect(buff.config.stackTrigger).toBeDefined();
        }
    });
});

// ─── Out-of-scope suspects verified: NOT "at the start of …" phrasing, correctly untouched ──

describe('Kinetik / Cinya: "every turn" (no "at the start of" phrase) — out of PR4 scope, unaffected', () => {
    it('Kinetik: the per-turn shield stays on-cast (no start-of-X phrase to detect)', () => {
        const abilities = passiveAbilities({
            firstPassiveSkillText:
                'This Unit gains a <unit-damage>Shield equal to 4%</unit-damage> of its Max HP every turn.',
        });
        const shield = abilities.find((a) => a.type === 'shield')!;
        expect(shield.trigger).toBe('on-cast');
    });

    it('Cinya: the per-turn heal stays on-cast (no start-of-X phrase to detect)', () => {
        const abilities = passiveAbilities({
            firstPassiveSkillText:
                'This Unit <unit-damage>repairs 3.5%</unit-damage> of its Max HP every turn.',
        });
        const heal = abilities.find((a) => a.type === 'heal')!;
        expect(heal.trigger).toBe('on-cast');
    });
});
