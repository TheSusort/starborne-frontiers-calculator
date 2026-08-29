import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageLayout } from '../components/ui';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { CHANGELOG, CURRENT_VERSION } from '../constants/changelog';

const DocumentationPage: React.FC = () => {
    const location = useLocation();

    useEffect(() => {
        // If there's a hash in the URL, scroll to that section
        if (location.hash) {
            const element = document.getElementById(location.hash.slice(1));
            if (element) {
                // Add a small delay to ensure the page has rendered
                setTimeout(() => {
                    element.scrollIntoView({ behavior: 'smooth' });
                }, 100);
            }
        }
    }, [location]);

    return (
        <>
            <Seo {...SEO_CONFIG.documentation} />
            <PageLayout
                title="Documentation"
                description="Comprehensive guide to using the Starborne Planner tool for ship management, gear optimization, and battle simulations."
            >
                <div className="space-y-8 [counter-reset:section] [counter-reset:index]">
                    {/* Table of Contents */}
                    <nav className="card">
                        <h2 className="text-xl font-semibold mb-4">Table of Contents</h2>
                        <hr className="mb-4" />
                        <h4 className="text-lg font-semibold mb-4">Help</h4>
                        <ul className="space-y-2 [counter-reset:index]">
                            <li className="[counter-increment:index]">
                                <a
                                    href="#getting-started"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Getting Started
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#tips-tricks"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Tips & Tricks
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a href="#FAQ" className="text-primary hover:text-primary-light">
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        FAQ
                                    </span>
                                </a>
                            </li>
                        </ul>
                        <hr className="my-4" />
                        <h4 className="text-lg font-semibold mb-4">Documentation</h4>
                        <ul className="space-y-2">
                            <li className="[counter-increment:index]">
                                <a
                                    href="#ship-management"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Ship Management
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#inventory-management"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Inventory Management
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#autogear"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Autogear
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#community-recommendations"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Community Recommendations
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#engineering-stats"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Engineering Stats
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#loadouts"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Loadouts
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#ship-database"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Ship Database
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#effect-index"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Effect Index
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#squad-leaders"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Squad Leaders
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#leaderboards"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Leaderboards
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a href="#lore" className="text-primary hover:text-primary-light">
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Lore
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#calculators"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Calculators
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#encounters"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Encounter Notes
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#shared-encounters"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Shared Encounters
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#statistics"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Statistics
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#simulation"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Simulation
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#combat-simulator"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Combat Simulator
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a href="#themes" className="text-primary hover:text-primary-light">
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Themes & Appearance
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#profile"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Profile & Account
                                    </span>
                                </a>
                            </li>
                            <li className="[counter-increment:index]">
                                <a
                                    href="#changelog"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Changelog
                                    </span>
                                </a>
                            </li>
                        </ul>
                    </nav>

                    <h2 className="text-2xl font-bold before:mr-2">Help</h2>
                    <hr className="mb-4" />

                    {/* Getting Started Section */}
                    <section id="getting-started" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Getting Started
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Introduction</h3>
                            <p className="mb-4">
                                Welcome to the Starborne Frontiers Calculator, your comprehensive
                                tool for optimizing your fleet and gear in Starborne Frontiers. This
                                guide will help you understand and make the most of all the features
                                available.
                            </p>

                            <div>
                                <h3 className="text-xl font-semibold mb-2">
                                    Importing Your Game Data
                                </h3>
                                <div className="space-y-4">
                                    <p className="text-theme-text">
                                        To get started, you&apos;ll need to import your game data.
                                        This process requires the Windows version of Starborne
                                        Frontiers, which can be accessed through either:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 text-theme-text">
                                        <li>The standalone Windows client</li>
                                        <li>The Steam client</li>
                                    </ul>

                                    <div className="card">
                                        <h4 className="font-semibold text-primary mb-2">
                                            Steps to Export Data:
                                        </h4>
                                        <ol className="list-decimal pl-6 space-y-2 text-theme-text">
                                            <li>Open Starborne Frontiers in Windows</li>
                                            <li>
                                                Click on{' '}
                                                <span className="text-primary">Settings</span>
                                            </li>
                                            <li>
                                                Navigate to{' '}
                                                <span className="text-primary">Account</span>
                                            </li>
                                            <li>
                                                Click{' '}
                                                <span className="text-primary">
                                                    Export Player Data
                                                </span>
                                            </li>
                                            <li>
                                                This will download a JSON file containing your game
                                                data
                                            </li>
                                        </ol>

                                        <div className="mt-4">
                                            <h4 className="font-semibold text-primary mb-2">
                                                Video Guide:
                                            </h4>
                                            <div className="relative w-full max-w-2xl border border-dark-border">
                                                <video
                                                    className="w-full h-auto"
                                                    autoPlay
                                                    loop
                                                    muted
                                                    playsInline
                                                >
                                                    <source
                                                        src="/videos/export.mp4"
                                                        type="video/mp4"
                                                    />
                                                    Your browser does not support the video tag.
                                                </video>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="card">
                                        <h4 className="font-semibold text-primary mb-2">
                                            Importing into the Calculator:
                                        </h4>
                                        <ol className="list-decimal pl-6 space-y-2 text-theme-text">
                                            <li>
                                                Locate the yellow{' '}
                                                <span className="text-primary">Import Data</span>{' '}
                                                button in the sidebar
                                            </li>
                                            <li>
                                                Click the button and select your exported JSON file
                                            </li>
                                            <li>
                                                An <strong>Import Complete</strong> summary appears
                                                showing what changed: new/leveled/refitted ships by
                                                rarity, gear count delta, and any new legendary
                                                6-star gear highlights
                                            </li>
                                            <li>
                                                The app updates in-place — no page reload required
                                            </li>
                                        </ol>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Tips & Tricks Section */}
                    <section id="tips-tricks" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Tips & Tricks
                        </h2>
                        <div className="card">
                            <h3 className="text-xl font-semibold mb-2">Best Practices</h3>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>
                                    Edit ships to give them the proper role, to make autogearing
                                    faster. This persists between imports.
                                </li>
                                <li>
                                    Use the equipment lock feature often to lock the equipment on
                                    the ships you don&apos;t want to be touched. This persists
                                    between imports.
                                </li>
                                <li>
                                    Always run autogear multiple times to find the best combination.
                                </li>
                                <li>
                                    Regularly import new data from the game, to get the latest gear.
                                </li>
                                <li>
                                    Regularly run the optimizer for your MVPs, to make sure you are
                                    getting the best possible gear.
                                </li>
                                <li>
                                    Check out Gear -&gt; Upgrade Analysis, to locate gear pieces
                                    most likely to improve role scores the most.
                                </li>
                            </ul>

                            <h3 className="text-xl font-semibold mt-6 mb-2">Example workflow</h3>
                            <p>
                                Here is an example workflow of how to use the calculator to autogear
                                your fleet.
                            </p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>Import your game data</li>
                                <li>
                                    If first time using the calculator, edit ships to give them the
                                    proper role.
                                </li>
                                <li>Optimize the most important units first, arena/vault teams</li>
                                <li>
                                    Toggle the lock on the autogear page, when you find a good gear
                                    combination, equip stuff in the game, before continuing to the
                                    next ship.
                                </li>
                                <li>
                                    Then depending on the content you want to do, repeat the process
                                    on the situational ships, for example Faction Ops. Unlock the
                                    arena/vault teams if you need the best possible gear here.
                                </li>
                                <li>
                                    After the content runs are done, unlock the situational ships,
                                    and optimize the MVPs again, if these were touched.
                                </li>
                            </ul>
                        </div>
                    </section>

                    {/* FAQ Section */}
                    <section id="FAQ" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            FAQ
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">FAQ</h3>
                            <p className="text-theme-text">
                                Here are some frequently asked questions about the app.
                            </p>
                            <ul className="list-disc pl-6 space-y-4">
                                <li className="flex flex-col gap-1">
                                    <span className="text-primary">
                                        What is the purpose of the app?
                                    </span>
                                    The purpose of the app is to help you with gear management and
                                    quickly optimize your ships. Do you spend a lot of time gear
                                    swapping when doing faction ops, or just a wild amount of
                                    credits on gearing up all your ships? The autogear feature is a
                                    tool to help you quickly find the best gear for your ships for
                                    any content, and easily keep track of what gear is going where.
                                </li>
                                <li className="flex flex-col gap-1">
                                    <span className="text-primary">
                                        Why would I use this, when I have a spreadsheet with all my
                                        ships and gear?
                                    </span>
                                    This community has an untamable passion for spreadsheets, but
                                    this is more efficient, I promise you. It has integrated import
                                    with game data, so you can easily import your gear and fleet,
                                    and find better gear combinations depending on a lot of
                                    different roles and requirements. It will also tell you what
                                    ships you need to move gear from if its already equipped.
                                    Engineering and implants are also factored in.
                                </li>
                                <li className="flex flex-col gap-1">
                                    <span className="text-primary">
                                        Do I need a huge game account to use this?
                                    </span>
                                    No, it will work with any size of game account, wether newly
                                    started or old time whale, or anything in between.
                                </li>
                                <li className="flex flex-col gap-1">
                                    <span className="text-primary">
                                        How do I import my game data?
                                    </span>
                                    <span>
                                        You can import your game data by clicking the import button
                                        in the sidebar. Check out the{' '}
                                        <Link to="/documentation#getting-started">
                                            Getting Started
                                        </Link>{' '}
                                        section for more information.
                                    </span>
                                </li>
                                <li className="flex flex-col gap-1">
                                    <span className="text-primary">
                                        Does the app work without an account?
                                    </span>
                                    Yes, the app works without an account. You can import your game
                                    data and use the app, but what you do will not be synced across
                                    devices.
                                </li>
                                <li className="flex flex-col gap-1">
                                    <span className="text-primary">
                                        How do I delete my account?
                                    </span>
                                    You can delete your account by clicking the delete account
                                    button in the Profile page, inside the Backup & Restore section.
                                </li>
                            </ul>
                        </div>
                    </section>

                    <hr className="my-4" />
                    <h2 className="text-2xl font-bold before:mr-2">Documentation</h2>
                    <hr className="mb-4" />

                    {/* Ship Management Section */}
                    <section id="ship-management" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Ship Management
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Ship Cards</h3>
                            <p className="text-theme-text">
                                Each ship in your fleet is displayed as a card containing
                                comprehensive information and management options.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Ship Information
                                </h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <span className="text-primary">Basic Info:</span> Name
                                    </li>
                                    <li>
                                        <span className="text-primary">Faction:</span> The
                                        ship&apos;s faction icon
                                    </li>
                                    <li>
                                        <span className="text-primary">Role:</span> Ship role (e.g.,
                                        Attacker, Defender) is displayed by the role icon.
                                    </li>
                                    <li>
                                        <span className="text-primary">Affinity:</span> The
                                        ship&apos;s elemental affinity is displayed by the color of
                                        the role icon.
                                    </li>
                                    <li>
                                        <span className="text-primary">Rank:</span> Current ship
                                        rank displayed as white stars.
                                    </li>
                                    <li>
                                        <span className="text-primary">Refit Level:</span> Number of
                                        gold stars (★) indicating refit progress
                                    </li>
                                    <li>
                                        <span className="text-primary">Equipment:</span> Currently
                                        equipped gear pieces
                                    </li>
                                    <li>
                                        <span className="text-primary">Active Sets:</span> Currently
                                        active gear set bonuses
                                    </li>
                                    <li>
                                        <span className="text-primary">Implants:</span> Installed
                                        implants, their effects, and their description.
                                    </li>
                                    <li>
                                        <span className="text-primary">Final Stats:</span> Total
                                        stats including all bonuses.
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Ship Actions</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <span className="text-primary">Equip Gear:</span> Manually
                                        equip gear pieces to different slots
                                    </li>
                                    <li>
                                        <span className="text-primary">Unequip All:</span> Remove
                                        all currently equipped gear
                                    </li>
                                    <li>
                                        <span className="text-primary">Lock Equipment:</span>{' '}
                                        Prevent gear from being changed by autogear
                                    </li>
                                    <li>
                                        <span className="text-primary">Calibrate Gear:</span> Quick
                                        access to calibrate gear for this ship
                                    </li>
                                    <li>
                                        <span className="text-primary">Ship Details:</span> View
                                        detailed ship information in the ship database
                                    </li>
                                    <li>
                                        <span className="text-primary">Quick Autogear:</span> Direct
                                        access to autogear for this specific ship
                                    </li>
                                    <li>
                                        <span className="text-primary">Simulator:</span> Quick
                                        access to battle simulation with this ship
                                    </li>
                                    <li>
                                        <span className="text-primary">Compare Ships:</span> Add
                                        ships to comparison panel to view stats side-by-side
                                    </li>
                                    <li>
                                        <span className="text-primary">Delete Ship:</span> Remove
                                        the ship from your fleet
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Ship Comparison</h4>
                                <p className="text-theme-text mb-2">
                                    Compare multiple ships side-by-side to analyze their stats and
                                    gear configurations:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        Click &quot;Compare&quot; on ship cards to add them to the
                                        comparison panel
                                    </li>
                                    <li>View up to 4 ships at once</li>
                                    <li>Compare final stats, gear, and set bonuses</li>
                                    <li>
                                        Also available in Ship Database for comparing base stats
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Starred Ship Alerts
                                </h4>
                                <p className="text-theme-text mb-2">
                                    When starred ships have empty gear slots, a floating panel
                                    appears in the bottom-right corner:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        Click a ship name to go directly to Autogear with that ship
                                        pre-selected
                                    </li>
                                    <li>
                                        When there are 2 or more ships, an{' '}
                                        <span className="text-primary">Autogear All</span> button
                                        appears — it loads all of them into the Autogear queue at
                                        once
                                    </li>
                                    <li>
                                        The panel can be minimized to a small badge and restored by
                                        clicking the badge
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Filtering and Sorting
                                </h4>
                                <p className="text-theme-text mb-2">
                                    The ship management interface includes powerful filtering and
                                    sorting capabilities:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <span className="text-primary">Faction Filter:</span> Filter
                                        ships by their faction
                                    </li>
                                    <li>
                                        <span className="text-primary">Ship Type Filter:</span>{' '}
                                        Filter by ship type (e.g., Cruiser, Battleship)
                                    </li>
                                    <li>
                                        <span className="text-primary">Rarity Filter:</span> Filter
                                        by ship rarity
                                    </li>
                                    <li>
                                        <span className="text-primary">Affinity Filter:</span>{' '}
                                        Filter by elemental affinity
                                    </li>
                                    <li>
                                        <span className="text-primary">Equipment Lock Filter:</span>{' '}
                                        Show only ships with locked equipment
                                    </li>
                                    <li>
                                        <span className="text-primary">
                                            Skill Targeting Filters:
                                        </span>{' '}
                                        Filter by &quot;Target&quot; (target selection: Front, Back,
                                        Skip, All, Self, Allies, Other Allies) and{' '}
                                        &quot;Pattern&quot; (AoE pattern shape)
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Sorting Options</h4>
                                <p className="text-theme-text mb-2">
                                    Ships can be sorted by various criteria:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Date Added (default)</li>
                                    <li>Name (alphabetical)</li>
                                    <li>Ship Type</li>
                                    <li>Faction</li>
                                    <li>Rarity</li>
                                    <li>Number of Equipped Gear</li>
                                    <li>Any individual stat (e.g., Attack, Defense, Speed)</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Search Functionality
                                </h4>
                                <p className="text-theme-text mb-2">
                                    The search feature allows you to find ships by:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1 mt-2">
                                    <li>Ship name</li>
                                    <li>Ship type</li>
                                    <li>Faction name</li>
                                    <li>Affinity</li>
                                    <li>
                                        Targeting terms (e.g. &quot;cone&quot; or
                                        &quot;backline&quot;)
                                    </li>
                                </ul>
                                <p className="text-theme-text mt-2">
                                    The search is case-insensitive and updates results in real-time
                                    as you type.
                                </p>
                            </div>

                            <div className="mt-4 p-4 bg-yellow-900/50 border border-yellow-700">
                                <h4 className="font-semibold text-yellow-200 mb-2">Pro Tips</h4>
                                <ul className="text-yellow-100 space-y-2">
                                    <li>
                                        Use the equipment lock feature to prevent autogear from
                                        changing specific ship setups
                                    </li>
                                    <li>
                                        Combine filters to quickly find specific ship combinations
                                    </li>
                                    <li>
                                        Sort by stats to identify your strongest ships in specific
                                        areas
                                    </li>
                                    <li>
                                        Use the search function to quickly locate ships when you
                                        have a large fleet
                                    </li>
                                </ul>
                            </div>

                            <h3 className="text-xl font-semibold mt-6 mb-2">Ship Details Page</h3>
                            <p className="text-theme-text">
                                The ship details page shows detailed information about a specific
                                ship. Including:
                            </p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>Complete stats breakdown</li>
                                <li>Equipment</li>
                                <li>Implants</li>
                                <li>Score breakdown by gear slots</li>
                                <li>Upgrade analysis based on gear slots</li>
                                <li>Ship skills</li>
                            </ul>

                            <div className="p-4 bg-dark-lighter mt-4">
                                <h4 className="font-semibold text-primary mb-2">Skills Card</h4>
                                <p className="text-theme-text mb-2">
                                    The Skills card shows each of your ship&apos;s skills — Active,
                                    Charge (with turn count), and Passive R1/R2/R4 — with full
                                    formatted skill text. Damage values are highlighted in orange,
                                    buff and debuff names are underlined with tooltip descriptions,
                                    and beneficial effects appear in green. Hovering an Active or
                                    Charge skill shows a board diagram of its targeting footprint —
                                    which cells the skill hits (red = primary target, orange =
                                    splash).
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Inventory Management Section */}
                    <section
                        id="inventory-management"
                        className="space-y-4 [counter-increment:section]"
                    >
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Inventory Management
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Gear Cards</h3>
                            <p className="text-theme-text">
                                Each piece of gear in your inventory is displayed as a card
                                containing detailed information and management options.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Gear Information
                                </h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <span className="text-primary">Header:</span>
                                        <ul className="list-disc pl-4 mt-1">
                                            <li>Slot type with icon (e.g., Weapon, Armor)</li>
                                            <li>Stars (★) and Level indicator</li>
                                            <li>
                                                For implants: Implant slot type (Major/Ultimate)
                                            </li>
                                        </ul>
                                    </li>
                                    <li>
                                        <span className="text-primary">Main Stat:</span> Primary
                                        stat with value and type
                                    </li>
                                    <li>
                                        <span className="text-primary">Sub Stats:</span> List of
                                        secondary stats with values
                                    </li>
                                    <li>
                                        <span className="text-primary">Set Bonus:</span>
                                        <ul className="list-disc pl-4 mt-1">
                                            <li>Set name</li>
                                            <li>Set bonus stats</li>
                                            <li>Set bonus description</li>
                                        </ul>
                                    </li>
                                    <li>
                                        <span className="text-primary">Implant Details:</span> (for
                                        implants only)
                                        <ul className="list-disc pl-4 mt-1">
                                            <li>Implant name and icon</li>
                                            <li>Description (for Major and Ultimate implants)</li>
                                        </ul>
                                    </li>
                                    <li>
                                        <span className="text-primary">Equipped Status:</span> Shows
                                        which ship is using this gear
                                    </li>
                                </ul>
                                <div className="mt-4 p-4 bg-blue-900/50 border border-blue-700">
                                    <h4 className="font-semibold text-blue-200 mb-2">
                                        Visual Indicators
                                    </h4>
                                    <ul className="text-blue-100 list-disc pl-4 space-y-1">
                                        <li>Rarity is indicated by border color and text color</li>
                                        <li>Set icon is displayed next to the slot type</li>
                                        <li>Implant icon is shown for implant slots</li>
                                        <li>Stars are shown in yellow (★)</li>
                                    </ul>
                                </div>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Gear Actions</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <span className="text-primary">Edit:</span> Modify gear
                                        details (not available for implants). Edit mode uses a
                                        compact layout — slot, stars, rarity, set, and main stat
                                        type are locked and shown as a read-only summary. Only level
                                        and substats are editable:
                                        <ul className="list-disc pl-4 mt-1">
                                            <li>
                                                <span className="text-primary">Level:</span>{' '}
                                                Adjusting the level automatically recalculates the
                                                main stat value from the game&apos;s lookup table.
                                            </li>
                                            <li>
                                                <span className="text-primary">Substats:</span> The
                                                number of substat slots available depends on rarity
                                                and level. Rare gear unlocks a third slot at level
                                                12 and a fourth at level 16. Epic gear unlocks a
                                                fourth slot at level 16. Legendary gear starts with
                                                all four slots available.
                                            </li>
                                        </ul>
                                    </li>
                                    <li>
                                        <span className="text-primary">Remove:</span> Delete the
                                        gear piece
                                    </li>
                                    <li>
                                        <span className="text-primary">Equip:</span> (in select
                                        mode) Equip to a ship
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Filtering and Sorting
                                </h4>
                                <p className="text-theme-text mb-2">
                                    The gear management interface includes powerful filtering and
                                    sorting capabilities:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <span className="text-primary">Slot Filter:</span> Filter by
                                        gear slot type
                                    </li>
                                    <li>
                                        <span className="text-primary">Rarity Filter:</span> Filter
                                        by gear rarity
                                    </li>
                                    <li>
                                        <span className="text-primary">Set Filter:</span> Filter by
                                        gear set
                                    </li>
                                    <li>
                                        <span className="text-primary">Equipped Filter:</span> Show
                                        equipped or unequipped gear
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Search Functionality
                                </h4>
                                <p className="text-theme-text mb-2">
                                    The search feature allows you to find gear by:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Gear name</li>
                                    <li>Slot type</li>
                                    <li>Set name</li>
                                    <li>Rarity</li>
                                    <li>Stat names and values</li>
                                    <li>Equipped ship name</li>
                                </ul>
                                <p className="text-theme-text mt-2">
                                    The search is case-insensitive and updates results in real-time
                                    as you type.
                                </p>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Sorting Options</h4>
                                <p className="text-theme-text mb-2">
                                    Gear can be sorted by various criteria:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Date Added (default)</li>
                                    <li>Level</li>
                                    <li>Stars</li>
                                    <li>Rarity</li>
                                </ul>
                            </div>

                            <h3 className="text-xl font-semibold mb-2">Gear Page Tabs</h3>
                            <p className="text-theme-text mb-4">
                                The Gear page has five tabs for different management features:
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Inventory Tab</h4>
                                <p className="text-theme-text">
                                    Your main gear inventory with filtering, sorting, and search
                                    capabilities as described above.
                                </p>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Calibration Tab</h4>
                                <p className="text-theme-text mb-2">
                                    Gear calibration is an in-game feature that boosts your
                                    gear&apos;s main stat when calibrated to a specific ship.
                                    Requirements: level 16 gear with 5 or 6 stars.
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <strong>Calibration Candidates:</strong> Find your best gear
                                        pieces to calibrate for each role, ranked by potential score
                                        improvement
                                    </li>
                                    <li>
                                        <strong>Ship Analysis:</strong> Select a specific ship to
                                        see which of their equipped gear would benefit most from
                                        calibration
                                    </li>
                                    <li>
                                        Calibration bonuses vary by stat type (flat attack doubles,
                                        HP gains ~50%, percentage stats gain 5-7 points)
                                    </li>
                                    <li>
                                        Quick access via &quot;Calibrate Gear&quot; in ship dropdown
                                        menus
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Upgrade Analysis Tab
                                </h4>
                                <p className="text-theme-text mb-2">
                                    This tab shows which gear pieces are most likely to improve your
                                    role scores when upgraded. It simulates upgrading unlevelled
                                    gear 10 times, scores each result using the role scoring system,
                                    and averages the results.
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        Results are displayed per role, sorted by score improvement
                                    </li>
                                    <li>Helps identify high-potential gear worth investing in</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Simulate Upgrades Tab
                                </h4>
                                <p className="text-theme-text mb-2">
                                    Simulate upgrading all your unlevelled gear to see potential
                                    outcomes:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        Click &quot;Simulate Upgrades&quot; to randomly upgrade all
                                        unlevelled gear (like the in-game RNG)
                                    </li>
                                    <li>Upgraded stats are displayed on gear cards</li>
                                    <li>
                                        Use &quot;Clear Upgrades&quot; to reset to original stats
                                    </li>
                                    <li>
                                        Enable &quot;Use upgraded stats&quot; in autogear to factor
                                        simulated upgrades into optimization
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Wishlist Tab</h4>
                                <p className="text-theme-text mb-2">
                                    The Wishlist tab lets you track gear you are actively farming.
                                    Each entry describes the kind of gear you are looking for, so
                                    you can quickly check whether any newly imported drops match
                                    your goals.
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <strong>Adding an entry:</strong> Give it a name (required,
                                        up to 64 characters) and optionally set any combination of
                                        filters — slot, minimum stars, rarity, gear set, main stat,
                                        and substats. All active filters use AND logic: a gear piece
                                        must satisfy every filter to match. Leaving a filter unset
                                        means it matches anything.
                                    </li>
                                    <li>
                                        <strong>Editing and deleting:</strong> Each entry card has
                                        inline edit and delete buttons.
                                    </li>
                                    <li>
                                        <strong>Search Inventory button:</strong> Searches your
                                        current inventory against all wishlist entries. Results are
                                        shown in tabs, one per entry. If no gear in your inventory
                                        matches an entry, that tab shows &quot;No gear in your
                                        inventory matches this entry yet&quot;.
                                    </li>
                                    <li>
                                        <strong>Import Summary integration:</strong> After importing
                                        game data, newly imported gear that matches any wishlist
                                        entry appears in a &quot;Wishlist Hits&quot; section inside
                                        the Import Summary modal. This section is hidden on a
                                        first-ever import, when there is no previous import to
                                        compare against.
                                    </li>
                                </ul>
                            </div>

                            <div className="mt-4 p-4 bg-yellow-900/50 border border-yellow-700">
                                <h4 className="font-semibold text-yellow-200 mb-2">Pro Tips</h4>
                                <ul className="text-yellow-100 space-y-2">
                                    <li>
                                        Use the equipped filter to quickly find gear that&apos;s not
                                        being used
                                    </li>
                                    <li>
                                        Search by stat names to find gear with specific stat
                                        combinations
                                    </li>
                                    <li>
                                        Check the Upgrade Analysis tab regularly to identify gear
                                        that has a good probability of being a good piece, once
                                        upgraded.
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* Gear Optimization Section */}
                    <section id="autogear" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Autogear
                        </h2>
                        <div className="card">
                            <h3 className="text-xl font-semibold mb-2">Autogear System</h3>
                            <p className="mb-4">
                                The autogear system uses advanced algorithms to find the optimal
                                gear combinations for your ships. It takes into account various
                                factors including:
                            </p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>Ship role and type</li>
                                <li>Stat priorities and requirements</li>
                                <li>Gear set bonuses</li>
                                <li>Equipment constraints</li>
                                <li>Stat bonuses and synergies</li>
                            </ul>

                            <div className="space-y-4">
                                <h3 className="text-xl font-semibold mt-6 mb-2">
                                    Ship Roles and Scoring
                                </h3>
                                <div className="space-y-4">
                                    <p className="text-theme-text">
                                        Each ship role has specific scoring criteria that determine
                                        how gear combinations are evaluated. Understanding these
                                        criteria helps you make better decisions about gear
                                        optimization.
                                        <br />
                                        <br />
                                        <strong>
                                            PRO TIP: Edit ship roles in the ships page to
                                            automatically set the chosen role for the autogear tool.
                                            Roles persists through imports.
                                        </strong>
                                    </p>
                                    <h4 className="text-lg font-semibold">Attacker Roles</h4>
                                    <div className="flex flex-wrap gap-4">
                                        <div className="card">
                                            <h4 className="font-semibold text-primary">Attacker</h4>
                                            <p className="text-theme-text">
                                                Focuses on maximizing damage output through:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Base attack damage</li>
                                                <li>Critical hit chance and damage</li>
                                                <li>Defense penetration</li>
                                            </ul>
                                        </div>
                                    </div>
                                    <h4 className="text-lg font-semibold">Defender Roles</h4>
                                    <div className="flex flex-wrap gap-4">
                                        <div className="card">
                                            <h4 className="font-semibold text-primary">Defender</h4>
                                            <p className="text-theme-text">
                                                Optimizes for survival through:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Effective HP (HP × damage reduction)</li>
                                                <li>Healing and shield regeneration</li>
                                                <li>Survival rounds calculation</li>
                                            </ul>
                                        </div>

                                        <div className="card">
                                            <h4 className="font-semibold text-primary">
                                                Defender (Security)
                                            </h4>
                                            <p className="text-theme-text">
                                                Combines defensive capabilities with security:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Base defender score</li>
                                                <li>Security stat multiplier</li>
                                                <li>Balanced defensive stats</li>
                                            </ul>
                                        </div>
                                    </div>
                                    <h4 className="text-lg font-semibold">Debuffer Roles</h4>
                                    <div className="flex flex-wrap gap-4">
                                        <div className="card">
                                            <h4 className="font-semibold text-primary">Debuffer</h4>
                                            <p className="text-theme-text">
                                                Specializes in hacking and damage:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Hacking stat × DPS</li>
                                            </ul>
                                        </div>

                                        <div className="card">
                                            <h4 className="font-semibold text-primary">
                                                Debuffer (Defensive)
                                            </h4>
                                            <p className="text-theme-text">
                                                Balances hacking with survivability:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Hacking stat × Effective HP</li>
                                            </ul>
                                        </div>

                                        <div className="card">
                                            <h4 className="font-semibold text-primary">
                                                Debuffer (Defensive, Security)
                                            </h4>
                                            <p className="text-theme-text">
                                                Anti-debuffer specialist with survivability:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Hacking × Security × Effective HP</li>
                                            </ul>
                                        </div>

                                        <div className="card">
                                            <h4 className="font-semibold text-primary">
                                                Debuffer (Bomber)
                                            </h4>
                                            <p className="text-theme-text">
                                                Focuses on hacking and raw attack power:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Hacking stat × Attack</li>
                                            </ul>
                                        </div>

                                        <div className="card">
                                            <h4 className="font-semibold text-primary">
                                                Debuffer (Corrosion)
                                            </h4>
                                            <p className="text-theme-text">
                                                DoT specialist for long-term damage:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Hacking stat × Decimation</li>
                                                <li>Optimized for corrosion stacking</li>
                                            </ul>
                                        </div>
                                    </div>
                                    <h4 className="text-lg font-semibold">Supporter Roles</h4>
                                    <div className="flex flex-wrap gap-4">
                                        <div className="card">
                                            <h4 className="font-semibold text-primary">
                                                Supporter
                                            </h4>
                                            <p className="text-theme-text">
                                                Optimizes healing capabilities:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Base healing (15% of HP)</li>
                                                <li>Critical hit multiplier</li>
                                                <li>Heal modifier</li>
                                            </ul>
                                        </div>

                                        <div className="card">
                                            <h4 className="font-semibold text-primary">
                                                Supporter (Buffer)
                                            </h4>
                                            <p className="text-theme-text">
                                                Focuses on speed and defensive support:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Speed × 10 (base weight)</li>
                                                <li>
                                                    Boost set bonus (30,000 points for 4 pieces)
                                                </li>
                                                <li>Effective HP (scaled down)</li>
                                            </ul>
                                        </div>

                                        <div className="card">
                                            <h4 className="font-semibold text-primary">
                                                Supporter (Offensive)
                                            </h4>
                                            <p className="text-theme-text">
                                                Balances speed with attack power:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Speed × 10 (base weight)</li>
                                                <li>Attack power (square root scaled)</li>
                                                <li>
                                                    Boost set bonus (30,000 points for 4 pieces)
                                                </li>
                                            </ul>
                                        </div>

                                        <div className="card">
                                            <h4 className="font-semibold text-primary">
                                                Supporter (Shield)
                                            </h4>
                                            <p className="text-theme-text">
                                                Maximizes shielding capability:
                                            </p>
                                            <ul className="text-theme-text list-disc pl-4 space-y-1">
                                                <li>Maximize HP</li>
                                                <li>
                                                    Best for ships that provide shields based on HP
                                                </li>
                                            </ul>
                                        </div>
                                    </div>
                                    <div className="mt-4 p-4 bg-blue-900/50 border border-blue-700">
                                        <h4 className="font-semibold text-blue-200 mb-2">
                                            Scoring System Notes
                                        </h4>
                                        <ul className="text-blue-100 space-y-2">
                                            <li>
                                                Each role has a unique scoring formula that
                                                prioritizes different stats and combinations.
                                            </li>
                                            <li>
                                                Stat bonuses are applied after the base score
                                                calculation.
                                            </li>
                                            <li>
                                                Penalties are applied as percentage reductions to
                                                the final score.
                                            </li>
                                        </ul>
                                    </div>
                                </div>

                                <h3 className="text-xl font-semibold mt-6 mb-2">
                                    Configuration Options
                                </h3>

                                <p className="text-theme-text mb-4">
                                    Open Settings on a selected ship to pick a{' '}
                                    <strong>Strategy</strong> (role) and add{' '}
                                    <strong>Your tweaks</strong> on top — stat priorities, set
                                    requirements, or stat bonuses. Click{' '}
                                    <strong>+ Add tweak</strong> to choose a type, then fill in the
                                    form. Each row has up/down chevrons to reorder it within its
                                    list — order matters, higher tweaks weigh more in scoring.
                                </p>

                                <div className="card">
                                    <h4 className="font-semibold">Stat Priorities</h4>
                                    <p className="text-theme-text">
                                        Define minimum and maximum values for specific stats. The
                                        algorithm will try to keep stats within these ranges while
                                        optimizing the overall build. You can also limit{' '}
                                        <strong>Effective HP</strong> — a derived survivability
                                        value combining HP, Defense, and damage reduction.
                                    </p>
                                    <p className="text-theme-text mt-2">
                                        Each row has an <strong>Edit</strong> button (opens the form
                                        pre-filled) and supports inline number editing — click any
                                        number to change it directly.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold">Hard Requirements</h4>
                                    <p className="text-theme-text mb-2">
                                        Any min/max limit on a stat priority can be flagged as a{' '}
                                        <strong>Hard Requirement</strong> via the checkbox in the
                                        priority form. Soft limits work by penalizing the score when
                                        they&apos;re missed; the optimizer can still choose to miss
                                        them if the trade-off is worthwhile. Hard requirements are
                                        different &mdash; the optimizer is instructed to{' '}
                                        <em>never</em> pick a combo that violates them, if any
                                        feasible combo exists in your inventory.
                                    </p>
                                    <p className="text-theme-text">
                                        When the algorithm can&apos;t find a combo that meets every
                                        hard requirement on the first try, it retries up to five
                                        times with fresh random starting points. If no attempt
                                        produces a feasible combo, the closest-to-feasible result is
                                        shown along with a list of which requirements were missed
                                        and by how much &mdash; so you can adjust your limits to
                                        something your inventory can actually hit.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold">Set Priorities</h4>
                                    <p className="text-theme-text">
                                        Specify which gear sets you want to complete and how many
                                        pieces of each set. The algorithm will prioritize completing
                                        these sets while maintaining stat requirements. Setting the
                                        count to 0, will prevent that gear set from being in the
                                        calculations.
                                    </p>
                                    <p className="text-theme-text mt-2">
                                        Each row has an <strong>Edit</strong> button (opens the form
                                        pre-filled) and supports inline number editing — click any
                                        number to change it directly.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold">Stat Bonuses</h4>
                                    <p className="text-theme-text">
                                        Add bonus effects that contribute to the role score. For
                                        example, an attacker that gains extra damage equal to 10% of
                                        HP.
                                    </p>
                                    <p className="text-theme-text mt-2">
                                        Each row has an <strong>Edit</strong> button (opens the form
                                        pre-filled) and supports inline number editing — click any
                                        number to change it directly.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold">Buffs</h4>
                                    <p className="text-theme-text">
                                        Add external buffs as tweaks (e.g. Volk&apos;s +30% crit
                                        rate from a commander ability). The scorer inflates the
                                        ship&apos;s stats before optimising, so gear choices reflect
                                        the ship&apos;s true in-combat performance. Percentage-only
                                        stats (crit, crit power, def pen, etc.) receive the buff as
                                        a flat addition; flat stats (attack, HP, defence, etc.)
                                        receive it as a percentage multiplier.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold">Equipment Constraints</h4>
                                    <ul className="text-theme-text list-disc pl-4 space-y-1">
                                        <li>
                                            <strong>Ignore currently equipped gear:</strong> When
                                            enabled, the algorithm will only consider gear that
                                            isn&apos;t equipped on other ships.
                                        </li>
                                        <li>
                                            <strong>Ignore unleveled gear:</strong> When enabled,
                                            the algorithm will only consider gear that has been
                                            leveled up. Note: This does not apply to implants as
                                            they don&apos;t have levels.
                                        </li>
                                        <li>
                                            <strong>Use upgraded stats:</strong> When enabled, the
                                            algorithm will consider gear that has been upgraded in
                                            the Upgrade Analysis tab in the Gear page.
                                        </li>
                                        <li>
                                            <strong>Include calibrated gear:</strong> When enabled,
                                            gear calibrated to other ships is included in the
                                            search. On its own it scores that gear at its base stats
                                            — without the calibration bonus, which belongs to the
                                            other ship.
                                        </li>
                                        <li>
                                            <strong>Assume all gear is calibrated:</strong> When
                                            enabled, every calibration-eligible piece (5-6 star,
                                            level 16) is scored as if it were calibrated to this
                                            ship. Without it, an already-calibrated piece competes
                                            against uncalibrated gear while holding a bonus that
                                            gear could equally have, so the optimizer keeps
                                            recommending whatever you calibrated first. The two
                                            calibration options are independent: &quot;Include
                                            calibrated gear&quot; decides what is available, this
                                            one decides how it is scored — with both on, gear
                                            calibrated elsewhere is included and gets the bonus too.
                                            With &quot;Use upgraded stats&quot; on, gear below level
                                            16 is included as well, since it would be eligible once
                                            upgraded. Your ship&apos;s current gear is scored the
                                            same way, so the before/after difference is the gain
                                            from swapping gear rather than from calibrating what you
                                            already wear. Suggested pieces needing calibration are
                                            marked; calibration is a limited resource, so check that
                                            the result is one you can actually afford.
                                        </li>
                                        <li>
                                            <strong>Optimize implants:</strong> When enabled, the
                                            algorithm will also optimize your ship&apos;s implants
                                            (Major and 3 Minor slots). Ultimate implants are not
                                            optimized but will be displayed if equipped. Implants
                                            use the same stat priorities as gear and follow the same
                                            &quot;Ignore equipped&quot; rules.
                                        </li>
                                    </ul>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold">Arena Season Modifiers</h4>
                                    <p className="text-theme-text">
                                        PVP arena seasons apply temporary stat modifiers to ships
                                        based on conditions like faction, rarity, or role (e.g.,
                                        &quot;all epic defenders get +150% HP and +150% DEF&quot;).
                                        When an active arena season exists, you can enable the
                                        &quot;Apply arena modifiers&quot; checkbox to have the
                                        autogear algorithm account for these modifiers when scoring
                                        gear loadouts.
                                    </p>
                                    <ul className="text-theme-text list-disc pl-4 space-y-1 mt-2">
                                        <li>
                                            Modifiers are applied to total stats before scoring —
                                            they shift which gear the algorithm considers optimal.
                                        </li>
                                        <li>
                                            Multiple rules can stack: if a ship matches several
                                            rules, their modifiers are summed per stat.
                                        </li>
                                        <li>
                                            The modified stats are only used for scoring — your
                                            ship&apos;s displayed stats remain unchanged.
                                        </li>
                                        <li>
                                            Arena seasons are managed by admins and expire
                                            automatically when their end date passes.
                                        </li>
                                    </ul>
                                </div>
                            </div>

                            <h3 className="text-xl font-semibold mt-6 mb-2">
                                Available Algorithms
                            </h3>
                            <div className="space-y-4">
                                <div className="card">
                                    <h4 className="font-semibold text-primary">
                                        Genetic Algorithm (Recommended)
                                    </h4>
                                    <p className="text-theme-text">
                                        Easily the best algorithm, an evolution-inspired approach
                                        that maintains a population of potential solutions and
                                        evolves them over time. This algorithm is particularly good
                                        at finding balanced gear combinations that satisfy multiple
                                        requirements.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold text-primary">
                                        Two-Pass Algorithm
                                    </h4>
                                    <p className="text-theme-text">
                                        A fast algorithm that first optimizes individual stats, then
                                        looks for opportunities to complete gear sets. Good for
                                        quick results when you have specific stat requirements.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold text-primary">
                                        Set-First Approach
                                    </h4>
                                    <p className="text-theme-text">
                                        Prioritizes completing gear sets before optimizing
                                        individual stats. Best used when set bonuses are crucial for
                                        your build.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold text-primary">Beam Search</h4>
                                    <p className="text-theme-text">
                                        A balanced approach that keeps multiple possible
                                        configurations in consideration. Good for finding
                                        near-optimal solutions when you have complex requirements.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-6 p-4 bg-yellow-900/50 border border-yellow-700">
                                <h4 className="font-semibold text-yellow-200 mb-2">
                                    Important Notes
                                </h4>
                                <ul className="text-yellow-100 space-y-2">
                                    <li>
                                        The autogear system uses shortcuts to handle the large
                                        number of possible combinations. Results are based on about
                                        30-40k comparisons, so running it multiple times may yield
                                        different optimal solutions.
                                    </li>
                                    <li>
                                        Consider unchecking the &quot;Ignore currently equipped
                                        gear&quot; option if you want to look through all your gear
                                        on other ships aswell. Use it together with the Ship
                                        Equipment Lock to exclude certain ships from this field.
                                    </li>
                                    <li>
                                        For best results, combine autogear suggestions with manual
                                        adjustments in the secondary requirements accordion based on
                                        your specific needs.
                                    </li>
                                </ul>
                            </div>

                            <h3 className="text-xl font-semibold mt-6 mb-2">
                                After running autogear
                            </h3>
                            <p className="text-theme-text">
                                After running autogear, you can see the gear suggestions on the
                                right side of the page, together with an equip all button, a lock
                                equipment button, and an expand gear button.
                                <br />
                                <br />
                            </p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>
                                    The equip all button will equip all the gear suggestions at
                                    once. If other ships have it equipped, it will ask before
                                    removing it from them.
                                </li>
                                <li>
                                    The lock equipment button will lock the ship currently selected,
                                    to easily continue autogearing other ships.
                                </li>
                                <li>
                                    The expand gear button will expand the gear suggestions to show
                                    the gear pieces as gear cards, so you can see the stats and
                                    bonuses, to easily locate them in game.
                                </li>
                            </ul>

                            <h4 className="text-lg font-semibold mt-6 mb-2">
                                Suggested Next Autogear
                            </h4>
                            <p className="text-theme-text mb-4">
                                After equipping suggestions, a{' '}
                                <span className="text-primary">Suggested Next Autogear</span> panel
                                appears showing ships that may need attention — starred ships with
                                empty slots, and any ships whose gear was just reassigned (donor
                                ships). Click <span className="text-primary">Select</span> on a ship
                                to queue it as the next autogear target, or click{' '}
                                <span className="text-primary">Select All</span> (visible when there
                                are 2 or more suggestions) to load all of them into the queue at
                                once.
                            </p>

                            <h4 className="text-lg font-semibold mt-6 mb-2">Simulation Results</h4>
                            <p className="text-theme-text">
                                The simulation results will show you a comparison of the gear
                                suggestions, and the current gear on the ship, based on the
                                different goals of the roles.
                                <br />
                                <br />
                            </p>
                        </div>

                        <div className="card">
                            <h3 className="text-xl font-semibold mb-2">Teams</h3>
                            <p className="mb-4">
                                Autogear processes ships in the order you select them — the first
                                ship gets first pick of your gear. Once you have selected at least
                                two ships, use <strong>Save Team</strong> to store that ordered
                                selection under a name, and <strong>Add Team</strong> to load it
                                back later. Each ship arrives with whatever role and stat priorities
                                you already saved for it.
                            </p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>
                                    Team names must be unique. To change a team, delete it and save
                                    again.
                                </li>
                                <li>
                                    Loading a team replaces your current selection, asking first if
                                    ships are already selected.
                                </li>
                                <li>
                                    Ships that have left your fleet are skipped when a team loads,
                                    and the team itself is left untouched.
                                </li>
                                <li>
                                    <span className="text-primary">From encounter:</span> the Add
                                    Team dialog can also load a saved encounter&apos;s ships,
                                    ordered by the turn order you assigned in the formation. Nothing
                                    is saved until you use Save Team, so you can adjust the group
                                    first.
                                </li>
                                <li>
                                    Use the up and down arrows beside each ship to change the order.
                                    The first ship gets first pick of your gear, so the order is
                                    worth getting right.
                                </li>
                                <li>
                                    Reordering a team you loaded saves the new order to that team
                                    automatically. Add, remove or swap a ship and it stops being
                                    that team, so only the order is ever saved this way.
                                </li>
                            </ul>
                        </div>
                    </section>

                    {/* Community Recommendations Section */}
                    <section
                        id="community-recommendations"
                        className="space-y-4 [counter-increment:section]"
                    >
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Community Recommendations
                        </h2>
                        <div className="card space-y-4">
                            <p className="text-theme-text">
                                The community recommendations system allows players to share their
                                autogear configurations with others.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Viewing Recommendations
                                </h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        When you select a ship, every community build shared for
                                        that ship is listed, best rated first
                                    </li>
                                    <li>
                                        Builds tagged for the ultimate implant you have equipped
                                        sort to the top; builds for a different implant stay visible
                                        at the bottom
                                    </li>
                                    <li>
                                        Click a build to expand its full configuration — role, stat
                                        priorities, gear sets, stat bonuses, fleet buffs and implant
                                        settings
                                    </li>
                                    <li>
                                        Sort by top rated or newest, and see each build&apos;s refit
                                        level
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Sharing Your Build
                                </h4>
                                <ol className="text-theme-text list-decimal pl-4 space-y-1">
                                    <li>
                                        Configure your autogear settings (role, stat priorities,
                                        gear sets, stat bonuses, fleet buffs, implant settings)
                                    </li>
                                    <li>
                                        Click &quot;Share your build&quot; to open the share form —
                                        it previews exactly what will be published
                                    </li>
                                    <li>
                                        Add a descriptive title (e.g., &quot;High Crit DPS
                                        Build&quot;)
                                    </li>
                                    <li>Optionally add a description explaining your strategy</li>
                                    <li>
                                        Check &quot;Only show to users with same ultimate
                                        implant&quot; if your build is implant-specific
                                    </li>
                                    <li>Click &quot;Share&quot; to publish</li>
                                </ol>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Voting</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        Click &quot;Helpful&quot; or &quot;Not Helpful&quot; to vote
                                        on recommendations
                                    </li>
                                    <li>Your votes help surface the best builds for each ship</li>
                                    <li>Sign in required to vote or share</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Applying a Build
                                </h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        Click &quot;Apply to autogear&quot; on an expanded build to
                                        copy it into your configuration for that ship
                                    </li>
                                    <li>
                                        It replaces role, stat priorities, gear sets, stat bonuses,
                                        fleet buffs and implant settings
                                    </li>
                                    <li>
                                        Your own preferences are never changed: algorithm, ignore
                                        equipped, ignore unleveled, use upgraded stats, complete
                                        sets, calibration and arena modifiers all stay as you set
                                        them
                                    </li>
                                    <li>
                                        You are asked to confirm whenever applying would overwrite
                                        an existing configuration
                                    </li>
                                    <li>
                                        Builds shared before August 2026 carry role, stat
                                        priorities, gear sets and stat bonuses only
                                    </li>
                                </ul>
                            </div>

                            <div className="mt-4 p-4 bg-blue-900/50 border border-blue-700">
                                <h4 className="font-semibold text-blue-200 mb-2">Pro Tips</h4>
                                <ul className="text-blue-100 space-y-2">
                                    <li>
                                        Use descriptive titles that highlight the build&apos;s
                                        purpose (e.g., &quot;Arena Speed Build&quot; or &quot;Vault
                                        Tank Build&quot;)
                                    </li>
                                    <li>
                                        When your build relies on a specific ultimate implant,
                                        enable the implant filter to help users find relevant
                                        recommendations
                                    </li>
                                    <li>
                                        Check community recommendations before running autogear to
                                        see what works for other players
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* Engineering Stats Section */}
                    <section
                        id="engineering-stats"
                        className="space-y-4 [counter-increment:section]"
                    >
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Engineering Stats
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Ship Type Bonuses</h3>
                            <p className="text-theme-text">
                                The Engineering Stats page allows you to manage per-ship-type
                                engineering bonuses that apply to all ships of that type in your
                                fleet. The page has three tabs: Engineering Stats, Preview Upgrade,
                                and Optimizer.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Engineering Stats Tab
                                </h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Set engineering bonuses for each ship type</li>
                                    <li>Bonuses automatically apply to all ships of that type</li>
                                    <li>Import engineering data from game exports</li>
                                    <li>Edit bonuses for Attack, Defense, HP, and other stats</li>
                                    <li>
                                        Engineering bonuses are factored into autogear calculations
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Preview Upgrade Tab
                                </h4>
                                <p className="text-theme-text mb-2">
                                    See how investing in engineering upgrades will affect your ships
                                    before spending resources:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Select a ship and role to analyze</li>
                                    <li>Choose which engineering stat to preview upgrading</li>
                                    <li>See current stats vs. stats after the upgrade</li>
                                    <li>
                                        View simulation results showing DPS, survivability, and
                                        other role-specific metrics
                                    </li>
                                    <li>
                                        Helps decide which engineering stats to prioritize for each
                                        role
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Optimizer Tab</h4>
                                <p className="text-theme-text">
                                    The <strong>Optimizer</strong> tab recommends the most impactful
                                    engineering upgrades for your token budget. It scores each
                                    possible next-level upgrade by the average % score improvement
                                    it would give your starred ships of that role, divided by the
                                    token cost. The ranked queue shows you exactly where to spend
                                    for maximum fleet impact.
                                </p>
                            </div>

                            <div className="mt-4 p-4 bg-yellow-900/50 border border-yellow-700">
                                <h4 className="font-semibold text-yellow-200 mb-2">Pro Tip</h4>
                                <p className="text-yellow-100">
                                    Keep your engineering stats up to date by importing fresh game
                                    data regularly. Use the Preview Upgrade tab to make informed
                                    decisions about where to invest your engineering points.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Loadouts Section */}
                    <section id="loadouts" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Loadouts
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">
                                Save and Manage Ship Configurations
                            </h3>
                            <p className="text-theme-text">
                                Loadouts allow you to save ship configurations for easy switching
                                between different gear setups and team compositions.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Individual Loadouts
                                </h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Save current gear configuration for a ship</li>
                                    <li>Create multiple loadouts per ship</li>
                                    <li>
                                        Name loadouts for different purposes (Arena, Vault, etc.)
                                    </li>
                                    <li>Quick restore to saved configuration</li>
                                    <li>Compare loadout stats side-by-side</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Team Loadouts</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Save entire team compositions</li>
                                    <li>Store gear configuration for all ships in a team</li>
                                    <li>Perfect for Arena, Vault, or Faction Ops setups</li>
                                    <li>Restore entire team with one click</li>
                                </ul>
                            </div>

                            <div className="mt-4 p-4 bg-yellow-900/50 border border-yellow-700">
                                <h4 className="font-semibold text-yellow-200 mb-2">Pro Tips</h4>
                                <ul className="text-yellow-100 space-y-2">
                                    <li>
                                        Create separate loadouts for different content types (Arena,
                                        Vault, Faction Ops)
                                    </li>
                                    <li>
                                        Use descriptive names to easily identify loadout purposes
                                    </li>
                                    <li>
                                        Update loadouts after major gear upgrades or acquisitions
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* Ship Database Section */}
                    <section id="ship-database" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Ship Database
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Browse All Ships</h3>
                            <p className="text-theme-text">
                                The Ship Database provides a comprehensive reference for all ships
                                available in Starborne Frontiers.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>View base stats for all ships at level 60</li>
                                    <li>Filter by faction, ship type, rarity, and affinity</li>
                                    <li>
                                        Filter by skill targeting — &quot;Target&quot; (target
                                        selection: Front, Back, Skip, All, Self, Allies, Other
                                        Allies) and &quot;Pattern&quot; (AoE pattern shape)
                                    </li>
                                    <li>
                                        Search ships by name or targeting terms (e.g.
                                        &quot;cone&quot; or &quot;backline&quot;)
                                    </li>
                                    <li>Sort by various stats</li>
                                    <li>View detailed ship information including abilities</li>
                                    <li>
                                        Access ship leaderboards to see top-performing
                                        configurations
                                    </li>
                                </ul>
                                <p className="text-theme-text mt-4">
                                    Ships can have up to three passive skills: first passive
                                    (unlocked at lower ranks), second passive (unlocked at higher
                                    ranks), and third passive (available on newest ships).
                                </p>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Implant Database
                                </h4>
                                <p className="text-theme-text mb-2">
                                    Similar to the Ship Database, the Implant Database lets you
                                    browse all available implants:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>View all Minor, Major, and Ultimate implants</li>
                                    <li>Filter by implant type and slot</li>
                                    <li>See detailed implant effects and descriptions</li>
                                    <li>Compare implant stats and bonuses</li>
                                </ul>
                            </div>

                            <div className="mt-4 p-4 bg-blue-900/50 border border-blue-700">
                                <h4 className="font-semibold text-blue-200 mb-2">Use Cases</h4>
                                <ul className="text-blue-100 space-y-2">
                                    <li>Research ships before acquisition</li>
                                    <li>Compare stats across factions and types</li>
                                    <li>Plan future team compositions</li>
                                    <li>Learn about ship abilities and synergies</li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* Effect Index Section */}
                    <section id="effect-index" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Effect Index
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">
                                Browse All Buffs, Debuffs, and Effects
                            </h3>
                            <p className="text-theme-text">
                                The Effect Index provides a comprehensive reference of all buffs,
                                debuffs, and effects in the game. Use the search bar to find
                                specific effects or filter by type.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Search effects by name, type, or description</li>
                                    <li>Filter by type: buffs, debuffs, or effects</li>
                                    <li>Sort effects alphabetically</li>
                                    <li>Color-coded badges for quick identification</li>
                                    <li>Over 155 effects catalogued</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Effect Types</h4>
                                <div className="space-y-3 text-theme-text">
                                    <div>
                                        <span className="text-green-400 font-semibold">Buffs:</span>{' '}
                                        Positive effects that enhance your ship&apos;s capabilities
                                        (e.g., Attack Up, Defense Up, Speed Up)
                                    </div>
                                    <div>
                                        <span className="text-red-400 font-semibold">Debuffs:</span>{' '}
                                        Negative effects applied to enemy ships that reduce their
                                        effectiveness (e.g., Attack Down, Corrosion, Stasis)
                                    </div>
                                    <div>
                                        <span className="text-blue-400 font-semibold">
                                            Effects:
                                        </span>{' '}
                                        Utility effects that modify gameplay mechanics (e.g.,
                                        Cleanse, Purge, Charge Manipulation)
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 p-4 bg-green-900/50 border border-green-700">
                                <h4 className="font-semibold text-green-200 mb-2">Pro Tip</h4>
                                <p className="text-green-100">
                                    Use the Effect Index as a quick reference during battles to
                                    understand what status effects are doing. Search for keywords
                                    like &quot;hacking&quot; or &quot;security&quot; to find effects
                                    that interact with specific stats.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Squad Leaders Section */}
                    <section id="squad-leaders" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Squad Leaders
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">
                                Faction Squad Leaders and Their Bonuses
                            </h3>
                            <p className="text-theme-text">
                                Each faction has three squad leaders — one rare, one epic, and one
                                legendary — and each leader grants fleet-wide bonuses to that
                                faction&apos;s units. A leader has three upgrade steps (I, II, III)
                                whose bonuses are cumulative: a leader upgraded to step III has all
                                three steps active at once.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Browse every faction&apos;s three squad leaders</li>
                                    <li>Filter by faction and rarity</li>
                                    <li>Search by leader name or effect text</li>
                                    <li>See each step&apos;s effects laid out I / II / III</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Reading Effects</h4>
                                <div className="space-y-3 text-theme-text">
                                    <div>
                                        <span className="text-green-400 font-semibold">
                                            Ally bonuses:
                                        </span>{' '}
                                        Stat increases and combat modifiers granted to your own
                                        faction&apos;s units (e.g., +8% Attack, shield each round).
                                    </div>
                                    <div>
                                        <span className="text-red-400 font-semibold">
                                            Enemy effects:
                                        </span>{' '}
                                        Reductions applied to enemy units (e.g., lower Defence or
                                        Security, reduced enemy repair output).
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Leaderboards Section */}
                    <section id="leaderboards" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Leaderboards
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">
                                Ship Performance Rankings
                            </h3>
                            <p className="text-theme-text">
                                Leaderboards showcase the highest-scoring ship configurations for
                                each ship type across all users.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>View top configurations for any ship</li>
                                    <li>See role-specific scores (Attacker, Defender, etc.)</li>
                                    <li>Compare your ship performance against community leaders</li>
                                    <li>
                                        <strong>Relative scores:</strong> Visual bars show how each
                                        entry compares to the top score
                                    </li>
                                    <li>View gear, implants, and stats of top performers</li>
                                    <li>Filter by specific ship roles</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    How to Access Leaderboards
                                </h4>
                                <ol className="text-theme-text list-decimal pl-4 space-y-1">
                                    <li>Go to Ship Database</li>
                                    <li>Click on any ship card</li>
                                    <li>Click the &quot;View Leaderboard&quot; button</li>
                                </ol>
                            </div>

                            <div className="mt-4 p-4 bg-yellow-900/50 border border-yellow-700">
                                <h4 className="font-semibold text-yellow-200 mb-2">Pro Tip</h4>
                                <p className="text-yellow-100">
                                    Study top leaderboard entries to discover optimal gear
                                    combinations, set bonuses, and stat distributions for your
                                    ships. The relative score bars help you quickly identify how
                                    competitive your build is.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Lore Section */}
                    <section id="lore" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Lore
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Ship Bios and World Lore</h3>
                            <p className="text-theme-text">
                                The Lore page provides immersive storytelling with ship biographies,
                                character quotes, and world lore articles. Two tabs let you explore
                                ship bios and world lore separately, with full-text search across
                                both.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Ship Bios Tab</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Browse biographies for 149 ships</li>
                                    <li>Read character quotes and author information</li>
                                    <li>Search ships by name, faction, or bio content</li>
                                    <li>
                                        Quick links to ship details and databases from bio cards
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">World Lore Tab</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Read 30 articles about the game world and universe</li>
                                    <li>Explore lore directly from starborne.com</li>
                                    <li>Search lore articles by title and content</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Audio Reader</h4>
                                <p className="text-theme-text mb-2">
                                    The lore page includes a text-to-speech audio reader. Use{' '}
                                    <strong>Play All</strong> in the toolbar to listen through all
                                    entries in the current tab hands-free, or the play button on any
                                    card to hear a single entry. Playback uses the browser&apos;s
                                    built-in speech synthesis (prefers the Microsoft Michelle Online
                                    voice on Windows).
                                </p>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Cross-Tab Search
                                </h4>
                                <p className="text-theme-text">
                                    The search bar works across both tabs. When you search, results
                                    from the other tab appear below with a separate section header,
                                    making it easy to find related content across ship bios and
                                    world lore.
                                </p>
                            </div>

                            <div className="mt-4 p-4 bg-blue-900/50 border border-blue-700">
                                <h4 className="font-semibold text-blue-200 mb-2">Use Cases</h4>
                                <ul className="text-blue-100 space-y-2">
                                    <li>
                                        Discover the story and background behind your favorite ships
                                    </li>
                                    <li>
                                        Understand the game world and universe lore while away from
                                        the game
                                    </li>
                                    <li>
                                        Use the audio reader to learn lore hands-free during
                                        commutes or downtime
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* Classified Archive Section */}
                    <section id="classified" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Classified Archive
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Terminal Interface</h3>
                            <p className="text-theme-text">
                                The Classified Archive (<code>/classified</code>) is a hidden
                                terminal interface containing encrypted lore fragments. Navigate and
                                decrypt them to uncover backstory and hidden transmissions.
                            </p>

                            <div className="space-y-4">
                                <div className="card">
                                    <h4 className="font-semibold text-primary mb-2">Navigation</h4>
                                    <ul className="text-theme-text space-y-1 list-disc list-inside">
                                        <li>
                                            <strong>↑ / ↓ arrow keys</strong> — move the cursor
                                            between fragments on the index screen
                                        </li>
                                        <li>
                                            <strong>Enter or click</strong> — open the selected
                                            fragment
                                        </li>
                                        <li>
                                            <strong>ESC</strong> — return to the index from a
                                            fragment detail; from the index, ESC navigates home
                                        </li>
                                        <li>
                                            <strong>Mouse hover</strong> — moves the cursor to the
                                            hovered row
                                        </li>
                                    </ul>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold text-primary mb-2">Decryption</h4>
                                    <p className="text-theme-text">
                                        Each fragment requires an authorisation code. Enter the
                                        correct code to start the decrypt sequence — a progress bar
                                        counts to 100% and the lore text fades in. Once decrypted, a
                                        fragment can be re-read at any time without re-entering the
                                        code. Decrypt all 4 fragments to reveal a final
                                        transmission.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Calculators Section */}
                    <section id="calculators" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Calculators
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">
                                Advanced Combat Calculators
                            </h3>
                            <p className="text-theme-text">
                                Various specialized calculators to analyze and optimize combat
                                performance.
                            </p>

                            <div className="space-y-4">
                                <div className="card">
                                    <h4 className="font-semibold text-primary mb-2">
                                        DPS Calculator
                                    </h4>
                                    <p className="text-theme-text mb-2">
                                        A time-to-kill tool: simulate one or more ship
                                        configurations against a real enemy ship, factoring in
                                        attack, crit rate, crit damage, and defense penetration.
                                        Under Enemy Target you can pick an actual ship &mdash;
                                        filling its stats and skills from game data &mdash; or set
                                        them by hand (defense, HP, security, speed, attack, crit,
                                        crit damage, affinity, type, buffs/debuffs). Once its HP
                                        reaches 0 the fight ends on that round.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            The enemy can fight back:
                                        </span>{' '}
                                        it takes its own turns, and its attack defaults to 0 so a
                                        comparison stays a clean measure of your output &mdash; your
                                        ship cannot be worn down or killed. Give the enemy an attack
                                        value and it starts hitting you, which is what lets ships
                                        built around being hit &mdash; counterattacks, reflects and
                                        on-hit triggers &mdash; contribute their real damage. Those
                                        effects cannot fire while its attack is 0, and your ship can
                                        be destroyed once it is not, which ends the run.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Board slots:</span> each
                                        config and each team ship picks the slot it fights from
                                        (column 4 is the front), which affects targeting patterns
                                        and adjacency. Two team ships cannot share a slot &mdash;
                                        choosing an occupied one swaps them. Separate configs may
                                        share a slot, since each is simulated on its own.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Buffed stats:</span> the crit
                                        multiplier and the average buffed attack/crit shown for each
                                        config are read from the simulation itself, averaged over
                                        every turn your ship takes &mdash; so a buff that only lands
                                        halfway through the fight counts for the part of the fight
                                        it was up, and an extra action counts as the extra turn it
                                        is. Hovering a simulated round in the chart also lists what
                                        each side still carries at the end of that round, which is
                                        what makes an expired or cleansed effect visibly disappear.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Rounds to Kill & Ranking:
                                        </span>{' '}
                                        Each config reports either{' '}
                                        <span className="font-semibold">
                                            &quot;Killed in N rounds&quot;
                                        </span>{' '}
                                        when it destroys the target within the configured round
                                        window, or{' '}
                                        <span className="font-semibold">
                                            &quot;Survived (X% HP left)&quot;
                                        </span>{' '}
                                        when the target outlasts it. Total damage and average
                                        damage/round remain visible as secondary detail. When
                                        comparing multiple configs, they are ranked by fastest kill
                                        first (ties broken by higher total damage), then by lowest
                                        remaining target HP% among configs that don&apos;t secure
                                        the kill. The cumulative damage chart marks the round each
                                        config&apos;s line empties the target&apos;s HP pool.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Ship Skills & Ability Editor:
                                        </span>{' '}
                                        Each ship has three skill slots &mdash; Active, Charged, and
                                        Passive &mdash; that you configure through per-skill ability
                                        editor modals. When you select a ship, its abilities are
                                        auto-filled from the skill text with all components: base
                                        damage, secondary damage, conditional scaling, charge gain,
                                        DoTs, DoT extensions, DoT detonations,
                                        accumulate-and-detonate debuffs (e.g. Echoing Burst), and
                                        buffs/debuffs. All fields are fully editable. Re-selecting a
                                        different ship into a slot rebuilds that ship&apos;s
                                        abilities from its skill text, replacing any manual edits.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        When you select a ship, the calculator automatically
                                        populates skill damage multipliers from your ship&apos;s
                                        skill data. The &quot;Start Charged&quot; checkbox is also
                                        automatically enabled if your selected ship&apos;s skill has
                                        the Start Charged property.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Skill Damage Multipliers:
                                        </span>{' '}
                                        If your ship has skills that deal damage based on specific
                                        stats (e.g., ATTACK, DEFENCE, HACKING), those multipliers
                                        are auto-filled.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Secondary Stat-Based Damage:
                                        </span>{' '}
                                        Ships like Chakara (&quot;+80% of Defense&quot;) and
                                        Lodolite (&quot;+10% of max HP&quot;) deal extra damage
                                        equal to a percentage of their Defense or max HP stat.
                                        Malvex, Quixilver, and FrontLine instead scale off their own
                                        current Shield pool at the moment they attack &mdash; zero
                                        if they haven&apos;t gained any Shield yet. This is
                                        auto-detected from the skill text and shown as an editable
                                        field in each skill row. The secondary damage is added to
                                        the base hit before crit and defense reduction, and scales
                                        with Defense Up / HP buffs (or, for the Shield basis, with
                                        the ship&apos;s live Shield pool).
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Shield Strip:</span> APEX,
                                        Laika, and Malvex remove a percentage of the target&apos;s
                                        current Shield on cast (e.g. &quot;removes 30% of the enemy
                                        Shield&quot;), separate from Lodolite&apos;s legendary refit
                                        that fully strips a purged enemy&apos;s Shield.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Conditional Scaling Damage:
                                        </span>{' '}
                                        Some attackers gain bonus damage that scales with a count,
                                        such as &quot;+20% per adjacent ally&quot; or &quot;+15% per
                                        debuff on the enemy&quot;. When the count derives from your
                                        buffs or the enemy&apos;s debuffs, it is tallied
                                        automatically each round; other conditions take a manual
                                        count. Auto-detected from skill text and editable per skill
                                        row.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Condition Thresholds:</span>{' '}
                                        Effects gated on a count — &quot;if the target has 3 or more
                                        debuffs&quot;, &quot;if this unit has no debuffs&quot; —
                                        fire only when the count actually meets the threshold,
                                        rather than on the first buff or debuff. Auto-detected from
                                        skill text and editable per condition (at least / at most /
                                        exactly N). Self buff and enemy debuff counts are tallied
                                        from sim state; enemy buff and self debuff counts default to
                                        zero under the single-target DPS assumptions.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Deterministic Simulation:
                                        </span>{' '}
                                        The simulator is fully deterministic — identical inputs
                                        always produce identical results. Crits follow a per-round
                                        fractional-accumulator schedule at the ship&apos;s effective
                                        crit rate, with separate schedules for active and charged
                                        hits to avoid cadence aliasing. Rounds where a crit lands
                                        show a <span className="font-semibold">Crit</span> badge in
                                        the chart tooltip. Attacks marked &quot;cannot critically
                                        hit&quot; never crit and consume no crit chance. Debuff and
                                        DoT landing, and chance-based DoT extensions, also follow
                                        deterministic schedules — no randomness anywhere in the sim.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Hard Condition Gates:</span>{' '}
                                        Conditions on damage, additional stat-based damage, DoTs,
                                        DoT detonations, and accumulate-and-detonate abilities now
                                        gate — if the condition is not met in a given round, that
                                        component contributes nothing. &quot;Below X% HP&quot; and
                                        scaling conditions that require a non-zero count also gate
                                        strictly: damage gated on &quot;per enemy debuff&quot; deals
                                        nothing when the enemy has zero debuffs that round.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Derived Enemy HP:</span>{' '}
                                        Enemy HP percentage declines as cumulative damage
                                        accumulates against the configured enemy HP pool, so
                                        execute-style &quot;below X% HP&quot; gates switch on
                                        mid-fight at the correct round rather than always passing or
                                        always failing. Since the target is destructible, reaching
                                        0% HP ends the simulation on that round instead of
                                        continuing on to the full configured window.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Enemy-Applied Stat Debuffs:
                                        </span>{' '}
                                        Debuffs that reduce crit rate, crit power, speed, hacking or
                                        security now take effect when the{' '}
                                        <span className="text-primary">opposing side</span> inflicts
                                        them, not only when a ship debuffs itself. Previously these
                                        five families landed and displayed correctly but changed
                                        nothing at all. So an enemy Speed Down really does push your
                                        ship later in the turn order, a Crit Rate Down really does
                                        stop a ship critting, and Hacking/Security Down really do
                                        move how often debuffs land. Where a ship carries its own
                                        instance of the same debuff family, the{' '}
                                        <span className="text-primary">stronger one wins</span> —
                                        the two never add together.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Ability Execution Order:
                                        </span>{' '}
                                        Abilities within a skill are executed in the same order they
                                        appear in the skill text, matching the game. This means a
                                        DoT inflicted early in a skill can satisfy a later
                                        ability&apos;s &quot;enemy has a debuff&quot; condition in
                                        the same round. You can reorder abilities with the up/down
                                        buttons in the skill editor.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            &quot;Most Buffs&quot; / &quot;Highest Attack&quot;
                                            Targeting:
                                        </span>{' '}
                                        Effects that pick an enemy by a fleet-wide rule — Rhodium
                                        and Lodolite purge{' '}
                                        <span className="text-primary">the most-buffed enemy</span>,
                                        Selenite debuffs the highest-attack one, Chakara hits the
                                        fastest — only ever consider{' '}
                                        <span className="text-primary">living</span> ships. A
                                        destroyed ship keeps the buffs it died holding, so before
                                        this it could keep winning the &quot;most buffs&quot; count
                                        and the purge landed on the wreck. If every buffed enemy is
                                        dead, the effect simply does nothing. Note that Stealth does
                                        not hide a ship from these effects: it hides a ship from
                                        being chosen as an attack target, not from a fleet-wide
                                        search.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Targets Offered Per Effect Type:
                                        </span>{' '}
                                        In the skill editor, the{' '}
                                        <span className="text-primary">Target</span> dropdown only
                                        offers targets that make sense for the effect type you
                                        picked — a Buff cannot be aimed at enemies, and a Damage or
                                        Debuff effect is not offered your own allies. Effects that
                                        genuinely work in both directions (Charge, Control — Taunt
                                        targets your own ship — and Extend Status) keep both sets.
                                        If you already saved an effect whose target is no longer
                                        offered, it stays visible and is marked as not valid for
                                        that effect type, so nothing is silently rewritten.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Charge Manipulation:</span>{' '}
                                        Ships that add charges to their own Charged Skill each round
                                        (e.g. &quot;+1 charge if you crit&quot;) make the charged
                                        skill fire sooner. These self-gain conditions are
                                        auto-detected from skill text and tallied automatically each
                                        round from sim state (crits, enemy debuffs, active self
                                        buffs); you can also set a manual trigger count per
                                        condition. The{' '}
                                        <span className="text-primary">Ally charges / round</span>{' '}
                                        field models supporter ships that feed charges to the
                                        attacker. The{' '}
                                        <span className="text-primary">Enemy Type</span> selector
                                        enables type-conditional charge gains (e.g. gains that only
                                        trigger against a Defender). The simulation summary shows a
                                        &quot;Charged skill fires: every N rounds&quot; line
                                        reflecting the effective cadence.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Start Charged:</span> Some
                                        ships have skills that begin combat already charged. When
                                        detected from your ship&apos;s skill data, this checkbox
                                        will be pre-checked, and the damage from your charged skill
                                        is included in round 1 of the simulation.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Attacker Buffs:</span> Search
                                        and select buffs from the game&apos;s full buff list to
                                        apply to the attacking ship. Attack, Crit Rate, Crit Power,
                                        and Outgoing Direct Damage buffs feed into the existing stat
                                        multipliers. Defense Penetration buffs are added on top of
                                        the ship&apos;s own penetration stat. Buffs with no DPS
                                        effect (e.g. Speed, Hacking) are shown greyed out and have
                                        no impact on the simulation. Stackable buffs include a stack
                                        counter.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Enemy Buffs / Debuffs:</span>{' '}
                                        Select buffs or debuffs that affect the enemy — for example
                                        Defense Down (reduces enemy defense before penetration is
                                        applied) or Incoming Direct Damage Up (multiplies all direct
                                        hits the enemy receives). Out. DoT and Inc. DoT modifiers
                                        from both sections are combined and applied as a single
                                        multiplier on corrosion and inferno damage.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        Buffs and debuffs only apply during the rounds they are
                                        actually active — timed buffs expire after their duration
                                        and charged-skill buffs only appear in rounds where the
                                        charge fires. Hover a round bar on the damage chart to see
                                        which buffs and debuffs are active that round and how many
                                        turns remain.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Turn Order:</span> Each
                                        simulated round, every ship acts once in descending Speed
                                        order — higher Speed acts first, with team support ships
                                        acting before the attacker on ties, and the enemy acting
                                        last by default (enemy default speed 50). A faster support
                                        applies its buffs before your attacker fires; a slower one
                                        starts benefiting you the following round. Set each
                                        ship&apos;s Speed in Combat Settings and on the
                                        attacker&apos;s stats panel. Debuffs that land now persist
                                        their full duration without re-rolling each round. Charged
                                        skills without direct damage (pure utility) still fire on
                                        their normal cadence and apply their effects. Speed Up buffs
                                        make a ship act earlier in the round and Speed Down buffs
                                        push it later — the turn order updates mid-round as speed
                                        changes take effect, so a buff that fires on one ship&apos;s
                                        turn is already reflected in the order for ships that have
                                        not yet acted. Ships with conditional extra actions re-enter
                                        the turn queue at their current Speed, including any live
                                        Speed buffs or debuffs. End-of-round extra actions (such as
                                        Harvester&apos;s on-ally-destroyed passive) drain after
                                        every other ship has acted, regardless of Speed.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Reactive Triggers:</span>{' '}
                                        Skill effects that react to combat events — crit-triggered
                                        debuff inflictions, charge gains on inflicting a debuff,
                                        start-of-round self-buffs, reactions when an ally lands a
                                        DoT with a critical hit (e.g. Crocus inflicting Corrosion),
                                        and reactions when an enemy uses its charged skill (e.g.
                                        Curator purging that enemy&apos;s buffs, FrontLine
                                        counter-attacking for damage and a shield once per round) —
                                        now fire from real combat events rather than being
                                        approximated as always-on conditions. The{' '}
                                        <span className="text-primary">Trigger</span> field in each
                                        ability&apos;s editor controls which event activates it.
                                        Triggers the simulator cannot derive (when attacked, ally
                                        destroyed, etc.) are treated as assume-active, preserving
                                        the existing manual-condition behavior.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Buff Steal:</span> Skills
                                        that &quot;steal a buff from the target&quot; (Pallas,
                                        Thresh, Tithonus) are now modeled as a dedicated Buff Steal
                                        ability in the editor. In a positioned battle the caster
                                        removes the newest buff from its target and takes it for
                                        itself, keeping that buff&apos;s remaining duration &mdash;
                                        buffs the target can&apos;t lose (like Protection) are
                                        skipped. Tithonus&apos; charged skill also grants the stolen
                                        buff to every adjacent ally, and steals before its own purge
                                        resolves, so it takes the newest buff before the purge
                                        strips the rest. Works for both teams. In the single-target
                                        DPS calculator there is no target holding buffs to steal, so
                                        the ability is inert and does not change DPS.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Shields:</span> Shields build
                                        an untimed absorption pool on the holder, capped at its max
                                        HP, that soaks incoming damage before HP is touched and does
                                        not expire on its own. Ships that grant shields to allies
                                        protect every targeted ally. Shield penetration lets an
                                        attack punch through a portion of the shield: that
                                        percentage of a direct hit bypasses the pool and lands
                                        straight on HP, while the rest drains the shield first.
                                        Damage-over-time effects (Inferno and Corrosion) bypass
                                        shields entirely and always hit HP, and bombs drain the
                                        shield in full. A live shield also powers shield-conditional
                                        effects such as the Arcane Siege implant. The per-round ship
                                        overview shows each ship&apos;s shield granted, absorbed,
                                        and current shield pool for the round.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Enemy Adjacency:</span> Some
                                        skills splash their effect onto enemies adjacent to the
                                        target on the board, either including the targeted enemy
                                        (e.g. Asphyxiator&apos;s Inferno and Stasis) or hitting only
                                        its neighbours (e.g. Vindicator&apos;s Provoke and Out.
                                        Damage Down, Meiying&apos;s Stasis). Demolisher&apos;s
                                        passive also detonates a splash equal to 100% of the
                                        exploded Bomb&apos;s damage onto the bombed enemy&apos;s
                                        neighbours, ignoring Defense and unable to critically hit.
                                        This resolves on the positioned board; in the single-target
                                        DPS calculator there are no neighbours, so it has no effect.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Team Ships:</span> Pick a
                                        ship into any of the four team slots and its real skills are
                                        parsed and simulated — the same full ability editor as the
                                        attacker opens on each team card, with combat stats (attack,
                                        crit rate, crit damage, defense penetration, hacking,
                                        defense, HP) and an affinity selector auto-filled from the
                                        ship&apos;s data and fully editable. Team ships deal real
                                        damage, and the round chart reports it as{' '}
                                        <span className="text-primary">Team round total</span> — the
                                        whole side&apos;s output for that round, this ship plus
                                        every ally, with the allies&apos; own share broken out
                                        beside it. The side total is the number to compare when you
                                        swap the attacker: a different attacker buffs its allies
                                        differently and feeds their reactions differently, so it
                                        changes what the rest of the team puts out, and neither
                                        figure alone shows that. Team damage reduces the
                                        enemy&apos;s HP (so HP-threshold gates fire at the right
                                        round) and is never added to the attacker&apos;s own DPS
                                        totals, so the per-config DPS comparison stays a clean
                                        measure of the attacker. Team ships apply their own DoTs and
                                        debuffs on their actual turns using their own stats and
                                        affinity, fire their own reactive triggers (crit-triggered
                                        effects, charge-on-inflict, start-of-round buffs), and grant
                                        ally-wide buffs and charge gains to the whole team —
                                        including the attacker. The buff and debuff pickers on team
                                        cards are manual extras only, for effects not covered by the
                                        ship&apos;s parsed skills. Exposed, Toxic Overflow, and Hit
                                        Mitigation can&apos;t be applied this way — they are
                                        one-shot statuses consumed by a single hit or round, and a
                                        hand-picked status carries no turn count for that to spend,
                                        so picking one manually has no effect; they apply in full
                                        only when a ship&apos;s own skill grants them. On the round
                                        chart, the attacker keeps its solid cumulative line and a
                                        dashed &quot;with team&quot; line shows the side&apos;s
                                        running total; because the enemy dies on that total, the
                                        kill mark sits on the dashed line at the round it empties
                                        the HP pool.
                                    </p>
                                    <p className="text-theme-text">
                                        <span className="text-primary">
                                            Multi-Hit Crits and Extra Actions:
                                        </span>{' '}
                                        Multi-hit skills (e.g. &quot;attacks three times&quot;)
                                        crit-check each hit individually — on-crit follow-up effects
                                        (such as crit-triggered debuffs) fire once per critting hit.
                                        Ships with &quot;extra action&quot; passives (Nuqtu,
                                        Sustainer, Liberator, Tygr, Tormenter) take a full
                                        additional turn each round, re-entering the turn queue at
                                        their Speed position. When an extra turn occurs, the round
                                        tooltip shows a{' '}
                                        <span className="font-semibold">+N extra turn</span> line
                                        beneath the charge counter.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Defense Calculator
                                    </h4>
                                    <p className="text-theme-text mb-2">
                                        Runs the real combat engine over each ship&apos;s own parsed
                                        skills, rather than the older static formula alone. Each
                                        card stacks three figures &mdash; rounds survived, damage
                                        absorbed, and the old static estimate (now Theoretical EHP)
                                        &mdash; so you can see where the measurement and the
                                        estimate agree and where they don&apos;t.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Enemy Team, Team &amp; Rounds:
                                        </span>{' '}
                                        The page has three separate collapsible cards.{' '}
                                        <span className="font-semibold">Enemy Team</span> is where
                                        you build the group bombarding the ship &mdash; real ships
                                        (their parsed skills fire for real) or quick manual
                                        attack/defense lines.{' '}
                                        <span className="font-semibold">Team</span> is its own card,
                                        for healers and protectors on the ship&apos;s own side.{' '}
                                        <span className="font-semibold">Combat Settings</span> holds
                                        only the length of the fight (1&ndash;50 rounds) and the
                                        buffs shared by every configuration. All three apply to
                                        every ship you are comparing, so swapping in a different
                                        build tests it against the exact same pressure.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Rounds survived</span> is the
                                        first headline number: how long the ship lasted, and whether
                                        it was destroyed or was still standing when the window ran
                                        out.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Damage absorbed:</span>{' '}
                                        everything thrown at the ship across the window, summed
                                        across every channel &mdash; direct hits, damage over time,
                                        bombs, detonations and reflected damage &mdash; measured
                                        BEFORE the ship reduced any of it. Every reduction the ship
                                        itself applies is deliberately left out: Defense mitigation,
                                        its own Inc. Damage Down, squad-leader incoming protections,
                                        gear-sourced damage reduction, the Vortex Veil
                                        damage-over-time reduction, block procs, and the reduction
                                        the ship applies to reflected damage coming back at it.
                                        Shields and Barrier still count, because those pools eat
                                        damage that arrived rather than reducing what was thrown
                                        &mdash; and so does Shield Converter, which turns a hit into
                                        shield rather than shrinking it. So a defensive ability on
                                        the ship itself never lowers this number{' '}
                                        <em>through its own damage reduction</em>, and it raises the
                                        number whenever it buys the ship another round.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Two things that ability will not do, though:
                                        </span>{' '}
                                        it will not raise the figure if the ship already survived
                                        the whole window (nothing was killing it either way), nor if
                                        the ship still dies to the very same incoming hit as before.
                                        The figure grows one whole hit at a time &mdash; see below
                                        for why that is not the same as one whole round.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Debuffing the attacker DOES lower it:
                                        </span>{' '}
                                        an <span className="font-semibold">Attack Down</span> or{' '}
                                        <span className="font-semibold">Out. Damage Down</span> your
                                        ship puts on the enemy shooting at it now shrinks what that
                                        enemy throws, so less is thrown and the figure falls.
                                        Measured on a four-round window against one 10,000-attack
                                        enemy: 40,000 absorbed with no debuff, 30,000 with your
                                        Attack Down at &minus;25%, 20,000 at &minus;50%, and 4,000
                                        at &minus;90%. Out. Damage Down behaves the same way, and an
                                        Out. Damage UP on the enemy pushes the figure the other way,
                                        to 60,000. This is a change: for one release the engine
                                        honoured only the attacker&apos;s OWN outgoing modifiers and
                                        silently ignored yours, so every ship that lands one of
                                        these on its attacker read as less durable than it actually
                                        plays. Seventeen ships inflict an Attack Down or an Out.
                                        Damage Down somewhere in their kit, and five of them do it
                                        from a passive rather than from a skill you fire &mdash;
                                        Arum, Bayah, Opal, Shepherd and Warden. Only the
                                        refit-active passive applies, so Opal, Shepherd and Arum
                                        inflict theirs on either of their first two passives, while
                                        Bayah&apos;s and Warden&apos;s need the second passive
                                        active.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            One limit worth knowing:
                                        </span>{' '}
                                        this reaches the ordinary attacks an enemy makes on its
                                        turn, which is the overwhelming majority of what it throws.
                                        It does <span className="font-semibold">not</span> yet reach{' '}
                                        <span className="font-semibold">counter-attacks</span> or{' '}
                                        <span className="font-semibold">reactive procs</span>{' '}
                                        &mdash; those take a different route through the engine and
                                        still ignore a suppressed attacker. So a debuffed enemy that
                                        counters, or that fires a &ldquo;when this happens&rdquo;
                                        passive, hits at full strength for now. Other kinds of buff
                                        and debuff you apply to an enemy are also still added rather
                                        than tier-shadowed across the two sides. Both are tracked as
                                        follow-up work.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Two of the same debuff do not add up.
                                        </span>{' '}
                                        If the enemy is already under an Attack Down and you land
                                        another, the STRONGER one applies on its own &mdash; it does
                                        not stack with the weaker. An enemy carrying a &minus;15%
                                        Attack Down I that you hit with a &minus;45% Attack Down III
                                        throws at &minus;45%, not &minus;60%, and that holds
                                        whichever side applied the stronger one &mdash; if the
                                        enemy&apos;s own is the stronger, yours is the one that is
                                        shadowed. This is the general rule for buffs and debuffs,
                                        not something specific to this page: only damage over time
                                        and bombs stack. Two DIFFERENT debuffs still combine: an
                                        Attack Down and an Out. Damage Down on the same enemy both
                                        apply.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        There is also an exception on the ALLY side rather than the
                                        ship&apos;s own: damage an ally soaks through{' '}
                                        <span className="font-semibold">Protection</span> is counted
                                        against that ALLY, not against this ship, so adding a
                                        protector lowers the figure shown here (a 30% redirect over
                                        the same four rounds takes 40,000 down to 28,000). The slice
                                        is not lost &mdash; it is simply booked on the ship that
                                        actually ate it, which is only visible on that ship&apos;s
                                        own card.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            The figure moves in whole HITS, not whole rounds.
                                        </span>{' '}
                                        It only grows when the ship survives one more incoming hit,
                                        never by the sliver a reduction shaves off each one.{' '}
                                        <span className="font-semibold">
                                            Against a single attacker that is the same thing as a
                                            round
                                        </span>{' '}
                                        &mdash; the round is one hit &mdash; so two such ships that
                                        die on the same round do show the same figure even if one is
                                        tankier.{' '}
                                        <span className="font-semibold">
                                            Against several attackers it is finer than a round.
                                        </span>{' '}
                                        A round is several hits, and a reduction can carry the ship
                                        past the first attacker&apos;s hit so that it also eats the
                                        second before dying; the fight ends with the turn that
                                        destroys the ship, so the frailer one never sees that second
                                        hit at all. Measured on a 100,000 HP ship at 5,000 Defense
                                        under two 40,000-attack enemies: it dies on round 4 having
                                        absorbed 280,000, and with Defense Up II it still dies on
                                        round 4 but absorbs 320,000 &mdash; one extra hit, same
                                        round of death. Deliver that identical pressure with one
                                        80,000-attack enemy instead and both read 320,000. That is
                                        why rounds survived sits above it: the two together tell you
                                        whether a change bought a whole round or just one more hit.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            On a ship that SURVIVES, this number describes the
                                            attackers, not the ship.
                                        </span>{' '}
                                        Nothing killed it, so the figure is simply everything the
                                        enemy team managed to throw in the window &mdash; and two
                                        survivors that both last the FULL window under the same
                                        enemies report the same total however differently tanky they
                                        are, <em>provided neither of them kills an attacker</em>.
                                        Read as a comparison, that tie means nothing. Its own
                                        OFFENCE is the one thing that does separate two survivors,
                                        and it separates them DOWNWARDS &mdash; the harder-hitting
                                        ship is thrown less. That happens two ways. It can end the
                                        fight: wipe the enemy team on round 6 of a 20-round window
                                        and the run stops there, so 14 rounds of fire are never
                                        thrown. Or it can just thin the volley while still standing
                                        for the whole window: measured against two 5,000-attack
                                        enemies over six rounds, a ship with no attack absorbed
                                        60,000, one that killed a single attacker part-way through
                                        absorbed 40,000, and one that killed it sooner absorbed
                                        30,000 &mdash; all three survived all six rounds. The fix
                                        either way is to raise enemy attack, add attackers, or
                                        extend the rounds until the ships actually die; only then
                                        does the figure measure the ship. For a survivor it is a
                                        lower bound on durability, never a limit.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Theoretical EHP</span> is the
                                        third figure, and the old static one: an estimate computed
                                        from configured stats, not a live measurement. No enemy ever
                                        fires at it round by round, and it cannot see shields,
                                        Barrier or self-repair. A kit buff whose own grant carries a
                                        condition is held back UNLESS this figure can tell, from
                                        what you have configured on this page, that the condition is
                                        actually satisfied. HP-based gates are checked against a
                                        ship at full health: Redeemer&apos;s first passive grants
                                        Defense Up II only once its own HP drops below 60%, so at
                                        full health this figure leaves that +30% Defense out &mdash;
                                        on a 100,000 HP ship at 5,000 Defense that is the difference
                                        between counting it (283,125) and holding it back (240,062).
                                        Roster-based gates are checked against the ally and enemy
                                        rosters on this page: Chakara&apos;s &ldquo;lowest Speed
                                        among allies&rdquo; counts as soon as no ally in your team
                                        roster is as slow or slower (an empty team roster counts too
                                        &mdash; Chakara is trivially the slowest ship on a team of
                                        one), and Asphyxiator/Bayah&apos;s &ldquo;enemy has N+
                                        debuffs&rdquo; counts once your team roster is configured to
                                        land at least that many distinct debuffs on a configured
                                        enemy. Every gate is resolved ONCE against that configured
                                        state, not re-evaluated turn by turn &mdash; this is not a
                                        second combat simulation. A gate this figure genuinely
                                        cannot answer (Taunt/Provoke status, a live crit, an enemy
                                        type, and similar) still gets held back, exactly as before.
                                        When a config has one or more buffs held back this way, the
                                        card lists them under &ldquo;Not counted
                                        (conditional)&rdquo; by name and reason, e.g. &ldquo;Defense
                                        Up II - below 60% HP&rdquo;. A buff you add yourself through
                                        the buff picker is unaffected by any of this &mdash; it
                                        always counts, gate or no gate. Because roster-based gates
                                        now read your team and enemy setup, Theoretical EHP is no
                                        longer a pure hangar-stats number &mdash; changing the team
                                        roster or the enemy debuffs you have configured can move it
                                        even though nothing about the measured ship itself changed.
                                        Theoretical EHP is shown so you can compare, but where the
                                        two disagree the measured pair is the one that saw the real
                                        fight.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">The breakdown</span> (to
                                        hull, absorbed by shield, blocked by Barrier, converted to
                                        shield) sits below the two measured figures &mdash; after
                                        the &ldquo;Compared to best&rdquo; row and the survivor note
                                        where those are shown &mdash; and above Theoretical EHP. It
                                        describes what actually reached the ship <em>after</em>{' '}
                                        everything it does to shrink an incoming hit &mdash;
                                        Defense, its own Inc. Damage Down, gear reduction and block
                                        procs, not Defense alone. It is labelled with its own
                                        sub-total. Those rows are on a different axis from the
                                        headline and are not meant to add up to it.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Editing a ship&apos;s skills:
                                        </span>{' '}
                                        each ship card has a <em>Show Advanced</em> section holding
                                        the same skill editor the DPS and Healing calculators use,
                                        so you can read the parsed abilities behind a ship&apos;s
                                        active, charged and passive skills and add or change them by
                                        hand. The Passive row appears whenever the ship <em>has</em>{' '}
                                        passive skill text, even when the parser read no abilities
                                        out of it &mdash; purely defensive and repair passives often
                                        parse to nothing, and those are exactly the ones worth
                                        entering manually on this page.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Charge Count</span> and{' '}
                                        <span className="text-primary">Start Charged</span> also
                                        live in Show Advanced. Some ships have skills that begin
                                        combat already charged (Akula, Chimei, Los, Sansi, Valkyrie
                                        and Wusheng); when detected from the picked ship&apos;s
                                        skill data, Start Charged is pre-checked and its charged
                                        skill fires in round 1 of the simulation, the same as for
                                        the enemy roster, team roster and healer cards. Both fields
                                        are editable, so you can turn a detected charge off to see
                                        how the ship fares without its first-turn burst, or set a
                                        charge count by hand on a manually-configured card with no
                                        ship attached.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Which card gets highlighted:
                                        </span>{' '}
                                        the &ldquo;Best ship configuration&rdquo; badge now goes to
                                        the highest{' '}
                                        <span className="font-semibold">damage absorbed</span>, not
                                        the highest Theoretical EHP &mdash; so for the same inputs a
                                        different card can be marked best than before, and the
                                        &ldquo;Compared to best&rdquo; percentage beside it is
                                        measured on that same figure. When the measured figures tie
                                        &mdash; which they do whenever there is no enemy pressure at
                                        all, and whenever every configuration survives the whole
                                        window &mdash; the badge falls back to{' '}
                                        <span className="font-semibold">Theoretical EHP</span>, so
                                        the zero-pressure page you first land on still ranks on the
                                        static estimate, the way it always did. Rounds survived is
                                        the last resort after that, not the first: damage absorbed
                                        already grows with rounds, so rounds only ever speak when it
                                        ties &mdash; and with no enemy configured they speak
                                        backwards, since the fight ends when a ship destroys the
                                        practice target, which makes the hardest hitter show the
                                        FEWEST rounds.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            A Defense buff does not move the headline:
                                        </span>{' '}
                                        Defense mitigation is excluded from damage absorbed by
                                        design, so raising Defense changes{' '}
                                        <span className="font-semibold">Rounds survived</span> and
                                        the &ldquo;Reached the ship&rdquo; sub-total (and
                                        Theoretical EHP), and only moves damage absorbed insofar as
                                        the extra hits it survives &mdash; a whole extra round, or
                                        just one more attacker&apos;s hit on the round it dies
                                        &mdash; bring more incoming fire with them.
                                    </p>
                                    <p className="text-theme-text">
                                        <span className="text-primary">The ship fights back:</span>{' '}
                                        the defender takes its own turns rather than standing still,
                                        so its self-buffs and self-repair fire for real, and a
                                        high-attack build that kills an attacker partway through the
                                        fight lowers its own incoming pressure for every round after
                                        that. That means a ship can out-measure another with a
                                        stronger defensive kit on paper simply by hitting back
                                        harder &mdash; an accepted, real consequence of measuring
                                        survivability with the actual engine instead of a static
                                        formula.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Healing Calculator
                                    </h4>
                                    <p className="text-theme-text mb-2">
                                        Calculate how much a supporter ship actually keeps a target
                                        alive. The Healing Calculator runs on the same deterministic
                                        combat engine as the DPS Calculator — identical inputs
                                        always produce identical round-by-round results.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Parsed Heal / Shield / Cleanse Abilities:
                                        </span>{' '}
                                        When you select a healer, its heal, shield, and cleanse
                                        abilities are auto-filled from the skill text and shown in
                                        the per-skill ability editor. Heals scale from the
                                        configured basis (the caster&apos;s max HP, Attack, or
                                        Defense, or the recipient&apos;s max HP) by the parsed
                                        percentage; shields and cleanse counts are editable too.
                                        Heal modifier, Outgoing Repair, and Incoming Repair all feed
                                        in as separate multipliers. Support ships that shorten
                                        debuff durations rather than removing them outright —
                                        Heliodor (reducing its own or all allies&apos; active debuff
                                        durations by 1 turn when directly damaged) and Pestilence
                                        (reducing all allies&apos; active debuff durations by 1 turn
                                        after it inflicts a debuff) — are modeled too: each affected
                                        debuff loses a turn (a debuff reduced to zero expires
                                        early), and the effect is tallied in the round&apos;s
                                        Cleanses count.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Heal Target &amp; Enemy Team:
                                        </span>{' '}
                                        Pick what the healer is keeping alive — the healer itself,
                                        another of your ships, or a manual stat line — then build an
                                        enemy team that bombards it each round. A ship with a damage
                                        ability hits the target; a support ship buffs the team.
                                        Enemies can be real ships (their charged skills produce
                                        realistic damage spikes, and they apply their real debuffs
                                        and damage-over-time effects to the target — which tick for
                                        damage each round — and buff themselves and their team with
                                        their own abilities) or quick manual attack/defense lines.
                                        Each enemy has an affinity selector matched against the
                                        target&apos;s affinity to scale their incoming damage. An
                                        enemy you pick from your ships also attacks with its own
                                        targeting and pattern, so an area attacker hits every cell
                                        its pattern covers rather than a single ship. A hover-gated
                                        round status panel beside the Healing Over Time chart shows,
                                        for the hovered round and grouped per healer config, the
                                        healer&apos;s own active buffs as well as which self-buffs
                                        are active on each enemy and which debuffs or DoTs they have
                                        landed on the target.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Board slots:</span> the
                                        healer, the heal target, every team ship and every enemy
                                        picks the slot it fights from (column 4 is the front), which
                                        affects targeting patterns and adjacency. Two ships on your
                                        side cannot share a slot &mdash; choosing an occupied one
                                        swaps them. Separate healer configs may share a slot, since
                                        each is simulated on its own board. Ships you have not
                                        placed start on sensible defaults: the heal target is placed
                                        inside the healer&apos;s support pattern where one exists.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Heals follow the healer&apos;s pattern:
                                        </span>{' '}
                                        a repair is aimed from the healer&apos;s own slot and covers
                                        exactly the cells its support pattern reaches, just as in
                                        game. An ally standing outside that pattern receives{' '}
                                        <span className="font-semibold">nothing</span> &mdash; not a
                                        reduced amount, nothing at all &mdash; and a healer whose
                                        pattern only covers its own cell cannot heal anyone else
                                        from there. Because a silent zero looks like a broken
                                        calculator, the page raises a placement warning naming every
                                        ally that is currently out of reach, so move that ally onto
                                        a covered cell or move the healer. One cast can also cover
                                        several allies at once, which is why healing is reported per
                                        ally.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Skills that name the worst-hurt ally:
                                        </span>{' '}
                                        a repair whose text names <em>which</em> ally it helps
                                        &mdash; Pallas, Volk and Valkyrie in the current roster
                                        &mdash; ignores the pattern and repairs the ally with the
                                        lowest share of health remaining wherever it stands. The
                                        caster is never that ally, so with no other ally alive the
                                        repair lands on nobody. An out-of-reach placement warning
                                        does not apply to these repairs.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Healing by ally:</span> under
                                        the charts, a breakdown table lists effective healing and
                                        overheal for each ship a repair actually landed on, with the
                                        heal target marked as the primary row (it is the ship the
                                        summary and the charts follow). Ships are counted here by
                                        what they received, whereas the healer&apos;s own summary
                                        counts what it produced regardless of where it went &mdash;
                                        so the rows deliberately do not add up to the healer&apos;s
                                        total, and a row can even show healing on a round the healer
                                        itself produced none, because a team-mate&apos;s repair
                                        landed. An ally missing from the table received nothing.
                                        Shields and cleanses have no per-ally figure and stay on the
                                        healer&apos;s summary. Only your own ships are listed: an
                                        enemy that repairs itself off its own damage still does so
                                        in the fight, but it is never counted as healing for your
                                        team (neither here nor in Team Healing).
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Enemies are real ships and can be destroyed:
                                        </span>{' '}
                                        each enemy carries its own HP, Defense and Security, all
                                        editable (a ship you pick fills them from its stats). Its
                                        Defense decides how much damage your healer&apos;s attack
                                        actually does to it &mdash; which matters for skills that
                                        repair or shield for a share of the damage they deal &mdash;
                                        and its Security resists debuffs your side aims at it. Kill
                                        an enemy and it stops attacking for the rest of the run, so
                                        the incoming damage your healer has to out-heal drops as the
                                        fight goes on.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            An empty enemy team measures pure output:
                                        </span>{' '}
                                        you can remove every enemy. Nothing then shoots back, so
                                        your heal target stays at full health and every point of
                                        repair is counted as overheal &mdash; which is exactly how
                                        to read a healer&apos;s ceiling without survival getting in
                                        the way. Your healer&apos;s own numbers do not change when
                                        you do this: the calculator stands in a practice target
                                        carrying the same HP, Defense and Security a freshly added
                                        enemy card has, just with no attack and no skills. Because
                                        its Defense is real, skills that repair or shield for a
                                        share of the damage they deal keep measuring against the
                                        same basis they would against a default enemy, so emptying
                                        the team changes only the damage coming at you. The practice
                                        target can still be destroyed, just like a real enemy at
                                        those stats.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Enemy Hacking &amp; Heal-Target Security:
                                        </span>{' '}
                                        Each enemy has a Hacking stat, and the heal target has a
                                        Security stat. An enemy&apos;s debuffs — both timed effects
                                        and damage-over-time — land based on its Hacking versus the
                                        target&apos;s Security: the higher the enemy&apos;s Hacking
                                        over the target&apos;s Security, the more reliably its
                                        debuffs stick (and high enough Security can shrug them off
                                        entirely). The exact landing chance is (enemy Hacking −
                                        target Security), clamped to a 0–100% range. Defaults: a
                                        freshly added manual enemy starts at 200 Hacking (picking an
                                        enemy ship fills Hacking from the ship&apos;s stats), and
                                        the target&apos;s Security defaults to 0 — so debuffs land
                                        at full chance until you raise the target&apos;s Security.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Effective Healing vs Overheal:
                                        </span>{' '}
                                        Each round the simulation tracks the target&apos;s HP and
                                        applies incoming damage and healing in turn order. Healing
                                        that would push the target above its max HP is counted as
                                        overheal, so you see the difference between raw healing
                                        output and the healing that actually mattered.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">
                                            Shields and Heal-Over-Time:
                                        </span>{' '}
                                        Shields build an absorption pool on the target (capped at
                                        its max HP) that soaks incoming damage before HP is touched,
                                        and does not expire. Repair Over Time effects tick at the
                                        holder&apos;s turn for their per-stack amount. Crit heals
                                        resolve on their own deterministic crit schedule, separate
                                        from any damage crits.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Damage-Based Sustain:</span>{' '}
                                        Some ships repair or gain shields based on a percentage of
                                        the damage they deal — lifesteal-style sustain (including,
                                        for some ships, from damage-over-time ticks such as
                                        Corrosion and Inferno) and burst-triggered heals — or based
                                        on the damage they take, like shield-on-hit. These are now
                                        simulated in the Healing Calculator too, applied as the
                                        damage is dealt or taken round by round. Event-reactive
                                        shields and heals — such as gaining a shield when an enemy
                                        is debuffed or when the ship applies Stasis — fire from
                                        their real triggers as well.
                                    </p>
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Survival Metric:</span> The
                                        summary reports how many rounds the target survives — or the
                                        round it is destroyed if incoming damage outpaces healing —
                                        so you can tell at a glance whether a healer keeps its
                                        charge standing.
                                    </p>
                                    <p className="text-theme-text">
                                        <span className="text-primary">Team Healers:</span> Add team
                                        ships and their parsed heals, shields, and cleanses
                                        contribute on their own turns, alongside reactive heal
                                        triggers (such as a ship reacting when it critically repairs
                                        an ally). The timeline chart shows HP, shield pool, incoming
                                        damage, and effective healing per round, with a cumulative
                                        comparison between configurations.
                                    </p>
                                    <p className="text-theme-text">
                                        <span className="text-primary">
                                            Per-Round Healer Overview:
                                        </span>{' '}
                                        Hover any round on the Healing Over Time chart to see every
                                        config&apos;s output for that round in the chart&apos;s
                                        hover card — direct heal, heal-over-time, shield granted,
                                        effective vs overheal, cleanses, and the incoming damage /
                                        target HP% each faced — with charged and crit badges.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Damage Deconstruction
                                    </h4>
                                    <p className="text-theme-text">
                                        Reverse-engineer combat results to understand damage
                                        calculations and identify enemy stats.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold text-primary mb-2">
                                        JSON Diff Calculator
                                    </h4>
                                    <p className="text-theme-text">
                                        Compare two game data exports to identify changes in your
                                        account, ships, gear, or engineering stats between different
                                        time periods.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Speed Calculator
                                    </h4>
                                    <p className="text-theme-text mb-2">
                                        Calculate speed values with various modifiers. Two modes
                                        available:
                                    </p>
                                    <ul className="text-theme-text list-disc pl-4 space-y-1">
                                        <li>
                                            <strong>Forward:</strong> Enter base speed and modifiers
                                            to calculate final speed
                                        </li>
                                        <li>
                                            <strong>Reverse:</strong> Enter target speed range and
                                            modifiers to find required base speed
                                        </li>
                                    </ul>
                                    <p className="text-theme-text mt-2">
                                        Pick speed buffs and debuffs from the game&apos;s named buff
                                        list — relevant speed buffs are surfaced at the top.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 p-4 bg-blue-900/50 border border-blue-700">
                                <h4 className="font-semibold text-blue-200 mb-2">Use Cases</h4>
                                <ul className="text-blue-100 space-y-2">
                                    <li>
                                        Test theoretical builds without changing your actual ship
                                        configurations
                                    </li>
                                    <li>
                                        Compare stat trade-offs (e.g., more defense vs. more HP)
                                    </li>
                                    <li>Analyze combat logs to understand battle outcomes</li>
                                    <li>Track account progression over time with JSON Diff</li>
                                    <li>
                                        Plan speed tuning to ensure your ships act in the desired
                                        order
                                    </li>
                                </ul>
                            </div>
                        </div>

                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Recruitment Calculator</h3>
                            <p className="text-theme-text">
                                Calculate the probability of obtaining specific ships from different
                                beacon types.
                            </p>

                            <div className="space-y-4">
                                <div className="card">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Beacon Types
                                    </h4>
                                    <p className="text-theme-text">
                                        The calculator supports all beacon types: Public,
                                        Specialist, Expert, and Elite. Each beacon type has
                                        different rarity pools and drop rates.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Faction Events
                                    </h4>
                                    <p className="text-theme-text">
                                        During faction events, ships from the selected faction have
                                        their pull weight multiplied (selectable 10x or 20x) in
                                        specialist beacons. This multiplier stacks on top of the
                                        affinity weighting: within a rarity, every non-antimatter
                                        ship already carries 10x the weight of an antimatter ship,
                                        and a featured-faction ship is multiplied again on top of
                                        that.
                                    </p>
                                </div>

                                <div className="card">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Individual Event Ships
                                    </h4>
                                    <p className="text-theme-text">
                                        Configure individual event ships with custom drop rates or
                                        pity thresholds to accurately calculate probabilities during
                                        special events.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 p-4 bg-blue-900/50 border border-blue-700">
                                <h4 className="font-semibold text-blue-200 mb-2">Use Cases</h4>
                                <ul className="text-blue-100 space-y-2">
                                    <li>
                                        Plan beacon spending by calculating odds for target ships
                                    </li>
                                    <li>
                                        Evaluate whether faction events are worth pulling for
                                        specific ships
                                    </li>
                                    <li>Calculate cumulative probability across multiple pulls</li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* Encounter Notes Section */}
                    <section id="encounters" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Encounter Notes
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">
                                Track Your Battle Encounters
                            </h3>
                            <p className="text-theme-text">
                                Document enemy compositions, strategies, and notes for various game
                                encounters. Your personal encounter notes are stored privately.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Create notes for Faction Ops, Story missions, etc.</li>
                                    <li>Record enemy ship compositions and stats</li>
                                    <li>Document successful strategies</li>
                                    <li>Add custom notes and observations</li>
                                    <li>
                                        Option to share encounters publicly to the Shared Encounters
                                        page
                                    </li>
                                </ul>
                            </div>

                            <div className="mt-4 p-4 bg-yellow-900/50 border border-yellow-700">
                                <h4 className="font-semibold text-yellow-200 mb-2">Pro Tip</h4>
                                <p className="text-yellow-100">
                                    Use Encounter Notes to build a personal knowledge base of
                                    challenging content. This is especially valuable for weekly
                                    rotating Faction Ops or event encounters.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Shared Encounters Section */}
                    <section
                        id="shared-encounters"
                        className="space-y-4 [counter-increment:section]"
                    >
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Shared Encounters
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">
                                Community-Shared Fleet Formations
                            </h3>
                            <p className="text-theme-text">
                                Browse encounters shared by other players to learn strategies and
                                fleet compositions for challenging content.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Browse all publicly shared encounters</li>
                                    <li>Search by name or description</li>
                                    <li>
                                        Vote on encounters to help surface the most helpful
                                        strategies
                                    </li>
                                    <li>View enemy compositions and recommended teams</li>
                                    <li>Learn from community-proven strategies</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    How to Share Your Encounters
                                </h4>
                                <ol className="text-theme-text list-decimal pl-4 space-y-1">
                                    <li>Create an encounter in your personal Encounter Notes</li>
                                    <li>Toggle the &quot;Share publicly&quot; option</li>
                                    <li>
                                        Your encounter will appear in the Shared Encounters page for
                                        others to view
                                    </li>
                                </ol>
                            </div>

                            <div className="mt-4 p-4 bg-blue-900/50 border border-blue-700">
                                <h4 className="font-semibold text-blue-200 mb-2">Pro Tip</h4>
                                <p className="text-blue-100">
                                    Check Shared Encounters before attempting difficult content like
                                    Faction Ops bosses. The community voting system helps identify
                                    the most effective strategies.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Statistics Section */}
                    <section id="statistics" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Statistics
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Fleet and Gear Analytics</h3>
                            <p className="text-theme-text">
                                The Statistics page provides a comprehensive analytics dashboard to
                                understand your collection at a glance. View detailed breakdowns
                                with charts and metrics across four tabs.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Ships Tab</h4>
                                <p className="text-theme-text mb-2">
                                    Analyze your ship collection with filters by role and rarity:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Total ships, average level, max level count</li>
                                    <li>Total refits and average refits per ship</li>
                                    <li>Ships with implants percentage</li>
                                    <li>Fully geared vs. ungeared ships</li>
                                    <li>Rarity distribution (pie chart)</li>
                                    <li>Role distribution (bar chart)</li>
                                    <li>Level distribution histogram</li>
                                    <li>Ships by faction breakdown</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Gear Tab</h4>
                                <p className="text-theme-text mb-2">
                                    Analyze your gear inventory with filters by set, main stat, and
                                    rarity:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Total gear pieces and equipped percentage</li>
                                    <li>Average level and star level</li>
                                    <li>Most common set bonus and main stat</li>
                                    <li>Top 10 gear sets distribution</li>
                                    <li>Main stat distribution with category colors</li>
                                    <li>Rarity and star level distributions</li>
                                    <li>Slot distribution across gear types</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Implants Tab</h4>
                                <p className="text-theme-text mb-2">
                                    Analyze your implant collection with filters by type and rarity:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Total implants and equipped percentage</li>
                                    <li>Types available (Minor, Major, Ultimate)</li>
                                    <li>Rarity distribution</li>
                                    <li>Type distribution breakdown</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Engineering Tab</h4>
                                <p className="text-theme-text mb-2">
                                    Analyze your engineering investment across roles:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Total engineering points invested</li>
                                    <li>Average points per role</li>
                                    <li>Most invested role identification</li>
                                    <li>Warning for roles with zero investment</li>
                                    <li>Points by role (horizontal bar chart)</li>
                                    <li>Point distribution by stat type (stacked bar chart)</li>
                                    <li>Detailed investment table by role and stat</li>
                                </ul>
                            </div>

                            <div className="mt-4 p-4 bg-blue-900/50 border border-blue-700">
                                <h4 className="font-semibold text-blue-200 mb-2">Use Cases</h4>
                                <ul className="text-blue-100 space-y-2">
                                    <li>
                                        Identify gaps in your collection (undergeared ships,
                                        underinvested roles)
                                    </li>
                                    <li>Track progress toward collection goals</li>
                                    <li>Find which gear sets you have the most/least of</li>
                                    <li>Ensure balanced engineering investment across roles</li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* Simulation Section */}
                    <section id="simulation" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Simulation
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Battle Simulation</h3>
                            <p className="text-theme-text mb-4">
                                The simulation page allows you to test different gear and implant
                                configurations without permanently changing your ships.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>Select any ship from your fleet</li>
                                    <li>Choose a role to simulate (Attacker, Defender, etc.)</li>
                                    <li>Temporarily swap gear pieces to test alternatives</li>
                                    <li>Temporarily swap implants to test different setups</li>
                                    <li>See real-time stat updates as you make changes</li>
                                    <li>
                                        Compare current vs. temporary configuration side-by-side
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Simulation Results
                                </h4>
                                <p className="text-theme-text mb-2">
                                    Results show role-specific metrics based on the selected role:
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <strong>Attacker:</strong> DPS, crit rate, crit damage
                                    </li>
                                    <li>
                                        <strong>Defender:</strong> Effective HP, damage reduction,
                                        survival rounds
                                    </li>
                                    <li>
                                        <strong>Supporter:</strong> Healing output, heal modifiers
                                    </li>
                                    <li>
                                        <strong>Debuffer:</strong> Hacking effectiveness, DPS
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Equip Changes</h4>
                                <p className="text-theme-text">
                                    After testing, you can permanently equip your temporary gear
                                    configuration with one click. The simulation will show you which
                                    ships will lose gear if you proceed.
                                </p>
                            </div>

                            <div className="mt-4 p-4 bg-yellow-900/50 border border-yellow-700">
                                <h4 className="font-semibold text-yellow-200 mb-2">Pro Tips</h4>
                                <ul className="text-yellow-100 space-y-2">
                                    <li>
                                        Use simulation to test gear before committing to expensive
                                        upgrades in-game
                                    </li>
                                    <li>
                                        Compare different set bonuses to see which provides better
                                        results for your role
                                    </li>
                                    <li>
                                        Access simulation quickly via the &quot;Simulator&quot;
                                        option in ship dropdown menus
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* Combat Simulator Section */}
                    <section
                        id="combat-simulator"
                        className="space-y-4 [counter-increment:section]"
                    >
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Combat Simulator
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Round-by-Round Battles</h3>
                            <p className="text-theme-text mb-4">
                                The Combat Simulator pits two squads against each other on the hex
                                board and plays out the whole fight, round by round. Both sides are
                                ships from your own fleet, simulated with their fully geared stats —
                                so you can stage matchups and watch exactly how they unfold.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Setting Up</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        Place ships on the two placement boards — your team on one,
                                        an enemy team on the other
                                    </li>
                                    <li>
                                        Click a cell to select it, then pick a ship from your fleet
                                        to fill it; click a placed ship to remove it
                                    </li>
                                    <li>
                                        Each placed ship fights with its real geared, refit, and
                                        engineering-resolved stats
                                    </li>
                                    <li>
                                        Run the simulation once you have at least one ship on each
                                        team
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Squad Leaders</h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        Pick one squad leader per team beneath each placement board
                                        — faction, leader, and upgrade stage (stages are additive:
                                        stage III includes stages I and II)
                                    </li>
                                    <li>
                                        Ally bonuses apply only to ships of the leader&apos;s
                                        faction — a leader with no faction ship on its own team
                                        grants nothing
                                    </li>
                                    <li>
                                        Enemy-targeting effects exist only on legendary leaders at
                                        stage III; they hit every opposing ship, but also require at
                                        least one leader-faction ship on the leader&apos;s own team
                                    </li>
                                    <li>
                                        Leader bonuses are hidden pre-fight modifiers: they fold
                                        into each ship&apos;s fully geared stats before round 1, are
                                        permanent, never appear as buffs, and are never purged,
                                        cleansed, or reset on death
                                    </li>
                                    <li>
                                        Effects the simulator cannot model yet (conditional bonuses,
                                        per-round effects, and damage/heal/shield modifiers) are
                                        marked &quot;Not simulated&quot; in the picker preview and
                                        listed after each run
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Pre-Fight Ship Passives
                                </h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        Some ships have permanent start-of-combat passives that are
                                        applied before round 1: Lionheart grants all adjacent allies
                                        10% of its HP, Centurion gains attack per adjacent ally, and
                                        Enforcer, Defiant, and Stalwart gain their bonuses when
                                        placed adjacent to a Supporter
                                    </li>
                                    <li>
                                        Adjacency uses the placement board&apos;s hex neighbours, so
                                        where you place these ships matters
                                    </li>
                                    <li>
                                        These passives apply after squad-leader bonuses (a leader
                                        that boosts Lionheart&apos;s HP also boosts what it grants),
                                        are hidden and permanent like leader bonuses, and are not
                                        lost when the granting ship is destroyed
                                    </li>
                                    <li>
                                        Ships whose skills state they start combat fully charged
                                        (e.g. Chimei, with enough refits for the passive) begin the
                                        battle with a full charge bar and fire their charged skill
                                        on round 1
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Watching the Battle
                                </h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        The outcome (which team wins, and the round it ended) is
                                        shown at the top
                                    </li>
                                    <li>
                                        Step through the battle round by round — First, Previous,
                                        Next, Last, the slider, or auto-play
                                    </li>
                                    <li>
                                        Each round, the boards show every ship&apos;s current HP,
                                        damage dealt, and healing, with destroyed ships marked
                                    </li>
                                    <li>
                                        Pin a ship to open a per-round detail card with its full
                                        breakdown for that round, including its active buffs and
                                        debuffs — Damage over Time effects (Corrosion, Inferno,
                                        Bomb, and converted-damage DoTs) are listed among the
                                        debuffs
                                    </li>
                                    <li>
                                        The event log lists every turn-by-turn action, reaction, and
                                        effect for the selected round — see below for details
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Support skill patterns
                                </h4>
                                <p className="text-theme-text mb-2">
                                    Ships with friendly targeting (Allies + a support pattern on
                                    their skill board) grant heals, shields, buffs, and ally charges
                                    only to allies standing on that pattern&apos;s footprint — not
                                    the entire team. This applies to active and charged skill casts
                                    and to reactive passives (such as start-of-round charge grants).
                                    Text that says &quot;(All) allies&quot; means all allies{' '}
                                    <em>in the pattern</em>, not every ship on your roster.
                                </p>
                                <p className="text-theme-text mb-2">
                                    <span className="text-primary">
                                        The one exception &mdash; a named ally:
                                    </span>{' '}
                                    when a skill&apos;s own text names <em>which</em> ally it helps
                                    &mdash; &quot;the ally with the lowest current health
                                    percentage&quot;, &quot;the ally with the most missing
                                    health&quot; &mdash; it reaches that ally wherever it stands,
                                    and the ship&apos;s targeting pattern does not narrow it.
                                    Pallas, Volk and Valkyrie are the ships in the current roster
                                    whose skills read this way, and it applies whether the effect
                                    sits on an active, charged or passive skill. The ally is always
                                    the worst-hurt one by share of health remaining, never the
                                    caster itself &mdash; so if no other ally is alive, the repair
                                    lands on nobody rather than on the caster. Every other
                                    ally-targeted repair, shield, buff, cleanse or charge grant
                                    follows the pattern as described above.
                                </p>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Combat Log</h4>
                                <p className="text-theme-text mb-2">
                                    The combat log shows a complete, hierarchical record of
                                    everything that happens each round — nothing is omitted or
                                    approximated.
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <strong>Area-of-effect attacks and heals:</strong> Every
                                        affected ship is listed individually with its own damage or
                                        heal amount and resulting HP percentage — not just the
                                        primary target.
                                    </li>
                                    <li>
                                        <strong>Reactions shown in context:</strong> Counterattacks,
                                        on-crit heals, reflects, reactive shields, and other
                                        triggered effects appear nested under the action that caused
                                        them, in the correct turn — not attributed to the reacting
                                        ship&apos;s own turn.
                                    </li>
                                    <li>
                                        <strong>Accurate per-ally heals:</strong> When a ship heals
                                        multiple allies, each ally&apos;s individual heal amount is
                                        shown rather than an even split.
                                    </li>
                                    <li>
                                        <strong>Buff grants show who cast them:</strong> A buff
                                        entry is attributed to the ship that granted it, with the
                                        ally that received it listed as the target — so a support
                                        ship&apos;s buffs to its allies are credited to that ship,
                                        not just shown against the ally that gained the buff.
                                    </li>
                                    <li>
                                        <strong>Charge state and skill tags:</strong> Each turn
                                        shows the acting ship&apos;s current charge (e.g.
                                        &quot;charge 2/3&quot;) and whether it used its active or
                                        charged skill variant. Charge gains, resets, and
                                        manipulations each appear as explicit lines.
                                    </li>
                                    <li>
                                        <strong>Per-turn stat snapshot:</strong> Each turn has a
                                        collapsible &quot;Stats&quot; row showing the acting
                                        ship&apos;s current modelled HP, attack, defence, crit, crit
                                        power, speed, hacking, and security including active stat
                                        buffs/debuffs (defense penetration shows the base value
                                        only) — so you can verify a buff actually landed.
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Gear Set and Implant Effects
                                </h4>
                                <p className="text-theme-text">
                                    Equipped implant and gear-set special effects are beginning to
                                    apply in the simulator (and now in the DPS calculator too).
                                    Currently supported: <strong>Leech</strong> gear set (heals the
                                    ship for 15% of all damage it deals each turn) and the{' '}
                                    <strong>Bloodthirst</strong> implant (on-crit heal for 12%, 17%,
                                    or 20% of damage dealt, depending on rarity). Chance-based procs
                                    such as Bloodthirst are modeled at their expected average
                                    frequency. Three conditional damage implants also apply:{' '}
                                    <strong>Intrusion</strong> (more outgoing damage for each debuff
                                    on the target), <strong>Arcane Siege</strong> (more outgoing
                                    damage while the ship is shielded), and{' '}
                                    <strong>Warpstrike</strong> (more outgoing damage while the ship
                                    is debuffed). Incoming-damage reduction is also modeled:{' '}
                                    <strong>Voidshade</strong> and <strong>Shadowguard</strong>{' '}
                                    (reduced damage while stealthed),{' '}
                                    <strong>Nebula Nullifier</strong> (reduced damage while in
                                    Stasis), <strong>Hyperion Gaze</strong> and the{' '}
                                    <strong>Hardened</strong> gear set (reduced incoming
                                    critical-hit damage), <strong>Iridium&apos;s</strong> passive
                                    (reduced crit damage taken, scaling with rarity),{' '}
                                    <strong>Vortex Veil</strong> (reduced Inferno and Corrosion
                                    damage), and <strong>Ironclad</strong> (a chance to block a
                                    repeated hit from the same attacker). Outgoing-damage
                                    amplification is also modeled: <strong>Menace</strong> (chance
                                    to amplify a hit&apos;s damage on a critical hit),{' '}
                                    <strong>Giant Slayer</strong> (chance to amplify a hit&apos;s
                                    damage against an enemy with higher attack), and{' '}
                                    <strong>Insidiousness</strong> (chance to deal bonus damage when
                                    you apply a debuff to an enemy). Three heal implants are also
                                    modeled: <strong>Second Wind</strong> (chance to repair itself
                                    when it takes a critical hit), <strong>Nourishment</strong>{' '}
                                    (stronger repairs on allies with less HP than the healer), and{' '}
                                    <strong>Vivacious Repair</strong> (chance to double a repair on
                                    an ally below 25% HP), and <strong>Exuberance</strong> (chance
                                    to increase the amount of a repair this unit receives). Charge
                                    manipulation is also modeled: <strong>Chrono Reaver</strong>{' '}
                                    (grants a bonus charge to the carrier&apos;s charged skill every
                                    2nd turn at legendary rarity or every 3rd turn at epic; units in
                                    Stasis bank no charge on skipped turns). Two damage-over-time
                                    gear sets are also modeled: <strong>Burner</strong> (applies
                                    Inferno for 2 turns when the ship attacks) and{' '}
                                    <strong>Decimation</strong> (+10% DoT damage per equipped set,
                                    up to +30%, boosting your Inferno and Corrosion ticks in both
                                    the combat simulator and the DPS calculator). Five shield
                                    sources are also modeled: the <strong>Shield</strong> gear set
                                    (grants the equipped ship a shield each turn, 4% of its max HP),{' '}
                                    <strong>Adaptive Plating</strong> (grants the ship a shield from
                                    the damage it takes, once per round),{' '}
                                    <strong>Abundant Renewal</strong> (turns over-healing on an ally
                                    into a shield for that ally), and{' '}
                                    <strong>Resonating Fury</strong> (a chance to grant Crit Power
                                    Up to allies it shields), and <strong>Lifeline</strong> (when a
                                    direct hit would drop the ship below 30% HP, it gains a shield —
                                    a flat amount plus 100% of its attack, capped at max HP — before
                                    the hit lands, once per battle). Three more gear-set and implant
                                    effects are also modeled: the <strong>Reflect</strong> gear set
                                    (reflects a portion of each incoming hit back at the attacker),
                                    the <strong>Revenge</strong> gear set (the wearer deals
                                    increasing damage as its HP drops, up to +25% near death), and
                                    the <strong>Smokescreen</strong> implant (a chance to gain
                                    Stealth when directly hit), and the <strong>Boost</strong> gear
                                    set (each timed buff the wearer applies — to itself or allies —
                                    lasts one extra turn, modeled in both the combat and DPS
                                    simulators). The <strong>Voidfire Catalyst</strong> implant is
                                    also modeled: it increases detonation damage (bomb bursts,
                                    Inferno detonations, and Corrosion detonations) and bomb splash
                                    damage by a percentage based on rarity — its rare and legendary
                                    variants amplify bomb splash damage only. Counterattacks are now
                                    modeled too: one of your ships with a &quot;when directly
                                    damaged&quot; passive (such as <strong>Stalwart</strong>)
                                    retaliates against the attacker for a share of its own attack —
                                    a full hit that can crit and kill. Different counterattackers
                                    have their own triggers: <strong>Nyxen</strong> strikes back
                                    only when its shield is the part that takes the hit, and{' '}
                                    <strong>Centurion</strong> retaliates when it or an adjacent
                                    ally is directly damaged. These reactions now fire for{' '}
                                    <strong>both teams</strong>: enemy ships react when you hit them
                                    too — enemy counterattackers strike back, and enemy on-hit
                                    reactions (self-repairs, defensive buffs, cleanses) fire. Enemy
                                    ships also benefit from their own on-cast shield skills — they
                                    gain shields, absorb your damage, and trigger shield-reactive
                                    abilities — so enemy teams play more like real opponents in
                                    positioned battles. In positioned battles, bomb, Inferno, and
                                    Corrosion <strong>detonation</strong> now lands on each ship the
                                    skill hits individually — every target detonates its own stored
                                    bombs and damage-over-time effects against its own HP, so a
                                    detonation can kill secondary (splash) targets and trigger their
                                    on-death effects, rather than only counting against the primary
                                    target. Timed bombs and Echoing Burst accumulators likewise
                                    burst on each affected ship individually — on both teams — every
                                    ship detonates its own timed bombs and accumulators against its
                                    own HP on its own turn. This per-ship detonation works for{' '}
                                    <strong>both teams</strong>: enemy detonation skills now damage
                                    each of your ships they hit individually too, so an enemy
                                    detonation can kill secondary (splash) targets and trigger their
                                    on-death effects. Ally ships (the non-focus members of your
                                    fleet) also detonate per-victim — each ship they hit detonates
                                    its own stored bombs and damage-over-time effects against its
                                    own HP, so an ally detonation can kill secondary targets and
                                    trigger their on-death effects such as bomb-splash-on-death.
                                    Inferno and Corrosion <strong>damage-over-time ticks</strong>{' '}
                                    likewise resolve per ship — on <strong>both teams</strong>, each
                                    affected ship takes its own DoT damage against its own HP at the
                                    start of its turn (even while in Stasis), so a DoT can wear down
                                    and kill secondary ships and trigger their on-death effects,
                                    instead of only counting against the primary target. In
                                    positioned battles, an area-of-effect attack now triggers the
                                    on-being-hit reactions of <strong>every</strong> ship caught in
                                    the blast — counter-attacks, retaliation buffs, and on-hit
                                    repairs — not just the primary target, on both teams. A few more
                                    ship passives are now modeled too: <strong>Nosorog</strong>{' '}
                                    reflects a portion of the damage it takes back at an attacker
                                    that hits it as its primary target (not on splash or
                                    area-of-effect hits), <strong>Chakara&apos;s</strong> charged
                                    skill bypasses part of the enemy&apos;s Defense, and{' '}
                                    <strong>Anemone</strong>, <strong>Panon</strong>,{' '}
                                    <strong>Wusheng</strong>, and <strong>Tormenter</strong> each
                                    take reduced damage under their own stated conditions.{' '}
                                    <strong>Anemone</strong> and <strong>Wusheng</strong> take less
                                    direct damage (from an attacking enemy afflicted with a
                                    damage-over-time effect, and while Stealthed, respectively),{' '}
                                    <strong>Panon</strong> reduces all incoming damage — direct and
                                    damage-over-time — while she has Barrier Recharging, and{' '}
                                    <strong>Tormenter&apos;s</strong> reduction (direct and
                                    damage-over-time) grows the lower her HP falls.{' '}
                                    <strong>Vindicator</strong> retaliates when it resists an enemy
                                    debuff, dealing damage equal to 30% of its own max HP back to
                                    the ship that attempted it. <strong>Protection</strong> (e.g.{' '}
                                    <strong>Meatshield</strong>) now works as a damage transfer
                                    instead of a plain unremovable buff: each stack a living ally
                                    holds intercepts 10% of the direct damage another ally would
                                    take, redirecting that share onto the protector instead — the
                                    redirected share is absorbed against the protector&apos;s own
                                    defense rather than the original target&apos;s, so the
                                    attacker&apos;s affinity match-up against the original target is
                                    unaffected. Protection covers all living allies (not only
                                    adjacent ones), allowing any protected ship to intercept damage
                                    for any teammate. When more than one ally holds Protection, the
                                    faster protector intercepts first and only its unabsorbed
                                    remainder cascades to the next. <strong>Lionheart</strong> uses
                                    a once-per-round variant: it gains 10 stacks of Protection at
                                    the start of each round, and after it absorbs the first hit
                                    redirected from an ally, it loses all Protection until the next
                                    round. More implant and gear-set effects will be added in future
                                    updates.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Themes Section */}
                    <section id="themes" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Themes & Appearance
                        </h2>
                        <div className="card space-y-4">
                            <p className="text-theme-text">
                                Customize the appearance of the calculator by choosing between
                                different themes. The theme switcher is located on your Profile page
                                and is available to authenticated users.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Available Themes
                                </h4>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <strong>Dark:</strong> The default dark theme with a clean,
                                        professional aesthetic
                                    </li>
                                    <li>
                                        <strong>Synthwave:</strong> A vibrant retro-futuristic theme
                                        featuring neon pink and cyan accents with visual effects
                                    </li>
                                </ul>
                            </div>

                            <p className="text-theme-text">
                                Your theme preference is saved locally in your browser, so your
                                choice will persist whenever you return to the calculator.
                            </p>
                        </div>
                    </section>

                    {/* Profile & Account Section */}
                    <section id="profile" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Profile & Account
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Overview</h3>
                            <p className="text-theme-text">
                                The Profile page is accessible to all users — no account required.
                                Anonymous users can manage their local data, back up and restore,
                                and configure data management settings without signing in. Signing
                                in unlocks cloud sync and additional account features.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Data Management</h4>
                                <p className="text-theme-text mb-2">
                                    The Data Management section controls how your data is stored and
                                    synced. It is available to signed-in users only.
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <strong>Sync toggle:</strong> Enable or disable cloud sync.
                                        When enabled, all data is written to Supabase in addition to
                                        localStorage. When disabled, data is stored in localStorage
                                        only and the cloud copy is not updated. The sync flag itself
                                        is saved in localStorage on this device — disabling sync on
                                        one device does not affect other devices.
                                    </li>
                                    <li>
                                        <strong>Clear &amp; re-sync:</strong> Wipes your cloud data
                                        and re-uploads everything from your current localStorage.
                                        Useful if your cloud data has become out of sync with your
                                        local data. Sync remains enabled after the operation.
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Backup &amp; Restore
                                </h4>
                                <p className="text-theme-text">
                                    Backup and restore controls are located on the Profile page,
                                    available to all users including anonymous users. Use backup to
                                    export a local copy of your data and restore to reload it on
                                    this or another device.
                                </p>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Connected Integrations
                                </h4>
                                <p className="text-theme-text mb-2">
                                    The Connected Integrations section is a placeholder for future
                                    third-party integrations.
                                </p>
                                <ul className="text-theme-text list-disc pl-4 space-y-1">
                                    <li>
                                        <strong>Cubedweb Hangar:</strong> The previous Cubedweb
                                        hangar sharing integration is deprecated while a new sharing
                                        system is in development.
                                    </li>
                                    <li>
                                        <strong>Starborne Frontiers API:</strong> A direct
                                        integration with the Starborne Frontiers API is coming soon,
                                        which will simplify data import.
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* Changelog Section */}
                    <section id="changelog" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Changelog
                        </h2>
                        <div className="card space-y-4">
                            <p className="text-theme-text">
                                A full history of updates and fixes. The latest version is{' '}
                                <span className="text-primary font-semibold">
                                    {CURRENT_VERSION}
                                </span>
                                .
                            </p>
                            <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-4">
                                {CHANGELOG.map((entry) => (
                                    <div
                                        key={entry.version}
                                        className="p-4 bg-dark-lighter border border-dark-border"
                                    >
                                        <h3 className="font-semibold text-primary mb-2">
                                            Version {entry.version} — {entry.date}
                                        </h3>
                                        <ul className="text-theme-text list-disc pl-4 space-y-1">
                                            {entry.changes.map((change, index) => (
                                                <li key={index}>{change}</li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                </div>
            </PageLayout>
        </>
    );
};

export default DocumentationPage;
