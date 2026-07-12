#include <pulp/view/window_host.hpp>

#include <choc/text/choc_JSON.h>

namespace pulp::view {

std::optional<SourceWindowContract> parse_source_window_contract_json(std::string_view json) {
    try {
        const auto root = choc::json::parse(json);
        if (!root.isObject() || !root.hasObjectMember("schema") ||
            std::string(root["schema"].toString()) != "burl-source-window-contract-v1" ||
            !root.hasObjectMember("source") || !root["source"].isString() ||
            !root.hasObjectMember("observations") || !root["observations"].isObject() ||
            !root.hasObjectMember("projection") || !root["projection"].isObject()) return std::nullopt;
        const auto projection = root["projection"];
        const auto string_value = [&](const char* key) -> std::optional<std::string> {
            if (!projection.hasObjectMember(key) || !projection[key].isString()) return std::nullopt;
            return std::string(projection[key].toString());
        };
        const auto title = string_value("titleBarStyle");
        const auto backdrop = string_value("backdropEffect");
        if (!title || !backdrop || *title != "hidden_inset" ||
            (*backdrop != "vibrancy_menu" && *backdrop != "liquid_glass") ||
            !projection.hasObjectMember("transparent") || !projection["transparent"].isBool() ||
            !projection.hasObjectMember("trafficLightX") ||
            !projection.hasObjectMember("trafficLightY"))
            return std::nullopt;
        SourceWindowContract contract;
        contract.title_bar_style = WindowTitleBarStyle::hidden_inset;
        contract.backdrop_effect = *backdrop == "liquid_glass"
            ? WindowBackdropEffect::liquid_glass : WindowBackdropEffect::vibrancy_menu;
        if (const auto appearance = string_value("appearance")) {
            if (*appearance == "dark") contract.appearance = WindowAppearance::dark;
            else if (*appearance == "light") contract.appearance = WindowAppearance::light;
            else if (*appearance != "system") return std::nullopt;
        }
        contract.transparent = projection["transparent"].getWithDefault(false);
        contract.traffic_light_x = static_cast<float>(projection["trafficLightX"].getWithDefault(0.0));
        contract.traffic_light_y = static_cast<float>(projection["trafficLightY"].getWithDefault(0.0));
        if (projection.hasObjectMember("minimumContentSize")) {
            const auto minimum = projection["minimumContentSize"];
            if (!minimum.isObject() || !minimum.hasObjectMember("width") ||
                !minimum.hasObjectMember("height")) return std::nullopt;
            contract.minimum_width = static_cast<float>(minimum["width"].getWithDefault(0.0));
            contract.minimum_height = static_cast<float>(minimum["height"].getWithDefault(0.0));
            if (contract.minimum_width <= 0.0f || contract.minimum_height <= 0.0f)
                return std::nullopt;
        }
        const auto observations = root["observations"];
        contract.resizable = observations.hasObjectMember("resizable")
            ? observations["resizable"].getWithDefault(false) : false;
        if (!contract.transparent || !contract.resizable || *contract.traffic_light_x < 0.0f ||
            *contract.traffic_light_y < 0.0f) return std::nullopt;
        return contract;
    } catch (...) {
        return std::nullopt;
    }
}

}  // namespace pulp::view
