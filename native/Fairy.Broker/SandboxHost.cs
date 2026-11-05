using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace Fairy.Broker;

/// <summary>
/// Worker containment host. Prototype: Job Object for lifecycle/resource containment
/// + path-jail + ACL checks on protected dirs. AppContainer integration is the
/// real OS-enforced boundary (T04 gate); this is the scaffolding + tests.
/// </summary>
public sealed class SandboxHost
{
    public string WorkspaceRoot { get; }
    public SandboxHost(string workspaceRoot)
    {
        WorkspaceRoot = Path.GetFullPath(workspaceRoot);
        Directory.CreateDirectory(WorkspaceRoot);
    }

    /// <summary>Resolve a requested path; reject escapes via .., junctions, symlinks.</summary>
    public string? ResolveInside(string requested)
    {
        if (string.IsNullOrWhiteSpace(requested)) return null;
        // reject absolute-ish / drive letters
        if (Path.IsPathRooted(requested)) return null;
        string candidate;
        try { candidate = Path.GetFullPath(Path.Combine(WorkspaceRoot, requested)); }
        catch { return null; }
        if (!candidate.StartsWith(WorkspaceRoot, StringComparison.OrdinalIgnoreCase)) return null;
        // reject any reparse point (junction/symlink) along the resolved path
        try
        {
            var rel = Path.GetRelativePath(WorkspaceRoot, candidate);
            var cur = WorkspaceRoot;
            if (rel != ".")
            {
                foreach (var part in rel.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
                {
                    if (string.IsNullOrEmpty(part) || part == ".") continue;
                    cur = Path.Combine(cur, part);
                    var di = new DirectoryInfo(cur);
                    if ((di.Attributes & FileAttributes.ReparsePoint) == FileAttributes.ReparsePoint) return null;
                    var fi = new FileInfo(cur);
                    if (fi.Exists && (fi.Attributes & FileAttributes.ReparsePoint) == FileAttributes.ReparsePoint) return null;
                }
            }
        }
        catch { return null; }
        // resolve reparse points
        try
        {
            var fi = new FileInfo(candidate);
            if (fi.Exists)
            {
                var real = fi.ResolveLinkTarget(returnFinalTarget: true);
                if (real != null && !real.FullName.StartsWith(WorkspaceRoot, StringComparison.OrdinalIgnoreCase)) return null;
            }
            var di = new DirectoryInfo(candidate);
            if (di.Exists)
            {
                var real = di.ResolveLinkTarget(returnFinalTarget: true);
                if (real != null && !real.FullName.StartsWith(WorkspaceRoot, StringComparison.OrdinalIgnoreCase)) return null;
            }
        }
        catch { return null; }
        return candidate;
    }

    public bool IsAllowedNetwork(string host) =>
        // default deny; allowlist populated by broker grants
        false;

    public bool CanCreateProcess() => false;     // generated workers may not spawn unrestricted children
    public bool CanAccessDesktop() => false;     // no UI automation
    public bool CanReadCredentials() => false;   // no credential store access
}
