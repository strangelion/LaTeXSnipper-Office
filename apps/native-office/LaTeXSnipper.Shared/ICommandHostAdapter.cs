namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Unified host adapter interface — mirrors core-protocol/command.router.ts HostAdapter.
/// Every VSTO host (Word, Excel, PowerPoint) implements this alongside its existing
/// host-specific methods.
/// </summary>
public interface ICommandHostAdapter
{
    /// <summary>
    /// Execute a unified command and return a result.
    /// </summary>
    CommandResultMessage Execute(CommandMessage cmd);
}
