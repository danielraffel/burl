#pragma once

#include <pulp/view/theme.hpp>

#include <map>
#include <string>
#include <vector>

namespace pulp::view {

struct AuthoredTokenSource {
    std::string uri;
    std::string revision;
    std::string content_hash;
    std::string adapter;
};

struct AuthoredTokenDiagnostic {
    std::string code;
    std::string message;
};

struct AuthoredTokenCollection {
    std::string id;
    std::string default_mode;
    std::vector<std::string> modes;
};

struct AuthoredTokenDocument {
    static constexpr int kSchemaVersion = 1;

    int schema_version = kSchemaVersion;
    std::string authored_dtcg_json;
    std::string normalized_selected_dtcg_json;
    AuthoredTokenSource source;
    std::vector<AuthoredTokenCollection> collections;
    std::map<std::string, std::string> selected_modes;
    Theme resolved_theme;
    bool resolved_theme_is_lossy = true;
    std::vector<AuthoredTokenDiagnostic> diagnostics;
};

AuthoredTokenDocument parse_authored_token_document(
    std::string authored_dtcg_json,
    AuthoredTokenSource source,
    const std::map<std::string, std::string>& requested_modes = {});

std::string serialize_authored_token_sidecar(const AuthoredTokenDocument& document);
AuthoredTokenDocument parse_authored_token_sidecar(const std::string& json);

}  // namespace pulp::view
