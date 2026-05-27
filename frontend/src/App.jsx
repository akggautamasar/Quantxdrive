import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
  photos: { bg: "#ede9ff", text: "#6c63ff" },
  videos: { bg: "#fff0f3", text: "#ff4d6d" },
  audio:  { bg: "#e6fdf6", text: "#00b894" },
  pdfs:   { bg: "#fff4e6", text: "#e67e22" },
  word_excel: { bg: "#e6faf4", text: "#00a878" },
  call_recordings: { bg: "#fdf0f8", text: "#d63384" },
  other_files: { bg: "#f0eeff", text: "#7c6fcd" },
};
const getColor = c => COLORS[c] || { bg: "#f0f2f8", text: "#6c63ff" };

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
const getEmoji = k => ({ image:"🖼️", video:"🎬", audio:"🎵", pdf:"📄", epub:"📚", office:"📊", text:"📝", other:"📦"}[k]);
const fmtSize = b => !b ? "—" : b < 1024*1024 ? `${(b/1024).toFixed(0)} KB` : b < 1024*1024*1024 ? `${(b/(1024*1024)).toFixed(1)} MB` : `${(b/(1024*1024*1024)).toFixed(2)} GB`;
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "";

// ── Login ─────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true); setErr("");
    try {
      const res = await fetch(`${API}/api/login`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({password: pw}) });
      if (!res.ok) throw new Error();
      const { token } = await res.json();
      localStorage.setItem("ad_token", token); onLogin(token);
    } catch { setErr("Wrong password"); }
    setLoading(false);
  };
  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={S.logoMark}>✦</div><span style={{ fontWeight: 900, fontSize: 26 }}>AirDrive</span>
        </div>
        <p style={{ color:"#8b8fa8", fontSize:13 }}>Your personal cloud on Telegram.</p>
        <div style={{ display:"flex", gap:10 }}>
          <input type="password" placeholder="Password" value={pw} onChange={e=>setPw(e.target.value)}
            onKeyDown={e=>e.key==="Enter" && submit()} style={S.input} autoFocus />
          <button style={S.btnP} onClick={submit} disabled={loading}>{loading?"…":"Unlock"}</button>
        </div>
        {err && <div style={S.errBox}>{err}</div>}
      </div>
    </div>
  );
}

// ── File Card ─────────────────────────────────────────────────────────────────
function Card({ file, token, onPreview, onFav, onMenu }) {
  const kind = getKind(file); const col = getColor(file.category);
  const url = `${API}/api/media/${token}/${file.id}`;
  return (
    <div style={{ ...S.card, borderColor: file.favorite ? "#ffc107" : "#e4e7f0" }} onClick={()=>onPreview(file)}>
      <div style={{ ...S.thumb, background: col.bg }}>
        {kind === "image"
          ? <img src={url} alt="" loading="lazy" style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>{ e.target.style.display="none"; }} />
          : <span style={{ fontSize: 36 }}>{getEmoji(kind)}</span>}
        <button onClick={e=>{ e.stopPropagation(); onFav(file); }} style={{ ...S.starBtn, color: file.favorite ? "#ffc107" : "#fff", textShadow: file.favorite ? "none" : "0 1px 3px rgba(0,0,0,0.4)" }}>
          {file.favorite ? "★" : "☆"}
        </button>
      </div>
      <div style={{ padding:"8px 10px 4px" }}>
        <p style={S.fname} title={file.filename}>{file.filename}</p>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#8b8fa8", fontWeight:600 }}>
          <span>{fmtSize(file.size)}</span><span>{fmtDate(file.date)}</span>
        </div>
      </div>
      <div style={{ padding:"4px 8px 8px", display:"flex", gap:6, justifyContent:"flex-end" }}>
        <button onClick={e=>{ e.stopPropagation(); onMenu(file); }} style={{ ...S.smallBtn, background:"#f0f2f8", color:"#6b6b72" }}>⋯</button>
        <a href={url} download={file.filename} onClick={e=>e.stopPropagation()} style={{ ...S.smallBtn, background:col.bg, color:col.text, textDecoration:"none" }}>↓</a>
      </div>
    </div>
  );
}

// ── Action menu (folder, share) ───────────────────────────────────────────────
function ActionMenu({ file, token, folders, onClose, onFolderChange, onShareCreated }) {
  const [tab, setTab] = useState("folder");
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [shareLink, setShareLink] = useState(null);
  const [shareExpiry, setShareExpiry] = useState("7"); // days

  const moveToFolder = async (folderId) => {
    await fetch(`${API}/api/files/${file.id}/folder`, {
      method: "POST", headers: {"Content-Type":"application/json", Authorization:`Bearer ${token}`},
      body: JSON.stringify({ folder_id: folderId }),
    });
    onFolderChange(); onClose();
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreating(true);
    const res = await fetch(`${API}/api/folders`, {
      method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`},
      body: JSON.stringify({ name: newFolderName.trim() }),
    });
    const f = await res.json();
    await moveToFolder(f.id);
    setCreating(false); setNewFolderName("");
  };

  const createShareLink = async () => {
    const days = parseInt(shareExpiry) || 7;
    const res = await fetch(`${API}/api/share/${file.id}`, {
      method: "POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`},
      body: JSON.stringify({ expires_in: days * 86400 }),
    });
    const data = await res.json();
    const link = `${window.location.origin}/share/${data.share_token}`;
    setShareLink(link);
    onShareCreated && onShareCreated(link);
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 480, maxHeight: "auto" }} onClick={e=>e.stopPropagation()}>
        <button style={S.modalClose} onClick={onClose}>✕</button>
        <p style={S.modalTitle}>{file.filename}</p>
        <div style={{ display:"flex", borderBottom:"1px solid #e4e7f0" }}>
          <button onClick={()=>setTab("folder")} style={{ ...S.tab, ...(tab==="folder" ? S.tabActive : {}) }}>📁 Folder</button>
          <button onClick={()=>setTab("share")} style={{ ...S.tab, ...(tab==="share" ? S.tabActive : {}) }}>🔗 Share</button>
        </div>
        {tab === "folder" && (
          <div style={{ padding: 16, display:"flex", flexDirection:"column", gap:8 }}>
            <button onClick={()=>moveToFolder(null)} style={{ ...S.listBtn, color: !file.folder_id ? "#6c63ff" : "#1a1a2e", fontWeight: !file.folder_id ? 800 : 600 }}>
              📂 No folder {!file.folder_id && "✓"}
            </button>
            {folders.map(f => (
              <button key={f.id} onClick={()=>moveToFolder(f.id)} style={{ ...S.listBtn, color: file.folder_id===f.id ? "#6c63ff" : "#1a1a2e", fontWeight: file.folder_id===f.id ? 800 : 600 }}>
                📁 {f.name} {file.folder_id===f.id && "✓"}
              </button>
            ))}
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <input value={newFolderName} onChange={e=>setNewFolderName(e.target.value)} placeholder="New folder name..." style={{ ...S.input, flex:1, padding:"8px 12px" }} />
              <button onClick={createFolder} disabled={creating || !newFolderName.trim()} style={{ ...S.btnP, padding:"8px 14px" }}>+ Create</button>
            </div>
          </div>
        )}
        {tab === "share" && (
          <div style={{ padding: 16, display:"flex", flexDirection:"column", gap:12 }}>
            {!shareLink ? (
              <>
                <label style={{ fontSize:13, fontWeight:600, color:"#1a1a2e" }}>Link expires after</label>
                <select value={shareExpiry} onChange={e=>setShareExpiry(e.target.value)} style={{ ...S.input, padding:"8px 12px" }}>
                  <option value="1">1 day</option><option value="7">7 days</option>
                  <option value="30">30 days</option><option value="365">1 year</option>
                </select>
                <button onClick={createShareLink} style={S.btnP}>🔗 Generate Share Link</button>
              </>
            ) : (
              <>
                <label style={{ fontSize:13, fontWeight:600 }}>Share link (anyone with this link can view):</label>
                <input value={shareLink} readOnly style={{ ...S.input, padding:"8px 12px", fontSize:11 }} onClick={e=>e.target.select()} />
                <button onClick={()=>{ navigator.clipboard.writeText(shareLink); alert("Copied!"); }} style={S.btnP}>📋 Copy Link</button>
              </>
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
  }, []);

  const render = () => {
    if (kind === "image") return <img src={url} alt={file.filename} style={S.vImg} />;
    if (kind === "video") return <video src={url} controls autoPlay playsInline style={S.vVid} />;
    if (kind === "audio") return (
      <div style={S.audioBox}>
        <div style={{ fontSize: 80 }}>🎵</div>
        <p style={{ fontWeight: 700, fontSize: 16, marginTop: 12, textAlign:"center" }}>{file.filename}</p>
        <audio src={url} controls autoPlay style={{ width: "100%", marginTop: 20 }} />
      </div>
    );
    if (kind === "pdf" || kind === "text") return <iframe src={url} style={S.vFrame} title={file.filename} />;
    return (
      <div style={S.unsupBox}>
        <div style={{ fontSize: 60 }}>{getEmoji(kind)}</div>
        <p style={{ fontWeight: 700, marginTop: 12 }}>{file.filename}</p>
        <p style={{ fontSize: 13, color: "#8b8fa8", marginTop: 6 }}>Preview not supported</p>
        <a href={url} download={file.filename} style={{ ...S.btnP, marginTop: 16, textDecoration: "none" }}>↓ Download</a>
      </div>
    );
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e=>e.stopPropagation()}>
        <button style={S.modalClose} onClick={onClose}>✕</button>
        <p style={S.modalTitle}>{file.filename}</p>
        <div style={S.vArea}>{render()}</div>
        <div style={S.modalFooter}>
          <span>{fmtSize(file.size)}</span><span>{fmtDate(file.date)}</span>
          <a href={url} download={file.filename} style={{ ...S.btnP, marginLeft:"auto", padding:"7px 16px", textDecoration:"none", fontSize:13 }}>↓ Download</a>
        </div>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
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
      const res = await fetch(`${API}/api/files?${p}`, { headers: {Authorization:`Bearer ${token}`} });
      if (res.status === 401) { setToken(""); localStorage.removeItem("ad_token"); return; }
      const data = await res.json();
      setFiles(data.files); setTotal(data.total); setPages(data.pages);
    } catch {}
    setLoading(false);
  }, [token]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/stats`, { headers: {Authorization:`Bearer ${token}`} });
      setStats(await res.json());
    } catch {}
  }, [token]);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/folders`, { headers: {Authorization:`Bearer ${token}`} });
      const data = await res.json();
      setFolders(data.folders || []);
    } catch {}
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
      await fetch(`${API}/api/sync/all`, { method: "POST", headers: {Authorization:`Bearer ${token}`} });
      await Promise.all([fetchFiles(realCategory, query, page, sortBy, sortDir, showFavorites, showFolders ? folder : null), fetchStats()]);
    } catch {}
    setSyncing(false);
  };

  const toggleFav = async (file) => {
    await fetch(`${API}/api/favorite/${file.id}`, { method: "POST", headers: {Authorization:`Bearer ${token}`} });
    setFiles(files.map(f => f.id === file.id ? { ...f, favorite: !f.favorite } : f));
  };

  if (!token) return <Login onLogin={setToken} />;

  const catStats = stats?.by_category?.reduce((a, r) => { a[r.category] = r; return a; }, {}) || {};

  // Determine which sidebar items to show counts for
  const getCount = (key) => {
    if (key === null) return stats?.total_files;
    if (key === "__favorites") return stats?.favorites_count;
    if (key === "__folders") return stats?.folders_count;
    return catStats[key]?.count;
  };

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Nunito', sans-serif; }
        body { background: #f5f6fa; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: #e4e7f0; border-radius: 10px; }
        .desktop-sb { display: block; }
        .mobile-only { display: none; }
        .mobile-btn { display: none; }
        @media (max-width: 768px) {
          .desktop-sb { display: none; }
          .mobile-only { display: block; }
          .mobile-btn { display: flex; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="desktop-sb">
        <Sidebar category={category} setCategory={handleCategory} stats={stats} syncing={syncing} onSync={syncAll}
          onClose={()=>{}} isMobile={false} getCount={getCount} folders={folders} folder={folder} setFolder={setFolder} />
      </div>

      {sbOpen && (
        <>
          <div onClick={()=>setSbOpen(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:99 }} />
          <Sidebar category={category} setCategory={handleCategory} stats={stats} syncing={syncing} onSync={syncAll}
            onClose={()=>setSbOpen(false)} isMobile getCount={getCount} folders={folders} folder={folder} setFolder={setFolder} />
        </>
      )}

      <main style={S.main}>
        {/* COMPACT TOPBAR — one row only */}
        <div style={S.topbar}>
          <button className="mobile-btn" style={S.menuBtn} onClick={()=>setSbOpen(true)}>☰</button>
          <div style={{ flex:1, position:"relative", display:"flex", alignItems:"center" }}>
            <span style={{ position:"absolute", left:10, fontSize:14 }}>🔍</span>
            <input style={S.search} placeholder="Search…" value={query} onChange={e=>handleSearch(e.target.value)} />
            {query && <button onClick={()=>handleSearch("")} style={{ position:"absolute", right:8, background:"none", border:"none", cursor:"pointer", color:"#8b8fa8", fontSize:13 }}>✕</button>}
          </div>
          {/* Sort dropdown */}
          <select value={`${sortBy}-${sortDir}`} onChange={e=>{ const [b,d] = e.target.value.split("-"); setSortBy(b); setSortDir(d); }} style={S.sortSel}>
            <option value="date-desc">Newest</option>
            <option value="date-asc">Oldest</option>
            <option value="name-asc">Name A→Z</option>
            <option value="name-desc">Name Z→A</option>
            <option value="size-desc">Largest</option>
            <option value="size-asc">Smallest</option>
          </select>
          {!loading && <span style={S.countBadge}>{total.toLocaleString()}</span>}
        </div>

        {/* MOBILE: horizontal category pills (compact) */}
        <div className="mobile-only" style={{ padding:"8px 12px 0", overflowX:"auto" }}>
          <div style={{ display:"flex", gap:6 }}>
            {CATEGORIES.map(c => {
              const active = category === c.key;
              const col = (c.key && !c.key.startsWith("__")) ? getColor(c.key) : { bg:"#ede9ff", text:"#6c63ff" };
              return (
                <button key={c.key||"all"} onClick={()=>handleCategory(c.key)} style={{
                  background: active ? col.bg : "white", color: active ? col.text : "#8b8fa8",
                  border: `1.5px solid ${active ? col.text : "#e4e7f0"}`, borderRadius: 20,
                  padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {c.emoji} {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Folder chips when in folders view */}
        {showFolders && (
          <div style={{ padding:"10px 14px 0", overflowX:"auto" }}>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              <button onClick={()=>setFolder("")} style={{ ...S.pill, background: folder==="" ? "#ede9ff" : "white", color: folder==="" ? "#6c63ff" : "#8b8fa8", borderColor: folder==="" ? "#6c63ff" : "#e4e7f0" }}>
                📂 Unfiled
              </button>
              {folders.map(f => (
                <button key={f.id} onClick={()=>setFolder(f.id)} style={{ ...S.pill, background: folder===f.id ? "#ede9ff" : "white", color: folder===f.id ? "#6c63ff" : "#8b8fa8", borderColor: folder===f.id ? "#6c63ff" : "#e4e7f0" }}>
                  📁 {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Grid — maximum space */}
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {loading ? (
            <div style={S.center}>
              <div style={S.spinner} />
              <p style={{ marginTop: 14, color: "#8b8fa8" }}>Loading…</p>
            </div>
          ) : files.length === 0 ? (
            <div style={S.center}>
              <span style={{ fontSize: 56 }}>📭</span>
              <p style={{ fontWeight: 800, fontSize: 16, marginTop: 12 }}>No files</p>
              <p style={{ fontSize: 13, color: "#8b8fa8", marginTop: 4 }}>{showFolders && folder===null ? "Pick a folder" : "Try syncing"}</p>
            </div>
          ) : (
            <div style={S.grid}>
              {files.map(f => <Card key={f.id} file={f} token={token} onPreview={setPreview} onFav={toggleFav} onMenu={setMenuFile} />)}
            </div>
          )}
        </div>

        {pages > 1 && (
          <div style={S.pager}>
            <button style={S.pBtn} disabled={page <= 1} onClick={()=>setPage(p=>p-1)}>←</button>
            <span style={{ fontSize: 12, color: "#8b8fa8", fontWeight: 700 }}>{page} / {pages}</span>
            <button style={S.pBtn} disabled={page >= pages} onClick={()=>setPage(p=>p+1)}>→</button>
          </div>
        )}
      </main>

      {preview && <Preview file={preview} token={token} onClose={()=>setPreview(null)} />}
      {menuFile && <ActionMenu file={menuFile} token={token} folders={folders} onClose={()=>setMenuFile(null)}
        onFolderChange={()=>{ fetchFiles(realCategory, query, page, sortBy, sortDir, showFavorites, showFolders ? folder : null); fetchStats(); }} />}
    </div>
  );
}

function Sidebar({ category, setCategory, stats, syncing, onSync, onClose, isMobile, getCount, folders, folder, setFolder }) {
  return (
    <div style={{ ...S.sidebar, ...(isMobile ? S.mobileSb : {}) }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingBottom:14, borderBottom:"1px solid #e4e7f0", marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={S.logoMark}>✦</div><span style={{ fontWeight:900, fontSize:18 }}>AirDrive</span>
        </div>
        {isMobile && <button onClick={onClose} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:"#8b8fa8" }}>✕</button>}
      </div>
      <button style={{ ...S.syncBtn, opacity: syncing ? 0.7 : 1 }} onClick={onSync} disabled={syncing}>
        ⟳ {syncing ? "Syncing…" : "Sync"}
      </button>
      <nav style={{ display:"flex", flexDirection:"column", gap:2, marginTop:8, flex:1, overflowY:"auto" }}>
        {CATEGORIES.map(c => {
          const active = category === c.key;
          const col = (c.key && !c.key.startsWith("__")) ? getColor(c.key) : { bg:"#ede9ff", text:"#6c63ff" };
          const count = getCount(c.key);
          return (
            <button key={c.key||"all"} style={{ ...S.navItem, background: active ? col.bg : "transparent", color: active ? col.text : "#6b6b72", fontWeight: active ? 800 : 600 }}
              onClick={() => { setCategory(c.key); if (isMobile) onClose(); }}>
              <span style={{ fontSize:15, width:20, textAlign:"center" }}>{c.emoji}</span>
              <span style={{ flex:1, textAlign:"left" }}>{c.label}</span>
              {count != null && <span style={{ fontSize:10, fontWeight:700, padding:"2px 6px", borderRadius:20, background: active ? col.text : "#f0f2f8", color: active ? "white" : "#8b8fa8" }}>{count.toLocaleString()}</span>}
            </button>
          );
        })}
      </nav>
      {stats && (
        <div style={{ borderTop:"1px solid #e4e7f0", paddingTop:12 }}>
          <p style={{ fontSize:18, fontWeight:900, background:"linear-gradient(135deg,#6c63ff,#ff6584)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
            {stats.total_files?.toLocaleString()}
          </p>
          <p style={{ fontSize:11, color:"#8b8fa8", fontWeight:600 }}>{fmtSize(stats.total_size)}</p>
        </div>
      )}
    </div>
  );
}

const S = {
  app: { display:"flex", height:"100vh", overflow:"hidden", background:"#f5f6fa" },
  sidebar: { width:220, background:"white", borderRight:"1px solid #e4e7f0", display:"flex", flexDirection:"column", padding:"16px 12px", flexShrink:0, overflowY:"hidden" },
  mobileSb: { position:"fixed", top:0, left:0, bottom:0, zIndex:100, width:260, boxShadow:"4px 0 24px rgba(0,0,0,0.15)" },
  logoMark: { width:34, height:34, background:"linear-gradient(135deg,#6c63ff,#ff6584)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, color:"white", fontWeight:900 },
  syncBtn: { width:"100%", padding:"9px 14px", background:"linear-gradient(135deg,#6c63ff,#8b83ff)", border:"none", borderRadius:9, color:"white", fontSize:12, fontWeight:800, cursor:"pointer", boxShadow:"0 4px 12px rgba(108,99,255,0.3)" },
  navItem: { display:"flex", alignItems:"center", gap:8, padding:"8px 10px", borderRadius:9, border:"none", cursor:"pointer", fontSize:12, width:"100%" },
  main: { flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minWidth:0 },
  topbar: { display:"flex", alignItems:"center", gap:8, padding:"10px 12px", background:"white", borderBottom:"1px solid #e4e7f0", flexShrink:0 },
  menuBtn: { background:"#f0f2f8", border:"1px solid #e4e7f0", borderRadius:8, color:"#6c63ff", width:34, height:34, cursor:"pointer", fontSize:16, alignItems:"center", justifyContent:"center" },
  search: { width:"100%", background:"#f5f6fa", border:"1.5px solid #e4e7f0", borderRadius:8, padding:"7px 30px 7px 32px", fontSize:13, fontWeight:600, outline:"none" },
  sortSel: { background:"#f0f2f8", border:"1.5px solid #e4e7f0", borderRadius:8, padding:"7px 8px", fontSize:11, fontWeight:700, color:"#6c63ff", cursor:"pointer", outline:"none" },
  countBadge: { fontSize:11, color:"#8b8fa8", fontWeight:700, background:"#f0f2f8", padding:"4px 9px", borderRadius:20, whiteSpace:"nowrap" },
  pill: { borderRadius:20, padding:"4px 10px", fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", border:"1.5px solid #e4e7f0" },
  grid: { display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:10 },
  card: { background:"white", border:"2px solid #e4e7f0", borderRadius:12, overflow:"hidden", cursor:"pointer", transition:"all 0.2s", display:"flex", flexDirection:"column" },
  thumb: { height:100, display:"flex", alignItems:"center", justifyContent:"center", position:"relative", overflow:"hidden" },
  starBtn: { position:"absolute", top:6, right:6, background:"none", border:"none", fontSize:20, cursor:"pointer", lineHeight:1, padding:2 },
  fname: { fontSize:11, fontWeight:700, color:"#1a1a2e", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", marginBottom:3 },
  smallBtn: { border:"none", borderRadius:6, padding:"3px 10px", fontSize:12, fontWeight:800, cursor:"pointer" },
  center: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"50vh", color:"#8b8fa8" },
  spinner: { width:44, height:44, border:"3px solid #e4e7f0", borderTopColor:"#6c63ff", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  pager: { display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:10, borderTop:"1px solid #e4e7f0", background:"white" },
  pBtn: { background:"#f5f6fa", border:"1.5px solid #e4e7f0", borderRadius:8, color:"#1a1a2e", padding:"5px 12px", cursor:"pointer", fontSize:12, fontWeight:700 },
  overlay: { position:"fixed", inset:0, background:"rgba(26,26,46,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(8px)", padding:12 },
  modal: { background:"white", border:"1px solid #e4e7f0", borderRadius:14, width:"100%", maxWidth:1000, maxHeight:"95vh", display:"flex", flexDirection:"column", overflow:"hidden", position:"relative" },
  modalClose: { position:"absolute", top:10, right:10, background:"rgba(255,255,255,0.95)", border:"1px solid #e4e7f0", borderRadius:8, color:"#1a1a2e", width:32, height:32, cursor:"pointer", fontSize:13, fontWeight:700, zIndex:10 },
  modalTitle: { padding:"12px 52px 10px 14px", fontSize:13, fontWeight:700, color:"#1a1a2e", borderBottom:"1px solid #e4e7f0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flexShrink:0 },
  tab: { flex:1, padding:"10px 12px", background:"none", border:"none", fontSize:13, fontWeight:700, color:"#8b8fa8", cursor:"pointer" },
  tabActive: { color:"#6c63ff", borderBottom:"2px solid #6c63ff" },
  listBtn: { textAlign:"left", padding:"10px 12px", background:"#f5f6fa", border:"1px solid #e4e7f0", borderRadius:8, fontSize:13, cursor:"pointer" },
  vArea: { flex:1, overflow:"auto", display:"flex", alignItems:"center", justifyContent:"center", background:"#1a1a2e", minHeight:250 },
  vImg: { maxWidth:"100%", maxHeight:"78vh", objectFit:"contain" },
  vVid: { width:"100%", maxHeight:"78vh", background:"#000" },
  vFrame: { width:"100%", height:"78vh", border:"none", background:"white" },
  audioBox: { display:"flex", flexDirection:"column", alignItems:"center", padding:40, background:"white", width:"100%" },
  unsupBox: { display:"flex", flexDirection:"column", alignItems:"center", padding:40, background:"white", width:"100%" },
  modalFooter: { display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderTop:"1px solid #e4e7f0", fontSize:12, fontWeight:600, color:"#8b8fa8", flexShrink:0 },
  loginWrap: { minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"radial-gradient(ellipse 70% 60% at 10% 90%, #ede9ff 0%, transparent 60%), #f5f6fa" },
  loginCard: { width:"min(380px, 92vw)", padding:"44px 36px", background:"white", borderRadius:20, boxShadow:"0 8px 32px rgba(108,99,255,0.15)", display:"flex", flexDirection:"column", gap:18 },
  input: { background:"#f5f6fa", border:"2px solid #e4e7f0", borderRadius:10, padding:"10px 14px", fontSize:13, fontWeight:600, color:"#1a1a2e", outline:"none" },
  btnP: { background:"linear-gradient(135deg,#6c63ff,#8b83ff)", color:"white", border:"none", borderRadius:9, padding:"10px 18px", fontWeight:800, fontSize:13, cursor:"pointer", boxShadow:"0 4px 12px rgba(108,99,255,0.3)" },
  errBox: { color:"#d63384", fontSize:12, fontWeight:700, background:"#fff0f6", padding:"8px 12px", borderRadius:8 },
};
