export function shouldPresentRecognitionResult(activeJobId, completedJobId) {
  if (!completedJobId) return false;
  return !activeJobId || activeJobId === completedJobId;
}
