package com.sellerops.connector;

/**
 * A data source that feeds canonical records into the shared
 * {@link com.sellerops.ingest.IngestionService}. {@code FileUploadConnector} is
 * the Phase 1 implementation; future Coupang/Naver API connectors implement this
 * same family and reuse the ingestion + dedup core rather than re-importing ad hoc.
 */
public interface ChannelConnector {

    /** Stable connector identifier, recorded on the sync job (e.g. FILE_UPLOAD). */
    String kind();
}
