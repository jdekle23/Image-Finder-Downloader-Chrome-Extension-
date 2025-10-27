# Image Finder & Downloader (Chrome Extension)
Download images from websites quickly and easily.

High-res image scraper for product pages. It automatically opens the gallery/lightbox, iterates thumbnails, triggers zoom when needed, and collects **true** large assets (e.g. ≥1000×1000).

<p align="center">
  <img src="assets/screenshot_popup.png" alt="Popup UI screenshot" width="420"/>
</p>

## ✨ Features
- Filters by **minimum width/height** (e.g. 1000×1000).
- **Auto-interact:** open expanded/zoom view and click through thumbnails.
- Captures images from `img/srcset`, `<picture>`, lazy-load `data-*`, CSS backgrounds, **and** network requests during interaction.
- Shadow-DOM aware traversal.
- Downloads with sensible filenames.
- Optional gallery/background scan.

## 🔧 Install (Developer mode)
1. Download the repo ZIP and extract, or `git clone` it.
2. Visit `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** → select the `extension/` folder.

## 🚀 Usage
1. Open a product page with a gallery.
2. Click the extension icon.
3. Set **Min Width/Height** (e.g., `1000`).
4. Keep **Include gallery** and **Auto open & iterate thumbnails** checked.
5. Optionally **Force zoom** and adjust **Max Thumbs** / **Delay** if needed.
6. Click **Find Images** → then **Download Found**.

> Tip: If a site is slow to swap images in the lightbox, increase the delay to 600-800ms.

## 🧠 How it works
- Injects a scanning function into the page context using the Extensions Scripting API.
- Triggers smooth scroll to wake lazy loaders.
- Optionally simulates clicks to open expanded view and step through thumbnails.
- After each step, scrapes DOM candidates **and** inspects recent `performance` entries (network) for image URLs.
- Loads each candidate in memory and checks **intrinsic dimensions** before accepting.

## 🔐 Permissions
- `activeTab`, `tabs`: interact with the current tab for scanning.
- `scripting`: injects the page-scanner.
- `downloads`: saves found images.
- Host permissions for `http/https`: scan public pages.

