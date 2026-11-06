using System;
using System.Collections.Generic;

namespace Fairy.Broker;

/// <summary>
/// Egress gate: a transfer is allowed only if the data reference's allowed destinations
/// include the destination, sensitivity permits cloud transfer, and provenance is intact.
/// Derived content inherits restrictions from parents: every ancestor (resolved via
/// ParentResolver) must also permit the destination. Unknown parents and provenance
/// cycles fail closed.
/// </summary>
public sealed class EgressHost
{
    public sealed record DataRef(string Id, string Sensitivity, IReadOnlyList<string> AllowedDestinations, IReadOnlyList<string> Parents);

    private const int MaxProvenanceDepth = 16;

    /// <summary>
    /// Resolves a parent id to its DataRef. Unset or returning null for a referenced
    /// parent = provenance cannot be proven = transfer denied (fail closed).
    /// </summary>
    public Func<string, DataRef?>? ParentResolver { get; set; }

    public bool AllowTransfer(DataRef data, string destination, bool isCloud)
        => AllowTransfer(data, destination, isCloud, new HashSet<string>(StringComparer.Ordinal));

    private bool AllowTransfer(DataRef data, string destination, bool isCloud, HashSet<string> visited)
    {
        if (data is null) return false;
        if (string.IsNullOrWhiteSpace(destination)) return false;
        if (!visited.Add(data.Id)) return false; // provenance cycle
        if (visited.Count > MaxProvenanceDepth) return false; // pathological chain
        if (isCloud && data.Sensitivity is "secret" or "private") return false;
        if (!data.AllowedDestinations.Contains(destination)) return false;
        // derived content: every parent must also permit this destination
        foreach (var parentId in data.Parents)
        {
            var parent = ParentResolver?.Invoke(parentId);
            if (parent is null) return false;
            if (!AllowTransfer(parent, destination, isCloud, visited)) return false;
        }
        return true;
    }
}
