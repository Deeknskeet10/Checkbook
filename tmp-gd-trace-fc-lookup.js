// TEMP debug helper — safe to delete.
// Reconciles the GenerateDistributions sweep math from LIVE records at one FC,
// independent of the plugin trace. Reproduces:
//     target       = funded TDP × AFP distribution %
//     immutableNet = Σ committed AFP credits − Σ committed AFP debits at the FC
//     delta        = target − immutableNet     (delta < 0 ⇒ Sweep Turn-In = -delta)
//
// It reads immutableNet + the AFP % straight from Dataverse, then shows what
// funded-TDP the plugin must be seeing to justify the observed sweep. Compare
// that implied TDP to the ~5M you expect — the gap is the bug.
//
// HOW TO RUN: model-driven app page → F12 → Console → paste. FC below is A18NE.

(async () => {
  const FC_GUID = "106453ad-3c45-f011-877a-001dd805a15f"; // A18NE
  const HOLDING_FC = "";  // optional: holding FC guid; leave "" — only affects a debit edge case
  const money = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const fv = (r, k) => r[k + "@OData.Community.Display.V1.FormattedValue"];

  // ── 1. The sweep turn-in(s) at this FC ──────────────────────────────────────
  const tins = (await Xrm.WebApi.retrieveMultipleRecords("book_turnin",
    "?$select=book_afpamount,book_allotmentamount,book_newamount,book_fiscalyear,book_origin," +
    "statecode,createdon,_book_fund_value,_book_pg_value" +
    "&$filter=_book_fundcenter_value eq " + FC_GUID + " and book_origin eq 1" +
    "&$orderby=createdon desc&$top=10")).entities;

  if (!tins.length) { console.warn("No Origin=Sweep turn-ins at this FC. Check the FC guid."); return; }

  console.group("%cSweep Turn-Ins at FC " + FC_GUID, "font-weight:bold");
  tins.forEach((t, i) => console.log(
    `[${i}] ${new Date(t.createdon).toLocaleString()} · ${fv(t,"statecode")} · ` +
    `Fund=${fv(t,"_book_fund_value")} · SAG=${fv(t,"_book_pg_value")} · ` +
    `AFP=${money(t.book_afpamount||0)} · Allot=${money(t.book_allotmentamount||0)} · TDP(newamount)=${money(t.book_newamount||0)}`));
  console.groupEnd();

  const sweep = tins[0];
  const fundId = sweep._book_fund_value, pgId = sweep._book_pg_value;
  const sweepAFP = sweep.book_afpamount || 0;
  console.log(`%cReconciling newest sweep — Fund=${fv(sweep,"_book_fund_value")}, SAG=${fv(sweep,"_book_pg_value")}, AFP overage=${money(sweepAFP)}`, "font-weight:bold;color:#a0a");

  // ── 2. All active distributions at this FC for that Fund/SAG ────────────────
  const dists = (await Xrm.WebApi.retrieveMultipleRecords("book_distributions",
    "?$select=book_newamount,book_disbursementdirection,book_entrydocumentnumber,book_manualentry," +
    "book_newenteredintogfebs,createdon,_book_turnin_value,_book_stateswap_value,_book_realignment_value," +
    "_book_debiteddistribution_value,_book_fundingevent_value" +
    "&$filter=_book_fundcenter_value eq " + FC_GUID + " and _book_fund_value eq " + fundId +
    " and _book_newpgsag_value eq " + pgId + " and statecode eq 0" +
    "&$orderby=createdon asc")).entities;

  // Resolve funding-event types (AFP=0 / Allotment=1) for the rows.
  const feIds = [...new Set(dists.map(d => d._book_fundingevent_value).filter(Boolean))];
  const feType = {};
  await Promise.all(feIds.map(async id => {
    try { const fe = await Xrm.WebApi.retrieveRecord("book_fundingevent", id, "?$select=book_fundingtype,book_name,statecode");
      feType[id] = { type: fe.book_fundingtype, name: fe.book_name, active: fe.statecode === 0 }; }
    catch { feType[id] = { type: null, name: "(missing)", active: false }; }
  }));

  let immCredits = 0, immDebits = 0, pending = 0, excluded = 0;
  console.group("%cActive distributions at FC (Fund/SAG matched)", "font-weight:bold");
  dists.forEach(d => {
    const amt = d.book_newamount || 0;
    const dir = d.book_disbursementdirection;          // 0 credit, 1 debit
    const fe  = d._book_fundingevent_value ? feType[d._book_fundingevent_value] : null;
    const isAFP = fe && fe.type === 0;
    const entered = !!d.book_entrydocumentnumber;
    const manual  = d.book_manualentry === true;
    const linked  = d._book_turnin_value || d._book_stateswap_value || d._book_realignment_value;
    // Plugin's immutable rule (approx; the "credit paired to an entered debit" nuance omitted):
    const immutable = entered || manual || !!linked || dir === 1;

    let bucket;
    if (!isAFP) { bucket = "EXCLUDED (not an active AFP funding event)"; excluded += amt; }
    else if (!immutable && dir === 0) { bucket = "pending sweep credit (amendable)"; pending += amt; }
    else if (dir === 0) { bucket = "immutable CREDIT (+net)"; immCredits += amt; }
    else { bucket = "immutable DEBIT (−net)"; immDebits += amt; }

    const tags = [entered && "ENTERED:" + d.book_entrydocumentnumber, manual && "MANUAL",
      d._book_turnin_value && "→turnin", d._book_stateswap_value && "→swap",
      d._book_realignment_value && "→realign", d._book_debiteddistribution_value && "hasDebitRef"]
      .filter(Boolean).join(" ");
    console.log(`${fv(d,"book_disbursementdirection")||dir} ${money(amt)} · FE=${fe?fe.name:"(none)"}` +
      `${isAFP?"":" [type "+(fe?fe.type:"—")+"]"} · ${bucket}${tags?" · "+tags:""}`);
  });
  console.groupEnd();

  const immutableNet = immCredits - immDebits;

  // ── 3. AFP distribution percentage from FundingDetails ─────────────────────
  const fds = (await Xrm.WebApi.retrieveMultipleRecords("book_fundingdetails",
    "?$select=book_distributionpercentage,_book_fundingevent_value" +
    "&$filter=_book_fund_value eq " + fundId + " and _book_pgsag_value eq " + pgId + " and statecode eq 0")).entities;
  await Promise.all(fds.map(async f => { const id = f._book_fundingevent_value;
    if (id && !feType[id]) { try { const fe = await Xrm.WebApi.retrieveRecord("book_fundingevent", id, "?$select=book_fundingtype,book_name,statecode");
      feType[id] = { type: fe.book_fundingtype, name: fe.book_name, active: fe.statecode === 0 }; } catch {} } }));
  const afpFd = fds.find(f => { const t = feType[f._book_fundingevent_value]; return t && t.type === 0 && t.active; });
  const pct = afpFd ? (afpFd.book_distributionpercentage || 0) : null;

  // ── 4. The verdict ─────────────────────────────────────────────────────────
  console.group("%c══ RECONCILIATION ══", "font-weight:bold;color:#08f");
  console.log(`immutable AFP credits   = ${money(immCredits)}`);
  console.log(`immutable AFP debits    = ${money(immDebits)}`);
  console.log(`immutableNet at FC      = ${money(immutableNet)}   ← what the plugin compares target against`);
  console.log(`pending sweep credits   = ${money(pending)}   (amendable; not part of immutableNet)`);
  console.log(`AFP distribution %      = ${pct === null ? "NO ACTIVE AFP FundingDetails ROW!" : pct + "%"}`);
  console.log(`observed sweep AFP      = ${money(sweepAFP)}`);
  console.log("%c" + "─".repeat(50), "color:#ccc");
  const impliedTarget = immutableNet - sweepAFP;   // delta=-sweepAFP ⇒ target = immutableNet - sweepAFP
  console.log(`⇒ plugin's implied target (immutableNet − sweep) = ${money(impliedTarget)}`);
  if (pct) console.log(`⇒ implied funded TDP (target ÷ %)               = ${money(impliedTarget / (pct/100))}`);
  console.log("%cCompare implied funded TDP to the ~5M you expect on the Prioritizations.", "color:#080");
  console.log("• If AFP % < 100 and implied TDP ≈ 5M → the sweep is the % scaling working as designed (Scenario A).");
  console.log("• If AFP % = 100 and immutableNet ≈ 7.25M → committed rows are double-counted; the list above shows the extra 2.25M (Scenario B).");
  console.log("• If NO active AFP FundingDetails row → the group would be SKIPPED, not swept — means a stale/duplicate FundingDetails or FundingEvent is in play.");
  console.groupEnd();
})();
