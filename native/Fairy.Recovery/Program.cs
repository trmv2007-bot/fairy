using System;
using Fairy.Recovery;

namespace Fairy.Recovery;

public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "rollback" && args.Length > 1 && args[1] == "--last-good")
        {
            var root = args.Length > 2 ? args[2] : "C:/Program Files/Fairy";
            return new StateRecovery(root).RollbackLastGood();
        }
        Console.WriteLine("Fairy.Recovery. Usage: rollback --last-good [appRoot]");
        return 0;
    }
}
