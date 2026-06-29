// Form behavior for book_turnin. Toggles visibility/lock state based on
// book_origin so the same form serves both kinds:
//
//   • Origin = State  (0) — user-initiated Kind A. Shows the items subgrid,
//                            book_newamount (TDP), and book_identifiedturninamount.
//                            Hides the Kind B AFP/Allotment fields.
//   • Origin = Sweep  (1) — Kind B Turn-In auto-created by GenerateDistributions.
//                            Hides items + TDP amount + identified amount; shows
//                            book_afpamount + book_allotmentamount (read-only,
//                            owned by GenerateDistributions).
//
// Register as JScript web resource "book_turnInFormBehavior" and wire on the
// book_turnin main form:
//   • OnLoad             → TurnInFormBehavior.onLoad
//   • OnChange of book_origin → TurnInFormBehavior.onOriginChange
//
// Form prerequisites (add these to the form first):
//   • Field controls: book_origin, book_afpamount, book_allotmentamount
//     (the script no-ops gracefully if a control is missing)
//   • The items subgrid lives in section "_section_541" of tab "general"; if
//     that section name changes in the form designer, update ITEMS_SECTION.
var TurnInFormBehavior = (function () {
  "use strict";

  var ORIGIN_STATE = 0;
  var ORIGIN_SWEEP = 1;

  // Tab + section names from the main form XML. If the form is restructured
  // these need to be updated to match.
  var GENERAL_TAB = "general";
  var ITEMS_SECTION = "_section_541";

  // Field/control ids that toggle with origin.
  var KIND_A_CONTROLS = [
    "book_newamount",
    "book_identifiedturninamount",
    "book_turnindetails"
  ];
  var KIND_B_CONTROLS = [
    "book_afpamount",
    "book_allotmentamount"
  ];

  function onLoad(executionContext) {
    var formContext = executionContext.getFormContext();
    applyForOrigin(formContext);
    lockOrigin(formContext);
  }

  function onOriginChange(executionContext) {
    applyForOrigin(executionContext.getFormContext());
  }

  function applyForOrigin(formContext) {
    var origin = getOrigin(formContext);
    var isSweep = origin === ORIGIN_SWEEP;

    setControlsVisible(formContext, KIND_A_CONTROLS, !isSweep);
    setControlsVisible(formContext, KIND_B_CONTROLS, isSweep);
    setItemsSectionVisible(formContext, !isSweep);

    // AFP/Allotment on a Sweep are authoritative outputs of GenerateDistributions —
    // user must not edit them.
    setControlsDisabled(formContext, KIND_B_CONTROLS, isSweep);
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
    onOriginChange: onOriginChange
  };
})();
