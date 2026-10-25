package com.reelnest.importer;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

public final class InstagramUrlNormalizer {

    private InstagramUrlNormalizer() {
    }

    public static NormalizedUrl normalize(String value) {
        if (value == null || value.isBlank() || value.length() > 2048) {
            throw new IllegalArgumentException("Post URL is empty or too long.");
        }

        try {
            URI parsed = new URI(value.trim());
            String scheme = parsed.getScheme();
            String host = parsed.getHost();
            if (scheme == null || host == null
                    || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))
                    || parsed.getRawUserInfo() != null
                    || !isInstagramHost(host)) {
                throw new IllegalArgumentException("Post URL must use an Instagram web address.");
            }

            scheme = scheme.toLowerCase(Locale.ROOT);
            host = host.toLowerCase(Locale.ROOT);
            int port = parsed.getPort();
            if ((scheme.equals("http") && port == 80) || (scheme.equals("https") && port == 443)) {
                port = -1;
            }

            String path = parsed.normalize().getRawPath();
            if (path == null || path.equals("/")) {
                path = "";
            } else {
                path = path.replaceAll("/+$", "");
            }

            StringBuilder canonical = new StringBuilder(scheme).append("://").append(host);
            if (port >= 0) {
                canonical.append(':').append(port);
            }
            canonical.append(path);
            if (parsed.getRawQuery() != null) {
                canonical.append('?').append(parsed.getRawQuery());
            }

            return new NormalizedUrl(value.trim(), canonical.toString());
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("Post URL is invalid.", exception);
        }
    }

    private static boolean isInstagramHost(String host) {
        String normalizedHost = host.toLowerCase(Locale.ROOT);
        return normalizedHost.equals("instagram.com") || normalizedHost.endsWith(".instagram.com");
    }

    public record NormalizedUrl(String original, String canonical) {
    }
}
