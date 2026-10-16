"""Place the TurnInBuilder control on the "Turn-In" main form (docs/TurnIn-FY27-Redesign.md).

Adds a one-column (full width) body section right after the header-fields section
"pri_section", with a second book_newamount cell bound to book_ARNGCheckbook.TurnInBuilder.
The existing numeric book_newamount cell stays (it now shows the item roll-up).

Idempotent: skipped once the section exists. Must be replicated in gov (maker portal:
add a one-column section, add Amount again, switch its control to TurnInBuilder).
Run from Checkbook/:  direnv exec . python3 devtools/sandbox-import/schema/turnin_place_builder.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi  # noqa: E402

FORM_NAME = "Turn-In"
CONTROL = "book_ARNGCheckbook.TurnInBuilder"
AFTER_SECTION = "pri_section"

# A cell bound to a PCF uses the custom-control host class id and MUST have a matching
# controlDescription (and vice versa) or the form save fails with 0x80160019.
PCF_HOST_CLASSID = "{F9A8A302-114E-466A-B582-6771B2AE0D92}"
DECIMAL_CLASSID = "{C3EFE0C3-0EC6-42BE-8349-CBD9079DFD8E}"

# Fixed ids so the script is idempotent.
SECTION_ID = "7a3e51c0-2f4d-4b8e-9c61-0d2b6e8f4a01"
CELL_ID = "{7a3e51c0-2f4d-4b8e-9c61-0d2b6e8f4a02}"
UNIQUE_ID = "{7a3e51c0-2f4d-4b8e-9c61-0d2b6e8f4a03}"

SECTION = (
    f'<section name="turnin_builder_section" id="{SECTION_ID}" IsUserDefined="0" locklevel="0" '
    'showlabel="false" showbar="false" layout="varwidth" celllabelalignment="Left" '
    'celllabelposition="Left" columns="1" labelwidth="115">'
    '<labels><label description="Turn-In Lines" languagecode="1033" /></labels>'
    f'<rows><row><cell id="{CELL_ID}" locklevel="0" colspan="1" rowspan="1" showlabel="false">'
    '<labels><label description="Turn-In Lines" languagecode="1033" /></labels>'
    f'<control id="book_newamount_builder" classid="{PCF_HOST_CLASSID}" '
    f'datafieldname="book_newamount" disabled="false" uniqueid="{UNIQUE_ID}" />'
    "</cell></row></rows></section>"
)

DESCRIPTION = (
    f'<controlDescription forControl="{UNIQUE_ID}">'
    f'<customControl id="{DECIMAL_CLASSID}"><parameters>'
    "<datafieldname>book_newamount</datafieldname></parameters></customControl>"
    + "".join(
        f'<customControl name="{CONTROL}" formFactor="{ff}"><parameters>'
        '<amount type="Decimal">book_newamount</amount>'
        "</parameters></customControl>"
        for ff in (0, 1, 2)
    )
    + "</controlDescription>"
)


def main():
    forms = dvapi.get(
        "systemforms?$select=name,formxml&$filter=objecttypecode%20eq%20%27book_turnin%27%20and%20type%20eq%202"
    )["value"]
    form = next(f for f in forms if f["name"] == FORM_NAME)
    xml = form["formxml"]
    if SECTION_ID in xml:
        print("builder section already placed — nothing to do")
        return

    host = re.search(r'<section [^>]*name="' + AFTER_SECTION + r'".*?</section>', xml, re.S)
    if not host:
        raise SystemExit(f'section "{AFTER_SECTION}" not found on form "{FORM_NAME}"')
    xml = xml[: host.end()] + SECTION + xml[host.end():]

    if "<controlDescriptions>" not in xml:
        raise SystemExit("form has no <controlDescriptions> block")
    xml = xml.replace("<controlDescriptions>", "<controlDescriptions>" + DESCRIPTION, 1)

    dvapi.patch("systemforms", form["formid"], {"formxml": xml})
    dvapi.action(
        "PublishXml",
        {"ParameterXml": "<importexportxml><entities><entity>book_turnin</entity></entities></importexportxml>"},
    )
    print("placed TurnInBuilder section and published")


if __name__ == "__main__":
    main()
