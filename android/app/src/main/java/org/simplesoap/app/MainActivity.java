package org.simplesoap.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // must be registered before the bridge starts
        registerPlugin(PdfPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
