#pragma once

#include <pulp/view/accessibility.hpp>

#include <cstddef>
#include <string>
#include <string_view>
#include <utility>

namespace pulp::view {

class BoundedAccessibilityLog {
public:
    explicit BoundedAccessibilityLog(std::size_t max_bytes = 480)
        : max_bytes_(max_bytes) {}

    void update(std::string stable_id, std::string_view text) {
        pending_id_ = std::move(stable_id);
        pending_text_ = truncate_utf8(text, max_bytes_);
        pending_ = true;
    }

    bool flush_frame() {
        if (!pending_) return false;
        announce_accessibility(pending_text_, AnnouncementPriority::Polite);
        last_id_ = pending_id_;
        pending_ = false;
        return true;
    }

    const std::string& last_stable_id() const { return last_id_; }
    std::size_t pending_bytes() const { return pending_text_.size(); }

private:
    static std::string truncate_utf8(std::string_view text, std::size_t limit) {
        if (text.size() <= limit) return std::string(text);
        std::size_t end = limit;
        while (end > 0 && (static_cast<unsigned char>(text[end]) & 0xc0) == 0x80) --end;
        return std::string(text.substr(0, end));
    }

    std::size_t max_bytes_;
    std::string pending_id_;
    std::string pending_text_;
    std::string last_id_;
    bool pending_ = false;
};

} // namespace pulp::view
