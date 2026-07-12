#include <pulp/view/application_binding_manifest.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace pulp::view;

TEST_CASE("application binding manifest round-trips deterministically", "[view][import]") {
    ApplicationBindingManifest manifest;
    manifest.application_id = "chat";
    manifest.source_anchors = {{"composer", "src/chat.tsx", "ChatInput"},
                               {"stream", "src/streaming.ts", "applyDelta"}};
    manifest.actions = {{"prompt.send", "typed", "composer", true,
                         {{"text", "string", true}}, "request-id"}};
    manifest.events = {{"message.part.delta", "typed", "stream", true,
                        {{"sessionID", "string", true}, {"delta", "string", true}}, "void"}};
    manifest.data = {{"session.current", "typed", "stream", true, {}, "session"}};
    manifest.retained_modules = {{"message-store", "javascript", "src/atoms/messages.ts", "stream", true}};
    manifest.required_capabilities = {"native-markdown", "variable-height-collection"};
    manifest.scenarios = {{"streamed-turn", "scenarios/streamed-turn.json", true}};
    manifest.diagnostics = {{"warning", "retained-module", "$.retainedModules[0]",
                             "Message state remains source-owned."}};

    const auto first = serialize_application_binding_manifest(manifest);
    std::string error;
    const auto parsed = parse_application_binding_manifest(first, &error);
    REQUIRE(parsed);
    REQUIRE(error.empty());
    REQUIRE(parsed->actions.front().fields.front().type == "string");
    REQUIRE(parsed->retained_modules.front().variant == "javascript");
    REQUIRE(serialize_application_binding_manifest(*parsed) == first);
}

TEST_CASE("application binding manifest rejects unknown required variants", "[view][import]") {
    std::string error;
    auto parsed = parse_application_binding_manifest(R"json({
      "version": 1,
      "applicationId": "chat",
      "actions": [{"id":"prompt.send","variant":"shell","required":true}]
    })json", &error);
    REQUIRE_FALSE(parsed);
    REQUIRE(error == "unknown required actions variant: shell");

    parsed = parse_application_binding_manifest(R"json({
      "version": 1,
      "applicationId": "chat",
      "retainedModules": [{"id":"store","variant":"browser","entrypoint":"store.ts","required":true}]
    })json", &error);
    REQUIRE_FALSE(parsed);
    REQUIRE(error == "unknown required retained module variant: browser");
}

TEST_CASE("application binding manifest diagnoses optional unknown variants", "[view][import]") {
    std::string error;
    const auto parsed = parse_application_binding_manifest(R"json({
      "version": 1,
      "applicationId": "chat",
      "events": [{"id":"telemetry","variant":"opaque","required":false}],
      "retainedModules": [{"id":"metrics","variant":"wasm","entrypoint":"metrics.wasm","required":false}]
    })json", &error);
    REQUIRE(parsed);
    REQUIRE(parsed->events.empty());
    REQUIRE(parsed->retained_modules.empty());
    REQUIRE(parsed->unknown_optional_variants.size() == 2);
    const auto canonical = serialize_application_binding_manifest(*parsed);
    const auto reparsed = parse_application_binding_manifest(canonical, &error);
    REQUIRE(reparsed);
    REQUIRE(reparsed->unknown_optional_variants.size() == 2);
    REQUIRE(serialize_application_binding_manifest(*reparsed) == canonical);
}

TEST_CASE("application binding manifest rejects malformed typed contracts", "[view][import]") {
    std::string error;
    REQUIRE_FALSE(parse_application_binding_manifest(R"json({
      "version": 1,
      "applicationId": "chat",
      "events": [{"id":"delta","variant":"typed","fields":[{"name":"text","type":""}]}]
    })json", &error));
    REQUIRE(error == "typed fields require non-empty name and type");
    REQUIRE_FALSE(parse_application_binding_manifest(R"json({"version":2,"applicationId":"chat"})json", &error));
    REQUIRE(error == "unsupported application binding manifest version");
}
