using System;
using System.Linq;
using Checkbook.Plugins.Base;
using Checkbook.Plugins.Constants;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Checkbook.Plugins.Tickets
{
    /// <summary>
    /// Custom API handler for <c>book_CastVote</c> — the Reddit-style up/down
    /// vote toggle behind the Ticket voting grid PCF.
    ///
    /// The caller casts a vote as themselves, but the score tally is written by
    /// the plugin's (elevated) identity, so a voter who has no write access to
    /// someone else's ticket can still move its score. Edit rights on the
    /// ticket body come from the role's Write depth on <c>book_ticket</c>
    /// (User for submitter roles, wider for triage/admin); endorsements live in
    /// their own user-owned <c>book_ticketendorsement</c> rows.
    ///
    /// Toggle semantics for the initiating user's single vote on the ticket:
    ///   - no existing vote          -> create a vote of the requested direction
    ///   - existing, same direction  -> delete it (click again to un-vote)  -> UserVote 0
    ///   - existing, opposite        -> flip it                             -> UserVote +/-1
    /// After the mutation, <c>book_score</c> is recomputed as the SUM of all votes.
    ///
    /// A unique alternate key on book_ticketendorsement (book_ticket, book_endorser)
    /// is the backstop that
    /// makes a double-click race safe: the second concurrent Create fails at the
    /// database rather than seeding a duplicate vote.
    ///
    /// Input parameters:
    ///   TicketId  (String) — GUID of the book_ticket being voted on.
    ///   Direction (Int)    — +1 for upvote, -1 for downvote.
    /// Output parameters:
    ///   NewScore  (Int)    — the ticket's recomputed score.
    ///   UserVote  (Int)    — the caller's resulting vote (-1, 0, or +1).
    /// </summary>
    public class CastVotePlugin : PluginBase
    {
        private const string MessageName = "book_CastVote";

        private const string InTicketId  = "TicketId";
        private const string InDirection = "Direction";
        private const string OutNewScore = "NewScore";
        private const string OutUserVote = "UserVote";

        protected override void ExecutePlugin(
            IPluginExecutionContext context,
            IOrganizationService service,
            ITracingService tracing)
        {
            if (context.MessageName != MessageName) return;

            // ---- validate inputs --------------------------------------------
            if (!context.InputParameters.TryGetValue(InTicketId, out var rawTicket) ||
                !Guid.TryParse(rawTicket as string, out var ticketId) ||
                ticketId == Guid.Empty)
            {
                throw new InvalidPluginExecutionException(
                    "CastVote: a valid TicketId (GUID string) is required.");
            }

            var direction = context.InputParameters.TryGetValue(InDirection, out var rawDir)
                ? Convert.ToInt32(rawDir)
                : 0;
            if (direction != 1 && direction != -1)
            {
                throw new InvalidPluginExecutionException(
                    "CastVote: Direction must be +1 (upvote) or -1 (downvote).");
            }

            var voterId = context.InitiatingUserId;
            tracing.Trace($"CastVote: ticket={ticketId}, voter={voterId}, dir={direction}");

            // ---- find this user's existing vote -----------------------------
            var existing = service.RetrieveMultiple(new QueryExpression(TicketAttributes.EndorsementEntity)
            {
                ColumnSet = new ColumnSet(TicketAttributes.EndorsementValue),
                TopCount  = 1,
                Criteria  =
                {
                    Conditions =
                    {
                        new ConditionExpression(TicketAttributes.EndorsementTicket, ConditionOperator.Equal, ticketId),
                        new ConditionExpression(TicketAttributes.EndorsementEndorser, ConditionOperator.Equal, voterId),
                    }
                }
            }).Entities.FirstOrDefault();

            int userVote;
            if (existing == null)
            {
                var vote = new Entity(TicketAttributes.EndorsementEntity)
                {
                    [TicketAttributes.EndorsementTicket] = new EntityReference(TicketAttributes.TicketEntity, ticketId),
                    [TicketAttributes.EndorsementEndorser] = new EntityReference(EntityNames.SystemUser, voterId),
                    [TicketAttributes.EndorsementValue]  = direction,
                };
                service.Create(vote);
                userVote = direction;
                tracing.Trace("CastVote: created new vote.");
            }
            else
            {
                var currentValue = existing.GetAttributeValue<int>(TicketAttributes.EndorsementValue);
                if (currentValue == direction)
                {
                    service.Delete(TicketAttributes.EndorsementEntity, existing.Id);
                    userVote = 0;
                    tracing.Trace("CastVote: same direction — removed vote (toggle off).");
                }
                else
                {
                    service.Update(new Entity(TicketAttributes.EndorsementEntity, existing.Id)
                    {
                        [TicketAttributes.EndorsementValue] = direction
                    });
                    userVote = direction;
                    tracing.Trace("CastVote: flipped vote direction.");
                }
            }

            // ---- recompute the ticket score (sum of all votes) --------------
            var newScore = SumVotes(service, ticketId);
            service.Update(new Entity(TicketAttributes.TicketEntity, ticketId)
            {
                [TicketAttributes.TicketScore] = newScore
            });
            tracing.Trace($"CastVote: recomputed score = {newScore}.");

            context.OutputParameters[OutNewScore] = newScore;
            context.OutputParameters[OutUserVote] = userVote;
        }

        /// <summary>
        /// Sums book_value across every vote on the ticket. Pages through all
        /// results so the tally stays correct past the 5,000-row default cap.
        /// </summary>
        private static int SumVotes(IOrganizationService service, Guid ticketId)
        {
            var query = new QueryExpression(TicketAttributes.EndorsementEntity)
            {
                ColumnSet = new ColumnSet(TicketAttributes.EndorsementValue),
                Criteria  =
                {
                    Conditions =
                    {
                        new ConditionExpression(TicketAttributes.EndorsementTicket, ConditionOperator.Equal, ticketId),
                    }
                },
                PageInfo = new PagingInfo { Count = 5000, PageNumber = 1 }
            };

            var total = 0;
            while (true)
            {
                var page = service.RetrieveMultiple(query);
                total += page.Entities.Sum(v => v.GetAttributeValue<int>(TicketAttributes.EndorsementValue));

                if (!page.MoreRecords) break;
                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = page.PagingCookie;
            }
            return total;
        }
    }
}
