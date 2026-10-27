package com.reelnest.importer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.text.Normalizer;

@Component
public class InstagramSavedPostsParser {

    private static final Map<String, Integer> MONTHS = Map.ofEntries(
            Map.entry("jan", 1), Map.entry("january", 1),
            Map.entry("sty", 1), Map.entry("styczen", 1), Map.entry("stycznia", 1),
            Map.entry("feb", 2), Map.entry("february", 2),
            Map.entry("lut", 2), Map.entry("luty", 2), Map.entry("lutego", 2),
            Map.entry("mar", 3), Map.entry("march", 3),
            Map.entry("marzec", 3), Map.entry("marca", 3),
            Map.entry("apr", 4), Map.entry("april", 4),
            Map.entry("kwi", 4), Map.entry("kwiecien", 4), Map.entry("kwietnia", 4),
            Map.entry("may", 5), Map.entry("maj", 5), Map.entry("maja", 5),
            Map.entry("jun", 6), Map.entry("june", 6),
            Map.entry("cze", 6), Map.entry("czerwiec", 6), Map.entry("czerwca", 6),
            Map.entry("jul", 7), Map.entry("july", 7),
            Map.entry("lip", 7), Map.entry("lipiec", 7), Map.entry("lipca", 7),
            Map.entry("aug", 8), Map.entry("august", 8),
            Map.entry("sie", 8), Map.entry("sierpien", 8), Map.entry("sierpnia", 8),
            Map.entry("sep", 9), Map.entry("september", 9),
            Map.entry("wrz", 9), Map.entry("wrzesien", 9), Map.entry("wrzesnia", 9),
            Map.entry("oct", 10), Map.entry("october", 10),
            Map.entry("paz", 10), Map.entry("pazdziernik", 10), Map.entry("pazdziernika", 10),
            Map.entry("nov", 11), Map.entry("november", 11),
            Map.entry("lis", 11), Map.entry("listopad", 11), Map.entry("listopada", 11),
            Map.entry("dec", 12), Map.entry("december", 12),
            Map.entry("gru", 12), Map.entry("grudzien", 12), Map.entry("grudnia", 12));

    private final ObjectMapper objectMapper;

    public InstagramSavedPostsParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public ParsedImport parse(byte[] content, ZoneId timeZone) {
        Document document = Jsoup.parse(new String(content, java.nio.charset.StandardCharsets.UTF_8));
        Elements records = document.select("main._a706 > div._a6-g");
        if (records.isEmpty()) {
            throw unsupportedFormat();
        }

        List<ParsedPost> posts = new ArrayList<>();
        List<ImportItemError> errors = new ArrayList<>();
        for (int index = 0; index < records.size(); index++) {
            try {
                posts.add(parseRecord(records.get(index), index + 1, timeZone));
            } catch (InvalidRecordException exception) {
                errors.add(new ImportItemError(index + 1, exception.code, exception.getMessage()));
            }
        }
        return new ParsedImport(List.copyOf(posts), List.copyOf(errors));
    }

    private ParsedPost parseRecord(Element record, int recordIndex, ZoneId timeZone) {
        InstagramUrlNormalizer.NormalizedUrl normalizedUrl = parsePostUrl(record);
        Element dateElement = record.selectFirst("div._3-94._a6-o");
        if (dateElement == null || dateElement.text().isBlank()) {
            throw invalid("invalid_timestamp", "Record does not contain a saved date.");
        }
        Instant savedAt = parseSavedAt(dateElement.text(), timeZone);
        String caption = readField(record, "napisy", "caption", "captions", "description");
        String creatorUsername = readField(
                record, "nazwa uzytkownika", "username", "user name");

        ObjectNode sourceMetadata = objectMapper.createObjectNode();
        if (caption == null) {
            sourceMetadata.putNull("caption");
        } else {
            sourceMetadata.put("caption", caption);
        }
        if (creatorUsername != null) {
            sourceMetadata.put("creatorUsername", creatorUsername);
        }

        return new ParsedPost(
                "instagram-html:" + normalizedUrl.canonical(),
                normalizedUrl.original(),
                normalizedUrl.canonical(),
                savedAt,
                sourceMetadata,
                recordIndex);
    }

    private InstagramUrlNormalizer.NormalizedUrl parsePostUrl(Element record) {
        Set<String> hrefs = new LinkedHashSet<>();
        for (Element row : record.select("tr")) {
            Element label = row.selectFirst("td._a6_q");
            Element value = row.selectFirst("td._a6_r");
            if (label == null || !isUrlLabel(label.text())) {
                continue;
            }
            Element linkContainer = value == null ? row : value;
            Elements links = linkContainer.select("a[href]");
            if (links.isEmpty() && value != null && !value.text().isBlank()) {
                hrefs.add(value.text().strip());
            } else {
                for (Element link : links) {
                    hrefs.add(link.attr("href").strip());
                }
            }
        }
        if (hrefs.isEmpty()) {
            throw invalid("missing_post_url", "Record does not contain a saved-post URL.");
        }

        Map<String, InstagramUrlNormalizer.NormalizedUrl> normalizedUrls = new LinkedHashMap<>();
        for (String href : hrefs) {
            try {
                URI uri = URI.create(href);
                String host = uri.getHost();
                String path = uri.getPath();
                if (!("http".equalsIgnoreCase(uri.getScheme())
                        || "https".equalsIgnoreCase(uri.getScheme()))
                        || host == null
                        || !(host.equalsIgnoreCase("instagram.com")
                        || host.equalsIgnoreCase("www.instagram.com"))
                        || path == null
                        || !path.matches("/(?:p|reel|tv)/[A-Za-z0-9_-]{1,128}/?")) {
                    continue;
                }
                InstagramUrlNormalizer.NormalizedUrl normalized = InstagramUrlNormalizer.normalize(href);
                normalizedUrls.putIfAbsent(normalized.canonical(), normalized);
            } catch (IllegalArgumentException exception) {
                continue;
            }
        }
        if (normalizedUrls.isEmpty()) {
            throw invalid("invalid_post_url", "Record does not contain a supported Instagram post URL.");
        }
        if (normalizedUrls.size() > 1) {
            throw invalid("ambiguous_post_url", "Record contains multiple saved-post URLs.");
        }
        return normalizedUrls.values().iterator().next();
    }

    private boolean isUrlLabel(String label) {
        String normalized = normalize(label);
        return normalized.equals("adres url")
                || normalized.startsWith("adres url ")
                || normalized.equals("post url")
                || normalized.startsWith("post url ");
    }

    private String readField(Element record, String... acceptedLabels) {
        Set<String> accepted = Set.of(acceptedLabels);
        Set<String> values = new LinkedHashSet<>();
        for (Element row : record.select("tr")) {
            Element label = row.selectFirst("td._a6_q");
            Element value = row.selectFirst("td._a6_r");
            if (label == null || value == null || !accepted.contains(normalize(label.text()))) {
                continue;
            }
            String text = value.text().strip();
            if (!text.isEmpty()) {
                values.add(text);
            }
        }
        return values.isEmpty() ? null : String.join("\n\n", values);
    }

    private Instant parseSavedAt(String value, ZoneId timeZone) {
        String normalized = normalize(value);
        String[] parts = normalized.split("\\s+");
        int timeIndex = -1;
        int hour = -1;
        int minute = -1;
        for (int index = 0; index < parts.length; index++) {
            String candidate = parts[index].replaceAll("[^0-9:]", "");
            if (candidate.matches("\\d{1,2}:\\d{2}")) {
                String[] time = candidate.split(":");
                timeIndex = index;
                hour = Integer.parseInt(time[0]);
                minute = Integer.parseInt(time[1]);
                break;
            }
        }
        if (timeIndex < 0 || hour > 23 || minute > 59) {
            throw invalid("invalid_timestamp", "Record contains an invalid saved date.");
        }

        List<String> dateParts = new ArrayList<>();
        for (int index = 0; index < timeIndex; index++) {
            if (!parts[index].equals("at")) {
                dateParts.add(parts[index]);
            }
        }
        int month;
        int day;
        int year;
        if (dateParts.size() >= 3 && MONTHS.containsKey(letters(dateParts.getFirst()))) {
            month = MONTHS.get(letters(dateParts.getFirst()));
            day = number(dateParts.get(1));
            year = number(dateParts.get(2));
        } else if (dateParts.size() >= 3 && MONTHS.containsKey(letters(dateParts.get(1)))) {
            day = number(dateParts.getFirst());
            month = MONTHS.get(letters(dateParts.get(1)));
            year = number(dateParts.get(2));
        } else {
            throw invalid("invalid_timestamp", "Record contains an unsupported saved-date format.");
        }

        String period = String.join(" ", java.util.Arrays.copyOfRange(parts, timeIndex + 1, parts.length))
                .replaceAll("[^\\p{L} ]", "")
                .strip();
        if (period.equals("am")) {
            hour = hour == 12 ? 0 : hour;
        } else if (period.equals("pm")) {
            hour = hour < 12 ? hour + 12 : hour;
        } else if (period.equals("rano")) {
            hour = hour == 12 ? 0 : hour;
        } else if (period.equals("po poludniu")) {
            hour = hour > 0 && hour < 12 ? hour + 12 : hour;
        } else if (!period.isEmpty()) {
            throw invalid("invalid_timestamp", "Record contains an unsupported saved-date period.");
        }

        try {
            return LocalDateTime.of(
                    LocalDate.of(year, month, day),
                    java.time.LocalTime.of(hour, minute))
                    .atZone(timeZone)
                    .toInstant();
        } catch (DateTimeException exception) {
            throw invalid("invalid_timestamp", "Record contains an invalid saved date.");
        }
    }

    private int number(String value) {
        String digits = value.replaceAll("\\D", "");
        if (digits.isEmpty()) {
            throw invalid("invalid_timestamp", "Record contains an invalid saved date.");
        }
        return Integer.parseInt(digits);
    }

    private String letters(String value) {
        return value.replaceAll("[^\\p{L}]", "");
    }

    private String normalize(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .replace('\u0142', 'l')
                .replace('\u0141', 'l')
                .toLowerCase(Locale.ROOT)
                .strip()
                .replaceAll("\\s+", " ");
    }

    private ImportValidationException unsupportedFormat() {
        return new ImportValidationException(
                HttpStatus.UNPROCESSABLE_ENTITY,
                "Unsupported export structure. This endpoint accepts the observed saved_posts.html format.");
    }

    private InvalidRecordException invalid(String code, String message) {
        return new InvalidRecordException(code, message);
    }

    public record ParsedPost(
            String sourceIdentifier,
            String originalUrl,
            String canonicalUrl,
            Instant savedAt,
            ObjectNode sourceMetadata,
            int recordIndex) {
    }

    public record ParsedImport(List<ParsedPost> posts, List<ImportItemError> errors) {
    }

    private static final class InvalidRecordException extends RuntimeException {

        private final String code;

        private InvalidRecordException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
