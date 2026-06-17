package com.sellerops.auth.dto;

import com.sellerops.user.UserView;

public record AuthResponse(String token, UserView user) {
}
