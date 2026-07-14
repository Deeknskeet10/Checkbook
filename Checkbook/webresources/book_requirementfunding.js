"use strict";
var Book = Book || {};
// Book.RequirementFunding — consolidated Requirement Funding main-form script.
//
// Merges three retired web resources:
//   book_requirementFundingValidation  Book.RequirementFunding.onFormLoad → Book.RequirementFunding.onLoad
//                                      Book.RequirementFunding.onFormSave → REMOVED (see below)
//   book_reqFundLockFields             lockAmountFields                   → Book.RequirementFunding.onRequirementChange
//                                                                           (also applied from onLoad)
//   book_reqFundOnLOAChange            onFundingLineChange                → Book.RequirementFunding.onLOAChange
//
// Public handlers (register with "pass execution context" checked):
//   Book.RequirementFunding.onLoad              — form OnLoad
//   Book.RequirementFunding.onRequirementChange — book_requirement OnChange
//   Book.RequirementFunding.onLOAChange         — book_lineofaccounting OnChange
// (book_newtdp OnChange is wired programmatically inside onLoad, as before.)
//
// Intentionally dropped from the old scripts:
//   - The OnSave blocking validation and its synchronous XHR helpers. The
//     RequirementFundingTDPValidator plugin is the enforcement; this script
//     is advisory UX only.
//   - The blocking field-level control.setNotification on book_newtdp (a
//     field notification prevents save). Over-cap now shows a WARNING form
//     notification instead of an ERROR + field block.
Book.RequirementFunding = (function () {

    var LOA          = "book_lineofaccounting";
    var TDP          = "book_newtdp";
    var REQUIREMENT  = "book_requirement";
    var FISCAL_YEAR  = "book_newfiscalyear";

    var VALIDATED_AMOUNT = "book_newvalidatedamount";
    var FUNDED_AMOUNT    = "book_newfundedamount";
    var REQUESTED_AMOUNT = "book_requestedamount";

    var NOTIFICATION_ID         = "tdp_validation_error";
    var NOTIFICATION_ID_LOADING = "tdp_validation_loading";
    var NOTIFICATION_ID_SUCCESS = "tdp_validation_success";

    var DEBOUNCE_MS = 500;
    var validationTimer = null;

    var loaTDPCache = { loaId: null, tdp: null };

    function stripBraces(id) {
        return id ? id.replace(/[{}]/g, "").toLowerCase() : null;
    }

    function roundCurrency(value) {
        if (!value) return 0;
        return Math.round(value * 100) / 100;
    }

    function formatCurrency(value) {
        if (value === null || value === undefined) return "$0.00";
        return "$" + value.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function clearAllNotifications(formContext) {
        formContext.ui.clearFormNotification(NOTIFICATION_ID);
        formContext.ui.clearFormNotification(NOTIFICATION_ID_LOADING);
        formContext.ui.clearFormNotification(NOTIFICATION_ID_SUCCESS);
    }

    // ----- Advisory TDP-vs-LOA check (from book_requirementFundingValidation) -----
    // Warns when the entered TDP would exceed what the LOA has left. The
    // RequirementFundingTDPValidator plugin does the real enforcement at save.

    function debouncedValidation(formContext) {
        if (validationTimer) clearTimeout(validationTimer);
        formContext.ui.clearFormNotification(NOTIFICATION_ID);
        formContext.ui.clearFormNotification(NOTIFICATION_ID_SUCCESS);
        validationTimer = setTimeout(function () {
            validateTDPAllocation(formContext);
        }, DEBOUNCE_MS);
    }

    async function validateTDPAllocation(formContext) {
        var loaAttr = formContext.getAttribute(LOA);
        var loaLookup = loaAttr ? loaAttr.getValue() : null;
        if (!loaLookup || loaLookup.length === 0) {
            clearAllNotifications(formContext);
            return;
        }

        var tdpAttr = formContext.getAttribute(TDP);
        var currentTDP = tdpAttr ? tdpAttr.getValue() : null;
        if (currentTDP === null || currentTDP === undefined) {
            clearAllNotifications(formContext);
            return;
        }

        var currentRecordId = stripBraces(formContext.data.entity.getId());
        var loaId = stripBraces(loaLookup[0].id);

        try {
            formContext.ui.setFormNotification(
                "Checking available TDP...", "INFO", NOTIFICATION_ID_LOADING);

            var loaTDP = await getLOATotalTDP(loaId);
            var otherAllocatedTDP = await getOtherRequirementFundingsTDP(loaId, currentRecordId);

            formContext.ui.clearFormNotification(NOTIFICATION_ID_LOADING);

            var proposedTotal = roundCurrency(otherAllocatedTDP + currentTDP);
            var roundedLoaTDP = roundCurrency(loaTDP);
            var remainingTDP  = roundCurrency(loaTDP - otherAllocatedTDP);

            if (proposedTotal > roundedLoaTDP) {
                formContext.ui.clearFormNotification(NOTIFICATION_ID_SUCCESS);
                formContext.ui.setFormNotification(
                    "TDP allocation exceeds available funds. " +
                    "Requested: " + formatCurrency(currentTDP) + " | " +
                    "Available: " + formatCurrency(remainingTDP) + " | " +
                    "LOA Total: " + formatCurrency(roundedLoaTDP) + " | " +
                    "Already Allocated: " + formatCurrency(otherAllocatedTDP) +
                    " — the save will be rejected unless the amount is reduced.",
                    "WARNING",
                    NOTIFICATION_ID
                );
            } else {
                formContext.ui.clearFormNotification(NOTIFICATION_ID);
                var remainingAfterSave = roundCurrency(remainingTDP - currentTDP);
                formContext.ui.setFormNotification(
                    "TDP allocation valid. " +
                    "LOA available: " + formatCurrency(remainingTDP) + " | " +
                    "After save: " + formatCurrency(remainingAfterSave) + " will remain",
                    "INFO",
                    NOTIFICATION_ID_SUCCESS
                );
            }
        } catch (error) {
            console.error("TDP Validation Error:", error);
            formContext.ui.clearFormNotification(NOTIFICATION_ID_LOADING);
            formContext.ui.setFormNotification(
                "Could not validate TDP: " + error.message,
                "WARNING",
                NOTIFICATION_ID
            );
        }
    }

    async function getLOATotalTDP(loaId) {
        if (loaTDPCache.loaId === loaId && loaTDPCache.tdp !== null) {
            return loaTDPCache.tdp;
        }
        var result = await Xrm.WebApi.retrieveRecord(
            "book_fundingline", loaId, "?$select=book_newtdp");
        var tdp = result.book_newtdp || 0;
        loaTDPCache = { loaId: loaId, tdp: tdp };
        return tdp;
    }

    async function getOtherRequirementFundingsTDP(loaId, excludeRecordId) {
        var filter = "_book_lineofaccounting_value eq " + loaId;
        if (excludeRecordId) {
            filter += " and book_requirementfundingid ne " + excludeRecordId;
        }
        var result = await Xrm.WebApi.retrieveMultipleRecords(
            "book_requirementfunding",
            "?$select=book_newtdp&$filter=" + filter
        );
        var total = 0;
        (result.entities || []).forEach(function (entity) {
            total += entity.book_newtdp || 0;
        });
        return total;
    }

    // ----- Amount-field lock UI (from book_reqFundLockFields) -----
    // Advisory only — the FundedAmountLock plugin is the enforcement. Locks
    // Validated/Funded amount and toggles Requested Amount visibility based
    // on the parent Requirement's type. Behavior (including the inverted
    // enable-when-type-1-or-4 logic) preserved from the original.

    function applyAmountLocks(formContext) {
        var reqAttr = formContext.getAttribute(REQUIREMENT);
        var requirement = reqAttr ? reqAttr.getValue() : null;

        var validatedAmountControl = formContext.getControl(VALIDATED_AMOUNT);
        var fundedAmountControl    = formContext.getControl(FUNDED_AMOUNT);
        var requestedAmountControl = formContext.getControl(REQUESTED_AMOUNT);

        if (requirement != null) {
            Xrm.WebApi.retrieveRecord(
                "book_requirements",
                stripBraces(requirement[0].id),
                "?$select=book_type"
            ).then(
                function (result) {
                    var requirementType = result.book_type;
                    var editable = requirementType === 1 || requirementType === 4;

                    if (validatedAmountControl) validatedAmountControl.setDisabled(!editable);
                    if (fundedAmountControl)    fundedAmountControl.setDisabled(!editable);
                    if (requestedAmountControl) requestedAmountControl.setVisible(!editable);
                },
                function (error) {
                    console.log(error.message);
                }
            );
        } else {
            // No Requirement selected — lock amounts, show Requested Amount.
            if (validatedAmountControl) validatedAmountControl.setDisabled(true);
            if (fundedAmountControl)    fundedAmountControl.setDisabled(true);
            if (requestedAmountControl) requestedAmountControl.setVisible(true);
        }
    }

    // ----- Fiscal-year defaulting (from book_reqFundOnLOAChange) -----
    // book_fiscalyear/book_newfiscalyear are the goal_fiscalyear option set;
    // the raw numeric value copies straight across.

    function defaultFiscalYearFromLOA(formContext) {
        var loaAttr = formContext.getAttribute(LOA);
        var fyAttr  = formContext.getAttribute(FISCAL_YEAR);
        if (!loaAttr || !fyAttr) return;

        var loaRef = loaAttr.getValue();
        if (!loaRef) {
            fyAttr.setValue(null);
            return;
        }

        Xrm.WebApi.retrieveRecord(
            "book_fundingline",
            stripBraces(loaRef[0].id),
            "?$select=book_fiscalyear"
        ).then(function (result) {
            fyAttr.setValue(result.book_fiscalyear);
        }).catch(function (error) {
            console.error("Error retrieving fiscal year: " + error.message);
        });
    }

    // ----- Public handlers -----

    function onLoad(executionContext) {
        var formContext = executionContext.getFormContext();

        clearAllNotifications(formContext);
        applyAmountLocks(formContext);

        // TDP changes revalidate; wired here (not in the designer) as before.
        var tdpAttr = formContext.getAttribute(TDP);
        if (tdpAttr) {
            tdpAttr.addOnChange(function (ctx) {
                debouncedValidation(ctx.getFormContext());
            });
        }

        var loaAttr = formContext.getAttribute(LOA);
        var loaLookup = loaAttr ? loaAttr.getValue() : null;
        var tdpValue = tdpAttr ? tdpAttr.getValue() : null;
        if (loaLookup && loaLookup.length > 0 && tdpValue !== null) {
            validateTDPAllocation(formContext);
        }
    }

    function onRequirementChange(executionContext) {
        applyAmountLocks(executionContext.getFormContext());
    }

    function onLOAChange(executionContext) {
        var formContext = executionContext.getFormContext();
        defaultFiscalYearFromLOA(formContext);
        loaTDPCache = { loaId: null, tdp: null };
        clearAllNotifications(formContext);
        debouncedValidation(formContext);
    }

    return {
        onLoad: onLoad,
        onRequirementChange: onRequirementChange,
        onLOAChange: onLOAChange
    };
})();
