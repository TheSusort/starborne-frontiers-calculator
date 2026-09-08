import React from 'react';
import { LucideIcon, Gavel, TriangleAlert, Lightbulb } from 'lucide-react';

/** `rule` — a locked game mechanic the reader must not argue with.
 *  `mistake` — a classic error the copy is warning against.
 *  `tip` — advice that helps but is not load-bearing. */
export type CalloutVariant = 'rule' | 'mistake' | 'tip';

interface VariantStyle {
    icon: LucideIcon;
    /** Fallback heading when the caller passes no `title`. */
    label: string;
    /** Accent border + tinted ground, applied to the outer box. */
    box: string;
    /** Icon and heading colour. */
    accent: string;
}

/** Three voices, three hues: a locked rule, an error the copy is warning against, and an aside.
 *  A reader skimming for the rules needs to tell them apart before reading a word, which is why
 *  this is the one component on the page that spends colour on its own state. */
const VARIANTS: Record<CalloutVariant, VariantStyle> = {
    rule: {
        icon: Gavel,
        label: 'Rule',
        box: 'border-l-primary bg-primary/5',
        accent: 'text-primary',
    },
    mistake: {
        icon: TriangleAlert,
        label: 'Common mistake',
        box: 'border-l-red-500 bg-red-500/5',
        accent: 'text-red-400',
    },
    tip: {
        icon: Lightbulb,
        label: 'Tip',
        box: 'border-l-sky-500 bg-sky-500/5',
        accent: 'text-sky-400',
    },
};

interface CalloutProps {
    variant?: CalloutVariant;
    /** Overrides the variant's default label. Use it to put the takeaway in the heading. */
    title?: string;
    children: React.ReactNode;
    className?: string;
}

/** An icon-led, accent-bordered box for a fact that must survive skim-reading.
 *  Deliberately not the `card` class: a callout sits INSIDE prose and has to read as an
 *  interruption of it, where `card` reads as a container of grouped content. */
export const Callout: React.FC<CalloutProps> = ({
    variant = 'rule',
    title,
    children,
    className = '',
}) => {
    const { icon: Icon, label, box, accent } = VARIANTS[variant];
    return (
        <div
            data-callout={variant}
            className={`border border-dark-border border-l-4 p-4 flex gap-3 ${box} ${className}`}
        >
            <Icon className={`${accent} shrink-0 mt-0.5`} size={18} aria-hidden="true" />
            <div className="min-w-0 space-y-1">
                <p className={`${accent} text-xs font-semibold uppercase tracking-wide`}>
                    {title ?? label}
                </p>
                <div className="text-sm text-theme-text space-y-2">{children}</div>
            </div>
        </div>
    );
};
