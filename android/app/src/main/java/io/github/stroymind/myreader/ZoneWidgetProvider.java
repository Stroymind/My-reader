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
            arr.put(new JSONObject().put("id", "zone-chief").put("name", "Zone 总管").put("role", "自动调度所有能力 · 直接说话派活").put("shape", "orb").put("accent", "#007AFF"));
            arr.put(new JSONObject().put("id", "bot-sichao").put("name", "思潮官").put("role", "云端 24/7 情报筛选与独立判断").put("shape", "prism").put("accent", "#5856D6"));
            arr.put(new JSONObject().put("id", "bot-reader").put("name", "研读官").put("role", "精读文档、生成小册子与星海记忆").put("shape", "halo").put("accent", "#34C759"));
            arr.put(new JSONObject().put("id", "bot-phone").put("name", "手机代办官").put("role", "语音跨 App 操作手机与生成微应用").put("shape", "fold").put("accent", "#FF9500"));
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
        int s = 160;
        Bitmap bmp = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        int accent;
        try { accent = Color.parseColor(accentHex); } catch (Exception e) { accent = Color.parseColor("#007AFF"); }
        int softAccent = Color.argb(38, Color.red(accent), Color.green(accent), Color.blue(accent));

        // Subtle Apple squircle ceramic base
        Paint base = new Paint(Paint.ANTI_ALIAS_FLAG);
        base.setShader(new LinearGradient(0, 0, s, s, Color.parseColor("#FFFFFF"), Color.parseColor("#F2F2F7"), Shader.TileMode.CLAMP));
        RectF r = new RectF(6, 6, s - 6, s - 6);
        c.drawRoundRect(r, 40, 40, base);

        Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
        border.setStyle(Paint.Style.STROKE);
        border.setStrokeWidth(2.4f);
        border.setColor(Color.parseColor("#1A1D1D1F"));
        c.drawRoundRect(r, 40, 40, border);

        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(softAccent);
        Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeWidth(4.5f);
        line.setColor(accent);
        Paint core = new Paint(Paint.ANTI_ALIAS_FLAG);
        core.setColor(accent);

        float cx = s / 2f, cy = s / 2f;
        if ("prism".equals(shape)) {
            Path p = new Path();
            p.moveTo(cx, 32); p.lineTo(s - 34, s - 38); p.lineTo(34, s - 38); p.close();
            c.drawPath(p, fill);
            c.drawPath(p, line);
            c.drawCircle(cx, cy + 10, 9, core);
        } else if ("halo".equals(shape)) {
            c.drawCircle(cx, cy, 42, fill);
            c.drawCircle(cx, cy, 42, line);
            c.drawOval(new RectF(cx - 50, cy - 18, cx + 50, cy + 18), line);
            c.drawCircle(cx, cy, 8, core);
        } else if ("fold".equals(shape)) {
            Path p = new Path();
            p.moveTo(cx, 28); p.lineTo(s - 30, cy); p.lineTo(cx, s - 28); p.lineTo(30, cy); p.close();
            c.drawPath(p, fill);
            c.drawPath(p, line);
            c.drawLine(30, cy, s - 30, cy, line);
            c.drawCircle(cx, cy, 8, core);
        } else {
            // Default Apple Living Orb (concentric harmonic rings)
            c.drawCircle(cx, cy, 44, fill);
            c.drawCircle(cx, cy, 44, line);
            c.drawCircle(cx, cy, 24, line);
            c.drawCircle(cx + 16, cy - 16, 8, core);
        }
        return bmp;
    }
}
