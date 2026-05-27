import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const CATEGORIES = [
  { key: null,              label: "All Files",       icon: "◈" },
  { key: "photos",          label: "Photos",          icon: "◎" },
  { key: "videos",          label: "Videos",          icon: "▷" },
  { key: "audio",           label: "Audio",           icon: "♪" },
  { key: "pdfs",            label: "PDFs",            icon: "◻" },
  { key: "word_excel",      label: "Word & Excel",    icon: "◧" },
  { key: "call_recordings", label: "Call Recordings", icon: "◉" },
  { key: "other_files",     label: "Other",           icon: "◌" },
];

const MIME_ICONS = {
  "image/": "◎",
  "video/": "▷",
  "audio/": "♪",
  "application/pdf": "◻",
  "application/vnd": "◧",
  "application/zip": "◈",
  "application/x-rar": "◈",
};

function getMimeIcon(mime = "") {
  for (const [k, v] of Object.entries(MIME_ICONS)) {
    if (mime.startsWith(k)) return v;
  }
  return "◌";
}

function formatSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function LoginPage({ onLogin }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) throw new Error("Wrong password");
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
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <span className="logo-mark">✦</span>
          <span className="logo-text">AirDrive</span>
        </div>
        <p className="login-sub">Your personal cloud, on Telegram.</p>
        <div className="login-field">
          <input
            type="password"
            placeholder="Enter password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            className="login-input"
            autoFocus
          />
          <button className="login-btn" onClick={handleSubmit} disabled={loading}>
            {loading ? "…" : "Unlock"}
          </button>
        </div>
        {error && <p className="login-error">{error}</p>}
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

  return (
    <div className="file-card" data-cat={file.category} onClick={() => canPreview && onPreview(file)}> canPreview && onPreview(file)}>
      <div className={`file-thumb ${isImage ? "file-thumb--image" : ""}`}>
        {isImage ? (
          <img
            src={`${API}/api/stream/${file.id}?token=${token}`}
            alt={file.filename}
            loading="lazy"
            onError={e => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
          />
        ) : null}
        <div className="file-icon-wrap" style={{ display: isImage ? "none" : "flex" }}>
          <span className="file-icon">{getMimeIcon(file.mime)}</span>
        </div>
        {canPreview && <div className="file-preview-hint">tap to preview</div>}
      </div>
      <div className="file-info">
        <p className="file-name" title={file.filename}>{file.filename}</p>
        <div className="file-meta">
          <span>{formatSize(file.size)}</span>
          <span>{formatDate(file.date)}</span>
        </div>
      </div>
      <div className="file-actions">
        <a
          href={`${API}/api/download/${file.id}`}
          download={file.filename}
          onClick={e => e.stopPropagation()}
          className="file-dl"
          title="Download"
        >↓</a>
      </div>
    </div>
  );
}

// ── Preview Modal ─────────────────────────────────────────────────────────────

function PreviewModal({ file, token, onClose }) {
  const isVideo = file.mime?.startsWith("video/");
  const isAudio = file.mime?.startsWith("audio/");
  const isImage = file.mime?.startsWith("image/");
  const streamUrl = `${API}/api/stream/${file.id}?token=${token}`;

  useEffect(() => {
    const handler = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <p className="modal-title">{file.filename}</p>
        <div className="modal-media">
          {isImage && <img src={streamUrl} alt={file.filename} className="modal-img" />}
          {isVideo && <video src={streamUrl} controls autoPlay className="modal-video" />}
          {isAudio && <audio src={streamUrl} controls autoPlay className="modal-audio" />}
        </div>
        <div className="modal-footer">
          <span>{formatSize(file.size)}</span>
          <span>{formatDate(file.date)}</span>
          <a href={`${API}/api/download/${file.id}`} download={file.filename} className="modal-dl">
            Download ↓
          </a>
        </div>
      </div>
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const searchTimer = useRef(null);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const fetchFiles = useCallback(async (cat, q, pg) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pg, limit: 50 });
      if (cat) params.set("category", cat);
      if (q) params.set("q", q);
      const res = await fetch(`${API}/api/files?${params}`, { headers: authHeaders });
      if (res.status === 401) { setToken(""); localStorage.removeItem("ad_token"); return; }
      const data = await res.json();
      setFiles(data.files);
      setTotal(data.total);
      setPages(data.pages);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/stats`, { headers: authHeaders });
      const data = await res.json();
      setStats(data);
    } catch {}
  }, [token]);

  useEffect(() => {
    if (token) { fetchFiles(category, query, page); fetchStats(); }
  }, [token, category, page]);

  const handleSearch = (q) => {
    setQuery(q);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); fetchFiles(category, q, 1); }, 400);
  };

  const handleCategory = (cat) => {
    setCategory(cat);
    setPage(1);
    setQuery("");
  };

  const syncAll = async () => {
    setSyncing(true);
    try {
      await fetch(`${API}/api/sync/all`, { method: "POST", headers: authHeaders });
      await fetchFiles(category, query, page);
      await fetchStats();
    } catch {}
    setSyncing(false);
  };

  if (!token) return <LoginPage onLogin={setToken} />;

  const catStats = stats?.by_category?.reduce((acc, r) => { acc[r.category] = r; return acc; }, {}) || {};

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "sidebar--open" : "sidebar--closed"}`}>
        <div className="sidebar-header">
          <span className="logo-mark">✦</span>
          {sidebarOpen && <span className="logo-text">AirDrive</span>}
        </div>

        <nav className="sidebar-nav">
          {CATEGORIES.map(c => (
            <button
              key={c.key}
              className={`nav-item ${category === c.key ? "nav-item--active" : ""}`}
              onClick={() => handleCategory(c.key)}
            >
              <span className="nav-icon">{c.icon}</span>
              {sidebarOpen && (
                <span className="nav-label">
                  {c.label}
                  {c.key && catStats[c.key] && (
                    <span className="nav-count">{catStats[c.key].count}</span>
                  )}
                </span>
              )}
            </button>
          ))}
        </nav>

        {sidebarOpen && stats && (
          <div className="sidebar-stats">
            <p className="stats-total">{stats.total_files.toLocaleString()} files</p>
            <p className="stats-size">{formatSize(stats.total_size)}</p>
          </div>
        )}

        <button
          className="sync-btn"
          onClick={syncAll}
          disabled={syncing}
          title="Sync from Telegram"
        >
          <span className={syncing ? "spin" : ""}>⟳</span>
          {sidebarOpen && <span>{syncing ? "Syncing…" : "Sync"}</span>}
        </button>
      </aside>

      {/* Main */}
      <main className="main">
        {/* Topbar */}
        <div className="topbar">
          <button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)}>
            {sidebarOpen ? "◂" : "▸"}
          </button>
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              className="search-input"
              placeholder="Search files…"
              value={query}
              onChange={e => handleSearch(e.target.value)}
            />
            {query && <button className="search-clear" onClick={() => handleSearch("")}>✕</button>}
          </div>
          <div className="topbar-info">
            {!loading && <span className="file-count">{total.toLocaleString()} files</span>}
          </div>
        </div>

        {/* Grid */}
        <div className="grid-area">
          {loading ? (
            <div className="loading-state">
              <span className="spinner">◈</span>
              <p>Loading…</p>
            </div>
          ) : files.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">◌</span>
              <p>No files found.</p>
              <p className="empty-hint">Try syncing from Telegram first.</p>
            </div>
          ) : (
            <div className="file-grid">
              {files.map(f => (
                <FileCard key={f.id} file={f} token={token} onPreview={setPreview} />
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</button>
            <span>{page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(p => p + 1)}>→</button>
          </div>
        )}
      </main>

      {/* Preview */}
      {preview && <PreviewModal file={preview} token={token} onClose={() => setPreview(null)} />}
    </div>
  );
}
