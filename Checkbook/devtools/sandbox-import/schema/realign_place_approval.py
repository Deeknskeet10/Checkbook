"""Place the RealignmentApprovalProcess chevron in the BODY of the "Realign Requirement" form.

The control was bound to book_name in the form HEADER, where the high-density header
does not render custom controls inline, so the approval bar never showed. This moves
the binding to a new one-column section at the top of the "Realignment Details" tab
(same body placement State Swap / Turn-In use) and leaves the header Name field plain.

It also moves the RealignmentBuilder cell (book_newamount) out of the two-column
"funding_details" section into its own one-column section, so the builder spans the
full form width instead of half of it.

Idempotent: each step is skipped once its section exists.
Run from Checkbook/:  direnv exec . python3 devtools/sandbox-import/schema/realign_place_approval.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-seed"))
import dvapi  # noqa: E402

FORM_NAME = "Realign Requirement"
MAIN_TAB = "Realignment Details"
CONTROL = "book_ARNGCheckbook.RealignmentApprovalProcess"

# A cell bound to a PCF uses the custom-control host class id and MUST have a matching
# controlDescription (and vice versa) or the form save fails with 0x80160019.
PCF_HOST_CLASSID = "{F9A8A302-114E-466A-B582-6771B2AE0D92}"
TEXT_CLASSID = "{4273EDBD-AC1D-40D3-9FB2-095C621B552D}"

# Fixed ids so the script is idempotent.
SECTION_ID = "5d0c1a52-7e0b-4f0e-9a57-1c7c5a3f9b01"
CELL_ID = "{5d0c1a52-7e0b-4f0e-9a57-1c7c5a3f9b02}"
UNIQUE_ID = "{5d0c1a52-7e0b-4f0e-9a57-1c7c5a3f9b03}"

BUILDER_SECTION_ID = "5d0c1a52-7e0b-4f0e-9a57-1c7c5a3f9b04"
BUILDER_SECTION_NAME = "builder_section"
BUILDER_FIELD = "book_newamount"


def place_builder_full_width(xml):
    """Move the builder cell into its own one-column section after funding_details."""
    if BUILDER_SECTION_ID in xml:
        return xml, False
    cell = re.search(
        r"<cell (?:(?!</cell>).)*?<control [^>]*datafieldname=\"" + BUILDER_FIELD
        + r"\"[^>]*classid=\"" + re.escape(PCF_HOST_CLASSID) + r"\"[^>]*/></cell>"
        r"|<cell (?:(?!</cell>).)*?<control [^>]*classid=\"" + re.escape(PCF_HOST_CLASSID)
        + r"\"[^>]*datafieldname=\"" + BUILDER_FIELD + r"\"[^>]*/></cell>",
        xml, re.S,
    )
    if not cell:
        raise SystemExit("builder cell (book_newamount bound to a PCF) not found")
    cell_xml = cell.group(0)
    xml = xml[: cell.start()] + xml[cell.end():]
    section = (
        f'<section name="{BUILDER_SECTION_NAME}" id="{BUILDER_SECTION_ID}" IsUserDefined="0" '
        'locklevel="0" showlabel="false" showbar="false" layout="varwidth" celllabelalignment="Left" '
        'celllabelposition="Left" columns="1" labelwidth="115">'
        '<labels><label description="Realignment Items" languagecode="1033" /></labels>'
        f"<rows><row>{cell_xml}</row></rows></section>"
    )
    host = re.search(r'<section name="funding_details".*?</section>', xml, re.S)
    if not host:
        raise SystemExit('section "funding_details" not found')
    return xml[: host.end()] + section + xml[host.end():], True


SECTION = (
    f'<section name="approval_section" id="{SECTION_ID}" IsUserDefined="0" locklevel="0" '
    'showlabel="false" showbar="false" layout="varwidth" celllabelalignment="Left" '
    'celllabelposition="Left" columns="1" labelwidth="115">'
    '<labels><label description="Approval" languagecode="1033" /></labels>'
    f'<rows><row><cell id="{CELL_ID}" locklevel="0" colspan="1" rowspan="1" showlabel="false">'
    '<labels><label description="Approval" languagecode="1033" /></labels>'
    f'<control id="book_name1" classid="{PCF_HOST_CLASSID}" '
    f'datafieldname="book_name" disabled="false" uniqueid="{UNIQUE_ID}" />'
    "</cell></row></rows></section>"
)

DESCRIPTION = (
    f'<controlDescription forControl="{UNIQUE_ID}">'
    '<customControl id="{4273EDBD-AC1D-40D3-9FB2-095C621B552D}"><parameters>'
    "<datafieldname>book_name</datafieldname></parameters></customControl>"
    + "".join(
        f'<customControl name="{CONTROL}" formFactor="{ff}"><parameters>'
        '<realignmentName type="SingleLine.Text">book_name</realignmentName>'
        "</parameters></customControl>"
        for ff in (0, 1, 2)
    )
    + "</controlDescription>"
)


def main():
    forms = dvapi.get(
        "systemforms?$select=name,formxml&$filter=objecttypecode%20eq%20%27book_realignments%27"
        "%20and%20type%20eq%202"
    )["value"]
    form = next(f for f in forms if f["name"] == FORM_NAME)
    xml = form["formxml"]

    xml, moved_builder = place_builder_full_width(xml)
    if UNIQUE_ID in xml:
        if moved_builder:
            publish(form["formid"], xml)
            print("moved builder to its own full-width section and published")
        else:
            print("approval + builder sections already placed — nothing to do")
        return

    # 1) Drop the header binding (any controlDescription for a header_* control that
    #    points at the approval control); the header Name field stays as a plain field.
    header = re.search(r"<header.*?</header>", xml, re.S)
    header_uids = re.findall(r'uniqueid="(\{[^"]+\})"', header.group(0)) if header else []
    removed = 0
    for uid in header_uids:
        pat = re.compile(
            r'<controlDescription forControl="' + re.escape(uid) + r'">.*?</controlDescription>', re.S
        )
        m = pat.search(xml)
        if m and CONTROL in m.group(0):
            xml = xml[: m.start()] + xml[m.end():]
            # Back to a plain text control, or the now-undescribed host cell is invalid.
            ctl = re.search(r'<control [^>]*uniqueid="' + re.escape(uid) + r'"[^>]*>', xml)
            xml = xml[: ctl.start()] + ctl.group(0).replace(PCF_HOST_CLASSID, TEXT_CLASSID) + xml[ctl.end():]
            removed += 1

    # 2) New section at the top of the main tab.
    tab = re.search(r'<tab [^>]*name="' + re.escape(MAIN_TAB) + r'"[^>]*>.*?<sections>', xml, re.S)
    if not tab:
        raise SystemExit(f'tab "{MAIN_TAB}" not found on form "{FORM_NAME}"')
    xml = xml[: tab.end()] + SECTION + xml[tab.end():]

    # 3) Bind the new cell to the PCF.
    if "<controlDescriptions>" not in xml:
        raise SystemExit("form has no <controlDescriptions> block")
    xml = xml.replace("<controlDescriptions>", "<controlDescriptions>" + DESCRIPTION, 1)

    publish(form["formid"], xml)
    print(f"placed approval section (removed {removed} header binding(s)) and published")


def publish(form_id, xml):
    dvapi.patch("systemforms", form_id, {"formxml": xml})
    dvapi.action(
        "PublishXml",
        {"ParameterXml": "<importexportxml><entities><entity>book_realignments</entity></entities></importexportxml>"},
    )


if __name__ == "__main__":
    main()
