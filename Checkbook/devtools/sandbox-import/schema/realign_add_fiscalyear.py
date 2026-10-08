#!/usr/bin/env python3
"""Add an EDITABLE Fiscal Year picklist to book_realignments.

The existing book_fiscalyear is a formula/calculated column (SourceType=3,
not valid for create/update) so it cannot be picked on the form. Mirror the
cross-table convention (book_prioritization.book_newfiscalyear): a new
book_newfiscalyear picklist bound to the shared global `goal_fiscalyear` choice
set, so its values line up with the Prioritizations' FY. The RealignmentBuilder
PCF reads this to filter Prioritizations by FY. Added to the ARNGCheckbook
solution; idempotent. See docs/Realignment-FY27-Redesign.md §5 and
[[fiscalyear-is-picklist]]."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi

SOLUTION = "ARNGCheckbook"
ENTITY = "book_realignments"
ATTR = "book_newfiscalyear"
GOAL_FY_OPTIONSET_ID = "9a55fd63-f113-df11-a16e-00155d7aa40d"  # global goal_fiscalyear

def L(text):
    return {"@odata.type": "Microsoft.Dynamics.CRM.Label",
            "LocalizedLabels": [{"@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel",
                                 "Label": text, "LanguageCode": 1033}]}

def exists_attr(entity, attr):
    try:
        dvapi.get("EntityDefinitions(LogicalName='%s')/Attributes(LogicalName='%s')?$select=LogicalName"
                  % (entity, attr))
        return True
    except Exception:
        return False

if exists_attr(ENTITY, ATTR):
    print(ATTR, "already exists")
else:
    body = {
        "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
        "SchemaName": "book_newFiscalYear",
        "AttributeTypeName": {"Value": "PicklistType"},
        "RequiredLevel": {"Value": "None"},
        "DisplayName": L("Fiscal Year"),
        "Description": L("Editable Fiscal Year for the realignment (goal_fiscalyear choice); "
                         "the formula book_fiscalyear cannot be picked."),
        "GlobalOptionSet@odata.bind": "/GlobalOptionSetDefinitions(%s)" % GOAL_FY_OPTIONSET_ID,
    }
    h = {"MSCRM.SolutionUniqueName": SOLUTION}
    dvapi._req("POST", "EntityDefinitions(LogicalName='%s')/Attributes" % ENTITY, body, h)
    print("+ created", ATTR, "(goal_fiscalyear)")

print("publishing...")
dvapi.action("PublishAllXml", {})
print("done.")
