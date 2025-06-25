// Extensive video search utilities for the Migaku extension
// This module attempts to detect video elements on a page using a wide variety
// of heuristics beyond simple <video> tag queries. The goal is to reliably
// locate embedded players regardless of how they are implemented or hidden.

(() => {
  const VIDEO_EXT_RE = /(\.m3u8|\.mp4|\.webm|\.ogg|\.mov|\.flv)(\?|$)/i;
  const KNOWN_PLAYER_SELECTORS = [
    'video', 'video-js', 'amp-video',
    '[class*="jw" i]', '[class*="vjs" i]', '[class*="plyr" i]',
    '[class*="player" i]', '[id*="player" i]',
    '[class*="video" i]', '[id*="video" i]'
  ];

  /**
   * Scans a document using multiple heuristics in sequence.
   * Returns the first matching element or null.
   */
  function searchForHiddenVideo(rootDoc = document) {
    const visitedDocs = new WeakSet();

    function searchDoc(doc) {
      if (!doc || visitedDocs.has(doc)) return null;
      visitedDocs.add(doc);

      return (
        findByTags(doc) ||
        findByKnownContainers(doc) ||
        findBySources(doc) ||
        findByEmbeds(doc) ||
        findByAttributes(doc) ||
        findByBackgrounds(doc) ||
        findByScripts(doc) ||
        findByPerformanceEntries(doc) ||
        findByShadowRoots(doc) ||
        findByCanvas(doc) ||
        findByDatasetHints(doc) ||
        findByMediaSourceUrls(doc) ||
        scanAllElements(doc)
      );
    }

    const direct = searchDoc(rootDoc);
    if (direct) return direct;

    const nested = searchFrames(rootDoc, searchDoc);
    if (nested) return nested;

    return null;
  }

  /*--------------------------------------------------------------*
   *  Individual heuristic functions
   *--------------------------------------------------------------*/

  // 1. Standard and custom video tags
  function findByTags(doc) {
    try {
      return doc.querySelector(KNOWN_PLAYER_SELECTORS.join(','));
    } catch {
      return null;
    }
  }

  // 2. Known containers often used by players
  function findByKnownContainers(doc) {
    const containers = doc.querySelectorAll('[id*="player" i], [class*="player" i], [id*="video" i], [class*="video" i], [class*="jw" i], [class*="vjs" i], [class*="plyr" i]');
    for (const c of containers) {
      const found = c.querySelector(KNOWN_PLAYER_SELECTORS.join(','));
      if (found) return found;
    }
    return null;
  }

  // 3. <source> elements pointing to video files
  function findBySources(doc) {
    const sources = doc.querySelectorAll('source');
    for (const s of sources) {
      const src = s.src || s.getAttribute('src');
      if (src && VIDEO_EXT_RE.test(src)) {
        return s.parentElement;
      }
    }
    return null;
  }

  // 4. <object> or <embed> elements containing video
  function findByEmbeds(doc) {
    const embeds = doc.querySelectorAll('object,embed');
    for (const e of embeds) {
      const type = e.type || '';
      const src = e.src || e.data || '';
      if (/video|mp4|webm|ogg|flash/i.test(type) || VIDEO_EXT_RE.test(src)) {
        return e;
      }
    }
    return null;
  }

  // 5. Generic attributes that might contain video URLs
  function findByAttributes(doc) {
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const attrList = ['src', 'data-src', 'href', 'data-href'];
      for (const a of attrList) {
        const val = el.getAttribute?.(a);
        if (val && VIDEO_EXT_RE.test(val)) {
          return el;
        }
      }
    }
    return null;
  }

  // 6. Elements using background-image to show video thumbnails
  function findByBackgrounds(doc) {
    const all = doc.querySelectorAll('*');
    for (const el of all) {
      const style = getComputedStyle(el);
      if (!style) continue;
      const bg = style.backgroundImage || '';
      if (bg.includes('url')) {
        const m = bg.match(/url\(("|')?(.*?)("|')?\)/i);
        if (m && VIDEO_EXT_RE.test(m[2])) {
          return el;
        }
      }
    }
    return null;
  }

  // 7. Inspect inline scripts or script tags that reference video files
  function findByScripts(doc) {
    const scripts = doc.querySelectorAll('script');
    for (const s of scripts) {
      const content = s.textContent || s.src || '';
      if (VIDEO_EXT_RE.test(content)) {
        return s;
      }
    }
    return null;
  }

  // 8. Analyze network performance entries for video requests
  function findByPerformanceEntries(doc) {
    try {
      const entries = performance.getEntriesByType('resource');
      for (const e of entries) {
        if (VIDEO_EXT_RE.test(e.name)) {
          const candidate = doc.querySelector(`*[src="${e.name}"]`);
          if (candidate) return candidate;
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  // 9. Search within shadow DOMs
  function findByShadowRoots(doc) {
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (el.shadowRoot) {
        const found = el.shadowRoot.querySelector(KNOWN_PLAYER_SELECTORS.join(','));
        if (found) return found;
      }
    }
    return null;
  }

  // 10. Canvas elements streaming video via captureStream
  function findByCanvas(doc) {
    const canvases = doc.querySelectorAll('canvas');
    for (const c of canvases) {
      if (typeof c.captureStream === 'function' && c.width > 0 && c.height > 0) {
        return c;
      }
    }
    return null;
  }

  // 11. Dataset attributes that hint at video
  function findByDatasetHints(doc) {
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      for (const key in el.dataset) {
        const val = el.dataset[key];
        if (VIDEO_EXT_RE.test(val)) {
          return el;
        }
      }
    }
    return null;
  }

  // 12. Look for script/link tags referencing streaming manifests
  function findByMediaSourceUrls(doc) {
    const nodes = doc.querySelectorAll('script,link');
    for (const n of nodes) {
      const content = n.src || n.href || n.textContent || '';
      if (/\.(m3u8|mpd)(\?|$)/i.test(content)) {
        return n;
      }
    }
    return null;
  }

  // 13. Exhaustive element scanning for video-like dimensions
  function scanAllElements(doc) {
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const rect = el.getBoundingClientRect();
      if (rect.width > 320 && rect.height > 180) {
        const style = getComputedStyle(el);
        const bg = style.backgroundImage || '';
        if (VIDEO_EXT_RE.test(bg) || /video/i.test(style.animationName || '')) {
          return el;
        }
      }
    }
    return null;
  }

  // 14. Crawl iframe contents
  function searchFrames(doc, searchFn) {
    const iframes = doc.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const innerDoc = iframe.contentDocument || iframe.contentWindow?.document;
        const found = searchFn(innerDoc);
        if (found) return found;
      } catch { /* cross-origin */ }
    }
    return null;
  }

  /*--------------------------------------------------------------*
   *  Additional helper utilities
   *--------------------------------------------------------------*/

  // Wait for a video element to appear using a MutationObserver.
  function waitForVideo(timeout = 30000, rootDoc = document) {
    return new Promise(resolve => {
      const existing = searchForHiddenVideo(rootDoc);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const vid = searchForHiddenVideo(rootDoc);
        if (vid) {
          observer.disconnect();
          resolve(vid);
        }
      });

      observer.observe(rootDoc, { subtree: true, childList: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  // Public API
  window.searchForHiddenVideo = searchForHiddenVideo;
  window.waitForVideo = waitForVideo;
})();

