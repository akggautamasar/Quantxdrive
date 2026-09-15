import { createRoot } from "react-dom/client";
import PdfReader from "./PdfReader.jsx";

const roots = new WeakMap();

function isPdfFrame(frame) {
  const title = String(frame.getAttribute("title") || "").toLowerCase();
  const src = String(frame.getAttribute("src") || "");
  return title.endsWith(".pdf") && src.includes("/api/media/");
}

function replacePdfFrame(frame) {
  if (!frame || !isPdfFrame(frame) || roots.has(frame)) return;
  const url = frame.getAttribute("src");
  const filename = frame.getAttribute("title") || "document.pdf";
  const host = document.createElement("div");
  // The PDF reader must escape the Channels preview card completely.
  // Fixed positioning makes the reader occupy the whole available viewport,
  // including on mobile where the previous modal left large margins visible.
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
  root.render(<PdfReader url={url} filename={filename} />);
}

export function installPdfReaderBridge() {
  const scan = () => document.querySelectorAll("iframe").forEach(replacePdfFrame);
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
