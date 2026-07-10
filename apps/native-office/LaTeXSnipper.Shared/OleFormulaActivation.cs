#nullable enable
using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace LaTeXSnipper.NativeOffice.Shared;

public sealed class OleActivationResult
{
    public bool Success { get; private set; }
    public string ErrorCode { get; private set; } = "";
    public int HResult { get; private set; }
    public string Message { get; private set; } = "";

    public static OleActivationResult Ok() => new OleActivationResult { Success = true };
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
        Exception? lastException = null;
        for (int attempt = 0; attempt < 10; attempt++)
        {
            try
            {
                automation = getAutomation();
                if (automation != null) break;
            }
            catch (COMException ex) when (IsRetryable(ex.ErrorCode))
            {
                lastException = ex;
            }
            catch (Exception ex)
            {
                return FailWithRollback("OLE_AUTOMATION_UNAVAILABLE", ex.HResult, ex.Message, rollback);
            }
            Thread.Sleep(40 + attempt * 20);
        }

        if (automation == null)
        {
            int hresult = lastException?.HResult ?? 0;
            string code = hresult == RegdbEClassNotReg ? "OLE_NOT_REGISTERED" :
                IsRetryable(hresult) ? "OLE_COM_CALL_REJECTED" : "OLE_ACTIVATION_TIMEOUT";
            return FailWithRollback(code, hresult, lastException?.Message ?? "OLE automation object was not available before the retry limit.", rollback);
        }

        try
        {
            bool initialized = OleFormulaInterop.IsInitialized(automation);
            bool verified = OleFormulaInterop.VerifyRoundTrip(automation, payload);
            if (!verified)
            {
                if (!OleFormulaInterop.Initialize(automation, payload))
                {
                    string previewCode = !string.IsNullOrWhiteSpace(payload.Render?.Svg)
                        ? "OLE_VECTOR_PREVIEW_FAILED"
                        : !string.IsNullOrWhiteSpace(payload.Render?.Png)
                            ? "OLE_RASTER_FALLBACK_FAILED"
                            : "OLE_INITIALIZE_FAILED";
                    return FailWithRollback(previewCode, 0, "InitializeFromJson failed.", rollback);
                }
                initialized = OleFormulaInterop.IsInitialized(automation);
                verified = OleFormulaInterop.VerifyRoundTrip(automation, payload);
            }
            if (!initialized)
                return FailWithRollback("OLE_INITIALIZE_FAILED", 0, "OLE object remained uninitialized after InitializeFromJson.", rollback);
            if (!verified)
                return FailWithRollback("OLE_ROUNDTRIP_FAILED", 0, "OLE payload round-trip verification failed.", rollback);
            return OleActivationResult.Ok();
        }
        catch (COMException ex)
        {
            string code = ex.ErrorCode == RegdbEClassNotReg ? "OLE_NOT_REGISTERED" :
                IsRetryable(ex.ErrorCode) ? "OLE_COM_CALL_REJECTED" : "OLE_AUTOMATION_UNAVAILABLE";
            return FailWithRollback(code, ex.ErrorCode, ex.Message, rollback);
        }
        catch (Exception ex)
        {
            return FailWithRollback("OLE_AUTOMATION_UNAVAILABLE", ex.HResult, ex.Message, rollback);
        }
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
