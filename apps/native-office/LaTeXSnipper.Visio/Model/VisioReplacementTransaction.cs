#nullable enable
using System;

namespace LaTeXSnipper.Visio.Model
{
    internal static class VisioReplacementTransaction
    {
        public static T Replace<T>(Func<T> createCandidate, Action<T> validateCandidate, Action deleteOriginal, Action<T> deleteCandidate)
        {
            if (createCandidate == null) throw new ArgumentNullException(nameof(createCandidate));
            if (validateCandidate == null) throw new ArgumentNullException(nameof(validateCandidate));
            if (deleteOriginal == null) throw new ArgumentNullException(nameof(deleteOriginal));
            if (deleteCandidate == null) throw new ArgumentNullException(nameof(deleteCandidate));

            T candidate = createCandidate();
            try
            {
                validateCandidate(candidate);
                deleteOriginal();
                return candidate;
            }
            catch (Exception replacementError)
            {
                try { deleteCandidate(candidate); }
                catch (Exception cleanupError)
                {
                    throw new AggregateException(
                        "Visio replacement failed and the candidate could not be removed.",
                        replacementError,
                        cleanupError);
                }
                throw;
            }
        }
    }
}
