namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Option-set values for the global <c>book_category</c> choice column
    /// (FY27+ LOA delineator, set on the Funding Track and rolled up to the LOA).
    /// Mirrors <c>src/ARNGCheckbook/OptionSets/book_category.xml</c> — keep in sync
    /// when options are added in Dataverse.
    /// </summary>
    public static class CategoryValues
    {
        public const int RISK = 0;
        public const int TSP  = 1;
        public const int RPA  = 2;
        public const int CON  = 3;
        public const int ARMY = 4;
        public const int CMWH = 5;
        public const int IRC1 = 6;
        public const int IRC2 = 7;
        public const int IRC4 = 8;
        public const int R2WE = 9;
        public const int GFSA = 10;
        public const int WTC  = 11;
        public const int PEC  = 12;
        public const int CNP0 = 13;
        public const int SPR2 = 14;

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
                case ARMY: return "ARMY";
                case CMWH: return "CMWH";
                case IRC1: return "IRC1";
                case IRC2: return "IRC2";
                case IRC4: return "IRC4";
                case R2WE: return "R2WE";
                case GFSA: return "GFSA";
                case WTC:  return "WTC";
                case PEC:  return "PEC";
                case CNP0: return "CNP0";
                case SPR2: return "SPR2";
                default:   return null;
            }
        }
    }
}
