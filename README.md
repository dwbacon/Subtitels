# Chrome Extension Conversion

This repository contains a Chrome extension that locates video elements on supported pages and provides a simple UI for configuring per-site settings.

## Loading the Extension
1. Open the Chrome Extensions page (`chrome://extensions`).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the `extension` directory from this repository.

The extension now uses a custom detection script which scans for `<video>` elements, including inside shadow DOM roots. Configuration can be edited via the extension's options page.
