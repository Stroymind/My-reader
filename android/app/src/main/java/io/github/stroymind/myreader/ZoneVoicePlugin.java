package io.github.stroymind.myreader;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.util.ArrayList;

@CapacitorPlugin(
    name = "ZoneVoice",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class ZoneVoicePlugin extends Plugin {
    private SpeechRecognizer recognizer;
    private MediaRecorder mediaRecorder;
    private File recordFile;
    private boolean pendingRecordAfterPerm = false;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean wakeMode = false;
    private boolean activeListening = false;
    private boolean pendingWakeAfterPerm = false;
    private final Runnable restartWake = () -> {
        if (wakeMode && !activeListening) startNativeRecognizer(true, null);
    };

    private boolean hasMicPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
    }

    private Intent buildSpeechIntent(boolean wake) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, !wake);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "说一句即可，如「字大一点、开护眼」");
        return intent;
    }

    private boolean hasIntentActivity() {
        Intent i = buildSpeechIntent(false);
        return i.resolveActivity(getContext().getPackageManager()) != null;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("hasPermission", hasMicPermission());
        ret.put("recognizerAvailable", SpeechRecognizer.isRecognitionAvailable(getContext()));
        ret.put("intentAvailable", hasIntentActivity());
        call.resolve(ret);
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (!hasMicPermission() && getPermissionState("microphone") != PermissionState.GRANTED) {
            pendingWakeAfterPerm = false;
            requestPermissionForAlias("microphone", call, "micPermsCallback");
            return;
        }
        launchOneShot(call);
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        main.post(() -> {
            activeListening = false;
            destroyRecognizer();
            emitState(false);
            if (wakeMode) main.postDelayed(restartWake, 450);
            call.resolve();
        });
    }

    @PluginMethod
    public void setWake(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        if (!on) {
            wakeMode = false;
            main.post(() -> {
                main.removeCallbacks(restartWake);
                if (!activeListening) destroyRecognizer();
                JSObject ret = new JSObject();
                ret.put("on", false);
                call.resolve(ret);
            });
            return;
        }
        if (!hasMicPermission() && getPermissionState("microphone") != PermissionState.GRANTED) {
            pendingWakeAfterPerm = true;
            requestPermissionForAlias("microphone", call, "micPermsCallback");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            JSObject ret = new JSObject();
            ret.put("on", false);
            ret.put("code", "NO_SPEECH_SERVICE");
            call.resolve(ret);
            return;
        }
        wakeMode = true;
        main.post(() -> {
            if (!activeListening) startNativeRecognizer(true, null);
            JSObject ret = new JSObject();
            ret.put("on", true);
            call.resolve(ret);
        });
    }

    @PermissionCallback
    private void micPermsCallback(PluginCall call) {
        if (!hasMicPermission()) {
            JSObject ret = new JSObject();
            ret.put("started", false);
            ret.put("on", false);
            ret.put("code", "NO_PERMISSION");
            call.resolve(ret);
            return;
        }
        if (pendingRecordAfterPerm) {
            pendingRecordAfterPerm = false;
            beginAudioRecording(call);
            return;
        }
        if (pendingWakeAfterPerm) {
            pendingWakeAfterPerm = false;
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                JSObject ret = new JSObject();
                ret.put("on", false);
                ret.put("code", "NO_SPEECH_SERVICE");
                call.resolve(ret);
                return;
            }
            wakeMode = true;
            main.post(() -> {
                if (!activeListening) startNativeRecognizer(true, null);
                JSObject ret = new JSObject();
                ret.put("on", true);
                call.resolve(ret);
            });
        } else {
            launchOneShot(call);
        }
    }

    private void launchOneShot(PluginCall call) {
        if (SpeechRecognizer.isRecognitionAvailable(getContext())) {
            main.post(() -> startNativeRecognizer(false, call));
            return;
        }
        if (hasIntentActivity()) {
            startActivityForResult(call, buildSpeechIntent(false), "onSpeechIntentResult");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("started", false);
        ret.put("code", "NO_SPEECH_SERVICE");
        call.resolve(ret);
    }

    @ActivityCallback
    private void onSpeechIntentResult(PluginCall call, ActivityResult result) {
        JSObject ret = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> list = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            String text = (list != null && !list.isEmpty()) ? list.get(0) : "";
            ret.put("started", true);
            ret.put("text", text);
            if (!text.isEmpty()) {
                JSObject ev = new JSObject();
                ev.put("text", text);
                ev.put("wake", false);
                notifyListeners("result", ev);
            }
        } else {
            ret.put("started", false);
            ret.put("code", "CANCELLED");
        }
        call.resolve(ret);
    }

    private void startNativeRecognizer(boolean isWake, PluginCall startCall) {
        main.removeCallbacks(restartWake);
        destroyRecognizer();
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        } catch (Exception e) {
            if (startCall != null) {
                if (hasIntentActivity()) {
                    startActivityForResult(startCall, buildSpeechIntent(false), "onSpeechIntentResult");
                } else {
                    JSObject ret = new JSObject();
                    ret.put("started", false);
                    ret.put("code", "NO_SPEECH_SERVICE");
                    startCall.resolve(ret);
                }
            }
            return;
        }
        activeListening = !isWake;
        if (!isWake) emitState(true);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) { if (!isWake) emitState(true); }
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() { if (!isWake) emitState(false); }
            @Override public void onPartialResults(Bundle partialResults) {
                if (isWake) return;
                ArrayList<String> list = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (list != null && !list.isEmpty() && !list.get(0).isEmpty()) {
                    JSObject ev = new JSObject();
                    ev.put("text", list.get(0));
                    notifyListeners("partial", ev);
                }
            }
            @Override public void onResults(Bundle results) {
                activeListening = false;
                if (!isWake) emitState(false);
                ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String text = (list != null && !list.isEmpty()) ? list.get(0) : "";
                if (!text.isEmpty()) {
                    JSObject ev = new JSObject();
                    ev.put("text", text);
                    ev.put("wake", isWake);
                    notifyListeners("result", ev);
                }
                if (wakeMode) main.postDelayed(restartWake, 550);
            }
            @Override public void onError(int error) {
                activeListening = false;
                if (!isWake) emitState(false);
                if (isWake) {
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        wakeMode = false;
                        emitError(hasMicPermission() ? "NO_SPEECH_SERVICE" : "NO_PERMISSION", true);
                    } else if (error == SpeechRecognizer.ERROR_CLIENT || error == SpeechRecognizer.ERROR_SERVER || error == 10 || error == 12) {
                        wakeMode = false;
                        emitError("NO_SPEECH_SERVICE", true);
                    } else if (wakeMode) {
                        main.postDelayed(restartWake, error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 900 : 650);
                    }
                    return;
                }
                if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                    emitError(hasMicPermission() ? "NO_SPEECH_SERVICE" : "NO_PERMISSION", false);
                } else if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    emitError("NO_MATCH", false);
                } else if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) {
                    emitError("NETWORK", false);
                } else {
                    emitError("NO_SPEECH_SERVICE", false);
                }
                if (wakeMode) main.postDelayed(restartWake, 650);
            }
            @Override public void onEvent(int eventType, Bundle params) {}
        });
        try {
            recognizer.startListening(buildSpeechIntent(isWake));
            if (startCall != null) {
                JSObject ret = new JSObject();
                ret.put("started", true);
                startCall.resolve(ret);
            }
        } catch (Exception e) {
            activeListening = false;
            if (!isWake) emitState(false);
            if (startCall != null) {
                if (hasIntentActivity()) {
                    startActivityForResult(startCall, buildSpeechIntent(false), "onSpeechIntentResult");
                } else {
                    JSObject ret = new JSObject();
                    ret.put("started", false);
                    ret.put("code", "NO_SPEECH_SERVICE");
                    startCall.resolve(ret);
                }
            }
        }
    }

    private void emitState(boolean listening) {
        JSObject ev = new JSObject();
        ev.put("listening", listening);
        notifyListeners("state", ev);
    }

    private void emitError(String code, boolean isWake) {
        JSObject ev = new JSObject();
        ev.put("code", code);
        ev.put("wake", isWake);
        notifyListeners("error", ev);
    }

    @PluginMethod
    public void startRecording(PluginCall call) {
        if (!hasMicPermission() && getPermissionState("microphone") != PermissionState.GRANTED) {
            pendingRecordAfterPerm = true;
            pendingWakeAfterPerm = false;
            requestPermissionForAlias("microphone", call, "micPermsCallback");
            return;
        }
        beginAudioRecording(call);
    }

    private void beginAudioRecording(PluginCall call) {
        main.post(() -> {
            releaseRecorder();
            try {
                File out = new File(getContext().getCacheDir(), "zone_voice.m4a");
                if (out.exists()) out.delete();
                recordFile = out;
                mediaRecorder = Build.VERSION.SDK_INT >= 31
                    ? new MediaRecorder(getContext())
                    : new MediaRecorder();
                mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
                mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                mediaRecorder.setAudioEncodingBitRate(32000);
                mediaRecorder.setAudioSamplingRate(16000);
                mediaRecorder.setAudioChannels(1);
                mediaRecorder.setOutputFile(out.getAbsolutePath());
                mediaRecorder.prepare();
                mediaRecorder.start();
                JSObject ret = new JSObject();
                ret.put("started", true);
                call.resolve(ret);
            } catch (Exception e) {
                releaseRecorder();
                JSObject ret = new JSObject();
                ret.put("started", false);
                ret.put("code", "RECORDER_FAILED");
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        main.post(() -> {
            File f = recordFile;
            boolean stopped = false;
            if (mediaRecorder != null) {
                try {
                    mediaRecorder.stop();
                    stopped = true;
                } catch (Exception ignored) {}
                releaseRecorder();
            }
            JSObject ret = new JSObject();
            if (stopped && f != null && f.exists() && f.length() > 128) {
                try (FileInputStream fis = new FileInputStream(f);
                     ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = fis.read(buf)) != -1) bos.write(buf, 0, n);
                    String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
                    ret.put("ok", true);
                    ret.put("base64", b64);
                    ret.put("mimeType", "audio/mp4");
                } catch (Exception e) {
                    ret.put("ok", false);
                    ret.put("code", "READ_FAILED");
                } finally {
                    try { f.delete(); } catch (Exception ignored) {}
                }
            } else {
                if (f != null) { try { f.delete(); } catch (Exception ignored) {} }
                ret.put("ok", false);
                ret.put("code", "EMPTY");
            }
            call.resolve(ret);
        });
    }

    private void releaseRecorder() {
        if (mediaRecorder != null) {
            try { mediaRecorder.reset(); } catch (Exception ignored) {}
            try { mediaRecorder.release(); } catch (Exception ignored) {}
            mediaRecorder = null;
        }
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) {}
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    @Override
    protected void handleOnPause() {
        main.removeCallbacks(restartWake);
        activeListening = false;
        destroyRecognizer();
        releaseRecorder();
    }

    @Override
    protected void handleOnResume() {
        if (wakeMode && hasMicPermission() && SpeechRecognizer.isRecognitionAvailable(getContext())) {
            main.postDelayed(restartWake, 500);
        }
    }

    @Override
    protected void handleOnDestroy() {
        wakeMode = false;
        main.removeCallbacks(restartWake);
        destroyRecognizer();
        releaseRecorder();
    }
}
