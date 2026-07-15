#include <pulp/view/imported_action_runtime.hpp>

#include <pulp/view/script_engine.hpp>

#include <stdexcept>
#include <utility>

namespace pulp::view {

ImportedActionRuntime::ImportedActionRuntime(ScriptEngine& engine,
                                             std::string dispatcher_name)
    : engine_(&engine), dispatcher_name_(std::move(dispatcher_name)) {
    if (dispatcher_name_.empty())
        throw std::invalid_argument("imported action dispatcher name must not be empty");
}

ImportedActionEndpoint ImportedActionRuntime::endpoint(std::string action_id) const {
    if (action_id.empty())
        throw std::invalid_argument("imported action id must not be empty");

    auto* engine = engine_;
    auto dispatcher_name = dispatcher_name_;
    return [engine, dispatcher_name = std::move(dispatcher_name),
            action_id = std::move(action_id)](std::string_view payload) {
        engine->invoke(dispatcher_name, action_id, std::string(payload));
    };
}

} // namespace pulp::view
