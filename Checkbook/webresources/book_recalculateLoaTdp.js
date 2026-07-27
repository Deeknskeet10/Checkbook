// Command-bar entry point for the book_RecalculateLOATDP Custom API.
// Register as JScript web resource "book_recalculateLoaTdp" and point the
// modern command's Run JavaScript action at: LoaTdpReconciler.run
//
// Use this after a bulk Funding Track load (Edit-in-Excel / Import Wizard),
// which writes rows at Depth 2 where FundingTrackTDPRecalculator skips the
// roll-up — so imported Beginning Balances never reach LOA TDP until this runs.
//
// Parameters from the command bar (in order):
//   1. PrimaryControl (required — refreshed after the API completes)
//   2. FiscalYear Integer (optional)
//      • Pass nothing / 0 → no FY filter (reconcile all FYs)
//      • Otherwise → option-set value on book_fundingline.book_fiscalyear (e.g. FY26).
//   3. BatchSize Integer (optional)
//      • Pass nothing / <=0 → default of 200 LOAs per pass.
//      • The loop pages through with this size until HasMore comes back false,
//        so each server call stays well under the 120s sync-sandbox ceiling.
//
// The Custom API step MUST be registered Sync — the loop reads HasMore from
// each response to decide whether to call again. Async runs don't return a
// body to the JS caller (use Async only for fire-and-forget from a flow).
var LoaTdpReconciler = (function () {
  "use strict";

  var DEFAULT_BATCH_SIZE = 200;

  // Safety cap on the paging loop. 500 passes × 200 = 100k LOAs — far past any
  // real workload. Hitting this means something is wrong (bad paging, loop).
  var MAX_PASSES = 500;

  function run(primaryControl, fiscalYearOptionValue, batchSizeRaw) {
    var fiscalYear = normalizeFiscalYear(fiscalYearOptionValue);
    var batchSize = normalizeBatchSize(batchSizeRaw);
    confirmAndExecute(primaryControl, fiscalYear, batchSize);
  }

  function normalizeFiscalYear(raw) {
    if (typeof raw !== "number" || raw <= 0) return null;
    return raw;
  }

  function normalizeBatchSize(raw) {
    if (typeof raw !== "number" || raw <= 0) return DEFAULT_BATCH_SIZE;
    return raw;
  }

  function confirmAndExecute(primaryControl, fiscalYear, batchSize) {
    var fyLabel = fiscalYear ? "FY=" + fiscalYear : "all FYs";
    Xrm.Navigation.openConfirmDialog(
      {
        title: "Reconcile LOA TDP",
        text:
          "Recalculate TDP for every active LOA (" + fyLabel + ")?\n\n" +
          "Each LOA's TDP is recomputed from scratch as " +
          "Σ active Funding Track Resource Amount + Ledger net. The recompute " +
          "is idempotent, so this is always safe to run.\n\n" +
          "The job runs in pages of " + batchSize + " LOAs. Leave the window " +
          "open until you see the completion dialog."
      },
      { height: 320, width: 520 }
    ).then(function (result) {
      if (!result || !result.confirmed) return;
      execute(primaryControl, fiscalYear, batchSize);
    });
  }

  // Page the Custom API until HasMore comes back false, accumulating Processed.
  function execute(primaryControl, fiscalYear, batchSize) {
    var totals = { Processed: 0, TotalInScope: 0 };
    var pageNumber = 1;
    var passes = 0;
    showProgress(passes, totals);

    function pumpOnce(page) {
      return Xrm.WebApi.online.execute(buildRequest(fiscalYear, batchSize, page))
        .then(function (response) {
          if (!response.ok && response.status !== 204) {
            return Promise.reject(new Error("Custom API returned HTTP " + response.status));
          }
          return response.status === 204 ? {} : response.json();
        })
        .then(function (body) {
          totals.Processed += body.Processed || 0;
          totals.TotalInScope = body.TotalInScope || totals.TotalInScope;
          passes++;
          showProgress(passes, totals);

          if (!body.HasMore) return; // done
          if (passes >= MAX_PASSES) {
            return Promise.reject(new Error(
              "Stopped after " + passes + " passes (safety cap). Processed " +
              totals.Processed + " of " + totals.TotalInScope + "."
            ));
          }
          return pumpOnce(page + 1);
        });
    }

    pumpOnce(pageNumber).then(
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
    // showProgressIndicator renders a single text run — \n is not honored.
    Xrm.Utility.showProgressIndicator(
      "Reconciling LOA TDP (pass " + (passes + 1) + ")  •  " +
      "Processed " + totals.Processed +
      (totals.TotalInScope ? " of " + totals.TotalInScope : "")
    );
  }

  // fiscalYear null/0 → omit FiscalYear (all FYs).
  function buildRequest(fiscalYear, batchSize, pageNumber) {
    var includeFy = !!fiscalYear;

    var req = {
      getMetadata: function () {
        var parameterTypes = {
          BatchSize:  { typeName: "Edm.Int32", structuralProperty: 1 },
          PageNumber: { typeName: "Edm.Int32", structuralProperty: 1 }
        };
        if (includeFy) {
          parameterTypes.FiscalYear = { typeName: "Edm.Int32", structuralProperty: 1 };
        }
        return {
          boundParameter: null,
          operationType: 0, // 0 = Action, 1 = Function, 2 = CRUD
          operationName: "book_RecalculateLOATDP",
          parameterTypes: parameterTypes
        };
      },
      BatchSize: batchSize,
      PageNumber: pageNumber
    };

    if (includeFy) req.FiscalYear = fiscalYear;

    return req;
  }

  function showCompleted(primaryControl, totals, passes) {
    Xrm.Navigation.openAlertDialog({
      text:
        "LOA TDP reconcile complete (" + passes + " pass" + (passes === 1 ? "" : "es") + ").\n\n" +
        "LOAs reconciled: " + totals.Processed +
        (totals.TotalInScope ? " of " + totals.TotalInScope + " in scope." : ".") + "\n\n" +
        "Per-LOA failures (if any) are traced and skipped — re-run to pick them up."
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
      message: "LOA TDP reconcile failed.",
      details: message
    });
  }

  return {
    run: run
  };
})();
