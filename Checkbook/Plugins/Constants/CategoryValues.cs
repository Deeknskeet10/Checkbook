namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Option-set values for the global <c>book_category</c> choice column
    /// (FY27+ LOA delineator, set on the Funding Track and rolled up to the LOA).
    /// The Dataverse choice must be created with these explicit values.
    /// </summary>
    public static class CategoryValues
    {
        public const int RISK = 0;
        public const int TSP  = 1;
        public const int RPA  = 2;
        public const int CON  = 3;

        /// <summary>
        /// Label used in the canonical LOA name. Returns null for unknown
        /// values so the name builder can reject the row instead of composing
        /// a wrong name.
        /// </summary>
        public static string NameOf(int value)
        {
            switch (value)
            {
                case RISK: return "RISK";
                case TSP:  return "TSP";
                case RPA:  return "RPA";
                case CON:  return "CON";
                default:   return null;
            }
        }
    }
}
