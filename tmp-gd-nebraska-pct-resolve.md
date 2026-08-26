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

---

## UPDATE 2026-08-26 — pct confirmed 97%, turn-in is NOT stale

Resolve-% fetch returned **one** row: `Enactment - AFP`, `pct = 97`, window
31 Jan 2026 → 30 Sep 2026 (covers today). So `pct = 97` is confirmed, and the
target side (`funded = 4,967,954`, verbatim Phase 2 fetch) is confirmed too.

Turn-in record was **deleted and Generate Distributions re-run (25 Aug 2026) — the
2,331,899 turn-in reappeared.** So it is NOT stale; the plugin recomputes it
deterministically from current data.

### The math now forces exactly two possibilities

```
target      = funded × 0.97
2,331,899   = immutableNet − target

(A) immutableNet[A18NE] = 4,818,915 + 2,331,899 = 7,150,814
        → ~2.18M of immutable credit at A18NE BEYOND the measured 4,967,954
(B) funded[A18NE bucket] = 2,636,055 / 0.97      = 2,717,582
        → ~2.25M of the 4,967,954 Prio funding is NOT landing in the A18NE bucket
          (a Prio FC resolving off A18NE), while its distributions sit stranded
          at A18NE
```

(A) contradicts the measured 4,967,954 (all credits, one direction). **(B) is the
live suspect** — the funded total was summed by fund+PG only, never grouped by
`prio_fc_id` and walked to the resolved dest FC. Run BOTH queries below to decide.

### Q1 — immutableNet by FC (distribution side, exact LoadGroupState set)

No FC filter, AFP-only, grouped so A18NE's committed net + entered/link split is visible.

```xml
<fetch aggregate='true' no-lock='true'>
  <entity name='book_distributions'>
    <attribute name='book_amount' alias='amt' aggregate='sum' />
    <attribute name='book_fundcenter' alias='fc' groupby='true' />
    <attribute name='book_disbursementdirection' alias='dir' groupby='true' />
    <attribute name='book_entrydocumentnumber' alias='entered' groupby='true' />
    <attribute name='book_turnin' alias='ti' groupby='true' />
    <attribute name='book_stateswap' alias='ss' groupby='true' />
    <attribute name='book_realignment' alias='ra' groupby='true' />
    <attribute name='book_manualentry' alias='man' groupby='true' />
    <filter type='and'>
      <condition attribute='book_fund'  operator='eq' value='{206510D26 GUID}' />
      <condition attribute='book_pgsag' operator='eq' value='{PG121 GUID}' />
      <condition attribute='statecode'  operator='eq' value='0' />
    </filter>
    <link-entity name='book_fundingevent' from='book_fundingeventid' to='book_fundingevent' link-type='inner' alias='fe'>
      <filter type='and'>
        <condition attribute='book_fundingtype' operator='eq' value='0' />   <!-- AFP -->
      </filter>
    </link-entity>
  </entity>
</fetch>
```

Read: A18NE `immutableNet` = Σ(entered / `ti` / `ss` / `ra` / `man`-flagged credits) − debits.
- If A18NE total > 4,967,954 → possibility (A): extra immutable rows the first
  measurement missed (duplicate set, or turn-in/realignment/state-swap-linked credits).
- If A18NE total ≤ 4,967,954 → (A) impossible; go to Q2.
- Watch for **two FCs that both read "Nebraska/A18NE"** (a duplicate fund-center
  record) — that alone would explain a split target vs. pooled distributions.

### Q2 — funded by Prio FC (Prio side, exposes the bucket split)

In the verbatim Phase 2 result filtered to this fund+PG, group by `prio_fc_id` and
subtotal `total_funding`. Then for EACH distinct Prio FC, walk its parent chain and
find the resolved dest FC = the FC whose parent IS the holding FC (A18):

- PrioFC.parent == A18 (holding)      → resolves to **PrioFC itself** (own bucket, NOT A18NE)
- PrioFC.parent == A18NE, A18NE.parent == A18 → resolves to **A18NE**
- otherwise keep walking up until parent == A18

Sum only the subtotals whose resolved dest FC == A18NE. **Predicted: 2,717,582**, not
4,967,954 — the remaining ~2.25M belongs to Prio FCs that resolve elsewhere, and its
distributions are stranded at A18NE.

If Q2 == 4,967,954 (all really resolve to A18NE) AND Q1 A18NE ≤ 4,967,954, then the
data genuinely cannot produce 2,331,899 and the runtime inputs differ from these
queries — capture the plugin trace line for the A18NE bucket (funded / target /
immutableNet / delta, `DistributionBucketProcessor.cs:114`) to see what it actually read.

## RESOLVED 2026-08-26 — Phase 2 / Phase 3 fight over the A18NE destination

Q1 (`Fetch output.xlsx`) settles it. A18NE committed net = **exactly 4,967,954**:
9 credit rows (`dir=0`), every one with a GFEBS entry document number
(`100098876 … 101804458`, `EXCEPECTED ACTIVITIES P1-P7`), zero debits, zero
amendable. So `immutableNet[A18NE] = 4,967,954`, all immutable → possibility (A)
dead, no hidden rows.

That forces the target the plugin actually used:

```
target        = immutableNet − turn-in = 4,967,954 − 2,331,899 = 2,636,055
funded_bucket = 2,636,055 / 0.97       = 2,717,582   (NOT 4,967,954)
```

Phase 2's A18NE bucket = 4,967,954 (verified), so the 2,717,582 bucket is **Phase 3**.
This is the tripwire the code already warns about (`GenerateDistributionsPlugin.cs:193-204`):

1. Phase 2 (Prios): target 4,818,915 vs immNet 4,967,954 → writes correct Turn-In **149,038.62**.
2. Phase 3 (Reqs) runs after, re-loads the SAME full immNet 4,967,954, but its own
   bucket target is 2,717,582 × 0.97 = 2,636,055 → delta −2,331,899.
3. `FindOpenSweepTurnInsByFc` finds Phase 2's turn-in → `UpdateTypeAmount` overwrites
   149,039 → **2,331,899** (`DistributionBucketProcessor.cs:159-164`). Phase 3 runs last, so it wins.

Deterministic every run (matches delete-and-reappear).

### Confirm
Verbatim Phase 3 fetch (`GenerateDistributionsPlugin.cs:680-717`) scoped to Fund
206510D26 / PG 121 → expect a destination resolving to A18NE with
`sum(book_newfundedamount) ≈ 2,717,582`, a BE-approved Requirement of type
TARC(1) or ARNG-External(4) with no active Prioritization. Trace should be firing
`WARNING: destination ... appears in BOTH Phase 2 and Phase 3` at A18NE.

### Fix direction
Per the code comment: merge Phase 2 + Phase 3 into ONE combined bucket set keyed by
(Fund, dest FC, PG) so a shared destination reconciles one summed target against the
committed net, instead of each phase clobbering the other's Sweep Turn-In. Also
determine whether the Phase 3 Requirement is legitimately separate funding or the same
prio'd money double-represented.

## Diagnostic path so far (ruled out)

- Type mix — single AFP type, one direction (credit)
- Multiple Fund/PG — single fund + PG
- Fiscal-year bucket split — single fund → single FY
- Wrong funded field — `book_newfundedamount` doesn't exist on Prio; only
  `book_newfundedamounttdp`, and the verbatim Phase 2 fetch = 4,967,954
- Wrong / stale percentage — resolved event is `Enactment - AFP` @ 97%, window covers today
- Stale turn-in — deleted + re-ran 25 Aug 2026, 2,331,899 reappeared → deterministic, live
