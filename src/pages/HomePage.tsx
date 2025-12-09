import React from 'react';
import { Link } from 'react-router-dom';
import {
    Upload,
    Eye,
    Zap,
    Ship,
    Wrench,
    Swords,
    Save,
    MapPin,
    BarChart3,
    Calculator,
    MessageCircle,
    Github,
    Database,
} from 'lucide-react';
import { BackupRestoreData } from '../components/import/BackupRestoreData';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { ImportButton } from '../components/import/ImportButton';
import { HeroCarousel } from '../components/home/HeroCarousel';
import { Button, SectionHeader, IconBadge, FeatureCard, QuickStartCard } from '../components/ui';

const HomePage: React.FC = () => {
    return (
        <>
            <Seo {...SEO_CONFIG.home} />
            <div className="space-y-12">
                {/* Hero Carousel */}
                <HeroCarousel />

                {/* Quick Start Guide */}
                <section className="space-y-6">
                    <SectionHeader
                        title="Quick Start Guide"
                        subtitle="Get started in three simple steps"
                    />
                    <div className="grid gap-6 md:grid-cols-3">
                        <QuickStartCard
                            icon={Upload}
                            iconGradientFrom="from-blue-600"
                            iconGradientTo="to-blue-800"
                            title="1. Import Data"
                            videoSrc="/videos/export.mov"
                            description={
                                <>
                                    <Link
                                        to="/documentation#getting-started"
                                        className="text-primary hover:text-primary-hover"
                                    >
                                        Export your game data
                                    </Link>{' '}
                                    from Starborne Frontiers and import it here. This will populate
                                    your ships, gear, and engineering stats.
                                </>
                            }
                            action={<ImportButton className="w-full" />}
                        />
                        <QuickStartCard
                            icon={Eye}
                            iconGradientFrom="from-purple-600"
                            iconGradientTo="to-purple-800"
                            title="2. View Your Fleet"
                            videoSrc="/videos/ships.mov"
                            description={
                                <>
                                    Browse your fleet in{' '}
                                    <Link
                                        to="/ships"
                                        className="text-primary hover:text-primary-hover"
                                    >
                                        Ships
                                    </Link>{' '}
                                    and manage your inventory in{' '}
                                    <Link
                                        to="/gear"
                                        className="text-primary hover:text-primary-hover"
                                    >
                                        Gear
                                    </Link>
                                    . Analyze gear, find upgrade suggestions and more.
                                </>
                            }
                        />
                        <QuickStartCard
                            icon={Zap}
                            iconGradientFrom="from-orange-600"
                            iconGradientTo="to-orange-800"
                            title="3. Optimize Gear"
                            videoSrc="/videos/autogear.mov"
                            description={
                                <>
                                    Use the{' '}
                                    <Link
                                        to="/autogear"
                                        className="text-primary hover:text-primary-hover"
                                    >
                                        Autogear Tool
                                    </Link>{' '}
                                    to automatically calculate the best gear combinations for your
                                    ships. Check out community suggested configurations or AI
                                    generated ones, based on ship skills and implants.
                                </>
                            }
                        />
                    </div>
                </section>

                {/* Core Features */}
                <section className="space-y-6">
                    <SectionHeader
                        title="Powerful Fleet Management Tools"
                        subtitle="Everything you need to optimize your Starborne Frontiers fleet"
                    />
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                        <FeatureCard
                            to="/autogear"
                            icon={Zap}
                            title="AI Autogear"
                            description="Intelligent gear optimization with AI-powered recommendations for maximum performance"
                        />
                        <FeatureCard
                            to="/ships"
                            icon={Ship}
                            title="Fleet Manager"
                            description="Comprehensive ship builder with stats, equipment, refits, and implants"
                        />
                        <FeatureCard
                            to="/gear"
                            icon={Wrench}
                            title="Gear Inventory"
                            description="Advanced filtering, sorting, and upgrade analysis for your entire gear collection"
                        />
                        <FeatureCard
                            to="/simulation"
                            icon={Swords}
                            title="Combat Simulator"
                            description="Test fleet compositions and strategies with detailed battle simulations"
                        />
                        <FeatureCard
                            to="/loadouts"
                            icon={Save}
                            title="Loadout System"
                            description="Save and share gear setups for individual ships or entire team compositions"
                        />
                        <FeatureCard
                            to="/encounters"
                            icon={MapPin}
                            title="Encounter Tracker"
                            description="Document and share fleet formations for PvE encounters and boss fights"
                        />
                        <FeatureCard
                            to="/engineering"
                            icon={BarChart3}
                            title="Engineering Bonuses"
                            description="Track ship type bonuses and achieve 100% stat coverage across your fleet"
                        />
                        <FeatureCard
                            to="/damage"
                            icon={Calculator}
                            title="Specialized Calculators"
                            description="DPS, defense, healing, and damage deconstruction tools for advanced theorycrafting"
                        />
                    </div>
                </section>

                {/* Community & Support */}
                <section className="space-y-6">
                    <SectionHeader
                        title="Community & Support"
                        subtitle="Get help, share feedback, or contribute to the project"
                    />
                    <div className="grid gap-6 md:grid-cols-2">
                        {/* Discord Community */}
                        <div className="card">
                            <div className="flex items-center gap-3 mb-4">
                                <IconBadge
                                    icon={MessageCircle}
                                    gradientFrom="from-indigo-600"
                                    gradientTo="to-indigo-800"
                                />
                                <h3 className="text-xl font-semibold text-gray-100">
                                    Join the Community
                                </h3>
                            </div>
                            <p className="text-gray-300 mb-4">
                                Get support, share strategies, and discuss features with other
                                players.
                            </p>
                            <div className="space-y-2 text-sm">
                                <p>
                                    Contact{' '}
                                    <span className="text-primary font-semibold">@alvbert</span> on
                                    Discord
                                </p>
                                <div className="flex flex-col gap-2">
                                    <a
                                        href="https://discord.com/invite/playfrontiers"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
                                    >
                                        <MessageCircle size={16} />
                                        Starborne Frontiers Discord
                                    </a>
                                    <a
                                        href="https://discord.com/channels/973311773920862308/1315988554534486036"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
                                    >
                                        <MessageCircle size={16} />
                                        Autogearing Forum Thread
                                    </a>
                                </div>
                            </div>
                        </div>

                        {/* Open Source */}
                        <div className="card">
                            <div className="flex items-center gap-3 mb-4">
                                <IconBadge
                                    icon={Github}
                                    gradientFrom="from-gray-600"
                                    gradientTo="to-gray-800"
                                />
                                <h3 className="text-xl font-semibold text-gray-100">
                                    Open Source Project
                                </h3>
                            </div>
                            <p className="text-gray-300 mb-4">
                                This project is free and open source. Contributions, bug reports,
                                and feature requests are welcome!
                            </p>
                            <div className="flex gap-3">
                                <a
                                    href="https://github.com/TheSusort/starborne-frontiers-calculator"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <Button
                                        variant="secondary"
                                        className="w-full justify-center gap-2"
                                    >
                                        View on GitHub
                                    </Button>
                                </a>
                                <a
                                    href="https://www.buymeacoffee.com/starborneplanner"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <Button
                                        variant="primary"
                                        className="w-full justify-center gap-2"
                                    >
                                        Buy me a coffee
                                    </Button>
                                </a>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Backup & Restore */}
                <section className="bg-dark p-8 border border-dark-border">
                    <div className="max-w-3xl mx-auto text-center">
                        <div className="flex justify-center mb-4">
                            <IconBadge
                                icon={Database}
                                size={32}
                                gradientFrom="from-green-600"
                                gradientTo="to-green-800"
                                className="w-16 h-16"
                            />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-100 mb-3">
                            Backup & Restore Your Data
                        </h2>
                        <p className="text-gray-300 mb-6">
                            Protect your fleet data by creating backups. Useful for migrating to a
                            new device or recovering from data loss.
                        </p>
                        <div className="flex justify-center">
                            <BackupRestoreData />
                        </div>
                    </div>
                </section>
            </div>
        </>
    );
};

export default HomePage;
