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
    Coffee,
    Database,
} from 'lucide-react';
import { BackupRestoreData } from '../components/import/BackupRestoreData';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { ImportButton } from '../components/import/ImportButton';
import { HeroCarousel } from '../components/home/HeroCarousel';
import { Button } from '../components/ui/Button';

const HomePage: React.FC = () => {
    const exportVideoRef = React.useRef<HTMLVideoElement>(null);
    const shipsVideoRef = React.useRef<HTMLVideoElement>(null);
    const autogearVideoRef = React.useRef<HTMLVideoElement>(null);

    const [isExportPlaying, setIsExportPlaying] = React.useState(false);
    const [isShipsPlaying, setIsShipsPlaying] = React.useState(false);
    const [isAutogearPlaying, setIsAutogearPlaying] = React.useState(false);

    return (
        <>
            <Seo {...SEO_CONFIG.home} />
            <div className="space-y-12">
                {/* Hero Carousel */}
                <HeroCarousel />

                {/* Quick Start Guide */}
                <section className="space-y-6">
                    <div className="text-center">
                        <h2 className="text-3xl font-bold text-gray-100 mb-2">Quick Start Guide</h2>
                        <p className="text-gray-400">Get started in three simple steps</p>
                    </div>
                    <div className="grid gap-6 md:grid-cols-3">
                        <div
                            className="card hover:border-primary/50 transition-colors group"
                            onMouseEnter={() => {
                                exportVideoRef.current?.play();
                                setIsExportPlaying(true);
                            }}
                            onMouseLeave={() => {
                                exportVideoRef.current?.pause();
                                setIsExportPlaying(false);
                            }}
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
                                    <Upload className="text-white" size={24} />
                                </div>
                                <h3 className="text-xl font-semibold text-gray-100">
                                    1. Import Data
                                </h3>
                            </div>
                            <div className="mb-4 overflow-hidden border border-dark-border h-48 relative">
                                <video
                                    ref={exportVideoRef}
                                    src="/videos/export.mov"
                                    loop
                                    muted
                                    playsInline
                                    className="w-full h-full object-cover"
                                />
                                {!isExportPlaying && (
                                    <div className="absolute inset-0 bg-black/50 transition-opacity duration-300" />
                                )}
                            </div>
                            <p className="text-gray-300 mb-4">
                                <Link
                                    to="/documentation#getting-started"
                                    className="text-primary hover:text-primary-hover"
                                >
                                    Export your game data
                                </Link>{' '}
                                from Starborne Frontiers and import it here. This will populate your
                                ships, gear, and engineering stats.
                            </p>
                            <ImportButton className="w-full" />
                        </div>
                        <div
                            className="card hover:border-primary/50 transition-colors"
                            onMouseEnter={() => {
                                shipsVideoRef.current?.play();
                                setIsShipsPlaying(true);
                            }}
                            onMouseLeave={() => {
                                shipsVideoRef.current?.pause();
                                setIsShipsPlaying(false);
                            }}
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center">
                                    <Eye className="text-white" size={24} />
                                </div>
                                <h3 className="text-xl font-semibold text-gray-100">
                                    2. View Your Fleet
                                </h3>
                            </div>
                            <div className="mb-4 overflow-hidden border border-dark-border h-48 relative">
                                <video
                                    ref={shipsVideoRef}
                                    src="/videos/ships.mov"
                                    loop
                                    muted
                                    playsInline
                                    className="w-full h-full object-cover"
                                />
                                {!isShipsPlaying && (
                                    <div className="absolute inset-0 bg-black/50 transition-opacity duration-300" />
                                )}
                            </div>
                            <p className="text-gray-300 mb-4">
                                Browse your fleet in{' '}
                                <Link to="/ships" className="text-primary hover:text-primary-hover">
                                    Ships
                                </Link>{' '}
                                and manage your inventory in{' '}
                                <Link to="/gear" className="text-primary hover:text-primary-hover">
                                    Gear
                                </Link>
                                . Analyze gear, find upgrade suggestions and more.
                            </p>
                        </div>
                        <div
                            className="card hover:border-primary/50 transition-colors"
                            onMouseEnter={() => {
                                autogearVideoRef.current?.play();
                                setIsAutogearPlaying(true);
                            }}
                            onMouseLeave={() => {
                                autogearVideoRef.current?.pause();
                                setIsAutogearPlaying(false);
                            }}
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 bg-gradient-to-br from-orange-600 to-orange-800 flex items-center justify-center">
                                    <Zap className="text-white" size={24} />
                                </div>
                                <h3 className="text-xl font-semibold text-gray-100">
                                    3. Optimize Gear
                                </h3>
                            </div>
                            <div className="mb-4 overflow-hidden border border-dark-border h-48 relative">
                                <video
                                    ref={autogearVideoRef}
                                    src="/videos/autogear.mov"
                                    loop
                                    muted
                                    playsInline
                                    className="w-full h-full object-cover"
                                />
                                {!isAutogearPlaying && (
                                    <div className="absolute inset-0 bg-black/50 transition-opacity duration-300" />
                                )}
                            </div>
                            <p className="text-gray-300 mb-4">
                                Use the{' '}
                                <Link
                                    to="/autogear"
                                    className="text-primary hover:text-primary-hover"
                                >
                                    Autogear Tool
                                </Link>{' '}
                                to automatically calculate the best gear combinations for your
                                ships. Check out community suggested configurations or AI generated
                                ones, based on ship skills and implants.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Core Features */}
                <section className="space-y-6">
                    <div className="text-center">
                        <h2 className="text-3xl font-bold text-gray-100 mb-2">
                            Powerful Fleet Management Tools
                        </h2>
                        <p className="text-gray-400">
                            Everything you need to optimize your Starborne Frontiers fleet
                        </p>
                    </div>
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                        {/* Autogear */}
                        <Link
                            to="/autogear"
                            className="card hover:border-primary/50 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <Zap
                                    className="text-primary mb-3 group-hover:scale-110 transition-transform"
                                    size={32}
                                />
                                <h3 className="text-lg font-semibold text-gray-100 mb-2">
                                    AI Autogear
                                </h3>
                            </div>
                            <p className="text-sm text-gray-400">
                                Intelligent gear optimization with AI-powered recommendations for
                                maximum performance
                            </p>
                        </Link>

                        {/* Ship Management */}
                        <Link
                            to="/ships"
                            className="card hover:border-primary/50 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <Ship
                                    className="text-primary mb-3 group-hover:scale-110 transition-transform"
                                    size={32}
                                />
                                <h3 className="text-lg font-semibold text-gray-100 mb-2">
                                    Fleet Manager
                                </h3>
                            </div>
                            <p className="text-sm text-gray-400">
                                Comprehensive ship builder with stats, equipment, refits, and
                                implants
                            </p>
                        </Link>

                        {/* Gear Management */}
                        <Link
                            to="/gear"
                            className="card hover:border-primary/50 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <Wrench
                                    className="text-primary mb-3 group-hover:scale-110 transition-transform"
                                    size={32}
                                />
                                <h3 className="text-lg font-semibold text-gray-100 mb-2">
                                    Gear Inventory
                                </h3>
                            </div>
                            <p className="text-sm text-gray-400">
                                Advanced filtering, sorting, and upgrade analysis for your entire
                                gear collection
                            </p>
                        </Link>

                        {/* Combat Simulation */}
                        <Link
                            to="/simulation"
                            className="card hover:border-primary/50 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <Swords
                                    className="text-primary mb-3 group-hover:scale-110 transition-transform"
                                    size={32}
                                />
                                <h3 className="text-lg font-semibold text-gray-100 mb-2">
                                    Combat Simulator
                                </h3>
                            </div>
                            <p className="text-sm text-gray-400">
                                Test fleet compositions and strategies with detailed battle
                                simulations
                            </p>
                        </Link>

                        {/* Loadouts */}
                        <Link
                            to="/loadouts"
                            className="card hover:border-primary/50 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <Save
                                    className="text-primary mb-3 group-hover:scale-110 transition-transform"
                                    size={32}
                                />
                                <h3 className="text-lg font-semibold text-gray-100 mb-2">
                                    Loadout System
                                </h3>
                            </div>
                            <p className="text-sm text-gray-400">
                                Save and share gear setups for individual ships or entire team
                                compositions
                            </p>
                        </Link>

                        {/* Encounters */}
                        <Link
                            to="/encounters"
                            className="card hover:border-primary/50 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <MapPin
                                    className="text-primary mb-3 group-hover:scale-110 transition-transform"
                                    size={32}
                                />
                                <h3 className="text-lg font-semibold text-gray-100 mb-2">
                                    Encounter Tracker
                                </h3>
                            </div>
                            <p className="text-sm text-gray-400">
                                Document and share fleet formations for PvE encounters and boss
                                fights
                            </p>
                        </Link>

                        {/* Engineering Stats */}
                        <Link
                            to="/engineering"
                            className="card hover:border-primary/50 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <BarChart3
                                    className="text-primary mb-3 group-hover:scale-110 transition-transform"
                                    size={32}
                                />
                                <h3 className="text-lg font-semibold text-gray-100 mb-2">
                                    Engineering Bonuses
                                </h3>
                            </div>
                            <p className="text-sm text-gray-400">
                                Track ship type bonuses and achieve 100% stat coverage across your
                                fleet
                            </p>
                        </Link>

                        {/* Calculators */}
                        <Link
                            to="/damage"
                            className="card hover:border-primary/50 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <Calculator
                                    className="text-primary mb-3 group-hover:scale-110 transition-transform"
                                    size={32}
                                />
                                <h3 className="text-lg font-semibold text-gray-100 mb-2">
                                    Specialized Calculators
                                </h3>
                            </div>
                            <p className="text-sm text-gray-400">
                                DPS, defense, healing, and damage deconstruction tools for advanced
                                theorycrafting
                            </p>
                        </Link>
                    </div>
                </section>

                {/* Community & Support */}
                <section className="space-y-6">
                    <div className="text-center">
                        <h2 className="text-3xl font-bold text-gray-100 mb-2">
                            Community & Support
                        </h2>
                        <p className="text-gray-400">
                            Get help, share feedback, or contribute to the project
                        </p>
                    </div>
                    <div className="grid gap-6 md:grid-cols-2">
                        {/* Discord Community */}
                        <div className="card">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 to-indigo-800 flex items-center justify-center">
                                    <MessageCircle className="text-white" size={24} />
                                </div>
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
                                <div className="w-12 h-12 bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center">
                                    <Github className="text-white" size={24} />
                                </div>
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
                                    href="https://buymeacoffee.com/alvbert"
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
                            <div className="w-16 h-16 bg-gradient-to-br from-green-600 to-green-800 flex items-center justify-center">
                                <Database className="text-white" size={32} />
                            </div>
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
