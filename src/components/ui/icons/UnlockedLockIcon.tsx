import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

export const UnlockedLockIcon: React.FC<IconProps> = ({ className = '', ...props }) => {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 unlocked ${className}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            role="img"
            aria-hidden="true"
            {...props}
        >
            <defs>
                <mask id="mask-powermask-path-effect4132" maskUnits="userSpaceOnUse">
                    <path id="mask-powermask-path-effect4132_box" d="m2 1h20v23h-20z" fill="#fff" />
                    <rect
                        x="13.737"
                        y="6.8416"
                        width="5.0534"
                        height="2.0496"
                        d="m 13.736565,6.8415651 h 5.053393 v 2.0496281 h -5.053393 z"
                        fill="none"
                        stroke="#000"
                        strokeWidth="2.1531"
                    />
                </mask>
            </defs>
            <path
                d="m8 11v-4c0-5.3333 8-5.3333 8 0v4h2c1.1046 0 2 0.89543 2 2v7c0 1.1046-0.89543 2-2 2h-12c-1.1046 0-2-0.89543-2-2v-7c0-1.1046 0.89543-2 2-2zm8.0466-3.9873c-0.016275-5.096-8.0033-4.9871-8.0233 0.019012-0.005291 1.3228-0.015873 3.9683-0.015873 3.9683h8.0519s-0.0085-2.6582-0.01273-3.9873z"
                mask="url(#mask-powermask-path-effect4132)"
            />
        </svg>
    );
};
