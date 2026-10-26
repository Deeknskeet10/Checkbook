namespace Checkbook.Plugins.Constants
{
    /// <summary>
    /// Schema names for the Ticket / feedback voting feature
    /// (book_ticket + book_ticketendorsement), consumed by the book_CastVote Custom API.
    ///
    /// book_ticket is user-owned: submitter-level roles (NPM, State PM) get
    /// User-level Write so they edit only their own tickets; triage/admin roles
    /// get wider Write by design. book_score is written ONLY by the
    /// book_CastVote handler running under the plugin's elevated identity, so an
    /// endorser with no write access to another user's ticket can still move
    /// its score.
    /// </summary>
    public static class TicketAttributes
    {
        // book_ticket
        public const string TicketEntity = "book_ticket";
        public const string TicketName   = "book_name";          // primary / title
        public const string TicketStatus = "book_ticketstatus";  // choice (named to avoid statecode clash)
        public const string TicketScore  = "book_score";         // whole number, API-written only

        // book_ticketendorsement — one row per (ticket, endorser); alternate key book_uniquevote enforces uniqueness
        public const string EndorsementEntity   = "book_ticketendorsement";
        public const string EndorsementTicket   = "book_ticket";   // lookup -> book_ticket
        public const string EndorsementEndorser = "book_endorser"; // lookup -> systemuser (the voter)
        public const string EndorsementValue    = "book_value";    // +1 (up) or -1 (down)
    }
}
