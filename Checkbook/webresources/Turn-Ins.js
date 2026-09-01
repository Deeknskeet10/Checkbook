"use strict";
var Book = Book || {};
// Book.TurnIn — form behavior for the book_turnin (Turn-In header) main form.
//
// Replaces (old web resource / old global → new handler):
//   book_turnInFormBehavior   TurnInFormBehavior.onLoad          → Book.TurnIn.onLoad
//   book_turnInFormBehavior   TurnInFormBehavior.onOriginChange  → Book.TurnIn.onOriginChange
//   book_turnInFormBehavior   TurnInFormBehavior.onAmountChange  → Book.TurnIn.onAmountChange
//   book_hidePriTurnIns       (unwired, retired — no replacement)
//
// Toggles visibility/lock state based on book_origin so the same form serves
// both kinds, and stamps the AFP/Allotment manual-override flags:
//
//   • Origin = State  (0) — user-initiated Kind A. Shows the items subgrid,
//                            book_newamount (TDP), and book_identifiedturninamount.
//                            Also shows book_afpamount + book_allotmentamount
//                            EDITABLE: TurnInAmountCalculator auto-sizes them from
//                            TDP × pct, but a state may hand-edit either to return
//                            TDP without the matching AFP/Allotment. Editing an
//                            amount sets its sticky override flag so the plugin
//                            stops re-deriving it (see onAmountChange).
//   • Origin = Sweep  (1) — Kind B Turn-In auto-created by GenerateDistributions.
//                            Hides items + TDP amount + identified amount; shows
//                            book_afpamount + book_allotmentamount (read-only,
//                            owned by GenerateDistributions).
//
// Wire on the book_turnin main form (all with "Pass execution context" checked):
//   • OnLoad                            → Book.TurnIn.onLoad
//   • OnChange of book_origin           → Book.TurnIn.onOriginChange
//   • OnChange of book_afpamount        → Book.TurnIn.onAmountChange
//   • OnChange of book_allotmentamount  → Book.TurnIn.onAmountChange
//
// Form prerequisites (add these to the form first):
//   • Field controls: book_origin, book_afpamount, book_allotmentamount,
//     book_afpoverridden, book_allotmentoverridden
//     (the script no-ops gracefully if a control/attribute is missing)
//   • The items subgrid lives in section "_section_541" of tab "general"; if
//     that section name changes in the form designer, update ITEMS_SECTION.
//   • book_beapproved / book_stateapproved are Column-Level-Security masked
//     columns on this form. onLoad tolerates the "masking feature is not ready"
//     error their async init throws by retrying the origin layout (see below).
Book.TurnIn = (function () {

  var ORIGIN_STATE = 0;
  var ORIGIN_SWEEP = 1;

  // Tab + section names from the main form XML. If the form is restructured
  // these need to be updated to match.
  var GENERAL_TAB = "general";
  var ITEMS_SECTION = "_section_541";

  // Column-Level-Security masking (on book_beapproved / book_stateapproved,
  // the two secured approval flags on this form) initializes asynchronously
  // AFTER OnLoad fires. Any attribute .getValue() during that window — even on
  // an unsecured column like book_origin — throws "Column level security masking
  // feature is not ready". So origin-driven layout is applied on a bounded retry
  // until masking settles, rather than synchronously in onLoad.
  var MASKING_RETRY_MS = 150;
  var MASKING_MAX_RETRIES = 20; // ~3s ceiling; readiness is effectively immediate

  // Field/control ids that toggle with origin.
  var KIND_A_CONTROLS = [
    "book_newamount",
    "book_identifiedturninamount",
    "book_turnindetails"
  ];
  // AFP/Allotment amount controls — shown for both kinds, but only editable on
  // Kind A (State). On Kind B (Sweep) they are read-only outputs.
  var AMOUNT_CONTROLS = [
    "book_afpamount",
    "book_allotmentamount"
  ];

  // Maps each editable amount to its sticky manual-override flag. Hand-editing
  // the amount sets the flag so TurnInAmountCalculator stops auto-deriving it.
  var AMOUNT_TO_FLAG = {
    "book_afpamount": "book_afpoverridden",
    "book_allotmentamount": "book_allotmentoverridden"
  };

  function onLoad(executionContext) {
    var formContext = executionContext.getFormContext();
    // lockOrigin only touches controls (no getValue) so it's masking-safe now.
    lockOrigin(formContext);
    // applyForOrigin reads book_origin.getValue(), which can throw while CLS
    // masking is still initializing — apply it once masking is ready.
    applyForOriginWhenReady(formContext, 0);
  }

  // Runs applyForOrigin, retrying on the CLS "masking feature is not ready"
  // error until masking settles. Any other error propagates immediately.
  function applyForOriginWhenReady(formContext, attempt) {
    try {
      applyForOrigin(formContext);
    } catch (e) {
      if (isMaskingNotReady(e) && attempt < MASKING_MAX_RETRIES) {
        setTimeout(function () {
          applyForOriginWhenReady(formContext, attempt + 1);
        }, MASKING_RETRY_MS);
        return;
      }
      // Masking never settled (pathological) — degrade quietly rather than
      // surfacing the error popup; the form still works, just without
      // origin-based field toggling. Non-masking errors still throw.
      if (!isMaskingNotReady(e)) throw e;
    }
  }

  function isMaskingNotReady(e) {
    var msg = e && e.message ? e.message : String(e);
    return msg.indexOf("masking feature is not ready") !== -1;
  }

  function onOriginChange(executionContext) {
    applyForOrigin(executionContext.getFormContext());
  }

  // OnChange handler shared by book_afpamount and book_allotmentamount. When a
  // state hand-edits an amount, set its override flag so the pre-op calculator
  // treats the value as authoritative and never re-derives it (e.g. on a later
  // TDP change). Clearing the flag (Yes/No field on the form) resumes auto-sizing.
  function onAmountChange(executionContext) {
    var formContext = executionContext.getFormContext();

    // Only meaningful on Kind A — on a Sweep the amounts are disabled and owned
    // by GenerateDistributions, so never stamp an override there.
    if (getOrigin(formContext) === ORIGIN_SWEEP) return;

    var src = executionContext.getEventSource();
    var amountName = src && typeof src.getName === "function" ? src.getName() : null;
    var flagName = amountName ? AMOUNT_TO_FLAG[amountName] : null;
    if (!flagName) return;

    var flagAttr = formContext.getAttribute(flagName);
    if (flagAttr && flagAttr.getValue() !== true) {
      flagAttr.setValue(true);
    }
  }

  function applyForOrigin(formContext) {
    var origin = getOrigin(formContext);
    var isSweep = origin === ORIGIN_SWEEP;

    setControlsVisible(formContext, KIND_A_CONTROLS, !isSweep);
    setControlsVisible(formContext, AMOUNT_CONTROLS, true);
    setItemsSectionVisible(formContext, !isSweep);

    // AFP/Allotment on a Sweep are authoritative outputs of GenerateDistributions —
    // user must not edit them. On Kind A they are editable so a state can override.
    setControlsDisabled(formContext, AMOUNT_CONTROLS, isSweep);
  }

  function getOrigin(formContext) {
    var attr = formContext.getAttribute("book_origin");
    if (!attr) return null;
    var v = attr.getValue();
    return v === null || v === undefined ? null : v;
  }

  function lockOrigin(formContext) {
    // Origin distinguishes the two workflows — flipping it after create would
    // silently change which fields the rest of the system trusts. Always read-only.
    var ctrl = formContext.getControl("book_origin");
    if (ctrl && typeof ctrl.setDisabled === "function") {
      ctrl.setDisabled(true);
    }
  }

  function setControlsVisible(formContext, controlIds, visible) {
    for (var i = 0; i < controlIds.length; i++) {
      var ctrl = formContext.getControl(controlIds[i]);
      if (ctrl && typeof ctrl.setVisible === "function") {
        ctrl.setVisible(visible);
      }
    }
  }

  function setControlsDisabled(formContext, controlIds, disabled) {
    for (var i = 0; i < controlIds.length; i++) {
      var ctrl = formContext.getControl(controlIds[i]);
      if (ctrl && typeof ctrl.setDisabled === "function") {
        ctrl.setDisabled(disabled);
      }
    }
  }

  function setItemsSectionVisible(formContext, visible) {
    try {
      var tab = formContext.ui.tabs.get(GENERAL_TAB);
      if (!tab) return;
      var section = tab.sections.get(ITEMS_SECTION);
      if (section && typeof section.setVisible === "function") {
        section.setVisible(visible);
      }
    } catch (e) {
      // Section name changed or tab structure moved — fall back silently.
      // The subgrid's own controls aren't toggled individually because subgrids
      // are addressed via their section, not a control id.
    }
  }

  return {
    onLoad: onLoad,
    onOriginChange: onOriginChange,
    onAmountChange: onAmountChange
  };
})();
