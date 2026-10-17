# Squeeze: offline PDF & file tools

Merge, split, organize, convert and compress PDFs and images entirely in your browser. Nothing is uploaded, and every tool works offline once it has been opened or saved.

## Tools
PDF: Compress, Merge, Split, Rotate, Organize (reorder/rotate/delete with previews), PDF to Images, Images to PDF, Watermark, Metadata, Page Numbers, PDF to Word/Text, Document to PDF.
Images: Compress, Resize, Convert. Files: Compress to ZIP.

## How offline works
- `vendor/` holds pdf-lib, pdf.js (legacy build, works on older browsers and iOS) and JSZip. `tools/shared.js` loads them from there, never from a CDN.
- `sw.js` pre-caches only the shell (home page, style, `shared.js`). A tool and its libraries are cached when you open it, or when you press Save on the home page's "Offline use" panel (pick tools, or Save all). **When you add or change any file, bump `V` in `sw.js`** so installed copies update.
- No web fonts are loaded; the app uses your system font.

## Deploy on GitHub Pages
Settings > Pages > deploy from the `main` branch, root folder. Open the https link once online, then use Install / Add to Home Screen.

## Adding a tool
Copy a page in `tools/`, include `shared.js` (it provides `getPdfLib()`, `getPdfJs()`, `getJsZip()`, `renderPage()`, `download()`, `toast()`), add a card to `index.html`, and add `data-needs="pdflib pdfjs jszip"` (the libraries it uses) to the card so the Offline panel can save it.

## Limits
- Not built yet: Protect/Unlock PDF (needs real encryption such as qpdf compiled to WebAssembly; pdf-lib cannot encrypt), OCR, real PDF to Word layout.
- Compress PDF has two modes: *Recompress images* (keeps text selectable; re-encodes embedded images as JPEG) and *Rasterize pages* (smallest, but text becomes images). Ghostscript-grade compression would need Ghostscript-WASM (AGPL: keep the repo public).
- Output files are named `<original>_<action>_<YYMMDD-HHMMSS>.ext` via `uniqueName()`/`nameFor()` in `tools/shared.js`.
- Theme: slate blue + cream, 60/30/10 (see `:root` in `style.css`).
- Watermark and Page Numbers use a Latin-only font and do not yet account for pages that are already rotated.
- Password-protected PDFs are not supported. Signed PDFs lose their signature when changed.
- Large PDFs can run out of memory on phones (esp. iOS Safari).

## GitHub Pages gotcha
GitHub Pages runs Jekyll by default, which silently **does not publish any file or folder whose name starts with `_` or `.`**. Never name a shared file `_something.js`. The `.nojekyll` file at the root turns this behaviour off as a second safety net.

## Protect / Unlock PDF
`tools/pdfcrypt.js` is our own implementation (no library): Protect writes AES-256 (PDF 2.0, revision 6); Unlock opens revisions 2, 3, 4 (RC4, AES-128) and 6 (AES-256) and unpacks encrypted object streams. It was checked against `qpdf`. It needs https or localhost (WebCrypto).

## OCR PDF
`tools/ocr-pdf.html` renders each page (300 dpi), cleans it, reads it with Tesseract (`vendor/tesseract`, files fetched by the *Vendor Tesseract* workflow) and writes an invisible text layer (glyphless Type0 font + ToUnicode) onto the original page, so the PDF looks identical but is searchable. Printed/typed text only; sideways pages need rotating first; Hindi data is cached the first time it is used online.

## Compress Video
`tools/compress-video.html` uses the browser's own encoders (WebCodecs) through Mediabunny (`vendor/mediabunny/`, MPL-2.0, v1.61.5; 692 KB, about 177 KB gzipped; fetched by the *Vendor Mediabunny* workflow). It reads MP4/MOV/WebM/MKV, re-encodes to MP4 (H.264 + AAC) when the device can, else WebM (VP9 + Opus), keeps aspect ratio and sound (optional mute), and caps the bitrate at a share of the source bitrate so the file should not grow. The result is opened and checked before it is called a success; if it is not smaller you are told and can keep the original. Test: `node tests/video.test.js` (headless Chromium has no H.264, so only the WebM path is tested there; MP4 needs a real browser or phone).
**FFmpeg.wasm fallback: not included.** It is about 30 MB (core + wasm), cannot encode with hardware, and its build was not obtainable in the build environment. WebCodecs covers current Chrome, Edge and Safari 16.4+; other browsers get a clear message. It can be added later behind an opt-in download if needed.
