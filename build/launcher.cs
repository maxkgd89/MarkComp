using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Tiny launcher placed next to the packaged Electron app. Chromium's sandbox
// fails to initialize on some locked-down Windows machines (the process exits
// with STATUS_BREAKPOINT or an access violation before any app code runs), so
// the launcher retries once with --no-sandbox when it observes that failure.
// It keeps running while the app is open so electron-builder's portable target
// can clean up its temporary folder after exit.

[assembly: System.Reflection.AssemblyTitle("Markdown Review Studio")]
[assembly: System.Reflection.AssemblyProduct("Markdown Review Studio")]
[assembly: System.Reflection.AssemblyCompany("maxkgd89")]
[assembly: System.Reflection.AssemblyVersion("0.1.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.1.0.0")]

internal static class Program
{
    private const int SandboxBreakpoint = unchecked((int)0x80000003);
    private const int SandboxAccessViolation = unchecked((int)0xC0000005);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    [STAThread]
    private static int Main(string[] args)
    {
        var directory = AppDomain.CurrentDomain.BaseDirectory;
        var core = Path.Combine(directory, "Markdown Review Studio Core.exe");

        if (!File.Exists(core))
        {
            MessageBoxW(IntPtr.Zero,
                "The application files are incomplete.\r\n\r\nExpected:\r\n" + core,
                "Markdown Review Studio", 0x10);
            return 1;
        }

        var first = Start(core, directory, args, null);
        if (first == null) return 1;

        if (!first.WaitForExit(2000))
        {
            first.WaitForExit();
            return first.ExitCode;
        }

        var exitCode = first.ExitCode;
        if (exitCode != SandboxBreakpoint && exitCode != SandboxAccessViolation)
        {
            return exitCode;
        }

        // The sandbox could not start; retry with it disabled.
        var retry = Start(core, directory, args, "--no-sandbox");
        if (retry == null) return 1;
        retry.WaitForExit();
        return retry.ExitCode;
    }

    private static Process Start(string core, string directory, string[] args, string prefix)
    {
        try
        {
            var info = new ProcessStartInfo(core)
            {
                UseShellExecute = false,
                WorkingDirectory = directory
            };

            var commandLine = new StringBuilder();
            if (prefix != null) commandLine.Append(prefix);
            foreach (var arg in args)
            {
                if (commandLine.Length > 0) commandLine.Append(' ');
                commandLine.Append(Quote(arg));
            }

            info.Arguments = commandLine.ToString();
            return Process.Start(info);
        }
        catch (Exception ex)
        {
            MessageBoxW(IntPtr.Zero,
                "Could not start the application.\r\n\r\n" + ex.Message,
                "Markdown Review Studio", 0x10);
            return null;
        }
    }

    // Windows command-line quoting rules (see CommandLineToArgvW).
    private static string Quote(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;

        var result = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var c in arg)
        {
            if (c == '\\')
            {
                backslashes++;
                continue;
            }
            if (c == '"')
            {
                result.Append('\\', backslashes * 2 + 1).Append('"');
                backslashes = 0;
                continue;
            }
            result.Append('\\', backslashes).Append(c);
            backslashes = 0;
        }
        result.Append('\\', backslashes * 2).Append('"');
        return result.ToString();
    }
}
