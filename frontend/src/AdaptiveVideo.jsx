import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

const QUALITY_OPTIONS = [
  { id: "v0", label: "144p", note: "Best for very slow internet" },
  { id: "v1", label: "240p", note: "Balanced data use" },
  { id: "v2", label: "360p", note: "Better picture quality" },
];

export default function AdaptiveVideo({
  src,
  fallbackSrc,
  autoPlay = false,
  style,
  className,
  ...props
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const pollRef = useRef(null);
  const [mode, setMode] = useState(null);
  const [selectedQuality, setSelectedQuality] = useState(null);
  const [available, setAvailable] = useState([]);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [levels, setLevels] = useState([]);
  const [level, setLevel] = useState(-1);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mode !== "fast") return undefined;
    video.src = fallbackSrc || "";
    video.load();
    setError("");
    setPreparing(false);
    if (autoPlay) video.play().catch(() => {});
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }, [mode, fallbackSrc, autoPlay]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mode !== "slow" || !selectedQuality || !src) return undefined;

    let cancelled = false;
    let lastCount = 0;

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

    const targetIndex = QUALITY_OPTIONS.findIndex(q => q.id === selectedQuality);
    const target = targetIndex >= 0 ? targetIndex : 0;

    const startNativeHls = () => {
      if (cancelled || !video.canPlayType("application/vnd.apple.mpegurl")) return false;
      const variantUrl = src.replace(/\/master\.m3u8$/, `/${selectedQuality}/playlist.m3u8`);
      video.src = variantUrl;
      video.load();
      const onMetadata = () => {
        if (cancelled) return;
        setPreparing(false);
        setError("");
        if (autoPlay) video.play().catch(() => {});
      };
      video.addEventListener("loadedmetadata", onMetadata, { once: true });
      return true;
    };

    const startHls = count => {
      if (cancelled || hlsRef.current || count <= target) return;
      lastCount = count;
      if (!Hls.isSupported()) {
        startNativeHls();
        return;
      }
      setPreparing(true);
      setError("");

      const hls = new Hls({
        enableWorker: true,
        autoStartLoad: true,
        capLevelToPlayerSize: false,
        startLevel: target,
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
        const nextLevels = data.levels || [];
        setLevels(nextLevels);
        if (!nextLevels[target]) {
          setPreparing(true);
          return;
        }
        setLevel(target);
        hls.currentLevel = target;
        setPreparing(false);
        setError("");
        if (autoPlay) video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (cancelled || !data || !data.fatal) return;
        console.warn("QuantXDrive HLS error", data.type, data.details, data.fatal);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setPreparing(true);
          try { hls.startLoad(); } catch {}
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try { hls.recoverMediaError(); return; } catch {}
        }
        setPreparing(false);
        setError("HLS playback could not be started. Please retry.");
      });

      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (cancelled || hlsRef.current !== hls) return;
        hls.loadSource(src);
        hls.startLoad(0);
      });
    };

    const refreshManifest = count => {
      const hls = hlsRef.current;
      if (!hls || cancelled || count <= lastCount) return;
      lastCount = count;
      const resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const wasPlaying = !video.paused;
      try {
        hls.once(Hls.Events.MANIFEST_PARSED, (_, data) => {
          if (cancelled) return;
          const nextLevels = data.levels || [];
          setLevels(nextLevels);
          if (nextLevels[target]) {
            hls.currentLevel = target;
            setLevel(target);
            setPreparing(false);
            if (resumeAt > 0) { try { video.currentTime = resumeAt; } catch {} }
            if (wasPlaying || autoPlay) video.play().catch(() => {});
          }
        });
        hls.loadSource(`${src}?q=${count}`);
        hls.startLoad(0);
      } catch {}
    };

    const pollStatus = async () => {
      if (cancelled) return;
      try {
        const r = await fetch(src.replace(/\/master\.m3u8$/, "/status"), { cache: "no-store" });
        if (r.ok) {
          const d = await r.json();
          const names = Array.isArray(d.qualities) ? d.qualities : [];
          setAvailable(names);
          if (names.length > target && !hlsRef.current) startHls(names.length);
          else if (hlsRef.current && names.length > lastCount) refreshManifest(names.length);
          if (d.failed && !hlsRef.current) {
            setPreparing(false);
            setError("Could not prepare the low-bandwidth stream. Please retry.");
          }
        }
      } catch {}
      if (!cancelled) pollRef.current = setTimeout(pollStatus, 1200);
    };

    setPreparing(true);
    setError("");
    setLevels([]);
    setLevel(-1);
    pollStatus();

    return () => {
      cancelled = true;
      stopPoll();
      destroyHls();
      video.removeAttribute("src");
      video.load();
    };
  }, [mode, selectedQuality, src, autoPlay]);

  const chooseMode = nextMode => {
    setError("");
    setSelectedQuality(null);
    setAvailable([]);
    setLevels([]);
    setLevel(-1);
    setMode(nextMode);
  };

  const chooseQuality = quality => {
    setSelectedQuality(quality);
  };

  const chooseLevel = e => {
    const next = Number(e.target.value);
    setLevel(next);
    if (hlsRef.current) hlsRef.current.currentLevel = next;
  };

  return (
    <div style={{ position: "relative", width: "100%", background: "#000", borderRadius: 10, overflow: "hidden" }}>
      <video
        ref={videoRef}
        controls={!!mode}
        playsInline
        preload="metadata"
        className={className}
        style={{ width: "100%", display: "block", background: "#000", ...style }}
        {...props}
      />

      {!mode && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "linear-gradient(180deg,rgba(13,13,26,.82),rgba(13,13,26,.96))" }}>
          <div style={{ width: "min(420px,92%)", color: "white", textAlign: "center" }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>📶</div>
            <p style={{ fontSize: 18, fontWeight: 900 }}>How is your internet?</p>
            <p style={{ marginTop: 6, color: "#b9bdd2", fontSize: 12 }}>Choose the best playback method for this video.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
              <button onClick={() => chooseMode("slow")} style={{ border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "14px 10px", background: "rgba(255,255,255,.08)", color: "white", cursor: "pointer", textAlign: "left" }}>
                <div style={{ fontSize: 16, fontWeight: 900 }}>🐢 Slow Internet</div>
                <div style={{ marginTop: 4, fontSize: 10, color: "#b9bdd2" }}>Choose a low-data quality</div>
              </button>
              <button onClick={() => chooseMode("fast")} style={{ border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "14px 10px", background: "linear-gradient(135deg,#6c63ff,#8b83ff)", color: "white", cursor: "pointer", textAlign: "left" }}>
                <div style={{ fontSize: 16, fontWeight: 900 }}>🚀 Fast Internet</div>
                <div style={{ marginTop: 4, fontSize: 10, color: "rgba(255,255,255,.78)" }}>Play the original video directly</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === "slow" && !selectedQuality && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "linear-gradient(180deg,rgba(13,13,26,.9),rgba(13,13,26,.97))" }}>
          <div style={{ width: "min(440px,94%)", color: "white" }}>
            <button onClick={() => chooseMode(null)} style={{ background: "none", border: "none", color: "#b9bdd2", cursor: "pointer", fontSize: 12, marginBottom: 8 }}>← Change internet mode</button>
            <p style={{ fontSize: 18, fontWeight: 900 }}>Choose video quality</p>
            <p style={{ marginTop: 5, color: "#b9bdd2", fontSize: 11 }}>Lower quality uses much less data and works better on slow connections.</p>
            <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
              {QUALITY_OPTIONS.map(q => (
                <button key={q.id} onClick={() => chooseQuality(q.id)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", border: "1px solid rgba(255,255,255,.16)", borderRadius: 11, padding: "11px 13px", background: "rgba(255,255,255,.08)", color: "white", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ minWidth: 54, fontSize: 17, fontWeight: 900 }}>{q.label}</div>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 800 }}>{q.note}</div><div style={{ marginTop: 2, fontSize: 9, color: "#b9bdd2" }}>Select this quality</div></div>
                  <span style={{ fontSize: 15 }}>▶</span>
                </button>
              ))}
            </div>
            <p style={{ marginTop: 10, fontSize: 9, color: "#8d91a8" }}>Higher qualities may take a little longer to prepare the first time.</p>
          </div>
        </div>
      )}

      {mode === "slow" && selectedQuality && preparing && (
        <div style={{ position: "absolute", top: 10, left: 10, zIndex: 6, background: "rgba(0,0,0,.78)", color: "white", borderRadius: 8, padding: "6px 9px", fontSize: 11, fontWeight: 800, pointerEvents: "none" }}>
          ⚡ Preparing {QUALITY_OPTIONS.find(q => q.id === selectedQuality)?.label || selectedQuality}…
        </div>
      )}

      {mode === "slow" && selectedQuality && levels.length > 1 && (
        <select value={level} onChange={chooseLevel} aria-label="Video quality" style={{ position: "absolute", right: 10, bottom: 42, zIndex: 7, background: "rgba(0,0,0,.78)", color: "white", border: "1px solid rgba(255,255,255,.2)", borderRadius: 6, padding: "4px 7px", fontSize: 11 }}>
          {levels.map((l, i) => <option key={`${l.height}-${i}`} value={i}>{l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)} kbps`}</option>)}
        </select>
      )}

      {error && <div style={{ position: "absolute", inset: 0, zIndex: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, color: "white", background: "rgba(0,0,0,.72)", textAlign: "center", fontSize: 12, fontWeight: 700 }}>{error}</div>}
    </div>
  );
}
