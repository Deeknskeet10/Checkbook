// Command-bar entry point for the book_GenerateDistributions Custom API.
// Register as JScript web resource "book_generateDistributions" and point the
// modern command's Run JavaScript action at: DistributionGenerator.run
//
// Parameters from the command bar (in order):
//   1. PrimaryControl (required — refreshed after the API completes)
//   2. FundingType Integer (optional)
//      • Pass nothing / -1 → user is prompted to pick AFP / Allotment / Both
//      • 0 → AFP only      (skips the prompt)
//      • 1 → Allotment only
//      • 2 → Both          (omit FundingType in the request payload)
//   3. FiscalYear Integer (optional)
//      • Pass nothing / 0 → no FY filter (process all FYs)
//      • Otherwise → option-set value on book_fund.book_fiscalyear (e.g. FY26).
//
// The Custom API step MUST be registered Sync — the loop reads ContinuationToken
// from each response to decide whether to call again. Async runs don't return a
// body to the JS caller. Each plugin invocation self-budgets to ~105s of the
// 120s sandbox ceiling and returns a token when more work remains; the loop
// keeps calling until the token comes back empty.
var DistributionGenerator = (function () {
  "use strict";

  var FUNDING_TYPE_AFP = 0;
  var FUNDING_TYPE_ALLOTMENT = 1;
  var FUNDING_TYPE_BOTH = 2;

  // Safety cap on continuation loop iterations. With ~105s budget per call,
  // 60 passes ≈ 100 minutes of cumulative server work — far past any real
  // workload. If we hit this, something is wrong (infinite loop, bad data).
  var MAX_PASSES = 60;

  function run(primaryControl, fundingTypeOptionValue, fiscalYearOptionValue) {
    var fiscalYear = normalizeFiscalYear(fiscalYearOptionValue);
    var preset = normalizePreset(fundingTypeOptionValue);
    if (preset !== null) {
      confirmAndExecute(primaryControl, preset.value, preset.label, fiscalYear);
      return;
    }

    promptForFundingType().then(
      function (choice) {
        if (!choice) return;
        confirmAndExecute(primaryControl, choice.value, choice.label, fiscalYear);
      },
      handleError
    );
  }

  function normalizePreset(raw) {
    if (typeof raw !== "number") return null;
    if (raw === FUNDING_TYPE_AFP) return { value: FUNDING_TYPE_AFP, label: "AFP only" };
    if (raw === FUNDING_TYPE_ALLOTMENT) return { value: FUNDING_TYPE_ALLOTMENT, label: "Allotment only" };
    if (raw === FUNDING_TYPE_BOTH) return { value: FUNDING_TYPE_BOTH, label: "Both AFP and Allotment" };
    return null;
  }

  function normalizeFiscalYear(raw) {
    if (typeof raw !== "number" || raw <= 0) return null;
    return raw;
  }

  // Resolves to { value, label } or null on cancel/invalid.
  function promptForFundingType() {
    return new Promise(function (resolve) {
      var raw = window.prompt(
        "Generate Distributions — choose a Funding Type:\n\n" +
          "0. Both AFP and Allotment (default)\n" +
          "1. AFP only\n" +
          "2. Allotment only\n\n" +
          "Enter a number from the list above:",
        "0"
      );
      if (raw === null) {
        resolve(null);
        return;
      }
      var n = parseInt(raw, 10);
      if (n === 0) resolve({ value: FUNDING_TYPE_BOTH, label: "Both AFP and Allotment" });
      else if (n === 1) resolve({ value: FUNDING_TYPE_AFP, label: "AFP only" });
      else if (n === 2) resolve({ value: FUNDING_TYPE_ALLOTMENT, label: "Allotment only" });
      else {
        Xrm.Navigation.openAlertDialog({ text: "Invalid selection: '" + raw + "'." });
        resolve(null);
      }
    });
  }

  function confirmAndExecute(primaryControl, fundingType, fundingTypeLabel, fiscalYear) {
    var fyLabel = fiscalYear ? "FY=" + fiscalYear : "all FYs";
    Xrm.Navigation.openConfirmDialog(
      {
        title: "Generate Distributions",
        text:
          "Generate Distributions for " + fundingTypeLabel + " (" + fyLabel + ")?\n\n" +
          "This will:\n" +
          "  • Deactivate active Distributions not yet entered into GFEBS.\n" +
          "  • Create debit/credit Distribution pairs to reach the target funded amount.\n" +
          "  • Create overage Turn-Ins where existing credits exceed the target " +
          "(unless an open Turn-In already exists for that bucket).\n\n" +
          "The job runs in passes of up to ~2 minutes each. Leave the window " +
          "open until you see the completion dialog."
      },
      { height: 360, width: 540 }
    ).then(function (result) {
      if (!result || !result.confirmed) return;
      execute(primaryControl, fundingType, fiscalYear);
    });
  }

  // Pump the Custom API in a continuation loop. Each call returns a
  // ContinuationToken; loop until it comes back empty.
  function execute(primaryControl, fundingType, fiscalYear) {
    var totals = { Deactivated: 0, Created: 0, TurnInsCreated: 0, Skipped: 0 };
    var passes = 0;
    showProgress(passes, totals);

    function pumpOnce(token) {
      return Xrm.WebApi.online.execute(buildRequest(fundingType, fiscalYear, token))
        .then(function (response) {
          if (!response.ok && response.status !== 204) {
            return Promise.reject(new Error("Custom API returned HTTP " + response.status));
          }
          return response.status === 204 ? {} : response.json();
        })
        .then(function (body) {
          totals.Deactivated    += body.Deactivated    || 0;
          totals.Created        += body.Created        || 0;
          totals.TurnInsCreated += body.TurnInsCreated || 0;
          totals.Skipped        += body.Skipped        || 0;
          passes++;
          showProgress(passes, totals);

          var nextToken = body.ContinuationToken || "";
          if (!nextToken) return; // done
          if (passes >= MAX_PASSES) {
            return Promise.reject(new Error(
              "Stopped after " + passes + " passes (safety cap). Last token: " + nextToken
            ));
          }
          return pumpOnce(nextToken);
        });
    }

    pumpOnce("").then(
      function () {
        Xrm.Utility.closeProgressIndicator();
        showCompleted(primaryControl, totals, passes);
      },
      function (error) {
        Xrm.Utility.closeProgressIndicator();
        handleError(error);
      }
    );
  }

  function showProgress(passes, totals) {
    Xrm.Utility.showProgressIndicator(
      "Generating Distributions — pass " + (passes + 1) + "\n\n" +
      "Deactivated: " + totals.Deactivated + "\n" +
      "Created (debits + credits): " + totals.Created + "\n" +
      "Turn-Ins created: " + totals.TurnInsCreated + "\n" +
      "Skipped (no FundingDetails): " + totals.Skipped
    );
  }

  // FundingType = 2 → omit the param so the plugin processes both.
  // fiscalYear null/0 → omit FY (all FYs).
  // token empty → omit ContinuationToken (fresh start).
  function buildRequest(fundingType, fiscalYear, continuationToken) {
    var includeFundingType =
      fundingType === FUNDING_TYPE_AFP || fundingType === FUNDING_TYPE_ALLOTMENT;
    var includeFy = !!fiscalYear;
    var includeToken = !!continuationToken;

    var req = {
      getMetadata: function () {
        var parameterTypes = {};
        if (includeFundingType) {
          parameterTypes.FundingType = { typeName: "Edm.Int32", structuralProperty: 1 };
        }
        if (includeFy) {
          parameterTypes.FiscalYear = { typeName: "Edm.Int32", structuralProperty: 1 };
        }
        if (includeToken) {
          parameterTypes.ContinuationToken = { typeName: "Edm.String", structuralProperty: 1 };
        }
        return {
          boundParameter: null,
          operationType: 0, // 0 = Action, 1 = Function, 2 = CRUD
          operationName: "book_GenerateDistributions",
          parameterTypes: parameterTypes
        };
      }
    };

    if (includeFundingType) req.FundingType = fundingType;
    if (includeFy)          req.FiscalYear  = fiscalYear;
    if (includeToken)       req.ContinuationToken = continuationToken;

    return req;
  }

  function showCompleted(primaryControl, totals, passes) {
    Xrm.Navigation.openAlertDialog({
      text:
        "Distribution generation complete (" + passes + " pass" + (passes === 1 ? "" : "es") + ").\n\n" +
        "Deactivated: " + totals.Deactivated + "\n" +
        "Created (debits + credits): " + totals.Created + "\n" +
        "Turn-Ins created: " + totals.TurnInsCreated + "\n" +
        "Skipped (no FundingDetails): " + totals.Skipped
    }).then(function () {
      if (primaryControl && typeof primaryControl.refresh === "function") {
        primaryControl.refresh();
      }
    });
  }

  function handleError(error) {
    Xrm.Utility.closeProgressIndicator();
    var message = (error && (error.message || error.toString())) || "Unknown error.";
    Xrm.Navigation.openErrorDialog({
      message: "Distribution generation failed.",
      details: message
    });
  }

  return {
    run: run
  };
})();
