import React from 'react';

interface Tab {
    id: string;
    label: string;
    dataTutorial?: string;
    /** Optional secondary content shown after the label, e.g. a count. */
    badge?: React.ReactNode;
}

interface TabsProps {
    tabs: Tab[];
    activeTab: string;
    onChange: (tabId: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange }) => {
    return (
        <div className="mb-4 min-w-0">
            <div className="border-b border-dark-border overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-dark-border scrollbar-track-transparent">
                <nav className="-mb-px flex space-x-4 min-w-max" aria-label="Tabs">
                    {tabs.map((tab) => (
                        <button
                            aria-label={tab.label}
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
                        </button>
                    ))}
                </nav>
            </div>
        </div>
    );
};
