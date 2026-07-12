#include <pulp/view/application_binding_manifest.hpp>

#include <choc/text/choc_JSON.h>

#include <algorithm>
#include <set>

namespace pulp::view {
namespace {

std::string string_member(const choc::value::ValueView& object, const char* key) {
    if (!object.isObject() || !object.hasObjectMember(key) || !object[key].isString()) return {};
    return std::string(object[key].getString());
}

bool bool_member(const choc::value::ValueView& object, const char* key, bool fallback) {
    if (!object.isObject() || !object.hasObjectMember(key) || !object[key].isBool()) return fallback;
    return object[key].getBool();
}

bool fail(std::string* error, std::string message) {
    if (error) *error = std::move(message);
    return false;
}

template <typename T, typename Key>
std::vector<T> sorted_copy(const std::vector<T>& input, Key key) {
    auto result = input;
    std::sort(result.begin(), result.end(), [&](const T& a, const T& b) {
        return key(a) < key(b);
    });
    return result;
}

choc::value::Value fields_json(const std::vector<ApplicationValueField>& fields) {
    auto array = choc::value::createEmptyArray();
    for (const auto& field : sorted_copy(fields, [](const auto& v) { return v.name; })) {
        auto object = choc::value::createObject("");
        object.addMember("name", field.name);
        object.addMember("type", field.type);
        object.addMember("required", field.required);
        array.addArrayElement(object);
    }
    return array;
}

choc::value::Value signatures_json(const std::vector<ApplicationContractSignature>& signatures) {
    auto array = choc::value::createEmptyArray();
    for (const auto& signature : sorted_copy(signatures, [](const auto& v) { return v.id; })) {
        auto object = choc::value::createObject("");
        object.addMember("id", signature.id);
        object.addMember("variant", signature.variant);
        object.addMember("sourceAnchor", signature.source_anchor);
        object.addMember("required", signature.required);
        object.addMember("fields", fields_json(signature.fields));
        object.addMember("resultType", signature.result_type);
        array.addArrayElement(object);
    }
    return array;
}

bool parse_fields(const choc::value::ValueView& parent,
                  std::vector<ApplicationValueField>& output, std::string* error) {
    if (!parent.hasObjectMember("fields")) return true;
    auto fields = parent["fields"];
    if (!fields.isArray()) return fail(error, "fields must be an array");
    std::set<std::string> names;
    for (uint32_t i = 0; i < fields.size(); ++i) {
        auto value = fields[i];
        ApplicationValueField field{string_member(value, "name"), string_member(value, "type"),
                                    bool_member(value, "required", true)};
        if (field.name.empty() || field.type.empty())
            return fail(error, "typed fields require non-empty name and type");
        if (!names.insert(field.name).second) return fail(error, "duplicate typed field: " + field.name);
        output.push_back(std::move(field));
    }
    return true;
}

bool parse_signatures(const choc::value::ValueView& root, const char* section,
                      std::vector<ApplicationContractSignature>& output,
                      std::vector<UnknownApplicationBindingVariant>& unknown,
                      std::string* error) {
    if (!root.hasObjectMember(section)) return true;
    auto values = root[section];
    if (!values.isArray()) return fail(error, std::string(section) + " must be an array");
    std::set<std::string> ids;
    for (uint32_t i = 0; i < values.size(); ++i) {
        auto value = values[i];
        ApplicationContractSignature signature;
        signature.id = string_member(value, "id");
        signature.variant = string_member(value, "variant");
        signature.source_anchor = string_member(value, "sourceAnchor");
        signature.required = bool_member(value, "required", true);
        signature.result_type = string_member(value, "resultType");
        if (signature.id.empty()) return fail(error, std::string(section) + " entry requires id");
        if (!ids.insert(signature.id).second)
            return fail(error, std::string("duplicate ") + section + " id: " + signature.id);
        if (signature.variant != "typed") {
            if (signature.required)
                return fail(error, std::string("unknown required ") + section + " variant: " + signature.variant);
            unknown.push_back({section, signature.id, signature.variant});
            continue;
        }
        if (!parse_fields(value, signature.fields, error)) return false;
        output.push_back(std::move(signature));
    }
    return true;
}

}  // namespace

std::string serialize_application_binding_manifest(const ApplicationBindingManifest& manifest) {
    auto root = choc::value::createObject("");
    root.addMember("version", manifest.version);
    root.addMember("applicationId", manifest.application_id);

    auto anchors = choc::value::createEmptyArray();
    for (const auto& anchor : sorted_copy(manifest.source_anchors, [](const auto& v) { return v.id; })) {
        auto object = choc::value::createObject("");
        object.addMember("id", anchor.id);
        object.addMember("sourceUri", anchor.source_uri);
        object.addMember("symbol", anchor.symbol);
        anchors.addArrayElement(object);
    }
    root.addMember("sourceAnchors", anchors);
    root.addMember("actions", signatures_json(manifest.actions));
    root.addMember("events", signatures_json(manifest.events));
    root.addMember("data", signatures_json(manifest.data));

    auto modules = choc::value::createEmptyArray();
    for (const auto& module : sorted_copy(manifest.retained_modules, [](const auto& v) { return v.id; })) {
        auto object = choc::value::createObject("");
        object.addMember("id", module.id);
        object.addMember("variant", module.variant);
        object.addMember("entrypoint", module.entrypoint);
        object.addMember("sourceAnchor", module.source_anchor);
        object.addMember("required", module.required);
        modules.addArrayElement(object);
    }
    root.addMember("retainedModules", modules);

    auto capabilities = choc::value::createEmptyArray();
    auto sorted_capabilities = manifest.required_capabilities;
    std::sort(sorted_capabilities.begin(), sorted_capabilities.end());
    for (const auto& capability : sorted_capabilities) capabilities.addArrayElement(capability);
    root.addMember("requiredCapabilities", capabilities);

    auto scenarios = choc::value::createEmptyArray();
    for (const auto& scenario : sorted_copy(manifest.scenarios, [](const auto& v) { return v.id; })) {
        auto object = choc::value::createObject("");
        object.addMember("id", scenario.id);
        object.addMember("manifestUri", scenario.manifest_uri);
        object.addMember("required", scenario.required);
        scenarios.addArrayElement(object);
    }
    root.addMember("scenarios", scenarios);

    auto diagnostics = choc::value::createEmptyArray();
    for (const auto& diagnostic : sorted_copy(manifest.diagnostics, [](const auto& v) {
             return v.code + "\n" + v.path;
         })) {
        auto object = choc::value::createObject("");
        object.addMember("severity", diagnostic.severity);
        object.addMember("code", diagnostic.code);
        object.addMember("path", diagnostic.path);
        object.addMember("message", diagnostic.message);
        diagnostics.addArrayElement(object);
    }
    root.addMember("diagnostics", diagnostics);

    auto unknown = choc::value::createEmptyArray();
    for (const auto& variant : sorted_copy(manifest.unknown_optional_variants, [](const auto& v) {
             return v.section + "\n" + v.id;
         })) {
        auto object = choc::value::createObject("");
        object.addMember("section", variant.section);
        object.addMember("id", variant.id);
        object.addMember("variant", variant.variant);
        unknown.addArrayElement(object);
    }
    root.addMember("unknownOptionalVariants", unknown);
    return choc::json::toString(root, true);
}

std::optional<ApplicationBindingManifest> parse_application_binding_manifest(
    const std::string& json, std::string* error) {
    if (error) error->clear();
    choc::value::Value root;
    try {
        root = choc::json::parse(json);
    } catch (...) {
        fail(error, "invalid application binding manifest JSON");
        return std::nullopt;
    }
    if (!root.isObject()) { fail(error, "application binding manifest must be an object"); return std::nullopt; }
    ApplicationBindingManifest manifest;
    manifest.version = root.hasObjectMember("version") ? root["version"].getWithDefault<int>(0) : 0;
    if (manifest.version != kApplicationBindingManifestVersion) {
        fail(error, "unsupported application binding manifest version");
        return std::nullopt;
    }
    manifest.application_id = string_member(root, "applicationId");
    if (manifest.application_id.empty()) { fail(error, "applicationId is required"); return std::nullopt; }

    if (root.hasObjectMember("sourceAnchors")) {
        auto values = root["sourceAnchors"];
        if (!values.isArray()) { fail(error, "sourceAnchors must be an array"); return std::nullopt; }
        std::set<std::string> ids;
        for (uint32_t i = 0; i < values.size(); ++i) {
            ApplicationSourceAnchor anchor{string_member(values[i], "id"),
                                           string_member(values[i], "sourceUri"),
                                           string_member(values[i], "symbol")};
            if (anchor.id.empty() || anchor.source_uri.empty() || !ids.insert(anchor.id).second) {
                fail(error, "source anchors require unique ids and sourceUri"); return std::nullopt;
            }
            manifest.source_anchors.push_back(std::move(anchor));
        }
    }
    if (!parse_signatures(root, "actions", manifest.actions, manifest.unknown_optional_variants, error) ||
        !parse_signatures(root, "events", manifest.events, manifest.unknown_optional_variants, error) ||
        !parse_signatures(root, "data", manifest.data, manifest.unknown_optional_variants, error)) return std::nullopt;

    if (root.hasObjectMember("retainedModules")) {
        auto values = root["retainedModules"];
        if (!values.isArray()) { fail(error, "retainedModules must be an array"); return std::nullopt; }
        std::set<std::string> ids;
        for (uint32_t i = 0; i < values.size(); ++i) {
            RetainedModuleEntrypoint module{string_member(values[i], "id"), string_member(values[i], "variant"),
                                            string_member(values[i], "entrypoint"),
                                            string_member(values[i], "sourceAnchor"),
                                            bool_member(values[i], "required", true)};
            if (module.id.empty() || !ids.insert(module.id).second) {
                fail(error, "retained modules require unique ids"); return std::nullopt;
            }
            if (module.variant != "javascript" && module.variant != "native") {
                if (module.required) { fail(error, "unknown required retained module variant: " + module.variant); return std::nullopt; }
                manifest.unknown_optional_variants.push_back({"retainedModules", module.id, module.variant});
                continue;
            }
            if (module.entrypoint.empty()) { fail(error, "retained module entrypoint is required"); return std::nullopt; }
            manifest.retained_modules.push_back(std::move(module));
        }
    }

    if (root.hasObjectMember("requiredCapabilities")) {
        auto values = root["requiredCapabilities"];
        if (!values.isArray()) { fail(error, "requiredCapabilities must be an array"); return std::nullopt; }
        std::set<std::string> unique;
        for (uint32_t i = 0; i < values.size(); ++i) {
            if (!values[i].isString() || !unique.insert(std::string(values[i].getString())).second) {
                fail(error, "requiredCapabilities must contain unique strings"); return std::nullopt;
            }
            manifest.required_capabilities.push_back(std::string(values[i].getString()));
        }
    }

    if (root.hasObjectMember("scenarios")) {
        auto values = root["scenarios"];
        if (!values.isArray()) { fail(error, "scenarios must be an array"); return std::nullopt; }
        std::set<std::string> ids;
        for (uint32_t i = 0; i < values.size(); ++i) {
            ApplicationScenarioContract scenario{string_member(values[i], "id"),
                                                  string_member(values[i], "manifestUri"),
                                                  bool_member(values[i], "required", true)};
            if (scenario.id.empty() || scenario.manifest_uri.empty() || !ids.insert(scenario.id).second) {
                fail(error, "scenarios require id and manifestUri"); return std::nullopt;
            }
            manifest.scenarios.push_back(std::move(scenario));
        }
    }

    if (root.hasObjectMember("diagnostics")) {
        auto values = root["diagnostics"];
        if (!values.isArray()) { fail(error, "diagnostics must be an array"); return std::nullopt; }
        for (uint32_t i = 0; i < values.size(); ++i) {
            ApplicationBindingDiagnostic diagnostic{string_member(values[i], "severity"),
                                                     string_member(values[i], "code"),
                                                     string_member(values[i], "path"),
                                                     string_member(values[i], "message")};
            if (diagnostic.code.empty()) { fail(error, "diagnostics require code"); return std::nullopt; }
            manifest.diagnostics.push_back(std::move(diagnostic));
        }
    }
    if (root.hasObjectMember("unknownOptionalVariants")) {
        auto values = root["unknownOptionalVariants"];
        if (!values.isArray()) { fail(error, "unknownOptionalVariants must be an array"); return std::nullopt; }
        for (uint32_t i = 0; i < values.size(); ++i) {
            UnknownApplicationBindingVariant variant{string_member(values[i], "section"),
                                                      string_member(values[i], "id"),
                                                      string_member(values[i], "variant")};
            if (variant.section.empty() || variant.id.empty() || variant.variant.empty()) {
                fail(error, "unknown optional variants require section, id and variant"); return std::nullopt;
            }
            const auto duplicate = std::find_if(manifest.unknown_optional_variants.begin(),
                                                manifest.unknown_optional_variants.end(),
                                                [&](const auto& existing) {
                                                    return existing.section == variant.section &&
                                                           existing.id == variant.id &&
                                                           existing.variant == variant.variant;
                                                });
            if (duplicate == manifest.unknown_optional_variants.end())
                manifest.unknown_optional_variants.push_back(std::move(variant));
        }
    }
    return manifest;
}

const ApplicationContractSignature* find_application_action(
    const ApplicationBindingManifest& manifest, std::string_view id) {
    const auto found = std::find_if(manifest.actions.begin(), manifest.actions.end(),
                                    [id](const auto& action) { return action.id == id; });
    return found == manifest.actions.end() ? nullptr : &*found;
}

}  // namespace pulp::view
