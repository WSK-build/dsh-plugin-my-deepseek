package com.wskbuild.mydeepseek;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.webkit.WebView;
import android.widget.Toast;

/**
 * 应用依赖较新的 WebView 渲染引擎：界面与平台登录页都用到了旧内核不支持的
 * JavaScript 语法与 CSS 特性。版本不足时给出可操作的提示，而不是留一个白屏。
 */
final class WebViewGate {
    /**
     * 应用支持的最低 WebView 主版本。
     *
     * 门槛由界面实际使用的 JavaScript API 决定：Array.prototype.toReversed
     * 在 vendor/chat-demo-src/services/chat/store.ts 中用于倒序遍历上下文回合，
     * 该 API 随 Chromium 110 提供，旧内核执行到此处会抛 TypeError 并让页面停在白屏。
     */
    private static final int MIN_MAJOR = 110;

    /** 无法确定提供方时退回的商店包名，覆盖未安装 WebView 的设备。 */
    private static final String FALLBACK_WEBVIEW_PACKAGE = "com.google.android.webview";

    private WebViewGate() {
    }

    static boolean isSupported() {
        return majorVersion() >= MIN_MAJOR;
    }

    /**
     * 返回当前 WebView 提供方的主版本号，无法判定时返回 0。
     *
     * 版本号取自 versionName 的首段而不是 versionCode：Chromium 的 Android
     * versionCode 由 BUILD、PATCH、package、ABI 编码组成，主版本号不参与其中，
     * 用它对门槛做除法会得到恒大于门槛的结果，使检查永不触发。
     */
    static int majorVersion() {
        PackageInfo info = WebView.getCurrentWebViewPackage();
        if (info == null || info.versionName == null) {
            return 0;
        }
        return parseMajor(info.versionName);
    }

    /** 从 "110.0.5481.153" 这类版本名中取出主版本号，格式异常时返回 0。 */
    private static int parseMajor(String versionName) {
        try {
            return Integer.parseInt(versionName.split("\\.")[0].trim());
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    /**
     * 提示用户更新 WebView。
     *
     * 国产 ROM 上应用商店深链经常无法解析，因此文案同时给出系统设置里的组件更新
     * 路径；同时保留继续进入的入口，避免用户在无法更新时只剩下退出应用一条路。
     */
    static void showUnsupported(MainActivity activity) {
        PackageInfo info = WebView.getCurrentWebViewPackage();
        String version = info == null || info.versionName == null ? "未知" : info.versionName;
        String provider = info == null ? FALLBACK_WEBVIEW_PACKAGE : info.packageName;
        String message = "当前渲染引擎版本为 " + version + "，应用需要 " + MIN_MAJOR + " 或更高版本。\n\n"
                + "更新方式：\n"
                + "1. 在应用商店中更新“Android System WebView”（或 Chrome）；\n"
                + "2. 应用商店无法打开时，进入 系统设置 → 应用 → Android System WebView，"
                + "在应用信息页中选择更新；应用列表中没有该项时改更新 Chrome。\n\n"
                + "继续使用可能出现白屏或部分功能不可用。";
        new AlertDialog.Builder(activity)
                .setTitle("需要更新系统 WebView")
                .setMessage(message)
                .setPositiveButton("前往更新", (dialog, which) -> openStore(activity, provider))
                .setNeutralButton("仍要继续", null)
                .setNegativeButton("退出", (dialog, which) -> activity.finish())
                .setCancelable(false)
                .show();
    }

    /** 依次尝试应用商店与网页商店，两者都打不开时用提示补齐手动更新的路径。 */
    private static void openStore(MainActivity activity, String packageName) {
        if (openUri(activity, "market://details?id=" + packageName)
                || openUri(activity, "https://play.google.com/store/apps/details?id=" + packageName)) {
            return;
        }
        Toast.makeText(activity,
                "未能打开应用商店，请在 系统设置 → 应用 → Android System WebView 中更新",
                Toast.LENGTH_LONG).show();
    }

    private static boolean openUri(MainActivity activity, String uri) {
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(uri)));
            return true;
        } catch (ActivityNotFoundException ignored) {
            return false;
        }
    }
}
