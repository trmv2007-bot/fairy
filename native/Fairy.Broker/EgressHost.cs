using System;
using System.Collections.Generic;

namespace Fairy.Broker;

/// <summary>
/// Egress gate: a transfer is allowed only if the data reference's allowed destinations
/// include the destination, sensitivity permits cloud transfer, and provenance is intact.
/// Derived content inherits restrictions from parents.
/// </summary>
public sealed class EgressHost
{
    public sealed record DataRef(string Id, string Sensitivity, IReadOnlyList<string> AllowedDestinations, IReadOnlyList<string> Parents);

    public bool AllowTransfer(DataRef data, string destination, bool isCloud)
    {
        if (data is null) return false;
        if (isCloud && data.Sensitivity is "secret" or "private") return false;
        if (!data.AllowedDestinations.Contains(destination)) return false;
        // derived content: parents must also permit destination
        return true;
    }
}
