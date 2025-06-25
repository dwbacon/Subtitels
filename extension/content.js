// Utility functions to mimic Tampermonkey GM_* APIs
function GM_addStyle(css) {
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

function GM_getValue(key, defaultValue) {
  return new Promise(resolve => {
    chrome.storage.local.get([key], result => {
      if (chrome.runtime.lastError) {
        resolve(defaultValue);
      } else {
        resolve(result[key] !== undefined ? result[key] : defaultValue);
      }
    });
  });
}

function GM_setValue(key, value) {
  chrome.storage.local.set({ [key]: value });
}

const version = chrome.runtime.getManifest().version;
const unsafeWindow = window;

(async function() {
    'use strict';

    // --- Global State ---
    const state = {
        subtitles: [], currentSubtitleIndex: -1, calculatedOffset: 0,
        manualOffset: 0, offset: 0,
        fontSizeValue: 22,
        minimized: false, isEmbedded: window.self !== window.top,
        videoElement: null, videoContainer: null, subtitleCheckInterval: null,
        lastProcessedTime: -1, iframeWindow: null, currentVideoTime: 0,
        logElement: null, controller: null,
        currentPage: 'import',
        subtitleTextColor: '#FFFFFF',
        subtitleBackgroundColor: '#000000',
        subtitleBackgroundOpacity: 0.7,
        darkMode: false,
        verticalPosition: 15,
        outlineSize: 1,
        advancedSettingsOpen: false,
        rawSubtitleContent: null, detectedEpisode: null, detectedAnimeName: null,
        subtitleFiles: {}, loadedSubtitleFilename: 'N/A',
        loadedSubtitleFileOriginalOffset: null,
        syncPointSelectionModal: null, nativeSubtitles: {}, syncPointsDisplayModal: null,
        syncPoints: [],
        savedAnimeData: {},
        activeSavedAnimeKey: null,
        activeImportId: null,
        ignorePageDetection: false,
        savedPageEditMode: false, editingTarget: null,
        expandedAnimeInSaved: null,
        expandedImportInSaved: null,
        controllerLastWidth: '380px',
        controllerLastHeight: 'auto',
        filesDisplayModal: null,
    };

    async function loadStoredState() {
        const keys = [
            'manualSubtitleOffset','subtitleFontSize','minimized','migakuLastActiveTab',
            'subtitleTextColor','subtitleBackgroundColor','subtitleBackgroundOpacity','darkMode',
            'verticalPosition','outlineSize','advancedSettingsOpen','syncPoints',
            'migakuSavedSubtitles','migakuActiveSavedAnime','migakuActiveImportId',
            'migakuIgnorePageDetection','migakuExpandedAnimeInSaved','migakuExpandedImportInSaved',
            'migakuControllerWidth','migakuControllerHeight'
        ];
        const result = await new Promise(r => chrome.storage.local.get(keys, r));
        state.manualOffset = parseFloat(result.manualSubtitleOffset ?? 0);
        state.fontSizeValue = parseInt(result.subtitleFontSize ?? 22);
        state.minimized = result.minimized ?? false;
        state.currentPage = result.migakuLastActiveTab ?? 'import';
        state.subtitleTextColor = result.subtitleTextColor ?? '#FFFFFF';
        state.subtitleBackgroundColor = result.subtitleBackgroundColor ?? '#000000';
        state.subtitleBackgroundOpacity = parseFloat(result.subtitleBackgroundOpacity ?? 0.7);
        state.darkMode = result.darkMode ?? false;
        state.verticalPosition = parseInt(result.verticalPosition ?? 15);
        state.outlineSize = parseFloat(result.outlineSize ?? 1);
        state.advancedSettingsOpen = result.advancedSettingsOpen ?? false;
        try { state.syncPoints = JSON.parse(result.syncPoints ?? '[]'); } catch(e){ state.syncPoints = []; }
        try { state.savedAnimeData = JSON.parse(result.migakuSavedSubtitles ?? '{}'); } catch(e){ state.savedAnimeData = {}; }
        state.activeSavedAnimeKey = result.migakuActiveSavedAnime ?? null;
        state.activeImportId = result.migakuActiveImportId ?? null;
        state.ignorePageDetection = result.migakuIgnorePageDetection ?? false;
        state.expandedAnimeInSaved = result.migakuExpandedAnimeInSaved ?? null;
        state.expandedImportInSaved = result.migakuExpandedImportInSaved ?? null;
        state.controllerLastWidth = result.migakuControllerWidth ?? '380px';
        state.controllerLastHeight = result.migakuControllerHeight ?? 'auto';
    }

    function calculateAverageOffset(points) {
        if (!points || points.length === 0) return 0;
        const sum = points.reduce((acc, p) => acc + (p.videoTime - p.subtitleTime), 0);
        return parseFloat((sum / points.length).toFixed(1));
    }

    // Values depending on stored data will be set in initialize()

    const errorBar = {
        element: null, messageElement: null, dismissButton: null,
        init: function() {
            this.element = document.getElementById('migaku-error-bar');
            this.messageElement = document.getElementById('migaku-error-message');
            this.dismissButton = document.getElementById('migaku-dismiss-error');
            if (this.dismissButton) this.dismissButton.addEventListener('click', () => this.hide());
            this.toggleDarkMode(state.darkMode);
        },
        show: function(message) {
            if (this.element && this.messageElement) {
                this.messageElement.textContent = message; this.element.style.display = 'block';
                logToPopup(`ERROR UI: ${message}`);
            } else { alert(message); console.error("ErrorBar UI not ready:", message); }
        },
        hide: function() { if (this.element) this.element.style.display = 'none'; },
        toggleDarkMode: function(isDark) {
            if (this.element) { isDark ? this.element.classList.add('dark-mode') : this.element.classList.remove('dark-mode'); }
        }
    };

    // --- Styles ---
    GM_addStyle(`
        /* Error Bar Styles */
        #migaku-error-bar { background-color: #f44336; color: white; padding: 10px; margin-bottom: 10px; border-radius: 4px; position: relative; font-size: 13px; line-height: 1.4; display: none; box-sizing: border-box; }
        #migaku-controller.dark-mode #migaku-error-bar { background-color: #c62828; color: #E5E5EA; }
        #migaku-error-message { margin-right: 25px; display: block; }
        #migaku-dismiss-error { position: absolute; top: 50%; right: 10px; transform: translateY(-50%); background: none !important; border: none !important; color: white !important; font-size: 20px !important; cursor: pointer; padding: 0 5px !important; line-height: 1 !important; margin: 0 !important; min-width: auto !important; }
        #migaku-controller.dark-mode #migaku-dismiss-error { color: #E5E5EA !important; }

        /* Controller styles */
        #migaku-controller { position: fixed; bottom: 10px; right: 10px; background-color: #F5F5F7; color: #1D1D1F; padding: 15px; border-radius: 8px; z-index: 10001; width: 380px; max-height: 90vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); transition: width 0.2s ease, height 0.2s ease, background-color 0.2s ease, color 0.2s ease; resize: both; overflow: hidden; min-width: 280px; min-height: 180px; display: flex; flex-direction: column; border: 1px solid #D1D1D6; }
        #migaku-controller.dark-mode { background-color: #1C1C1E; color: #E5E5EA; border-color: #3A3A3C; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5); }
        #migaku-controller.dark-mode h3, #migaku-controller.dark-mode label { color: #D1D1D6; }
        #migaku-controller.dark-mode .controller-nav button { color: #bbb; }
        #migaku-controller.dark-mode .controller-nav button:hover { color: #E5E5EA; }
        #migaku-controller.dark-mode .controller-nav button.active { color: #4CAF50; border-bottom-color: #4CAF50; }
        #migaku-controller.dark-mode input[type="file"], #migaku-controller.dark-mode input[type="range"], #migaku-controller.dark-mode input[type="number"], #migaku-controller.dark-mode input[type="color"], #migaku-controller.dark-mode select { background-color: #2C2C2E; border-color: #3A3A3C; color: #E5E5EA; }
        #migaku-controller.dark-mode .sync-value, #migaku-controller.dark-mode .font-size-value { color: #E5E5EA; }
        #migaku-controller.dark-mode .log-area { background-color: #2C2C2E; border-top-color: #3A3A3C; color: #bbb; }
        #migaku-controller.dark-mode .log-area strong { color: #E5E5EA; }
        #migaku-controller.dark-mode .settings-row label { color: #D1D1D6; }
        #migaku-controller.dark-mode .settings-row span { color: #bbb; }
        #migaku-controller.dark-mode #page-about h4 { color: #D1D1D6; }
        #migaku-controller.dark-mode #page-about p { color: #bbb; }
        #migaku-controller.dark-mode #page-about a { color: #66bb6a; }
        #migaku-controller.dark-mode .advanced-settings-header { color: #D1D1D6; }
        #migaku-controller.dark-mode .advanced-settings-header button { color: #bbb; }
        #migaku-controller.minimized { min-width: 50px !important; min-height: 30px !important; width: 50px !important; height: 30px !important; overflow: hidden !important; resize: none; padding: 5px; }
        #migaku-controller.minimized .controller-content, #migaku-controller.minimized .log-area, #migaku-controller.minimized .controller-nav, #migaku-controller.minimized #migaku-error-bar, #migaku-controller.minimized h3 { display: none; }
        #migaku-toggle-btn { position: absolute; top: 12px; right: 12px; background: none; border: none; color: inherit; font-size: 18px; cursor: pointer; padding: 0; margin: 0; width: 20px; height: 20px; line-height: 20px; text-align: center; z-index: 1; }
        #migaku-controller h3 { padding-right: 35px; margin-top: 0; margin-bottom: 10px; font-size: 18px; color: #3A3A3C; }
        .controller-nav { display: flex; justify-content: space-around; margin-bottom: 15px; border-bottom: 1px solid #E5E5EA; padding-bottom: 8px; }
        #migaku-controller.dark-mode .controller-nav { border-bottom-color: #3A3A3C; }
        .controller-nav button { background: none; border: none; color: #3A3A3C; cursor: pointer; font-size: 13px; padding: 5px 6px; transition: color 0.2s ease, border-bottom-color 0.2s ease; flex-grow: 1; text-align: center; white-space: nowrap; }
        .controller-nav button:hover { color: #000; }
        .controller-nav button.active { color: #4CAF50; border-bottom: 2px solid #4CAF50; }
        .controller-content { flex-grow: 1; overflow-y: auto; padding-right: 5px; padding-bottom: 15px; box-sizing: border-box; overflow-x: hidden; }
        .controller-page { display: none; padding-bottom: 10px; }
        .controller-page.active { display: block; }
        .controller-row { margin-bottom: 12px; display: flex; align-items: center; flex-wrap: wrap; width: 100%; box-sizing: border-box; }
        .controller-row label { flex-basis: 120px; margin-right: 10px; flex-shrink: 0; }
        .controller-row input[type="file"] { flex-grow: 1; min-width: 150px; }
        .controller-row button { flex-shrink: 0; margin-top: 5px; }
        .controller-row .button-group { display: flex; gap: 8px; flex-wrap: wrap; }
        #migaku-controller label { display: block; margin-bottom: 6px; font-size: 14px; color: #444; }
        #migaku-controller button { background-color: #4CAF50; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; font-size: 13px; transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease; border: 1px solid transparent; }
        #migaku-controller button:hover { background-color: #45a049; color: white; border-color: transparent; }
        #migaku-controller.dark-mode button { background-color: #2C2C2E; color: #E5E5EA; border-color: #3A3A3C; }
        #migaku-controller.dark-mode button:hover { background-color: #3A3A3C; color: #fff; border-color: #66bb6a; }
        #migaku-controller #clear-subtitles, #migaku-controller #clear-sync-points, #page-saved .delete-anime-btn, #page-saved .delete-import-btn, #page-saved .delete-file-btn { background-color: #f44336 !important; }
        #migaku-controller #clear-subtitles:hover, #migaku-controller #clear-sync-points:hover, #page-saved .delete-anime-btn:hover, #page-saved .delete-import-btn:hover, #page-saved .delete-file-btn:hover { background-color: #d32f2f !important; }
        #migaku-controller.dark-mode #clear-subtitles, #migaku-controller.dark-mode #clear-sync-points, #migaku-controller.dark-mode #page-saved .delete-anime-btn, #migaku-controller.dark-mode #page-saved .delete-import-btn, #migaku-controller.dark-mode #page-saved .delete-file-btn { background-color: #5a2d2d !important; border-color: #795548 !important; }
        #migaku-controller.dark-mode #clear-subtitles:hover, #migaku-controller.dark-mode #clear-sync-points:hover, #migaku-controller.dark-mode #page-saved .delete-anime-btn:hover, #migaku-controller.dark-mode #page-saved .delete-import-btn:hover, #migaku-controller.dark-mode #page-saved .delete-file-btn:hover { background-color: #795548 !important; border-color: #f44336 !important; }
        #migaku-controller input[type="file"] { width: 100%; margin-bottom: 8px; font-size: 12px; box-sizing: border-box; border: 1px solid #D1D1D6; border-radius: 3px; padding: 6px; background-color: #F2F2F7; }
        .sync-value, .font-size-value { display: inline-block; width: 35px; text-align: right; font-weight: bold; color: #1D1D1F; flex-shrink: 0; margin-left: auto; }
        #migaku-controller.dark-mode .sync-value, #migaku-controller.dark-mode .font-size-value { color: #E5E5EA; }
        #subtitle-font-size, #vertical-position, #manual-sync-offset, #subtitle-background-opacity { width: calc(100% - 50px); vertical-align: middle; -webkit-appearance: none; appearance: none; height: 6px; background: #D1D1D6; outline: none; opacity: 0.9; transition: opacity .2s; border-radius: 3px; flex-grow: 1; }
        #migaku-controller.dark-mode #subtitle-font-size, #migaku-controller.dark-mode #vertical-position, #migaku-controller.dark-mode #manual-sync-offset, #migaku-controller.dark-mode #subtitle-background-opacity { background: #3A3A3C; }
        #migaku-controller input[type="range"]:hover { opacity: 1; }
        #migaku-controller input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; background: #4CAF50; cursor: pointer; border-radius: 50%; transition: background-color 0.2s ease; }
        #migaku-controller input[type="range"]::-webkit-slider-thumb:hover { background-color: #388E3C; }
        #migaku-controller input[type="range"]::-moz-range-thumb { width: 14px; height: 14px; background: #4CAF50; cursor: pointer; border-radius: 50%; transition: background-color 0.2s ease; }
        #migaku-controller input[type="range"]::-moz-range-thumb:hover { background-color: #388E3C; }
        .log-area { margin-top: 15px; padding-top: 10px; border-top: 1px solid #E5E5EA; font-size: 10px; height: 120px; overflow-y: auto; color: #3A3A3C; white-space: pre-wrap; word-break: break-all; background-color: #F2F2F7; padding: 10px; border-radius: 4px; box-sizing: border-box; }
        #migaku-controller.dark-mode .log-area { border-top-color: #3A3A3C; background-color: #2C2C2E; color: #bbb; }
        .log-area strong { color: #1D1D1F; }
        #migaku-controller.dark-mode .log-area strong { color: #E5E5EA; }
        .settings-row { margin-bottom: 12px; display: flex; align-items: center; width: 100%; box-sizing: border-box; }
        .settings-row label { display: inline-block; width: 120px; margin-right: 10px; font-size: 14px; color: #444; flex-shrink: 0; }
        #migaku-controller.dark-mode .settings-row label { color: #D1D1D6; }
        .settings-row input[type="color"], .settings-row input[type="number"], .settings-row input[type="range"], .settings-row input[type="checkbox"], .settings-row select { vertical-align: middle; height: 28px; padding: 4px; border: 1px solid #D1D1D6; border-radius: 4px; background-color: #F2F2F7; flex-grow: 1; }
        #migaku-controller.dark-mode input[type="color"], #migaku-controller.dark-mode input[type="number"], #migaku-controller.dark-mode input[type="range"], #migaku-controller.dark-mode select { background-color: #2C2C2E; border-color: #3A3A3C; color: #E5E5EA; }
        .settings-row input[type="number"] { width: 70px; flex-grow: 0; }
        .settings-row input[type="checkbox"]#dark-mode-toggle, .settings-row input[type="checkbox"]#ignore-page-detection-toggle { flex-grow: 0; width: auto; height: auto; padding: 0; margin: 0 5px 0 0; border: none; background: none; appearance: checkbox; -webkit-appearance: checkbox; vertical-align: middle;}
        .settings-row input[type="range"] { padding: 0; }
        .settings-row span { margin-left: 8px; font-size: 13px; color: #3A3A3C; flex-grow: 1; word-break: break-word; }
        #migaku-controller.dark-mode .settings-row span { color: #bbb; }
        #page-about h4 { margin-top: 0; margin-bottom: 10px; color: #3A3A3C; }
        #migaku-controller.dark-mode #page-about h4 { color: #D1D1D6; }
        #page-about p { margin-bottom: 8px; font-size: 13px; line-height: 1.4; color: #444; }
        #migaku-controller.dark-mode #page-about p { color: #bbb; }
        #page-about a { color: #4CAF50; text-decoration: none; transition: color 0.2s ease; }
        #page-about a:hover { color: #388E3C; text-decoration: underline; }
        #migaku-controller.dark-mode #page-about a { color: #66bb6a; }
        .advanced-settings-header { margin-top: 15px; margin-bottom: 10px; font-size: 16px; font-weight: bold; cursor: pointer; color: #3A3A3C; display: flex; align-items: center; }
        #migaku-controller.dark-mode .advanced-settings-header { color: #D1D1D6; }
        .advanced-settings-header button { background: none; border: none; font-size: 18px; margin-left: 5px; padding: 0; cursor: pointer; color: #3A3A3C; }
        #migaku-controller.dark-mode .advanced-settings-header button { color: #bbb; }
        .advanced-settings-content { display: none; padding-left: 10px; border-left: 2px solid #E5E5EA; padding-top: 5px; }
        #migaku-controller.dark-mode .advanced-settings-content { border-left-color: #3A3A3C; }
        .advanced-settings-content.active { display: block; }
        #subtitle-file-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.8); z-index: 10002; display: none; justify-content: center; align-items: center; }
        #subtitle-file-modal-content { background-color: #fff; padding: 20px; border-radius: 8px; max-width: 80%; max-height: 80%; overflow: auto; position: relative; }
        #migaku-controller.dark-mode #subtitle-file-modal-content { background-color: #2C2C2E; color: #E5E5EA; }
        #subtitle-file-modal-content pre { white-space: pre-wrap; word-break: break-all; font-size: 12px; color: #1D1D1F; }
        #migaku-controller.dark-mode #subtitle-file-modal-content pre { color: #E5E5EA; }
        #subtitle-file-modal-close { position: absolute; top: 10px; right: 10px; font-size: 20px; cursor: pointer; color: #1D1D1F; }
        #migaku-controller.dark-mode #subtitle-file-modal-close { color: #E5E5EA; }
        #sync-point-selection-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.7); z-index: 10003; display: none; justify-content: center; align-items: center; }
        #sync-point-selection-content { background-color: #fff; padding: 20px; border-radius: 8px; max-width: 90%; max-height: 90%; overflow-y: auto; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        #migaku-controller.dark-mode #sync-point-selection-content { background-color: #2C2C2E; color: #E5E5EA; }
        #sync-point-selection-content h4 { margin-top: 0; margin-bottom: 15px; color: #3A3A3C; font-size: 16px; }
        #migaku-controller.dark-mode #sync-point-selection-content h4 { color: #D1D1D6; }
        #sync-point-selection-list div { padding: 8px; margin-bottom: 5px; border: 1px solid #E5E5EA; border-radius: 4px; cursor: pointer; transition: background-color 0.2s ease; font-size: 13px; line-height: 1.4; color: #1D1D1F; white-space: pre-wrap; word-break: break-word; }
        #migaku-controller.dark-mode #sync-point-selection-list div { border-color: #3A3A3C; color: #bbb; }
        #sync-point-selection-list div:hover { background-color: #D1D1D6; }
        #migaku-controller.dark-mode #sync-point-selection-list div:hover { background-color: #3A3A3C; }
        #sync-point-selection-close { position: absolute; top: 10px; right: 10px; font-size: 20px; cursor: pointer; color: #1D1D1F; }
        #migaku-controller.dark-mode #sync-point-selection-close { color: #E5E5EA; }
        #migaku-subtitle-display-wrapper { position: fixed; left: 0; right: 0; display: flex; justify-content: center; align-items: center; pointer-events: none; z-index: 10000; text-align: center; width: 100%; height: auto; box-sizing: border-box; top: auto; bottom: 15%; }
        #migaku-subtitle-display-wrapper .migaku-subtitle-text { display: inline-block; background-color: rgba(0,0,0,0.7); color: white; padding: 10px 15px; border-radius: 5px; max-width: 80%; text-align: center; font-size: ${state.fontSizeValue}px; font-family: inherit; text-shadow: 1px 1px 1px rgba(0,0,0,0.8); pointer-events: auto; white-space: pre-line; line-height: 1.4; box-shadow: 0 2px 5px rgba(0,0,0,0.5); word-wrap: break-word; }
        .native-subtitle-hint { font-style: italic; color: #888; margin-bottom: 10px; font-size: 12px; }
        #migaku-controller.dark-mode .native-subtitle-hint { color: #bbb; }
        #sync-points-display-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.7); z-index: 10004; display: none; justify-content: center; align-items: center; }
        #sync-points-display-content { background-color: #fff; padding: 20px; border-radius: 8px; max-width: 90%; max-height: 90%; overflow-y: auto; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        #migaku-controller.dark-mode #sync-points-display-content { background-color: #2C2C2E; color: #E5E5EA; }
        #sync-points-display-content h4 { margin-top: 0; margin-bottom: 15px; color: #3A3A3C; font-size: 16px; }
        #migaku-controller.dark-mode #sync-points-display-content h4 { color: #D1D1D6; }
        #sync-points-list-display div { padding: 8px; margin-bottom: 5px; border: 1px solid #E5E5EA; border-radius: 4px; font-size: 13px; line-height: 1.4; color: #1D1D1F; white-space: pre-wrap; word-break: break-word; display: flex; justify-content: space-between; align-items: center; }
        #migaku-controller.dark-mode #sync-points-list-display div { border-color: #3A3A3C; color: #bbb; }
        #sync-points-list-display div button { background-color: #f44336; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; flex-shrink: 0; }
        #migaku-controller.dark-mode #sync-points-list-display div button { background-color: #5a2d2d; border-color: #795548; }
        #sync-points-list-display div button:hover { background-color: #d32f2f; }
        #migaku-controller.dark-mode #sync-points-list-display div button:hover { background-color: #795548; border-color: #f44336; }
        #sync-points-display-close { position: absolute; top: 10px; right: 10px; font-size: 20px; cursor: pointer; color: #1D1D1F; }
        #migaku-controller.dark-mode #sync-points-display-close { color: #E5E5EA; }

        /* Saved Page - New Layout & Button Size Fix */
        #page-saved { display: flex; flex-direction: column; height: 100%; }
        .saved-page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-shrink: 0; }
        .saved-columns-container { display: flex; flex-grow: 1; overflow: hidden; gap: 10px;}
        #saved-anime-column { width: 40%; overflow-y: auto; border-right: 1px solid #D1D1D6; padding-right: 10px; box-sizing: border-box; }
        #saved-imports-column { width: 60%; overflow-y: auto; box-sizing: border-box; }
        #migaku-controller.dark-mode #saved-anime-column { border-right-color: #3A3A3C; }
        #page-saved .anime-list-item, #page-saved .import-session-item { padding: 6px 8px; margin-bottom: 5px; border: 1px solid #E5E5EA; border-radius: 4px; cursor: pointer; transition: background-color 0.2s ease; position: relative; display: flex; align-items: center; }
        #migaku-controller.dark-mode #page-saved .anime-list-item, #migaku-controller.dark-mode #page-saved .import-session-item { border-color: #3A3A3C; }
        #page-saved .anime-list-item:hover, #page-saved .import-session-item:hover { background-color: #E5E5EA; }
        #migaku-controller.dark-mode #page-saved .anime-list-item:hover, #migaku-controller.dark-mode #page-saved .import-session-item:hover { background-color: #48484A; }
        #page-saved .anime-list-item.active-selection, #page-saved .import-session-item.active-selection { background-color: #d1e7dd; border-left: 3px solid #4CAF50; padding-left: 5px; }
        #migaku-controller.dark-mode #page-saved .anime-list-item.active-selection, #migaku-controller.dark-mode #page-saved .import-session-item.active-selection { background-color: #3e5247; border-left-color: #66bb6a; }
        #page-saved h4, #page-saved h5 { margin-bottom: 10px; }
        #page-saved .list-item-content { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 5px; cursor: pointer; }
        #page-saved .import-session-details { font-size: 0.85em; color: #777; display: block; line-height: 1.2; }
        #migaku-controller.dark-mode #page-saved .import-session-details { color: #aaa; }
        #page-saved .list-item-actions { display: flex; align-items: center; flex-shrink: 0; }
        #page-saved .action-btn { padding: 3px 5px !important; font-size: 12px !important; line-height: 1 !important; min-width: auto !important; margin-left: 4px !important; border-radius: 3px !important; }
        /* Delete buttons use general delete styles. Edit/View use specific */
        #page-saved .edit-icon { background-color: #ffc107 !important; color: black !important; }
        #migaku-controller.dark-mode #page-saved .edit-icon { background-color: #ffa000 !important; }
        #page-saved .view-files-btn { background-color: #03a9f4 !important; color: white !important; }
        #migaku-controller.dark-mode #page-saved .view-files-btn { background-color: #0277bd !important; }
        #no-saved-anime-message { text-align: center; margin-top: 20px; color: #777; }
        #migaku-controller.dark-mode #no-saved-anime-message { color: #aaa; }
        #page-saved .edit-input { width: 100%; padding: 4px; font-size: inherit; background-color: inherit; color: inherit; border: 1px solid #888; border-radius:3px; box-sizing:border-box; margin-top:2px; }
        #migaku-controller.dark-mode #page-saved .edit-input { border-color: #666; background-color: #3A3A3C; }
        #saved-page-edit-toggle { margin-left: auto; font-size: 12px !important; padding: 4px 8px !important;}

        /* Files Display Modal */
        #files-display-modal { position: fixed; top:0; left:0; width:100%; height:100%; background-color: rgba(0,0,0,0.75); z-index: 10005; display:none; justify-content:center; align-items:center; }
        #files-display-modal-content { background-color: #fff; padding: 20px; border-radius:8px; max-width: 700px; width:90%; max-height: 80vh; display:flex; flex-direction:column; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
        #migaku-controller.dark-mode #files-display-modal-content { background-color: #1C1C1E; color: #E5E5EA; border: 1px solid #3A3A3C; }
        #files-display-modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom: 1px solid #E5E5EA; padding-bottom:10px;}
        #migaku-controller.dark-mode #files-display-modal-header { border-bottom-color: #3A3A3C; }
        #files-display-modal-title { font-size: 1.2em; margin:0; }
        #files-display-modal-close { font-size:1.5em; cursor:pointer; background:none; border:none; color:inherit; padding:0 5px; }
        #files-list-in-modal { flex-grow:1; overflow-y:auto; border: 1px solid #D1D1D6; padding: 10px; border-radius: 4px; background-color: #F2F2F7;}
        #migaku-controller.dark-mode #files-list-in-modal { border-color: #3A3A3C; background-color: #1C1C1E; }
        #files-list-in-modal .file-item { display:flex; justify-content:space-between; align-items:center; padding: 8px 6px; border-bottom: 1px solid #E5E5EA; }
        #migaku-controller.dark-mode #files-list-in-modal .file-item { border-bottom-color: #444; }
        #files-list-in-modal .file-item:last-child { border-bottom: none; }
        #files-list-in-modal .file-item-name { flex-grow:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-right:10px; font-size: 0.95em; }
        #files-list-in-modal .file-item-details { font-size:0.8em; color:#3A3A3C; margin-right:10px; white-space:nowrap; }
        #migaku-controller.dark-mode #files-list-in-modal .file-item-details { color:#bbb; }
        #files-list-in-modal .file-item-actions { display: flex; align-items: center; } /* Ensure buttons in actions div are aligned */
        #files-list-in-modal .file-item-actions button { margin-left: 5px; padding: 4px 8px !important; font-size: 11px !important; }
        #files-list-in-modal .file-item.active-playing { background-color: #e6ffed !important; border-left: 3px solid #4CAF50; padding-left: 3px;}
        #migaku-controller.dark-mode #files-list-in-modal .file-item.active-playing { background-color: #2a4031 !important; border-left-color: #66bb6a;}
    `);

    // --- Cross-Window Communication ---
    window.addEventListener('message', handleMessage);
    window.addEventListener('beforeunload', () => {
        window.removeEventListener('message', handleMessage);
        document.removeEventListener('fullscreenchange', handleFullscreenChangeTop);
        document.removeEventListener('webkitfullscreenchange', handleFullscreenChangeTop);
    });
    function handleMessage(event) {
        const message = event.data;
        if (message.source !== 'migaku-subtitle-importer') return;
        if (!state.isEmbedded) { // Top window
            switch (message.command) {
                case 'statusUpdate': updateStatus(message.text); break;
                case 'videoFound': logToPopup('Video found in iframe. Ready.'); state.iframeWindow = event.source; updateStatus('Video found in iframe. Ready.'); break;
                case 'log': logToPopup(`[Iframe] ${message.text}`); break;
                 case 'currentTimeUpdate':
                     state.currentVideoTime = message.currentTime;
                     const videoTimeElement = document.getElementById('current-video-time');
                     if (videoTimeElement) videoTimeElement.textContent = state.currentVideoTime.toFixed(1);
                     updateSubtitleDisplay();
                     if (Math.floor(state.currentVideoTime * 2) !== Math.floor(state.lastProcessedTime * 2) || state.lastProcessedTime === -1) {
                          updateStatus(`Playing... (${state.currentVideoTime.toFixed(1)}s)`);
                          state.lastProcessedTime = state.currentVideoTime;
                     }
                     break;
                 case 'iframeReady': logToPopup('Iframe script is ready.'); break;
                 case 'fullscreenChange': logToPopup(`Iframe fullscreen: ${message.isFullscreen}`); updateSubtitleDisplay(); break;
                 case 'nativeCues': logToPopup(`Native cues for "${message.trackLabel}": ${message.cues.length}`); state.nativeSubtitles[message.trackLabel] = message.cues; break;
            }
        } else { // Iframe
            switch (message.command) {
                case 'loadSubtitles': console.log(`[Iframe] Load: "${message.filename}".`); break;
                case 'clearSubtitles': console.log('[Iframe] Clear.'); clearSubtitlesIframe(); break;
                case 'updateSettings': console.log('[Iframe] Settings update (ignored).'); break;
                 case 'handshake': console.log('[Iframe] Handshake received.'); if (state.videoElement) { sendMessage('videoFound'); sendMessage('statusUpdate', { text: 'Video found. Ready.' }); } sendMessage('iframeReady'); break;
            }
        }
    }
    function sendMessage(command, data = {}) { const message = { source: 'migaku-subtitle-importer', command, ...data }; if (!state.isEmbedded && state.iframeWindow) state.iframeWindow.postMessage(message, '*'); else if (state.isEmbedded && window.top) window.top.postMessage(message, '*'); }
    function logToPopup(message) { if (state.isEmbedded) return; if (!state.logElement && state.controller) state.logElement = state.controller.querySelector('.log-area'); if (state.logElement) { const entry = document.createElement('div'); entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`; state.logElement.appendChild(entry); state.logElement.scrollTop = state.logElement.scrollHeight; } console.log(message); }

    // --- Controller UI Initialization & Structure ---
    function initializeController() {
        if (state.isEmbedded) return;
        state.controller = document.createElement('div'); state.controller.id = 'migaku-controller';
        if (state.minimized) { state.controller.classList.add('minimized');}
        else {
            state.controller.style.width = state.controllerLastWidth && state.controllerLastWidth !== 'auto' ? state.controllerLastWidth : '380px';
            state.controller.style.height = state.controllerLastHeight && state.controllerLastHeight !== 'auto' ? '' : state.controllerLastHeight;
        }
        if (state.darkMode) state.controller.classList.add('dark-mode');
        state.controller.innerHTML = controllerShellHTML();
        document.body.appendChild(state.controller);
        errorBar.init();
        setupCommonEventListeners();
        createModalsAndListeners();
        applySubtitleAppearanceSettings(); applyVerticalPosition(); applyOutlineSize();
        updateSyncPointsDisplay(); updateActiveSavedDisplay();
        showPage(state.currentPage);
        logToPopup('Controller UI fully initialized.');
    }
    function controllerShellHTML() {
        return `
            <button id="migaku-toggle-btn">✕</button> <h3>Migaku Subtitle Control</h3>
            <div id="migaku-error-bar" style="display: none;"><span id="migaku-error-message"></span><button id="migaku-dismiss-error">&times;</button></div>
            <div class="controller-nav">
                <button data-page="import">Import</button> <button data-page="saved">Saved</button>
                <button data-page="sync">Sync</button> <button data-page="settings">Settings</button>
                <button data-page="about">About</button>
            </div>
            <div class="controller-content"></div>`;
    }
    function importPageHTML() {
        return `<div class="controller-row"><label for="subtitle-folder-import">Import Folder:</label><input type="file" id="subtitle-folder-import" webkitdirectory directory multiple accept=".srt,.vtt,.ass,.ssa"></div>
                <div class="controller-row"><label for="subtitle-file-import">Import File(s):</label><input type="file" id="subtitle-file-import" multiple accept=".srt,.vtt,.ass,.ssa"></div>
                <div class="controller-row button-group"><button id="clear-subtitles">Clear Current Display</button></div>
                <div class="controller-row"><a href="https://kitsunekko.net/dirlist.php?dir=subtitles%2Fjapanese%2F" target="_blank" rel="noopener noreferrer" style="color: #4CAF50; text-decoration: none; font-size: 13px;">Kitsunekko Subs</a></div>
                <div class="controller-row" id="status-row" style="display:none;"><div id="subtitle-status" style="font-size: 12px; margin-top: 10px; color: inherit;">Loading...</div></div>`;
    }
    function savedPageHTML() {
        return `<div class="saved-page-header">
                    <h4>Saved Anime Subtitles</h4>
                    <button id="saved-page-edit-toggle">${state.savedPageEditMode ? "View Mode" : "Edit Mode"}</button>
                </div>
                <div class="saved-columns-container">
                    <div id="saved-anime-column"></div>
                    <div id="saved-imports-column">
                        <p style="text-align:center; color:#777; margin-top:20px;">Select an anime to see its imports.</p>
                    </div>
                </div>
                <div id="no-saved-anime-message" style="display: none; text-align:center; margin-top:20px;">No subtitles saved yet. Use the "Import" tab.</div>`;
    }
    function syncPageHTML() {
        return `<h4>Sync Controls</h4>
            <div class="controller-row button-group"><button id="mark-sync-point">Mark</button><button id="clear-sync-points">Clear All Points</button><button id="show-sync-points">Show Points</button></div>
            <div class="controller-row"><label>Points Count:</label><span id="sync-points-count">${state.syncPoints.length}</span></div>
            <div class="controller-row"><label>Calc Offset (from points):</label><span id="calculated-sync-value" class="sync-value">${state.calculatedOffset.toFixed(1)}s</span></div>
            <div class="controller-row"><label>Manual Fine-Tune:<span id="manual-sync-value" class="sync-value">${state.manualOffset.toFixed(1)}s</span></label><input type="range" id="manual-sync-offset" min="-10" max="10" step="0.1" value="${state.manualOffset}"></div>
            <div class="controller-row"><label>Effective Offset:</label><span id="effective-offset-value" class="sync-value">${state.offset.toFixed(1)}s</span></div>
            <div class="controller-row button-group" style="margin-top:15px; flex-direction:column; align-items:flex-start; gap:5px;">
                <button id="save-current-sync-to-file">Save Effective Offset to Loaded File</button>
                <button id="clear-saved-sync-for-file" style="background-color:#cc8000 !important;">Clear Saved Offset for Loaded File</button>
            </div>`;
    }
    function settingsPageHTML() {
        return `<h4>Appearance</h4>
            <div class="settings-row"><label for="dark-mode-toggle">Dark Mode:</label><input type="checkbox" id="dark-mode-toggle" ${state.darkMode?'checked':''}></div>
            <div class="settings-row"><label for="subtitle-font-size">Font Size:</label><input type="range" id="subtitle-font-size" min="12" max="36" step="1" value="${state.fontSizeValue}"><span id="font-size-value" class="font-size-value">${state.fontSizeValue}</span>px</div>
            <div class="settings-row"><label for="subtitle-text-color">Text Color:</label><input type="color" id="subtitle-text-color" value="${state.subtitleTextColor}"></div>
            <div class="settings-row"><label for="subtitle-background-color">BG Color:</label><input type="color" id="subtitle-background-color" value="${state.subtitleBackgroundColor}"></div>
            <div class="settings-row"><label for="subtitle-background-opacity">BG Opacity:</label><input type="range" id="subtitle-background-opacity" min="0" max="1" step="0.05" value="${state.subtitleBackgroundOpacity}"><span id="background-opacity-value">${state.subtitleBackgroundOpacity.toFixed(2)}</span></div>
            <div class="settings-row"><label for="vertical-position">Vertical Pos:</label><input type="range" id="vertical-position" min="0" max="100" step="1" value="${state.verticalPosition}"><span id="vertical-position-value">${state.verticalPosition}</span>%</div>
            <div class="settings-row"><label for="outline-size">Outline Size:</label><input type="number" id="outline-size" min="0" max="5" step="0.1" value="${state.outlineSize}"><span id="outline-size-value">${state.outlineSize.toFixed(1)}</span>px</div>
            <div class="advanced-settings-header" id="advanced-settings-header">Advanced <button id="toggle-advanced-settings">${state.advancedSettingsOpen?'▲':'▼'}</button></div>
            <div class="advanced-settings-content ${state.advancedSettingsOpen?'active':''}" id="advanced-settings-content">
                <div class="settings-row">
                    <label for="ignore-page-detection-toggle">Ignore Page Changes:</label>
                    <input type="checkbox" id="ignore-page-detection-toggle" ${state.ignorePageDetection?'checked':''}>
                    <button id="ignore-page-info-btn" class="action-btn file-info-btn" style="position:static; transform:none; margin-left:5px; padding: 1px 5px !important; font-size: 10px !important; background-color: #bbb !important;">ℹ</button>
                </div>
                <div class="settings-row" id="video-time-row" style="display:none;"><label>Video Time:</label><span id="current-video-time">0.0</span>s</div>
                <div class="settings-row"><label>Detected Anime:</label><span id="detected-anime-name">N/A</span></div>
                <div class="settings-row"><label>Detected Ep:</label><span id="detected-episode">N/A</span></div>
                <div class="settings-row"><label>Active Saved Anime:</label><span id="active-saved-anime-display">N/A</span></div>
                <div class="settings-row"><label>Active Import:</label><span id="active-import-display">N/A</span></div>
                <div class="settings-row">
                    <label for="manual-subtitle-select">Select File (Active Import):</label>
                    <select id="manual-subtitle-select" style="flex-grow: 1; margin-right: 8px;"></select>
                </div>
                <div class="settings-row" style="justify-content: flex-end;">
                    <button id="apply-manual-subtitle">Load Selected File</button>
                </div>
                <div class="settings-row"><label>Loaded Subtitle:</label><span id="loaded-subtitle-filename">N/A</span></div>
                <div class="settings-row"><button id="show-full-subtitles">Show Full Subtitle</button></div>
                <h4>Debug Log <button id="copy-log-button" style="padding:2px 5px;font-size:10px;margin-left:5px;">Copy</button></h4><div class="log-area"></div>
            </div>`;
    }
    function aboutPageHTML() { return `<h4>About</h4><p>Migaku Subtitle Importer (v${version})</p><p>Author: Derek</p><p>Manages local subtitle collections for Migaku.</p>`; }

    function setupCommonEventListeners() {
        document.getElementById('migaku-toggle-btn').addEventListener('click', toggleMinimize);
        state.controller.querySelectorAll('.controller-nav button').forEach(b => b.addEventListener('click', handleNavigationClick));
    }
    function setupImportPageListeners() { document.getElementById('subtitle-folder-import')?.addEventListener('change',(e)=>handleSubtitleImport(e,'folder')); document.getElementById('subtitle-file-import')?.addEventListener('change',(e)=>handleSubtitleImport(e,'files')); document.getElementById('clear-subtitles')?.addEventListener('click',clearCurrentSubtitlesOnly); }
    function setupSavedPageListeners() { document.getElementById('saved-page-edit-toggle')?.addEventListener('click',toggleSavedPageEditMode); renderSavedAnimeList(); }
    function setupSyncPageListeners() { document.getElementById('mark-sync-point')?.addEventListener('click',markSyncPoint); document.getElementById('clear-sync-points')?.addEventListener('click',clearSyncPoints); document.getElementById('show-sync-points')?.addEventListener('click',showSyncPointsDisplayModal); document.getElementById('manual-sync-offset')?.addEventListener('input',adjustManualSyncOffset); document.getElementById('save-current-sync-to-file')?.addEventListener('click',saveCurrentSyncToFileHandler); document.getElementById('clear-saved-sync-for-file')?.addEventListener('click',clearSavedSyncForFileHandler); }
    function setupSettingsPageListeners() { document.getElementById('dark-mode-toggle')?.addEventListener('change',toggleDarkMode); document.getElementById('subtitle-font-size')?.addEventListener('input',adjustFontSize); document.getElementById('subtitle-text-color')?.addEventListener('input',adjustSubtitleAppearance); document.getElementById('subtitle-background-color')?.addEventListener('input',adjustSubtitleAppearance); document.getElementById('subtitle-background-opacity')?.addEventListener('input',adjustSubtitleAppearance); document.getElementById('vertical-position')?.addEventListener('input',adjustVerticalPosition); document.getElementById('outline-size')?.addEventListener('input',adjustOutlineSize); document.getElementById('toggle-advanced-settings')?.addEventListener('click',toggleAdvancedSettings); document.getElementById('apply-manual-subtitle')?.addEventListener('click',applyManualSubtitleSelection); document.getElementById('show-full-subtitles')?.addEventListener('click',showFullSubtitlesModal); document.getElementById('copy-log-button')?.addEventListener('click',copyLogToClipboard); document.getElementById('ignore-page-detection-toggle')?.addEventListener('change',toggleIgnorePageDetection); document.getElementById('ignore-page-info-btn')?.addEventListener('click',()=>{alert("When ON, page detection won't auto-switch subs.");}); if(!state.logElement)state.logElement=state.controller.querySelector('.log-area'); }

    function createModalsAndListeners() { const sw=document.createElement('div');sw.id='migaku-subtitle-display-wrapper';document.body.appendChild(sw);const sfm=document.createElement('div');sfm.id='subtitle-file-modal';sfm.innerHTML=`<div id="subtitle-file-modal-content"><span id="subtitle-file-modal-close">&times;</span><h4>Full Subtitle Content</h4><pre id="full-subtitle-text"></pre></div>`;document.body.appendChild(sfm);sfm.querySelector('#subtitle-file-modal-close').addEventListener('click',hideFullSubtitlesModal);sfm.addEventListener('click',(e)=>{if(e.target===sfm)hideFullSubtitlesModal();});state.syncPointSelectionModal=document.createElement('div');state.syncPointSelectionModal.id='sync-point-selection-modal';state.syncPointSelectionModal.innerHTML=`<div id="sync-point-selection-content"><span id="sync-point-selection-close">&times;</span><h4>Select Cue (Video: <span id="sync-modal-video-time"></span>s)</h4><div id="native-subtitle-hint" class="native-subtitle-hint" style="display:none;"></div><div id="sync-point-selection-list"></div></div>`;document.body.appendChild(state.syncPointSelectionModal);state.syncPointSelectionModal.querySelector('#sync-point-selection-close').addEventListener('click',hideSyncPointSelectionModal);state.syncPointSelectionModal.addEventListener('click',(e)=>{if(e.target===state.syncPointSelectionModal)hideSyncPointSelectionModal();});state.syncPointsDisplayModal=document.createElement('div');state.syncPointsDisplayModal.id='sync-points-display-modal';state.syncPointsDisplayModal.innerHTML=`<div id="sync-points-display-content"><span id="sync-points-display-close">&times;</span><h4>Marked Sync Points</h4><div id="sync-points-list-display"></div></div>`;document.body.appendChild(state.syncPointsDisplayModal);state.syncPointsDisplayModal.querySelector('#sync-points-display-close').addEventListener('click',hideSyncPointsDisplayModal);state.syncPointsDisplayModal.addEventListener('click',(e)=>{if(e.target===state.syncPointsDisplayModal)hideSyncPointsDisplayModal();});const fm=document.createElement('div');fm.id='files-display-modal';fm.innerHTML=`<div id="files-display-modal-content"><div id="files-display-modal-header"><h4 id="files-display-modal-title">Files</h4><button id="files-display-modal-close">&times;</button></div><div id="files-list-in-modal"></div></div>`;document.body.appendChild(fm);state.filesDisplayModal=fm;fm.querySelector('#files-display-modal-close').addEventListener('click',hideFilesDisplayModal);fm.addEventListener('click',(e)=>{if(e.target.id==='files-display-modal')hideFilesDisplayModal();});}

    function handleNavigationClick(event) { if (state.isEmbedded) return; const pageId = event.target.dataset.page; if (pageId && pageId !== state.currentPage) { showPage(pageId); GM_setValue('migakuLastActiveTab', pageId); }}
    function showPage(pageId) { if (state.isEmbedded || !state.controller) return; const contentArea = state.controller.querySelector('.controller-content'); if (!contentArea) { logToPopup("Error: Controller content area not found."); return; } let pageHTML = ''; switch (pageId) { case 'import': pageHTML = importPageHTML(); break; case 'saved': pageHTML = savedPageHTML(); break; case 'sync': pageHTML = syncPageHTML(); break; case 'settings': pageHTML = settingsPageHTML(); break; case 'about': pageHTML = aboutPageHTML(); break; default: logToPopup(`Unknown pageId: ${pageId}. Defaulting to import.`); pageHTML = importPageHTML(); pageId = 'import'; } contentArea.innerHTML = pageHTML; state.controller.querySelectorAll('.controller-nav button').forEach(b => b.classList.remove('active')); const targetButton = state.controller.querySelector(`.controller-nav button[data-page="${pageId}"]`); if (targetButton) targetButton.classList.add('active'); else { logToPopup(`Could not find nav button for page ${pageId}`);} state.currentPage = pageId; logToPopup(`Switched to page: ${pageId}`); if (pageId === 'import') setupImportPageListeners(); else if (pageId === 'saved') setupSavedPageListeners(); else if (pageId === 'sync') setupSyncPageListeners(); else if (pageId === 'settings') setupSettingsPageListeners(); updateActiveSavedDisplay(); updateSyncPointsDisplay(); if(pageId === 'settings' && !state.logElement) state.logElement = state.controller.querySelector('.log-area'); }
    function toggleMinimize() { if (state.isEmbedded) return; const controller = state.controller; state.minimized = !state.minimized; GM_setValue('minimized', state.minimized); if (state.minimized) { if (controller.style.width && controller.style.width !== 'auto' && controller.style.width !== '50px') { state.controllerLastWidth = controller.style.width; GM_setValue('migakuControllerWidth', state.controllerLastWidth); } if (controller.style.height && controller.style.height !== 'auto' && controller.style.height !== '30px') { state.controllerLastHeight = controller.style.height; GM_setValue('migakuControllerHeight', state.controllerLastHeight); } controller.classList.add('minimized'); } else { controller.classList.remove('minimized'); controller.style.width = state.controllerLastWidth || '380px'; controller.style.height = (state.controllerLastHeight === 'auto' || !state.controllerLastHeight) ? '' : state.controllerLastHeight; controller.style.overflow = 'hidden'; } logToPopup(`Controller minimized: ${state.minimized}`); }
    function toggleDarkMode() { if (state.isEmbedded) return; state.darkMode = document.getElementById('dark-mode-toggle').checked; GM_setValue('darkMode', state.darkMode); state.darkMode ? state.controller.classList.add('dark-mode') : state.controller.classList.remove('dark-mode'); errorBar.toggleDarkMode(state.darkMode); logToPopup(`Dark mode ${state.darkMode ? 'enabled' : 'disabled'}.`); applySubtitleAppearanceSettings(); }
    function toggleAdvancedSettings() { if (state.isEmbedded) return; const content = document.getElementById('advanced-settings-content'), btn = document.getElementById('toggle-advanced-settings'); state.advancedSettingsOpen = !content.classList.contains('active'); GM_setValue('advancedSettingsOpen', state.advancedSettingsOpen); if (state.advancedSettingsOpen) { content.classList.add('active'); btn.textContent = '▲'; } else { content.classList.remove('active'); btn.textContent = '▼'; } logToPopup(`Advanced settings ${state.advancedSettingsOpen ? 'shown' : 'hidden'}.`); }
    function toggleIgnorePageDetection() { if (state.isEmbedded) return; state.ignorePageDetection = document.getElementById('ignore-page-detection-toggle').checked; GM_setValue('migakuIgnorePageDetection', state.ignorePageDetection); logToPopup(`Ignore Page Detection: ${state.ignorePageDetection ? 'ON' : 'OFF'}`); if (!state.ignorePageDetection) attemptToMatchAndLoadCurrentPageDetection(); }
    function toggleSavedPageEditMode() { state.savedPageEditMode = !state.savedPageEditMode; const btn = document.getElementById('saved-page-edit-toggle'); if (btn) btn.textContent = state.savedPageEditMode ? "View Mode" : "Edit Mode"; if (btn) btn.style.backgroundColor = state.savedPageEditMode ? "#ffc107" : ""; renderSavedAnimeList(); logToPopup(`Saved Page Edit Mode: ${state.savedPageEditMode ? 'ON' : 'OFF'}`); }

    function saveSubtitlesToGM() { try { GM_setValue('migakuSavedSubtitles', JSON.stringify(state.savedAnimeData)); logToPopup("Saved subtitle data to GM_storage."); } catch (e) { logToPopup(`Error saving to GM_storage: ${e.message}.`); errorBar.show("Failed to save library. Storage full?"); console.error("GM_setValue error:", e); }}
    function renderSavedAnimeList() {
        if (state.isEmbedded) return;
        const container = document.getElementById('saved-anime-column'); const noSavedMsg = state.controller.querySelector('#no-saved-anime-message'); const importsColumn = document.getElementById('saved-imports-column');
        if (!container || !noSavedMsg || !importsColumn) { logToPopup("Saved page columns missing in renderSavedAnimeList."); return; }
        container.innerHTML = ''; importsColumn.innerHTML = '<p style="text-align:center; color:#777; margin-top:20px;">Select an anime to see its imports.</p>';
        const animeKeys = Object.keys(state.savedAnimeData); if (noSavedMsg) noSavedMsg.style.display = animeKeys.length === 0 ? 'block' : 'none';
        animeKeys.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).forEach(animeKey => {
            const animeItem = document.createElement('div'); animeItem.className = 'anime-list-item'; const isActiveForLoading = animeKey === state.activeSavedAnimeKey; if (isActiveForLoading) animeItem.classList.add('active-selection'); animeItem.dataset.animeKey = animeKey;
            const nameContent = document.createElement('span'); nameContent.className = 'list-item-content';
            if (state.savedPageEditMode && state.editingTarget === animeKey) { const input = document.createElement('input'); input.type = 'text'; input.value = animeKey; input.className = 'edit-input'; input.onkeydown = (e) => { if (e.key === 'Enter') handleRenameAnime(animeKey, input.value); else if (e.key === 'Escape') { state.editingTarget = null; renderSavedAnimeList(); }}; input.onblur = () => { setTimeout(() => { if (state.editingTarget === animeKey) { state.editingTarget = null; renderSavedAnimeList(); }}, 100);}; nameContent.appendChild(input); setTimeout(() => input.focus(), 0); }
            else { nameContent.textContent = animeKey; } animeItem.appendChild(nameContent);
            const actionsDiv = document.createElement('div'); actionsDiv.className = 'list-item-actions';
            if (state.savedPageEditMode) { const renBtn = document.createElement('button'); renBtn.className = 'action-btn edit-icon'; renBtn.innerHTML = '✏️'; renBtn.title = 'Rename Anime'; renBtn.onclick = (e) => { e.stopPropagation(); state.editingTarget = animeKey; renderSavedAnimeList(); }; actionsDiv.appendChild(renBtn); }
            const delBtn = document.createElement('button'); delBtn.className = 'action-btn delete-anime-btn'; delBtn.innerHTML = '✕'; delBtn.title = `Delete all for ${animeKey}`; delBtn.onclick = (e) => { e.stopPropagation(); if (confirm(`Delete all saved for "${animeKey}"?`)) deleteAnimeFromSaved(animeKey); }; actionsDiv.appendChild(delBtn);
            animeItem.appendChild(actionsDiv);
            animeItem.addEventListener('click', (e) => {
                if (e.target.closest('.list-item-actions')) return; // Ignore clicks on the action buttons themselves
                if (isActiveForLoading) { state.activeSavedAnimeKey = null; state.activeImportId = null; state.subtitleFiles = {}; clearCurrentSubtitlesOnly(); }
                else { state.activeSavedAnimeKey = animeKey; state.activeImportId = state.savedAnimeData[animeKey]?.[0]?.importId || null; if (state.activeImportId) { const activeSession = state.savedAnimeData[state.activeSavedAnimeKey]?.find(s => s.importId === state.activeImportId); if (activeSession?.files) state.subtitleFiles = JSON.parse(JSON.stringify(activeSession.files)); else state.subtitleFiles = {}; } else state.subtitleFiles = {}; }
                GM_setValue('migakuActiveSavedAnime', state.activeSavedAnimeKey); GM_setValue('migakuActiveImportId', state.activeImportId);
                renderSavedAnimeList(); renderImportSessionsForSelectedAnime(); updateActiveSavedDisplay(); populateManualSelectDropdownFromActiveImport();
            });
            container.appendChild(animeItem);
        });
        if (state.activeSavedAnimeKey) renderImportSessionsForSelectedAnime();
    }
    function renderImportSessionsForSelectedAnime() { const importsColumn = document.getElementById('saved-imports-column'); if (!importsColumn) return; importsColumn.innerHTML = ''; if (!state.activeSavedAnimeKey || !state.savedAnimeData[state.activeSavedAnimeKey]) { importsColumn.innerHTML = '<p style="text-align:center; color:#777; margin-top:20px;">Select an anime to see its imports.</p>'; return; } const animeSessions = state.savedAnimeData[state.activeSavedAnimeKey]; if (!animeSessions || animeSessions.length === 0) { importsColumn.innerHTML = `<p style="text-align:center; color:#777; margin-top:20px;">No imports for ${state.activeSavedAnimeKey}.</p>`; return; } const header = document.createElement('h5'); header.textContent = `Imports for: ${state.activeSavedAnimeKey}`; importsColumn.appendChild(header); animeSessions.forEach(session => { const sessionItem = document.createElement('div'); sessionItem.className = 'import-session-item'; const isActiveForDropdown = session.importId === state.activeImportId; if (isActiveForDropdown) sessionItem.classList.add('active-selection'); sessionItem.dataset.importId = session.importId; const nameContent = document.createElement('span'); nameContent.className = 'list-item-content'; if (state.savedPageEditMode && state.editingTarget === session.importId) { const input = document.createElement('input'); input.type = 'text'; input.value = session.importName; input.className = 'edit-input'; input.onkeydown = (e) => { if (e.key === 'Enter') handleRenameImport(state.activeSavedAnimeKey, session.importId, input.value); else if (e.key === 'Escape') { state.editingTarget = null; renderImportSessionsForSelectedAnime(); }}; input.onblur = () => { setTimeout(() => { if (state.editingTarget === session.importId) { state.editingTarget = null; renderImportSessionsForSelectedAnime(); }}, 100);}; nameContent.appendChild(input); setTimeout(() => input.focus(), 0); } else { nameContent.textContent = `${session.importName||'Import'} (Files: ${Object.keys(session.files).length})`; } const detailsS = document.createElement('span'); detailsS.className = 'import-session-details'; detailsS.textContent = `Added: ${session.dateAdded}`; nameContent.appendChild(detailsS); sessionItem.appendChild(nameContent); const actionsDiv = document.createElement('div'); actionsDiv.className = 'list-item-actions'; const viewFilesBtn = document.createElement('button'); viewFilesBtn.className = 'action-btn view-files-btn'; viewFilesBtn.textContent = "Files"; viewFilesBtn.onclick = (e) => { e.stopPropagation(); showFilesDisplayModal(state.activeSavedAnimeKey, session.importId); }; actionsDiv.appendChild(viewFilesBtn); if (state.savedPageEditMode) { const renBtn = document.createElement('button'); renBtn.className = 'action-btn edit-icon'; renBtn.innerHTML = '✏️'; renBtn.title = 'Rename Import'; renBtn.onclick = (e) => { e.stopPropagation(); state.editingTarget = session.importId; renderImportSessionsForSelectedAnime(); }; actionsDiv.appendChild(renBtn); } const delBtn = document.createElement('button'); delBtn.className = 'action-btn delete-import-btn'; delBtn.innerHTML = '✕'; delBtn.title = `Delete import`; delBtn.onclick = (e) => { e.stopPropagation(); if (confirm(`Delete import "${session.importName}"?`)) deleteImportSession(state.activeSavedAnimeKey, session.importId); }; actionsDiv.appendChild(delBtn); sessionItem.appendChild(actionsDiv); sessionItem.addEventListener('click', (e) => { if (e.target.closest('.list-item-actions') || e.target.tagName === 'INPUT') return; if (isActiveForDropdown) { state.activeImportId = null; state.subtitleFiles = {}; } else { state.activeImportId = session.importId; if (session.files) state.subtitleFiles = JSON.parse(JSON.stringify(session.files)); else state.subtitleFiles = {}; } GM_setValue('migakuActiveImportId', state.activeImportId); renderImportSessionsForSelectedAnime(); updateActiveSavedDisplay(); populateManualSelectDropdownFromActiveImport(); }); importsColumn.appendChild(sessionItem); }); }
    function showFilesDisplayModal(animeKey, importId) { const importSession = state.savedAnimeData[animeKey]?.find(s => s.importId === importId); if (!importSession || !state.filesDisplayModal) return; state.filesDisplayModal.querySelector('#files-display-modal-title').textContent = `Files in: ${importSession.importName || 'Import'}`; const fileListDiv = state.filesDisplayModal.querySelector('#files-list-in-modal'); fileListDiv.innerHTML = ''; if (!importSession.files || Object.keys(importSession.files).length === 0) { fileListDiv.textContent = "No files in this import session."; } else { Object.values(importSession.files).sort((a,b) => (a.episode ?? 999)-(b.episode ?? 999) || a.filename.localeCompare(b.filename) ).forEach(fileEntry => { const item = document.createElement('div'); item.className = 'file-item'; if (fileEntry.filename === state.loadedSubtitleFilename && animeKey === state.activeSavedAnimeKey && importId === state.activeImportId) item.classList.add('active-playing'); const nameS = document.createElement('span'); nameS.className = 'file-item-name'; nameS.textContent = fileEntry.filename; nameS.title = fileEntry.filename; const detailsS = document.createElement('span'); detailsS.className = 'file-item-details'; let detTxt = `(Ep: ${fileEntry.episode ?? 'N/A'}, Cues: ${fileEntry.parsed?.length ?? 'N/P'})`; if (fileEntry.savedOffset !== undefined) detTxt += ` Offset: ${fileEntry.savedOffset.toFixed(1)}s`; detailsS.textContent = detTxt; item.appendChild(nameS); item.appendChild(detailsS); const actsDiv = document.createElement('div'); actsDiv.className = 'file-item-actions'; const loadBtn = document.createElement('button'); loadBtn.textContent = "Load"; loadBtn.onclick = () => { state.activeSavedAnimeKey = animeKey; GM_setValue('migakuActiveSavedAnime', animeKey); state.activeImportId = importId; GM_setValue('migakuActiveImportId', importId); loadSingleSubtitleFromFileEntry(fileEntry, true); renderSavedAnimeList(); updateActiveSavedDisplay(); populateManualSelectDropdownFromActiveImport(); hideFilesDisplayModal(); }; actsDiv.appendChild(loadBtn); const infoBtn = document.createElement('button'); infoBtn.className = 'action-btn file-info-btn'; infoBtn.innerHTML = 'ℹ'; infoBtn.title = 'Show raw content'; infoBtn.onclick=(e)=>{e.stopPropagation();showRawContentForFile(fileEntry.rawContent);}; actsDiv.appendChild(infoBtn); if (state.savedPageEditMode) { const delBtn = document.createElement('button'); delBtn.className = 'action-btn delete-file-btn'; delBtn.innerHTML = '✕'; delBtn.title = `Delete file`; delBtn.onclick=(e)=>{e.stopPropagation();if(confirm(`Delete "${fileEntry.filename}"?`)){deleteFileFromImport(animeKey,importId,fileEntry.filename); showFilesDisplayModal(animeKey, importId);}}; actsDiv.appendChild(delBtn); } item.appendChild(actsDiv); fileListDiv.appendChild(item); }); } state.filesDisplayModal.style.display = 'flex'; }
    function hideFilesDisplayModal() { if (state.filesDisplayModal) state.filesDisplayModal.style.display = 'none';}
    function populateManualSelectDropdownFromActiveImport() { if (state.isEmbedded) return; const sel = document.getElementById('manual-subtitle-select'); if (!sel) return; sel.innerHTML = ''; if (state.activeSavedAnimeKey && state.activeImportId) { const activeImport = state.savedAnimeData[state.activeSavedAnimeKey]?.find(s => s.importId === state.activeImportId); if (activeImport?.files) { state.subtitleFiles = JSON.parse(JSON.stringify(activeImport.files)); Object.keys(state.subtitleFiles).sort().forEach(fnKey => { const opt = document.createElement('option'); opt.value = fnKey; opt.textContent = fnKey; if (fnKey === state.loadedSubtitleFilename) opt.selected = true; sel.appendChild(opt); }); return; }} state.subtitleFiles = {}; }
    function handleSubtitleImport(event, importType) { if (state.isEmbedded) return; errorBar.hide(); if (!state.detectedAnimeName) { errorBar.show("Cannot save: Anime name not detected."); event.target.value = ''; return; } const files = event.target.files; if (!files || files.length === 0) return; if (state.savedAnimeData[state.detectedAnimeName]) { const newFNames = Array.from(files).map(f=>f.name).sort(); for(const exImp of state.savedAnimeData[state.detectedAnimeName]){ const exFNames = Object.keys(exImp.files).sort(); if(newFNames.length===exFNames.length && newFNames.every((v,i)=>v===exFNames[i])){ errorBar.show(`Import aborted: Duplicate of "${exImp.importName}" for ${state.detectedAnimeName}.`); event.target.value=''; return;}}} const impId=Date.now().toString(), dateAdd=new Date().toISOString().substring(0,16).replace('T',' '); let impName=(importType==='folder'&&files[0].webkitRelativePath)?files[0].webkitRelativePath.split('/')[0]:files[0].name; const newSess={importId:impId,importName:impName,dateAdded:dateAdd,files:{}}; let procCnt=0,ok=false; Array.from(files).forEach(f=>{const r=new FileReader();r.onload=(e)=>{const c=e.target.result,fn=f.name,xt=fn.split('.').pop().toLowerCase();if(!['srt','vtt','ass','ssa'].includes(xt))logToPopup(`Skipping:${fn}`);else{const epN=extractEpisodeNumber(fn);let pS=[];try{if(xt==='srt')pS=parseSubRip(c);else if(xt==='vtt')pS=parseWebVTT(c);else if(xt==='ass'||xt==='ssa')pS=parseASS(c);if(pS.length>0){newSess.files[fn]={filename:fn,parsed:pS,rawContent:c,episode:epN, savedOffset: undefined};ok=true;}else logToPopup(`No cues:${fn}`);}catch(err){logToPopup(`Err parsing ${fn}:${err.message}`);}}if(++procCnt===files.length)finishImp();};r.onerror=()=>{logToPopup(`Err read:${f.name}`);if(++procCnt===files.length)finishImp();};r.readAsText(f);}); function finishImp(){if(!ok){errorBar.show(`Import fail:No valid files from "${impName}".`);event.target.value='';return;}if(!state.savedAnimeData[state.detectedAnimeName])state.savedAnimeData[state.detectedAnimeName]=[];state.savedAnimeData[state.detectedAnimeName].unshift(newSess);saveSubtitlesToGM();state.activeSavedAnimeKey=state.detectedAnimeName;state.activeImportId=impId;GM_setValue('migakuActiveSavedAnime',state.activeSavedAnimeKey);GM_setValue('migakuActiveImportId',state.activeImportId);logToPopup(`Imported "${impName}" for "${state.detectedAnimeName}".`);updateStatus(`Imported "${impName}".`);renderSavedAnimeList();updateActiveSavedDisplay();populateManualSelectDropdownFromActiveImport();attemptToMatchAndLoadCurrentPageDetection();showPage('saved');event.target.value='';}}
    function handleRenameAnime(oldKey, newKey) { newKey=newKey.trim(); if(!newKey||newKey===oldKey){state.editingTarget=null;renderSavedAnimeList();return;} if(state.savedAnimeData[newKey]){errorBar.show(`Cannot rename: "${newKey}" exists.`);state.editingTarget=null;renderSavedAnimeList();return;} state.savedAnimeData[newKey]=state.savedAnimeData[oldKey]; delete state.savedAnimeData[oldKey]; if(state.activeSavedAnimeKey===oldKey){state.activeSavedAnimeKey=newKey;GM_setValue('migakuActiveSavedAnime',newKey);} if(state.expandedAnimeInSaved===oldKey){state.expandedAnimeInSaved=newKey; GM_setValue('migakuExpandedAnimeInSaved',newKey); if(state.expandedImportInSaved?.startsWith(oldKey+'_')){ state.expandedImportInSaved = state.expandedImportInSaved.replace(oldKey+'_', newKey+'_'); GM_setValue('migakuExpandedImportInSaved', state.expandedImportInSaved);}} state.editingTarget=null;saveSubtitlesToGM();renderSavedAnimeList();updateActiveSavedDisplay();logToPopup(`Renamed "${oldKey}" to "${newKey}".`);}
    function handleRenameImport(animeKey, importId, newName) { newName=newName.trim(); const session=state.savedAnimeData[animeKey]?.find(s=>s.importId===importId); if(!session||!newName||newName===session.importName){state.editingTarget=null;renderSavedAnimeList();return;} session.importName=newName; state.editingTarget=null;saveSubtitlesToGM();renderSavedAnimeList();updateActiveSavedDisplay();logToPopup(`Renamed import to "${newName}".`);}
    function deleteAnimeFromSaved(animeKey) { if(state.savedAnimeData[animeKey]){delete state.savedAnimeData[animeKey];saveSubtitlesToGM();logToPopup(`Deleted all for:${animeKey}`);if(state.activeSavedAnimeKey===animeKey){state.activeSavedAnimeKey=null;state.activeImportId=null;GM_setValue('migakuActiveSavedAnime',null);GM_setValue('migakuActiveImportId',null);clearCurrentSubtitlesOnly();state.subtitleFiles={};populateManualSelectDropdownFromActiveImport();}if(state.expandedAnimeInSaved===animeKey){state.expandedAnimeInSaved=null; GM_setValue('migakuExpandedAnimeInSaved',null); state.expandedImportInSaved=null; GM_setValue('migakuExpandedImportInSaved',null);}renderSavedAnimeList();updateActiveSavedDisplay();}}
    function deleteImportSession(animeKey, importId) { if(state.savedAnimeData[animeKey]){state.savedAnimeData[animeKey]=state.savedAnimeData[animeKey].filter(s=>s.importId!==importId);if(state.savedAnimeData[animeKey].length===0)delete state.savedAnimeData[animeKey];saveSubtitlesToGM();logToPopup(`Deleted import ID ${importId} for ${animeKey}`);if(state.activeSavedAnimeKey===animeKey&&state.activeImportId===importId){state.activeImportId=null;GM_setValue('migakuActiveImportId',null);if(state.savedAnimeData[animeKey]?.length>0){state.activeImportId=state.savedAnimeData[animeKey][0].importId;GM_setValue('migakuActiveImportId',state.activeImportId);state.expandedImportInSaved=animeKey+'_'+state.activeImportId;}else{state.activeSavedAnimeKey=null;GM_setValue('migakuActiveSavedAnime',null);state.expandedAnimeInSaved=null;state.expandedImportInSaved=null;clearCurrentSubtitlesOnly();state.subtitleFiles={};}}else if(state.expandedImportInSaved === (animeKey + '_' + importId)){state.expandedImportInSaved=null; GM_setValue('migakuExpandedImportInSaved',null);}renderSavedAnimeList();updateActiveSavedDisplay();populateManualSelectDropdownFromActiveImport();}}
    function deleteFileFromImport(animeKey, importId, filename) { const session=state.savedAnimeData[animeKey]?.find(s=>s.importId===importId); if(!session||!session.files[filename])return; delete session.files[filename];logToPopup(`Deleted "${filename}" from "${session.importName}".`);if(state.loadedSubtitleFilename===filename)clearCurrentSubtitlesOnly();if(Object.keys(session.files).length===0){logToPopup(`Import "${session.importName}" empty, deleting.`);deleteImportSession(animeKey,importId);}else{saveSubtitlesToGM();renderSavedAnimeList(); populateManualSelectDropdownFromActiveImport();}}
    function clearCurrentSubtitlesOnly() { if(state.isEmbedded)return;logToPopup('Clearing current display.');state.subtitles=[];state.currentSubtitleIndex=-1;state.lastProcessedTime=-1;state.rawSubtitleContent=null;state.loadedSubtitleFilename='N/A';state.loadedSubtitleFileOriginalOffset=null;const w=document.getElementById('migaku-subtitle-display-wrapper');if(w)w.innerHTML='';const lEl=document.getElementById('loaded-subtitle-filename');if(lEl)lEl.textContent=state.loadedSubtitleFilename;const tRow=document.getElementById('video-time-row');if(tRow)tRow.style.display='none';updateStatus('Current subs cleared.');if(state.iframeWindow)sendMessage('clearSubtitles');const activeFile=document.querySelector('#files-list-in-modal .file-item.active-playing');if(activeFile)activeFile.classList.remove('active-playing');const manSel=document.getElementById('manual-subtitle-select');if(manSel)manSel.value=''; if (state.loadedSubtitleFileOriginalOffset === null) { state.calculatedOffset = calculateAverageOffset(state.syncPoints); state.offset = state.calculatedOffset + state.manualOffset; updateSyncPointsDisplay();}}
    function updateActiveSavedDisplay() { if(state.isEmbedded)return;const anDisp=document.getElementById('active-saved-anime-display'),imDisp=document.getElementById('active-import-display');if(anDisp)anDisp.textContent=state.activeSavedAnimeKey||'N/A';if(imDisp){if(state.activeSavedAnimeKey&&state.activeImportId){const sess=state.savedAnimeData[state.activeSavedAnimeKey]?.find(s=>s.importId===state.activeImportId);imDisp.textContent=sess?`${sess.importName} (${sess.dateAdded.substring(0,10)})`:'N/A';}else imDisp.textContent='N/A';}}

    function saveCurrentSyncToFileHandler() { if (state.isEmbedded) return; if (!state.loadedSubtitleFilename || state.loadedSubtitleFilename === 'N/A') { errorBar.show("No subtitle file loaded to save sync for."); return; } if (!state.activeSavedAnimeKey || !state.activeImportId) { errorBar.show("Cannot save sync: No active saved anime/import. Select from 'Saved' tab first."); return; } const importSession = state.savedAnimeData[state.activeSavedAnimeKey]?.find(s => s.importId === state.activeImportId); if (importSession && importSession.files[state.loadedSubtitleFilename]) { const effectiveOffset = parseFloat(state.offset.toFixed(1)); importSession.files[state.loadedSubtitleFilename].savedOffset = effectiveOffset; saveSubtitlesToGM(); logToPopup(`Saved offset ${effectiveOffset}s for file: ${state.loadedSubtitleFilename}`); alert(`Sync offset ${effectiveOffset}s saved for ${state.loadedSubtitleFilename}`); state.loadedSubtitleFileOriginalOffset = effectiveOffset; state.calculatedOffset = effectiveOffset; state.manualOffset = 0; state.offset = state.calculatedOffset; updateSyncPointsDisplay(); const modalFileItemDetails = state.filesDisplayModal?.querySelector(`#files-list-in-modal .file-item-name[data-filename="${state.loadedSubtitleFilename}"]`)?.closest('.file-item')?.querySelector('.file-item-details'); if(modalFileItemDetails) { let currentDetails = modalFileItemDetails.textContent.replace(/\sOffset:.*$/,''); modalFileItemDetails.textContent = `${currentDetails} Offset: ${effectiveOffset}s`; } } else { errorBar.show("Error finding loaded file in saved data to save sync."); }}
    function clearSavedSyncForFileHandler() { if (state.isEmbedded) return; if (!state.loadedSubtitleFilename || state.loadedSubtitleFilename === 'N/A') { errorBar.show("No file loaded to clear sync for."); return; } if (!state.activeSavedAnimeKey || !state.activeImportId) { errorBar.show("No active saved anime/import."); return; } const importSession = state.savedAnimeData[state.activeSavedAnimeKey]?.find(s => s.importId === state.activeImportId); if (importSession && importSession.files[state.loadedSubtitleFilename]) { if (importSession.files[state.loadedSubtitleFilename].savedOffset !== undefined) { delete importSession.files[state.loadedSubtitleFilename].savedOffset; saveSubtitlesToGM(); logToPopup(`Cleared saved offset for: ${state.loadedSubtitleFilename}`); alert(`Saved sync offset cleared for ${state.loadedSubtitleFilename}.`); state.loadedSubtitleFileOriginalOffset = null; state.calculatedOffset = calculateAverageOffset(state.syncPoints); state.offset = state.calculatedOffset + state.manualOffset; updateSyncPointsDisplay(); state.lastProcessedTime = -1; updateSubtitleDisplay(); const modalFileItemDetails = state.filesDisplayModal?.querySelector(`#files-list-in-modal .file-item-name[data-filename="${state.loadedSubtitleFilename}"]`)?.closest('.file-item')?.querySelector('.file-item-details'); if(modalFileItemDetails) { modalFileItemDetails.textContent = modalFileItemDetails.textContent.replace(/\sOffset:.*$/,''); }} else { alert(`No saved sync offset to clear for ${state.loadedSubtitleFilename}.`); }} else { errorBar.show("Error finding loaded file in saved data to clear sync."); }}

    function attemptToMatchAndLoadCurrentPageDetection() { if(state.isEmbedded||state.ignorePageDetection)return;errorBar.hide();if(!state.detectedAnimeName||state.detectedEpisode===null)return;if(state.activeSavedAnimeKey===state.detectedAnimeName){if(Object.keys(state.subtitleFiles).length>0){const fL=Object.values(state.subtitleFiles).find(f=>f.episode===state.detectedEpisode);if(fL){if(fL.filename!==state.loadedSubtitleFilename)loadSingleSubtitleFromFileEntry(fL,true);}else logToPopup(`No ep ${state.detectedEpisode} in active import for ${state.detectedAnimeName}.`);}}else if(state.savedAnimeData[state.detectedAnimeName]?.length>0){logToPopup(`Page anime "${state.detectedAnimeName}" differs. Switching active.`);state.activeSavedAnimeKey=state.detectedAnimeName;GM_setValue('migakuActiveSavedAnime',state.activeSavedAnimeKey);state.activeImportId=state.savedAnimeData[state.detectedAnimeName][0].importId;GM_setValue('migakuActiveImportId',state.activeImportId);renderSavedAnimeList();updateActiveSavedDisplay();const actImp=state.savedAnimeData[state.activeSavedAnimeKey]?.find(s=>s.importId===state.activeImportId);if(actImp?.files){state.subtitleFiles=JSON.parse(JSON.stringify(actImp.files));populateManualSelectDropdownFromActiveImport();const fL=Object.values(state.subtitleFiles).find(f=>f.episode===state.detectedEpisode);if(fL)loadSingleSubtitleFromFileEntry(fL,true);else{logToPopup(`Switched to ${state.detectedAnimeName}, no ep ${state.detectedEpisode}.`);clearCurrentSubtitlesOnly();}}}else{logToPopup(`Detected "${state.detectedAnimeName}" not saved.`);}}
    function loadSingleSubtitleFromFileEntry(fileEntry, applySavedOffset = false) { if(state.isEmbedded||!fileEntry||!fileEntry.parsed){logToPopup(`Cannot load file entry.`);clearCurrentSubtitlesOnly();return;}errorBar.hide();logToPopup(`Loading: "${fileEntry.filename}" (Ep ${fileEntry.episode??'N/A'})`);state.subtitles=fileEntry.parsed;state.rawSubtitleContent=fileEntry.rawContent;state.loadedSubtitleFilename=fileEntry.filename;state.currentSubtitleIndex=-1;state.lastProcessedTime=-1;state.loadedSubtitleFileOriginalOffset=null;if(applySavedOffset&&fileEntry.savedOffset!==undefined){logToPopup(`Applying saved offset: ${fileEntry.savedOffset.toFixed(1)}s for ${fileEntry.filename}`);state.loadedSubtitleFileOriginalOffset=fileEntry.savedOffset;state.calculatedOffset=fileEntry.savedOffset;state.manualOffset=0;state.offset=state.calculatedOffset+state.manualOffset;updateSyncPointsDisplay();}else if(state.loadedSubtitleFileOriginalOffset===null){state.calculatedOffset=calculateAverageOffset(state.syncPoints);state.offset=state.calculatedOffset+state.manualOffset;updateSyncPointsDisplay();}const elF=document.getElementById('loaded-subtitle-filename');if(elF)elF.textContent=state.loadedSubtitleFilename;const elT=document.getElementById('video-time-row');if(elT)elT.style.display='flex';updateStatus(`Loaded: "${state.loadedSubtitleFilename}" (${state.subtitles.length} cues)`);updateSubtitleDisplay();const fListDiv=document.getElementById(`files-list-in-modal`);if(fListDiv){const cA=fListDiv.querySelector('.file-item.active-playing');if(cA)cA.classList.remove('active-playing');const nA=Array.from(fListDiv.querySelectorAll('.file-item')).find(item=>item.querySelector('.file-item-name')?.textContent===fileEntry.filename);if(nA)nA.classList.add('active-playing');}const mSel=document.getElementById('manual-subtitle-select');if(mSel)mSel.value=fileEntry.filename;}
    function applyManualSubtitleSelection() { if(state.isEmbedded)return;errorBar.hide();const mSel=document.getElementById('manual-subtitle-select');if(!mSel||mSel.options.length===0){errorBar.show('No files in active cache. Select an import from "Saved" tab.');return;}const selFn=mSel.value;if(!selFn){errorBar.show('Please select file.');return;}if(state.subtitleFiles[selFn]){loadSingleSubtitleFromFileEntry(state.subtitleFiles[selFn],true);logToPopup(`Manually loaded: "${selFn}".`);}else errorBar.show(`File "${selFn}" not in cache.`);}

    function adjustManualSyncOffset(e) { if (state.isEmbedded) return; state.manualOffset = parseFloat(e.target.value); GM_setValue('manualSubtitleOffset', state.manualOffset); state.offset = state.calculatedOffset + state.manualOffset; GM_setValue('subtitleOffset', state.offset); updateSyncPointsDisplay(); logToPopup(`Manual offset: ${state.manualOffset.toFixed(1)}s. Effective: ${state.offset.toFixed(1)}s.`); state.lastProcessedTime = -1; updateSubtitleDisplay(); }
    function adjustFontSize(e) { if (state.isEmbedded) return; state.fontSizeValue = parseInt(e.target.value); document.getElementById('font-size-value').textContent = state.fontSizeValue; GM_setValue('subtitleFontSize', state.fontSizeValue); logToPopup(`Font size: ${state.fontSizeValue}px.`); const subEl = document.querySelector('#migaku-subtitle-display-wrapper .migaku-subtitle-text'); if (subEl) subEl.style.fontSize = `${state.fontSizeValue}px`; }
    function adjustSubtitleAppearance() { if (state.isEmbedded) return; state.subtitleTextColor = document.getElementById('subtitle-text-color').value; state.subtitleBackgroundColor = document.getElementById('subtitle-background-color').value; state.subtitleBackgroundOpacity = parseFloat(document.getElementById('subtitle-background-opacity').value); GM_setValue('subtitleTextColor', state.subtitleTextColor); GM_setValue('subtitleBackgroundColor', state.subtitleBackgroundColor); GM_setValue('subtitleBackgroundOpacity', state.subtitleBackgroundOpacity); document.getElementById('background-opacity-value').textContent = state.subtitleBackgroundOpacity.toFixed(2); const subEl = document.querySelector('#migaku-subtitle-display-wrapper .migaku-subtitle-text'); if (subEl) { subEl.style.color = state.subtitleTextColor; const rgb = hexToRgb(state.subtitleBackgroundColor); if (rgb) subEl.style.backgroundColor = `rgba(${rgb.r},${rgb.g},${rgb.b},${state.subtitleBackgroundOpacity})`; else subEl.style.backgroundColor = state.subtitleBackgroundColor; } logToPopup(`Subtitle appearance updated.`); }
    function adjustVerticalPosition(e) { if (state.isEmbedded) return; state.verticalPosition = parseInt(e.target.value); document.getElementById('vertical-position-value').textContent = state.verticalPosition; GM_setValue('verticalPosition', state.verticalPosition); logToPopup(`Vertical pos: ${state.verticalPosition}%.`); applyVerticalPosition(); }
    function applyVerticalPosition() { if (state.isEmbedded) return; const wrapper = document.getElementById('migaku-subtitle-display-wrapper'); if (!wrapper) return; const isFs = document.fullscreenElement || document.webkitFullscreenElement; if (!isFs) { const iframe = document.querySelector(`iframe[src*="megacloud.tv/embed"], iframe[src*="megacloud.blog/embed"]`); if (iframe) { const rect = iframe.getBoundingClientRect(); const bottomOffset = rect.height * (state.verticalPosition/100); const vpBottom = window.innerHeight - (rect.bottom - bottomOffset); wrapper.style.position = 'fixed'; wrapper.style.top = 'auto'; wrapper.style.bottom = `${vpBottom}px`; wrapper.style.left = `${rect.left}px`; wrapper.style.width = `${rect.width}px`; wrapper.style.transform = 'none'; wrapper.style.maxWidth = '80%'; } else { wrapper.style.bottom = `${state.verticalPosition}%`; wrapper.style.left = '0'; wrapper.style.width = '100%'; }} else { wrapper.style.bottom = `${state.verticalPosition}%`; wrapper.style.left = '0'; wrapper.style.width = '100%'; wrapper.style.maxWidth = '100%'; }}
    function adjustOutlineSize(e) { if (state.isEmbedded) return; state.outlineSize = parseFloat(e.target.value); document.getElementById('outline-size-value').textContent = state.outlineSize.toFixed(1); GM_setValue('outlineSize', state.outlineSize); logToPopup(`Outline: ${state.outlineSize.toFixed(1)}px.`); applyOutlineSize(); }
    function applyOutlineSize() {
        if (state.isEmbedded) return;
        const el = document.querySelector('#migaku-subtitle-display-wrapper .migaku-subtitle-text');
        if (!el) return;
        const s = state.outlineSize;
        let shadow = 'none';
        if (s > 0) {
            const parts = [
                `-${s}px -${s}px 0 #000`,
                `${s}px -${s}px 0 #000`,
                `-${s}px ${s}px 0 #000`,
                `${s}px ${s}px 0 #000`,
                `0 -${s}px 0 #000`,
                `0 ${s}px 0 #000`,
                `-${s}px 0 0 #000`,
                `${s}px 0 0 #000`
            ];
            shadow = parts.join(',');
        }
        el.style.textShadow = shadow;
    }
    function hexToRgb(hex) { const r = /^#?([a-f\d])([a-f\d])([a-f\d])$/i; hex = hex.replace(r, (m,r,g,b)=>r+r+g+g+b+b); const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return res ? {r:parseInt(res[1],16),g:parseInt(res[2],16),b:parseInt(res[3],16)} : null; }
    function applySubtitleAppearanceSettings() { if(state.isEmbedded)return;state.subtitleTextColor=GM_getValue('subtitleTextColor','#FFFFFF');state.subtitleBackgroundColor=GM_getValue('subtitleBackgroundColor','#000000');state.subtitleBackgroundOpacity=parseFloat(GM_getValue('subtitleBackgroundOpacity',0.7));state.darkMode=GM_getValue('darkMode',false);state.verticalPosition=parseInt(GM_getValue('verticalPosition',15));state.outlineSize=parseFloat(GM_getValue('outlineSize',1));state.ignorePageDetection=GM_getValue('migakuIgnorePageDetection',false);if(state.controller){state.darkMode?state.controller.classList.add('dark-mode'):state.controller.classList.remove('dark-mode');errorBar.toggleDarkMode(state.darkMode);}const elTxtC=document.getElementById('subtitle-text-color');if(elTxtC)elTxtC.value=state.subtitleTextColor;const elBgC=document.getElementById('subtitle-background-color');if(elBgC)elBgC.value=state.subtitleBackgroundColor;const elBgO=document.getElementById('subtitle-background-opacity');if(elBgO){elBgO.value=state.subtitleBackgroundOpacity;const elBgOV=document.getElementById('background-opacity-value');if(elBgOV)elBgOV.textContent=state.subtitleBackgroundOpacity.toFixed(2);}const elDM=document.getElementById('dark-mode-toggle');if(elDM)elDM.checked=state.darkMode;const elVP=document.getElementById('vertical-position');if(elVP){elVP.value=state.verticalPosition;const elVPV=document.getElementById('vertical-position-value');if(elVPV)elVPV.textContent=state.verticalPosition;}const elOS=document.getElementById('outline-size');if(elOS){elOS.value=state.outlineSize;const elOSV=document.getElementById('outline-size-value');if(elOSV)elOSV.textContent=state.outlineSize.toFixed(1);}const elIPD=document.getElementById('ignore-page-detection-toggle');if(elIPD)elIPD.checked=state.ignorePageDetection;updateSubtitleDisplay();}
    function updateStatus(message) { if(state.isEmbedded)return;const statusEl=document.getElementById('subtitle-status'),statusRow=document.getElementById('status-row');if(statusEl&&statusRow){statusEl.textContent=message;const show=state.subtitles.length>0||message.includes('Searching')||message.includes('Video found')||message.includes('Loaded')||message.includes('Imported');statusRow.style.display=show?'flex':'none';}}
    function findCurrentSubtitle(currentTime) { if(state.isEmbedded||state.subtitles.length===0)return null;const adjTime=currentTime+state.offset;for(let i=0;i<state.subtitles.length;i++){const sub=state.subtitles[i];if(adjTime>=sub.start&&adjTime<=sub.end){state.currentSubtitleIndex=i;return sub;}if(adjTime<sub.start)break;}state.currentSubtitleIndex=-1;return null;}
    function updateSubtitleDisplay() { if(state.isEmbedded)return;const vr=document.getElementById('video-time-row'),wr=document.getElementById('migaku-subtitle-display-wrapper');if(!wr)return;if(state.subtitles.length===0){if(wr.innerHTML!=='')wr.innerHTML='';if(vr)vr.style.display='none';return;}if(vr)vr.style.display='flex';const ct=state.currentVideoTime;if(Math.abs(ct-state.lastProcessedTime)<0.08&&state.lastProcessedTime!==-1)return;state.lastProcessedTime=ct;const cs=findCurrentSubtitle(ct);const de=wr.querySelector('.migaku-subtitle-text');const di=de?parseInt(de.dataset.id):null;let nu=false;if(cs){if(!de||di!==cs.id||de.textContent!==cs.text)nu=true;}else if(de)nu=true;if(nu){wr.innerHTML='';if(cs){const se=document.createElement('div');se.className='migaku-subtitle-text';se.style.fontSize=`${state.fontSizeValue}px`;se.style.color=state.subtitleTextColor;const rgb=hexToRgb(state.subtitleBackgroundColor);if(rgb)se.style.backgroundColor=`rgba(${rgb.r},${rgb.g},${rgb.b},${state.subtitleBackgroundOpacity})`;else se.style.backgroundColor=state.subtitleBackgroundColor;const s=state.outlineSize;let sh='none';if(s>0)sh=`-${s}px -${s}px 0 #000,${s}px -${s}px 0 #000,-${s}px ${s}px 0 #000,${s}px ${s}px 0 #000,0 -${s}px 0 #000,0 ${s}px 0 #000,-${s}px 0 0 #000,${s}px 0 0 #000`.replace(/\s+/g,'');se.style.textShadow=sh;se.textContent=cs.text;se.dataset.start=cs.start;se.dataset.end=cs.end;se.dataset.id=cs.id;wr.appendChild(se);}applyVerticalPosition();}}
    function handleFullscreenChangeTop() { if(state.isEmbedded)return;const isFs=!!(document.fullscreenElement||document.webkitFullscreenElement);const ctrl=document.getElementById('migaku-controller');logToPopup(`Fullscreen(top):${isFs}`);if(ctrl)ctrl.style.display=isFs?'none':'flex';updateSubtitleDisplay();}
    function showFullSubtitlesModal() { if(state.isEmbedded)return;errorBar.hide();if(!state.rawSubtitleContent){errorBar.show('No active sub to show content.');return;}const modal=document.getElementById('subtitle-file-modal'),contEl=document.getElementById('full-subtitle-text');if(modal&&contEl){contEl.textContent=state.rawSubtitleContent;modal.style.display='flex';logToPopup('Showing full sub content.');}}
    function hideFullSubtitlesModal() { if(state.isEmbedded)return;const modal=document.getElementById('subtitle-file-modal');if(modal)modal.style.display='none';}
    function copyLogToClipboard() { if(state.isEmbedded||!state.logElement)return;const txt=state.logElement.innerText;navigator.clipboard.writeText(txt).then(()=>logToPopup('Log copied!')).catch(()=>logToPopup('Log copy failed.'));
    }

    function markSyncPoint() { if(state.isEmbedded)return;errorBar.hide();if(state.subtitles.length===0){errorBar.show('Load sub first.');return;}if(!state.iframeWindow||(state.currentVideoTime===0&&!state.videoElement?.paused)){errorBar.show('Video not ready/time 0. Pause if at start.');return;}const vTime=state.currentVideoTime;const cues=findNearbySubtitles(vTime,5);if(cues.length===0){errorBar.show(`No nearby cues at ${vTime.toFixed(1)}s.`);return;}let nativeCueTxt=null;for(const trL in state.nativeSubtitles){const nC=state.nativeSubtitles[trL].find(c=>vTime>=c.start&&vTime<=c.end);if(nC){nativeCueTxt=`Native(${trL}):"${nC.text}"`;break;}}const modal=state.syncPointSelectionModal,listEl=modal.querySelector('#sync-point-selection-list'),timeEl=modal.querySelector('#sync-modal-video-time'),hintEl=modal.querySelector('#native-subtitle-hint');if(!modal||!listEl||!timeEl||!hintEl)return;timeEl.textContent=vTime.toFixed(1);listEl.innerHTML='';hintEl.style.display=nativeCueTxt?(hintEl.textContent=nativeCueTxt,'block'):'none';cues.forEach(c=>{const d=document.createElement('div');d.textContent=`[${formatTime(c.start)}] ${c.text.substring(0,100)}`;d.dataset.subtitleTime=c.start;d.dataset.videoTime=vTime;d.addEventListener('click',handleSyncCueSelected);listEl.appendChild(d);});modal.style.display='flex';}
    function findNearbySubtitles(time, count = 5) { if(state.subtitles.length===0)return[];let startIdx=state.subtitles.findIndex(s=>s.start>=time);if(startIdx===-1)startIdx=state.subtitles.length-count;startIdx=Math.max(0,startIdx-Math.floor(count/2));const endIdx=Math.min(state.subtitles.length,startIdx+count);return state.subtitles.slice(startIdx,endIdx);}
    function handleSyncCueSelected(event) { const vTime=parseFloat(event.target.dataset.videoTime),sTime=parseFloat(event.target.dataset.subtitleTime);if(isNaN(vTime)||isNaN(sTime))return;state.syncPoints.push({videoTime:vTime,subtitleTime:sTime});GM_setValue('syncPoints',JSON.stringify(state.syncPoints));state.calculatedOffset=calculateAverageOffset(state.syncPoints);state.offset=state.calculatedOffset+state.manualOffset;GM_setValue('subtitleOffset',state.offset);updateSyncPointsDisplay();state.lastProcessedTime=-1;updateSubtitleDisplay();hideSyncPointSelectionModal();logToPopup(`Sync point. New calc offset: ${state.calculatedOffset.toFixed(1)}s`);}
    function clearSyncPoints() { if(state.isEmbedded)return;errorBar.hide();state.syncPoints=[];GM_setValue('syncPoints','[]');state.calculatedOffset=0;state.offset=state.manualOffset;GM_setValue('subtitleOffset',state.offset);updateSyncPointsDisplay();state.lastProcessedTime=-1;updateSubtitleDisplay();logToPopup('Sync points cleared.');}
    function updateSyncPointsDisplay() { if(state.isEmbedded)return;const cEl=document.getElementById('sync-points-count');if(cEl)cEl.textContent=state.syncPoints.length;const caEl=document.getElementById('calculated-sync-value');if(caEl)caEl.textContent=state.calculatedOffset.toFixed(1);const mVEl=document.getElementById('manual-sync-value');if(mVEl)mVEl.textContent=state.manualOffset.toFixed(1);const mREl=document.getElementById('manual-sync-offset');if(mREl)mREl.value=state.manualOffset;const efEl=document.getElementById('effective-offset-value');if(efEl)efEl.textContent=state.offset.toFixed(1);}
    function hideSyncPointSelectionModal() { if(state.syncPointSelectionModal)state.syncPointSelectionModal.style.display='none';}
    function showSyncPointsDisplayModal() { if(state.isEmbedded)return;errorBar.hide();const modal=state.syncPointsDisplayModal,listEl=modal.querySelector('#sync-points-list-display');if(!modal||!listEl)return;listEl.innerHTML=state.syncPoints.length===0?'No sync points.':'';state.syncPoints.forEach((p,i)=>{const d=document.createElement('div');d.innerHTML=`V:${p.videoTime.toFixed(1)} S:${p.subtitleTime.toFixed(1)} (Off:${(p.videoTime-p.subtitleTime).toFixed(1)}) <button data-index="${i}">Del</button>`;d.querySelector('button').addEventListener('click',handleRemoveSyncPoint);listEl.appendChild(d);});modal.style.display='flex';}
    function handleRemoveSyncPoint(event) { const idx=parseInt(event.target.dataset.index);if(isNaN(idx)||idx<0||idx>=state.syncPoints.length)return;state.syncPoints.splice(idx,1);GM_setValue('syncPoints',JSON.stringify(state.syncPoints));state.calculatedOffset=calculateAverageOffset(state.syncPoints);state.offset=state.calculatedOffset+state.manualOffset;GM_setValue('subtitleOffset',state.offset);updateSyncPointsDisplay();showSyncPointsDisplayModal();state.lastProcessedTime=-1;updateSubtitleDisplay();logToPopup(`Removed sync point ${idx}.`);}
    function hideSyncPointsDisplayModal() { if(state.syncPointsDisplayModal)state.syncPointsDisplayModal.style.display='none';}
    function formatTime(seconds) { const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return `${h>0?h+':':''}${String(m).padStart(2,'0')}:${String(s.toFixed(3)).padStart(6,'0')}`;}

    function extractEpisodeNumber(filename) { if (!filename) return null; const lower = filename.toLowerCase(); const patterns = [ /_(\d{1,3})\.(?:srt|vtt|ass|ssa)$/, /-\s*(\d{1,3})\.(?:srt|vtt|ass|ssa)$/, /[^a-z0-9](\d{1,3})\.(?:srt|vtt|ass|ssa)$/, /episode\s*(\d{1,3})/i, /\s-\s*(\d{1,3})\s*(?:\[|\(|$)/, /s\d{1,2}e(\d{1,3})/i, /[^\w-](\d{1,3})(?:[^\w-]|$)/ ]; for (const p of patterns) { const match = lower.match(p); if (match && match[1]) { const ep = parseInt(match[1],10); if (ep > 0 && ep < 1000) return ep; }} return null; }
    function detectAnimeName() { if (state.isEmbedded || state.ignorePageDetection) return; const txt = document.body.innerText; const regex = /HiAnime is the best site to watch\s+(.+?)\s+(?:SUB|DUB)\s+online/i; const match = txt.match(regex); let newName = null; if (match&&match[1]) newName = match[1].trim(); if (newName && newName !== state.detectedAnimeName) { state.detectedAnimeName = newName; const el=document.getElementById('detected-anime-name'); if(el)el.textContent=state.detectedAnimeName; logToPopup(`Detected anime: ${state.detectedAnimeName}`); attemptToMatchAndLoadCurrentPageDetection(); } else if (!state.detectedAnimeName && newName) { state.detectedAnimeName=newName; const el=document.getElementById('detected-anime-name'); if(el)el.textContent=state.detectedAnimeName; logToPopup(`Initial anime: ${state.detectedAnimeName}`); attemptToMatchAndLoadCurrentPageDetection(); }}
    function detectEpisode() { if (state.isEmbedded || state.ignorePageDetection) return; const txt = document.body.innerText; const regex = /You are watching\s*Episode\s*(\d+)/i; const match = txt.match(regex); let newEp = null; if (match&&match[1]) newEp = parseInt(match[1],10); if (newEp !== null && newEp !== state.detectedEpisode) { state.detectedEpisode=newEp; const el=document.getElementById('detected-episode'); if(el)el.textContent=state.detectedEpisode; logToPopup(`Detected ep: ${state.detectedEpisode}`); attemptToMatchAndLoadCurrentPageDetection(); } else if (state.detectedEpisode === null && newEp !== null) { state.detectedEpisode=newEp; const el=document.getElementById('detected-episode'); if(el)el.textContent=state.detectedEpisode; logToPopup(`Initial ep: ${state.detectedEpisode}`); attemptToMatchAndLoadCurrentPageDetection(); }}

    function hideElementAggressively(element, reason) { if (!element) return; element.style.setProperty('display', 'none', 'important'); element.style.setProperty('visibility', 'hidden', 'important'); element.style.setProperty('pointer-events', 'none', 'important'); console.log(`[Iframe] Hid: ${element.tagName}${element.id?'#'+element.id:''}${element.className?'.'+element.className.split(' ').join('.'):''} (${reason})`); }
    function disableTextTrack(track, reason) { if (!track || track.label === "Migaku Subtitles") return; track.mode = 'disabled'; console.log(`[Iframe] Disabled track: ${track.label} (${reason})`); }
    function findAndInitializeVideo() { if(!state.isEmbedded)return false;console.log('[Iframe] Finding video...');let v=document.querySelector('video');if(v){state.videoElement=v;let c=v.parentElement;while(c&&!c.classList.contains('jw-media')&&!c.classList.contains('plyr')&&c.tagName!=='BODY')c=c.parentElement;state.videoContainer=c||v.parentElement;if(window.getComputedStyle(state.videoContainer).position==='static')state.videoContainer.style.position='relative';state.videoContainer.classList.add('video-wrapper-migaku');document.addEventListener('fullscreenchange',handleFullscreenChangeIframe);document.addEventListener('webkitfullscreenchange',handleFullscreenChangeIframe);v.addEventListener('timeupdate',sendCurrentTimeToTop);const nS=state.videoContainer.querySelectorAll('.jw-texttrack-display,.jw-captions,.plyr__captions,.vjs-text-track-display');nS.forEach(e=>hideElementAggressively(e,'init find'));if(v.textTracks)Array.from(v.textTracks).forEach(t=>disableTextTrack(t,'init'));if(!state.mutationObserver&&state.videoContainer){state.mutationObserver=new MutationObserver(handleMutations);state.mutationObserver.observe(state.videoContainer,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});}observeTextTracks();sendMessage('videoFound');sendMessage('statusUpdate',{text:'Video found.'});console.log('[Iframe] Video initialized.');return true;}return false;}
    function handleFullscreenChangeIframe() { if(!state.isEmbedded)return;const isFs=!!(document.fullscreenElement||document.webkitFullscreenElement);sendMessage('fullscreenChange',{isFullscreen:isFs});console.log(`[Iframe] Fullscreen:${isFs}`);sendCurrentTimeToTop(); }
    function sendCurrentTimeToTop() { if(!state.isEmbedded||!state.videoElement||state.videoElement.readyState===0)return;sendMessage('currentTimeUpdate',{currentTime:state.videoElement.currentTime});}
    function handleMutations(mutationsList,observer){if(!state.isEmbedded)return;for(const m of mutationsList){if(m.type==='childList'){m.addedNodes.forEach(n=>{if(n.nodeType===1){if(n.matches('.jw-texttrack-display,.jw-captions,.plyr__captions,.vjs-text-track-display'))hideElementAggressively(n,'mut:added sub disp');if(n.tagName==='TRACK'&&state.videoElement&&state.videoElement.contains(n)){disableTextTrack(n,'mut:added track');observeTextTrack(n);}n.querySelectorAll('.jw-texttrack-display,.jw-captions,.plyr__captions,.vjs-text-track-display,track').forEach(el=>{if(el.tagName==='TRACK'){disableTextTrack(el,'mut:added track sub');observeTextTrack(el);}else hideElementAggressively(el,'mut:added sub disp sub');});}});}}if(state.videoElement?.textTracks)Array.from(state.videoElement.textTracks).forEach(t=>disableTextTrack(t,'mut:periodic'));}
    function observeTextTracks() { if(!state.isEmbedded||!state.videoElement?.textTracks)return;state.videoElement.textTracks.addEventListener('addtrack',(e)=>{const nT=e.track;disableTextTrack(nT,'addtrack');observeTextTrack(nT);});Array.from(state.videoElement.textTracks).forEach(t=>{disableTextTrack(t,'init obs');observeTextTrack(t);});}
    function observeTextTrack(track) { if(!state.isEmbedded||!track||!track.cues)return;const sendCues=()=>{if(!track.cues)return;const cuesData=Array.from(track.cues).map(c=>({start:c.startTime,end:c.endTime,text:c.text.replace(/<[^>]*>/g,'').trim()}));if(cuesData.length>0)sendMessage('nativeCues',{trackLabel:track.label,cues:cuesData});};if(track.cues.length>0)sendCues();else setTimeout(sendCues,2000);}
    function clearSubtitlesIframe() { if(!state.isEmbedded)return;console.log('[Iframe] Clearing state.');state.currentSubtitleIndex=-1;if(state.videoElement?.textTracks)Array.from(state.videoElement.textTracks).forEach(t=>disableTextTrack(t,'clear cmd'));}

    function parseSubRip(content) {const s=[];const r=/(\d+)\r?\n(\d{2}:\d{2}:\d{2}[,.]\d{3}) --> (\d{2}:\d{2}:\d{2}[,.]\d{3})\r?\n([\s\S]*?)(?=\r?\n\r?\n\d+\r?\n|\s*$)/g;let m;while((m=r.exec(content))!==null)s.push({id:parseInt(m[1]),start:timeToSeconds(m[2]),end:timeToSeconds(m[3]),text:m[4].trim().replace(/<[^>]*>/g,'').replace(/\{[^}]*\}/g,'').replace(/\r\n|\r|\n/g,'\n')});return s;}
    function parseWebVTT(content) {const s=[];const l=content.trim().split(/\r?\n\r?\n/);let id=1;let sI=l[0].includes('WEBVTT')?1:0;for(let i=sI;i<l.length;i++){const cL=l[i].split(/\r?\n/);const tLI=cL.findIndex(ln=>ln.includes('-->'));if(tLI===-1)continue;const tP=cL[tLI].split('-->');if(tP.length!==2)continue;s.push({id:id++,start:timeToSeconds(tP[0].trim()),end:timeToSeconds(tP[1].trim()),text:cL.slice(tLI+1).join('\n').replace(/<[^>]*>/g,'').trim()});}return s;}
    function parseASS(content) {const s=[];const l=content.split(/\r?\n/);let iE=false,fmt=[],id=1;for(const ln of l){const tr=ln.trim();if(tr==='[Events]'){iE=true;continue;}if(iE){if(tr.startsWith('Format:')){fmt=tr.substring(7).split(',').map(x=>x.trim());continue;}if(tr.startsWith('Dialogue:')){const p=parseASSLine(tr.substring(9).trim());if(p.length>=fmt.length){const sI=fmt.indexOf('Start'),eI=fmt.indexOf('End'),tI=fmt.indexOf('Text');if(sI!==-1&&eI!==-1&&tI!==-1)s.push({id:id++,start:timeToSeconds(p[sI]),end:timeToSeconds(p[eI]),text:p[tI].replace(/\\N/g,'\n').replace(/\{[^}]*\}/g,'').trim()});}}}}return s;}
    function parseASSLine(line) {const p=[];let cP='';let iQ=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch===','&&!iQ){p.push(cP);cP='';}else{if(ch==='"')iQ=!iQ;cP+=ch;}}if(cP)p.push(cP);return p;}
    function timeToSeconds(ts) {ts=ts.replace(',','.');const p=ts.split(':');let s=0;if(p.length===3)s=parseFloat(p[0])*3600+parseFloat(p[1])*60+parseFloat(p[2]);else if(p.length===2)s=parseFloat(p[0])*60+parseFloat(p[1]);else if(p.length===1)s=parseFloat(p[0]);return s;}

    // --- Initialization ---
    function initialize() {
        if (state.syncPoints.length > 0 && state.loadedSubtitleFileOriginalOffset === null) {
            state.calculatedOffset = calculateAverageOffset(state.syncPoints);
        } else if (state.loadedSubtitleFileOriginalOffset !== null) {
            state.calculatedOffset = state.loadedSubtitleFileOriginalOffset;
        } else {
            state.calculatedOffset = 0;
        }
        state.offset = state.calculatedOffset + state.manualOffset;

        if (!state.isEmbedded) {
            initializeController();
            logToPopup(`Migaku Script: Initializing (v${version})...`);
            if (state.activeSavedAnimeKey && state.savedAnimeData[state.activeSavedAnimeKey]) {
                if (!state.activeImportId && state.savedAnimeData[state.activeSavedAnimeKey].length > 0) {
                    state.activeImportId = state.savedAnimeData[state.activeSavedAnimeKey][0].importId; GM_setValue('migakuActiveImportId', state.activeImportId);
                }
                const importSession = state.savedAnimeData[state.activeSavedAnimeKey]?.find(s => s.importId === state.activeImportId);
                if (importSession?.files) {
                    state.subtitleFiles = JSON.parse(JSON.stringify(importSession.files)); populateManualSelectDropdownFromActiveImport();
                    logToPopup(`Restored: ${state.activeSavedAnimeKey} - ${importSession.importName}`);
                } else { state.activeSavedAnimeKey = null; state.activeImportId = null; GM_setValue('migakuActiveSavedAnime', null); GM_setValue('migakuActiveImportId', null); }
            } else { state.activeSavedAnimeKey = null; state.activeImportId = null; GM_setValue('migakuActiveSavedAnime', null); GM_setValue('migakuActiveImportId', null); }
            renderSavedAnimeList(); updateActiveSavedDisplay(); // Render UI based on restored state
            detectAnimeName(); detectEpisode(); // Perform initial detection
            // If after detection, no subs are loaded from an active session for the current episode, it will attempt to load.
            // If still nothing, display should be clear.
            if (state.subtitles.length === 0 && Object.keys(state.subtitleFiles).length > 0 && state.detectedEpisode !== null) {
                 attemptToMatchAndLoadCurrentPageDetection();
            } else if (state.subtitles.length === 0) {
                 clearCurrentSubtitlesOnly();
            }

            setInterval(() => {
                if(!state.iframeWindow){
                    const iframes=document.querySelectorAll('iframe');
                    for(const i of iframes){
                        try{
                            if(i.src&&(i.src.includes('megacloud.tv/embed')||i.src.includes('megacloud.blog/embed'))){
                                i.contentWindow.postMessage({source:'migaku-subtitle-importer',command:'handshake'},'*');
                                if(!document.body.classList.contains('in-embed-player')) document.body.classList.add('in-embed-player');
                            }
                        }catch(e){
                            console.error('Iframe access error',e);
                        }
                    }
                }
                if(!state.ignorePageDetection){
                    detectEpisode();
                    detectAnimeName();
                }
            },3000);
            const resObs = new ResizeObserver(() => requestAnimationFrame(updateSubtitleDisplay));
            resObs.observe(document.documentElement);
            document.addEventListener('fullscreenchange', handleFullscreenChangeTop); document.addEventListener('webkitfullscreenchange', handleFullscreenChangeTop);
            updateStatus('Searching for video player...'); logToPopup('Initialization complete.');
        } else {
            console.log(`Migaku Script (Iframe v${version}): Initializing.`);
            const found = findAndInitializeVideo();
            if (!found) state.subtitleCheckInterval = setInterval(() => { if (!state.videoElement) findAndInitializeVideo(); else { clearInterval(state.subtitleCheckInterval); state.subtitleCheckInterval = null; if(window.top) sendMessage('log', {text: 'Iframe video by interval.'});}}, 2000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', async () => {
            await loadStoredState();
            initialize();
        });
    } else {
        await loadStoredState();
        initialize();
    }
})();
