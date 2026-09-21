const assert = require("assert");
const P21Recon = require("./core.js");
const { buildDemoData } = require("./demo.js");

const { manifestHeaders, manifestRows, labHeaders, labRows, samplePlan } = buildDemoData();

console.log(`manifest rows: ${manifestRows.length}, lab rows: ${labRows.length}`);

// ---- 1. Key suggestion: accession columns must outrank subject columns ----
const suggestion = P21Recon.suggestKeys(manifestRows, manifestHeaders, labRows, labHeaders);
console.log("\nTop ranked pairs:");
suggestion.rankedPairs.forEach((p) =>
  console.log(`  ${p.colA} <-> ${p.colB}  score=${p.score.toFixed(3)} overlap=${p.overlap.toFixed(3)} variant=${p.normVariant} category=${p.category}`)
);

assert.strictEqual(suggestion.primary.colA, "AccessionNo");
assert.strictEqual(suggestion.primary.colB, "AccessionNumber");
assert.ok(suggestion.primary.score > 0.8, "primary key score should be high");

const subjectPair = suggestion.rankedPairs.find((p) => p.colA === "SiteSubjNo" && p.colB === "LabPatientID");
console.log("\nSubject-column pair (for comparison):", subjectPair || "not in top 10 — overlap too low to rank");
if (subjectPair) {
  assert.ok(subjectPair.score < suggestion.primary.score, "subject pair must score lower than accession pair");
  assert.ok(subjectPair.overlap < 0.5, "subject-ID overlap should be poor given inconsistent nomenclature");
}

console.log("\n[PASS] Accession-ID columns correctly identified as the primary key, ranked above subject-ID columns.");

// ---- 2. Reconciliation ----
const primaryKey = { colA: "AccessionNo", colB: "AccessionNumber", normVariant: suggestion.primary.normVariant };
const fallbackKey = {
  subject: { colA: "SiteSubjNo", colB: "LabPatientID" },
  visit: { colA: "VisitLabel", colB: "VisitName" },
  sampleType: { colA: "SpecimenType", colB: "Analyte" },
};
const demographicMappings = [
  { label: "Sex", colA: "SubjectSex", colB: "Sex", type: "exact" },
  { label: "DOB", colA: "SubjectDOB", colB: "DOB", type: "date", toleranceDays: 0 },
];

const result = P21Recon.reconcile({ rowsA: manifestRows, rowsB: labRows, primaryKey, fallbackKey, demographicMappings });
console.log("\nReconciliation summary:", result.summary);

// subject 7's blank-accession manifest row can't be indexed -> lab row becomes an orphan
assert.ok(result.missingInA.length >= 1, "expected at least one unmatched lab record (subject 7 orphan)");
const orphan = result.missingInA.find((m) => m.row.LabPatientID === "007");
assert.ok(orphan, "subject 7's orphan lab record should appear in missingInA");

// subject 12's reused accession number must be flagged as a duplicate on both sides
const dupA = result.duplicates.find((d) => d.side === "A" && d.key.includes("PK012000"));
assert.ok(dupA, "reused accession number should be flagged as a duplicate in manifest data");

// demographic mismatches for subjects 5 (DOB) and 14 (Sex) must surface
const allMatched = result.matchedHigh.concat(result.matchedLow);
const dobMismatches = allMatched.filter((m) => m.rowA.SiteSubjNo === "07-005" && m.fieldResults.find((f) => f.label === "DOB" && f.status === "mismatch"));
const sexMismatches = allMatched.filter((m) => m.rowA.SiteSubjNo === "07-014" && m.fieldResults.find((f) => f.label === "Sex" && f.status === "mismatch"));
assert.ok(dobMismatches.length > 0, "subject 5 DOB mismatch should be detected");
assert.ok(sexMismatches.length > 0, "subject 14 Sex mismatch should be detected");

console.log("[PASS] Duplicate accession, orphan record, and demographic mismatches all detected correctly.");

// ---- 2b. cross-format date comparison (regression guard) ----
// Same calendar date, three different textual formats — must all report zero
// difference. This is the exact bug class that caused "1967-08-17" vs
// "17-AUG-1967" to falsely mismatch by an hour before parseCalendarDate existed
// (Date.parse treats ISO dates as UTC but other formats as local time).
const sameDateFormats = [
  ["1967-08-17", "17-AUG-1967"],
  ["1967-08-17", "08-17-1967"],
  ["1967-08-17", "1967/08/17"],
  ["2026-02-11", "11-Feb-2026"],
];
sameDateFormats.forEach(([a, b]) => {
  const r = P21Recon.compareField(a, b, "date", 0);
  assert.strictEqual(r.status, "match", `"${a}" and "${b}" are the same calendar date and must match, got: ${JSON.stringify(r)}`);
  assert.strictEqual(r.diffDays, 0, `"${a}" vs "${b}" should have zero day difference, got: ${JSON.stringify(r)}`);
});
console.log("[PASS] Same calendar date compares equal across ISO / DD-MON-YYYY / MM-DD-YYYY / slash formats (no timezone artifacts).");

// genuinely ambiguous day/month order must be flagged, not silently guessed
const ambiguousCase = P21Recon.compareField("2026-02-11", "11/02/2026", "date", 0);
assert.strictEqual(ambiguousCase.ambiguous, true, "day-first vs month-first ambiguity must be flagged");
console.log(`[PASS] Ambiguous numeric date order (11/02/2026) is flagged rather than silently assumed: ${JSON.stringify(ambiguousCase)}`);

// fallback key should rescue ~nothing, proving subject/visit nomenclature alone is unusable here
console.log(`Fallback-matched (low confidence) count: ${result.matchedLow.length} (expected 0 — subject ID formats never coincide)`);
assert.strictEqual(result.matchedLow.length, 0);
console.log("[PASS] Fallback subject/visit key correctly fails to rescue any records — confirms accession-ID matching is required, not optional.");

// ---- 3. Expected-sample reconciliation (cohort-scoped, timepoint-qualified) ----
const expCols = { subjectCol: "SiteSubjNo", cohortCol: "Cohort", visitCol: "VisitLabel", periodCol: "", timepointCol: "Timepoint", sampleTypeCol: "SpecimenType" };
const expected = P21Recon.expectedSampleCheck(manifestRows, expCols, samplePlan);
console.log(`\nExpected-sample check across ${expected.subjectCount} subjects, ${expected.findings.length} findings.`);

const subj3Missing = expected.findings.find((f) => f.subject === "07-003" && f.visit === "WEEK 8" && f.sampleType === "PK Trough" && f.severity === "ERROR");
assert.ok(subj3Missing, "subject 3 should be flagged as missing WEEK 8 / PK Trough");

const subj15Missing = expected.findings.filter((f) => f.subject === "07-015" && f.visit === "WEEK 8");
assert.strictEqual(subj15Missing.length, 2, "subject 15 (dropout) should show 2 missing WEEK 8 findings (trough + peak, Cohort A)");

// subject 7's blank-accession row still counts as *present* for expected-sample purposes —
// this check only cares whether the manifest row exists, independent of key resolution.
const subj7Wk4Peak = expected.findings.find((f) => f.subject === "07-007" && f.visit === "WEEK 4" && f.sampleType === "PK Peak");
assert.strictEqual(subj7Wk4Peak, undefined, "subject 7's WEEK 4/PK Peak sample should NOT be flagged missing (manifest row exists despite blank accession)");

console.log("[PASS] Expected-sample reconciliation correctly flags real gaps (subjects 3 & 15) and is unaffected by the accession-matching problem (subject 7).");

// ---- 3b. cohort-scoped plan rows ----
// Cohort B (subjects 16-20) never draws a PK Peak sample — the plan rows requiring
// PK Peak are scoped to Cohort A only, so Cohort B subjects must show zero PK Peak
// findings of *any* kind (neither "missing" nor "unexpected").
const cohortBPeakFindings = expected.findings.filter((f) => /^07-01[6-9]|^07-020/.test(f.subject) && f.sampleType === "PK Peak");
assert.strictEqual(cohortBPeakFindings.length, 0, `Cohort B subjects must have no PK Peak findings at all, got: ${JSON.stringify(cohortBPeakFindings)}`);
console.log("[PASS] Cohort-scoped plan rows correctly exclude Cohort B from PK Peak requirements (no false positives).");

// A clean Cohort A subject (07-001) should have zero findings — proving the
// timepoint-qualified WEEK 4 plan rows (trough @ PRE-DOSE, peak @ 2H POST) match
// correctly against the manifest's own timepoint values rather than false-flagging.
const subj001Findings = expected.findings.filter((f) => f.subject === "07-001");
assert.strictEqual(subj001Findings.length, 0, `Clean Cohort A subject 07-001 should have zero expected-sample findings, got: ${JSON.stringify(subj001Findings)}`);
console.log("[PASS] Timepoint-qualified plan rows (PRE-DOSE / 2H POST) match cleanly against a subject with no exceptions.");

// ---- 3c. value aliases resolve cross-vendor formatting differences (not real vocabulary gaps) ----
// If the *data* used different casing/punctuation for the same timepoint ("Pre Dose"
// instead of "PRE-DOSE"), it should still match the plan without needing an alias,
// because comparison is alphanumeric-normalized. Simulate that by cloning subject 1's
// WEEK 4 trough row with a cosmetically different timepoint spelling.
const cosmeticRows = manifestRows.map((r) => r.SiteSubjNo === "07-001" && r.VisitLabel === "WEEK 4" && r.SpecimenType === "PK Trough"
  ? { ...r, Timepoint: "Pre Dose" } : r);
const cosmeticCheck = P21Recon.expectedSampleCheck(cosmeticRows, expCols, samplePlan);
const cosmeticSubj001 = cosmeticCheck.findings.filter((f) => f.subject === "07-001");
assert.strictEqual(cosmeticSubj001.length, 0, "cosmetic timepoint spelling ('Pre Dose' vs 'PRE-DOSE') must still match without an alias");
console.log("[PASS] Cosmetic formatting differences in qualifier values (case/punctuation) resolve without an alias.");

// A *genuine* vocabulary difference ("0H" instead of any variant of "pre-dose") does
// NOT resolve on its own — and an explicit alias fixes it. This is the deliberate
// limitation: the tool flags real terminology gaps rather than guessing at them.
const vocabRows = manifestRows.map((r) => r.SiteSubjNo === "07-001" && r.VisitLabel === "WEEK 4" && r.SpecimenType === "PK Trough"
  ? { ...r, Timepoint: "0H" } : r);
const vocabCheckNoAlias = P21Recon.expectedSampleCheck(vocabRows, expCols, samplePlan);
const vocabFindingNoAlias = vocabCheckNoAlias.findings.filter((f) => f.subject === "07-001");
assert.ok(vocabFindingNoAlias.length > 0, "a genuine vocabulary difference ('0H' vs 'PRE-DOSE') must NOT silently resolve");

const aliases = [{ dimension: "timepoint", raw: "0H", canonical: "PRE-DOSE" }];
const vocabCheckWithAlias = P21Recon.expectedSampleCheck(vocabRows, expCols, samplePlan, aliases);
const vocabFindingWithAlias = vocabCheckWithAlias.findings.filter((f) => f.subject === "07-001");
assert.strictEqual(vocabFindingWithAlias.length, 0, "an explicit value alias should resolve the genuine vocabulary difference");
console.log("[PASS] Genuine cross-vendor vocabulary differences are flagged, not guessed — and resolve once an explicit alias is supplied.");

console.log("\nALL TESTS PASSED");
