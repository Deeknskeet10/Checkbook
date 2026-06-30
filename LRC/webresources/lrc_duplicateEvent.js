"use strict";

var LRC = LRC || {};
LRC.Event = LRC.Event || {};

(function () {
    LRC.Event.openDuplicateDialog = function (primaryControl) {
        var formContext = primaryControl;
        var idAttr = formContext.data && formContext.data.entity && formContext.data.entity.getId();
        if (!idAttr) {
            formContext.ui.setFormNotification(
                "Save the event before duplicating it.",
                "WARNING",
                "lrc_duplicate_unsaved"
            );
            setTimeout(function () {
                formContext.ui.clearFormNotification("lrc_duplicate_unsaved");
            }, 5000);
            return;
        }
        var sourceId = idAttr.replace(/[{}]/g, "");

        var pageInput = {
            pageType: "webresource",
            webresourceName: "lrc_duplicateEventDialog.html",
            data: encodeURIComponent(JSON.stringify({ sourceId: sourceId }))
        };
        var navOptions = {
            target: 2,
            position: 1,
            width: { value: 480, unit: "px" },
            height: { value: 360, unit: "px" },
            title: "Duplicate Event"
        };

        Xrm.Navigation.navigateTo(pageInput, navOptions).then(
            function () {
                if (formContext.data && formContext.data.refresh) {
                    formContext.data.refresh(false);
                }
            },
            function (err) {
                console.error("Duplicate dialog error:", err);
            }
        );
    };

    LRC.Event.canDuplicate = function (primaryControl) {
        if (!primaryControl || !primaryControl.data || !primaryControl.data.entity) return false;
        var id = primaryControl.data.entity.getId();
        return !!id;
    };
})();
