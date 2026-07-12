#include <pulp/view/authored_token_document.hpp>
#include <pulp/view/w3c_tokens.hpp>

#include <choc/text/choc_JSON.h>

#include <algorithm>
#include <stdexcept>
#include <utility>

namespace pulp::view {
namespace {

constexpr const char* kExtension = "com.pulp.authoredTokens";

std::string string_member(const choc::value::ValueView& value, const char* key) {
    return value.hasObjectMember(key) ? std::string(value[key].toString()) : std::string{};
}

choc::value::Value source_json(const AuthoredTokenSource& source) {
    auto value = choc::value::createObject("source");
    value.addMember("uri", source.uri);
    value.addMember("revision", source.revision);
    value.addMember("contentHash", source.content_hash);
    value.addMember("adapter", source.adapter);
    return value;
}

AuthoredTokenSource parse_source(const choc::value::ValueView& value) {
    return {string_member(value, "uri"), string_member(value, "revision"),
            string_member(value, "contentHash"), string_member(value, "adapter")};
}

void merge_theme(Theme& destination, const Theme& source) {
    destination.colors.insert(source.colors.begin(), source.colors.end());
    destination.dimensions.insert(source.dimensions.begin(), source.dimensions.end());
    destination.strings.insert(source.strings.begin(), source.strings.end());
}

}  // namespace

AuthoredTokenDocument parse_authored_token_document(
    std::string authored_dtcg_json, AuthoredTokenSource source,
    const std::map<std::string, std::string>& requested_modes) {
    AuthoredTokenDocument result;
    result.authored_dtcg_json = std::move(authored_dtcg_json);
    result.normalized_selected_dtcg_json = result.authored_dtcg_json;
    result.source = std::move(source);

    auto root = choc::json::parse(result.authored_dtcg_json);
    choc::value::ValueView extension;
    if (root.hasObjectMember("$extensions") && root["$extensions"].isObject() &&
        root["$extensions"].hasObjectMember(kExtension))
        extension = root["$extensions"][kExtension];

    if (extension.isObject() && extension.hasObjectMember("collections") &&
        extension["collections"].isArray()) {
        const auto collections = extension["collections"];
        for (uint32_t index = 0; index < collections.size(); ++index) {
            const auto item = collections[index];
            AuthoredTokenCollection collection;
            collection.id = string_member(item, "id");
            collection.default_mode = string_member(item, "defaultMode");
            if (item.hasObjectMember("modes") && item["modes"].isArray())
                for (uint32_t mode = 0; mode < item["modes"].size(); ++mode)
                    collection.modes.push_back(item["modes"][mode].toString());
            std::sort(collection.modes.begin(), collection.modes.end());
            collection.modes.erase(std::unique(collection.modes.begin(), collection.modes.end()),
                                   collection.modes.end());
            if (collection.id.empty() || collection.modes.empty()) {
                result.diagnostics.push_back({"tokens.collection.invalid",
                                              "collection id and modes must be non-empty"});
                continue;
            }
            if (result.selected_modes.contains(collection.id)) {
                result.diagnostics.push_back({"tokens.collection.duplicate", collection.id});
                continue;
            }
            auto requested = requested_modes.find(collection.id);
            std::string selected = requested == requested_modes.end() ? collection.default_mode
                                                                       : requested->second;
            if (std::find(collection.modes.begin(), collection.modes.end(), selected) ==
                collection.modes.end()) {
                result.diagnostics.push_back({"tokens.mode.fallback",
                                              "requested/default mode unavailable for " + collection.id});
                selected = collection.modes.front();
            }
            result.selected_modes[collection.id] = selected;
            result.collections.push_back(std::move(collection));
        }
        std::sort(result.collections.begin(), result.collections.end(),
                  [](const auto& left, const auto& right) { return left.id < right.id; });
    }

    bool projected_mode_document = false;
    if (extension.isObject() && extension.hasObjectMember("modeDocuments") &&
        extension["modeDocuments"].isObject()) {
        Theme merged;
        for (const auto& [collection, mode] : result.selected_modes) {
            const auto key = collection + "/" + mode;
            const auto documents = extension["modeDocuments"];
            if (!documents.hasObjectMember(key)) {
                result.diagnostics.push_back({"tokens.mode.document-missing", key});
                continue;
            }
            const auto normalized = choc::json::toString(documents[key], true);
            merge_theme(merged, parse_w3c_tokens(normalized));
            result.normalized_selected_dtcg_json = normalized;
            projected_mode_document = true;
        }
        if (projected_mode_document) result.resolved_theme = std::move(merged);
    }
    if (!projected_mode_document)
        result.resolved_theme = parse_w3c_tokens(result.normalized_selected_dtcg_json);
    return result;
}

std::string serialize_authored_token_sidecar(const AuthoredTokenDocument& document) {
    auto root = choc::value::createObject("authored-token-sidecar");
    root.addMember("schemaVersion", document.schema_version);
    root.addMember("authoredDtcgJson", document.authored_dtcg_json);
    root.addMember("themeProjection", "lossy");
    root.addMember("source", source_json(document.source));
    auto selected = choc::value::createObject("selectedModes");
    for (const auto& [collection, mode] : document.selected_modes)
        selected.addMember(collection, mode);
    root.addMember("selectedModes", std::move(selected));
    std::vector<choc::value::Value> diagnostic_values;
    for (const auto& diagnostic : document.diagnostics) {
        auto item = choc::value::createObject("diagnostic");
        item.addMember("code", diagnostic.code);
        item.addMember("message", diagnostic.message);
        diagnostic_values.push_back(std::move(item));
    }
    root.addMember("diagnostics", choc::value::createArray(diagnostic_values));
    return choc::json::toString(root, true);
}

AuthoredTokenDocument parse_authored_token_sidecar(const std::string& json) {
    const auto root = choc::json::parse(json);
    if (!root.hasObjectMember("schemaVersion") || root["schemaVersion"].getInt64() !=
        AuthoredTokenDocument::kSchemaVersion)
        throw std::runtime_error("unsupported authored token sidecar version");
    if (!root.hasObjectMember("authoredDtcgJson") || !root.hasObjectMember("source"))
        throw std::runtime_error("authored token sidecar is incomplete");
    std::map<std::string, std::string> selected;
    if (root.hasObjectMember("selectedModes") && root["selectedModes"].isObject()) {
        const auto modes = root["selectedModes"];
        for (uint32_t index = 0; index < modes.size(); ++index) {
            const auto member = modes.getObjectMemberAt(index);
            selected.emplace(std::string(member.name), member.value.toString());
        }
    }
    auto result = parse_authored_token_document(root["authoredDtcgJson"].toString(),
                                                parse_source(root["source"]), selected);
    if (root.hasObjectMember("diagnostics") && root["diagnostics"].isArray()) {
        const auto diagnostics = root["diagnostics"];
        for (uint32_t index = 0; index < diagnostics.size(); ++index) {
            const auto diagnostic = diagnostics[index];
            const auto code = string_member(diagnostic, "code");
            const auto message = string_member(diagnostic, "message");
            const auto duplicate = std::find_if(result.diagnostics.begin(), result.diagnostics.end(),
                [&](const auto& existing) {
                    return existing.code == code && existing.message == message;
                });
            if (duplicate == result.diagnostics.end())
                result.diagnostics.push_back({code, message});
        }
    }
    return result;
}

}  // namespace pulp::view
