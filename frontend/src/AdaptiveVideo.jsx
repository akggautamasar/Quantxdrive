import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

export default function AdaptiveVideo({ src, fallbackSrc, autoPlay = false, style, className, ...props }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [levels, setLevels] = useState([]);
  const [level, setLevel] = useState(-1);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const pollRef = useRef(null);
  const hlsStartedRef = useRef(false);
  const qualityCountRef = useRef(0);
  const lastReadyRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !fallbackSrc) return undefined;
    let cancelled = false;

    const stopPoll = () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };

    const destroyHls = () => {
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch {}
        hlsRef.current = null;
      }
    };

    const directPlay = () => {
      if (cancelled) return;
      destroyHls();
      hlsStartedRef.current = false;
      qualityCountRef.current = 0;
      video.src = fallbackSrc;
      video.load();
      if (autoPlay) video.play().catch(() => {});
    };

    const reloadHlsManifest = count => {
      if (cancelled || !hlsStartedRef.current || !src || count <= qualityCountRef.current) return;
      const resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const wasPlaying = !video.paused;
      qualityCountRef.current = count;
      const nextSrc = `${src}${src.includes("?") ? "&" : "?"}q=${count}`;

      if (hlsRef.current) {
        try {
          hlsRef.current.loadSource(nextSrc);
          hlsRef.current.attachMedia(video);
          const restore = () => {
            if (resumeAt > 0) {
              try { video.currentTime = resumeAt; } catch {}
            }
            if (wasPlaying || autoPlay) video.play().catch(() => {});
          };
          if (video.readyState >= 1) restore();
          else video.addEventListener("loadedmetadata", restore, { once: true });
          return;
        } catch {}
      }

      video.src = nextSrc;
      video.load();
      const restore = () => {
        if (resumeAt > 0) {
          try { video.currentTime = resumeAt; } catch {}
        }
        if (wasPlaying || autoPlay) video.play().catch(() => {});
      };
      video.addEventListener("loadedmetadata", restore, { once: true });
    };

    const startHls = async initialCount => {
      if (cancelled || hlsStartedRef.current || !src) return;
      hlsStartedRef.current = true;
      qualityCountRef.current = Math.max(1, initialCount || 1);
      setPreparing(true);
      setError("");
      const resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const wasPlaying = !video.paused;

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.addEventListener("loadedmetadata", () => {
          if (cancelled) return;
          if (resumeAt > 0) { try { video.currentTime = resumeAt; } catch {} }
          setPreparing(false);
          if (wasPlaying || autoPlay) video.play().catch(() => {});
        }, { once: true });
        return;
      }

      if (!Hls.isSupported()) {
        hlsStartedRef.current = false;
        setPreparing(false);
        setError("This browser cannot play HLS video.");
        directPlay();
        return;
      }

      const hls = new Hls({
        enableWorker: true,
        capLevelToPlayerSize: true,
        startLevel: 0,
        abrEwmaDefaultEstimate: 120000,
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.7,
        maxBufferLength: 8,
        maxMaxBufferLength: 20,
        backBufferLength: 10,
        fragLoadingMaxRetry: 6,
        manifestLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1000,
        levelLoadingRetryDelay: 1000,
        fragLoadingRetryDelay: 500,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        if (cancelled) return;
        setLevels(data.levels || []);
        setPreparing(false);
        setError("");
        const restore = () => {
          if (resumeAt > 0) { try { video.currentTime = resumeAt; } catch {} }
          if (wasPlaying || autoPlay) video.play().catch(() => {});
        };
        if (video.readyState >= 1) restore();
        else video.addEventListener("loadedmetadata", restore, { once: true });
      });

      hls.on(Hls.Events.LEVEL_LOADED, () => {
        if (!cancelled) setPreparing(false);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (cancelled || !data) return;
        console.warn("QuantXDrive HLS error", data.type, data.details, data.fatal);
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setPreparing(true);
          try { hls.startLoad(); } catch {}
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try { hls.recoverMediaError(); return; } catch {}
        }
        setPreparing(false);
        setError("HLS playback could not be started. Retrying…");
        try { hls.destroy(); } catch {}
        hlsRef.current = null;
        hlsStartedRef.current = false;
      });

      hls.loadSource(src);
      hls.attachMedia(video);
    };

    const pollStatus = async () => {
      if (cancelled || !src) return;
      try {
        const r = await fetch(src.replace(/\/master\.m3u8$/, "/status"), { cache: "no-store" });
        if (r.ok) {
          const d = await r.json();
          const count = Array.isArray(d.qualities) ? d.qualities.length : 0;
          const ready = !!d.ready || count > 0;
          lastReadyRef.current = ready;
          setPreparing(!!d.preparing && count < 3);
          if (!hlsStartedRef.current && ready) {
            await startHls(count || 1);
          } else if (hlsStartedRef.current && count > qualityCountRef.current) {
            reloadHlsManifest(count);
          }
          if (d.failed && !d.ready) {
            setPreparing(false);
            setError("Preparing the video stream…");
          }
        }
      } catch {}
      if (!cancelled) pollRef.current = setTimeout(pollStatus, 1500);
    };

    hlsStartedRef.current = false;
    qualityCountRef.current = 0;
    lastReadyRef.current = false;
    setLevels([]);
    setLevel(-1);
    setPreparing(true);
    setError("");

    // Keep the direct source as an immediate fallback, but never depend on an
    // external CDN for HLS. HLS.js is bundled with the Vercel build.
    directPlay();
    pollStatus();

    return () => {
      cancelled = true;
      stopPoll();
      destroyHls();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, fallbackSrc, autoPlay]);

  const chooseLevel = e => {
    const next = Number(e.target.value);
    setLevel(next);
    if (hlsRef.current) hlsRef.current.currentLevel = next;
  };

  return (
    <div style={{ position: "relative", width: "100%", background: "#000", borderRadius: 10, overflow: "hidden" }}>
      <video
        ref={videoRef}
        controls
        playsInline
        preload="auto"
        className={className}
        onError={() => {
          if (!hlsStartedRef.current && fallbackSrc) directFallback(videoRef.current, fallbackSrc, autoPlay);
        }}
        style={{ width: "100%", display: "block", background: "#000", ...style }}
        {...props}
      />
      {preparing && <div style={{ position: "absolute", top: 10, left: 10, zIndex: 6, background: "rgba(0,0,0,.72)", color: "white", borderRadius: 7, padding: "5px 8px", fontSize: 10, fontWeight: 700, pointerEvents: "none" }}>⚡ Preparing adaptive stream…</div>}
      {levels.length > 0 && <select value={level} onChange={chooseLevel} aria-label="Video quality" style={{ position: "absolute", right: 10, bottom: 42, zIndex: 5, background: "rgba(0,0,0,.78)", color: "white", border: "1px solid rgba(255,255,255,.2)", borderRadius: 6, padding: "4px 7px", fontSize: 11 }}>
        <option value={-1}>Auto</option>
        {levels.map((l, i) => <option key={`${l.height}-${i}`} value={i}>{l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)} kbps`}</option>)}
      </select>}
      {error && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, color: "white", background: "rgba(0,0,0,.72)", textAlign: "center", fontSize: 12, fontWeight: 700 }}>{error}</div>}
    </div>
  );
}

function directFallback(video, fallbackSrc, autoPlay) {
  if (!video || !fallbackSrc) return;
  video.src = fallbackSrc;
  video.load();
  if (autoPlay) video.play().catch(() => {});
}
