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
                    <nav className="bg-dark p-4 border border-dark-border">
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
                        <div className="bg-dark p-4 border border-dark-border space-y-4">
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
                        <div className="bg-dark p-4 border border-dark-border">
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
                        <div className="bg-dark p-4 border border-dark-border space-y-4">
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
                        <div className="bg-dark p-4 border border-dark-border space-y-4">
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
                        <div className="bg-dark p-4 border border-dark-border space-y-4">
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
                        <div className="bg-dark p-4 border border-dark-border">
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
                                            Ignore currently equipped gear: When enabled, the
                                            algorithm will only consider gear that isn&apos;t
                                            equipped on other ships.
                                        </li>
                                        <li>
                                            Ignore unleveled gear: When enabled, the algorithm will
                                            only consider gear that has been leveled up.
                                        </li>
                                        <li>
                                            Use upgraded stats: When enabled, the algorithm will
                                            consider gear that has been upgraded in the Upgrade
                                            Analysis tab in the Gear page.
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

                    {/* Simulation Section */}
                    <section id="simulation" className="space-y-4 [counter-increment:section]">
                        <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
                            Simulation
                        </h2>
                        <div className="bg-dark p-4 border border-dark-border">
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
