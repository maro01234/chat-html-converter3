import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.Executors;

public class WebServer {
    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final Map<String, String> ASSETS = Map.of(
        "/", "index.html", "/app.js", "app.js", "/style.css", "style.css");
    private static final String CSP = "default-src 'none'; style-src 'self' 'unsafe-inline'; "
        + "script-src 'self' https://cdn.jsdelivr.net; connect-src 'self'; frame-src 'self' blob:; "
        + "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "10000"));
        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 32);
        server.createContext("/", WebServer::handle);
        server.setExecutor(Executors.newFixedThreadPool(4));
        Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(1)));
        server.start();
        System.out.println("Chat HTML Converter listening on port " + port);
    }

    private static void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod();
            if (path.equals("/api/convert")) {
                if (!method.equals("POST")) {
                    exchange.getResponseHeaders().set("Allow", "POST");
                    send(exchange, 405, "text/plain", "POSTを使用してください。");
                    return;
                }
                String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
                if (contentType == null || !contentType.split(";", 2)[0].trim().equalsIgnoreCase("text/plain")) {
                    send(exchange, 415, "text/plain", "UTF-8のテキストを送信してください。");
                    return;
                }
                byte[] body = exchange.getRequestBody().readNBytes(MAX_BYTES + 1);
                if (body.length > MAX_BYTES) {
                    send(exchange, 413, "text/plain", "ログは2 MiB以下にしてください。");
                    return;
                }
                try {
                    String source = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(body)).toString();
                    send(exchange, 200, "text/html", ChatHtmlConverter.convert(source));
                } catch (CharacterCodingException e) {
                    send(exchange, 400, "text/plain", "UTF-8のテキストを送信してください。");
                } catch (IllegalArgumentException e) {
                    send(exchange, 400, "text/plain", e.getMessage());
                }
                return;
            }
            if (!method.equals("GET") && !method.equals("HEAD")) {
                exchange.getResponseHeaders().set("Allow", "GET, HEAD");
                send(exchange, 405, "text/plain", "GETを使用してください。");
                return;
            }
            if (path.equals("/healthz")) {
                send(exchange, 200, "text/plain", "ok");
            } else if (ASSETS.containsKey(path)) {
                String filename = ASSETS.get(path);
                String type = filename.endsWith(".css") ? "text/css"
                    : filename.endsWith(".js") ? "text/javascript" : "text/html";
                send(exchange, 200, type, Files.readString(Path.of("public", filename)));
            } else {
                send(exchange, 404, "text/plain", "ページが見つかりません。");
            }
        } catch (IOException e) {
            // Do not log request bodies or generated conversations.
            System.err.println("HTTP request could not be completed: " + e.getClass().getSimpleName());
        }
    }

    private static void send(HttpExchange exchange, int status, String type, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        var headers = exchange.getResponseHeaders();
        headers.set("Content-Type", type + "; charset=utf-8");
        headers.set("Cache-Control", "no-store");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Referrer-Policy", "no-referrer");
        headers.set("Content-Security-Policy", CSP);
        if (exchange.getRequestMethod().equals("HEAD")) {
            headers.set("Content-Length", Integer.toString(bytes.length));
            exchange.sendResponseHeaders(status, -1);
        } else {
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
        }
    }
}
