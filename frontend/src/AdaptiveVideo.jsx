import { useEffect, useRef, useState } from "react";

const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@1.7.2/dist/hls.min.js";

function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (window.__quantxHlsPromise) return window.__quantxHlsPromise;
  window.__quantxHlsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${HLS_CDN}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Hls), { once: true });
      existing.addEventListener("error", reject, { once: true });
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
  const [preparing, setPreparing] = useState(false);
  const pollRef = useRef(null);
  const hlsStartedRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !fallbackSrc) return undefined;
    let cancelled = false;
    const stopPoll = () => { if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; } };
    const destroyHls = () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } };
    const directPlay = () => { if (cancelled) return; destroyHls(); video.src = fallbackSrc; video.load(); if (autoPlay) video.play().catch(() => {}); };
    const startHls = async () => {
      if (cancelled || hlsStartedRef.current || !src) return;
      hlsStartedRef.current = true; stopPoll(); setPreparing(false);
      const resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const wasPlaying = !video.paused;
      try {
        const Hls = await loadHls();
        if (cancelled || !Hls) return;
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src;
          video.addEventListener("loadedmetadata", () => { if (resumeAt > 0) { try { video.currentTime = resumeAt; } catch {} } if (wasPlaying || autoPlay) video.play().catch(() => {}); }, { once: true });
          return;
        }
        if (!Hls.isSupported()) return;
        const hls = new Hls({ enableWorker:true, capLevelToPlayerSize:true, startLevel:0, abrEwmaDefaultEstimate:120000, abrBandWidthFactor:0.8, abrBandWidthUpFactor:0.7, maxBufferLength:8, maxMaxBufferLength:20, backBufferLength:10, fragLoadingMaxRetry:4, manifestLoadingMaxRetry:3, levelLoadingMaxRetry:4 });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          if (cancelled) return; setLevels(data.levels || []);
          const restore=()=>{ if(resumeAt>0){try{video.currentTime=resumeAt}catch{}} if(wasPlaying||autoPlay)video.play().catch(()=>{}); };
          if(video.readyState>=1) restore(); else video.addEventListener("loadedmetadata",restore,{once:true});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if(cancelled || !data?.fatal) return;
          if(data.type===Hls.ErrorTypes.MEDIA_ERROR){try{hls.recoverMediaError();return}catch{}}
          hlsStartedRef.current=false; setLevels([]); setLevel(-1); directPlay();
        });
        hls.loadSource(src); hls.attachMedia(video);
      } catch { if(!cancelled){hlsStartedRef.current=false;directPlay();} }
    };
    const pollStatus = async () => {
      if(cancelled || hlsStartedRef.current || !src) return;
      try {
        const r=await fetch(src.replace(/\/master\.m3u8$/, "/status"), {cache:"no-store"});
        if(r.ok){ const d=await r.json(); if(d.ready){await startHls();return;} setPreparing(!!d.preparing); }
      } catch {}
      if(!cancelled&&!hlsStartedRef.current) pollRef.current=setTimeout(pollStatus,3000);
    };
    hlsStartedRef.current=false; setLevels([]); setLevel(-1); setPreparing(false); setError("");
    // Direct Telegram Range playback starts immediately. HLS preparation never blocks it.
    directPlay();
    pollStatus();
    return()=>{cancelled=true;stopPoll();destroyHls();video.removeAttribute("src");video.load();};
  }, [src, fallbackSrc, autoPlay]);

  const chooseLevel = e => { const next=Number(e.target.value); setLevel(next); if(hlsRef.current) hlsRef.current.currentLevel=next; };

  return (
    <div style={{ position:"relative", width:"100%", background:"#000", borderRadius:10, overflow:"hidden" }}>
      <video ref={videoRef} controls playsInline preload="auto" className={className}
        onError={() => { if (!hlsStartedRef.current && fallbackSrc) directFallback(videoRef.current, fallbackSrc, autoPlay); }}
        style={{ width:"100%", display:"block", background:"#000", ...style }} {...props} />
      {preparing && <div style={{ position:"absolute", top:10, left:10, zIndex:6, background:"rgba(0,0,0,.72)", color:"white", borderRadius:7, padding:"5px 8px", fontSize:10, fontWeight:700, pointerEvents:"none" }}>⚡ Playing now · Adaptive quality preparing…</div>}
      {levels.length > 0 && <select value={level} onChange={chooseLevel} aria-label="Video quality" style={{ position:"absolute", right:10, bottom:42, zIndex:5, background:"rgba(0,0,0,.78)", color:"white", border:"1px solid rgba(255,255,255,.2)", borderRadius:6, padding:"4px 7px", fontSize:11 }}>
        <option value={-1}>Auto</option>
        {levels.map((l,i)=><option key={`${l.height}-${i}`} value={i}>{l.height?`${l.height}p`:`${Math.round((l.bitrate||0)/1000)} kbps`}</option>)}
      </select>}
      {error && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", padding:20, color:"white", background:"rgba(0,0,0,.72)", textAlign:"center", fontSize:12, fontWeight:700 }}>{error}</div>}
    </div>
  );
}

function directFallback(video, fallbackSrc, autoPlay) { if (!video || !fallbackSrc) return; video.src=fallbackSrc; video.load(); if(autoPlay) video.play().catch(()=>{}); }
