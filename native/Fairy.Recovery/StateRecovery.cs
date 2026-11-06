using System;
using System.IO;

namespace Fairy.Recovery;

/// <summary>
/// Recovery: switch to retained last-good app generation, preserve acknowledged state,
/// replay compatible events, do not replay external actions.
/// Rollback is non-destructive: last-good is COPIED into place (not moved), so a
/// second crash can still roll back, and the failed generation is kept in `previous`
/// for forensics. Copy-then-swap happens via directory renames on the same volume.
/// </summary>
public sealed class StateRecovery
{
    public string AppRoot { get; }
    public string LastGood { get; }
    public string Candidate { get; }

    public StateRecovery(string appRoot)
    {
        AppRoot = appRoot;
        LastGood = Path.Combine(appRoot, "releases", "last-good");
        Candidate = Path.Combine(appRoot, "releases", "candidate");
    }

    public int RollbackLastGood()
    {
        if (!Directory.Exists(LastGood)) { Console.WriteLine("no last-good release"); return 1; }
        var current = Path.Combine(AppRoot, "current");
        var previous = Path.Combine(AppRoot, "previous");
        var staging = Path.Combine(AppRoot, "releases", "staging-" + Guid.NewGuid().ToString("N"));
        try
        {
            // 1) materialize a copy of last-good; last-good itself stays intact
            CopyDirectory(LastGood, staging);
            // 2) keep the broken generation for forensics
            if (Directory.Exists(current))
            {
                if (Directory.Exists(previous)) Directory.Delete(previous, true);
                Directory.Move(current, previous);
            }
            // 3) swap the copy into place
            Directory.Move(staging, current);
            Console.WriteLine("rolled back to last-good (last-good retained for future rollbacks)");
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"rollback failed: {ex.Message}");
            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { }
            // restore serviceability if we died between steps 2 and 3
            if (!Directory.Exists(current) && Directory.Exists(previous))
            {
                try { Directory.Move(previous, current); Console.WriteLine("restored broken current (no rollback performed)"); } catch { }
            }
            return 2;
        }
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.GetFiles(source))
        {
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)));
        }
        foreach (var dir in Directory.GetDirectories(source))
        {
            CopyDirectory(dir, Path.Combine(destination, Path.GetFileName(dir)));
        }
    }
}
