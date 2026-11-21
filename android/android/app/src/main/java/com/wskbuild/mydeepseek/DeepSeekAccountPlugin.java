package com.wskbuild.mydeepseek;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.MediaType;
import okhttp3.Response;

/**
 * DeepSeek 账号登录桥。
 *
 * 采用 PKCE S256 授权码流程，回调地址为回环 HTTP 地址；令牌存于
 * Android Keystore 加密的首选项，请求由 WebView 拦截器附加
 * x-dsh-auth-token 后发往 api.deepseek.com。
 */
@CapacitorPlugin(name = "DeepSeekAccount")
public class DeepSeekAccountPlugin extends Plugin {

    private static final String PLATFORM_ORIGIN = "https://platform.deepseek.com";
    private static final String API_ORIGIN = "https://api.deepseek.com";
    private static final String CLIENT_VERSION = "0.2.2-rc.3";
    /** 平台只接受回环形式的回调地址；该地址由 MainActivity 的 WebViewClient
     *  拦截，不启动实际的 HTTP 服务。 */
    private static final String LOOPBACK_REDIRECT_URI = "http://127.0.0.1:49876/oauth/callback";

    private OkHttpClient http;
    private OkHttpClient apiHttp;
    private SharedPreferences securePrefs;
    /** 账号令牌只在解密后保留在内存中。 */
    private String accountToken;
    private String obtainedAt;

    /** 按调用号索引进行中的流式请求，由 cancelStream 取消。 */
    private final java.util.concurrent.ConcurrentHashMap<String, okhttp3.Call> activeStreams =
            new java.util.concurrent.ConcurrentHashMap<>();

    @Override
    public void load() {
        super.load();
        http = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build();
        securePrefs = getContext().getSharedPreferences("dsh_account_secure", Context.MODE_PRIVATE);
        restoreToken();
    }

    /* ---------------------------------------------------------------- *
     * 暴露给页面的插件方法
     * ---------------------------------------------------------------- */

    @PluginMethod
    public void startLogin(PluginCall call) {
        String locale = call.getString("locale", "zh_CN");
        final PluginCall finalCall = call;
        CompletableFuture.runAsync(() -> {
            try {
                String authorizeUrl = beginLogin(locale);
                JSObject result = new JSObject();
                result.put("authorizeUrl", authorizeUrl);
                finalCall.resolve(result);
            } catch (Exception error) {
                finalCall.reject("account sign-in failed: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void openAuthorizeUrl(PluginCall call) {
        // 应用内流程直接由 WebView 导航到授权页；此入口保留给需要重新打开授权页的调用方。
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        clearPending();
        call.resolve();
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        JSObject result = null;
        if (accountToken != null) {
            result = new JSObject();
            result.put("token", accountToken);
            result.put("obtainedAt", obtainedAt);
        }
        call.resolve(result);
    }

    /** 账号登录流程的诊断状态，便于在调试工具中查看。 */
    @PluginMethod
    public void getDebugState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("hasToken", accountToken != null);
        result.put("pendingVerifier", securePrefs.getString("pending_verifier", null) != null);
        result.put("pendingRedirect", securePrefs.getString("pending_redirect", "-"));
        result.put("pendingAgeMs", System.currentTimeMillis() - securePrefs.getLong("pending_started", 0L));
        result.put("lastExchangeError", securePrefs.getString("last_exchange_error", "-"));
        call.resolve(result);
    }

    /**
     * 把文件写入系统下载集合。页面用它在导出历史 ZIP 时落盘：
     * Android 的 WebView 不会响应 blob: 的 a[download] 下载，浏览器式导出没有任何反应。
     */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String filename = call.getString("filename", "export.zip");
        String base64 = call.getString("base64", "");
        String mimeType = call.getString("mimeType", "application/zip");
        if (base64.isEmpty()) {
            call.reject("saveFile: missing data");
            return;
        }
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            android.net.Uri saved;
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                android.content.ContentValues values = new android.content.ContentValues();
                values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(android.provider.MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(android.provider.MediaStore.Downloads.IS_PENDING, 1);
                saved = getContext().getContentResolver().insert(
                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (saved == null) {
                    throw new IllegalStateException("MediaStore insert failed");
                }
                try (java.io.OutputStream out = getContext().getContentResolver().openOutputStream(saved)) {
                    if (out == null) {
                        throw new IllegalStateException("MediaStream open failed");
                    }
                    out.write(data);
                }
                values.clear();
                values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0);
                getContext().getContentResolver().update(saved, values, null, null);
            } else {
                // 分区存储之前的系统版本：直接写公共下载目录。
                java.io.File dir = android.os.Environment
                        .getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new IllegalStateException("cannot create Downloads directory");
                }
                java.io.File file = new java.io.File(dir, filename);
                try (java.io.FileOutputStream out = new java.io.FileOutputStream(file)) {
                    out.write(data);
                }
            }
            JSObject result = new JSObject();
            result.put("filename", filename);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("saveFile failed: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        accountToken = null;
        obtainedAt = null;
        securePrefs.edit().remove("account_token").remove("obtained_at").apply();
        call.resolve();
    }

    @PluginMethod
    public void reportRejectedToken(PluginCall call) {
        accountToken = null;
        obtainedAt = null;
        securePrefs.edit().remove("account_token").remove("obtained_at").apply();
        call.resolve();
    }

    /* ---------------------------------------------------------------- *
     * WebView 请求拦截：附加账号令牌
     * ---------------------------------------------------------------- */

    @PluginMethod
    public void fetch(PluginCall call) {
        String url = call.getString("url", "");
        String method = call.getString("method", "GET");
        JSObject headers = call.getObject("headers", new JSObject());
        String body = call.getString("body", null);
        if (url.isEmpty()) {
            call.reject("fetch: missing url");
            return;
        }
        CompletableFuture.runAsync(() -> {
            try {
                Request.Builder builder = new Request.Builder()
                        .url(url)
                        .header("x-dsh-auth-token", accountToken != null ? accountToken : "");
                java.util.Iterator<String> headerNames = headers.keys();
                while (headerNames.hasNext()) {
                    String name = headerNames.next();
                    builder.header(name, headers.getString(name));
                }
                RequestBody requestBody = null;
                if (body != null) {
                    String contentType = headers.has("content-type") ? headers.getString("content-type") : "application/json";
                    requestBody = RequestBody.create(body, MediaType.parse(contentType));
                }
                builder.method(method, requestBody);
                try (Response response = apiClient().newCall(builder.build()).execute()) {
                    String text = response.body() != null ? response.body().string() : "";
                    JSObject result = new JSObject();
                    result.put("status", response.code());
                    result.put("contentType", response.header("content-type", "application/octet-stream"));
                    result.put("body", text);
                    call.resolve(result);
                }
            } catch (Exception error) {
                call.reject("fetch failed: " + error.getMessage(), error);
            }
        });
    }

    private OkHttpClient apiClient() {
        if (apiHttp == null) {
            apiHttp = new OkHttpClient.Builder()
                    .connectTimeout(30, TimeUnit.SECONDS)
                    // 长 SSE 流：流式响应不设读超时。
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .writeTimeout(60, TimeUnit.SECONDS)
                    .build();
        }
        return apiHttp;
    }

    /**
     * fetch 的流式版本：响应体按行经 streamOpen / streamChunk / streamClose
     * 事件转交给页面，SSE 输出逐段出现而不是等全部到齐。
     * 页面通过 cancelStream 取消（停止按钮）。
     */
    @PluginMethod
    public void fetchStream(PluginCall call) {
        String url = call.getString("url", "");
        String method = call.getString("method", "GET");
        String callId = call.getString("callId", "");
        JSObject headers = call.getObject("headers", new JSObject());
        String body = call.getString("body", null);
        if (url.isEmpty() || callId.isEmpty()) {
            call.reject("fetchStream: missing url or callId");
            return;
        }
        final PluginCall finalCall = call;
        final String id = callId;
        CompletableFuture.runAsync(() -> {
            Request.Builder builder = new Request.Builder().url(url);
            if (accountToken != null) {
                builder.header("x-dsh-auth-token", accountToken);
            }
            java.util.Iterator<String> headerNames = headers.keys();
            while (headerNames.hasNext()) {
                String name = headerNames.next();
                builder.header(name, headers.getString(name));
            }
            RequestBody requestBody = null;
            if (body != null) {
                String contentType = headers.has("content-type") ? headers.getString("content-type") : "application/json";
                requestBody = RequestBody.create(body, MediaType.parse(contentType));
            }
            builder.method(method, requestBody);
            okhttp3.Call streamCall = apiClient().newCall(builder.build());
            activeStreams.put(id, streamCall);
            try (Response response = streamCall.execute()) {
                JSObject open = new JSObject();
                open.put("callId", id);
                open.put("status", response.code());
                open.put("contentType", response.header("content-type", "application/octet-stream"));
                notifyListeners("streamOpen", open);
                if (response.body() != null) {
                    okio.BufferedSource source = response.body().source();
                    // 按行读取（SSE 与 JSON 都以行分隔），跨分块的 UTF-8 多字节字符
                    // 才不会被截断；readUtf8Line 会去掉行终止符，回收时必须补回 '\n'。
                    StringBuilder pending = new StringBuilder();
                    while (!source.exhausted()) {
                        String line = source.readUtf8Line();
                        if (line == null) {
                            break;
                        }
                        pending.append(line).append('\n');
                        if (pending.length() >= 8192) {
                            emitChunk(id, pending.toString());
                            pending.setLength(0);
                        }
                    }
                    if (pending.length() > 0) {
                        emitChunk(id, pending.toString());
                    }
                }
                finalCall.resolve();
            } catch (Exception error) {
                if (streamCall.isCanceled()) {
                    // 页面已取消（停止按钮），静默结束本次调用。
                    finalCall.resolve();
                } else {
                    JSObject failure = new JSObject();
                    failure.put("callId", id);
                    failure.put("error", error.getMessage() != null ? error.getMessage() : "stream failed");
                    notifyListeners("streamError", failure);
                    finalCall.reject("fetchStream failed: " + error.getMessage(), error);
                    return;
                }
            } finally {
                activeStreams.remove(id);
                JSObject close = new JSObject();
                close.put("callId", id);
                notifyListeners("streamClose", close);
            }
        });
    }

    private void emitChunk(String callId, String text) {
        JSObject chunk = new JSObject();
        chunk.put("callId", callId);
        chunk.put("text", text);
        notifyListeners("streamChunk", chunk);
    }

    /** 取消进行中的 fetchStream；挂起的调用静默结束。 */
    @PluginMethod
    public void cancelStream(PluginCall call) {
        String callId = call.getString("callId", "");
        okhttp3.Call streamCall = activeStreams.remove(callId);
        if (streamCall != null) {
            streamCall.cancel();
        }
        call.resolve();
    }

    /* ---------------------------------------------------------------- *
     * PKCE 登录流程
     * ---------------------------------------------------------------- */

    private static class AccountToken {
        final String value;
        final String obtainedAt;

        AccountToken(String value, String obtainedAt) {
            this.value = value;
            this.obtainedAt = obtainedAt;
        }
    }

    /**
     * 登录第一步：调用 auth_init，把授权页地址交回页面，由页面导航本 WebView 前往。
     * 整个授权过程都在应用内完成（始终处于前台，不会被系统按后台回收），
     * 回环重定向由 MainActivity 的 WebViewClient 拦截，因此不需要真正的 HTTP 服务。
     *
     * 重定向地址仍必须是回环 HTTP 形式：平台会拒绝其他 scheme（错误码 50005）。
     */
    private String beginLogin(String locale) throws Exception {
        SecureRandom random = new SecureRandom();
        byte[] verifierBytes = new byte[32];
        random.nextBytes(verifierBytes);
        String verifier = Base64.encodeToString(verifierBytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        byte[] stateBytes = new byte[32];
        random.nextBytes(stateBytes);
        String state = Base64.encodeToString(stateBytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        String challenge = Base64.encodeToString(
                MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);

        String redirectUri = LOOPBACK_REDIRECT_URI;
        securePrefs.edit()
                .putString("pending_verifier", verifier)
                .putString("pending_state", state)
                .putString("pending_redirect", redirectUri)
                .putString("pending_locale", locale)
                .putLong("pending_started", System.currentTimeMillis())
                .apply();

        JSONObject initBody = new JSONObject()
                .put("code_challenge", challenge)
                .put("code_challenge_method", "S256")
                .put("state", state)
                .put("redirect_uri", redirectUri)
                .put("locale", locale)
                .put("login_source", "web");
        JSONObject initData = postPlatform("auth_init", initBody);
        String authorizeUrl = initData.getJSONObject("biz_data").getString("authorize_url");
        Log.d("DeepSeekAccount", "beginLogin ok: authorize_id obtained, pending stored");
        return authorizeUrl;
    }

    /**
     * 完成一次已开始的授权：校验 state，用授权码换取账号令牌并持久化。
     * 由页面导航与 intent 路径调用。
     */
    private void completePendingLogin(String code, String state) {
        final String TAG = "DeepSeekAccount";
        String verifier = securePrefs.getString("pending_verifier", null);
        String expectedState = securePrefs.getString("pending_state", null);
        String redirectUri = securePrefs.getString("pending_redirect", LOOPBACK_REDIRECT_URI);
        long started = securePrefs.getLong("pending_started", 0L);
        Log.d(TAG, "completePendingLogin: pending=" + (verifier != null) + " stateMatch=" + (state != null && state.equals(expectedState)));
        if (verifier == null || expectedState == null) {
            return;
        }
        if (state == null || !state.equals(expectedState)) {
            clearPending();
            notifyPhase("failed");
            return;
        }
        // 授权尝试在服务端过期（默认 600 秒）。
        if (started > 0 && System.currentTimeMillis() - started > 10 * 60 * 1000L) {
            Log.d(TAG, "completePendingLogin: TTL exceeded");
            clearPending();
            notifyPhase("expired");
            return;
        }
        CompletableFuture.runAsync(() -> {
            try {
                JSONObject exchangeBody = new JSONObject()
                        .put("code", code)
                        .put("code_verifier", verifier)
                        .put("redirect_uri", redirectUri)
                        .put("device_id", deviceId())
                        .put("device_model", android.os.Build.MODEL)
                        .put("os_version", "Android " + android.os.Build.VERSION.RELEASE);
                Log.d(TAG, "completePendingLogin: exchanging code (len " + code.length() + ") verifier (len " + verifier.length() + ")");
                JSONObject exchangeData = postPlatform("auth_exchange", exchangeBody);
                String token = exchangeData.getJSONObject("biz_data").getString("token");
                Log.d(TAG, "completePendingLogin: token obtained (len " + token.length() + ")");
                String at = java.time.Instant.now().toString();
                saveToken(token, at);
                Log.d(TAG, "completePendingLogin: token saved at " + at);
                clearPending();
                notifyPhase("signed-in");
            } catch (Exception error) {
                Log.e(TAG, "completePendingLogin: exchange failed: " + error.getMessage(), error);
                securePrefs.edit().putString("last_exchange_error", String.valueOf(error.getMessage())).apply();
                notifyPhase("failed");
            }
        });
    }

    private void clearPending() {
        securePrefs.edit()
                .remove("pending_verifier")
                .remove("pending_state")
                .remove("pending_redirect")
                .remove("pending_locale")
                .remove("pending_started")
                .apply();
    }

    /** WebView 导航拦截：应用内授权会重定向到回环回调地址，
     *  从它的查询参数完成令牌交换。 */
    public boolean completeFromLoopbackRedirect(android.net.Uri uri) {
        if (uri == null) {
            return false;
        }
        String host = uri.getHost();
        if (!"127.0.0.1".equals(host) && !"localhost".equals(host)) {
            return false;
        }
        if (!"/oauth/callback".equals(uri.getPath())) {
            return false;
        }
        String code = uri.getQueryParameter("code");
        String state = uri.getQueryParameter("state");
        Log.d("DeepSeekAccount", "loopback redirect intercepted: code=" + (code != null) + " state=" + (state != null));
        if (code != null && state != null) {
            completePendingLogin(code, state);
            return true;
        }
        return false;
    }

    private void notifyPhase(String phase) {
        JSObject event = new JSObject();
        event.put("phase", phase);
        notifyListeners("accountPhase", event);
    }

    private JSONObject postPlatform(String method, JSONObject body) throws Exception {
        // 请求体是裸的 auth 对象；{code, data:{biz_code, biz_data}} 是响应信封的形状。
        // 使用 Harness 的 User-Agent，平台的 WAF 才不会对 okhttp 默认 UA 返回 HTML 挑战页。
        Request request = new Request.Builder()
                .url(PLATFORM_ORIGIN + "/auth-api/v0/dsh/" + method)
                .header("content-type", "application/json")
                .header("user-agent", "node")
                .header("x-client-bundle-id", "")
                .header("x-client-platform", "web")
                .header("x-client-version", CLIENT_VERSION)
                .header("x-client-locale", "zh_CN".equals(body.optString("locale")) ? "zh_CN" : "en_US")
                .header("x-client-timezone-offset", String.valueOf(timezoneOffsetMinutes()))
                .post(RequestBody.create(body.toString(), MediaType.parse("application/json")))
                .build();
        try (Response response = http.newCall(request).execute()) {
            String text = response.body() != null ? response.body().string() : "";
            if (response.code() == 401) {
                throw new IllegalStateException("platform " + method + " unauthorized (401)");
            }
            JSONObject payload;
            try {
                payload = new JSONObject(text);
            } catch (org.json.JSONException parseError) {
                // 只记录定长前缀：既能定位失败原因，也不会把整页 HTML 挑战打出来。
                String prefix = text.length() > 120 ? text.substring(0, 120) : text;
                throw new IllegalStateException("platform " + method + " returned non-JSON (HTTP "
                        + response.code() + ", content-type " + response.header("content-type") + "): " + prefix);
            }
            if (payload.optInt("code", -1) != 0) {
                throw new IllegalStateException("platform " + method + " rejected: code " + payload.optInt("code", -1));
            }
            JSONObject data = payload.getJSONObject("data");
            if (data.optInt("biz_code", -1) != 0) {
                throw new IllegalStateException("platform " + method + " business failure: biz_code " + data.optInt("biz_code", -1));
            }
            return data;
        }
    }

    private int timezoneOffsetMinutes() {
        return -java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000;
    }

    private String deviceId() {
        String id = securePrefs.getString("device_id", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            securePrefs.edit().putString("device_id", id).apply();
        }
        return id;
    }

    /* ---------------------------------------------------------------- *
     * 令牌加密存储（Android Keystore AES-GCM）
     * ---------------------------------------------------------------- */

    private void restoreToken() {
        String blob = securePrefs.getString("account_token", null);
        String iv = securePrefs.getString("account_token_iv", null);
        if (blob == null || iv == null) {
            return;
        }
        try {
            byte[] decrypted = decrypt(Base64.decode(blob, Base64.NO_WRAP), Base64.decode(iv, Base64.NO_WRAP));
            accountToken = new String(decrypted, StandardCharsets.UTF_8);
            obtainedAt = securePrefs.getString("obtained_at", null);
        } catch (Exception error) {
            securePrefs.edit().remove("account_token").remove("account_token_iv").remove("obtained_at").apply();
        }
    }

    private void saveToken(String token, String at) throws Exception {
        // AndroidKeyStore 不允许 AES-GCM 由调用方提供 IV；
        // 由密钥库生成，并把返回的 IV 一并持久化。
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        securePrefs.edit()
                .putString("account_token", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString("account_token_iv", Base64.encodeToString(iv, Base64.NO_WRAP))
                .putString("obtained_at", at)
                .remove("last_exchange_error")
                .apply();
        accountToken = token;
        obtainedAt = at;
    }

    private SecretKey key() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry("dsh_account", null);
        if (entry != null) {
            return entry.getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        generator.init(new android.security.keystore.KeyGenParameterSpec.Builder(
                "dsh_account", android.security.keystore.KeyProperties.PURPOSE_ENCRYPT | android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    private byte[] encrypt(byte[] plain, byte[] iv) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return cipher.doFinal(plain);
    }

    private byte[] decrypt(byte[] encrypted, byte[] iv) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return cipher.doFinal(encrypted);
    }

}
