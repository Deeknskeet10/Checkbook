using System.Collections.Generic;

namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Option-set values for the global <c>book_appropriation</c> choice column.
    /// </summary>
    public static class AppropriationValues
    {
        public const int MCNG  = 0;
        public const int NGPA  = 1;
        public const int NGPM  = 2;
        public const int OMNG  = 3;
        public const int OMA   = 4;
        public const int OMDW  = 5;
        public const int OPA   = 6;
        public const int OMAR  = 7;
        public const int NGREA = 8;
        public const int FWFC  = 9;
        public const int FPP   = 10;

        /// <summary>
        /// Appropriations that key their LOA name off PG rather than SAG.
        /// Matches the "APPN requires PG" branch in the legacy
        /// LineofAccounting-Initialization XAML workflow.
        /// </summary>
        private static readonly HashSet<int> PgAppropriations =
            new HashSet<int> { NGPA, NGPM, NGREA };

        public static bool RequiresPg(int appropriation) =>
            PgAppropriations.Contains(appropriation);
    }
}
