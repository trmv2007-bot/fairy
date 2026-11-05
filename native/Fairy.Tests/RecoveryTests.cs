using System;
using System.IO;
using Fairy.Recovery;

namespace Fairy.Tests;

public static class RecoveryTests
{
    public static int Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "fairy-rec-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "releases", "last-good"));
        File.WriteAllText(Path.Combine(root, "releases", "last-good", "app.txt"), "good");
        Directory.CreateDirectory(Path.Combine(root, "releases", "candidate"));
        File.WriteAllText(Path.Combine(root, "releases", "candidate", "app.txt"), "bad");
        // current points to candidate (crashed)
        Directory.CreateDirectory(Path.Combine(root, "current"));
        File.WriteAllText(Path.Combine(root, "current", "app.txt"), "bad");

        var r = new StateRecovery(root);
        Assert(r.RollbackLastGood() == 0, "rollback succeeds");
        Assert(File.Exists(Path.Combine(root, "current", "app.txt")), "current restored");
        Assert(File.ReadAllText(Path.Combine(root, "current", "app.txt")) == "good", "last-good content present");

        Directory.Delete(root, true);
        Console.WriteLine("ALL RECOVERY TESTS PASSED");
        return 0;
    }

    private static void Assert(bool cond, string msg)
    {
        if (!cond) { Console.WriteLine("FAIL: " + msg); Environment.Exit(1); }
        else { Console.WriteLine("PASS: " + msg); }
    }
}
