package org.simplesoap.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Renders an HTML report through Android's print pipeline.
 *
 * The report is laid out in HTML and CSS rather than drawn, so the platform's
 * print engine handles pagination and honours page-break rules — which matters
 * for a handoff document, where a table splitting mid-row is not acceptable.
 * The system print dialog lets the user save to PDF or send it straight to a
 * printer at the receiving facility.
 */
@CapacitorPlugin(name = "Pdf")
public class PdfPlugin extends Plugin {

    /**
     * Held only for the life of one print job. The WebView must outlive the
     * call or the print adapter loses its content source mid-render.
     */
    private WebView printView;

    @PluginMethod
    public void print(final PluginCall call) {
        final String html = call.getString("html");
        final String jobName = call.getString("jobName", "SOAP Note");

        if (html == null || html.isEmpty()) {
            call.reject("html is required");
            return;
        }

        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    WebView webView = new WebView(getContext());
                    // the report is generated locally and needs no scripting
                    webView.getSettings().setJavaScriptEnabled(false);

                    webView.setWebViewClient(new WebViewClient() {
                        @Override
                        public void onPageFinished(WebView view, String url) {
                            try {
                                PrintManager printManager =
                                    (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);

                                if (printManager == null) {
                                    printView = null;
                                    call.reject("Printing is not available on this device");
                                    return;
                                }

                                PrintAttributes attributes = new PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.NA_LETTER)
                                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                    .build();

                                printManager.print(
                                    jobName,
                                    view.createPrintDocumentAdapter(jobName),
                                    attributes
                                );

                                printView = null;
                                call.resolve();
                            } catch (Exception e) {
                                printView = null;
                                call.reject("Could not start the print job: " + e.getMessage());
                            }
                        }
                    });

                    webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                    printView = webView;
                } catch (Exception e) {
                    printView = null;
                    call.reject("Could not prepare the report: " + e.getMessage());
                }
            }
        });
    }
}
