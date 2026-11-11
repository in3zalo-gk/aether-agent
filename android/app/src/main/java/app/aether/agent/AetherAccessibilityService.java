package app.aether.agent;

import android.accessibilityservice.AccessibilityService;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Optional foreground-only service; every command is confirmed by MainActivity. */
public final class AetherAccessibilityService extends AccessibilityService {
    private static volatile AetherAccessibilityService current;
    private static final Set<String> SENSITIVE = new HashSet<>(Arrays.asList(
        "bank", "wallet", "payment", "pay", "auth", "identity", "password", "credential", "finance", "crypto", "card"
    ));
    public static AetherAccessibilityService instance() { return current; }
    @Override public void onServiceConnected() { current = this; }
    @Override public void onDestroy() { if (current == this) current = null; super.onDestroy(); }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { /* no background collection */ }
    @Override public void onInterrupt() { }

    public Object command(String action, JSONObject args) throws Exception {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) throw new IllegalStateException("No foreground window");
        try {
            if (sensitivePackage(root.getPackageName())) throw new SecurityException("Sensitive app blocked");
            if (action.equals("deviceSnapshot")) return snapshot(root);
            int index = args.optInt("index", -1);
            if (index < 1 || index > 200) throw new IllegalArgumentException("Snapshot index required");
            AccessibilityNodeInfo target = findByIndex(root, index, new int[]{0}, 0);
            if (target == null) throw new IllegalArgumentException("Snapshot index unavailable");
            try {
                if (passwordNode(target)) throw new SecurityException("Password field blocked");
                if (action.equals("deviceTap")) {
                    AccessibilityNodeInfo clickable = clickableTarget(target);
                    try {
                        if (clickable == null || !clickable.isEnabled() || !clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) throw new IllegalStateException("Indexed node is not clickable");
                        return new JSONObject().put("tapped", true).put("index", index);
                    } finally { if (clickable != null && clickable != target) clickable.recycle(); }
                }
                if (action.equals("deviceText")) {
                    String text = args.optString("text");
                    if (text.length() > 12000 || !target.isEditable()) throw new IllegalArgumentException("Indexed node is not an editable field");
                    Bundle b = new Bundle();
                    b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
                    if (!target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)) throw new IllegalStateException("Text entry failed");
                    return new JSONObject().put("typed", true).put("index", index);
                }
                throw new IllegalArgumentException("Unsupported device action");
            } finally { target.recycle(); }
        } finally { root.recycle(); }
    }

    private static AccessibilityNodeInfo clickableTarget(AccessibilityNodeInfo n) {
        AccessibilityNodeInfo current = n;
        while (current != null && !current.isClickable()) {
            AccessibilityNodeInfo parent = current.getParent();
            if (current != n) current.recycle();
            current = parent;
        }
        return current;
    }
    private static AccessibilityNodeInfo findByIndex(AccessibilityNodeInfo n, int wanted, int[] seen, int depth) {
        if (n == null || depth > 12 || seen[0] >= 200) return null;
        if (++seen[0] == wanted) return AccessibilityNodeInfo.obtain(n);
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo child = n.getChild(i);
            if (child != null) try { AccessibilityNodeInfo found = findByIndex(child, wanted, seen, depth + 1); if (found != null) return found; } finally { child.recycle(); }
        }
        return null;
    }
    private static boolean sensitivePackage(CharSequence p) { String s = String.valueOf(p).toLowerCase(Locale.ROOT); for (String x : SENSITIVE) if (s.contains(x)) return true; return false; }
    private static boolean passwordNode(AccessibilityNodeInfo n) { return n.isPassword() || (n.getInputType() & 0x00000080) != 0; }
    private JSONObject snapshot(AccessibilityNodeInfo root) throws JSONException {
        JSONArray nodes = new JSONArray(); append(root, nodes, new int[]{0}, 0);
        return new JSONObject().put("package", String.valueOf(root.getPackageName())).put("nodes", nodes);
    }
    private void append(AccessibilityNodeInfo n, JSONArray out, int[] index, int depth) throws JSONException {
        if (n == null || depth > 12 || out.length() >= 200) return;
        JSONObject x = new JSONObject(); x.put("index", ++index[0]); x.put("class", String.valueOf(n.getClassName())); x.put("clickable", n.isClickable()); x.put("editable", n.isEditable()); x.put("enabled", n.isEnabled());
        if (passwordNode(n)) x.put("text", "[REDACTED]"); else { String t = String.valueOf(n.getText()); String d = String.valueOf(n.getContentDescription()); x.put("text", t.length() > 500 ? t.substring(0, 500) : t); x.put("description", d.length() > 300 ? d.substring(0, 300) : d); }
        out.put(x);
        for (int i = 0; i < n.getChildCount(); i++) { AccessibilityNodeInfo c = n.getChild(i); if (c != null) try { append(c, out, index, depth + 1); } finally { c.recycle(); } }
    }
}
