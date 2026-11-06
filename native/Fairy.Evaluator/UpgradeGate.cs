using System;

namespace Fairy.Evaluator;

/// <summary>
/// Protected evaluator: validates immutable upgrade artifacts, protects baseline tests,
/// selects app versions, recovers after failure. Candidate cannot replace judge/tests.
/// All checks FAIL CLOSED: until the real baseline/negative-permission runners are
/// wired (T17), a candidate can never self-approve by getting "true" from a stub.
/// </summary>
public sealed class UpgradeGate
{
    public bool CheckManifest(string candidateId, string[]? allowedEffects)
    {
        if (string.IsNullOrWhiteSpace(candidateId)) return false;
        if (allowedEffects is null) return false;
        // reject new privileges / protected-component changes
        foreach (var e in allowedEffects)
        {
            if (e is "grant-change" or "protected-test-edit" or "evaluator-edit" or "recovery-edit") return false;
        }
        return true;
    }

    public bool RunBaseline(string candidateId)
    {
        Console.WriteLine($"[evaluator] baseline runner not wired; candidate '{candidateId}' fails closed");
        return false;
    }

    public bool NegativePermissions(string candidateId)
    {
        Console.WriteLine($"[evaluator] negative-permission runner not wired; candidate '{candidateId}' fails closed");
        return false;
    }
}
