import { describe, it, expect } from 'vitest';
import {
    parseSlot,
    sigs,
    canonical,
    type RewordPair,
    type SlotName,
} from './helpers/catalogueWording';

const PAIRS: RewordPair[] = [
    {
        ship: 'Prospect',
        slot: 'passive',
        old: 'This Unit gains <unit-skill>Inc. Damage Down I</unit-skill> for 2 turns when inflicting a debuff.',
        new: 'This Unit gains <unit-skill>Inc. Damage Down I</unit-skill> for 2 turns after it inflicts a <unit-aid>debuff</unit-aid>.',
        expects: 'buff|self|on-debuff-inflicted|Inc. Damage Down I',
    },
    {
        ship: 'Prospect',
        slot: 'passive',
        old: 'This Unit gains <unit-skill>Inc. Damage Down II</unit-skill> for 3 turns when inflicting a debuff.',
        new: 'This Unit gains <unit-skill>Inc. Damage Down II</unit-skill> for 3 turns after it inflicts a <unit-aid>debuff</unit-aid>.',
        expects: 'buff|self|on-debuff-inflicted|Inc. Damage Down II',
    },
    {
        ship: 'Torcher',
        slot: 'passive',
        old: 'This Unit gains <unit-skill>Marauder Rage I</unit-skill> for 3 turns upon inflicting a debuff.',
        new: 'This Unit gains <unit-skill>Marauder Rage I</unit-skill> for 3 turns after it inflicts a <unit-aid>debuff</unit-aid>.',
        expects: 'buff|self|on-debuff-inflicted|Marauder Rage I',
    },
    {
        ship: 'Torcher',
        slot: 'passive',
        old: 'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns upon inflicting a debuff.',
        new: 'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns after it inflicts a <unit-aid>debuff</unit-aid>.',
        expects: 'buff|self|on-debuff-inflicted|Marauder Rage II',
    },
];

// Rows whose catalogue sentence is the only wording the parser reads: the parse must carry
// `expects`.
const CATALOGUE_ROWS: { ship: string; slot: SlotName; text: string; expects: string }[] = [
    {
        ship: 'Defiant',
        slot: 'passive',
        text: 'This Unit gains a <unit-damage>shield equal to 30%</unit-damage> of its max HP after it inflicts <unit-skill>Stasis</unit-skill>.',
        expects: 'shield|self|on-stasis-applied|shield',
    },
    {
        ship: 'Asphyxiator',
        slot: 'passive',
        text: 'At the start of the round, if there are any enemies with 3 or more <unit-aid>debuffs</unit-aid>, this Unit gains 1 stack of <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns. Upon destroying an enemy, this Unit removes <unit-skill>Overload</unit-skill>. <br /><br />After this Unit inflicts a <unit-aid>debuff</unit-aid> with a critical hit, the newly inflicted <unit-aid>debuff</unit-aid> is <unit-skill>extended by 1 turn</unit-skill>.',
        expects: 'extend-status|all-enemies|on-cast|extend-status',
    },
    {
        ship: 'Pestilence',
        slot: 'passive',
        text: 'When this Unit inflicts a <unit-aid>debuff</unit-aid>, it <unit-skill>reduces the duration of all active</unit-skill> <unit-aid>debuffs</unit-aid> on all allies by 1 turn.',
        expects: 'cleanse|all-allies|on-debuff-inflicted|cleanse',
    },
    {
        ship: 'Pestilence',
        slot: 'passive',
        text: 'When this Unit inflicts a <unit-aid>debuff</unit-aid>, it <unit-skill>reduces the duration of all active</unit-skill> <unit-aid>debuffs</unit-aid> on all allies by 1 turn.<br /><br />When an enemy <unit-skill>cleanses a debuff</unit-skill>, this Unit inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns',
        expects: 'cleanse|all-allies|on-debuff-inflicted|cleanse',
    },
    {
        ship: 'Hayyan',
        slot: 'passive',
        text: "When this Unit <unit-skill>cleanses a debuff</unit-skill> from an ally, it also <unit-damage>repairs the ally 4%</unit-damage> of this Unit's max HP. <br /><br />When a <unit-aid>debuff</unit-aid> is inflicted on an ally, this Unit <unit-damage>repairs the ally for 6%</unit-damage> of this Unit's max HP.",
        expects: 'heal|ally|on-ally-debuffed|heal',
    },
    {
        ship: 'Wisteria',
        slot: 'passive',
        text: 'When this Unit inflicts <unit-skill>Corrosion</unit-skill> with a critical hit, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.',
        expects: 'dot|enemy|on-self-crit-dot|dot',
    },
    {
        ship: 'Wisteria',
        slot: 'passive',
        text: "When this Unit inflicts <unit-skill>Corrosion</unit-skill> with a critical hit, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns and <unit-skill>extends the newly inflicted</unit-skill> <unit-skill>Corrosion</unit-skill> by 1 turn with the extension chance equal to this Unit's crit power.",
        expects: 'dot|enemy|on-self-crit-dot|dot',
    },
    {
        ship: 'Belladonna',
        slot: 'passive',
        text: 'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit converts the <unit-skill>Corrosion</unit-skill> into <unit-skill>Acidic Decay</unit-skill> of the same level, with the chance scaling at 1% per 10 Hacking.',
        expects: 'convert-dot|enemy|on-ally-debuff-inflicted|Acidic Decay',
    },
    {
        ship: 'Belladonna',
        slot: 'passive',
        text: 'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit converts the <unit-skill>Corrosion</unit-skill> into <unit-skill>Acidic Decay</unit-skill> of the same level, with the chance scaling at 1% per 10 Hacking.<br /><br />Upon converting <unit-skill>Corrosion</unit-skill>, this Unit <unit-skill>extends the newly inflicted</unit-skill> <unit-skill>Acidic Decay</unit-skill> status for 1 turn, with the chance equal to its crit power.',
        expects: 'convert-dot|enemy|on-ally-debuff-inflicted|Acidic Decay',
    },
];

describe('inflict/apply vocabulary — catalogue wording parses like ours', () => {
    it.each(PAIRS)('$ship $slot', ({ slot, old, new: next, expects }) => {
        const before = parseSlot(slot, old);
        expect(sigs(before)).toContain(expects); // the reference parse is not vacuous
        expect(canonical(parseSlot(slot, next))).toEqual(canonical(before));
    });

    it.each(CATALOGUE_ROWS)(
        '$ship $slot: the catalogue sentence carries its parse',
        ({ slot, text, expects }) => {
            expect(sigs(parseSlot(slot, text))).toContain(expects);
        }
    );
});

// APEX: "when an enemy gets inflicted with a debuff" says "inflicted", so its shield reacts only
// to inflicted debuffs (#593's split; the user's rule that a reaction's own verb decides what it
// sees).
const APEX_ROWS: { ship: string; slot: SlotName; text: string; expects: string }[] = [
    {
        ship: 'APEX',
        slot: 'passive',
        text: 'This Unit gains a <unit-damage>shield equal to 3%</unit-damage> of their max HP when an enemy gets inflicted with a <unit-aid>debuff</unit-aid>.',
        expects: 'shield|self|on-debuff-inflicted|shield',
    },
    {
        ship: 'APEX',
        slot: 'passive',
        text: 'This Unit gains a <unit-damage>shield equal to 3%</unit-damage> of their max HP when an enemy gets inflicted with a <unit-aid>debuff</unit-aid>.<br /><br />If that enemy has 3 or more <unit-aid>debuffs</unit-aid> on a <unit-aid>debuff</unit-aid> infliction, this Unit inflicts <unit-skill>Block Shield</unit-skill> for 1 turn.',
        expects: 'shield|self|on-debuff-inflicted|shield',
    },
];

describe('inflict/apply vocabulary — APEX: the inflict verb sets the inflict filter', () => {
    it.each(APEX_ROWS)('$ship $slot', ({ slot, text, expects }) => {
        const abilities = parseSlot(slot, text);
        expect(sigs(abilities)).toContain(expects);
        const shield = abilities.find((a) => a.trigger === 'on-debuff-inflicted');
        expect(shield?.triggerApplicationFilter).toBe('inflict');
    });
});

// Ravager R2's resist reaction, pinned directly; the full row (including its "This Unit has 10%
// defense penetration" clause) pairs in catalogueWording.clauses.test.ts.
describe('inflict/apply vocabulary — resist reaction', () => {
    it('Ravager passive R2: "If this Unit\'s debuff is resisted" grants Hacking Module Overdrive on that resist', () => {
        const text =
            "This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage III</unit-skill> for 3 turns.<br /><br />If this Unit's debuff is resisted, it gains <unit-skill>Hacking Module Overdrive</unit-skill> for 1 turn. This Unit has <unit-damage>10% defense penetration</unit-damage>.";
        const s = sigs(parseSlot('passive', text));
        expect(s).toContain('buff|self|on-own-debuff-resisted|Hacking Module Overdrive');
        expect(s).not.toContain('buff|self|on-cast|Hacking Module Overdrive');
    });
});

// User ruling (2026-10-02): a reaction "after it inflicts a debuff" needs a SUCCESSFUL infliction
// (landed, not resisted). `on-debuff-inflicted` is that trigger: its listener (triggers.ts) wakes
// on `debuff-applied`, which only a landed application emits — a resisted roll emits
// `debuff-resisted` instead. Our Ripper text uses the phrase, so it reacts like Prospect's.
describe('inflict/apply vocabulary — "after it inflicts a debuff" needs a landed debuff', () => {
    it.each([
        [
            'R0',
            'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns after it inflicts a debuff.',
        ],
        [
            'R2',
            'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns after it inflicts a debuff.<br /><br />All allies extend their active <unit-aid>Buffs</unit-aid> by 1 turn.',
        ],
    ])('Ripper passive %s: Marauder Rage II fires on each landed infliction', (_refit, text) => {
        const abilities = parseSlot('passive', text);
        const s = sigs(abilities);
        expect(s).toContain('buff|self|on-debuff-inflicted|Marauder Rage II');
        expect(s).not.toContain('buff|self|on-cast|Marauder Rage II');
        const rage = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Marauder Rage II'
        );
        // The reaction's own trigger is the gate: no leftover enemy-has-a-debuff condition, and
        // the clause's "inflicts" verb keeps an applied (no-roll) status from waking it.
        expect(rage?.conditions).toEqual([]);
        expect(rage?.triggerApplicationFilter).toBe('inflict');
        expect(rage?.config).toMatchObject({ buffName: 'Marauder Rage II', duration: 3 });
    });

    it('Ripper passive R2: the all-allies buff extension stays a cast effect', () => {
        const text =
            'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns after it inflicts a debuff.<br /><br />All allies extend their active <unit-aid>Buffs</unit-aid> by 1 turn.';
        expect(sigs(parseSlot('passive', text))).toEqual([
            'buff|self|on-debuff-inflicted|Marauder Rage II',
            'extend-status|all-allies|on-cast|extend-status',
        ]);
    });
});

// "When this Unit inflicts a Bomb it gains Stealth" reacts to one of HER Bombs landing — not to any
// debuff she lands, and not on every cast. Our R0 and the catalogue's R0/R2/R4 share the sentence;
// the catalogue's R2/R4 add the crit-power detonation clause.
describe('inflict/apply vocabulary — "When this Unit inflicts a Bomb" reacts to her landed Bomb', () => {
    it.each([
        [
            'R0',
            'When this Unit inflicts a <unit-skill>Bomb</unit-skill> it gains <unit-skill>Stealth</unit-skill> for 1 turn.',
            1,
        ],
        [
            'R2',
            'When this Unit inflicts a <unit-skill>Bomb</unit-skill> it gains <unit-skill>Stealth</unit-skill> for 1 turn.<br /><br />This Unit deals <unit-damage>1% more detonation damage</unit-damage> per 20% crit power it has.',
            1,
        ],
        [
            'R4',
            'When this Unit inflicts a <unit-skill>Bomb</unit-skill> it gains <unit-skill>Stealth</unit-skill> for 2 turns.<br /><br />This Unit deals <unit-damage>1% more detonation damage</unit-damage> per 10% crit power it has.',
            2,
        ],
    ])(
        'Lingshe passive %s: Stealth rides on-debuff-inflicted narrowed to Bomb',
        (refit, text, turns) => {
            const abilities = parseSlot('passive', text);
            const s = sigs(abilities);
            expect(s).toContain('buff|self|on-debuff-inflicted|Stealth');
            expect(s).not.toContain('buff|self|on-cast|Stealth');
            // R2/R4's crit-power detonation clause still parses beside the Stealth reaction.
            if (refit !== 'R0') expect(s).toContain('modifier|self|on-cast|modifier');
            const stealth = abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Stealth'
            );
            expect(stealth?.triggerStatusFilter).toBe('Bomb');
            expect(stealth?.triggerApplicationFilter).toBe('inflict');
            expect(stealth?.conditions).toEqual([]);
            expect(stealth?.config).toMatchObject({ buffName: 'Stealth', duration: turns });
        }
    );

    it('a debuff-noun reaction carries no status filter (Ripper "after it inflicts a debuff")', () => {
        const rage = parseSlot(
            'passive',
            'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns after it inflicts a debuff.'
        ).find((a) => a.config.type === 'buff' && a.config.buffName === 'Marauder Rage II');
        expect(rage?.trigger).toBe('on-debuff-inflicted');
        expect(rage?.triggerStatusFilter).toBeUndefined();
    });
});
