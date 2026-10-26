"use strict";
var Book = Book || {};
// Book.StateSwap — form behavior for the book_stateswap (State Swap) main form.
//
// New library (no predecessor). FY27+ swaps are built by the SwapBuilder PCF
// (docs/StateSwap-FY27-Redesign.md §7): each leg runs from one Prioritization
// Funding line to another, which the native Swap Items subgrid cannot express.
// On FY27+ this hides the subgrid and shows the builder cell; on FY26 (or no
// Fiscal Year yet) it does the reverse. Re-applies when the Fiscal Year changes.
//
// Wire: form OnLoad → Book.StateSwap.onLoad (pass execution context).
Book.StateSwap = (function () {
  var FIRST_PF_LEG_FY = 2027;
  var FISCAL_YEAR = "book_newfiscalyear";
  var ITEMS_SUBGRID = "Subgrid_new_1";
  var BUILDER_CONTROL = "book_totalsentbya_builder";

  function onLoad(executionContext) {
    var formContext = executionContext.getFormContext();
    var fyAttr = formContext.getAttribute(FISCAL_YEAR);
    if (fyAttr) {
      fyAttr.addOnChange(function () {
        apply(formContext);
      });
    }
    apply(formContext);
  }

  function apply(formContext) {
    var fyAttr = formContext.getAttribute(FISCAL_YEAR);
    var fy = fyAttr ? fyAttr.getValue() : null;
    var pfLegs = fy !== null && fy !== undefined && fy >= FIRST_PF_LEG_FY;
    setVisible(formContext, ITEMS_SUBGRID, !pfLegs);
    setVisible(formContext, BUILDER_CONTROL, pfLegs);
  }

  function setVisible(formContext, controlId, visible) {
    var ctrl = formContext.getControl(controlId);
    if (ctrl && typeof ctrl.setVisible === "function") {
      ctrl.setVisible(visible);
    }
  }

  return {
    onLoad: onLoad
  };
})();
