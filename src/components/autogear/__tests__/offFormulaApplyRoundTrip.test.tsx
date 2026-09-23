import { readFileSync } from 'fs';
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '../../../test-utils/test-utils';
import { AutogearSettings } from '../AutogearSettings';
import type { OffFormulaApplyUpdate } from '../OffFormulaNotice';
import type { RoleBasis } from '../../../types/autogear';
import type { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { makeSettingsProps } from './autogearSettingsProps';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports '/favicon.ico?url' —
// unresolvable under Vitest. Same workaround as the other component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));
// useTutorialTrigger calls useTutorial(), which throws without a TutorialProvider;
// TestProviders does not supply one.
vi.mock('../../../hooks/useTutorialTrigger', () => ({ useTutorialTrigger: () => undefined }));

// --- Real-corpus fixture, mirroring OffFormulaNotice.test.tsx's own loader (same gitignored
// docs/ship-skills.csv + docs/ship-data.json this project's other off-formula tests read).

interface Datum {
    name: string;
    role: string;
    hp: number;
    attack: number;
    defense: number;
    hacking: number;
    security: number;
    speed: number;
    critRate: number;
    critDamage: number;
}

const asShip = (rec: ReturnType<typeof loadShipSkillRecords>[number], d: Datum): Ship =>
    ({
        id: rec.name.toLowerCase(),
        name: rec.name,
        type: d.role,
        baseStats: {
            attack: d.attack,
            crit: d.critRate,
            critDamage: d.critDamage,
            hacking: d.hacking,
            security: d.security,
            defence: d.defense,
            hp: d.hp,
            speed: d.speed,
        },
        equipment: {},
        implants: {},
        refits: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, stats: [] })),
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
        chargedTarget: 'front',
        chargedPattern: 'Pattern-Base',
    }) as unknown as Ship;

const corpusShipNamed = (name: string): Ship => {
    const data: Datum[] = JSON.parse(readFileSync('docs/ship-data.json', 'utf8'));
    const byName = new Map(data.map((d) => [d.name.toLowerCase(), d]));
    const rec = loadShipSkillRecords().find((r) => r.name.toLowerCase() === name.toLowerCase());
    const d = byName.get(name.toLowerCase());
    if (!rec || !d) throw new Error(`mutation guard: no corpus ship named ${name}`);
    return asShip(rec, d);
};

/** Renders `AutogearSettings` against REAL `updateShipConfig`-style state: `appliedRoleBasis`
 *  and the handlers below round-trip through a plain `useState`, exactly like
 *  `AutogearPage`'s `shipConfigs` state does through `getShipConfig`/`updateShipConfig`. A spy
 *  on `onApply` alone (the shape the pre-existing tests use) proves the write fires but not that
 *  anything ever reads it back — that gap is exactly how this bug shipped looking green. */
const Harness: React.FC<{ ship: Ship }> = ({ ship }) => {
    const [roleBasis, setRoleBasis] = useState<RoleBasis | undefined>(undefined);
    return (
        <AutogearSettings
            {...makeSettingsProps({ selectedShip: ship, selectedShipRole: 'ATTACKER' })}
            appliedRoleBasis={roleBasis}
            onApplyOffFormula={(update: OffFormulaApplyUpdate) => setRoleBasis(update.roleBasis)}
            onClearOffFormula={() => setRoleBasis(undefined)}
        />
    );
};

describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'Clicking "Use this equation" shows a visible applied state',
    () => {
        it('renders the applied state after Apply, and Undo returns to the offer', () => {
            const cobalt = corpusShipNamed('Cobalt');
            render(<Harness ship={cobalt} />);

            // Nothing claims an equation is in use yet.
            expect(screen.queryByText(/will score/i)).not.toBeInTheDocument();
            const applyButton = screen.getByRole('button', { name: /use this equation/i });

            fireEvent.click(applyButton);

            // The applied state is now visible, and the offer to apply is gone — the player is
            // not left staring at a button that looks unclicked.
            expect(
                screen.getByText(/Autogear will score Cobalt with this equation on its next run\./i)
            ).toBeInTheDocument();
            expect(
                screen.queryByRole('button', { name: /use this equation/i })
            ).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /stop using this equation/i }));

            // Undo clears the stored basis and returns the offer.
            expect(screen.queryByText(/will score/i)).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: /use this equation/i })).toBeInTheDocument();
        });

        // The routing-bug class this branch keeps hitting: a control must key off what the
        // STORED state actually says, not merely off something being present. A basis applied
        // under one role, then left in place after the player switches the ship to a role that
        // doesn't host the same axis, must not read as "in use" — the scorer ignores it too
        // (`roleHostsBasis`), so claiming otherwise would tell the player a lie the engine
        // doesn't act on.
        it('does not render the applied state when the stored basis is on an axis this role does not host', () => {
            const cobalt = corpusShipNamed('Cobalt');
            const mismatchedBasis: RoleBasis = {
                produces: 'repair',
                terms: [{ stat: 'hp', weight: 1 }],
            };
            render(
                <AutogearSettings
                    {...makeSettingsProps({ selectedShip: cobalt, selectedShipRole: 'ATTACKER' })}
                    appliedRoleBasis={mismatchedBasis}
                    onApplyOffFormula={vi.fn()}
                    onClearOffFormula={vi.fn()}
                />
            );

            expect(screen.queryByText(/will score/i)).not.toBeInTheDocument();
            // ATTACKER still hosts its own (damage) equation, so the ordinary offer remains —
            // the mismatch withholds the APPLIED claim, not the button entirely.
            expect(screen.getByRole('button', { name: /use this equation/i })).toBeInTheDocument();
        });
    }
);
