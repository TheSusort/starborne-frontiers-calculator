import React, { useMemo, useState } from 'react';
import { useShipsData } from '../hooks/useShipsData';
import { PageLayout } from '../components/ui';
import { Loader } from '../components/ui/Loader';
import { SearchInput } from '../components/ui/SearchInput';
import { Image } from '../components/ui/Image';
import { RARITIES, FACTIONS, SHIP_TYPES } from '../constants';
import { SEO_CONFIG } from '../constants/seo';
import { Ship } from '../types/ship';
import { ShipIcon, getAffinityClass } from '../components/ship/shipDisplayComponents';
import { ChevronDownIcon } from '../components/ui/icons/ChevronIcons';
import { Tabs } from '../components/ui/layout/Tabs';
import { WEBSITE_LORE, LoreArticle } from '../constants/websiteLore';
import {
    BioContent,
    PlainTextContent,
    SnippetText,
    HighlightedText,
} from '../components/ship/BioContent';
import Seo from '../components/seo/Seo';

const getMatchSnippet = (text: string, query: string): string | null => {
    if (!query || query.length < 2 || !text) return null;
    const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const idx = plain.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return null;
    const before = plain.lastIndexOf('.', idx);
    const after = plain.indexOf('.', idx + query.length);
    const start = before === -1 ? 0 : before + 1;
    const end = after === -1 ? plain.length : after + 1;
    return plain.slice(start, end).trim();
};

const ExpandableCard: React.FC<{
    title: React.ReactNode;
    snippet: string | null;
    searchQuery: string;
    quote?: string;
    quoteAuthor?: string;
    className?: string;
    children?: React.ReactNode;
    content: React.ReactNode;
}> = ({ title, snippet, searchQuery, quote, quoteAuthor, className = '', children, content }) => {
    const [expanded, setExpanded] = useState(false);

    return (
        <button
            className={`card w-full text-left cursor-pointer hover:bg-dark-lighter transition-colors ${className}`}
            onClick={() => setExpanded(!expanded)}
        >
            <div className="flex items-start gap-3">
                {children}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        {title}
                        <ChevronDownIcon
                            className={`w-5 h-5 text-gray-500 ml-auto flex-shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
                        />
                    </div>
                    {!expanded && snippet && <SnippetText text={snippet} query={searchQuery} />}
                    {!expanded && !snippet && quote && (
                        <p className="text-sm text-gray-400 mt-1 line-clamp-2 font-primary italic">
                            {quote}
                            {quoteAuthor && (
                                <span className="not-italic text-gray-500"> — {quoteAuthor}</span>
                            )}
                        </p>
                    )}
                </div>
            </div>
            <div
                className="transition-all duration-300 ease-in-out overflow-hidden"
                style={{
                    maxHeight: expanded ? '5000px' : '0',
                    opacity: expanded ? 1 : 0,
                }}
            >
                <div className="mt-3 pt-3 border-t border-dark-border">
                    {quote && (
                        <blockquote className="border-l-2 border-primary pl-4 mb-4 italic text-gray-400 font-primary">
                            <p>
                                <HighlightedText text={quote} query={searchQuery} />
                            </p>
                            {quoteAuthor && (
                                <footer className="mt-1 text-sm not-italic text-gray-500">
                                    — <HighlightedText text={quoteAuthor} query={searchQuery} />
                                </footer>
                            )}
                        </blockquote>
                    )}
                    {content}
                </div>
            </div>
        </button>
    );
};

const ShipBioCard: React.FC<{ ship: Ship; searchQuery: string }> = ({ ship, searchQuery }) => {
    const snippet = useMemo(() => {
        if (!searchQuery || searchQuery.length < 2) return null;
        const query = searchQuery.toLowerCase();
        if (ship.quote?.toLowerCase().includes(query)) return ship.quote;
        if (ship.quoteAuthor?.toLowerCase().includes(query)) return ship.quoteAuthor;
        return getMatchSnippet(ship.bio ?? '', searchQuery);
    }, [ship.bio, ship.quote, ship.quoteAuthor, searchQuery]);

    return (
        <ExpandableCard
            className={RARITIES[ship.rarity || 'common'].borderColor}
            title={
                <>
                    {ship.type && SHIP_TYPES[ship.type] && (
                        <ShipIcon
                            iconUrl={SHIP_TYPES[ship.type].iconUrl}
                            name={SHIP_TYPES[ship.type].name}
                            className={ship.affinity ? getAffinityClass(ship.affinity) : ''}
                        />
                    )}
                    {ship.faction && FACTIONS[ship.faction] && (
                        <ShipIcon
                            iconUrl={FACTIONS[ship.faction].iconUrl}
                            name={FACTIONS[ship.faction].name}
                        />
                    )}
                    <span
                        className={`font-secondary text-lg ${RARITIES[ship.rarity || 'common'].textColor}`}
                    >
                        {ship.name}
                    </span>
                </>
            }
            snippet={snippet}
            searchQuery={searchQuery}
            quote={ship.quote}
            quoteAuthor={ship.quoteAuthor}
            content={
                <BioContent
                    bio={ship.bio ?? ''}
                    searchQuery={searchQuery}
                    className="text-gray-300 leading-relaxed font-sans"
                />
            }
        >
            {ship.imageKey && (
                <div className="w-20 h-20 flex-shrink-0">
                    <Image
                        src={`${ship.imageKey}_BigPortrait.jpg`}
                        alt={ship.name}
                        className="w-full h-full"
                        imageClassName="w-full h-full object-cover object-top"
                        aspectRatio="1/1"
                    />
                </div>
            )}
        </ExpandableCard>
    );
};

const LoreArticleCard: React.FC<{ article: LoreArticle; searchQuery: string }> = ({
    article,
    searchQuery,
}) => {
    const snippet = useMemo(
        () => getMatchSnippet(article.body, searchQuery),
        [article.body, searchQuery]
    );

    return (
        <ExpandableCard
            title={<span className="font-secondary text-lg text-white">{article.title}</span>}
            snippet={snippet}
            searchQuery={searchQuery}
            content={
                <PlainTextContent
                    text={article.body}
                    searchQuery={searchQuery}
                    className="text-gray-300 leading-relaxed font-primary"
                />
            }
        />
    );
};

const TABS = [
    { id: 'bios', label: 'Ship Bios' },
    { id: 'articles', label: 'World Lore' },
];

export const ShipLorePage: React.FC = () => {
    const { ships: templateShips, loading, error } = useShipsData();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('bios');

    const shipsWithBios = useMemo(() => {
        if (!templateShips) return [];
        return templateShips
            .filter((ship) => ship.bio)
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [templateShips]);

    const isSearching = searchQuery.length >= 2;

    const filteredShips = useMemo(() => {
        if (!isSearching) return shipsWithBios;
        const query = searchQuery.toLowerCase();
        return shipsWithBios.filter(
            (ship) =>
                ship.name.toLowerCase().includes(query) ||
                ship.bio?.toLowerCase().includes(query) ||
                ship.quote?.toLowerCase().includes(query) ||
                ship.quoteAuthor?.toLowerCase().includes(query)
        );
    }, [shipsWithBios, searchQuery, isSearching]);

    const filteredArticles = useMemo(() => {
        if (!isSearching) return WEBSITE_LORE;
        const query = searchQuery.toLowerCase();
        return WEBSITE_LORE.filter(
            (article) =>
                article.title.toLowerCase().includes(query) ||
                article.body.toLowerCase().includes(query)
        );
    }, [searchQuery, isSearching]);

    const visibleCount = isSearching
        ? filteredShips.length + filteredArticles.length
        : activeTab === 'bios'
          ? filteredShips.length
          : filteredArticles.length;
    const totalItems = shipsWithBios.length + WEBSITE_LORE.length;
    const resultCount = isSearching
        ? `${visibleCount} of ${totalItems} entries`
        : activeTab === 'bios'
          ? `${shipsWithBios.length} ships`
          : `${WEBSITE_LORE.length} articles`;

    if (loading) return <Loader />;

    if (error) {
        return (
            <div className="text-center text-red-500">
                <p>Error: {error}</p>
            </div>
        );
    }

    return (
        <>
            <Seo {...SEO_CONFIG.shipLore} />
            <PageLayout
                title="Lore"
                description="Browse and search through ship bios, diaries, and world lore. Look for easter eggs, cross-references, and hidden connections."
            >
                <div className="space-y-4 max-w-4xl">
                    <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

                    <div className="flex items-center gap-4">
                        <SearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder="Search all lore..."
                            className="flex-1"
                        />
                        <span className="text-sm text-gray-400 whitespace-nowrap">
                            {resultCount}
                        </span>
                    </div>

                    <div className="space-y-2">
                        {activeTab === 'bios' &&
                            filteredShips.map((ship) => (
                                <ShipBioCard key={ship.id} ship={ship} searchQuery={searchQuery} />
                            ))}

                        {activeTab === 'articles' &&
                            filteredArticles.map((article) => (
                                <LoreArticleCard
                                    key={article.slug}
                                    article={article}
                                    searchQuery={searchQuery}
                                />
                            ))}

                        {isSearching && (
                            <>
                                {activeTab === 'bios' && filteredArticles.length > 0 && (
                                    <>
                                        <div className="text-xs text-gray-500 uppercase tracking-wide pt-2">
                                            World Lore
                                        </div>
                                        {filteredArticles.map((article) => (
                                            <LoreArticleCard
                                                key={article.slug}
                                                article={article}
                                                searchQuery={searchQuery}
                                            />
                                        ))}
                                    </>
                                )}
                                {activeTab === 'articles' && filteredShips.length > 0 && (
                                    <>
                                        <div className="text-xs text-gray-500 uppercase tracking-wide pt-2">
                                            Ship Bios
                                        </div>
                                        {filteredShips.map((ship) => (
                                            <ShipBioCard
                                                key={ship.id}
                                                ship={ship}
                                                searchQuery={searchQuery}
                                            />
                                        ))}
                                    </>
                                )}
                            </>
                        )}

                        {visibleCount === 0 && (
                            <div className="text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                                No matching lore found
                            </div>
                        )}
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default ShipLorePage;
