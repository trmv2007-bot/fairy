using System;
using Fairy.Tests;

namespace Fairy.Tests;

public static class Program
{
    public static int Main(string[] args)
    {
        if (PolicyTests.Run() != 0) return 1;
        if (SandboxTests.Run() != 0) return 1;
        if (EgressTests.Run() != 0) return 1;
        if (RecoveryTests.Run() != 0) return 1;
        return 0;
    }
}
