import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

function PdfPage({ pdf, pageNumber, scale, onVisible }) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [error, setError] = useState("");

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting || entry.intersectionRatio > 0),
      { rootMargin: "900px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !pdf || !canvasRef.current) return;
    let cancelled = false;
    let renderTask;
    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        canvas.width = Math.ceil(viewport.width * dpr);
        canvas.height = Math.ceil(viewport.height * dpr);
        canvas.style.width = `${Math.ceil(viewport.width)}px`;
        canvas.style.height = `${Math.ceil(viewport.height)}px`;
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (!cancelled) onVisible?.(pageNumber);
      } catch (e) {
        if (!cancelled && e?.name !== "RenderingCancelledException") setError(e?.message || "Could not render page");
      }
    })();
    return () => {
      cancelled = true;
      try { renderTask?.cancel(); } catch {}
    };
  }, [pdf, pageNumber, scale, visible, onVisible]);

  return (
    <div ref={hostRef} data-page={pageNumber} style={{ ...styles.page, minHeight: 120 }}>
      <div style={styles.pageLabel}>Page {pageNumber}</div>
      {visible ? <canvas ref={canvasRef} style={styles.canvas} /> : <div style={styles.lazy}>Loading when near view…</div>}
      {error && <div style={styles.pageError}>Unable to render page {pageNumber}: {error}</div>}
    </div>
  );
}

export default function PdfReader({ url, filename = "document.pdf" }) {
  const [pdf, setPdf] = useState(null);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(1);
  const [fullScreen, setFullScreen] = useState(false);
  const [barVisible, setBarVisible] = useState(true);
  const scrollerRef = useRef(null);
  const hideTimer = useRef(null);
  const visiblePageRef = useRef(1);

  useEffect(() => {
    let cancelled = false;
    let task;
    setLoading(true);
    setProgress(0);
    setError("");
    setPdf(null);
    setPages(0);
    setCurrent(1);

    (async () => {
      try {
        task = pdfjsLib.getDocument({
          url,
          // QuantXDrive's /api/media endpoint supports HTTP Range requests.
          // 1 MiB chunks reduce request overhead while keeping first-page loading bounded.
          rangeChunkSize: 1024 * 1024,
          disableRange: false,
          disableStream: true,
          disableAutoFetch: true,
          useWorkerFetch: true,
          isEvalSupported: true,
        });
        task.onProgress = ({ loaded, total }) => {
          if (total) setProgress(Math.min(100, Math.round((loaded / total) * 100)));
        };
        const doc = await task.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        setPdf(doc);
        setPages(doc.numPages);
        setLoading(false);
        setProgress(100);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Unable to open PDF");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      try { task?.destroy(); } catch {}
    };
  }, [url]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll("[data-page]");
    const observer = new IntersectionObserver(entries => {
      const best = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (best) {
        const n = Number(best.target.dataset.page);
        visiblePageRef.current = n;
        setCurrent(n);
      }
    }, { root, threshold: [0.2, 0.5, 0.75] });
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [pages, scale, fullScreen]);

  const scheduleHide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBarVisible(false), 3000);
  };
  const revealBar = () => {
    setBarVisible(true);
    clearTimeout(hideTimer.current);
    scheduleHide();
  };

  useEffect(() => {
    revealBar();
    return () => clearTimeout(hideTimer.current);
  }, [url]);

  const jump = n => {
    if (!pages) return;
    const target = Math.max(1, Math.min(pages, n));
    scrollerRef.current?.querySelector(`[data-page="${target}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    revealBar();
  };

  const fitWidth = async () => {
    if (!pdf) return;
    try {
      const page = await pdf.getPage(visiblePageRef.current || 1);
      const base = page.getViewport({ scale: 1 });
      const width = Math.max(260, (scrollerRef.current?.clientWidth || window.innerWidth) - 32);
      setScale(Math.min(3, width / base.width));
      revealBar();
    } catch {}
  };

  const zoom = factor => {
    setScale(s => Math.min(6, Math.max(0.35, +(s * factor).toFixed(2))));
    revealBar();
  };

  const openBrowser = () => window.open(url, "_blank", "noopener,noreferrer");

  useEffect(() => {
    const onKey = e => {
      if (e.target?.tagName === "INPUT") return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
          e.preventDefault(); jump(current + 1); break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          e.preventDefault(); jump(current - 1); break;
        case "Home":
          e.preventDefault(); jump(1); break;
        case "End":
          e.preventDefault(); jump(pages); break;
        case "+":
        case "=":
          e.preventDefault(); zoom(1.2); break;
        case "-":
          e.preventDefault(); zoom(1 / 1.2); break;
        case "0":
          e.preventDefault(); fitWidth(); break;
        case "f":
        case "F":
          e.preventDefault(); setFullScreen(v => !v); break;
        case "h":
        case "H":
          e.preventDefault(); setBarVisible(v => !v); break;
        case "Escape":
          if (fullScreen) setFullScreen(false);
          break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, pages, fullScreen]);

  return (
    <div
      style={{ ...styles.wrap, ...(fullScreen ? styles.fullScreen : {}) }}
      onMouseMove={revealBar}
      onTouchStart={revealBar}
    >
      <div style={{ ...styles.toolbar, ...(barVisible ? null : styles.toolbarHidden) }}>
        <div style={styles.left}>
          <span style={styles.filename} title={filename}>{filename}</span>
          <span style={styles.badge}>PDF</span>
        </div>
        <div style={styles.center}>
          <button onClick={() => jump(current - 1)} disabled={!pages || current <= 1} style={styles.tool} title="Previous">‹</button>
          <div style={styles.counterWrap}>
            <input
              type="number"
              min="1"
              max={pages || 1}
              value={current}
              onChange={e => setCurrent(Number(e.target.value) || 1)}
              onKeyDown={e => { if (e.key === "Enter") jump(Number(e.currentTarget.value)); }}
              style={styles.pageInput}
            />
            <span>/ {pages || "—"}</span>
          </div>
          <button onClick={() => jump(current + 1)} disabled={!pages || current >= pages} style={styles.tool} title="Next">›</button>
          <span style={styles.divider} />
          <button onClick={() => zoom(1 / 1.2)} style={styles.tool} title="Zoom out">−</button>
          <span style={styles.zoom}>{Math.round(scale * 100)}%</span>
          <button onClick={() => zoom(1.2)} style={styles.tool} title="Zoom in">＋</button>
          <button onClick={fitWidth} style={styles.fit}>Fit</button>
        </div>
        <div style={styles.right}>
          <button onClick={() => setFullScreen(true)} style={styles.appButton} title="Open in QuantXDrive full screen">📱 In App</button>
          <button onClick={openBrowser} style={styles.browserButton} title="Open PDF in browser">🌐 Browser</button>
          <a href={url} download={filename} style={styles.download}>↓ Save</a>
          {fullScreen && <button onClick={() => setFullScreen(false)} style={styles.exitButton}>✕ Exit</button>}
        </div>
      </div>

      <div ref={scrollerRef} style={styles.scroller}>
        {loading && (
          <div style={styles.status}>
            <div style={styles.spinner} />
            <b>Opening PDF…</b>
            <span>{progress ? `${progress}%` : "Preparing range requests…"}</span>
          </div>
        )}
        {error && (
          <div style={styles.status}>
            <b>PDF reader error</b>
            <span>{error}</span>
            <div style={styles.statusActions}>
              <button onClick={openBrowser} style={styles.browserButton}>🌐 Open in Browser</button>
              <a href={url} download={filename} style={styles.download}>↓ Download PDF</a>
            </div>
          </div>
        )}
        {!error && pdf && Array.from({ length: pages }, (_, i) => (
          <PdfPage
            key={`${url}-${i + 1}`}
            pdf={pdf}
            pageNumber={i + 1}
            scale={scale}
            onVisible={n => { if (n === visiblePageRef.current) setCurrent(n); }}
          />
        ))}
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    width: "100%", height: "100%", minHeight: 0, display: "flex", flexDirection: "column",
    background: "#0a0a0a", color: "#e2e2e2", overflow: "hidden", fontFamily: "monospace",
  },
  fullScreen: { position: "fixed", inset: 0, width: "100vw", height: "100dvh", zIndex: 99999, borderRadius: 0 },
  toolbar: {
    flexShrink: 0, minHeight: 48, display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
    background: "rgba(10,10,10,.96)", borderBottom: "1px solid rgba(255,255,255,.08)",
    backdropFilter: "blur(24px)", zIndex: 5, transition: "transform 180ms ease, opacity 180ms ease",
  },
  toolbarHidden: { transform: "translateY(-100%)", opacity: 0, pointerEvents: "none", position: "absolute", top: 0, left: 0, right: 0 },
  left: { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, overflow: "hidden" },
  center: { display: "flex", alignItems: "center", justifyContent: "center", gap: 4, flexShrink: 0 },
  right: { flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5, minWidth: 0 },
  filename: { maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 700, opacity: .8 },
  badge: { fontSize: 9, padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(255,255,255,.08)", color: "#777" },
  tool: { border: "1px solid rgba(255,255,255,.08)", background: "transparent", color: "#aaa", borderRadius: 7, minWidth: 32, height: 32, fontSize: 18, cursor: "pointer" },
  counterWrap: { display: "flex", alignItems: "center", gap: 4, color: "#666", fontSize: 11 },
  pageInput: { width: 36, height: 27, textAlign: "center", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 5, color: "#e2e2e2", outline: "none", fontFamily: "monospace", fontSize: 11 },
  divider: { width: 1, height: 20, background: "rgba(255,255,255,.08)", margin: "0 4px" },
  zoom: { minWidth: 42, textAlign: "center", color: "#777", fontSize: 11 },
  fit: { border: "1px solid rgba(255,255,255,.08)", background: "transparent", color: "#888", borderRadius: 7, height: 32, padding: "0 8px", cursor: "pointer", fontSize: 11 },
  appButton: { border: "1px solid rgba(185,247,81,.25)", background: "rgba(185,247,81,.1)", color: "#b9f751", borderRadius: 7, height: 32, padding: "0 9px", cursor: "pointer", fontSize: 10, fontWeight: 700 },
  browserButton: { border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.05)", color: "#aaa", borderRadius: 7, height: 32, padding: "0 9px", cursor: "pointer", fontSize: 10, fontWeight: 700 },
  exitButton: { border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.05)", color: "#aaa", borderRadius: 7, height: 32, padding: "0 9px", cursor: "pointer", fontSize: 10 },
  download: { borderRadius: 7, padding: "8px 9px", background: "rgba(185,247,81,.1)", color: "#b9f751", border: "1px solid rgba(185,247,81,.25)", textDecoration: "none", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" },
  scroller: { flex: 1, minHeight: 0, overflow: "auto", WebkitOverflowScrolling: "touch", padding: "14px 8px 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, background: "#0a0a0a" },
  page: { position: "relative", background: "white", boxShadow: "0 4px 35px rgba(0,0,0,.65)", maxWidth: "100%", overflow: "hidden", flexShrink: 0 },
  canvas: { display: "block", maxWidth: "100%", height: "auto" },
  pageLabel: { position: "absolute", top: 6, left: 7, zIndex: 1, padding: "2px 5px", borderRadius: 4, background: "rgba(10,10,10,.6)", color: "white", fontSize: 9, pointerEvents: "none" },
  lazy: { width: "min(820px,92vw)", height: 140, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 11 },
  status: { margin: "auto", padding: 25, minHeight: 220, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#ddd", fontSize: 12, textAlign: "center" },
  statusActions: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  spinner: { width: 28, height: 28, border: "2px solid rgba(255,255,255,.08)", borderTopColor: "#b9f751", borderRadius: "50%", animation: "quantx-pdf-spin .7s linear infinite" },
  pageError: { padding: 15, color: "#ff9090", fontSize: 11 },
};

if (typeof document !== "undefined" && !document.getElementById("quantx-pdf-spin")) {
  const style = document.createElement("style");
  style.id = "quantx-pdf-spin";
  style.textContent = "@keyframes quantx-pdf-spin{to{transform:rotate(360deg)}}@media(max-width:700px){.quantx-pdf-reader-toolbar{font-size:10px}}";
  document.head.appendChild(style);
}
