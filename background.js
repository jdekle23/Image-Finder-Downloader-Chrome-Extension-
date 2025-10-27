// ---- tiny utils ----
function uniq(arr) { return Array.from(new Set(arr)); }
function isHttp(url) { return /^https?:/i.test(url); }
function setBadge(text) { chrome.action.setBadgeText({ text }); }
function clearBadge() { chrome.action.setBadgeText({ text: "" }); }

console.log("[worker] starting up");
chrome.runtime.onInstalled.addListener(() => console.log("[worker] onInstalled"));
chrome.runtime.onStartup.addListener(() => console.log("[worker] onStartup"));

function log(...args) { console.log("[worker]", ...args); }

async function runInPage(tabId, func, args=[]) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args
  });
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  (async () => {
    if (msg.action === "ping") {
      chrome.runtime.sendMessage({ action: "status", text: "Worker alive ✅" });
      setBadge("ON");
      setTimeout(clearBadge, 1500);
      return;
    }

    if (msg.action === "findImages") {
      const tabId = msg.tabId || sender?.tab?.id;
      if (!tabId) {
        chrome.runtime.sendMessage({ action: "status", text: "No active tab." });
        return;
      }

      const { minWidth, minHeight, includeGalleries, autoInteract, forceZoom, maxThumbs, delayMs } = msg;

      try {
        const urls = await runInPage(
          tabId,
          async (minW, minH, includeGalleries, autoInteract, forceZoom, maxThumbs, delayMs) => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            const absUrl = (u) => { try { return new URL(u, document.baseURI).href; } catch { return null; } };

            const pickFromSrcset = (srcset) => {
              if (!srcset) return null;
              let bestUrl = null, bestW = 0;
              srcset.split(",").forEach(part => {
                const m = part.trim().match(/(\S+)\s+(\d+)w/);
                if (m) {
                  const url = absUrl(m[1]);
                  const w = parseInt(m[2], 10);
                  if (w > bestW) { bestW = w; bestUrl = url; }
                } else {
                  const u = absUrl(part.trim().split(/\s+/)[0]);
                  if (u) { bestUrl = u; }
                }
              });
              return bestUrl;
            };

            const probe = (url) => new Promise(resolve => {
              const img = new Image();
              let done = false;
              const finish = (ok, w=0, h=0) => { if (!done) { done = true; resolve({ url, w, h, ok }); } };
              img.onload = () => finish(true, img.naturalWidth || 0, img.naturalHeight || 0);
              img.onerror = () => finish(false, 0, 0);
              try { img.referrerPolicy = "no-referrer"; } catch {}
              img.decoding = "async";
              img.src = url;
              setTimeout(() => finish(false, 0, 0), 6000);
            });

            const collectNow = () => {
              const found = new Set();
              const add = (u) => { if (u && !u.startsWith("data:")) found.add(absUrl(u)); };

              document.querySelectorAll("img").forEach(img => {
                add(img.src); add(img.currentSrc);
                if (img.srcset) add(pickFromSrcset(img.srcset));
                for (const attr of ["data-zoom-image","data-large","data-original","data-src","data-srcset"]) {
                  const v = img.getAttribute(attr);
                  if (v) add(attr.endsWith("srcset") ? pickFromSrcset(v) : v);
                }
              });

              document.querySelectorAll("picture source[srcset], picture source[src]").forEach(s => {
                const ss = s.getAttribute("srcset"); const s1 = s.getAttribute("src");
                if (ss) add(pickFromSrcset(ss));
                if (s1) add(s1);
              });

              if (includeGalleries) {
                const gallerySelectors = [
                  '[class*=\"gallery\"]','[id*=\"gallery\"]','[class*=\"carousel\"]','[id*=\"carousel\"]',
                  '[class*=\"slider\"]','[id*=\"slider\"]','[class*=\"lightbox\"]','[id*=\"lightbox\"]',
                  '[class*=\"thumb\"]','[class*=\"product-media\"]','[class*=\"product-gallery\"]',
                  '[class*=\"image\"]','[id*=\"image\"]','[class*=\"media\"]','[id*=\"media\"]'
                ];
                document.querySelectorAll(gallerySelectors.join(",")).forEach(root => {
                  root.querySelectorAll("*").forEach(n => {
                    const bg = getComputedStyle(n).backgroundImage;
                    if (bg && bg !== "none") {
                      [...bg.matchAll(/url\((['\"]?)(.*?)\1\)/g)].forEach(m => add(m[2]));
                    }
                  });
                });
              }

              // Meta
              document.querySelectorAll('meta[property=\"og:image\"],meta[name=\"twitter:image\"],meta[name=\"twitter:image:src\"]').forEach(m => add(m.getAttribute("content")));

              // Network resources since page load
              performance.getEntriesByType('resource').forEach(entry => {
                const u = entry.name;
                if (/\.(jpe?g|png|webp|gif|bmp|tiff?)($|\?)/i.test(u)) add(u);
              });

              return Array.from(found).filter(Boolean);
            };

            // Try to open expanded/zoom UI
            if (autoInteract) {
              const clickEl = (el) => el.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true}));
              // click an expand/zoom button/link if present
              const openers = Array.from(document.querySelectorAll('a,button')).filter(el => {
                const t = (el.textContent || "").toLowerCase();
                const ar = (el.getAttribute('aria-label') || "").toLowerCase();
                return t.includes("expanded view") || t.includes("open expanded") || t.includes("zoom") || ar.includes("zoom") || ar.includes("expand");
              });
              if (openers[0]) { clickEl(openers[0]); await sleep(delayMs); }
            }

            // Gather thumbnails and iterate
            let thumbs = Array.from(new Set([
              ...Array.from(document.querySelectorAll('[class*=\"thumb\"] img, [class*=\"thumbnail\"] img')),
              ...Array.from(document.querySelectorAll('[data-thumb] img, .slick-slide img, [class*=\"carousel\"] img, [class*=\"gallery\"] img'))
            ]));

            // If no thumbs, also try the left-rail images commonly used on retail PDPs
            if (thumbs.length === 0) {
              thumbs = Array.from(document.querySelectorAll('img')).filter(img => /thumb|carousel|gallery|nav/i.test(img.className + " " + (img.parentElement?.className || "")));
            }

            const collected = new Set();

            const mainViewer = () => {
              // Heuristic: the largest visible IMG
              const imgs = Array.from(document.querySelectorAll('img')).filter(i => i.offsetParent !== null);
              imgs.sort((a,b) => (b.clientWidth*b.clientHeight)-(a.clientWidth*a.clientHeight));
              return imgs[0] || null;
            };

            // Always process the initially selected image first
            const processStep = async (label) => {
              // Optionally try to trigger zoom
              if (forceZoom) {
                const target = mainViewer();
                if (target) {
                  const rect = target.getBoundingClientRect();
                  const x = rect.left + rect.width/2;
                  const y = rect.top + rect.height/2;
                  target.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
                  target.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
                  await sleep(Math.max(200, Math.floor(delayMs/2)));
                }
              }

              // collect resources and DOM candidates
              const candidates = collectNow();
              // size probe
              const results = await Promise.all(candidates.map(probe));
              results.forEach(r => {
                if (r.w >= minW && r.h >= minH) collected.add(r.url);
              });
            };

            await processStep("initial");

            for (let i = 0; i < Math.min(maxThumbs, thumbs.length); i++) {
              const t = thumbs[i];
              try {
                t.scrollIntoView({ block: 'center' });
                t.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true}));
                await sleep(delayMs);
                await processStep("thumb-"+i);
              } catch { /* ignore single step errors */ }
            }

            return Array.from(collected);
          },
          [minWidth, minHeight, includeGalleries, autoInteract, forceZoom, maxThumbs, delayMs]
        );

        log("found", urls.length, "images");
        chrome.runtime.sendMessage({ action: "foundImages", urls });
      } catch (e) {
        console.error("[worker] findImages error", e);
        chrome.runtime.sendMessage({ action: "status", text: "Error scanning images. See service worker console." });
      }
      return;
    }

    if (msg.action === "downloadImages" && Array.isArray(msg.urls)) {
      let i = 0;
      for (const rawUrl of msg.urls) {
        try {
          if (!isHttp(rawUrl)) continue;
          const u = new URL(rawUrl);
          let base = u.pathname.split("/").pop() || `image_${++i}`;
          if (!/\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(base)) {
            base = base.replace(/[^a-z0-9_\-\.]/gi, "_") + ".jpg";
          }
          chrome.downloads.download({ url: rawUrl, filename: base });
        } catch (e) {
          console.log("[worker] download skip", rawUrl, e);
        }
      }
      return;
    }
  })();
  return true;
});
