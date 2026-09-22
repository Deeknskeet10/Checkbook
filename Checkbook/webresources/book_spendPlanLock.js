// Command-bar entry point for the book_ToggleSpendPlanLock Custom API.
// Register as JScript web resource "book_spendPlanLock" and point the modern
// command's Run JavaScript action at: SpendPlanLock.run
//
// Parameters from the command bar (in order):
//   1. PrimaryControl (required — refreshed after the toggle completes)
//
// One static button ("Spend Plan Lock") — command bar labels cannot be
// dynamic, so the current state is surfaced in a confirm dialog before
// flipping and an alert after. The Custom API creates the environment-variable
// value record on first use, so a missing value record simply reads as
// unlocked here. Mirrors book_fundedAmountLock.js.
var SpendPlanLock = (function () {
  "use strict";

  var ENV_VAR_SCHEMA = "book_LockSpendPlanEdits";

  function run(primaryControl) {
    readCurrentState().then(
      function (isLocked) {
        confirmAndToggle(primaryControl, isLocked);
      },
      function (error) {
        // State read is cosmetic (confirm-dialog text only) — still allow the
        // toggle, the Custom API response is the source of truth.
        confirmAndToggle(primaryControl, null);
      }
    );
  }

  // Resolves true/false, or rejects if the definition cannot be read.
  // No value record yet → falls back to the definition default.
  function readCurrentState() {
    return Xrm.WebApi.retrieveMultipleRecords(
      "environmentvariabledefinition",
      "?$select=defaultvalue&$filter=schemaname eq '" + ENV_VAR_SCHEMA + "'" +
        "&$expand=environmentvariabledefinition_environmentvariablevalue($select=value)"
    ).then(function (result) {
      if (!result.entities.length) {
        return Promise.reject(new Error(
          "Environment variable '" + ENV_VAR_SCHEMA + "' not found."
        ));
      }
      var def = result.entities[0];
      var values = def.environmentvariabledefinition_environmentvariablevalue || [];
      var raw = values.length ? values[0].value : def.defaultvalue;
      return parseBool(raw);
    });
  }

  function parseBool(raw) {
    if (typeof raw !== "string") return false;
    var v = raw.trim().toLowerCase();
    return v === "true" || v === "yes" || v === "1";
  }

  function confirmAndToggle(primaryControl, isLocked) {
    var text;
    if (isLocked === true) {
      text =
        "Spend plan editing is currently LOCKED.\n\n" +
        "Unlock to allow users to edit spend plans again?";
    } else if (isLocked === false) {
      text =
        "Spend plan editing is currently UNLOCKED.\n\n" +
        "Lock all spend plans so users cannot create, change, or delete " +
        "planning rows? Automated roll-ups and the Actual process keep running.";
    } else {
      text =
        "Could not read the current lock state.\n\n" +
        "Toggle the Spend Plan lock anyway?";
    }

    Xrm.Navigation.openConfirmDialog(
      { title: "Spend Plan Lock", text: text },
      { height: 240, width: 480 }
    ).then(function (result) {
      if (!result || !result.confirmed) return;
      execute(primaryControl);
    });
  }

  function execute(primaryControl) {
    Xrm.Utility.showProgressIndicator("Toggling the Spend Plan lock…");
    Xrm.WebApi.online.execute(buildRequest())
      .then(function (response) {
        if (!response.ok && response.status !== 204) {
          return Promise.reject(new Error("Custom API returned HTTP " + response.status));
        }
        return response.status === 204 ? {} : response.json();
      })
      .then(function (body) {
        Xrm.Utility.closeProgressIndicator();
        showCompleted(primaryControl, body.IsLocked === true);
      })
      .catch(function (error) {
        Xrm.Utility.closeProgressIndicator();
        handleError(error);
      });
  }

  function buildRequest() {
    return {
      getMetadata: function () {
        return {
          boundParameter: null,
          operationType: 0, // 0 = Action, 1 = Function, 2 = CRUD
          operationName: "book_ToggleSpendPlanLock",
          parameterTypes: {}
        };
      }
    };
  }

  function showCompleted(primaryControl, isLocked) {
    Xrm.Navigation.openAlertDialog({
      text: isLocked
        ? "Spend plans are now LOCKED.\n\nUsers cannot create, change, or " +
          "delete planning rows until an administrator unlocks them."
        : "Spend plans are now UNLOCKED.\n\nUsers can edit spend plans again."
    }).then(function () {
      if (primaryControl && typeof primaryControl.refresh === "function") {
        primaryControl.refresh();
      }
    });
  }

  function handleError(error) {
    var message = (error && (error.message || error.toString())) || "Unknown error.";
    Xrm.Navigation.openErrorDialog({
      message: "Spend plan lock toggle failed.",
      details: message
    });
  }

  return {
    run: run
  };
})();
