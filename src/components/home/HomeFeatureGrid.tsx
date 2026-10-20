import React from 'react';
import { Chip } from '../ui/Chip';
import { FeatureCard } from '../ui/FeatureCard';
import { HOME_FEATURE_GROUPS, isNewFeature } from './homeFeatures';

export const HomeFeatureGrid: React.FC = () => {
    const now = new Date();
    return (
        <div className="space-y-8">
            {HOME_FEATURE_GROUPS.map((group) => (
                <div key={group.title} className="space-y-4">
                    <h3 className="text-lg font-semibold text-theme-text">{group.title}</h3>
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                        {group.features.map((feature) => (
                            <div key={feature.to} className="relative flex flex-col">
                                <FeatureCard
                                    to={feature.to}
                                    icon={feature.icon}
                                    title={feature.title}
                                    description={feature.description}
                                    className="h-full"
                                />
                                {isNewFeature(feature.addedOn, now) && (
                                    <Chip variant="accent" className="absolute top-3 right-3">
                                        New
                                    </Chip>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};
