import React from 'react';
import { Link } from 'react-router-dom';
import { CHANGELOG } from '../../constants/changelog';

const MAX_CHANGES = 4;

/** The latest released changelog entry; the full list lives on the documentation page. */
export const WhatsNewCard: React.FC = () => {
    const latest = CHANGELOG[0];
    if (!latest) return null;

    return (
        <div className="card space-y-3">
            <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xl font-semibold text-theme-text">
                    What&apos;s new in {latest.version}
                </h3>
                <span className="text-sm text-theme-text-secondary">{latest.date}</span>
            </div>
            <ul className="list-disc pl-5 space-y-1 text-sm text-theme-text">
                {latest.changes.slice(0, MAX_CHANGES).map((change) => (
                    <li key={change}>{change}</li>
                ))}
            </ul>
            <Link
                to="/documentation#changelog"
                className="text-primary hover:text-primary-hover text-sm inline-block"
            >
                Full changelog
            </Link>
        </div>
    );
};
