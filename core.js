// core.js — P21 Reconciliation POC core algorithms (framework-free, runs in browser or node)
// Shared by index.html (browser) and test.js (node verification).

(function (root) {
  "use strict";

  // ---------- normalization ----------
  function normTrimUpper(v) {
    if (v === undefined || v === null) return "";
    return String(v).trim().toUpperCase();
  }
  function normAlnumUpper(v) {
    return normTrimUpper(v).replace(/[^A-Z0-9]/g, "");
  }
  function normAlnumUpperNoLeadingZeros(v) {
    const a = normAlnumUpper(v);
    // strip leading zeros only from a purely-numeric string; leave alphanumeric ids alone
    if (/^[0-9]+$/.test(a)) return a.replace(/^0+(?=\d)/, "");
    return a;
  }
  const NORM_VARIANTS = [
    { name: "trim-upper", fn: normTrimUpper },
    { name: "alnum-upper", fn: normAlnumUpper },
    { name: "alnum-upper-no-leading-zeros", fn: normAlnumUpperNoLeadingZeros },
  ];

  // ---------- synonym dictionaries ----------
  const CATEGORY_SYNONYMS = {
    BARCODE: ["barcode", "accession", "accessionnumber", "accessionno", "accessionnum", "accessionid",
      "specimenid", "sampleid", "aliquotid", "tubeid", "kitid", "labelid", "specimenbarcode"],
    SUBJECT: ["subject", "subjid", "usubjid", "patient", "patid", "patientid", "participant",
      "participantid", "screeningnumber", "screeningno", "subjectid", "subjectnumber", "subjno"],
    VISIT: ["visit", "visitnum", "visitname", "event", "visitdate"],
    SAMPLETYPE: ["sampletype", "specimentype", "spectype", "analyte", "matrix", "specimen", "sampletypedesc"],
    SEX: ["sex", "gender"],
    DOB: ["dob", "birthdate", "dateofbirth", "birthdt"],
    AGE: ["age", "ageyears", "agey"],
    RACE: ["race", "ethnicity"],
    SITE: ["site", "siteid", "siteno", "center", "centre", "centerid"],
    COLLECTDATE: ["collectiondate", "drawdate", "sampledate", "receiveddate", "collectdt", "draweddate"],
    COHORT: ["cohort", "arm", "armcd", "treatmentarm", "group", "cohortid", "cohortname"],
    PERIOD: ["period", "periodnum", "cycle", "cycleno"],
    TIMEPOINT: ["timepoint", "tpt", "time"],
  };

  function normalizeHeader(h) {
    return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function categoryForHeader(header) {
    const h = normalizeHeader(header);
    const scores = {};
    for (const [cat, syns] of Object.entries(CATEGORY_SYNONYMS)) {
      let best = 0;
      for (const syn of syns) {
        const s = normalizeHeader(syn);
        let score = 0;
        if (h === s) score = 1.0;
        else if (h.includes(s) || s.includes(h)) score = 0.7;
        if (score > best) best = score;
      }
      scores[cat] = best;
    }
    // SUBJECT is a broad, generic category and a common qualifying prefix
    // (e.g. "SubjectSex", "SubjectDOB") — down-weight it in the head-to-head
    // comparison so it doesn't swallow compound names that are really about a
    // more specific field. The *reported* score is still the undiscounted one.
    let bestCat = null, bestEffective = 0;
    for (const [cat, score] of Object.entries(scores)) {
      const effective = cat === "SUBJECT" ? score * 0.75 : score;
      if (effective > bestEffective) { bestEffective = effective; bestCat = cat; }
    }
    return { category: bestCat, score: bestCat ? scores[bestCat] : 0 };
  }

  // ---------- column profiling ----------
  function profileColumn(rows, header) {
    const raw = rows.map((r) => r[header]);
    const nonEmpty = raw.filter((v) => v !== undefined && v !== null && String(v).trim() !== "");
    const upperVals = nonEmpty.map(normTrimUpper);
    const distinct = new Set(upperVals);
    const uniquenessRatio = nonEmpty.length ? distinct.size / nonEmpty.length : 0;

    let barcodeLike = 0, dateLike = 0, numericLike = 0;
    for (const v of upperVals) {
      if (/^[A-Z0-9][A-Z0-9\-_]{3,19}$/.test(v)) barcodeLike++;
      if (/^[0-9]+$/.test(v) && v.length <= 12) numericLike++;
      if (!isNaN(Date.parse(v)) && /[0-9]{2,4}/.test(v) && v.length >= 6) dateLike++;
    }
    const n = Math.max(nonEmpty.length, 1);
    const barcodeRatio = barcodeLike / n;
    const dateRatio = dateLike / n;
    const numericRatio = numericLike / n;

    const cat = categoryForHeader(header);

    return {
      header,
      nonEmptyCount: nonEmpty.length,
      distinctCount: distinct.size,
      uniquenessRatio,
      looksBarcode: barcodeRatio > 0.8 && uniquenessRatio > 0.8,
      looksDate: dateRatio > 0.6,
      looksNumericId: numericRatio > 0.6,
      category: cat.category,
      categoryScore: cat.score,
      sample: nonEmpty.slice(0, 3),
    };
  }

  function profileFile(rows, headers) {
    const profiles = {};
    for (const h of headers) profiles[h] = profileColumn(rows, h);
    return profiles;
  }

  // ---------- value overlap between two columns ----------
  function computeOverlap(rowsA, colA, rowsB, colB) {
    let best = { score: 0, variant: null };
    for (const variant of NORM_VARIANTS) {
      const setA = new Set(rowsA.map((r) => variant.fn(r[colA])).filter(Boolean));
      const setB = new Set(rowsB.map((r) => variant.fn(r[colB])).filter(Boolean));
      if (!setA.size || !setB.size) continue;
      let intersection = 0;
      for (const v of setA) if (setB.has(v)) intersection++;
      const score = intersection / Math.min(setA.size, setB.size);
      if (score > best.score) best = { score, variant: variant.name, intersection, sizeA: setA.size, sizeB: setB.size };
    }
    return best;
  }

  // ---------- key suggestion ----------
  function suggestKeys(rowsA, headersA, rowsB, headersB) {
    const profA = profileFile(rowsA, headersA);
    const profB = profileFile(rowsB, headersB);

    const pairs = [];
    for (const colA of headersA) {
      for (const colB of headersB) {
        const overlap = computeOverlap(rowsA, colA, rowsB, colB);
        if (overlap.score <= 0) continue;
        const pA = profA[colA], pB = profB[colB];
        const nameSynergy = pA.category && pA.category === pB.category
          ? Math.min(pA.categoryScore, pB.categoryScore) : 0;
        const patternBonus = pA.looksBarcode && pB.looksBarcode ? 0.2 : 0;
        const score = 0.55 * overlap.score + 0.25 * nameSynergy + 0.20 * patternBonus;
        pairs.push({
          colA, colB, score,
          overlap: overlap.score, normVariant: overlap.variant,
          category: pA.category === pB.category ? pA.category : null,
          barcodeLike: pA.looksBarcode && pB.looksBarcode,
        });
      }
    }
    pairs.sort((a, b) => b.score - a.score);

    const primary = pairs[0] || null;

    // fallback: best pair within SUBJECT, VISIT, SAMPLETYPE categories (excluding the primary's columns)
    function bestOfCategory(cat) {
      const candidates = pairs.filter((p) => p.category === cat && p !== primary);
      return candidates[0] || null;
    }
    const fallback = {
      subject: bestOfCategory("SUBJECT"),
      visit: bestOfCategory("VISIT"),
      sampleType: bestOfCategory("SAMPLETYPE"),
    };

    return { profA, profB, rankedPairs: pairs.slice(0, 10), primary, fallback };
  }

  // ---------- reconciliation ----------
  function buildIndex(rows, col, normFn) {
    const idx = new Map();
    rows.forEach((row, i) => {
      const key = normFn(row[col]);
      if (!key) return;
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(i);
    });
    return idx;
  }

  function normFnFor(variantName) {
    return (NORM_VARIANTS.find((v) => v.name === variantName) || NORM_VARIANTS[0]).fn;
  }

  // ---------- flexible date parsing ----------
  // Deliberately does NOT lean on the platform's native Date.parse for
  // cross-format comparison. Two problems with that: (1) Date.parse treats
  // bare ISO dates ("2026-02-11") as UTC but treats almost every other format
  // ("11-Feb-2026", "02/11/2026") as *local* time, so the same calendar date
  // written two different ways can come back an hour or more apart purely from
  // timezone arithmetic — a false mismatch with zero clinical meaning. (2) for
  // ambiguous numeric formats (03/04/2026) it silently guesses month-first with
  // no way to know it guessed. This parser extracts year/month/day directly for
  // every format it recognizes (so identical dates always net to zero difference
  // regardless of source format) and flags the result "ambiguous" when the
  // day/month order had to be assumed, so that can be surfaced rather than hidden.
  const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function fixYear(y) { y = Number(y); return y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y; }

  function parseCalendarDate(str) {
    const s = String(str === undefined || str === null ? "" : str).trim();
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return { y: +m[1], mo: +m[2], d: +m[3] };
    if ((m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/))) return { y: +m[1], mo: +m[2], d: +m[3] };
    if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})$/))) {
      const mo = MONTH_NAMES[m[2].toLowerCase().slice(0, 3)];
      if (mo) return { y: fixYear(m[3]), mo, d: +m[1] };
    }
    if ((m = s.match(/^([A-Za-z]{3,})[-\s](\d{1,2}),?[-\s](\d{2,4})$/))) {
      const mo = MONTH_NAMES[m[1].toLowerCase().slice(0, 3)];
      if (mo) return { y: fixYear(m[3]), mo, d: +m[2] };
    }
    if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/))) {
      const a = +m[1], b = +m[2], y = fixYear(m[3]);
      if (a > 12 && b <= 12) return { y, mo: b, d: a };   // only valid as D/M/Y
      if (b > 12 && a <= 12) return { y, mo: a, d: b };   // only valid as M/D/Y
      return { y, mo: a, d: b, ambiguous: true };          // both <=12: assuming month-first
    }
    // last resort: hand off to the platform, but re-extract via UTC getters so
    // the *result* is at least self-consistent even though the input format
    // wasn't recognized.
    const t = Date.parse(s);
    if (!isNaN(t)) {
      const dt = new Date(t);
      return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), fallback: true };
    }
    return null;
  }

  function calendarDateToEpochDay(cd) {
    return Math.floor(Date.UTC(cd.y, cd.mo - 1, cd.d) / 86400000);
  }

  function compareField(valA, valB, type, toleranceDays) {
    const a = valA === undefined || valA === null ? "" : String(valA).trim();
    const b = valB === undefined || valB === null ? "" : String(valB).trim();
    if (!a || !b) return { status: "n/a" };
    if (type === "date") {
      const pa = parseCalendarDate(a), pb = parseCalendarDate(b);
      if (!pa || !pb) return { status: a.toUpperCase() === b.toUpperCase() ? "match" : "mismatch" };
      const diffDays = Math.abs(calendarDateToEpochDay(pa) - calendarDateToEpochDay(pb));
      return {
        status: diffDays <= (toleranceDays || 0) ? "match" : "mismatch",
        diffDays,
        ambiguous: !!(pa.ambiguous || pb.ambiguous),
      };
    }
    return { status: a.toUpperCase() === b.toUpperCase() ? "match" : "mismatch" };
  }

  function reconcile(opts) {
    const { rowsA, rowsB, primaryKey, fallbackKey, demographicMappings = [] } = opts;
    const normFn = normFnFor(primaryKey.normVariant);
    const idxA = buildIndex(rowsA, primaryKey.colA, normFn);
    const idxB = buildIndex(rowsB, primaryKey.colB, normFn);

    const matchedHigh = [];
    const duplicates = [];
    const unmatchedAIdx = new Set(rowsA.map((_, i) => i));
    const unmatchedBIdx = new Set(rowsB.map((_, i) => i));

    for (const [key, aIdxs] of idxA.entries()) {
      if (aIdxs.length > 1) duplicates.push({ side: "A", key, count: aIdxs.length, rows: aIdxs });
      const bIdxs = idxB.get(key);
      if (!bIdxs) continue;
      if (bIdxs.length > 1) duplicates.push({ side: "B", key, count: bIdxs.length, rows: bIdxs });
      const ai = aIdxs[0], bi = bIdxs[0];
      unmatchedAIdx.delete(ai);
      unmatchedBIdx.delete(bi);
      const rowA = rowsA[ai], rowB = rowsB[bi];
      const fieldResults = demographicMappings.map((m) => ({
        label: m.label,
        ...compareField(rowA[m.colA], rowB[m.colB], m.type, m.toleranceDays),
      }));
      matchedHigh.push({ key, rowA, rowB, confidence: "high", fieldResults });
    }

    // tiered fallback match on remaining unmatched rows
    const matchedLow = [];
    if (fallbackKey && fallbackKey.subject && fallbackKey.visit) {
      const fbNorm = (row, subjCol, visitCol, stCol) =>
        [normTrimUpper(row[subjCol]), normTrimUpper(row[visitCol]), stCol ? normTrimUpper(row[stCol]) : ""].join("|");

      const remA = [...unmatchedAIdx];
      const remB = [...unmatchedBIdx];
      const fbIdxA = new Map();
      remA.forEach((i) => {
        const k = fbNorm(rowsA[i], fallbackKey.subject.colA, fallbackKey.visit.colA, fallbackKey.sampleType && fallbackKey.sampleType.colA);
        if (!fbIdxA.has(k)) fbIdxA.set(k, []);
        fbIdxA.get(k).push(i);
      });
      remB.forEach((i) => {
        const k = fbNorm(rowsB[i], fallbackKey.subject.colB, fallbackKey.visit.colB, fallbackKey.sampleType && fallbackKey.sampleType.colB);
        if (fbIdxA.has(k)) {
          const aList = fbIdxA.get(k);
          if (aList.length) {
            const ai = aList.shift();
            unmatchedAIdx.delete(ai);
            unmatchedBIdx.delete(i);
            const rowA = rowsA[ai], rowB = rowsB[i];
            const fieldResults = demographicMappings.map((m) => ({
              label: m.label,
              ...compareField(rowA[m.colA], rowB[m.colB], m.type, m.toleranceDays),
            }));
            matchedLow.push({ key: k, rowA, rowB, confidence: "low", note: "matched via fallback subject/visit key — verify identity", fieldResults });
          }
        }
      });
    }

    const missingInB = [...unmatchedAIdx].map((i) => ({ row: rowsA[i], source: "A" }));
    const missingInA = [...unmatchedBIdx].map((i) => ({ row: rowsB[i], source: "B" }));

    const fieldMismatchCount = matchedHigh.concat(matchedLow)
      .reduce((sum, m) => sum + m.fieldResults.filter((f) => f.status === "mismatch").length, 0);

    return {
      summary: {
        matchedHigh: matchedHigh.length,
        matchedLow: matchedLow.length,
        missingInB: missingInB.length,
        missingInA: missingInA.length,
        duplicateKeys: duplicates.length,
        fieldMismatches: fieldMismatchCount,
      },
      matchedHigh, matchedLow, missingInB, missingInA, duplicates,
    };
  }

  // ---------- expected-sample reconciliation ----------
  // cols: { subjectCol, cohortCol, visitCol, periodCol, timepointCol, sampleTypeCol }
  //   — cohortCol/periodCol/timepointCol are optional; pass "" or omit to skip that dimension.
  // plan: [{ cohort, visit, period, timepoint, sampleType, required }]
  //   — cohort/period/timepoint are optional per row. A blank value in a plan row for any
  //     of these means "applies regardless" (wildcard), so a flat plan with none of them set
  //     behaves exactly like the original single-schedule check. A plan row with a cohort set
  //     only applies to subjects whose resolved cohort matches it; a plan row with period/
  //     timepoint set only matches actual records that also carry that period/timepoint.
  // aliases: [{ dimension, raw, canonical }] — optional per-dimension value crosswalk applied
  //     to the *actual data* (never the plan) before comparison. Needed because visit/timepoint/
  //     cohort naming is realistically inconsistent across vendors/EDC — see README. Comparison
  //     itself uses alphanumeric-normalized matching (case/punctuation-insensitive) on top of
  //     any alias substitution, so cosmetic differences ("PRE-DOSE" vs "Pre Dose") resolve on
  //     their own, while genuine vocabulary differences ("2H POST" vs "2hr Post-Dose") need an
  //     explicit alias to resolve — the tool deliberately does not guess at those.
  function expectedSampleCheck(rows, cols, plan, aliases) {
    const norm = normAlnumUpper;
    function resolve(dimension, rawValue) {
      const v = rawValue === undefined || rawValue === null ? "" : String(rawValue).trim();
      if (!v || !aliases || !aliases.length) return v;
      const hit = aliases.find((al) => al.dimension === dimension && norm(al.raw) === norm(v));
      return hit ? hit.canonical : v;
    }

    const bySubject = new Map();
    rows.forEach((r) => {
      const subj = r[cols.subjectCol];
      if (subj === undefined || subj === null || String(subj).trim() === "") return;
      const key = String(subj).trim();
      if (!bySubject.has(key)) bySubject.set(key, { cohort: "", records: [] });
      const entry = bySubject.get(key);
      const cohortVal = cols.cohortCol ? resolve("cohort", r[cols.cohortCol]) : "";
      if (cohortVal && !entry.cohort) entry.cohort = cohortVal;
      entry.records.push({
        visit: resolve("visit", cols.visitCol ? r[cols.visitCol] : ""),
        period: cols.periodCol ? resolve("period", r[cols.periodCol]) : "",
        timepoint: cols.timepointCol ? resolve("timepoint", r[cols.timepointCol]) : "",
        sampleType: resolve("sampleType", cols.sampleTypeCol ? r[cols.sampleTypeCol] : ""),
      });
    });

    function dimMatch(planVal, actualVal) {
      if (planVal === undefined || planVal === null || String(planVal).trim() === "") return true; // wildcard
      return norm(planVal) === norm(actualVal || "");
    }
    function planAppliesToCohort(p, cohort) {
      if (!p.cohort || String(p.cohort).trim() === "") return true; // applies to all cohorts
      if (!cohort) return false; // plan row is cohort-specific; subject's cohort is unknown — can't confirm, so skip rather than falsely flag
      return norm(p.cohort) === norm(cohort);
    }
    function recordSatisfies(rec, p) {
      return dimMatch(p.visit, rec.visit) && dimMatch(p.period, rec.period) &&
        dimMatch(p.timepoint, rec.timepoint) && dimMatch(p.sampleType, rec.sampleType);
    }

    const subjects = [...bySubject.keys()];
    const findings = [];
    for (const subj of subjects) {
      const { cohort, records } = bySubject.get(subj);
      const applicable = plan.filter((p) => planAppliesToCohort(p, cohort));

      applicable.forEach((p) => {
        const required = (p.required || "Y").toUpperCase();
        if (required === "N") return;
        const found = records.some((rec) => recordSatisfies(rec, p));
        if (!found) {
          findings.push({
            subject: subj, cohort: cohort || "", visit: p.visit || "(any)",
            period: p.period || "", timepoint: p.timepoint || "", sampleType: p.sampleType || "(any)",
            severity: required === "Y" ? "ERROR" : required === "W" ? "WARNING" : "INFO",
            issue: "Expected sample not found",
          });
        }
      });

      const flagged = new Set();
      records.forEach((rec) => {
        const combo = [rec.visit, rec.period, rec.timepoint, rec.sampleType].map(norm).join("|");
        if (flagged.has(combo)) return;
        const covered = applicable.some((p) => recordSatisfies(rec, p));
        if (!covered) {
          flagged.add(combo);
          findings.push({
            subject: subj, cohort: cohort || "", visit: rec.visit || "", period: rec.period || "",
            timepoint: rec.timepoint || "", sampleType: rec.sampleType || "",
            severity: "INFO", issue: "Unexpected — not in sample plan",
          });
        }
      });
    }

    const rollup = new Map();
    for (const f of findings) {
      if (f.issue !== "Expected sample not found") continue;
      const k = [f.cohort, f.visit, f.period, f.timepoint, f.sampleType].join("|");
      rollup.set(k, (rollup.get(k) || 0) + 1);
    }

    return {
      subjectCount: subjects.length,
      findings,
      rollup: [...rollup.entries()].map(([k, count]) => {
        const [cohort, visit, period, timepoint, sampleType] = k.split("|");
        return { cohort, visit, period, timepoint, sampleType, subjectsMissing: count };
      }),
    };
  }

  const P21Recon = {
    normTrimUpper, normAlnumUpper, normAlnumUpperNoLeadingZeros,
    categoryForHeader, profileColumn, profileFile, computeOverlap,
    suggestKeys, reconcile, expectedSampleCheck, compareField,
    parseCalendarDate, calendarDateToEpochDay,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = P21Recon;
  else root.P21Recon = P21Recon;
})(typeof window !== "undefined" ? window : globalThis);
