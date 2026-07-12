#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace pulp::view {

inline constexpr int kApplicationBindingManifestVersion = 1;

struct ApplicationSourceAnchor {
    std::string id;
    std::string source_uri;
    std::string symbol;
};

struct ApplicationValueField {
    std::string name;
    std::string type;
    bool required = true;
};

struct ApplicationContractSignature {
    std::string id;
    std::string variant = "typed";
    std::string source_anchor;
    bool required = true;
    std::vector<ApplicationValueField> fields;
    std::string result_type;
};

struct RetainedModuleEntrypoint {
    std::string id;
    std::string variant;
    std::string entrypoint;
    std::string source_anchor;
    bool required = true;
};

struct ApplicationScenarioContract {
    std::string id;
    std::string manifest_uri;
    bool required = true;
};

struct ApplicationBindingDiagnostic {
    std::string severity;
    std::string code;
    std::string path;
    std::string message;
};

struct UnknownApplicationBindingVariant {
    std::string section;
    std::string id;
    std::string variant;
};

struct ApplicationBindingManifest {
    int version = kApplicationBindingManifestVersion;
    std::string application_id;
    std::vector<ApplicationSourceAnchor> source_anchors;
    std::vector<ApplicationContractSignature> actions;
    std::vector<ApplicationContractSignature> events;
    std::vector<ApplicationContractSignature> data;
    std::vector<RetainedModuleEntrypoint> retained_modules;
    std::vector<std::string> required_capabilities;
    std::vector<ApplicationScenarioContract> scenarios;
    std::vector<ApplicationBindingDiagnostic> diagnostics;
    std::vector<UnknownApplicationBindingVariant> unknown_optional_variants;
};

std::string serialize_application_binding_manifest(
    const ApplicationBindingManifest& manifest);

std::optional<ApplicationBindingManifest> parse_application_binding_manifest(
    const std::string& json, std::string* error = nullptr);

const ApplicationContractSignature* find_application_action(
    const ApplicationBindingManifest& manifest, std::string_view id);

}  // namespace pulp::view
