#pragma once

#include <functional>
#include <string>
#include <string_view>

namespace pulp::view {

class ScriptEngine;

using ImportedActionEndpoint = std::function<void(std::string_view payload)>;

class ImportedActionRuntime {
public:
    ImportedActionRuntime(ScriptEngine& engine, std::string dispatcher_name);

    [[nodiscard]] ImportedActionEndpoint endpoint(std::string action_id) const;

private:
    ScriptEngine* engine_;
    std::string dispatcher_name_;
};

} // namespace pulp::view
