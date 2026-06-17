package com.sellerops.connector;

/**
 * Thrown when a connector is asked to fetch a {@link DataType} it does not serve
 * for a given channel (e.g. reviews on a marketplace with no review API). Makes
 * the unsupported case explicit rather than silently returning empty data.
 */
public class UnsupportedDataTypeException extends RuntimeException {

    public UnsupportedDataTypeException(String channelCode, DataType dataType) {
        super("Connector does not support data type " + dataType + " for channel " + channelCode);
    }
}
