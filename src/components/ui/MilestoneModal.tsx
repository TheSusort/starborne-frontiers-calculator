import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import confetti from 'canvas-confetti';
import { Modal } from './layout/Modal';
import { Button } from './Button';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    milestoneCount: number | null;
}

// Pre-compute mirror tile positions on a sphere
const BALL_RADIUS = 56; // pixels
const TILE_SIZE = 12;
const ROWS = 9;

const mirrorTiles: {
    phi: number;
    theta: number;
    scale: number;
    shimmerDelay: number;
    shimmerDuration: number;
}[] = [];
for (let row = 1; row < ROWS; row++) {
    const phi = (Math.PI * row) / ROWS; // latitude: 0 (top) to PI (bottom)
    const rowRadius = Math.sin(phi);
    const tilesInRow = Math.max(4, Math.round(14 * rowRadius));
    for (let col = 0; col < tilesInRow; col++) {
        const theta = (2 * Math.PI * col) / tilesInRow; // longitude
        mirrorTiles.push({
            phi,
            theta,
            scale: 0.7 + Math.random() * 0.3,
            shimmerDelay: Math.random() * 2,
            shimmerDuration: 1 + Math.random() * 2,
        });
    }
}

const DiscoBall: React.FC<{ descended: boolean }> = ({ descended }) => (
    <div
        className="fixed left-1/2 -translate-x-1/2 transition-all duration-[2500ms] ease-out z-[90]"
        style={{ top: descended ? '0px' : '-250px' }}
    >
        {/* String */}
        <div className="w-[2px] h-12 bg-gradient-to-b from-gray-400 to-gray-600 mx-auto" />

        {/* Ball container with perspective */}
        <div
            className="relative mx-auto"
            style={{
                width: BALL_RADIUS * 2,
                height: BALL_RADIUS * 2,
                perspective: '600px',
            }}
        >
            {/* Outer glow */}
            <div
                className="absolute -inset-8 rounded-full pointer-events-none"
                style={{
                    background:
                        'radial-gradient(circle, rgba(255,255,255,0.2) 0%, transparent 70%)',
                    animation: 'glow-pulse 2s ease-in-out infinite alternate',
                }}
            />

            {/* 3D rotating sphere */}
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    position: 'relative',
                    transformStyle: 'preserve-3d',
                    animation: 'disco-spin 6s linear infinite',
                }}
            >
                {/* Mirror tiles placed on sphere surface */}
                {mirrorTiles.map((tile, i) => {
                    // Use transform chain to place tile on sphere:
                    // 1. rotateY to correct longitude
                    // 2. rotateX to correct latitude (phi=0 is top, so tilt from upward)
                    // 3. translateZ to push out along the now-outward normal
                    const thetaDeg = (tile.theta * 180) / Math.PI;
                    // phi goes 0 (top) to PI (bottom); offset by -90 so rotateX
                    // sweeps from -90° (top) through 0° (equator) to +90° (bottom)
                    const phiDeg = (tile.phi * 180) / Math.PI - 90;

                    return (
                        <div
                            key={i}
                            style={{
                                position: 'absolute',
                                width: `${TILE_SIZE}px`,
                                height: `${TILE_SIZE}px`,
                                left: '50%',
                                top: '50%',
                                marginLeft: `-${TILE_SIZE / 2}px`,
                                marginTop: `-${TILE_SIZE / 2}px`,
                                transform: `rotateY(${thetaDeg}deg) rotateX(${phiDeg}deg) translateZ(${BALL_RADIUS}px)`,
                                backfaceVisibility: 'visible',
                                background: `linear-gradient(135deg,
                                    rgba(255,255,255,${0.5 + tile.scale * 0.4}) 0%,
                                    rgba(210,215,230,${0.3 + tile.scale * 0.3}) 40%,
                                    rgba(160,165,180,${0.2 + tile.scale * 0.2}) 100%)`,
                                border: '0.5px solid rgba(255,255,255,0.2)',
                                borderRadius: '1px',
                                boxShadow: `inset 0 0 3px rgba(255,255,255,${0.2 + tile.scale * 0.3})`,
                                animation: `mirror-shimmer ${tile.shimmerDuration}s ease-in-out ${tile.shimmerDelay}s infinite alternate`,
                            }}
                        />
                    );
                })}

                {/* Inner sphere for base color / shading */}
                <div
                    className="absolute rounded-full"
                    style={{
                        width: BALL_RADIUS * 1.85,
                        height: BALL_RADIUS * 1.85,
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        background:
                            'radial-gradient(ellipse at 35% 30%, rgba(192,192,200,0.5) 0%, rgba(128,128,144,0.4) 35%, rgba(80,80,96,0.35) 65%, rgba(48,48,64,0.3) 100%)',
                        boxShadow: '0 0 40px rgba(255,255,255,0.4), 0 0 80px rgba(255,255,255,0.2)',
                    }}
                />
                {/* Perpendicular disc to fill in gaps */}
                <div
                    className="absolute rounded-full"
                    style={{
                        width: BALL_RADIUS * 1.85,
                        height: BALL_RADIUS * 1.85,
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%) rotateY(90deg)',
                        background:
                            'radial-gradient(ellipse at 35% 30%, rgba(184,184,192,0.5) 0%, rgba(120,120,136,0.4) 35%, rgba(72,72,88,0.35) 65%, rgba(40,40,56,0.3) 100%)',
                    }}
                />
            </div>
        </div>
    </div>
);

const LightBeam: React.FC<{
    color: string;
    delay: number;
    duration: number;
    startAngle: number;
    sweepRange: number;
    originX: string;
    width?: number;
}> = ({ color, delay, duration, startAngle, sweepRange, originX, width = 6 }) => (
    <div
        className="absolute top-0 pointer-events-none"
        style={
            {
                left: originX,
                width: `${width}px`,
                height: '200%',
                background: `linear-gradient(180deg, ${color} 0%, transparent 70%)`,
                transformOrigin: 'top center',
                animation: `beam-sweep ${duration}s ease-in-out ${delay}s infinite alternate`,
                '--beam-start': `${startAngle}deg`,
                '--beam-end': `${startAngle + sweepRange}deg`,
                opacity: 0.5,
                filter: 'blur(4px)',
            } as React.CSSProperties
        }
    />
);

const FloorLight: React.FC<{
    color: string;
    size: number;
    x: string;
    y: string;
    delay: number;
}> = ({ color, size, x, y, delay }) => (
    <div
        className="absolute rounded-full pointer-events-none"
        style={{
            left: x,
            top: y,
            width: `${size}px`,
            height: `${size}px`,
            background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
            animation: `floor-pulse 2s ease-in-out ${delay}s infinite alternate`,
            opacity: 0.35,
            filter: 'blur(12px)',
        }}
    />
);

const DiscoOverlay: React.FC<{ descended: boolean }> = ({ descended }) => {
    return createPortal(
        <div className="fixed inset-0 z-[85] pointer-events-none overflow-hidden">
            {/* Ambient color cycling across the whole viewport */}
            <div
                className="absolute inset-0"
                style={{ animation: 'color-cycle 4s linear infinite' }}
            />

            {/* Light beams — originate from top center (disco ball) and sweep across the screen */}
            <LightBeam
                color="rgba(255, 0, 255, 0.5)"
                delay={0}
                duration={3}
                startAngle={-50}
                sweepRange={40}
                originX="50%"
                width={8}
            />
            <LightBeam
                color="rgba(0, 255, 255, 0.5)"
                delay={0.5}
                duration={2.5}
                startAngle={-25}
                sweepRange={50}
                originX="50%"
                width={8}
            />
            <LightBeam
                color="rgba(255, 255, 0, 0.5)"
                delay={1}
                duration={3.5}
                startAngle={15}
                sweepRange={-40}
                originX="50%"
                width={8}
            />
            <LightBeam
                color="rgba(255, 100, 0, 0.5)"
                delay={0.3}
                duration={2.8}
                startAngle={-15}
                sweepRange={60}
                originX="50%"
                width={8}
            />
            <LightBeam
                color="rgba(0, 255, 100, 0.5)"
                delay={0.7}
                duration={3.2}
                startAngle={25}
                sweepRange={-50}
                originX="50%"
                width={8}
            />
            <LightBeam
                color="rgba(200, 0, 255, 0.5)"
                delay={1.2}
                duration={2.2}
                startAngle={-35}
                sweepRange={70}
                originX="50%"
                width={8}
            />
            <LightBeam
                color="rgba(255, 50, 150, 0.4)"
                delay={0.1}
                duration={4}
                startAngle={5}
                sweepRange={-60}
                originX="50%"
                width={6}
            />
            <LightBeam
                color="rgba(50, 200, 255, 0.4)"
                delay={1.5}
                duration={3.8}
                startAngle={-45}
                sweepRange={80}
                originX="50%"
                width={6}
            />

            {/* Floor light spots scattered across the viewport */}
            <FloorLight color="rgba(255, 0, 255, 0.7)" size={150} x="5%" y="75%" delay={0} />
            <FloorLight color="rgba(0, 255, 255, 0.7)" size={120} x="80%" y="65%" delay={0.5} />
            <FloorLight color="rgba(255, 255, 0, 0.7)" size={130} x="35%" y="85%" delay={1} />
            <FloorLight color="rgba(0, 255, 100, 0.7)" size={100} x="15%" y="45%" delay={1.5} />
            <FloorLight color="rgba(255, 100, 0, 0.7)" size={110} x="90%" y="80%" delay={0.8} />
            <FloorLight color="rgba(200, 0, 255, 0.6)" size={140} x="60%" y="90%" delay={0.3} />
            <FloorLight color="rgba(255, 50, 150, 0.6)" size={90} x="50%" y="55%" delay={1.2} />
            <FloorLight color="rgba(0, 200, 255, 0.6)" size={120} x="25%" y="70%" delay={0.6} />

            {/* Floating sparkles across the whole viewport */}
            {Array.from({ length: 40 }).map((_, i) => (
                <div
                    key={i}
                    className="absolute"
                    style={{
                        left: `${2 + Math.random() * 96}%`,
                        top: `-5%`,
                        fontSize: `${8 + Math.random() * 14}px`,
                        animation: `sparkle-drift ${4 + Math.random() * 6}s linear ${Math.random() * 4}s infinite`,
                        color: [
                            '#ff00ff',
                            '#00ffff',
                            '#ffff00',
                            '#ff6600',
                            '#00ff00',
                            '#ff3399',
                            '#6633ff',
                            '#00ccff',
                        ][i % 8],
                    }}
                >
                    &#10022;
                </div>
            ))}

            {/* Disco ball */}
            <DiscoBall descended={descended} />
        </div>,
        document.body
    );
};

const discoStyles = `
    @keyframes disco-spin {
        from { transform: rotateY(0deg); }
        to { transform: rotateY(360deg); }
    }
    @keyframes mirror-shimmer {
        0% { opacity: 0.3; }
        100% { opacity: 1; }
    }
    @keyframes glow-pulse {
        0% { opacity: 0.5; transform: scale(0.9); }
        100% { opacity: 1; transform: scale(1.15); }
    }
    @keyframes beam-sweep {
        0% { transform: rotate(var(--beam-start)); }
        100% { transform: rotate(var(--beam-end)); }
    }
    @keyframes floor-pulse {
        0% { opacity: 0.1; transform: scale(0.7); }
        100% { opacity: 0.5; transform: scale(1.3); }
    }
    @keyframes color-cycle {
        0% { background-color: rgba(255, 0, 255, 0.04); }
        14% { background-color: rgba(0, 255, 255, 0.04); }
        28% { background-color: rgba(255, 255, 0, 0.04); }
        42% { background-color: rgba(255, 0, 100, 0.04); }
        57% { background-color: rgba(0, 255, 100, 0.04); }
        71% { background-color: rgba(100, 0, 255, 0.04); }
        85% { background-color: rgba(255, 150, 0, 0.04); }
        100% { background-color: rgba(255, 0, 255, 0.04); }
    }
    @keyframes text-glow {
        0% { text-shadow: 0 0 10px #ff00ff, 0 0 30px #ff00ff, 0 0 50px #ff00ff; }
        25% { text-shadow: 0 0 10px #00ffff, 0 0 30px #00ffff, 0 0 50px #00ffff; }
        50% { text-shadow: 0 0 10px #ffff00, 0 0 30px #ffff00, 0 0 50px #ffff00; }
        75% { text-shadow: 0 0 10px #00ff00, 0 0 30px #00ff00, 0 0 50px #00ff00; }
        100% { text-shadow: 0 0 10px #ff00ff, 0 0 30px #ff00ff, 0 0 50px #ff00ff; }
    }
    @keyframes sparkle-drift {
        0% { transform: translateY(0) rotate(0deg); opacity: 0; }
        5% { opacity: 1; }
        90% { opacity: 0.8; }
        100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
    }
`;

export const MilestoneModal: React.FC<Props> = ({ isOpen, onClose, milestoneCount }) => {
    const [descended, setDescended] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const descentTimer = setTimeout(() => setDescended(true), 100);

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

            return () => {
                clearTimeout(descentTimer);
                setDescended(false);
            };
        } else {
            setDescended(false);
        }
    }, [isOpen]);

    return (
        <>
            {isOpen && <style>{discoStyles}</style>}
            {isOpen && <DiscoOverlay descended={descended} />}

            <Modal isOpen={isOpen} onClose={onClose} title="Milestone Reached!">
                <div className="relative space-y-4 text-center">
                    <p
                        className="text-2xl font-bold"
                        style={{ animation: 'text-glow 3s ease-in-out infinite' }}
                    >
                        {milestoneCount} Autogear Runs!
                    </p>
                    <p className="text-theme-text">
                        Thank you for using the Starborne Planner! Your continued use means a lot.
                        If you&apos;re enjoying the app and want to support its development,
                        consider buying me a coffee.
                    </p>
                    <div className="pt-4">
                        <Button
                            variant="primary"
                            className="justify-center gap-2"
                            onClick={() =>
                                window.open(
                                    'https://www.buymeacoffee.com/starborneplanner',
                                    '_blank'
                                )
                            }
                        >
                            Buy me a coffee
                        </Button>

                        <p className="text-theme-text text-sm pt-2">
                            No pressure, the app will be free as long as I can keep below the free
                            tier of the hosting provider.
                        </p>
                    </div>
                </div>
            </Modal>
        </>
    );
};
