// Command-bar entry point for the book_GenerateLOAs Custom API.
// Register as JScript web resource "book_generateLOAs" and point the
// modern command's Run JavaScript action at: LOAGenerator.run
//
// Parameters from the command bar (in order):
//   1. PrimaryControl (required — refreshed after the API completes)
//   2. FiscalYear option-set value (optional Integer)
//      • Pass nothing or 0  → user is prompted to pick the FY (or All)
//      • Pass a specific FY option value (e.g. 100000000) → skip the prompt
//        and run for that FY directly. Useful if you'd rather have one
//        button per FY than a runtime picker.
var LOAGenerator = (function () {
  "use strict";

  var FUND_ENTITY = "book_fund";
  var FUND_FY_ATTRIBUTE = "book_fiscalyear";

  // FTs attempted per Custom API invocation. Chosen to stay well under the
  // 2-minute sync sandbox limit on production data: each FT triggers the
  // PostOp FundingTrackTDPRecalculator (~5 calls) plus the link itself, so
  // ~200/batch is conservative. Tune here if the env is noticeably faster/slower.
  var BATCH_SIZE = 200;

  function run(primaryControl, fiscalYearOptionValue) {
    if (typeof fiscalYearOptionValue === "number" && fiscalYearOptionValue > 0) {
      confirmAndExecute(primaryControl, fiscalYearOptionValue, "FY (option value " + fiscalYearOptionValue + ")");
      return;
    }

    promptForFiscalYear().then(
      function (choice) {
        if (!choice) return;
        confirmAndExecute(primaryControl, choice.value, choice.label);
      },
      handleError
    );
  }

  // Returns a promise that resolves to { value: int, label: string } or null if cancelled.
  function promptForFiscalYear() {
    return fetchFundFiscalYearOptions().then(function (options) {
      if (!options || options.length === 0) {
        return { value: 0, label: "All fiscal years (no FY options found)" };
      }

      // 0 = All, then 1..N for individual FY choices.
      var menuLines = ["0. All fiscal years"];
      for (var i = 0; i < options.length; i++) {
        menuLines.push(i + 1 + ". " + options[i].label);
      }

      var raw = window.prompt(
        "Generate LOAs — choose a fiscal year:\n\n" +
          menuLines.join("\n") +
          "\n\nEnter a number from the list above:",
        "0"
      );
      if (raw === null) return null; // cancelled

      var n = parseInt(raw, 10);
      if (isNaN(n) || n < 0 || n > options.length) {
        Xrm.Navigation.openAlertDialog({ text: "Invalid selection: '" + raw + "'." });
        return null;
      }
      if (n === 0) return { value: 0, label: "All fiscal years" };
      return options[n - 1];
    });
  }

  // GETs the Fund.book_fiscalyear option set via metadata.
  // Resolves to [{ value: int, label: string }, ...] sorted descending so the
  // newest FY appears at the top of the picker.
  function fetchFundFiscalYearOptions() {
    var url =
      "/api/data/v9.2/EntityDefinitions(LogicalName='" + FUND_ENTITY + "')" +
      "/Attributes(LogicalName='" + FUND_FY_ATTRIBUTE + "')" +
      "/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet";

    return new Promise(function (resolve, reject) {
      var req = new XMLHttpRequest();
      req.open("GET", Xrm.Utility.getGlobalContext().getClientUrl() + url, true);
      req.setRequestHeader("OData-MaxVersion", "4.0");
      req.setRequestHeader("OData-Version", "4.0");
      req.setRequestHeader("Accept", "application/json");
      req.onreadystatechange = function () {
        if (req.readyState !== 4) return;
        if (req.status >= 200 && req.status < 300) {
          try {
            var body = JSON.parse(req.responseText);
            var rawOptions = (body.OptionSet && body.OptionSet.Options) || [];
            var mapped = rawOptions
              .map(function (o) {
                return {
                  value: o.Value,
                  label: (o.Label && o.Label.UserLocalizedLabel && o.Label.UserLocalizedLabel.Label) || String(o.Value)
                };
              })
              .sort(function (a, b) {
                return b.value - a.value;
              });
            resolve(mapped);
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error("FY option-set fetch failed: HTTP " + req.status));
        }
      };
      req.onerror = function () {
        reject(new Error("FY option-set fetch network error."));
      };
      req.send();
    });
  }

  function confirmAndExecute(primaryControl, fiscalYear, fiscalYearLabel) {
    var scope =
      fiscalYear > 0
        ? "limited to " + fiscalYearLabel
        : "across every fiscal year";

    Xrm.Navigation.openConfirmDialog(
      {
        title: "Generate LOAs",
        text:
          "Generate Lines of Accounting for every Funding Track that is " +
          "not yet linked to an LOA, " + scope + "?\n\n" +
          "This will create new LOAs where no match exists, link Funding " +
          "Tracks to existing LOAs where a match is found, and skip any " +
          "Funding Tracks that are missing required fields."
      },
      { height: 260, width: 480 }
    ).then(function (result) {
      if (!result || !result.confirmed) return;
      execute(primaryControl, fiscalYear);
    });
  }

  function execute(primaryControl, fiscalYear) {
    Xrm.Utility.showProgressIndicator("Generating LOAs…");

    // Aggregates across all batches in this run.
    var totals = {
      created: 0,
      linked: 0,
      skipped: 0,
      failed: 0,
      failedDetails: []
    };
    // Captured from the first batch's Remaining so we can render "X of Y" progress.
    // Remaining shrinks each batch as FTs get linked, but FTs that are skipped or
    // failed stay in the unlinked pool and continue to count toward Remaining.
    var totalToProcess = null;

    runBatch();

    function runBatch() {
      Xrm.WebApi.online.execute(buildRequest(fiscalYear, BATCH_SIZE)).then(
        function (response) {
          if (!response.ok) {
            handleError(new Error("Custom API returned HTTP " + response.status));
            return;
          }
          response.json().then(
            function (body) {
              var batchCreated = (body && body.Created) || 0;
              var batchLinked  = (body && body.Linked)  || 0;
              var batchSkipped = (body && body.Skipped) || 0;
              var batchFailed  = (body && body.Failed)  || 0;
              var remaining    = (body && body.Remaining) || 0;
              var batchDetails = (body && body.FailedDetails) || "";

              totals.created += batchCreated;
              totals.linked  += batchLinked;
              totals.skipped += batchSkipped;
              totals.failed  += batchFailed;
              if (batchDetails) {
                batchDetails.split(";").forEach(function (entry) {
                  var trimmed = entry.trim();
                  if (trimmed) totals.failedDetails.push(trimmed);
                });
              }

              if (totalToProcess === null) {
                // First batch — Remaining now is "left over after this batch";
                // total in scope = what we processed + what's left.
                totalToProcess = (batchCreated + batchLinked + batchSkipped + batchFailed) + remaining;
              }

              // Stop when nothing's left, or when this batch made no forward
              // progress (Created+Linked == 0 means everything attempted was
              // skipped or failed — the same FTs will keep being re-fetched).
              var madeProgress = (batchCreated + batchLinked) > 0;
              if (remaining === 0 || !madeProgress) {
                Xrm.Utility.closeProgressIndicator();
                showResult(totals, remaining, primaryControl);
                return;
              }

              var processed = totalToProcess - remaining;
              Xrm.Utility.showProgressIndicator(
                "Generating LOAs… " + processed + " of " + totalToProcess + " processed."
              );
              runBatch();
            },
            handleError
          );
        },
        handleError
      );
    }
  }

  // FiscalYear = 0 → process all FYs. BatchSize > 0 → process at most that
  // many FTs this call and return Remaining so the caller can loop.
  function buildRequest(fiscalYear, batchSize) {
    return {
      FiscalYear: fiscalYear,
      BatchSize: batchSize,
      getMetadata: function () {
        return {
          boundParameter: null,
          operationType: 0, // 0 = Action, 1 = Function, 2 = CRUD
          operationName: "book_GenerateLOAs",
          parameterTypes: {
            FiscalYear: { typeName: "Edm.Int32", structuralProperty: 1 },
            BatchSize:  { typeName: "Edm.Int32", structuralProperty: 1 }
          }
        };
      }
    };
  }

  function showResult(totals, remaining, primaryControl) {
    var text =
      "LOA generation complete.\n\n" +
      "Created: " + totals.created + "\n" +
      "Linked:  " + totals.linked + "\n" +
      "Skipped: " + totals.skipped + "\n" +
      "Failed:  " + totals.failed;

    if (remaining > 0) {
      // We stopped because the last batch made no forward progress — every
      // remaining FT was either skipped or failed and would keep recycling.
      text += "\n\n" + remaining + " Funding Track(s) still unlinked " +
              "(unresolvable — see Skipped/Failed details).";
    }

    if (totals.failedDetails.length > 0) {
      // Show the first few so the alert stays readable; the rest are in the
      // plugin trace log for diagnosis.
      var preview = totals.failedDetails.slice(0, 5).join("\n  ");
      var more = totals.failedDetails.length > 5
        ? "\n  …and " + (totals.failedDetails.length - 5) + " more (see plugin trace)."
        : "";
      text += "\n\nFailed Funding Tracks:\n  " + preview + more;
    }

    Xrm.Navigation.openAlertDialog({ text: text }).then(function () {
      if (primaryControl && typeof primaryControl.refresh === "function") {
        primaryControl.refresh();
      }
    });
  }

  function handleError(error) {
    Xrm.Utility.closeProgressIndicator();
    var message = (error && (error.message || error.toString())) || "Unknown error.";
    Xrm.Navigation.openErrorDialog({
      message: "LOA generation failed.",
      details: message
    });
  }

  return {
    run: run
  };
})();
