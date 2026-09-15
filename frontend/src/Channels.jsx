import { useCallback, useEffect, useRef, useState } from "react";
import AdaptiveVideo from "./AdaptiveVideo";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const kindOf = f => {
  const m = String(f.mime || "").toLowerCase();
  const n = String(f.filename || "").toLowerCase();
  if (m.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/.test(n)) return "photo";
  if (m.startsWith("video/") || /\.(mp4|mkv|webm|mov|m4v|avi|3gp)$/.test(n)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|wav|flac|aac|ogg|m4a|opus)$/.test(n)) return "audio";
  if (m === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
  if (m === "application/epub+zip" || m.includes("epub") || /\.epub$/.test(n)) return "epub";
  return "other";
};

const icon = k => ({ photo: "🖼️", video: "🎬", audio: "🎵", pdf: "📕", epub: "📚", other: "📦" }[k] || "📦");
const size = b => !b ? "—" : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`;
const date = d => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "";

function Setup({ token, channels, reload, onClose }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const add = async () => {
    if (!id.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel_id: id.trim(), name: name.trim() })
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.detail || "Could not connect to channel");
      setId(""); setName(""); await reload();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const remove = async cid => {
    if (!confirm("Remove this channel from QuantXDrive? Telegram messages will not be deleted.")) return;
    await fetch(`${API}/api/channels/${cid}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    reload();
  };

  return <div style={S.overlay} onClick={onClose}>
    <div style={S.setup} onClick={e => e.stopPropagation()}>
      <div style={S.head}>
        <div><b>⚙️ Channel Settings</b><p style={S.muted}>Add Telegram channel IDs that the connected Telegram account can access.</p></div>
        <button style={S.x} onClick={onClose}>✕</button>
      </div>
      <div style={S.note}>ℹ️ The account behind <b>SESSION_STRING</b> must be a member/admin of the channel. If you use a Telegram bot, add that bot to the channel with the required access.</div>
      <div style={S.form}>
        <input value={id} onChange={e => setId(e.target.value)} placeholder="Channel ID, e.g. -1001234567890" style={S.input}/>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Display name (optional)" style={S.input}/>
        <button disabled={busy || !id.trim()} onClick={add} style={S.primary}>{busy ? "⏳ Checking access…" : "＋ Add Channel"}</button>
      </div>
      {err && <div style={S.error}>❌ {err}</div>}
      <div style={{ marginTop: 16 }}><b style={{ fontSize: 13 }}>Configured channels</b>
        {channels.length === 0 ? <p style={S.empty}>No channels configured yet.</p> : channels.map(c =>
          <div key={c.id} style={S.channelRow}><span style={{ fontSize: 22 }}>📺</span><div style={{ flex: 1, minWidth: 0 }}><b style={S.ellipsis}>{c.title || c.id}</b><p style={S.muted}>{c.id}{c.username ? ` · @${c.username}` : ""}</p></div><button onClick={() => remove(c.id)} style={S.remove}>Remove</button></div>
        )}
      </div>
    </div>
  </div>;
}

function ChannelFiles({ token, channel, onBack }) {
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("date-desc");
  const [q, setQ] = useState("");
  const [files, setFiles] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [preview, setPreview] = useState(null);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    const [sortBy, sortDir] = sort.split("-");
    try {
      const u = new URLSearchParams({ type, sort_by: sortBy, sort_dir: sortDir, page: p, limit: 50 });
      if (q) u.set("q", q);
      const r = await fetch(`${API}/api/channels/${channel.id}/files?${u}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (r.ok) { setFiles(d.files || []); setPages(d.pages || 1); setTotal(d.total || 0); }
    } catch {}
    setLoading(false);
  }, [token, channel.id, type, sort, q, page]);

  useEffect(() => { setPage(1); }, [type, sort, q]);
  useEffect(() => { load(page); }, [load, page]);

  const sync = async () => {
    setSyncing(true); setSyncError("");
    try {
      const r = await fetch(`${API}/api/channels/${channel.id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ limit: 0 })
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.detail || `Sync failed (${r.status})`);
      await load(1); setPage(1);
    } catch (e) { setSyncError(e.message); }
    setSyncing(false);
  };

  return <div style={S.overlay}>
    <div style={S.channelPanel}>
      <div style={S.head}>
        <div style={{ minWidth: 0 }}><button onClick={onBack} style={S.back}>← Channels</button><b style={S.title}>📺 {channel.title}</b><p style={S.muted}>{total.toLocaleString()} indexed media items{channel.last_sync ? ` · synced ${date(channel.last_sync)}` : ""}</p></div>
        <button style={S.x} onClick={onBack}>✕</button>
      </div>
      <div style={S.toolbar}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search channel…" style={{ ...S.input, flex: 1, minWidth: 150 }}/>
        <select value={type} onChange={e => setType(e.target.value)} style={S.select}>
          <option value="all">All</option><option value="video">🎬 Videos</option><option value="photo">🖼 Photos</option><option value="audio">🎵 Audio</option><option value="document">📚 Documents</option><option value="other">📦 Other files</option>
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)} style={S.select}>
          <option value="date-desc">Newest</option><option value="date-asc">Oldest</option><option value="name-asc">Name A→Z</option><option value="name-desc">Name Z→A</option><option value="size-desc">Largest</option><option value="size-asc">Smallest</option>
        </select>
        <button onClick={sync} disabled={syncing} style={S.sync}>{syncing ? "⏳ Syncing…" : "⟳ Sync"}</button>
      </div>
      {syncError && <div style={S.syncError}>❌ {syncError}</div>}
      <div style={S.list}>
        {loading ? <div style={S.center}>⏳ Loading channel…</div> : files.length === 0 ? <div style={S.center}><span style={{ fontSize: 48 }}>📭</span><b>No media found</b><span style={S.muted}>Press Sync to read the channel history.</span></div> : files.map(f => <ChannelCard key={f.id} file={f} token={token} onOpen={() => setPreview(f)}/>) }
      </div>
      {pages > 1 && <div style={S.pagination}><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button><span>Page {page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next →</button></div>}
      {preview && <ChannelPreview file={preview} token={token} onClose={() => setPreview(null)}/>} 
    </div>
  </div>;
}

function ChannelCard({ file, token, onOpen }) {
  const k = kindOf(file), url = `${API}/api/media/${token}/${file.id}`;
  return <div onClick={onOpen} style={S.fileRow}>
    <div style={{ width: 48, height: 48, borderRadius: 11, background: k === "photo" ? "#111" : "#f0eeff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, fontSize: 23 }}>
      {k === "photo" ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/> : icon(k)}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}><b style={S.ellipsis}>{file.filename}</b><p style={S.muted}>{size(file.size)} · {date(file.date)}{file.caption ? ` · ${file.caption.slice(0, 60)}` : ""}</p></div>
    <span style={S.open}>{k === "video" ? "▶" : k === "audio" ? "♫" : k === "pdf" ? "PDF" : k === "epub" ? "EPUB" : "Open"}</span>
  </div>;
}

function EpubReader({ url, filename }) {
  const hostRef = useRef(null);
  const [state, setState] = useState("Loading EPUB…");
  useEffect(() => {
    let book, rendition, blobUrl, cancelled = false;
    const loadScript = () => new Promise((resolve, reject) => {
      if (window.ePub) return resolve(window.ePub);
      const existing = document.querySelector('script[data-quantx-epubjs="1"]');
      if (existing) { existing.addEventListener("load", () => resolve(window.ePub), { once: true }); existing.addEventListener("error", reject, { once: true }); return; }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js";
      s.async = true; s.dataset.quantxEpubjs = "1";
      s.onload = () => resolve(window.ePub); s.onerror = reject;
      document.head.appendChild(s);
    });
    (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw Error(`Unable to load EPUB (${r.status})`);
        const blob = await r.blob();
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        const ePub = await loadScript();
        if (cancelled || !ePub || !hostRef.current) return;
        book = ePub(blobUrl);
        rendition = book.renderTo(hostRef.current, { width: "100%", height: "100%", spread: "none" });
        rendition.display();
        setState("");
      } catch (e) { if (!cancelled) setState(`EPUB reader error: ${e.message}`); }
    })();
    return () => { cancelled = true; try { rendition?.destroy(); book?.destroy(); } catch {} if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [url]);
  return <div style={S.epubWrap}><div ref={hostRef} style={S.epubReader}/>{state && <div style={S.epubState}>{state}{state.startsWith("EPUB reader error") && <a href={url} download={filename} style={S.primary}>↓ Download EPUB</a>}</div>}</div>;
}

function ChannelPreview({ file, token, onClose }) {
  const k = kindOf(file), url = `${API}/api/media/${token}/${file.id}`, hls = `${API}/api/hls/${token}/${file.id}/master.m3u8`;
  return <div style={S.previewOverlay} onClick={onClose}>
    <div style={S.preview} onClick={e => e.stopPropagation()}>
      <div style={S.previewHead}><b style={S.ellipsis}>{file.filename}</b><button style={S.x} onClick={onClose}>✕</button></div>
      <div style={S.previewBody}>
        {k === "video" ? <AdaptiveVideo src={hls} fallbackSrc={url} autoPlay style={{ width: "100%", height: "100%", maxHeight: "80vh" }}/> :
         k === "photo" ? <img src={url} alt={file.filename} style={{ maxWidth: "100%", maxHeight: "82vh", objectFit: "contain" }}/> :
         k === "audio" ? <audio controls autoPlay src={url} style={{ width: "min(600px,90%)" }}/> :
         k === "pdf" ? <iframe title={file.filename} src={url} style={S.pdfFrame}/> :
         k === "epub" ? <EpubReader url={url} filename={file.filename}/> :
         <div style={S.center}><span style={{ fontSize: 60 }}>{icon(k)}</span><b>{file.filename}</b><a href={url} download={file.filename} style={S.primary}>↓ Download</a></div>}
      </div>
      <div style={S.previewFoot}><span>{size(file.size)} · {date(file.date)}</span>{file.tg_link && <a href={file.tg_link} target="_blank" rel="noreferrer" style={S.tg}>✈ Telegram</a>}<a href={url} download={file.filename} style={S.primary}>↓ Download</a></div>
    </div>
  </div>;
}

export default function Channels({ token, onClose }) {
  const [channels, setChannels] = useState([]), [selected, setSelected] = useState(null), [settings, setSettings] = useState(false), [loading, setLoading] = useState(true);
  const reload = useCallback(async () => { setLoading(true); try { const r = await fetch(`${API}/api/channels`, { headers: { Authorization: `Bearer ${token}` } }); const d = await r.json(); setChannels(d.channels || []); } catch {} setLoading(false); }, [token]);
  useEffect(() => { reload(); }, [reload]);
  if (selected) return <ChannelFiles token={token} channel={selected} onBack={() => { setSelected(null); reload(); }}/>;
  return <div style={S.overlay} onClick={onClose}><div style={S.panel} onClick={e => e.stopPropagation()}>
    <div style={S.head}><div><b style={S.title}>📺 Channels</b><p style={S.muted}>Browse Telegram channel media inside QuantXDrive</p></div><div style={{ display: "flex", gap: 7 }}><button onClick={() => setSettings(true)} style={S.settings}>⚙ Settings</button><button style={S.x} onClick={onClose}>✕</button></div></div>
    {loading ? <div style={S.center}>⏳ Loading channels…</div> : channels.length === 0 ? <div style={S.center}><span style={{ fontSize: 60 }}>📺</span><b>No channels configured</b><span style={S.muted}>Open Settings and add a Telegram channel ID.</span><button onClick={() => setSettings(true)} style={S.primary}>⚙ Setup Channels</button></div> : <div style={S.channelGrid}>{channels.map(c => <button key={c.id} onClick={() => setSelected(c)} style={S.channelCard}><span style={{ fontSize: 34 }}>📺</span><span style={{ fontWeight: 900, color: "#1a1a2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>{c.title || c.id}</span><span style={S.muted}>{c.id}</span><span style={S.open}>{c.files ? `${c.files} files` : "Open channel →"}</span></button>)}</div>}
    {settings && <Setup token={token} channels={channels} reload={reload} onClose={() => setSettings(false)}/>} 
  </div></div>;
}

const S = {
  overlay: { position: "fixed", inset: 0, zIndex: 200, background: "rgba(13,13,26,.62)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
  panel: { width: "100vw", height: "100dvh", background: "#f8f9fd", borderRadius: 0, boxShadow: "none", overflow: "hidden", display: "flex", flexDirection: "column" },
  channelPanel: { width: "100vw", height: "100dvh", background: "#f8f9fd", borderRadius: 0, boxShadow: "none", overflow: "hidden", display: "flex", flexDirection: "column" },
  setup: { width: "min(620px,94vw)", maxHeight: "90dvh", overflowY: "auto", background: "white", borderRadius: 18, padding: 18, boxShadow: "0 20px 70px rgba(0,0,0,.3)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", background: "white", borderBottom: "1px solid #e8eaf2" },
  title: { fontSize: 18, color: "#1a1a2e" }, muted: { fontSize: 11, color: "#8b8fa8", marginTop: 3, fontWeight: 600 },
  x: { width: 34, height: 34, borderRadius: 10, border: "1px solid #e8eaf2", background: "#f5f6fa", cursor: "pointer", color: "#6b6b72" },
  settings: { border: "1px solid #d9d5ff", background: "#ede9ff", color: "#6c63ff", borderRadius: 10, padding: "8px 12px", fontWeight: 800, cursor: "pointer" },
  back: { border: 0, background: "none", color: "#6c63ff", fontWeight: 800, cursor: "pointer", padding: 0, marginBottom: 5 },
  toolbar: { display: "flex", gap: 8, padding: 12, background: "white", borderBottom: "1px solid #e8eaf2", flexWrap: "wrap" },
  input: { border: "1.5px solid #e8eaf2", background: "#f7f8fc", borderRadius: 10, padding: "9px 11px", color: "#1a1a2e", outline: "none", fontWeight: 600, minWidth: 0 },
  select: { border: "1.5px solid #e8eaf2", background: "#f7f8fc", borderRadius: 10, padding: "9px 10px", color: "#6c63ff", fontWeight: 800 },
  primary: { border: 0, background: "linear-gradient(135deg,#6c63ff,#8b83ff)", color: "white", borderRadius: 10, padding: "9px 13px", fontWeight: 800, cursor: "pointer", textDecoration: "none", display: "inline-block" },
  sync: { border: 0, background: "#e8f4fd", color: "#229ED9", borderRadius: 10, padding: "9px 13px", fontWeight: 800, cursor: "pointer" },
  syncError: { padding: "9px 14px", background: "#fff0f6", color: "#d63384", borderBottom: "1px solid #ffd6e7", fontSize: 12, fontWeight: 700 },
  list: { flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 6 },
  fileRow: { display: "flex", alignItems: "center", gap: 12, padding: 9, background: "white", border: "1px solid #e8eaf2", borderRadius: 12, cursor: "pointer" },
  ellipsis: { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1a1a2e", fontSize: 13 },
  open: { color: "#6c63ff", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" },
  center: { flex: 1, minHeight: 250, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 9, color: "#1a1a2e" },
  pagination: { display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: 10, background: "white", borderTop: "1px solid #e8eaf2", fontSize: 12, fontWeight: 700, color: "#8b8fa8" },
  channelGrid: { padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 12, overflowY: "auto" },
  channelCard: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, padding: 18, border: "1.5px solid #e8eaf2", background: "white", borderRadius: 15, cursor: "pointer", textAlign: "left" },
  form: { display: "flex", flexDirection: "column", gap: 8, marginTop: 14 },
  note: { marginTop: 12, padding: 11, background: "#f5f3ff", border: "1px solid #ddd8ff", borderRadius: 10, color: "#5f58a6", fontSize: 11, lineHeight: 1.5 },
  error: { marginTop: 10, padding: 10, background: "#fff0f6", border: "1px solid #ffd6e7", borderRadius: 9, color: "#d63384", fontSize: 11, fontWeight: 700 },
  empty: { color: "#8b8fa8", fontSize: 12, padding: "16px 0" },
  channelRow: { display: "flex", alignItems: "center", gap: 10, padding: 10, marginTop: 7, border: "1px solid #e8eaf2", borderRadius: 10, background: "#fafbff" },
  remove: { border: 0, background: "#fff0f6", color: "#d63384", borderRadius: 8, padding: "7px 9px", cursor: "pointer", fontWeight: 800, fontSize: 11 },
  previewOverlay: { position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,.88)", display: "flex", alignItems: "stretch", justifyContent: "stretch", padding: 0 },
  preview: { width: "100vw", height: "100dvh", background: "#0d0d1a", overflow: "hidden", display: "flex", flexDirection: "column" },
  previewHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", background: "white" },
  previewBody: { flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 8, overflow: "hidden" },
  previewFoot: { display: "flex", alignItems: "center", gap: 8, padding: 10, background: "white", color: "#8b8fa8", fontSize: 11, fontWeight: 700 },
  tg: { marginLeft: "auto", textDecoration: "none", color: "white", background: "#229ED9", borderRadius: 9, padding: "7px 11px" },
  pdfFrame: { width: "100%", height: "100%", minHeight: "70vh", border: 0, background: "white" },
  epubWrap: { position: "relative", width: "100%", height: "100%", background: "white", borderRadius: 8, overflow: "hidden" },
  epubReader: { width: "100%", height: "100%" },
  epubState: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "white", color: "#1a1a2e", fontWeight: 700, padding: 20, textAlign: "center" }
};
