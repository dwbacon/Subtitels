// Advanced video search utilities for Migaku Extension
// This file adds more robust search strategies to locate hidden video elements.

function searchForHiddenVideo(rootDoc = document) {
    function findInDocument(doc) {
        if (!doc) return null;
        let vid = doc.querySelector('video');
        if (vid) return vid;

        const playerContainers = doc.querySelectorAll('[id*="player" i], [class*="player" i], [id*="video" i], [class*="video" i]');
        for (const c of playerContainers) {
            const candidate = c.querySelector('video');
            if (candidate) return candidate;
        }

        const embeds = doc.querySelectorAll('object,embed');
        for (const e of embeds) {
            const type = e.type || '';
            const src = e.src || e.data || '';
            if (/video|mp4|webm|ogg/i.test(type) || /(mp4|webm|ogg)(\?|$)/i.test(src)) {
                return e;
            }
        }

        const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
            const el = walker.currentNode;
            if (el.shadowRoot) {
                const shadowVid = el.shadowRoot.querySelector('video');
                if (shadowVid) return shadowVid;
            }
        }
        return null;
    }

    let v = findInDocument(rootDoc);
    if (v) return v;

    const iframes = rootDoc.querySelectorAll('iframe');
    for (const iframe of iframes) {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            const nested = findInDocument(doc);
            if (nested) return nested;
        } catch (e) {
            // ignore cross-origin frames
        }
    }
    return null;
}

// expose globally
window.searchForHiddenVideo = searchForHiddenVideo;
