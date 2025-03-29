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
    const fullTitle = `${title} | ${siteTitle}`;
    const defaultOgImage = '/faviconV2.png';

    return (
        <Helmet>
            <title>{title ? fullTitle : siteTitle}</title>
            <meta name="description" content={description} />
            {keywords && <meta name="keywords" content={keywords} />}

            {/* Open Graph / Facebook */}
            <meta property="og:type" content="website" />
            <meta property="og:title" content={fullTitle} />
            <meta property="og:description" content={description} />
            <meta property="og:image" content={ogImage || defaultOgImage} />

            {/* Twitter */}
            <meta name="twitter:title" content={fullTitle} />
            <meta name="twitter:description" content={description} />
            <meta name="twitter:image" content={ogImage || defaultOgImage} />
        </Helmet>
    );
};

export default Seo;
