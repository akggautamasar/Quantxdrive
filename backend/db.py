import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const CATEGORIES = [
  { key: null,              label: "All",          emoji: "🗂️" },
  { key: "photos",          label: "Photos",       emoji: "🖼️" },
  { key: "videos",          label: "Videos",       emoji: "🎬" },
  { key: "audio",           label: "Audio",        emoji: "🎵" },
  { key: "pdfs",            label: "PDFs",         emoji: "📄" },
  { key: "word_excel",      label: "Word/Excel",   emoji: "📊" },
  { key: "call_recordings", label: "Calls",        emoji: "📞" },
  { key: "other_files",     label: "Other",        emoji: "📦" },
];

const COLORS = {
  photos: { bg: "#ede9ff", text: "#6c63ff", border: "#c4bbff" },
  videos: { bg: "#fff0f3", text: "#ff4d6d", border: "#ffb3c1" },
  audio:  { bg: "#e6fdf6", text: "#00b894", border: "#a0e4ce" },
  pdfs:   { bg: "#fff4e6", text: "#e67e22", border: "#ffd199" },
  word_excel: { bg: "#e6faf4", text: "#00a878", border: "#99ddc8" },
  call_recordings: { bg: "#fdf0f8", text: "#d63384", border: "#f0aad4" },
  other_files: { bg: "#f0eeff", text: "#7c6fcd", border: "#c5bbff" },
};

const getColor = (cat) => COLORS[cat] || { bg: "#f0f2f8", text: "#6c63ff", border: "#c4bbff" };

const getFileKind = (file) => {
  const mime = file.mime || "";
  const name = (file.filename || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(name)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|mkv|webm|mov|m4v|avi|3gp)$/.test(name)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|wav|flac|aac|ogg|m4a|opus)$/.test(name)) return "audio";
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".epub")) return "epub";
  if (mime.includes("word") || mime.includes("excel") || mime.includes("officedocument") || /\.(doc|docx|xls|xlsx|ppt|pptx)$/.test(name)) return "office";
  if (mime.startsWith("text/") || /\.(txt|md|log|json|csv|xml|html|js|py|css)$/.test(name)) return "text";
  return "other";
};

const getEmoji = (kind) => ({
  image: "🖼️", video: "🎬", audio: "🎵", pdf: "📄",
  epub: "📚", office: "📊", text: "📝", other: "📦"
}[kind]);

const formatSize = (b) => {
  if (!b) return "—";
  if (b < 1024*1024) return `${(b/1024).toFixed(0)} KB`;
  if (b < 1024*1024*1024) return `${(b/(1024*1024)).toFixed(1)} MB`;
  return `${(b/(1024*1024*1024)).toFixed(2)} GB`;
};

const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "";

// ── Login ─────────────────────────────────────────────────────────────────────

function LoginPage({ onLogin }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API}/api/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) throw new Error();
      const { token } = await res.json();
      localStorage.setItem("ad_token", token);
      onLogin(token);
    } catch {
      setError("Wrong password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={S.logoMark}>✦</div>
          <span style={{ fontWeight: 900, fontSize: 26, color: "#1a1a2e" }}>AirDrive</span>
        </div>
        <p style={{ color: "#8b8fa8", fontSize: 13 }}>Your personal cloud on Telegram.</p>
        <div style={{ display: "flex", gap: 10 }}>
          <input type="password" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()} style={S.input} autoFocus />
          <button style={S.btnPrimary} onClick={submit} disabled={loading}>{loading ? "…" : "Unlock"}</button>
        </div>
        {error && <div style={S.errBox}>{error}</div>}
      </div>
    </div>
  );
}

// ── File Card ─────────────────────────────────────────────────────────────────

function FileCard({ file, token, onPreview }) {
  const kind = getFileKind(file);
  const col = getColor(file.category);
  const [hover, setHover] = useState(false);
  const mediaUrl = `${API}/api/media/${token}/${file.id}`;

  return (
    <div
      style={{ ...S.card, borderColor: hover ? col.text : "#e4e7f0",
        transform: hover ? "translateY(-3px)" : "none",
        boxShadow: hover ? `0 12px 24px ${col.text}22` : "0 2px 8px rgba(0,0,0,0.06)" }}
      onClick={() => onPreview(file)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    >
      <div style={{ ...S.thumb, background: col.bg }}>
        {kind === "image" ? (
          <img src={mediaUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={e => { e.target.style.display = "none"; }} />
        ) : (
          <span style={{ fontSize: 38 }}>{getEmoji(kind)}</span>
        )}
      </div>
      <div style={{ padding: "10px 10px 4px" }}>
        <p style={S.fname} title={file.filename}>{file.filename}</p>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8b8fa8", fontWeight: 600 }}>
          <span>{formatSize(file.size)}</span>
          <span>{formatDate(file.date)}</span>
        </div>
      </div>
      <div style={{ padding: "6px 10px 10px", display: "flex", justifyContent: "flex-end" }}>
        <a href={mediaUrl} download={file.filename} onClick={e => e.stopPropagation()}
          style={{ ...S.dlBtn, background: col.bg, color: col.text, border: `1.5px solid ${col.border}` }}>
          ↓ Download
        </a>
      </div>
    </div>
  );
}

// ── Preview Modal ─────────────────────────────────────────────────────────────

function PreviewModal({ file, token, onClose }) {
  const kind = getFileKind(file);
  const url = `${API}/api/media/${token}/${file.id}`;

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const renderViewer = () => {
    if (kind === "image") return <img src={url} alt={file.filename} style={S.viewerImg} />;
    if (kind === "video") return <video src={url} controls autoPlay playsInline style={S.viewerVideo} />;
    if (kind === "audio") return (
      <div style={S.audioWrap}>
        <div style={{ fontSize: 80 }}>🎵</div>
        <p style={{ fontWeight: 700, fontSize: 16, textAlign: "center", marginTop: 12, color: "#1a1a2e" }}>{file.filename}</p>
        <audio src={url} controls autoPlay style={{ width: "100%", marginTop: 20 }} />
      </div>
    );
    if (kind === "pdf") return <iframe src={url} style={S.viewerIframe} title={file.filename} />;
    if (kind === "epub") return (
      <div style={S.unsupportedWrap}>
        <div style={{ fontSize: 60 }}>📚</div>
        <p style={{ fontWeight: 700, marginTop: 12 }}>EPUB file</p>
        <p style={{ fontSize: 13, color: "#8b8fa8", marginTop: 6 }}>Download to read in your e-reader app</p>
        <a href={url} download={file.filename} style={{ ...S.btnPrimary, marginTop: 16, textDecoration: "none" }}>↓ Download</a>
      </div>
    );
    if (kind === "office") return (
      <div style={S.unsupportedWrap}>
        <div style={{ fontSize: 60 }}>📊</div>
        <p style={{ fontWeight: 700, marginTop: 12 }}>{file.filename}</p>
        <p style={{ fontSize: 13, color: "#8b8fa8", marginTop: 6 }}>Office documents can't preview in browser</p>
        <a href={url} download={file.filename} style={{ ...S.btnPrimary, marginTop: 16, textDecoration: "none" }}>↓ Download</a>
      </div>
    );
    if (kind === "text") return <iframe src={url} style={S.viewerIframe} title={file.filename} />;
    return (
      <div style={S.unsupportedWrap}>
        <div style={{ fontSize: 60 }}>{getEmoji(kind)}</div>
        <p style={{ fontWeight: 700, marginTop: 12 }}>{file.filename}</p>
        <p style={{ fontSize: 13, color: "#8b8fa8", marginTop: 6 }}>Preview not supported</p>
        <a href={url} download={file.filename} style={{ ...S.btnPrimary, marginTop: 16, textDecoration: "none" }}>↓ Download</a>
      </div>
    );
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <button style={S.modalClose} onClick={onClose}>✕</button>
        <p style={S.modalTitle}>{file.filename}</p>
        <div style={S.viewerArea}>{renderViewer()}</div>
        <div style={S.modalFooter}>
          <span>{formatSize(file.size)}</span>
          <span>{formatDate(file.date)}</span>
          <a href={url} download={file.filename} style={{ ...S.btnPrimary, marginLeft: "auto", padding: "7px 16px", textDecoration: "none", fontSize: 13 }}>↓ Download</a>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ category, setCategory, stats, syncing, onSync, onClose, isMobile }) {
  const catStats = stats?.by_category?.reduce((a, r) => { a[r.category] = r; return a; }, {}) || {};
  return (
    <div style={{ ...S.sidebar, ...(isMobile ? S.mobileSidebar : {}) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16, borderBottom: "1px solid #e4e7f0", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={S.logoMark}>✦</div>
          <span style={{ fontWeight: 900, fontSize: 18 }}>AirDrive</span>
        </div>
        {isMobile && <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#8b8fa8" }}>✕</button>}
      </div>
      <button style={{ ...S.syncBtn, opacity: syncing ? 0.7 : 1 }} onClick={onSync} disabled={syncing}>
        ⟳ {syncing ? "Syncing…" : "Sync from Telegram"}
      </button>
      <nav style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8, flex: 1 }}>
        {CATEGORIES.map(c => {
          const active = category === c.key;
          const col = c.key ? getColor(c.key) : { bg: "#ede9ff", text: "#6c63ff" };
          const count = c.key ? catStats[c.key]?.count : stats?.total_files;
          return (
            <button key={c.key} style={{ ...S.navItem, background: active ? col.bg : "transparent",
                color: active ? col.text : "#6b6b72", fontWeight: active ? 800 : 600 }}
              onClick={() => { setCategory(c.key); if (isMobile) onClose(); }}>
              <span style={{ fontSize: 16, width: 22, textAlign: "center" }}>{c.emoji}</span>
              <span style={{ flex: 1, textAlign: "left" }}>{c.label}</span>
              {count != null && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
                background: active ? col.text : "#f0f2f8", color: active ? "white" : "#8b8fa8" }}>{count.toLocaleString()}</span>}
            </button>
          );
        })}
      </nav>
      {stats && (
        <div style={{ borderTop: "1px solid #e4e7f0", paddingTop: 14, marginTop: 8 }}>
          <p style={{ fontSize: 22, fontWeight: 900, background: "linear-gradient(135deg,#6c63ff,#ff6584)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            {stats.total_files?.toLocaleString()}
          </p>
          <p style={{ fontSize: 11, color: "#8b8fa8", fontWeight: 600 }}>{formatSize(stats.total_size)}</p>
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("ad_token") || "");
  const [category, setCategory] = useState(null);
  const [files, setFiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [stats, setStats] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [sbOpen, setSbOpen] = useState(false);
  const searchTimer = useRef(null);

  const fetchFiles = useCallback(async (cat, q, pg) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: pg, limit: 50 });
      if (cat) p.set("category", cat);
      if (q) p.set("q", q);
      const res = await fetch(`${API}/api/files?${p}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { setToken(""); localStorage.removeItem("ad_token"); return; }
      const data = await res.json();
      setFiles(data.files); setTotal(data.total); setPages(data.pages);
    } catch {}
    setLoading(false);
  }, [token]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/stats`, { headers: { Authorization: `Bearer ${token}` } });
      setStats(await res.json());
    } catch {}
  }, [token]);

  useEffect(() => { if (token) { fetchFiles(category, query, page); fetchStats(); } }, [token, category, page]);

  const handleSearch = q => {
    setQuery(q);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); fetchFiles(category, q, 1); }, 400);
  };

  const handleCategory = cat => { setCategory(cat); setPage(1); setQuery(""); };

  const syncAll = async () => {
    setSyncing(true);
    try {
      await fetch(`${API}/api/sync/all`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      await Promise.all([fetchFiles(category, query, page), fetchStats()]);
    } catch {}
    setSyncing(false);
  };

  if (!token) return <LoginPage onLogin={setToken} />;

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Nunito', sans-serif; }
        body { background: #f5f6fa; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: #e4e7f0; border-radius: 10px; }
        ::-webkit-scrollbar-track { background: transparent; }
        .desktop-sb { display: block; }
        .mobile-extras { display: none; }
        .mobile-btn { display: none; }
        @media (max-width: 768px) {
          .desktop-sb { display: none; }
          .mobile-extras { display: block; }
          .mobile-btn { display: flex; }
        }
      `}</style>

      <div className="desktop-sb">
        <Sidebar category={category} setCategory={handleCategory} stats={stats} syncing={syncing} onSync={syncAll} onClose={() => {}} isMobile={false} />
      </div>

      {sbOpen && (
        <>
          <div onClick={() => setSbOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 99 }} />
          <Sidebar category={category} setCategory={handleCategory} stats={stats} syncing={syncing} onSync={syncAll} onClose={() => setSbOpen(false)} isMobile />
        </>
      )}

      <main style={S.main}>
        <div style={S.topbar}>
          <button className="mobile-btn" style={S.menuBtn} onClick={() => setSbOpen(true)}>☰</button>
          <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: 12, fontSize: 16 }}>🔍</span>
            <input style={S.search} placeholder="Search files…" value={query} onChange={e => handleSearch(e.target.value)} />
            {query && <button onClick={() => handleSearch("")} style={{ position: "absolute", right: 10, background: "none", border: "none", cursor: "pointer", color: "#8b8fa8" }}>✕</button>}
          </div>
          {!loading && <span style={S.countBadge}>{total.toLocaleString()} files</span>}
        </div>

        <div className="mobile-extras" style={{ padding: "10px 14px 0" }}>
          <button style={{ ...S.syncBtn, width: "100%" }} onClick={syncAll} disabled={syncing}>
            ⟳ {syncing ? "Syncing…" : "Sync from Telegram"}
          </button>
        </div>

        <div className="mobile-extras" style={{ padding: "10px 14px 0", overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {CATEGORIES.map(c => {
              const active = category === c.key;
              const col = c.key ? getColor(c.key) : { bg: "#ede9ff", text: "#6c63ff" };
              return (
                <button key={c.key} onClick={() => handleCategory(c.key)} style={{
                  background: active ? col.bg : "white", color: active ? col.text : "#8b8fa8",
                  border: `1.5px solid ${active ? col.text : "#e4e7f0"}`, borderRadius: 20,
                  padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {c.emoji} {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {loading ? (
            <div style={S.center}>
              <div style={S.spinner} />
              <p style={{ marginTop: 14, color: "#8b8fa8" }}>Loading…</p>
            </div>
          ) : files.length === 0 ? (
            <div style={S.center}>
              <span style={{ fontSize: 56 }}>📭</span>
              <p style={{ fontWeight: 800, fontSize: 16, marginTop: 12 }}>No files</p>
              <p style={{ fontSize: 13, color: "#8b8fa8", marginTop: 4 }}>Tap Sync from Telegram</p>
            </div>
          ) : (
            <div style={S.grid}>
              {files.map(f => <FileCard key={f.id} file={f} token={token} onPreview={setPreview} />)}
            </div>
          )}
        </div>

        {pages > 1 && (
          <div style={S.pager}>
            <button style={S.pBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ fontSize: 13, color: "#8b8fa8", fontWeight: 700 }}>{page} / {pages}</span>
            <button style={S.pBtn} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </main>

      {preview && <PreviewModal file={preview} token={token} onClose={() => setPreview(null)} />}
    </div>
  );
}

const S = {
  app: { display: "flex", height: "100vh", overflow: "hidden", background: "#f5f6fa" },
  sidebar: { width: 240, background: "white", borderRight: "1px solid #e4e7f0", display: "flex", flexDirection: "column", padding: "20px 14px", flexShrink: 0, overflowY: "auto" },
  mobileSidebar: { position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100, width: 280, boxShadow: "4px 0 24px rgba(0,0,0,0.15)" },
  logoMark: { width: 36, height: 36, background: "linear-gradient(135deg,#6c63ff,#ff6584)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "white", fontWeight: 900 },
  syncBtn: { width: "100%", padding: "11px 16px", background: "linear-gradient(135deg,#6c63ff,#8b83ff)", border: "none", borderRadius: 10, color: "white", fontSize: 13, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 12px rgba(108,99,255,0.3)" },
  navItem: { display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, width: "100%" },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 },
  topbar: { display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "white", borderBottom: "1px solid #e4e7f0", flexShrink: 0 },
  menuBtn: { background: "#f0f2f8", border: "1px solid #e4e7f0", borderRadius: 8, color: "#6c63ff", width: 38, height: 38, cursor: "pointer", fontSize: 18, alignItems: "center", justifyContent: "center" },
  search: { width: "100%", background: "#f5f6fa", border: "2px solid #e4e7f0", borderRadius: 10, padding: "9px 36px 9px 38px", fontSize: 13, fontWeight: 600, outline: "none" },
  countBadge: { fontSize: 12, color: "#8b8fa8", fontWeight: 700, background: "#f0f2f8", padding: "5px 10px", borderRadius: 20, whiteSpace: "nowrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 },
  card: { background: "white", border: "2px solid #e4e7f0", borderRadius: 14, overflow: "hidden", cursor: "pointer", transition: "all 0.2s", display: "flex", flexDirection: "column" },
  thumb: { height: 110, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fname: { fontSize: 12, fontWeight: 700, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 4 },
  dlBtn: { textDecoration: "none", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6 },
  center: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", color: "#8b8fa8" },
  spinner: { width: 44, height: 44, border: "3px solid #e4e7f0", borderTopColor: "#6c63ff", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  pager: { display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: 16, borderTop: "1px solid #e4e7f0", background: "white" },
  pBtn: { background: "#f5f6fa", border: "2px solid #e4e7f0", borderRadius: 8, color: "#1a1a2e", padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700 },
  overlay: { position: "fixed", inset: 0, background: "rgba(26,26,46,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, backdropFilter: "blur(8px)", padding: 12 },
  modal: { background: "white", border: "1px solid #e4e7f0", borderRadius: 16, width: "100%", maxWidth: 1000, maxHeight: "95vh", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" },
  modalClose: { position: "absolute", top: 10, right: 10, background: "rgba(255,255,255,0.95)", border: "1px solid #e4e7f0", borderRadius: 8, color: "#1a1a2e", width: 34, height: 34, cursor: "pointer", fontSize: 14, fontWeight: 700, zIndex: 10 },
  modalTitle: { padding: "14px 54px 12px 16px", fontSize: 13, fontWeight: 700, color: "#1a1a2e", borderBottom: "1px solid #e4e7f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 },
  viewerArea: { flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e", minHeight: 250 },
  viewerImg: { maxWidth: "100%", maxHeight: "78vh", objectFit: "contain" },
  viewerVideo: { width: "100%", maxHeight: "78vh", background: "#000" },
  viewerIframe: { width: "100%", height: "78vh", border: "none", background: "white" },
  audioWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, background: "white", width: "100%" },
  unsupportedWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, background: "white", width: "100%" },
  modalFooter: { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid #e4e7f0", fontSize: 12, fontWeight: 600, color: "#8b8fa8", flexShrink: 0 },
  loginWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse 70% 60% at 10% 90%, #ede9ff 0%, transparent 60%), radial-gradient(ellipse 50% 50% at 90% 10%, #ffd16633 0%, transparent 60%), #f5f6fa" },
  loginCard: { width: "min(380px, 92vw)", padding: "44px 36px", background: "white", borderRadius: 20, boxShadow: "0 8px 32px rgba(108,99,255,0.15)", display: "flex", flexDirection: "column", gap: 18 },
  input: { flex: 1, background: "#f5f6fa", border: "2px solid #e4e7f0", borderRadius: 10, padding: "12px 14px", fontSize: 14, fontWeight: 600, color: "#1a1a2e", outline: "none" },
  btnPrimary: { background: "linear-gradient(135deg,#6c63ff,#8b83ff)", color: "white", border: "none", borderRadius: 10, padding: "12px 20px", fontWeight: 800, fontSize: 14, cursor: "pointer", boxShadow: "0 4px 12px rgba(108,99,255,0.3)" },
  errBox: { color: "#d63384", fontSize: 12, fontWeight: 700, background: "#fff0f6", padding: "8px 12px", borderRadius: 8 },
};

// Add keyframes via injected style
if (typeof document !== "undefined" && !document.getElementById("ad-keyframes")) {
  const style = document.createElement("style");
  style.id = "ad-keyframes";
  style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(style);
}
