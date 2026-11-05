using System;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace Fairy.Broker;

/// <summary>
/// Policy broker: grants, scoped approvals, authoritative audit.
/// Approval is bound to exact target/effect/payload digest/expiry/UI-state + one-use nonce.
/// </summary>
public sealed class PolicyBroker
{
    public sealed class Approval
    {
        public string Nonce { get; init; } = string.Empty;
        public string CapabilityId { get; init; } = string.Empty;
        public string Target { get; init; } = string.Empty;
        public string Effect { get; init; } = string.Empty;
        public string PayloadDigest { get; init; } = string.Empty;
        public string UiStateHash { get; init; } = string.Empty;
        public DateTimeOffset ExpiresAt { get; init; }
        public bool Used { get; set; }
    }

    private readonly ConcurrentDictionary<string, Approval> _approvals = new();
    private readonly ConcurrentDictionary<string, DateTimeOffset> _revoked = new();

    public string IssueApproval(string capabilityId, string target, string effect, string payloadDigest, string uiStateHash, TimeSpan ttl)
    {
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        var a = new Approval
        {
            Nonce = nonce,
            CapabilityId = capabilityId,
            Target = target,
            Effect = effect,
            PayloadDigest = payloadDigest,
            UiStateHash = uiStateHash,
            ExpiresAt = DateTimeOffset.UtcNow.Add(ttl),
        };
        _approvals[nonce] = a;
        return nonce;
    }

    public bool TryConsume(string nonce, string capabilityId, string target, string effect, string payloadDigest, string uiStateHash)
    {
        if (!_approvals.TryGetValue(nonce, out var a)) return false;
        if (a.Used) return false;
        if (a.CapabilityId != capabilityId) return false;
        if (a.Target != target) return false;
        if (a.Effect != effect) return false;
        if (a.PayloadDigest != payloadDigest) return false;
        if (a.UiStateHash != uiStateHash) return false;
        if (DateTimeOffset.UtcNow > a.ExpiresAt) return false;
        if (_revoked.ContainsKey(nonce)) return false;
        a.Used = true;
        return true;
    }

    public void Revoke(string nonce) => _revoked[nonce] = DateTimeOffset.UtcNow;

    public static string Digest(string payload)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(payload));
        return Convert.ToHexString(bytes);
    }
}
