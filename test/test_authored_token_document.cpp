#include <catch2/catch_test_macros.hpp>

#include <pulp/view/authored_token_document.hpp>

#include <string>

using namespace pulp::view;

namespace {

const std::string authored = R"JSON({
  "$extensions": {
    "org.example.original": {"opaque": [3, 2, 1]},
    "com.pulp.authoredTokens": {
      "collections": [{"id":"appearance","defaultMode":"light","modes":["light","dark"]}],
      "modeDocuments": {
        "appearance/light": {"surface":{"$type":"color","$value":"#ffffff"},"space":{"$type":"dimension","$value":"8px"}},
        "appearance/dark": {"surface":{"$type":"color","$value":"#101010"},"space":{"$type":"dimension","$value":"10px"}}
      }
    }
  },
  "palette": {"base":{"$type":"color","$value":"#ffffff"}},
  "semantic": {"surface":{"$type":"color","$value":"{palette.base}"}}
})JSON";

AuthoredTokenSource source() {
    return {"figma://file/node", "rev-7", "sha256:abc", "figma-plugin-v1"};
}

}  // namespace

TEST_CASE("authored token sidecar preserves DTCG aliases extensions and source identity",
          "[tokens][dtcg][sidecar]") {
    auto document = parse_authored_token_document(authored, source(), {{"appearance", "dark"}});
    REQUIRE(document.authored_dtcg_json == authored);
    REQUIRE(document.authored_dtcg_json.find("{palette.base}") != std::string::npos);
    REQUIRE(document.authored_dtcg_json.find("org.example.original") != std::string::npos);
    REQUIRE(document.source.revision == "rev-7");
    REQUIRE(document.selected_modes.at("appearance") == "dark");
    REQUIRE(document.collections.size() == 1);
    REQUIRE(document.collections[0].modes == std::vector<std::string>{"dark", "light"});
    REQUIRE(document.resolved_theme_is_lossy);
    REQUIRE(document.resolved_theme.color("surface").has_value());
    REQUIRE(document.resolved_theme.dimension("space") == 10.0f);
}

TEST_CASE("authored token sidecar round-trip is deterministic", "[tokens][dtcg][sidecar]") {
    const auto first = parse_authored_token_document(authored, source(), {{"appearance", "dark"}});
    const auto encoded = serialize_authored_token_sidecar(first);
    const auto decoded = parse_authored_token_sidecar(encoded);
    REQUIRE(decoded.authored_dtcg_json == authored);
    REQUIRE(decoded.selected_modes == first.selected_modes);
    REQUIRE(decoded.source.content_hash == "sha256:abc");
    REQUIRE(serialize_authored_token_sidecar(decoded) == encoded);
}

TEST_CASE("authored token mode fallback is deterministic and diagnosed",
          "[tokens][dtcg][sidecar][negative]") {
    const auto document = parse_authored_token_document(authored, source(),
                                                        {{"appearance", "missing"}});
    REQUIRE(document.selected_modes.at("appearance") == "dark");
    REQUIRE(document.diagnostics.size() == 1);
    REQUIRE(document.diagnostics[0].code == "tokens.mode.fallback");
    const auto round_trip = parse_authored_token_sidecar(
        serialize_authored_token_sidecar(document));
    REQUIRE(round_trip.diagnostics.size() == 1);
    REQUIRE(round_trip.diagnostics[0].code == "tokens.mode.fallback");
}

TEST_CASE("authored token missing selected mode document is diagnosed",
          "[tokens][dtcg][sidecar][negative]") {
    auto without_dark = authored;
    const auto position = without_dark.find("\"appearance/dark\"");
    REQUIRE(position != std::string::npos);
    without_dark.replace(position, std::string("\"appearance/dark\"").size(),
                         "\"appearance/other\"");
    const auto document = parse_authored_token_document(without_dark, source(),
                                                        {{"appearance", "dark"}});
    REQUIRE(document.diagnostics.size() == 1);
    REQUIRE(document.diagnostics[0].code == "tokens.mode.document-missing");
}

TEST_CASE("authored token sidecar rejects unsupported versions",
          "[tokens][dtcg][sidecar][negative]") {
    REQUIRE_THROWS(parse_authored_token_sidecar(
        R"({"schemaVersion":2,"authoredDtcgJson":"{}","source":{}})"));
    REQUIRE_THROWS(parse_authored_token_document("{", source()));
}
