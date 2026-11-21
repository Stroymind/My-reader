package io.github.stroymind.myreader;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.net.Uri;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ZoneShortcut")
public class ZoneShortcutPlugin extends Plugin {

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", ShortcutManagerCompat.isRequestPinShortcutSupported(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void getLaunchUri(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("uri", MainActivity.consumePendingDeepLink());
        call.resolve(ret);
    }

    @PluginMethod
    public void pinShortcut(PluginCall call) {
        Context ctx = getContext();
        String id = call.getString("id", "zone-shortcut-" + System.currentTimeMillis());
        String label = call.getString("label", "Zone");
        String uri = call.getString("uri", "zone://open/agent");
        String glyph = call.getString("glyph", "");
        if (glyph == null || glyph.trim().isEmpty()) {
            glyph = label != null && !label.trim().isEmpty() ? label.trim().substring(0, 1) : "Z";
        }
        if (!ShortcutManagerCompat.isRequestPinShortcutSupported(ctx)) {
            call.reject("当前桌面不支持固定快捷方式");
            return;
        }
        try {
            Intent launchIntent = new Intent(ctx, MainActivity.class);
            launchIntent.setAction(Intent.ACTION_VIEW);
            launchIntent.setData(Uri.parse(uri));
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

            Bitmap bmp = renderAppleIcon(glyph.trim().substring(0, 1));
            ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(ctx, id)
                .setShortLabel(label.length() > 14 ? label.substring(0, 14) : label)
                .setLongLabel(label)
                .setIcon(IconCompat.createWithBitmap(bmp))
                .setIntent(launchIntent)
                .build();

            boolean ok = ShortcutManagerCompat.requestPinShortcut(ctx, shortcut, null);
            JSObject ret = new JSObject();
            ret.put("ok", ok);
            ret.put("id", id);
            ret.put("uri", uri);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("创建桌面快捷方式失败: " + e.getMessage());
        }
    }

    private Bitmap renderAppleIcon(String ch) {
        int size = 192;
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);

        // Apple-style subtle warm light surface (#FFFFFF -> #F2F2F7)
        Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        bg.setShader(new LinearGradient(0, 0, 0, size,
            Color.parseColor("#FFFFFF"), Color.parseColor("#F2F2F7"), Shader.TileMode.CLAMP));
        RectF rect = new RectF(6, 6, size - 6, size - 6);
        c.drawRoundRect(rect, 44, 44, bg);

        // Delicate hairline border
        Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(2.5f);
        stroke.setColor(Color.parseColor("#1A1D1D1F"));
        c.drawRoundRect(rect, 44, 44, stroke);

        // Crisp Apple typography glyph
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setColor(Color.parseColor("#1D1D1F"));
        text.setTextSize(82f);
        text.setTypeface(Typeface.create(Typeface.SERIF, Typeface.NORMAL));
        text.setTextAlign(Paint.Align.CENTER);
        Paint.FontMetrics fm = text.getFontMetrics();
        float y = size / 2f - (fm.ascent + fm.descent) / 2f;
        c.drawText(ch, size / 2f, y, text);

        // Subtle Apple blue live indicator dot
        Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
        dot.setColor(Color.parseColor("#007AFF"));
        c.drawCircle(size - 38, 38, 9f, dot);
        return bmp;
    }
}
