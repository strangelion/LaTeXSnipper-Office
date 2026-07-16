using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class PipeReconnectCoordinatorTests
    {
        public static int Run()
        {
            try
            {
                ReconnectsAfterDisconnect();
                Console.WriteLine("PASS PipeReconnectCoordinator reconnects after disconnect");
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("FAIL PipeReconnectCoordinator: " + ex.Message);
                return 1;
            }
        }

        private static void ReconnectsAfterDisconnect()
        {
            int attempts = 0;
            Action signalDisconnect = null;
            var firstConnected = new ManualResetEventSlim(false);
            var reconnected = new ManualResetEventSlim(false);
            var states = new List<bool>();
            object stateLock = new object();

            using (var coordinator = new PipeReconnectCoordinator(
                "test",
                (signal, cancellationToken) =>
                {
                    int attempt = Interlocked.Increment(ref attempts);
                    if (attempt == 1) return Task.FromResult(false);
                    signalDisconnect = signal;
                    return Task.FromResult(true);
                },
                connected =>
                {
                    lock (stateLock) states.Add(connected);
                    if (connected && Volatile.Read(ref attempts) == 2) firstConnected.Set();
                    if (connected && Volatile.Read(ref attempts) >= 3) reconnected.Set();
                },
                TimeSpan.FromMilliseconds(10)))
            {
                coordinator.Start();
                Assert(firstConnected.Wait(TimeSpan.FromSeconds(2)), "initial connection was not established");
                Assert(coordinator.IsConnected, "coordinator did not publish connected state");
                Assert(signalDisconnect != null, "disconnect callback was not registered");
                signalDisconnect();
                Assert(reconnected.Wait(TimeSpan.FromSeconds(2)), "coordinator did not reconnect");
                Assert(coordinator.IsConnected, "coordinator did not restore connected state");
            }

            lock (stateLock)
            {
                Assert(states.Count >= 3, "connection transitions were not published");
                Assert(states[0] && !states[1] && states[2], "connection transition order is invalid");
            }
        }

        private static void Assert(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
