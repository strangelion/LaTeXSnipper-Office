namespace LaTeXSnipper.Word.Host
{
    internal sealed class WordAdapter
    {
        private readonly Microsoft.Office.Interop.Word.Application _application;

        public WordAdapter(Microsoft.Office.Interop.Word.Application application)
        {
            _application = application;
        }

        public string HostType => "word";

        public void InsertText(string value)
        {
            System.Diagnostics.Debug.WriteLine(
                "[WordAdapter] InsertText called.");
            _application.Selection.TypeText(value);
        }

        public string GetCurrentContextId()
        {
            var document = _application.ActiveDocument;
            if (document == null)
            {
                return "word:unsaved:none";
            }

            var fullName = document.FullName;
            if (!string.IsNullOrWhiteSpace(fullName))
            {
                return "word:" + fullName;
            }

            return "word:" + document.Name;
        }
    }
}
