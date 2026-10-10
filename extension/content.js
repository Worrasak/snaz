// Routes the YouTube <video> audio through the vocal remover.
//
// Content scripts run on youtube.com itself, so the video's MediaSource stream
// is same-origin and createMediaElementSource() can read it without CORS issues.
(() => {
  let settings = { ...SNAZ_DEFAULTS };
  let ctx = null;
  let ctxReady = null;
  let mode = 'idle'; // 'idle' | 'worklet' | 'fallback'
  // A media element can only be wrapped by one source node, ever.
  const chains = new WeakMap();
  let currentVideo = null;

  function findVideo() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function ensureContext() {
    if (!ctxReady) {
      ctx = new AudioContext({ latencyHint: 'playback' });
      ctxReady = ctx.audioWorklet
        .addModule(chrome.runtime.getURL('vocal-remover-worklet.js'))
        .then(() => 'worklet')
        .catch((err) => {
          console.warn('[Snaz Karaoke] AudioWorklet unavailable, using simple filter mode', err);
          return 'fallback';
        });
    }
    return ctxReady;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function workletChain() {
    const node = new AudioWorkletNode(ctx, 'vocal-remover', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions: settings,
    });
    return { input: node, output: node, update: (s) => node.port.postMessage(s) };
  }

  // Classic L-R cancellation inside the vocal band, used if the worklet fails.
  function fallbackChain() {
    const input = new GainNode(ctx);
    const output = new GainNode(ctx);
    const dry = new GainNode(ctx);
    const wet = new GainNode(ctx);
    input.connect(dry).connect(output);
    wet.connect(output);

    const low = new BiquadFilterNode(ctx, { type: 'lowpass' });
    const high = new BiquadFilterNode(ctx, { type: 'highpass' });
    input.connect(low).connect(wet);
    input.connect(high).connect(wet);

    const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    const left = new GainNode(ctx, { gain: 0.5 });
    const right = new GainNode(ctx, { gain: -0.5 });
    const side = new GainNode(ctx);
    input.connect(split);
    split.connect(left, 0);
    split.connect(right, 1);
    left.connect(side);
    right.connect(side);
    const bandLow = new BiquadFilterNode(ctx, { type: 'highpass' });
    const bandHigh = new BiquadFilterNode(ctx, { type: 'lowpass' });
    const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    side.connect(bandLow).connect(bandHigh);
    bandHigh.connect(merge, 0, 0);
    bandHigh.connect(merge, 0, 1);
    merge.connect(wet);

    const update = (s) => {
      const amount = s.enabled ? s.strength : 0;
      dry.gain.value = 1 - amount;
      wet.gain.value = amount;
      low.frequency.value = s.lowHz;
      bandLow.frequency.value = s.lowHz;
      high.frequency.value = s.highHz;
      bandHigh.frequency.value = s.highHz;
    };
    update(settings);
    return { input, output, update };
  }

  // Makes up the loudness lost with the vocal, with a limiter so peaks don't clip.
  function withBoost(chain) {
    const boost = new GainNode(ctx);
    const limiter = new DynamicsCompressorNode(ctx, { knee: 4, attack: 0.002, release: 0.15 });
    chain.output.connect(boost).connect(limiter);
    const update = (s) => {
      chain.update(s);
      const on = s.enabled && s.strength > 0;
      boost.gain.value = on ? Math.pow(10, s.boostDb / 20) : 1;
      // Ratio 1 makes the compressor a no-op while karaoke is off.
      limiter.threshold.value = on ? -3 : 0;
      limiter.ratio.value = on ? 12 : 1;
    };
    update(settings);
    return { input: chain.input, output: limiter, update };
  }

  async function hook() {
    const video = findVideo();
    if (!video) return;
    currentVideo = video;
    if (chains.has(video)) {
      chains.get(video).update(settings);
      resume();
      return;
    }
    // Leave YouTube untouched until karaoke is switched on for the first time.
    if (!settings.enabled) return;

    mode = await ensureContext();
    if (chains.has(video)) return;
    const chain = withBoost(mode === 'worklet' ? workletChain() : fallbackChain());
    ctx.createMediaElementSource(video).connect(chain.input);
    chain.output.connect(ctx.destination);
    chains.set(video, chain);
    video.addEventListener('play', resume);
    resume();
    console.info(`[Snaz Karaoke] active (${mode} mode)`);
  }

  chrome.storage.sync.get(SNAZ_DEFAULTS, (stored) => {
    settings = { ...SNAZ_DEFAULTS, ...stored };
    hook();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
    hook();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === 'snaz-status') {
      reply({ mode, hasVideo: !!findVideo(), contextState: ctx ? ctx.state : 'none' });
    }
  });

  // YouTube is a single-page app; the player element can be swapped on navigation.
  document.addEventListener('yt-navigate-finish', hook);
  new MutationObserver(() => {
    if (!currentVideo || !currentVideo.isConnected) hook();
  }).observe(document.documentElement, { childList: true, subtree: true });
  // Autoplay policy may start the context suspended; any user gesture unlocks it.
  document.addEventListener('pointerdown', resume, true);
  document.addEventListener('keydown', resume, true);
})();
