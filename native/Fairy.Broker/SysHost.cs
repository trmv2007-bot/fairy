using System;
using System.Collections.Generic;
using System.Text;

namespace Fairy.Broker;

/// <summary>
/// Real Windows integration for the broker: enumerate visible top-level windows
/// (EnumWindows P/Invoke). Fairy's window_list tool calls this through the
/// 'window.list' op; on non-Windows hosts it fails cleanly with ok:false —
/// never a crash across the boundary.
/// </summary>
public static class SysHost
{
    private const int MaxWindows = 64;
    private const int MaxTitleLength = 160;
    private const int MaxProcessLength = 64;

    public sealed record WindowEntry(long Handle, string Title, string Process);

    public static bool IsSupported => OperatingSystem.IsWindows();

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    /// <summary>Visible, titled top-level windows (handle, title, process), capped at 64.</summary>
    public static List<WindowEntry> ListWindows()
    {
        if (!IsSupported)
        {
            throw new PlatformNotSupportedException("window.list requires Windows (EnumWindows)");
        }

        var windows = new List<WindowEntry>();
        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd)) return true;
            int len = GetWindowTextLength(hWnd);
            if (len <= 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            var title = sb.ToString().Trim();
            if (title.Length == 0) return true;

            GetWindowThreadProcessId(hWnd, out var pid);
            var process = "?";
            try
            {
                process = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;
            }
            catch (ArgumentException)
            {
                // process exited between enumeration and lookup — keep the window, mark unknown
            }
            catch (InvalidOperationException)
            {
                process = "access-denied";
            }

            windows.Add(new WindowEntry(hWnd.ToInt64(), Truncate(title, MaxTitleLength), Truncate(process, MaxProcessLength)));
            return windows.Count < MaxWindows; // stop enumerating at the cap
        }, IntPtr.Zero);

        return windows;
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
