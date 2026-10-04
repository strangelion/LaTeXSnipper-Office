using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json.Serialization;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>Serial, inclusive stage measurements; never changes exception behavior.</summary>
public sealed class BatchStageTimings
{
    private readonly Dictionary<string, long> _ticks = new();
    private readonly Dictionary<string, int> _calls = new();

    public T Measure<T>(string stage, Func<T> operation)
    {
        if (string.IsNullOrWhiteSpace(stage)) throw new ArgumentException("Stage is required.", nameof(stage));
        if (operation == null) throw new ArgumentNullException(nameof(operation));
        long start = Stopwatch.GetTimestamp();
        try { return operation(); }
        finally
        {
            long elapsed = Stopwatch.GetTimestamp() - start;
            _ticks.TryGetValue(stage, out long previous);
            _calls.TryGetValue(stage, out int calls);
            _ticks[stage] = previous + elapsed;
            _calls[stage] = calls + 1;
        }
    }

    public void Measure(string stage, Action operation)
    {
        if (operation == null) throw new ArgumentNullException(nameof(operation));
        Measure(stage, () => { operation(); return true; });
    }

    /// <summary>Detached snapshot, safe to retain when the executor starts another chunk.</summary>
    public Dictionary<string, BatchStageMeasurement> Snapshot()
    {
        var snapshot = new Dictionary<string, BatchStageMeasurement>();
        foreach (var stage in _ticks)
            snapshot[stage.Key] = new BatchStageMeasurement(
                _calls[stage.Key], stage.Value * 1000.0 / Stopwatch.Frequency);
        return snapshot;
    }
}

public sealed class BatchStageMeasurement
{
    [JsonPropertyName("calls")] public int Calls { get; }
    [JsonPropertyName("elapsedMs")] public double ElapsedMs { get; }
    public BatchStageMeasurement(int calls, double elapsedMs)
    {
        Calls = calls;
        ElapsedMs = elapsedMs;
    }
}
