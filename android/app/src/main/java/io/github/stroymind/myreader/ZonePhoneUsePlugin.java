package io.github.stroymind.myreader;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "ZonePhoneUse")
public class ZonePhoneUsePlugin extends Plugin {

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("enabled", ZonePhoneUseService.isRunning());
        ret.put("foregroundPkg", ZonePhoneUseService.getForegroundPkg());
        ret.put("stopRequested", ZonePhoneUseService.isStopRequested());
        call.resolve(ret);
    }

    @PluginMethod
    public void resetStop(PluginCall call) {
        ZonePhoneUseService.resetStop();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("无法打开无障碍设置: " + e.getMessage());
        }
    }

    @PluginMethod
    public void dumpScreen(PluginCall call) {
        ZonePhoneUseService svc = ZonePhoneUseService.getInstance();
        if (svc == null) {
            call.reject("请先在系统设置中开启「Zone 手机控屏」无障碍服务");
            return;
        }
        try {
            JSONObject raw = svc.dumpUiTree();
            JSObject ret = JSObject.fromJSONObject(raw);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取屏幕控件失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void performAction(PluginCall call) {
        ZonePhoneUseService svc = ZonePhoneUseService.getInstance();
        if (svc == null) {
            call.reject("请先在系统设置中开启「Zone 手机控屏」无障碍服务");
            return;
        }
        String action = call.getString("action", "");
        boolean ok = false;
        switch (action) {
            case "tap":
                ok = svc.performTap(call.getFloat("x", 0f), call.getFloat("y", 0f), 60L);
                break;
            case "long_press":
                ok = svc.performTap(call.getFloat("x", 0f), call.getFloat("y", 0f), 620L);
                break;
            case "swipe":
                ok = svc.performSwipe(
                    call.getFloat("x", 0f), call.getFloat("y", 0f),
                    call.getFloat("x2", 0f), call.getFloat("y2", 0f),
                    call.getInt("durationMs", 320)
                );
                break;
            case "type":
                ok = svc.performTypeText(call.getString("text", ""));
                break;
            case "back":
                ok = svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
                break;
            case "home":
                ok = svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME);
                break;
            case "recents":
                ok = svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_RECENTS);
                break;
            case "open_app":
                ok = svc.openAppByNameOrPkg(call.getString("app", ""));
                break;
            case "wait":
                ok = true;
                break;
            default:
                call.reject("不支持的控屏动作: " + action);
                return;
        }
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        ret.put("action", action);
        call.resolve(ret);
    }

    @PluginMethod
    public void setOverlay(PluginCall call) {
        ZonePhoneUseService svc = ZonePhoneUseService.getInstance();
        if (svc == null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", false));
        String text = call.getString("text", "控屏中（点此停止）");
        if (visible) svc.showFloatingOrb(text);
        else svc.hideFloatingOrb();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void bringToFront(PluginCall call) {
        ZonePhoneUseService svc = ZonePhoneUseService.getInstance();
        if (svc != null) svc.bringZoneToFront();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
