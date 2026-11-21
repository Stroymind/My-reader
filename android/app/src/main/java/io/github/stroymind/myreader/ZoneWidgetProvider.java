package io.github.stroymind.myreader;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.net.Uri;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

public class ZoneWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_NEXT_BOT = "io.github.stroymind.myreader.ACTION_NEXT_BOT";
    private static final String PREFS = "zone_widget_prefs";
    private static final String KEY_BOTS = "bots_json";
    private static final String KEY_INDEX = "active_index";

    private static JSONArray defaultBots() {
        JSONArray arr = new JSONArray();
        try {
            arr.put(new JSONObject().put("id", "zone-chief").put("name", "Zone").put("role", "点右侧直接说话派活 · 形象与规则由你定义").put("shape", "onigiri").put("accent", "#111111"));
        } catch (Exception ignored) {}
        return arr;
    }

    public static void saveBots(Context ctx, String botsJson, int activeIdx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor ed = sp.edit();
        if (botsJson != null && !botsJson.isEmpty()) ed.putString(KEY_BOTS, botsJson);
        if (activeIdx >= 0) ed.putInt(KEY_INDEX, activeIdx);
        ed.apply();
        refreshAll(ctx);
    }

    public static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, ZoneWidgetProvider.class));
        for (int id : ids) updateWidget(ctx, mgr, id);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) updateWidget(context, appWidgetManager, id);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_NEXT_BOT.equals(intent.getAction())) {
            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray bots = loadBots(sp);
            int cur = sp.getInt(KEY_INDEX, 0);
            int next = bots.length() > 0 ? (cur + 1) % bots.length() : 0;
            sp.edit().putInt(KEY_INDEX, next).apply();
            refreshAll(context);
        }
    }

    private static JSONArray loadBots(SharedPreferences sp) {
        try {
            String raw = sp.getString(KEY_BOTS, "");
            if (raw != null && !raw.isEmpty()) {
                JSONArray arr = new JSONArray(raw);
                if (arr.length() > 0) return arr;
            }
        } catch (Exception ignored) {}
        return defaultBots();
    }

    private static void updateWidget(Context ctx, AppWidgetManager mgr, int appWidgetId) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray bots = loadBots(sp);
        int idx = Math.abs(sp.getInt(KEY_INDEX, 0)) % Math.max(1, bots.length());
        JSONObject bot = bots.optJSONObject(idx);
        String id = bot != null ? bot.optString("id", "zone-chief") : "zone-chief";
        String name = bot != null ? bot.optString("name", "Zone 总管") : "Zone 总管";
        String role = bot != null ? bot.optString("role", "随时待命") : "随时待命";
        String shape = bot != null ? bot.optString("shape", "orb") : "orb";
        String accent = bot != null ? bot.optString("accent", "#007AFF") : "#007AFF";

        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.zone_widget);
        rv.setTextViewText(R.id.zone_widget_name, name);
        rv.setTextViewText(R.id.zone_widget_role, role);
        rv.setTextViewText(R.id.zone_widget_badge, (idx + 1) + "/" + bots.length());
        rv.setImageViewBitmap(R.id.zone_widget_avatar, renderGeometricAvatar(shape, accent));

        // 1. Tap Switch -> cycle Bot directly on home screen
        Intent nextIntent = new Intent(ctx, ZoneWidgetProvider.class);
        nextIntent.setAction(ACTION_NEXT_BOT);
        PendingIntent nextPi = PendingIntent.getBroadcast(
            ctx, 101, nextIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        rv.setOnClickPendingIntent(R.id.zone_widget_switch, nextPi);

        // 2. Tap Mic -> instant voice launch with active Bot
        Intent voiceIntent = new Intent(ctx, MainActivity.class);
        voiceIntent.setAction(Intent.ACTION_VIEW);
        voiceIntent.setData(Uri.parse("zone://open/voice?bot=" + Uri.encode(id)));
        voiceIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent voicePi = PendingIntent.getActivity(
            ctx, 102, voiceIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        rv.setOnClickPendingIntent(R.id.zone_widget_mic, voicePi);

        // 3. Tap Body/Avatar -> open active Bot workspace
        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setAction(Intent.ACTION_VIEW);
        openIntent.setData(Uri.parse("zone://open/bot/" + Uri.encode(id)));
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(
            ctx, 103, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        rv.setOnClickPendingIntent(R.id.zone_widget_info, openPi);
        rv.setOnClickPendingIntent(R.id.zone_widget_avatar, openPi);

        mgr.updateAppWidget(appWidgetId, rv);
    }

    private static Bitmap renderGeometricAvatar(String shape, String accentHex) {
        int s = 184;
        Bitmap bmp = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        int fillCol;
        try { fillCol = Color.parseColor(accentHex); } catch (Exception e) { fillCol = Color.parseColor("#111111"); }
        Paint body = new Paint(Paint.ANTI_ALIAS_FLAG);
        body.setColor(fillCol);
        Paint eye = new Paint(Paint.ANTI_ALIAS_FLAG);
        eye.setColor(Color.WHITE);

        float cx = s / 2f, cy = s / 2f;
        if ("cube".equals(shape)) {
            c.save(); c.rotate(-16f, cx, cy);
            c.drawRoundRect(new RectF(28, 28, s - 28, s - 28), 28, 28, body);
            c.drawRoundRect(new RectF(76, 76, 90, 108), 7, 7, eye);
            c.drawRoundRect(new RectF(104, 76, 118, 108), 7, 7, eye);
            c.restore();
        } else if ("bean".equals(shape)) {
            c.save(); c.rotate(-15f, cx, cy);
            c.drawRoundRect(new RectF(20, 46, s - 20, s - 46), 46, 46, body);
            c.drawRoundRect(new RectF(82, 72, 96, 104), 7, 7, eye);
            c.drawRoundRect(new RectF(110, 72, 124, 104), 7, 7, eye);
            c.restore();
        } else if ("orb".equals(shape)) {
            c.save(); c.rotate(-12f, cx, cy);
            c.drawCircle(cx, cy, 70, body);
            c.drawRoundRect(new RectF(84, 66, 98, 98), 7, 7, eye);
            c.drawRoundRect(new RectF(112, 66, 126, 98), 7, 7, eye);
            c.restore();
        } else {
            // Iconic plump rounded onigiri triangle
            Path p = new Path();
            p.moveTo(cx, 22);
            p.cubicTo(cx + 16, 22, s - 22, s - 46, s - 24, s - 32);
            p.cubicTo(s - 26, s - 18, 26, s - 18, 24, s - 32);
            p.cubicTo(22, s - 46, cx - 16, 22, cx, 22);
            p.close();
            c.drawPath(p, body);
            c.drawRoundRect(new RectF(74, 86, 88, 120), 7, 7, eye);
            c.drawRoundRect(new RectF(102, 86, 116, 120), 7, 7, eye);
        }
        return bmp;
    }
}
