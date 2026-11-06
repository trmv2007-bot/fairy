using System;
using Fairy.Evaluator;

namespace Fairy.Tests;

public static class UpgradeTests
{
    public static int Run()
    {
        var gate = new UpgradeGate();

        // Manifest checks fail closed
        Assert(gate.CheckManifest("", Array.Empty<string>()) == false, "empty candidate id rejected");
        Assert(gate.CheckManifest("cand-1", null) == false, "null allowedEffects rejected");
        Assert(gate.CheckManifest("cand-1", new[] { "file-read" }) == true, "benign effect accepted");
        Assert(gate.CheckManifest("cand-1", new[] { "file-read", "grant-change" }) == false, "grant-change rejected");
        Assert(gate.CheckManifest("cand-1", new[] { "protected-test-edit" }) == false, "protected-test-edit rejected");
        Assert(gate.CheckManifest("cand-1", new[] { "evaluator-edit" }) == false, "evaluator-edit rejected");
        Assert(gate.CheckManifest("cand-1", new[] { "recovery-edit" }) == false, "recovery-edit rejected");

        // Baseline / negative-permission runners are not wired: MUST fail closed,
        // never return true from a stub (self-approval prevention).
        Assert(gate.RunBaseline("cand-1") == false, "baseline not wired -> fails closed");
        Assert(gate.NegativePermissions("cand-1") == false, "negative-permissions not wired -> fails closed");

        Console.WriteLine("ALL UPGRADE TESTS PASSED");
        return 0;
    }

    private static void Assert(bool cond, string msg)
    {
        if (!cond) { Console.WriteLine("FAIL: " + msg); Environment.Exit(1); }
        else { Console.WriteLine("PASS: " + msg); }
    }
}
