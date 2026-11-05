using System;
using Fairy.Broker;

namespace Fairy.Tests;

public static class PolicyTests
{
    public static int Run()
    {
        var b = new PolicyBroker();
        var nonce = b.IssueApproval("cap.click", "window:scratch", "write", PolicyBroker.Digest("hello"), "uihash1", TimeSpan.FromMinutes(5));

        Assert(b.TryConsume(nonce, "cap.click", "window:scratch", "write", PolicyBroker.Digest("hello"), "uihash1") == true, "exact approved action executes once");
        Assert(b.TryConsume(nonce, "cap.click", "window:scratch", "write", PolicyBroker.Digest("hello"), "uihash1") == false, "replay fails");

        var n2 = b.IssueApproval("cap.click", "window:scratch", "write", PolicyBroker.Digest("hello"), "uihash1", TimeSpan.FromMinutes(5));
        Assert(b.TryConsume(n2, "cap.click", "window:scratch", "write", PolicyBroker.Digest("HELLO"), "uihash1") == false, "changed payload fails");

        var n3 = b.IssueApproval("cap.click", "window:scratch", "write", PolicyBroker.Digest("x"), "uihash1", TimeSpan.FromMilliseconds(1));
        System.Threading.Thread.Sleep(50);
        Assert(b.TryConsume(n3, "cap.click", "window:scratch", "write", PolicyBroker.Digest("x"), "uihash1") == false, "expired fails");

        Assert(b.TryConsume("deadbeef", "cap.click", "window:scratch", "write", PolicyBroker.Digest("x"), "uihash1") == false, "synthetic self-approval fails");

        var n4 = b.IssueApproval("cap.click", "window:scratch", "write", PolicyBroker.Digest("r"), "uihash1", TimeSpan.FromMinutes(5));
        b.Revoke(n4);
        Assert(b.TryConsume(n4, "cap.click", "window:scratch", "write", PolicyBroker.Digest("r"), "uihash1") == false, "revoked fails");

        // ui-state mismatch
        var n5 = b.IssueApproval("cap.click", "window:scratch", "write", PolicyBroker.Digest("u"), "uihash1", TimeSpan.FromMinutes(5));
        Assert(b.TryConsume(n5, "cap.click", "window:scratch", "write", PolicyBroker.Digest("u"), "uihash2") == false, "ui-state mismatch fails");

        Console.WriteLine("ALL POLICY TESTS PASSED");
        return 0;
    }

    private static void Assert(bool cond, string msg)
    {
        if (!cond) { Console.WriteLine("FAIL: " + msg); Environment.Exit(1); }
        else { Console.WriteLine("PASS: " + msg); }
    }
}
