package io.github.stroymind.myreader;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public class ZonePhoneUseService extends AccessibilityService {
    private static volatile ZonePhoneUseService sInstance;
    private static volatile String sForegroundPkg = "";
    private static volatile boolean sStopRequested = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private TextView orbView;
    private WindowManager.LayoutParams orbParams;

    public static ZonePhoneUseService getInstance() {
        return sInstance;
    }

    public static boolean isRunning() {
        return sInstance != null;
    }

    public static String getForegroundPkg() {
        return sForegroundPkg == null ? "" : sForegroundPkg;
    }

    public static boolean isStopRequested() {
        return sStopRequested;
    }

    public static void resetStop() {
        sStopRequested = false;
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        sInstance = this;
        sStopRequested = false;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event != null && event.getPackageName() != null) {
            String pkg = event.getPackageName().toString();
            if (!pkg.isEmpty() && !pkg.equals("com.android.systemui")) {
                sForegroundPkg = pkg;
            }
        }
    }

    @Override
    public void onInterrupt() {
        hideFloatingOrb();
    }

    @Override
    public boolean onUnbind(Intent intent) {
        hideFloatingOrb();
        sInstance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        hideFloatingOrb();
        sInstance = null;
        super.onDestroy();
    }

    public JSONObject dumpUiTree() {
        JSONObject out = new JSONObject();
        try {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            out.put("w", dm.widthPixels);
            out.put("h", dm.heightPixels);
            AccessibilityNodeInfo root = getRootInActiveWindow();
            String pkg = sForegroundPkg;
            if (root != null && root.getPackageName() != null) {
                pkg = root.getPackageName().toString();
            }
            out.put("pkg", pkg == null ? "" : pkg);
            JSONArray nodes = new JSONArray();
            if (root != null) {
                collectNodes(root, nodes, 0, 120);
                root.recycle();
            }
            out.put("nodes", nodes);
        } catch (Exception e) {
            try { out.put("error", e.getMessage()); } catch (Exception ignored) {}
        }
        return out;
    }

    private void collectNodes(AccessibilityNodeInfo node, JSONArray out, int depth, int limit) {
        if (node == null || out.length() >= limit || depth > 24) return;
        try {
            if (!node.isVisibleToUser()) return;
            CharSequence txt = node.getText();
            CharSequence desc = node.getContentDescription();
            String textStr = txt != null ? txt.toString().trim() : "";
            String descStr = desc != null ? desc.toString().trim() : "";
            boolean clickable = node.isClickable();
            boolean editable = node.isEditable();
            boolean scrollable = node.isScrollable();
            if (!textStr.isEmpty() || !descStr.isEmpty() || clickable || editable) {
                Rect r = new Rect();
                node.getBoundsInScreen(r);
                if (r.width() > 4 && r.height() > 4) {
                    JSONObject item = new JSONObject();
                    if (!textStr.isEmpty()) item.put("text", textStr.length() > 80 ? textStr.substring(0, 80) : textStr);
                    if (!descStr.isEmpty()) item.put("desc", descStr.length() > 60 ? descStr.substring(0, 60) : descStr);
                    String resId = node.getViewIdResourceName();
                    if (resId != null && resId.contains("/")) {
                        item.put("id", resId.substring(resId.lastIndexOf('/') + 1));
                    }
                    if (clickable) item.put("c", 1);
                    if (editable) item.put("e", 1);
                    if (scrollable) item.put("s", 1);
                    item.put("cx", r.centerX());
                    item.put("cy", r.centerY());
                    out.put(item);
                }
            }
            int count = node.getChildCount();
            for (int i = 0; i < count && out.length() < limit; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) {
                    collectNodes(child, out, depth + 1, limit);
                    child.recycle();
                }
            }
        } catch (Exception ignored) {}
    }

    public boolean performTap(float x, float y, long durationMs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.StrokeDescription stroke =
            new GestureDescription.StrokeDescription(path, 0, Math.max(40, durationMs));
        return dispatchGesture(new GestureDescription.Builder().addStroke(stroke).build(), null, null);
    }

    public boolean performSwipe(float x1, float y1, float x2, float y2, long durationMs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        Path path = new Path();
        path.moveTo(x1, y1);
        path.lineTo(x2, y2);
        GestureDescription.StrokeDescription stroke =
            new GestureDescription.StrokeDescription(path, 0, Math.max(120, durationMs));
        return dispatchGesture(new GestureDescription.Builder().addStroke(stroke).build(), null, null);
    }

    public boolean performTypeText(String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo target = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (target == null) target = findFirstEditable(root);
        boolean ok = false;
        if (target != null) {
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            ok = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            if (!ok) {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) {
                    cm.setPrimaryClip(ClipData.newPlainText("zone", text));
                    ok = target.performAction(AccessibilityNodeInfo.ACTION_PASTE);
                }
            }
            if (target != root) target.recycle();
        }
        root.recycle();
        return ok;
    }

    private AccessibilityNodeInfo findFirstEditable(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isEditable() && node.isVisibleToUser()) return node;
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo found = findFirstEditable(child);
                if (found != null) {
                    if (found != child) child.recycle();
                    return found;
                }
                child.recycle();
            }
        }
        return null;
    }

    public boolean openAppByNameOrPkg(String query) {
        if (query == null || query.trim().isEmpty()) return false;
        String q = query.trim().toLowerCase();
        PackageManager pm = getPackageManager();
        // 1. Direct package name match
        Intent direct = pm.getLaunchIntentForPackage(query.trim());
        if (direct != null) {
            direct.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(direct);
            return true;
        }
        // 2. Common Chinese app aliases
        String aliasPkg = mapCommonAppAlias(q);
        if (aliasPkg != null) {
            Intent aliasIntent = pm.getLaunchIntentForPackage(aliasPkg);
            if (aliasIntent != null) {
                aliasIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(aliasIntent);
                return true;
            }
        }
        // 3. Fuzzy label match across launcher apps
        Intent launcher = new Intent(Intent.ACTION_MAIN, null);
        launcher.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(launcher, 0);
        for (ResolveInfo info : apps) {
            CharSequence labelCs = info.loadLabel(pm);
            String label = labelCs != null ? labelCs.toString().toLowerCase() : "";
            String pkg = info.activityInfo.packageName.toLowerCase();
            if (label.equals(q) || label.contains(q) || q.contains(label) || pkg.contains(q)) {
                Intent launch = pm.getLaunchIntentForPackage(info.activityInfo.packageName);
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(launch);
                    return true;
                }
            }
        }
        return false;
    }

    private String mapCommonAppAlias(String q) {
        if (q.contains("微信") || q.contains("wechat")) return "com.tencent.mm";
        if (q.contains("小红书")) return "com.xingin.xhs";
        if (q.contains("抖音")) return "com.ss.android.ugc.aweme";
        if (q.contains("b站") || q.contains("哔哩") || q.contains("bilibili")) return "tv.danmaku.bili";
        if (q.contains("知乎")) return "com.zhihu.android";
        if (q.contains("微博")) return "com.sina.weibo";
        if (q.contains("淘宝")) return "com.taobao.taobao";
        if (q.contains("支付宝")) return "com.eg.android.AlipayGphone";
        if (q.contains("高德")) return "com.autonavi.minimap";
        if (q.contains("美团")) return "com.sankuai.meituan";
        if (q.contains("wps")) return "cn.wps.moffice_eng";
        if (q.contains("notion")) return "notion.id";
        if (q.contains("obsidian")) return "md.obsidian";
        if (q.contains("chrome") || q.contains("谷歌浏览器")) return "com.android.chrome";
        if (q.contains("设置") || q.contains("settings")) return "com.android.settings";
        return null;
    }

    public void bringZoneToFront() {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            startActivity(intent);
        } catch (Exception ignored) {}
    }

    public void showFloatingOrb(String statusText) {
        mainHandler.post(() -> {
            try {
                if (windowManager == null) {
                    windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
                }
                if (windowManager == null) return;
                String label = "Z · " + (statusText == null || statusText.isEmpty() ? "控屏中（点此停止）" : statusText);
                if (orbView != null) {
                    orbView.setText(label);
                    return;
                }
                float density = getResources().getDisplayMetrics().density;
                TextView tv = new TextView(this);
                tv.setText(label);
                tv.setTextColor(Color.parseColor("#1D1D1F"));
                tv.setTextSize(12.5f);
                int padH = Math.round(14 * density);
                int padV = Math.round(8 * density);
                tv.setPadding(padH, padV, padH, padV);
                GradientDrawable bg = new GradientDrawable();
                bg.setColor(Color.parseColor("#EBFFFFFF"));
                bg.setCornerRadius(999 * density);
                bg.setStroke(Math.round(1 * density), Color.parseColor("#243C3C43"));
                tv.setBackground(bg);
                tv.setElevation(10 * density);

                int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1
                    ? WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE;

                WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    type,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT
                );
                lp.gravity = Gravity.TOP | Gravity.END;
                lp.x = Math.round(14 * density);
                lp.y = Math.round(72 * density);

                tv.setOnTouchListener(new View.OnTouchListener() {
                    private int initX, initY;
                    private float downX, downY;
                    private boolean moved;
                    @Override
                    public boolean onTouch(View v, MotionEvent event) {
                        switch (event.getAction()) {
                            case MotionEvent.ACTION_DOWN:
                                initX = lp.x;
                                initY = lp.y;
                                downX = event.getRawX();
                                downY = event.getRawY();
                                moved = false;
                                return true;
                            case MotionEvent.ACTION_MOVE:
                                float dx = event.getRawX() - downX;
                                float dy = event.getRawY() - downY;
                                if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
                                lp.x = Math.max(0, initX - Math.round(dx));
                                lp.y = Math.max(40, initY + Math.round(dy));
                                try { windowManager.updateViewLayout(v, lp); } catch (Exception ignored) {}
                                return true;
                            case MotionEvent.ACTION_UP:
                                if (!moved) {
                                    sStopRequested = true;
                                    hideFloatingOrb();
                                    bringZoneToFront();
                                }
                                return true;
                            default:
                                return false;
                        }
                    }
                });

                windowManager.addView(tv, lp);
                orbView = tv;
                orbParams = lp;
            } catch (Exception ignored) {}
        });
    }

    public void hideFloatingOrb() {
        mainHandler.post(() -> {
            if (orbView != null && windowManager != null) {
                try { windowManager.removeView(orbView); } catch (Exception ignored) {}
            }
            orbView = null;
            orbParams = null;
        });
    }
}
