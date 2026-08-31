using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;

namespace Checkbook.Plugins.Helpers
{
    /// <summary>
    /// Accumulates Create / Update / Delete requests and flushes them to Dataverse
    /// in <see cref="ExecuteMultipleRequest"/> batches, collapsing what would
    /// otherwise be one network round-trip per row into a handful of batched
    /// calls. Used by GenerateDistributions, where a single (Fund, PG) group can
    /// touch a few hundred rows — hundreds of sequential round-trips was the bulk
    /// of the wall-clock that blew the 120s sandbox ceiling.
    ///
    /// Auto-flushes once the buffer reaches <c>chunkSize</c> so a caller that
    /// checks a wall-clock budget between units of work sees the REAL elapsed time
    /// — the writes execute as the buffer fills, not deferred entirely to the end
    /// (which would move their cost past the budget check). Call <see cref="Flush"/>
    /// once more when done to drain the remainder (≤ one chunk).
    ///
    /// ContinueOnError = false: the first faulting request aborts the batch and
    /// throws, matching the fail-fast behaviour of the direct service calls this
    /// replaces. Requests execute in the order queued, so a caller needing
    /// A-before-B (e.g. create a parent, then children referencing its id) must
    /// either queue them in that order OR create the parent synchronously first —
    /// SyncHoldingDebit creates the consolidated debit synchronously for exactly
    /// this reason.
    /// </summary>
    public sealed class BatchWriter
    {
        private readonly IOrganizationService _service;
        private readonly ITracingService _tracing;
        private readonly int _chunkSize;
        private readonly List<OrganizationRequest> _pending = new List<OrganizationRequest>();

        public BatchWriter(IOrganizationService service, ITracingService tracing, int chunkSize = 50)
        {
            _service = service ?? throw new ArgumentNullException(nameof(service));
            _tracing = tracing;
            _chunkSize = Math.Max(1, chunkSize);
        }

        public void Create(Entity entity) => Enqueue(new CreateRequest { Target = entity });

        public void Update(Entity entity) => Enqueue(new UpdateRequest { Target = entity });

        public void Delete(string logicalName, Guid id) =>
            Enqueue(new DeleteRequest { Target = new EntityReference(logicalName, id) });

        private void Enqueue(OrganizationRequest request)
        {
            _pending.Add(request);
            if (_pending.Count >= _chunkSize) Flush();
        }

        /// <summary>Executes and clears all buffered requests (in chunks). No-op when empty.</summary>
        public void Flush()
        {
            if (_pending.Count == 0) return;

            var total = _pending.Count;
            for (var offset = 0; offset < _pending.Count; offset += _chunkSize)
            {
                var slice = _pending.Skip(offset).Take(_chunkSize).ToList();
                var request = new ExecuteMultipleRequest
                {
                    Settings = new ExecuteMultipleSettings { ContinueOnError = false, ReturnResponses = false },
                    Requests = new OrganizationRequestCollection(),
                };
                foreach (var r in slice) request.Requests.Add(r);

                var response = (ExecuteMultipleResponse)_service.Execute(request);
                if (response.IsFaulted)
                {
                    // With ReturnResponses = false, only faulted items come back.
                    var faulted = response.Responses.FirstOrDefault(x => x.Fault != null);
                    var culprit = faulted != null && faulted.RequestIndex >= 0 && faulted.RequestIndex < slice.Count
                        ? Describe(slice[faulted.RequestIndex])
                        : "unknown request";
                    throw new InvalidPluginExecutionException(
                        $"Batch write failed (request {faulted?.RequestIndex} in a {slice.Count}-item chunk) — " +
                        $"{culprit}: {faulted?.Fault?.Message ?? "unknown fault"}.");
                }
            }
            _tracing?.Trace($"  BatchWriter: flushed {total} request(s).");
            _pending.Clear();
        }

        public int PendingCount => _pending.Count;

        // Human-readable identity of a queued request, so a batch fault points at
        // the exact row/operation (and, for a create, the lookup targets that
        // Dataverse validates — a dangling book_debiteddistribution surfaces here).
        private static string Describe(OrganizationRequest request)
        {
            switch (request)
            {
                case CreateRequest c:
                    var e = c.Target;
                    var lookups = string.Join(", ", e.Attributes
                        .Where(a => a.Value is EntityReference)
                        .Select(a => $"{a.Key}→{((EntityReference)a.Value).LogicalName}:{((EntityReference)a.Value).Id}"));
                    return $"Create {e.LogicalName}" + (lookups.Length > 0 ? $" [{lookups}]" : string.Empty);
                case UpdateRequest u:
                    return $"Update {u.Target.LogicalName}:{u.Target.Id}";
                case DeleteRequest d:
                    return $"Delete {d.Target.LogicalName}:{d.Target.Id}";
                default:
                    return request?.RequestName ?? "unknown";
            }
        }
    }
}
