package com.sellerops.order.dto;

import java.time.LocalDate;

public record SalesTrendPoint(LocalDate date, int orderCount, long salesAmount) {
}
