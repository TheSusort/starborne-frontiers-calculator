import React from 'react';
import { Link } from 'react-router-dom';
import { APP_NAME } from '../constants';
import { BackupRestoreData } from '../components/debug/BackupRestoreData';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';

const HomePage: React.FC = () => {
    return (
        <>
            <Seo {...SEO_CONFIG.home} />
            <div className="space-y-8">
                <section className="space-y-4">
                    <h1 className="text-3xl font-bold text-gray-100">Welcome to the {APP_NAME}</h1>
                    <p>
                        Build, customize, simulate, and calculate the best gear for your fleet with
                        our comprehensive ship management tools.
                    </p>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-gray-100">Quick Start Guide</h2>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        <div className="bg-dark p-4 ">
                            <h3 className="text-xl font-semibold text-gray-100 mb-2">
                                1. Add Ships
                            </h3>
                            <p>
                                Start by visiting the{' '}
                                <Link to="/ships" className="text-primary hover:text-primary-hover">
                                    Ships
                                </Link>{' '}
                                page to create and manage your fleet.
                            </p>
                        </div>
                        <div className="bg-dark p-4 ">
                            <h3 className="text-xl font-semibold text-gray-100 mb-2">
                                2. Add Gear
                            </h3>
                            <p>
                                Configure your equipment in the{' '}
                                <Link to="/gear" className="text-primary hover:text-primary-hover">
                                    Gear
                                </Link>{' '}
                                section.
                            </p>
                        </div>
                        <div className="bg-dark p-4 ">
                            <h3 className="text-xl font-semibold text-gray-100 mb-2">3. Gear Up</h3>
                            <p>
                                Let the app calculate the best gear for your fleet with the{' '}
                                <Link
                                    to="/autogear"
                                    className="text-primary hover:text-primary-hover"
                                >
                                    Autogear Tool
                                </Link>
                            </p>
                        </div>
                    </div>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-gray-100">Features</h2>
                    <ul className="list-disc list-inside  space-y-2">
                        <li>
                            <b>Automated gear optimization</b>
                        </li>
                        <li>Ship builder with comprehensive customization options</li>
                        <li>Gear management system</li>
                        <li>Combat simulation tools</li>
                        <li>
                            Loadout saving and sharing, for saving gear setups, for individual ships
                            or teams
                        </li>
                        <li>
                            Encounter notes and tracking, for saving and sharing fleet formations
                        </li>
                        <li>Engineering stats, I just wanted to achieve 100% stat coverage</li>
                        <li>
                            Specialized calculators for{' '}
                            <Link to="/defense" className="text-primary hover:text-primary-hover">
                                Defense
                            </Link>
                            ,{' '}
                            <Link to="/damage" className="text-primary hover:text-primary-hover">
                                Damage
                            </Link>
                            ,{' '}
                            <Link to="/healing" className="text-primary hover:text-primary-hover">
                                Healing
                            </Link>
                            , and{' '}
                            <Link
                                to="/damage-deconstruction"
                                className="text-primary hover:text-primary-hover"
                            >
                                Damage Deconstruction
                            </Link>
                        </li>
                    </ul>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-gray-100">Coming Soon</h2>
                    <div className="bg-dark p-4 ">
                        <ul className="list-disc list-inside  space-y-2">
                            <li>Enhanced simulation features</li>
                            <li>Fleet management improvements</li>
                            <li>Additional customization options</li>
                            <li>More statistical analysis tools</li>
                        </ul>
                    </div>
                </section>

                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-gray-100">Feedback</h2>
                    <p>
                        Please provide feedback on the app, or any suggestions for improvements.
                        I&apos;m open to any suggestions, as I&apos;m running out of ideas of stuff
                        to implement.
                    </p>

                    <p>
                        Contact me directly on Discord at <b>alvbert</b>, or in the{' '}
                        <Link
                            to="https://discord.com/invite/playfrontiers"
                            className="text-primary hover:text-primary-hover"
                        >
                            Starborne Frontiers
                        </Link>{' '}
                        discord server, my{' '}
                        <Link
                            to="https://discord.com/channels/973311773920862308/1315988554534486036"
                            className="text-primary hover:text-primary-hover"
                        >
                            Autogearing forum thread
                        </Link>
                    </p>

                    <p>
                        This whole project is also open source, and you can find the code on{' '}
                        <Link
                            to="https://github.com/TheSusort/starborne-frontiers-calculator"
                            className="text-primary hover:text-primary-hover"
                        >
                            GitHub
                        </Link>
                        . Feel free to contribute to the project, adding issues, or even just use it
                        as a base for your own project.
                    </p>
                </section>

                <section className="bg-dark p-4">
                    <h2 className="text-lg font-bold mb-4">Backup & Restore</h2>
                    <p className="text-sm mb-4">
                        Create and restore your gear and ship data from a backup file. This is
                        useful if you want to migrate your data to a new device, or if you want to
                        backup your data.
                        <br />
                    </p>
                    <BackupRestoreData />
                </section>
            </div>
        </>
    );
};

export default HomePage;
