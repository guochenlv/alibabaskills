function keepAlive() {
  if (!chrome.runtime || !chrome.runtime.id) return;
  try {
    const port = chrome.runtime.connect({ name: 'keepalive' });
    port.onDisconnect.addListener(() => {
      if (chrome.runtime && chrome.runtime.id) setTimeout(keepAlive, 1000);
    });
  } catch (error) {
    // Extension reloaded: this page must be refreshed to inject a fresh content script.
  }
}

keepAlive();
