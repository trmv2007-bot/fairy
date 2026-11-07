using System;
using System.Collections.Concurrent;
using System.Text.Json;

namespace Fairy.Broker;

/// <summary>Wire request envelope: {"id","op","payload"} over newline-delimited JSON.</summary>
public sealed record BrokerRequest(string Id, string Op, JsonElement? Payload);

/// <summary>Wire response envelope: {"id","ok",("result"|"error")}</summary>
public sealed record BrokerResponse(string Id, bool Ok, JsonElement? Result, string? Error)
{
    public static BrokerResponse Ok(string id, object? result) =>
        new(id, true, result is null ? null : JsonSerializer.SerializeToElement(result), null);

    public static BrokerResponse Fail(string id, string error) => new(id, false, null, error);
}

/// <summary>
/// Protocol handler for the native broker host. Pure request->response logic so it is
/// unit-testable without pipes (see Fairy.Tests/HostTests.cs). Transport lives in Program.cs.
/// Every failure returns ok:false — the host never throws across the boundary.
/// </summary>
public sealed class BrokerHost
{
    public const string DefaultPipeName = "fairy-broker";
    public const string ProtocolVersion = "1";

    private readonly PolicyBroker policy = new();
    private readonly ConcurrentDictionary<string, SandboxHost> sandboxes =
        new(StringComparer.OrdinalIgnoreCase);

    public PolicyBroker Policy => policy;

    public BrokerResponse HandleRequest(BrokerRequest req)
    {
        if (string.IsNullOrEmpty(req.Id) || string.IsNullOrEmpty(req.Op))
        {
            return BrokerResponse.Fail(req.Id ?? string.Empty, "malformed request envelope: id and op are required");
        }
        try
        {
            var result = req.Op switch
            {
                "ping" => Ping(),
                "sandbox.resolve" => SandboxResolve(req.Payload),
                "egress.check" => EgressCheck(req.Payload),
                "policy.issue" => PolicyIssue(req.Payload),
                "policy.consume" => PolicyConsume(req.Payload),
                "window.list" => WindowList(),
                _ => throw new InvalidOperationException($"unknown op '{req.Op}'"),
            };
            return BrokerResponse.Ok(req.Id, result);
        }
        catch (Exception ex)
        {
            return BrokerResponse.Fail(req.Id, ex.Message);
        }
    }

    private static object Ping() => new { pong = true, version = ProtocolVersion };

    /// <summary>Real Windows integration: EnumWindows-backed window sweep (SysHost).</summary>
    private static object WindowList()
    {
        if (!SysHost.IsSupported)
        {
            throw new PlatformNotSupportedException("window.list requires Windows (EnumWindows)");
        }
        var windows = SysHost.ListWindows();
        return new { windows };
    }

    /// <summary>payload: { root, requested } -> { resolved: string|null }. Path stays jailed.</summary>
    private object SandboxResolve(JsonElement? payload)
    {
        var (root, requested) = RequireStrings(payload, "root", "requested");
        var host = sandboxes.GetOrAdd(root, r => new SandboxHost(r));
        var resolved = host.ResolveInside(requested);
        return new { resolved };
    }

    /// <summary>
    /// payload: { id, sensitivity, allowedDestinations: [...], destination, isCloud,
    ///            parents?: [...ids], parentData?: { id: {id,sensitivity,allowedDestinations,parents} } }
    /// -> { allowed: bool }. Unknown parents fail closed (fail-closed provenance).
    /// </summary>
    private object EgressCheck(JsonElement? payload)
    {
        if (payload is null) throw new ArgumentException("egress.check requires a payload");
        var p = payload.Value;
        var gate = new EgressHost();

        if (p.TryGetProperty("parentData", out var parentData) && parentData.ValueKind == JsonValueKind.Object)
        {
            gate.ParentResolver = id =>
            {
                if (!parentData.TryGetProperty(id, out var el)) return null;
                return ParseDataRef(el);
            };
        }

        var data = ParseDataRef(p);
        var destination = RequireString(p, "destination");
        bool isCloud = p.TryGetProperty("isCloud", out var cloudEl) && cloudEl.ValueKind == JsonValueKind.True;
        var allowed = gate.AllowTransfer(data, destination, isCloud);
        return new { allowed };
    }

    /// <summary>payload: { capabilityId, target, effect, payloadDigest, uiStateHash, ttlMs } -> { nonce }.</summary>
    private object PolicyIssue(JsonElement? payload)
    {
        if (payload is null) throw new ArgumentException("policy.issue requires a payload");
        var p = payload.Value;
        var capabilityId = RequireString(p, "capabilityId");
        var target = RequireString(p, "target");
        var effect = RequireString(p, "effect");
        var payloadDigest = p.TryGetProperty("payloadDigest", out var pd) && pd.ValueKind == JsonValueKind.String
            ? pd.GetString() ?? string.Empty
            : string.Empty;
        var uiStateHash = p.TryGetProperty("uiStateHash", out var uh) && uh.ValueKind == JsonValueKind.String
            ? uh.GetString() ?? string.Empty
            : string.Empty;
        var ttlMs = p.TryGetProperty("ttlMs", out var ttl) && ttl.TryGetInt64(out var ms) ? ms
            : throw new ArgumentException("policy.issue requires a positive integer ttlMs");
        if (ttlMs <= 0) throw new ArgumentException("policy.issue requires a positive integer ttlMs");
        var nonce = policy.IssueApproval(capabilityId, target, effect, payloadDigest, uiStateHash, TimeSpan.FromMilliseconds(ttlMs));
        return new { nonce };
    }

    /// <summary>payload: { nonce, capabilityId, target, effect, payloadDigest, uiStateHash } -> { granted }.</summary>
    private object PolicyConsume(JsonElement? payload)
    {
        if (payload is null) throw new ArgumentException("policy.consume requires a payload");
        var p = payload.Value;
        var granted = policy.TryConsume(
            RequireString(p, "nonce"),
            RequireString(p, "capabilityId"),
            RequireString(p, "target"),
            RequireString(p, "effect"),
            p.TryGetProperty("payloadDigest", out var pd) && pd.ValueKind == JsonValueKind.String ? pd.GetString() ?? string.Empty : string.Empty,
            p.TryGetProperty("uiStateHash", out var uh) && uh.ValueKind == JsonValueKind.String ? uh.GetString() ?? string.Empty : string.Empty);
        return new { granted };
    }

    private static EgressHost.DataRef ParseDataRef(JsonElement e)
    {
        var id = RequireString(e, "id");
        var sensitivity = e.TryGetProperty("sensitivity", out var s) && s.ValueKind == JsonValueKind.String
            ? s.GetString() ?? string.Empty
            : string.Empty;
        var destinations = new System.Collections.Generic.List<string>();
        if (e.TryGetProperty("allowedDestinations", out var dests) && dests.ValueKind == JsonValueKind.Array)
        {
            foreach (var d in dests.EnumerateArray())
            {
                if (d.ValueKind == JsonValueKind.String) destinations.Add(d.GetString() ?? string.Empty);
            }
        }
        var parents = new System.Collections.Generic.List<string>();
        if (e.TryGetProperty("parents", out var pars) && pars.ValueKind == JsonValueKind.Array)
        {
            foreach (var par in pars.EnumerateArray())
            {
                if (par.ValueKind == JsonValueKind.String) parents.Add(par.GetString() ?? string.Empty);
            }
        }
        return new EgressHost.DataRef(id, sensitivity, destinations, parents);
    }

    private static string RequireString(JsonElement e, string name)
    {
        if (!e.TryGetProperty(name, out var el) || el.ValueKind != JsonValueKind.String)
        {
            throw new ArgumentException($"missing string field '{name}'");
        }
        var s = el.GetString();
        if (string.IsNullOrEmpty(s)) throw new ArgumentException($"field '{name}' must be non-empty");
        return s;
    }

    private static (string, string) RequireStrings(JsonElement? payload, string a, string b)
    {
        if (payload is null) throw new ArgumentException($"payload required (expects '{a}' and '{b}')");
        return (RequireString(payload.Value, a), RequireString(payload.Value, b));
    }
}
