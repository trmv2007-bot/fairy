using System;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace Fairy.Broker;

/// <summary>
/// Policy broker: grants, scoped approvals, authoritative audit.
/// Approval is bound to exact target/effect/payload digest/expiry/UI-state + one-use nonce.
/// Used, expired and revoked entries are pruned on access so a long-lived broker
/// cannot grow without bound. TTL is validated (positive, capped).
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

    /// <summary>Upper bound for approval lifetimes; longer TTLs are clamped to this.</summary>
    public static readonly TimeSpan MaxTtl = TimeSpan.FromMinutes(30);

    private readonly ConcurrentDictionary<string, Approval> _approvals = new();
    private readonly ConcurrentDictionary<string, DateTimeOffset> _revoked = new();

    public string IssueApproval(string capabilityId, string target, string effect, string payloadDigest, string uiStateHash, TimeSpan ttl)
    {
        if (string.IsNullOrEmpty(capabilityId)) throw new ArgumentException("capabilityId must be non-empty", nameof(capabilityId));
        if (string.IsNullOrEmpty(target)) throw new ArgumentException("target must be non-empty", nameof(target));
        if (string.IsNullOrEmpty(effect)) throw new ArgumentException("effect must be non-empty", nameof(effect));
        if (ttl <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(ttl), "approval TTL must be positive");
        if (ttl > MaxTtl) ttl = MaxTtl;
        Prune();
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
        if (string.IsNullOrEmpty(nonce)) return false;
        Prune();
        if (!_approvals.TryGetValue(nonce, out var a)) return false;
        lock (a)
        {
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
    }

    public void Revoke(string nonce) => _revoked[nonce] = DateTimeOffset.UtcNow;

    /// <summary>Remove consumed/expired approvals and stale revocation markers.</summary>
    public void Prune()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var kv in _approvals)
        {
            if (kv.Value.Used || kv.Value.ExpiresAt < now) _approvals.TryRemove(kv.Key, out _);
        }
        foreach (var kv in _revoked)
        {
            if (kv.Value < now - MaxTtl) _revoked.TryRemove(kv.Key, out _);
        }
    }

    public int ApprovalCount => _approvals.Count;
    public int RevokedCount => _revoked.Count;

    public static string Digest(string payload)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(payload));
        return Convert.ToHexString(bytes);
    }
}
