# Charter Forge

Turn a plain-text project idea into a polished, downloadable **Excel Project Charter** — powered by Google's Gemini API, running entirely in your browser.

## What it does

1. **Add your Gemini API key** (Step 1) — stored only in your browser's localStorage if you choose "remember"; sent only to Google's API.
2. **Describe your project** (Step 2) — plain text, plus optional details (organization, start date, duration, budget, team size, sponsor, PM, constraints). Anything you fill in is used verbatim; anything you skip is inferred intelligently by the model.
3. **Review & download** (Step 3) — a live document preview mirrors the final spreadsheet. Every field is editable, then download a pixel-faithful `.xlsx`.

## The generated workbook

Reproduces the classic blue charter template:

- Dark-blue title band and label rail (Project Name, Objective, Success Criteria, Key Deliverables, Milestones, High Level Requirements, Resource, Risks, Stakeholders, Project Manager, Approval)
- Light-blue content blocks with white grid borders
- Milestone/Deadline sub-table with real Excel dates (`dd-mmm-yyyy`)
- Stakeholder Name/Role sub-table
- Budget + Team members resource block
- Bordered Approval box (Name / Title / Signature / Date)
- Landscape print setup, auto-sized rows for wrapped text

Opens cleanly in Microsoft Excel, Google Sheets, and LibreOffice.

## Run it

No build step, no dependencies to install:

- **Easiest:** double-click `index.html`, or
- **Recommended:** serve the folder statically so the browser treats it as a proper origin:
  ```
  npx serve .
  ```
  or
  ```
  python -m http.server 8080
  ```

Then open the printed URL. Get a free Gemini API key at <https://aistudio.google.com/apikey>.

## Tech notes

- **Stack:** vanilla HTML/CSS/JS — zero framework, zero build.
- **Excel engine:** [ExcelJS](https://github.com/exceljs/exceljs) v4.4.0, vendored locally at `vendor/exceljs.min.js` (CDN fallback wired in), so downloads work even on flaky networks.
- **Model:** `gemini-3.5-flash` by default, with automatic fallback to `gemini-2.5-flash` → `gemini-2.0-flash` if a model isn't available on your key. Structured JSON output (`responseSchema`) keeps responses predictable.
- **Privacy:** your API key and project text never touch any server other than Google's Generative Language API.

## Project layout

```
index.html          app shell (3-step wizard)
css/styles.css      dark workbench theme + document preview styles
js/gemini.js        Gemini REST client, prompt, schema, error handling
js/excel.js         workbook builder (UMD — also runs under Node for testing)
js/app.js           wizard state, editor, live preview, xlsx download
vendor/             vendored ExcelJS
```
