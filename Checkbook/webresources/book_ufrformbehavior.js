"use strict";
var Book = Book || {};
// Book.UFR — Unfunded Request form/BPF switching.
//
// Replaces crbc0_swapFormsUFR (old global → new handler):
//   SwitchUFRForm → Book.UFR.onLoad
//
// Intent (unchanged): a UFR with a Higher Level UFR parent is a STATE-side
// request — show the "UFR - State" form and run the UFR Acceptance BPF; a
// UFR without a parent is the OPR-side original — show the "UFR - OPR" form
// and run the UFR Validation BPF.
//
// Rewritten from the deployed script to:
//   - use the executionContext/formContext API (no Xrm.Page),
//   - match forms by LABEL via formContext.ui.formSelector.items instead of
//     hardcoded form GUIDs,
//   - resolve BPF ids at runtime from their solution-stable unique names
//     instead of hardcoded process GUIDs,
//   - only call setActiveProcess when the target BPF isn't already active.
//
// If the forms or BPFs are ever renamed, adjust the constants below.
Book.UFR = (function () {

    // Form labels exactly as they appear in the form selector.
    var STATE_FORM_LABEL = "UFR - State";
    var OPR_FORM_LABEL   = "UFR - OPR";

    // BPF unique names (workflow.uniquename — stable across environments).
    var STATE_BPF = "book_arngcheckbookufr";           // "ARNG Checkbook - UFR Acceptance"
    var OPR_BPF   = "book_arngcheckbookufrvalidation"; // "ARNG Checkbook - UFR Validation"

    var HIGHER_LEVEL_UFR = "book_higherlevelufr";

    function onLoad(executionContext) {
        var formContext = executionContext.getFormContext();

        var parentAttr = formContext.getAttribute(HIGHER_LEVEL_UFR);
        if (!parentAttr) return;

        var isStateSide = parentAttr.getValue() !== null;
        var targetFormLabel = isStateSide ? STATE_FORM_LABEL : OPR_FORM_LABEL;
        var targetBpfName   = isStateSide ? STATE_BPF : OPR_BPF;

        // navigate() reloads the page, so when we switch forms this handler
        // runs again on the target form and sets the BPF on that pass.
        if (switchToFormByLabel(formContext, targetFormLabel)) return;

        ensureActiveProcess(formContext, targetBpfName);
    }

    /** Navigates to the form with the given label. Returns true when a
     *  navigation was started, false when already there (or unavailable). */
    function switchToFormByLabel(formContext, label) {
        var selector = formContext.ui.formSelector;
        if (!selector) return false;

        var current = selector.getCurrentItem();
        if (current && current.getLabel() === label) return false;

        var target = null;
        selector.items.forEach(function (item) {
            if (!target && item.getLabel() === label) target = item;
        });

        if (!target) {
            // The user's roles may not expose the form — leave them where they are.
            console.warn("Book.UFR: form '" + label + "' is not available; staying on current form.");
            return false;
        }

        target.navigate();
        return true;
    }

    function ensureActiveProcess(formContext, bpfUniqueName) {
        var process = formContext.data && formContext.data.process;
        if (!process) return;

        var active = process.getActiveProcess();

        // Resolve the BPF definition id from its unique name (category 4 =
        // business process flow, type 1 = definition).
        Xrm.WebApi.retrieveMultipleRecords(
            "workflow",
            "?$select=workflowid,name" +
            "&$filter=uniquename eq '" + bpfUniqueName + "' and category eq 4 and type eq 1" +
            "&$top=1"
        ).then(function (result) {
            if (!result.entities.length) {
                console.warn("Book.UFR: BPF '" + bpfUniqueName + "' not found.");
                return;
            }
            var targetId = result.entities[0].workflowid.toLowerCase();

            if (active && active.getId() &&
                active.getId().replace(/[{}]/g, "").toLowerCase() === targetId) {
                return; // already on the right BPF
            }

            process.setActiveProcess(targetId, function (status) {
                if (status !== "success") {
                    console.warn("Book.UFR: setActiveProcess('" +
                        bpfUniqueName + "') returned " + status);
                }
            });
        }).catch(function (error) {
            console.error("Book.UFR: BPF lookup failed: " + (error && error.message));
        });
    }

    return { onLoad: onLoad };
})();
