import React from 'react';

interface Tab {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange }) => {
  return (
    <div className="mb-4">
      <div className="border-b border-gray-700">
        <nav className="-mb-px flex space-x-4" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              aria-label={tab.label}
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`
                                whitespace-nowrap py-3 px-4 border-b-2 font-medium text-sm
                                ${
                                  activeTab === tab.id
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300'
                                }
                            `}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
};
