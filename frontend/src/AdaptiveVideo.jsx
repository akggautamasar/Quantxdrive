import { useEffect, useRef, useState } from "react";

const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@1.7.2/dist/hls.min.js";

function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (window.__quantxHlsPromise) return window.__quantxHlsPromise;
  window.__quantxHlsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${HLS_CDN}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Hls));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.src = HLS_CDN;
    script.async = true;
    script.onload = () => resolve(window.Hls);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return window.__quantxHlsPromise;
}

export default function AdaptiveVideo({ src, fallbackSrc, autoPlay = false, style, className, ...props }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const fallbackUsedRef = useRef(false);
  const [levels, setLevels] = useState([]);
  const [level, setLevel] = useState(-1);
  const [error, setError] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return undefined;
    let cancelled = false;
    const cleanup = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute("src");
      video.load();
    };

    const useFallback = () => {
      if (cancelled || !fallbackSrc || fallbackUsedRef.current) return false;
      fallbackUsedRef.current = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      setLevels([]);
      setLevel(-1);
      setError("");
      video.src = fallbackSrc;
      video.load();
      if (autoPlay) video.play().catch(() => {});
      return true;
    };

    fallbackUsedRef.current = false;
    setError("");
    setLevels([]);
    setLevel(-1);

    const start = async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        if (autoPlay) video.play().catch(() => {});
        return;
      }
      try {
        const Hls = await loadHls();
        if (cancelled || !Hls || !Hls.isSupported()) {
          if (!useFallback()) setError("This browser cannot play the video.");
          return;
        }
        const hls = new Hls({
          enableWorker: true,
          capLevelToPlayerSize: true,
          maxBufferLength: 12,
          maxMaxBufferLength: 30,
          backBufferLength: 20,
          abrEwmaDefaultEstimate: 180000,
          abrBandWidthFactor: 0.72,
          abrBandWidthUpFactor: 0.65,
          startLevel: -1,
          autoStartLoad: true,
          fragLoadingMaxRetry: 3,
          manifestLoadingMaxRetry: 2,
          levelLoadingMaxRetry: 2,
        });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          if (cancelled) return;
          setLevels(data.levels || []);
          if (autoPlay) video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data?.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            if (!hlsRef.current || hlsRef.current !== hls) return;
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            useFallback();
            if (!fallbackSrc) setError("Video stream could not be loaded. Please retry.");
          }
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      } catch {
        if (!cancelled && !useFallback()) setError("Unable to load the video.");
      }
    };

    start();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [src, fallbackSrc, autoPlay]);

  const chooseLevel = e => {
    const next = Number(e.target.value);
    setLevel(next);
    if (hlsRef.current) hlsRef.current.currentLevel = next;
  };

  return (
    <div style={{ position: "relative", width: "100%", background: "#000", borderRadius: 10, overflow: "hidden" }}>
      <video ref={videoRef} controls playsInline preload="metadata" className={className}
        onError={() => {
          if (!fallbackUsedRef.current && fallbackSrc) {
            const video = videoRef.current;
            if (video) {
              fallbackUsedRef.current = true;
              if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
              setLevels([]);
              video.src = fallbackSrc;
              video.load();
              if (autoPlay) video.play().catch(() => {});
            }
          }
        }}
        style={{ width: "100%", display: "block", background: "#000", ...style }} {...props} />
      {levels.length > 0 && (
        <select value={level} onChange={chooseLevel} aria-label="Video quality"
          style={{ position: "absolute", right: 10, bottom: 42, zIndex: 5, background: "rgba(0,0,0,.75)", color: "white", border: "1px solid rgba(255,255,255,.2)", borderRadius: 6, padding: "4px 7px", fontSize: 11 }}>
          <option value={-1}>Auto</option>
          {levels.map((l, i) => <option key={`${l.height}-${i}`} value={i}>{l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)} kbps`}</option>)}
        </select>
      )}
      {error && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, color: "white", background: "rgba(0,0,0,.72)", textAlign: "center", fontSize: 12, fontWeight: 700 }}>{error}</div>}
    </div>
  );
}
