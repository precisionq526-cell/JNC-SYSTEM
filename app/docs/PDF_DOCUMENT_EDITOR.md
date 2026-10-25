# PDF document editor

The PDF editor now opens existing text as editable document pages using the same page editor as Word files. The previous text-placement form is no longer the PDF editing interface.

## Behavior

- Click existing text to type, select text to format it, and use the familiar font, size, bold/italic/underline, paragraph, list, table, and image tools.
- Undo/redo and keyboard formatting are provided by the existing document engine. Ctrl+S saves edits to the order.
- Original PDF opens a reference preview. Print preview renders the current edited document.
- Save PDF to order exports the edits through the existing local Office PDF renderer and replaces the staged file with a PDF under its original filename. Cancel retains the original staged file.
- The document editor prevents the underlying order page from scrolling. Formatting controls wrap on smaller screens.

## Implementation

PDF preparation runs in the browser with the existing PDF.js and JSZip dependencies. Extracted text becomes Word paragraphs and runs. Page dimensions become document sections. Existing page graphics are rendered without the extracted text and embedded as background images, so the editable text is not duplicated in the background. The existing SuperDoc editor supplies on-page editing and Word export. No new external conversion service or package dependency is required.

Text layout is reconstructed from PDF positions. Complex layouts, unusual fonts, rotated text, columns, and document graphics can differ after conversion or text reflow. Compare Original PDF and Print preview before saving. This is a document-editing conversion, not a lossless PDF structure editor. Image-only scans without text are rejected with a clear explanation; OCR was not added.

## Verification

- All 96 regression tests pass, including four new document-builder tests for editable Unicode text, XML escaping, fonts, page dimensions/sections, graphics-only pages within a document, paragraph reconstruction, and image-only document errors.
- Production build, TypeScript, and source ESLint pass.
- Browser verification replaced existing text on a generated three-page PDF, applied bold formatting, opened original and edited previews, saved the replacement PDF into the order, and downloaded it under its original filename.
- PDF extraction confirmed three output pages, the new sentence, absence of the replaced sentence, and the remaining pages' content. The saved PDF was rendered and visually checked, including its original graphic background.
- Desktop and phone editor screenshots are in the workspace's `output/ui-refresh/` folder. Browser results are recorded in `output/ui-refresh/pdf-editor-browser-verification.json`.
- No live order or physical print job was submitted during testing.
