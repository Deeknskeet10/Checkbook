using Microsoft.Xrm.Sdk;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Detects approval-style transitions on an Update target. The two
    /// flavors mirror how approvals are modeled across the solution:
    /// boolean flags (Turn-In: book_stateapproved, book_beapproved) and
    /// OptionSet choices (Realignment: book_newstateapproved, book_bedecision).
    ///
    /// Both methods require that the target's Update payload actually
    /// contains the attribute — otherwise no transition is reported, even
    /// if the pre-image value differs from the requested value. This is
    /// what callers consistently meant by the inline
    /// <c>target.Contains(attr)</c> check.
    /// </summary>
    public static class ApprovalTransitionDetector
    {
        /// <summary>
        /// True when <paramref name="attribute"/> is in the target payload AND
        /// the effective value transitions from <paramref name="from"/> to
        /// <paramref name="to"/>. Default detects false → true (approval).
        /// </summary>
        public static bool DetectBoolTransition(
            Entity target,
            Entity preImage,
            string attribute,
            bool from = false,
            bool to = true)
        {
            if (target == null || !target.Contains(attribute)) return false;

            bool pre = preImage?.GetAttributeValue<bool?>(attribute) ?? false;
            bool post = target.GetAttributeValue<bool?>(attribute) ?? pre;

            return pre == from && post == to;
        }

        /// <summary>
        /// True when <paramref name="attribute"/> is in the target payload AND
        /// the effective OptionSet value transitions to <paramref name="toValue"/>
        /// from any other value (or null).
        /// </summary>
        public static bool DetectOptionSetTransition(
            Entity target,
            Entity preImage,
            string attribute,
            int toValue)
        {
            if (target == null || !target.Contains(attribute)) return false;

            int? pre = preImage?.GetAttributeValue<OptionSetValue>(attribute)?.Value;
            int? post = target.GetAttributeValue<OptionSetValue>(attribute)?.Value ?? pre;

            return pre != toValue && post == toValue;
        }

        /// <summary>
        /// True when <paramref name="attribute"/> is in the target payload with
        /// exactly <paramref name="value"/>, regardless of the pre-image.
        /// Callers must pair this with their own idempotency check (e.g.
        /// "record still active") — it will match again on every save that
        /// carries the value, which is the point: a decision written while
        /// processing was unavailable can be re-driven by a later save instead
        /// of being permanently invisible to a transition check.
        /// </summary>
        public static bool PayloadHasOptionSetValue(Entity target, string attribute, int value)
        {
            if (target == null || !target.Contains(attribute)) return false;

            return target.GetAttributeValue<OptionSetValue>(attribute)?.Value == value;
        }

        /// <summary>
        /// Boolean flavor of <see cref="PayloadHasOptionSetValue"/>: true when
        /// <paramref name="attribute"/> is in the target payload with
        /// <paramref name="value"/>. Same idempotency caveat — pair with a
        /// "record still active" (or ledger-existence) check.
        /// </summary>
        public static bool PayloadHasBoolValue(Entity target, string attribute, bool value = true)
        {
            if (target == null || !target.Contains(attribute)) return false;

            return (target.GetAttributeValue<bool?>(attribute) ?? false) == value;
        }
    }
}
