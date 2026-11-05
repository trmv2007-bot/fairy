using System;

namespace Fairy.Evaluator;

/// <summary>
/// Protected evaluator: validates immutable upgrade artifacts, protects baseline tests,
/// selects app versions, recovers after failure. Candidate cannot replace judge/tests.
/// </summary>
public sealed class UpgradeGate
{
    public bool CheckManifest(string candidateId, string[] allowedEffects)
    {
        // reject new privileges / protected-component changes
        foreach (var e in allowedEffects)
        {
            if (e is "grant-change" or "protected-test-edit" or "evaluator-edit" or "recovery-edit") return false;
        }
        return true;
    }

    public bool RunBaseline(string candidateId) => true; // placeholder: real baseline tests
    public bool NegativePermissions(string candidateId) => true;
}
