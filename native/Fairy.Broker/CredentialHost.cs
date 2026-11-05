using System;
using System.Collections.Concurrent;

namespace Fairy.Broker;

/// <summary>
/// Credential store owned by the broker. Stores only an opaque handle -> encrypted blob
/// reference; raw secrets never leave the broker process. Real impl uses
/// Windows Credential Manager / DPAPI (T05). This is the contract + in-memory fake.
/// </summary>
public sealed class CredentialHost
{
    private readonly ConcurrentDictionary<string, string> _handles = new(); // handle -> redacted label
    public string Store(string label, string secret)
    {
        // In production: encrypt via DPAPI and persist; return handle. Never store plaintext.
        var handle = "cred_" + Guid.NewGuid().ToString("N");
        _handles[handle] = label; // label only, secret discarded from this map
        _ = secret; // consumed, not retained in plaintext map
        return handle;
    }
    public bool Exists(string handle) => _handles.ContainsKey(handle);
    public string? Label(string handle) => _handles.TryGetValue(handle, out var l) ? l : null;
    public void Revoke(string handle) => _handles.TryRemove(handle, out _);
}
