"use strict";
var Book = Book || {};
// Book.QuickCreate — generic quick-create parent-populate handlers.
//
// Replaces (old web resource / old global → new handler + designer parameter):
//   book_linRequestQC              linRequestQC          → Book.QuickCreate.populateParent, parameters: "book_prioritization"
//   book_turnInQC                  turnInQC              → Book.QuickCreate.populateParent, parameters: "book_turnin"
//   book_supplyQuickCreate         supplyQC (unreferenced) → delete, no replacement needed
//   book_updateObligationQuickCreate manageFieldVisibility → Book.QuickCreate.populateParentByType,
//       parameters: "book_prioritization:book_prioritization,book_requirements:book_requirement"
//
// Register on the quick-create form's OnLoad with "pass execution context"
// checked; the string above goes in the handler's comma-separated parameters
// box (quotes included).
Book.QuickCreate = (function () {

    // The record the quick-create was launched from, or null when opened
    // globally (e.g. the + button in the nav bar).
    function getParentReference() {
        var pageContext = Xrm.Utility.getPageContext();
        return (pageContext && pageContext.input && pageContext.input.createFromEntity) || null;
    }

    function toLookupValue(parentRef) {
        return [{
            id: parentRef.id,
            name: parentRef.name,
            entityType: parentRef.entityType
        }];
    }

    /**
     * Copies the launching record into the named lookup attribute.
     * @param {*} executionContext
     * @param {string} lookupAttributeName e.g. "book_prioritization"
     */
    function populateParent(executionContext, lookupAttributeName) {
        var formContext = executionContext.getFormContext();
        var parentRef = getParentReference();
        if (parentRef == null) return;

        var attr = formContext.getAttribute(lookupAttributeName);
        if (attr) attr.setValue(toLookupValue(parentRef));
    }

    /**
     * Entity-type-aware variant: picks the target lookup based on which
     * table the quick create was launched from, and hides the lookups that
     * don't apply (preserves book_updateObligationQuickCreate behavior).
     *
     * @param {*} executionContext
     * @param {string} mapString "parentEntity:lookupAttribute" pairs, comma
     *        separated, e.g. "book_prioritization:book_prioritization,book_requirements:book_requirement"
     *
     * When the parent matches a pair: that lookup is populated and every
     * OTHER mapped lookup is hidden. When launched from an unmapped entity:
     * all mapped lookups stay visible. When there is no parent at all
     * (opened globally): nothing happens — matching the original script.
     */
    function populateParentByType(executionContext, mapString) {
        var formContext = executionContext.getFormContext();
        var parentRef = getParentReference();
        if (parentRef == null) return;

        var pairs = String(mapString || "").split(",").map(function (p) {
            var parts = p.split(":");
            return { entity: parts[0].trim(), lookup: (parts[1] || "").trim() };
        }).filter(function (p) { return p.entity && p.lookup; });

        var matched = null;
        pairs.forEach(function (p) {
            if (p.entity === parentRef.entityType) matched = p;
        });

        pairs.forEach(function (p) {
            var control = formContext.getControl(p.lookup);
            if (!control) return;
            // Matched pair (or no match at all) → visible; others hidden.
            control.setVisible(matched === null || p === matched);
        });

        if (matched) {
            var attr = formContext.getAttribute(matched.lookup);
            if (attr) attr.setValue(toLookupValue(parentRef));
        }
    }

    return {
        populateParent: populateParent,
        populateParentByType: populateParentByType
    };
})();
