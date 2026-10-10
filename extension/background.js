// Fetches lyrics for the content script; the extension's host permission
// lets this bypass CORS, which a content script on youtube.com can't.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.type !== 'lrclib-search') return false;
  fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(msg.q)}`, {
    headers: { 'Lrclib-Client': 'Snaz Karaoke (https://github.com/Worrasak/snaz)' },
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then(
      (data) => reply({
        results: data.slice(0, 20).map((r) => ({
          artist: r.artistName,
          track: r.trackName,
          duration: r.duration,
          syncedLyrics: r.syncedLyrics || null,
          plainLyrics: r.plainLyrics || null,
        })),
      }),
      (err) => reply({ error: String(err.message || err) }),
    );
  return true;
});
