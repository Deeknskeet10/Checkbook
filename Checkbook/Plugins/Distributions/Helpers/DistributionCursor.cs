using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Checkbook.Plugins.Constants;
using Checkbook.Plugins.Helpers;

namespace Checkbook.Plugins.Distributions.Helpers
{
    // -----------------------------------------------------------------
    // Continuation cursor — tiny key=value text, no escaping needed since
    // values are int / Guid only. Three states:
    //   phase=2;fe=<guid>;idx=<n>[;boff=<b>]  → mid-Phase-2 of FE <guid>, (Fund,PG) group <n>
    //   phase=3;fe=<guid>;idx=<n>[;boff=<b>]  → mid-Phase-3 of FE <guid>, (Fund,PG) group <n>
    //   phase=4                               → Phase 4 (orphan cleanup) incomplete
    // idx is a group index (see GroupByFundAndPg). boff (optional, default 0)
    // is the first UNPROCESSED bucket within that group — a group whose
    // reconciliation can't finish inside one time budget is split across
    // passes at bucket boundaries. The group's single holding-FC debit is
    // re-synced from live state on every pass (SyncHoldingDebit re-derives,
    // never accumulates), so a mid-group split leaves a consistent debit.
    // Legacy phase=1 tokens (from the retired deactivation sweep) parse as
    // a fresh start.
    // -----------------------------------------------------------------
internal sealed class DistributionCursor
    {
        public int Phase;
        public Guid FundingEventId;
        public int BucketIdx;
        public int BucketOffset;   // first unprocessed bucket WITHIN group BucketIdx

        public string Serialize() =>
            Phase == 4
                ? "phase=4"
                : $"phase={Phase};fe={FundingEventId};idx={BucketIdx}" +
                  (BucketOffset > 0 ? $";boff={BucketOffset}" : string.Empty);

        public static DistributionCursor Parse(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            var c = new DistributionCursor();
            foreach (var part in s.Split(';'))
            {
                var kv = part.Split(new[] { '=' }, 2);
                if (kv.Length != 2) continue;
                switch (kv[0].Trim())
                {
                    case "phase":
                        if (int.TryParse(kv[1], out var p)) c.Phase = p;
                        break;
                    case "fe":
                        if (Guid.TryParse(kv[1], out var g)) c.FundingEventId = g;
                        break;
                    case "idx":
                        if (int.TryParse(kv[1], out var i)) c.BucketIdx = i;
                        break;
                    case "boff":
                        if (int.TryParse(kv[1], out var bo)) c.BucketOffset = bo;
                        break;
                }
            }
            if (c.Phase == 4) return c;
            if ((c.Phase == 2 || c.Phase == 3) && c.FundingEventId != Guid.Empty) return c;
            return null;
        }
    }

}
