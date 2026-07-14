"use strict";
var Book = Book || {};
// Book.SpendPlanValidate — Spend Plan monthly-allocation validation.
//
// Replaces book_spendPlanValidate (old handler → new handler):
//   Book.SpendPlan.onFormLoad → Book.SpendPlanValidate.onLoad
//   Book.SpendPlan.onFormSave → Book.SpendPlanValidate.onSave
//
// Fix from the old script: the Prioritization quick view (qvPri) toggle
// compared the book_spendplantype attribute OBJECT to "Prioritization"
// (missing .getValue()), so the quick view never showed. Everything else is
// preserved — the validation is pure client-side arithmetic (no server calls).
Book.SpendPlanValidate = (function () {

    var NOTIFICATION_ID         = "spendplan_validation_error";
    var NOTIFICATION_ID_SUCCESS = "spendplan_validation_success";
    var PRECISION_TOLERANCE = 0.01; // 1 cent tolerance for floating-point error

    var TOTAL_FIELD      = "book_newtotaltdp";
    var SPEND_PLAN_TYPE  = "book_spendplantype";
    var QV_PRIORITIZATION = "qvPri";

    var MONTH_FIELDS = [
        "book_january", "book_february", "book_march", "book_april",
        "book_may", "book_june", "book_july", "book_august",
        "book_september", "book_october", "book_november", "book_december"
    ];

    function roundToCurrency(value) {
        if (value === null || value === undefined) return 0.00;
        return Math.round(value * 100) / 100;
    }

    function formatCurrency(value) {
        if (value === null || value === undefined) return "$0.00";
        return "$" + value.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function onLoad(executionContext) {
        var formContext = executionContext.getFormContext();

        clearAllNotifications(formContext);

        MONTH_FIELDS.forEach(function (fieldName) {
            var attr = formContext.getAttribute(fieldName);
            if (attr) attr.addOnChange(onMonthChange);
        });

        var totalAttr = formContext.getAttribute(TOTAL_FIELD);
        if (totalAttr) totalAttr.addOnChange(onMonthChange);

        // Show the Prioritization quick view only for Prioritization spend
        // plans (book_spendplantype is a text column).
        var typeAttr = formContext.getAttribute(SPEND_PLAN_TYPE);
        var spendPlanType = typeAttr ? typeAttr.getValue() : null;
        var qvToHide = formContext.getControl(QV_PRIORITIZATION);
        if (qvToHide) {
            qvToHide.setVisible(spendPlanType === "Prioritization");
        }

        validateSpendPlan(formContext);
    }

    function onMonthChange(executionContext) {
        validateSpendPlan(executionContext.getFormContext());
    }

    function onSave(executionContext) {
        var formContext = executionContext.getFormContext();
        var eventArgs = executionContext.getEventArgs();

        clearAllNotifications(formContext);

        var validation = calculateSpendPlanTotals(formContext);

        if (validation.isOverAllocated) {
            eventArgs.preventDefault();
            formContext.ui.setFormNotification(
                buildErrorMessage(validation), "ERROR", NOTIFICATION_ID);
            focusFirstPopulatedMonth(formContext);
        }
    }

    function validateSpendPlan(formContext) {
        clearAllNotifications(formContext);

        var validation = calculateSpendPlanTotals(formContext);

        if (validation.total === null) return; // no total set — can't validate

        if (validation.isOverAllocated) {
            formContext.ui.setFormNotification(
                buildErrorMessage(validation), "ERROR", NOTIFICATION_ID);
            highlightOverAllocated(formContext, true);
        } else {
            formContext.ui.setFormNotification(
                "Spend Plan valid. " +
                "Total Budget: " + formatCurrency(validation.total) + " | " +
                "Allocated: " + formatCurrency(validation.spendPlanTotal) + " | " +
                "Remaining: " + formatCurrency(validation.availableAmount),
                "INFO", NOTIFICATION_ID_SUCCESS);
            highlightOverAllocated(formContext, false);
        }
    }

    function calculateSpendPlanTotals(formContext) {
        var totalAttr = formContext.getAttribute(TOTAL_FIELD);
        var total = totalAttr ? totalAttr.getValue() : null;

        var spendPlanTotal = 0;
        var monthlyBreakdown = {};

        MONTH_FIELDS.forEach(function (fieldName) {
            var attr = formContext.getAttribute(fieldName);
            var value = roundToCurrency(attr ? attr.getValue() : 0.00);
            spendPlanTotal += value;
            monthlyBreakdown[fieldName] = value;
        });

        spendPlanTotal = roundToCurrency(spendPlanTotal);
        total = roundToCurrency(total);

        var availableAmount = roundToCurrency(total - spendPlanTotal);
        var isOverAllocated = total !== null &&
            (spendPlanTotal - total) > PRECISION_TOLERANCE;
        var overageAmount = isOverAllocated
            ? roundToCurrency(spendPlanTotal - total) : 0.00;

        return {
            total: total,
            spendPlanTotal: spendPlanTotal,
            availableAmount: availableAmount,
            isOverAllocated: isOverAllocated,
            overageAmount: overageAmount,
            monthlyBreakdown: monthlyBreakdown
        };
    }

    function buildErrorMessage(validation) {
        return "Spend Plan exceeds available budget. " +
            "Total Budget: " + formatCurrency(validation.total) + " | " +
            "Allocated: " + formatCurrency(validation.spendPlanTotal) + " | " +
            "Over by: " + formatCurrency(validation.overageAmount);
    }

    function highlightOverAllocated(formContext, showError) {
        MONTH_FIELDS.forEach(function (fieldName) {
            var control = formContext.getControl(fieldName);
            if (!control) return;
            if (showError) {
                control.setNotification("Review allocation", "month_allocation_warning");
            } else {
                control.clearNotification("month_allocation_warning");
            }
        });
    }

    function focusFirstPopulatedMonth(formContext) {
        for (var i = 0; i < MONTH_FIELDS.length; i++) {
            var attr = formContext.getAttribute(MONTH_FIELDS[i]);
            var value = attr ? attr.getValue() : null;
            if (value && value > 0) {
                var control = formContext.getControl(MONTH_FIELDS[i]);
                if (control) control.setFocus();
                return;
            }
        }
    }

    function clearAllNotifications(formContext) {
        formContext.ui.clearFormNotification(NOTIFICATION_ID);
        formContext.ui.clearFormNotification(NOTIFICATION_ID_SUCCESS);
        MONTH_FIELDS.forEach(function (fieldName) {
            var control = formContext.getControl(fieldName);
            if (control) control.clearNotification("month_allocation_warning");
        });
    }

    return {
        onLoad: onLoad,
        onSave: onSave
    };
})();
