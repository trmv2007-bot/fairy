using System;
using Fairy.Evaluator;

namespace Fairy.Evaluator;

public static class Program
{
    public static int Main(string[] args)
    {
        var g = new UpgradeGate();
        Console.WriteLine("manifest check (safe): " + g.CheckManifest("c1", new[]{"read","write"}));
        Console.WriteLine("manifest check (grant-change): " + g.CheckManifest("c2", new[]{"grant-change"}));
        return 0;
    }
}
