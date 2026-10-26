using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Compares EntityReference by logical name + ID.
    /// Use as the comparer for EntityReference-keyed dictionaries / sets.
    /// </summary>
    public sealed class EntityReferenceComparer : IEqualityComparer<EntityReference>
    {
        public bool Equals(EntityReference x, EntityReference y)
        {
            if (x == null && y == null) return true;
            if (x == null || y == null) return false;

            return x.Id == y.Id &&
                   string.Equals(x.LogicalName, y.LogicalName, StringComparison.OrdinalIgnoreCase);
        }

        public int GetHashCode(EntityReference obj)
        {
            return (obj.LogicalName + obj.Id.ToString()).ToLower().GetHashCode();
        }
    }
}
