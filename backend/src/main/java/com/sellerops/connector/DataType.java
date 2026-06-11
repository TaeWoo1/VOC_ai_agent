package com.sellerops.connector;

/**
 * Collectable data types, aligned 1:1 with {@code connector_capabilities.data_type}
 * and the per-(seller account x data type) scheduling model. The string name() is
 * what is stored in those columns.
 */
public enum DataType {
    REVIEW,
    INQUIRY,
    ORDER_SUMMARY,
    PRODUCT,
    SALES
}
