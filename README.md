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

## Cost Management (EVM)

`cost.html` implements the EVM coursework as an interactive page (no API key needed):

- **§1 Variances (All):** editable PV/EV/AC sprint table → live CV = EV−AC, SV = EV−PV with under/over budget and ahead/behind verdicts.
- **§2 Indexes (All):** CPI = EV/AC, SPI = EV/PV with a 4-chart dashboard (trend + AI projection, PV/EV/AC bars, CV/SV diverging bars, EAC comparison).
- **§3 Forecasting (All):** EAC (typical / atypical / composite), ETC, VAC, TCPI forecast report.
- **§4 AI forecasting (odd ID):** least-squares regression over CPI/SPI history projects the next 3 sprints and is compared against classical EAC (in-browser stand-in for Random Forest/LSTM).
- **§5 Anomaly detection (even ID):** isolation-style z-score over CV%, SV%, CPI, SPI drift flags HIGH RISK / WATCH sprints (in-browser stand-in for Isolation Forest).
- Entering the last digit of a Student ID highlights the student's AI track; Sprint 1 ships with the PDF worked example (PV 100, EV 80, AC 90); the page exports a 5-sheet `.xlsx` report and persists to localStorage. Verify with `node test-cost.cjs`.
- **AI-driven practice (Gemini, same key):** the closing panel sends the live EVM snapshot to Gemini — reusing the exact same `cf_gemini_key` browser entry as the charter app — for a predictive outlook, risk flags, and control actions. No extra setup if a key is already saved; offline regression/anomaly tables remain the no-key baseline.
- **Generate from brief:** describe the project (3–12 sprints, BAC, shape: mixed/healthy/struggling/recovery) and Gemini drafts the PV/EV/AC history straight into the editable table — same pattern as the Charter/Schedule flows.

## Project layout

```
index.html          app shell (charter + schedule wizard)
cost.html           Cost Management page (EVM: variances, indexes, forecast, AI)
css/styles.css      dark workbench theme + document preview styles
css/cost.css        cost page panels, tables, charts, KPIs
js/gemini.js        Gemini REST client, prompt, schema, error handling
js/excel.js         workbook builder (UMD — also runs under Node for testing)
js/app.js           wizard state, editor, live preview, xlsx download
js/cost.js          EVM engine + dashboard (variances, CPI/SPI, EAC/ETC, regression AI, anomaly flags)
js/cost-excel.js    5-sheet EVM report workbook builder
test-cost.cjs       node verification for the EVM math + workbook export
vendor/             vendored ExcelJS
```
