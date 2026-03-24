import { useEffect, useRef, memo } from 'react';

interface Star {
    x: number;
    y: number;
    size: number;
    brightness: number;
    twinkleSpeed: number;
    twinkleOffset: number;
}

interface ShootingStar {
    x: number;
    y: number;
    angle: number;
    speed: number;
    length: number;
    life: number;
    maxLife: number;
    brightness: number;
}

export const SynthwaveCanvas = memo(({ animate = true }: { animate?: boolean }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const starsRef = useRef<Star[]>([]);
    const gridOffsetRef = useRef(0);
    const shootingStarsRef = useRef<ShootingStar[]>([]);
    const lastShootingStarRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Generate stars once
        if (starsRef.current.length === 0) {
            for (let i = 0; i < 150; i++) {
                starsRef.current.push({
                    x: Math.random(),
                    y: Math.random() * 0.5,
                    size: Math.random() * 1.5 + 0.3,
                    brightness: Math.random() * 0.6 + 0.2,
                    twinkleSpeed: Math.random() * 2 + 1,
                    twinkleOffset: Math.random() * Math.PI * 2,
                });
            }
        }

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = canvas.offsetWidth * dpr;
            canvas.height = canvas.offsetHeight * dpr;
            ctx.scale(dpr, dpr);
        };

        resize();
        window.addEventListener('resize', resize);

        const render = (time: number) => {
            const w = canvas.offsetWidth;
            const h = canvas.offsetHeight;
            const horizonY = h * 0.45;

            ctx.clearRect(0, 0, w, h);

            // === SKY ===
            const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
            skyGrad.addColorStop(0, '#0a0515');
            skyGrad.addColorStop(0.4, '#1a0a30');
            skyGrad.addColorStop(0.7, '#2a1045');
            skyGrad.addColorStop(1, '#3d1555');
            ctx.fillStyle = skyGrad;
            ctx.fillRect(0, 0, w, horizonY);

            // Nebula/pink patches on sides
            const nebulaLeft = ctx.createRadialGradient(
                w * 0.1,
                horizonY * 0.6,
                0,
                w * 0.1,
                horizonY * 0.6,
                w * 0.25
            );
            nebulaLeft.addColorStop(0, 'rgba(180, 40, 100, 0.15)');
            nebulaLeft.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = nebulaLeft;
            ctx.fillRect(0, 0, w * 0.4, horizonY);

            const nebulaRight = ctx.createRadialGradient(
                w * 0.9,
                horizonY * 0.5,
                0,
                w * 0.9,
                horizonY * 0.5,
                w * 0.2
            );
            nebulaRight.addColorStop(0, 'rgba(120, 30, 80, 0.1)');
            nebulaRight.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = nebulaRight;
            ctx.fillRect(w * 0.6, 0, w * 0.4, horizonY);

            // === STARS ===
            for (const star of starsRef.current) {
                const twinkle = animate
                    ? Math.sin(time * 0.001 * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7
                    : 1;
                const alpha = star.brightness * twinkle;
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.beginPath();
                ctx.arc(star.x * w, star.y * h, star.size, 0, Math.PI * 2);
                ctx.fill();
            }

            // === SHOOTING STARS ===
            if (animate) {
                // Spawn new shooting stars occasionally
                if (time - lastShootingStarRef.current > 2000 + Math.random() * 4000) {
                    lastShootingStarRef.current = time;
                    const angle = Math.PI * 0.15 + Math.random() * Math.PI * 0.2;
                    shootingStarsRef.current.push({
                        x: Math.random() * w * 0.8 + w * 0.1,
                        y: Math.random() * horizonY * 0.4,
                        angle,
                        speed: 4 + Math.random() * 4,
                        length: 60 + Math.random() * 80,
                        life: 0,
                        maxLife: 40 + Math.random() * 30,
                        brightness: 0.6 + Math.random() * 0.4,
                    });
                }

                // Update and draw shooting stars
                shootingStarsRef.current = shootingStarsRef.current.filter((s) => {
                    s.life++;
                    s.x += Math.cos(s.angle) * s.speed;
                    s.y += Math.sin(s.angle) * s.speed;

                    const progress = s.life / s.maxLife;
                    const alpha = s.brightness * (1 - progress);
                    const tailX = s.x - Math.cos(s.angle) * s.length * (1 - progress * 0.5);
                    const tailY = s.y - Math.sin(s.angle) * s.length * (1 - progress * 0.5);

                    // Glowing trail
                    const grad = ctx.createLinearGradient(tailX, tailY, s.x, s.y);
                    grad.addColorStop(0, `rgba(255, 255, 255, 0)`);
                    grad.addColorStop(0.6, `rgba(200, 180, 255, ${alpha * 0.4})`);
                    grad.addColorStop(1, `rgba(255, 255, 255, ${alpha})`);

                    ctx.strokeStyle = grad;
                    ctx.lineWidth = 1.5;
                    ctx.shadowColor = `rgba(200, 150, 255, ${alpha})`;
                    ctx.shadowBlur = 8;
                    ctx.beginPath();
                    ctx.moveTo(tailX, tailY);
                    ctx.lineTo(s.x, s.y);
                    ctx.stroke();

                    // Bright head
                    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                    ctx.beginPath();
                    ctx.arc(s.x, s.y, 1.2, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.shadowBlur = 0;
                    ctx.shadowColor = 'transparent';

                    return s.life < s.maxLife;
                });
            }

            // === SUN ===
            const sunR = h * 0.18;
            const sunX = w / 2;
            const sunY = horizonY - sunR * 0.6;

            // Sun outer glow
            const outerGlow = ctx.createRadialGradient(sunX, sunY, sunR, sunX, sunY, sunR * 4);
            outerGlow.addColorStop(0, 'rgba(255, 150, 180, 0.25)');
            outerGlow.addColorStop(0.3, 'rgba(200, 80, 150, 0.1)');
            outerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = outerGlow;
            ctx.fillRect(0, 0, w, horizonY + sunR);

            // Sun body
            ctx.save();
            ctx.beginPath();
            ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
            ctx.clip();

            const sunGrad = ctx.createLinearGradient(sunX, sunY - sunR, sunX, sunY + sunR);
            sunGrad.addColorStop(0, '#ffccaa');
            sunGrad.addColorStop(0.3, '#ff99aa');
            sunGrad.addColorStop(0.6, '#ee6688');
            sunGrad.addColorStop(1, '#aa3366');
            ctx.fillStyle = sunGrad;
            ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);

            // Horizontal stripes through sun (bottom half, matching sky color)
            // Stripes get thicker and more spaced toward bottom
            const stripes = [
                { offset: -0.17, height: 2 },
                { offset: -0.05, height: 3.5 },
                { offset: 0.08, height: 6 },
                { offset: 0.22, height: 9 },
                { offset: 0.38, height: 13 },
            ];
            for (const stripe of stripes) {
                const stripeY = sunY + sunR * stripe.offset;
                // Use sky gradient color at this Y position
                const skyT = stripeY / horizonY;
                const r = Math.round(10 + skyT * 50);
                const g = Math.round(5 + skyT * 15);
                const b = Math.round(21 + skyT * 60);
                ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                ctx.fillRect(sunX - sunR, stripeY, sunR * 2, stripe.height);
            }
            ctx.restore();

            // === MOUNTAINS ===
            ctx.fillStyle = '#0d0620';
            ctx.beginPath();
            ctx.moveTo(-10, horizonY);
            // Mountain peaks — low, rounded silhouettes like the reference
            const mountainScale = Math.max(h * 0.012, Math.min(h, w) * 0.015);
            const peakHeights = [
                [-0.05, 1],
                [0.0, 2],
                [0.05, 3],
                [0.08, 2.5],
                [0.12, 4],
                [0.16, 3],
                [0.2, 5],
                [0.25, 4],
                [0.3, 3.5],
                [0.35, 4.5],
                [0.4, 3],
                [0.44, 2],
                [0.48, 1],
                [0.5, 0.5],
                [0.52, 1],
                [0.56, 2],
                [0.6, 3],
                [0.65, 4.5],
                [0.7, 3.5],
                [0.75, 4],
                [0.8, 5],
                [0.84, 3],
                [0.88, 4],
                [0.92, 2.5],
                [0.95, 3],
                [1.0, 2],
                [1.05, 1],
            ];
            for (const [px, peakH] of peakHeights) {
                ctx.lineTo(px * w, horizonY - peakH * mountainScale);
            }
            ctx.lineTo(w + 10, horizonY);
            ctx.closePath();
            ctx.fill();

            // Mountain subtle highlight
            ctx.fillStyle = 'rgba(80, 30, 80, 0.15)';
            ctx.fill();

            // === GROUND (below horizon) ===
            const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
            groundGrad.addColorStop(0, '#1a0835');
            groundGrad.addColorStop(0.05, '#0d0420');
            groundGrad.addColorStop(1, '#050210');
            ctx.fillStyle = groundGrad;
            ctx.fillRect(0, horizonY, w, h - horizonY);

            // === HORIZON GLOW LINE ===
            const horizGlow = ctx.createLinearGradient(0, horizonY - 8, 0, horizonY + 15);
            horizGlow.addColorStop(0, 'rgba(200, 100, 255, 0)');
            horizGlow.addColorStop(0.4, 'rgba(200, 100, 255, 0.6)');
            horizGlow.addColorStop(0.5, 'rgba(220, 120, 255, 0.9)');
            horizGlow.addColorStop(0.6, 'rgba(200, 100, 255, 0.6)');
            horizGlow.addColorStop(1, 'rgba(200, 100, 255, 0)');
            ctx.fillStyle = horizGlow;
            ctx.fillRect(0, horizonY - 8, w, 23);

            // === PERSPECTIVE GRID ===
            const gridBottom = h;
            const gridHeight = gridBottom - horizonY;
            const vanishX = w / 2;

            // Enable neon glow for grid
            ctx.shadowColor = 'rgba(200, 100, 255, 1)';
            ctx.shadowBlur = 12;

            // Horizontal grid lines
            const numHLines = 25;
            const gridSpeed = animate ? gridOffsetRef.current : 0;
            for (let i = 0; i <= numHLines; i++) {
                const rawT = (i / numHLines + gridSpeed) % 1;
                const perspT = Math.pow(rawT, 3);
                const y = horizonY + perspT * gridHeight;
                const alpha = Math.min(perspT * 1.5, 0.7);
                const lineWidth = 0.3 + perspT * 3.5;

                ctx.shadowBlur = 8 + perspT * 16;
                ctx.strokeStyle = `rgba(180, 80, 255, ${alpha})`;
                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                ctx.stroke();
            }

            // Vertical grid lines as tapered trapezoids (wide at bottom, thin at horizon)
            const aspectRatio = w / h;
            const numVLines = aspectRatio > 1.2 ? 60 : 30;
            const spreadBottom = Math.max(w * 10, h * 12);
            const horizonSpread = Math.max(h * 0.2, w * 0.15);
            for (let i = 0; i <= numVLines; i++) {
                const t = i / numVLines;
                const bottomX = -spreadBottom * 0.3 + t * spreadBottom;
                const distFromCenter = t - 0.5;
                const topX = vanishX + distFromCenter * horizonSpread;
                const absFromCenter = Math.abs(distFromCenter);
                // Width at bottom (wide) and top (hairline)
                const bottomW = Math.max(6 - absFromCenter * 9, 0.3);
                const topW = 0.2;
                const alpha = 0.55 - absFromCenter * 0.5;

                ctx.shadowBlur = Math.max(20 - absFromCenter * 28, 2);
                ctx.fillStyle = `rgba(180, 80, 255, ${Math.max(alpha, 0.08)})`;
                ctx.beginPath();
                ctx.moveTo(topX - topW / 2, horizonY);
                ctx.lineTo(topX + topW / 2, horizonY);
                ctx.lineTo(bottomX + bottomW / 2, gridBottom);
                ctx.lineTo(bottomX - bottomW / 2, gridBottom);
                ctx.closePath();
                ctx.fill();
            }

            // Reset shadow
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';

            // Center glow on grid (brighter near center vanishing point)
            const centerGlow = ctx.createRadialGradient(
                vanishX,
                horizonY + 20,
                0,
                vanishX,
                horizonY + gridHeight * 0.3,
                w * 0.4
            );
            centerGlow.addColorStop(0, 'rgba(180, 80, 255, 0.15)');
            centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = centerGlow;
            ctx.fillRect(0, horizonY, w, gridHeight);

            // === FADED OVERLAY ===
            const overlay = ctx.createLinearGradient(0, 0, 0, h);
            overlay.addColorStop(0, 'rgba(13, 10, 46, 0.6)');
            overlay.addColorStop(0.45, 'rgba(13, 10, 46, 0.35)');
            overlay.addColorStop(0.55, 'rgba(13, 10, 46, 0.35)');
            overlay.addColorStop(1, 'rgba(13, 10, 46, 0.65)');
            ctx.fillStyle = overlay;
            ctx.fillRect(0, 0, w, h);

            if (animate) {
                gridOffsetRef.current += 0.002;
                if (gridOffsetRef.current >= 1) gridOffsetRef.current = 0;
                animationRef.current = requestAnimationFrame(render);
            }
        };

        if (animate) {
            animationRef.current = requestAnimationFrame(render);
        } else {
            render(0);
        }

        return () => {
            window.removeEventListener('resize', resize);
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [animate]);

    return <canvas ref={canvasRef} />;
});

SynthwaveCanvas.displayName = 'SynthwaveCanvas';
