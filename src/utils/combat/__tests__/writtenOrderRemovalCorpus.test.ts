/**
 * Census of every firing-slot status REMOVAL (buff steal, purge, cleanse) in a skill that also deals
 * damage, with where it is written relative to that damage. Clauses resolve in written order:
 * `runPlayerTurn` runs a removal written ahead of the damage before the caster's stats are read
 * (`isRemovalBeforeDamage`), and holds one written after it back until the damage has landed.
 *
 * Two tripwires ride the census:
 *  - Only an ungated, unscaled removal (and only a SELF cleanse) can run that early, because its
 *    gate context and its crit-power scaling do not exist yet. A shipped clause written ahead of
 *    the damage that is not one of those would silently keep its old, late place — so it fails here.
 *  - A purge written after the damage lands after the `buffs-purged-this-cast` re-gate, so a skill
 *    whose extra action counts its purges must purge ahead of its damage.
 *
 * CORPUS ACCESS: both reference files are gitignored; this census fails if either is missing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { clausePhase, isDamageClause, isRemovalBeforeDamage } from '../castClauseOrder';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';

const REMOVAL_TYPES = new Set(['buff-steal', 'purge', 'cleanse']);

const kits = (): { name: string; skills: ShipSkills }[] =>
    loadShipSkillRecords().map((rec) => ({
        name: rec.name,
        skills: buildShipAbilities(buildTraceShip(rec.name, { refitLevel: 4 }) as Ship),
    }));

const firingRemovals = (): { name: string; slot: string; ability: Ability; all: Ability[] }[] =>
    kits().flatMap(({ name, skills }) =>
        skills.slots
            .filter((s) => s.slot === 'active' || s.slot === 'charged')
            .filter((s) => s.abilities.some(isDamageClause))
            .flatMap((s) =>
                s.abilities
                    .filter((a) => REMOVAL_TYPES.has(a.config.type) && a.trigger === 'on-cast')
                    .map((ability) => ({ name, slot: s.slot, ability, all: s.abilities }))
            )
    );

describe('firing-slot removals vs the damage clause (census)', () => {
    beforeAll(() => {
        if (!csvAvailable() || !shipDataAvailable()) {
            throw new Error(
                'This census requires docs/ship-skills.csv and docs/ship-data.json ' +
                    '(gitignored reference data) — copy them in before running'
            );
        }
    });

    it('the census of removal clauses in damage-dealing skills is unchanged', () => {
        const rows = firingRemovals()
            .map(
                ({ name, slot, ability, all }) =>
                    `${name} ${slot} ${ability.config.type}[${ability.target}] ${clausePhase(all, ability)}`
            )
            .sort();
        expect(rows).toEqual([
            'Amartya charged purge[all-enemies] after-damage',
            'Chakara charged purge[enemy] after-damage',
            'Cobalt active purge[enemy] before-damage',
            'Cobalt charged purge[enemy] before-damage',
            'Laika active cleanse[self] before-damage',
            'Lev active cleanse[self] before-damage',
            'Lodolite charged purge[enemy-most-buffs] after-damage',
            'Morao charged cleanse[self] before-damage',
            'Nayra charged purge[enemy] after-damage',
            'Nosorog charged cleanse[self] after-damage',
            'Obsidian active purge[enemy] before-damage',
            'Pallas charged buff-steal[enemy] before-damage',
            'Sefuba active purge[enemy] after-damage',
            'Sustainer active cleanse[self] before-damage',
            'Thresh charged buff-steal[enemy] before-damage',
            'Tithonus active purge[enemy] before-damage',
            'Tithonus charged buff-steal[enemy] before-damage',
            'Tithonus charged purge[enemy] before-damage',
            'Voron charged purge[enemy] after-damage',
            'Zeolite active purge[enemy] before-damage',
        ]);
    });

    it('every removal written ahead of the damage runs ahead of it', () => {
        const stuckLate = firingRemovals()
            .filter(({ ability, all }) => clausePhase(all, ability) === 'before-damage')
            .filter(({ ability, all }) => !isRemovalBeforeDamage(all, ability))
            .map(({ name, slot, ability }) => `${name} ${slot} ${ability.id}`);
        expect(stuckLate).toEqual([]);
    });

    it('a skill that counts its purges purges ahead of its damage', () => {
        const late = kits().flatMap(({ name, skills }) => {
            const countsPurges = skills.slots.some((s) =>
                s.abilities.some((a) =>
                    a.conditions.some((c) => c.subject === 'buffs-purged-this-cast')
                )
            );
            if (!countsPurges) return [];
            return skills.slots
                .filter((s) => s.slot === 'active' || s.slot === 'charged')
                .flatMap((s) =>
                    s.abilities
                        .filter(
                            (a) =>
                                a.config.type === 'purge' &&
                                clausePhase(s.abilities, a) === 'after-damage'
                        )
                        .map((a) => `${name} ${s.slot} ${a.id}`)
                );
        });
        expect(late).toEqual([]);
    });
});
