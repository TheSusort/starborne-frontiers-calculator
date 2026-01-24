import React, { useEffect } from 'react';
import { PageLayout } from '../components/ui';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { Link, useLocation } from 'react-router-dom';

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
                                    href="#leaderboards"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Leaderboards
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
                                    href="#simulation"
                                    className="text-primary hover:text-primary-light"
                                >
                                    <span className="before:content-[counter(index)'.'] before:mr-2">
                                        Simulation
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
                                    <p className="text-gray-300">
                                        To get started, you&apos;ll need to import your game data.
                                        This process requires the Windows version of Starborne
                                        Frontiers, which can be accessed through either:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 text-gray-300">
                                        <li>The standalone Windows client</li>
                                        <li>The Steam client</li>
                                    </ul>

                                    <div className="p-4 bg-dark-lighter">
                                        <h4 className="font-semibold text-primary mb-2">
                                            Steps to Export Data:
                                        </h4>
                                        <ol className="list-decimal pl-6 space-y-2 text-gray-300">
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
                                                        src="/videos/export.mov"
                                                        type="video/mp4"
                                                    />
                                                    Your browser does not support the video tag.
                                                </video>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-dark-lighter">
                                        <h4 className="font-semibold text-primary mb-2">
                                            Importing into the Calculator:
                                        </h4>
                                        <ol className="list-decimal pl-6 space-y-2 text-gray-300">
                                            <li>
                                                Locate the yellow{' '}
                                                <span className="text-primary">Import Data</span>{' '}
                                                button in the sidebar
                                            </li>
                                            <li>
                                                Click the button and select your exported JSON file
                                            </li>
                                            <li>
                                                It will process your data and update all relevant
                                                sections
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
                            <p className="text-gray-300">
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
                                    button in the Home page.
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
                            <p className="text-gray-300">
                                Each ship in your fleet is displayed as a card containing
                                comprehensive information and management options.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Ship Information
                                </h4>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
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
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
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
                                        <span className="text-primary">Delete Ship:</span> Remove
                                        the ship from your fleet
                                    </li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Filtering and Sorting
                                </h4>
                                <p className="text-gray-300 mb-2">
                                    The ship management interface includes powerful filtering and
                                    sorting capabilities:
                                </p>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
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
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Sorting Options</h4>
                                <p className="text-gray-300 mb-2">
                                    Ships can be sorted by various criteria:
                                </p>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
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
                                <p className="text-gray-300 mb-2">
                                    The search feature allows you to find ships by:
                                </p>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1 mt-2">
                                    <li>Ship name</li>
                                    <li>Ship type</li>
                                    <li>Faction name</li>
                                    <li>Affinity</li>
                                </ul>
                                <p className="text-gray-300 mt-2">
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
                            <p className="text-gray-300">
                                The ship details page shows detailed information about a specific
                                ship. Including:
                            </p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>Complete stats breakdown</li>
                                <li>Equipment</li>
                                <li>Implants</li>
                                <li>Score breakdown by gear slots</li>
                                <li>Upgrade analysis based on gear slots</li>
                            </ul>
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
                            <p className="text-gray-300">
                                Each piece of gear in your inventory is displayed as a card
                                containing detailed information and management options.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Gear Information
                                </h4>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
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
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                    <li>
                                        <span className="text-primary">Edit:</span> Modify gear
                                        details (not available for implants)
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
                                <p className="text-gray-300 mb-2">
                                    The gear management interface includes powerful filtering and
                                    sorting capabilities:
                                </p>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
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
                                <p className="text-gray-300 mb-2">
                                    The search feature allows you to find gear by:
                                </p>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                    <li>Gear name</li>
                                    <li>Slot type</li>
                                    <li>Set name</li>
                                    <li>Rarity</li>
                                    <li>Stat names and values</li>
                                    <li>Equipped ship name</li>
                                </ul>
                                <p className="text-gray-300 mt-2">
                                    The search is case-insensitive and updates results in real-time
                                    as you type.
                                </p>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Sorting Options</h4>
                                <p className="text-gray-300 mb-2">
                                    Gear can be sorted by various criteria:
                                </p>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                    <li>Date Added (default)</li>
                                    <li>Level</li>
                                    <li>Stars</li>
                                    <li>Rarity</li>
                                </ul>
                            </div>

                            <h3 className="text-xl font-semibold mb-2">Upgrade Analysis</h3>
                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Upgrade Analysis
                                </h4>
                                <p className="text-gray-300 mb-2">
                                    The Upgrade Analysis tab provides insights into your gear
                                    collection. It shows you which gear pieces are most likely to
                                    improve your role scores the most, by simulating upgrading them
                                    10 times, scoring each one using the role scoring system, and
                                    averaging the results. Displayed per role, and sorted by total
                                    improvement to the role score. The average improvement is how
                                    much the gear itself, not the role score, is improved by
                                    upgrading it.
                                </p>

                                <p className="text-gray-300 mb-2">
                                    You can also simulate upgrading all your unlevelled gear, by
                                    clicking the Simulate Upgrades button. This will then run
                                    through all gear and upgrade it randomly, like in the game. The
                                    upgraded stats will now be displayed in the gear cards.
                                    <br />
                                    <br />
                                    Clear upgrades button is used to reset the gear.
                                </p>
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
                                    <p className="text-gray-300">
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
                                        <div className="p-4 bg-dark-lighter">
                                            <h4 className="font-semibold text-primary">Attacker</h4>
                                            <p className="text-gray-300">
                                                Focuses on maximizing damage output through:
                                            </p>
                                            <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                                <li>Base attack damage</li>
                                                <li>Critical hit chance and damage</li>
                                                <li>Defense penetration</li>
                                            </ul>
                                        </div>
                                    </div>
                                    <h4 className="text-lg font-semibold">Defender Roles</h4>
                                    <div className="flex flex-wrap gap-4">
                                        <div className="p-4 bg-dark-lighter">
                                            <h4 className="font-semibold text-primary">Defender</h4>
                                            <p className="text-gray-300">
                                                Optimizes for survival through:
                                            </p>
                                            <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                                <li>Effective HP (HP × damage reduction)</li>
                                                <li>Healing and shield regeneration</li>
                                                <li>Survival rounds calculation</li>
                                            </ul>
                                        </div>

                                        <div className="p-4 bg-dark-lighter">
                                            <h4 className="font-semibold text-primary">
                                                Defender (Security)
                                            </h4>
                                            <p className="text-gray-300">
                                                Combines defensive capabilities with security:
                                            </p>
                                            <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                                <li>Base defender score</li>
                                                <li>Security stat multiplier</li>
                                                <li>Balanced defensive stats</li>
                                            </ul>
                                        </div>
                                    </div>
                                    <h4 className="text-lg font-semibold">Debuffer Roles</h4>
                                    <div className="flex flex-wrap gap-4">
                                        <div className="p-4 bg-dark-lighter">
                                            <h4 className="font-semibold text-primary">Debuffer</h4>
                                            <p className="text-gray-300">
                                                Specializes in hacking and damage:
                                            </p>
                                            <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                                <li>Hacking stat × DPS</li>
                                            </ul>
                                        </div>

                                        <div className="p-4 bg-dark-lighter">
                                            <h4 className="font-semibold text-primary">
                                                Debuffer (Defensive)
                                            </h4>
                                            <p className="text-gray-300">
                                                Balances hacking with survivability:
                                            </p>
                                            <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                                <li>Hacking stat × Effective HP</li>
                                            </ul>
                                        </div>

                                        <div className="p-4 bg-dark-lighter">
                                            <h4 className="font-semibold text-primary">
                                                Debuffer (Bomber)
                                            </h4>
                                            <p className="text-gray-300">
                                                Focuses on hacking and raw attack power:
                                            </p>
                                            <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                                <li>Hacking stat × Attack</li>
                                            </ul>
                                        </div>
                                    </div>
                                    <h4 className="text-lg font-semibold">Supporter Roles</h4>
                                    <div className="flex flex-wrap gap-4">
                                        <div className="p-4 bg-dark-lighter">
                                            <h4 className="font-semibold text-primary">
                                                Supporter
                                            </h4>
                                            <p className="text-gray-300">
                                                Optimizes healing capabilities:
                                            </p>
                                            <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                                <li>Base healing (15% of HP)</li>
                                                <li>Critical hit multiplier</li>
                                                <li>Heal modifier</li>
                                            </ul>
                                        </div>

                                        <div className="p-4 bg-dark-lighter">
                                            <h4 className="font-semibold text-primary">
                                                Supporter (Buffer)
                                            </h4>
                                            <p className="text-gray-300">
                                                Focuses on speed and defensive support:
                                            </p>
                                            <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                                <li>Speed × 10 (base weight)</li>
                                                <li>
                                                    Boost set bonus (30,000 points for 4 pieces)
                                                </li>
                                                <li>Effective HP (scaled down)</li>
                                            </ul>
                                        </div>

                                        <div className="p-4 bg-dark-lighter">
                                            <h4 className="font-semibold text-primary">
                                                Supporter (Offensive)
                                            </h4>
                                            <p className="text-gray-300">
                                                Balances speed with attack power:
                                            </p>
                                            <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                                <li>Speed × 10 (base weight)</li>
                                                <li>Attack power (square root scaled)</li>
                                                <li>
                                                    Boost set bonus (30,000 points for 4 pieces)
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

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold">Stat Priorities</h4>
                                    <p className="text-gray-300">
                                        Define minimum and maximum values for specific stats. The
                                        algorithm will try to keep stats within these ranges while
                                        optimizing the overall build.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold">Set Priorities</h4>
                                    <p className="text-gray-300">
                                        Specify which gear sets you want to complete and how many
                                        pieces of each set. The algorithm will prioritize completing
                                        these sets while maintaining stat requirements. Setting the
                                        count to 0, will prevent that gear set from being in the
                                        calculations.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold">Stat Bonuses</h4>
                                    <p className="text-gray-300">
                                        Add bonus effects that contribute to the role score. For
                                        example, an attacker that gains extra damage equal to 10% of
                                        HP.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold">Equipment Constraints</h4>
                                    <ul className="text-gray-300 list-disc pl-4 space-y-1">
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
                                            <strong>Optimize implants:</strong> When enabled, the
                                            algorithm will also optimize your ship&apos;s implants
                                            (Major and 3 Minor slots). Ultimate implants are not
                                            optimized but will be displayed if equipped. Implants
                                            use the same stat priorities as gear and follow the same
                                            &quot;Ignore equipped&quot; rules.
                                        </li>
                                    </ul>
                                </div>
                            </div>

                            <h3 className="text-xl font-semibold mt-6 mb-2">
                                Available Algorithms
                            </h3>
                            <div className="space-y-4">
                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary">
                                        Genetic Algorithm (Recommended)
                                    </h4>
                                    <p className="text-gray-300">
                                        Easily the best algorithm, an evolution-inspired approach
                                        that maintains a population of potential solutions and
                                        evolves them over time. This algorithm is particularly good
                                        at finding balanced gear combinations that satisfy multiple
                                        requirements.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary">
                                        Two-Pass Algorithm
                                    </h4>
                                    <p className="text-gray-300">
                                        A fast algorithm that first optimizes individual stats, then
                                        looks for opportunities to complete gear sets. Good for
                                        quick results when you have specific stat requirements.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary">
                                        Set-First Approach
                                    </h4>
                                    <p className="text-gray-300">
                                        Prioritizes completing gear sets before optimizing
                                        individual stats. Best used when set bonuses are crucial for
                                        your build.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary">Beam Search</h4>
                                    <p className="text-gray-300">
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
                            <p className="text-gray-300">
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

                            <h4 className="text-lg font-semibold mt-6 mb-2">Simulation Results</h4>
                            <p className="text-gray-300">
                                The simulation results will show you a comparison of the gear
                                suggestions, and the current gear on the ship, based on the
                                different goals of the roles.
                                <br />
                                <br />
                            </p>
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
                            <p className="text-gray-300">
                                The community recommendations system allows players to share their
                                autogear configurations with others.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Viewing Recommendations
                                </h4>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                    <li>
                                        When you select a ship, you&apos;ll see the highest-voted
                                        community recommendation
                                    </li>
                                    <li>Click to expand and see the full configuration details</li>
                                    <li>View alternative recommendations from other players</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Sharing Your Build
                                </h4>
                                <ol className="text-gray-300 list-decimal pl-4 space-y-1">
                                    <li>
                                        Configure your autogear settings (stat priorities, set
                                        bonuses, etc.)
                                    </li>
                                    <li>
                                        Click &quot;Find Optimal Gear&quot; to run the optimization
                                    </li>
                                    <li>
                                        Click &quot;Share to Community&quot; to open the share form
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
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                    <li>
                                        Click &quot;Helpful&quot; or &quot;Not Helpful&quot; to vote
                                        on recommendations
                                    </li>
                                    <li>Your votes help surface the best builds for each ship</li>
                                    <li>Sign in required to vote or share</li>
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
                            <p className="text-gray-300">
                                The Engineering Stats page allows you to manage per-ship-type
                                engineering bonuses that apply to all ships of that type in your
                                fleet.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                    <li>Set engineering bonuses for each ship type</li>
                                    <li>Bonuses automatically apply to all ships of that type</li>
                                    <li>Import engineering data from game exports</li>
                                    <li>Edit bonuses for Attack, Defense, HP, and other stats</li>
                                    <li>
                                        Engineering bonuses are factored into autogear calculations
                                    </li>
                                </ul>
                            </div>

                            <div className="mt-4 p-4 bg-yellow-900/50 border border-yellow-700">
                                <h4 className="font-semibold text-yellow-200 mb-2">Pro Tip</h4>
                                <p className="text-yellow-100">
                                    Keep your engineering stats up to date by importing fresh game
                                    data regularly. These bonuses significantly impact your ship
                                    performance and autogear suggestions.
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
                            <p className="text-gray-300">
                                Loadouts allow you to save ship configurations for easy switching
                                between different gear setups and team compositions.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Individual Loadouts
                                </h4>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
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
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
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
                            <p className="text-gray-300">
                                The Ship Database provides a comprehensive reference for all ships
                                available in Starborne Frontiers.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                    <li>View base stats for all ships at level 60</li>
                                    <li>Filter by faction, ship type, rarity, and affinity</li>
                                    <li>Search ships by name</li>
                                    <li>Sort by various stats</li>
                                    <li>View detailed ship information including abilities</li>
                                    <li>
                                        Access ship leaderboards to see top-performing
                                        configurations
                                    </li>
                                </ul>
                                <p className="text-gray-300 mt-4">
                                    Ships can have up to three passive skills: first passive
                                    (unlocked at lower ranks), second passive (unlocked at higher
                                    ranks), and third passive (available on newest ships).
                                </p>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">
                                    Implant Database
                                </h4>
                                <p className="text-gray-300 mb-2">
                                    Similar to the Ship Database, the Implant Database lets you
                                    browse all available implants:
                                </p>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
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
                            <p className="text-gray-300">
                                The Effect Index provides a comprehensive reference of all buffs,
                                debuffs, and effects in the game. Use the search bar to find
                                specific effects or filter by type.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                    <li>Search effects by name, type, or description</li>
                                    <li>Filter by type: buffs, debuffs, or effects</li>
                                    <li>Sort effects alphabetically</li>
                                    <li>Color-coded badges for quick identification</li>
                                    <li>Over 155 effects catalogued</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Effect Types</h4>
                                <div className="space-y-3 text-gray-300">
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

                    {/* Leaderboards Section */}
                    <section id="leaderboards" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Leaderboards
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">
                                Ship Performance Rankings
                            </h3>
                            <p className="text-gray-300">
                                Leaderboards showcase the highest-scoring ship configurations for
                                each ship type across all users.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
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
                                <ol className="text-gray-300 list-decimal pl-4 space-y-1">
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

                    {/* Calculators Section */}
                    <section id="calculators" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Calculators
                        </h2>
                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">
                                Advanced Combat Calculators
                            </h3>
                            <p className="text-gray-300">
                                Various specialized calculators to analyze and optimize combat
                                performance.
                            </p>

                            <div className="space-y-4">
                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary mb-2">
                                        DPS Calculator
                                    </h4>
                                    <p className="text-gray-300">
                                        Calculate damage per second for ships, factoring in attack,
                                        crit rate, crit damage, and defense penetration.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Defense Calculator
                                    </h4>
                                    <p className="text-gray-300">
                                        Analyze defensive capabilities including effective HP,
                                        damage reduction, and survivability metrics.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Healing Calculator
                                    </h4>
                                    <p className="text-gray-300">
                                        Calculate healing output for supporter ships, including
                                        critical heal multipliers and heal modifiers.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Damage Deconstruction
                                    </h4>
                                    <p className="text-gray-300">
                                        Reverse-engineer combat results to understand damage
                                        calculations and identify enemy stats.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary mb-2">
                                        JSON Diff Calculator
                                    </h4>
                                    <p className="text-gray-300">
                                        Compare two game data exports to identify changes in your
                                        account, ships, gear, or engineering stats between different
                                        time periods.
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
                                </ul>
                            </div>
                        </div>

                        <div className="card space-y-4">
                            <h3 className="text-xl font-semibold mb-2">Recruitment Calculator</h3>
                            <p className="text-gray-300">
                                Calculate the probability of obtaining specific ships from different
                                beacon types.
                            </p>

                            <div className="space-y-4">
                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Beacon Types
                                    </h4>
                                    <p className="text-gray-300">
                                        The calculator supports all beacon types: Public,
                                        Specialist, Expert, and Elite. Each beacon type has
                                        different rarity pools and drop rates.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Faction Events
                                    </h4>
                                    <p className="text-gray-300">
                                        During faction events, ships from the selected faction have
                                        20x the pull weight in specialist beacons. This bypasses the
                                        normal affinity split - all ships of the same rarity compete
                                        in a single weighted pool.
                                    </p>
                                </div>

                                <div className="p-4 bg-dark-lighter">
                                    <h4 className="font-semibold text-primary mb-2">
                                        Individual Event Ships
                                    </h4>
                                    <p className="text-gray-300">
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
                                Track and Share Battle Encounters
                            </h3>
                            <p className="text-gray-300">
                                Document enemy compositions, strategies, and notes for various game
                                encounters.
                            </p>

                            <div className="p-4 bg-dark-lighter">
                                <h4 className="font-semibold text-primary mb-2">Features</h4>
                                <ul className="text-gray-300 list-disc pl-4 space-y-1">
                                    <li>Create notes for Faction Ops, Story missions, etc.</li>
                                    <li>Record enemy ship compositions and stats</li>
                                    <li>Document successful strategies</li>
                                    <li>Add custom notes and observations</li>
                                    <li>Share encounters with alliance members or the community</li>
                                    <li>Browse shared encounters from other players</li>
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

                    {/* Simulation Section */}
                    <section id="simulation" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Simulation
                        </h2>
                        <div className="card">
                            <h3 className="text-xl font-semibold mb-2">Battle Simulation</h3>
                            <p className="mb-4">The simulation tools allow you to:</p>
                            <ul className="list-disc pl-6 space-y-2">
                                <li>Test different ship configurations</li>
                                <li>Simulate combat scenarios</li>
                                <li>Calculate damage output</li>
                                <li>Analyze defensive capabilities</li>
                            </ul>
                        </div>
                    </section>
                </div>
            </PageLayout>
        </>
    );
};

export default DocumentationPage;
