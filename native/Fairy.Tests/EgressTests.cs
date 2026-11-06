using System;
using Fairy.Broker;

namespace Fairy.Tests;

public static class EgressTests
{
    public static int Run()
    {
        // CredentialHost: handle issued, raw secret not retrievable
        var c = new CredentialHost();
        var h = c.Store("openai-key", "sk-supersecret");
        Assert(c.Exists(h), "credential handle exists");
        Assert(c.Label(h) == "openai-key", "only label retrievable");
        c.Revoke(h);
        Assert(!c.Exists(h), "revoked handle gone");

        // EgressHost: allowed transfer succeeds
        var e = new EgressHost();
        var pub = new EgressHost.DataRef("d1", "public", new[]{"api.example.com"}, Array.Empty<string>());
        Assert(e.AllowTransfer(pub, "api.example.com", isCloud: true) == true, "allowed public transfer succeeds");

        // unapproved destination rejected
        Assert(e.AllowTransfer(pub, "evil.com", isCloud: true) == false, "unapproved destination rejected");

        // private/secret rejected for cloud
        var priv = new EgressHost.DataRef("d2", "private", new[]{"api.example.com"}, Array.Empty<string>());
        Assert(e.AllowTransfer(priv, "api.example.com", isCloud: true) == false, "private cloud transfer rejected");

        // private allowed to local (non-cloud)
        Assert(e.AllowTransfer(priv, "api.example.com", isCloud: false) == true, "private local transfer allowed");

        // derived content inherits parent restrictions, and provenance FAILS CLOSED:
        // a child whose parent cannot be resolved is denied even if labeled public.
        var child = new EgressHost.DataRef("d3", "public", new[]{"api.example.com"}, new[]{"d2"});
        Assert(e.AllowTransfer(child, "api.example.com", isCloud: true) == false, "child with unresolvable parent denied (fail closed)");

        // with a resolver, inheritance is enforced: public child of a private parent cannot go cloud
        e.ParentResolver = id => id switch
        {
            "d2" => priv,
            "d4" => new EgressHost.DataRef("d4", "public", new[]{"api.example.com"}, Array.Empty<string>()),
            _ => null,
        };
        Assert(e.AllowTransfer(child, "api.example.com", isCloud: true) == false, "public child of private parent denied for cloud");

        // public child of a public parent passes
        var childOk = new EgressHost.DataRef("d5", "public", new[]{"api.example.com"}, new[]{"d4"});
        Assert(e.AllowTransfer(childOk, "api.example.com", isCloud: true) == true, "public child of public parent allowed");

        // provenance cycle fails closed
        e.ParentResolver = id => id == "d7"
            ? new EgressHost.DataRef("d7", "public", new[]{"api.example.com"}, new[]{"d6"})
            : new EgressHost.DataRef("d6", "public", new[]{"api.example.com"}, new[]{"d7"});
        var cyc = new EgressHost.DataRef("d6", "public", new[]{"api.example.com"}, new[]{"d7"});
        Assert(e.AllowTransfer(cyc, "api.example.com", isCloud: true) == false, "provenance cycle denied");

        Console.WriteLine("ALL EGRESS TESTS PASSED");
        return 0;
    }

    private static void Assert(bool cond, string msg)
    {
        if (!cond) { Console.WriteLine("FAIL: " + msg); Environment.Exit(1); }
        else { Console.WriteLine("PASS: " + msg); }
    }
}
