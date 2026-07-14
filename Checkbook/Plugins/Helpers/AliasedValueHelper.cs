using System;
using Microsoft.Xrm.Sdk;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Extraction helpers for FetchXML aggregate / link-entity results, which
    /// wrap grouped, aggregated, and linked attributes in AliasedValue.
    /// Single source of truth — do not re-implement these per plugin.
    /// For link-entity columns the key is "alias.attributename".
    /// </summary>
    public static class AliasedValueHelper
    {
        public static Guid GetGuid(Entity e, string alias)
        {
            if (!e.Contains(alias)) return Guid.Empty;
            var raw = (e[alias] as AliasedValue)?.Value;
            if (raw is Guid g) return g;
            if (raw is EntityReference er) return er.Id;
            return Guid.Empty;
        }

        public static EntityReference GetReference(Entity e, string alias)
            => (e.GetAttributeValue<AliasedValue>(alias))?.Value as EntityReference;

        public static decimal GetDecimal(Entity e, string alias, decimal defaultValue = 0m)
        {
            if (!e.Contains(alias)) return defaultValue;
            var raw = (e[alias] as AliasedValue)?.Value;
            return NumericHelper.ToDecimal(raw, defaultValue);
        }

        /// <summary>Reads an int or OptionSetValue alias (aggregates over
        /// picklists come back as OptionSetValue).</summary>
        public static int GetInt(Entity e, string alias, int defaultValue = 0)
        {
            if (!e.Contains(alias)) return defaultValue;
            var raw = (e[alias] as AliasedValue)?.Value;
            if (raw is OptionSetValue osv) return osv.Value;
            if (raw is int i) return i;
            return defaultValue;
        }

        public static string GetString(Entity e, string alias)
        {
            if (!e.Contains(alias)) return null;
            return (e[alias] as AliasedValue)?.Value as string;
        }

        public static DateTime? GetDate(Entity e, string alias)
        {
            if (!e.Contains(alias)) return null;
            return (e[alias] as AliasedValue)?.Value as DateTime?;
        }
    }
}
