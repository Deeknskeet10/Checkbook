// TEMP debug helper — safe to delete.
// Scans recent book_GenerateDistributions plugin-trace runs to debug a spurious
// Sweep Turn-In. Handles the two reasons a turn-in's FC can seem "missing":
//   (1) Continuation: one logical run = MANY plugin invocations (each ~105s,
//       each its own trace row). The creating invocation may be far down the list.
//   (2) Source truncation: a huge messageblock is capped by Dataverse when written.
//
// HOW TO RUN:
//   1. Open any model-driven app page in the Checkbook environment.
//   2. F12 -> Console.
//   3. Paste the FC GUID into FC_GUID below, then paste this whole block + Enter.
//
// It prints, per run: length + a truncation flag, every "Dest FC=<yourguid>" hit
// with context, and EVERY "Created Sweep Turn-In" line paired with the nearest
// preceding "Dest FC=" line (so you can see which FC each sweep belongs to, even
// if it isn't your GUID).

(async () => {
  // ─── paste the Fund Center GUID here (dashes ok, braces/case don't matter) ───
  const FC_GUID = "00000000-0000-0000-0000-000000000000";
  const RUNS    = 40;   // how many recent GenerateDistributions invocations to scan
  const CONTEXT = 2;    // lines of context around each FC hit
  // ─────────────────────────────────────────────────────────────────────────────

  const needle = FC_GUID.replace(/[{}]/g, "").trim().toLowerCase();

  const r = await Xrm.WebApi.retrieveMultipleRecords(
    "plugintracelog",
    "?$select=createdon,typename,messagename,messageblock,exceptiondetails," +
    "performanceexecutionduration" +
    "&$filter=contains(typename,'GenerateDistributions')" +
    "&$orderby=createdon desc&$top=" + RUNS
  );

  if (!r.entities.length) { console.warn("No GenerateDistributions trace logs found."); return; }
  console.log(`%cScanned ${r.entities.length} invocation(s). Searching for FC ${needle}`,
              "font-weight:bold");

  const nearestDestFcAbove = (lines, idx) => {
    for (let j = idx; j >= 0; j--) if (/Dest FC=/i.test(lines[j])) return lines[j].trim();
    return "(no Dest FC line above — likely truncated)";
  };

  let totalFcHits = 0, totalSweeps = 0;

  r.entities.forEach((log, i) => {
    const block = log.messageblock || "";
    const lines = block.split(/\r?\n/);
    const len   = block.length;

    const hits       = lines.reduce((a, ln, idx) => (ln.toLowerCase().includes(needle) && a.push(idx), a), []);
    const sweepIdxs  = lines.reduce((a, ln, idx) => (/Created Sweep Turn-In/i.test(ln) && a.push(idx), a), []);
    const warnings   = lines.filter(l => /WARNING/i.test(l));
    // Heuristic: real runs end with a WriteOutputs-ish tail; a block that ends
    // mid-line (no trailing newline, very long) is a truncation suspect.
    const truncSuspect = len > 90000 || (block.length && !/\n\s*$/.test(block) && lines[lines.length - 1].length > 40);

    totalFcHits += hits.length;
    totalSweeps += sweepIdxs.length;

    // Skip totally-irrelevant runs to keep the console readable.
    if (!hits.length && !sweepIdxs.length && !warnings.length && !log.exceptiondetails) return;

    console.group(
      `%c[${i}] ${new Date(log.createdon).toLocaleString()} · ${log.performanceexecutionduration}ms · ` +
      `len=${len}${truncSuspect ? " ⚠TRUNC?" : ""} · FC hits=${hits.length} · sweeps=${sweepIdxs.length}`,
      "font-weight:bold"
    );

    if (log.exceptiondetails) {
      console.log("%cEXCEPTION:", "color:#c00;font-weight:bold");
      console.log(log.exceptiondetails);
    }
    if (warnings.length) {
      console.log("%cPhase 2/3 WARNING line(s):", "color:#c60;font-weight:bold");
      warnings.forEach(w => console.log("  " + w.trim()));
    }

    // Your FC's Dest lines, with context.
    if (hits.length) {
      console.log("%c── FC matches ──", "color:#08f;font-weight:bold");
      const shown = new Set();
      hits.forEach(idx => {
        const s = Math.max(0, idx - CONTEXT), e = Math.min(lines.length - 1, idx + CONTEXT);
        for (let j = s; j <= e; j++) {
          if (shown.has(j)) continue; shown.add(j);
          console.log((j === idx ? "%c→ " : "%c  ") + lines[j],
                      j === idx ? "color:#08f;font-weight:bold" : "color:inherit");
        }
        console.log("%c" + "─".repeat(30), "color:#ccc");
      });
    }

    // EVERY sweep created in this invocation, tied to its FC (via the Dest line above).
    if (sweepIdxs.length) {
      console.log("%c── Sweep Turn-Ins created in this invocation ──", "color:#a0a;font-weight:bold");
      sweepIdxs.forEach(idx => {
        console.log("%cFC: " + nearestDestFcAbove(lines, idx), "color:#a0a");
        console.log("     " + lines[idx].trim());
      });
    }

    if (truncSuspect) console.log("%c…tail: " + block.slice(-160).replace(/\s+/g, " "), "color:#888");
    console.groupEnd();
  });

  console.log(`%cDone. Total across scanned invocations — FC hits: ${totalFcHits}, sweeps created: ${totalSweeps}.`,
              "color:#080;font-weight:bold");
  if (!totalFcHits) {
    console.log("%cFC still not found across " + r.entities.length + " invocations. Next: bump RUNS higher, " +
                "or re-run book_GenerateDistributions scoped (FundingType=0 + the specific FiscalYear) to shrink " +
                "the trace so Nebraska's group survives, then re-run this.", "color:#c60");
  }
})();
