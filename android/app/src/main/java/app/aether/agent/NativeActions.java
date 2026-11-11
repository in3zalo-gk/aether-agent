package app.aether.agent;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayInputStream;
import java.net.InetAddress;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Native-only action dispatcher. It deliberately does not expose a JavaScript bridge. */
public final class NativeActions {
    public interface Callback { void done(boolean ok, Object result, String error); }
    private static final long BROWSER_TIMEOUT_MS = 15000L;
    private final Activity activity;
    private final FrameLayout root;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Set<String> approvedHosts = Collections.synchronizedSet(new HashSet<String>());
    private FrameLayout browserPanel;
    private BrowserWebView browser;
    private TextView browserTitle;
    private PendingLoad pendingLoad;
    private boolean closed;

    public NativeActions(Activity activity, FrameLayout root) {
        this.activity = activity;
        this.root = root;
        buildBrowserOverlay();
    }

    /** Request an action. Every state-changing/read action is separately confirmed. */
    public void request(String action, JSONObject args, Callback callback) {
        final Callback once = once(callback);
        final JSONObject safeArgs = args == null ? new JSONObject() : args;
        if (closed) { once.done(false, null, "As ações nativas foram encerradas."); return; }
        if (!allowed(action)) { once.done(false, null, "Ação nativa não suportada: " + readable(action)); return; }
        // Browser visibility is UI-only: closing or revealing an already isolated overlay needs no permission.
        if ("browserVisible".equals(action)) { if (safeArgs.optBoolean("visible", true)) browserPanel.setVisibility(View.VISIBLE); else hideBrowser(); once.done(true, visibleResult(), null); return; }
        if ("browserClose".equals(action)) { hideBrowser(); once.done(true, visibleResult(), null); return; }
        confirm(action, safeArgs, once);
    }

    public void close() {
        closed = true;
        if (pendingLoad != null) { pendingLoad.finish(false, null, "A navegação foi fechada antes de terminar."); pendingLoad = null; }
        if (browser != null) { browser.stopLoading(); browser.loadUrl("about:blank"); browser.destroy(); }
        if (browserPanel != null) root.removeView(browserPanel);
        network.shutdownNow();
    }
    public boolean isShowingBrowser() { return browserPanel != null && browserPanel.getVisibility() == View.VISIBLE; }
    public void hideBrowser() {
        if (pendingLoad != null) { pendingLoad.finish(false, null, "A navegação foi fechada antes de terminar."); pendingLoad = null; }
        if (browser != null) { browser.stopLoading(); browser.loadUrl("about:blank"); }
        if (browserPanel != null) browserPanel.setVisibility(View.GONE);
    }

    private void confirm(final String action, final JSONObject args, final Callback callback) {
        String details = humanDetails(action, args);
        new AlertDialog.Builder(activity)
            .setTitle("Autorizar " + readable(action) + "?")
            .setMessage(details + "\n\nIsso executará somente esta ação no aparelho.")
            .setNegativeButton("Cancelar", (d, w) -> callback.done(false, null, "Você não autorizou " + readable(action) + "."))
            .setPositiveButton("Autorizar", (d, w) -> execute(action, args, callback))
            .setOnCancelListener(d -> callback.done(false, null, "Você não autorizou " + readable(action) + "."))
            .show();
    }

    private void execute(String action, JSONObject args, Callback cb) {
        try {
            if ("listApps".equals(action)) { cb.done(true, listApps(), null); return; }
            if ("launchApp".equals(action)) { launchApp(args, cb); return; }
            if ("accessibilitySettings".equals(action)) {
                activity.startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
                cb.done(true, new JSONObject().put("opened", true), null); return;
            }
            if (action.startsWith("device")) { device(action, args, cb); return; }
            if ("browserOpen".equals(action) || "browserNavigate".equals(action)) { openPublic(args.optString("url", ""), cb); return; }
            if ("browserSnapshot".equals(action)) { snapshot(cb); return; }
            if ("browserClick".equals(action)) { click(args, cb); return; }
            if ("browserType".equals(action)) { type(args, cb); return; }
            cb.done(false, null, "Ação nativa não suportada.");
        } catch (Exception e) { cb.done(false, null, errorFor(action, e)); }
    }

    private JSONArray listApps() throws Exception {
        JSONArray out = new JSONArray();
        Intent intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        for (ResolveInfo r : activity.getPackageManager().queryIntentActivities(intent, 0))
            out.put(new JSONObject().put("package", r.activityInfo.packageName).put("label", String.valueOf(r.loadLabel(activity.getPackageManager()))));
        return out;
    }
    private void launchApp(JSONObject args, Callback cb) throws Exception {
        String pkg = args.optString("package", "");
        Intent launch = activity.getPackageManager().getLaunchIntentForPackage(pkg);
        if (launch == null) { cb.done(false, null, "Não encontrei um app abrível para “" + pkg + "”."); return; }
        activity.startActivity(launch);
        cb.done(true, new JSONObject().put("launched", pkg).put("label", appName(pkg)), null);
    }
    private void device(String action, JSONObject args, Callback cb) throws Exception {
        AetherAccessibilityService service = AetherAccessibilityService.instance();
        if (service == null) {
            cb.done(false, null, "A acessibilidade do Aether está desativada. Ela é opcional; ative-a nas configurações para usar ações na tela.");
            return;
        }
        cb.done(true, service.command(action, args), null);
    }

    private void openPublic(String raw, Callback cb) {
        final Uri uri;
        try { uri = Uri.parse(raw); } catch (Exception e) { cb.done(false, null, "O endereço informado não é válido."); return; }
        if (!syntacticPublicHttps(uri)) { cb.done(false, null, "Só é permitido navegar para endereços HTTPS públicos na porta 443."); return; }
        network.execute(() -> {
            boolean safe = true;
            try { for (InetAddress address : InetAddress.getAllByName(uri.getHost())) if (isPrivate(address)) { safe = false; break; } }
            catch (Exception e) { safe = false; }
            final boolean approved = safe;
            main.post(() -> {
                if (closed) { cb.done(false, null, "As ações nativas foram encerradas."); return; }
                if (!approved) { cb.done(false, null, "Não foi possível validar que esse host é público."); return; }
                approvedHosts.add(uri.getHost().toLowerCase(Locale.ROOT));
                browserPanel.setVisibility(View.VISIBLE);
                if (pendingLoad != null) pendingLoad.finish(false, null, "Uma nova navegação substituiu a anterior.");
                pendingLoad = new PendingLoad(cb);
                browser.loadUrl(uri.toString());
                main.postDelayed(pendingLoad.timeout, BROWSER_TIMEOUT_MS);
            });
        });
    }
    private void snapshot(Callback cb) {
        if (!browserReady(cb) || blockSensitivePage(cb)) return;
        browser.evaluateJavascript("(function(){var f=[].slice.call(document.querySelectorAll('input,textarea,select'));var sensitive=f.some(function(e){var z=((e.type||'')+' '+(e.autocomplete||'')+' '+(e.name||'')+' '+(e.id||'')).toLowerCase();return e.type==='password'||/password|current-password|new-password|one-time-code|cc-|card|cvv|cvc|otp|pin/.test(z);});if(sensitive)return JSON.stringify({sensitive:true});var b=document.body;var t=b?(b.innerText||'').slice(0,12000):'';var l=[].slice.call(document.querySelectorAll('a')).slice(0,100).map(function(x,i){return {n:i+1,text:(x.innerText||x.href||'').slice(0,300),href:x.href};});return JSON.stringify({title:(document.title||'').slice(0,300),text:t,links:l});})()", v -> { try { String raw=unquote(v); if(new JSONObject(raw).optBoolean("sensitive")){cb.done(false,null,"A leitura é bloqueada em páginas com campos de senha, pagamento ou códigos temporários.");return;} cb.done(true,result("snapshot",raw),null); } catch(Exception e) { cb.done(false,null,"Não foi possível ler a página com segurança."); } });
    }
    private void click(JSONObject args, Callback cb) {
        if (!browserReady(cb) || blockSensitivePage(cb)) return;
        int index = args.optInt("selector", 0);
        if (index < 1 || index > 100) { cb.done(false, null, "Escolha um link entre 1 e 100 do snapshot do navegador."); return; }
        browser.evaluateJavascript("(function(){var a=document.querySelectorAll('a'),x=a[" + (index - 1) + "];if(!x)return 'missing';x.click();return 'clicked';})()", v -> cb.done(true, result("status", unquote(v)), null));
    }
    private void type(JSONObject args, Callback cb) {
        if (!browserReady(cb) || blockSensitivePage(cb)) return;
        String text = args.optString("text", ""), selector = args.optString("selector", "");
        if (text.length() > 12000 || !safeInputSelector(selector)) { cb.done(false, null, "O campo do navegador não é permitido ou o texto é longo demais."); return; }
        String js = "(function(){var e=document.querySelector(" + JSONObject.quote(selector) + ");if(!e)return 'missing';var z=((e.type||'')+' '+(e.autocomplete||'')+' '+(e.name||'')+' '+(e.id||'')).toLowerCase();if(/password|current-password|new-password|one-time-code|cc-|card|cvv|cvc|otp|pin/.test(z))return 'blocked';e.focus();e.value=" + JSONObject.quote(text) + ";e.dispatchEvent(new Event('input',{bubbles:true}));return 'typed';})()";
        browser.evaluateJavascript(js, v -> { String status = unquote(v); if ("blocked".equals(status)) cb.done(false, null, "Não é permitido preencher senhas, cartões, PINs ou códigos temporários."); else cb.done(true, result("status", status), null); });
    }
    private boolean browserReady(Callback cb) {
        if (!isShowingBrowser() || browser.getUrl() == null || "about:blank".equals(browser.getUrl())) { cb.done(false, null, "Abra uma página pública no navegador antes de interagir."); return false; }
        return true;
    }
    private boolean blockSensitivePage(Callback cb) {
        String url = browser.getUrl() == null ? "" : browser.getUrl().toLowerCase(Locale.ROOT);
        if (url.matches(".*(login|signin|auth|bank|wallet|payment|checkout|account).*")) {
            cb.done(false, null, "A leitura e interação são bloqueadas em páginas de login, conta, banco ou pagamento.");
            return true;
        }
        return false;
    }

    private void buildBrowserOverlay() {
        browserPanel = new FrameLayout(activity); browserPanel.setBackgroundColor(Color.WHITE); browserPanel.setVisibility(View.GONE);
        LinearLayout bar = new LinearLayout(activity); bar.setOrientation(LinearLayout.HORIZONTAL);
        Button back = new Button(activity); back.setText("‹"); back.setOnClickListener(v -> { if (browser.canGoBack()) browser.goBack(); });
        browserTitle = new TextView(activity); browserTitle.setText("Navegador isolado"); browserTitle.setGravity(Gravity.CENTER_VERTICAL); browserTitle.setSingleLine();
        Button close = new Button(activity); close.setText("Fechar"); close.setOnClickListener(v -> hideBrowser());
        bar.addView(back, new LinearLayout.LayoutParams(56, -1)); bar.addView(browserTitle, new LinearLayout.LayoutParams(0, -1, 1)); bar.addView(close, new LinearLayout.LayoutParams(-2, -1));
        browser = new BrowserWebView(activity); browserPanel.addView(bar, new FrameLayout.LayoutParams(-1, 58));
        FrameLayout.LayoutParams page = new FrameLayout.LayoutParams(-1, -1); page.topMargin = 58; browserPanel.addView(browser, page);
        root.addView(browserPanel, new FrameLayout.LayoutParams(-1, -1));
    }
    private final class BrowserWebView extends WebView {
        BrowserWebView(Activity context) { super(context); WebSettings s=getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setAllowFileAccess(false); s.setAllowContentAccess(false); s.setAllowFileAccessFromFileURLs(false); s.setAllowUniversalAccessFromFileURLs(false); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); s.setSaveFormData(false); setWebViewClient(new WebViewClient(){ @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r){return !hostApproved(r.getUrl());} @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r){return hostApproved(r.getUrl())?null:blocked();} @Override public void onPageFinished(WebView v,String url){browserTitle.setText(v.getTitle()==null?url:v.getTitle()); if(pendingLoad!=null){PendingLoad p=pendingLoad;pendingLoad=null;p.finish(true,result("url",url),null);}} }); }
    }
    private final class PendingLoad {
        final Callback cb; final AtomicBoolean done=new AtomicBoolean(false); final Runnable timeout=()->finish(false,null,"A página demorou demais para carregar.");
        PendingLoad(Callback cb){this.cb=cb;} void finish(boolean ok,Object result,String error){if(done.compareAndSet(false,true)){main.removeCallbacks(timeout);cb.done(ok,result,error);}}
    }
    private Callback once(final Callback cb) { AtomicBoolean done=new AtomicBoolean(false); return (ok,result,error)->{if(done.compareAndSet(false,true)) cb.done(ok,result,error);}; }
    private boolean hostApproved(Uri u) { return syntacticPublicHttps(u) && approvedHosts.contains(u.getHost().toLowerCase(Locale.ROOT)); }
    private static boolean syntacticPublicHttps(Uri u) { if(u==null||!"https".equalsIgnoreCase(u.getScheme())||u.getHost()==null||u.getUserInfo()!=null||(u.getPort()!=-1&&u.getPort()!=443))return false;String h=u.getHost().toLowerCase(Locale.ROOT);return !(h.equals("localhost")||h.endsWith(".localhost")||h.matches("[0-9.]+")||h.indexOf(':')>=0); }
    private static boolean isPrivate(InetAddress a) { byte[] b=a.getAddress();if(a.isAnyLocalAddress()||a.isLoopbackAddress()||a.isLinkLocalAddress()||a.isSiteLocalAddress()||a.isMulticastAddress())return true;if(b.length==4){int x=b[0]&255,y=b[1]&255;return x==0||x==10||(x==100&&y>=64&&y<=127)||x==127||(x==169&&y==254)||(x==172&&y>=16&&y<=31)||(x==192&&y==168);}return (b[0]&0xfe)==0xfc; }
    private static boolean safeInputSelector(String s) { return s.length()>0&&s.length()<=120&&s.matches("(input|textarea)(#[A-Za-z][A-Za-z0-9_-]{0,63}|\\[name=['\\\"]?[A-Za-z][A-Za-z0-9_-]{0,63}['\\\"]?\\]|\\[type=['\\\"]?(text|search|email|tel|url|number)['\\\"]?\\])?"); }
    private static boolean allowed(String a) { return Arrays.asList("listApps","launchApp","accessibilitySettings","deviceSnapshot","deviceTap","deviceText","browserOpen","browserNavigate","browserSnapshot","browserClick","browserType","browserVisible","browserClose").contains(a); }
    private static WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",403,"Bloqueado",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    private static JSONObject result(String k,String v){try{return new JSONObject().put(k,v);}catch(Exception e){return new JSONObject();}}
    private static String unquote(String s){try{return new JSONTokener(s).nextValue().toString();}catch(Exception e){return "";}}
    private JSONObject visibleResult(){try{return new JSONObject().put("visible",isShowingBrowser());}catch(Exception e){return new JSONObject();}}
    private String appName(String pkg){try{return String.valueOf(activity.getPackageManager().getApplicationLabel(activity.getPackageManager().getApplicationInfo(pkg,0)));}catch(Exception e){return pkg;}}
    private String humanDetails(String a,JSONObject x){ if("launchApp".equals(a))return "Abrir o app: "+appName(x.optString("package")); if(a.startsWith("device"))return "Usar a acessibilidade para "+readable(a)+" na janela atual."; if(a.startsWith("browser"))return "Usar o navegador isolado para: "+(x.optString("url","").isEmpty()?readable(a):x.optString("url")); if("listApps".equals(a))return "Ler a lista de apps instalados e seus nomes."; return "Abrir as configurações de acessibilidade do Android."; }
    private static String readable(String a){if("listApps".equals(a))return "listar aplicativos";if("launchApp".equals(a))return "abrir aplicativo";if("accessibilitySettings".equals(a))return "configurações de acessibilidade";if("deviceSnapshot".equals(a))return "ler a tela atual";if("deviceTap".equals(a))return "tocar em um item da tela";if("deviceText".equals(a))return "digitar na tela";if("browserOpen".equals(a)||"browserNavigate".equals(a))return "abrir página";if("browserSnapshot".equals(a))return "ler página";if("browserClick".equals(a))return "clicar em link";if("browserType".equals(a))return "preencher campo";return a;}
    private static String errorFor(String action,Exception e){return "Não foi possível "+readable(action)+": "+(e.getMessage()==null?"verifique os dados e tente novamente.":e.getMessage());}
}
