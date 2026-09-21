// demo.js — synthetic demo data for the P21 Reconciliation POC.
//
// Mirrors two real-world scenarios discussed:
// 1. A sample manifest (site-entered) vs vendor lab data, where subject-ID
//    nomenclature differs completely between sources but the lab-issued
//    accession/barcode number is the one value that travels unchanged.
// 2. A study with two cohorts on different PK sampling schedules, where one
//    visit (WEEK 4) draws two specimens distinguished only by a timepoint
//    qualifier (pre-dose vs 2h post-dose) — exercising the cohort-scoped,
//    multi-qualifier expected-sample plan.
//
// Deliberate gaps/exceptions are injected to exercise every finding type.

(function (root) {
  "use strict";

  function pad3(n) { return String(n).padStart(3, "0"); }

  // Cohort A (subjects 1-15): full PK schedule — trough + peak at WEEK 4 and WEEK 8,
  // with WEEK 4's two draws distinguished by a timepoint qualifier.
  // Cohort B (subjects 16-20): reduced/extension cohort — trough only, no peak, ever.
  const COHORT_A_EVENTS = [
    { visit: "SCREENING", sampleType: "PD Biomarker", timepoint: "" },
    { visit: "WEEK 4", sampleType: "PK Trough", timepoint: "PRE-DOSE" },
    { visit: "WEEK 4", sampleType: "PK Peak", timepoint: "2H POST" },
    { visit: "WEEK 8", sampleType: "PK Trough", timepoint: "" },
    { visit: "WEEK 8", sampleType: "PK Peak", timepoint: "" },
  ];
  const COHORT_B_EVENTS = [
    { visit: "SCREENING", sampleType: "PD Biomarker", timepoint: "" },
    { visit: "WEEK 4", sampleType: "PK Trough", timepoint: "PRE-DOSE" },
    { visit: "WEEK 8", sampleType: "PK Trough", timepoint: "" },
  ];

  const visitLabelMap = { SCREENING: "Screening", "WEEK 4": "Wk4", "WEEK 8": "Wk8" };
  const sampleTypeMap = { "PD Biomarker": "PD-Biomarker", "PK Trough": "PK-Trough", "PK Peak": "PK-Peak" };

  // Authored once, in the manifest's own canonical vocabulary. Cohort-blank rows
  // apply to every cohort; the two PK Peak rows are Cohort A-only since Cohort B
  // never draws a peak sample at all. This is the "safe to persist as a reference
  // table" artifact — a protocol template, no subject data.
  const samplePlan = [
    { cohort: "", visit: "SCREENING", sampleType: "PD Biomarker", required: "Y" },
    { cohort: "", visit: "WEEK 4", sampleType: "PK Trough", timepoint: "PRE-DOSE", required: "Y" },
    { cohort: "Cohort A", visit: "WEEK 4", sampleType: "PK Peak", timepoint: "2H POST", required: "Y" },
    { cohort: "", visit: "WEEK 8", sampleType: "PK Trough", required: "Y" },
    { cohort: "Cohort A", visit: "WEEK 8", sampleType: "PK Peak", required: "Y" },
  ];

  function buildDemoData() {
    const manifestHeaders = ["SiteSubjNo", "Cohort", "VisitLabel", "SpecimenType", "Timepoint", "AccessionNo", "CollectionDate", "SubjectSex", "SubjectDOB"];
    const labHeaders = ["LabPatientID", "VisitName", "Analyte", "AccessionNumber", "ReceivedDate", "Sex", "DOB"];

    const manifestRows = [];
    const labRows = [];
    let accessionSeq = 100000;
    const nextAccession = () => "PK" + String(accessionSeq++).padStart(6, "0");

    function demographicsFor(n) {
      const baseSex = n % 2 === 0 ? "F" : "M";
      const baseDOB = `19${60 + (n % 30)}-0${1 + (n % 9)}-1${n % 9}`;
      let manifestSex = baseSex, labSex = baseSex;
      let manifestDOB = baseDOB, labDOB = baseDOB;
      if (n === 14) { manifestSex = "F"; labSex = "M"; } // transcription error
      if (n === 5) { manifestDOB = "1975-04-12"; labDOB = "1957-04-12"; } // digit transposition
      return { manifestSex, labSex, manifestDOB, labDOB };
    }

    for (let n = 1; n <= 20; n++) {
      const subjA = `07-${pad3(n)}`; // site-formatted, e.g. "07-007"
      const subjB = pad3(n);          // lab-formatted, no site prefix, e.g. "007" — NOT string-equal to subjA
      const cohort = n <= 15 ? "Cohort A" : "Cohort B";
      const events = n <= 15 ? COHORT_A_EVENTS : COHORT_B_EVENTS;
      const dem = demographicsFor(n);

      for (const ev of events) {
        // Subject 3: entire WEEK 8 / PK Trough sample never happened (gap in both sources)
        if (n === 3 && ev.visit === "WEEK 8" && ev.sampleType === "PK Trough") continue;
        // Subject 15: dropout after WEEK 4 — no WEEK 8 samples at all
        if (n === 15 && ev.visit === "WEEK 8") continue;

        const manifestVisit = ev.visit;
        const manifestType = ev.sampleType;
        const labVisit = visitLabelMap[ev.visit];
        const labType = sampleTypeMap[ev.sampleType];
        const collectionDate = `2026-0${1 + (n % 6)}-1${n % 8}`;

        // Subject 7, WEEK 4 / PK Peak: manifest accession left blank (data-entry gap).
        // The lab still received *a* sample and logged its own accession number,
        // but with no shared key the two records can never be linked automatically.
        // (Only Cohort A subjects reach this branch, since only Cohort A has a Peak event.)
        if (n === 7 && ev.visit === "WEEK 4" && ev.sampleType === "PK Peak") {
          manifestRows.push({
            SiteSubjNo: subjA, Cohort: cohort, VisitLabel: manifestVisit, SpecimenType: manifestType, Timepoint: ev.timepoint,
            AccessionNo: "", CollectionDate: collectionDate,
            SubjectSex: dem.manifestSex, SubjectDOB: dem.manifestDOB,
          });
          labRows.push({
            LabPatientID: subjB, VisitName: labVisit, Analyte: labType,
            AccessionNumber: nextAccession(), ReceivedDate: collectionDate,
            Sex: dem.labSex, DOB: dem.labDOB,
          });
          continue;
        }

        // Subject 12: same accession number accidentally reused for two different
        // draws (WEEK 4 and WEEK 8 PK Trough) — classic relabeling error.
        if (n === 12 && ev.sampleType === "PK Trough" && (ev.visit === "WEEK 4" || ev.visit === "WEEK 8")) {
          const sharedAcc = "PK012000";
          manifestRows.push({
            SiteSubjNo: subjA, Cohort: cohort, VisitLabel: manifestVisit, SpecimenType: manifestType, Timepoint: ev.timepoint,
            AccessionNo: sharedAcc, CollectionDate: collectionDate,
            SubjectSex: dem.manifestSex, SubjectDOB: dem.manifestDOB,
          });
          labRows.push({
            LabPatientID: subjB, VisitName: labVisit, Analyte: labType,
            AccessionNumber: sharedAcc, ReceivedDate: collectionDate,
            Sex: dem.labSex, DOB: dem.labDOB,
          });
          continue;
        }

        // Normal case: shared accession number, formatted with a dash on the lab
        // side to prove normalization handles cosmetic formatting differences.
        const acc = nextAccession();
        const accLabFormatted = acc.slice(0, 2) + "-" + acc.slice(2); // "PK-000101"
        manifestRows.push({
          SiteSubjNo: subjA, Cohort: cohort, VisitLabel: manifestVisit, SpecimenType: manifestType, Timepoint: ev.timepoint,
          AccessionNo: acc, CollectionDate: collectionDate,
          SubjectSex: dem.manifestSex, SubjectDOB: dem.manifestDOB,
        });
        labRows.push({
          LabPatientID: subjB, VisitName: labVisit, Analyte: labType,
          AccessionNumber: accLabFormatted, ReceivedDate: collectionDate,
          Sex: dem.labSex, DOB: dem.labDOB,
        });
      }
    }

    return { manifestHeaders, manifestRows, labHeaders, labRows, samplePlan };
  }

  const P21ReconDemo = { buildDemoData };
  if (typeof module !== "undefined" && module.exports) module.exports = P21ReconDemo;
  else root.P21ReconDemo = P21ReconDemo;
})(typeof window !== "undefined" ? window : globalThis);
