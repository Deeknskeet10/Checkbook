namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Attribute schema names for book_sag entity. SAG records carry a lookup
    /// back to their parent PG (<see cref="PG"/>), which the Turn-In resolver
    /// uses to derive a SAG when the user only selected a PG on the header.
    /// </summary>
    public static class SagAttributes
    {
        public const string Id   = "book_sagid";
        public const string Name = "book_name";
        public const string PG   = "book_pg";
    }
}
