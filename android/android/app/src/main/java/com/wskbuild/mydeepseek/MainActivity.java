package com.wskbuild.mydeepseek;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.PluginHandle;

/**
 * 承载应用界面，并在应用内完成 DeepSeek 账号授权。
 *
 * 授权页在同一 WebView 内打开，应用全程处于前台，不依赖系统浏览器；
 * 平台要求的回环重定向由 WebViewClient 拦截，不经过实际的 HTTP 服务。
 */
public class MainActivity extends BridgeActivity {
    private DeepSeekAccountPlugin accountPlugin;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeepSeekAccountPlugin.class);
        super.onCreate(savedInstanceState);
        installLoopbackInterceptor();
        enforceWebViewVersion();
    }

    /**
     * 渲染引擎版本不足时页面只会白屏，因此先于页面交互给出提示。
     * 检查发生在 super.onCreate 之后，此时 Bridge 已创建出 WebView，平台能报告提供方版本；
     * 无法读取版本同样按不支持处理，否则旧内核会以白屏的形式沉默失败。
     */
    private void enforceWebViewVersion() {
        if (!WebViewGate.isSupported()) {
            WebViewGate.showUnsupported(this);
        }
    }

    private void installLoopbackInterceptor() {
        final Bridge bridge = getBridge();
        if (bridge == null) {
            return;
        }
        final WebView webView = bridge.getWebView();
        if (webView == null) {
            return;
        }
        webView.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                findAccountPlugin();
                if (accountPlugin != null && accountPlugin.completeFromLoopbackRedirect(uri)) {
                    // 令牌交换需要一点时间，交回页面后由令牌存储恢复登录状态。
                    view.postDelayed(() -> view.loadUrl(bridge.getAppUrl()), 1200);
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });
    }

    private void findAccountPlugin() {
        if (accountPlugin != null) {
            return;
        }
        Bridge bridge = getBridge();
        if (bridge == null) {
            return;
        }
        PluginHandle handle = bridge.getPlugin("DeepSeekAccount");
        if (handle != null && handle.getInstance() instanceof DeepSeekAccountPlugin) {
            accountPlugin = (DeepSeekAccountPlugin) handle.getInstance();
        }
    }
}
