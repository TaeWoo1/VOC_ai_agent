package com.sellerops.ingest.parse;

import com.sellerops.common.ApiException;
import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.apache.poi.openxml4j.util.ZipSecureFile;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Component;

/** Parses an uploaded CSV or XLSX into a header-keyed {@link ParsedTable}. */
@Component
public class FileParser {

    static {
        // Zip-bomb guards for XLSX (OOXML is a zip). The 10MB multipart cap bounds
        // the compressed input; these cap decompressed expansion per entry.
        ZipSecureFile.setMaxEntrySize(64L * 1024 * 1024);
        ZipSecureFile.setMinInflateRatio(0.01);
    }

    /** Normalize a header cell: drop a leading UTF-8 BOM, then strip and lowercase.
     *  CSV/XLSX exported for Excel often prefixes the first header with a BOM
     *  (U+FEFF) — our own sample download does — and {@code String.strip()} does
     *  NOT remove it (U+FEFF is not whitespace), leaving a BOM-prefixed "상품명" to
     *  silently miss the "상품명" alias. Applied at every header site so headers and
     *  row keys agree. Header normalization only; ingestion semantics are unchanged. */
    static String normalizeHeader(String raw) {
        if (raw == null) {
            return "";
        }
        String h = raw;
        if (!h.isEmpty() && h.charAt(0) == '\uFEFF') {
            h = h.substring(1);
        }
        return h.strip().toLowerCase();
    }

    public ParsedTable parse(String filename, InputStream data) {
        String name = filename == null ? "" : filename.toLowerCase();
        try (InputStream in = new BufferedInputStream(data)) {
            if (name.endsWith(".xlsx")) {
                return parseXlsx(in);
            }
            if (name.endsWith(".csv")) {
                return parseCsv(in);
            }
            throw ApiException.badRequest("지원하지 않는 파일 형식입니다. CSV 또는 XLSX 파일을 올려주세요.");
        } catch (IOException e) {
            throw ApiException.badRequest("파일을 읽지 못했습니다: " + e.getMessage());
        }
    }

    private ParsedTable parseCsv(InputStream in) throws IOException {
        CSVFormat format = CSVFormat.DEFAULT.builder()
                .setHeader()
                .setSkipHeaderRecord(true)
                .setIgnoreSurroundingSpaces(true)
                .setTrim(true)
                .build();
        try (CSVParser parser = format.parse(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            List<String> headers = parser.getHeaderNames().stream()
                    .map(FileParser::normalizeHeader)
                    .toList();
            List<Map<String, String>> rows = new ArrayList<>();
            for (CSVRecord record : parser) {
                Map<String, String> row = new LinkedHashMap<>();
                record.toMap().forEach((header, value) ->
                        row.put(normalizeHeader(header), value == null ? "" : value.strip()));
                rows.add(row);
            }
            return new ParsedTable(headers, rows);
        }
    }

    private ParsedTable parseXlsx(InputStream in) throws IOException {
        try (Workbook workbook = new XSSFWorkbook(in)) {
            Sheet sheet = workbook.getSheetAt(0);
            DataFormatter formatter = new DataFormatter();
            if (sheet == null || sheet.getPhysicalNumberOfRows() == 0) {
                return new ParsedTable(List.of(), List.of());
            }
            Row headerRow = sheet.getRow(sheet.getFirstRowNum());
            List<String> headers = new ArrayList<>();
            for (int c = 0; c < headerRow.getLastCellNum(); c++) {
                Cell cell = headerRow.getCell(c);
                headers.add(normalizeHeader(formatter.formatCellValue(cell)));
            }
            List<Map<String, String>> rows = new ArrayList<>();
            for (int r = sheet.getFirstRowNum() + 1; r <= sheet.getLastRowNum(); r++) {
                Row sheetRow = sheet.getRow(r);
                if (sheetRow == null) {
                    continue;
                }
                Map<String, String> row = new LinkedHashMap<>();
                boolean anyValue = false;
                for (int c = 0; c < headers.size(); c++) {
                    String value = formatter.formatCellValue(sheetRow.getCell(c)).strip();
                    row.put(headers.get(c), value);
                    anyValue = anyValue || !value.isEmpty();
                }
                if (anyValue) {
                    rows.add(row);
                }
            }
            return new ParsedTable(headers, rows);
        }
    }
}
