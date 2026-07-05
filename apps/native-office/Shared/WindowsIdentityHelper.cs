using System;
using System.Security.Principal;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Windows identity helper for SID retrieval.
/// Used for Named Pipe naming and verification.
/// </summary>
internal static class WindowsIdentityHelper
{
    /// <summary>
    /// Get the current Windows user SID.
    /// Throws if SID cannot be obtained.
    /// </summary>
    public static string CurrentUserSid()
    {
        var identity = WindowsIdentity.GetCurrent();
        var sid = identity.User?.Value;
        if (string.IsNullOrWhiteSpace(sid))
            throw new InvalidOperationException("Unable to obtain current Windows SID.");
        return sid;
    }

    /// <summary>
    /// Get the pipe leaf name for the current user.
    /// Format: LaTeXSnipper.NativeOffice.v3.S-1-5-21-...
    /// </summary>
    public static string PipeLeafName =>
        $"{NativeOfficeProtocol.PipePrefix}.{CurrentUserSid()}";
}
