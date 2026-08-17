"use strict";
var Book = Book || {};
Book.Prioritization = (function () {
    var REQUESTED_AMOUNT   = "book_newrequestedamount";
    var QUANTITY           = "book_quantities";
    var REQUIREMENT        = "book_requirement";
    var REQUIREMENT_FUNDING = "book_requirementfunding";
    var FUND_CENTER        = "book_fundcenter";
    var FUNDING_MODE       = "book_fundingmode";
    var STATE              = "book_state";
    var STATE_PRIORITY     = "book_statepriority";
    var FISCAL_YEAR        = "book_newfiscalyear";
    var APPROVAL_STATUS    = "book_approvalstatus";

    var FUNDING_MODE_ITEMIZED       = 1;
    var APPROVAL_STATUS_STATE_INPUT = 0;

    var SPEND_PLAN_TAB = "tab_spendplan";
    // First FY that uses the PrioritizationSpendPlanGrid tab; earlier FYs keep
    // the legacy Spend Plan page (command bar button).
    var SPEND_PLAN_MIN_FY = 2027;

    var DOCS_REMINDER_ID = "docsReminder";
    var DOCS_REMINDER_MESSAGE =
        "Upload supporting Documentation and Analysis substantiating Resource " +
        "Request in the timeline prior to submission to the NPM.";

    function setControlsVisible(formContext, names, visible) {
        names.forEach(function (name) {
            var ctrl = formContext.getControl(name);
            if (ctrl) ctrl.setVisible(visible);
        });
    }

    function stripBraces(id) { return id.replace(/[{}]/g, ""); }

    // ----- Requested Amount / Quantity visibility -----
    // Itemized-ness is derived from the parent Requirement having any
    // Requirement Details.
    //
    // Itemized Prio:
    //   - Requested Amount stays visible but read-only — PrioritizationItemizedRollup
    //     writes the sum of the children into it.
    //   - Quantity isn't rolled up by the plugin, so hide it rather than show a
    //     misleading empty/0. book_quantities is RequiredLevel=required at the
    //     table level, so we must drop the required level in lockstep with
    //     hiding — otherwise the platform's save-time required-field check fails
    //     and auto-unhides the field.
    // Direct Prio:
    //   - Requested Amount visible and editable; Quantity visible and required.

    function setItemizedFieldsHidden(formContext, itemized) {
        var reqCtrl = formContext.getControl(REQUESTED_AMOUNT);
        if (reqCtrl) {
            reqCtrl.setVisible(true);
            reqCtrl.setDisabled(itemized);
        }
        var qtyCtrl = formContext.getControl(QUANTITY);
        if (qtyCtrl) qtyCtrl.setVisible(!itemized);
        var qtyAttr = formContext.getAttribute(QUANTITY);
        if (qtyAttr) qtyAttr.setRequiredLevel(itemized ? "none" : "required");
    }

    function hasRequirementDetails(requirementId) {
        return Xrm.WebApi.retrieveMultipleRecords(
            "book_requirementdetails",
            "?$select=book_requirementdetailsid" +
            "&$filter=_book_requirement_value eq " + stripBraces(requirementId) +
            "&$top=1"
        ).then(function (result) { return result.entities.length > 0; });
    }

    function applyItemizedVisibilityFromRequirement(formContext) {
        var lookup = formContext.getAttribute(REQUIREMENT).getValue();
        if (!lookup || !lookup[0]) {
            setItemizedFieldsHidden(formContext, true);
            return;
        }
        hasRequirementDetails(lookup[0].id).then(
            function (hasRDs) { setItemizedFieldsHidden(formContext, hasRDs); },
            function ()        { setItemizedFieldsHidden(formContext, true); }
        );
    }

    function applyItemizedVisibilityOnLoad(formContext) {
        if (formContext.ui.getFormType() === 2) {
            var mode = formContext.getAttribute(FUNDING_MODE).getValue();
            setItemizedFieldsHidden(formContext, mode === FUNDING_MODE_ITEMIZED);
            return;
        }
        setItemizedFieldsHidden(formContext, true);
        applyItemizedVisibilityFromRequirement(formContext);
    }

    // ----- Fund Center visibility / lock based on Requirement.book_national -----
    // Centrally managed Reqs get FC backfilled by the PrioritizationFundCenterBackfill
    // plugin — show but lock so users can see where the money is going without
    // trying to overwrite. Path to book_national depends on FY:
    //   FY26 records:  book_requirementfunding is populated → traverse RF → Requirement
    //   FY27+ records: book_requirement is populated directly

    function readIsNational(formContext) {
        var rf  = formContext.getAttribute(REQUIREMENT_FUNDING);
        var req = formContext.getAttribute(REQUIREMENT);
        var rfVal  = rf  ? rf.getValue()  : null;
        var reqVal = req ? req.getValue() : null;

        if (rfVal && rfVal[0]) {
            return Xrm.WebApi.retrieveRecord(
                "book_requirementfunding",
                stripBraces(rfVal[0].id),
                "?$expand=book_Requirement($select=book_national)"
            ).then(function (result) {
                return !!(result.book_Requirement && result.book_Requirement.book_national === true);
            });
        }
        if (reqVal && reqVal[0]) {
            return Xrm.WebApi.retrieveRecord(
                "book_requirements",
                stripBraces(reqVal[0].id),
                "?$select=book_national"
            ).then(function (result) {
                return result.book_national === true;
            });
        }
        return Promise.resolve(null);
    }

    function applyFundCenterLock(formContext) {
        var fcAttr = formContext.getAttribute(FUND_CENTER);
        var fcCtrl = formContext.getControl(FUND_CENTER);
        if (!fcAttr || !fcCtrl) return;

        readIsNational(formContext).then(
            function (isNational) {
                fcCtrl.setVisible(true);
                if (isNational === null) {
                    // No parent set yet — user-editable, default required.
                    fcCtrl.setDisabled(false);
                    fcAttr.setRequiredLevel("required");
                    return;
                }
                fcCtrl.setDisabled(isNational);
                fcAttr.setRequiredLevel(isNational ? "none" : "required");
            },
            function (error) {
                console.log("applyFundCenterLock retrieve failed: " + error.message);
            }
        );
    }

    // ----- Spend Plan tab visibility (FY27+) -----
    // The Spend Plan tab hosts PrioritizationSpendPlanGrid; FY26 and earlier
    // keep the legacy Spend Plan custom page, so hide the tab for them.

    function applySpendPlanTabVisibility(formContext) {
        var tab = formContext.ui.tabs.get(SPEND_PLAN_TAB);
        if (!tab) return;
        var fyAttr = formContext.getAttribute(FISCAL_YEAR);
        var fy = fyAttr ? fyAttr.getValue() : null;
        tab.setVisible(fy !== null && fy >= SPEND_PLAN_MIN_FY);
    }

    // ----- State auto-populate from user BU -----

    function businessUnitNameToStateName(name) {
        var words = name.split(" ");
        return words.map(function (w) {
            return w.length === 0 ? "" : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }).join(" ");
    }

    function findStateRecord(name) {
        return Xrm.WebApi.retrieveMultipleRecords(
            "book_state",
            "?$select=book_name,book_stateid&$filter=book_name eq '" + name + "'"
        ).then(function (result) {
            return result.entities.length > 0 ? result.entities[0] : null;
        });
    }

    function setStateLookup(formContext, stateRecord) {
        formContext.getAttribute(STATE).setValue([{
            id: stateRecord.book_stateid,
            name: stateRecord.book_name,
            entityType: "book_state"
        }]);
    }

    function populateStateFromBU(formContext) {
        if (formContext.getAttribute(STATE).getValue()) return;
        var userId = Xrm.Utility.getGlobalContext().userSettings.userId;

        Xrm.WebApi.retrieveRecord(
            "systemuser",
            userId.slice(1, -1),
            "?$expand=businessunitid($select=name)"
        ).then(function (user) {
            if (!user.businessunitid) return;
            var buName = businessUnitNameToStateName(user.businessunitid.name);
            var buId   = user.businessunitid.businessunitid;

            findStateRecord(buName).then(function (state) {
                if (state) { setStateLookup(formContext, state); return; }
                Xrm.WebApi.retrieveRecord(
                    "businessunit",
                    buId,
                    "?$expand=parentbusinessunitid($select=name)"
                ).then(function (bu) {
                    if (!bu.parentbusinessunitid) return;
                    findStateRecord(businessUnitNameToStateName(bu.parentbusinessunitid.name))
                        .then(function (parentState) {
                            if (parentState) setStateLookup(formContext, parentState);
                        });
                });
            });
        });
    }

    // ----- Documentation reminder banner -----
    // Show on create, and on open whenever the Prio is still in State Input.
    // User can dismiss with the X — it just won't reappear until next load.

    function applyDocsReminderBanner(formContext) {
        var formType = formContext.ui.getFormType();
        var status = formContext.getAttribute(APPROVAL_STATUS).getValue();
        var show = formType === 1 || status === APPROVAL_STATUS_STATE_INPUT;

        if (show) {
            formContext.ui.setFormNotification(DOCS_REMINDER_MESSAGE, "INFO", DOCS_REMINDER_ID);
        } else {
            formContext.ui.clearFormNotification(DOCS_REMINDER_ID);
        }
    }

    // ----- Fiscal Year lock -----
    // FY is user-selectable on create, then locked once the row exists so it
    // can't drift after downstream records (RFs, LOAs, ledger) are tied to it.

    function applyFiscalYearLock(formContext) {
        var ctrl = formContext.getControl(FISCAL_YEAR);
        if (!ctrl) return;
        ctrl.setDisabled(formContext.ui.getFormType() !== 1);
    }

    // ----- Requirement Funding is a FY26-only linkage -----
    // Users can set FY=2026, pick an RF lookup, then flip FY to 2027 before the
    // first save — leaving a FY27 Prio pinned to a FY26 RequirementFunding.
    // Business rules can't clear a lookup, so do it here: whenever FY moves off
    // 2026, blank the RF. (setValue(null) is the client-API move a "Set Field
    // Value" business-rule action has no equivalent for on lookups.)
    var FY_WITH_REQUIREMENT_FUNDING = 2026;

    function clearRequirementFundingIfNotFy26(formContext) {
        var fy    = formContext.getAttribute(FISCAL_YEAR);
        var rf    = formContext.getAttribute(REQUIREMENT_FUNDING);
        if (!fy || !rf) return;
        if (fy.getValue() === FY_WITH_REQUIREMENT_FUNDING) return;
        if (rf.getValue() === null) return;
        rf.setValue(null);
    }

    // ----- Unique state-priority enforcement -----

    async function verifyUniquePriority(executionContext) {
        var formContext = executionContext.getFormContext();
        var saveEvent = executionContext.getEventArgs();

        var priority = formContext.getAttribute(STATE_PRIORITY).getValue();
        if (!priority) return;

        var fy         = formContext.getAttribute(FISCAL_YEAR).getValue();
        var state      = formContext.getAttribute(STATE).getValue();
        var fundCenter = formContext.getAttribute(FUND_CENTER).getValue();
        if (!fy || !state || !fundCenter) return;

        var fundCenterId    = stripBraces(fundCenter[0].id);
        var stateId         = stripBraces(state[0].id);
        var currentRecordId = stripBraces(formContext.data.entity.getId());

        var fetchXml =
            '<fetch top="1">' +
              '<entity name="book_prioritization">' +
                '<attribute name="book_statepriority" />' +
                '<filter>' +
                  '<condition attribute="book_newfiscalyear" operator="eq" value="' + fy + '" />' +
                  '<condition attribute="book_state" operator="eq" value="' + stateId + '" />' +
                  '<condition attribute="book_fundcenter" operator="eq" value="' + fundCenterId + '" />' +
                  '<condition attribute="book_statepriority" operator="eq" value="' + priority + '" />' +
                  '<condition attribute="book_prioritizationid" operator="ne" value="' + currentRecordId + '" />' +
                '</filter>' +
              '</entity>' +
            '</fetch>';

        var result = await Xrm.WebApi.retrieveMultipleRecords(
            "book_prioritization",
            "?fetchXml=" + encodeURIComponent(fetchXml)
        );

        if (result.entities.length > 0) {
            saveEvent.preventDefault();
            formContext.ui.setFormNotification(
                "Priority " + priority + " is already assigned within this Fund Center. Please choose a unique priority.",
                "ERROR",
                "duplicate_priority"
            );
        } else {
            formContext.ui.clearFormNotification("duplicate_priority");
        }
    }

    return {
        onLoad: function (executionContext) {
            var formContext = executionContext.getFormContext();
            populateStateFromBU(formContext);
            applyFundCenterLock(formContext);
            applyItemizedVisibilityOnLoad(formContext);
            applyDocsReminderBanner(formContext);
            applyFiscalYearLock(formContext);
            applySpendPlanTabVisibility(formContext);

            // After an in-place save, the platform refreshes the form to Update mode
            // and discards our JS-set visibility/disabled/required overrides. The
            // "Lock Funding Fields for Itemized" business rule then evaluates against
            // FundingMode — which is still empty because ItemizedDetailsSynchronizer
            // is Async and hasn't run yet — and unlocks the fields. Re-apply on
            // PostSave; our check reads Requirement → Requirement Details, which is
            // stable regardless of plugin timing.
            if (formContext.data && formContext.data.entity &&
                typeof formContext.data.entity.addOnPostSave === "function") {
                formContext.data.entity.addOnPostSave(function () {
                    applyItemizedVisibilityFromRequirement(formContext);
                });
            }
        },

        onRequirementFundingChange: function (executionContext) {
            applyFundCenterLock(executionContext.getFormContext());
        },

        onFiscalYearChange: function (executionContext) {
            var formContext = executionContext.getFormContext();
            clearRequirementFundingIfNotFy26(formContext);
            applyFundCenterLock(formContext);
            applySpendPlanTabVisibility(formContext);
        },

        onRequirementChange: function (executionContext) {
            var formContext = executionContext.getFormContext();
            applyFundCenterLock(formContext);
            applyItemizedVisibilityFromRequirement(formContext);
        },

        onSave: function (executionContext) {
            return verifyUniquePriority(executionContext);
        }
    };
})();
