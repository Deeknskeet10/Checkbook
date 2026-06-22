"use strict";
var Book = Book || {};
Book.Prioritization = (function () {
    var REQUESTED_AMOUNT = "book_newrequestedamount";
    var QUANTITY = "book_quantities";
    var REQUIREMENT = "book_requirement";
    var FUNDING_MODE = "book_fundingmode";
    var FUNDING_MODE_ITEMIZED = 1;

    function setVisible(formContext, visible) {
        [REQUESTED_AMOUNT, QUANTITY].forEach(function (name) {
            var ctrl = formContext.getControl(name);
            if (ctrl) ctrl.setVisible(visible);
        });
    }

    function hasRequirementDetails(requirementId) {
        var id = requirementId.replace(/[{}]/g, "");
        return Xrm.WebApi.retrieveMultipleRecords(
            "book_requirementdetails",
            "?$select=book_requirementdetailsid" +
            "&$filter=_book_requirement_value eq " + id +
            "&$top=1"
        ).then(function (result) {
            return result.entities.length > 0;
        });
    }

    function applyVisibilityFromRequirement(formContext) {
        var lookup = formContext.getAttribute(REQUIREMENT).getValue();
        if (!lookup || !lookup[0]) {
            setVisible(formContext, false);
            return;
        }
        hasRequirementDetails(lookup[0].id).then(
            function (hasRDs) { setVisible(formContext, !hasRDs); },
            function ()        { setVisible(formContext, false); }
        );
    }

    return {
        onLoad: function (executionContext) {
            var formContext = executionContext.getFormContext();
            var formType = formContext.ui.getFormType();

            if (formType === 2) {
                var mode = formContext.getAttribute(FUNDING_MODE).getValue();
                setVisible(formContext, mode !== FUNDING_MODE_ITEMIZED);
                return;
            }

            setVisible(formContext, false);
            applyVisibilityFromRequirement(formContext);
        },

        onRequirementChange: function (executionContext) {
            applyVisibilityFromRequirement(executionContext.getFormContext());
        }
    };
})();
