using System;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace Fairy.Broker;

/// <summary>
/// Credential store owned by the broker. Stores an opaque handle -> encrypted blob;
/// raw secrets never leave the broker process. On Windows secrets are encrypted with
/// DPAPI (CurrentUser scope); elsewhere an ephemeral AES-GCM key with process lifetime
/// is used (keys are unrecoverable after restart by design until a persistent store lands).
/// Plaintext exists only transiently inside Protect/Unprotect.
/// </summary>
public sealed class CredentialHost
{
    private sealed record Entry(string Label, byte[] Blob, bool Dpapi);

    private readonly ConcurrentDictionary<string, Entry> _entries = new();
    // Ephemeral key for the non-Windows fallback: generated once per process, never persisted.
    private static readonly byte[] EphemeralKey = RandomNumberGenerator.GetBytes(32);

    public string Store(string label, string secret)
    {
        if (string.IsNullOrEmpty(label)) throw new ArgumentException("label must be non-empty", nameof(label));
        if (string.IsNullOrEmpty(secret)) throw new ArgumentException("secret must be non-empty", nameof(secret));
        var handle = "cred_" + Guid.NewGuid().ToString("N");
        var plain = Encoding.UTF8.GetBytes(secret);
        var dpapi = OperatingSystem.IsWindows();
        try
        {
            var blob = Protect(plain, dpapi);
            _entries[handle] = new Entry(label, blob, dpapi);
            return handle;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    /// <summary>
    /// Decrypt and return the secret for a handle, or null if unknown/revoked.
    /// Callers must treat the value as single-use and never persist it.
    /// </summary>
    public string? Retrieve(string handle)
    {
        if (!_entries.TryGetValue(handle, out var entry)) return null;
        try
        {
            var plain = Unprotect(entry.Blob, entry.Dpapi);
            var secret = Encoding.UTF8.GetString(plain);
            CryptographicOperations.ZeroMemory(plain);
            return secret;
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    public bool Exists(string handle) => _entries.ContainsKey(handle);
    public string? Label(string handle) => _entries.TryGetValue(handle, out var e) ? e.Label : null;
    public void Revoke(string handle) => _entries.TryRemove(handle, out _);

    private static byte[] Protect(byte[] plain, bool useDpapi)
    {
        if (useDpapi)
        {
#if WINDOWS_CREDENTIAL_DPAPI
            return System.Security.Cryptography.ProtectedData.Protect(plain, optionalEntropy: null, DataProtectionScope.CurrentUser);
#else
            return AesProtect(plain);
#endif
        }
        return AesProtect(plain);
    }

    private static byte[] Unprotect(byte[] blob, bool useDpapi)
    {
        if (useDpapi)
        {
#if WINDOWS_CREDENTIAL_DPAPI
            return System.Security.Cryptography.ProtectedData.Unprotect(blob, optionalEntropy: null, DataProtectionScope.CurrentUser);
#else
            return AesUnprotect(blob);
#endif
        }
        return AesUnprotect(blob);
    }

    // AES-256-GCM with a fresh 12-byte nonce per blob: layout = nonce || ciphertext || tag(16).
    private static byte[] AesProtect(byte[] plain)
    {
        using var aes = new AesGcm(EphemeralKey, tagSizeInBytes: 16);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        aes.Encrypt(nonce, plain, cipher, tag);
        var blob = new byte[nonce.Length + cipher.Length + tag.Length];
        Buffer.BlockCopy(nonce, 0, blob, 0, nonce.Length);
        Buffer.BlockCopy(cipher, 0, blob, nonce.Length, cipher.Length);
        Buffer.BlockCopy(tag, 0, blob, nonce.Length + cipher.Length, tag.Length);
        return blob;
    }

    private static byte[] AesUnprotect(byte[] blob)
    {
        if (blob.Length < 12 + 16) throw new CryptographicException("credential blob truncated");
        using var aes = new AesGcm(EphemeralKey, tagSizeInBytes: 16);
        var nonce = new byte[12];
        var tag = new byte[16];
        var cipher = new byte[blob.Length - 12 - 16];
        Buffer.BlockCopy(blob, 0, nonce, 0, 12);
        Buffer.BlockCopy(blob, 12, cipher, 0, cipher.Length);
        Buffer.BlockCopy(blob, blob.Length - 16, tag, 0, 16);
        var plain = new byte[cipher.Length];
        aes.Decrypt(nonce, cipher, tag, plain);
        return plain;
    }
}
