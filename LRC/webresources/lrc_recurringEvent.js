"use strict";

var LRC = LRC || {};
LRC.Event = LRC.Event || {};

(function () {
    LRC.Event.openRecurringDialog = function (primaryControl) {
        var formContext = primaryControl;
        var idAttr = formContext.data && formContext.data.entity && formContext.data.entity.getId();
        if (!idAttr) {
            formContext.ui.setFormNotification(
                "Save the event before making it recurring.",
                "WARNING",
                "lrc_recurring_unsaved"
            );
            setTimeout(function () {
                formContext.ui.clearFormNotification("lrc_recurring_unsaved");
            }, 5000);
            return;
        }
        var sourceId = idAttr.replace(/[{}]/g, "");

        var pageInput = {
            pageType: "webresource",
            webresourceName: "lrc_recurringEventDialog.html",
            data: encodeURIComponent(JSON.stringify({ sourceId: sourceId }))
        };
        var navOptions = {
            target: 2,
            position: 1,
            width: { value: 520, unit: "px" },
            height: { value: 560, unit: "px" },
            title: "Make Event Recurring"
        };

        Xrm.Navigation.navigateTo(pageInput, navOptions).then(
            function () {
                if (formContext.data && formContext.data.refresh) {
                    formContext.data.refresh(false);
                }
            },
            function (err) {
                console.error("Recurring dialog error:", err);
            }
        );
    };
})();
