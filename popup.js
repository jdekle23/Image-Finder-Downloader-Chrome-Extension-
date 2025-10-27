const $ = (sel) => document.querySelector(sel);

$("#ping").onclick = () => chrome.runtime.sendMessage({ action: "ping" });

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0].id : null;
}

$("#scan").onclick = async () => {
  const params = {
    minWidth: parseInt($("#minW").value, 10) || 0,
    minHeight: parseInt($("#minH").value, 10) || 0,
    includeGalleries: $("#galleries").checked,
    autoInteract: $("#autoInteract").checked,
    forceZoom: $("#forceZoom").checked,
    maxThumbs: parseInt($("#maxThumbs").value, 10) || 8,
    delayMs: parseInt($("#delayMs").value, 10) || 450
  };

  $("#status").textContent = "Scanning for images…";
  $("#log").textContent = "";

  const tabId = await getActiveTabId();
  if (!tabId) {
    $("#status").textContent = "No active tab.";
    return;
  }
  chrome.runtime.sendMessage({ action: "findImages", tabId, ...params });
};

let foundUrls = [];

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "status") {
    $("#status").textContent = msg.text;
  }
  if (msg.action === "foundImages") {
    foundUrls = msg.urls || [];
    $("#status").textContent = `Found ${foundUrls.length} images.`;
    $("#log").textContent = foundUrls.join("\n");
  }
});

$("#download").onclick = async () => {
  if (!foundUrls.length) {
    $("#status").textContent = "Nothing to download.";
    return;
  }
  chrome.runtime.sendMessage({ action: "downloadImages", urls: foundUrls });
  $("#status").textContent = "Downloading…";
};
