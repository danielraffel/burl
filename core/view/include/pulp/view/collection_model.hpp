#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <variant>
#include <vector>

namespace pulp::view {

class CollectionModel {
public:
    using Key = std::string;

    struct Item {
        Key key;
        std::uint64_t content_version = 0;
        float estimated_height = 0.0f;
        std::string role;
    };

    struct Snapshot {
        std::uint64_t epoch = 0;
        std::uint64_t revision = 0;
        std::vector<Item> items;
    };

    struct Insert { std::size_t index; Item item; };
    struct Remove { std::size_t index; Key expected_key; };
    struct Move { std::size_t from; std::size_t to; Key expected_key; };
    struct Reload { std::size_t index; Item item; };
    struct Reset { Snapshot snapshot; };
    using Operation = std::variant<Insert, Remove, Move, Reload, Reset>;

    struct Patch {
        std::uint64_t base_revision = 0;
        std::uint64_t new_revision = 0;
        std::vector<Operation> operations;
    };

    struct BindingToken {
        Key key;
        std::uint64_t content_version = 0;
        std::uint64_t binding_generation = 0;
        std::uint64_t measurement_epoch = 0;
    };

    struct Measurement {
        BindingToken token;
        float width = 0.0f;
        float font_scale = 1.0f;
        std::string locale;
        float height = 0.0f;
        std::uint64_t measurement_version = 0;
    };

    struct Anchor {
        Key key;
        float intra_row_offset = 0.0f;
        std::size_t old_index = 0;
        std::optional<Key> predecessor;
        std::optional<Key> successor;
    };

    struct Focus {
        Key key;
        std::string descendant_id;
    };

    struct Bounds {
        std::size_t max_items = 100000;
        std::size_t max_live_rows = 256;
        std::size_t max_pool_rows = 128;
        std::size_t max_pinned_rows = 8;
        std::size_t max_measurements = 200000;
    };

    explicit CollectionModel(std::string collection_id)
        : CollectionModel(std::move(collection_id), Bounds{}) {}
    CollectionModel(std::string collection_id, Bounds bounds)
        : collection_id_(std::move(collection_id)), bounds_(bounds) {}

    bool apply_snapshot(const Snapshot& snapshot) {
        if (!validate_items(snapshot.items)) return reject();
        items_ = snapshot.items;
        epoch_ = snapshot.epoch;
        revision_ = snapshot.revision;
        ++measurement_epoch_;
        rebuild_index_and_tree();
        reset_requested_ = false;
        return true;
    }

    bool apply_patch(const Patch& patch) {
        if (patch.base_revision != revision_ || patch.new_revision <= patch.base_revision)
            return reject();
        auto candidate = items_;
        auto candidate_epoch = epoch_;
        for (const auto& operation : patch.operations) {
            if (const auto* insert = std::get_if<Insert>(&operation)) {
                if (insert->index > candidate.size()) return reject();
                candidate.insert(candidate.begin() + static_cast<std::ptrdiff_t>(insert->index), insert->item);
            } else if (const auto* remove = std::get_if<Remove>(&operation)) {
                if (remove->index >= candidate.size() || candidate[remove->index].key != remove->expected_key)
                    return reject();
                candidate.erase(candidate.begin() + static_cast<std::ptrdiff_t>(remove->index));
            } else if (const auto* move = std::get_if<Move>(&operation)) {
                if (move->from >= candidate.size() || move->to > candidate.size() ||
                    candidate[move->from].key != move->expected_key) return reject();
                auto item = candidate[move->from];
                candidate.erase(candidate.begin() + static_cast<std::ptrdiff_t>(move->from));
                const auto destination = std::min(move->to, candidate.size());
                candidate.insert(candidate.begin() + static_cast<std::ptrdiff_t>(destination), std::move(item));
            } else if (const auto* reload = std::get_if<Reload>(&operation)) {
                if (reload->index >= candidate.size() || candidate[reload->index].key != reload->item.key)
                    return reject();
                candidate[reload->index] = reload->item;
            } else if (const auto* reset = std::get_if<Reset>(&operation)) {
                if (reset->snapshot.revision != patch.new_revision ||
                    !validate_items(reset->snapshot.items)) return reject();
                candidate = reset->snapshot.items;
                candidate_epoch = reset->snapshot.epoch;
            }
        }
        if (!validate_items(candidate)) return reject();
        std::unordered_map<Key, std::pair<std::uint64_t, float>> preserved_heights;
        if (candidate_epoch == epoch_) {
            for (std::size_t index = 0; index < items_.size(); ++index)
                preserved_heights.emplace(items_[index].key,
                    std::pair{items_[index].content_version, heights_[index]});
        }
        items_ = std::move(candidate);
        if (candidate_epoch != epoch_) {
            epoch_ = candidate_epoch;
            ++measurement_epoch_;
        }
        revision_ = patch.new_revision;
        if (composing_key_ && !contains_key(items_, *composing_key_)) {
            ++composition_resolution_count_;
            composing_key_.reset();
        }
        rebuild_index_and_tree(preserved_heights.empty() ? nullptr : &preserved_heights);
        reset_requested_ = false;
        return true;
    }

    BindingToken bind(const Key& key) {
        const auto it = indices_.find(key);
        if (it == indices_.end()) return {};
        return {key, items_[it->second].content_version, ++binding_generation_[key], measurement_epoch_};
    }

    bool commit_measurement(const Measurement& measurement) {
        const auto it = indices_.find(measurement.token.key);
        if (it == indices_.end() || !std::isfinite(measurement.height) || measurement.height < 0.0f)
            return false;
        const auto& item = items_[it->second];
        if (item.content_version != measurement.token.content_version ||
            binding_generation_[item.key] != measurement.token.binding_generation ||
            measurement_epoch_ != measurement.token.measurement_epoch) return false;
        const MeasurementKey cache_key{item.key, item.content_version, quantize_width(measurement.width),
                                       quantize_scale(measurement.font_scale), measurement.locale};
        if (!measurement_cache_.contains(cache_key) && measurement_cache_.size() >= bounds_.max_measurements)
            return false;
        measurement_cache_[cache_key] = {measurement.height, measurement.measurement_version};
        const float delta = measurement.height - heights_[it->second];
        heights_[it->second] = measurement.height;
        add_tree(it->second, delta);
        return true;
    }

    std::optional<Anchor> capture_anchor(float scroll_y, float viewport_height) const {
        if (items_.empty()) return std::nullopt;
        const float bottom = scroll_y + viewport_height;
        for (std::size_t index = 0; index < items_.size(); ++index) {
            const float top = prefix(index);
            const float row_bottom = top + heights_[index];
            if (top >= scroll_y - 0.0001f && row_bottom <= bottom + 0.0001f)
                return make_anchor(index, scroll_y - top);
        }
        const auto index = index_at(scroll_y);
        return make_anchor(index, scroll_y - prefix(index));
    }

    float restore_anchor(const Anchor& anchor) const {
        if (const auto it = indices_.find(anchor.key); it != indices_.end())
            return std::max(0.0f, prefix(it->second) + anchor.intra_row_offset);
        if (items_.empty()) return 0.0f;
        if (anchor.successor) {
            if (const auto it = indices_.find(*anchor.successor); it != indices_.end())
                return std::max(0.0f, prefix(it->second) + anchor.intra_row_offset);
        }
        if (anchor.predecessor) {
            if (const auto it = indices_.find(*anchor.predecessor); it != indices_.end())
                return std::max(0.0f, prefix(it->second + 1) + anchor.intra_row_offset);
        }
        const auto fallback = std::min(anchor.old_index, items_.size() - 1);
        return std::max(0.0f, prefix(fallback) + anchor.intra_row_offset);
    }

    bool should_follow_bottom(float scroll_y, float viewport_height, float threshold,
                              bool user_scrolling, bool selecting) const {
        return !user_scrolling && !selecting &&
               total_height() - (scroll_y + viewport_height) <= threshold;
    }

    float bottom_scroll(float viewport_height) const {
        return std::max(0.0f, total_height() - viewport_height);
    }

    void set_focus(std::optional<Focus> focus) { focus_ = std::move(focus); }
    const std::optional<Focus>& focus() const { return focus_; }
    std::string accessibility_id(const Key& key, const std::string& descendant) const {
        return collection_id_ + ":" + key + ":" + descendant;
    }
    void set_composing_key(std::optional<Key> key) { composing_key_ = std::move(key); }
    std::size_t composition_resolution_count() const { return composition_resolution_count_; }

    bool set_resource_counts(std::size_t live, std::size_t pooled, std::size_t pinned) {
        if (live > bounds_.max_live_rows || pooled > bounds_.max_pool_rows ||
            pinned > bounds_.max_pinned_rows) return false;
        live_rows_ = live;
        pool_rows_ = pooled;
        pinned_rows_ = pinned;
        return true;
    }

    std::uint64_t revision() const { return revision_; }
    std::uint64_t epoch() const { return epoch_; }
    std::uint64_t measurement_epoch() const { return measurement_epoch_; }
    std::size_t size() const { return items_.size(); }
    float total_height() const { return prefix(items_.size()); }
    float offset_of(const Key& key) const {
        const auto it = indices_.find(key);
        return it == indices_.end() ? -1.0f : prefix(it->second);
    }
    const Item* item_at(std::size_t index) const { return index < items_.size() ? &items_[index] : nullptr; }
    bool reset_requested() const { return reset_requested_; }

private:
    struct MeasurementKey {
        Key key;
        std::uint64_t content_version;
        std::uint32_t width;
        std::uint32_t scale;
        std::string locale;
        bool operator==(const MeasurementKey&) const = default;
    };
    struct MeasurementKeyHash {
        std::size_t operator()(const MeasurementKey& value) const {
            std::size_t hash = std::hash<std::string>{}(value.key);
            auto mix = [&hash](std::size_t part) { hash ^= part + 0x9e3779b9 + (hash << 6) + (hash >> 2); };
            mix(std::hash<std::uint64_t>{}(value.content_version));
            mix(value.width); mix(value.scale); mix(std::hash<std::string>{}(value.locale));
            return hash;
        }
    };
    struct CachedMeasurement { float height; std::uint64_t version; };

    bool validate_items(const std::vector<Item>& items) const {
        if (items.size() > bounds_.max_items) return false;
        std::unordered_set<Key> keys;
        for (const auto& item : items)
            if (item.key.empty() || !std::isfinite(item.estimated_height) || item.estimated_height < 0.0f ||
                !keys.insert(item.key).second) return false;
        return true;
    }
    static bool contains_key(const std::vector<Item>& items, const Key& key) {
        return std::any_of(items.begin(), items.end(), [&](const auto& item) { return item.key == key; });
    }
    bool reject() { reset_requested_ = true; return false; }
    static std::uint32_t quantize_width(float value) { return static_cast<std::uint32_t>(std::lround(value * 8.0f)); }
    static std::uint32_t quantize_scale(float value) { return static_cast<std::uint32_t>(std::lround(value * 1024.0f)); }
    Anchor make_anchor(std::size_t index, float intra_row_offset) const {
        Anchor anchor{items_[index].key, intra_row_offset, index, std::nullopt, std::nullopt};
        if (index > 0) anchor.predecessor = items_[index - 1].key;
        if (index + 1 < items_.size()) anchor.successor = items_[index + 1].key;
        return anchor;
    }
    void rebuild_index_and_tree(
        const std::unordered_map<Key, std::pair<std::uint64_t, float>>* preserved = nullptr) {
        indices_.clear(); heights_.clear(); tree_.assign(items_.size() + 1, 0.0f);
        for (std::size_t index = 0; index < items_.size(); ++index) {
            indices_[items_[index].key] = index;
            float height = items_[index].estimated_height;
            if (preserved) {
                const auto found = preserved->find(items_[index].key);
                if (found != preserved->end() &&
                    found->second.first == items_[index].content_version)
                    height = found->second.second;
            }
            heights_.push_back(height);
            add_tree(index, height);
        }
    }
    void add_tree(std::size_t index, float delta) {
        for (std::size_t cursor = index + 1; cursor < tree_.size(); cursor += cursor & (~cursor + 1))
            tree_[cursor] += delta;
    }
    float prefix(std::size_t count) const {
        float total = 0.0f;
        for (std::size_t cursor = count; cursor > 0; cursor &= cursor - 1) total += tree_[cursor];
        return total;
    }
    std::size_t index_at(float position) const {
        std::size_t low = 0, high = items_.size();
        while (low + 1 < high) {
            const auto middle = (low + high) / 2;
            if (prefix(middle) <= position) low = middle; else high = middle;
        }
        return low;
    }

    std::string collection_id_;
    Bounds bounds_;
    std::vector<Item> items_;
    std::vector<float> heights_;
    std::vector<float> tree_;
    std::unordered_map<Key, std::size_t> indices_;
    std::unordered_map<Key, std::uint64_t> binding_generation_;
    std::unordered_map<MeasurementKey, CachedMeasurement, MeasurementKeyHash> measurement_cache_;
    std::optional<Focus> focus_;
    std::optional<Key> composing_key_;
    std::uint64_t epoch_ = 0;
    std::uint64_t revision_ = 0;
    std::uint64_t measurement_epoch_ = 1;
    std::size_t live_rows_ = 0, pool_rows_ = 0, pinned_rows_ = 0;
    std::size_t composition_resolution_count_ = 0;
    bool reset_requested_ = false;
};

template <class Row>
class CollectionAdapter {
public:
    struct MeasuredSize { float height = 0.0f; std::uint64_t measurement_version = 0; };
    virtual ~CollectionAdapter() = default;
    virtual Row create(const std::string& reuse_kind) = 0;
    virtual CollectionModel::BindingToken bind(Row& row, const CollectionModel::Key& key,
                                                std::size_t index,
                                                std::uint64_t content_version) = 0;
    virtual void unbind(Row& row, const CollectionModel::Key& key) = 0;
    virtual MeasuredSize measure(Row& row, float width_constraint) = 0;
    virtual void prepare_accessibility(Row& row, const CollectionModel::Key& key) = 0;
    virtual void on_focus_transfer(const std::optional<CollectionModel::Key>& old_key,
                                   const std::optional<CollectionModel::Key>& new_key) = 0;
};

} // namespace pulp::view
