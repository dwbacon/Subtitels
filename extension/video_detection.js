(function() {
    'use strict';

    const log = (...args) => {
        console.log('[Detection]', ...args);
        let logArea = document.getElementById('video-detection-log');
        if (!logArea) {
            logArea = document.createElement('pre');
            logArea.id = 'video-detection-log';
            logArea.style.cssText = 'position:fixed;bottom:0;left:0;max-height:200px;overflow:auto;background:rgba(0,0,0,0.7);color:#0f0;font-size:10px;z-index:999999;padding:5px;';
            document.documentElement.appendChild(logArea);
        }
        logArea.textContent += `\n[${new Date().toISOString()}] ${args.join(' ')} `;
    };

    let pageConfig = null;
    const loadConfig = (cfg) => {
        const host = location.host;
        for (const p of cfg.pages) {
            if (new RegExp(p.host).test(host)) {
                pageConfig = p;
                break;
            }
        }
        start();
    };
    chrome.storage.local.get('pagesConfig', (res) => {
        if (res.pagesConfig) {
            log('Loaded config from storage');
            loadConfig(res.pagesConfig);
        } else {
            fetch(chrome.runtime.getURL('pages.json')).then(r => r.json()).then(cfg => {
                chrome.storage.local.set({pagesConfig: cfg});
                loadConfig(cfg);
            }).catch(err => {
                log('Failed to load pages config', err);
                start();
            });
        }
    });

    const shadowRootHosts = [];
    const nodes = [];
    const iterationLimit = 100;
    const bindings = [];

    class Binding {
        constructor(video) {
            this.video = video;
            this.heartbeat = setInterval(() => {
                log('heartbeat', video.currentSrc || video.src);
            }, 1000);
        }
        dispose() {
            clearInterval(this.heartbeat);
        }
    }

    const garbageCollect = () => {
        let i = 0;
        while (i < shadowRootHosts.length) {
            const host = shadowRootHosts[i];
            if (!document.contains(host) || !host.shadowRoot) {
                shadowRootHosts.splice(i, 1);
            } else {
                ++i;
            }
        }
        i = 0;
        while (i < bindings.length) {
            if (!document.contains(bindings[i].video)) {
                bindings[i].dispose();
                bindings.splice(i, 1);
            } else {
                ++i;
            }
        }
    };

    const incrementallyFindShadowRoots = () => {
        garbageCollect();
        if (nodes.length === 0) {
            if (shadowRootHosts.length > 0) {
                return;
            }
            nodes.push(document);
        }
        let iteration = 0;
        while (nodes.length > 0 && ++iteration < iterationLimit) {
            const node = nodes.pop();
            if (!node) {
                continue;
            }
            const shadowRoot = node.shadowRoot;
            if (shadowRoot) {
                shadowRootHosts.push(node);
            }
            node.childNodes.forEach(child => nodes.push(child));
        }
    };

    const hasValidVideoSource = (video) => {
        if (pageConfig && pageConfig.allowBlankSrc) return true;
        if (video.src) return true;
        for (const child of video.children) {
            if (child.tagName === 'SOURCE' && child.src) return true;
        }
        return false;
    };

    const bindToVideoElements = () => {
        const videos = Array.from(document.getElementsByTagName('video'));
        for (const host of shadowRootHosts) {
            if (!host.shadowRoot) continue;
            host.shadowRoot.querySelectorAll('video').forEach(v => videos.push(v));
        }
        for (const video of videos) {
            if (!hasValidVideoSource(video)) continue;
            const existing = bindings.some(b => b.video === video);
            if (!existing) {
                log('Binding video', video.currentSrc || video.src);
                bindings.push(new Binding(video));
            }
        }
    };

    function start() {
        log('Starting detection');
        bindToVideoElements();
        setInterval(bindToVideoElements, 1000);
        if (pageConfig && pageConfig.searchShadowRoots) {
            setInterval(incrementallyFindShadowRoots, 100);
        }
    }
})();
