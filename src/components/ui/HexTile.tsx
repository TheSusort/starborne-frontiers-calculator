import React from 'react';

/** A pointy-top hexagon, the shape of `hexGeometry`'s board cells. */
const HEX_CLIP = '[clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]';

interface HexTileProps {
    /** Tailwind background class for the hex's rim. */
    rimClassName?: string;
    /** Tailwind classes for the hex's face (background, opacity). */
    faceClassName?: string;
    className?: string;
    children?: React.ReactNode;
}

/** A non-interactive pointy-top hex cell that fills its box: a coloured rim around a face that
 *  clips its children to the hexagon. `HexButton` is the clickable, rotated board cell instead. */
export const HexTile: React.FC<HexTileProps> = ({
    rimClassName = 'bg-dark-border',
    faceClassName = 'bg-dark',
    className = '',
    children,
}) => (
    <div className={`relative h-full w-full ${HEX_CLIP} ${rimClassName} ${className}`}>
        <div className={`absolute inset-[2px] overflow-hidden ${HEX_CLIP} ${faceClassName}`}>
            {children}
        </div>
    </div>
);
