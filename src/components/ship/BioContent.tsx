import React from 'react';

interface BioContentProps {
    bio: string;
    searchQuery?: string;
    className?: string;
}

interface BioNode {
    type: 'heading' | 'text';
    content: string;
}

const parseBio = (bio: string): BioNode[] => {
    const nodes: BioNode[] = [];
    const regex = /<h4>(.*?)<\/h4>/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(bio)) !== null) {
        // Text before this heading
        if (match.index > lastIndex) {
            const text = bio.slice(lastIndex, match.index).trim();
            if (text) nodes.push({ type: 'text', content: text });
        }
        nodes.push({ type: 'heading', content: match[1] });
        lastIndex = regex.lastIndex;
    }

    // Remaining text after last heading
    if (lastIndex < bio.length) {
        const text = bio.slice(lastIndex).trim();
        if (text) nodes.push({ type: 'text', content: text });
    }

    return nodes;
};

const splitParagraphs = (text: string): string[] => {
    return text.split(/<br\s*\/?>\s*<br\s*\/?>/).filter((p) => p.trim());
};

export const HighlightedText: React.FC<{ text: string; query?: string }> = ({ text, query }) => {
    if (!query || query.length < 2) return <>{text}</>;

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);

    return (
        <>
            {parts.map((part, i) =>
                regex.test(part) ? (
                    <mark key={i} className="bg-yellow-500/30 text-white">
                        {part}
                    </mark>
                ) : (
                    <React.Fragment key={i}>{part}</React.Fragment>
                )
            )}
        </>
    );
};

export const BioContent: React.FC<BioContentProps> = ({ bio, searchQuery, className = '' }) => {
    const nodes = parseBio(bio);

    return (
        <div className={className}>
            {nodes.map((node, i) => {
                if (node.type === 'heading') {
                    return (
                        <h4
                            key={i}
                            className={`text-white font-secondary font-semibold text-base ${i > 0 ? 'mt-4' : ''}`}
                        >
                            <HighlightedText text={node.content} query={searchQuery} />
                        </h4>
                    );
                }
                const paragraphs = splitParagraphs(node.content);
                return paragraphs.map((p, j) => (
                    <p key={`${i}-${j}`} className={j > 0 ? 'mt-3' : 'mt-1'}>
                        <HighlightedText text={p.trim()} query={searchQuery} />
                    </p>
                ));
            })}
        </div>
    );
};

export const PlainTextContent: React.FC<{
    text: string;
    searchQuery?: string;
    className?: string;
}> = ({ text, searchQuery, className = '' }) => {
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());

    return (
        <div className={className}>
            {paragraphs.map((p, i) => (
                <p key={i} className={i > 0 ? 'mt-3' : ''}>
                    <HighlightedText text={p.trim()} query={searchQuery} />
                </p>
            ))}
        </div>
    );
};

export const SnippetText: React.FC<{ text: string; query: string }> = ({ text, query }) => (
    <p className="text-sm text-theme-text-secondary mt-1 line-clamp-2 font-primary">
        ...
        <HighlightedText text={text} query={query} />
        ...
    </p>
);
