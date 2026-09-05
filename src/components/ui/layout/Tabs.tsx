import React from 'react';

interface Tab {
    id: string;
    label: string;
    dataTutorial?: string;
    /** Optional secondary content shown after the label, e.g. a count. */
    badge?: React.ReactNode;
    /**
     * Words a screen reader can read for `badge`, e.g. "5 pieces at level
     * 16, 42 percent levelling priority" for a `5 · 42%` badge. `badge` is
     * arbitrary `ReactNode` and the button's accessible name must stay
     * `label`-only (see `aria-label` below), so without this the badge's
     * information reaches no screen-reader user at all. Ignored when
     * `badge` is not set.
     */
    badgeDescription?: string;
}

interface TabsProps {
    tabs: Tab[];
    activeTab: string;
    onChange: (tabId: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange }) => {
    const idPrefix = React.useId();
    return (
        <div className="mb-4 min-w-0">
            <div className="border-b border-dark-border overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-dark-border scrollbar-track-transparent">
                <nav className="-mb-px flex space-x-4 min-w-max" aria-label="Tabs">
                    {tabs.map((tab) => {
                        const badgeDescriptionId =
                            tab.badge !== undefined && tab.badgeDescription
                                ? `${idPrefix}-${tab.id}-badge-description`
                                : undefined;
                        return (
                            <button
                                aria-label={tab.label}
                                aria-describedby={badgeDescriptionId}
                                key={tab.id}
                                onClick={() => onChange(tab.id)}
                                data-tutorial={tab.dataTutorial}
                                className={`
                                whitespace-nowrap py-3 px-4 border-b-2 font-medium text-sm
                                ${
                                    activeTab === tab.id
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-theme-text-secondary hover:text-theme-text hover:border-dark-border'
                                }
                            `}
                                aria-current={activeTab === tab.id ? 'page' : undefined}
                            >
                                <span className="flex items-center gap-2">
                                    <span>{tab.label}</span>
                                    {tab.badge !== undefined && (
                                        <span className="text-xxs text-theme-text-secondary font-normal">
                                            {tab.badge}
                                        </span>
                                    )}
                                </span>
                                {badgeDescriptionId && (
                                    <span id={badgeDescriptionId} className="sr-only">
                                        {tab.badgeDescription}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </nav>
            </div>
        </div>
    );
};
