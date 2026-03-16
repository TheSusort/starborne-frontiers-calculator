import React from 'react';
import { Helmet } from 'react-helmet-async';

interface SeoProps {
    description: string;
    title?: string;
    keywords?: string;
    ogImage?: string;
}

const Seo: React.FC<SeoProps> = ({ title, description, keywords, ogImage }) => {
    const siteTitle = 'Starborne Planner';
    const fullTitle = title ? `${title} | ${siteTitle}` : siteTitle;
    const siteUrl = 'https://starborneplanner.com';
    const defaultOgImage = `${siteUrl}/faviconV2.png`;
    const canonicalUrl = `${siteUrl}${window.location.pathname}`;

    return (
        <Helmet>
            <title>{fullTitle}</title>
            <meta name="description" content={description} />
            {keywords && <meta name="keywords" content={keywords} />}
            <link rel="canonical" href={canonicalUrl} />

            {/* Open Graph / Facebook */}
            <meta property="og:type" content="website" />
            <meta property="og:title" content={fullTitle} />
            <meta property="og:description" content={description} />
            <meta property="og:image" content={ogImage || defaultOgImage} />
            <meta property="og:url" content={canonicalUrl} />

            {/* Twitter */}
            <meta name="twitter:card" content="summary" />
            <meta name="twitter:title" content={fullTitle} />
            <meta name="twitter:description" content={description} />
            <meta name="twitter:image" content={ogImage || defaultOgImage} />
        </Helmet>
    );
};

export default Seo;
