import { describe, it, expect } from 'vitest';
import { roleObjective } from '../roleObjectives';
import { suggestedPrimary } from '../metricTable';

describe('roleObjective', () => {
    it.each([
        ['ATTACKER', 'focusDamageDealt', 'winRate'],
        ['DEFENDER', 'focusDamageTakenShare', 'survival'],
        ['SUPPORTER', 'focusSupportOutput', 'survival'],
        ['DEBUFFER', 'enemyDebuffUptime', 'winRate'],
    ])('%s maximises %s subject to %s', (role, maximise, constraint) => {
        const objective = roleObjective(role);
        expect(objective.maximise).toBe(maximise);
        expect(objective.constraint).toBe(constraint);
    });

    // Variants share their family's objective. A hand-written per-role map drifts the moment a
    // role is added; this pins that variants resolve through matchesRoleCategory.
    it.each([
        ['DEBUFFER_BOMBER', 'enemyDebuffUptime'],
        ['DEBUFFER_CORROSION', 'enemyDebuffUptime'],
        ['SUPPORTER_SHIELD', 'focusSupportOutput'],
        ['DEFENDER_SECURITY', 'focusDamageTakenShare'],
    ])('%s inherits its family objective %s', (role, maximise) => {
        expect(roleObjective(role).maximise).toBe(maximise);
    });
});

describe('the defender objective', () => {
    it('suggests win rate, not team damage which rewards a defender for being ignored', () => {
        expect(suggestedPrimary('DEFENDER')).toBe('winRate');
    });
});
