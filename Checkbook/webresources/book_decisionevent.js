"use strict";
var Book = Book || {};
// Book.DecisionEvent — Decision Event main-form rollup refresh.
//
// Replaces book_calculateRollUp (old global → new handler):
//   decisionEventOnLoad → Book.DecisionEvent.onLoad
//
// Fixes from the old script:
//   - recalculateRollup referenced `formContext` whose declaration was
//     commented out (ReferenceError, so the post-recalc refresh never ran);
//     the declaration is restored by passing formContext in.
//   - The old refresh call was formContext.data.entity.refresh(), which is
//     not a Client API method — corrected to formContext.data.refresh(false).
//   - Skips recalculation on create forms (no record id yet).
Book.DecisionEvent = (function () {

    var ENTITY_SET   = "book_decisionevents";
    var ROLLUP_FIELD = "book_decisionbalance";

    function recalculateRollup(formContext, entitySet, entityId, fieldName) {
        var clientUrl = Xrm.Utility.getGlobalContext().getClientUrl();

        return fetch(
            clientUrl + "/api/data/v9.2/" +
            "CalculateRollupField(Target=@p1,FieldName=@p2)?" +
            "@p1={'@odata.id':'" + entitySet + "(" + entityId + ")'}&" +
            "@p2='" + fieldName + "'"
        ).then(function (response) {
            return response.json();
        }).then(function (data) {
            if (data.error) {
                console.log(data.error.message);
                return;
            }
            // Refresh the form so the recalculated rollup is displayed.
            formContext.data.refresh(false);
            console.log("Data Recalculated");
        }).catch(function (error) {
            console.error("Book.DecisionEvent rollup recalc failed: " +
                (error && error.message));
        });
    }

    return {
        onLoad: function (executionContext) {
            var formContext = executionContext.getFormContext();
            var entityId = (formContext.data.entity.getId() || "").replace(/[{}]/g, "");
            if (!entityId) return;

            recalculateRollup(formContext, ENTITY_SET, entityId, ROLLUP_FIELD);
        }
    };
})();
