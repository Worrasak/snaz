// Finds lyrics for the current YouTube video and shows them over the player.
(() => {
  let settings = { ...SNAZ_DEFAULTS };
  const state = {
    videoId: null,
    query: '',
    status: 'idle', // 'idle' | 'searching' | 'found' | 'notfound' | 'error'
    error: '',
    label: '',
    lines: null, // synced [{ time, text }]
    plain: null, // plain text when there are no timestamps
    offset: 0,
    results: [],
  };
  let box = null;
  let raf = 0;
  let lastIndex = -2;

  const storageKey = (id) => `lyr:${id}`;
  const getVideoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const video = () => document.querySelector('video.html5-main-video') || document.querySelector('video');

  function setLyrics(text, label) {
    state.lines = parseLrc(text);
    state.plain = state.lines ? null : String(text).trim();
    state.label = label;
    state.status = state.lines || state.plain ? 'found' : 'notfound';
    lastIndex = -2;
    render();
  }

  function save() {
    const text = state.lines ? state.lines.map((l) => `[${fmt(l.time)}]${l.text}`).join('\n') : state.plain;
    chrome.storage.local.set({ [storageKey(state.videoId)]: { text, label: state.label, offset: state.offset } });
  }

  function fmt(t) {
    const m = Math.floor(t / 60);
    return `${String(m).padStart(2, '0')}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
  }

  function search(q) {
    state.query = q;
    state.status = 'searching';
    state.results = [];
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'lrclib-search', q }, (res) => {
        if (chrome.runtime.lastError || !res || res.error) {
          state.status = 'error';
          state.error = (res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '';
        } else {
          state.results = res.results;
          state.status = res.results.length ? 'idle' : 'notfound';
        }
        resolve();
      });
    });
  }

  const labelOf = (r) => `${r.artist} – ${r.track}`;

  function choose(r) {
    setLyrics(r.syncedLyrics || r.plainLyrics, labelOf(r));
    save();
  }

  // Video titles render a moment after SPA navigation; wait for the new one.
  async function readTitle(previous) {
    for (let i = 0; i < 20; i++) {
      const h1 = document.querySelector('ytd-watch-metadata h1');
      const title = h1 && h1.textContent.trim();
      if (title && title !== previous) return title;
      await new Promise((r) => setTimeout(r, 250));
    }
    return document.title;
  }

  async function readDuration() {
    for (let i = 0; i < 20; i++) {
      const v = video();
      if (v && v.duration > 0 && Number.isFinite(v.duration)) return v.duration;
      await new Promise((r) => setTimeout(r, 250));
    }
    return 0;
  }

  let previousTitle = '';
  async function load(id) {
    Object.assign(state, { videoId: id, status: 'idle', label: '', lines: null, plain: null, offset: 0, results: [], query: '' });
    render();
    if (!id || !settings.enabled || !settings.lyrics) return;

    const saved = (await chrome.storage.local.get(storageKey(id)))[storageKey(id)];
    if (state.videoId !== id) return;
    if (saved) {
      state.offset = saved.offset || 0;
      setLyrics(saved.text, saved.label);
      return;
    }

    const title = await readTitle(previousTitle);
    previousTitle = title;
    const channel = (document.querySelector('ytd-watch-metadata ytd-channel-name a') || {}).textContent || '';
    const duration = await readDuration();
    if (state.videoId !== id) return;
    await search(cleanTitle(title, channel.trim()));
    if (state.videoId !== id) return;
    const best = pickBest(state.results, duration);
    if (best) choose(best);
    else if (state.status !== 'error') state.status = 'notfound';
    render();
  }

  function ensureBox() {
    const player = document.querySelector('#movie_player') || (video() && video().parentElement);
    if (!player) return null;
    if (!box || box.parentElement !== player) {
      if (box) box.remove();
      box = document.createElement('div');
      box.className = 'snaz-lyrics';
      box.innerHTML = '<div class="cur"></div><div class="next"></div>';
      player.appendChild(box);
    }
    return box;
  }

  function render() {
    const visible = settings.enabled && settings.lyrics && state.status === 'found';
    if (!visible) {
      if (box) box.hidden = true;
      cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    const el = ensureBox();
    if (!el) return;
    el.hidden = false;
    el.classList.toggle('plain', !state.lines);
    if (!state.lines) {
      el.firstChild.textContent = '';
      el.lastChild.textContent = state.plain;
      return;
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    const v = video();
    if (!v || !box || !state.lines) return;
    const lines = state.lines;
    const t = v.currentTime + state.offset;
    const i = lineAt(lines, t);
    if (i !== lastIndex) {
      lastIndex = i;
      box.firstChild.textContent = i >= 0 ? lines[i].text : '';
      const next = lines.slice(i + 1).find((l) => l.text);
      box.lastChild.textContent = next ? next.text : '';
    }
    if (i >= 0) {
      const start = lines[i].time;
      const end = i + 1 < lines.length ? lines[i + 1].time : start + 4;
      // Don't stretch the sweep across instrumental gaps after a short line.
      const span = Math.min(end - start, 1 + lines[i].text.length * 0.2);
      box.firstChild.style.setProperty('--p', Math.min(Math.max((t - start) / span, 0), 1).toFixed(3));
    }
  }

  function publicState() {
    return {
      videoId: state.videoId,
      query: state.query,
      status: state.status,
      error: state.error,
      label: state.label,
      synced: !!state.lines,
      offset: state.offset,
      results: state.results.map((r) => ({ label: labelOf(r), duration: r.duration, synced: !!r.syncedLyrics })),
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('lyrics-')) return false;
    (async () => {
      switch (msg.type) {
        case 'lyrics-search':
          await search(msg.q);
          break;
        case 'lyrics-select':
          if (state.results[msg.index]) choose(state.results[msg.index]);
          break;
        case 'lyrics-offset':
          state.offset = Math.round((state.offset + msg.delta) * 10) / 10;
          lastIndex = -2;
          if (state.status === 'found') save();
          break;
        case 'lyrics-custom':
          setLyrics(msg.text, 'วางเอง');
          if (state.status === 'found') save();
          break;
        case 'lyrics-clear':
          await chrome.storage.local.remove(storageKey(state.videoId));
          previousTitle = '';
          await load(state.videoId);
          break;
      }
      reply(publicState());
    })();
    return true;
  });

  chrome.storage.sync.get(SNAZ_DEFAULTS, (stored) => {
    settings = { ...SNAZ_DEFAULTS, ...stored };
    load(getVideoId());
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const wasOn = settings.enabled && settings.lyrics;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
    const isOn = settings.enabled && settings.lyrics;
    if (isOn && !wasOn && state.status === 'idle' && !state.label) load(getVideoId());
    else render();
  });

  // YouTube navigates without reloading the page.
  setInterval(() => {
    const id = getVideoId();
    if (id !== state.videoId) load(id);
  }, 500);
})();
