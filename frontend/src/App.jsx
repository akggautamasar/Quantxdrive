import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const CATEGORIES = [
  { key: null,              label: "All Files",       emoji: "🗂️" },
  { key: "photos",          label: "Photos",          emoji: "🖼️" },
  { key: "videos",          label: "Videos",          emoji: "🎬" },
  { key: "audio",           label: "Audio",           emoji: "🎵" },
  { key: "pdfs",            label: "PDFs",            emoji: "📄" },
  { key: "word_excel",      label: "Word & Excel",    emoji: "📊" },
  { key: "call_recordings", label: "Call Recordings", emoji: "📞" },
  { key: "other_files",     label: "Other",           emoji: "📦" },
];

const CAT_COLORS = {
  photos:          { bg: "#ede9ff", text: "#6c63ff", border: "#c4bbff" },
  videos:          { bg: "#fff0f3", text: "#ff4d6d", border: "#ffb3c1" },
  audio:           { bg: "#e6fdf6", text: "#00b894", border: "#a0e4ce" },
  pdfs:            { bg: "#fff4e6", text: "#e67e22", border: "#ffd199" },
  word_excel:      { bg: "#e6faf4", text: "#00a878", border: "#99ddc8" },
  call_recordings: { bg: "#fdf0f8", text: "#d63384", border: "#f0aad4" },
  other_files:     { bg: "#f0eeff", text: "#7c6fcd", border: "#c5bbff" },
};

function getColor(cat) {
  return CAT_COLORS[cat] || { bg: "#f0f2f8", text: "#6c63ff", border: "#c4bbff" };
}

function formatSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) throw new Error();
      const { token } = await res.json();
      localStorage.setItem("ad_token", token);
      onLogin(token);
    } catch {
      setError("Wrong password. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.loginWrap}>
      <div style={styles.loginCard}>
        <div style={styles.loginLogo}>
          <div style={styles.logoMark}>✦</div>
          <span style={{ fontWeight: 900, fontSize: 26 }}>AirDrive</span>
        </div>
        <p style={{ color: "#8b8fa8", fontSize: 13, marginTop: -8 }}>Your personal cloud, powered by Telegram.</p>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            type="password"
            placeholder="Enter password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            style={styles.loginInput}
            autoFocus
          />
          <button style={styles.loginBtn} onClick={submit} disabled={loading}>
            {loading ? "…" : "Unlock"}
          </button>
        </div>
        {error && <div style={styles.loginError}>{error}</div>}
      </div>
    </div>
  );
}

// ── File Card ─────────────────────────────────────────────────────────────────
function FileCard({ file, token, onPreview }) {
  const isImage = file.mime?.startsWith("image/");
  const isVideo = file.mime?.startsWith("video/");
  const isAudio = file.mime?.startsWith("audio/");
  const canPreview = isImage || isVideo || isAudio;
  const col = getColor(file.category);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        ...styles.fileCard,
        borderColor: hovered ? col.text : "#e4e7f0",
        transform: hovered ? "translateY(-4px)" : "none",
        boxShadow: hovered ? `0 12px 28px ${col.text}22` : "0 2px 8px rgba(0,0,0,0.06)",
      }}
      onClick={() => canPreview && onPreview(file)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Thumb */}
      <div style={{ ...styles.fileThumb, background: col.bg }}>
        {isImage ? (
          <img
            src={`${API}/api/stream/${file.id}`}
            alt={file.filename}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={e => { e.target.style.display = "none"; }}
          />
        ) : (
          <span style={{ fontSize: 36 }}>
            {isVideo ? "🎬" : isAudio ? "🎵" :
             file.mime?.includes("pdf") ? "📄" :
             file.mime?.includes("zip") || file.mime?.includes("rar") ? "📦" :
             file.mime?.includes("word") || file.mime?.includes("excel") ? "📊" : "📁"}
          </span>
        )}
        {canPreview && hovered && (
          <div style={styles.previewHint}>▶ Preview</div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: "10px 10px 4px" }}>
        <p style={styles.fileName} title={file.filename}>{file.filename}</p>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8b8fa8", fontWeight: 600 }}>
          <span>{formatSize(file.size)}</span>
          <span>{formatDate(file.date)}</span>
        </div>
      </div>

      {/* Download */}
      <div style={{ padding: "6px 10px 10px", display: "flex", justifyContent: "flex-end" }}>
        <a
          href={`${API}/api/download/${file.id}`}
          download={file.filename}
          onClick={e => e.stopPropagation()}
          style={{ ...styles.dlBtn, background: col.bg, color: col.text, border: `1.5px solid ${col.border}` }}
        >
          ↓ Download
        </a>
      </div>
    </div>
  );
}

// ── Preview Modal ─────────────────────────────────────────────────────────────
function PreviewModal({ file, token, onClose }) {
  const isVideo = file.mime?.startsWith("video/");
  const isAudio = file.mime?.startsWith("audio/");
  const isImage = file.mime?.startsWith("image/");
  const url = `${API}/api/stream/${file.id}`;

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <button style={styles.modalClose} onClick={onClose}>✕</button>
        <p style={styles.modalTitle}>{file.filename}</p>
        <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f6fa", minHeight: 200 }}>
          {isImage && <img src={url} alt={file.filename} style={{ maxWidth: "100%", maxHeight: "65vh", objectFit: "contain", borderRadius: 8 }} />}
          {isVideo && <video src={url} controls autoPlay style={{ width: "100%", maxHeight: "65vh" }} />}
          {isAudio && <audio src={url} controls autoPlay style={{ width: "90%", margin: "40px auto" }} />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid #e4e7f0", fontSize: 12, color: "#8b8fa8", fontWeight: 600 }}>
          <span>{formatSize(file.size)}</span>
          <span>{formatDate(file.date)}</span>
          <a href={`${API}/api/download/${file.id}`} download={file.filename} style={{ ...styles.loginBtn, marginLeft: "auto", padding: "7px 16px", textDecoration: "none", fontSize: 13 }}>
            ↓ Download
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ category, setCategory, stats, syncing, onSync, onClose, isMobile }) {
  const catStats = stats?.by_category?.reduce((a, r) => { a[r.category] = r; return a; }, {}) || {};

  return (
    <div style={{ ...styles.sidebar, ...(isMobile ? styles.mobileSidebar : {}) }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16, borderBottom: "1px solid #e4e7f0", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={styles.logoMark}>✦</div>
          <span style={{ fontWeight: 900, fontSize: 18, color: "#1a1a2e" }}>AirDrive</span>
        </div>
        {isMobile && (
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#8b8fa8" }}>✕</button>
        )}
      </div>

      {/* Sync Button — always visible */}
      <button
        style={{ ...styles.syncBtn, opacity: syncing ? 0.7 : 1 }}
        onClick={onSync}
        disabled={syncing}
      >
        <span style={syncing ? { display: "inline-block", animation: "spin 1s linear infinite" } : {}}>⟳</span>
        {syncing ? "Syncing from Telegram…" : "⟳ Sync from Telegram"}
      </button>

      {/* Nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8, flex: 1 }}>
        {CATEGORIES.map(c => {
          const active = category === c.key;
          const col = c.key ? getColor(c.key) : { bg: "#ede9ff", text: "#6c63ff" };
          const count = c.key ? catStats[c.key]?.count : stats?.total_files;
          return (
            <button
              key={c.key}
              style={{
                ...styles.navItem,
                background: active ? col.bg : "transparent",
                color: active ? col.text : "#6b6b72",
                fontWeight: active ? 800 : 600,
              }}
              onClick={() => { setCategory(c.key); if (isMobile) onClose(); }}
            >
              <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{c.emoji}</span>
              <span style={{ flex: 1, textAlign: "left" }}>{c.label}</span>
              {count != null && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
                  background: active ? col.text : "#f0f2f8",
                  color: active ? "white" : "#8b8fa8",
                }}>
                  {count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Stats */}
      {stats && (
        <div style={{ borderTop: "1px solid #e4e7f0", paddingTop: 14, marginTop: 8 }}>
          <p style={{ fontSize: 22, fontWeight: 900, background: "linear-gradient(135deg,#6c63ff,#ff6584)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            {stats.total_files?.toLocaleString()} files
          </p>
          <p style={{ fontSize: 11, color: "#8b8fa8", fontWeight: 600, marginTop: 2 }}>{formatSize(stats.total_size)}</p>
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const searchTimer = useRef(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchFiles = useCallback(async (cat, q, pg) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: pg, limit: 50 });
      if (cat) p.set("category", cat);
      if (q) p.set("q", q);
      const res = await fetch(`${API}/api/files?${p}`, { headers });
      if (res.status === 401) { setToken(""); localStorage.removeItem("ad_token"); return; }
      const data = await res.json();
      setFiles(data.files); setTotal(data.total); setPages(data.pages);
    } catch {}
    setLoading(false);
  }, [token]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/stats`, { headers });
      setStats(await res.json());
    } catch {}
  }, [token]);

  useEffect(() => {
    if (token) { fetchFiles(category, query, page); fetchStats(); }
  }, [token, category, page]);

  const handleSearch = q => {
    setQuery(q);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); fetchFiles(category, q, 1); }, 400);
  };

  const handleCategory = cat => { setCategory(cat); setPage(1); setQuery(""); };

  const syncAll = async () => {
    setSyncing(true);
    try {
      await fetch(`${API}/api/sync/all`, { method: "POST", headers });
      await Promise.all([fetchFiles(category, query, page), fetchStats()]);
    } catch {}
    setSyncing(false);
  };

  if (!token) return <LoginPage onLogin={setToken} />;

  return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Nunito', sans-serif; }
        body { background: #f5f6fa; }
        @keyframes spin { to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 5px; } 
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e4e7f0; border-radius: 10px; }
        .mobile-overlay { display: none; }
        @media (max-width: 768px) {
          .desktop-sidebar { display: none !important; }
          .mobile-overlay { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 99; }
        }
        @media (min-width: 769px) {
          .mobile-menu-btn { display: none !important; }
        }
      `}</style>

      {/* Desktop Sidebar */}
      <div className="desktop-sidebar">
        <Sidebar
          category={category}
          setCategory={handleCategory}
          stats={stats}
          syncing={syncing}
          onSync={syncAll}
          onClose={() => {}}
          isMobile={false}
        />
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileSidebarOpen && (
        <>
          <div className="mobile-overlay" onClick={() => setMobileSidebarOpen(false)} />
          <Sidebar
            category={category}
            setCategory={handleCategory}
            stats={stats}
            syncing={syncing}
            onSync={syncAll}
            onClose={() => setMobileSidebarOpen(false)}
            isMobile={true}
          />
        </>
      )}

      {/* Main */}
      <main style={styles.main}>
        {/* Topbar */}
        <div style={styles.topbar}>
          <button
            className="mobile-menu-btn"
            style={styles.menuBtn}
            onClick={() => setMobileSidebarOpen(true)}
          >
            ☰
          </button>
          <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: 12, fontSize: 16, color: "#8b8fa8" }}>🔍</span>
            <input
              style={styles.searchInput}
              placeholder="Search your files…"
              value={query}
              onChange={e => handleSearch(e.target.value)}
            />
            {query && (
              <button onClick={() => handleSearch("")} style={{ position: "absolute", right: 10, background: "none", border: "none", cursor: "pointer", color: "#8b8fa8", fontSize: 14 }}>✕</button>
            )}
          </div>
          {!loading && (
            <span style={{ fontSize: 12, color: "#8b8fa8", fontWeight: 700, background: "#f0f2f8", padding: "5px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
              {total.toLocaleString()} files
            </span>
          )}
        </div>

        {/* Mobile Sync Button */}
        <div className="mobile-sync" style={{ padding: "10px 16px 0", display: "none" }}>
          <style>{`@media (max-width: 768px) { .mobile-sync { display: block !important; } }`}</style>
          <button style={{ ...styles.syncBtn, width: "100%" }} onClick={syncAll} disabled={syncing}>
            {syncing ? "⟳ Syncing from Telegram…" : "⟳ Sync from Telegram"}
          </button>
        </div>

        {/* Category Pills (mobile) */}
        <div style={{ padding: "10px 16px 0", overflowX: "auto", display: "flex", gap: 8, scrollbarWidth: "none" }}>
          <style>{`@media (min-width: 769px) { .cat-pills { display: none !important; } }`}</style>
          <div className="cat-pills" style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {CATEGORIES.map(c => {
              const active = category === c.key;
              const col = c.key ? getColor(c.key) : { bg: "#ede9ff", text: "#6c63ff" };
              return (
                <button
                  key={c.key}
                  onClick={() => handleCategory(c.key)}
                  style={{
                    background: active ? col.bg : "white",
                    color: active ? col.text : "#8b8fa8",
                    border: `1.5px solid ${active ? col.text : "#e4e7f0"}`,
                    borderRadius: 20,
                    padding: "5px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.emoji} {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", gap: 14, color: "#8b8fa8" }}>
              <div style={{ width: 44, height: 44, border: "3px solid #e4e7f0", borderTopColor: "#6c63ff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <p style={{ fontWeight: 700 }}>Loading files…</p>
            </div>
          ) : files.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", gap: 12, color: "#8b8fa8", textAlign: "center" }}>
              <span style={{ fontSize: 56 }}>📭</span>
              <p style={{ fontWeight: 800, fontSize: 16, color: "#1a1a2e" }}>No files found</p>
              <p style={{ fontSize: 13 }}>Tap <strong>Sync from Telegram</strong> to import your files</p>
            </div>
          ) : (
            <div style={styles.grid}>
              {files.map(f => (
                <FileCard key={f.id} file={f} token={token} onPreview={setPreview} />
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: 16, borderTop: "1px solid #e4e7f0", background: "white" }}>
            <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ fontSize: 13, color: "#8b8fa8", fontWeight: 700 }}>{page} / {pages}</span>
            <button style={styles.pageBtn} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </main>

      {preview && <PreviewModal file={preview} token={token} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  app: { display: "flex", height: "100vh", overflow: "hidden", background: "#f5f6fa" },

  sidebar: {
    width: 240,
    background: "white",
    borderRight: "1px solid #e4e7f0",
    display: "flex",
    flexDirection: "column",
    padding: "20px 14px",
    flexShrink: 0,
    overflowY: "auto",
    boxShadow: "2px 0 12px rgba(0,0,0,0.04)",
  },

  mobileSidebar: {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 100,
    width: 280,
    boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
  },

  logoMark: {
    width: 36,
    height: 36,
    background: "linear-gradient(135deg, #6c63ff, #ff6584)",
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    color: "white",
    fontWeight: 900,
    flexShrink: 0,
  },

  syncBtn: {
    width: "100%",
    padding: "11px 16px",
    background: "linear-gradient(135deg, #6c63ff, #8b83ff)",
    border: "none",
    borderRadius: 10,
    color: "white",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(108,99,255,0.3)",
    marginBottom: 4,
  },

  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 10px",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    transition: "all 0.15s",
    width: "100%",
  },

  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  },

  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    background: "white",
    borderBottom: "1px solid #e4e7f0",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
    flexShrink: 0,
  },

  menuBtn: {
    background: "#f0f2f8",
    border: "1px solid #e4e7f0",
    borderRadius: 8,
    color: "#6c63ff",
    width: 38,
    height: 38,
    cursor: "pointer",
    fontSize: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  searchInput: {
    width: "100%",
    background: "#f5f6fa",
    border: "2px solid #e4e7f0",
    borderRadius: 10,
    padding: "9px 36px 9px 40px",
    fontSize: 14,
    fontWeight: 600,
    color: "#1a1a2e",
    outline: "none",
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: 12,
  },

  fileCard: {
    background: "white",
    border: "2px solid #e4e7f0",
    borderRadius: 14,
    overflow: "hidden",
    cursor: "pointer",
    transition: "all 0.2s",
    display: "flex",
    flexDirection: "column",
  },

  fileThumb: {
    height: 110,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
  },

  previewHint: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    background: "rgba(0,0,0,0.5)",
    color: "white",
    fontSize: 11,
    fontWeight: 700,
    textAlign: "center",
    padding: "6px 4px 4px",
  },

  fileName: {
    fontSize: 12,
    fontWeight: 700,
    color: "#1a1a2e",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    marginBottom: 4,
  },

  dlBtn: {
    textDecoration: "none",
    fontSize: 11,
    fontWeight: 800,
    padding: "3px 10px",
    borderRadius: 6,
    transition: "all 0.15s",
  },

  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(26,26,46,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 200,
    backdropFilter: "blur(8px)",
    padding: 16,
  },

  modalBox: {
    background: "white",
    border: "2px solid #e4e7f0",
    borderRadius: 20,
    width: "100%",
    maxWidth: 880,
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    position: "relative",
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },

  modalClose: {
    position: "absolute",
    top: 12,
    right: 12,
    background: "#f5f6fa",
    border: "1px solid #e4e7f0",
    borderRadius: 8,
    color: "#8b8fa8",
    width: 32,
    height: 32,
    cursor: "pointer",
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },

  modalTitle: {
    padding: "16px 52px 14px 16px",
    fontSize: 13,
    fontWeight: 700,
    color: "#1a1a2e",
    borderBottom: "1px solid #e4e7f0",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flexShrink: 0,
  },

  loginWrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "radial-gradient(ellipse 70% 60% at 10% 90%, #ede9ff 0%, transparent 60%), radial-gradient(ellipse 50% 50% at 90% 10%, #ffd16633 0%, transparent 60%), #f5f6fa",
  },

  loginCard: {
    width: "min(380px, 92vw)",
    padding: "44px 36px",
    background: "white",
    border: "1px solid #e4e7f0",
    borderRadius: 20,
    boxShadow: "0 8px 32px rgba(108,99,255,0.15)",
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },

  loginLogo: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "#1a1a2e",
  },

  loginInput: {
    flex: 1,
    background: "#f5f6fa",
    border: "2px solid #e4e7f0",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 14,
    fontWeight: 600,
    color: "#1a1a2e",
    outline: "none",
  },

  loginBtn: {
    background: "linear-gradient(135deg, #6c63ff, #8b83ff)",
    color: "white",
    border: "none",
    borderRadius: 10,
    padding: "12px 20px",
    fontWeight: 800,
    fontSize: 14,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 4px 12px rgba(108,99,255,0.3)",
  },

  loginError: {
    color: "#d63384",
    fontSize: 12,
    fontWeight: 700,
    background: "#fff0f6",
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #f0aad4",
  },

  pageBtn: {
    background: "#f5f6fa",
    border: "2px solid #e4e7f0",
    borderRadius: 8,
    color: "#1a1a2e",
    padding: "7px 16px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
  },
};
