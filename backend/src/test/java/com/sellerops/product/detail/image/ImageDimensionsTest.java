package com.sellerops.product.detail.image;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ImageDimensionsTest {

    @Test
    @DisplayName("PNG: the size is read from IHDR without decoding a pixel")
    void png() {
        byte[] b = new byte[40];
        b[0] = (byte) 0x89;
        b[1] = 'P';
        b[2] = 'N';
        b[3] = 'G';
        b[18] = 0x03;
        b[19] = 0x5C;   // 860
        b[22] = 0x04;
        b[23] = (byte) 0xB0; // 1200
        assertThat(ImageDimensions.of(b)).isEqualTo(new ImageDimensions.Size(860, 1200));
    }

    @Test
    @DisplayName("JPEG: the marker walk finds the frame header")
    void jpeg() {
        byte[] b = new byte[]{
            (byte) 0xFF, (byte) 0xD8,
            (byte) 0xFF, (byte) 0xE0, 0x00, 0x04, 0x00, 0x00,          // APP0, skipped by length
            (byte) 0xFF, (byte) 0xC0, 0x00, 0x11, 0x08, 0x02, 0x30, 0x03, 0x20,  // SOF0 560×800
            0x00, 0x00, 0x00, 0x00};
        assertThat(ImageDimensions.of(b)).isEqualTo(new ImageDimensions.Size(800, 560));
    }

    @Test
    @DisplayName("GIF: little-endian logical screen size")
    void gif() {
        byte[] b = new byte[20];
        b[0] = 'G';
        b[1] = 'I';
        b[2] = 'F';
        b[6] = 0x40;
        b[7] = 0x01;    // 320
        b[8] = (byte) 0xF0;
        b[9] = 0x00;    // 240
        assertThat(ImageDimensions.of(b)).isEqualTo(new ImageDimensions.Size(320, 240));
    }

    @Test
    @DisplayName("unknown is a normal answer, not a failure")
    void unknownIsNull() {
        assertThat(ImageDimensions.of(null)).isNull();
        assertThat(ImageDimensions.of(new byte[4])).isNull();
        assertThat(ImageDimensions.of("not an image at all, just text".getBytes())).isNull();
    }
}
