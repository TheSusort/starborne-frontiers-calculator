import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Modal } from './layout/Modal';
import { Button } from './Button';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    milestoneCount: number | null;
}

export const MilestoneModal: React.FC<Props> = ({ isOpen, onClose, milestoneCount }) => {
    useEffect(() => {
        if (isOpen) {
            const duration = 2000;
            const end = Date.now() + duration;

            const frame = () => {
                confetti({
                    particleCount: 3,
                    angle: 60,
                    spread: 55,
                    origin: { x: 0, y: 0.6 },
                });
                confetti({
                    particleCount: 3,
                    angle: 120,
                    spread: 55,
                    origin: { x: 1, y: 0.6 },
                });

                if (Date.now() < end) {
                    requestAnimationFrame(frame);
                }
            };

            frame();
        }
    }, [isOpen]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Milestone Reached!">
            <div className="space-y-4 text-center">
                <p className="text-xl font-semibold">{milestoneCount} Autogear Runs!</p>
                <p className="text-gray-300">
                    Thank you for using the Starborne Planner! Your continued use means a lot. If
                    you&apos;re enjoying the app and want to support its development, consider
                    buying me a coffee.
                </p>
                <div className="pt-4">
                    <Button
                        variant="primary"
                        className="justify-center gap-2"
                        onClick={() =>
                            window.open('https://www.buymeacoffee.com/starborneplanner', '_blank')
                        }
                    >
                        Buy me a coffee
                    </Button>

                    <p className="text-gray-300 text-sm pt-2">
                        No pressure, the app will be free as long as I can keep below the free tier
                        of the hosting provider.
                    </p>
                </div>
            </div>
        </Modal>
    );
};
