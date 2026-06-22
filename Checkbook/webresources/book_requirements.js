"use strict";
var Book = Book || {};
Book.Requirements = (function () {
    var APPROVAL_STATUS = "book_approvalstatus";
    var TYPE            = "book_type";

    var APPROVAL_STATUS_BE_APPROVED = 7;
    var TYPE_DOMOPS                 = 5;

    var TAB_REQ_FUNDING     = "reqFundingTab";
    var TAB_GENERAL         = "general";
    var SECTION_REQ_FUNDING = "req_funding";
    var SECTION_REQ_DOMOPS  = "req_domops";

    function setSectionControlsVisible(formContext, tabName, sectionName, visible) {
        var tab = formContext.ui.tabs.get(tabName);
        if (!tab) return;
        var section = tab.sections.get(sectionName);
        if (!section) return;
        section.controls.forEach(function (control) {
            control.setVisible(visible);
        });
    }

    // ----- Funding tab/section visibility based on approval status -----
    // The dedicated Funding tab is shown only when the Requirement is BE Approved.
    // The general-tab Funding section is forced hidden when not approved (legacy
    // asymmetry — it's not re-shown from here when status flips back).

    function applyFundingTabVisibility(formContext) {
        var status = formContext.getAttribute(APPROVAL_STATUS).getValue();
        var fundingTab = formContext.ui.tabs.get(TAB_REQ_FUNDING);
        if (!fundingTab) return;

        if (status === APPROVAL_STATUS_BE_APPROVED) {
            fundingTab.setVisible(true);
            return;
        }
        fundingTab.setVisible(false);
        setSectionControlsVisible(formContext, TAB_GENERAL, SECTION_REQ_FUNDING, false);
    }

    // ----- DOMOPs section visibility based on Requirement Type -----

    function applyDomOpsVisibility(formContext) {
        var type = formContext.getAttribute(TYPE).getValue();
        setSectionControlsVisible(
            formContext,
            TAB_GENERAL,
            SECTION_REQ_DOMOPS,
            type === TYPE_DOMOPS
        );
    }

    return {
        onLoad: function (executionContext) {
            var formContext = executionContext.getFormContext();
            applyFundingTabVisibility(formContext);
            applyDomOpsVisibility(formContext);
        },

        onTypeChange: function (executionContext) {
            applyDomOpsVisibility(executionContext.getFormContext());
        },

        onApprovalStatusChange: function (executionContext) {
            applyFundingTabVisibility(executionContext.getFormContext());
        }
    };
})();
