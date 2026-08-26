# TEMP — Nebraska A18NE Sweep Turn-In diagnostic (resolve the distribution %)

**Scratch/diagnostic file — delete once the Nebraska turn-in is understood.**

## Symptom

Fund `206510D26-BASE-BASE`, PG `121`, FC `A18NE` (Nebraska):

- Prioritization funded (`book_newfundedamounttdp`, verbatim Phase 2 fetch, filtered to
  this fund/PG) = **4,967,954**
- Distributions at A18NE = **4,967,954** — all single-type AFP credits (`dir=0`, `ftype=0`),
  no debits (debit lives at the holding FC)
- Distribution percentage believed to be **97%** → expected Sweep Turn-In ≈ **149,038.62**
- Actual Sweep Turn-In = **2,331,899**  ← the anomaly

## Why this fetch

The turn-in is `immutableNet − target`, where `target = funded × pct`
(`DistributionBucketProcessor.cs:108-110`). `immutableNet` is capped at the 4,967,954 of
credits physically at A18NE (nothing subtracts). With `funded` confirmed = 4,967,954, the
math pins the only remaining variable:

```
2,331,899 = 4,967,954 − 4,967,954 × pct   →   pct ≈ 0.5306 (53%)
```

So the plugin is resolving ~53%, not 97%. `pct` comes *only* from
`FundingPercentageHelper.Resolve` (`FundingPercentageHelper.cs:73-128`), which reads
`book_distributionpercentage` off the `book_fundingdetails` row whose **FundingEvent's
[StartDate, EndDate] window covers today** and whose type = AFP. This fetch reproduces that
resolution so we can see the actual percentage + which event it resolves to.

As-of date = `DateTime.UtcNow.Date` (use today's date in the two date conditions).

## Fetch — replicates FundingPercentageHelper.Resolve (Fund 206510D26 / PG 121 / AFP)

```xml
<fetch no-lock='true'>
  <entity name='book_fundingdetails'>
    <attribute name='book_distributionpercentage' alias='pct' />
    <attribute name='book_fundingevent' alias='resolved_fe' />
    <filter type='and'>
      <condition attribute='book_fund'  operator='eq' value='{206510D26-BASE-BASE GUID}' />
      <condition attribute='book_pgsag' operator='eq' value='{PG 121 GUID}' />
      <condition attribute='statecode'  operator='eq' value='0' />
    </filter>
    <link-entity name='book_fundingevent' from='book_fundingeventid' to='book_fundingevent' link-type='inner' alias='fe'>
      <attribute name='book_name'      alias='fe_name' />
      <attribute name='book_startdate' alias='start' />
      <attribute name='book_enddate'   alias='end' />
      <filter type='and'>
        <condition attribute='book_fundingtype' operator='eq' value='0' />          <!-- 0 = AFP -->
        <condition attribute='statecode'        operator='eq' value='0' />
        <condition attribute='book_startdate'   operator='on-or-before' value='2026-08-26' />
        <condition attribute='book_enddate'     operator='on-or-after'  value='2026-08-26' />
      </filter>
    </link-entity>
  </entity>
</fetch>
```

## How to read the result

- **`pct ≈ 53`** → confirmed. The 97% is on a *different* row than the plugin reads. Compare
  `resolved_fe` / `fe_name` to the event you set to 97%. Three usual causes:
  1. 97% set on the wrong FundingEvent's details — its window doesn't cover today, so the
     plugin keeps reading the active (53%) event.
  2. 97% set on the Allotment-type event; the AFP event (which owns these distributions) is
     still ~53%.
  3. (Ruled out unless it throws) two active AFP events covering today → non-overlap
     exception, not a turn-in.
  Fix: set 97% on the resolved event's `book_fundingdetails`, or fix the date windows so the
  right event is active. Re-run Generate Distributions → turn-in should drop to ≈149,038.62.

- **`pct = 97`** (against the arithmetic) → target side is innocent; pivot to `immutableNet`.
  Means there are immutable rows at A18NE beyond the measured 4,967,954 — most likely a prior
  turn-in's linked distributions (`book_turnin` set → classified immutable,
  `DistributionBucketProcessor.cs:363`).

## Diagnostic path so far (ruled out)

- Type mix — single AFP type, one direction (credit)
- Multiple Fund/PG — single fund + PG
- Fiscal-year bucket split — single fund → single FY
- FC resolution split/drop — all Prio FCs parent to A18NE, all resolve to A18NE
- Wrong funded field — `book_newfundedamount` doesn't exist on Prio; only
  `book_newfundedamounttdp`, and the verbatim Phase 2 fetch = 4,967,954
