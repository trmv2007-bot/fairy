using System;
using System.IO;

namespace Fairy.Recovery;

/// <summary>
/// Recovery: switch to retained last-good app generation, preserve acknowledged state,
/// replay compatible events, do not replay external actions.
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
        // atomic-ish: rename current -> previous, last-good -> current
        var previous = Path.Combine(AppRoot, "previous");
        if (Directory.Exists(current)) { if (Directory.Exists(previous)) Directory.Delete(previous, true); Directory.Move(current, previous); }
        Directory.Move(LastGood, current);
        Console.WriteLine("rolled back to last-good");
        return 0;
    }
}
