#nullable enable
using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace LaTeXSnipper.NativeOffice.Shared;

public sealed class OleActivationResult
{
    public bool Success { get; private set; }
    public string ErrorCode { get; private set; } = "";
    public int HResult { get; private set; }
    public string Message { get; private set; } = "";
    public object? AutomationObject { get; private set; }

    public static OleActivationResult Ok(object automationObject) =>
        new OleActivationResult { Success = true, AutomationObject = automationObject };

    public static OleActivationResult Failure(string errorCode, int hresult, string message) =>
        new OleActivationResult { Success = false, ErrorCode = errorCode, HResult = hresult, Message = message };
}

public static class OleFormulaActivation
{
    private const int RpcECallRejected = unchecked((int)0x80010001);
    private const int RpcEServerCallRetryLater = unchecked((int)0x8001010A);
    private const int MkEUnavailable = unchecked((int)0x800401E3);
    private const int RegdbEClassNotReg = unchecked((int)0x80040154);

    public static OleActivationResult ActivateAndVerify(Func<dynamic?> getAutomation, FormulaPayload payload, Action rollback)
    {
        if (getAutomation == null) throw new ArgumentNullException(nameof(getAutomation));
        if (payload == null) throw new ArgumentNullException(nameof(payload));
        if (rollback == null) throw new ArgumentNullException(nameof(rollback));

        dynamic? automation = null;
        Exception? lastAcquireError = null;
        int[] delaysMs = { 25, 50, 100, 200, 300 };

        // Phase 1: Acquire automation object with retries
        for (int attempt = 0; attempt < delaysMs.Length; attempt++)
        {
            try
            {
                automation = getAutomation();
                if (automation != null)
                    break;
            }
            catch (COMException ex) when (IsRetryable(ex.ErrorCode))
            {
                lastAcquireError = ex;
            }
            catch (Exception ex)
            {
                return FailWithRollback("OLE_AUTOMATION_UNAVAILABLE", ex.HResult, ex.Message, rollback);
            }
            Task.Delay(delaysMs[attempt]).GetAwaiter().GetResult();
        }

        if (automation == null)
        {
            int hresult = lastAcquireError?.HResult ?? 0;
            string message = lastAcquireError?.Message ?? "OLE automation object was not available.";
            string code = lastAcquireError is COMException com && IsRetryable(com.ErrorCode)
                ? "OLE_COM_CALL_REJECTED" : "OLE_AUTOMATION_UNAVAILABLE";
            return FailWithRollback(code, hresult, message, rollback);
        }

        // Phase 2: Initialize and verify with retries
        string finalErrorCode = "OLE_INITIALIZE_FAILED";
        string finalMessage = "OLE initialization or verification failed.";

        for (int attempt = 0; attempt < delaysMs.Length; attempt++)
        {
            bool initialized = OleFormulaInterop.IsInitialized(automation);
            bool verified = initialized && OleFormulaInterop.VerifyRoundTrip(automation, payload);

            if (!verified)
            {
                bool initializeSucceeded = OleFormulaInterop.Initialize(automation, payload);
                if (!initializeSucceeded)
                {
                    finalErrorCode = !string.IsNullOrWhiteSpace(payload.Render?.Svg)
                        ? "OLE_VECTOR_PREVIEW_FAILED"
                        : !string.IsNullOrWhiteSpace(payload.Render?.Png)
                            ? "OLE_RASTER_FALLBACK_FAILED"
                            : "OLE_INITIALIZE_FAILED";
                    finalMessage = "InitializeFromJson failed.";
                }
                else
                {
                    initialized = OleFormulaInterop.IsInitialized(automation);
                    verified = initialized && OleFormulaInterop.VerifyRoundTrip(automation, payload);
                }
            }

            if (initialized && verified)
                return OleActivationResult.Ok(automation);

            Task.Delay(delaysMs[attempt]).GetAwaiter().GetResult();
        }

        return FailWithRollback(finalErrorCode, 0, finalMessage, rollback);
    }

    private static bool IsRetryable(int hresult) =>
        hresult == RpcECallRejected || hresult == RpcEServerCallRetryLater || hresult == MkEUnavailable;

    private static OleActivationResult FailWithRollback(string code, int hresult, string message, Action rollback)
    {
        System.Diagnostics.Debug.WriteLine($"[OleFormulaActivation] code={code} hresult=0x{hresult:X8} detail={message}");
        try { rollback(); }
        catch (Exception rollbackError)
        {
            message += $" Rollback failed: {rollbackError.Message}";
        }
        return OleActivationResult.Failure(code, hresult, message);
    }
}
