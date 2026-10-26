"""Place the SwapBuilder control on the "Information" State Swap main form
(docs/StateSwap-FY27-Redesign.md §7) and wire the Book.StateSwap form library.

1. Creates / updates web resource book_StateSwaps from webresources/State-Swaps.js.
2. Adds a one-column (full width) body section right after "Overview" (null_section_3,
   which holds the legacy Swap Items subgrid) with a book_totalsentbya cell bound to
   book_ARNGCheckbook.SwapBuilder (control id book_totalsentbya_builder).
3. Adds the book_StateSwaps library + OnLoad handler Book.StateSwap.onLoad, which hides
   the subgrid on FY27+ and the builder on FY26.

Idempotent: each step is skipped once done (the web resource content is always refreshed).
Must be replicated in gov (maker portal: upload the web resource, add a one-column
section, add Total Sent by A, switch its control to SwapBuilder, add the library and the
OnLoad handler with "pass execution context").
Run from Checkbook/:  direnv exec . python3 devtools/sandbox-import/schema/swap_place_builder.py
"""
import base64
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi  # noqa: E402

FORM_NAME = "Information"
CONTROL = "book_ARNGCheckbook.SwapBuilder"
FIELD = "book_totalsentbya"
AFTER_SECTION = "null_section_3"
WR_NAME = "book_StateSwaps"
WR_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "..", "webresources", "State-Swaps.js")

# A cell bound to a PCF uses the custom-control host class id and MUST have a matching
# controlDescription (and vice versa) or the form save fails with 0x80160019.
PCF_HOST_CLASSID = "{F9A8A302-114E-466A-B582-6771B2AE0D92}"
DECIMAL_CLASSID = "{C3EFE0C3-0EC6-42BE-8349-CBD9079DFD8E}"

# Fixed ids so the script is idempotent.
SECTION_ID = "5c2b8e10-6a1d-4f3e-9b72-3e4d1a7c9f01"
CELL_ID = "{5c2b8e10-6a1d-4f3e-9b72-3e4d1a7c9f02}"
UNIQUE_ID = "{5c2b8e10-6a1d-4f3e-9b72-3e4d1a7c9f03}"
LIBRARY_ID = "{5c2b8e10-6a1d-4f3e-9b72-3e4d1a7c9f04}"
HANDLER_ID = "{5c2b8e10-6a1d-4f3e-9b72-3e4d1a7c9f05}"

SECTION = (
    f'<section name="swap_builder_section" id="{SECTION_ID}" IsUserDefined="0" locklevel="0" '
    'showlabel="false" showbar="false" layout="varwidth" celllabelalignment="Left" '
    'celllabelposition="Left" columns="1" labelwidth="115">'
    '<labels><label description="Swap Legs" languagecode="1033" /></labels>'
    f'<rows><row><cell id="{CELL_ID}" locklevel="0" colspan="1" rowspan="1" showlabel="false">'
    '<labels><label description="Swap Legs" languagecode="1033" /></labels>'
    f'<control id="{FIELD}_builder" classid="{PCF_HOST_CLASSID}" '
    f'datafieldname="{FIELD}" disabled="false" uniqueid="{UNIQUE_ID}" />'
    "</cell></row></rows></section>"
)

DESCRIPTION = (
    f'<controlDescription forControl="{UNIQUE_ID}">'
    f'<customControl id="{DECIMAL_CLASSID}"><parameters>'
    f"<datafieldname>{FIELD}</datafieldname></parameters></customControl>"
    + "".join(
        f'<customControl name="{CONTROL}" formFactor="{ff}"><parameters>'
        f'<amount type="Decimal">{FIELD}</amount>'
        "</parameters></customControl>"
        for ff in (0, 1, 2)
    )
    + "</controlDescription>"
)

LIBRARY = f'<Library name="{WR_NAME}" libraryUniqueId="{LIBRARY_ID}" />'
HANDLER = (
    f'<Handler functionName="Book.StateSwap.onLoad" libraryName="{WR_NAME}" handlerUniqueId="{HANDLER_ID}" '
    'enabled="true" parameters="" passExecutionContext="true" />'
)


def upsert_web_resource():
    with open(WR_FILE, "rb") as fh:
        content = base64.b64encode(fh.read()).decode()
    found = dvapi.get(f"webresourceset?$select=webresourceid&$filter=name%20eq%20%27{WR_NAME}%27")["value"]
    if found:
        dvapi.patch("webresourceset", found[0]["webresourceid"], {"content": content})
        print("updated web resource", WR_NAME)
        return found[0]["webresourceid"]
    wid = dvapi.post("webresourceset", {
        "name": WR_NAME, "displayname": "State Swaps", "webresourcetype": 3, "content": content,
        "description": "Book.StateSwap form library for the State Swap main form.",
    })
    print("created web resource", WR_NAME)
    return wid


def place(xml):
    if SECTION_ID in xml:
        print("builder section already placed")
        return xml
    host = re.search(r'<section [^>]*name="' + AFTER_SECTION + r'".*?</section>', xml, re.S)
    if not host:
        raise SystemExit(f'section "{AFTER_SECTION}" not found on form "{FORM_NAME}"')
    xml = xml[: host.end()] + SECTION + xml[host.end():]
    if "<controlDescriptions>" not in xml:
        raise SystemExit("form has no <controlDescriptions> block")
    print("placed builder section")
    return xml.replace("<controlDescriptions>", "<controlDescriptions>" + DESCRIPTION, 1)


def wire(xml):
    if HANDLER_ID in xml:
        print("form library + OnLoad handler already wired")
        return xml
    if "<formLibraries>" in xml:
        xml = xml.replace("<formLibraries>", "<formLibraries>" + LIBRARY, 1)
    else:
        xml = xml.replace("</footer>", "</footer><formLibraries>" + LIBRARY + "</formLibraries>", 1)
    onload = re.search(r'<event name="onload"[^>]*><Handlers>', xml)
    if onload:
        xml = xml[: onload.end()] + HANDLER + xml[onload.end():]
    elif "<events>" in xml:
        xml = xml.replace("<events>", '<events><event name="onload" application="false" active="false"><Handlers>'
                          + HANDLER + "</Handlers></event>", 1)
    else:
        xml = xml.replace("</form>", '<events><event name="onload" application="false" active="false"><Handlers>'
                          + HANDLER + "</Handlers></event></events></form>", 1)
    print("wired form library + OnLoad handler")
    return xml


def main():
    wid = upsert_web_resource()
    forms = dvapi.get(
        "systemforms?$select=name,formxml&$filter=objecttypecode%20eq%20%27book_stateswap%27%20and%20type%20eq%202"
    )["value"]
    form = next(f for f in forms if f["name"] == FORM_NAME)
    xml = wire(place(form["formxml"]))
    if xml != form["formxml"]:
        dvapi.patch("systemforms", form["formid"], {"formxml": xml})
    dvapi.action(
        "PublishXml",
        {"ParameterXml": "<importexportxml><entities><entity>book_stateswap</entity></entities>"
                         f"<webresources><webresource>{{{wid}}}</webresource></webresources></importexportxml>"},
    )
    print("published")


if __name__ == "__main__":
    main()
