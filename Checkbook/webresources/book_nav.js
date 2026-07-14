"use strict";
var Book = Book || {};
// Book.Nav — consolidated Xrm.Navigation.navigateTo wrappers for the custom
// pages that used to live in eight near-identical single-function web
// resources. Mapping (old web resource / old global → new function):
//
//   book_cewCustomPage           openCostEstimate(fc) → Book.Nav.openCostEstimate(fc)
//   book_cewSpendPlan            openSpendPlan(fc)    → Book.Nav.openSpendPlanForUFR(fc)
//   book_spendPlanPrioritization openSpendPlan(fc)    → Book.Nav.openSpendPlanForPrioritization(fc)
//   book_spendPlanRequirement    openSpendPlan(fc)    → Book.Nav.openSpendPlanForRequirement(fc)
//   book_pageDistroModal         showDistroModal(fc)  → Book.Nav.openGenerateDistributions(fc)
//   book_pageFTModal             showFTModal(fc)      → Book.Nav.openGenerateLOAs(fc)
//   book_pageValidateFund        openValidateFund(fc) → Book.Nav.openValidateAndFund(fc)
//   book_showUFRModal            showUFRModal(fc)     → Book.Nav.openGenerateUFRs(fc)
//
// Every wrapper keeps its original call signature: a single formContext
// argument (appaction on-click parameter [{"type":5}] — PrimaryControl).
Book.Nav = (function () {

    function stripBraces(id) { return id ? id.replace(/[{}]/g, "") : id; }

    /**
     * Opens a custom page as a dialog.
     * @param {string} pageName  Custom page logical name (e.g. "book_pagevalidatefund_d0f43").
     * @param {Object} options
     *   title          Dialog title.
     *   width, height  { value, unit } objects (unit "%" or "px"). Height optional.
     *   entityName     Record context passed to the page (optional).
     *   recordId       Record id (braces stripped automatically, optional).
     *   target         navigateTo target; default 2 (dialog).
     *   position       1 = centered (default), 2 = side pane.
     *   refreshContext formContext whose data is refreshed when the dialog
     *                  closes (omit for no refresh).
     * @returns {Promise} the navigateTo promise.
     */
    function openPage(pageName, options) {
        options = options || {};

        var pageInput = {
            pageType: "custom",
            name: pageName
        };
        if (options.entityName) pageInput.entityName = options.entityName;
        if (options.recordId)   pageInput.recordId   = stripBraces(options.recordId);

        var navigationOptions = {
            target:   options.target   !== undefined ? options.target   : 2,
            position: options.position !== undefined ? options.position : 1
        };
        if (options.width)  navigationOptions.width  = options.width;
        if (options.height) navigationOptions.height = options.height;
        if (options.title)  navigationOptions.title  = options.title;

        return Xrm.Navigation.navigateTo(pageInput, navigationOptions)
            .then(function () {
                // Called when the dialog closes.
                if (options.refreshContext) {
                    options.refreshContext.data.refresh();
                }
            })
            .catch(function (error) {
                console.error("Book.Nav.openPage(" + pageName + "): " +
                    (error && error.message));
            });
    }

    function currentRecordId(formContext) {
        return stripBraces(formContext.data.entity.getId());
    }

    // ----- Named wrappers (one per retired web resource) -----

    // was book_cewCustomPage / openCostEstimate — Prioritization form.
    function openCostEstimate(formContext) {
        return openPage("book_pagecostestimateworksheetcew_4df1e", {
            title: "Cost Estimate Worksheet (CEW)",
            width: { value: 80, unit: "%" },
            entityName: "book_prioritization",
            recordId: currentRecordId(formContext),
            refreshContext: formContext
        });
    }

    // was book_cewSpendPlan / openSpendPlan — Unfunded Request form.
    // entityName "book_unfundedrequest" preserved verbatim from the old script.
    function openSpendPlanForUFR(formContext) {
        return openPage("book_pagespendplanufr_01af9", {
            title: "Spend Plan (UFR)",
            width:  { value: 90, unit: "%" },
            height: { value: 70, unit: "%" },
            entityName: "book_unfundedrequest",
            recordId: currentRecordId(formContext),
            refreshContext: formContext
        });
    }

    // was book_spendPlanPrioritization / openSpendPlan — Prioritization form.
    function openSpendPlanForPrioritization(formContext) {
        return openPage("book_pagespendplanufr_01af9", {
            title: "Spend Plan (Prioritization)",
            width:  { value: 90, unit: "%" },
            height: { value: 70, unit: "%" },
            entityName: "book_prioritization",
            recordId: currentRecordId(formContext),
            refreshContext: formContext
        });
    }

    // was book_spendPlanRequirement / openSpendPlan — Requirement / RF forms.
    // entityName "book_requirementfundings" preserved verbatim from the old script.
    function openSpendPlanForRequirement(formContext) {
        return openPage("book_pagenpmspendplan_7fa13", {
            title: "Spend Plan (Requirement)",
            width:  { value: 90, unit: "%" },
            height: { value: 70, unit: "%" },
            entityName: "book_requirementfundings",
            recordId: currentRecordId(formContext),
            refreshContext: formContext
        });
    }

    // was book_pageDistroModal / showDistroModal — no record context.
    function openGenerateDistributions(formContext) {
        return openPage("book_pagedistributionmodal_f0fad", {
            title: "Generate Distributions",
            width:  { value: 300, unit: "px" },
            height: { value: 260, unit: "px" },
            refreshContext: formContext
        });
    }

    // was book_pageFTModal / showFTModal — no record context, no refresh
    // on close (matching the old script, whose refresh was commented out).
    function openGenerateLOAs(formContext) {
        return openPage("book_pagefundingtrackmodal_30c95", {
            title: "Generate LOAs",
            width:  { value: 300, unit: "px" },
            height: { value: 260, unit: "px" }
        });
    }

    // was book_pageValidateFund / openValidateFund — side pane (position 2).
    // entityName "book_requirementfundings" preserved verbatim from the old script.
    function openValidateAndFund(formContext) {
        return openPage("book_pagevalidatefund_d0f43", {
            title: "Validate & Fund",
            position: 2,
            width: { value: 785, unit: "px" },
            entityName: "book_requirementfundings",
            recordId: currentRecordId(formContext),
            refreshContext: formContext
        });
    }

    // was book_showUFRModal / showUFRModal — no record context.
    function openGenerateUFRs(formContext) {
        return openPage("book_pagegenerateufrmodal_f2c44", {
            title: "Generate UFRs",
            width:  { value: 300, unit: "px" },
            height: { value: 260, unit: "px" },
            refreshContext: formContext
        });
    }

    return {
        openPage: openPage,
        openCostEstimate: openCostEstimate,
        openSpendPlanForUFR: openSpendPlanForUFR,
        openSpendPlanForPrioritization: openSpendPlanForPrioritization,
        openSpendPlanForRequirement: openSpendPlanForRequirement,
        openGenerateDistributions: openGenerateDistributions,
        openGenerateLOAs: openGenerateLOAs,
        openValidateAndFund: openValidateAndFund,
        openGenerateUFRs: openGenerateUFRs
    };
})();
