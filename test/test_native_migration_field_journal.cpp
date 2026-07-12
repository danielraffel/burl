#include <catch2/catch_test_macros.hpp>

#include <pulp/state/async_reducer.hpp>
#include <pulp/view/accessibility_tree.hpp>
#include <pulp/view/collection_model.hpp>
#include <pulp/view/markdown_view.hpp>
#include <pulp/view/text_editor.hpp>

#include <algorithm>
#include <memory>
#include <string>
#include <vector>

namespace {

using pulp::state::AsyncEvent;
using pulp::state::AsyncEventKind;
using pulp::state::AsyncReducer;
using pulp::view::CollectionModel;
using pulp::view::FlexDirection;
using pulp::view::MarkdownView;
using pulp::view::TextEditor;
using pulp::view::View;

AsyncEvent delta(pulp::state::AsyncTaskKey key, std::uint64_t sequence,
                 std::string text) {
    return {key, sequence, sequence, 1, AsyncEventKind::delta,
            "entry", std::move(text)};
}

std::string stream_entry(const std::vector<std::string>& chunks, bool reverse) {
    AsyncReducer reducer(31);
    const auto key = reducer.start();
    std::vector<AsyncEvent> events;
    for (std::size_t index = 0; index < chunks.size(); ++index)
        events.push_back(delta(key, index, chunks[index]));
    if (reverse) std::reverse(events.begin(), events.end());
    for (auto& event : events) REQUIRE(reducer.enqueue(std::move(event)));
    reducer.drain();
    REQUIRE(reducer.phase() == AsyncReducer::Phase::running);
    return reducer.state();
}

void apply_projection(View& root, View& index, float width) {
    const bool wide = width >= 600.0f;
    root.set_bounds({0, 0, width, 560});
    root.flex().direction = wide ? FlexDirection::row : FlexDirection::column;
    index.set_visible(wide);
    root.layout_children();
}

std::vector<std::string> group_ax_log(const View& root) {
    std::vector<std::string> result;
    for (const auto& node : pulp::view::snapshot_accessibility_tree(root))
        if (node.role == View::AccessRole::group) result.push_back(node.label);
    return result;
}

}  // namespace

TEST_CASE("held-out field journal migration preserves streaming layout focus and AX log",
          "[native-migration][async][collection][markdown][a11y]") {
    const std::vector<std::string> snow_chunks{
        "## Snow line\n", "Packed snow began above ", "**1,850 m**."
    };
    const std::vector<std::string> wind_chunks{
        "## Wind shift\n", "Gusts moved **northwest** ", "after 14:20."
    };
    REQUIRE(stream_entry(snow_chunks, false) == stream_entry(snow_chunks, true));
    REQUIRE(stream_entry(wind_chunks, false) == stream_entry(wind_chunks, true));
    const auto snow_streamed = stream_entry(snow_chunks, true);
    const auto wind_streamed = stream_entry(wind_chunks, true);

    CollectionModel collection("field-journal");
    REQUIRE(collection.apply_snapshot({1, 1, {
        {"reading-01", 1, 48.0f, "article"},
        {"reading-02", 1, 76.0f, "article"},
    }}));
    collection.set_focus(CollectionModel::Focus{"reading-02", "entry"});
    const auto stable_ax = collection.accessibility_id("reading-02", "entry");

    View root;
    auto index = std::make_unique<View>();
    index->set_access_role(View::AccessRole::group);
    index->set_access_label("Field journal");
    index->flex().preferred_width = 220.0f;
    index->flex().min_width = 180.0f;
    index->flex().max_width = 240.0f;
    auto* index_ptr = index.get();

    auto content = std::make_unique<View>();
    content->flex().direction = FlexDirection::column;
    content->flex().flex_grow = 1.0f;

    auto first = std::make_unique<MarkdownView>(snow_streamed);
    first->set_access_label("Snow line");
    first->flex().preferred_height = 48.0f;
    auto second = std::make_unique<MarkdownView>(wind_streamed);
    second->set_access_label("Wind shift");
    second->flex().preferred_height = 76.0f;
    auto editor = std::make_unique<TextEditor>();
    editor->multi_line = true;
    editor->set_text("Add a field observation");
    editor->set_access_role(View::AccessRole::group);
    editor->set_access_label("Observation note");
    editor->set_access_value(editor->text());
    editor->flex().preferred_height = 104.0f;

    content->add_child(std::move(first));
    content->add_child(std::move(second));
    content->add_child(std::move(editor));
    root.add_child(std::move(index));
    root.add_child(std::move(content));

    apply_projection(root, *index_ptr, 920.0f);
    REQUIRE(index_ptr->visible());
    REQUIRE(root.child_at(1)->bounds().width > index_ptr->bounds().width);
    apply_projection(root, *index_ptr, 520.0f);
    REQUIRE_FALSE(index_ptr->visible());
    REQUIRE(root.child_at(1)->bounds().width == 520.0f);
    apply_projection(root, *index_ptr, 920.0f);
    REQUIRE(index_ptr->visible());

    const auto token1 = collection.bind("reading-01");
    const auto token2 = collection.bind("reading-02");
    REQUIRE(collection.commit_measurement({token1, 700, 1, "en-US", 48, 1}));
    REQUIRE(collection.commit_measurement({token2, 700, 1, "en-US", 76, 1}));
    REQUIRE(collection.apply_patch({1, 2, {
        CollectionModel::Insert{2, {"reading-03", 1, 104.0f, "article"}}
    }}));
    const auto token3 = collection.bind("reading-03");
    REQUIRE(collection.commit_measurement({token3, 700, 1, "en-US", 104, 1}));
    REQUIRE(collection.total_height() == 228.0f);
    REQUIRE(collection.focus()->key == "reading-02");
    REQUIRE(collection.accessibility_id("reading-02", "entry") == stable_ax);

    REQUIRE(group_ax_log(root) == std::vector<std::string>{
        "Field journal", "Snow line", "Wind shift", "Observation note"
    });
}
