using System;
using System.IO;
using Fairy.Broker;

namespace Fairy.Tests;

public static class SandboxTests
{
    public static int Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "fairy-sandbox-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var sb = new SandboxHost(root);

        // allowed inside
        var inside = Path.Combine(root, "work", "file.txt");
        Directory.CreateDirectory(Path.GetDirectoryName(inside)!);
        File.WriteAllText(inside, "ok");
        Assert(sb.ResolveInside("work/file.txt") == inside, "inside path resolves");

        // escape via ..
        Assert(sb.ResolveInside("../escape.txt") == null, "dotdot escape denied");

        // sibling-prefix escape (regression): a sibling dir whose name shares the
        // root's string prefix must be unreachable even when it actually exists.
        var sibling = root.TrimEnd(Path.DirectorySeparatorChar) + "2";
        Directory.CreateDirectory(sibling);
        File.WriteAllText(Path.Combine(sibling, "secret.txt"), "outside");
        Assert(sb.ResolveInside("../" + Path.GetFileName(sibling) + "/secret.txt") == null,
            "existing sibling-prefix escape denied");
        Assert(sb.ResolveInside("..\\sub\\..\\evil.txt") == null, "obfuscated dotdot denied");
        Directory.Delete(sibling, true);

        // absolute path denied
        Assert(sb.ResolveInside("C:/Windows/System32/cmd.exe") == null, "absolute path denied");

        // junction/symlink escape
        var link = Path.Combine(root, "link");
        try
        {
            // create a symlink to outside if supported
            var outside = Path.Combine(Path.GetTempPath(), "fairy-outside-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(outside);
            File.WriteAllText(Path.Combine(outside, "secret.txt"), "secret");
            try { Directory.CreateSymbolicLink(link, outside); }
            catch { /* symlink may require privileges; skip */ }
            if (Directory.Exists(link))
            {
                Assert(sb.ResolveInside("link/secret.txt") == null, "symlink escape denied");
            }
            Directory.Delete(outside, true);
        }
        catch { }

        // capability flags
        Assert(sb.CanCreateProcess() == false, "process creation denied");
        Assert(sb.CanAccessDesktop() == false, "desktop access denied");
        Assert(sb.CanReadCredentials() == false, "credential access denied");
        Assert(sb.IsAllowedNetwork("example.com") == false, "network default deny");

        Directory.Delete(root, true);
        Console.WriteLine("ALL SANDBOX TESTS PASSED");
        return 0;
    }

    private static void Assert(bool cond, string msg)
    {
        if (!cond) { Console.WriteLine("FAIL: " + msg); Environment.Exit(1); }
        else { Console.WriteLine("PASS: " + msg); }
    }
}
