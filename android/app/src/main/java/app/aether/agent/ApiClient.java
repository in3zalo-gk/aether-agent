package app.aether.agent;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.List;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** HTTPS JSON client. Session is encrypted with a non-exportable Android Keystore key.
 * Never persists account passwords or BYOK keys and never logs response bodies. */
public final class ApiClient {
    private static final String ORIGIN = "https://aether-secure.pages.dev";
    private static final String KEY_ALIAS = "aether.session.v1";
    private final SharedPreferences preferences;
    private String session = "";
    public ApiClient(Context context) {
        preferences = context.getSharedPreferences("aether_private_session", Context.MODE_PRIVATE);
        try {
            String data = preferences.getString("session", "");
            if (!data.isEmpty()) {
                String[] parts = data.split(":", 2);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                session = new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
            }
        } catch (Exception e) { clearSession(); }
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    private void saveSession(String value) {
        session = value;
        if (value.isEmpty()) { preferences.edit().remove("session").apply(); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
                Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            preferences.edit().putString("session", encrypted).apply();
        } catch (Exception e) {
            // Keep the authenticated session in memory only if secure storage is unavailable.
            preferences.edit().remove("session").apply();
        }
    }
    public synchronized void clearSession() { session = ""; preferences.edit().remove("session").apply(); }
    public synchronized JSONObject call(String method, String path, JSONObject body) throws Exception {
        if (!path.matches("/[A-Za-z0-9_/?=&%.-]*") || path.contains("..") || path.startsWith("//"))
            throw new Exception("Caminho de API inválido.");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(ORIGIN + "/api" + path).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000); connection.setReadTimeout(35000);
            connection.setRequestMethod(method); connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Origin", ORIGIN);
            connection.setRequestProperty("X-Aether-Request", "1");
            connection.setRequestProperty("User-Agent", "AetherAndroid/2.1.0");
            connection.setUseCaches(false);
            if (!session.isEmpty()) connection.setRequestProperty("Cookie", session);
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 128 * 1024) throw new Exception("A mensagem ultrapassou o limite de envio.");
                connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                if (entry.getKey() != null && "set-cookie".equalsIgnoreCase(entry.getKey())) {
                    for (String cookie : entry.getValue()) if (cookie.startsWith("__Host-aether=")) {
                        String pair = cookie.split(";", 2)[0];
                        saveSession(pair.equals("__Host-aether=") ? "" : pair);
                    }
                }
            }
            String raw;
            try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                if (input != null) {
                    byte[] buffer = new byte[8192]; int size;
                    while ((size = input.read(buffer)) != -1) {
                        if (output.size() + size > 8 * 1024 * 1024) throw new Exception("Resposta grande demais. Reduza o histórico da conta.");
                        output.write(buffer, 0, size);
                    }
                }
                raw = output.toString("UTF-8");
            }
            JSONObject data;
            try { data = new JSONObject(raw); }
            catch (Exception e) { throw new Exception("O serviço respondeu fora do formato esperado (HTTP " + status + "). Tente novamente mais tarde."); }
            if (status < 200 || status >= 300) {
                JSONObject error = data.optJSONObject("error");
                String code = error == null ? "" : error.optString("code");
                if ("UNAUTHENTICATED".equals(code) || "UNAUTHORIZED".equals(code)) clearSession();
                throw new Exception(friendly(code, status));
            }
            return data;
        } catch (java.net.UnknownHostException e) { throw new Exception("Sem conexão com o Aether. Confira sua internet e tente novamente."); }
        catch (java.net.SocketTimeoutException e) { throw new Exception("O serviço demorou a responder. Confira o histórico antes de reenviar."); }
        catch (javax.net.ssl.SSLException e) { throw new Exception("Não foi possível estabelecer uma conexão segura. Confira data e hora do aparelho."); }
        catch (java.io.IOException e) { throw new Exception("A conexão foi interrompida. Confira o histórico antes de reenviar a mensagem."); }
        finally { if (connection != null) connection.disconnect(); }
    }
    private String friendly(String code, int status) {
        switch (code) {
            case "INVALID_CREDENTIALS": return "Usuário ou senha incorretos.";
            case "UNAUTHORIZED": case "UNAUTHENTICATED": return "Sua sessão expirou. Entre novamente.";
            case "HANDLE_TAKEN": return "Este nome de usuário já está em uso.";
            case "INVALID_INPUT": return "Confira os campos. Use uma senha de pelo menos 12 caracteres.";
            case "RECOVERY_FAILED": return "Confira usuário, código de recuperação e nova senha de pelo menos 12 caracteres.";
            case "RATE_LIMITED": return "Limite temporário de tentativas. Aguarde um pouco antes de tentar novamente.";
            case "PROVIDER_UNAVAILABLE": return "O provedor de IA não respondeu. Confira a chave, o saldo, a URL e o modelo em Provedores.";
            case "PROVIDER_REQUIRED": case "NO_PROVIDER": return "Adicione e selecione um provedor de IA com sua chave antes de conversar.";
            case "KEY_STORAGE_UNAVAILABLE": return "O armazenamento seguro de chaves está indisponível no servidor. Tente novamente mais tarde.";
            case "UNSAFE_PROVIDER_URL": return "Use uma URL HTTPS pública de provedor. Endereços locais não são permitidos.";
            case "PROVIDER_REMOVED": return "Este provedor foi removido. Escolha outro.";
            case "CHAT_BUSY": return "A conversa já está processando uma resposta. Aguarde e atualize o histórico.";
            case "MEMORY_DISABLED": return "Ative a memória nas preferências antes de adicionar uma lembrança.";
            case "KEY_REQUIRED": return "Informe a chave do provedor em Provedores.";
            case "NOT_FOUND": return "Este item não foi encontrado. Atualize a lista.";
            case "ORIGIN_FORBIDDEN": return "O servidor recusou a conexão deste aplicativo. Atualize o Aether.";
            case "REVISION_CONFLICT": case "CONFLICT": return "A conta foi alterada em outro lugar. Atualize antes de tentar novamente.";
            default: return "Não foi possível concluir (HTTP " + status + "). Confira os campos e tente novamente.";
        }
    }
}
