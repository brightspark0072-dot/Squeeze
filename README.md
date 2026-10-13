# Squeeze: offline PDF & file tools

Merge, split, organize, convert and compress PDFs and images entirely in your browser. Nothing is uploaded, and every tool works offline after the first visit.

## Tools
PDF: Compress, Merge, Split, Rotate, Organize (reorder/rotate/delete with previews), PDF to Images, Images to PDF, Watermark, Metadata, Page Numbers, PDF to Word/Text, Document to PDF.
Images: Compress, Resize, Convert. Files: Compress to ZIP.

## How offline works
- `vendor/` holds pdf-lib, pdf.js (legacy build, works on older browsers and iOS) and JSZip. `tools/shared.js` loads them from there, never from a CDN.
- `sw.js` pre-caches every page and library when the app is first opened online. **When you add or change any file, bump `V` in `sw.js`** so installed copies update.
- No web fonts are loaded; the app uses your system font.

## Deploy on GitHub Pages
Settings > Pages > deploy from the `main` branch, root folder. Open the https link once online, then use Install / Add to Home Screen.

## Adding a tool
Copy a page in `tools/`, include `shared.js` (it provides `getPdfLib()`, `getPdfJs()`, `getJsZip()`, `renderPage()`, `download()`, `toast()`), add a card to `index.html`, and add the page to `CORE` in `sw.js`.

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
