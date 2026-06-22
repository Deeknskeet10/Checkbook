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

    var FUNDING_MODE_ITEMIZED = 1;

    function setControlsVisible(formContext, names, visible) {
        names.forEach(function (name) {
            var ctrl = formContext.getControl(name);
            if (ctrl) ctrl.setVisible(visible);
        });
    }

    function stripBraces(id) { return id.replace(/[{}]/g, ""); }

    // ----- Requested Amount / Quantity visibility -----
    // Hide on Itemized Prios so users don't type values the post-create
    // plugin will clear. Itemized-ness is derived from the parent Requirement
    // having any Requirement Details.

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
            setControlsVisible(formContext, [REQUESTED_AMOUNT, QUANTITY], false);
            return;
        }
        hasRequirementDetails(lookup[0].id).then(
            function (hasRDs) { setControlsVisible(formContext, [REQUESTED_AMOUNT, QUANTITY], !hasRDs); },
            function ()        { setControlsVisible(formContext, [REQUESTED_AMOUNT, QUANTITY], false); }
        );
    }

    function applyItemizedVisibilityOnLoad(formContext) {
        if (formContext.ui.getFormType() === 2) {
            var mode = formContext.getAttribute(FUNDING_MODE).getValue();
            setControlsVisible(formContext, [REQUESTED_AMOUNT, QUANTITY], mode !== FUNDING_MODE_ITEMIZED);
            return;
        }
        setControlsVisible(formContext, [REQUESTED_AMOUNT, QUANTITY], false);
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
        },

        onRequirementFundingChange: function (executionContext) {
            applyFundCenterLock(executionContext.getFormContext());
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
