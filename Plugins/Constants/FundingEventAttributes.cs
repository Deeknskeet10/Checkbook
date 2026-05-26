namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_fundingevent entity.
    /// A FundingEvent is the active window during which a given FundingType (AFP / Allotment)
    /// is being distributed. The Generate Distributions plugin filters for the event(s)
    /// whose [StartDate, EndDate] include "now".
    /// </summary>
    public static class FundingEventAttributes
    {
        public const string Id = "book_fundingeventid";
        public const string Name = "book_name";
        public const string StartDate = "book_startdate";
        public const string EndDate = "book_enddate";
        public const string FundingType = "book_fundingtype";
        public const string StateCode = "statecode";
    }
}
