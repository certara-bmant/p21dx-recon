# P21 Reconciliation — Proof of Concept

A proof-of-concept tool for reconciling a sample manifest / EDC extract against lab or vendor data — key matching, demographic cross-checks, and expected-sample validation — without ever storing the underlying clinical data anywhere.

Built to accompany a design discussion on extending P21 DX beyond spec-conformance checking into data-manager-facing reconciliation, and informed by a review of IQVIA LabMatrix and the TrackREX (apples-and-oranges.co.uk) reconciliation tools.

## Why this exists

P21 DX today checks data for conformity against a spec. The bigger, unmet need for data managers is reconciliation: does the sample manifest agree with the lab data? Does the lab data agree with EDC? Were all the samples we expected actually collected? P21 can't become the system that stores clinical data to do this (no repository, no 21 CFR Part 11 data-retention posture) — so this POC deliberately proves out an architecture that never needs to.

Two real-world tools shaped the design:

- **IQVIA LabMatrix** — a genuine repository/virtual-biorepository product. Its own materials describe "fuzzy match" and "pattern matching" import features, and separately note that samples "are matched using Accession ID and date to reduce mismatches... due to limitations in visit naming." In practice, teams have found it defaults toward subject/visit-nomenclature matching, which breaks when subject-ID formats differ across sites, EDC, and vendor — exactly the failure mode this POC is built to avoid by design.
- **TrackREX** (apples-and-oranges.co.uk) — an Excel/VBA reconciliation tool that works with any EDC/vendor combination, but requires a manually-built, per-study mapping table before it can run. That manual specification step is the piece this POC tries to automate (or at least accelerate) via key suggestion.
- **[soa-concept-validation](https://github.com/certara-bmant/soa-concept-validation)** — an earlier internal POC for SoA-based content validation, whose core principle (upload → in-memory validation → discard) this POC follows and extends from lab-panel/test presence to sample-level reconciliation.

## What it does

1. **Load two data sources** — any CSV or Excel file. Column names don't need to match.
2. **Suggest matching keys** — ranks every column pair between the two files by actual value overlap (not just name similarity), and separately checks whether each column *looks* like a barcode/accession number vs. a subject identifier vs. a date, etc. The suggestion explicitly favors barcode/accession-pattern columns as the primary key, because subject-ID nomenclature is the least reliable join key in this data class (site-formatted vs. lab-formatted vs. EDC-formatted subject numbers rarely coincide, whereas an accession number is generated once and should travel unchanged).
3. **Confirm/override fields to cross-check** — sex, DOB, site, collection date, etc. — auto-suggested from column names, editable, with a per-field date tolerance.
4. **Run reconciliation** — tiered matching: primary key first, then an optional fallback key (subject + visit + sample type) for records where the primary key is blank. Produces matched (high/low confidence), missing-in-A, missing-in-B, duplicate-key, and field-mismatch findings, exportable to CSV.
5. **Expected-sample check** — independent of identity matching: given a sample plan (cohort × visit × period × timepoint × sample type × required), checks whether each subject has everything *their cohort's* plan expects. The plan can be typed inline or imported from any CSV/XLSX (you map its columns, same pattern as everywhere else in the tool). This is the one thing genuinely safe to persist as a reference table — a plan/template contains no subject data. See "Cohorts, visit qualifiers, and cross-vendor terminology" below for how study-design complexity is factored in.

## Architecture — and why it satisfies the "don't store data" constraint

`index.html` is a single, self-contained page. There is no server, no database, no API call, no analytics, nothing. Files are read with the browser's File API, parsed with SheetJS (loaded from a CDN, used only to turn CSV/XLSX bytes into JavaScript objects), and every computation happens in the browser's own memory. Close the tab and everything — uploaded data, results, everything — is gone. This is a stricter version of the "never store data" principle than the SoA POC's Python backend achieved (which held state in a module-level dict for the life of the server process); here there is no process to hold state in at all beyond the open tab.

The only things that would be safe to persist in a production version are the *templates*, not the data:

- **Field-mapping templates** (which column pairs to use as primary/fallback keys, which fields to cross-check) — reusable per vendor/lab, contains no subject data.
- **Sample plan / SoA templates** (expected visit × sample type combinations) — a protocol artifact, not subject data. This is the "SoA template as a reference table" case you'd allow.

Everything else — the uploaded manifest, EDC extract, lab data, and every finding derived from them — stays out of any store.

## Files

| File | Purpose |
|---|---|
| `index.html` | The POC itself. Open directly in a browser — no install, no server. Click "Load Demo Data" to try it immediately. |
| `core.js` | The matching/reconciliation algorithms, framework-free, embedded verbatim inside `index.html`. Kept as a separate file too so it can be unit-tested with Node and read/reviewed independently of the UI. |
| `demo.js` | Generates the synthetic demo dataset (20 subjects, manifest vs. lab data, with deliberately injected gaps — see below). |
| `test.js` | Node test harness. Run with `node test.js` (requires Node, no other dependencies). Verifies the key-suggestion, reconciliation, and expected-sample logic against the demo dataset before it's trusted inside the browser UI. |

## Cohorts, visit qualifiers, and cross-vendor terminology

Real study designs are rarely one flat visit schedule. Different cohorts/arms can have different sampling schedules, and a single visit can draw multiple specimens distinguished only by a period and/or timepoint qualifier (pre-dose vs. 2h post-dose, Period 1 vs. Period 2 in a crossover). None of that is guaranteed to be named consistently across a manifest, an EDC export, and a vendor lab file. Three mechanisms handle this, each solving a different part of the problem:

**Cohort-scoped plan rows.** A plan row can optionally specify a `cohort`. A blank cohort means "applies to every cohort"; a row with a cohort set only applies to subjects resolved to that cohort. This means you don't have to duplicate the whole plan per cohort — only the rows that actually differ. In the demo, Cohort A gets a full PK schedule (trough + peak at WEEK 4 and WEEK 8) and Cohort B gets a reduced schedule (trough only, no peak, ever); the plan has one shared row for "trough at WEEK 4" that applies to both, and two Cohort-A-only rows for the peak samples Cohort B never draws. Each subject's cohort is read once from whichever data source you're checking (it doesn't need to be present in — or agree in format with — the *other* source, since this check only ever reads one source at a time).

**Optional period/timepoint dimensions with wildcard matching.** A plan row can specify `period` and/or `timepoint`; a blank value on either means "don't care" rather than "must be blank." So most rows can ignore timepoint entirely, and only the rows that genuinely need to distinguish (e.g. WEEK 4's trough-vs-peak, which are really the same visit split by timepoint) specify it. This is the same tiered/wildcard pattern already used for the reconciliation fallback key — extended from a fixed 3-part tuple to an arbitrary set of optional qualifiers.

**Alphanumeric-normalized comparison, plus an explicit alias table for the rest.** Comparing qualifier values ignores case and punctuation by default, so `"PRE-DOSE"` and `"Pre Dose"` are recognized as the same value with zero configuration — that covers most of what "differs across vendors" actually turns out to be (formatting, not meaning). What it deliberately does **not** do is guess that `"0H"` means the same thing as `"PRE-DOSE"` — that's a genuine vocabulary difference, not a formatting one, and guessing at it silently is exactly the LabMatrix failure mode this whole project is trying to avoid. Instead, Step 5 has an editable value-alias table (`{dimension, raw value, canonical value}`) — a genuine terminology mismatch shows up as a flagged finding until someone adds the one-line alias that resolves it. Aliases apply only to whichever data source is being checked, never to the plan itself (the plan is the canonical vocabulary everything else maps onto). Like the plan and the field-mapping templates, an alias table is pure metadata — safe to build once per vendor and reuse.

`test.js` has explicit regression coverage for all three: Cohort B correctly shows zero PK Peak findings of any kind; a clean Cohort A subject matches the timepoint-qualified WEEK 4 rows with zero findings; a cosmetic spelling difference resolves without an alias; and a genuine vocabulary difference is flagged until an alias is supplied, then resolves.

What's still a manual step, deliberately: deciding which raw values need an alias in the first place. The tool doesn't attempt to suggest aliases the way it suggests column keys — value-level fuzzy-matching across an entire vendor's vocabulary is a much larger and riskier proposition than column-level matching (the failure mode is silently merging two things that are actually different, which is worse than not merging at all). If this turns out to be a frequent need, the next step would be surfacing *unmatched, non-wildcarded* qualifier values as suggested-alias candidates for human review, rather than fully automating it.

## Reconciling dates stored in different formats

Date fields configured as `type: "date"` in Step 3 (DOB, collection date, etc.) are not compared as plain strings — they're parsed into an actual year/month/day and compared with a configurable tolerance window (e.g. "match if within 3 days"), so `"2026-02-11"` and `"11-Feb-2026"` are recognized as the same date rather than failing a literal string comparison.

That parsing deliberately does **not** lean on the browser's built-in `Date.parse`, because it has two problems that matter here: it treats bare ISO dates (`"2026-02-11"`) as UTC but treats almost every other format (`"11-Feb-2026"`, `"02/11/2026"`) as *local* time, so the same calendar date written two different ways could come back an hour or more apart — a false mismatch with zero clinical meaning. It also silently guesses month-first for ambiguous numeric dates with no way to know it guessed. `core.js`'s `parseCalendarDate()` extracts year/month/day directly for ISO, `DD-Mon-YYYY`, `Mon DD, YYYY`, and slash/dash numeric formats, so identical dates always net to zero difference regardless of which format each source used, and returns an explicit `ambiguous: true` flag whenever a numeric date's day/month order had to be assumed (both parts ≤ 12) rather than silently picking one. The results table shows a "(day/month assumed ⚠)" note on any comparison where that happened, so it gets a human look rather than passing or failing on a guess.

What it does **not** do: resolve genuine day/month ambiguity on its own (`03/04/2026` could mean 3-Apr or 4-Mar — there's no way to know without a per-column format hint), and it doesn't attempt fuzzy parsing of exotic or locale-specific formats beyond what's listed above (anything unrecognized falls back to the platform parser, with the same ambiguity risk that entails). `test.js` includes a regression check (`sameDateFormats`) proving several format pairs resolve to zero difference, and one proving the ambiguous case is flagged rather than guessed silently — worth rerunning after any change to the date logic.

## The demo dataset, and what it's built to prove

`demo.js` builds a 20-subject, ~87-row synthetic manifest and lab dataset with subject IDs formatted completely differently between the two sources (`07-007` on the manifest side vs. `007` on the lab side, with no shared crosswalk) — deliberately mirroring the real complaint about subject-nomenclature-based matching. Subjects 1–15 are "Cohort A" (full PK schedule: trough + peak at WEEK 4 and WEEK 8, with WEEK 4's two draws distinguished by a `PRE-DOSE` / `2H POST` timepoint qualifier); subjects 16–20 are "Cohort B" (reduced schedule: trough only, no peak, ever). Several things are injected on purpose:

- **Subject 3** — a sample genuinely never collected (WEEK 8 / PK Trough missing from both sources). Only the expected-sample check catches this; plain reconciliation has nothing to compare since neither side has a record.
- **Subject 7** — manifest accession number left blank (a data-entry gap). The lab still has a record with its own accession number, but with no shared key the two can never be automatically linked — this shows up as an unmatched record on both sides, distinct from a true missing sample.
- **Subject 12** — the same accession number was accidentally reused for two different draws — flagged as a duplicate key, the same failure mode TrackREX's example message ("Accession Number ... has been used for another subject") describes.
- **Subject 15** — a dropout with no WEEK 8 data at all. The expected-sample check flags this as missing, which is realistic but also a known limitation (see below).
- **Subjects 5 and 14** — demographic mismatches (DOB and sex respectively) between what the site recorded and what the lab recorded.
- **Subjects 16–20 (Cohort B)** — never draw a PK Peak sample; the plan's two peak rows are scoped to Cohort A only, so Cohort B correctly shows zero peak-related findings of any kind.
- Every other record — a clean match, with the accession number formatted with a stray dash on the lab side purely to prove that value normalization handles cosmetic formatting noise.

`PK_Sample_Manifest.csv`, `PK_Vendor_Lab_Data.csv`, and `PK_Sample_Plan.csv` in this folder are this exact dataset exported to disk, generated straight from `demo.js` so they can't drift out of sync with it — upload them through the actual file-upload/plan-import paths (rather than the "Load Demo Data" shortcut) to exercise the CSV parsing and plan-mapping code specifically.

Run `node test.js` to see this verified: it asserts that the accession-number columns are ranked as the primary key (score ~0.84, 100% value overlap) while the subject-ID columns don't even make the top 10 ranked pairs (0% overlap, given the incompatible formats) — the empirical version of the LabMatrix conversation's conclusion that subject/visit matching alone doesn't work here.

## Known limitations (POC scope)

- **Single pair of files at a time** — no batch/multi-vendor reconciliation in one pass.
- **Client-side performance ceiling** — fine for thousands of rows; a truly large trial's full dataset would need a different approach (this POC is a design proof, not a scaled tool).
- **CSV parsing is hand-rolled, not SheetJS** — SheetJS's default CSV type-inference silently turns date-looking text (DOB, collection dates) into raw Excel serial numbers (e.g. `1967-08-17` → `24701.04...`). `index.html` parses `.csv` files itself (no type coercion) to avoid this, and only hands `.xlsx`/`.xls` files to SheetJS, with `cellDates` + a fixed date format so genuinely-numeric Excel date cells come back as plain `yyyy-mm-dd` text too.
- **Ambiguous numeric dates aren't fully resolvable** — `03/04/2026` is genuinely ambiguous between 3-Apr and 4-Mar with no per-column format hint; the tool defaults to month-first and flags the assumption (`ambiguous: true`, shown as "day/month assumed ⚠") rather than guessing silently, but that's a flag for human review, not a fix. A production version would want an explicit per-field format selector instead of an assumption.
- **No SAS7BDAT support** — CSV/XLSX only. The SoA POC's Python backend used `pyreadstat` for SAS files; that route is available if a server-side option is preferred later.
- **Name-based category matching is a heuristic, not NLP** — compound header names (e.g. `SubjectSex`) are resolved with a simple token-preference rule, not true language understanding. It's tuned and tested against the demo dataset's naming conventions; a real deployment would want a larger synonym library and probably a short human-in-the-loop confirmation step, which the UI already provides (every suggestion is editable before it's used).
- **Expected-sample check doesn't know about subject disposition** — subject 15's dropout is (correctly, if bluntly) flagged as missing samples. A production version would cross-reference disposition/early-termination data before flagging.
- **Duplicate keys pair by row order, not by additional context** — if a key is duplicated on both sides, only the first occurrence on each side is auto-matched; the rest are surfaced as both a duplicate-key finding and an unmatched record for manual review, rather than guessed at.
- **Cohort resolution assumes one cohort per subject, read from one source at a time** — the expected-sample check reads Cohort/Period/Timepoint from whichever single source you're checking; it doesn't cross-validate that the manifest's and the lab's idea of a subject's cohort agree (mostly because in this demo the lab file doesn't even carry a cohort column, which is realistic — arm/cohort assignment is usually an EDC/site construct, not something vendor labs echo back).
- **No alias suggestions** — the value-alias table for cross-vendor qualifier terminology is entirely manual; the tool doesn't try to guess that `"0H"` might mean `"PRE-DOSE"` the way it suggests column keys. See "Cohorts, visit qualifiers, and cross-vendor terminology" above for why that's a deliberate choice, not an oversight.
- **Plan import requires Visit and Sample Type at minimum** — Cohort/Period/Timepoint/Required are all optional when mapping an imported plan file's columns, but the import is rejected without at least those two, since a plan row with neither means nothing.
- **No session persistence** — by design. Refreshing the page clears everything; there's no "save and come back tomorrow." If that turns out to be a real requirement, it would need a deliberate, scoped decision about what (if anything) gets stored, not an accidental one.

## Suggested next steps

1. Try it against a real (de-identified or synthetic) manifest/lab pair from the PK reconciliation group's actual data to see how the key-suggestion heuristics hold up outside the demo dataset.
2. Extend the synonym dictionary and normalization rules based on what that test surfaces.
3. Decide whether mapping templates and sample-plan templates should live as P21 reference tables (per the design discussion) and, if so, design that storage layer separately from this POC.
4. If EDC-side reconciliation is the next priority (per the earlier design discussion's phasing), extend the demo and test harness to an EDC-shaped dataset before touching the UI.
