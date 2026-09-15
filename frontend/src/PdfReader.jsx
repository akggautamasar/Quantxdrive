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
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting || entry.intersectionRatio > 0), { rootMargin: "900px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !pdf || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * dpr);
        canvas.height = Math.ceil(viewport.height * dpr);
        canvas.style.width = `${Math.ceil(viewport.width)}px`;
        canvas.style.height = `${Math.ceil(viewport.height)}px`;
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) onVisible?.(pageNumber);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not render page");
      }
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNumber, scale, visible, onVisible]);

  return <div ref={hostRef} data-page={pageNumber} style={{ ...styles.page, minHeight: 120 }}>
    <div style={styles.pageLabel}>Page {pageNumber}</div>
    {visible ? <canvas ref={canvasRef} style={styles.canvas} /> : <div style={styles.lazy}>Loading when near view…</div>}
    {error && <div style={styles.pageError}>Unable to render page {pageNumber}: {error}</div>}
  </div>;
}

export default function PdfReader({ url, filename }) {
  const [pdf, setPdf] = useState(null);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1.15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(1);
  const scrollerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let task;
    setLoading(true); setError(""); setPdf(null); setPages(0); setCurrent(1);
    (async () => {
      try {
        task = pdfjsLib.getDocument({ url, rangeChunkSize: 1024 * 1024, disableAutoFetch: false, disableStream: false, useWorkerFetch: true, isEvalSupported: true });
        const doc = await task.promise;
        if (cancelled) { await doc.destroy(); return; }
        setPdf(doc); setPages(doc.numPages); setLoading(false);
      } catch (e) {
        if (!cancelled) { setError(e?.message || "Unable to open PDF"); setLoading(false); }
      }
    })();
    return () => { cancelled = true; try { task?.destroy(); } catch {} };
  }, [url]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll("[data-page]");
    const observer = new IntersectionObserver(entries => {
      const best = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (best) setCurrent(Number(best.target.dataset.page));
    }, { root, threshold: [0.25, 0.5, 0.75] });
    nodes.forEach(n => observer.observe(n));
    return () => observer.disconnect();
  }, [pages, scale]);

  const jump = n => scrollerRef.current?.querySelector(`[data-page="${n}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return <div style={styles.wrap}>
    <div style={styles.toolbar}>
      <button onClick={() => jump(Math.max(1, current - 1))} disabled={!pages || current <= 1} style={styles.tool}>‹</button>
      <span style={styles.counter}>{pages ? `${current} / ${pages}` : "PDF"}</span>
      <button onClick={() => jump(Math.min(pages, current + 1))} disabled={!pages || current >= pages} style={styles.tool}>›</button>
      <button onClick={() => setScale(s => Math.max(.65, +(s - .15).toFixed(2)))} style={styles.tool}>−</button>
      <span style={styles.zoom}>{Math.round(scale * 100)}%</span>
      <button onClick={() => setScale(s => Math.min(2.5, +(s + .15).toFixed(2)))} style={styles.tool}>＋</button>
      <a href={url} download={filename} style={styles.download}>↓ Download</a>
    </div>
    <div ref={scrollerRef} style={styles.scroller}>
      {loading && <div style={styles.status}>⏳ Opening PDF…</div>}
      {error && <div style={styles.status}><b>PDF reader error</b><span>{error}</span><a href={url} download={filename} style={styles.download}>↓ Download PDF</a></div>}
      {!error && pdf && Array.from({ length: pages }, (_, i) => <PdfPage key={`${url}-${i + 1}`} pdf={pdf} pageNumber={i + 1} scale={scale} onVisible={setCurrent} />)}
    </div>
  </div>;
}

const styles = {
  wrap: { width: "100%", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: "#171820" },
  toolbar: { flexShrink: 0, minHeight: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "6px 9px", background: "#fff", borderBottom: "1px solid #e5e5eb", flexWrap: "wrap", zIndex: 2 },
  tool: { border: "1px solid #e1e2e8", background: "#f6f7fb", color: "#24243a", borderRadius: 8, minWidth: 34, height: 34, fontSize: 18, fontWeight: 800, cursor: "pointer" },
  counter: { minWidth: 64, textAlign: "center", fontSize: 12, fontWeight: 800, color: "#34344a" },
  zoom: { minWidth: 42, textAlign: "center", fontSize: 11, fontWeight: 800, color: "#707287" },
  download: { marginLeft: 4, borderRadius: 8, padding: "9px 11px", background: "#6c63ff", color: "white", textDecoration: "none", fontSize: 11, fontWeight: 800 },
  scroller: { flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch", padding: "14px 8px 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 },
  page: { position: "relative", background: "white", boxShadow: "0 2px 12px rgba(0,0,0,.28)", maxWidth: "100%", overflow: "hidden", flexShrink: 0 },
  canvas: { display: "block", maxWidth: "100%", height: "auto" },
  pageLabel: { position: "absolute", top: 5, left: 7, zIndex: 1, padding: "2px 5px", borderRadius: 5, background: "rgba(20,20,30,.65)", color: "white", fontSize: 9, pointerEvents: "none" },
  lazy: { width: "min(820px,92vw)", height: 140, display: "flex", alignItems: "center", justifyContent: "center", color: "#a8aab7", fontSize: 11 },
  status: { margin: "auto", padding: 25, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: "#e9e9ef", fontSize: 13, textAlign: "center" },
  pageError: { padding: 15, color: "#a00", fontSize: 12 },
};
