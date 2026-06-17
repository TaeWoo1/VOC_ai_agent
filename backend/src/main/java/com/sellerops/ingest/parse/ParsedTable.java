package com.sellerops.ingest.parse;

import java.util.List;
import java.util.Map;

/** A parsed spreadsheet: lowercased header names + rows keyed by header. */
public record ParsedTable(List<String> headers, List<Map<String, String>> rows) {
}
