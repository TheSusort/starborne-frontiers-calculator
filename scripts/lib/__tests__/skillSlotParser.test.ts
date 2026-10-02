import { describe, it, expect } from 'vitest';
import { slotParser } from '../skillSlotParser';
import { abilitySignature } from '../skillParseDiff';
import type { ShipSkillRecord } from '../shipSkillCsv';

const rec = (passives: [string, string, string]): ShipSkillRecord => ({
    name: 'S', active: 'This Unit deals <unit-damage>100% damage</unit-damage>.', charge: '', chargeCharge: 3, passives,
});
const heal = 'When this Unit cleanses a <unit-aid>debuff</unit-aid>, it repairs <unit-aid>10%</unit-aid> of its max HP.';

describe('slotParser', () => {
    it('parses the passive the refit level unlocks', () => {
        const parse = slotParser(() => ({}));
        const r = rec(['This Unit deals <unit-damage>100% damage</unit-damage>.', heal, '']);
        expect(parse(r, 0).passive.map(abilitySignature)).toEqual(['damage|enemy|on-cast|damage']);
        expect(parse(r, 2).passive.map(abilitySignature)).toEqual(['heal|self|on-own-cleanse|heal']);
        expect(parse(r, 4).passive.map(abilitySignature)).toEqual(['heal|self|on-own-cleanse|heal']);
        expect(parse(r, 0).active.map(abilitySignature)).toEqual(['damage|enemy|on-cast|damage']);
    });

    it('overlays the record onto the base ship, so the base role reaches the parse', () => {
        const supporter = slotParser(() => ({ type: 'SUPPORTER' }));
        const defender = slotParser(() => ({ type: 'DEFENDER' }));
        expect(supporter(rec([heal, '', '']), 0).passive.map(abilitySignature)).toEqual(['heal|ally|on-own-cleanse|heal']);
        expect(defender(rec([heal, '', '']), 0).passive.map(abilitySignature)).toEqual(['heal|self|on-own-cleanse|heal']);
    });

    it("takes text from the record, not the base ship's", () => {
        const parse = slotParser(() => ({ activeSkillText: heal, firstPassiveSkillText: heal }));
        expect(parse(rec(['', '', '']), 0).passive).toEqual([]);
        expect(parse(rec(['', '', '']), 0).active.map(abilitySignature)).toEqual(['damage|enemy|on-cast|damage']);
    });
});
