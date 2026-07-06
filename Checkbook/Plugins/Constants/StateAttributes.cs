namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_state entity.
    /// A book_state is also a Business Unit — owning BU flows from the user
    /// creating the record.
    /// </summary>
    public static class StateAttributes
    {
        public const string Id = "book_stateid";
        public const string Name = "book_name";
        public const string Abbreviation = "book_abbreviation";
        public const string StateCode = "statecode";
    }
}
