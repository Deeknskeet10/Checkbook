// TEMP debug helper — safe to delete.
// Pulls the last N GenerateDistributions plugin-trace runs and prints every
// trace line mentioning a given Fund Center GUID, with surrounding context.
//
// HOW TO RUN:
//   1. Open any model-driven app page in the Checkbook environment.
//   2. F12 → Console.
//   3. Paste the FC GUID into FC_GUID below, then paste this whole block and Enter.
//
// The "→" lines are the FC matches. On a Dest-FC line, read pct / target /
// immutableNet / delta:  delta=-$... means an overage Sweep Turn-In was created.

(async () => {
  // ─── paste the Fund Center GUID here (dashes ok, braces/case don't matter) ───
  const FC_GUID   = "00000000-0000-0000-0000-000000000000";
  const RUNS      = 5;   // how many recent GenerateDistributions executions to scan
  const CONTEXT   = 2;   // lines of context to show before/after each hit
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

  r.entities.forEach((log, i) => {
    const block = log.messageblock || "";
    const lines = block.split(/\r?\n/);

    // indexes of lines that mention the FC guid
    const hits = lines.reduce((acc, ln, idx) => {
      if (ln.toLowerCase().includes(needle)) acc.push(idx);
      return acc;
    }, []);

    const warnings = lines.filter(l => /WARNING/i.test(l));

    console.group(
      `%c[${i}] ${new Date(log.createdon).toLocaleString()}  ·  ${log.performanceexecutionduration}ms  ·  ${hits.length} FC hit(s)`,
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

    if (!hits.length) {
      console.log("(FC guid not mentioned in this run)");
    } else {
      // print each hit with surrounding context, merging overlapping windows
      const shown = new Set();
      hits.forEach(idx => {
        const start = Math.max(0, idx - CONTEXT);
        const end   = Math.min(lines.length - 1, idx + CONTEXT);
        for (let j = start; j <= end; j++) {
          if (shown.has(j)) continue;
          shown.add(j);
          const marker = j === idx ? "%c→ " : "%c  ";
          const style  = j === idx ? "color:#08f;font-weight:bold" : "color:inherit";
          console.log(marker + lines[j], style);
        }
        console.log("%c" + "─".repeat(40), "color:#ccc");
      });
    }

    console.groupEnd();
  });

  console.log("%cDone. Tip: the '→' lines are the FC matches; look for 'delta=-' = an overage turn-in.",
              "color:#080");
})();
