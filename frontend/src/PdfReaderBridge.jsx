import { createRoot } from "react-dom/client";
import PdfReader from "./PdfReader.jsx";

const roots = new WeakMap();

function isPdfFrame(frame) {
  const title = String(frame.getAttribute("title") || "").toLowerCase();
  const src = String(frame.getAttribute("src") || "");
  return title.endsWith(".pdf") && src.includes("/api/media/") && frame.dataset.quantxPdfRestored !== "1";
}

function restorePdfFrame(host, frame, root) {
  try { root.unmount(); } catch {}
  host.remove();
  frame.dataset.quantxPdfRestored = "1";
  frame.style.display = "";
  frame.style.visibility = "";
  if (frame.parentNode == null) {
    // The original parent can disappear if Channels closes the preview first.
    return;
  }
  frame.parentNode.replaceChild(frame, host);
}

function replacePdfFrame(frame) {
  if (!frame || !isPdfFrame(frame) || roots.has(frame)) return;
  const url = frame.getAttribute("src");
  const filename = frame.getAttribute("title") || "document.pdf";
  const parent = frame.parentNode;
  if (!parent) return;

  const host = document.createElement("div");
  host.style.cssText = [
    "position:fixed",
    "inset:0",
    "width:100vw",
    "height:100dvh",
    "min-height:100vh",
    "z-index:999999",
    "display:block",
    "background:#0a0a0a",
    "overflow:hidden",
  ].join(";");

  frame.replaceWith(host);
  const root = createRoot(host);
  roots.set(host, root);

  // Back button lives outside the React reader so it can reliably close the
  // full-screen overlay and return to the original Channels preview.
  const back = document.createElement("button");
  back.type = "button";
  back.setAttribute("aria-label", "Back to Channels");
  back.title = "Back to Channels";
  back.textContent = "← Back";
  back.style.cssText = [
    "position:absolute",
    "top:max(8px, env(safe-area-inset-top))",
    "left:max(8px, env(safe-area-inset-left))",
    "z-index:1000001",
    "height:34px",
    "padding:0 11px",
    "border:1px solid rgba(255,255,255,.12)",
    "border-radius:8px",
    "background:rgba(10,10,10,.88)",
    "backdrop-filter:blur(14px)",
    "color:#e2e2e2",
    "font:600 11px monospace",
    "cursor:pointer",
    "box-shadow:0 4px 18px rgba(0,0,0,.35)",
  ].join(";");
  back.addEventListener("click", () => restorePdfFrame(host, frame, root));
  host.appendChild(back);

  root.render(<PdfReader url={url} filename={filename} />);
}

export function installPdfReaderBridge() {
  const scan = () => document.querySelectorAll("iframe").forEach(replacePdfFrame);
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
