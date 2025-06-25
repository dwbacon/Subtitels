// Page detection utilities for Migaku Extension
// Provides functions to detect anime title and episode from the page.

function pageDetectAnimeName(state) {
    if (!state || state.isEmbedded || state.ignorePageDetection) return;
    let newName = null;

    const metaSelectors = [
        'meta[property="og:title"]',
        'meta[name="title"]',
        'meta[property="twitter:title"]'
    ];
    for (const sel of metaSelectors) {
        const content = document.querySelector(sel)?.content;
        if (content) {
            const m = content.match(/^(.*?)(?:\s+(?:Episode|Ep|\||-|:|$))/i);
            if (m && m[1]) { newName = m[1].trim(); break; }
        }
    }

    if (!newName && document.title) {
        const m = document.title.match(/^(.*?)(?:\s+(?:Episode|Ep|\||-|:|$))/i);
        if (m && m[1]) newName = m[1].trim();
    }

    if (!newName) {
        const heading = document.querySelector('h1, h2');
        if (heading) newName = heading.textContent.trim();
    }

    if (!newName) {
        const slugMatch = window.location.pathname.match(/\/anime\/([^\/]+)/);
        if (slugMatch && slugMatch[1]) newName = slugMatch[1].replace(/-/g, ' ');
    }

    if (!newName) return;

    if (newName !== state.detectedAnimeName || !state.detectedAnimeName) {
        state.detectedAnimeName = newName;
        const el = document.getElementById('detected-anime-name');
        if (el) el.textContent = state.detectedAnimeName;
        if (typeof logToPopup === 'function') logToPopup(`Detected anime: ${state.detectedAnimeName}`);
        if (typeof attemptToMatchAndLoadCurrentPageDetection === 'function') attemptToMatchAndLoadCurrentPageDetection();
    }
}

function pageDetectEpisode(state) {
    if (!state || state.isEmbedded || state.ignorePageDetection) return;
    let newEp = null;
    const patterns = [
        /Episode\s*(\d+)/i,
        /Ep\.?\s*(\d+)/i,
        /\bE(\d{1,3})\b/i,
        /episode-(\d{1,3})/i
    ];
    const txt = document.body.innerText;
    for (const p of patterns) {
        const match = txt.match(p);
        if (match && match[1]) { newEp = parseInt(match[1], 10); break; }
    }

    if (newEp === null) {
        const slug = window.location.pathname.match(/episode-(\d{1,3})/i);
        if (slug && slug[1]) newEp = parseInt(slug[1], 10);
    }

    if (newEp !== null && (state.detectedEpisode === null || newEp !== state.detectedEpisode)) {
        state.detectedEpisode = newEp;
        const el = document.getElementById('detected-episode');
        if (el) el.textContent = state.detectedEpisode;
        if (typeof logToPopup === 'function') logToPopup(`Detected ep: ${state.detectedEpisode}`);
        if (typeof attemptToMatchAndLoadCurrentPageDetection === 'function') attemptToMatchAndLoadCurrentPageDetection();
    }
}

// Expose globally (for content.js)
window.pageDetectAnimeName = pageDetectAnimeName;
window.pageDetectEpisode = pageDetectEpisode;
