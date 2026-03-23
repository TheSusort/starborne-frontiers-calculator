import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useShipsData } from '../../hooks/useShipsData';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { PageLayout } from '../../components/ui';
import { Loader } from '../../components/ui/Loader';
import { SearchInput } from '../../components/ui/SearchInput';
import { Image } from '../../components/ui/Image';
import { Button } from '../../components/ui/Button';
import { RARITIES, FACTIONS, SHIP_TYPES } from '../../constants';
import { SEO_CONFIG } from '../../constants/seo';
import { Ship } from '../../types/ship';
import { ShipIcon, getAffinityClass } from '../../components/ship/shipDisplayComponents';
import { ChevronDownIcon } from '../../components/ui/icons/ChevronIcons';
import { Tabs } from '../../components/ui/layout/Tabs';
import { WEBSITE_LORE, LoreArticle } from '../../constants/websiteLore';
import {
    BioContent,
    PlainTextContent,
    SnippetText,
    HighlightedText,
} from '../../components/ship/BioContent';
import Seo from '../../components/seo/Seo';

type Selection = { type: 'ship'; id: string } | { type: 'article'; slug: string } | null;

/**
 * Makes a sticky element scrollable by adjusting its `top` based on scroll direction.
 * Scrolling down anchors the bottom edge; scrolling up anchors the top edge.
 */
const useStickyScroll = (topOffset = 16) => {
    const ref = useRef<HTMLDivElement>(null);
    const [stickyTop, setStickyTop] = useState(topOffset);
    const prevScrollY = useRef(window.scrollY);

    useEffect(() => {
        const onScroll = () => {
            const el = ref.current;
            if (!el) return;

            const scrollY = window.scrollY;
            const delta = scrollY - prevScrollY.current;
            prevScrollY.current = scrollY;

            const elHeight = el.offsetHeight;
            const vpHeight = window.innerHeight;

            if (elHeight <= vpHeight - topOffset * 2) {
                setStickyTop(topOffset);
                return;
            }

            const minTop = -(elHeight - vpHeight + topOffset);

            setStickyTop((prev) => Math.max(minTop, Math.min(topOffset, prev - delta)));
        };

        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, [topOffset]);

    return { ref, stickyTop };
};

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

// --- Expandable card (mobile / desktop with no selection) ---

const ExpandableCard: React.FC<{
    title: React.ReactNode;
    snippet: string | null;
    searchQuery: string;
    quote?: string;
    quoteAuthor?: string;
    className?: string;
    activeBgColor?: string;
    children?: React.ReactNode;
    content: React.ReactNode;
    onClickOverride?: () => void;
    isActive?: boolean;
}> = ({
    title,
    snippet,
    searchQuery,
    quote,
    quoteAuthor,
    className = '',
    activeBgColor = '',
    children,
    content,
    onClickOverride,
    isActive = false,
}) => {
    const [expanded, setExpanded] = useState(false);

    const handleClick = () => {
        if (onClickOverride) {
            onClickOverride();
        } else {
            setExpanded(!expanded);
        }
    };

    const showExpanded = !onClickOverride && expanded;

    return (
        <div className={`card transition-colors duration-150 relative ${className}`}>
            {isActive && (
                <div
                    className={`absolute inset-0 ${activeBgColor} opacity-20 pointer-events-none rounded-[inherit]`}
                />
            )}
            <div
                className="flex items-start gap-3 cursor-pointer"
                onClick={handleClick}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleClick();
                    }
                }}
            >
                {children}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        {title}
                        {!onClickOverride && (
                            <ChevronDownIcon
                                className={`w-5 h-5 text-theme-text-secondary ml-auto flex-shrink-0 transition-transform duration-300 ${showExpanded ? 'rotate-180' : ''}`}
                            />
                        )}
                    </div>
                    {!showExpanded && snippet && <SnippetText text={snippet} query={searchQuery} />}
                    {!showExpanded && !snippet && quote && (
                        <p className="text-sm text-theme-text-secondary mt-1 line-clamp-2 font-primary italic">
                            {quote}
                            {quoteAuthor && (
                                <span className="not-italic text-theme-text-secondary">
                                    {' '}
                                    — {quoteAuthor}
                                </span>
                            )}
                        </p>
                    )}
                </div>
            </div>
            {!onClickOverride && (
                <div
                    className="transition-all duration-300 ease-in-out overflow-hidden"
                    style={{
                        maxHeight: showExpanded ? '5000px' : '0',
                        opacity: showExpanded ? 1 : 0,
                    }}
                >
                    <div className="mt-3 pt-3 border-t border-dark-border">
                        {quote && (
                            <blockquote className="border-l-2 border-primary pl-4 mb-4 italic text-theme-text-secondary font-primary">
                                <p>
                                    <HighlightedText text={quote} query={searchQuery} />
                                </p>
                                {quoteAuthor && (
                                    <footer className="mt-1 text-sm not-italic text-theme-text-secondary">
                                        — <HighlightedText text={quoteAuthor} query={searchQuery} />
                                    </footer>
                                )}
                            </blockquote>
                        )}
                        {content}
                    </div>
                </div>
            )}
        </div>
    );
};

const ShipBioCard: React.FC<{
    ship: Ship;
    searchQuery: string;
    onClickOverride?: () => void;
    isActive?: boolean;
}> = ({ ship, searchQuery, onClickOverride, isActive }) => {
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
            isActive={isActive}
            activeBgColor={RARITIES[ship.rarity || 'common'].bgColor}
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
            onClickOverride={onClickOverride}
            content={
                <BioContent
                    bio={ship.bio ?? ''}
                    searchQuery={searchQuery}
                    className="text-theme-text leading-relaxed font-sans"
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

const LoreArticleCard: React.FC<{
    article: LoreArticle;
    searchQuery: string;
    onClickOverride?: () => void;
    isActive?: boolean;
}> = ({ article, searchQuery, onClickOverride, isActive }) => {
    const snippet = useMemo(
        () => getMatchSnippet(article.body, searchQuery),
        [article.body, searchQuery]
    );

    return (
        <ExpandableCard
            title={<span className="font-secondary text-lg text-white">{article.title}</span>}
            snippet={snippet}
            searchQuery={searchQuery}
            onClickOverride={onClickOverride}
            isActive={isActive}
            activeBgColor="bg-primary"
            content={
                <PlainTextContent
                    text={article.body}
                    searchQuery={searchQuery}
                    className="text-theme-text leading-relaxed font-primary"
                />
            }
        />
    );
};

// --- Reader pane content ---

const ShipReaderPane: React.FC<{ ship: Ship; searchQuery: string }> = ({ ship, searchQuery }) => (
    <div className="space-y-6">
        <div className="flex items-start gap-4">
            {ship.imageKey && (
                <div className="w-28 h-28 flex-shrink-0">
                    <Image
                        src={`${ship.imageKey}_BigPortrait.jpg`}
                        alt={ship.name}
                        className="w-full h-full"
                        imageClassName="w-full h-full object-cover object-top"
                        aspectRatio="1/1"
                    />
                </div>
            )}
            <div>
                <div className="flex items-center gap-2 mb-1">
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
                </div>
                <h2
                    className={`font-secondary text-2xl ${RARITIES[ship.rarity || 'common'].textColor}`}
                >
                    {ship.name}
                </h2>
            </div>
        </div>

        {ship.quote && (
            <blockquote className="border-l-2 border-primary pl-4 italic text-theme-text-secondary font-primary">
                <p>
                    <HighlightedText text={ship.quote} query={searchQuery} />
                </p>
                {ship.quoteAuthor && (
                    <footer className="mt-1 text-sm not-italic text-theme-text-secondary">
                        — <HighlightedText text={ship.quoteAuthor} query={searchQuery} />
                    </footer>
                )}
            </blockquote>
        )}

        <div className="border-t border-dark-border pt-4">
            <BioContent
                bio={ship.bio ?? ''}
                searchQuery={searchQuery}
                className="text-theme-text leading-relaxed font-sans"
            />
        </div>
    </div>
);

const ArticleReaderPane: React.FC<{ article: LoreArticle; searchQuery: string }> = ({
    article,
    searchQuery,
}) => (
    <div className="space-y-6">
        <h2 className="font-secondary text-2xl text-white">{article.title}</h2>

        <div className="border-t border-dark-border pt-4">
            <PlainTextContent
                text={article.body}
                searchQuery={searchQuery}
                className="text-theme-text leading-relaxed font-primary"
            />
        </div>

        {article.sourceUrl && (
            <div className="pt-4 border-t border-dark-border">
                <a
                    href={article.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:text-primary-hover"
                >
                    View original source
                </a>
            </div>
        )}
    </div>
);

// --- Main page ---

const TABS = [
    { id: 'bios', label: 'Ship Bios' },
    { id: 'articles', label: 'World Lore' },
];

export const ShipLorePage: React.FC = () => {
    const { ships: templateShips, loading, error } = useShipsData();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('bios');
    const [selection, setSelection] = useState<Selection>(null);
    const isDesktop = useMediaQuery('(min-width: 1280px)');

    const readerOpen = isDesktop && selection !== null;
    const { ref: readerRef, stickyTop } = useStickyScroll(16);

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

    const selectedShip = useMemo(() => {
        if (selection?.type !== 'ship') return null;
        return shipsWithBios.find((s) => s.id === selection.id) ?? null;
    }, [selection, shipsWithBios]);

    const selectedArticle = useMemo(() => {
        if (selection?.type !== 'article') return null;
        return WEBSITE_LORE.find((a) => a.slug === selection.slug) ?? null;
    }, [selection]);

    const handleSelectShip = useCallback(
        (id: string) =>
            setSelection((prev) =>
                prev?.type === 'ship' && prev.id === id ? null : { type: 'ship', id }
            ),
        []
    );

    const handleSelectArticle = useCallback(
        (slug: string) =>
            setSelection((prev) =>
                prev?.type === 'article' && prev.slug === slug ? null : { type: 'article', slug }
            ),
        []
    );

    const handleCloseReader = useCallback(() => setSelection(null), []);

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

    // On desktop: cards open the reader; on mobile: cards expand inline
    const shipClickHandler = isDesktop
        ? (id: string) => () => handleSelectShip(id)
        : () => undefined;
    const articleClickHandler = isDesktop
        ? (slug: string) => () => handleSelectArticle(slug)
        : () => undefined;

    const shipList = (
        <>
            {filteredShips.map((ship) => (
                <ShipBioCard
                    key={ship.id}
                    ship={ship}
                    searchQuery={searchQuery}
                    onClickOverride={shipClickHandler(ship.id)}
                    isActive={selection?.type === 'ship' && selection.id === ship.id}
                />
            ))}
        </>
    );

    const articleList = (
        <>
            {filteredArticles.map((article) => (
                <LoreArticleCard
                    key={article.slug}
                    article={article}
                    searchQuery={searchQuery}
                    onClickOverride={articleClickHandler(article.slug)}
                    isActive={selection?.type === 'article' && selection.slug === article.slug}
                />
            ))}
        </>
    );

    const crossResults = isSearching && (
        <>
            {activeTab === 'bios' && filteredArticles.length > 0 && (
                <>
                    <div className="text-xs text-theme-text-secondary uppercase tracking-wide pt-2">
                        World Lore
                    </div>
                    {filteredArticles.map((article) => (
                        <LoreArticleCard
                            key={article.slug}
                            article={article}
                            searchQuery={searchQuery}
                            onClickOverride={articleClickHandler(article.slug)}
                            isActive={
                                selection?.type === 'article' && selection.slug === article.slug
                            }
                        />
                    ))}
                </>
            )}
            {activeTab === 'articles' && filteredShips.length > 0 && (
                <>
                    <div className="text-xs text-theme-text-secondary uppercase tracking-wide pt-2">
                        Ship Bios
                    </div>
                    {filteredShips.map((ship) => (
                        <ShipBioCard
                            key={ship.id}
                            ship={ship}
                            searchQuery={searchQuery}
                            onClickOverride={shipClickHandler(ship.id)}
                            isActive={selection?.type === 'ship' && selection.id === ship.id}
                        />
                    ))}
                </>
            )}
        </>
    );

    return (
        <>
            <Seo {...SEO_CONFIG.shipLore} />
            <PageLayout
                title="Lore"
                description="Browse and search through ship bios, diaries, and world lore. Look for easter eggs, cross-references, and hidden connections."
            >
                {isDesktop ? (
                    <div className="flex gap-6">
                        {/* List panel — full width initially, shrinks when reader opens */}
                        <div
                            className="flex-shrink-0 min-w-0 space-y-4 transition-all duration-500 ease-in-out"
                            style={{ width: readerOpen ? '380px' : '100%' }}
                        >
                            <div className={readerOpen ? '' : 'max-w-4xl space-y-4'}>
                                <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
                                <div className="flex items-center gap-4 mt-4">
                                    <SearchInput
                                        value={searchQuery}
                                        onChange={setSearchQuery}
                                        placeholder="Search all lore..."
                                        className="flex-1"
                                    />
                                    <span className="text-sm text-theme-text-secondary whitespace-nowrap">
                                        {resultCount}
                                    </span>
                                </div>
                                <div className="space-y-2 mt-4">
                                    {activeTab === 'bios' && shipList}
                                    {activeTab === 'articles' && articleList}
                                    {crossResults}
                                    {visibleCount === 0 && (
                                        <div className="text-center py-8 text-theme-text-secondary bg-dark-lighter border-2 border-dashed">
                                            No matching lore found
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Reader panel — hidden initially, slides in */}
                        <div
                            className="min-w-0 transition-all duration-500 ease-in-out"
                            style={{
                                flex: readerOpen ? '1 1 0%' : '0 0 0%',
                                opacity: readerOpen ? 1 : 0,
                                overflow: readerOpen ? 'visible' : 'hidden',
                            }}
                        >
                            <div
                                ref={readerRef}
                                className="card sticky"
                                style={{ top: `${stickyTop}px` }}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-xs text-theme-text-secondary uppercase tracking-wide">
                                        Reading
                                    </span>
                                    <Button
                                        variant="secondary"
                                        size="xs"
                                        onClick={handleCloseReader}
                                    >
                                        Close
                                    </Button>
                                </div>
                                {selectedShip && (
                                    <ShipReaderPane ship={selectedShip} searchQuery={searchQuery} />
                                )}
                                {selectedArticle && (
                                    <ArticleReaderPane
                                        article={selectedArticle}
                                        searchQuery={searchQuery}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Mobile/tablet: original expandable cards */
                    <div className="space-y-4 max-w-4xl">
                        <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
                        <div className="flex items-center gap-4">
                            <SearchInput
                                value={searchQuery}
                                onChange={setSearchQuery}
                                placeholder="Search all lore..."
                                className="flex-1"
                            />
                            <span className="text-sm text-theme-text-secondary whitespace-nowrap">
                                {resultCount}
                            </span>
                        </div>
                        <div className="space-y-2">
                            {activeTab === 'bios' && shipList}
                            {activeTab === 'articles' && articleList}
                            {crossResults}
                            {visibleCount === 0 && (
                                <div className="text-center py-8 text-theme-text-secondary bg-dark-lighter border-2 border-dashed">
                                    No matching lore found
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </PageLayout>
        </>
    );
};

export default ShipLorePage;
