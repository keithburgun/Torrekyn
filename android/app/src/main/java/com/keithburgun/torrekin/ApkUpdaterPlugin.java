package com.keithburgun.torrekin;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * In-app updates for the Android build (used by src/ui/update.ts).
 *  - fetchText: read version.json from the public builds repo (native, so no browser CORS rules apply)
 *  - downloadAndInstall: download the new APK into the app's cache, then open Android's installer for it
 *  - canInstall / openInstallSettings: Android asks once for permission to install updates from this app
 * GitHub release downloads redirect to a storage host, so redirects are followed by hand.
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    private boolean allowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", allowed());
        call.resolve(r);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void fetchText(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("No url"); return; }
        new Thread(() -> {
            try {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                get(url, buf, false);
                JSObject r = new JSObject();
                r.put("text", new String(buf.toByteArray(), StandardCharsets.UTF_8));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not reach the update server: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("No url"); return; }
        if (!allowed()) { call.reject("NOT_ALLOWED"); return; }
        new Thread(() -> {
            try {
                File out = new File(getContext().getCacheDir(), "torrekin-update.apk");
                try (OutputStream os = new FileOutputStream(out)) { get(url, os, true); }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage());
            }
        }).start();
    }

    /** GET a URL into a stream, following redirects; reports download progress when asked */
    private void get(String u, OutputStream out, boolean progress) throws IOException {
        for (int hop = 0; hop < 8; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "Torrekin-Updater");
            c.setRequestProperty("Cache-Control", "no-cache");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("Redirect without a location");
                u = new URL(new URL(u), loc).toString();
                continue;
            }
            if (code != 200) { c.disconnect(); throw new IOException("HTTP " + code); }
            long total = c.getContentLengthLong();
            try (InputStream in = new BufferedInputStream(c.getInputStream())) {
                byte[] buf = new byte[65536];
                long got = 0;
                int n;
                int last = -1;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    got += n;
                    if (progress && total > 0) {
                        int pct = (int) (got * 100 / total);
                        if (pct != last) {
                            last = pct;
                            JSObject p = new JSObject();
                            p.put("percent", pct);
                            notifyListeners("progress", p);
                        }
                    }
                }
            } finally {
                c.disconnect();
            }
            return;
        }
        throw new IOException("Too many redirects");
    }
}
