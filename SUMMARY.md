# P21 Reconciliation POC — What it is, in plain terms

## The problem

Data managers reconciling a sample manifest against lab data (or EDC data) today either build a bespoke SAS/Excel comparison for each study, or lean on a vendor tool. One vendor tool in active use — IQVIA LabMatrix — has a specific, recurring problem: it tends to match records using subject ID and visit name, and those are exactly the fields most likely to be inconsistent across a site, an EDC system, and a lab (different formats, different abbreviations, no shared crosswalk). When the match key is unreliable, everything downstream — missing-sample detection, demographic checks — is unreliable too.

The other missing piece is checking whether samples that were *supposed* to be collected actually exist anywhere. Not "do these two files agree with each other" but "did we get what the protocol said we'd get."

## What this POC demonstrates

A small web tool — one file, opens directly in a browser, nothing to install — that:

1. Takes two uploaded files (a manifest and a lab export, say) and looks at the actual values in every column to work out which two columns are really the same identifier — rather than guessing from column names alone. It's built to prefer the accession/barcode number over the subject ID as the matching key, because the barcode is the one thing that's supposed to stay identical everywhere, while subject IDs are the thing most likely to differ.
2. Lets you confirm or override that suggestion, and pick which demographic fields (sex, DOB, etc.) should be cross-checked between the two files.
3. Runs the comparison and shows you: what matched cleanly, what's missing from one side or the other, any accession numbers that got accidentally reused, and any demographic disagreements.
4. Separately checks — against a plan of "what should exist" (which visit, which sample type, for which cohort) — whether each subject actually has everything their cohort's schedule expected, independent of whether the identity-matching problem above is solved at all. The plan can be typed in by hand or uploaded from its own file.

Real studies rarely have one flat schedule, so the plan handles the messier reality: different cohorts or arms can require different samples (an extension cohort that only draws half of what the main cohort draws, say), and a single visit can draw more than one specimen distinguished only by a timepoint (pre-dose vs. two hours post-dose). The tool only asks you to spell out where things actually differ — a sample requirement that applies to every cohort is written once, not once per cohort.

That still leaves the question of naming. A cosmetic difference — "PRE-DOSE" in one file, "Pre Dose" in another — is recognized automatically. A genuine difference in vocabulary — one vendor calling the same draw "0H" instead of any spelling of "pre-dose" — is not silently guessed at; it shows up as a flagged discrepancy until someone tells the tool, once, that the two mean the same thing. That one-line correction is then reusable, the same way the plan itself is reusable.

Click "Load Demo Data" on the first screen and it runs through a realistic example immediately, including a few deliberately broken cases (a sample that was never collected, a lost accession number, a mislabeled reused barcode, two demographic typos, and a reduced-schedule cohort) so you can see exactly what each type of finding looks like.

## Why it doesn't need to "store" anything

Everything happens inside the browser tab. Nothing gets uploaded to a server, saved to a database, or sent anywhere. Close the tab and it's as if it never happened. That's not a limitation to work around later — it's the point: this is designed to answer the reconciliation question without ever becoming a place where clinical data lives, which is exactly the gap between what P21 can do today and what a repository-style tool like LabMatrix does.

The only thing worth keeping between sessions is the *setup* — which columns to match on, what the expected sample plan looks like for a given protocol, which vendor terms mean the same thing — because that's all just configuration, not subject data.

## A note on dates

Dates get their own small piece of care: they're compared as actual calendar dates, not as text, so "2026-02-11" and "11-Feb-2026" are correctly recognized as the same day. This mattered in practice — an earlier version of the date comparison had a subtle bug where the *same* date written two different ways could come back looking like it differed by an hour, purely because of how the browser's own date parser handles timezones differently depending on format. That's fixed. What's still an open question is genuinely ambiguous dates like "03/04/2026" — nothing can know for certain whether that's the 3rd of April or the 4th of March without being told, so the tool flags that case for a human to check rather than quietly picking one.

## What it isn't (yet)

This is a proof of concept for a design discussion, not a finished product. It handles one manifest-vs-data comparison at a time, it's tuned against the demo dataset's naming conventions (real-world files will need the matching rules broadened), and it doesn't know about things like subject dropout when checking for expected samples — a real subject who left the study early will currently get flagged as "missing" samples they were never going to give. The vendor-terminology aliases mentioned above are also entirely manual — the tool won't guess on its own that two spellings mean the same specimen draw, because guessing wrong there is worse than not guessing at all. All of that is fixable; none of it was worth solving before checking whether the core idea — match on accession ID first, check expected samples independently of that, and handle cohort/timepoint complexity without forcing every study into one flat schedule — actually holds up. Running `node test.js` (for anyone comfortable with that) walks through the demo data step by step and confirms it does.
