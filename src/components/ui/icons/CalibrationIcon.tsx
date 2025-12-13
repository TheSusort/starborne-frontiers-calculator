import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

export const CalibrationIcon: React.FC<IconProps> = ({ className = '', ...props }) => {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-3 w-3 ${className}`}
            viewBox="0 0 11.799384 10.224028"
            fill="currentColor"
            stroke="currentColor"
            role="img"
            aria-hidden="true"
            {...props}
        >
            <path
                strokeWidth="0.1"
                strokeLinecap="round"
                d="M 0.4503085,1.237986 1.0987443,2.36355 3.3954,6.34987 5.1870218,9.459964 6.0567362,7.964811 5.1848514,6.451466 2.1460189,1.239536 Z m 2.2817728,0.00212 0.8749853,1.500735 0.1996261,2e-4 A 0.25270851,0.25270851 0 0 1 3.8936641,2.724195 L 11.391346,2.732565 12.249691,1.249089 6.3501033,1.243409 Z M 9.3922432,3.235695 5.4779601,9.964999 6.3403364,11.462014 9.2950398,6.355556 11.099116,3.237658 Z"
            />
        </svg>
    );
};
