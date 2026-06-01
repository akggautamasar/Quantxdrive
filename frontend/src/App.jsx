import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const EXPIRY_OPTIONS = [
  { label: "30 seconds",  value: 30 },
  { label: "5 minutes",   value: 300 },
  { label: "30 minutes",  value: 1800 },
  { label: "1 hour",      value: 3600 },
  { label: "6 hours",     value: 21600 },
  { label: "12 hours",    value: 43200 },
  { label: "1 day",       value: 86400 },
  { label: "3 days",      value: 259200 },
  { label: "1 week",      value: 604800 },
  { label: "1 month",     value: 2592000 },
  { label: "3 months",    value: 7776000 },
  { label: "1 year",      value: 31536000 },
  { label: "5 years",     value: 157680000 },
  { label: "Never",       value: 3153600000 },
];

const CATEGORIES = [
  { key: null,              label: "All",      emoji: "🗂️" },
  { key: "__favorites",     label: "Favorites",emoji: "⭐" },
  { key: "__folders",       label: "Folders",  emoji: "📁" },
  { key: "photos",          label: "Photos",   emoji: "🖼️" },
  { key: "videos",          label: "Videos",   emoji: "🎬" },
  { key: "audio",           label: "Audio",    emoji: "🎵" },
  { key: "pdfs",            label: "PDFs",     emoji: "📄" },
  { key: "word_excel",      label: "Office",   emoji: "📊" },
  { key: "call_recordings", label: "Calls",    emoji: "📞" },
  { key: "other_files",     label: "Other",    emoji: "📦" },
];

const COLORS = {
  photos:          { bg: "#ede9ff", text: "#6c63ff", glow: "rgba(108,99,255,0.2)" },
  videos:          { bg: "#fff0f3", text: "#ff4d6d", glow: "rgba(255,77,109,0.2)" },
  audio:           { bg: "#e6fdf6", text: "#00b894", glow: "rgba(0,184,148,0.2)" },
  pdfs:            { bg: "#fff4e6", text: "#e67e22", glow: "rgba(230,126,34,0.2)" },
  word_excel:      { bg: "#e6faf4", text: "#00a878", glow: "rgba(0,168,120,0.2)" },
  call_recordings: { bg: "#fdf0f8", text: "#d63384", glow: "rgba(214,51,132,0.2)" },
  other_files:     { bg: "#f0eeff", text: "#7c6fcd", glow: "rgba(124,111,205,0.2)" },
};
const getColor = c => COLORS[c] || { bg: "#f0eeff", text: "#6c63ff", glow: "rgba(108,99,255,0.2)" };

const getKind = file => {
  const m = file.mime || ""; const n = (file.filename || "").toLowerCase();
  if (m.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(n)) return "image";
  if (m.startsWith("video/") || /\.(mp4|mkv|webm|mov|m4v|avi|3gp)$/.test(n)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|wav|flac|aac|ogg|m4a|opus)$/.test(n)) return "audio";
  if (m.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".epub")) return "epub";
  if (m.includes("word") || m.includes("excel") || /\.(doc|docx|xls|xlsx|ppt|pptx)$/.test(n)) return "office";
  if (m.startsWith("text/") || /\.(txt|md|log|json|csv|xml|html|js|py|css)$/.test(n)) return "text";
  return "other";
};
const getEmoji = k => ({ image:"🖼️", video:"🎬", audio:"🎵", pdf:"📄", epub:"📚", office:"📊", text:"📝", other:"📦" }[k] || "📦");
const fmtSize = b => !b ? "—" : b < 1024*1024 ? `${(b/1024).toFixed(0)} KB` : b < 1024*1024*1024 ? `${(b/(1024*1024)).toFixed(1)} MB` : `${(b/(1024*1024*1024)).toFixed(2)} GB`;
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "";
const fmtTime = t => { if (!t || !isFinite(t)) return "0:00"; const m = Math.floor(t/60); const s = Math.floor(t%60); return `${m}:${s.toString().padStart(2,"0")}`; };
const stripExt = name => name.replace(/\.[^/.]+$/, "");

// ── Login ─────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  const [slowWakeup, setSlowWakeup] = useState(false);
  const submit = async () => {
    setLoading(true); setErr(""); setSlowWakeup(false);
    const wakeTimer = setTimeout(() => setSlowWakeup(true), 5000);
    try {
      const res = await fetch(`${API}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
      clearTimeout(wakeTimer); setSlowWakeup(false);
      if (!res.ok) throw new Error();
      const { token } = await res.json();
      localStorage.setItem("ad_token", token); onLogin(token);
    } catch { clearTimeout(wakeTimer); setSlowWakeup(false); setErr("Wrong password"); }
    setLoading(false);
  };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse 80% 60% at 20% 80%, #ede9ff 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 80% 20%, #ffeef3 0%, transparent 50%), #f0f2f8", overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", top: "10%", left: "5%", width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, rgba(108,99,255,0.12), transparent)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "15%", right: "8%", width: 240, height: 240, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,101,132,0.1), transparent)", pointerEvents: "none" }} />
      <div style={{ width: "min(400px, 92vw)", padding: "48px 40px", background: "rgba(255,255,255,0.9)", borderRadius: 24, boxShadow: "0 20px 60px rgba(108,99,255,0.18), 0 2px 8px rgba(0,0,0,0.06)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.8)", display: "flex", flexDirection: "column", gap: 20, animation: "fadeIn 0.4s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, background: "linear-gradient(135deg,#6c63ff,#ff6584)", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "white", boxShadow: "0 6px 20px rgba(108,99,255,0.4)" }}>✦</div>
          <div>
            <p style={{ fontWeight: 900, fontSize: 22, color: "#1a1a2e" }}>AirDrive</p>
            <p style={{ fontSize: 11, color: "#8b8fa8", fontWeight: 600 }}>Telegram-powered cloud</p>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input type="password" placeholder="Enter password…" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            style={{ background: "#f5f6fa", border: "2px solid #e4e7f0", borderRadius: 12, padding: "13px 16px", fontSize: 14, fontWeight: 600, color: "#1a1a2e", outline: "none", transition: "border 0.2s" }}
            onFocus={e => e.target.style.borderColor = "#6c63ff"}
            onBlur={e => e.target.style.borderColor = "#e4e7f0"}
            autoFocus />
          <button style={{ background: "linear-gradient(135deg,#6c63ff,#8b83ff)", color: "white", border: "none", borderRadius: 12, padding: "13px", fontWeight: 800, fontSize: 14, cursor: "pointer", boxShadow: "0 6px 20px rgba(108,99,255,0.35)", transition: "transform 0.1s, box-shadow 0.1s", opacity: loading ? 0.8 : 1 }}
            onClick={submit} disabled={loading}
            onMouseDown={e => e.currentTarget.style.transform = "scale(0.98)"}
            onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
          >{loading ? "Unlocking…" : "🔓 Unlock"}</button>
        </div>
        {slowWakeup && <div style={{ color: "#e67e22", fontSize: 12, fontWeight: 700, background: "#fff8f0", padding: "10px 14px", borderRadius: 10, border: "1px solid #fde8c8" }}>⏳ Waking up backend… takes ~30 s on first load.</div>}
        {err && <div style={{ color: "#d63384", fontSize: 12, fontWeight: 700, background: "#fff0f6", padding: "10px 14px", borderRadius: 10, border: "1px solid #ffd6e7" }}>❌ {err}</div>}
      </div>
    </div>
  );
}

// ── Equalizer bars ────────────────────────────────────────────────────────────
function EqBars({ playing }) {
  const barStyle = (delay, animName) => ({
    width: 3, borderRadius: 2,
    background: "linear-gradient(180deg, #6c63ff, #00b894)",
    animationName: playing ? animName : "none",
    animationDuration: "0.8s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationDelay: delay,
    height: playing ? undefined : 4,
  });
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 18 }}>
      <div style={barStyle("0s", "eq1")} />
      <div style={barStyle("0.15s", "eq2")} />
      <div style={barStyle("0.3s", "eq3")} />
      <div style={barStyle("0.45s", "eq1")} />
    </div>
  );
}

// ── File Card ─────────────────────────────────────────────────────────────────
function Card({ file, token, onPreview, onFav, onMenu, nowPlayingId }) {
  const kind = getKind(file); const col = getColor(file.category);
  const url = `${API}/api/media/${token}/${file.id}`;
  const isPlaying = nowPlayingId === file.id;
  const isLarge = file.size > 20 * 1024 * 1024;
  const dlProps = isLarge && file.tg_link
    ? { href: file.tg_link, target: "_blank", rel: "noopener noreferrer" }
    : { href: url, download: file.filename };

  return (
    <div className="card-hover" style={{ ...S.card, borderColor: isPlaying ? "#6c63ff" : file.favorite ? "#ffc107" : "#e8eaf2", boxShadow: isPlaying ? "0 0 0 2px rgba(108,99,255,0.3), 0 4px 16px rgba(108,99,255,0.15)" : undefined }} onClick={() => onPreview(file)}>
      <div style={{ ...S.thumb, background: kind === "image" ? "#000" : col.bg }}>
        {kind === "image"
          ? <img src={url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.target.style.display = "none"; e.target.parentNode.style.background = col.bg; }} />
          : kind === "audio"
            ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <div style={{ width: 50, height: 50, borderRadius: "50%", background: `linear-gradient(135deg, ${col.text}, #6c63ff)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, animation: isPlaying ? "spin-disc 4s linear infinite" : "none", boxShadow: isPlaying ? `0 0 16px ${col.glow}` : "none" }}>🎵</div>
                {isPlaying && <EqBars playing={true} />}
              </div>
            : <span style={{ fontSize: 38 }}>{getEmoji(kind)}</span>
        }
        <button onClick={e => { e.stopPropagation(); onFav(file); }} style={{ position: "absolute", top: 6, left: 6, background: file.favorite ? "rgba(255,193,7,0.2)" : "rgba(0,0,0,0.35)", border: "none", borderRadius: 6, fontSize: 14, cursor: "pointer", lineHeight: 1, padding: "3px 5px", backdropFilter: "blur(4px)", color: file.favorite ? "#ffc107" : "rgba(255,255,255,0.8)" }}>
          {file.favorite ? "★" : "☆"}
        </button>
        {isPlaying && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#6c63ff,#ff6584,#00b894)", backgroundSize: "200% 100%", animation: "gradShift 2s linear infinite" }} />}
      </div>
      <div style={{ padding: "8px 10px 4px" }}>
        <p style={S.fname} title={file.filename}>{file.filename}</p>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8b8fa8", fontWeight: 600 }}>
          <span>{fmtSize(file.size)}</span><span>{fmtDate(file.date)}</span>
        </div>
      </div>
      <div style={{ padding: "4px 8px 8px", display: "flex", gap: 5, justifyContent: "flex-end" }}>
        <button onClick={e => { e.stopPropagation(); onMenu(file); }} style={{ ...S.smallBtn, background: "#f0f2f8", color: "#6b6b72" }}>⋯</button>
        {file.tg_link && (
          <a href={file.tg_link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            title="Open in Telegram" style={{ ...S.smallBtn, background: "#e8f4fd", color: "#229ED9", textDecoration: "none" }}>✈</a>
        )}
        <a {...dlProps} onClick={e => e.stopPropagation()} style={{ ...S.smallBtn, background: col.bg, color: col.text, textDecoration: "none" }}>↓</a>
      </div>
    </div>
  );
}

// ── Audio Player ──────────────────────────────────────────────────────────────
function AudioPlayer({ nowPlaying, setNowPlaying, token }) {
  const audioRef = useRef(null);
  const progressRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => parseFloat(localStorage.getItem("vol") || "0.9"));
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("none");
  const [isLoading, setIsLoading] = useState(false);

  const track = nowPlaying?.file;
  const queue = nowPlaying?.queue || [];
  const qIdx = nowPlaying?.index ?? -1;

  const goNext = useCallback(() => {
    if (!queue.length) return;
    let next;
    if (shuffle) next = Math.floor(Math.random() * queue.length);
    else if (qIdx < queue.length - 1) next = qIdx + 1;
    else if (repeat === "all") next = 0;
    else return;
    setNowPlaying({ file: queue[next], queue, index: next });
  }, [queue, qIdx, shuffle, repeat, setNowPlaying]);

  const goPrev = useCallback(() => {
    if (audioRef.current && currentTime > 3) { audioRef.current.currentTime = 0; return; }
    if (qIdx > 0) setNowPlaying({ file: queue[qIdx - 1], queue, index: qIdx - 1 });
  }, [currentTime, queue, qIdx, setNowPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!track || !audio) return;
    setIsLoading(true);
    setCurrentTime(0); setDuration(0);
    audio.src = `${API}/api/media/${token}/${track.id}`;
    audio.volume = volume;
    audio.load();
    audio.play().catch(() => {});
  }, [track?.id, token]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(audio.currentTime);
    const onDur = () => { setDuration(audio.duration || 0); setIsLoading(false); };
    const onWait = () => setIsLoading(true);
    const onCan = () => setIsLoading(false);
    const onEnd = () => { if (repeat === "one") { audio.currentTime = 0; audio.play(); } else goNext(); };
    audio.addEventListener("play", onPlay); audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTime); audio.addEventListener("durationchange", onDur);
    audio.addEventListener("waiting", onWait); audio.addEventListener("canplay", onCan);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("play", onPlay); audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTime); audio.removeEventListener("durationchange", onDur);
      audio.removeEventListener("waiting", onWait); audio.removeEventListener("canplay", onCan);
      audio.removeEventListener("ended", onEnd);
    };
  }, [repeat, goNext]);

  useEffect(() => {
    if (!track) return;
    const onKey = e => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      const audio = audioRef.current;
      if (!audio) return;
      if (e.code === "Space") { e.preventDefault(); isPlaying ? audio.pause() : audio.play(); }
      if (e.code === "ArrowRight" && !e.shiftKey) { e.preventDefault(); audio.currentTime = Math.min(duration, audio.currentTime + 10); }
      if (e.code === "ArrowLeft" && !e.shiftKey) { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 10); }
      if (e.code === "ArrowRight" && e.shiftKey) goNext();
      if (e.code === "ArrowLeft" && e.shiftKey) goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [track, isPlaying, duration, goNext, goPrev]);

  const togglePlay = () => { const a = audioRef.current; if (!a) return; isPlaying ? a.pause() : a.play(); };
  const handleSeek = e => {
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect || !duration || !audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
  };
  const handleVol = e => {
    const v = parseFloat(e.target.value);
    setVolume(v); if (audioRef.current) audioRef.current.volume = v;
    localStorage.setItem("vol", v);
  };
  const nextRepeat = () => setRepeat(r => r === "none" ? "all" : r === "all" ? "one" : "none");
  const progress = duration ? (currentTime / duration) * 100 : 0;

  if (!track) return <audio ref={audioRef} style={{ display: "none" }} />;
  const trackName = stripExt(track.filename);

  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 300, height: 76, background: "rgba(12,12,28,0.96)", backdropFilter: "blur(24px)", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 0, boxShadow: "0 -4px 40px rgba(0,0,0,0.5)" }}>
      <audio ref={audioRef} style={{ display: "none" }} />
      <div ref={progressRef} onClick={handleSeek} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, cursor: "pointer", background: "rgba(255,255,255,0.08)", zIndex: 1 }}>
        <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#6c63ff,#ff6584)", transition: "width 0.15s", borderRadius: "0 2px 2px 0" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 20px", width: "clamp(180px, 25%, 280px)", flexShrink: 0 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg,#6c63ff,#ff6584)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, animation: isPlaying ? "spin-disc 5s linear infinite" : "none", boxShadow: isPlaying ? "0 0 18px rgba(108,99,255,0.6), 0 0 36px rgba(108,99,255,0.2)" : "0 2px 8px rgba(0,0,0,0.4)", transition: "box-shadow 0.4s", position: "relative" }}>
          🎵
          <div style={{ position: "absolute", inset: "20%", borderRadius: "50%", background: "rgba(12,12,28,0.6)" }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ color: "white", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170, marginBottom: 2 }}>{trackName}</p>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{fmtSize(track.size)}</p>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "0 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setShuffle(s => !s)} title="Shuffle" style={{ ...S.pCtrl, color: shuffle ? "#6c63ff" : "rgba(255,255,255,0.35)", fontSize: 15 }}>⇄</button>
          <button onClick={goPrev} title="Previous (Shift+←)" style={{ ...S.pCtrl, fontSize: 18, color: "rgba(255,255,255,0.7)" }}>⏮</button>
          <button onClick={togglePlay} title="Play/Pause (Space)" style={{ width: 44, height: 44, borderRadius: "50%", border: "none", cursor: "pointer", background: "linear-gradient(135deg,#6c63ff,#ff6584)", color: "white", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(108,99,255,0.6)", transition: "transform 0.1s", flexShrink: 0 }}
            onMouseDown={e => e.currentTarget.style.transform = "scale(0.92)"}
            onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
          >
            {isLoading ? <span style={{ animation: "spin 0.8s linear infinite", display: "inline-block" }}>⌛</span> : isPlaying ? "⏸" : "▶"}
          </button>
          <button onClick={goNext} title="Next (Shift+→)" style={{ ...S.pCtrl, fontSize: 18, color: "rgba(255,255,255,0.7)" }}>⏭</button>
          <button onClick={nextRepeat} title="Repeat" style={{ ...S.pCtrl, color: repeat !== "none" ? "#6c63ff" : "rgba(255,255,255,0.35)", fontSize: 15, position: "relative" }}>
            {repeat === "one" ? "↺" : "⟳"}
            {repeat === "one" && <span style={{ position: "absolute", top: -3, right: -3, fontSize: 8, background: "#6c63ff", borderRadius: "50%", width: 10, height: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 900 }}>1</span>}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontVariantNumeric: "tabular-nums", minWidth: 32 }}>{fmtTime(currentTime)}</span>
          <EqBars playing={isPlaying} />
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "right" }}>{fmtTime(duration)}</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 20px", width: "clamp(160px, 22%, 250px)", flexShrink: 0, justifyContent: "flex-end" }}>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 14 }}>{volume === 0 ? "🔇" : volume < 0.4 ? "🔉" : "🔊"}</span>
        <input type="range" min="0" max="1" step="0.01" value={volume} onChange={handleVol} style={{ width: 72, accentColor: "#6c63ff" }} title="Volume" />
        {queue.length > 1 && <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, fontWeight: 700 }}>{qIdx + 1}/{queue.length}</span>}
        <button onClick={() => { audioRef.current?.pause(); setNowPlaying(null); }} title="Close player" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "rgba(255,255,255,0.5)", width: 30, height: 30, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.15)"}
          onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
        >✕</button>
      </div>
    </div>
  );
}

// ── Public Share View ─────────────────────────────────────────────────────────
function ShareView({ shareToken }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pwdInput, setPwdInput] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/shared/${shareToken}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setInfo(d); if (!d.password_protected) setPwd("__open__"); })
      .catch(() => setError("This link is invalid or has expired."))
      .finally(() => setLoading(false));
  }, [shareToken]);

  const verify = async () => {
    setVerifying(true); setPwdError("");
    try {
      const r = await fetch(`${API}/api/shared/${shareToken}/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwdInput }),
      });
      if (r.ok) setPwd(pwdInput);
      else setPwdError("Wrong password. Try again.");
    } catch { setPwdError("Network error."); }
    setVerifying(false);
  };

  const streamUrl = `${API}/api/shared/${shareToken}/stream${info?.password_protected && pwd && pwd !== "__open__" ? `?pwd=${encodeURIComponent(pwd)}` : ""}`;
  const kind = info ? getKind({ mime: info.mime, filename: info.filename }) : "other";
  const isUnlocked = !!pwd;

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f2f8" }}>
      <div style={{ width: 40, height: 40, border: "3px solid #e8eaf2", borderTopColor: "#6c63ff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse 80% 60% at 20% 80%, #ede9ff 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 80% 20%, #ffeef3 0%, transparent 50%), #f0f2f8", padding: 16 }}>
      <div style={{ width: "min(520px, 100%)", background: "rgba(255,255,255,0.95)", borderRadius: 20, boxShadow: "0 20px 60px rgba(108,99,255,0.18)", padding: "28px 28px 24px", animation: "fadeIn 0.4s ease" }}>
        {/* Branding */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, paddingBottom: 16, borderBottom: "1px solid #f0f2f8" }}>
          <div style={{ width: 34, height: 34, background: "linear-gradient(135deg,#6c63ff,#ff6584)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "white" }}>✦</div>
          <span style={{ fontWeight: 900, fontSize: 17, color: "#1a1a2e" }}>AirDrive</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#aab0c6", fontWeight: 700, background: "#f0f2f8", padding: "3px 10px", borderRadius: 20 }}>Shared File</span>
        </div>

        {error ? (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <span style={{ fontSize: 56 }}>🔗</span>
            <p style={{ fontWeight: 800, fontSize: 16, color: "#1a1a2e", marginTop: 14 }}>Link not available</p>
            <p style={{ color: "#8b8fa8", fontSize: 13, marginTop: 6 }}>{error}</p>
          </div>
        ) : info ? (
          <>
            {/* File card */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, background: "#f5f6fa", borderRadius: 14, padding: "14px 16px", marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: 12, background: getColor(info.category).bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0 }}>{getEmoji(kind)}</div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 800, fontSize: 14, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{info.filename}</p>
                <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "#8b8fa8", fontWeight: 600 }}>{fmtSize(info.size)}</span>
                  {info.category && <span style={{ fontSize: 11, color: "#8b8fa8", fontWeight: 600, textTransform: "capitalize" }}>{info.category.replace(/_/g, " ")}</span>}
                  {info.password_protected && <span style={{ fontSize: 10, fontWeight: 700, color: "#e67e22", background: "#fff8f0", padding: "1px 7px", borderRadius: 10, border: "1px solid #fde8c8" }}>🔒 Protected</span>}
                </div>
              </div>
            </div>

            {/* Password gate */}
            {info.password_protected && !pwd ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>🔒 Password required to access this file</p>
                <input
                  type="password" placeholder="Enter password…" value={pwdInput}
                  onChange={e => setPwdInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && verify()}
                  autoFocus
                  style={{ background: "#f5f6fa", border: "2px solid #e4e7f0", borderRadius: 10, padding: "12px 14px", fontSize: 13, fontWeight: 600, color: "#1a1a2e", outline: "none" }}
                  onFocus={e => e.target.style.borderColor = "#6c63ff"}
                  onBlur={e => e.target.style.borderColor = "#e4e7f0"}
                />
                {pwdError && <p style={{ color: "#d63384", fontSize: 12, fontWeight: 700 }}>{pwdError}</p>}
                <button onClick={verify} disabled={verifying || !pwdInput}
                  style={{ background: "linear-gradient(135deg,#6c63ff,#8b83ff)", color: "white", border: "none", borderRadius: 10, padding: "12px", fontWeight: 800, fontSize: 14, cursor: "pointer", boxShadow: "0 4px 14px rgba(108,99,255,0.3)" }}>
                  {verifying ? "Verifying…" : "🔓 Unlock"}
                </button>
              </div>
            ) : isUnlocked ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Inline preview */}
                {kind === "image" && (
                  <img src={streamUrl} alt={info.filename} style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 10, background: "#0d0d1a" }} />
                )}
                {kind === "video" && (
                  <video src={streamUrl} controls playsInline style={{ width: "100%", maxHeight: 320, borderRadius: 10, background: "#000" }} />
                )}
                {kind === "audio" && (
                  <div style={{ background: "#f5f6fa", borderRadius: 12, padding: "16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 60, height: 60, borderRadius: "50%", background: "linear-gradient(135deg,#6c63ff,#ff6584)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🎵</div>
                    <audio src={streamUrl} controls style={{ width: "100%" }} />
                  </div>
                )}
                {kind === "pdf" && (
                  <iframe src={streamUrl} style={{ width: "100%", height: 360, border: "none", borderRadius: 10 }} title={info.filename} />
                )}
                {/* Download button */}
                <a href={streamUrl} download={info.filename}
                  style={{ display: "block", textAlign: "center", background: "linear-gradient(135deg,#6c63ff,#8b83ff)", color: "white", textDecoration: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 14, boxShadow: "0 4px 14px rgba(108,99,255,0.3)" }}>
                  ↓ Download {info.filename}
                </a>
                {(kind === "pdf" || kind === "text") && (
                  <a href={streamUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: "block", textAlign: "center", background: "#f5f6fa", color: "#6c63ff", textDecoration: "none", borderRadius: 10, padding: "11px", fontWeight: 800, fontSize: 14, border: "1.5px solid #e8eaf2" }}>
                    👁 Open in Browser
                  </a>
                )}
              </div>
            ) : null}
          </>
        ) : null}

        <p style={{ fontSize: 10, color: "#d4d8eb", textAlign: "center", marginTop: 20, fontWeight: 600 }}>Powered by AirDrive · Telegram Cloud</p>
      </div>
    </div>
  );
}

// ── Action menu (3-dot) ───────────────────────────────────────────────────────
function ActionMenu({ file, token, folders, onClose, onFolderChange, onDelete }) {
  const [tab, setTab] = useState("share");
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [shareResult, setShareResult] = useState(null);
  const [shareExpiry, setShareExpiry] = useState(604800);
  const [sharePassword, setSharePassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newName, setNewName] = useState(file.filename);
  const [renaming, setRenaming] = useState(false);
  const [renameErr, setRenameErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const moveToFolder = async folderId => {
    await fetch(`${API}/api/files/${file.id}/folder`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ folder_id: folderId }) });
    onFolderChange(); onClose();
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreating(true);
    const res = await fetch(`${API}/api/folders`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: newFolderName.trim() }) });
    const f = await res.json(); await moveToFolder(f.id);
    setCreating(false); setNewFolderName("");
  };

  const genShare = async () => {
    setGenerating(true);
    const res = await fetch(`${API}/api/share/${file.id}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ expires_in: shareExpiry, password: sharePassword }),
    });
    const data = await res.json();
    const expiresAt = data.expires_at;
    const isNever = shareExpiry >= 3153600000;
    setShareResult({
      url: `${window.location.origin}/share/${data.share_token}`,
      expiresLabel: isNever ? "Never" : new Date(expiresAt * 1000).toLocaleString(),
      passwordProtected: !!sharePassword,
    });
    setGenerating(false);
  };

  const copy = () => { navigator.clipboard.writeText(shareResult.url); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleRename = async () => {
    const name = newName.trim();
    if (!name || name === file.filename) { setRenaming(false); return; }
    setRenaming(true); setRenameErr("");
    const r = await fetch(`${API}/api/files/${file.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: name }),
    });
    if (r.ok) { onFolderChange(); onClose(); }
    else { setRenameErr("Rename failed. Try again."); }
    setRenaming(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    await fetch(`${API}/api/files/${file.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    onDelete(file.id); onClose();
  };

  const TABS = [["share","🔗 Share"], ["folder","📁 Folder"], ["info","ℹ️ Info"]];

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <button style={S.modalClose} onClick={onClose}>✕</button>

        {/* File header */}
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #e8eaf2" }}>
          <p style={{ fontWeight: 800, fontSize: 13, color: "#1a1a2e", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.filename}</p>
          <p style={{ fontSize: 11, color: "#8b8fa8", marginTop: 2 }}>{fmtSize(file.size)} · {fmtDate(file.date)}</p>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid #e8eaf2" }}>
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: "10px 4px", background: "none", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", color: tab === k ? "#6c63ff" : "#8b8fa8", borderBottom: tab === k ? "2px solid #6c63ff" : "2px solid transparent", whiteSpace: "nowrap" }}>{l}</button>
          ))}
        </div>

        {/* ── Share tab ── */}
        {tab === "share" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {!shareResult ? (
              <>
                <div>
                  <label style={S.label}>Link expires after</label>
                  <select value={shareExpiry} onChange={e => setShareExpiry(Number(e.target.value))} style={{ ...S.input, padding: "9px 12px" }}>
                    {EXPIRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Password protection (optional)</label>
                  <div style={{ position: "relative" }}>
                    <input type={showPwd ? "text" : "password"} placeholder="Leave blank for public access…"
                      value={sharePassword} onChange={e => setSharePassword(e.target.value)}
                      style={{ ...S.input, padding: "9px 40px 9px 12px" }}
                      onFocus={e => e.target.style.borderColor = "#6c63ff"}
                      onBlur={e => e.target.style.borderColor = "#e8eaf2"}
                    />
                    <button onClick={() => setShowPwd(s => !s)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#aab0c6" }}>{showPwd ? "🙈" : "👁"}</button>
                  </div>
                </div>
                <button onClick={genShare} disabled={generating} style={S.btnP}>
                  {generating ? "⏳ Generating…" : "🔗 Generate Share Link"}
                </button>
              </>
            ) : (
              <>
                <div style={{ background: "#f5f6fa", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#6b6b72" }}>Access:</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: shareResult.passwordProtected ? "#e67e22" : "#00b894", background: shareResult.passwordProtected ? "#fff8f0" : "#e6fdf6", padding: "1px 8px", borderRadius: 20 }}>
                      {shareResult.passwordProtected ? "🔒 Password protected" : "🌐 Public"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#6b6b72" }}>Expires:</span>
                    <span style={{ fontSize: 11, color: "#1a1a2e", fontWeight: 600 }}>{shareResult.expiresLabel}</span>
                  </div>
                  <input value={shareResult.url} readOnly onClick={e => e.target.select()} style={{ ...S.input, padding: "8px 10px", fontSize: 11, background: "white", marginTop: 4 }} />
                </div>
                <button onClick={copy} style={{ ...S.btnP, background: copied ? "linear-gradient(135deg,#00b894,#00a878)" : undefined }}>
                  {copied ? "✓ Copied to clipboard!" : "📋 Copy Link"}
                </button>
                <button onClick={() => { setShareResult(null); setSharePassword(""); }} style={{ background: "#f5f6fa", border: "1.5px solid #e8eaf2", color: "#6b6b72", borderRadius: 10, padding: "9px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  ↩ Generate another
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Folder tab ── */}
        {tab === "folder" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
            <button onClick={() => moveToFolder(null)} style={{ ...S.listBtn, color: !file.folder_id ? "#6c63ff" : "#1a1a2e", fontWeight: !file.folder_id ? 800 : 600, borderColor: !file.folder_id ? "#c4beff" : "#e8eaf2" }}>
              📂 No folder {!file.folder_id && <span style={{ marginLeft: "auto", color: "#6c63ff" }}>✓</span>}
            </button>
            {folders.map(f => (
              <button key={f.id} onClick={() => moveToFolder(f.id)} style={{ ...S.listBtn, color: file.folder_id === f.id ? "#6c63ff" : "#1a1a2e", fontWeight: file.folder_id === f.id ? 800 : 600, borderColor: file.folder_id === f.id ? "#c4beff" : "#e8eaf2" }}>
                📁 {f.name} {file.folder_id === f.id && <span style={{ marginLeft: "auto", color: "#6c63ff" }}>✓</span>}
              </button>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="New folder name…" style={{ ...S.input, flex: 1, padding: "9px 12px", fontSize: 12 }}
                onKeyDown={e => e.key === "Enter" && createFolder()}
                onFocus={e => e.target.style.borderColor = "#6c63ff"}
                onBlur={e => e.target.style.borderColor = "#e8eaf2"} />
              <button onClick={createFolder} disabled={creating || !newFolderName.trim()} style={{ ...S.btnP, padding: "9px 14px", fontSize: 12 }}>+ Add</button>
            </div>
          </div>
        )}

        {/* ── Info tab ── */}
        {tab === "info" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Details */}
            <div style={{ background: "#f5f6fa", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
              {[["Filename", file.filename], ["Size", fmtSize(file.size)], ["Date", fmtDate(file.date)], ["Category", (file.category || "").replace(/_/g, " ")], ["MIME type", file.mime || "Unknown"]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 10 }}>
                  <span style={{ fontSize: 11, color: "#aab0c6", fontWeight: 700, minWidth: 72, flexShrink: 0 }}>{k}</span>
                  <span style={{ fontSize: 11, color: "#1a1a2e", fontWeight: 600, wordBreak: "break-all" }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Rename */}
            <div>
              <label style={S.label}>Rename</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={newName} onChange={e => setNewName(e.target.value)} style={{ ...S.input, flex: 1, padding: "9px 12px", fontSize: 12 }}
                  onKeyDown={e => e.key === "Enter" && handleRename()}
                  onFocus={e => e.target.style.borderColor = "#6c63ff"}
                  onBlur={e => e.target.style.borderColor = "#e8eaf2"} />
                <button onClick={handleRename} disabled={renaming || !newName.trim() || newName.trim() === file.filename} style={{ ...S.btnP, padding: "9px 14px", fontSize: 12 }}>✏️</button>
              </div>
              {renameErr && <p style={{ color: "#d63384", fontSize: 11, marginTop: 4 }}>{renameErr}</p>}
            </div>

            {/* Delete */}
            {!confirmDel ? (
              <button onClick={() => setConfirmDel(true)} style={{ background: "#fff0f6", border: "1.5px solid #ffd6e7", color: "#d63384", borderRadius: 10, padding: "10px 14px", fontWeight: 800, fontSize: 12, cursor: "pointer", textAlign: "left" }}>
                🗑 Remove from AirDrive index
              </button>
            ) : (
              <div style={{ background: "#fff0f6", border: "1.5px solid #ffd6e7", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#d63384" }}>Remove from index? The file stays in Telegram — only its entry in AirDrive is deleted.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={handleDelete} disabled={deleting} style={{ flex: 1, background: "linear-gradient(135deg,#d63384,#c2185b)", color: "white", border: "none", borderRadius: 8, padding: "9px", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                    {deleting ? "Removing…" : "Yes, Remove"}
                  </button>
                  <button onClick={() => setConfirmDel(false)} style={{ flex: 1, background: "#f5f6fa", border: "1.5px solid #e8eaf2", color: "#6b6b72", borderRadius: 8, padding: "9px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Preview Modal ─────────────────────────────────────────────────────────────
function Preview({ file, token, onClose }) {
  const kind = getKind(file); const url = `${API}/api/media/${token}/${file.id}`;
  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const inner = () => {
    if (kind === "image") return <img src={url} alt={file.filename} style={{ maxWidth: "100%", maxHeight: "78vh", objectFit: "contain" }} />;
    if (kind === "video") return <video src={url} controls autoPlay playsInline style={{ width: "100%", maxHeight: "78vh", background: "#000" }} />;
    if (kind === "pdf" || kind === "text") return <iframe src={url} style={{ width: "100%", height: "78vh", border: "none", background: "white" }} title={file.filename} />;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 48, background: "white", width: "100%" }}>
        <span style={{ fontSize: 64 }}>{getEmoji(kind)}</span>
        <p style={{ fontWeight: 800, fontSize: 16, marginTop: 14, color: "#1a1a2e" }}>{file.filename}</p>
        <p style={{ fontSize: 13, color: "#8b8fa8", marginTop: 6 }}>Preview not available</p>
        <a href={url} download={file.filename} style={{ ...S.btnP, marginTop: 20, textDecoration: "none" }}>↓ Download</a>
      </div>
    );
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <button style={S.modalClose} onClick={onClose}>✕</button>
        <p style={S.modalTitle}>{file.filename}</p>
        <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", background: kind === "image" || kind === "video" ? "#0d0d1a" : "white", minHeight: 250 }}>{inner()}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: "1px solid #e8eaf2", fontSize: 12, fontWeight: 600, color: "#8b8fa8", flexShrink: 0, flexWrap: "wrap" }}>
          <span>{fmtSize(file.size)}</span><span>{fmtDate(file.date)}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {file.tg_link && (
              <a href={file.tg_link} target="_blank" rel="noopener noreferrer" style={{ ...S.btnP, padding: "7px 14px", textDecoration: "none", fontSize: 12, background: "linear-gradient(135deg,#229ED9,#1a8bc4)", boxShadow: "0 4px 12px rgba(34,158,217,0.3)" }}>✈ Telegram</a>
            )}
            <a href={url} download={file.filename} style={{ ...S.btnP, padding: "7px 14px", textDecoration: "none", fontSize: 12 }}>↓ Download</a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ category, setCategory, stats, syncing, onSync, onClose, isMobile, getCount, folders, folder, setFolder }) {
  const totalSize = stats?.total_size || 0;
  const maxSize = 10 * 1024 * 1024 * 1024;
  const usagePct = Math.min(100, (totalSize / maxSize) * 100);

  return (
    <div style={{ ...S.sidebar, ...(isMobile ? S.mobileSb : {}) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16, borderBottom: "1px solid #e8eaf2", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, background: "linear-gradient(135deg,#6c63ff,#ff6584)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "white", boxShadow: "0 4px 14px rgba(108,99,255,0.35)" }}>✦</div>
          <div>
            <span style={{ fontWeight: 900, fontSize: 17, color: "#1a1a2e" }}>AirDrive</span>
            <p style={{ fontSize: 10, color: "#aab0c6", fontWeight: 600, lineHeight: 1 }}>Telegram Cloud</p>
          </div>
        </div>
        {isMobile && <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#8b8fa8" }}>✕</button>}
      </div>

      <button style={{ width: "100%", padding: "9px 14px", background: syncing ? "#e8eaf2" : "linear-gradient(135deg,#6c63ff,#8b83ff)", border: "none", borderRadius: 10, color: syncing ? "#6b6b72" : "white", fontSize: 12, fontWeight: 800, cursor: syncing ? "not-allowed" : "pointer", boxShadow: syncing ? "none" : "0 4px 14px rgba(108,99,255,0.3)", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        onClick={onSync} disabled={syncing}>
        <span style={{ display: "inline-block", animation: syncing ? "spin 1s linear infinite" : "none" }}>⟳</span>
        {syncing ? "Syncing…" : "Sync Files"}
      </button>

      <nav style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 10, flex: 1, overflowY: "auto" }}>
        {CATEGORIES.map(c => {
          const active = category === c.key;
          const col = (c.key && !c.key.startsWith("__")) ? getColor(c.key) : { bg: "#ede9ff", text: "#6c63ff" };
          const count = getCount(c.key);
          return (
            <button key={c.key || "all"}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12, width: "100%", background: active ? col.bg : "transparent", color: active ? col.text : "#6b6b72", fontWeight: active ? 800 : 600, transition: "all 0.15s", borderLeft: active ? `3px solid ${col.text}` : "3px solid transparent" }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#f5f6fa"; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
              onClick={() => { setCategory(c.key); if (isMobile) onClose(); }}>
              <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>{c.emoji}</span>
              <span style={{ flex: 1, textAlign: "left" }}>{c.label}</span>
              {count != null && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: active ? col.text : "#f0f2f8", color: active ? "white" : "#aab0c6" }}>{count.toLocaleString()}</span>}
            </button>
          );
        })}
      </nav>

      {stats && (
        <div style={{ borderTop: "1px solid #e8eaf2", paddingTop: 12, marginTop: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <p style={{ fontSize: 18, fontWeight: 900, background: "linear-gradient(135deg,#6c63ff,#ff6584)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              {stats.total_files?.toLocaleString()}
            </p>
            <p style={{ fontSize: 11, color: "#aab0c6", fontWeight: 600, alignSelf: "flex-end" }}>{fmtSize(totalSize)}</p>
          </div>
          <div style={{ height: 4, background: "#e8eaf2", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${usagePct}%`, background: "linear-gradient(90deg,#6c63ff,#ff6584)", borderRadius: 4, transition: "width 0.5s" }} />
          </div>
          <p style={{ fontSize: 10, color: "#aab0c6", marginTop: 4 }}>files · {usagePct.toFixed(1)}% of 10 GB</p>
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  // Check for public share URL before anything else
  const shareToken = useMemo(() => {
    const m = window.location.pathname.match(/^\/share\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }, []);
  if (shareToken) return <ShareView shareToken={shareToken} />;

  const [token, setToken] = useState(() => localStorage.getItem("ad_token") || "");
  const [category, setCategory] = useState(null);
  const [folder, setFolder] = useState(null);
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [menuFile, setMenuFile] = useState(null);
  const [stats, setStats] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [sbOpen, setSbOpen] = useState(false);
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [viewMode, setViewMode] = useState("grid");
  const [nowPlaying, setNowPlaying] = useState(null);
  const searchTimer = useRef(null);

  const showFavorites = category === "__favorites";
  const showFolders = category === "__folders";
  const realCategory = (showFavorites || showFolders) ? null : category;

  const fetchFiles = useCallback(async (cat, q, pg, sBy, sDir, fav, fld) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: pg, limit: 50, sort_by: sBy, sort_dir: sDir });
      if (cat) p.set("category", cat);
      if (q) p.set("q", q);
      if (fav) p.set("favorites", "true");
      if (fld !== null) p.set("folder", fld);
      const res = await fetch(`${API}/api/files?${p}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { setToken(""); localStorage.removeItem("ad_token"); return; }
      const data = await res.json();
      setFiles(data.files); setTotal(data.total); setPages(data.pages);
    } catch {}
    setLoading(false);
  }, [token]);

  const fetchStats = useCallback(async () => {
    try { const res = await fetch(`${API}/api/stats`, { headers: { Authorization: `Bearer ${token}` } }); setStats(await res.json()); } catch {}
  }, [token]);

  const fetchFolders = useCallback(async () => {
    try { const res = await fetch(`${API}/api/folders`, { headers: { Authorization: `Bearer ${token}` } }); const d = await res.json(); setFolders(d.folders || []); } catch {}
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchFiles(realCategory, query, page, sortBy, sortDir, showFavorites, showFolders ? folder : null);
    fetchStats(); fetchFolders();
  }, [token, category, page, sortBy, sortDir, folder]);

  const handleSearch = q => {
    setQuery(q);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); fetchFiles(realCategory, q, 1, sortBy, sortDir, showFavorites, showFolders ? folder : null); }, 400);
  };

  const handleCategory = cat => { setCategory(cat); setPage(1); setQuery(""); setFolder(null); };

  const syncAll = async () => {
    setSyncing(true);
    try {
      await fetch(`${API}/api/sync/all`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      await Promise.all([fetchFiles(realCategory, query, page, sortBy, sortDir, showFavorites, showFolders ? folder : null), fetchStats()]);
    } catch {}
    setSyncing(false);
  };

  const toggleFav = async file => {
    await fetch(`${API}/api/favorite/${file.id}`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    setFiles(files.map(f => f.id === file.id ? { ...f, favorite: !f.favorite } : f));
  };

  const handlePreview = file => {
    if (getKind(file) === "audio") {
      const audioFiles = files.filter(f => getKind(f) === "audio");
      const idx = audioFiles.findIndex(f => f.id === file.id);
      setNowPlaying({ file, queue: audioFiles, index: idx >= 0 ? idx : 0 });
    } else {
      setPreview(file);
    }
  };

  const handleFileDeleted = fileId => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
    setTotal(t => t - 1);
    fetchStats();
  };

  if (!token) return <Login onLogin={setToken} />;

  const catStats = stats?.by_category?.reduce((a, r) => { a[r.category] = r; return a; }, {}) || {};
  const getCount = key => {
    if (key === null) return stats?.total_files;
    if (key === "__favorites") return stats?.favorites_count;
    if (key === "__folders") return stats?.folders_count;
    return catStats[key]?.count;
  };

  const playerOpen = !!nowPlaying;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#f0f2f8" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Nunito', sans-serif; }
        body { background: #f0f2f8; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: #d4d8eb; border-radius: 10px; }
        ::-webkit-scrollbar-track { background: transparent; }
        .desktop-sb { display: block; }
        .mobile-only { display: none; }
        .mobile-btn { display: none; }
        @media (max-width: 768px) { .desktop-sb { display: none; } .mobile-only { display: block; } .mobile-btn { display: flex; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes spin-disc { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes gradShift { 0%{background-position:0%} 100%{background-position:200%} }
        @keyframes eq1 { 0%,100%{height:3px} 50%{height:14px} }
        @keyframes eq2 { 0%,100%{height:9px} 30%{height:3px} 70%{height:13px} }
        @keyframes eq3 { 0%,100%{height:5px} 40%{height:16px} 80%{height:6px} }
        .card-hover { transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease; }
        .card-hover:hover { transform: translateY(-3px); box-shadow: 0 10px 28px rgba(108,99,255,0.14) !important; }
        .list-row:hover { background: rgba(108,99,255,0.04) !important; }
        input[type="range"] { accent-color: #6c63ff; cursor: pointer; height: 4px; }
        input[type="range"]:focus { outline: none; }
        button:focus { outline: none; }
        select { outline: none; }
      `}</style>

      <div className="desktop-sb">
        <Sidebar category={category} setCategory={handleCategory} stats={stats} syncing={syncing} onSync={syncAll}
          onClose={() => {}} isMobile={false} getCount={getCount} folders={folders} folder={folder} setFolder={setFolder} />
      </div>

      {sbOpen && (
        <>
          <div onClick={() => setSbOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 99, backdropFilter: "blur(2px)" }} />
          <Sidebar category={category} setCategory={handleCategory} stats={stats} syncing={syncing} onSync={syncAll}
            onClose={() => setSbOpen(false)} isMobile getCount={getCount} folders={folders} folder={folder} setFolder={setFolder} />
        </>
      )}

      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, paddingBottom: playerOpen ? 76 : 0 }}>
        {/* Topbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "white", borderBottom: "1px solid #e8eaf2", flexShrink: 0, boxShadow: "0 1px 8px rgba(0,0,0,0.04)" }}>
          <button className="mobile-btn" style={{ background: "#f0f2f8", border: "1px solid #e8eaf2", borderRadius: 9, color: "#6c63ff", width: 36, height: 36, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setSbOpen(true)}>☰</button>
          <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: 11, fontSize: 13, color: "#aab0c6" }}>🔍</span>
            <input style={{ width: "100%", background: "#f5f6fa", border: "1.5px solid #e8eaf2", borderRadius: 10, padding: "8px 32px 8px 34px", fontSize: 13, fontWeight: 600, color: "#1a1a2e", outline: "none", transition: "border 0.2s" }}
              placeholder="Search files…" value={query} onChange={e => handleSearch(e.target.value)}
              onFocus={e => e.target.style.borderColor = "#6c63ff"}
              onBlur={e => e.target.style.borderColor = "#e8eaf2"} />
            {query && <button onClick={() => handleSearch("")} style={{ position: "absolute", right: 10, background: "none", border: "none", cursor: "pointer", color: "#aab0c6", fontSize: 13 }}>✕</button>}
          </div>
          <select value={`${sortBy}-${sortDir}`} onChange={e => { const [b, d] = e.target.value.split("-"); setSortBy(b); setSortDir(d); }}
            style={{ background: "#f5f6fa", border: "1.5px solid #e8eaf2", borderRadius: 10, padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#6c63ff", cursor: "pointer" }}>
            <option value="date-desc">Newest</option>
            <option value="date-asc">Oldest</option>
            <option value="name-asc">Name A→Z</option>
            <option value="name-desc">Name Z→A</option>
            <option value="size-desc">Largest</option>
            <option value="size-asc">Smallest</option>
          </select>
          <div style={{ display: "flex", background: "#f5f6fa", border: "1.5px solid #e8eaf2", borderRadius: 10, overflow: "hidden" }}>
            {[["grid","⊞"],["list","☰"]].map(([mode, icon]) => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{ padding: "7px 10px", border: "none", cursor: "pointer", fontSize: 14, background: viewMode === mode ? "#6c63ff" : "transparent", color: viewMode === mode ? "white" : "#aab0c6", transition: "all 0.15s" }}>{icon}</button>
            ))}
          </div>
          {!loading && <span style={{ fontSize: 11, color: "#aab0c6", fontWeight: 700, background: "#f5f6fa", padding: "5px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>{total.toLocaleString()}</span>}
        </div>

        {/* Mobile category pills */}
        <div className="mobile-only" style={{ padding: "8px 12px 0", overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {CATEGORIES.map(c => {
              const active = category === c.key;
              const col = (c.key && !c.key.startsWith("__")) ? getColor(c.key) : { bg: "#ede9ff", text: "#6c63ff" };
              return (
                <button key={c.key || "all"} onClick={() => handleCategory(c.key)} style={{ background: active ? col.bg : "white", color: active ? col.text : "#8b8fa8", border: `1.5px solid ${active ? col.text : "#e8eaf2"}`, borderRadius: 20, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {c.emoji} {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Folder chips */}
        {showFolders && (
          <div style={{ padding: "10px 14px 0", overflowX: "auto" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[{ id: "", name: "📂 Unfiled" }, ...folders.map(f => ({ id: f.id, name: `📁 ${f.name}` }))].map(f => (
                <button key={f.id} onClick={() => setFolder(f.id)} style={{ borderRadius: 20, padding: "5px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", border: `1.5px solid ${folder === f.id ? "#6c63ff" : "#e8eaf2"}`, background: folder === f.id ? "#ede9ff" : "white", color: folder === f.id ? "#6c63ff" : "#8b8fa8", transition: "all 0.15s" }}>{f.name}</button>
              ))}
            </div>
          </div>
        )}

        {/* File grid / list */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", color: "#8b8fa8" }}>
              <div style={{ width: 44, height: 44, border: "3px solid #e8eaf2", borderTopColor: "#6c63ff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <p style={{ marginTop: 14, fontWeight: 700 }}>Loading…</p>
            </div>
          ) : files.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", color: "#8b8fa8" }}>
              <span style={{ fontSize: 60 }}>📭</span>
              <p style={{ fontWeight: 900, fontSize: 17, marginTop: 14, color: "#1a1a2e" }}>No files here</p>
              <p style={{ fontSize: 13, marginTop: 6 }}>{showFolders && folder === null ? "Pick a folder" : "Try syncing"}</p>
            </div>
          ) : viewMode === "grid" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))", gap: 12 }}>
              {files.map(f => <Card key={f.id} file={f} token={token} onPreview={handlePreview} onFav={toggleFav} onMenu={setMenuFile} nowPlayingId={nowPlaying?.file?.id} />)}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {files.map(f => {
                const kind = getKind(f); const col = getColor(f.category);
                const url = `${API}/api/media/${token}/${f.id}`;
                const isNP = nowPlaying?.file?.id === f.id;
                return (
                  <div key={f.id} className="list-row" onClick={() => handlePreview(f)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: isNP ? "#ede9ff" : "white", borderRadius: 10, cursor: "pointer", border: `1.5px solid ${isNP ? "#c4beff" : f.favorite ? "#ffd96a" : "#e8eaf2"}`, transition: "all 0.15s" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: kind === "image" ? "#000" : col.bg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, fontSize: 18 }}>
                      {kind === "image" ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : getEmoji(kind)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.filename}</p>
                      <p style={{ fontSize: 11, color: "#aab0c6", fontWeight: 600 }}>{fmtSize(f.size)} · {fmtDate(f.date)}</p>
                    </div>
                    {isNP && <EqBars playing={true} />}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={e => { e.stopPropagation(); toggleFav(f); }} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: f.favorite ? "#ffc107" : "#d4d8eb" }}>{f.favorite ? "★" : "☆"}</button>
                      {f.tg_link && <a href={f.tg_link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ ...S.smallBtn, background: "#e8f4fd", color: "#229ED9", textDecoration: "none" }}>✈</a>}
                      <button onClick={e => { e.stopPropagation(); setMenuFile(f); }} style={{ ...S.smallBtn, background: "#f0f2f8", color: "#6b6b72" }}>⋯</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 14px", borderTop: "1px solid #e8eaf2", background: "white", flexShrink: 0 }}>
            <button style={{ background: "#f5f6fa", border: "1.5px solid #e8eaf2", borderRadius: 9, color: "#1a1a2e", padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700 }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ fontSize: 12, color: "#8b8fa8", fontWeight: 700 }}>Page {page} of {pages}</span>
            <button style={{ background: "#f5f6fa", border: "1.5px solid #e8eaf2", borderRadius: 9, color: "#1a1a2e", padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700 }} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </main>

      <AudioPlayer nowPlaying={nowPlaying} setNowPlaying={setNowPlaying} token={token} />

      {preview && <Preview file={preview} token={token} onClose={() => setPreview(null)} />}
      {menuFile && (
        <ActionMenu
          file={menuFile} token={token} folders={folders}
          onClose={() => setMenuFile(null)}
          onFolderChange={() => { fetchFiles(realCategory, query, page, sortBy, sortDir, showFavorites, showFolders ? folder : null); fetchStats(); fetchFolders(); }}
          onDelete={handleFileDeleted}
        />
      )}
    </div>
  );
}

const S = {
  sidebar: { width: 224, background: "white", borderRight: "1px solid #e8eaf2", display: "flex", flexDirection: "column", padding: "16px 12px", flexShrink: 0, overflowY: "hidden" },
  mobileSb: { position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100, width: 264, boxShadow: "6px 0 32px rgba(0,0,0,0.18)" },
  card: { background: "white", border: "2px solid #e8eaf2", borderRadius: 14, overflow: "hidden", cursor: "pointer", display: "flex", flexDirection: "column" },
  thumb: { height: 108, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" },
  fname: { fontSize: 11, fontWeight: 700, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 },
  smallBtn: { border: "none", borderRadius: 7, padding: "3px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer" },
  overlay: { position: "fixed", inset: 0, background: "rgba(12,12,28,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, backdropFilter: "blur(10px)", padding: 12 },
  modal: { background: "white", borderRadius: 16, width: "100%", maxWidth: 1000, maxHeight: "95vh", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", boxShadow: "0 24px 80px rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.12)" },
  modalClose: { position: "absolute", top: 10, right: 10, background: "rgba(255,255,255,0.95)", border: "1px solid #e8eaf2", borderRadius: 9, color: "#1a1a2e", width: 32, height: 32, cursor: "pointer", fontSize: 13, fontWeight: 700, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center" },
  modalTitle: { padding: "13px 52px 11px 16px", fontSize: 13, fontWeight: 700, color: "#1a1a2e", borderBottom: "1px solid #e8eaf2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 },
  listBtn: { textAlign: "left", padding: "10px 12px", background: "#f5f6fa", border: "1.5px solid #e8eaf2", borderRadius: 10, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", transition: "all 0.15s" },
  input: { background: "#f5f6fa", border: "2px solid #e8eaf2", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, color: "#1a1a2e", outline: "none", width: "100%", transition: "border 0.2s" },
  btnP: { background: "linear-gradient(135deg,#6c63ff,#8b83ff)", color: "white", border: "none", borderRadius: 10, padding: "11px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer", boxShadow: "0 4px 14px rgba(108,99,255,0.3)", textAlign: "center" },
  pCtrl: { background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.7)", padding: "6px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, transition: "color 0.15s, background 0.15s", fontSize: 18 },
  label: { display: "block", fontSize: 11, fontWeight: 700, color: "#6b6b72", marginBottom: 5 },
};
