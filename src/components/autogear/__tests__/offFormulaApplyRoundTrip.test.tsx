import { readFileSync } from 'fs';
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '../../../test-utils/test-utils';
import { AutogearSettings } from '../AutogearSettings';
import type { OffFormulaApplyUpdate } from '../OffFormulaNotice';
import { deriveBasis } from '../../../utils/autogear/offFormula/basisDerivation';
import type { RoleBasis } from '../../../types/autogear';
import type { Ship } from '../../../types/ship';
import type { ShipTypeName } from '../../../constants/shipTypes';
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
 *  anything ever reads it back — that gap is exactly how this bug shipped looking green.
 *
 *  `onUpdateCaptured` additionally hands the test the last `OffFormulaApplyUpdate` (not only its
 *  `roleBasis`), so a test can assert `shipRole` and `produces` stayed put after an edit — the
 *  UI's own re-render still runs off the `roleBasis` state above, never off this capture. */
const Harness: React.FC<{
    ship: Ship;
    role?: ShipTypeName;
    onUpdateCaptured?: (update: OffFormulaApplyUpdate | undefined) => void;
}> = ({ ship, role = 'ATTACKER', onUpdateCaptured }) => {
    const [roleBasis, setRoleBasis] = useState<RoleBasis | undefined>(undefined);
    return (
        <AutogearSettings
            {...makeSettingsProps({ selectedShip: ship, selectedShipRole: role })}
            appliedRoleBasis={roleBasis}
            onApplyOffFormula={(update: OffFormulaApplyUpdate) => {
                setRoleBasis(update.roleBasis);
                onUpdateCaptured?.(update);
            }}
            onClearOffFormula={() => {
                setRoleBasis(undefined);
                onUpdateCaptured?.(undefined);
            }}
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

describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'Editing an applied equation (#544, Task 4b)',
    () => {
        /** Applies Cobalt's derived damage equation (Attack x2.100 + HP x0.267, pinned in
         *  `basisDerivation.test.ts`) and opens the editor, against real config state. */
        const applyAndOpenEditor = (
            onUpdateCaptured?: (u: OffFormulaApplyUpdate | undefined) => void
        ) => {
            const cobalt = corpusShipNamed('Cobalt');
            render(<Harness ship={cobalt} onUpdateCaptured={onUpdateCaptured} />);
            fireEvent.click(screen.getByRole('button', { name: /use this equation/i }));
            fireEvent.click(screen.getByRole('button', { name: /edit this equation/i }));
        };

        it('shows the kit equation as in use, not edited, right after Apply', () => {
            applyAndOpenEditor();
            expect(screen.getByText(/^Attack x2\.100 \+ HP x0\.267$/)).toBeInTheDocument();
        });

        it('saving an edited weight updates the applied terms and flips the edited indicator', () => {
            const captured: OffFormulaApplyUpdate[] = [];
            applyAndOpenEditor((u) => u && captured.push(u));

            const weightInputs = screen.getAllByLabelText(/basis weight/i);
            fireEvent.change(weightInputs[1], { target: { value: '0.5' } });
            fireEvent.click(screen.getByRole('button', { name: /save equation/i }));

            // The applied state visibly shows the EDITED terms — not a spy proving the
            // callback fired, a real re-render off real config state.
            expect(screen.getByText(/Attack x2\.100 \+ HP x0\.500/)).toBeInTheDocument();
            expect(screen.getByText(/your own version of the equation/i)).toBeInTheDocument();
            expect(screen.queryByText(/the kit's own equation/i)).not.toBeInTheDocument();

            // produces and shipRole are untouched by the edit.
            const last = captured[captured.length - 1];
            expect(last.shipRole).toBe('ATTACKER');
            expect(last.roleBasis.produces).toBe('damage');
        });

        it('adding a term saves it alongside the existing ones', () => {
            applyAndOpenEditor();
            fireEvent.click(screen.getByRole('button', { name: /^add stat$/i }));

            const weightInputs = screen.getAllByLabelText(/basis weight/i);
            fireEvent.change(weightInputs[weightInputs.length - 1], { target: { value: '1.5' } });
            fireEvent.click(screen.getByRole('button', { name: /save equation/i }));

            expect(
                screen.getByText(/Attack x2\.100 \+ HP x0\.267 \+ Defence x1\.500/)
            ).toBeInTheDocument();
        });

        it('removing a term saves the equation without it', () => {
            applyAndOpenEditor();
            const removeButtons = screen.getAllByRole('button', { name: /remove basis term/i });
            fireEvent.click(removeButtons[1]); // the HP row
            fireEvent.click(screen.getByRole('button', { name: /save equation/i }));

            // The applied line names only the surviving term — the finding's own equation-line
            // sentence above it still names HP (it always states the ship's real derivation,
            // independent of what is applied), so the assertion is scoped to the exact applied
            // line rather than "no HP anywhere on the card".
            expect(screen.getByText(/^Attack x2\.100$/)).toBeInTheDocument();
        });

        it('refuses a blank weight and leaves the applied equation unchanged', () => {
            applyAndOpenEditor();
            fireEvent.click(screen.getAllByRole('button', { name: /remove basis term/i })[1]);
            fireEvent.change(screen.getAllByLabelText(/basis weight/i)[0], {
                target: { value: '' },
            });
            fireEvent.click(screen.getByRole('button', { name: /save equation/i }));

            expect(screen.getByRole('alert')).toHaveTextContent(
                'Every stat needs a weight above zero. Remove a stat instead of leaving it blank or at 0.'
            );
            expect(screen.getByText(/^Attack x2\.100 \+ HP x0\.267$/)).toBeInTheDocument();
            expect(screen.getByText(/the kit's own equation/i)).toBeInTheDocument();
        });

        it('refuses a zero weight and leaves the applied equation unchanged', () => {
            applyAndOpenEditor();
            fireEvent.click(screen.getAllByRole('button', { name: /remove basis term/i })[1]);
            fireEvent.change(screen.getAllByLabelText(/basis weight/i)[0], {
                target: { value: '0' },
            });
            fireEvent.click(screen.getByRole('button', { name: /save equation/i }));

            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText(/^Attack x2\.100 \+ HP x0\.267$/)).toBeInTheDocument();
        });

        it('refuses a negative weight (dropping it silently is not enough) and leaves the equation unchanged', () => {
            applyAndOpenEditor();
            // Attack stays positive; HP goes negative. `usableBasisTerms` would drop only the
            // HP term and keep Attack — that partial drop must still refuse the whole save
            // rather than silently landing without the term the player typed.
            fireEvent.change(screen.getAllByLabelText(/basis weight/i)[1], {
                target: { value: '-1' },
            });
            fireEvent.click(screen.getByRole('button', { name: /save equation/i }));

            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText(/^Attack x2\.100 \+ HP x0\.267$/)).toBeInTheDocument();
        });

        it('refuses an all-zero equation and leaves the applied equation unchanged', () => {
            applyAndOpenEditor();
            const weightInputs = screen.getAllByLabelText(/basis weight/i);
            fireEvent.change(weightInputs[0], { target: { value: '0' } });
            fireEvent.change(weightInputs[1], { target: { value: '0' } });
            fireEvent.click(screen.getByRole('button', { name: /save equation/i }));

            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByText(/^Attack x2\.100 \+ HP x0\.267$/)).toBeInTheDocument();
        });

        it('offers no derived stat (Direct Damage, Effective HP) in the term picker', async () => {
            applyAndOpenEditor();
            await userEvent.click(screen.getByRole('button', { name: /^add stat$/i }));
            const pickers = screen.getAllByLabelText(/basis stat/i);
            await userEvent.click(pickers[pickers.length - 1]);

            expect(screen.getByRole('option', { name: 'Attack' })).toBeInTheDocument();
            expect(screen.queryByRole('option', { name: 'Direct Damage' })).not.toBeInTheDocument();
            expect(screen.queryByRole('option', { name: 'Effective HP' })).not.toBeInTheDocument();
        });

        it("restores exactly deriveBasis's own terms and flips the edited indicator back", () => {
            applyAndOpenEditor();
            fireEvent.change(screen.getAllByLabelText(/basis weight/i)[1], {
                target: { value: '9.999' },
            });
            fireEvent.click(screen.getByRole('button', { name: /save equation/i }));
            expect(screen.getByText(/your own version of the equation/i)).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /restore the derived equation/i }));

            const cobalt = corpusShipNamed('Cobalt');
            expect(deriveBasis(cobalt, 'damage').terms).toEqual([
                { stat: 'attack', weight: expect.closeTo(2.1) },
                { stat: 'hp', weight: expect.closeTo(0.267) },
            ]);
            expect(screen.getByText(/^Attack x2\.100 \+ HP x0\.267$/)).toBeInTheDocument();
            expect(screen.getByText(/the kit's own equation/i)).toBeInTheDocument();
            expect(
                screen.queryByRole('button', { name: /restore the derived equation/i })
            ).not.toBeInTheDocument();
        });

        it('closes the editor when Stop is clicked mid-edit, with no equation left applied', () => {
            applyAndOpenEditor();
            fireEvent.change(screen.getAllByLabelText(/basis weight/i)[0], {
                target: { value: '9.999' },
            });

            fireEvent.click(screen.getByRole('button', { name: /stop using this equation/i }));

            // The applied state is gone entirely — Stop ended it, not merely hid the editor over
            // it — so the ordinary offer to apply again is what's left.
            expect(screen.queryByText(/will score/i)).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: /use this equation/i })).toBeInTheDocument();

            // No save control survives that could re-apply the abandoned draft.
            expect(
                screen.queryByRole('button', { name: /save equation/i })
            ).not.toBeInTheDocument();
            expect(screen.queryAllByLabelText(/basis weight/i)).toHaveLength(0);
        });

        it('keeps the excluded-carrier sentence visible while editing', () => {
            // Xcellence's damage basis reduces to Attack alone — the same stat ATTACKER already
            // scores — so #544 I2 offers Write an equation here, never Apply (her real derivation
            // is a no-op); she reaches applied state through that instead.
            const xcellence = corpusShipNamed('Xcellence');
            render(<Harness ship={xcellence} role="ATTACKER" />);
            fireEvent.click(screen.getByRole('button', { name: /write an equation/i }));
            fireEvent.click(screen.getByRole('button', { name: /^add stat$/i }));
            fireEvent.change(screen.getAllByLabelText(/basis weight/i)[0], {
                target: { value: '0.5' },
            });
            fireEvent.click(screen.getByRole('button', { name: /save equation/i }));
            fireEvent.click(screen.getByRole('button', { name: /edit this equation/i }));

            expect(
                screen.getByText(
                    /Xcellence deals damage equal to 115% of its shield pool when an enemy resists a debuff/i
                )
            ).toBeInTheDocument();
        });
    }
);

describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'Writing an equation for a passive-only carrier (#544 gap)',
    () => {
        // Zenith's whole shield carrier lives in a passive slot (Attack x50% at the start of the
        // round), so `deriveBasis(Zenith, 'shield').terms` is empty and "Use this equation" never
        // renders — this is the exact case the editor exists for (owner's stated reason: "editing
        // is how a player adds one"), yet the applied state (and therefore the editor) was
        // unreachable before this fix.
        it('offers Write an equation, not Apply, for Zenith under SUPPORTER_SHIELD', () => {
            const zenith = corpusShipNamed('Zenith');
            render(<Harness ship={zenith} role="SUPPORTER_SHIELD" />);
            expect(screen.getByRole('button', { name: /write an equation/i })).toBeInTheDocument();
            expect(
                screen.queryByRole('button', { name: /use this equation/i })
            ).not.toBeInTheDocument();
        });

        it('opens the editor empty, with the excluded clause visible beside it', () => {
            const zenith = corpusShipNamed('Zenith');
            render(<Harness ship={zenith} role="SUPPORTER_SHIELD" />);
            fireEvent.click(screen.getByRole('button', { name: /write an equation/i }));

            // Empty, not pre-filled with the passive's own stat/percentage — pre-filling would
            // count the passive as firing every turn, the assumption the derivation refuses to
            // make (owner ruling, brief).
            expect(screen.queryAllByLabelText(/basis weight/i)).toHaveLength(0);
            expect(screen.getByRole('button', { name: /^add stat$/i })).toBeInTheDocument();
            expect(
                screen.getByText(/Zenith shields for 50% of Attack at the start of the round/i)
            ).toBeInTheDocument();
        });

        it('refuses to save an empty equation', () => {
            const zenith = corpusShipNamed('Zenith');
            render(<Harness ship={zenith} role="SUPPORTER_SHIELD" />);
            fireEvent.click(screen.getByRole('button', { name: /write an equation/i }));
            fireEvent.click(screen.getByRole('button', { name: /save equation/i }));

            // No stat is on screen to "remove" — the refusal copy for a from-scratch draft with
            // no terms added at all must not presume one is there.
            expect(screen.getByRole('alert')).toHaveTextContent(
                'Add at least one stat with a weight above zero.'
            );
            expect(screen.queryByText(/will score/i)).not.toBeInTheDocument();
        });

        it('saving a positive term applies it, shown honestly, with no Restore offered', () => {
            const captured: OffFormulaApplyUpdate[] = [];
            const zenith = corpusShipNamed('Zenith');
            render(
                <Harness
                    ship={zenith}
                    role="SUPPORTER_SHIELD"
                    onUpdateCaptured={(u) => u && captured.push(u)}
                />
            );
            fireEvent.click(screen.getByRole('button', { name: /write an equation/i }));
            fireEvent.click(screen.getByRole('button', { name: /^add stat$/i }));
            fireEvent.change(screen.getAllByLabelText(/basis weight/i)[0], {
                target: { value: '0.5' },
            });
            fireEvent.click(screen.getByRole('button', { name: /save equation/i }));

            expect(
                screen.getByText(/Autogear will score Zenith with this equation on its next run\./i)
            ).toBeInTheDocument();
            expect(screen.getByText(/^Attack x0\.500$/)).toBeInTheDocument();
            // Restoring would write back an empty, unsaveable basis — there is nothing derived
            // to restore to, so the control must not appear at all.
            expect(
                screen.queryByRole('button', { name: /restore the derived equation/i })
            ).not.toBeInTheDocument();
            expect(
                screen.queryByRole('button', { name: /write an equation/i })
            ).not.toBeInTheDocument();

            const last = captured[captured.length - 1];
            expect(last.shipRole).toBe('SUPPORTER_SHIELD');
            expect(last.roleBasis.produces).toBe('shield');
        });

        // The control case: a ship whose derivation isn't empty still gets the ordinary Apply
        // control, never the write-from-scratch one.
        it('offers Apply, not Write an equation, for Cobalt/ATTACKER', () => {
            const cobalt = corpusShipNamed('Cobalt');
            render(<Harness ship={cobalt} role="ATTACKER" />);
            expect(screen.getByRole('button', { name: /use this equation/i })).toBeInTheDocument();
            expect(
                screen.queryByRole('button', { name: /write an equation/i })
            ).not.toBeInTheDocument();
        });
    }
);
