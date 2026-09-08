import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatGuideTable, { STAT_GUIDE, NOT_A_GAME_STAT } from '../StatGuideTable';
import { STATS } from '../../../constants/stats';
import type { StatName } from '../../../types/stats';

describe('StatGuideTable', () => {
    it('accounts for every entry in STATS — documented or explicitly excluded', () => {
        // Tripwire: adding a stat to STATS fails here rather than leaving a blank row on a
        // page aimed at new players. To leave one out, add it to NOT_A_GAME_STAT with a reason.
        expect([...Object.keys(STAT_GUIDE), ...NOT_A_GAME_STAT].sort()).toEqual(
            Object.keys(STATS).sort()
        );
    });

    it('has non-empty copy for every documented stat', () => {
        for (const [name, entry] of Object.entries(STAT_GUIDE)) {
            expect(entry.does, `${name}.does`).not.toBe('');
            expect(entry.wants, `${name}.wants`).not.toBe('');
        }
    });

    it('renders a row per documented stat, labelled from STATS', () => {
        render(<StatGuideTable />);
        for (const name of Object.keys(STAT_GUIDE) as StatName[]) {
            expect(screen.getByText(STATS[name].label)).toBeInTheDocument();
        }
    });

    it('does not show planner-internal stats to players', () => {
        // HP Regen is a tool-internal modelling stat, not something a player sees in game.
        render(<StatGuideTable />);
        for (const name of NOT_A_GAME_STAT) {
            expect(screen.queryByText(STATS[name].label)).not.toBeInTheDocument();
        }
        expect(NOT_A_GAME_STAT).toContain('hpRegen');
    });
});
