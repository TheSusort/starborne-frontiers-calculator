// Netlify build plugin: fires a repository_dispatch on GitHub after a
// successful production deploy so the e2e-post-deploy workflow can kick off.
//
// Env vars (set in Netlify site settings → environment variables):
//   GH_DISPATCH_TOKEN  — fine-grained PAT with Contents: write on the repo
//   GH_DISPATCH_REPO   — e.g. "TheSusort/starborne-frontiers-calculator"
//
// Runs only when CONTEXT === "production" so preview/branch deploys don't
// trigger the smoke suite.

const EVENT_TYPE = 'netlify-deploy-succeeded';

export const onSuccess = async function ({ utils }) {
    const context = process.env.CONTEXT;
    if (context !== 'production') {
        console.log(`[github-dispatch] skipping: context="${context}" (only fires on production)`);
        return;
    }

    const token = process.env.GH_DISPATCH_TOKEN;
    const repo = process.env.GH_DISPATCH_REPO;
    // Prefer the canonical production URL (URL) over the branch permalink
    // (DEPLOY_PRIME_URL). The preview domain (`main--<site>.netlify.app`)
    // isn't in Supabase's allowed origins, so CORS-gated fetches from the
    // browser would fail there even though the same bundle works on prod.
    const deployUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;

    if (!token) {
        return utils.build.failPlugin('GH_DISPATCH_TOKEN is not set — add it in Netlify env vars');
    }
    if (!repo) {
        return utils.build.failPlugin('GH_DISPATCH_REPO is not set — add it in Netlify env vars (e.g. "TheSusort/starborne-frontiers-calculator")');
    }

    const endpoint = `https://api.github.com/repos/${repo}/dispatches`;
    const body = {
        event_type: EVENT_TYPE,
        client_payload: {
            deploy_url: deployUrl,
            commit_ref: process.env.COMMIT_REF,
            deploy_id: process.env.DEPLOY_ID,
        },
    };

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        return utils.build.failPlugin(
            `GitHub dispatch failed: ${res.status} ${res.statusText} — ${text}`
        );
    }

    console.log(`[github-dispatch] posted ${EVENT_TYPE} for ${deployUrl}`);
};
