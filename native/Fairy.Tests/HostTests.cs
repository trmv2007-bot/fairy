using System;
using System.Text.Json;
using Fairy.Broker;

namespace Fairy.Tests;

public static class HostTests
{
    private static JsonElement Payload(string json) => JsonDocument.Parse(json).RootElement;

    private static string Obj(params (string k, string v)[] fields)
    {
        var pairs = Array.ConvertAll(fields, f => $"\"{f.k}\":{f.v}");
        return "{" + string.Join(",", pairs) + "}";
    }

    private static string Str(string s) => JsonSerializer.Serialize(s);

    public static int Run()
    {
        var host = new BrokerHost();

        // ping
        var ping = host.HandleRequest(new BrokerRequest("r1", "ping", null));
        Assert(ping.Ok && ping.Result?.GetProperty("pong").GetBoolean() == true, "ping answers with pong");

        // unknown op fails cleanly (ok:false), never throws across the boundary
        var unknown = host.HandleRequest(new BrokerRequest("r2", "nope", null));
        Assert(!unknown.Ok && unknown.Error!.Contains("unknown op"), "unknown op -> ok:false");

        // malformed envelope
        var malformed = host.HandleRequest(new BrokerRequest("", "", null));
        Assert(!malformed.Ok, "empty id/op -> malformed envelope");

        // sandbox.resolve: inside answers with a path, traversal resolves to null
        var root = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "fairy-host-tests-" + Guid.NewGuid().ToString("N"));
        var inside = host.HandleRequest(new BrokerRequest("r3", "sandbox.resolve",
            Payload(Obj(("root", Str(root)), ("requested", Str("a/b.txt"))))));
        Assert(inside.Ok && inside.Result?.TryGetProperty("resolved", out var resolved) == true
            && resolved.ValueKind == JsonValueKind.String, "sandbox.resolve answers with a jailed path");

        var escape = host.HandleRequest(new BrokerRequest("r4", "sandbox.resolve",
            Payload(Obj(("root", Str(root)), ("requested", Str("../escape.txt"))))));
        Assert(escape.Ok && escape.Result?.GetProperty("resolved").ValueKind == JsonValueKind.Null,
            "traversal resolves to null");

        // egress.check: public cloud pass, unapproved destination denied, unknown parent fails closed
        var pass = host.HandleRequest(new BrokerRequest("r5", "egress.check", Payload(
            Obj(("id", Str("d1")), ("sensitivity", Str("public")),
                ("allowedDestinations", "[\"api.example.com\"]"),
                ("destination", Str("api.example.com")), ("isCloud", "true")))));
        Assert(pass.Ok && pass.Result?.GetProperty("allowed").GetBoolean() == true, "egress public cloud allowed");

        var deny = host.HandleRequest(new BrokerRequest("r6", "egress.check", Payload(
            Obj(("id", Str("d1")), ("sensitivity", Str("public")),
                ("allowedDestinations", "[\"api.example.com\"]"),
                ("destination", Str("evil.com")), ("isCloud", "true")))));
        Assert(deny.Ok && deny.Result?.GetProperty("allowed").GetBoolean() == false, "egress unapproved destination denied");

        var orphan = host.HandleRequest(new BrokerRequest("r7", "egress.check", Payload(
            Obj(("id", Str("d3")), ("sensitivity", Str("public")),
                ("allowedDestinations", "[\"api.example.com\"]"),
                ("parents", "[\"ghost\"]"),
                ("destination", Str("api.example.com")), ("isCloud", "true")))));
        Assert(orphan.Ok && orphan.Result?.GetProperty("allowed").GetBoolean() == false,
            "egress unknown parent fails closed");

        // policy.issue + consume: grants once, second consume denied (one-use nonce)
        var issue = host.HandleRequest(new BrokerRequest("r8", "policy.issue", Payload(
            Obj(("capabilityId", Str("cap.edit")), ("target", Str("C:/w/file.txt")),
                ("effect", Str("file-write")), ("payloadDigest", Str("AB")),
                ("uiStateHash", Str("U1")), ("ttlMs", "60000")))));
        Assert(issue.Ok, "policy.issue returns a nonce");
        var nonce = issue.Result?.GetProperty("nonce").GetString()
            ?? throw new InvalidOperationException("test setup: no nonce");

        object consumePayload() => new
        {
            nonce,
            capabilityId = "cap.edit",
            target = "C:/w/file.txt",
            effect = "file-write",
            payloadDigest = "AB",
            uiStateHash = "U1",
        };
        var consume1 = host.HandleRequest(new BrokerRequest("r9", "policy.consume",
            Payload(JsonSerializer.Serialize(consumePayload()))));
        Assert(consume1.Ok && consume1.Result?.GetProperty("granted").GetBoolean() == true, "first consume granted");

        var consume2 = host.HandleRequest(new BrokerRequest("r10", "policy.consume",
            Payload(JsonSerializer.Serialize(consumePayload()))));
        Assert(consume2.Ok && consume2.Result?.GetProperty("granted").GetBoolean() == false,
            "second consume denied (one-use)");

        // missing required fields -> ok:false with an error message
        var missing = host.HandleRequest(new BrokerRequest("r11", "policy.consume", Payload("{}")));
        Assert(!missing.Ok && missing.Error!.Length > 0, "missing fields -> ok:false with error");

        // window.list: real EnumWindows on Windows; graceful ok:false elsewhere
        var wl = host.HandleRequest(new BrokerRequest("r12", "window.list", null));
        if (OperatingSystem.IsWindows())
        {
            Assert(wl.Ok && wl.Result?.TryGetProperty("windows", out _) == true,
                "window.list enumerates real windows on Windows");
        }
        else
        {
            Assert(!wl.Ok && wl.Error!.Contains("Windows"),
                "window.list fails closed off-Windows with a clear reason");
        }

        Console.WriteLine("ALL HOST TESTS PASSED");
        return 0;
    }

    private static void Assert(bool cond, string msg)
    {
        if (!cond) { Console.WriteLine("FAIL: " + msg); Environment.Exit(1); }
        else { Console.WriteLine("PASS: " + msg); }
    }
}
