using System;
using System.Globalization;
using Microsoft.Xrm.Sdk;

namespace Checkbook.Plugins.Helpers
{
    public static class NumericHelper
    {
        public static decimal ToDecimal(object raw, decimal defaultValue = 0m)
        {
            if (raw == null) return defaultValue;
            if (raw is AliasedValue aliased) return ToDecimal(aliased.Value, defaultValue);

            switch (raw)
            {
                case decimal d: return d;
                case double dbl: return Convert.ToDecimal(dbl);
                case float f: return Convert.ToDecimal(f);
                case Money m: return m.Value;
                case int i: return i;
                case long l: return l;
                case string s when decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed): return parsed;
                default:
                    throw new InvalidPluginExecutionException(
                        $"Unsupported numeric type '{raw.GetType().FullName}' for decimal conversion.");
            }
        }

        // NEW: convenient overload to read a decimal directly from an entity attribute
        public static decimal? ToDecimal(Entity entity, string attrName, decimal? defaultValueIfMissing = null)
        {
            if (entity == null || string.IsNullOrWhiteSpace(attrName)) return defaultValueIfMissing;
            if (!entity.Attributes.TryGetValue(attrName, out var raw) || raw == null) return defaultValueIfMissing;
            return ToDecimal(raw, defaultValueIfMissing ?? 0m);
        }
    }
}