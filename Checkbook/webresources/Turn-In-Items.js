"use strict";
var Book = Book || {};
// Book.TurnInItem — form behavior for the book_turninitem (Turn-In Items) form.
//
// Replaces (old web resource / old global → new handler):
//   book_turnInFilterForm   TurnInItem.onLoad   → Book.TurnInItem.onLoad
//
// (The Items quick-create populate handler that used to live alongside this,
//  book_turnInQC, is retired separately in favor of the generic
//  Book.QuickCreate.populateParent — see WIRING.md §3.)
//
// On load, reads the parent Turn-In's Fund / PG / Fiscal Year / Fund Center and:
//   • scopes the Requirement Funding lookup to LOAs matching that Fund+PG+FY, and
//   • scopes the Prioritization lookup to any Fund Center within the Turn-In's
//     STATE (resolved from the Turn-In's state-level Fund Center), not just the
//     exact Fund Center.
//
// Wire on the book_turninitem form (with "Pass execution context" checked):
//   • OnLoad → Book.TurnInItem.onLoad
//
// Form prerequisites: lookup controls book_turnin, book_requirementfunding,
// book_prioritization (the script no-ops gracefully if a control is missing).
Book.TurnInItem = (function () {

  // Parent Turn-In context, resolved on load and read by the pre-search filters.
  var parentData = {
    fundId: null,
    pgId: null,
    fiscalYear: null,
    fundCenterId: null,
    stateId: null
  };

  function onLoad(executionContext) {
    var formContext = executionContext.getFormContext();

    var turnInAttr = formContext.getAttribute("book_turnin");
    var turnInValue = turnInAttr ? turnInAttr.getValue() : null;

    if (turnInValue && turnInValue.length > 0) {
      var turnInId = turnInValue[0].id.replace("{", "").replace("}", "");
      fetchParentData(turnInId, formContext);
    }
  }

  function fetchParentData(turnInId, formContext) {
    Xrm.WebApi.retrieveRecord("book_turnin", turnInId,
      "?$select=_book_fund_value,_book_pg_value,book_fiscalyear,_book_fundcenter_value"
    ).then(
      function (result) {
        parentData.fundId = result._book_fund_value;
        parentData.pgId = result._book_pg_value;
        parentData.fiscalYear = result.book_fiscalyear;
        parentData.fundCenterId = result._book_fundcenter_value;

        // Set up Requirement Funding custom view
        var reqFundingControl = formContext.getControl("book_requirementfunding");
        if (reqFundingControl && parentData.fundId && parentData.pgId && parentData.fiscalYear) {
          setRequirementFundingView(reqFundingControl);
        }

        // The Turn-In's Fund Center is the state-level (level 3, e.g. A18TX).
        // Prioritizations should be selectable from ANY Fund Center in that
        // state, so resolve the Fund Center's State and filter Prioritizations
        // by book_state rather than by the exact Fund Center.
        if (parentData.fundCenterId) {
          fetchFundCenterState(parentData.fundCenterId, formContext);
        }
      },
      function (error) {
        console.log("Error fetching parent Turn-In data: " + error.message);
      }
    );
  }

  function fetchFundCenterState(fundCenterId, formContext) {
    Xrm.WebApi.retrieveRecord("book_fundcenter", fundCenterId,
      "?$select=_book_state_value"
    ).then(
      function (result) {
        parentData.stateId = result._book_state_value;

        var prioritizationControl = formContext.getControl("book_prioritization");
        if (prioritizationControl) {
          prioritizationControl.addPreSearch(filterPrioritizations);
        }
      },
      function (error) {
        console.log("Error fetching Fund Center state: " + error.message);
      }
    );
  }

  function setRequirementFundingView(control) {
    var viewId = "00000000-0000-0000-0000-000000000001"; // Random GUID for custom view
    var entityName = "book_requirementfunding";
    var viewDisplayName = "Filtered Requirement Fundings";

    var fetchXml = `
      <fetch version="1.0" output-format="xml-platform" mapping="logical" distinct="true">
        <entity name="book_requirementfunding">
          <attribute name="book_requirementfundingid" />
          <attribute name="book_name" />
          <filter type="and">
            <condition attribute="statecode" operator="eq" value="0" />
          </filter>
          <link-entity name="book_fundingline" from="book_fundinglineid" to="book_lineofaccounting" alias="loa">
            <filter type="and">
              <condition attribute="book_fund" operator="eq" value="${parentData.fundId}" />
              <condition attribute="book_pg" operator="eq" value="${parentData.pgId}" />
              <condition attribute="book_fiscalyear" operator="eq" value="${parentData.fiscalYear}" />
            </filter>
          </link-entity>
          <order attribute="book_name" descending="false" />
        </entity>
      </fetch>
    `;

    var layoutXml = `
      <grid name="resultset" object="1" jump="book_name" select="1" icon="1" preview="1">
        <row name="result" id="book_requirementfundingid">
          <cell name="book_name" width="300" />
        </row>
      </grid>
    `;

    control.addCustomView(viewId, entityName, viewDisplayName, fetchXml, layoutXml, true);
  }

  function filterPrioritizations(executionContext) {
    var formContext = executionContext.getFormContext();

    if (!parentData.stateId) {
      return;
    }

    // Allow Prioritizations from any Fund Center within the Turn-In's state.
    var filter = `
      <filter type="and">
        <condition attribute="statecode" operator="eq" value="0" />
        <condition attribute="book_state" operator="eq" value="${parentData.stateId}" />
      </filter>
    `;

    formContext.getControl("book_prioritization").addCustomFilter(filter, "book_prioritization");
  }

  return {
    onLoad: onLoad
  };
})();
