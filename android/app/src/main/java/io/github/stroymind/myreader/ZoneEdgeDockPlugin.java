package io.github.stroymind.myreader;

import android.animation.ValueAnimator;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Zone 跨应用右缘吸附悬浮条（真实 Android WindowManager 系统悬浮窗）：
 * - 将卡片或卡片堆拖到屏幕右侧吸附后，即使退出 Zone 回到桌面或其他 App，仍贴附在手机右侧边缘
 * - 轻点或向左轻滑：立即拉起 Zone 回到该书或卡片堆继续阅读
 * - 向左上方拖到顶部「松手放回书流」区域：自动解除吸附并把卡片/堆放回原位
 */
@CapacitorPlugin(name = "ZoneEdgeDock")
public class ZoneEdgeDockPlugin extends Plugin {
    private static final String PREFS = "zone_edge_dock_v1";
    private static volatile View sEdgeView = null;
    private static volatile View sReturnZoneView = null;
    private static volatile WindowManager.LayoutParams sEdgeLp = null;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private boolean overlayGranted(Context ctx) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx);
    }

    private int dp(Context ctx, float v) {
        return Math.round(v * ctx.getResources().getDisplayMetrics().density);
    }

    @PluginMethod
    public void canDrawOverlays(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", overlayGranted(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(ctx)) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            } catch (Exception ignored) {}
        }
        JSObject ret = new JSObject();
        ret.put("granted", overlayGranted(ctx));
        call.resolve(ret);
    }

    @PluginMethod
    public void getDockedItem(PluginCall call) {
        SharedPreferences sp = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = sp.getString("id", "");
        JSObject ret = new JSObject();
        ret.put("docked", !id.isEmpty());
        ret.put("id", id);
        ret.put("kind", sp.getString("kind", "book"));
        ret.put("title", sp.getString("title", ""));
        ret.put("subtitle", sp.getString("subtitle", ""));
        ret.put("uri", sp.getString("uri", ""));
        call.resolve(ret);
    }

    @PluginMethod
    public void dockItem(PluginCall call) {
        final Context appCtx = getContext().getApplicationContext();
        final String id = call.getString("id", "");
        final String kind = call.getString("kind", "book");
        final String title = call.getString("title", "阅读卡片");
        final String subtitle = call.getString("subtitle", "");
        final String uri = call.getString("uri", "");

        if (id == null || id.isEmpty()) {
            call.reject("Missing id");
            return;
        }
        appCtx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("id", id)
            .putString("kind", kind)
            .putString("title", title)
            .putString("subtitle", subtitle)
            .putString("uri", uri)
            .apply();

        final boolean granted = overlayGranted(appCtx);
        if (granted) {
            mainHandler.post(() -> showNativeEdgeHandle(appCtx, id, kind, title, uri));
        }

        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("systemOverlay", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void undockItem(PluginCall call) {
        final Context appCtx = getContext().getApplicationContext();
        appCtx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        mainHandler.post(() -> removeNativeOverlays(appCtx));
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    private void removeNativeOverlays(Context ctx) {
        WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        if (wm == null) return;
        if (sEdgeView != null) {
            try { wm.removeView(sEdgeView); } catch (Exception ignored) {}
            sEdgeView = null;
        }
        if (sReturnZoneView != null) {
            try { wm.removeView(sReturnZoneView); } catch (Exception ignored) {}
            sReturnZoneView = null;
        }
    }

    private void setReturnZoneVisible(Context ctx, boolean visible, boolean active) {
        WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        if (wm == null) return;
        if (!visible) {
            if (sReturnZoneView != null) {
                try { wm.removeView(sReturnZoneView); } catch (Exception ignored) {}
                sReturnZoneView = null;
            }
            return;
        }
        if (sReturnZoneView == null) {
            TextView tv = new TextView(ctx);
            tv.setText("松手放回书流");
            tv.setTextSize(13.5f);
            tv.setTypeface(Typeface.DEFAULT_BOLD);
            tv.setGravity(Gravity.CENTER);
            int px = dp(ctx, 20), py = dp(ctx, 10);
            tv.setPadding(px, py, px, py);
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            );
            lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
            lp.y = dp(ctx, 54);
            try {
                wm.addView(tv, lp);
                sReturnZoneView = tv;
            } catch (Exception ignored) {}
        }
        if (sReturnZoneView instanceof TextView) {
            TextView tv = (TextView) sReturnZoneView;
            tv.setText(active ? "松手即可放回原位" : "拖到此处放回原位");
            tv.setTextColor(active ? Color.WHITE : Color.parseColor("#1D1D1F"));
            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(dp(ctx, 999));
            bg.setColor(active ? Color.parseColor("#E61D1D1F") : Color.parseColor("#EBFFFFFF"));
            bg.setStroke(dp(ctx, 1), Color.parseColor("#26000000"));
            tv.setBackground(bg);
        }
    }

    private void showNativeEdgeHandle(Context ctx, String id, String kind, String title, String uri) {
        removeNativeOverlays(ctx);
        WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        if (wm == null) return;

        DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
        final int screenW = dm.widthPixels;
        final int screenH = dm.heightPixels;

        LinearLayout box = new LinearLayout(ctx);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(ctx, 9), dp(ctx, 14), dp(ctx, 7), dp(ctx, 14));

        GradientDrawable bg = new GradientDrawable();
        float r = dp(ctx, 18);
        bg.setCornerRadii(new float[]{r, r, 0, 0, 0, 0, r, r});
        bg.setColor(Color.parseColor("#ECFFFFFF"));
        bg.setStroke(dp(ctx, 1), Color.parseColor("#22000000"));
        box.setBackground(bg);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            box.setElevation(dp(ctx, 8));
        }

        // Accent dot
        View dot = new View(ctx);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(ctx, 6), dp(ctx, 6));
        dotLp.bottomMargin = dp(ctx, 6);
        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor("stack".equals(kind) ? Color.parseColor("#FF9500") : Color.parseColor("#007AFF"));
        dot.setBackground(dotBg);
        box.addView(dot, dotLp);

        // Compact vertical title (up to 4 chars)
        String clean = title == null ? "阅读" : title.trim();
        if (clean.isEmpty()) clean = "阅读";
        StringBuilder vert = new StringBuilder();
        int lim = Math.min(4, clean.length());
        for (int i = 0; i < lim; i++) {
            if (i > 0) vert.append('\n');
            vert.append(clean.charAt(i));
        }
        TextView label = new TextView(ctx);
        label.setText(vert.toString());
        label.setTextColor(Color.parseColor("#1D1D1F"));
        label.setTextSize(11.5f);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setGravity(Gravity.CENTER);
        label.setLineSpacing(0f, 1.05f);
        box.addView(label);

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        final WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        lp.gravity = Gravity.TOP | Gravity.END;
        lp.x = 0;
        lp.y = Math.round(screenH * 0.42f);

        box.setOnTouchListener(new View.OnTouchListener() {
            float downRawX, downRawY;
            int startX, startY;
            boolean dragging = false;
            boolean inReturn = false;

            @Override
            public boolean onTouch(View v, MotionEvent ev) {
                switch (ev.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downRawX = ev.getRawX();
                        downRawY = ev.getRawY();
                        startX = lp.x;
                        startY = lp.y;
                        dragging = false;
                        inReturn = false;
                        v.animate().scaleX(0.94f).scaleY(0.94f).setDuration(120).start();
                        return true;
                    case MotionEvent.ACTION_MOVE: {
                        float dx = ev.getRawX() - downRawX;
                        float dy = ev.getRawY() - downRawY;
                        if (!dragging && Math.hypot(dx, dy) > dp(ctx, 8)) {
                            dragging = true;
                        }
                        if (dragging) {
                            // Gravity is END so increasing lp.x moves LEFT away from right edge
                            int nextX = Math.max(0, Math.min(screenW - dp(ctx, 44), Math.round(startX - dx)));
                            int nextY = Math.max(dp(ctx, 40), Math.min(screenH - dp(ctx, 130), Math.round(startY + dy)));
                            lp.x = nextX;
                            lp.y = nextY;
                            try { wm.updateViewLayout(v, lp); } catch (Exception ignored) {}
                            boolean showZone = nextX > dp(ctx, 36);
                            boolean hitTop = showZone && ev.getRawY() < dp(ctx, 165);
                            if (hitTop != inReturn) {
                                inReturn = hitTop;
                                if (inReturn) v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                            }
                            setReturnZoneVisible(ctx, showZone, hitTop);
                        }
                        return true;
                    }
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL: {
                        v.animate().scaleX(1f).scaleY(1f).setDuration(160).start();
                        float dx = ev.getRawX() - downRawX;
                        float dy = ev.getRawY() - downRawY;
                        boolean cancelled = ev.getActionMasked() == MotionEvent.ACTION_CANCEL;
                        setReturnZoneVisible(ctx, false, false);

                        if (!cancelled && inReturn) {
                            v.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
                            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
                            removeNativeOverlays(ctx);
                            launchUri(ctx, "zone://undock/" + Uri.encode(id));
                            return true;
                        }
                        boolean isTap = !cancelled && !dragging && Math.hypot(dx, dy) <= dp(ctx, 12);
                        boolean isSwipeLeftOpen = !cancelled && dx < -dp(ctx, 42) && Math.abs(dy) < dp(ctx, 90);
                        if (isTap || isSwipeLeftOpen) {
                            v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                            // Snap edge handle back to right bezel then open Zone reader
                            snapBackToRight(wm, v, lp);
                            if (uri != null && !uri.isEmpty()) launchUri(ctx, uri);
                            return true;
                        }
                        snapBackToRight(wm, v, lp);
                        return true;
                    }
                }
                return false;
            }
        });

        try {
            wm.addView(box, lp);
            sEdgeView = box;
            sEdgeLp = lp;
        } catch (Exception ignored) {}
    }

    private void snapBackToRight(WindowManager wm, View v, WindowManager.LayoutParams lp) {
        if (lp.x == 0) return;
        ValueAnimator anim = ValueAnimator.ofInt(lp.x, 0);
        anim.setDuration(220);
        anim.setInterpolator(new DecelerateInterpolator(2.0f));
        anim.addUpdateListener(a -> {
            if (sEdgeView != v) return;
            lp.x = (Integer) a.getAnimatedValue();
            try { wm.updateViewLayout(v, lp); } catch (Exception ignored) {}
        });
        anim.start();
    }

    private void launchUri(Context ctx, String uri) {
        try {
            Intent i = new Intent(ctx, MainActivity.class);
            i.setAction(Intent.ACTION_VIEW);
            i.setData(Uri.parse(uri));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            ctx.startActivity(i);
        } catch (Exception ignored) {}
    }
}
