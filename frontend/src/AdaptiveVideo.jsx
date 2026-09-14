import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

const QUALITY_OPTIONS = [
  { id: "v0", label: "144p", height: 144, note: "Best for very slow internet" },
  { id: "v1", label: "240p", height: 240, note: "Balanced data use" },
  { id: "v2", label: "360p", height: 360, note: "Low data, clearer picture" },
  { id: "v3", label: "480p", height: 480, note: "Good everyday quality" },
  { id: "v4", label: "720p", height: 720, note: "HD quality" },
  { id: "v5", label: "1080p", height: 1080, note: "Full HD quality" },
  { id: "v6", label: "1440p", height: 1440, note: "2K quality" },
  { id: "v7", label: "2160p", height: 2160, note: "4K quality" },
];

const QUALITY_BY_ID = Object.fromEntries(QUALITY_OPTIONS.map(q => [q.id, q]));

export default function AdaptiveVideo({ src, fallbackSrc, autoPlay = false, style, className, ...props }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const pollRef = useRef(null);
  const resumeTimeRef = useRef(0);
  const [mode, setMode] = useState(null);
  const [selectedQuality, setSelectedQuality] = useState(null);
  const [supported, setSupported] = useState(QUALITY_OPTIONS.map(q => q.id));
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mode !== "fast") return undefined;
    video.src = fallbackSrc || "";
    video.load();
    setError("");
    setPreparing(false);
    if (autoPlay) video.play().catch(() => {});
    return () => { video.removeAttribute("src"); video.load(); };
  }, [mode, fallbackSrc, autoPlay]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mode !== "slow" || !selectedQuality || !src) return undefined;
    let cancelled = false;

    const stopPoll = () => { if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; } };
    const destroyHls = () => { if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; } };
    const targetHeight = QUALITY_BY_ID[selectedQuality]?.height || 144;
    const resumeAt = resumeTimeRef.current;
    resumeTimeRef.current = 0;
    const variantUrl = src.replace(/\/master\.m3u8$/, `/${selectedQuality}/playlist.m3u8`);

    const setResume = () => {
      if (resumeAt > 0) { try { video.currentTime = resumeAt; } catch {} }
    };

    const startNativeHls = () => {
      if (cancelled || !video.canPlayType("application/vnd.apple.mpegurl")) return false;
      video.src = variantUrl;
      video.load();
      const onMetadata = () => {
        if (cancelled) return;
        setPreparing(false); setError(""); setResume();
        if (autoPlay || !video.paused) video.play().catch(() => {});
      };
      video.addEventListener("loadedmetadata", onMetadata, { once: true });
      return true;
    };

    const startHls = () => {
      if (cancelled || hlsRef.current) return;
      if (!Hls.isSupported()) { startNativeHls(); return; }
      setPreparing(true); setError("");
      const hls = new Hls({
        enableWorker: true,
        autoStartLoad: true,
        startLevel: 0,
        abrEwmaDefaultEstimate: 120000,
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.7,
        maxBufferLength: 8,
        maxMaxBufferLength: 20,
        backBufferLength: 10,
        fragLoadingMaxRetry: 10,
        manifestLoadingMaxRetry: 10,
        levelLoadingMaxRetry: 10,
        manifestLoadingRetryDelay: 1000,
        levelLoadingRetryDelay: 1000,
        fragLoadingRetryDelay: 500,
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        if (cancelled) return;
        const height = data?.levels?.[0]?.height;
        if (height && Math.abs(height - targetHeight) > 4) {
          setError(`Server returned ${height}p instead of ${QUALITY_BY_ID[selectedQuality]?.label}.`);
          setPreparing(false);
          return;
        }
        hls.currentLevel = 0;
        setPreparing(false); setError(""); setResume();
        if (autoPlay || !video.paused) video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (cancelled || !data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { setPreparing(true); try { hls.startLoad(); } catch {} return; }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { try { hls.recoverMediaError(); return; } catch {} }
        setPreparing(false); setError("This quality could not be played. Try another quality.");
      });
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (cancelled || hlsRef.current !== hls) return;
        hls.loadSource(variantUrl);
        hls.startLoad(0);
      });
    };

    const pollStatus = async () => {
      if (cancelled) return;
      try {
        const separator = src.includes("?") ? "&" : "?";
        const statusUrl = `${src.replace(/\/master\.m3u8$/, "/status")}${separator}quality=${encodeURIComponent(selectedQuality)}`;
        const r = await fetch(statusUrl, { cache: "no-store" });
        if (r.ok) {
          const d = await r.json();
          const names = Array.isArray(d.qualities) ? d.qualities : [];
          const nextSupported = Array.isArray(d.supported) && d.supported.length ? d.supported : QUALITY_OPTIONS.map(q => q.id);
          setSupported(nextSupported);
          if (names.includes(selectedQuality)) startHls();
          else setPreparing(true);
          if (d.failed && !names.includes(selectedQuality)) {
            setPreparing(false);
            setError(`Could not prepare ${QUALITY_BY_ID[selectedQuality]?.label || selectedQuality}. Try another quality.`);
          }
        }
      } catch {}
      if (!cancelled) pollRef.current = setTimeout(pollStatus, 1500);
    };

    setPreparing(true); setError(""); pollStatus();
    return () => {
      cancelled = true; stopPoll();
      if (Number.isFinite(video.currentTime)) resumeTimeRef.current = video.currentTime;
      destroyHls(); video.removeAttribute("src"); video.load();
    };
  }, [mode, selectedQuality, src, autoPlay]);

  const chooseMode = nextMode => {
    if (videoRef.current && Number.isFinite(videoRef.current.currentTime)) resumeTimeRef.current = videoRef.current.currentTime;
    setError(""); setSelectedQuality(null); setSupported(QUALITY_OPTIONS.map(q => q.id)); setMode(nextMode);
  };

  const chooseQuality = quality => {
    if (quality === selectedQuality && hlsRef.current) return;
    if (videoRef.current && Number.isFinite(videoRef.current.currentTime)) resumeTimeRef.current = videoRef.current.currentTime;
    setError(""); setSelectedQuality(quality);
  };

  const visibleQualities = QUALITY_OPTIONS.filter(q => supported.includes(q.id));
  const scrollPanel = { width: "min(440px,94%)", maxHeight: "100%", overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", touchAction: "pan-y", padding: "8px 4px 14px" };

  return (
    <div style={{ position: "relative", width: "100%", background: "#000", borderRadius: 10, overflow: "hidden" }}>
      <video ref={videoRef} controls={!!mode} playsInline preload="metadata" className={className} style={{ width: "100%", display: "block", background: "#000", ...style }} {...props} />

      {!mode && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, background: "linear-gradient(180deg,rgba(13,13,26,.9),rgba(13,13,26,.97))" }}>
          <div style={{ ...scrollPanel, color: "white", textAlign: "center" }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>📶</div>
            <p style={{ fontSize: 18, fontWeight: 900 }}>How is your internet?</p>
            <p style={{ marginTop: 6, color: "#b9bdd2", fontSize: 12 }}>Choose the best playback method for this video.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
              <button onClick={() => chooseMode("slow")} style={{ minHeight: 82, border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "14px 10px", background: "rgba(255,255,255,.08)", color: "white", cursor: "pointer", textAlign: "left", touchAction: "manipulation" }}><div style={{ fontSize: 16, fontWeight: 900 }}>🐢 Slow Internet</div><div style={{ marginTop: 4, fontSize: 10, color: "#b9bdd2" }}>Choose a low-data quality</div></button>
              <button onClick={() => chooseMode("fast")} style={{ minHeight: 82, border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "14px 10px", background: "linear-gradient(135deg,#6c63ff,#8b83ff)", color: "white", cursor: "pointer", textAlign: "left", touchAction: "manipulation" }}><div style={{ fontSize: 16, fontWeight: 900 }}>🚀 Fast Internet</div><div style={{ marginTop: 4, fontSize: 10, color: "rgba(255,255,255,.78)" }}>Play the original video directly</div></button>
            </div>
          </div>
        </div>
      )}

      {mode === "slow" && !selectedQuality && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 10, background: "linear-gradient(180deg,rgba(13,13,26,.93),rgba(13,13,26,.98))" }}>
          <div style={{ ...scrollPanel, color: "white" }}>
            <button onClick={() => chooseMode(null)} style={{ background: "none", border: "none", color: "#b9bdd2", cursor: "pointer", fontSize: 12, marginBottom: 6, padding: "8px 2px", touchAction: "manipulation" }}>← Change internet mode</button>
            <p style={{ fontSize: 18, fontWeight: 900, margin: "4px 0" }}>Choose video quality</p>
            <p style={{ margin: "5px 0 12px", color: "#b9bdd2", fontSize: 11 }}>Swipe up/down to see all qualities.</p>
            <div style={{ display: "grid", gap: 8 }}>
              {visibleQualities.map(q => <button key={q.id} onClick={() => chooseQuality(q.id)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 66, border: "1px solid rgba(255,255,255,.16)", borderRadius: 11, padding: "11px 13px", background: "rgba(255,255,255,.08)", color: "white", cursor: "pointer", textAlign: "left", touchAction: "manipulation" }}><div style={{ minWidth: 60, fontSize: 17, fontWeight: 900 }}>{q.label}</div><div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 800 }}>{q.note}</div><div style={{ marginTop: 2, fontSize: 9, color: "#b9bdd2" }}>Tap to select</div></div><span style={{ fontSize: 15 }}>▶</span></button>)}
            </div>
          </div>
        </div>
      )}

      {mode === "slow" && selectedQuality && <>
        {preparing && <div style={{ position: "absolute", top: 10, left: 10, zIndex: 6, background: "rgba(0,0,0,.78)", color: "white", borderRadius: 8, padding: "6px 9px", fontSize: 11, fontWeight: 800, pointerEvents: "none" }}>⚡ Preparing {QUALITY_BY_ID[selectedQuality]?.label || selectedQuality}…</div>}
        <select value={selectedQuality} onChange={e => chooseQuality(e.target.value)} aria-label="Video quality" style={{ position: "absolute", right: 10, bottom: 42, zIndex: 7, background: "rgba(0,0,0,.85)", color: "white", border: "1px solid rgba(255,255,255,.2)", borderRadius: 6, padding: "5px 8px", fontSize: 11, maxWidth: 90 }}>{visibleQualities.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}</select>
        <button onClick={() => chooseMode(null)} style={{ position: "absolute", top: 10, right: 10, zIndex: 7, border: "1px solid rgba(255,255,255,.2)", borderRadius: 7, padding: "6px 9px", background: "rgba(0,0,0,.72)", color: "white", cursor: "pointer", fontSize: 10, touchAction: "manipulation" }}>Change mode</button>
      </>}

      {error && <div style={{ position: "absolute", inset: 0, zIndex: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, color: "white", background: "rgba(0,0,0,.72)", textAlign: "center", fontSize: 12, fontWeight: 700 }}>{error}</div>}
    </div>
  );
}
