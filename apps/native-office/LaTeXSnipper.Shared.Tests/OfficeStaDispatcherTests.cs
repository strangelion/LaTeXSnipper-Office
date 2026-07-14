using System;
using System.Threading;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class OfficeStaDispatcherTests
    {
        internal static int Run()
        {
            int failures = 0;
            Exception staError = null;
            var staThread = new Thread(() =>
            {
                try
                {
                    using (var dispatcher = new OfficeStaDispatcher("test", 2, TimeSpan.FromSeconds(1)))
                    {
                        if (!dispatcher.IsAvailable || !dispatcher.IsCurrentThread)
                            throw new InvalidOperationException("dispatcher did not bind to the creating STA");
                    }
                }
                catch (Exception error)
                {
                    staError = error;
                }
            });
            staThread.SetApartmentState(ApartmentState.STA);
            staThread.Start();
            staThread.Join();
            if (staError != null)
            {
                Console.Error.WriteLine("FAIL: STA dispatcher lifecycle: " + staError.Message);
                failures++;
            }

            bool rejectedMta = false;
            var mtaThread = new Thread(() =>
            {
                try
                {
                    using (new OfficeStaDispatcher("test")) { }
                }
                catch (InvalidOperationException)
                {
                    rejectedMta = true;
                }
            });
            mtaThread.SetApartmentState(ApartmentState.MTA);
            mtaThread.Start();
            mtaThread.Join();
            if (!rejectedMta)
            {
                Console.Error.WriteLine("FAIL: MTA dispatcher construction was accepted");
                failures++;
            }
            return failures;
        }
    }
}
