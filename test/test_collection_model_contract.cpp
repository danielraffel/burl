#include <pulp/view/collection_model.hpp>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <iostream>
#include <random>
#include <string>
#include <vector>

using Model = pulp::view::CollectionModel;

static Model::Item item(std::size_t id, float height = 20.0f, std::uint64_t version = 1) {
    return {"k" + std::to_string(id), version, height, "article"};
}

static Model::Snapshot snapshot(std::size_t count, std::uint64_t revision = 1) {
    Model::Snapshot value{1, revision, {}};
    for (std::size_t index = 0; index < count; ++index) value.items.push_back(item(index));
    return value;
}

int main() {
    { // C1: randomized operations preserve vector order and prefix sums.
        Model model("c1"); assert(model.apply_snapshot(snapshot(10000)));
        std::vector<Model::Item> oracle = snapshot(10000).items;
        std::mt19937 rng(7); std::uint64_t revision = 1; std::size_t next = 10000;
        for (int step = 0; step < 1000; ++step) {
            Model::Patch patch{revision, revision + 1, {}};
            if (step % 3 == 0) { const auto index = rng() % (oracle.size() + 1); auto value = item(next++); patch.operations.push_back(Model::Insert{index, value}); oracle.insert(oracle.begin() + index, value); }
            else if (step % 3 == 1) { const auto index = rng() % oracle.size(); patch.operations.push_back(Model::Remove{index, oracle[index].key}); oracle.erase(oracle.begin() + index); }
            else { const auto from = rng() % oracle.size(); const auto to = rng() % oracle.size(); auto value = oracle[from]; patch.operations.push_back(Model::Move{from, to, value.key}); oracle.erase(oracle.begin() + from); oracle.insert(oracle.begin() + std::min(to, oracle.size()), value); }
            assert(model.apply_patch(patch)); revision++;
        }
        assert(model.size() == oracle.size());
        for (std::size_t index = 0; index < oracle.size(); ++index) assert(model.item_at(index)->key == oracle[index].key);
        assert(std::abs(model.total_height() - static_cast<float>(oracle.size() * 20)) < 0.5f);
    }
    { // C2: prepend and delayed measurement preserve the captured visual anchor.
        Model model("c2"); assert(model.apply_snapshot(snapshot(1000))); auto anchor = model.capture_anchor(10000, 400); assert(anchor);
        Model::Patch patch{1, 2, {}}; for (std::size_t i = 0; i < 500; ++i) patch.operations.push_back(Model::Insert{i, item(1000 + i)});
        assert(model.apply_patch(patch));
        for (std::size_t i = 0; i < 500; ++i) { auto token = model.bind("k" + std::to_string(1000 + i)); assert(model.commit_measurement({token, 800, 1, "en", 21, 1})); }
        assert(std::abs(model.restore_anchor(*anchor) - 20500.0f) < 0.5f);
    }
    { // C3: a late result after row reuse is stale-dropped.
        Model model("c3"); assert(model.apply_snapshot(snapshot(2))); auto old = model.bind("k0"); auto current = model.bind("k0");
        assert(!model.commit_measurement({old, 800, 1, "en", 80, 1}));
        assert(model.commit_measurement({current, 800, 1, "en", 80, 2}));
    }
    { // C4: reversed width completion cannot cross a measurement epoch.
        Model model("c4"); assert(model.apply_snapshot(snapshot(1))); auto at800 = model.bind("k0");
        auto changed = snapshot(1, 2); changed.epoch = 2; assert(model.apply_snapshot(changed)); auto at600 = model.bind("k0");
        assert(!model.commit_measurement({at800, 800, 1, "en", 30, 1}));
        assert(model.commit_measurement({at600, 600, 1, "en", 50, 2}));
    }
    { // C5: moving a focused key preserves logical focus and accessibility ID.
        Model model("c5"); assert(model.apply_snapshot(snapshot(10000))); model.set_focus(Model::Focus{"k5", "copy"}); const auto ax = model.accessibility_id("k5", "copy");
        assert(model.apply_patch({1, 2, {Model::Move{5, 9005, "k5"}}})); assert(model.focus()->key == "k5"); assert(model.accessibility_id("k5", "copy") == ax);
    }
    { // C6: composing-row removal resolves once before the row disappears.
        Model model("c6"); assert(model.apply_snapshot(snapshot(4))); model.set_composing_key("k2"); assert(model.set_resource_counts(4, 0, 1)); assert(model.apply_patch({1, 2, {Model::Remove{2, "k2"}}})); assert(model.composition_resolution_count() == 1); assert(model.apply_patch({2, 3, {}})); assert(model.composition_resolution_count() == 1); assert(!model.set_resource_counts(4, 0, 9));
    }
    { // C7: bottom-follow is conditional on proximity and user intent.
        Model model("c7"); assert(model.apply_snapshot(snapshot(100))); assert(model.should_follow_bottom(1600, 400, 1, false, false)); assert(!model.should_follow_bottom(1200, 400, 1, false, false)); assert(!model.should_follow_bottom(1600, 400, 1, true, false));
    }
    { // C8: removal falls back deterministically to successor position.
        Model model("c8"); assert(model.apply_snapshot(snapshot(10))); auto anchor = model.capture_anchor(80, 100); assert(anchor && anchor->key == "k4"); assert(model.apply_patch({1, 2, {Model::Remove{4, "k4"}}})); assert(std::abs(model.restore_anchor(*anchor) - 80) < 0.5f);
    }
    { // C9: invalid revisions and duplicate keys leave the old revision visible.
        Model model("c9"); assert(model.apply_snapshot(snapshot(3))); assert(!model.apply_patch({9, 10, {}})); assert(model.revision() == 1 && model.size() == 3 && model.reset_requested()); auto bad = snapshot(2, 2); bad.items[1].key = bad.items[0].key; assert(!model.apply_snapshot(bad)); assert(model.revision() == 1);
    }
    { // C10: a 100k collection stays within explicit row budgets.
        Model model("c10"); assert(model.apply_snapshot(snapshot(100000))); assert(model.set_resource_counts(128, 64, 4)); assert(!model.set_resource_counts(257, 64, 4));
    }
    { // C11: a reset is atomic and exposes only its final revision.
        Model model("c11"); assert(model.apply_snapshot(snapshot(10))); auto next = snapshot(12, 2); next.epoch = 2; assert(model.apply_patch({1, 2, {Model::Reset{next}}})); assert(model.revision() == 2 && model.size() == 12);
    }
    { // C12: deterministic measurement replay is independent of rejected stale completion order.
        auto run = [](bool reverse) { Model model("c12"); assert(model.apply_snapshot(snapshot(3))); auto a = model.bind("k0"), b = model.bind("k1"); std::vector<Model::Measurement> values{{a, 800, 1, "en", 31, 1}, {b, 800, 1, "en", 47, 1}}; if (reverse) std::reverse(values.begin(), values.end()); for (const auto& value : values) assert(model.commit_measurement(value)); return model.total_height(); };
        assert(std::abs(run(false) - run(true)) < 0.001f);
    }
    { // Measurements for unchanged keys survive ordinary collection patches.
        Model model("measurement-preservation"); assert(model.apply_snapshot(snapshot(3)));
        auto token = model.bind("k1"); assert(model.commit_measurement({token, 800, 1, "en", 80, 1}));
        assert(std::abs(model.total_height() - 120.0f) < 0.001f);
        assert(model.apply_patch({1, 2, {Model::Insert{0, item(10)}}}));
        assert(std::abs(model.total_height() - 140.0f) < 0.001f);
        assert(model.apply_patch({2, 3, {Model::Reload{2, item(1, 20.0f, 2)}}}));
        assert(std::abs(model.total_height() - 80.0f) < 0.001f);
    }
    { // Anchor removal follows the captured successor, not a shifted index.
        Model model("anchor-neighbors"); assert(model.apply_snapshot(snapshot(8)));
        auto anchor = model.capture_anchor(80, 60); assert(anchor && anchor->key == "k4");
        assert(model.apply_patch({1, 2, {Model::Insert{0, item(20)}, Model::Remove{5, "k4"}}}));
        assert(std::abs(model.restore_anchor(*anchor) - model.offset_of("k5")) < 0.001f);
    }
    { // Older or invalid measurement results cannot replace a committed result.
        Model model("measurement-order"); assert(model.apply_snapshot(snapshot(1)));
        const auto token = model.bind("k0");
        assert(model.commit_measurement({token, 800, 1, "en", 60, 2}));
        assert(!model.commit_measurement({token, 800, 1, "en", 30, 1}));
        assert(!model.commit_measurement({token, -1, 1, "en", 30, 3}));
        assert(!model.commit_measurement({token, 800, 0, "en", 30, 3}));
        assert(std::abs(model.total_height() - 60.0f) < 0.001f);
    }
    std::cout << "collection-model-contract C1-C15 PASS\n";
}
