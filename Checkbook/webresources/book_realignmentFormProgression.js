// Realignment form — top-down section gating.
// Register as JScript web resource "book_realignmentFormProgression" and
// add as an OnLoad library on the "Realign Requirement" main form, calling
// RealignmentFormProgression.onLoad with the execution context passed in.
//
// Behavior:
//   • Fund populated                                         → show LOA section
//   • Debited LOA AND Credited LOA populated                  → show RF section
//   • Debited Requirement AND Credited Requirement populated → show Prioritization section
//   • Clearing a field at any level clears every downstream field on its side
//     (debit clears debit, credit clears credit) so the other side's work is
//     preserved. Clearing Fund clears both sides since Fund is the shared root.
//     Sections re-hide whenever they lose their prerequisites.
//
// We treat debit and credit as one gate (BOTH must be set to advance) because
// a realignment isn't meaningful until both sides of the move are chosen.
var RealignmentFormProgression = (function () {
  "use strict";

  var TAB = "Realignment Details";

  var SECTION = {
    fund: "funding_details",
    loa: "Realignment Details_section_6",
    rf: "Realignment Details_sec_requirement",
    prio: "prioritization_section"
  };

  var FIELD = {
    fund: "book_fund",
    debitLoa: "book_newdebitedloa",
    creditLoa: "book_newcreditedloa",
    debitRf: "book_newdebitedrequirement",
    creditRf: "book_newcreditedrequirement",
    debitPrio: "book_debitedprioritization",
    creditPrio: "book_creditedprioritization"
  };

  function onLoad(executionContext) {
    var formContext = executionContext.getFormContext();

    // Wire change handlers. Each handler clears its dependants and then
    // refreshes section visibility from current values.
    onChange(formContext, FIELD.fund, function () {
      if (isEmpty(formContext, FIELD.fund)) {
        clearFields(formContext, [
          FIELD.debitLoa, FIELD.creditLoa,
          FIELD.debitRf, FIELD.creditRf,
          FIELD.debitPrio, FIELD.creditPrio
        ]);
      }
      applyVisibility(formContext);
    });

    // LOA changes only cascade down their own side, so the user can fix the
    // debited chain without losing what they've already entered on the credit
    // chain (and vice versa).
    onChange(formContext, FIELD.debitLoa, function () {
      if (isEmpty(formContext, FIELD.debitLoa)) {
        clearFields(formContext, [FIELD.debitRf, FIELD.debitPrio]);
      }
      applyVisibility(formContext);
    });
    onChange(formContext, FIELD.creditLoa, function () {
      if (isEmpty(formContext, FIELD.creditLoa)) {
        clearFields(formContext, [FIELD.creditRf, FIELD.creditPrio]);
      }
      applyVisibility(formContext);
    });

    onChange(formContext, FIELD.debitRf, function () {
      if (isEmpty(formContext, FIELD.debitRf)) {
        clearFields(formContext, [FIELD.debitPrio]);
      }
      applyVisibility(formContext);
    });
    onChange(formContext, FIELD.creditRf, function () {
      if (isEmpty(formContext, FIELD.creditRf)) {
        clearFields(formContext, [FIELD.creditPrio]);
      }
      applyVisibility(formContext);
    });

    applyVisibility(formContext);
  }

  function applyVisibility(formContext) {
    var fundSet = !isEmpty(formContext, FIELD.fund);
    var loaSet  = !isEmpty(formContext, FIELD.debitLoa) && !isEmpty(formContext, FIELD.creditLoa);
    var rfSet   = !isEmpty(formContext, FIELD.debitRf)  && !isEmpty(formContext, FIELD.creditRf);

    setSectionVisible(formContext, SECTION.loa,  fundSet);
    setSectionVisible(formContext, SECTION.rf,   fundSet && loaSet);
    setSectionVisible(formContext, SECTION.prio, fundSet && loaSet && rfSet);
  }

  // --- helpers -------------------------------------------------------------

  function isEmpty(formContext, name) {
    var attr = formContext.getAttribute(name);
    if (!attr) return true;
    var v = attr.getValue();
    return v === null || v === undefined || (Array.isArray(v) && v.length === 0);
  }

  function clearFields(formContext, names) {
    names.forEach(function (name) {
      var attr = formContext.getAttribute(name);
      if (attr && attr.getValue() !== null) {
        attr.setValue(null);
        // Mark submit so the cleared value is actually persisted.
        attr.setSubmitMode("always");
      }
    });
  }

  function onChange(formContext, name, handler) {
    var attr = formContext.getAttribute(name);
    if (attr) attr.addOnChange(handler);
  }

  function setSectionVisible(formContext, sectionName, visible) {
    var tab = formContext.ui.tabs.get(TAB);
    if (!tab) return;
    var section = tab.sections.get(sectionName);
    if (section) section.setVisible(visible);
  }

  return { onLoad: onLoad };
})();
